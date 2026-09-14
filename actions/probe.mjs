const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const add = (k, v) => { out.steps.push({ [k]: v }); };

async function tryFetch(name, url, init) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, init);
    const t = (await r.text()).slice(0, 200);
    add(name, { ok: true, status: r.status, ms: Date.now() - t0, body: t });
  } catch (e) {
    add(name, { ok: false, ms: Date.now() - t0, err: String(e && e.message || e), cause: String((e && e.cause && (e.cause.code || e.cause.message)) || "") });
  }
}

async function main() {
  // 纯连通性：不带任何凭据
  await tryFetch("GET_yun139_root", "https://yun.139.com/", {});
  await tryFetch("GET_mcloud_root", "https://m.mcloud.139.com/", {});
  await tryFetch("GET_orches_root", "https://orches.yun.139.com/", {});
  await tryFetch("GET_caiyun_root", "https://caiyun.feixin.10086.cn:7071/", {});
  await tryFetch("GET_api_mcloud", "https://m.mcloud.139.com/ycloud/signin/page/startSignIn", {});

  // 带凭据：querySpecToken
  const auth = "Basic " + String(AUTH).trim().replace(/^basic /i, "");
  await tryFetch("POST_querySpecToken", "https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json" },
    body: JSON.stringify({ account: PHONE, toSourceId: "001005" }),
  });
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => {
    const fs = await import("fs");
    let dump = JSON.stringify(out, null, 1);
    if (PHONE) dump = dump.split(PHONE).join(PHONE.slice(0, 3) + "****" + PHONE.slice(-4));
    dump = dump.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0, 8) + "…(已打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), dump);
  });
