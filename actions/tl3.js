// 诊断：① 同一任务重复点击能否推进 currstep 直到 FINISH  ② FINISH 任务的奖励领取接口探测
const fs = require("fs");
const path = require("path");
const R = require("./run.js");

const UA_CLOUD = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY_HOSTS = ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn", "https://yun.139.com"];
const MCLOUD = "https://m.mcloud.139.com";
function cyHeaders(jwt, host) {
  return { "User-Agent": UA_CLOUD, "Host": host.replace("https://", ""), "jwtToken": jwt, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" };
}
async function cyGet(jwt, p) {
  let lastErr = null;
  for (const h of CY_HOSTS) {
    try {
      const r = await fetch(h + p, { headers: cyHeaders(jwt, h), signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch { }
      if (j && String(j.code) === "0") return j;
      lastErr = "HTTP" + r.status + ":" + t.slice(0, 100);
    } catch (e) { lastErr = String(e.message || e).slice(0, 80); }
  }
  throw new Error("cyGet 失败: " + lastErr);
}
async function rawTaskList(jwt) { return await cyGet(jwt, "/market/signin/task/taskList?marketname=sign_in_3"); }
async function clickTask(jwt, id) {
  const r = await cyGet(jwt, "/market/signin/task/click?key=task&id=" + id);
  return { code: String(r.code), msg: String(r.msg || r.message || "").slice(0, 60), raw: JSON.stringify(r).slice(0, 200) };
}
function flat(j) {
  const out = [];
  for (const arr of Object.values(j.result || {})) {
    if (!Array.isArray(arr)) continue;
    for (const t of arr) out.push(t);
  }
  return out;
}
async function getNum(jwt) {
  const r = await fetch(MCLOUD + "/ycloud/signin/page/getCloudNum", {
    headers: { "User-Agent": UA_CLOUD, "jwtToken": jwt, "Accept": "application/json", "Cookie": "jwtToken=" + jwt, "Referer": MCLOUD + "/" },
    signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  const v = j.result !== undefined ? j.result : (j.data && j.data.cloudNum);
  return v === undefined || v === null ? null : Number(v);
}

(async () => {
  const out = { ts: new Date().toISOString(), accts: [] };
  try {
    const key = await R.deriveKey(process.env.PANEL_DATA_KEY || "");
    const accounts = JSON.parse(await R.aesGcmDecryptText(key, fs.readFileSync(path.join(__dirname, "../data/accounts.enc"), "utf8").trim()));
    // 只跑前 2 个账号，控制时长
    for (const a of accounts.slice(0, 2)) {
      const rec = { phone: R.maskPhone(a.phone), rounds: [] };
      try {
        const jwt = await R.getJwt(a.authorization, a.phone);
        rec.num0 = await getNum(jwt);
        let list = flat(await rawTaskList(jwt));
        // 选 3 个 WAIT 且含 click 的任务做重复点击实验
        const targets = list.filter(t => String(t.state) !== "FINISH" && (t.stepTypeSet || []).includes("click")).slice(0, 3);
        for (const t of targets) {
          const tr = { name: String(t.name || "").replace(/<[^>]*>/g, "").slice(0, 22), id: t.id, start: { state: t.state, currstep: t.currstep }, hits: [] };
          for (let i = 0; i < 6; i++) {
            const c = await clickTask(jwt, t.id);
            await new Promise(r => setTimeout(r, 1500));
            const l2 = flat(await rawTaskList(jwt));
            const now = l2.find(x => String(x.id) === String(t.id));
            tr.hits.push({ click: c.code + "/" + c.msg, state: now ? now.state : "?", currstep: now ? now.currstep : null, cloudId: now ? now.cloudId : null });
            if (!now || String(now.state) === "FINISH") break;
          }
          rec.rounds.push(tr);
        }
        rec.num1 = await getNum(jwt);
        // FINISH 任务的奖励领取接口探测
        const fin = flat(await rawTaskList(jwt)).filter(t => String(t.state) === "FINISH").slice(0, 3);
        rec.finProbe = [];
        const paths = ["/market/signin/task/receive", "/market/signin/task/getReward", "/market/signin/task/award"];
        for (const t of fin) {
          for (const p of paths) {
            try {
              const r = await cyGet(jwt, p + "?key=task&id=" + t.id + "&recordid=" + (t.recordid || ""));
              rec.finProbe.push({ id: t.id, name: String(t.name || "").replace(/<[^>]*>/g, "").slice(0, 18), path: p, resp: JSON.stringify(r).slice(0, 160) });
            } catch (e) {
              rec.finProbe.push({ id: t.id, path: p, err: String(e.message || e).slice(0, 90) });
            }
            await new Promise(r => setTimeout(r, 800));
          }
        }
        rec.ok = true;
      } catch (e) { rec.error = String(e.message || e).slice(0, 250); }
      out.accts.push(rec);
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (e) { out.fatal = String(e.message || e).slice(0, 250); }
  fs.writeFileSync(path.join(__dirname, "../data/tl3.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out).slice(0, 6000));
})();
