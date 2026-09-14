const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [], note: [] };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY7071 = "https://caiyun.feixin.10086.cn:7071";
const PAGE = "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1#/newsignin";
const log = (k, v) => out.steps.push({ k, v });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let JWT = "";
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
async function main() {
  const { chromium } = await import("playwright");
  await getJwt(); log("jwt", "ok");
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
  const ctx = await browser.newContext({
    userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, locale: "zh-CN", timezoneId: "Asia/Shanghai",
  });
  await ctx.addCookies([
    { name: "jwtToken", value: JWT, domain: "m.mcloud.139.com", path: "/" },
    { name: "ud_id", value: "1235293937743367395", domain: "m.mcloud.139.com", path: "/" },
    { name: "a_k", value: "Um7AMDEqBJxN3vJO", domain: "m.mcloud.139.com", path: "/" },
    { name: "NATION_CODE", value: "86", domain: "m.mcloud.139.com", path: "/" },
    { name: "platform", value: "2", domain: "m.mcloud.139.com", path: "/" },
  ]);
  const page = await ctx.newPage();
  const devHits = [], apiCalls = [];
  page.on("request", r => {
    try {
      const h = r.headers(), u = r.url();
      const keys = Object.keys(h).filter(k => /^(deviceid|x-device-id|device_id|uaid|box|x-uaid|fp|fingerprint)$/i.test(k));
      if (keys.length) devHits.push({ url: u.slice(0, 120), kv: keys.map(k => k + "=" + String(h[k]).slice(0, 90)) });
      if (u.includes("/ycloud/signin/")) apiCalls.push({ api: u.replace("https://m.mcloud.139.com", "").slice(0, 90),
        devKeys: Object.keys(h).filter(k => /device|uaid|box|fp/i.test(k)).map(k => k + "=" + String(h[k]).slice(0, 70)) });
    } catch (e) {}
  });
  page.on("console", m => { if (/deviceId|device/i.test(m.text())) out.note.push({ k: "console", v: m.text().slice(0, 150) }); });
  await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await sleep(11000);
  log("页面标题", await page.title());
  log("URL", page.url().slice(0, 120));
  for (const sel of [".AIPoints", '[class*="AIPoints"]', ".receive_cloud", '[class*="receive"]', ".cloudNum"]) {
    try { log("元素 " + sel, (await page.locator(sel).count()) + " 个"); } catch (e) { log("元素 " + sel, "查询失败"); }
  }
  // 页面文本片段，看是否已渲染出云豆/气泡
  try {
    const txt = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400);
    log("页面文本", txt);
  } catch (e) { log("页面文本", "读取失败"); }
  log("★ device 头捕获", devHits.slice(0, 12));
  log("签到相关请求", apiCalls.slice(0, 18));
  await browser.close();
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
