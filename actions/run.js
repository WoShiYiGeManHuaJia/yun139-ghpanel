// GitHub Actions 执行脚本: 接收前端 dispatch 的 client_payload, 执行签到/续期/发码/登录抓令牌
// 环境变量: EVENT_TYPE(签到=sign/续期=refresh/发码=send_code/登录=do_login), PAYLOAD(JSON), PANEL_DATA_KEY(数据密钥)
// 输出: data/result.json {ts,type,ok,msg,enc_accounts?}

// ---------------- 常量 ----------------
const UA_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const DEFAULT_DEVICE = "BKeBfkGru6F2XMZXyGlYrhCEUZ+PO5LWbH1Rokz6vhuYyU4l7qEYfTv0z3B3qfTeV2I+VwCyCOzY7k8u";
const SALT = "fetion.com.cn:";
const KEY_HEX_1 = "73634235495062495331515373756c734e7253306c673d3d"; // 24字节 AES-192-CBC
const KEY_HEX_2 = "7150714477323633586746674c337538";                   // 16字节 AES-128-ECB
const SMS_RSA_N = "9ec3874c5b705b9aeaffc80684f94ce59dd13dd78dfddf856081dbe4999c7c1382a335ee4fc73ed1a9efc6d923ce0862c703659e606e84df0e61f4bbf3d62e1ffa917906c70bb39d962b0b8a574d58f1d135461c3dad16de55d21b7fbcd425caec50d73ef5e8e6e6f0d86a956c8b1c70c6ab2357727d7762e084e2097be633dc1805d52cf725eda28ae1969c98508d8657c1cdb108d62bd3f94191d3de8c79432fa68d19afbfa4541492cf38c90e4bfa466740f00b5ca9159071b2d5b4fdfb55ba974e9865af5bb276fdedddab703f52f2240b861463f7622f5c22821271d46f4c89144e2128cd32f372503493a8f272e75ebe977b201c46dcd3aed0209c7635";
const SMS_RSA_E = 65537;

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto").webcrypto;

const FETCH_TIMEOUT_MS = 30000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function base64Utf8Encode(str) { return Buffer.from(String(str), "utf8").toString("base64"); }
function parseJsonSafe(text) { try { return JSON.parse(text); } catch { return null; } }
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const signal = options.signal;
    return await fetch(url, { ...options, signal: signal || controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function responseTextChecked(r, label) {
  const text = await r.text();
  if (!r.ok) throw new Error(`${label} HTTP ${r.status}: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
  return text;
}
async function responseJsonChecked(r, label) {
  const text = await responseTextChecked(r, label);
  const j = parseJsonSafe(text);
  if (j === null) throw new Error(`${label} 返回非 JSON: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
  return j;
}
function getSetCookies(headers) {
  try {
    if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  } catch {}
  const one = headers.get("set-cookie");
  return one ? [one] : [];
}

// ---------------- 通用工具 ----------------
function b64encode(bytes) { return Buffer.from(bytes).toString("base64"); }
function utf8B64(str) { return Buffer.from(str, "utf8").toString("base64"); }
function cleanAuth(raw) {
  raw = String(raw || "").replace(/\s+/g, "");
  raw = raw.replace(/^basic/i, "");
  return raw;
}
function decodeAuth(raw) {
  const b64 = cleanAuth(raw);
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) throw new Error("authorization 不是合法 Base64");
  let decoded;
  try { decoded = Buffer.from(b64, "base64").toString("utf8"); } catch { throw new Error("authorization 不是合法 Base64"); }
  const parts = decoded.split(":");
  if (parts.length < 3) throw new Error("authorization 解码后缺少字段(应为 pc:手机号:token)");
  const prefix = parts[0].trim(), phone = parts[1].trim(), token = parts.slice(2).join(":").trim();
  if (!prefix || !/^\d{6,15}$/.test(phone) || !token) throw new Error("authorization 字段格式错误");
  return { prefix, phone, token };
}
function fmtDate(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function nowStr() { return fmtDate(new Date()); }

// ===== 钉钉机器人推送 =====
// 需要在仓库 Secrets 配置：DINGTALK_WEBHOOK（必填）、DINGTALK_SECRET（机器人安全设为"加签"时填）
const nodeCrypto = require("node:crypto");
async function sendDingTalk(title, lines) {
  const webhook = String(process.env.DINGTALK_WEBHOOK || "").trim();
  if (!webhook) { console.log("[钉钉] 未配置 DINGTALK_WEBHOOK，跳过推送"); return { skipped: true }; }
  let url = webhook;
  const secret = String(process.env.DINGTALK_SECRET || "").trim();
  if (secret) {
    const ts = Date.now();
    const sign = encodeURIComponent(
      nodeCrypto.createHmac("sha256", secret).update(ts + "\n" + secret).digest("base64"));
    url += (webhook.includes("?") ? "&" : "?") + "timestamp=" + ts + "&sign=" + sign;
  }
  const body = { msgtype: "markdown", markdown: {
    title: String(title || "云盘签到").slice(0, 60),
    text: (Array.isArray(lines) ? lines : [String(lines)]).join("\n") } };
  try {
    const r = await fetchWithTimeout(url, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, 20000);
    const t = await r.text();
    console.log("[钉钉] HTTP " + r.status + " " + t.slice(0, 160));
    return { ok: r.ok, status: r.status, body: t.slice(0, 200) };
  } catch (e) {
    console.log("[钉钉] 发送异常: " + String(e.message || e).slice(0, 120));
    return { ok: false, error: String(e.message || e).slice(0, 120) };
  }
}
function maskPhone(p) {
  p = String(p || "");
  return p.length >= 7 ? p.slice(0, 3) + "****" + p.slice(-4) : p;
}

// ---------------- SHA1 / RSA ----------------
async function sha1Hex(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function rsaModPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}
function rsaEncrypt(nHex, e, text) {
  const n = BigInt("0x" + nHex);
  const k = nHex.length / 2;
  const msgBytes = Array.from(new TextEncoder().encode(text));
  const psLen = k - msgBytes.length - 3;
  if (psLen < 8) throw new Error("RSA 明文过长");
  const ps = Array.from(crypto.getRandomValues(new Uint8Array(psLen)), b => b || 1);
  const em = [0, 2, ...ps, 0, ...msgBytes];
  let m = 0n;
  for (const b of em) m = (m << 8n) | BigInt(b);
  const c = rsaModPow(m, BigInt(e), n);
  const hex = c.toString(16).padStart(k * 2, "0");
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  return Buffer.from(out).toString("base64");
}

// ---------------- 数据加解密(AES-256-GCM, 密钥=SHA256(DATA_KEY)) ----------------
async function deriveKey(dataKey) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataKey));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function aesGcmEncryptText(key, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  const b = new Uint8Array(enc);
  const all = new Uint8Array(iv.length + b.length);
  all.set(iv); all.set(b, 12);
  return Buffer.from(all).toString("base64");
}
async function aesGcmDecryptText(key, b64) {
  let raw;
  try { raw = Buffer.from(String(b64 || ""), "base64"); } catch { throw new Error("加密数据 Base64 无效"); }
  if (raw.length < 13) throw new Error("加密数据长度无效");
  const iv = new Uint8Array(raw.slice(0, 12));
  const ct = new Uint8Array(raw.slice(12));
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

// ---------------- 短信登录链路 (含会话cookie修复 + RSA发码) ----------------
async function getJsession() {
  const r = await fetchWithTimeout("https://mail.10086.cn/Login/Login.ashx", {
    redirect: "manual",
    headers: { "User-Agent": UA_EDGE, "Accept": "text/html,application/xhtml+xml" },
  });
  if (!r.ok && r.status !== 302 && r.status !== 301) throw new Error(`获取 JSESSIONID 失败 HTTP ${r.status}`);
  const sc = getSetCookies(r.headers).join(";");
  const m = sc.match(/(?:^|[;,]\s*)JSESSIONID=([^;]+)/i);
  return m ? m[1] : "";
}
async function sendSmsCodeByScene(phone) {
  const encPhone = rsaEncrypt(SMS_RSA_N, SMS_RSA_E, phone);
  const cguid = Date.now();
  const body = `<object><string name="loginName">${encPhone}</string><string name="fv">4</string><string name="clientId">1003</string><string name="eMode">1</string><string name="loginFailureUrl"></string><string name="loginSuccessUrl"></string><string name="verifyCode"></string><string name="version">1.0</string><string name="scene">5</string></object>`;
  const r = await fetchWithTimeout(`https://mail.10086.cn/s?func=login:sendSmsCodeByScene&cguid=${cguid}`, {
    method: "POST",
    headers: {
      "User-Agent": UA_EDGE,
      "Content-Type": "text/plain; charset=UTF-8",
      "Origin": "https://mail.10086.cn",
      "Referer": "https://mail.10086.cn/",
      "Accept": "*/*",
    },
    body,
  });
  const text = await responseTextChecked(r, "发送验证码");
  const j = parseJsonSafe(text);
  if (!j) throw new Error("发送验证码返回非 JSON");
  return j;
}
async function smsPasswordLogin(phone, smsCode) {
  const jsession = await getJsession();
  const cguid = String(Date.now());
  const password = await sha1Hex(SALT + smsCode);
  const uParam = utf8B64(phone);
  const referer = `https://mail.10086.cn/default.html?&s=1&v=0&u=${uParam}&m=1&ec=S035&resource=indexLogin&clientid=1003&auto=on&cguid=${cguid}&mtime=45`;
  const form = new URLSearchParams();
  form.set("UserName", phone); form.set("passOld", ""); form.set("auto", "on");
  form.set("Password", password); form.set("webIndexPagePwdLogin", "1");
  form.set("pwdType", "1"); form.set("clientId", "1003"); form.set("authType", "2");
  const r = await fetchWithTimeout("https://mail.10086.cn/Login/Login.ashx", {
    method: "POST", redirect: "manual",
    headers: {
      "User-Agent": UA_EDGE, "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://mail.10086.cn", "Referer": referer,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Cache-Control": "max-age=0", "upgrade-insecure-requests": "1",
      "Cookie": jsession ? `JSESSIONID=${jsession}` : "",
    },
    body: form.toString(),
  });
  if (!r.ok && r.status !== 302 && r.status !== 301) {
    const txt = await r.text();
    throw new Error(`短信登录 HTTP ${r.status}: ${txt.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  const cj = {};
  for (const cookie of getSetCookies(r.headers)) {
    const mm = cookie.match(/^\s*([^=;]+)=([^;]*)/);
    if (mm) cj[mm[1].trim()] = mm[2].trim();
  }
  const loc = r.headers.get("location") || "";
  const ec = (loc.match(/ec=([^&]+)/) || [])[1];
  if (ec && ec !== "0" && ec !== "S_OK") throw new Error(`登录被风控拦截(ec=${ec})`);
  let sid = (loc.match(/sid=([^&]+)/) || [])[1] || "";
  if (!sid && cj.Os_SSo_Sid) sid = cj.Os_SSo_Sid;
  const rmkey = cj.RMKEY || "";
  if (!sid) throw new Error("登录失败: 未从响应获取 sid");
  return { sid, rmkey };
}
async function exchangeArtifact(sid, rmkey) {
  const cguid = String(Date.now());
  const url = `https://smsrebuild1.mail.10086.cn/setting/s?func=${encodeURIComponent("umc:getArtifact")}&sid=${encodeURIComponent(sid)}&cguid=${cguid}`;
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Host": "smsrebuild1.mail.10086.cn", "Cookie": `RMKEY=${rmkey}`, "Content-Type": "text/xml; charset=utf-8", "User-Agent": "okhttp/4.12.0" },
  });
  const text = await responseTextChecked(r, "换 artifact");
  const j = parseJsonSafe(text) || {};
  const artifact = (j.var && j.var.artifact) || "";
  if (!artifact) throw new Error(`换 artifact 失败: code=${j.code || "?"} summary=${j.summary || text.slice(0, 100)}`);
  return artifact;
}
async function thirdPartyLogin(phone, dycpwd) {
  // AES-192-CBC 加密请求体 (KEY1)
  const bodyObj = {
    clientkey_decrypt: "l3TryM&Q+X7@dzwk)qP", clienttype: "886", cpid: "507", dycpwd,
    extInfo: { ifOpenAccount: "0" }, loginMode: "0", msisdn: phone,
    pintype: "13", secinfo: (await sha1Hex(SALT + dycpwd)).toUpperCase(), version: "20250901",
  };
  const plainJson = stableJsonStringify(bodyObj);
  const key1 = hexToBytes(KEY_HEX_1);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const enc = await aesCbcEncrypt(new TextEncoder().encode(plainJson), key1, iv);
  const payload = b64encode(mergeU8([iv, enc]));
  const r = await fetchWithTimeout("https://user-njs.yun.139.com/user/thirdlogin", {
    method: "POST",
    headers: {
      "hcy-cool-flag": "1", "x-huawei-channelSrc": "10246600", "x-MM-Source": "0",
      "x-UserAgent": "android|23116PN5BC|android15|1.2.6|||1440x3200|10246600",
      "x-DeviceInfo": "4|127.0.0.1|5|1.2.6|Xiaomi|23116PN5BC||02-00-00-00-00-00|android 15|1440x3200|android|||",
      "Content-Type": "text/plain;charset=UTF-8", "Host": "user-njs.yun.139.com", "User-Agent": "okhttp/3.12.2",
    },
    body: payload,
  });
  const text = await responseTextChecked(r, "thirdlogin");
  let layer1;
  if (text.replace(/\s/g, "").startsWith("{")) {
    try { layer1 = JSON.parse(text); } catch { layer1 = { data: "" }; }
  } else {
    let rawStr;
    try { rawStr = Buffer.from(text.trim(), "base64").toString("binary"); } catch { rawStr = null; }
    if (!rawStr || rawStr.length < 16) throw new Error(`thirdlogin 响应解析失败: ${text.slice(0, 80)}`);
    const raw = new Uint8Array(rawStr.length);
    for (let i = 0; i < raw.length; i++) raw[i] = rawStr.charCodeAt(i) & 0xff;
    const rIv = raw.slice(0, 16); const rCt = raw.slice(16);
    const rPlain = await aesCbcDecrypt(rCt, key1, rIv);
    try { layer1 = JSON.parse(new TextDecoder().decode(rPlain)); } catch { layer1 = { data: "" }; }
  }
  const hexInner = layer1.data || "";
  if (!hexInner) throw new Error(`thirdlogin 失败: ${text.slice(0, 80)}`);
  const innerBytes = hexBytes(hexInner);
  if (!innerBytes.length || innerBytes.length % 16 !== 0) throw new Error("thirdlogin 内层密文长度无效");
  const key2 = hexToBytes(KEY_HEX_2);
  const dec = await aesEcbDecrypt(innerBytes, key2);
  const finalJson = new TextDecoder().decode(pkcs7Unpad(dec));
  let fj; try { fj = JSON.parse(finalJson); } catch { fj = {}; }
  const authToken = fj.authToken || ""; const account = fj.account || "";
  if (!authToken || !account) throw new Error(`thirdlogin 结果缺少 token: ${finalJson.slice(0, 80)}`);
  const authorization = base64Utf8Encode(`pc:${account}:${authToken}`);
  return { account, authorization };
}
async function loginBySms(phone, smsCode) {
  const { sid, rmkey } = await smsPasswordLogin(phone, smsCode);
  const artifact = await exchangeArtifact(sid, rmkey);
  const { authorization } = await thirdPartyLogin(phone, artifact);
  return authorization;
}

// ---------------- 签到 / 续期 ----------------
async function getJwtOnce(authorization, phone) {
  const auth = "Basic " + cleanAuth(authorization);
  const r = await fetchWithTimeout("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: phone, toSourceId: "001005" }),
  });
  const j = await responseJsonChecked(r, "querySpecToken");
  if (String(j.code) !== "0") throw new Error(`querySpecToken 失败 code=${j.code} msg=${j.message || ""} raw=${JSON.stringify(j).slice(0, 200)}`);
  if (!j.data || !j.data.token) throw new Error("querySpecToken 响应缺少 token: " + JSON.stringify(j).slice(0, 200));
  const ssoToken = j.data.token;
  for (const h of CY_HOSTS) {
    try {
      const r2 = await fetchWithTimeout(`${h}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(ssoToken)}`, {
        headers: { "Host": h.replace("https://", ""), "Accept": "*/*" }, signal: AbortSignal.timeout(20000),
      });
      const j2 = await responseJsonChecked(r2, "tyrzLogin");
      if (j2 && j2.result && j2.result.token) return j2.result.token;
    } catch (e) { /* 换下一个主机 */ }
  }
  throw new Error("tyrzLogin 所有主机均失败");
}
async function getSsoToken(authorization, phone) {
  const auth = "Basic " + cleanAuth(authorization);
  const r = await fetchWithTimeout("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: phone, toSourceId: "001005" }),
  });
  const j = await responseJsonChecked(r, "querySpecToken");
  if (String(j.code) !== "0") {
    const inner = (j.data && j.data.result && (j.data.result.resultCode + " " + j.data.result.resultDesc)) || "";
    throw new Error("querySpecToken 失败 code=" + j.code + " msg=" + (j.message || "") + " inner=" + inner);
  }
  if (!j.data || !j.data.token) throw new Error("querySpecToken 响应缺少 token");
  return j.data.token;
}
// 风控码：命中说明被临时限流/拒绝，需要更长的退避等待（不是令牌真的失效）
function isRateLimited(msg) {
  return /1010010015|鉴权失效|05050006|暂无权限|1010199999/.test(String(msg || ""));
}
async function getJwt(authorization, phone) {
  let last;
  // 普通错误快速重试；风控错误退避更久（2s→5s→12s→25s→40s），避免加重限流
  const waits = [2000, 5000, 12000, 25000, 40000];
  for (let i = 0; i < waits.length + 1; i++) {
    try { return await getJwtOnce(authorization, phone); }
    catch (e) {
      last = e;
      if (i < waits.length) {
        const w = isRateLimited(e.message) ? waits[i] : Math.min(waits[i], 3000);
        await new Promise(r => setTimeout(r, w));
      }
    }
  }
  throw last;
}
// 鉴权失效(1010010015)时自动续期一次，返回可用的 authorization（会就地更新 a）
async function ensureAuth(a) {
  try {
    await getJwtOnce(a.authorization, a.phone);
    return a.authorization;
  } catch (e) {
    const msg = String(e.message || e);
    if (!/1010010015|鉴权失效/.test(msg)) throw e;
    let d;
    try { d = decodeAuth(a.authorization); } catch (e2) { throw e; }
    const r = await refreshToken(a.phone, d.token);
    if (!r.ok) throw new Error("自动续期失败: " + r.error + (r.raw ? " | 原始: " + r.raw.replace(/\s+/g, " ").slice(0, 160) : ""));
    const newAuth = base64Utf8Encode(`${d.prefix}:${a.phone}:${r.data.new_token}`);
    a.authorization = newAuth;
    a.expires_at = r.data.new_expires_at;
    a.remaining_days = r.data.remaining_days;
    a.last_refresh = nowStr();
    a.auto_refreshed = true;
    await getJwtOnce(newAuth, a.phone);   // 验证新凭据可用
    return newAuth;
  }
}

async function signOne(authorization, phone, dev) {
  try {
    const jwt = await getJwt(authorization, phone);
    // 优先使用账号自身设备标识（与多账号风控原则一致），缺失才回退内置 deviceId
    const deviceId = (dev && (dev.ud_id || dev.deviceId)) || DEFAULT_DEVICE;
    const url = `https://m.mcloud.139.com/ycloud/signin/page/startSignIn?client=app&deviceId=${encodeURIComponent(deviceId)}`;
    const baseH = { "Host": "m.mcloud.139.com", "jwtToken": jwt, "Origin": "https://m.mcloud.139.com", "Referer": "https://m.mcloud.139.com/", "Accept": "application/json, text/plain, */*" };
    // 2026-09-20: 该接口返回 405，移动疑似调整了请求方法。依次回退尝试，命中即停。
    const attempts = [
      { tag: "GET", opt: { method: "GET", headers: baseH } },
      { tag: "POST-form", opt: { method: "POST", headers: { ...baseH, "Content-Type": "application/x-www-form-urlencoded" }, body: "" } },
      { tag: "POST-json", opt: { method: "POST", headers: { ...baseH, "Content-Type": "application/json" }, body: "{}" } },
      { tag: "GET-noclient", opt: { method: "GET", headers: baseH, url: `https://m.mcloud.139.com/ycloud/signin/page/startSignIn?deviceId=${encodeURIComponent(deviceId)}` } },
    ];
    let lastErr = "";
    for (const at of attempts) {
      try {
        const r = await fetchWithTimeout(at.url || url, { ...at.opt, signal: undefined });
        if (r.status === 405) { lastErr = `${at.tag} 405`; continue; }
        const txt = await r.text();
        let j = null; try { j = JSON.parse(txt); } catch (_) {}
        if (!j) { lastErr = `${at.tag} 非JSON(${r.status})`; continue; }
        const ok = String(j.code) === "0" || String(j.code).toLowerCase() === "success" || j.success === true;
        return { ok, message: (ok ? "已提交签到" : "签到接口返回失败") + `[${at.tag}]`,
                 data: { code: j.code, via: at.tag, result: (typeof (j.result || j.msg) === "object" ? JSON.stringify(j.result || j.msg) : String(j.result || j.msg || j.code || "")).slice(0, 200) } };
      } catch (e) { lastErr = `${at.tag} ${String(e.message || e).slice(0, 60)}`; }
    }
    return { ok: false, message: "签到失败：全部方式不可用 " + lastErr, data: { via: "none" } };
  } catch (e) {
    return { ok: false, message: String(e.message || e).slice(0, 300) };
  }
}
async function refreshToken(phone, token) {
  const body = `<root><token>${token}</token><account>${phone}</account><clienttype>656</clienttype></root>`;
  const r = await fetchWithTimeout("https://aas.caiyun.feixin.10086.cn:443/tellin/authTokenRefresh.do", {
    method: "POST",
    headers: { "Content-Type": "application/xml;charset=UTF-8", "User-Agent": "okhttp/4.12.0", "Accept": "application/xml" },
    body,
  });
  const text = await responseTextChecked(r, "续期");
  const mRet = text.match(/<return[^>]*>([^<]*)<\/return>/);
  const mTok = text.match(/<token[^>]*>([^<]*)<\/token>/);
  const mDesc = text.match(/<desc[^>]*>([^<]*)<\/desc>/);
  if (!mRet || mRet[1] !== "0" || !mTok) return { ok: false, error: `续期失败 return=${mRet ? mRet[1] : "?"} desc=${mDesc ? mDesc[1] : "未知"}`, raw: text.slice(0, 300) };
  const newTok = mTok[1];
  const strs = newTok.split("|");
  let exp = null, remain = null;
  if (strs.length >= 4) {
    const expMs = parseInt(strs[3], 10);
    // 时间戳非法时不能写成 "NaN-NaN-NaN NaN:NaN:NaN"，置空由前端显示“未知”
    if (Number.isFinite(expMs) && expMs > 0) {
      exp = fmtDate(new Date(expMs));
      remain = Math.round((expMs - Date.now()) / 86400000 * 10) / 10;
    }
  }
  return { ok: true, data: { new_token: newTok, new_expires_at: exp, remaining_days: remain } };
}

// ---------------- AES-CBC(KEY1) / AES-ECB(KEY2) 实现 ----------------
async function aesCbcEncrypt(plainBytes, keyBytes, ivBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["encrypt"]);
  const buf = await crypto.subtle.encrypt({ name: "AES-CBC", iv: ivBytes }, key, plainBytes);
  return new Uint8Array(buf);
}
async function aesCbcDecrypt(cipherBytes, keyBytes, ivBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const buf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, cipherBytes);
  return new Uint8Array(buf);
}
const AES_SBOX = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
const AES_RSBOX = [0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
const AES_RCON = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36,0x6c,0xd8,0xab,0x4d,0x9a];
function aesExpandKey(keyBytes) {
  const Nk = keyBytes.length / 4;
  const Nr = Nk + 6;
  const Nb = 4;
  const w = new Uint8Array(4 * Nb * (Nr + 1));
  w.set(keyBytes);
  let i = Nk;
  while (i < Nb * (Nr + 1)) {
    let t = w.slice((i - 1) * 4, i * 4);
    if (i % Nk === 0) {
      const tt = t[0]; t[0] = AES_SBOX[t[1]] ^ AES_RCON[i / Nk]; t[1] = AES_SBOX[t[2]]; t[2] = AES_SBOX[t[3]]; t[3] = AES_SBOX[tt];
    } else if (Nk > 6 && i % Nk === 4) {
      t[0] = AES_SBOX[t[0]]; t[1] = AES_SBOX[t[1]]; t[2] = AES_SBOX[t[2]]; t[3] = AES_SBOX[t[3]];
    }
    for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - Nk) * 4 + j] ^ t[j];
    i++;
  }
  return w;
}
function aesDecryptBlock(block, w) {
  const s = [[],[],[],[]];
  for (let i = 0; i < 16; i++) s[i%4][(i/4)|0] = block[i];
  const Nr = w.length / 16 - 1;
  const addKey = (r) => { for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) s[row][col] ^= w[r*16 + col*4 + row]; };
  addKey(Nr);
  for (let r = Nr - 1; r > 0; r--) {
    const t = [[],[],[],[]];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) t[row][col] = s[row][(col - row + 4) % 4];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) s[row][col] = t[row][col];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) s[row][col] = AES_RSBOX[s[row][col]];
    addKey(r);
    for (let col = 0; col < 4; col++) {
      const a = [s[0][col], s[1][col], s[2][col], s[3][col]];
      s[0][col] = gmul(a[0],14)^gmul(a[1],11)^gmul(a[2],13)^gmul(a[3],9);
      s[1][col] = gmul(a[0],9)^gmul(a[1],14)^gmul(a[2],11)^gmul(a[3],13);
      s[2][col] = gmul(a[0],13)^gmul(a[1],9)^gmul(a[2],14)^gmul(a[3],11);
      s[3][col] = gmul(a[0],11)^gmul(a[1],13)^gmul(a[2],9)^gmul(a[3],14);
    }
  }
  const t = [[],[],[],[]];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) t[row][col] = s[row][(col - row + 4) % 4];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) s[row][col] = t[row][col];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) s[row][col] = AES_RSBOX[s[row][col]];
  addKey(0);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = s[i%4][(i/4)|0];
  return out;
}
function gmul(a, b) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80; a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}
function aesEcbDecryptBytes(cipherBytes, keyBytes) {
  if (!cipherBytes.length || cipherBytes.length % 16 !== 0) throw new Error("AES-ECB 密文长度无效");
  if (![16, 24, 32].includes(keyBytes.length)) throw new Error("AES 密钥长度无效");
  const w = aesExpandKey(keyBytes);
  const n = cipherBytes.length / 16;
  const out = new Uint8Array(n * 16);
  for (let i = 0; i < n; i++) { const d = aesDecryptBlock(cipherBytes.slice(i*16, i*16+16), w); out.set(d, i*16); }
  return out;
}
async function aesEcbDecrypt(cipherBytes, keyBytes) { return aesEcbDecryptBytes(cipherBytes, keyBytes); }
function mergeU8(arrs) {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function pkcs7Unpad(b) {
  if (!b.length || b.length % 16 !== 0) throw new Error("PKCS#7 数据长度无效");
  const pad = b[b.length - 1];
  if (pad < 1 || pad > 16 || pad > b.length) throw new Error("PKCS#7 填充无效");
  for (let i = b.length - pad; i < b.length; i++) if (b[i] !== pad) throw new Error("PKCS#7 填充无效");
  return b.slice(0, b.length - pad);
}
function hexToBytes(hex) {
  hex = String(hex || "").trim();
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("十六进制数据无效");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function hexBytes(hex) { return hexToBytes(hex); }
function stableJsonStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(o => stableJsonStringify(o)).join(",") + "]";
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    return "{" + keys.map(k => `${JSON.stringify(k)}:${stableJsonStringify(obj[k])}`).join(",") + "}";
  }
  return JSON.stringify(obj);
}

// ---------------- 主流程 ----------------

// ---------------- 云朵真实任务引擎（2026-09 新增，已实测可用） ----------------
const UA_CLOUD = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY_HOSTS = ["https://caiyun.feixin.10086.cn:7071", "https://caiyun.feixin.10086.cn", "https://yun.139.com"];
function cyHeaders(jwt, host) {
  return { "User-Agent": UA_CLOUD, "Host": host.replace("https://", ""), "jwtToken": jwt, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" };
}
async function fetchTaskListOnce(jwt) {
  let j = null, lastErr = null;
  for (const h of CY_HOSTS) {
    try {
      const r = await fetchWithTimeout(h + "/market/signin/task/taskList?marketname=sign_in_3", { headers: cyHeaders(jwt, h), signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      j = await r.json();
      if (String(j.code) === "0") break;
      j = null;
    } catch (e) { lastErr = e; }
  }
  if (!j) throw new Error("所有主机均不可用: " + String((lastErr && lastErr.message) || "未知"));
  if (String(j.code) !== "0") throw new Error("任务列表获取失败: " + (j.msg || j.message || "未知错误"));
  const list = [];
  for (const arr of Object.values(j.result || {})) {
    if (!Array.isArray(arr)) continue;
    for (const t of arr) list.push({
      id: t.id, group: t.groupid, name: String(t.name || "").replace(/<[^>]*>/g, ""),
      reward: t.content_display2 || "", state: t.state, limit: t.limitType,
      steps: t.stepTypeSet || [], process: t.process || 0, currDay: t.currDay || 0, currstep: t.currstep || 0,
    });
  }
  return list;
}
async function fetchTaskList(jwt) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return await fetchTaskListOnce(jwt); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1200 * (i + 1))); }
  }
  throw last;
}
async function clickTask(jwt, id) {
  let txt = "", got = false, lastErr = null;
  for (const h of CY_HOSTS) {
    try {
      const r = await fetchWithTimeout(h + "/market/signin/task/click?key=task&id=" + id, { headers: cyHeaders(jwt, h), signal: AbortSignal.timeout(20000) });
      txt = await responseTextChecked(r, "点击任务"); got = true; break;
    } catch (e) { lastErr = e; }
  }
  if (!got) throw new Error("点击失败: " + String((lastErr && lastErr.message) || "未知"));
  let j = {}; try { j = JSON.parse(txt); } catch { j = { msg: txt.slice(0, 120) }; }
  return { ok: String(j.code) === "0", code: j.code, msg: j.msg || "" };
}


// ===== 云朵状态查询（轻量 API，不开浏览器）=====
const MCLOUD = "https://m.mcloud.139.com";
async function mcloudGet(jwt, path) {
  const tries = [
    { headers: { "User-Agent": MOBILE_UA_FALLBACK, "jwtToken": jwt, "Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest", "Referer": MCLOUD + "/", "Cookie": "jwtToken=" + jwt } },
    { headers: { "User-Agent": MOBILE_UA_FALLBACK, "Accept": "application/json, text/plain, */*", "Cookie": "jwtToken=" + jwt, "Referer": MCLOUD + "/" } },
  ];
  let lastErr = null;
  for (const t of tries) {
    try {
      const r = await fetchWithTimeout(MCLOUD + path, { headers: t.headers }, 20000);
      const txt = await r.text();
      let j = null; try { j = JSON.parse(txt); } catch { j = null; }
      if (j) return j;
      lastErr = new Error("非 JSON: " + txt.slice(0, 80));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("云朵状态请求失败");
}
// ===== 16号会员日（mCloudDay）=====
const MDAY = "https://m.mcloud.139.com/ycloud/mcloudday";
function mdayHeaders(jwt) {
  return { "User-Agent": UA_CLOUD, "jwtToken": jwt, "Cookie": "jwtToken=" + jwt,
           "Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest",
           "Referer": "https://m.mcloud.139.com/huiyuanri/v1/index.html?path=mCloudDay",
           "Content-Type": "application/json;charset=UTF-8" };
}
async function mdayGet(jwt, path) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchWithTimeout(MDAY + path, { headers: mdayHeaders(jwt) }, 25000);
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch { j = null; }
      if (j) return j;
      last = new Error("非JSON:" + t.slice(0, 60));
    } catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last || new Error("会员日请求失败");
}
async function mdayPost(jwt, path, body) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchWithTimeout(MDAY + path, {
        method: "POST", headers: mdayHeaders(jwt),
        body: JSON.stringify(body || {}) }, 25000);
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch { j = null; }
      if (j) return j;
      last = new Error("非JSON:" + t.slice(0, 60));
    } catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last || new Error("会员日请求失败");
}
// 活动状态
async function mdayInfo(jwt) {
  const j = await mdayGet(jwt, "/common/activityInfo?marketName=mCloudDay");
  if (String(j.code) !== "0") throw new Error("活动信息失败:" + (j.msg || j.code));
  const r = j.result || {};
  return { online: !!r.online, activityDay: !!r.activityDay, extGiftOnline: !!r.extGiftOnline,
           blindboxOnline: !!r.blindboxOnline, reservationSwitch: !!r.reservationSwitch,
           memberLevel: r.memberLevel, finalUserType: r.finalUserType, isMember: !!r.isMember,
           gotoneLevel: r.gotoneLevel, countdownMs: Number(r.countDownTimeStamp) || 0,
           raw: r };
}
// 奖品列表
async function mdayGifts(jwt, ext) {
  const j = await mdayGet(jwt, "/gift/list?client=app" + (ext ? "&type=ext" : ""));
  if (String(j.code) !== "0") throw new Error("奖品列表失败:" + (j.msg || j.code));
  const r = j.result || {};
  const arr = r.nationalPrizeList || r.prizeList || [];
  return arr.map(p => ({ prizeId: p.prizeId, name: p.prizeName, hasStock: !!p.hasStock,
                         received: !!p.receiveFlag, sort: p.sort || 0 }));
}
// 预约（必须 POST + body，GET/query 会报"不支持该预约来源"）
async function mdayReserve(jwt) {
  return await mdayPost(jwt, "/common/reservation",
    { marketName: "mCloudDay", open: true, sourceid: "1000", source: "app" });
}
// 领奖：试多个候选路径
async function mdayReceive(jwt, prizeId) {
  const paths = ["/gift/receive", "/gift/draw", "/prize/receive", "/gift/get"];
  const bodies = [
    { prizeId: String(prizeId), marketName: "mCloudDay", client: "app" },
    { prizeId: Number(prizeId), marketName: "mCloudDay" },
  ];
  const tried = [];
  for (const pth of paths) {
    for (const b of bodies) {
      try {
        const j = await mdayPost(jwt, pth, b);
        tried.push(pth + "→" + String(j.code));
        if (String(j.code) === "0") return { ok: true, path: pth, body: b, resp: j, tried };
      } catch (e) { tried.push(pth + "→ERR"); }
    }
  }
  return { ok: false, tried };
}
function fmtCountdown(ms) {
  if (!ms || ms <= 0) return "已开始";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return (d ? d + "天" : "") + h + "小时" + m + "分";
}

function numOf(v) {
  if (v === null || v === undefined) return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? null : n;
}
async function cloudStatus(jwt) {
  const out = { total: null, toReceive: null, list: [], nextMonth: 0, receivable: 0, raw: "" };
  try {
    const j1 = await mcloudGet(jwt, "/ycloud/signin/page/getCloudNum");
    out.total = numOf(j1.result !== undefined ? j1.result : (j1.data && j1.data.cloudNum));
  } catch (e) { out.errNum = String(e.message || e).slice(0, 80); }
  try {
    const j2 = await mcloudGet(jwt, "/ycloud/signin/page/infoV3?client=app");
    const res = j2.result || j2.data || {};
    out.toReceive = numOf(res.toReceive !== undefined ? res.toReceive : res.receiveNum);
    const arr = res.receiveList || res.taskList || res.list || [];
    if (Array.isArray(arr)) {
      out.list = arr.slice(0, 100).map(x => ({
        cloudType: x.cloudType, cloudNum: numOf(x.cloudNum !== undefined ? x.cloudNum : x.num),
        recordId: x.recordId !== undefined && x.recordId !== null ? x.recordId : (x.cloudId !== undefined ? x.cloudId : null),
        name: String(x.name || x.taskName || x.title || "").slice(0, 30),
        keys: Object.keys(x).slice(0, 12).join(","),
      }));
    }
    out.raw = JSON.stringify(j2).slice(0, 200);
  } catch (e) { out.errInfo = String(e.message || e).slice(0, 80); }
  for (const it of out.list) {
    if (String(it.cloudType) === "2") out.nextMonth += (it.cloudNum || 0);
    else out.receivable += (it.cloudNum || 0);
  }
  out.ok = out.total !== null || out.toReceive !== null || out.list.length > 0;
  return out;
}

// ===== 气泡领取：必须用真实浏览器（deviceId 由页面指纹动态生成）=====
const MOBILE_UA_FALLBACK = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const SIGNIN_PAGE = "https://m.mcloud.139.com/portal/mobilecloud/index.html?path=newsignin&sourceid=1427&enableShare=1#/newsignin";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
async function readCloudNum(page) {
  // ① 页面上下文里调官方接口（注意：必须用浏览器原生 fetch，Node 侧函数在页面里不存在）
  try {
    const v = await page.evaluate(async () => {
      try {
        const r = await fetch("/ycloud/signin/page/getCloudNum", { headers: { Accept: "application/json, text/plain, */*" }, credentials: "include" });
        if (!r.ok) return null;
        const j = await r.json();
        const n = (j && j.result !== undefined && j.result !== null) ? j.result : (j && j.data && j.data.cloudNum);
        return n === undefined || n === null ? null : Number(n);
      } catch (e) { return null; }
    });
    if (v !== null && v !== undefined && !isNaN(v)) return v;
  } catch (e) {}
  // ② 兜底：页面文案（云豆可能为个位数，不能限制最少 2 位）
  try {
    const t = await page.locator("body").innerText();
    const m = String(t).match(/([\d,]{1,9})\s*(?:云盘专属AI豆|云豆|AI豆)/);
    if (m) { const n = parseInt(String(m[1]).replace(/,/g, ""), 10); return isNaN(n) ? null : n; }
  } catch (e) {}
  return null;
}
// 云豆读取的统一入口：页面读不到时直接用 API，避免误判为"页面未加载"
async function readCloudNumSafe(page, jwt) {
  let v = await readCloudNum(page);
  if (v !== null) return { v, src: "page" };
  if (jwt) {
    try {
      const st = await cloudStatus(jwt);
      if (st && st.total !== null && st.total !== undefined) return { v: st.total, src: "api" };
    } catch (e) {}
  }
  return { v: null, src: "none" };
}
async function diagPage(page) {
  try {
    const u = page.url();
    const t = String(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 260);
    const all = await page.locator(".AIPoints").count();
    const ok2 = await page.locator(".AIPoints:not(.is-next-month)").count();
    return { url: u.slice(0, 160), text: t, all: all, clickable: ok2 };
  } catch (e) { return { url: "", text: "诊断失败: " + String(e.message || e).slice(0, 80), all: -1, clickable: -1 }; }
}

// ===== API 直连领取（cloudType=3 的大额任务奖励实测可领，浏览器点击反而触发不了）=====
async function postReceiveV3(jwt, body) {
  const r = await fetchWithTimeout(MCLOUD + "/ycloud/signin/page/receiveV3", {
    method: "POST",
    headers: { ...{ "User-Agent": MOBILE_UA_FALLBACK, "jwtToken": jwt, "Accept": "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest", "Referer": MCLOUD + "/", "Cookie": "jwtToken=" + jwt },
      "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 20000);
  const t = await r.text();
  let j = {}; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 120) }; }
  return j;
}
// 遍历待领清单逐个领取；cloudId 必须是数字，cloudType 必须用清单里的原值
async function receiveViaApi(jwt, list) {
  const steps = [];
  let got = 0;
  const details = [];
  for (const it of list || []) {
    const rawId = it.recordId !== undefined && it.recordId !== null ? it.recordId : it.cloudId;
    const cloudId = Number(rawId);
    const ct = Number(it.cloudType);
    const num = Number(it.cloudNum !== undefined ? it.cloudNum : (it.num || 0)) || 0;
    if (!cloudId || isNaN(cloudId)) {
      steps.push("⚠ 清单项缺 recordId/cloudId，无法 API 领取（字段:" + Object.keys(it || {}).join(",") + " 内容:" + JSON.stringify(it).slice(0, 120) + "）");
      continue;
    }
    let j = null;
    try { j = await postReceiveV3(jwt, { client: "app", cloudId, cloudType: ct }); }
    catch (e) { steps.push("cloudId=" + cloudId + " 请求异常: " + String(e.message).slice(0, 60)); continue; }
    const code = String(j.code);
    const recv = j.result && (j.result.receive !== undefined ? j.result.receive : j.result.receiveNum);
    details.push({ cloudId, cloudType: ct, code, receive: recv });
    if (code === "0" && Number(recv) > 0) {
      got += Number(recv);
      steps.push("✅ API 领取 +" + recv + "（cloudId=" + cloudId + " type=" + ct + " 标称" + num + "）");
    } else {
      steps.push("✗ cloudId=" + cloudId + " type=" + ct + " code=" + code + " msg=" + (j.msg || "") + (recv !== undefined ? " receive=" + recv : ""));
    }
    await sleep(1200);
  }
  return { got, steps, details };
}

async function receiveBubbles(authorization, phone, dev) {
  const steps = [];
  dev = dev || {};
  let jwt;
  try { jwt = await getJwt(authorization, phone); }
  catch (e) { return { ok: false, error: "令牌失效或鉴权失败: " + String(e.message || e).slice(0, 80), got: 0, steps }; }
  // 先尝试 API 直连领取（大额任务奖励这条路实测可行且不需要浏览器）
  let before = null, after = null, got = 0;
  try {
    const st0 = await cloudStatus(jwt);
    before = st0.total;
    if (st0.list && st0.list.length) {
      const ra = await receiveViaApi(jwt, st0.list);
      got += ra.got;
      for (const x of ra.steps) steps.push("[API] " + x);
      const st1 = await cloudStatus(jwt);
      after = st1.total;
      if (after !== null && before !== null && after > before) got = Math.max(got, after - before);
      if (got > 0) {
        steps.push("API 领取完成: " + before + " → " + after + "（+" + got + "）");
        return { ok: true, before, after, got, via: "api", steps };
      }
      steps.push("API 未领到（可能无可领或被风控），回退浏览器点击…");
    }
  } catch (e) {
    steps.push("API 领取异常，回退浏览器: " + String(e.message || e).slice(0, 80));
  }
  let chromium = null;
  try { const pw = require("playwright"); chromium = pw.chromium; }
  catch (e) {
    // 区分「确实没有可领」和「真的失败」：无可领时 got=0 且余额没变，属正常情况
    const noPending = (before !== null && before === after) && got === 0;
    return {
      ok: noPending,
      error: noPending ? "当前无可领气泡（余额 " + before + "，无需处理）" : "playwright 未安装且 API 未领到",
      got, before, after, steps,
    };
  }
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
  // 页面需要 token 参数才进入已登录态（用户原始链接里带 token=…）
  let pageUrl = SIGNIN_PAGE;
  try {
    const sso = await getSsoToken(authorization, phone);
    if (sso) pageUrl = SIGNIN_PAGE.replace("#/newsignin", "&token=" + encodeURIComponent(sso) + "#/newsignin");
    steps.push("页面 token: " + (sso ? "已获取" : "未获取"));
  } catch (e) { steps.push("页面 token 获取失败: " + String(e.message || e).slice(0, 60)); }
  try {
    const ctx = await browser.newContext({
      userAgent: MOBILE_UA, viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      locale: "zh-CN", timezoneId: "Asia/Shanghai",
    });
    const cookies = [
      { name: "jwtToken", value: jwt, domain: "m.mcloud.139.com", path: "/" },
      { name: "NATION_CODE", value: "86", domain: "m.mcloud.139.com", path: "/" },
      { name: "platform", value: "2", domain: "m.mcloud.139.com", path: "/" },
    ];
    // 设备标识仅在该账号自己提供时才携带，避免多账号共用同一设备ID触发风控
    if (dev.ud_id) cookies.push({ name: "ud_id", value: String(dev.ud_id), domain: "m.mcloud.139.com", path: "/" });
    if (dev.a_k) cookies.push({ name: "a_k", value: String(dev.a_k), domain: "m.mcloud.139.com", path: "/" });
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    const recv = [];
    page.on("response", async (r) => {
      if (/receiveV3/.test(r.url())) {
        let b = ""; try { b = (await r.text()).slice(0, 150); } catch (e) {}
        recv.push(b);
      }
    });
    // 页面加载偶发超时（GitHub Actions 到 m.mcloud.139.com 网络抖动）：
    // 重试 3 次；全部失败不再抛异常，改用 API 复核是否真有可领，
    // 避免把"页面打不开但其实没气泡可领"误报成异常。
    let gotoOk = false, gotoErr = "";
    for (let gt = 0; gt < 3 && !gotoOk; gt++) {
      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        gotoOk = true;
      } catch (e) {
        gotoErr = String(e.message || e).slice(0, 90);
        steps.push("页面加载第 " + (gt + 1) + " 次超时，重试…");
        await sleep(3000);
      }
    }
    if (!gotoOk) {
      steps.push("页面加载失败: " + gotoErr);
      try {
        const stF = await cloudStatus(jwt);
        const pendF = (stF.list || []).filter(x => x && x.cloudType === 0 && x.recordId).length;
        steps.push("API 复核：云豆 " + stF.total + " / 可领 " + (stF.receivable || 0) + " / 待领项 " + pendF);
        if (!pendF) {
          return { ok: true, before: stF.total, after: stF.total, got: 0, via: "api-fallback",
                   error: "页面加载超时，但 API 复核无可领气泡（无需处理）", steps };
        }
      } catch (e) { steps.push("API 复核失败: " + String(e.message || e).slice(0, 60)); }
      return { ok: false, before, after, got: 0, error: "页面加载超时(已重试3次): " + gotoErr, steps };
    }
    await sleep(11000);
    let rb0 = await readCloudNumSafe(page, jwt);
    before = rb0.v;
    if (before === null) {
      // 首次未渲染出来，重载一次再试（偶发白屏/接口慢）
      steps.push("首次未读到云豆，重载页面重试…");
      try { await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }); } catch (e) {}
      await sleep(9000);
      rb0 = await readCloudNumSafe(page, jwt);
      before = rb0.v;
    }
    if (before !== null) steps.push("云豆来源: " + rb0.src);
    steps.push("初始云豆 " + before);
    if (before === null) {
      const d = await diagPage(page);
      steps.push("⚠ 页面未读到云豆，诊断：URL=" + d.url);
      steps.push("   页面文本: " + d.text);
      steps.push("   气泡元素: 共 " + d.all + " 个，可点击 " + d.clickable + " 个");
      // 可能是登录态失效，尝试用 API 直接读取一次确认
      try {
        const st = await cloudStatus(jwt);
        steps.push("   API 云豆: " + st.total + " / 可领 " + st.receivable + " / 下月 " + st.nextMonth);
      } catch (e) { steps.push("   API 读取失败: " + String(e.message || e).slice(0, 60)); }
    }
    // ★ 领取逻辑采用 diag 实测通过的方案：
    //   1) 遍历全部 .AIPoints（含下月的），逐个按下标点击，跳过 is-next-month
    //   2) 必须先 scrollIntoView，再派发 pointerdown/pointerup/click 坐标级事件序列
    //   3) 每步之后等待 6 秒（3.8 秒实测不够，接口还没返回就读了余额）
    let eligible = false;
    const totalBubbles = await page.evaluate(() => document.querySelectorAll(".AIPoints").length);
    steps.push("页面气泡总数 " + totalBubbles);
    for (let idx = 0; idx < Math.min(totalBubbles, 12); idx++) {
      const isNextMonth = await page.evaluate((k) => {
        const el = document.querySelectorAll(".AIPoints")[k];
        return !el ? "gone" : (/is-next-month/.test(el.className || "") ? "next" : "ok");
      }, idx);
      if (isNextMonth === "gone") continue;
      if (isNextMonth === "next") { steps.push("气泡#" + (idx + 1) + " 是下月的，跳过"); continue; }
      eligible = true;
      const b0 = (await readCloudNumSafe(page, jwt)).v;
      const res = await page.evaluate((k) => {
        const el = document.querySelectorAll(".AIPoints")[k];
        if (!el) return "no-el";
        el.scrollIntoView({ block: "center" });
        const rc = el.getBoundingClientRect();
        const cx = rc.x + rc.width / 2, cy = rc.y + rc.height / 2;
        const fire = (type) => {
          el.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, clientX: cx, clientY: cy,
            pointerType: "touch", isPrimary: true,
          }));
        };
        fire("pointerdown"); fire("pointerup"); fire("click");
        el.click();
        const inner = el.querySelector("div,span,img");
        if (inner) inner.click();
        return "ok";
      }, idx);
      await sleep(6000);
      const b1 = (await readCloudNumSafe(page, jwt)).v;
      const delta = (b0 !== null && b1 !== null) ? (b1 - b0) : 0;
      if (delta > 0) { got += delta; steps.push("气泡#" + (idx + 1) + " 领取 +" + delta + "（" + b0 + "→" + b1 + "）"); }
      else { steps.push("气泡#" + (idx + 1) + " " + res + " 无变化（" + b0 + "→" + b1 + "）"); }
    }
    after = (await readCloudNumSafe(page, jwt)).v;

    // ── 领完复检：API 还有可领就继续领，直到清零或连续无进展 ──
    // 这是"确保领干净"的关键：不是点一轮就结束，而是反复核对到可领=0
    for (let qa = 0; qa < 4; qa++) {
      let stQ = null;
      try { stQ = await cloudStatus(jwt); } catch (e) { break; }
      const pend = (stQ.list || []).filter(x => x && x.cloudType === 0 && x.recordId);
      steps.push("复检#" + (qa + 1) + ": API可领 " + (stQ.receivable || 0) + "，待领项 " + pend.length);
      if (!pend.length) { steps.push("✅ 可领已清零"); break; }

      // 先试 API（大额/部分类型这条路可行）
      let moved = false;
      try {
        const rq = await receiveViaApi(jwt, pend);
        if (rq.got > 0) { got += rq.got; moved = true; steps.push("  复检API +" + rq.got); }
        for (const x of rq.steps) steps.push("    " + x);
      } catch (e) { steps.push("  复检API异常: " + String(e.message || e).slice(0, 50)); }

      // API 没领到就回退页面点击（页面元素每次重新枚举，因为 DOM 会刷新）
      if (!moved) {
        const nNow = await page.evaluate(() => document.querySelectorAll(".AIPoints").length);
        for (let idx = 0; idx < Math.min(nNow, 12); idx++) {
          const isNext = await page.evaluate((k) => {
            const el = document.querySelectorAll(".AIPoints")[k];
            return !el ? "gone" : (/is-next-month/.test(el.className || "") ? "next" : "ok");
          }, idx);
          if (isNext !== "ok") continue;
          const b0 = (await readCloudNumSafe(page, jwt)).v;
          await page.evaluate((k) => {
            const el = document.querySelectorAll(".AIPoints")[k];
            if (!el) return;
            el.scrollIntoView({ block: "center" });
            const rc = el.getBoundingClientRect();
            const cx = rc.x + rc.width / 2, cy = rc.y + rc.height / 2;
            const fire = (t) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerType: "touch", isPrimary: true }));
            fire("pointerdown"); fire("pointerup"); fire("click"); el.click();
            const inner = el.querySelector("div,span,img");
            if (inner) inner.click();
          }, idx);
          await sleep(6000);
          const b1 = (await readCloudNumSafe(page, jwt)).v;
          const d = (b0 !== null && b1 !== null) ? (b1 - b0) : 0;
          if (d > 0) { got += d; moved = true; steps.push("  复检点击#" + (idx + 1) + " +" + d + "（" + b0 + "→" + b1 + "）"); }
        }
      }
      if (!moved) { steps.push("⚠ 复检发现仍有可领，但本轮未领到（可能需真机环境）"); break; }
      await sleep(2500);
    }
    after = (await readCloudNumSafe(page, jwt)).v;
    steps.push("最终云豆 " + after);
    if (before === null && after === null) {
      return { ok: false, error: "页面未加载出云豆数据（登录态失效或页面改版）", got: 0, steps };
    }
    // 页面读不到初始值时以 API 值为准，避免把"可领取"误判成失败
    if (before === null && after !== null) before = after;
    if (before !== null && after !== null && after > before && got === 0) got = after - before;
    if (eligible && got === 0 && before !== null && after !== null && after <= before) {
      return { ok: false, before, after, got: 0, error: "检测到可领取气泡，但点击后云豆未增加", recv: recv.slice(0, 6), steps };
    }
    return { ok: true, before, after, got, recv: recv.slice(0, 6), steps };
  } finally {
    try { await browser.close(); } catch (e) {}
  }
}

async function main() {
  const type = String(process.env.EVENT_TYPE || "").trim();
  let payload = {};
  try { payload = JSON.parse(process.env.PAYLOAD || "{}"); } catch { throw new Error("PAYLOAD 不是合法 JSON"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("PAYLOAD 必须是 JSON 对象");
  const dataKey = process.env.PANEL_DATA_KEY || "";
  const allowedTypes = new Set(["send_code","do_login","sync","sign","refresh","task","status","receive","list","srefresh","rtask","daily","probe16","mday16","diag","verify"]);
  if (!allowedTypes.has(type)) throw new Error("未知命令: " + type);
  const key = dataKey ? await deriveKey(dataKey) : null;

  const requestId = String(payload.requestId || `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`).slice(0, 100);
  let out = { ts: nowStr(), requestId, type, ok: false, msg: "" };

  function normalizeAccounts(arr) {
    if (!Array.isArray(arr)) throw new Error("账号列表格式错误");
    const seen = new Set();
    return arr.map((a, i) => {
      if (!a || typeof a !== "object") throw new Error(`第 ${i + 1} 个账号格式错误`);
      const phone = String(a.phone || "").trim();
      const authorization = String(a.authorization || "").trim();
      if (!/^\d{6,15}$/.test(phone)) throw new Error(`第 ${i + 1} 个账号手机号格式错误`);
      decodeAuth(authorization);
      if (seen.has(phone)) throw new Error(`账号重复: ${maskPhone(phone)}`);
      seen.add(phone);
      return { ...a, phone, authorization };
    });
  }
  async function decryptAccounts() {
    if (!key || !payload.cipher) throw new Error("缺少加密数据或密钥");
    if (typeof payload.cipher !== "string" || payload.cipher.length > 2_000_000) throw new Error("加密账号数据过大或格式错误");
    const plain = await aesGcmDecryptText(key, payload.cipher);
    const arr = JSON.parse(plain);
    return normalizeAccounts(arr);
  }
  // ---- 账号仓库文件：data/accounts.enc（用 DATA_KEY 加密，续期后自动回写，供定时任务使用）----
  const STORE_PATH = path.join(__dirname, "../data/accounts.enc");
  let saveStoreErr = "";
  async function loadStore() {
    if (!key) return null;
    try {
      const b = fs.readFileSync(STORE_PATH, "utf8").trim();
      if (!b) return null;
      const arr = JSON.parse(await aesGcmDecryptText(key, b));
      if (!Array.isArray(arr)) throw new Error("账号仓库不是数组");
      return arr.length ? arr : null;
    } catch (e) {
      saveStoreErr = "读取账号仓库失败: " + String(e.message || e);
      return null;
    }
  }
  async function saveStore(list) {
    try {
      if (!key) throw new Error("未配置 PANEL_DATA_KEY");
      const payloadStr = await aesGcmEncryptText(key, JSON.stringify(normalizeAccounts(list)));
      const tmp = path.join(__dirname, "../data/accounts.enc.tmp");
      fs.writeFileSync(tmp, payloadStr, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tmp, STORE_PATH);
      return true;
    } catch (e) {
      try { fs.unlinkSync(path.join(__dirname, "../data/accounts.enc.tmp")); } catch {}
      saveStoreErr = String(e.message || e); return false;
    }
  }
  // 统一解析账号来源：前端 cipher > 仓库文件 > Secret 兜底
  async function resolveAccounts() {
    const diag = [];
    try { const l = await decryptAccounts(); if (l.length) { diag.push("cipher:" + l.length); return { list: l, trusted: true, diag }; } }
    catch (e) { diag.push("cipher失败:" + String(e.message || e).slice(0, 60)); }
    const st = await loadStore();
    if (st) { diag.push("store:" + st.length); return { list: st, trusted: true, diag }; }
    diag.push("store失败:" + (saveStoreErr || "空"));
    const c = await pickCreds();
    diag.push("secret兜底:" + String(c.phone).slice(0, 3) + "****" + String(c.phone).slice(-4));
    return { list: [c], trusted: false, diag };
  }

  // 定时运行时没有前端 cipher，回退读仓库 Secret
  async function pickCreds() {
    // 优先用面板/仓库的账号文件；Secret 仅作最后兜底（旧令牌常已作废，优先用会导致鉴权失败）
    try {
      const accounts = await decryptAccounts();
      if (accounts.length) return { authorization: accounts[0].authorization, phone: accounts[0].phone };
    } catch (e) {}
    const st = await loadStore();
    if (st && st.length) return { authorization: st[0].authorization, phone: st[0].phone };
    const ea = process.env.YUN139_AUTHORIZATION, ep = process.env.YUN139_PHONE;
    if (ea && ep) return { authorization: ea, phone: ep };
    throw new Error("无可用的账号令牌");
  }

  try {
    if (type === "send_code") {
      const phone = String(payload.phone || "").trim();
      if (!/^1\d{10}$/.test(phone)) throw new Error("手机号格式错误");
      const j = await sendSmsCodeByScene(phone);
      out.phone = phone;
      out.msg = j.summary || j.message || j.msg || String(j.code ?? "unknown");
      out.ok = String(j.code) === "0" || String(j.code).toLowerCase() === "success" || j.success === true;
      if (!out.ok) out.msg = `发送验证码失败: ${out.msg}`;
    } else if (type === "do_login") {
      const phone = String(payload.phone || "").trim();
      const code = String(payload.code || "").trim();
      if (!/^1\d{10}$/.test(phone)) throw new Error("手机号格式错误");
      if (!/^\d{4,8}$/.test(code)) throw new Error("验证码格式错误");
      if (!key) throw new Error("未配置 PANEL_DATA_KEY, 无法回传新令牌");
      const authorization = await loginBySms(phone, code);
      const accounts = await decryptAccounts();
      const dec = decodeAuth(authorization);
      const strs = dec.token.split("|");
      const expMs = strs.length >= 4 ? parseInt(strs[3], 10) : 0;
      const expValid = Number.isFinite(expMs) && expMs > 0;
      const newAcc = {
        id: String(Date.now() % 1000000),
        name: payload.name || `139-${phone.slice(-4)}`,
        phone,
        authorization,
        expires_at: expValid ? fmtDate(new Date(expMs)) : "",
        remaining_days: expValid ? Math.round((expMs - Date.now()) / 86400000 * 10) / 10 : null,
        created_at: nowStr(),
      };
      const existing = accounts.findIndex(a => String(a.phone) === phone);
      if (existing >= 0) accounts[existing] = newAcc; else accounts.push(newAcc);
      out.enc_accounts = await aesGcmEncryptText(key, JSON.stringify(accounts));
      out.phone = phone;
      out.msg = "登录成功, 已抓取令牌";
      out.ok = true;
    } else if (type === "sync") {
      // 前端把当前账号列表同步到仓库文件（供定时任务使用）
      if (!key) throw new Error("未配置 PANEL_DATA_KEY（仓库 Secret 缺失）");
      let accounts;
      try {
        accounts = await decryptAccounts();
      } catch (e) {
        // 最常见原因：浏览器里的 DATA_KEY 与仓库 Secret PANEL_DATA_KEY 不一致
        throw new Error("解密账号失败：" + String(e.message || e) + "。请确认 ⚙ 高级配置的 DATA_KEY 与仓库 Secret PANEL_DATA_KEY 完全一致");
      }
      if (!accounts.length) throw new Error("账号列表为空");
      const okw = await saveStore(accounts);
      out.ok = okw;
      out.msg = okw ? ("已同步 " + accounts.length + " 个账号到仓库（定时任务将使用）") : ("写入仓库文件失败: " + saveStoreErr);
      out.synced = accounts.length;
    } else if (type === "sign" || type === "refresh") {
      const ra = await resolveAccounts();
      const accounts = ra.list;
      const results = [];
      const updated = [];
      for (let ai = 0; ai < accounts.length; ai++) {
        const a = accounts[ai];
        if (ai > 0) await new Promise(r => setTimeout(r, 3500));
        const phone = a.phone;
        const row = { phone, masked: maskPhone(phone), name: a.name || "" };
        try {
          if (type === "sign") {
            const r = await signOne(a.authorization, phone, a);
            row.ok = r.ok; row.message = r.message;
          } else {
            const r = await refreshToken(phone, decodeAuth(a.authorization).token);
            if (r.ok) {
              const newAuth = base64Utf8Encode(`${decodeAuth(a.authorization).prefix}:${phone}:${r.data.new_token}`);
              a.authorization = newAuth; a.expires_at = r.data.new_expires_at; a.remaining_days = r.data.remaining_days; a.last_refresh = nowStr();
              row.ok = true; row.message = `续期成功, 剩余 ${r.data.remaining_days} 天`;
            } else { row.ok = false; row.message = r.error; }
          }
        } catch (e) { row.ok = false; row.message = String(e.message || e).slice(0, 200); }
        results.push(row);
        updated.push(a);
      }
      out.results = results;
       if (key) out.enc_accounts = await aesGcmEncryptText(key, JSON.stringify(updated));
       if (ra.trusted) await saveStore(updated);   // 续期后回写仓库
      out.msg = type === "sign" ? "签到完成" : "续期完成";
      out.ok = results.some(r => r.ok);
    } else if (type === "task") {
      const ra = await resolveAccounts();
      const accounts = ra.list;
      const wanted = Array.isArray(payload.tasks) && payload.tasks.length ? payload.tasks.slice(0, 100).map(x => String(x).slice(0, 80)) : ["sign"];
      const results = [];
      for (let ai = 0; ai < accounts.length; ai++) {
        const a = accounts[ai];
        if (ai > 0) await new Promise(r => setTimeout(r, 3500));
        const phone = a.phone;
        for (const t of wanted) {
          const row = { phone, masked: maskPhone(phone), name: a.name || "", task: t };
          try {
            if (t === "sign") {
              const r = await signOne(a.authorization, phone, a);
              row.ok = r.ok;
              row.message = `每日签到: ${r.message}`;
            } else if (t === "backup") {
              row.ok = false; row.message = "云盘备份需在 App 内主动开启，接口无法代开";
            } else if (t === "notify31") {
              row.ok = false; row.message = "连续 31 天通知属长期行为任务，需日常保持，无法单次接口完成";
            } else if (t === "upload100") {
              row.ok = false; row.message = "传满 100 个文件为累计任务，需 App 内持续上传";
            } else if (t === "manual_upload") {
              row.ok = false; row.message = "手动上传需 App 内真实操作，暂未接入自动执行";
            } else if (t === "ai_camera") {
              row.ok = false; row.message = "AI 相机需打开 App 功能操作，暂未接入自动执行";
            } else if (t === "ai_chat") {
              row.ok = false; row.message = "AI 对话需 App 内交互完成，暂未接入自动执行";
            } else if (t === "lib_read") {
              row.ok = false; row.message = "图书馆阅读需 App 内完成阅读行为，暂未接入自动执行";
            } else {
              row.ok = false; row.message = "未知任务: " + t;
            }
          } catch (e) {
            row.ok = false;
            row.message = String(e.message || e).slice(0, 200);
          }
          results.push(row);
          await new Promise(r => setTimeout(r, 150));
        }
      }
      out.results = results;
      out.msg = "云朵任务执行完成";
      out.ok = results.some(r => r.ok);
    } else if (type === "status") {
      const ra = await resolveAccounts();
      const accounts = ra.list;
      out.acctDiag = ra.diag;
      const rows = [];
      for (let ai = 0; ai < accounts.length; ai++) {
        const a = accounts[ai];
        if (ai > 0) await new Promise(r => setTimeout(r, 3500));
        const row = { phone: a.phone, masked: maskPhone(a.phone) };
        try {
          const auth = await ensureAuth(a);
          if (a.auto_refreshed) { row.refreshed = true; a.auto_refreshed = false; }
          const jwt = await getJwt(auth, a.phone);
          const st = await cloudStatus(jwt);
          row.ok = !!st.ok;
          row.total = st.total;
          row.toReceive = st.toReceive;
          row.receivable = st.receivable;
          row.nextMonth = st.nextMonth;
          row.list = st.list;
          if (st.errNum || st.errInfo) row.warn = (st.errNum || "") + " " + (st.errInfo || "");
          if (st.raw) row.raw = st.raw;
        } catch (e) { row.ok = false; row.message = String(e.message || e).slice(0, 120); }
        rows.push(row);
        await new Promise(r => setTimeout(r, 400));
      }
      out.status = rows;
      out.ok = rows.some(r => r.ok);
      out.msg = "已查询 " + rows.length + " 个账号";
      // 仅当账号来自前端加密数据才回写，避免用 Secret 兜底的单个号覆盖用户全部账号
      if (key && ra.trusted) out.enc_accounts = await aesGcmEncryptText(key, JSON.stringify(accounts));
      if (ra.trusted) await saveStore(accounts);
    } else if (type === "receive") {
      const ra2 = await resolveAccounts();
      const accounts = ra2.list;
      const only = String(payload.phone || "").trim();
      const targets = only ? accounts.filter(a => String(a.phone) === only) : accounts;
      if (!targets.length) throw new Error("未找到目标账号");
      const rows = [];
      for (const a of targets) {
        let rb;
        try {
          const auth = await ensureAuth(a);
          rb = await receiveBubbles(auth, a.phone, { ud_id: a.ud_id, a_k: a.a_k });
        } catch (e) {
          rb = { ok: false, error: String(e.message || e).slice(0, 120), got: 0, steps: ["异常中断"] };
        }
        rows.push({ phone: a.phone, masked: maskPhone(a.phone), ok: !!rb.ok,
          before: rb.before, after: rb.after, got: rb.got, steps: rb.steps,
          error: rb.error || (rb.ok ? "" : "未知") });
        await new Promise(r => setTimeout(r, 1500));
      }
      // 令牌失效的账号在结果中明确标注，方便前端提示用户重新粘贴
      out.badAccounts = rows.filter(r => !r.ok && /令牌|鉴权|失效/.test(String(r.error || ""))).map(r => r.masked || r.phone);
      if (key && ra2.trusted) out.enc_accounts = await aesGcmEncryptText(key, JSON.stringify(accounts));
      if (ra2.trusted) await saveStore(accounts);
      out.receiveList = rows;
      out.receive = rows.length === 1 ? rows[0] : null;
      out.ok = rows.some(r => r.ok);
      out.msg = rows.map(r => r.masked + " " + (r.ok ? (r.before + "→" + r.after + " +" + r.got) : ("失败:" + r.error))).join("；");
    } else if (type === "list") {
      const ra = await resolveAccounts();
      out.acctDiag = ra.diag;
      const c = ra.list[0] || await pickCreds();
      out.phone = c.phone;
      out.masked = maskPhone(c.phone);
      const jwt = await getJwt(c.authorization, c.phone);
      out.tasks = await fetchTaskList(jwt);
      out.msg = "已获取 " + out.tasks.length + " 个真实任务（" + maskPhone(c.phone) + "）";
      out.ok = true;
    } else if (type === "mday16" || type === "probe16") {
      // ── 16号会员日（星动日）：资格查询 / 自动抢奖品 ──
      const mode = String(payload.mode || (type === "probe16" ? "query" : "grab")).trim();
      const MAX_WAIT_MS = Number(payload.maxWaitSec || 3300) * 1000;   // 最多轮询多久
      const POLL_MS = Number(payload.pollSec || 8) * 1000;
      const M = "https://m.mcloud.139.com/ycloud/mcloudday";
      // 优先目标（默认星巴克）：排到最前、加强重试、开闸前抢跑
      const PRIORITY = String(payload.priority || "星巴克").trim();
      const GRAB_ROUNDS = Number(payload.grabRounds || 8);            // 优先奖品重试轮数
      const FAST_LANE_MS = Number(payload.fastLaneMs || 180000);      // 开闸前多久开始抢跑探测

      const ra = await resolveAccounts();
      out.acctDiag = ra.diag;
      out.mode = mode;
      const accounts = ra.list;
      const results = [];
      let anyGot = false;

      for (const acct of accounts) {
        const it = { phone: acct.phone, masked: maskPhone(acct.phone) };
        try {
          let jwt = "";
          try { jwt = await getJwt(acct.authorization, acct.phone); }
          catch (e) { it.err = "jwt失败:" + String(e.message || e).slice(0, 70); results.push(it); continue; }

          const H = {
            "User-Agent": UA_CLOUD, "jwtToken": jwt, "Cookie": "jwtToken=" + jwt,
            "Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://m.mcloud.139.com/huiyuanri/v1/index.html?path=mCloudDay",
            "Content-Type": "application/json;charset=UTF-8",
          };
          if (acct.ud_id) H["deviceId"] = acct.ud_id;

          async function api(path, body) {
            const opt = { headers: H };
            if (body !== undefined) { opt.method = "POST"; opt.body = JSON.stringify(body); }
            const r = await fetchWithTimeout(M + path, opt, 30000);
            const t = await r.text();
            let j = null; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 150) }; }
            return j || {};
          }

          // 1) 资格 / 状态
          const info = await api("/common/activityInfo?marketName=mCloudDay");
          const R = info.result || {};
          it.memberLevel = R.memberLevel;
          it.isMember = R.isMember;
          it.online = R.online;
          it.activityDay = R.activityDay;
          it.countdownMs = R.countDownTimeStamp;
          try {
            const ml = await fetchWithTimeout(
              "https://m.mcloud.139.com/ycloud/caiyun-service/isbo/openApi/queryMemberLevel?marketName=mCloudDay",
              { headers: H }, 30000);
            const mj = await ml.json().catch(() => ({}));
            it.memberDesc = (mj.result || {}).desc || "";
          } catch (e) {}

          if (R.isMember === false) {
            it.result = "非会员，无资格参加会员日";
            results.push(it); continue;
          }

          if (mode === "query") {
            // 只读：清单 + 预约尝试
            const gl = await api("/gift/list");
            const gr = gl.result || {};
            const all = [].concat(gr.nationalPrizeList || [], gr.provPrizeList || [], gr.extGiftList || []);
            it.prizeCount = all.length;
            it.prizes = all.slice(0, 20).map(x => ({ id: x.prizeId, name: x.prizeName, stock: x.hasStock, got: x.receiveFlag }));
            try {
              // 注意：必须 POST + body 传参；用 URL query 会返回 500「不支持该预约来源」
              const rv = await fetchWithTimeout(M + "/common/reservation",
                { method: "POST", headers: H,
                  body: JSON.stringify({ marketName: "mCloudDay", open: true, sourceid: "1000", source: "app" }) }, 30000);
              const rj = await rv.json().catch(() => ({}));
              it.reservation = (String(rj.code) === "0") ? "预约成功" : (rj.msg || ("code=" + rj.code));
            } catch (e) { it.reservation = "异常:" + String(e.message || e).slice(0, 50); }
            results.push(it);
            continue;
          }

          // 2) grab 模式：先预约（成功与否都继续，预约不是抢购前置条件）
          try {
            const rv0 = await fetchWithTimeout(M + "/common/reservation",
              { method: "POST", headers: H,
                body: JSON.stringify({ marketName: "mCloudDay", open: true, sourceid: "1000", source: "app" }) }, 30000);
            const rj0 = await rv0.json().catch(() => ({}));
            it.reservation = (String(rj0.code) === "0") ? "预约成功" : (rj0.msg || ("code=" + rj0.code));
          } catch (e) { it.reservation = "预约异常:" + String(e.message || e).slice(0, 50); }

          // 先取一次清单，锁定优先奖品的 prizeId（后面轮询要用）
          let PRIO_ID = "";
          try {
            const g0 = await api("/gift/list");
            const r0 = g0.result || {};
            const a0 = [].concat(r0.nationalPrizeList || [], r0.provPrizeList || [], r0.extGiftList || []);
            const hit = a0.find(x => x && PRIORITY && String(x.prizeName || "").includes(PRIORITY));
            if (hit) PRIO_ID = hit.prizeId;
            it.priority = PRIORITY;
            it.prioId = PRIO_ID || "清单中未找到";
          } catch (e) { it.prioId = "取清单失败:" + String(e.message || e).slice(0, 40); }

          // 轮询等开闸
          let open = !!(R.online && R.activityDay);
          let fastGot = false;
          if (!open) {
            const t0 = Date.now();
            // 智能前置休眠：倒计时还远就先粗睡，临近开闸再密集轮询（避免请求过多被限流）
            const cd = Number(R.countDownTimeStamp || 0);
            // ★ 不能一次性粗睡到开闸前：coarseSleep 被 MAX_WAIT_MS 截断后会睡过头，
            //   醒来时 Date.now()-t0 已 >= MAX_WAIT_MS，while 循环一次都不执行，直接判超时。
            //   改为分段短睡（每段 ≤10 分钟），睡醒就检查，把控制权交给下面的 while 轮询。
            if (cd > 300000) {
              const SEG = 600000;   // 每段最多睡 10 分钟
              let slept = 0;
              while (slept < MAX_WAIT_MS - 60000) {
                const left = cd - slept - 240000;
                if (left <= 1000) break;                 // 已接近开闸，交给 while 密集轮询
                const seg = Math.min(SEG, left, MAX_WAIT_MS - 60000 - slept);
                if (seg <= 1000) break;
                await new Promise(r => setTimeout(r, seg));
                slept += seg;
                // 睡醒先探一次，已开闸就直接跳出
                const pk = await api("/common/activityInfo?marketName=mCloudDay").catch(() => ({}));
                const pkR = pk.result || {};
                if (pkR.online && pkR.activityDay) break;
              }
              it.coarseSleepSec = Math.round(slept / 1000);
            }
            const FAST_MS = Number(payload.fastPollSec || 5) * 1000;
            let waited = Math.round((Date.now() - t0) / 1000);
            let checked = 0;
            while (Date.now() - t0 < MAX_WAIT_MS) {
              const i2 = await api("/common/activityInfo?marketName=mCloudDay").catch(() => ({}));
              checked++;
              const R2 = i2.result || {};
              if (R2.online && R2.activityDay) {
                open = true; it.waitedSec = waited; it.checked = checked;
                it.online = R2.online; it.activityDay = R2.activityDay;
                break;
              }
              // 快车道：临近开闸时直接探测优先奖品，verify 一放行就立刻领取
              // （比等 online 标志更快，服务端有时先放行 verify）
              if (PRIO_ID && !fastGot && (R2.countDownTimeStamp || 0) < FAST_LANE_MS) {
                const vf = await api("/gift/verify", { prizeId: PRIO_ID }).catch(() => ({}));
                it.fastLaneTries = (it.fastLaneTries || 0) + 1;
                if (String(vf.code) === "0") {
                  const rc = await api("/gift/receive", { prizeId: PRIO_ID }).catch(() => ({}));
                  it.fastLaneCode = rc.code; it.fastLaneMsg = rc.msg || "";
                  if (String(rc.code) === "0") {
                    fastGot = true; open = true; it.waitedSec = waited; it.checked = checked;
                    it.fastLane = "快车道抢到（verify 放行即领）";
                    it.got = [PRIORITY]; it.fastGot = true;
                    break;
                  }
                }
              }
              if ((R2.countDownTimeStamp || 0) > 300000) {
                await new Promise(r => setTimeout(r, 60000));
              } else {
                await new Promise(r => setTimeout(r, FAST_MS));
              }
              waited = Math.round((Date.now() - t0) / 1000);
            }
            if (!open) { it.result = "等待超时未开闸（已等 " + waited + "s，查了 " + checked + " 次）"; results.push(it); continue; }
          }

          // 3) 开抢：按 sort 顺序逐个 verify + receive
          const gl = await api("/gift/list");
          const gr = gl.result || {};
          const prioOf = (x) => (PRIO_ID && String(x.prizeId) === String(PRIO_ID)) ? 0 : 1;
          const all = [].concat(gr.nationalPrizeList || [], gr.provPrizeList || [], gr.extGiftList || [])
            .filter(x => x && x.prizeId)
            .sort((a, b) => (prioOf(a) - prioOf(b)) || ((a.sort || 99) - (b.sort || 99)));
          it.prizeCount = all.length;
          const got = [], tried = [];
          for (const pz of all) {
            const isPrio = PRIO_ID && String(pz.prizeId) === String(PRIO_ID);
            const rounds = isPrio ? GRAB_ROUNDS : 3;
            for (let round = 0; round < rounds; round++) {
              const vf = await api("/gift/verify", { prizeId: pz.prizeId }).catch(() => ({}));
              if (String(vf.code) === "0") {
                const rc = await api("/gift/receive", { prizeId: pz.prizeId }).catch(() => ({}));
                tried.push({ id: pz.prizeId, name: pz.prizeName, code: rc.code, msg: rc.msg || "" });
                if (String(rc.code) === "0") { got.push(pz.prizeName || ("#" + pz.prizeId)); break; }
                if (String(rc.code) === "10005") break;      // 未开启
                if (/已领取|领取过|已达上限/.test(String(rc.msg || ""))) break;
              } else {
                if (String(vf.code) === "10005") { tried.push({ id: pz.prizeId, name: pz.prizeName, code: vf.code, msg: vf.msg }); break; }
                if (/已领取|领取过|已达上限|无资格|不符合/.test(String(vf.msg || ""))) {
                  tried.push({ id: pz.prizeId, name: pz.prizeName, code: vf.code, msg: vf.msg }); break;
                }
              }
              await new Promise(r => setTimeout(r, 900));
            }
            await new Promise(r => setTimeout(r, 600));
          }
          it.tried = tried.slice(0, 25);
          it.got = got;
          it.result = got.length ? ("抢到 " + got.length + " 件：" + got.join("、")) : "未抢到（已试 " + tried.length + " 件）";
          if (got.length) anyGot = true;
        } catch (e) {
          it.err = String(e.message || e).slice(0, 140);
        }
        results.push(it);
      }
      // 补齐面板需要的字段：message / ok / name（否则面板显示 undefined 且判定为失败爆红）
      const MLEVEL = { "2": "黄金", "1": "白银", "3": "钻石", "-1": "非会员" };
      out.results = results.map(x => {
        const lv = MLEVEL[String(x.memberLevel)] || (x.memberDesc || ("Lv" + (x.memberLevel ?? "?")));
        const bits = [];
        bits.push("等级" + lv);
        if (x.reservation) bits.push(x.reservation === "预约成功" ? "已预约" : ("预约" + x.reservation));
        if (x.prizeCount) bits.push("奖品" + x.prizeCount + "件");
        if (x.priority && x.prioId && x.prioId !== "清单中未找到") bits.push("优先目标" + x.priority + "(" + x.prioId + ")");
        if (x.countdownMs) bits.push("倒计时" + fmtCountdown(Number(x.countdownMs)));
        if (x.fastLane) bits.push(x.fastLane);
        if (x.got && x.got.length) bits.push("抢到：" + x.got.join("、"));
        if (x.result) bits.push(x.result);
        if (x.err) bits.push("异常：" + x.err);
        const gotAny = (x.got && x.got.length) || x.fastGot;
        return Object.assign({}, x, {
          name: "会员日",
          message: bits.join("；") || (x.err ? String(x.err) : "无返回"),
          ok: !!(!x.err && x.isMember !== false && (gotAny || mode === "query" || x.reservation === "预约成功"))
        });
      });
      out.ok = out.results.some(x => x.ok);
      out.msg = (mode === "query" ? "会员日资格查询完成" : (anyGot ? "会员日抢购完成，有收获" : "会员日抢购完成，未抢到"))
        + "（" + results.length + " 个账号）";

      // ---- 钉钉推送会员日结果 ----
      try {
        const L = [];
        L.push("### 移动云盘 · 16号会员日" + (mode === "query" ? "（资格查询）" : "（抢购）"));
        L.push("**时间**：" + nowStr());
        L.push("");
        for (const x of out.results) {
          L.push("#### " + (x.masked || "?") + "　" + (x.ok ? "✅" : "❌"));
          L.push("- " + (x.message || "无详情"));
          L.push("");
        }
        L.push("---");
        L.push(out.msg);
        out.dingtalk = await sendDingTalk("会员日" + (mode === "query" ? "资格查询" : "抢购结果"), L);
      } catch (e) {
        out.dingtalk = { ok: false, error: String(e.message || e).slice(0, 120) };
      }
    } else if (type === "srefresh") {    } else if (type === "srefresh") {
      const c = await pickCreds();
      const rr = await refreshToken(c.phone, decodeAuth(c.authorization).token);
      out.ok = !!rr.ok;
      out.msg = rr.ok ? ("续期成功，剩余 " + rr.data.remaining_days + " 天") : (rr.error || "续期失败");
      if (rr.ok) out.new_expires_at = rr.data.new_expires_at;
    } else if (type === "rtask" || type === "daily") {
      // daily：遍历仓库/前端账号逐个续期 + 推进任务 + 领气泡，并回写仓库
      const ra = await resolveAccounts();
      const accounts = ra.list;
      const perAccount = [];
      let okCount = 0;
      for (let ai = 0; ai < accounts.length; ai++) {
        const a = accounts[ai];
        if (ai > 0) await new Promise(r => setTimeout(r, 3500));
        const item = { phone: a.phone, masked: maskPhone(a.phone) };
        // 网络抖动（fetch failed / ECONNRESET / timeout）整体重试，避免限流时误报"异常"
        for (let attempt = 0; attempt < 3; attempt++) {
        let netErr = null;
        try {
          const auth = await ensureAuth(a);

          // 1) 续期（失败不中断：令牌仍有约 30 天有效期，本次沿用旧令牌继续跑任务与气泡）
          if (type === "daily") {
            try {
              const rr = await refreshToken(a.phone, decodeAuth(auth).token);
              if (rr.ok) {
                const d = decodeAuth(auth);
                a.authorization = base64Utf8Encode(`${d.prefix}:${a.phone}:${rr.data.new_token}`);
                a.expires_at = rr.data.new_expires_at;
                a.remaining_days = rr.data.remaining_days;
                a.last_refresh = nowStr();
                item.refresh = "成功，剩余 " + rr.data.remaining_days + " 天";
              } else {
                item.refresh = "未续期：" + String(rr.error || "").slice(0, 80);
              }
            } catch (e) {
              item.refresh = "未续期（接口不可达，沿用旧令牌，剩 " + (a.remaining_days != null ? a.remaining_days : "未知") + " 天）";
            }
            if (/^未续期/.test(String(item.refresh || "")) && a.remaining_days != null && Number(a.remaining_days) <= 3) {
              item.warn = "令牌仅剩 " + a.remaining_days + " 天且续期失败，请尽快处理";
            }
          }

          // 2.0) 记录本次运行前的云豆基线
          // 签到豆是直接到账的（signInPoints 当场入账），基线必须取在签到之前，
          // 否则领气泡时读到的已经是签到后的余额，永远显示 +0，看起来像"没涨"。
          let baseTotal = null;
          try {
            const jb = await getJwt(a.authorization, a.phone);
            const sb = await cloudStatus(jb);
            baseTotal = sb.total;
          } catch (e) { /* 基线取不到不影响主流程 */ }

          // 2) 每日签到（daily 此前缺失该步骤：只续期+点任务+领气泡，签到豆从未主动触发）
          try {
            const sg = await signOne(a.authorization, a.phone, a);
            item.sign = sg.ok
              ? ("签到成功" + (sg.data && sg.data.result ? "（" + String(sg.data.result).slice(0, 40) + "）" : ""))
              : ("签到失败：" + String(sg.message || "").slice(0, 70));
          } catch (e) { item.sign = "签到异常：" + String(e.message || e).slice(0, 70); }

          // 3) 推进可点击任务
          const jwt = await getJwt(a.authorization, a.phone);
          const before = await fetchTaskList(jwt);
          const wanted = Array.isArray(payload.tasks) && payload.tasks.length ? payload.tasks.slice(0, 100).map(x => String(x).slice(0, 80)) : [];
          const results = [];
          for (const t of before) {
            if (wanted.length && !wanted.includes(String(t.id))) continue;
            if (t.state === "FINISH") continue;
            if (!Array.isArray(t.steps) || !t.steps.includes("click")) continue;
            const r = await clickTask(jwt, t.id);
            results.push({ id: t.id, name: t.name, ok: r.ok });
            await new Promise(x => setTimeout(x, 600));
          }
          item.tasks = results.length;
          item.taskOk = results.filter(r => r.ok).length;
          item.taskFail = results.filter(r => !r.ok).length;
          item.taskDetail = results.map(r => {
            const nm = String(r.name || "");
            const mm = nm.match(/(\d+)\s*\/\s*(\d+)/);
            const o = { name: nm, ok: !!r.ok };
            if (mm) {
              o.progress = mm[1] + "/" + mm[2];
              o.done = Number(mm[1]) >= Number(mm[2]);
              // 点击成功 ≠ 任务完成：进度未满仍记未完成
              if (!o.done) { o.ok = false; o.note = "进行中 " + o.progress + "（点击已推进，条件未达标）"; }
              else o.note = "已完成 " + o.progress;
            }
            return o;
          });
          // 按真实完成度重算（原值只反映 click 接口是否返回 0）
          item.taskOk = item.taskDetail.filter(t => t.ok).length;
          item.taskFail = item.taskDetail.filter(t => !t.ok).length;

          // 4) 领气泡（真实浏览器，较慢）
          try {
            const rb = await receiveBubbles(a.authorization, a.phone, { ud_id: a.ud_id, a_k: a.a_k });
            item.receive = rb.ok ? ("+" + rb.got + "（" + rb.before + "→" + rb.after + "）") : ("失败：" + (rb.error || "未知"));
            item.bubbleGot = rb.got || 0;
          } catch (e) { item.receive = "异常：" + String(e.message || e).slice(0, 80); item.bubbleGot = 0; }

          // 5) 复核本次运行的真实净增（签到豆直接到账，必须单独再查一次余额才看得见）
          try {
            const jf = await getJwt(a.authorization, a.phone);
            const sf = await cloudStatus(jf);
            item.total = sf.total;
            if (baseTotal !== null && baseTotal !== undefined && sf.total !== null && sf.total !== undefined) {
              item.base = baseTotal;
              item.gain = sf.total - baseTotal;
              item.gainText = (item.gain >= 0 ? "+" : "") + item.gain + "（" + baseTotal + "→" + sf.total + "）";
            }
          } catch (e) { /* 复核失败不影响主流程 */ }

          // 成功判定：签到成功 或 气泡确实领到，才算这个账号跑通
          // 旧逻辑是无条件 item.ok=true，导致签到失败也计入"成功 N 个" —— 这是误报的根源
          const signOk = /签到成功/.test(String(item.sign || ""));
          item.ok = signOk || (item.bubbleGot || 0) > 0;
          if (!item.ok) item.error = item.error || (String(item.sign || "签到未成功").slice(0, 80));
          if (item.ok) okCount++;
        } catch (e) {
          const msg = String(e.message || e);
          const isNet = /fetch failed|ECONNRESET|ETIMEDOUT|timeout|socket hang up|network/i.test(msg);
          if (isNet && attempt < 2) {
            netErr = msg;
            await new Promise(r => setTimeout(r, [15000, 40000][attempt] || 20000));
            continue;
          }
          item.ok = false;
          item.error = (isNet ? "网络异常（已重试3次）：" : "") + msg.slice(0, 140);
        }
        if (netErr) continue;
        break;
        }
        perAccount.push(item);
        await new Promise(x => setTimeout(x, 1200));
      }
      out.perAccount = perAccount;
      if (key && ra.trusted) out.enc_accounts = await aesGcmEncryptText(key, JSON.stringify(accounts));
      if (ra.trusted) await saveStore(accounts);
      out.results = perAccount.map(x => ({ phone: x.phone, masked: x.masked, name: "", ok: x.ok,
        message: [x.refresh ? "续期" + x.refresh : "", x.sign ? "签到" + (/成功/.test(x.sign) ? "成功" : x.sign.replace("签到","")) : "",
                  x.gainText ? "云豆" + x.gainText : "",
                  (x.bubbleGot || 0) > 0 ? ("气泡+" + x.bubbleGot) : (x.receive ? "气泡无可领" : ""),
                  x.tasks !== undefined ? "任务" + x.tasks + "个" : "", x.warn || "", x.error || ""].filter(Boolean).join("；") }));
      out.ok = okCount > 0;
      out.msg = "共 " + accounts.length + " 个账号，成功 " + okCount + " 个";

      // ---- 收尾复检：逐号确认「可领已清零」，未清零记为问题并报警 ----
      const rechecks = [];
      for (const a of accounts) {
        try {
          const auth = await ensureAuth(a);
          const jwt = await getJwt(auth, a.phone);
          const st = await cloudStatus(jwt);
          const pend = (st.list || []).filter(x => x && x.cloudType === 0 && x.recordId);
          rechecks.push({ masked: maskPhone(a.phone), total: st.total,
                          receivable: st.receivable || 0, pending: pend.length,
                          clean: pend.length === 0 });
          if (pend.length) {
            okCount = Math.min(okCount, accounts.length - 1);
          }
        } catch (e) {
          rechecks.push({ masked: maskPhone(a.phone), error: String(e.message || e).slice(0, 80), clean: false });
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      out.recheck = rechecks;
      const dirty = rechecks.filter(r => !r.clean);
      out.allClean = dirty.length === 0;
      if (!out.allClean) {
        out.msg = "共 " + accounts.length + " 个账号，成功 " + okCount + " 个；⚠ " +
                  dirty.map(d => d.masked + "(剩" + (d.pending || "?") + ")").join("、") + " 仍有未领气泡";
      }

      // ---- 钉钉推送每日报告（含任务完成情况）----
      try {
        const L = [];
        L.push("### 移动云盘 · 每日签到报告");
        L.push("**时间**：" + nowStr());
        L.push("");
        for (const x of perAccount) {
          L.push("#### " + x.masked + "　" + (x.ok ? "✅ 正常" : "❌ 异常"));
          if (x.refresh) L.push("- 令牌续期：" + x.refresh);
          if (x.tasks !== undefined) {
            const failed = (x.taskDetail || []).filter(t => !t.ok);
            if (!failed.length) {
              if (x.sign) L.push("- 签到：" + x.sign);
              L.push("- 任务：" + (x.tasks || 0) + " 个全部完成 ✅");
            } else {
              L.push("- 任务：执行 " + x.tasks + " 个，成功 " + (x.taskOk || 0) + " 个，失败 " + failed.length + " 个 ❌");
              for (const t of failed.slice(0, 10)) L.push("    - ✘ " + (t.name || "未命名任务"));
              if (failed.length > 10) L.push("    - ……共失败 " + failed.length + " 个");
            }
          }
          if (x.gainText) L.push("- 本次云豆：" + x.gainText + (x.total != null ? "（当前 " + x.total + "）" : ""));
          else if (x.receive) L.push("- 云豆气泡：" + x.receive);
          const rc = (out.recheck || []).find(r => r.masked === x.masked);
          if (rc) L.push("- 领取核对：" + (rc.clean ? "可领已清零 ✅（余额 " + rc.total + "）" : "⚠ 仍剩 " + (rc.pending || "?") + " 个未领"));
          if (x.error) L.push("- 异常：" + x.error);
          L.push("");
        }
        L.push("---");
        L.push("共 " + accounts.length + " 个账号，成功 " + okCount + " 个");
        out.dingtalk = await sendDingTalk("云盘每日签到报告", L);
      } catch (e) {
        out.dingtalk = { ok: false, error: String(e.message || e).slice(0, 120) };
      }
    } else if (type === "verify") {
      // ── 零容忍验证：API 清单 / 页面气泡 / 点击结果 / 最终复检，四步逐项核对 ──
      const ra = await resolveAccounts();
      const only = String(payload.phone || "").trim();
      const targets = only ? ra.list.filter(a => String(a.phone) === only) : ra.list;
      const vout = [];
      for (const a of targets) {
        const V = { phone: a.phone, masked: maskPhone(a.phone), pass: true, issues: [], steps: [] };
        try {
          const auth = await ensureAuth(a);
          const jwt = await getJwt(auth, a.phone);

          // 步骤1：API 清单
          const st = await cloudStatus(jwt);
          V.apiBefore = { total: st.total, receivable: st.receivable, toReceive: st.toReceive,
                          nextMonth: st.nextMonth, list: st.list };
          V.steps.push("①API: 云豆=" + st.total + " 可领=" + st.receivable + " 待领=" + st.toReceive + " 下月=" + st.nextMonth);
          if (!st.list || !st.list.length) V.steps.push("①API 清单为空");

          // 步骤2：打开页面，抓真实气泡元素
          let chromium = null;
          try { chromium = require("playwright").chromium; } catch (e) {}
          if (!chromium) {
            V.pass = false; V.issues.push("playwright 未安装，无法做页面核对");
            vout.push(V); continue;
          }
          const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
          try {
            let pageUrl = SIGNIN_PAGE;
            try { const sso = await getSsoToken(auth, a.phone); if (sso) pageUrl = SIGNIN_PAGE.replace("#/newsignin", "&token=" + encodeURIComponent(sso) + "#/newsignin"); } catch (e) {}
            const ctx = await browser.newContext({ userAgent: MOBILE_UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
            await ctx.addCookies([
              { name: "jwtToken", value: jwt, domain: "m.mcloud.139.com", path: "/" },
              { name: "NATION_CODE", value: "86", domain: "m.mcloud.139.com", path: "/" },
              { name: "platform", value: "2", domain: "m.mcloud.139.com", path: "/" },
            ].concat(a.ud_id ? [{ name: "ud_id", value: String(a.ud_id), domain: "m.mcloud.139.com", path: "/" }] : [])
             .concat(a.a_k ? [{ name: "a_k", value: String(a.a_k), domain: "m.mcloud.139.com", path: "/" }] : []));
            const page = await ctx.newPage();
            const recvRes = [];
            page.on("response", async r => {
              if (/receiveV3/.test(r.url())) {
                let b = ""; try { b = (await r.text()).slice(0, 160); } catch (e) {}
                recvRes.push(b);
              }
            });
            await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
            await sleep(13000);

            const snap = await page.evaluate(() => {
              const all = Array.from(document.querySelectorAll(".AIPoints"));
              return all.map((el, i) => ({
                i, cls: el.className,
                text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30),
                isNext: /is-next-month/.test(el.className || ""),
                x: Math.round(el.getBoundingClientRect().x),
                y: Math.round(el.getBoundingClientRect().y),
                w: Math.round(el.getBoundingClientRect().width),
                h: Math.round(el.getBoundingClientRect().height),
              }));
            });
            V.pageBefore = snap;
            V.steps.push("②页面: 气泡 " + snap.length + " 个 → " +
              (snap.map(x => (x.isNext ? "[下月]" : "[可领]") + x.text).join(" | ") || "无"));

            // 一致性核对：API 说可领 vs 页面显示可领
            const apiCanGet = (st.list || []).filter(x => x && x.cloudType === 0 && x.recordId);
            const pageCanGet = snap.filter(x => !x.isNext);
            V.consistency = { apiCanGetCount: apiCanGet.length, pageCanGetCount: pageCanGet.length,
                              apiNums: apiCanGet.map(x => x.cloudNum), pageTexts: pageCanGet.map(x => x.text) };
            V.steps.push("③核对: API可领 " + apiCanGet.length + " 个" + JSON.stringify(apiCanGet.map(x=>x.cloudNum)) +
                         " / 页面可领 " + pageCanGet.length + " 个" + JSON.stringify(pageCanGet.map(x=>x.text)));
            if (apiCanGet.length !== pageCanGet.length) {
              V.issues.push("API 与页面可领数量不一致（API " + apiCanGet.length + " vs 页面 " + pageCanGet.length + "）");
            }

            // 步骤4：逐个点击可领气泡
            const beforeBal = (await readCloudNumSafe(page, jwt)).v;
            let clickedAny = false, totalGot = 0;
            for (const b of pageCanGet) {
              const b0 = (await readCloudNumSafe(page, jwt)).v;
              const res = await page.evaluate((k) => {
                const el = document.querySelectorAll(".AIPoints")[k];
                if (!el) return "gone";
                el.scrollIntoView({ block: "center" });
                const rc = el.getBoundingClientRect();
                const cx = rc.x + rc.width / 2, cy = rc.y + rc.height / 2;
                const fire = (t) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerType: "touch", isPrimary: true }));
                fire("pointerdown"); fire("pointerup"); fire("click"); el.click();
                const inner = el.querySelector("div,span,img");
                if (inner) inner.click();
                return "ok";
              }, b.i);
              await sleep(6000);
              const b1 = (await readCloudNumSafe(page, jwt)).v;
              const d = (b0 !== null && b1 !== null) ? (b1 - b0) : 0;
              clickedAny = true;
              totalGot += Math.max(0, d);
              V.steps.push("④点击#" + (b.i + 1) + " 「" + b.text + "」 " + res + " " + b0 + "→" + b1 + (d > 0 ? " +" + d : " 无变化"));
              if (d <= 0) { V.pass = false; V.issues.push("气泡「" + b.text + "」点击后云豆未增加（" + b0 + "→" + b1 + "）"); }
            }
            const afterBal = (await readCloudNumSafe(page, jwt)).v;
            V.browser = { before: beforeBal, after: afterBal, got: totalGot, clicked: clickedAny, recvRes: recvRes.slice(0, 5) };

            // 步骤5：最终 API 复检，可领必须归零
            await sleep(2500);
            const st2 = await cloudStatus(jwt);
            V.apiAfter = { total: st2.total, receivable: st2.receivable, toReceive: st2.toReceive, list: st2.list };
            V.steps.push("⑤复检: 云豆=" + st2.total + " 可领=" + st2.receivable + " 待领=" + st2.toReceive);
            if (pageCanGet.length > 0 && (st2.receivable || 0) > 0) {
              V.pass = false; V.issues.push("点击后 API 仍显示可领 " + st2.receivable + "，未清零");
            }
            if (totalGot > 0 && st2.total !== (beforeBal === null ? st2.total : beforeBal + totalGot)) {
              // 余额对不上只做记录，云豆可能因签到等其它动作变动
              V.issues.push("注意：页面 +" + totalGot + "，API 复检 " + (beforeBal === null ? "?" : beforeBal) + "→" + st2.total);
            }
          } finally { try { await browser.close(); } catch (e) {} }
        } catch (e) {
          V.pass = false;
          V.fatal = String(e.message || e).slice(0, 200);
          V.issues.push("执行异常: " + V.fatal);
        }
        vout.push(V);
        await sleep(4000);
      }
      out.verify = vout;
      out.ok = vout.every(v => v.pass);
      out.msg = "零容忍验证：" + vout.filter(v => v.pass).length + "/" + vout.length + " 通过" +
                (out.ok ? " ✅" : " ❌ " + vout.flatMap(v => v.issues).join("; ").slice(0, 300));
      try { fs.writeFileSync(path.join(__dirname, "../data/verify.json"), JSON.stringify(vout, null, 2)); } catch (e) {}
    } else if (type === "diag") {
      // 深度诊断：不跳过任何一个气泡，逐步点击并记录每次请求/响应
      const ra = await resolveAccounts();
      const only = String(payload.phone || "").trim();
      const targets = only ? ra.list.filter(a => String(a.phone) === only) : ra.list;
      const diagOut = [];
      for (const a of targets) {
        const D = { phone: a.phone, masked: maskPhone(a.phone), steps: [], attempts: [] };
        try {
          const auth = await ensureAuth(a);
          const jwt = await getJwt(auth, a.phone);
          const st = await cloudStatus(jwt);
          D.api = { total: st.total, receivable: st.receivable, toReceive: st.toReceive, nextMonth: st.nextMonth, list: st.list };
          D.steps.push("API 云豆=" + st.total + " 可领=" + st.receivable + " 待领=" + st.toReceive + " 下月=" + st.nextMonth);

          // 逐个 API 尝试，记录每条返回
          for (const it of (st.list || [])) {
            try {
              const r = await receiveViaApi(jwt, [it]);
              D.attempts.push({ via: "api", item: it, got: r.got, steps: r.steps });
            } catch (e) {
              D.attempts.push({ via: "api", item: it, err: String(e.message || e).slice(0, 100) });
            }
            await sleep(1200);
          }

          // 浏览器：抓取页面上所有气泡元素
          let chromium = null;
          try { chromium = require("playwright").chromium; } catch (e) { D.steps.push("playwright 未安装"); }
          if (chromium) {
            const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
            try {
              let pageUrl = SIGNIN_PAGE;
              try { const sso = await getSsoToken(auth, a.phone); if (sso) pageUrl = SIGNIN_PAGE.replace("#/newsignin", "&token=" + encodeURIComponent(sso) + "#/newsignin"); } catch (e) {}
              const ctx = await browser.newContext({ userAgent: MOBILE_UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
              await ctx.addCookies([
                { name: "jwtToken", value: jwt, domain: "m.mcloud.139.com", path: "/" },
                { name: "NATION_CODE", value: "86", domain: "m.mcloud.139.com", path: "/" },
                { name: "platform", value: "2", domain: "m.mcloud.139.com", path: "/" },
              ].concat(a.ud_id ? [{ name: "ud_id", value: String(a.ud_id), domain: "m.mcloud.139.com", path: "/" }] : [])
               .concat(a.a_k ? [{ name: "a_k", value: String(a.a_k), domain: "m.mcloud.139.com", path: "/" }] : []));
              const page = await ctx.newPage();
              const net = [];
              page.on("request", r => { if (/receive|signin|cloud/i.test(r.url())) net.push({ t: "REQ", u: r.url().slice(0, 130), m: r.method() }); });
              page.on("response", async r => {
                if (/receive|cloud/i.test(r.url())) {
                  let b = ""; try { b = (await r.text()).slice(0, 200); } catch (e) {}
                  net.push({ t: "RES", u: r.url().slice(0, 130), b });
                }
              });
              await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
              await sleep(12000);

              // 枚举页面上所有气泡元素
              const els = await page.evaluate(() => {
                const all = Array.from(document.querySelectorAll(".AIPoints"));
                const out = all.map((el, i) => {
                  const cs = getComputedStyle(el);
                  const rc = el.getBoundingClientRect();
                  return { i, cls: el.className, text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 40),
                    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
                    x: Math.round(rc.x), y: Math.round(rc.y), w: Math.round(rc.width), h: Math.round(rc.height),
                    inView: rc.y >= 0 && rc.y < window.innerHeight };
                });
                // 额外找其它可能的气泡选择器
                const alt = {};
                for (const sel of [".bubble", ".cloud-bubble", ".points-item", "[class*=bubble]", "[class*=ubble]", ".signin-bubble"]) {
                  try { alt[sel] = document.querySelectorAll(sel).length; } catch (e) { alt[sel] = "err"; }
                }
                return { count: all.length, items: out, alt, bodyLen: document.body.innerText.length,
                  bodySnippet: document.body.innerText.replace(/\s+/g, " ").slice(0, 300) };
              });
              D.page = els;
              D.steps.push("页面气泡元素: " + els.count + " 个");

              // 逐个点击（不因连续无变化而提前退出）
              for (let k = 0; k < Math.min(els.count, 12); k++) {
                const b0 = (await readCloudNumSafe(page, jwt)).v;
                const res = await page.evaluate((idx) => {
                  const all = Array.from(document.querySelectorAll(".AIPoints"));
                  const el = all[idx];
                  if (!el) return "no-el";
                  el.scrollIntoView({ block: "center" });
                  const rc = el.getBoundingClientRect();
                  // 直接派发坐标级事件序列，模拟真实触摸
                  const fire = (type, x, y) => {
                    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: "touch", isPrimary: true });
                    el.dispatchEvent(ev);
                  };
                  const cx = rc.x + rc.width / 2, cy = rc.y + rc.height / 2;
                  fire("pointerdown", cx, cy); fire("pointerup", cx, cy); fire("click", cx, cy);
                  el.click();
                  const inner = el.querySelector("div,span,img");
                  if (inner) { inner.click(); }
                  return "ok";
                }, k);
                await sleep(6000);
                const b1 = (await readCloudNumSafe(page, jwt)).v;
                D.attempts.push({ via: "browser", idx: k, res, before: b0, after: b1, delta: (b0 !== null && b1 !== null) ? (b1 - b0) : null });
                D.steps.push("点击#" + (k + 1) + " " + res + " " + b0 + "→" + b1);
              }
              const fin = (await readCloudNumSafe(page, jwt)).v;
              D.final = fin;
              D.steps.push("最终云豆 " + fin);
              D.net = net.slice(-40);
            } finally { try { await browser.close(); } catch (e) {} }
          }
        } catch (e) {
          D.fatal = String(e.message || e).slice(0, 200);
        }
        diagOut.push(D);
        await sleep(2500);
      }
      out.diag = diagOut;
      out.ok = true;
      out.msg = "诊断完成（" + diagOut.length + " 个账号）";
      try { fs.writeFileSync(path.join(__dirname, "../data/diag.json"), JSON.stringify(diagOut, null, 2)); } catch (e) {}
    } else {
      throw new Error("未知命令: " + type);
    }
  } catch (e) {
    out.ok = false;
    out.msg = String(e.message || e).slice(0, 300);
  }

  fs.writeFileSync(path.join(__dirname, "../data/result.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
  return out;
}

module.exports = { decodeAuth, cleanAuth, maskPhone, rsaEncrypt, pkcs7Unpad, hexToBytes, aesEcbDecryptBytes, aesGcmEncryptText, aesGcmDecryptText, deriveKey, stableJsonStringify, getJwt, cloudStatus, receiveViaApi };

if (require.main === module) main().then(out => {
  // 全部账号失败 -> 非零退出，让 Actions 变红（否则一直显示绿色，失败无人知）
  if (out && out.type === "daily" && Array.isArray(out.perAccount) && out.perAccount.length > 0) {
    const okN = out.perAccount.filter(x => x && x.ok).length;
    if (okN === 0) { console.error("ALL_ACCOUNTS_FAILED: 0/" + out.perAccount.length); process.exit(2); }
    const half = okN < out.perAccount.length;
    if (half) console.error("PARTIAL_FAILURE: " + okN + "/" + out.perAccount.length);
  }
}).catch(e => { console.error("FATAL:", e); process.exit(1); });
