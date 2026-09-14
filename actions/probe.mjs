// 一次性探针：在 GitHub runner 上发现「云朵中心/活动任务」的真实接口
// 只用 Secrets 里的令牌，不打印任何凭据
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const DEV = "BKeBfkGru6F2XMZXyGlYrhCEUZ+PO5LWbH1Rokz6vhuYyU4l7qEYfTv0z3B3qfTeV2I+VwCyCOzY7k8u";
const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const log = (k, v) => { out.steps.push({ [k]: v }); console.log("### " + k + " ###"); console.log(typeof v === "string" ? v : JSON.stringify(v, null, 1)); };

function cleanAuth(raw) { raw = String(raw || "").trim(); if (raw.toLowerCase().startsWith("basic ")) raw = raw.slice(6).trim(); return raw; }

async function getJwt() {
  const auth = "Basic " + cleanAuth(AUTH);
  const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: PHONE, toSourceId: "001005" }),
  });
  const j = await r.json();
  if (String(j.code) !== "0") throw new Error("querySpecToken 失败 code=" + j.code + " msg=" + j.message);
  const r2 = await fetch("https://caiyun.feixin.10086.cn:7071/portal/auth/tyrzLogin.action?ssoToken=" + encodeURIComponent(j.data.token), {
    headers: { "Host": "caiyun.feixin.10086.cn:7071", "Accept": "*/*" },
  });
  const j2 = await r2.json();
  return j2.result.token;
}

const H = (jwt, extra = {}) => ({
  "User-Agent": UA, "Host": "m.mcloud.139.com", "jwtToken": jwt,
  "Origin": "https://m.mcloud.139.com", "Referer": "https://m.mcloud.139.com/",
  "Accept": "application/json, text/plain, */*", "Content-Type": "application/json", ...extra,
});

async function main() {
  const jwt = await getJwt();
  log("jwt", "获取成功，长度 " + String(jwt || "").length);

  // 1) 拉签到页 HTML
  const pageUrl = "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1";
  const pr = await fetch(pageUrl, { headers: { "User-Agent": UA } });
  const html = await pr.text();
  log("page", { status: pr.status, len: html.length });

  // 2) 抽取脚本地址
  const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  const links = [...html.matchAll(/<link[^>]+href=["']([^"']+\.js)["']/g)].map(m => m[1]);
  const all = [...new Set([...srcs, ...links])];
  log("scripts", all);

  // 3) 下载脚本，找接口路径
  const found = new Set();
  for (const s of all.slice(0, 25)) {
    let u = s;
    try { u = new URL(s, pageUrl).href; } catch { continue; }
    try {
      const rr = await fetch(u, { headers: { "User-Agent": UA } });
      if (!rr.ok) continue;
      const js = await rr.text();
      if (js.length > 3_000_000) continue;
      for (const m of js.matchAll(/["'`](\/(?:ycloud|portal|activity|mcloud)[A-Za-z0-9_\/\-\.\?&=]{3,120})["'`]/g)) found.add(m[1]);
      for (const m of js.matchAll(/["'`](https:\/\/[a-z0-9\.\-]*\.139\.com\/[A-Za-z0-9_\/\-\.\?&=]{3,120})["'`]/g)) found.add(m[1]);
    } catch (e) { /* ignore */ }
  }
  const arr = [...found];
  log("api_paths_total", arr.length);
  // 只输出与任务/签到/豆/活动最相关的
  const kw = /task|sign|bean|act|reward|lotter|draw|point|grow|mission|daily/i;
  log("api_paths_relevant", arr.filter(x => kw.test(x)).slice(0, 120));

  // 4) 试几个候选「任务列表」接口
  const cands = [
    "/ycloud/signin/page/signInIndex",
    "/ycloud/activity/task/list",
    "/ycloud/signin/page/taskList",
    "/ycloud/cloudbean/task/list",
    "/ycloud/task/list",
  ];
  const tried = [];
  for (const c of cands) {
    try {
      const rr = await fetch("https://m.mcloud.139.com" + c, { method: "POST", headers: H(jwt), body: "{}" });
      const t = await rr.text();
      tried.push({ path: c, status: rr.status, body: t.slice(0, 300) });
    } catch (e) { tried.push({ path: c, err: String(e.message || e) }); }
  }
  log("candidate_probe", tried);
}
main().catch(e => { console.error("FATAL", e); console.log("### FATAL ### " + String(e.message || e)); });
