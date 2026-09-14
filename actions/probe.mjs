const out = { ts: new Date().toISOString(), logs: [], paths: [], ctx: [] };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function dl(u, tries) {
  let last;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "*/*", "Referer": "https://m.mcloud.139.com/portal/mobilecloud/index.html" }, signal: AbortSignal.timeout(40000) });
      const t = await r.text();
      if (r.status === 200 && t.length > 500) return { url: u, status: 200, body: t };
      last = "status=" + r.status;
    } catch (e) { last = String((e && e.message) || e); }
    await sleep(1500);
  }
  return { url: u, status: 0, body: "", err: String(last).slice(0, 90) };
}
const names = [
  "newsignin.336f18c3.js",
  "139newsignin.cc383f1b.js",
  "139newsignin~newsignin~test.a6a6e5d7.js",
  "139newsignin~National_zero2025~newsignin.101e5209.js",
  "National_zero2025.9ea4a91a.js",
  "promotion.fa741431.js",
  "test.5f77bd17.js",
];
const bases = [
  "https://m.mcloud.139.com/portal/mobilecloud/public/js/",
  "https://img.mcloud.139.com/portal/mobilecloud/public/js/",
];
const got = [];
for (const n of names) {
  for (const b of bases) {
    const r = await dl(b + n, 3);
    out.logs.push({ n: n.slice(0, 42), base: b.includes("img") ? "img" : "m", status: r.status, len: r.body.length, err: r.err || null });
    if (r.body.length > 2000) { got.push({ n, body: r.body }); break; }
  }
}
const set = new Set(), ctxSet = new Set();
for (const { n, body } of got) {
  for (const m of body.matchAll(/["'`](\/[^"'`]{3,130})["'`]/g)) {
    const v = m[1];
    if (/market|signin|receive|award|backupgift|msgPushOn|prize|cloud/i.test(v)) set.add(v);
  }
  for (const m of body.matchAll(/(https?:\/\/[^\s"'`\)]{10,150})/g)) {
    const v = m[1];
    if (/market|signin|receive/i.test(v)) set.add(v);
  }
  for (const kw of ["receive", "award", "cloudCount", "气泡", "bubble", "toReceive", "unReceive"]) {
    let i = 0, c = 0;
    while ((i = body.indexOf(kw, i)) !== -1 && c < 5) {
      ctxSet.add("[" + n.slice(0, 22) + "] " + kw + " → …" + body.slice(Math.max(0, i - 100), i + 120).replace(/\s+/g, " ") + "…");
      i += kw.length; c++;
    }
  }
}
out.paths = [...set].filter(x => x.length < 170).sort();
out.ctx = [...ctxSet].slice(0, 40);
const fs = await import("fs");
fs.writeFileSync(new URL("../data/probe.json", import.meta.url), JSON.stringify(out, null, 1));
