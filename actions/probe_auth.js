// 探针：逐个账号测 querySpecToken，定位哪个失效
const path = require("node:path");
const fs = require("node:fs");
const { deriveKey, aesGcmDecryptText, cleanAuth } = require("./run.js");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = { steps: [] };
function log(s) { out.steps.push(String(s).slice(0, 400)); }

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function tryQuerySpecToken(authorization, phone) {
  const auth = "Basic " + cleanAuth(authorization);
  const res = [];
  for (const toSourceId of ["001005", "001007", "001001"]) {
    try {
      const r = await fetchWithTimeout("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
        method: "POST",
        headers: { "Authorization": auth, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
        body: JSON.stringify({ account: phone, toSourceId }),
      });
      const t = await r.text();
      res.push("toSourceId=" + toSourceId + " → " + t.replace(/\s+/g, " ").slice(0, 220));
    } catch (e) { res.push("toSourceId=" + toSourceId + " 异常 " + String(e.message).slice(0, 50)); }
    await sleep(1200);
  }
  return res;
}

async function main() {
  const dk = process.env.PANEL_DATA_KEY || "";
  const key = await deriveKey(dk);
  let accounts = [];
  try { accounts = JSON.parse(await aesGcmDecryptText(key, fs.readFileSync(path.join(__dirname, "../data/accounts.enc"), "utf8"))); }
  catch (e) { log("读取账号失败: " + e.message); }

  log("账号总数: " + accounts.length);
  for (const a of accounts) {
    const phone = String(a.phone);
    const masked = phone.slice(0, 3) + "****" + phone.slice(-4);
    log("===== " + masked + " =====");
    log("  auth 长度=" + String(a.authorization || "").length + " 开头=" + String(a.authorization || "").slice(0, 24));
    const r = await tryQuerySpecToken(a.authorization, phone);
    r.forEach(x => log("  " + x));
    await sleep(1500);
  }
  fs.writeFileSync(path.join(__dirname, "../data/probe_auth.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { out.steps.push("FATAL: " + e.message); console.log(JSON.stringify(out, null, 2)); });
