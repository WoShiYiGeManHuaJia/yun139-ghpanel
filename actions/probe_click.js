// 探针：用真实浏览器打开 6553 签到页，抓点击气泡时页面实际发出的请求（URL+headers+body）
const fs = require("node:fs");
const path = require("node:path");
const { deriveKey, aesGcmDecryptText, getJwt } = require("./run.js");

const out = { steps: [] };
function log(s) { out.steps.push(String(s).slice(0, 1200)); }
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
  if (!target) throw new Error("未找到 6553 账号");
  log("目标: 137****6553");

  const jwt = await getJwt(target.authorization, target.phone);
  log("JWT OK");

  // 取 sso token 拼进 URL
  const { getSsoToken } = {};
  let pageUrl = SIGNIN_PAGE;
  try {
    const mod = fs.readFileSync(path.join(__dirname, "run.js"), "utf8");
    // getSsoToken 未导出，用简易实现
    const { cleanAuth } = require("./run.js");
    const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
      method: "POST",
      headers: { "Authorization": "Basic " + cleanAuth(target.authorization), "Content-Type": "application/json" },
      body: JSON.stringify({ account: target.phone, toSourceId: "001005" }),
    });
    const j = await r.json();
    if (String(j.code) === "0" && j.data && j.data.token) {
      pageUrl = SIGNIN_PAGE.replace("#/newsignin", "&token=" + encodeURIComponent(j.data.token) + "#/newsignin");
      log("已拼接 sso token 到页面 URL");
    }
  } catch (e) { log("取 sso token 失败: " + String(e.message).slice(0, 80)); }

  const before = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
  const b0 = before.result !== undefined ? before.result : (before.data && before.data.cloudNum);
  log("点击前云豆: " + b0);

  let chromium;
  try { const pw = require("playwright"); chromium = pw.chromium; }
  catch (e) { throw new Error("playwright 未安装"); }

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
  const ctx = await browser.newContext({
    userAgent: MOBILE_UA,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { "jwtToken": jwt, "Referer": MCLOUD + "/" },
  });
  // 注入 jwt cookie
  await ctx.addCookies([{ name: "jwtToken", value: jwt, domain: ".mcloud.139.com", path: "/" }]);
  const page = await ctx.newPage();

  // ★ 抓所有请求，重点看 receiveV3
  const captured = [];
  page.on("request", req => {
    const u = req.url();
    if (/receive|signin|SignIn|task|Task|cloud/i.test(u)) {
      captured.push({
        url: u.slice(0, 300),
        method: req.method(),
        headers: JSON.stringify(req.headers()).slice(0, 900),
        body: (req.postData() || "").slice(0, 400),
      });
    }
  });
  page.on("response", async res => {
    const u = res.url();
    if (/receiveV3|receiveTask/i.test(u)) {
      try {
        const t = await res.text();
        captured.push({ RESPONSE: u.slice(0, 200), body: t.slice(0, 300) });
      } catch (e) {}
    }
  });

  log("=== 打开页面 ===");
  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (e) { log("goto 异常: " + String(e.message).slice(0, 100)); }
  await sleep(6000);
  try { await page.waitForSelector(".AIPoints", { timeout: 15000 }); log("已出现 .AIPoints 元素"); }
  catch (e) { log("未等到 .AIPoints: " + String(e.message).slice(0, 80)); }

  // dump 所有 AIPoints 元素
  const els = await page.locator(".AIPoints").all();
  log("AIPoints 元素数: " + els.length);
  for (let i = 0; i < els.length; i++) {
    try {
      const cls = await els[i].getAttribute("class");
      const txt = (await els[i].innerText()).replace(/\s+/g, " ").slice(0, 60);
      const box = await els[i].boundingBox();
      log("  [" + i + "] class='" + cls + "' text='" + txt + "' box=" + JSON.stringify(box));
    } catch (e) { log("  [" + i + "] 读取失败 " + String(e.message).slice(0, 60)); }
  }

  // 逐个点击，每次点击后查余额
  for (let i = 0; i < els.length; i++) {
    const cls = await els[i].getAttribute("class").catch(() => "");
    if (/is-next-month/.test(String(cls))) { log("  跳过 [" + i + "] 下月可领"); continue; }
    log("=== 点击 [" + i + "] ===");
    captured.length = 0;
    try {
      await els[i].scrollIntoViewIfNeeded();
      await sleep(500);
      await els[i].click({ timeout: 8000 });
      await sleep(3500);
    } catch (e) { log("  点击异常: " + String(e.message).slice(0, 100)); }
    // 输出本次点击捕获到的关键请求
    for (const c of captured) {
      if (c.RESPONSE) { log("  ★响应 " + c.RESPONSE + " → " + c.body); }
      else if (/receive/i.test(c.url)) { log("  ★请求 " + c.method + " " + c.url); log("      headers=" + c.headers); log("      body=" + c.body); }
    }
    const cn = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
    const now = cn.result !== undefined ? cn.result : (cn.data && cn.data.cloudNum);
    log("  点击后云豆: " + now + (Number(now) > Number(b0) ? " 【+成功】" : " （无变化）"));
    captured.length = 0;
    await sleep(2000);
  }

  const cnF = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
  const b1 = cnF.result !== undefined ? cnF.result : (cnF.data && cnF.data.cloudNum);
  log("=== 最终: " + b0 + " → " + b1 + " ===");

  await browser.close();
  const p = path.join(__dirname, "../data/probe_click.json");
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
function dump() {
  const p = path.join(__dirname, "../data/probe_click.json");
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(out, null, 2)); } catch (e) {}
  console.log(JSON.stringify(out, null, 2));
}
main().then(dump).catch(e => { out.steps.push("FATAL: " + String(e && e.message || e)); out.steps.push("STACK: " + String(e && e.stack || "").slice(0, 400)); dump(); });
