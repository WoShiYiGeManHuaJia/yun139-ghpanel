const out = { ts: new Date().toISOString(), hits: [] };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const files = [
  "https://m.mcloud.139.com/portal/mobilecloud/public/js/newsignin.336f18c3.js",
  "https://m.mcloud.139.com/portal/mobilecloud/public/js/139newsignin.cc383f1b.js",
  "https://m.mcloud.139.com/portal/mobilecloud/public/js/test.5f77bd17.js",
];
const KWS = ["receiveTask", "recordId", "recordid", "cloudType", "toReceive", "receiveList", "getCloudNum", "receiveV3"];
for (const u of files) {
  let s = "";
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(u, { headers: { "User-Agent": UA, "Referer": "https://m.mcloud.139.com/" }, signal: AbortSignal.timeout(40000) });
      if (r.status === 200) { s = await r.text(); break; }
    } catch (e) { await new Promise(z => setTimeout(z, 1500)); }
  }
  if (!s) { out.hits.push({ file: u.split("/").pop(), err: "下载失败" }); continue; }
  const name = u.split("/").pop();
  for (const kw of KWS) {
    let idx = 0, n = 0;
    while ((idx = s.indexOf(kw, idx)) !== -1 && n < 4) {
      out.hits.push({ file: name, kw, ctx: s.slice(Math.max(0, idx - 160), idx + 200).replace(/\s+/g, " ") });
      idx += kw.length; n++;
    }
  }
}
const fs = await import("fs");
fs.writeFileSync(new URL("../data/probe.json", import.meta.url), JSON.stringify(out, null, 1));
