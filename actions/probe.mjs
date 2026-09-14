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
  throw new Error("getJwt 失败");
}
async function main() {
  const { chromium } = await import("playwright");
  await getJwt(); log("jwt", "ok");
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  await ctx.addCookies([
    { name: "jwtToken", value: JWT, domain: "m.mcloud.139.com", path: "/" },
    { name: "ud_id", value: "1235293937743367395", domain: "m.mcloud.139.com", path: "/" },
    { name: "a_k", value: "Um7AMDEqBJxN3vJO", domain: "m.mcloud.139.com", path: "/" },
    { name: "NATION_CODE", value: "86", domain: "m.mcloud.139.com", path: "/" },
    { name: "platform", value: "2", domain: "m.mcloud.139.com", path: "/" },
  ]);
  const page = await ctx.newPage();
  const recvCalls = [];
  page.on("response", async r => {
    const u = r.url();
    if (/receive|receiveV3|receiveTask/.test(u)) {
      let body = ""; try { body = (await r.text()).slice(0, 200); } catch (e) {}
      recvCalls.push({ api: u.replace("https://m.mcloud.139.com","").slice(0,120), status: r.status(), body });
    }
  });
  await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await sleep(12000);
  const readNum = async () => {
    try { const t = (await page.locator("body").innerText()).match(/(\d{2,6})\s*云盘专属AI豆/); return t ? parseInt(t[1]) : null; }
    catch (e) { return null; }
  };
  const N0 = await readNum(); log("① 初始云豆", N0);
  // 列出气泡状态
  const st = await page.evaluate(() => [...document.querySelectorAll(".AIPoints")].map(e => ({
    cls: e.className, txt: (e.innerText||"").replace(/\s+/g," ").trim().slice(0,30) })));
  log("② 气泡状态", st);
  const results = [];
  for (const sel of [".AIPoints.two", ".AIPoints.three"]) {
    const before = await readNum();
    let ok = false, err = "";
    // 方式A：Playwright force click
    try { await page.locator(sel).click({ force: true, timeout: 8000 }); ok = true; }
    catch (e) { err = "force点击失败: " + String(e.message).slice(0, 60);
      // 方式B：JS 原生 click
      try { await page.evaluate(s => { const el = document.querySelector(s); if (el) el.click(); }, sel); ok = true; err += " | 已用JS点击"; }
      catch (e2) { err += " | JS点击也失败"; }
    }
    await sleep(4000);
    const after = await readNum();
    results.push({ 气泡: sel, 点击: ok ? "成功" : "失败", 云豆: before + " → " + after, 变化: (before!==null&&after!==null)? after-before : null, 备注: err });
    if (ok && after !== null && before !== null && after > before) log("★★★ " + sel + " 领取成功", { "增加": after - before });
  }
  log("③ 逐个结果", results);
  log("④ receive 接口", recvCalls.slice(0, 8));
  const st2 = await page.evaluate(() => [...document.querySelectorAll(".AIPoints")].map(e => ({
    cls: e.className, txt: (e.innerText||"").replace(/\s+/g," ").trim().slice(0,30) })));
  log("⑤ 点击后气泡状态", st2);
  const N1 = await readNum();
  log("⑥ 最终", { 起始: N0, 现在: N1, 净增: (N1!==null&&N0!==null)? N1-N0 : null });
  await browser.close();
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
