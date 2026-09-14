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
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
        method: "POST", headers: { "Authorization": "Basic " + A, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
        body: JSON.stringify({ account: PHONE, toSourceId: "001005" }), signal: AbortSignal.timeout(25000) });
      const j = await r.json();
      if (String(j.code) !== "0") throw new Error("code=" + j.code);
      const inner = j.data && j.data.result && j.data.result.resultCode;
      if (inner !== undefined && String(inner) !== "0") throw new Error("业务码=" + inner);
      const sso = j.data && j.data.token; if (!sso) throw new Error("无sso");
      const r2 = await fetch(`${CY7071}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(sso)}`, { headers: { "Host": "caiyun.feixin.10086.cn:7071", "Accept": "*/*" }, signal: AbortSignal.timeout(25000) });
      const j2 = await r2.json();
      if (!j2 || !j2.result || !j2.result.token) throw new Error("无jwt");
      JWT = j2.result.token; return;
    } catch (e) { last = e; await sleep(2000 * (i + 1)); }
  }
  throw new Error("getJwt 失败: " + String((last && last.message) || last));
}
async function G(p, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch(MM + p, { headers: hJ(), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t.slice(0, 200) };
    } catch (e) { last = e; await sleep(1200); }
  }
  return { status: 0, j: null, raw: "失败" };
}
async function snap() {
  const a = await G("/ycloud/signin/page/getCloudNum", 2);
  const b = await G("/ycloud/signin/page/infoV3?client=app", 2);
  const R = (b.j && b.j.result) || {};
  return { total: a.j && a.j.result, toReceive: R.toReceive, list: JSON.stringify(R.receiveList) };
}
async function main() {
  await getJwt(); log("jwt", "ok");
  let s = await snap();
  const START = { total: s.total, toReceive: s.toReceive };
  log("⓪ 基线", { total: s.total, toReceive: s.toReceive, list: s.list });
  // ① 拿任务列表，找所有 FINISH 任务的 cloudId
  const tl = await G("/market/signin/task/taskList?marketname=sign_in_3", 3);
  const flat = [];
  for (const v of Object.values((tl.j && tl.j.result) || {})) if (Array.isArray(v)) for (const t of v) flat.push(t);
  const fin = flat.filter(t => t.state === "FINISH");
  log("① FINISH 任务", fin.map(t => ({ id: t.id, cloudId: t.cloudId, cloudType: t.cloudType,
    name: String(t.name || "").replace(/<[^>]*>/g, "").slice(0, 14) })));
  // ② 用任务的 cloudId + cloudType 领（receiveV3）
  for (const t of fin.slice(0, 4)) {
    if (!t.cloudId) continue;
    const body = { client: "app", cloudId: String(t.cloudId), cloudType: t.cloudType !== undefined ? t.cloudType : 0 };
    let r;
    for (let i = 0; i < 2; i++) {
      try { r = await fetch(MM + "/ycloud/signin/page/receiveV3", { method: "POST",
        headers: { ...hJ(), "Content-Type": "application/json;charset=UTF-8", "isDeviceId": "true" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
        const t2 = await r.text(); let j = null; try { j = JSON.parse(t2); } catch {}
        r = { status: r.status, j, raw: t2.slice(0, 160) }; break;
      } catch (e) { r = { status: 0, j: null, raw: String(e.message) }; await sleep(1000); }
    }
    const s2 = await snap();
    const changed = (s2.total !== s.total) || (s2.toReceive !== s.toReceive);
    log((changed ? "★★★成功 " : "") + "② 任务" + t.id + " cloudId=" + t.cloudId, {
      code: r.j && r.j.code, msg: r.j && r.j.msg, raw: r.raw.slice(0, 100),
      总豆: s.total + "→" + s2.total, 待领: s.toReceive + "→" + s2.toReceive });
    if (changed) { s = s2; }
    await sleep(600);
  }
  // ③ receiveTask 逐个 FINISH 任务 id
  for (const t of fin.slice(0, 5)) {
    const r = await G(`/ycloud/signin/page/receiveTask?taskId=${t.id}`, 2);
    const s2 = await snap();
    const changed = (s2.total !== s.total) || (s2.toReceive !== s.toReceive);
    log((changed ? "★★★成功 " : "") + "③ receiveTask id=" + t.id, {
      code: r.j && r.j.code, result: r.j && r.j.result, raw: r.raw.slice(0, 90),
      总豆: s.total + "→" + s2.total, 待领: s.toReceive + "→" + s2.toReceive });
    if (changed) s = s2;
    await sleep(500);
  }
  const sEnd = await snap();
  log("最终", { 起始: START, 现在: { total: sEnd.total, toReceive: sEnd.toReceive },
    总增豆: (sEnd.total || 0) - (START.total || 0) });
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
