const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY7071 = "https://caiyun.feixin.10086.cn:7071";
const CY = "https://caiyun.feixin.10086.cn";   // ← 不带端口！market 接口用这个
const HOST7071 = "caiyun.feixin.10086.cn:7071";
const HOST = "caiyun.feixin.10086.cn";
let JWT = "";
function hJwt(host, withCookie) {
  const h = { "User-Agent": UA, "Host": host, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest", "jwtToken": JWT };
  if (withCookie) h["Cookie"] = "jwtToken=" + JWT;
  return h;
}
async function getJwt() {
  const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST", headers: { "Authorization": "Basic " + A, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: PHONE, toSourceId: "001005" }) });
  const j = await r.json();
  if (String(j.code) !== "0") throw new Error("querySpecToken 失败 " + j.code);
  const r2 = await fetch(`${CY7071}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(j.data.token)}`, { headers: { "Host": HOST7071, "Accept": "*/*" }, signal: AbortSignal.timeout(20000) });
  const j2 = await r2.json();
  if (!j2 || !j2.result || !j2.result.token) throw new Error("tyrzLogin 失败");
  JWT = j2.result.token;
}
async function get(p, host) {
  const url = (host === HOST7071 ? CY7071 : CY) + p;
  try {
    const r = await fetch(url, { headers: hJwt(host, true), signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, j, raw: t.slice(0, 300) };
  } catch (e) { return { status: 0, raw: String(e.message || e) }; }
}
const log = (k, v) => out.steps.push({ k, v });
async function main() {
  await getJwt(); log("jwt", "ok");
  // ① 领取前：查余额
  const before = await get("/market/signin/page/info?client=app", HOST);
  log("① page/info 领取前", { status: before.status,
    todaySignIn: before.j && before.j.result ? before.j.result.todaySignIn : null,
    receive: before.j && before.j.result ? before.j.result.receive : null,
    total: before.j && before.j.result ? before.j.result.total : null,
    keys: before.j && before.j.result ? Object.keys(before.j.result).slice(0, 25) : null,
    raw: before.raw.slice(0, 250) });
  // ② 签到（若未签）
  if (before.j && before.j.result && before.j.result.todaySignIn === false) {
    const sg = await get("/market/manager/commonMarketconfig/getByMarketRuleName?marketName=sign_in_3", HOST);
    log("② 签到动作", { status: sg.status, msg: sg.j ? sg.j.msg : null, raw: sg.raw.slice(0, 160) });
  } else log("② 签到动作", "今日已签到，跳过");
  // ③ 领取云豆（核心！）
  const rc = await get("/market/signin/page/receive", HOST);
  log("③ page/receive 领取", { status: rc.status, msg: rc.j ? rc.j.msg : null,
    receive: rc.j && rc.j.result ? rc.j.result.receive : null,
    total: rc.j && rc.j.result ? rc.j.result.total : null,
    raw: rc.raw.slice(0, 250) });
  // ④ 领取后：再查余额，对比
  const after = await get("/market/signin/page/info?client=app", HOST);
  log("④ page/info 领取后", { status: after.status,
    receive: after.j && after.j.result ? after.j.result.receive : null,
    total: after.j && after.j.result ? after.j.result.total : null });
  // ⑤ 其它领取类接口
  for (const [name, p] of [["备份礼 info", "/market/backupgift/info"],
                            ["通知任务 status", "/market/msgPushOn/task/status"],
                            ["任务扩展 taskExpansion", "/market/signin/page/taskExpansion"]]) {
    const r = await get(p, HOST);
    log("⑤ " + name, { status: r.status, msg: r.j ? r.j.msg : null, raw: r.raw.slice(0, 200) });
  }
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
