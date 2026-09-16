const fs = require("fs");
const { chromium } = require("playwright");
const RAW = process.env.CMCC_CK2 || "";
const OUT = "data";
fs.mkdirSync(OUT, { recursive: true });

function parseCookies(raw) {
  const list = [];
  raw.split(";").forEach(seg => {
    const i = seg.indexOf("=");
    if (i <= 0) return;
    const n = seg.slice(0, i).trim(), v = seg.slice(i + 1).trim();
    if (!n) return;
    ["https://www.10086.cn/", "https://shop.10086.cn/", "https://touch.10086.cn/", "https://login.10086.cn/"].forEach(url => {
      list.push({ name: n, value: v, url });
    });
  });
  return list;
}

(async () => {
  const R = { ts: new Date().toISOString(), pages: [], xhr: [], hits: [], fatal: null };
  const KEY = /可用余额|账户总额|当月消费|语音剩余|流量剩余|套餐余量|152\.87|258\.07|75\.20/;
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      ignoreHTTPSErrors: true,
    });
    const ck = parseCookies(RAW);
    await ctx.addCookies(ck);
    console.log("注入 cookie 条数: " + ck.length);

    const page = await ctx.newPage();
    const seen = new Set();
    page.on("response", async r => {
      const u = r.url();
      const ct = r.headers()["content-type"] || "";
      if (!/json|javascript/.test(ct)) return;
      if (seen.has(u)) return; seen.add(u);
      R.xhr.push(u.slice(0, 180));
      try {
        const t = await r.text();
        if (t && t.length < 300000 && KEY.test(t)) R.hits.push({ url: u.slice(0, 180), body: t.slice(0, 1200) });
      } catch (e) {}
    });

    const targets = (process.env.TARGETS || "https://www.10086.cn/,https://shop.10086.cn/i/?f=home,https://www.10086.cn/my/").split(",");
    for (const url of targets) {
      const rec = { url, status: null, title: "", bal: false, text: "", err: null, links: [] };
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        rec.status = resp ? resp.status() : null;
        await page.waitForTimeout(12000);
        rec.title = await page.title();
        const body = await page.evaluate(() => document.body ? document.body.innerText : "");
        rec.text = (body || "").slice(0, 1800);
        rec.bal = KEY.test(body || "");
        rec.links = await page.evaluate(() =>
          Array.from(document.querySelectorAll("a")).map(a => (a.innerText || "").trim() + " => " + a.href)
            .filter(s => /我的移动|个人中心|余量|话费|账单|余额/.test(s)).slice(0, 25));
        await page.screenshot({ path: `${OUT}/d7_${url.replace(/[^a-z0-9]/gi, "_").slice(0, 45)}.png`, fullPage: true }).catch(() => {});
      } catch (e) { rec.err = String(e.message).slice(0, 150); }
      R.pages.push(rec);
      console.log(`[${rec.status}] ${url} 命中=${rec.bal} 链接=${rec.links.length}`);
    }
  } catch (e) { R.fatal = String(e.stack || e.message).slice(0, 600); }
  finally { if (browser) await browser.close().catch(() => {}); }
  fs.writeFileSync(`${OUT}/d7.json`, JSON.stringify(R, null, 2));
  console.log("DONE xhr=" + R.xhr.length + " hits=" + R.hits.length);
})();
