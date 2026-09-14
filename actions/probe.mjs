const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const UDID = "1235293937743367395";
const AK = "Um7AMDEqBJxN3vJO";
const out = { ts: new Date().toISOString(), steps: [] };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY7071 = "https://caiyun.feixin.10086.cn:7071";
const MM = "https://m.mcloud.139.com", HM = "m.mcloud.139.com";
const REFER = "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1";
let JWT = "";
const log = (k, v) => out.steps.push({ k, v });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hJ = (ex) => ({ "User-Agent": UA, "Host": HM, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest",
  "Referer": REFER, "Origin": "https://m.mcloud.139.com",
  "jwtToken": JWT, "Cookie": `jwtToken=${JWT}; ud_id=${UDID}; a_k=${AK}; NATION_CODE=86; platform=2`,
  ...(ex || {}) });
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
      return { j, raw: t.slice(0, 200) };
    } catch (e) { last = e; await sleep(1200); }
  }
  return { j: null, raw: "失败" };
}
async function snap() {
  const a = await G("/ycloud/signin/page/getCloudNum", 2);
  const b = await G("/ycloud/signin/page/infoV3?client=app", 2);
  const R = (b.j && b.j.result) || {};
  return { total: a.j && a.j.result, list: JSON.stringify(R.receiveList || []) };
}
async function tryReceive(rid, opt) {
  const body = { client: "app", cloudId: rid, cloudType: 0 };
  const url = MM + "/ycloud/signin/page/receiveV3" + (opt.query || "");
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { ...hJ(opt.headers), "Content-Type": "application/json;charset=UTF-8", "isDeviceId": "true" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { j, raw: t.slice(0, 160) };
    } catch (e) { await sleep(1000); }
  }
  return { j: null, raw: "请求失败" };
}
async function main() {
  await getJwt(); log("jwt", "ok");
  // 提取 isDeviceId / deviceId 的 JS 上下文
  try {
    const rr = await fetch("https://m.mcloud.139.com/portal/mobilecloud/public/js/newsignin.336f18c3.js", { headers: { "User-Agent": UA, "Referer": REFER }, signal: AbortSignal.timeout(40000) });
    const s = await rr.text();
    for (const kw of ["isDeviceId", "deviceId"]) {
      let idx = 0, n = 0;
      while ((idx = s.indexOf(kw, idx)) !== -1 && n < 2) {
        log("JS上下文 " + kw, s.slice(Math.max(0, idx - 150), idx + 180).replace(/\s+/g, " "));
        idx += kw.length; n++;
      }
    }
  } catch (e) { log("JS上下文", "下载失败 " + e.message); }
  let s = await snap();
  const START = s.total;
  log("⓪ 基线", { total: s.total, list: s.list });
  const METHODS = [
    ["① 仅设备cookie(数字cloudId)", {}],
    ["② +query deviceId", { query: "?deviceId=" + UDID }],
    ["③ +header deviceId", { headers: { deviceId: UDID } }],
  ];
  let win = null;
  for (const rid of [2343307559, 2343307413]) {
    let got = false;
    for (const [name, opt] of METHODS) {
      const r = await tryReceive(rid, opt);
      const s2 = await snap();
      const changed = (s2.total !== s.total) || (s2.list !== s.list);
      log((changed ? "★★★成功 " : "") + name + " rid=" + rid, {
        code: r.j && r.j.code, msg: r.j && r.j.msg, raw: r.raw.slice(0, 100),
        总豆: s.total + "→" + s2.total, 清单变化: s.list !== s2.list ? "是" : "否" });
      if (changed) { s = s2; got = true; win = name; log("★到账", { rid, 豆增加: (s2.total || 0) - (START || 0) }); break; }
      await sleep(700);
    }
    if (!got) log("✗ 未能领取 rid=" + rid, { 说明: "该 6 豆气泡暂无法通过 API 领取" });
  }
  const sEnd = await snap();
  log("最终", { 起始总豆: START, 现在总豆: sEnd.total, 净增: (sEnd.total || 0) - (START || 0), 清单: sEnd.list, 成功方法: win || "无" });
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
