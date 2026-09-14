const out = { ts: new Date().toISOString() };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const PAGES = [
  "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin",
  "https://caiyun.feixin.10086.cn:7071/portal/newsignin/index.html",
];
async function grab(u) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    return { status: r.status, html: await r.text() };
  } catch (e) { return { status: 0, html: "", err: String(e && e.message || e) }; }
}
async function main() {
  const found = new Set();
  out.pages = [];
  for (const p of PAGES) {
    const g = await grab(p);
    out.pages.push({ p, status: g.status, len: g.html.length, err: g.err });
    if (!g.html) continue;
    for (const m of g.html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) found.add(m[1]);
  }
  out.scripts = [...found];
  const apis = new Set();
  for (let s of found) {
    try { s = new URL(s, "https://m.mcloud.139.com/").href; } catch (e) { continue; }
    try {
      const r = await fetch(s, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
      if (!r.ok) continue;
      const js = await r.text();
      if (js.length > 6_000_000) continue;
      // 提取 /market 开头路径
      for (const m of js.matchAll(/["'`](\/market[A-Za-z0-9_\/\-\.\?&=]{3,90})["'`]/g)) apis.add(m[1]);
      // 提取含 领取/收/气泡 的中文接口附近字符串
      for (const m of js.matchAll(/["'`](\/[a-zA-Z][A-Za-z0-9_\/\-\.]{3,70}(?:receive|award|collect|draw|bubble|cloud|bean|sign)[A-Za-z0-9_\/\-\.]{0,40})["'`]/gi)) apis.add(m[1]);
    } catch (e) {}
  }
  out.apis = [...apis].sort();
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => {
    const fs = await import("fs");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), JSON.stringify(out, null, 1));
  });
