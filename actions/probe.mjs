const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [], note: [] };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const log = (k, v) => out.steps.push({ k, v });
// 解码 authorization 看真实内容
try {
  const dec = Buffer.from(A, "base64").toString("utf8");
  const masked = dec.replace(/\d{6,}/g, m => m.slice(0,3) + "****" + m.slice(-4));
  const parts = dec.split("|");
  out.note.push({ k: "解码长度", v: dec.length });
  out.note.push({ k: "段数", v: parts.length });
  // 第4段是时间戳
  if (parts.length >= 4) {
    const ts = Number(parts[3]);
    out.note.push({ k: "令牌内时间戳", v: ts + " → " + new Date(ts).toISOString() + " (UTC)" });
    out.note.push({ k: "是否过期", v: ts < Date.now() ? "★已过期" : "未过期，剩余 " + Math.round((ts - Date.now())/86400000) + " 天" });
  }
  out.note.push({ k: "解码打码", v: masked.slice(0, 120) });
} catch (e) { out.note.push({ k: "解码失败", v: String(e.message) }); }
// 直接测 querySpecToken，打印原始返回
async function t(label, body) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
        method: "POST",
        headers: { "Authorization": "Basic " + A, "Content-Type": "application/json", "Host": "orches.yun.139.com",
                   "User-Agent": "Mozilla/5.0 (Linux; Android 12) MCloudApp/10.3.0" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      const txt = await r.text();
      log(label + " 第" + (i+1) + "次", { status: r.status, raw: txt.slice(0, 300) });
      return;
    } catch (e) { log(label + " 第" + (i+1) + "次", { err: String(e.message).slice(0,120) }); }
    await new Promise(z => setTimeout(z, 3000));
  }
}
await t("querySpecToken(001005)", { account: PHONE, toSourceId: "001005" });
await new Promise(z => setTimeout(z, 2000));
await t("querySpecToken(无toSourceId)", { account: PHONE });
// 测 tyrzLogin 是否可达（用假 token）
try {
  const r = await fetch("https://caiyun.feixin.10086.cn:7071/portal/auth/tyrzLogin.action?ssoToken=test",
    { headers: { "Host": "caiyun.feixin.10086.cn:7071" }, signal: AbortSignal.timeout(20000) });
  log("tyrzLogin 连通性(假token)", { status: r.status, raw: (await r.text()).slice(0, 200) });
} catch (e) { log("tyrzLogin 连通性", { err: String(e.message).slice(0,120) }); }
const fs = await import("fs");
let d = JSON.stringify(out, null, 1);
if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d);
