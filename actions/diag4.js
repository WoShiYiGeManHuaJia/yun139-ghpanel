// 诊断 v4：在页面上下文内直接调接口（带页面完整登录态），取证气泡列表与领取接口
const fs = require("fs");
const { chromium } = require("playwright");
const AUTH = process.env.DIAG_AUTH || "";
const PHONE = process.env.DIAG_PHONE || "";

(async () => {
  const out = { ts: new Date().toISOString(), phone: PHONE, probe: {}, login: {} };
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 Mobile Safari/537.36",
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    });
    const page = await ctx.newPage();
    const reqHeaders = {};
    page.on("request", (r) => {
      if (/taskListV3|infoV3|cloudNum|receive/i.test(r.url())) reqHeaders[r.url().slice(0, 120)] = r.headers();
    });

    // 注入凭据后打开云朵中心
    await ctx.addInitScript(([auth, phone]) => {
      try { localStorage.setItem("authorization", auth); localStorage.setItem("ORCHES-I-ACCOUNT-SIMPLIFY", phone); } catch (e) {}
    }, [AUTH, PHONE]);
    await page.goto("https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(10000);

    // 1) 页面内调 taskListV3（真实任务+气泡清单）
    out.probe.taskListV3 = await page.evaluate(async () => {
      try {
        const r = await fetch("/ycloud/signin/task/taskListV3", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ marketname: "sign_in_3", client: 0, clientVersion: "" }),
        });
        return (await r.text()).slice(0, 9000);
      } catch (e) { return "ERR " + String(e.message); }
    });

    // 2) 页面内调 infoV3
    out.probe.infoV3 = await page.evaluate(async () => {
      try {
        const r = await fetch("/ycloud/signin/page/infoV3?client=app", { headers: { "Content-Type": "application/json" } });
        return (await r.text()).slice(0, 4000);
      } catch (e) { return "ERR " + String(e.message); }
    });

    // 3) 页面内调 getCloudNum
    out.probe.cloudNum = await page.evaluate(async () => {
      try {
        const r = await fetch("/ycloud/signin/page/getCloudNum", { headers: { "Content-Type": "application/json" } });
        return (await r.text()).slice(0, 1500);
      } catch (e) { return "ERR " + String(e.message); }
    });

    // 4) 探测领取相关接口
    out.probe.receiveProbe = await page.evaluate(async () => {
      const paths = ["/ycloud/signin/page/receiveV3", "/ycloud/signin/task/receive", "/ycloud/signin/page/receive"];
      const res = {};
      for (const p of paths) {
        try {
          const r = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
          res[p] = (await r.text()).slice(0, 500);
        } catch (e) { res[p] = "ERR " + String(e.message).slice(0, 60); }
      }
      return res;
    });

    // 5) 登录态检查
    out.login.storage = await page.evaluate(() => {
      const o = {};
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = String(localStorage.getItem(k)).slice(0, 60); } } catch (e) {}
      return o;
    });
    out.login.cookies = (await ctx.cookies()).map(c => c.name + "=" + String(c.value).slice(0, 30));
    out.login.text = await page.evaluate(() => (document.body.innerText || "").slice(0, 1200));
    out.reqHeaders = reqHeaders;
  } catch (e) {
    out.error = String(e.message || e).slice(0, 300);
  } finally { if (browser) await browser.close().catch(() => {}); }
  fs.mkdirSync("/tmp/diag4", { recursive: true });
  fs.writeFileSync("/tmp/diag4/out.json", JSON.stringify(out, null, 2));
  console.log("DONE");
})();
