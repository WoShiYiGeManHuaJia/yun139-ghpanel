const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString() };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const B = "https://caiyun.feixin.10086.cn:7071";
async function main() {
  let jwt = "";
  const auth = "Basic " + String(AUTH).trim().replace(/^basic /i, "");
  const r1 = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST", headers: { "Authorization": auth, "Content-Type": "application/json" },
    body: JSON.stringify({ account: PHONE, toSourceId: "001005" }), signal: AbortSignal.timeout(20000) });
  const j1 = await r1.json();
  const r2 = await fetch(B + "/portal/auth/tyrzLogin.action?ssoToken=" + encodeURIComponent(j1.data.token), { headers: { "Accept": "*/*" }, signal: AbortSignal.timeout(20000) });
  jwt = (await r2.json()).result.token;
  const H = { "User-Agent": UA, "Host": "caiyun.feixin.10086.cn:7071", "jwtToken": jwt, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" };
  async function raw() {
    const r = await fetch(B + "/market/signin/task/taskList?marketname=sign_in_3", { headers: H, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const m = {};
    for (const arr of Object.values(j.result || {})) if (Array.isArray(arr)) for (const t of arr) { m[t.id] = JSON.parse(JSON.stringify(t)); delete m[t.id].icon; delete m[t.id].button; delete m[t.id].buttonProperty; }
    return m;
  }
  const before = await raw();
  // 只点 106（每日上传）观察字段变化
  const r = await fetch(B + "/market/signin/task/click?key=task&id=106", { headers: H, signal: AbortSignal.timeout(20000) });
  out.click106 = (await r.text()).slice(0, 200);
  await new Promise(x => setTimeout(x, 1200));
  const after = await raw();
  const diff = {};
  for (const id of Object.keys(before)) {
    const b = before[id], a = after[id] || {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) {
        diff[id] = diff[id] || { name: b.name };
        diff[id][k] = { before: b[k], after: a[k] };
      }
    }
  }
  out.changed = diff;
  // 采样：完整字段（去掉超长）
  out.sample_106 = after["106"];
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => {
    const fs = await import("fs");
    let dump = JSON.stringify(out, null, 1);
    if (PHONE) dump = dump.split(PHONE).join(PHONE.slice(0, 3) + "****" + PHONE.slice(-4));
    dump = dump.replace(/"icon":"[^"]*"/g, '"icon":"…"');
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), dump);
  });
