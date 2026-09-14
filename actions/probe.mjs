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
    if (u.includes("receive") || u.includes("startSignIn")) {
      let body = ""; try { body = (await r.text()).slice(0, 200); } catch (e) {}
      recvCalls.push({ api: u.replace("https://m.mcloud.139.com","").slice(0,110), status: r.status(), body });
    }
  });
  await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await sleep(12000);
  const readNum = async () => {
    try { const t = (await page.locator("body").innerText()).match(/(\d{2,6})\s*云盘专属AI豆/); return t ? parseInt(t[1]) : null; }
    catch (e) { return null; }
  };
  const N0 = await readNum(); log("① 初始云豆", N0);
  // 找出所有"可领取"气泡元素
  const bubbles = await page.evaluate(() => {
    const res = [];
    document.querySelectorAll("*").forEach(el => {
      if (el.children.length === 0 || el.className) {
        const t = (el.innerText || "").trim();
        if (t === "可领取" || /^\+\d+$/.test(t)) {
          let p = el, path = [];
          for (let i = 0; i < 4 && p; i++) {
            path.push(p.tagName.toLowerCase() + (p.className && typeof p.className === "string" ? "." + p.className.trim().split(/\s+/).join(".") : ""));
            p = p.parentElement;
          }
          res.push({ text: t, path: path.join(" < ") });
        }
      }
    });
    return res.slice(0, 20);
  });
  log("② 气泡元素", bubbles);
  // 点击策略：依次尝试点击"可领取"文本所在的可点区域
  const clickAttempts = [];
  for (let round = 1; round <= 4; round++) {
    let clicked = false;
    try {
      const loc = page.locator("text=可领取").first();
      const cnt = await page.locator("text=可领取").count();
      clickAttempts.push({ round, 可领取数量: cnt });
      if (cnt > 0) {
        // 点父级容器（气泡本身可点）
        await loc.locator("xpath=ancestor::div[contains(@class,'cloud') or contains(@class,'cloudIcon') or contains(@class,'AI')][1]").first().click({ timeout: 8000 });
        clicked = true;
      }
    } catch (e) {
      try { await page.locator("text=可领取").first().click({ timeout: 6000 }); clicked = true; }
      catch (e2) { clickAttempts.push({ round, 错误: String(e2.message).slice(0, 80) }); }
    }
    if (!clicked) break;
    await sleep(3500);
    const N = await readNum();
    clickAttempts.push({ round, 点击后云豆: N, 变化: N !== null && N0 !== null ? N - N0 : null });
    if (N !== null && N0 !== null && N > N0) { log("★★★ 领取成功", { 云豆: N0 + " → " + N, 增加: N - N0 }); break; }
  }
  log("③ 点击过程", clickAttempts);
  log("④ 领取接口调用", recvCalls.slice(0, 10));
  const N1 = await readNum();
  log("⑤ 最终云豆", { 起始: N0, 现在: N1, 净增: (N1 !== null && N0 !== null) ? N1 - N0 : null });
  await browser.close();
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
