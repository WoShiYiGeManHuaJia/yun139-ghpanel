// 深度诊断：抓取云朵中心页面真实网络请求 + 原始接口返回
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const PHONE = process.env.DIAG_PHONE || "";
const AUTH = process.env.DIAG_AUTH || "";

(async () => {
  const out = { ts: new Date().toISOString(), phone: PHONE, calls: [], dom: [], pages: [] };
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36",
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();

    // 监听所有请求
    page.on("response", async (resp) => {
      const u = resp.url();
      if (!/mcloud|yun\.139|caiyun|ycloud|cloud/i.test(u)) return;
      let body = "";
      try { body = (await resp.text()).slice(0, 3000); } catch (e) { body = "<读取失败>"; }
      out.calls.push({ url: u.slice(0, 220), status: resp.status(), body });
    });

    // 注入 cookie/token 后打开云朵中心
    const base = "https://m.mcloud.139.com";
    await ctx.addCookies([
      { name: "authorization", value: AUTH, domain: ".139.com", path: "/" },
      { name: "token", value: "", domain: ".139.com", path: "/" },
    ]);

    const urls = [
      "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1",
      "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=mCloudDay",
    ];
    for (const u of urls) {
      try {
        await page.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(6000);
        // 抓页面文本里跟云豆/气泡相关的
        const txt = await page.evaluate(() => {
          const res = [];
          document.querySelectorAll("*").forEach(el => {
            if (el.children.length > 2) return;
            const t = (el.innerText || "").trim();
            if (t && t.length < 60 && /云豆|气泡|领取|待领|\+\d|可领/.test(t)) res.push(t);
          });
          return res.slice(0, 60);
        });
        out.dom.push({ url: u.slice(0, 100), texts: txt });
        out.pages.push({ url: u.slice(0, 100), title: await page.title() });
      } catch (e) {
        out.pages.push({ url: u.slice(0, 100), err: String(e.message || e).slice(0, 120) });
      }
    }
  } catch (e) {
    out.error = String(e.message || e).slice(0, 300);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  fs.mkdirSync("/tmp/diag", { recursive: true });
  fs.writeFileSync("/tmp/diag/out.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out).slice(0, 4000));
})();
