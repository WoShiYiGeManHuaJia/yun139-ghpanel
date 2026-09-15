// 探针：在页面上下文里直接 fetch receiveV3（自动带上页面真实 cookie/Referer/指纹）
const fs = require("node:fs");
const path = require("node:path");
const { deriveKey, aesGcmDecryptText, getJwt } = require("./run.js");

const out = { steps: [] };
function log(s) { out.steps.push(String(s).slice(0, 1400)); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MCLOUD = "https://m.mcloud.139.com";
const SIGNIN_PAGE = "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1#/newsignin";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";

async function mcloudGet(jwt, p) {
  const r = await fetch(MCLOUD + p, {
    headers: { "User-Agent": MOBILE_UA, "jwtToken": jwt, "Accept": "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest", "Referer": MCLOUD + "/", "Cookie": "jwtToken=" + jwt },
  });
  return await r.json();
}

async function main() {
  const dk = process.env.PANEL_DATA_KEY || "";
  const key = await deriveKey(dk);
  const accounts = JSON.parse(await aesGcmDecryptText(key, fs.readFileSync(path.join(__dirname, "../data/accounts.enc"), "utf8")));
  const target = accounts.find(a => String(a.phone) === "13717306553");
  if (!target) throw new Error("未找到 6553");
  log("目标: 137****6553");

  const jwt = await getJwt(target.authorization, target.phone);
  log("JWT OK, len=" + jwt.length);

  let pageUrl = SIGNIN_PAGE;
  try {
    const { cleanAuth } = require("./run.js");
    const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
      method: "POST",
      headers: { "Authorization": "Basic " + cleanAuth(target.authorization), "Content-Type": "application/json" },
      body: JSON.stringify({ account: target.phone, toSourceId: "001005" }),
    });
    const j = await r.json();
    if (String(j.code) === "0" && j.data && j.data.token) {
      pageUrl = SIGNIN_PAGE.replace("#/newsignin", "&token=" + encodeURIComponent(j.data.token) + "#/newsignin");
      log("已拼接 sso token");
    }
  } catch (e) { log("sso 失败: " + String(e.message).slice(0, 60)); }

  const cn0 = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
  const b0 = cn0.result !== undefined ? cn0.result : (cn0.data && cn0.data.cloudNum);
  log("点击前云豆: " + b0);

  // 待领清单
  const info = await mcloudGet(jwt, "/ycloud/signin/page/infoV3?client=app");
  const res = info.result || {};
  const arr = res.receiveList || [];
  log("待领项: " + arr.length + " " + JSON.stringify(arr).slice(0, 400));

  let chromium;
  try { const pw = require("playwright"); chromium = pw.chromium; }
  catch (e) { throw new Error("playwright 未安装"); }

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
  const ctx = await browser.newContext({
    userAgent: MOBILE_UA, viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  await ctx.addCookies([{ name: "jwtToken", value: jwt, domain: ".mcloud.139.com", path: "/" }]);
  const page = await ctx.newPage();

  // 抓取页面发出的 startSignIn（含真实 deviceId）
  let realDeviceId = "";
  page.on("request", req => {
    const u = req.url();
    const m = u.match(/[?&]deviceId=([^&]+)/);
    if (m && !realDeviceId) { realDeviceId = decodeURIComponent(m[1]); log("★ 捕获页面真实 deviceId: " + realDeviceId.slice(0, 60)); }
  });

  log("=== 打开页面 ===");
  let loaded = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 40000 });
      await sleep(5000);
      const n = await page.locator(".AIPoints").count();
      if (n > 0) { loaded = true; log("第 " + attempt + " 次加载成功，AIPoints=" + n); break; }
      log("第 " + attempt + " 次无气泡元素，重载");
    } catch (e) { log("第 " + attempt + " 次 goto 失败: " + String(e.message).slice(0, 70)); }
    await sleep(3000);
  }
  if (!loaded) log("⚠ 页面未加载出气泡元素，仍继续尝试页面内 API");

  // dump 页面上的 cookie / localStorage（找指纹）
  try {
    const diag = await page.evaluate(() => {
      const ls = {};
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = String(localStorage.getItem(k)).slice(0, 60); } } catch (e) {}
      return { cookies: document.cookie.slice(0, 300), ls: JSON.stringify(ls).slice(0, 700), ua: navigator.userAgent.slice(0, 60) };
    });
    log("页面 cookie: " + diag.cookies);
    log("页面 localStorage: " + diag.ls);
  } catch (e) { log("诊断失败 " + String(e.message).slice(0, 60)); }

  // ★★★ 核心：在页面上下文里调 receiveV3
  log("=== 页面内 fetch receiveV3 ===");
  for (const it of arr) {
    const rid = it.recordId !== undefined && it.recordId !== null ? it.recordId : it.cloudId;
    const ct = Number(it.cloudType);
    const num = it.cloudNum;
    log("--- 项 cloudId=" + rid + " type=" + ct + " num=" + num + " ---");

    const combos = [
      { client: "app", cloudId: Number(rid), cloudType: ct },
      { client: "app", cloudId: Number(rid), cloudType: ct, isDeviceId: true },
      { client: "app", cloudId: Number(rid), cloudType: ct, deviceId: realDeviceId, isDeviceId: true },
    ];
    if (realDeviceId) combos.push({ client: "app", cloudId: Number(rid), cloudType: ct, deviceId: realDeviceId });

    for (const cb of combos) {
      let r;
      try {
        r = await page.evaluate(async (body) => {
          try {
            const resp = await fetch("/ycloud/signin/page/receiveV3", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest" },
              credentials: "include",
              body: JSON.stringify(body),
            });
            const t = await resp.text();
            return "HTTP" + resp.status + " " + t.slice(0, 200);
          } catch (e) { return "ERR " + String(e.message).slice(0, 80); }
        }, cb);
      } catch (e) { r = "EVAL_ERR " + String(e.message).slice(0, 80); }
      const ok = /"code"\s*:\s*0/.test(r) && !/"receive"\s*:\s*0/.test(r);
      log((ok ? "★★★" : "   ") + " " + JSON.stringify(cb).slice(0, 130) + " → " + r);
      await sleep(1800);
    }

    // 页面内 API 没领到 → 补一次 JS 强制点击（绕过浮动动画）
    try {
      const idx = arr.indexOf(it);
      const r2 = await page.evaluate(i => {
        const el = document.querySelectorAll(".AIPoints")[i];
        if (!el) return "no-el";
        el.click();
        const inner = el.querySelector("div,span,img");
        if (inner) inner.click();
        return "clicked";
      }, idx);
      log("  JS 强制点击 [" + idx + "]: " + r2);
      await sleep(3000);
    } catch (e) { log("  JS 点击异常 " + String(e.message).slice(0, 60)); }

    const cn = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
    const now = cn.result !== undefined ? cn.result : (cn.data && cn.data.cloudNum);
    log("  → 余额 " + b0 + " → " + now + (Number(now) > Number(b0) ? " 【已到账 +" + (Number(now) - Number(b0)) + "】" : ""));
    if (Number(now) > Number(b0)) { log("★ 成功，停止"); break; }
  }

  // 最后兜底：遍历所有元素 JS 强制点一遍
  if (loaded) {
    log("=== 兜底：遍历全部元素 JS 点击 ===");
    const n = await page.locator(".AIPoints").count();
    for (let i = 0; i < n; i++) {
      try {
        const cls = await page.locator(".AIPoints").nth(i).getAttribute("class");
        if (/is-next-month/.test(String(cls))) continue;
        await page.evaluate(idx => {
          const el = document.querySelectorAll(".AIPoints")[idx];
          if (el) { el.click(); const c = el.querySelector("div,span,img"); if (c) c.click(); }
        }, i);
        log("  点击 [" + i + "]");
        await sleep(2500);
        const cn = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
        const now = cn.result !== undefined ? cn.result : (cn.data && cn.data.cloudNum);
        if (Number(now) > Number(b0)) { log("  ★★ 到账 +" + (Number(now) - Number(b0))); break; }
      } catch (e) { log("  点击 [" + i + "] 异常 " + String(e.message).slice(0, 50)); }
    }
  }

  const cnF = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
  const b1 = cnF.result !== undefined ? cnF.result : (cnF.data && cnF.data.cloudNum);
  log("=== 最终: " + b0 + " → " + b1 + " ===");

  await browser.close();
}
function dump() {
  const p = path.join(__dirname, "../data/probe_inpage.json");
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(out, null, 2)); } catch (e) {}
  console.log(JSON.stringify(out, null, 2));
}
main().then(dump).catch(e => { out.steps.push("FATAL: " + String(e && e.message || e)); out.steps.push("STACK: " + String(e && e.stack || "").slice(0, 400)); dump(); });
