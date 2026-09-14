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
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
async function req(p, host, method, body, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try {
      const r = await fetch((host === H7071 ? CY7071 : CY) + p, { method: method || "GET", headers: hJ(host), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t.slice(0, 300) };
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  return { status: 0, raw: "重试后仍失败: " + String((last && last.message) || last) };
}
async function main() {
  await getJwt(); log("jwt", "ok");
  // ★ 重试膨胀领取（两主机都试）
  const ex = await req("/market/signin/page/taskExpansion", HN, "GET", null, 3);
  const exr = (ex.j && ex.j.result) || {};
  log("膨胀-查询", { pre: exr.preMonthBackup, accept: exr.curMonthBackupTaskAccept, date: exr.acceptDate, next: exr.nextMonthTaskRecordCount });
  if (exr.preMonthBackup && !exr.curMonthBackupTaskAccept) {
    for (const host of [HN, H7071]) {
      const r = await req(`/market/signin/page/receiveTaskExpansion?acceptDate=${exr.acceptDate}`, host, "GET", null, 4);
      log("★膨胀-领取[" + host + "]", { status: r.status, code: r.j ? r.j.code : null, msg: r.j ? r.j.msg : null,
        cloudCount: (r.j && r.j.result) ? r.j.result.cloudCount : null, raw: r.raw.slice(0, 220) });
      if (r.status === 200) break;
    }
  } else log("膨胀-领取", "不满足条件");
  // ★ 爆破 task 动作名（用 FINISH 的 431 和 WAIT 的 106）
  const acts = ["draw", "obtain", "get", "claim", "gain", "pick", "finish", "complete", "submit", "take", "open", "bind", "send", "process", "award"];
  const hits = [];
  for (const act of acts) {
    for (const id of ["431", "106", "319"]) {
      const r = await req(`/market/signin/task/${act}?id=${id}`, HN, "GET", null, 1);
      if (r.status === 200) { hits.push({ act, id, raw: r.raw.slice(0, 180) }); break; }
    }
  }
  log("★task 动作命中", hits.length ? hits : "全部404");
  // ★ 爆破 page 下接口
  const pages = ["info", "receive", "cloud", "total", "init", "home", "main", "bean", "cloudBean", "userInfo", "account", "myInfo", "detail", "status"];
  const ph = [];
  for (const p of pages) {
    const r = await req(`/market/signin/page/${p}`, HN, "GET", null, 1);
    if (r.status === 200) ph.push({ p, raw: r.raw.slice(0, 200) });
  }
  log("★page 接口命中", ph.length ? ph : "全部404");
  // 7071 主机再试 page/receive
  const r7071 = await req("/market/signin/page/receive", H7071, "GET", null, 2);
  log("page/receive[:7071]", { status: r7071.status, raw: r7071.raw.slice(0, 180) });
  const i7071 = await req("/market/signin/page/info?client=app", H7071, "GET", null, 2);
  log("page/info[:7071]", { status: i7071.status, raw: i7071.raw.slice(0, 180) });
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
