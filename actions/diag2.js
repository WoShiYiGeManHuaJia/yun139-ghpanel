// 深度诊断 v2：dump 任务清单与气泡接口的完整原始 JSON
const fs = require("fs");
const AUTH = process.env.DIAG_AUTH || "";
const PHONE = process.env.DIAG_PHONE || "";
const CY_HOSTS = ["https://caiyun.feixin.10086.cn:443", "https://yun.139.com", "https://caiyun.feixin.10086.cn"];

async function getJwt() {
  const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST",
    headers: { Authorization: "Basic " + AUTH, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: PHONE, toSourceId: "001005" }),
  });
  const j = await r.json();
  if (String(j.code) !== "0" || !j.data || !j.data.token) throw new Error("token失败:" + JSON.stringify(j).slice(0, 200));
  const sso = j.data.token;
  for (const h of CY_HOSTS) {
    try {
      const r2 = await fetch(`${h}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(sso)}`, { headers: { Host: h.replace("https://", "") } });
      const j2 = await r2.json();
      if (j2 && j2.result && j2.result.token) return j2.result.token;
    } catch (e) {}
  }
  throw new Error("tyrzLogin 全部失败");
}

(async () => {
  const out = { ts: new Date().toISOString(), phone: PHONE, data: {} };
  try {
    const jwt = await getJwt();
    out.jwtOk = true;
    const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 Mobile Safari/537.36";
    const cyH = (h) => ({ Authorization: "Bearer " + jwt, "User-Agent": UA, Host: h.replace("https://", ""), "Content-Type": "application/json", Accept: "application/json, text/plain, */*" });
    const mH = () => ({ Authorization: "Bearer " + jwt, "User-Agent": UA, Host: "m.mcloud.139.com", "Content-Type": "application/json", Accept: "application/json" });

    // 1) 任务清单（完整原始）
    for (const h of CY_HOSTS) {
      try {
        const r = await fetch(h + "/market/signin/task/taskList?marketname=sign_in_3", { headers: cyH(h) });
        const t = await r.text();
        if (r.ok && t.includes('"code"')) { out.data.taskList = t.slice(0, 12000); out.taskHost = h; break; }
      } catch (e) { out.taskErr = String(e.message).slice(0, 100); }
    }

    // 2) 气泡 infoV3（完整原始）
    try {
      const r = await fetch("https://m.mcloud.139.com/ycloud/signin/page/infoV3?client=app", { headers: mH() });
      out.data.infoV3 = (await r.text()).slice(0, 6000);
    } catch (e) { out.infoErr = String(e.message).slice(0, 100); }

    // 3) 云豆总数
    try {
      const r = await fetch("https://m.mcloud.139.com/ycloud/signin/page/getCloudNum", { headers: mH() });
      out.data.cloudNum = (await r.text()).slice(0, 1500);
    } catch (e) {}

    // 4) 尝试其他可能的任务/气泡接口
    const probes = [
      "/ycloud/signin/page/taskList",
      "/ycloud/signin/page/cloudList?client=app",
      "/ycloud/signin/page/receiveList?client=app",
      "/market/signin/task/taskList?marketname=sign_in_3&client=app",
    ];
    out.data.probes = {};
    for (const p of probes) {
      try {
        const r = await fetch("https://m.mcloud.139.com" + p, { headers: mH() });
        out.data.probes[p] = (await r.text()).slice(0, 2500);
      } catch (e) { out.data.probes[p] = "ERR " + String(e.message).slice(0, 60); }
    }
  } catch (e) {
    out.error = String(e.message || e).slice(0, 300);
  }
  fs.mkdirSync("/tmp/diag2", { recursive: true });
  fs.writeFileSync("/tmp/diag2/out.json", JSON.stringify(out, null, 2));
  console.log("DONE " + Object.keys(out.data).join(","));
})();
