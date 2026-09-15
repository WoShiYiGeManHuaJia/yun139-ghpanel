// 探针 v2：验证 200 豆（cloudType=3, recordId=550 开启APP通知）的领取路径
const path = require("node:path");
const fs = require("node:fs");
const { deriveKey, aesGcmDecryptText, cleanAuth } = require("./run.js");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = { steps: [], data: {} };
function log(s) { out.steps.push(String(s).slice(0, 500)); }

const FETCH_TIMEOUT_MS = 30000;
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

const CY_HOSTS = ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn", "https://yun.139.com"];
const UA_CLOUD = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const MCLOUD = "https://m.mcloud.139.com";
const cyHeaders = (jwt, host) => ({ "User-Agent": UA_CLOUD, "Host": host.replace("https://", ""), "jwtToken": jwt, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" });
const H1 = (jwt) => ({ "User-Agent": UA_CLOUD, "jwtToken": jwt, "Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest", "Referer": MCLOUD + "/", "Cookie": "jwtToken=" + jwt });

async function getSsoToken(authorization, phone) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const auth = "Basic " + cleanAuth(authorization);
      const r = await fetchWithTimeout("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
        method: "POST",
        headers: { "Authorization": auth, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
        body: JSON.stringify({ account: phone, toSourceId: "001005" }),
      });
      const j = await r.json();
      if (String(j.code) === "0") return j.data.token;
      last = "code=" + j.code;
    } catch (e) { last = e.message; }
    await sleep(2500);
  }
  throw new Error("querySpecToken 失败: " + last);
}
async function getJwt(authorization, phone) {
  const sso = await getSsoToken(authorization, phone);
  let last;
  for (let i = 0; i < 3; i++) {
    for (const h of CY_HOSTS) {
      try {
        const r = await fetchWithTimeout(`${h}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(sso)}`,
          { headers: { Host: h.replace("https://", ""), Accept: "*/*" } });
        const j = await r.json();
        if (j && j.result && j.result.token) return j.result.token;
      } catch (e) { last = e.message; }
    }
    await sleep(2500);
  }
  throw new Error("tyrzLogin 失败: " + last);
}
async function mcloudGet(jwt, p) {
  for (const hh of [H1(jwt), { "User-Agent": UA_CLOUD, "Accept": "application/json, text/plain, */*", "Cookie": "jwtToken=" + jwt, "Referer": MCLOUD + "/" }]) {
    try {
      const r = await fetchWithTimeout(MCLOUD + p, { headers: hh }, 20000);
      const t = await r.text();
      try { const j = JSON.parse(t); if (j) return j; } catch {}
    } catch (e) {}
  }
  return null;
}
async function postReceive(jwt, body) {
  try {
    const r = await fetchWithTimeout(MCLOUD + "/ycloud/signin/page/receiveV3", {
      method: "POST", headers: { ...H1(jwt), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, 20000);
    return (await r.text()).replace(/\s+/g, " ").slice(0, 220);
  } catch (e) { return "异常 " + String(e.message).slice(0, 60); }
}
async function clickTask(jwt, id) {
  for (const h of CY_HOSTS) {
    try {
      const r = await fetchWithTimeout(h + "/market/signin/task/click?key=task&id=" + id, { headers: cyHeaders(jwt, h) }, 20000);
      const t = await r.text();
      let j = {}; try { j = JSON.parse(t); } catch { j = { msg: t.slice(0, 100) }; }
      return "code=" + j.code + " msg=" + (j.msg || j.message || "");
    } catch (e) { return "异常 " + String(e.message).slice(0, 60); }
  }
  return "全部主机失败";
}
function parseList(info) {
  const res = (info && (info.result || info.data)) || {};
  const arr = res.receiveList || res.taskList || res.list || [];
  return { toReceive: res.toReceive, arr };
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
    log("========== " + masked + " ==========");
    let jwt;
    try { jwt = await getJwt(a.authorization, phone); log("JWT: OK"); }
    catch (e) { log("JWT 失败: " + String(e.message).slice(0, 140)); continue; }

    // ① 领取前快照
    const i0 = await mcloudGet(jwt, "/ycloud/signin/page/infoV3?client=app");
    const s0 = parseList(i0);
    log("领取前 toReceive=" + s0.toReceive + " 条数=" + s0.arr.length);
    s0.arr.slice(0, 8).forEach(x => log("   · " + JSON.stringify(x).slice(0, 200)));
    const n0 = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
    log("领取前云豆=" + JSON.stringify(n0 && (n0.result !== undefined ? n0.result : n0.data)).slice(0, 60));

    // ② 先点击 recordId=550（开启APP通知，200豆）
    log("点击任务 550 前先 click → " + await clickTask(jwt, 550));
    await sleep(3000);

    // ③ 再看 list 是否变化
    const i1 = await mcloudGet(jwt, "/ycloud/signin/page/infoV3?client=app");
    const s1 = parseList(i1);
    log("点击后 toReceive=" + s1.toReceive + " 条数=" + s1.arr.length);
    s1.arr.slice(0, 8).forEach(x => log("   · " + JSON.stringify(x).slice(0, 200)));

    // ④ 对每一项尝试领取
    for (const it of s1.arr.slice(0, 6)) {
      const cloudId = it.recordId !== undefined ? it.recordId : it.cloudId;
      const num = it.cloudNum !== undefined ? it.cloudNum : it.num;
      const ct = Number(it.cloudType);
      log("尝试领取 cloudId=" + cloudId + " num=" + num + " cloudType=" + ct);
      const variants = [
        { client: "app", cloudId: Number(cloudId), cloudType: ct },
        { client: "app", cloudId: String(cloudId), cloudType: ct },
        { client: "app", cloudId: Number(cloudId), cloudType: 0 },
      ];
      for (const v of variants) {
        const t = await postReceive(jwt, v);
        log("   " + JSON.stringify(v) + " → " + t);
        await sleep(1000);
      }
    }

    // ⑤ 领取后快照
    const n1 = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
    log("领取后云豆=" + JSON.stringify(n1 && (n1.result !== undefined ? n1.result : n1.data)).slice(0, 60));
    await sleep(1500);
  }

  fs.writeFileSync(path.join(__dirname, "../data/probe200.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { out.steps.push("FATAL: " + e.message); console.log(JSON.stringify(out, null, 2)); });
