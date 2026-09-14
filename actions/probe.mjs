const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), before: {}, clicks: {}, after: {} };
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const B = "https://caiyun.feixin.10086.cn:7071";
// 只试「无副作用或副作用仅为体验类」的 click 任务；
// 跳过 548/549(开启备份) 550/551(APP通知开关) 585/609(需真实接口) 522(需真上传) 431(云手机)
const SAFE = [409, 604, 547, 319, 113, 434, 106];

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

  async function list() {
    const r = await fetch(B + "/market/signin/task/taskList?marketname=sign_in_3", { headers: H, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const m = {};
    for (const arr of Object.values(j.result || {})) if (Array.isArray(arr)) for (const t of arr) m[t.id] = { name: t.name, state: t.state, process: t.process, reward: t.content_display2 || "" };
    return m;
  }
  out.before = await list();
  for (const id of SAFE) {
    const b0 = out.before[id] || {};
    if (b0.state === "FINISH") { out.clicks[id] = { skip: "已完成" }; continue; }
    try {
      const r = await fetch(B + "/market/signin/task/click?key=task&id=" + id, { headers: H, signal: AbortSignal.timeout(20000) });
      const t = (await r.text()).slice(0, 300);
      out.clicks[id] = { task: b0.name, reward: b0.reward, status: r.status, body: t };
    } catch (e) { out.clicks[id] = { task: b0.name, err: String(e && e.message || e) }; }
    await new Promise(r => setTimeout(r, 800));
  }
  out.after = await list();
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => {
    const fs = await import("fs");
    let dump = JSON.stringify(out, null, 1);
    if (PHONE) dump = dump.split(PHONE).join(PHONE.slice(0, 3) + "****" + PHONE.slice(-4));
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), dump);
  });
