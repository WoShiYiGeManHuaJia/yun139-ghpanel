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
      if (String(j.code) !== "0") throw new Error("外层code=" + j.code);
      const rc = j.data && (j.data.resultCode || (j.data.result && j.data.result.resultCode));
      if (String(rc) !== "0") throw new Error("★业务码异常 resultCode=" + rc);
      const sso = j.data && j.data.token;
      if (!sso) throw new Error("无ssoToken");
      const r2 = await fetch(`${CY7071}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(sso)}`, { headers: { "Host": "caiyun.feixin.10086.cn:7071", "Accept": "*/*" }, signal: AbortSignal.timeout(25000) });
      const j2 = await r2.json();
      if (!j2 || !j2.result || !j2.result.token) throw new Error("无jwt " + JSON.stringify(j2).slice(0,80));
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
      return { status: r.status, j, raw: t.slice(0, 220) };
    } catch (e) { last = e; await sleep(1200); }
  }
  return { status: 0, j: null, raw: "失败" };
}
async function P(p, body, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch(MM + p, { method: "POST", headers: { ...hJ(), "Content-Type": "application/json;charset=UTF-8" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t.slice(0, 220) };
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
  await getJwt(); log("jwt", "ok（已校验 resultCode）");
  let s = await snap();
  const BASE = { total: s.total, toReceive: s.toReceive };
  log("⓪ 基线", { total: s.total, toReceive: s.toReceive, list: s.list });
  const rid1 = 2343307559, rid2 = 2343307413;
  const plans = [
    ["A receiveTask?recordId", `/ycloud/signin/page/receiveTask?recordId=${rid1}`, null],
    ["B receiveTask?recordId+cloudType=0", `/ycloud/signin/page/receiveTask?recordId=${rid1}&cloudType=0`, null],
    ["C receiveTask?cloudType=2", "/ycloud/signin/page/receiveTask?cloudType=2", null],
    ["D receiveTask?cloudType=0", "/ycloud/signin/page/receiveTask?cloudType=0", null],
    ["E receiveTask?cloudNum", `/ycloud/signin/page/receiveTask?cloudNum=6&recordId=${rid1}`, null],
    ["F POST receiveV3{recordId,cloudType0}", null, { recordId: rid1, cloudType: 0 }],
    ["G POST receiveV3{cloudType:2}", null, { cloudType: 2 }],
    ["H POST receiveV3{}", null, {}],
  ];
  let won = null;
  for (const [name, gp, pb] of plans) {
    const r = gp ? await G(gp, 2) : await P("/ycloud/signin/page/receiveV3", pb, 2);
    const s2 = await snap();
    const changed = (s2.total !== s.total) || (s2.toReceive !== s.toReceive);
    log((changed ? "★★成功 " : "") + name, {
      code: r.j && r.j.code, msg: r.j && r.j.msg,
      result: r.j && r.j.result !== undefined ? JSON.stringify(r.j.result).slice(0, 60) : null,
      raw: r.raw.slice(0, 110),
      总豆: s.total + "→" + s2.total, 待领: s.toReceive + "→" + s2.toReceive });
    if (changed) { won = name; s = s2; log("★确认", { 方案: name, 豆变化: (s2.total||0)-(s.total||0), 待领变化: (s2.toReceive||0)-(s.toReceive||0) }); break; }
    await sleep(500);
  }
  // 再查一次清单看是否减少
  const sEnd = await snap();
  log("最终", { 基线: BASE, 现在: { total: sEnd.total, toReceive: sEnd.toReceive }, list: sEnd.list, 成功方案: won || "无" });
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
