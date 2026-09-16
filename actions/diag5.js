// 诊断 v5：定位「话费余额 / 流量 / 通话余量」数据接口（用户截图页面）
const fs = require("fs");
const { chromium } = require("playwright");
const AUTH = process.env.DIAG_AUTH || "";
const PHONE = process.env.DIAG_PHONE || "";
const OUT = "/tmp/diag5";
fs.mkdirSync(OUT, { recursive: true });

const KEY = /余额|话费|流量|余量|通话|积分|balance|fee|remain|flow|voice|point|asset|quota/i;

(async () => {
  const result = { ts: new Date().toISOString(), phone: PHONE, urls: [], hits: [], pages: [] };
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
        localStorage.setItem("ORCHES-I-ACCOUNT-ENCRYPT", btoa(phone));
      } catch (e) {}
    }, [AUTH, PHONE]);

    const page = await ctx.newPage();
    const seen = new Set();
    page.on("response", async (r) => {
      const u = r.url();
      if (seen.has(u)) return;
      seen.add(u);
      result.urls.push(u.slice(0, 180));
      const ct = (r.headers()["content-type"] || "");
      if (!/json|text|javascript/.test(ct)) return;
      try {
        const t = await r.text();
        if (t && t.length < 200000 && KEY.test(t)) {
          result.hits.push({ url: u.slice(0, 180), len: t.length, body: t.slice(0, 1200) });
        }
      } catch (e) {}
    });

    for (const url of process.env.TARGETS.split(",").map(s => s.trim()).filter(Boolean)) {
      const rec = { url, status: null, title: "", hasBalance: false, text: "" };
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        rec.status = resp ? resp.status() : null;
        await page.waitForTimeout(12000);
        rec.title = await page.title();
        const body = await page.evaluate(() => document.body ? document.body.innerText : "");
        rec.text = (body || "").slice(0, 800);
        rec.hasBalance = /余额|话费|流量|余量/.test(body || "");
        const name = url.replace(/[^a-z0-9]/gi, "_").slice(0, 60);
        await page.screenshot({ path: `${OUT}/shot_${name}.png`, fullPage: false }).catch(() => {});
      } catch (e) { rec.err = String(e.message).slice(0, 120); }
      result.pages.push(rec);
    }
  } catch (e) {
    result.fatal = String(e.stack || e.message).slice(0, 600);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  fs.writeFileSync(`${OUT}/out.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ urls: result.urls.length, hits: result.hits.length, pages: result.pages.map(p => ({ u: p.url, s: p.status, t: p.title, bal: p.hasBalance })) }, null, 2));
})();
