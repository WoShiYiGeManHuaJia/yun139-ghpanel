import fs from "fs";
const out = { ts: new Date().toISOString(), found: [], jsurls: [], err: [] };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const BASE = "https://m.mcloud.139.com/portal/mobilecloud/index.html";
async function txt(u, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "*/*" }, signal: AbortSignal.timeout(30000) });
      return { status: r.status, body: await r.text() };
    } catch (e) { last = e; await new Promise(z => setTimeout(z, 1500)); }
  }
  return { status: 0, body: "", err: String((last && last.message) || last) };
}
// 1) 取首页 HTML，找 JS 文件
const h = await txt(BASE + "?path=newsignin&sourceid=1427&enableShare=1", 3);
out.htmlStatus = h.status; out.htmlErr = h.err || null;
out.htmlLen = h.body.length;
const jsSet = new Set();
for (const m of h.body.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.js(?:\?[^"']*)?)["']/g)) jsSet.add(m[1]);
for (const m of h.body.matchAll(/["'](\/[^"']*\.js(?:\?[^"']*)?)["']/g)) jsSet.add(m[1]);
out.jsurls = [...jsSet].slice(0, 40);
// 2) 逐个下载 JS，搜 market/signin 路径 + receive 关键词
const pat = /["'`]([^"'`]*(?:market\/signin|market\/manager|market\/backupgift|market\/msgPushOn|market\/prizeApi)[^"'`]*)["'`]/g;
const rec = /["'`]([^"'`]{0,60}(?:receive|Receive|领取|award|Award|claim)[^"'`]{0,60})["'`]/g;
const all = new Set(), allRec = new Set();
for (const j of out.jsurls) {
  let url = j;
  if (url.startsWith("//")) url = "https:" + url;
  else if (url.startsWith("/")) url = "https://m.mcloud.139.com" + url;
  else if (!url.startsWith("http")) url = "https://m.mcloud.139.com/portal/mobilecloud/" + url;
  const r = await txt(url, 2);
  if (r.status === 200 && r.body.length > 500) {
    for (const m of r.body.matchAll(pat)) all.add(m[1]);
    for (const m of r.body.matchAll(rec)) if (m[1].includes("/") || m[1].includes("market")) allRec.add(m[1]);
    out.err.push({ url: url.slice(-60), len: r.body.length, signin: (r.body.match(/market\/signin/g) || []).length });
  } else out.err.push({ url: url.slice(-60), status: r.status, len: r.body.length, e: r.err || null });
}
out.found = [...all].sort();
out.receiveish = [...allRec].slice(0, 60).sort();
fs.writeFileSync(new URL("../data/probe.json", import.meta.url), JSON.stringify(out, null, 1));
