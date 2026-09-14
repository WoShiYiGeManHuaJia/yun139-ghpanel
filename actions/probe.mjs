const out = { ts: new Date().toISOString(), steps: [], note: [] };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const BASE = "https://m.mcloud.139.com/portal/mobilecloud/";
const REFER = BASE + "index.html?path=newsignin&sourceid=1427&enableShare=1";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (k, v) => out.steps.push({ k, v });
async function dl(u) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(u, { headers: { "User-Agent": UA, "Referer": REFER }, signal: AbortSignal.timeout(60000) });
      if (r.status === 200) { const t = await r.text(); if (t.length > 200) return t; } } catch (e) { await sleep(2000); }
  }
  return "";
}
// 1) index.html 列出 js
const html = await dl(BASE + "index.html");
const jsList = [...new Set([...html.matchAll(/src=([^ >]+\.js[^ >]*)/g)].map(m => m[1].replace(/["']/g, "")))];
out.note.push({ k: "index.html", v: html ? html.length + " 字符" : "失败" });
out.note.push({ k: "js 资源", v: jsList.join(" , ").slice(0, 500) });
// 2) 逐个下载并搜关键词
const KWS = ["isDeviceId", "deviceId", "deviceid", "getDeviceId", "x-device", "device_id"];
for (const rel of jsList.slice(0, 12)) {
  const u = rel.startsWith("http") ? rel : (rel.startsWith("/") ? new URL(rel, "https://m.mcloud.139.com").href : BASE + rel.replace(/^\.?\//, ""));
  const s = await dl(u);
  if (!s) { out.note.push({ k: rel.slice(-40), v: "下载失败" }); continue; }
  let hit = false;
  for (const kw of KWS) {
    const idx = s.indexOf(kw);
    if (idx !== -1) {
      hit = true;
      log("★ [" + rel.split("/").pop() + "] " + kw, s.slice(Math.max(0, idx - 500), idx + 600).replace(/\s+/g, " "));
    }
  }
  if (!hit) out.note.push({ k: rel.split("/").pop(), v: s.length + " 字符，无 device 关键词" });
}
const fs = await import("fs");
fs.writeFileSync(new URL("../data/probe.json", import.meta.url), JSON.stringify(out, null, 1));
