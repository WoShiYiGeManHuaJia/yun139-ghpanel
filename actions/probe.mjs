const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const add = (k, v) => out.steps.push({ [k]: v });
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";

async function main() {
  let jwt = "";
  try {
    const auth = "Basic " + String(AUTH).trim().replace(/^basic /i, "");
    const r1 = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
      method: "POST", headers: { "Authorization": auth, "Content-Type": "application/json" },
      body: JSON.stringify({ account: PHONE, toSourceId: "001005" }), signal: AbortSignal.timeout(20000) });
    const j1 = await r1.json();
    const r2 = await fetch("https://caiyun.feixin.10086.cn:7071/portal/auth/tyrzLogin.action?ssoToken=" + encodeURIComponent(j1.data.token),
      { headers: { "Accept": "*/*" }, signal: AbortSignal.timeout(20000) });
    const j2 = await r2.json();
    jwt = j2.result && j2.result.token || "";
  } catch (e) { add("jwt_err", String(e && e.message || e)); return; }
  add("jwt_len", jwt.length);

  const bases = ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn"];
  const H = (b) => ({ "User-Agent": UA, "Host": b.replace("https://", ""), "jwtToken": jwt, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" });

  for (const b of bases) {
    // 1) 任务列表
    for (const mn of ["sign_in_3", "newsign_139mail"]) {
      try {
        const r = await fetch(b + "/market/signin/task/taskList?marketname=" + mn, { headers: H(b), signal: AbortSignal.timeout(20000) });
        const t = await r.text();
        add("taskList:" + b.slice(8) + ":" + mn, { status: r.status, body: t.slice(0, 2500) });
      } catch (e) { add("taskList:" + mn, { err: String(e && e.message || e) }); }
    }
    // 2) 活动信息
    try {
      const r = await fetch(b + "/market/signin/page/info", { method: "POST", headers: { ...H(b), "Content-Type": "application/x-www-form-urlencoded" }, body: "operation=getActivityInfo&marketName=sign_in_3", signal: AbortSignal.timeout(20000) });
      add("pageInfo:" + b.slice(8), { status: r.status, body: (await r.text()).slice(0, 1500) });
    } catch (e) { add("pageInfo", { err: String(e && e.message || e) }); }
    // 3) 点击任务（不指定 id 先看报错）
    try {
      const r = await fetch(b + "/market/signin/task/click?key=task&id=0", { headers: H(b), signal: AbortSignal.timeout(20000) });
      add("click_probe:" + b.slice(8), { status: r.status, body: (await r.text()).slice(0, 400) });
    } catch (e) { add("click_probe", { err: String(e && e.message || e) }); }
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
