const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY7071 = "https://caiyun.feixin.10086.cn:7071";
const MM = "https://m.mcloud.139.com", HM = "m.mcloud.139.com";
let JWT = "";
const hJ = () => ({ "User-Agent": UA, "Host": HM, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest", "jwtToken": JWT, "Cookie": "jwtToken=" + JWT });
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
      const r2 = await fetch(`${CY7071}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(j.data.token)}`, { headers: { "Host": "caiyun.feixin.10086.cn:7071", "Accept": "*/*" }, signal: AbortSignal.timeout(25000) });
      const j2 = await r2.json();
      if (!j2 || !j2.result || !j2.result.token) throw new Error("无token");
      JWT = j2.result.token; return;
    } catch (e) { last = e; await sleep(2500 * (i + 1)); }
  }
  throw new Error("getJwt 失败: " + String((last && last.message) || last));
}
async function G(p, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch(MM + p, { headers: hJ(), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t };
    } catch (e) { last = e; await sleep(1200); }
  }
  return { status: 0, raw: "失败:" + String(((last && last.message) || last) || "").slice(0, 70), j: null };
}
async function P(p, body, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch(MM + p, { method: "POST", headers: { ...hJ(), "Content-Type": "application/json;charset=UTF-8" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t };
    } catch (e) { last = e; await sleep(1200); }
  }
  return { status: 0, raw: "失败:" + String(((last && last.message) || last) || "").slice(0, 70), j: null };
}
function brief(o, n) { const j = o.j || {}; return { status: o.status, code: j.code, msg: j.msg, res: JSON.stringify(j.result).slice(0, n || 200) }; }
async function main() {
  await getJwt(); log("jwt", "ok");
  // ① 余额 BEFORE
  const b1 = await G("/ycloud/signin/page/getCloudNum", 3);
  const BEFORE = (b1.j && b1.j.result);
  log("① 余额 BEFORE", { num: BEFORE, raw: b1.raw.slice(0, 120) });
  // ② infoV3 完整（找 toReceive）
  const iv = await G("/ycloud/signin/page/infoV3?client=app", 3);
  const R = (iv.j && iv.j.result) || {};
  log("② infoV3 关键字段", { keys: Object.keys(R).slice(0, 40),
    toReceive: R.toReceive, beforeTotal: R.beforeTotal, signInPoints: R.signInPoints,
    signCount: R.signCount, maxType: R.maxType,
    todaySignIn: R.todaySignIn, receive: R.receive, total: R.total });
  // ③ taskListV3 用 POST 拿任务（找待领取）
  const tl = await P("/ycloud/signin/task/taskListV3", { marketname: "sign_in_3" }, 3);
  let finIds = [];
  if (tl.j && String(tl.j.code) === "0") {
    const flat = [];
    for (const v of Object.values(tl.j.result || {})) if (Array.isArray(v)) for (const t of v) flat.push(t);
    finIds = flat.filter(t => t.state === "FINISH").map(t => t.id);
    log("③ taskListV3(POST)", { n: flat.length, fin: finIds.slice(0, 12) });
  } else log("③ taskListV3(POST)", brief(tl, 200));
  // ④ ★ 领取气泡：receiveTask?taskId=106（你刚完成的上传任务）
  const targets = [106, ...finIds.filter(x => x !== 106)].slice(0, 4);
  for (const id of targets) {
    const r = await G(`/ycloud/signin/page/receiveTask?taskId=${id}`, 3);
    log("④ ★receiveTask[" + id + "]", brief(r, 250));
    await sleep(800);
  }
  // ⑤ 余额 AFTER
  const b2 = await G("/ycloud/signin/page/getCloudNum", 3);
  const AFTER = (b2.j && b2.j.result);
  log("⑤ 余额 AFTER", { num: AFTER, raw: b2.raw.slice(0, 120) });
  log("⑥ ★结论", { before: BEFORE, after: AFTER, 变化: (typeof BEFORE === "number" && typeof AFTER === "number") ? (AFTER - BEFORE) : "无法比较" });
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
