const out = { ts: new Date().toISOString(), steps: [], note: [] };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const REFER = "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (k, v) => out.steps.push({ k, v });
async function dl(u) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, "Referer": REFER, "Accept": "*/*" }, signal: AbortSignal.timeout(60000) });
      if (r.status === 200) { const t = await r.text(); if (t.length > 5000) return t; }
    } catch (e) { await sleep(2500); }
  }
  return "";
}
const files = [
  "https://m.mcloud.139.com/portal/mobilecloud/public/js/newsignin.336f18c3.js",
  "https://m.mcloud.139.com/portal/mobilecloud/public/js/139newsignin.cc383f1b.js",
];
const blobs = [];
for (const u of files) {
  const s = await dl(u);
  const n = u.split("/").pop();
  out.note.push({ k: n, v: s ? s.length + " 字符" : "★下载失败" });
  if (s) blobs.push({ n, s });
}
// 1) receivePoints 完整实现
for (const b of blobs) {
  let idx = 0, n = 0;
  while ((idx = b.s.indexOf("receivePoints", idx)) !== -1 && n < 3) {
    log("【" + b.n + "】receivePoints", b.s.slice(Math.max(0, idx - 300), idx + 420).replace(/\s+/g, " "));
    idx += 13; n++;
  }
}
// 2) isDeviceId 拦截器
for (const b of blobs) {
  let idx = 0, n = 0;
  while ((idx = b.s.indexOf("isDeviceId", idx)) !== -1 && n < 3) {
    log("【" + b.n + "】isDeviceId", b.s.slice(Math.max(0, idx - 420), idx + 300).replace(/\s+/g, " "));
    idx += 10; n++;
  }
}
// 3) deviceId / getDeviceId 生成算法
for (const b of blobs) {
  for (const kw of ["getDeviceId", "deviceId:", "deviceId=", '"deviceId"', "ud_id", "fingerprint", "x-device"]) {
    let idx = 0, n = 0;
    while ((idx = b.s.indexOf(kw, idx)) !== -1 && n < 2) {
      log("【" + b.n + "】" + kw, b.s.slice(Math.max(0, idx - 220), idx + 260).replace(/\s+/g, " "));
      idx += kw.length; n++;
    }
  }
}
// 4) cloudNum 相关（f(t.cloudNum) 可能改写对象）
for (const b of blobs) {
  let idx = 0, n = 0;
  while ((idx = b.s.indexOf("cloudNum", idx)) !== -1 && n < 3) {
    const seg = b.s.slice(Math.max(0, idx - 200), idx + 200).replace(/\s+/g, " ");
    if (/receive|post|function|client/.test(seg)) { log("【" + b.n + "】cloudNum", seg); n++; }
    idx += 8;
  }
}
const fs = await import("fs");
fs.writeFileSync(new URL("../data/probe.json", import.meta.url), JSON.stringify(out, null, 1));
