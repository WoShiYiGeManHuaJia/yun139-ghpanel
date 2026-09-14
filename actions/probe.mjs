const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString() };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const CY_HOSTS = ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn", "https://yun.139.com"];
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
function cyH(jwt, host) {
  return { "User-Agent": UA, "Host": host.replace("https://", ""), "jwtToken": jwt, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" };
}
async function getJwt() {
  const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST",
    headers: { "Authorization": "Basic " + A, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: PHONE, toSourceId: "001005" }),
  });
  const j = await r.json();
  if (String(j.code) !== "0") throw new Error("querySpecToken 失败 " + j.code + " " + j.message);
  const sso = j.data.token;
  for (const h of CY_HOSTS) {
    try {
      const r2 = await fetch(`${h}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(sso)}`, { headers: { "Host": h.replace("https://", "") }, signal: AbortSignal.timeout(20000) });
      const j2 = await r2.json();
      if (j2 && j2.result && j2.result.token) return j2.result.token;
    } catch (e) {}
  }
  throw new Error("tyrzLogin 失败");
}
async function main() {
  const jwt = await getJwt();
  out.jwt_ok = true;
  // 1) 完整原始任务列表
  for (const h of CY_HOSTS) {
    try {
      const r = await fetch(h + "/market/signin/task/taskList?marketname=sign_in_3", { headers: cyH(jwt, h), signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (String(j.code) === "0") { out.raw = j; out.host = h; break; }
    } catch (e) {}
  }
  // 汇总所有字段 + 任务简表
  const keys = new Set(); const list = [];
  for (const arr of Object.values((out.raw && out.raw.result) || {})) {
    if (!Array.isArray(arr)) continue;
    for (const t of arr) { Object.keys(t).forEach(k => keys.add(k)); list.push(t); }
  }
  out.all_keys = [...keys];
  out.tasks = list.map(t => ({
    id: t.id, name: String(t.name || "").replace(/<[^>]*>/g, ""), state: t.state,
    process: t.process, currstep: t.currstep, stepTypeSet: t.stepTypeSet,
    award: t.content_display2 || "", receiveUrl: t.receiveUrl || t.url || "",
  }));
  // 找含"领/收/receive/award/draw/bubble/cloud"的字段值
  const clues = [];
  for (const t of list) for (const [k, v] of Object.entries(t)) {
    if (/receive|award|draw|bubble|cloud|collect|领取|收/i.test(k + "=" + JSON.stringify(v)) && String(v).length < 200)
      clues.push(t.id + " " + k + "=" + JSON.stringify(v));
  }
  out.clues = [...new Set(clues)].slice(0, 40);
  // 2) 探测领取/气泡接口
  const id0 = list.length ? list[0].id : "";
  const paths = [
    "/market/signin/index", "/market/signin/user/info", "/market/signin/signin/index",
    "/market/signin/cloud/info", "/market/signin/cloud/list",
    "/market/signin/task/receive?id=" + id0, "/market/signin/task/draw?id=" + id0,
    "/market/signin/task/collect?id=" + id0, "/market/signin/award/receive?id=" + id0,
    "/market/signin/task/click?key=award&id=" + id0,
    "/market/signin/task/click?key=receive&id=" + id0,
  ];
  out.probe = [];
  for (const p of paths) {
    for (const h of CY_HOSTS) {
      try {
        const r = await fetch(h + p, { headers: cyH(jwt, h), signal: AbortSignal.timeout(12000) });
        const t = (await r.text()).slice(0, 260);
        out.probe.push({ p, h: h.replace("https://", ""), status: r.status, body: t });
        break;
      } catch (e) { /* next */ }
    }
  }
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => {
    const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0, 3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0, 8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d);
  });
