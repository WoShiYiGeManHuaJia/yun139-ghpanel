// 诊断 v6：在云盘 H5 已登录上下文内，定位话费/流量/通话余量接口
const fs = require("fs");
const { chromium } = require("playwright");
const AUTH = process.env.DIAG_AUTH || "";
const PHONE = process.env.DIAG_PHONE || "";
const OUT = "/tmp/diag6";
fs.mkdirSync(OUT, { recursive: true });
const KEY = /余额|话费|余量|通用流量|通用通话|balance|remainFee|leftFlow/i;

(async () => {
  const result = { ts: new Date().toISOString(), phone: PHONE, pages: [], api: [], hits: [] };
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 Mobile Safari/537.36",
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript(([auth, phone]) => {
      try {
        localStorage.setItem("authorization", auth);
        localStorage.setItem("ORCHES-I-ACCOUNT-SIMPLIFY", phone);
      } catch (e) {}
    }, [AUTH, PHONE]);
    const page = await ctx.newPage();
    const seen = new Set();
    page.on("request", (r) => {
      const u = r.url();
      if (r.resourceType() === "xhr" || r.resourceType() === "fetch") {
        if (!seen.has(u)) { seen.add(u); result.api.push(u.slice(0, 200)); }
      }
    });
    page.on("response", async (r) => {
      const ct = r.headers()["content-type"] || "";
      if (!/json/.test(ct)) return;
      try {
        const t = await r.text();
        if (t && t.length < 200000 && KEY.test(t)) {
          result.hits.push({ url: r.url().slice(0, 200), body: t.slice(0, 900) });
        }
      } catch (e) {}
    });

    const targets = (process.env.TARGETS || "").split(",").map(s => s.trim()).filter(Boolean);
    for (const url of targets) {
      const rec = { url, status: null, title: "", bal: false, text: "" };
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        rec.status = resp ? resp.status() : null;
        await page.waitForTimeout(18000);
        rec.title = await page.title();
        const body = await page.evaluate(() => document.body ? document.body.innerText : "");
        rec.text = (body || "").slice(0, 1500);
        rec.bal = KEY.test(body || "");
        const n = url.replace(/[^a-z0-9]/gi, "_").slice(0, 50);
        await page.screenshot({ path: `${OUT}/s_${n}.png` }).catch(() => {});
      } catch (e) { rec.err = String(e.message).slice(0, 120); }
      result.pages.push(rec);
    }
  } catch (e) { result.fatal = String(e.stack || e.message).slice(0, 500); }
  finally { if (browser) await browser.close().catch(() => {}); }
  fs.writeFileSync(`${OUT}/out.json`, JSON.stringify(result, null, 2));
  console.log("DONE api=" + result.api.length + " hits=" + result.hits.length);
})();
