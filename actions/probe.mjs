const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [], defs: {} };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY7071 = "https://caiyun.feixin.10086.cn:7071", CY = "https://caiyun.feixin.10086.cn";
const H7071 = "caiyun.feixin.10086.cn:7071", HN = "caiyun.feixin.10086.cn";
const MM = "https://m.mcloud.139.com", HM = "m.mcloud.139.com";
let JWT = "";
const hJ = (host) => ({ "User-Agent": UA, "Host": host, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest", "jwtToken": JWT, "Cookie": "jwtToken=" + JWT });
const log = (k, v) => out.steps.push({ k, v });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJwt() {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
        method: "POST", headers: { "Authorization": "Basic " + A, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
        body: JSON.stringify({ account: PHONE, toSourceId: "001005" }), signal: AbortSignal.timeout(25000) });
      const j = await r.json();
      if (String(j.code) !== "0") throw new Error("code=" + j.code);
      const r2 = await fetch(`${CY7071}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(j.data.token)}`, { headers: { "Host": H7071, "Accept": "*/*" }, signal: AbortSignal.timeout(25000) });
      const j2 = await r2.json();
      if (!j2 || !j2.result || !j2.result.token) throw new Error("无token");
      JWT = j2.result.token; return;
    } catch (e) { last = e; await sleep(2500 * (i + 1)); }
  }
  throw new Error("getJwt 失败: " + String((last && last.message) || last));
}
async function req(base, host, p, opts) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(base + p, { headers: hJ(host), ...(opts || {}), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t.slice(0, 400) };
    } catch (e) { last = e; await sleep(1200); }
  }
  return { status: 0, raw: "失败:" + String(((last && last.message) || last) || "").slice(0, 70) };
}
// 从 JS 提取函数定义
async function getDefs() {
  const r = await fetch("https://m.mcloud.139.com/portal/mobilecloud/public/js/newsignin.336f18c3.js",
    { headers: { "User-Agent": UA, "Referer": "https://m.mcloud.139.com/" }, signal: AbortSignal.timeout(40000) });
  const s = await r.text();
  for (const fn of ["receiveTaskData", "getCloudNum", "getReceiveV3", "receiveV3", "getPopInfo", "getUserInfoV3", "infoV3", "startSignIn"]) {
    const i = s.indexOf(fn + ":");
    if (i !== -1) out.defs[fn] = s.slice(i, i + 260).replace(/\s+/g, " ");
    else { const j = s.indexOf(fn); if (j !== -1) out.defs[fn] = "(引用) " + s.slice(Math.max(0, j - 60), j + 180).replace(/\s+/g, " "); }
  }
}
async function main() {
  await getJwt(); log("jwt", "ok");
  await getDefs();
  // ① 云豆余额（getCloudNum）
  for (const [b, h, tag] of [[MM, HM, "m.mcloud"], [CY, HN, "caiyun"]]) {
    const r = await req(b, h, "/ycloud/signin/page/getCloudNum", {});
    log("① getCloudNum[" + tag + "]", { status: r.status, code: r.j ? r.j.code : null, raw: r.raw.slice(0, 300) });
    if (r.status === 200) break;
  }
  // ② page/infoV3（含 toReceive 待领取数）
  for (const [b, h, tag] of [[MM, HM, "m.mcloud"], [CY, HN, "caiyun"]]) {
    const r = await req(b, h, "/ycloud/signin/page/infoV3?client=app", {});
    log("② infoV3[" + tag + "]", { status: r.status, code: r.j ? r.j.code : null, raw: r.raw.slice(0, 400) });
    if (r.status === 200) break;
  }
  // ③ taskListV3（找待领取任务）
  let tl = null;
  for (const [b, h, tag] of [[MM, HM, "m.mcloud"], [CY, HN, "caiyun"]]) {
    const r = await req(b, h, "/ycloud/signin/task/taskListV3?marketname=sign_in_3", {});
    log("③ taskListV3[" + tag + "]", { status: r.status, code: r.j ? r.j.code : null, raw: r.raw.slice(0, 200) });
    if (r.status === 200 && r.j) { tl = r.j; break; }
  }
  // 挑出待领取的任务（state=FINISH 或有 toReceive）
  const flat = []; 
  for (const v of Object.values((tl && tl.result) || {})) if (Array.isArray(v)) for (const t of v) flat.push(t);
  const fin = flat.filter(t => t.state === "FINISH");
  log("③ 可领任务(FINISH)", fin.map(t => ({ id: t.id, name: String(t.name || "").replace(/<[^>]*>/g, "").slice(0, 16), state: t.state })));
  // ④ ★ 实测领取：receiveTask（气泡）
  for (const t of fin.slice(0, 3)) {
    for (const [b, h, tag] of [[MM, HM, "m.mcloud"], [CY, HN, "caiyun"]]) {
      const r = await req(b, h, `/ycloud/signin/page/receiveTask?taskId=${t.id}`, {});
      log("④ ★领取[" + t.id + " " + String(t.name || "").replace(/<[^>]*>/g, "").slice(0, 12) + " " + tag + "]", {
        status: r.status, code: r.j ? r.j.code : null, msg: r.j ? r.j.msg : null,
        result: r.j && r.j.result !== undefined ? r.j.result : null, raw: r.raw.slice(0, 200) });
      if (r.status === 200) break;
    }
  }
  // ⑤ 领取后再查余额对比
  for (const [b, h, tag] of [[MM, HM, "m.mcloud"], [CY, HN, "caiyun"]]) {
    const r = await req(b, h, "/ycloud/signin/page/getCloudNum", {});
    log("⑤ 领取后 getCloudNum[" + tag + "]", { status: r.status, raw: r.raw.slice(0, 250) });
    if (r.status === 200) break;
  }
  // ⑥ receiveV3 / popup / getPopInfo
  for (const p of ["/ycloud/signin/page/receiveV3", "/ycloud/signin/page/popup", "/ycloud/signin/public/getPopInfo", "/ycloud/signin/page/multiple"]) {
    const r = await req(MM, HM, p, {});
    log("⑥ " + p.split("/").pop(), { status: r.status, code: r.j ? r.j.code : null, raw: r.raw.slice(0, 250) });
  }
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
