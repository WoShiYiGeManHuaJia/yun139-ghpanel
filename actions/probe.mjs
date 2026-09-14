const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const add = (k, v) => out.steps.push({ [k]: v });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";

async function main() {
  const pageUrl = "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1";
  const pr = await fetch(pageUrl, { headers: { "User-Agent": UA } });
  const html = await pr.text();
  add("page", { status: pr.status, len: html.length });

  const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  add("scripts", srcs);

  const paths = new Set(), jwtHints = [];
  for (const s of srcs.slice(0, 30)) {
    let u; try { u = new URL(s, pageUrl).href; } catch { continue; }
    try {
      const rr = await fetch(u, { headers: { "User-Agent": UA } });
      if (!rr.ok) continue;
      const js = await rr.text();
      if (js.length > 4_000_000) continue;
      for (const m of js.matchAll(/["'`](\/(?:ycloud|portal|activity|mcloud|orchestration)[A-Za-z0-9_\/\-\.\?&=]{3,140})["'`]/g)) paths.add(m[1]);
      for (const m of js.matchAll(/["'`](https:\/\/[a-z0-9\.\-]+\.139\.com[A-Za-z0-9_\/\-\.\?&=]{3,140})["'`]/g)) paths.add(m[1]);
      if (/jwtToken/.test(js)) {
        for (const m of js.matchAll(/.{80}jwtToken.{80}/g)) jwtHints.push(m[0].replace(/\s+/g, " "));
      }
    } catch (e) {}
  }
  const arr = [...paths];
  add("paths_total", arr.length);
  const kw = /task|sign|bean|act|reward|lotter|draw|point|grow|mission|daily|jwt|token/i;
  add("paths_relevant", arr.filter(x => kw.test(x)).slice(0, 150));
  add("jwt_hints", jwtHints.slice(0, 8));

  // 鉴权方式对比：cookie-only vs jwt
  const cookieOnly = { "User-Agent": UA, "Cookie": "authorization=" + encodeURIComponent(AUTH), "Accept": "application/json, text/plain, */*", "Content-Type": "application/json" };
  const tests = [];
  for (const p of ["/ycloud/signin/page/startSignIn", "/ycloud/signin/page/signInIndex"]) {
    try {
      const r = await fetch("https://m.mcloud.139.com" + p, { method: "POST", headers: { ...cookieOnly, "Origin": "https://m.mcloud.139.com", "Referer": "https://m.mcloud.139.com/" }, body: "{}" });
      tests.push({ path: p, auth: "cookie-only", status: r.status, body: (await r.text()).slice(0, 200) });
    } catch (e) { tests.push({ path: p, auth: "cookie-only", err: String(e.message || e) }); }
  }
  // tyrzLogin 备选域名
  for (const base of ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn", "https://yun.139.com"]) {
    try {
      const r = await fetch(base + "/portal/auth/tyrzLogin.action?ssoToken=TEST", { headers: { "User-Agent": UA, "Accept": "*/*" }, signal: AbortSignal.timeout(12000) });
      tests.push({ path: base + "/portal/auth/tyrzLogin.action", status: r.status, body: (await r.text()).slice(0, 150) });
    } catch (e) { tests.push({ path: base + "/portal/auth/tyrzLogin.action", err: String(e.message || e), cause: String((e.cause && e.cause.code) || "") }); }
  }
  add("auth_tests", tests);
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => {
    const fs = await import("fs");
    let dump = JSON.stringify(out, null, 1);
    if (PHONE) dump = dump.split(PHONE).join(PHONE.slice(0, 3) + "****" + PHONE.slice(-4));
    dump = dump.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0, 8) + "…(已打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), dump);
  });
