// 探针：定位 cloudType=3 的 200 豆为什么领不了
const path = require("node:path");
const fs = require("node:fs");
const { deriveKey, aesGcmDecryptText, cleanAuth } = require("./run.js");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = { steps: [], compare: {} };
function log(s) { out.steps.push(String(s).slice(0, 400)); }

const FETCH_TIMEOUT_MS = 30000;
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function getSsoToken(authorization, phone) {
  const auth = "Basic " + cleanAuth(authorization);
  const r = await fetchWithTimeout("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: phone, toSourceId: "001005" }),
  });
  const j = await r.json();
  if (String(j.code) !== "0") throw new Error("querySpecToken " + j.code);
  return j.data.token;
}

async function getJwt(authorization, phone) {
  const sso = await getSsoToken(authorization, phone);
  for (const h of ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn", "https://yun.139.com"]) {
    try {
      const r = await fetchWithTimeout(`${h}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(sso)}`,
        { headers: { Host: h.replace("https://", ""), Accept: "*/*" } });
      const j = await r.json();
      if (j && j.result && j.result.token) return j.result.token;
    } catch (e) {}
  }
  throw new Error("tyrzLogin 失败");
}

async function mcloudGet(jwt, p) {
  const r = await fetchWithTimeout("https://m.mcloud.139.com" + p, {
    headers: { "Authorization": "Bearer " + jwt, Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0" },
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 200) }; }
}

async function main() {
  const dk = process.env.PANEL_DATA_KEY || "";
  const key = await deriveKey(dk);
  let accounts = [];
  try { accounts = JSON.parse(await aesGcmDecryptText(key, fs.readFileSync(path.join(__dirname, "../data/accounts.enc"), "utf8"))); }
  catch (e) { log("读取账号失败: " + e.message); }

  for (const a of accounts) {
    const phone = String(a.phone);
    const masked = phone.slice(0, 3) + "****" + phone.slice(-4);
    log("===== " + masked + " =====");
    let jwt;
    try { jwt = await getJwt(a.authorization, phone); }
    catch (e) { log("  JWT 失败: " + String(e.message).slice(0, 120)); continue; }

    // 1) 完整 infoV3
    const info = await mcloudGet(jwt, "/ycloud/signin/page/infoV3?client=app");
    const res = (info && (info.result || info.data)) || {};
    log("  toReceive=" + res.toReceive + " receiveNum=" + res.receiveNum);
    const arr = res.receiveList || res.taskList || res.list || [];
    log("  receiveList 条数: " + arr.length);
    for (const it of arr.slice(0, 10)) {
      log("    · " + JSON.stringify(it).slice(0, 220));
    }
    out.compare[masked] = arr.slice(0, 10);

    // 2) 找 cloudType=3 的项，尝试各种领取参数
    const c3 = arr.filter(x => String(x.cloudType) === "3");
    log("  cloudType=3 条数: " + c3.length);
    for (const it of c3) {
      const cloudId = it.recordId !== undefined ? it.recordId : it.cloudId;
      const num = it.cloudNum !== undefined ? it.cloudNum : it.num;
      log("  尝试领取: cloudId=" + cloudId + " cloudNum=" + num + " cloudType=" + it.cloudType);

      const variants = [
        { label: "数字cloudId+cloudType", body: { client: "app", cloudId: Number(cloudId), cloudType: 3 } },
        { label: "字符串cloudId", body: { client: "app", cloudId: String(cloudId), cloudType: 3 } },
        { label: "cloudType=0", body: { client: "app", cloudId: Number(cloudId), cloudType: 0 } },
        { label: "带cloudNum", body: { client: "app", cloudId: Number(cloudId), cloudType: 3, cloudNum: num } },
        { label: "recordId字段名", body: { client: "app", recordId: Number(cloudId), cloudType: 3 } },
      ];
      for (const v of variants) {
        try {
          const r = await fetchWithTimeout("https://m.mcloud.139.com/ycloud/signin/page/receiveV3", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt, Accept: "application/json" },
            body: JSON.stringify(v.body),
          });
          const t = (await r.text()).replace(/\s+/g, " ").slice(0, 160);
          log("    [" + v.label + "] " + t);
        } catch (e) { log("    [" + v.label + "] 异常 " + String(e.message).slice(0, 60)); }
        await sleep(900);
      }
    }

    // 3) 若没有 cloudType=3，试列表中每一项
    if (!c3.length) {
      for (const it of arr.slice(0, 4)) {
        const cloudId = it.recordId !== undefined ? it.recordId : it.cloudId;
        try {
          const r = await fetchWithTimeout("https://m.mcloud.139.com/ycloud/signin/page/receiveV3", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt },
            body: JSON.stringify({ client: "app", cloudId: Number(cloudId), cloudType: Number(it.cloudType) }),
          });
          const t = (await r.text()).replace(/\s+/g, " ").slice(0, 160);
          log("    尝试 cloudId=" + cloudId + " type=" + it.cloudType + " → " + t);
        } catch (e) { log("    尝试异常 " + String(e.message).slice(0, 60)); }
        await sleep(900);
      }
    }
    await sleep(1500);
  }

  fs.writeFileSync(path.join(__dirname, "../data/probe200.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { out.steps.push("FATAL: " + e.message); console.log(JSON.stringify(out, null, 2)); });
