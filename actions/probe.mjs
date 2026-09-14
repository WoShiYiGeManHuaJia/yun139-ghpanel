const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), lists: {} };
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
  for (const mn of ["sign_in_3", "newsign_139mail", "sign_in", "cloud_bean"]) {
    try {
      const r = await fetch(B + "/market/signin/task/taskList?marketname=" + mn, { headers: H, signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      if (j.code !== 0) { out.lists[mn] = { err: j.msg }; continue; }
      const groups = {};
      for (const [g, arr] of Object.entries(j.result || {})) {
        if (!Array.isArray(arr)) continue;
        groups[g] = arr.map(t => ({
          id: t.id, name: t.name, reward: t.content_display2 || "", state: t.state,
          limit: t.limitType, steps: (t.stepTypeSet || []).join("/"),
          process: t.process, currDay: t.currDay, currstep: t.currstep,
        }));
      }
      out.lists[mn] = groups;
    } catch (e) { out.lists[mn] = { err: String(e && e.message || e) }; }
  }
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => {
    const fs = await import("fs");
    let dump = JSON.stringify(out, null, 1);
    if (PHONE) dump = dump.split(PHONE).join(PHONE.slice(0, 3) + "****" + PHONE.slice(-4));
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), dump);
  });
