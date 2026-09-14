const out = { ts: new Date().toISOString(), scripts: [], paths: [] };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
async function main() {
  const r = await fetch("https://caiyun.feixin.10086.cn:7071/portal/newsignin/index.html", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  out.html_len = html.length;
  // 内联脚本片段（找接口线索）
  const inline = [];
  for (const m of html.matchAll(/["'`]([^"'`]*(?:market|signin|award|receive|collect|bean|cloud)[^"'`]{0,70})["'`]/gi)) inline.push(m[1]);
  out.inline_paths = [...new Set(inline)].slice(0, 40);
  out.script_tags = [...html.matchAll(/<script[^>]*>/g)].map(m => m[0]).slice(0, 12);
  const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  out.srcs = srcs;
  const all = new Set();
  for (let s of srcs) {
    try { s = new URL(s, "https://caiyun.feixin.10086.cn:7071/").href; } catch (e) { continue; }
    try {
      const rr = await fetch(s, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
      const js = await rr.text();
      out.scripts.push({ url: s.slice(-60), status: rr.status, len: js.length });
      if (js.length > 6_000_000) continue;
      for (const m of js.matchAll(/["'`]((?:\/[a-zA-Z][\w\-]*){2,6}(?:\?[\w=&%]*)?)["'`]/g)) all.add(m[1]);
    } catch (e) { out.scripts.push({ url: s.slice(-60), err: String(e && e.message || e) }); }
  }
  // 筛选：含关键词的
  const kw = /market|signin|award|receive|collect|bean|cloud|task|draw|bubble|gift|point/i;
  out.paths = [...all].filter(p => kw.test(p)).sort().slice(0, 120);
  out.all_count = all.size;
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => {
    const fs = await import("fs");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), JSON.stringify(out, null, 1));
  });
