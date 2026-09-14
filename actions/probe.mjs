const out = { ts: new Date().toISOString(), steps: [], note: [] };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const REFER = "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (k, v) => out.steps.push({ k, v });
async function dl(u) {
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(u, { headers: { "User-Agent": UA, "Referer": REFER }, signal: AbortSignal.timeout(60000) });
      if (r.status === 200) { const t = await r.text(); if (t.length > 5000) return t; } } catch (e) { await sleep(2500); }
  }
  return "";
}
const s = await dl("https://m.mcloud.139.com/portal/mobilecloud/public/js/newsignin.336f18c3.js");
out.note.push({ k: "文件", v: s ? s.length + " 字符" : "下载失败" });
if (s) {
  // 1) 6cac 模块（axios 实例 + 拦截器）
  for (const mod of ["6cac", "e9c4"]) {
    const p = s.indexOf('"' + mod + '":function');
    const p2 = s.indexOf(mod + ":function");
    const pos = p !== -1 ? p : p2;
    if (pos !== -1) log("模块 " + mod, s.slice(pos, pos + 2200).replace(/\s+/g, " "));
    else log("模块 " + mod, "未找到");
  }
  // 2) deviceId / deviceInfo 生成
  for (const kw of ["deviceId", "deviceInfo", "getDevice", "JsBridge", "jsbridge", "window.android", "webkit.messageHandlers", "localStorage.getItem"]) {
    let idx = 0, n = 0;
    while ((idx = s.indexOf(kw, idx)) !== -1 && n < 2) {
      log("搜索 " + kw, s.slice(Math.max(0, idx - 260), idx + 300).replace(/\s+/g, " "));
      idx += kw.length; n++;
    }
  }
  // 3) 锁定 / lock 相关（614=锁定失败，可能需前置接口）
  for (const kw of ["lock", "Lock", "LOCK", "锁定"]) {
    let idx = 0, n = 0;
    while ((idx = s.indexOf(kw, idx)) !== -1 && n < 2) {
      log("搜索 " + kw, s.slice(Math.max(0, idx - 200), idx + 240).replace(/\s+/g, " "));
      idx += kw.length; n++;
    }
  }
}
const fs = await import("fs");
fs.writeFileSync(new URL("../data/probe.json", import.meta.url), JSON.stringify(out, null, 1));
