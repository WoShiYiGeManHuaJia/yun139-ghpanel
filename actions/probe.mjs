import { execSync } from "child_process";
import fs from "fs";
const out = { ts: new Date().toISOString(), logs: [], paths: new Set(), files: [] };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
function sh(cmd, t) {
  try { return execSync(cmd, { encoding: "utf8", timeout: (t || 40) * 1000, maxBuffer: 60 * 1024 * 1024 }); }
  catch (e) { return "__ERR__" + String(e.message || e).slice(0, 200); }
}
const cands = [
  "https://img.mcloud.139.com/portal/mobilecloud/public/js/newsignin.336f18c3.js",
  "https://m.mcloud.139.com/portal/mobilecloud/public/js/newsignin.336f18c3.js",
  "https://img.mcloud.139.com/portal/mobilecloud/public/js/139newsignin.cc383f1b.js",
  "https://m.mcloud.139.com/portal/mobilecloud/public/js/139newsignin.cc383f1b.js",
  "https://img.mcloud.139.com/portal/mobilecloud/public/js/chunk-vendors.f3c3cfb0.js",
];
const dir = "/tmp/yjs";
sh(`mkdir -p ${dir}`);
for (const u of cands) {
  const f = dir + "/" + u.split("/").pop();
  const r = sh(`curl -sL --max-time 45 --compressed -A '${UA}' -e 'https://m.mcloud.139.com/' -o '${f}' -w '%{http_code} %{size_download}' '${u}'`);
  const sz = fs.existsSync(f) ? fs.statSync(f).size : 0;
  out.logs.push({ u: u.slice(-52), res: r.trim(), size: sz });
  if (sz > 2000) out.files.push({ f, size: sz });
}
// grep 接口路径
const PAT = /["'`]([^"'`]{4,120}(?:market|signin|receive|award|cloud)[^"'`]{0,80})["'`]/gi;
const hits = new Set();
for (const { f } of out.files) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/["'`](\/[^"'`]{3,120})["'`]/g)) {
    const v = m[1];
    if (/market|signin|receive|award|backupgift|msgPushOn|prize/i.test(v)) hits.add(v);
  }
  for (const m of s.matchAll(/(https?:\/\/[^"'`\s]{10,140})/g)) {
    const v = m[1];
    if (/market|signin|receive/i.test(v)) hits.add(v);
  }
}
out.paths = [...hits].filter(x => x.length < 160).sort();
// 云端豆/领取关键词上下文
const ctx = new Set();
for (const { f } of out.files) {
  const s = fs.readFileSync(f, "utf8");
  for (const kw of ["receive", "award", "cloudCount", "getCloud", "drawPrize", "bubble", "气泡"]) {
    let i = 0, n = 0;
    while ((i = s.indexOf(kw, i)) !== -1 && n < 6) {
      ctx.add(kw + " → …" + s.slice(Math.max(0, i - 90), i + 110).replace(/\s+/g, " ") + "…");
      i += kw.length; n++;
    }
  }
}
out.ctx = [...ctx].slice(0, 30);
fs.writeFileSync(new URL("../data/probe.json", import.meta.url), JSON.stringify(out, null, 1));
