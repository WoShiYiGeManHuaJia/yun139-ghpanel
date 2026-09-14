import crypto from "crypto";
const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString() };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const md5 = s => crypto.createHash("md5").update(s, "utf8").digest("hex");
const rnd = n => crypto.randomBytes(Math.ceil(n/2)).toString("hex").slice(0,n);
function calSign(body, ts, randStr) {
  let b = encodeURIComponent(body);
  b = [...b].sort().join("");
  b = Buffer.from(b, "utf8").toString("base64");
  const res = md5(b) + md5(ts + ":" + randStr);
  return md5(res).toUpperCase();
}
function H(bodyObj) {
  const ts = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace("T", " ");
  const randStr = rnd(16);
  const bodyStr = JSON.stringify(bodyObj);
  return {
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "CMS-DEVICE": "default",
    "Authorization": "Basic " + A,
    "mcloud-channel": "1000101",
    "mcloud-client": "10701",
    "mcloud-sign": `${ts},${randStr},${calSign(bodyStr, ts, randStr)}`,
    "mcloud-version": "7.14.0",
    "Origin": "https://yun.139.com",
    "Referer": "https://yun.139.com/w/",
    "x-DeviceInfo": "||9|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||",
    "x-huawei-channelSrc": "10000034",
    "x-inner-ntwk": "2",
    "x-m4c-caller": "PC",
    "x-m4c-src": "10002",
    "x-SvcType": "1",
    "Inner-Hcy-Router-Https": "1",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  };
}
async function post(url, body) {
  const b = JSON.stringify(body);
  const r = await fetch(url, { method: "POST", headers: H(body), body: b, signal: AbortSignal.timeout(25000) });
  return { status: r.status, body: (await r.text()).slice(0, 500) };
}
async function main() {
  // 1) 路由查询
  out.route = await post("https://user-njs.yun.139.com/user/route/qryRoutePolicy", {});
  // 2) 直接试 yun.139.com 的 /file/create
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d4944415478da63f8cfc0f01f0005fb02fe3f3b7e6b0000000049454e44ae426082", "hex");
  const size = png.length;
  const hash = crypto.createHash("sha256").update(png).digest("hex").toUpperCase();
  const createBody = {
    contentHash: hash, contentHashAlgorithm: "SHA256", contentType: "application/octet-stream",
    parallelUpload: true, size, parentFileId: "/", name: "_autotest_" + Date.now() + ".png",
    type: "file", fileRenameMode: "auto_rename",
    partInfos: [{ partNumber: 1, partSize: size, parallelHashCtx: { partOffset: 0 } }],
  };
  out.create = await post("https://yun.139.com/file/create", createBody);
  out.pngSize = size; out.hash = hash.slice(0, 16) + "…";
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => {
    const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0, 3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0, 8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d);
  });
