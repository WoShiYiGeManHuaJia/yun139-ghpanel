const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const add = (k, v) => out.steps.push({ [k]: v });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";

async function sf(name, url, init = {}, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
      const t = await r.text();
      add(name + "#" + i, { ok: true, status: r.status, ms: Date.now() - t0, len: t.length });
      return t;
    } catch (e) {
      add(name + "#" + i, { ok: false, ms: Date.now() - t0, err: String(e && e.message || e), cause: String((e && e.cause && (e.cause.code || e.cause.message)) || "") });
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  return null;
}

async function main() {
  const pageUrl = "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1";
  const html = await sf("page", pageUrl, { headers: { "User-Agent": UA } });
  if (!html) { add("abort", "页面拉取失败"); return; }

  const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  add("scripts", srcs);

  const paths = new Set(); const jwtHints = [];
  for (const s of srcs.slice(0, 30)) {
    let u; try { u = new URL(s, pageUrl).href; } catch { continue; }
    const js = await sf("js:" + s.split("/").pop(), u, { headers: { "User-Agent": UA } }, 2);
    if (!js || js.length > 4_000_000) continue;
    for (const m of js.matchAll(/["'`](\/(?:ycloud|portal|activity|mcloud|orchestration)[A-Za-z0-9_\/\-\.\?&=]{3,140})["'`]/g)) paths.add(m[1]);
    for (const m of js.matchAll(/["'`](https:\/\/[a-z0-9\.\-]+\.139\.com[A-Za-z0-9_\/\-\.\?&=]{3,140})["'`]/g)) paths.add(m[1]);
    if (/jwtToken/.test(js)) for (const m of js.matchAll(/.{70}jwtToken.{70}/g)) jwtHints.push(m[0].replace(/\s+/g, " "));
  }
  const arr = [...paths];
  add("paths_total", arr.length);
  const kw = /task|sign|bean|act|reward|lotter|draw|point|grow|mission|daily|jwt|token/i;
  add("paths_relevant", arr.filter(x => kw.test(x)).slice(0, 150));
  add("jwt_hints", jwtHints.slice(0, 6));

  // 拿 jwt
  let jwt = "";
  try {
    const auth = "Basic " + String(AUTH).trim().replace(/^basic /i, "");
    const r1 = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
      method: "POST", headers: { "Authorization": auth, "Content-Type": "application/json" },
      body: JSON.stringify({ account: PHONE, toSourceId: "001005" }), signal: AbortSignal.timeout(20000),
    });
    const j1 = await r1.json();
    add("specToken", { code: j1.code, has: !!(j1.data && j1.data.token) });
    if (j1.data && j1.data.token) {
      const r2 = await fetch("https://caiyun.feixin.10086.cn:7071/portal/auth/tyrzLogin.action?ssoToken=" + encodeURIComponent(j1.data.token), {
        headers: { "Accept": "*/*" }, signal: AbortSignal.timeout(20000),
      });
      const j2 = await r2.json();
      add("tyrzLogin", { code: j2.code, msg: j2.msg, hasToken: !!(j2.result && j2.result.token) });
      jwt = (j2.result && j2.result.token) || "";
    }
  } catch (e) { add("jwt_err", String(e && e.message || e)); }
  add("jwt_len", (jwt || "").length);
  if (jwt) {
    const H2 = { "User-Agent": UA, "Host": "m.mcloud.139.com", "jwtToken": jwt, "Origin": "https://m.mcloud.139.com", "Referer": "https://m.mcloud.139.com/", "Accept": "application/json, text/plain, */*", "Content-Type": "application/json" };
    for (const p of ["/ycloud/signin/page/startSignIn", "/ycloud/signin/page/signInIndex", "/ycloud/activity/task/list", "/ycloud/task/list"]) {
      try {
        const r = await fetch("https://m.mcloud.139.com" + p, { method: "POST", headers: H2, body: "{}", signal: AbortSignal.timeout(20000) });
        const t = await r.text();
        add("JWT_POST" + p, { status: r.status, body: t.slice(0, 400) });
      } catch (e) { add("JWT_POST" + p, { err: String(e && e.message || e) }); }
    }
  }

  // 鉴权方式：cookie-only
  const ck = { "User-Agent": UA, "Cookie": "authorization=" + encodeURIComponent(AUTH), "Origin": "https://m.mcloud.139.com", "Referer": "https://m.mcloud.139.com/", "Accept": "application/json, text/plain, */*", "Content-Type": "application/json" };
  for (const p of ["/ycloud/signin/page/startSignIn", "/ycloud/signin/page/signInIndex", "/ycloud/activity/task/list"]) {
    await sf("POST" + p, "https://m.mcloud.139.com" + p, { method: "POST", headers: ck, body: "{}" }, 1);
  }
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => {
    const fs = await import("fs");
    let dump = JSON.stringify(out, null, 1);
    if (PHONE) dump = dump.split(PHONE).join(PHONE.slice(0, 3) + "****" + PHONE.slice(-4));
    dump = dump.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0, 8) + "…(已打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), dump);
  });
