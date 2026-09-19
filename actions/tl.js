// 任务清单诊断：输出每个账号的真实 taskList 原始结构（含 stepTypeSet / state / reward）
const fs = require("fs");
const path = require("path");
const R = require("./run.js");

const UA_CLOUD = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY_HOSTS = ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn", "https://yun.139.com"];
function cyHeaders(jwt, host) {
  return { "User-Agent": UA_CLOUD, "Host": host.replace("https://", ""), "jwtToken": jwt, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" };
}
async function rawTaskList(jwt) {
  let lastErr = null;
  for (const h of CY_HOSTS) {
    try {
      const r = await fetch(h + "/market/signin/task/taskList?marketname=sign_in_3", { headers: cyHeaders(jwt, h), signal: AbortSignal.timeout(20000) });
      const txt = await r.text();
      let j = null; try { j = JSON.parse(txt); } catch { }
      if (j && String(j.code) === "0") return { host: h, json: j };
      lastErr = "HTTP" + r.status + " " + txt.slice(0, 120);
    } catch (e) { lastErr = String(e.message || e).slice(0, 120); }
  }
  throw new Error("taskList 失败: " + lastErr);
}

(async () => {
  const out = { ts: new Date().toISOString(), accounts: [] };
  const dataKey = process.env.PANEL_DATA_KEY || "";
  try {
    if (!dataKey) throw new Error("缺 PANEL_DATA_KEY");
    const key = await R.deriveKey(dataKey);
    const b = fs.readFileSync(path.join(__dirname, "../data/accounts.enc"), "utf8").trim();
    const accounts = JSON.parse(await R.aesGcmDecryptText(key, b));
    out.accountCount = accounts.length;
    for (const a of accounts) {
      const rec = { phone: R.maskPhone(a.phone), ok: false };
      try {
        const jwt = await R.getJwt(a.authorization, a.phone);
        rec.jwt = true;
        const { host, json } = await rawTaskList(jwt);
        rec.host = host;
        rec.raw = JSON.stringify(json).slice(0, 16000);
        const list = [];
        for (const [gname, arr] of Object.entries(json.result || {})) {
          if (!Array.isArray(arr)) continue;
          for (const t of arr) {
            list.push({
              group: gname, groupid: t.groupid, id: t.id,
              name: String(t.name || "").replace(/<[^>]*>/g, ""),
              state: t.state, limitType: t.limitType,
              stepTypeSet: t.stepTypeSet, process: t.process,
              currstep: t.currstep, currDay: t.currDay,
              reward: t.content_display2 || t.content_display || "",
            });
          }
        }
        rec.tasks = list;
        rec.ok = true;
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 300);
      }
      out.accounts.push(rec);
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (e) {
    out.fatal = String(e.message || e).slice(0, 300);
  }
  fs.mkdirSync(path.join(__dirname, "../data"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "../data/tl.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out).slice(0, 8000));
})();
