const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString() };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const CY = ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn", "https://yun.139.com"];
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const H = (jwt, host) => ({ "User-Agent": UA, "Host": host.replace("https://", ""), "jwtToken": jwt, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" });
async function getJwt() {
  const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST", headers: { "Authorization": "Basic " + A, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: PHONE, toSourceId: "001005" }) });
  const j = await r.json();
  if (String(j.code) !== "0") throw new Error("querySpecToken 失败 " + j.code);
  for (const h of CY) {
    try { const r2 = await fetch(`${h}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(j.data.token)}`, { headers: { "Host": h.replace("https://","") }, signal: AbortSignal.timeout(20000) });
      const j2 = await r2.json(); if (j2 && j2.result && j2.result.token) return j2.result.token; } catch (e) {}
  }
  throw new Error("tyrzLogin 失败");
}
async function cyGet(jwt, p) {
  for (const h of CY) {
    try { const r = await fetch(h + p, { headers: H(jwt, h), signal: AbortSignal.timeout(15000) });
      const t = await r.text(); return { h, status: r.status, body: t.slice(0, 400) }; } catch (e) {}
  }
  return { status: 0, body: "all-hosts-failed" };
}
async function main() {
  const jwt = await getJwt(); out.jwt = true;
  // 1) 找云豆余额接口（关键：验证是否到账）
  const balPaths = [
    "/market/signin/user/cloud", "/market/signin/cloud/balance", "/market/signin/user/balance",
    "/market/signin/account", "/market/signin/user/account", "/market/signin/info",
    "/market/signin/user/cloudinfo", "/market/signin/cloud/get", "/market/signin/total",
    "/market/signin/user/cloudtotal", "/market/signin/myCloud", "/market/signin/user/myinfo",
  ];
  out.balance = [];
  for (const p of balPaths) {
    const r = await cyGet(jwt, p);
    out.balance.push({ p, status: r.status, body: r.body.slice(0, 200) });
  }
  // 2) 拿任务列表，取 recordid
  let raw = null;
  for (const h of CY) {
    try { const r = await fetch(h + "/market/signin/task/taskList?marketname=sign_in_3", { headers: H(jwt, h), signal: AbortSignal.timeout(20000) });
      const j = await r.json(); if (String(j.code) === "0") { raw = j; break; } } catch (e) {}
  }
  const list = [];
  for (const arr of Object.values((raw && raw.result) || {})) {
    if (Array.isArray(arr)) for (const t of arr) list.push(t);
  }
  out.taskinfo = list.map(t => ({ id: t.id, name: String(t.name||"").replace(/<[^>]*>/g,""), state: t.state,
    currstep: t.currstep, recordid: t.recordid, cloudId: t.cloudId, limitCloud: t.limitCloud, steps: t.stepTypeSet }));
  // 3) 用 recordid 试领取
  const fin = list.filter(t => t.state === "FINISH");
  const wait = list.filter(t => t.state === "WAIT");
  out.probe = [];
  const mk = (t) => [
    `/market/signin/task/receive?recordid=${t.recordid||""}&id=${t.id}`,
    `/market/signin/task/click?key=award&id=${t.id}&recordid=${t.recordid||""}`,
    `/market/signin/task/click?key=cloud&id=${t.id}`,
    `/market/signin/task/click?key=task&id=${t.id}&step=award`,
    `/market/signin/task/award?recordid=${t.recordid||""}`,
    `/market/signin/cloud/receive?recordid=${t.recordid||""}&id=${t.id}`,
  ];
  for (const t of [...fin.slice(0,2), ...wait.slice(0,2)]) {
    for (const p of mk(t)) {
      const r = await cyGet(jwt, p);
      out.probe.push({ task: t.id, state: t.state, p, status: r.status, body: r.body.slice(0,180) });
    }
  }
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
