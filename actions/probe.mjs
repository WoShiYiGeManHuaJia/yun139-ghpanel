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
async function cyGet(jwt, p, host) {
  const hosts = host ? [host] : CY;
  for (const h of hosts) {
    try { const r = await fetch(h + p, { headers: H(jwt, h), signal: AbortSignal.timeout(15000) });
      const t = await r.text(); return { h, status: r.status, body: t.slice(0, 500) }; } catch (e) {}
  }
  return { status: 0, body: "all-hosts-failed" };
}
async function main() {
  const jwt = await getJwt(); out.jwt = true;
  // 1) taskList 完整结构：打印 result 的每个 key + 任务名
  let raw = null, host = null;
  for (const h of CY) {
    try { const r = await fetch(h + "/market/signin/task/taskList?marketname=sign_in_3", { headers: H(jwt, h), signal: AbortSignal.timeout(20000) });
      const j = await r.json(); if (String(j.code) === "0") { raw = j; host = h; break; } } catch (e) {}
  }
  out.host = host;
  out.result_keys = Object.keys(raw.result || {});
  out.groups = [];
  for (const [k, v] of Object.entries(raw.result || {})) {
    out.groups.push({ key: k, type: Array.isArray(v) ? "array" : typeof v, n: Array.isArray(v) ? v.length : 0,
      sample: Array.isArray(v) && v[0] ? String(v[0].name || "").replace(/<[^>]*>/g, "") : JSON.stringify(v).slice(0,120) });
  }
  // 完整 dump 一个 FINISH 任务的全部字段值
  const all = [];
  for (const arr of Object.values(raw.result || {})) if (Array.isArray(arr)) for (const t of arr) all.push(t);
  const fin = all.find(t => t.state === "FINISH");
  if (fin) { out.finish_full = {}; for (const [k,v] of Object.entries(fin)) out.finish_full[k] = (typeof v === "object" ? JSON.stringify(v).slice(0,200) : String(v).slice(0,200)); }
  // 2) 签到状态 / 日历（气泡可能来自签到日历）
  out.signin = [];
  for (const p of ["/market/signin/signin/list", "/market/signin/signin/record", "/market/signin/sign/calendar",
                   "/market/signin/calendar", "/market/signin/user/signin", "/market/signin/signin/days"]) {
    const r = await cyGet(jwt, p); out.signin.push({ p, status: r.status, body: r.body.slice(0,250) });
  }
  // 3) 云豆/云朵 体系接口（换关键词）
  out.cloud = [];
  for (const p of ["/market/signin/cloudBean/list", "/market/signin/bean/list", "/market/signin/yundou/list",
                   "/market/signin/user/yunDou", "/market/signin/task/cloudList", "/market/signin/index/info",
                   "/market/signin/home", "/market/signin/page/init", "/market/signin/task/awardList"]) {
    const r = await cyGet(jwt, p); out.cloud.push({ p, status: r.status, body: r.body.slice(0,250) });
  }
  // 4) 用 POST 试领取（之前都是 GET）
  out.post = [];
  for (const p of ["/market/signin/task/receive", "/market/signin/task/award", "/market/signin/cloud/receive"]) {
    try {
      const r = await fetch((host||CY[0]) + p, { method: "POST", headers: { ...H(jwt, host||CY[0]), "Content-Type": "application/json" },
        body: JSON.stringify({ id: fin ? fin.id : "", recordid: fin ? fin.recordid : "", marketname: "sign_in_3" }), signal: AbortSignal.timeout(15000) });
      out.post.push({ p, status: r.status, body: (await r.text()).slice(0,250) });
    } catch (e) { out.post.push({ p, err: String(e.message||e) }); }
  }
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
