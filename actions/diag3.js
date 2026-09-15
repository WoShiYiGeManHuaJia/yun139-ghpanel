// 诊断 v3：浏览器真实登录 → 抓气泡接口原始返回 → 点击气泡抓真实请求
const fs = require("fs");
const { chromium } = require("playwright");
const AUTH = process.env.DIAG_AUTH || "";
const PHONE = process.env.DIAG_PHONE || "";
const CY_HOSTS = ["https://caiyun.feixin.10086.cn:443", "https://yun.139.com", "https://caiyun.feixin.10086.cn"];

async function getJwt() {
  const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST",
    headers: { Authorization: "Basic " + AUTH, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: PHONE, toSourceId: "001005" }),
  });
  const j = await r.json();
  if (String(j.code) !== "0" || !j.data || !j.data.token) throw new Error("token失败:" + JSON.stringify(j).slice(0, 300));
  for (const h of CY_HOSTS) {
    try {
      const r2 = await fetch(`${h}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(j.data.token)}`, { headers: { Host: h.replace("https://", "") } });
      const j2 = await r2.json();
      if (j2 && j2.result && j2.result.token) return j2.result.token;
    } catch (e) {}
  }
  throw new Error("tyrzLogin 全部失败");
}

(async () => {
  const out = { ts: new Date().toISOString(), phone: PHONE, api: {}, net: [], clicks: [], bubbles: [] };
  let browser;
  try {
    const jwt = await getJwt();
    out.jwtOk = true;

    // 先直接打接口拿原始返回
    const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 Mobile Safari/537.36";
    const mH = () => ({ Authorization: "Bearer " + jwt, "User-Agent": UA, Host: "m.mcloud.139.com", "Content-Type": "application/json" });
    for (const p of ["/ycloud/signin/page/infoV3?client=app", "/ycloud/signin/page/getCloudNum", "/ycloud/signin/page/info?client=app", "/ycloud/signin/page/receiveList?client=app"]) {
      try {
        const r = await fetch("https://m.mcloud.139.com" + p, { headers: mH() });
        out.api[p] = (await r.text()).slice(0, 4000);
      } catch (e) { out.api[p] = "ERR " + String(e.message).slice(0, 80); }
    }

    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const ctx = await browser.newContext({
      userAgent: UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    });
    const page = await ctx.newPage();

    // 注入登录态
    await ctx.addInitScript(([token, phone, auth]) => {
      try {
        localStorage.setItem("token", token);
        localStorage.setItem("authorization", auth);
        localStorage.setItem("ORCHES-I-ACCOUNT-SIMPLIFY", phone);
      } catch (e) {}
    }, [jwt, PHONE, AUTH]);

    page.on("request", (req) => {
      const u = req.url();
      if (/ycloud\/(signin|mcloudday)|receiveV|cloudNum|taskList/i.test(u)) {
        let body = "";
        try { body = String(req.postData() || "").slice(0, 400); } catch (e) {}
        out.net.push({ m: req.method(), url: u.slice(0, 200), body });
      }
    });
    page.on("response", async (resp) => {
      const u = resp.url();
      if (/ycloud\/(signin)/i.test(u)) {
        let body = "";
        try { body = (await resp.text()).slice(0, 2500); } catch (e) {}
        out.net.push({ resp: true, status: resp.status(), url: u.slice(0, 200), body });
      }
    });

    await page.goto("https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(9000);

    // 抓气泡 DOM
    out.bubbles = await page.evaluate(() => {
      const res = [];
      // 找所有可能的气泡元素
      const sel = [".AIPoints", ".points", ".bubble", "[class*='oint']", "[class*='ubble']", "[class*='loud']"];
      for (const s of sel) {
        document.querySelectorAll(s).forEach((el, i) => {
          const r = el.getBoundingClientRect();
          if (r.width < 5 || r.height < 5) return;
          res.push({ sel: s, i, text: (el.innerText || "").trim().slice(0, 60),
            cls: String(el.className).slice(0, 80), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
        });
      }
      return res.slice(0, 40);
    });

    // 点击气泡，观察请求
    for (const b of out.bubbles.slice(0, 12)) {
      try {
        await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
        await page.waitForTimeout(2200);
      } catch (e) { out.clicks.push({ err: String(e.message).slice(0, 80) }); }
    }
    await page.waitForTimeout(3000);

    // 点击后云豆
    try {
      const r = await fetch("https://m.mcloud.139.com/ycloud/signin/page/getCloudNum", { headers: mH() });
      out.api["after_click_cloudNum"] = (await r.text()).slice(0, 800);
    } catch (e) {}
  } catch (e) {
    out.error = String(e.message || e).slice(0, 300);
  } finally { if (browser) await browser.close().catch(() => {}); }
  fs.mkdirSync("/tmp/diag3", { recursive: true });
  fs.writeFileSync("/tmp/diag3/out.json", JSON.stringify(out, null, 2));
  console.log("DONE");
})();
