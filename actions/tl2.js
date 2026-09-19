// 诊断：点击任务 → 待领清单变化 → 领取，全链路实测
const fs = require("fs");
const path = require("path");
const R = require("./run.js");

const MCLOUD = "https://m.mcloud.139.com";
const MOBILE_UA_FALLBACK = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const UA_CLOUD = MOBILE_UA_FALLBACK;
const CY_HOSTS = ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn", "https://yun.139.com"];

function mcloudHeaders(jwt) {
  return { "User-Agent": MOBILE_UA_FALLBACK, "jwtToken": jwt, "Accept": "application/json, text/plain, */*",
           "X-Requested-With": "XMLHttpRequest", "Referer": MCLOUD + "/", "Cookie": "jwtToken=" + jwt };
}
async function mcloudGet(jwt, p) {
  const r = await fetch(MCLOUD + p, { headers: mcloudHeaders(jwt), signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = null; }
  if (!j) throw new Error("非JSON:" + t.slice(0, 80));
  return j;
}
async function getNum(jwt) {
  const j = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
  const v = j.result !== undefined ? j.result : (j.data && j.data.cloudNum);
  return v === undefined || v === null ? null : Number(v);
}
async function infoV3(jwt) {
  const j = await mcloudGet(jwt, "/ycloud/signin/page/infoV3?client=app");
  const res = j.result || j.data || {};
  const arr = res.receiveList || res.taskList || res.list || [];
  return {
    toReceive: res.toReceive !== undefined ? res.toReceive : res.receiveNum,
    rawLen: Array.isArray(arr) ? arr.length : 0,
    rawHead: JSON.stringify(res).slice(0, 600),
    items: Array.isArray(arr) ? arr.map(x => ({
      recordId: x.recordId !== undefined ? x.recordId : x.cloudId,
      cloudType: x.cloudType, num: x.cloudNum !== undefined ? x.cloudNum : x.num,
      name: String(x.name || x.taskName || x.title || "").slice(0, 24),
      keys: Object.keys(x).slice(0, 14).join(","),
    })) : [],
  };
}
function cyHeaders(jwt, host) {
  return { "User-Agent": UA_CLOUD, "Host": host.replace("https://", ""), "jwtToken": jwt, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" };
}
async function rawTaskList(jwt) {
  for (const h of CY_HOSTS) {
    try {
      const r = await fetch(h + "/market/signin/task/taskList?marketname=sign_in_3", { headers: cyHeaders(jwt, h), signal: AbortSignal.timeout(20000) });
      let j = null; try { j = JSON.parse(await r.text()); } catch { }
      if (j && String(j.code) === "0") return j;
    } catch (e) { }
  }
  throw new Error("taskList 失败");
}
async function clickTask(jwt, id) {
  for (const h of CY_HOSTS) {
    try {
      const r = await fetch(h + "/market/signin/task/click?key=task&id=" + id, { headers: cyHeaders(jwt, h), signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      let j = {}; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 100) }; }
      return { host: h, code: String(j.code), msg: String(j.msg || j.message || "").slice(0, 80), raw: t.slice(0, 200) };
    } catch (e) { }
  }
  return { code: "ERR", msg: "全部主机失败" };
}
async function postReceive(jwt, cloudId, cloudType) {
  const r = await fetch(MCLOUD + "/ycloud/signin/page/receiveV3", {
    method: "POST", headers: { ...mcloudHeaders(jwt), "Content-Type": "application/json" },
    body: JSON.stringify({ client: "app", cloudId: Number(cloudId), cloudType: Number(cloudType) }),
    signal: AbortSignal.timeout(20000),
  });
  const t = await r.text();
  let j = {}; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 120) }; }
  const recv = j.result && (j.result.receive !== undefined ? j.result.receive : j.result.receiveNum);
  return { code: String(j.code), msg: String(j.msg || "").slice(0, 80), receive: recv, raw: t.slice(0, 200) };
}

(async () => {
  const out = { ts: new Date().toISOString(), accounts: [] };
  try {
    const dataKey = process.env.PANEL_DATA_KEY || "";
    if (!dataKey) throw new Error("缺 PANEL_DATA_KEY");
    const key = await R.deriveKey(dataKey);
    const b = fs.readFileSync(path.join(__dirname, "../data/accounts.enc"), "utf8").trim();
    const accounts = JSON.parse(await R.aesGcmDecryptText(key, b));
    for (const a of accounts) {
      const rec = { phone: R.maskPhone(a.phone) };
      try {
        const jwt = await R.getJwt(a.authorization, a.phone);
        rec.num0 = await getNum(jwt);
        rec.info0 = await infoV3(jwt);

        // 点击所有非 FINISH 且含 click 的任务
        const tl = await rawTaskList(jwt);
        const tasks = [];
        for (const arr of Object.values(tl.result || {})) {
          if (!Array.isArray(arr)) continue;
          for (const t of arr) tasks.push(t);
        }
        rec.clicks = [];
        for (const t of tasks) {
          if (String(t.state) === "FINISH") continue;
          const steps = t.stepTypeSet || [];
          if (!steps.includes("click")) continue;
          const c = await clickTask(jwt, t.id);
          rec.clicks.push({ name: String(t.name || "").replace(/<[^>]*>/g, "").slice(0, 24), id: t.id, code: c.code, msg: c.msg });
          await new Promise(r => setTimeout(r, 700));
        }
        await new Promise(r => setTimeout(r, 2500));
        rec.info1 = await infoV3(jwt);

        // 领取全部待领项（不截断 12 条）
        const arr2 = (rec.info1.items || []).filter(x => x.recordId !== undefined && x.recordId !== null);
        rec.receive = [];
        for (const it of arr2) {
          const r = await postReceive(jwt, it.recordId, it.cloudType);
          rec.receive.push({ recordId: it.recordId, type: it.cloudType, num: it.num, code: r.code, msg: r.msg, receive: r.receive });
          await new Promise(r => setTimeout(r, 1200));
        }
        await new Promise(r => setTimeout(r, 2000));
        rec.num1 = await getNum(jwt);
        rec.info2 = await infoV3(jwt);
        rec.ok = true;
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 250);
      }
      out.accounts.push(rec);
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (e) {
    out.fatal = String(e.message || e).slice(0, 250);
  }
  fs.writeFileSync(path.join(__dirname, "../data/tl2.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out).slice(0, 6000));
})();
