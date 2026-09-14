const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY7071 = "https://caiyun.feixin.10086.cn:7071";
const CY = "https://caiyun.feixin.10086.cn";
const H7071 = "caiyun.feixin.10086.cn:7071", HN = "caiyun.feixin.10086.cn";
let JWT = "";
const hJ = (host) => ({ "User-Agent": UA, "Host": host, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest", "jwtToken": JWT, "Cookie": "jwtToken=" + JWT });
const log = (k, v) => out.steps.push({ k, v });
async function getJwt() {
  const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST", headers: { "Authorization": "Basic " + A, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: PHONE, toSourceId: "001005" }) });
  const j = await r.json();
  if (String(j.code) !== "0") throw new Error("querySpecToken 失败 " + j.code);
  const r2 = await fetch(`${CY7071}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(j.data.token)}`, { headers: { "Host": H7071, "Accept": "*/*" }, signal: AbortSignal.timeout(20000) });
  const j2 = await r2.json();
  if (!j2 || !j2.result || !j2.result.token) throw new Error("tyrzLogin 失败");
  JWT = j2.result.token;
}
async function req(p, host, method, body) {
  try {
    const r = await fetch((host === H7071 ? CY7071 : CY) + p, { method: method || "GET", headers: hJ(host), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, j, raw: t.slice(0, 300) };
  } catch (e) { return { status: 0, raw: String(e.message || e) }; }
}
async function main() {
  await getJwt(); log("jwt", "ok");
  // ★ 实领 1：膨胀云朵（你的账号 preMonthBackup=true 且未领，可领 20）
  const ex = await req("/market/signin/page/taskExpansion", HN);
  log("膨胀-查询", { raw: ex.raw.slice(0, 200) });
  const exr = ex.j && ex.j.result || {};
  if (exr.preMonthBackup && !exr.curMonthBackupTaskAccept) {
    const r = await req(`/market/signin/page/receiveTaskExpansion?acceptDate=${exr.acceptDate}`, HN);
    log("★膨胀-领取", { status: r.status, code: r.j ? r.j.code : null, msg: r.j ? r.j.msg : null,
      cloudCount: r.j && r.j.result ? r.j.result.cloudCount : null, raw: r.raw.slice(0, 200) });
  } else log("★膨胀-领取", "不满足条件(已领或未备份) " + JSON.stringify(exr).slice(0,150));
  // ★ 实领 2：通知云朵
  const ms = await req("/market/msgPushOn/task/status", HN);
  const msr = ms.j && ms.j.result || {};
  log("通知-状态", { pushOn: msr.pushOn, first: msr.firstTaskStatus, second: msr.secondTaskStatus });
  if (msr.pushOn === 1) {
    if (msr.firstTaskStatus !== 3) {
      const r = await req("/market/msgPushOn/task/obtain", HN, "POST", { type: 1 });
      log("★通知-领任务1", { status: r.status, raw: r.raw.slice(0, 200) });
    } else log("通知-任务1", "已领取，跳过");
    if (msr.secondTaskStatus === 2 || msr.secondTaskStatus === 1) {
      const r = await req("/market/msgPushOn/task/obtain", HN, "POST", { type: 2 });
      log("★通知-领任务2", { status: r.status, raw: r.raw.slice(0, 200) });
    }
  }
  // ★ 实领 3：备份礼
  const bg = await req("/market/backupgift/info", HN);
  const bgr = bg.j && bg.j.result || {};
  log("备份-状态", { state: bgr.state, curMonth: bgr.curMonth });
  if (bgr.state === 0) {
    const r = await req("/market/backupgift/receive", HN);
    log("★备份-领取", { status: r.status, raw: r.raw.slice(0, 200) });
  } else log("备份-领取", "state=" + bgr.state + "（0=可领 1=已领 -1=未备份）");
  // ★ 爆破余额接口（找 200 的）
  const cands = [
    "/market/signin/page/cloudInfo", "/market/signin/cloud/info", "/market/signin/user/cloudCount",
    "/market/signin/page/cloud", "/market/signin/totalCloud", "/market/signin/cloud/total",
    "/market/signin/page/init", "/market/signin/index", "/market/signin/home",
    "/market/signin/page/home", "/market/signin/page/main", "/market/signin/user/total",
    "/market/signin/cloud/count", "/market/signin/bean", "/market/signin/page/bean",
    "/market/signin/page/signInInfo", "/market/signin/sign/info", "/market/signin/user/info",
    "/market/signin/task/myCloud", "/market/signin/cloud/myCloud", "/market/signin/cloudNum",
  ];
  const hits = [];
  for (const p of cands) {
    const r = await req(p, HN);
    if (r.status === 200) hits.push({ p, raw: r.raw.slice(0, 250) });
  }
  log("★余额接口命中", hits.length ? hits : "全部404（未找到）");
  // 云朵大作战
  const cg = await req("/market/signin/hecheng1T/info?op=info", HN);
  log("云朵大作战", { status: cg.status, raw: cg.raw.slice(0, 200) });
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
