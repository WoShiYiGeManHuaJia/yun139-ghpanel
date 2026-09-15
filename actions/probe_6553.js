// 探针：dump 6553 气泡清单完整字段 + 暴力试领取参数
const fs = require("node:fs");
const path = require("node:path");
const { deriveKey, aesGcmDecryptText } = require("./run.js");

const out = { steps: [] };
function log(s) { out.steps.push(String(s).slice(0, 900)); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MCLOUD = "https://m.mcloud.139.com";
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";

async function ft(url, opt = {}, ms = 25000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opt, signal: c.signal }); } finally { clearTimeout(t); }
}
async function mcloudGet(jwt, p) {
  const r = await ft(MCLOUD + p, {
    headers: { "User-Agent": UA, "jwtToken": jwt, "Accept": "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest", "Referer": MCLOUD + "/", "Cookie": "jwtToken=" + jwt },
  });
  return await r.json();
}
async function postJ(jwt, body) {
  const r = await ft(MCLOUD + "/ycloud/signin/page/receiveV3", {
    method: "POST",
    headers: { "User-Agent": UA, "jwtToken": jwt, "Accept": "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest", "Referer": MCLOUD + "/", "Cookie": "jwtToken=" + jwt,
      "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 20000);
  const t = await r.text();
  let j = {}; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 150) }; }
  return j;
}

async function main() {
  const dk = process.env.PANEL_DATA_KEY || "";
  const key = await deriveKey(dk);
  const accounts = JSON.parse(await aesGcmDecryptText(key, fs.readFileSync(path.join(__dirname, "../data/accounts.enc"), "utf8")));
  const target = accounts.find(a => String(a.phone) === "13717306553") || accounts[0];
  log("目标账号: " + String(target.phone).slice(0,3) + "****" + String(target.phone).slice(-4));

  const { getJwt } = require("./run.js");
  const jwt = await getJwt(target.authorization, target.phone);
  log("JWT 获取成功，长度 " + String(jwt).length);

  // 1) 完整 dump infoV3
  const info = await mcloudGet(jwt, "/ycloud/signin/page/infoV3?client=app");
  log("=== infoV3 完整原始 ===");
  log(JSON.stringify(info).slice(0, 2500));

  const res = info.result || info.data || {};
  const arr = res.receiveList || res.taskList || res.list || [];
  log("气泡项数: " + arr.length);
  arr.forEach((x, i) => log("  [" + i + "] " + JSON.stringify(x)));

  // 2) 云豆余额
  const cn = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
  const before = (cn.result !== undefined ? cn.result : (cn.data && cn.data.cloudNum));
  log("当前云豆: " + before);

  // 3) 对每一项，暴力试参数组合
  for (const it of arr) {
    const rid = it.recordId !== undefined && it.recordId !== null ? it.recordId : it.cloudId;
    const ct = it.cloudType;
    const num = it.cloudNum;
    log("=== 尝试领取 " + JSON.stringify(it) + " ===");
    if (String(ct) === "2") { log("  cloudType=2 属下月可领，跳过"); continue; }

    const combos = [
      { client: "app", cloudId: Number(rid), cloudType: Number(ct) },
      { client: "app", cloudId: Number(rid), cloudType: Number(ct), cloudNum: Number(num) },
      { client: "app", cloudId: String(rid), cloudType: Number(ct) },
      { client: "app", recordId: Number(rid), cloudType: Number(ct) },
      { client: "app", cloudId: Number(rid), cloudType: Number(ct), isDeviceId: true },
      { client: "app", cloudId: Number(rid), type: Number(ct) },
      { cloudId: Number(rid), cloudType: Number(ct) },
      { client: "app", cloudId: Number(rid), cloudType: 0 },
    ];
    for (const cb of combos) {
      const j = await postJ(jwt, cb);
      const code = String(j.code);
      const recv = j.result && (j.result.receive !== undefined ? j.result.receive : j.result.receiveNum);
      const mark = (code === "0" && Number(recv) > 0) ? "★★★成功" : "  ";
      log(mark + " " + JSON.stringify(cb) + " → code=" + code + " msg=" + (j.msg||"") + " receive=" + recv + (j._raw ? " raw=" + j._raw : ""));
      await sleep(1500);
    }

    // 每轮后查余额看是否变化
    const cn2 = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
    const now = (cn2.result !== undefined ? cn2.result : (cn2.data && cn2.data.cloudNum));
    log("  → 余额 " + before + " → " + now + (now > before ? " 【已到账 +" + (now - before) + "】" : ""));
    if (now > before) { log("★ 本项成功，停止后续"); break; }
    await sleep(2000);
  }

  const p = path.join(__dirname, "../data/probe_6553.json");
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { out.steps.push("FATAL: " + e.message); console.log(JSON.stringify(out, null, 2)); });
