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
  throw new Error("getJwt 失败");
}
async function G(p, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch(MM + p, { headers: hJ(), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t.slice(0, 250) };
    } catch (e) { last = e; await sleep(1200); }
  }
  return { status: 0, j: null, raw: "失败" };
}
async function P(p, body, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch(MM + p, { method: "POST", headers: { ...hJ(), "Content-Type": "application/json;charset=UTF-8" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t.slice(0, 250) };
    } catch (e) { last = e; await sleep(1200); }
  }
  return { status: 0, j: null, raw: "失败" };
}
async function state() {
  const [a, b] = await Promise.all([G("/ycloud/signin/page/getCloudNum", 2), G("/ycloud/signin/page/infoV3?client=app", 2)]);
  const R = (b.j && b.j.result) || {};
  return { total: a.j && a.j.result, toReceive: R.toReceive, list: JSON.stringify(R.receiveList) };
}
async function main() {
  await getJwt(); log("jwt", "ok");
  const s0 = await state();
  log("⓪ 初始", s0);
  const RID1 = 2343307559, RID2 = 2343307413;
  // 逐个方案试，每次试完立即查状态
  const plans = [
    ["A. receiveTask?recordId", `/ycloud/signin/page/receiveTask?recordId=${RID1}`, null],
    ["B. receiveTask?recordId+cloudType", `/ycloud/signin/page/receiveTask?recordId=${RID1}&cloudType=0`, null],
    ["C. receiveTask?cloudType=2", "/ycloud/signin/page/receiveTask?cloudType=2", null],
    ["D. receiveTask?cloudType=0", "/ycloud/signin/page/receiveTask?cloudType=0", null],
    ["E. POST receiveV3{recordId,cloudType}", null, { recordId: RID1, cloudType: 0 }],
    ["F. POST receiveV3{cloudType:2}", null, { cloudType: 2 }],
  ];
  for (const [name, gp, pb] of plans) {
    const r = gp ? await G(gp, 2) : await P("/ycloud/signin/page/receiveV3", pb, 2);
    const code = r.j && r.j.code, msg = r.j && r.j.msg;
    const res = r.j && r.j.result !== undefined ? JSON.stringify(r.j.result).slice(0, 80) : null;
    const s1 = await state();
    const changed = (s1.total !== s0.total) || (s1.toReceive !== s0.toReceive);
    log((changed ? "★成功 " : "") + name, { code, msg, res, raw: r.raw.slice(0, 120),
      total前: s0.total, total后: s1.total, toReceive前: s0.toReceive, toReceive后: s1.toReceive });
    if (changed) { log("★确认到账", { 方案: name, 变化: (s1.total || 0) - (s0.total || 0) }); break; }
    await sleep(600);
  }
  const sEnd = await state();
  log("最终", sEnd);
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
