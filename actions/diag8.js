/* 只读诊断：不签到、不领气泡，只回答「链路断在哪」 */
const fs = require("fs");
const path = require("path");
const R = require("./run.js");
const { deriveKey, aesGcmDecryptText, getJwtOnce, cloudStatus, cleanAuth, maskPhone } = R;

const HOSTS = [
  "https://user-njs.yun.139.com",
  "https://orches.yun.139.com",
  "https://caiyun.feixin.10086.cn:7071",
  "https://caiyun.feixin.10086.cn",
  "https://yun.139.com",
  "https://m.mcloud.139.com",
];
const CY = ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn", "https://yun.139.com"];

async function probe(h) {
  const t0 = Date.now();
  try {
    const r = await fetch(h, { signal: AbortSignal.timeout(15000) });
    return { h, ok: true, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { h, ok: false, err: String(e.message || e).slice(0, 90), ms: Date.now() - t0 };
  }
}

(async () => {
  const out = { ts: new Date().toISOString(), net: [], accounts: [] };
  for (const h of HOSTS) out.net.push(await probe(h));

  let arr = [];
  try {
    const key = await deriveKey(process.env.PANEL_DATA_KEY || "");
    const b = fs.readFileSync(path.join(__dirname, "../data/accounts.enc"), "utf8").trim();
    arr = JSON.parse(await aesGcmDecryptText(key, b));
  } catch (e) {
    out.fatal = "读账号失败: " + String(e.message || e).slice(0, 200);
  }

  for (const a of arr) {
    const rec = { masked: maskPhone(String(a.phone || "")) };
    const auth = cleanAuth(a.authorization);
    // 1) querySpecToken
    try {
      const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
        method: "POST",
        headers: { Authorization: "Basic " + auth, "Content-Type": "application/json", Host: "orches.yun.139.com" },
        body: JSON.stringify({ account: String(a.phone), toSourceId: "001005" }),
        signal: AbortSignal.timeout(20000),
      });
      const t = await r.text();
      rec.specToken = { http: r.status, head: t.replace(/\s+/g, " ").slice(0, 160) };
      let sso = "";
      try { sso = (JSON.parse(t).data || {}).token || ""; } catch (e) {}
      rec.ssoLen = sso.length;
      // 2) tyrzLogin 逐主机
      if (sso) {
        rec.tyrz = [];
        for (const h of CY) {
          try {
            const r2 = await fetch(`${h}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(sso)}`, {
              headers: { Host: h.replace("https://", ""), Accept: "*/*" },
              signal: AbortSignal.timeout(20000),
            });
            const t2 = await r2.text();
            let has = false;
            try { has = !!((JSON.parse(t2).result || {}).token); } catch (e) {}
            rec.tyrz.push({ h, http: r2.status, token: has, head: t2.replace(/\s+/g, " ").slice(0, 120) });
          } catch (e) {
            rec.tyrz.push({ h, err: String(e.message || e).slice(0, 80) });
          }
        }
      }
    } catch (e) {
      rec.specErr = String(e.message || e).slice(0, 160);
    }
    // 3) 完整 JWT + 云豆
    try {
      const t0 = Date.now();
      const jwt = await getJwtOnce(auth, String(a.phone));
      rec.jwt = { ok: true, len: jwt.length, ms: Date.now() - t0 };
      const st = await cloudStatus(jwt);
      rec.cloud = { total: st.total, receivable: st.receivable, toReceive: st.toReceive, errNum: st.errNum || "" };
    } catch (e) {
      rec.jwt = { ok: false, err: String(e.message || e).slice(0, 200) };
    }
    out.accounts.push(rec);
  }

  fs.writeFileSync(path.join(__dirname, "../data/d8.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  fs.writeFileSync(path.join(__dirname, "../data/d8.json"),
    JSON.stringify({ fatal: String(e.message || e).slice(0, 300) }, null, 2));
  console.error("FATAL", e);
});
