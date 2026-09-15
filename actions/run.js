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
    const r = await fetchWithTimeout(`https://m.mcloud.139.com/ycloud/signin/page/startSignIn?client=app&deviceId=${encodeURIComponent(deviceId)}`, {
      method: "POST",
      headers: { "Host": "m.mcloud.139.com", "jwtToken": jwt, "Origin": "https://m.mcloud.139.com", "Referer": "https://m.mcloud.139.com/", "Accept": "application/json, text/plain, */*", "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await responseJsonChecked(r, "签到");
    const ok = String(j.code) === "0" || String(j.code).toLowerCase() === "success" || j.success === true;
    return { ok, message: j.msg || j.message || (ok ? "已提交签到" : "签到接口返回失败"), data: { code: j.code, result: String(j.result || "").slice(0, 200) } };
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
      out.list = arr.slice(0, 12).map(x => ({
        cloudType: x.cloudType, cloudNum: numOf(x.cloudNum !== undefined ? x.cloudNum : x.num),
        recordId: x.recordId || x.cloudId || null,
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
    if (!cloudId || isNaN(cloudId)) { steps.push("跳过无效项 " + JSON.stringify(it).slice(0, 100)); continue; }
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
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
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
    let noChange = 0;
    let eligible = false;
    for (let round = 0; round < 6; round++) {
      const n = await page.locator(".AIPoints:not(.is-next-month)").count();
      if (!n) break;
      eligible = true;
      const b0 = (await readCloudNumSafe(page, jwt)).v;
      // ★ 气泡有浮动动画，locator.click() 的 actionability 检查必然超时。
      //   实测只有 JS 直接派发 click（并补点子元素）才能真正触发领取。
      let clicked = false, err = "";
      try {
        const r = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll(".AIPoints"))
            .filter(el => !/is-next-month/.test(el.className || ""));
          if (!els.length) return "none";
          const el = els[0];
          el.click();
          // 事件可能绑在子元素上，父子都派发一次
          const inner = el.querySelector("div,span,img");
          if (inner) inner.click();
          return "clicked:" + els.length;
        });
        if (String(r).indexOf("clicked") === 0) clicked = true; else err = "无元素(" + r + ")";
      } catch (e) { err = String(e.message || e).slice(0, 60); }
      if (!clicked) {
        // JS 点击失败才回退 locator（大概率也会超时，仅作兜底）
        try { await page.locator(".AIPoints:not(.is-next-month)").first().click({ force: true, timeout: 6000 }); clicked = true; }
        catch (e2) { err = String(e2.message || e2).slice(0, 60); }
      }
      await sleep(3800);
      const b1 = (await readCloudNumSafe(page, jwt)).v;
      const delta = (b0 !== null && b1 !== null) ? (b1 - b0) : 0;
      if (delta > 0) { got += delta; steps.push("第" + (round + 1) + "次领取 +" + delta + "（" + b0 + "→" + b1 + "）"); noChange = 0; }
      else { steps.push("第" + (round + 1) + "次无变化（" + b0 + "→" + b1 + "）" + (err ? " err=" + err : "")); noChange++; if (!clicked || noChange >= 2) break; }
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
  const allowedTypes = new Set(["send_code","do_login","sync","sign","refresh","task","status","receive","list","srefresh","rtask","daily","probe16"]);
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
    } else if (type === "probe16") {
      // 星动日 / 16号会员日 活动接口探测（只读，不领取）
      const ra = await resolveAccounts();
      out.acctDiag = ra.diag;
      const c = ra.list[0] || await pickCreds();
      out.phone = c.phone; out.masked = maskPhone(c.phone);
      let jwt = "";
      try { jwt = await getJwt(c.authorization, c.phone); }
      catch (e) { out.ok = false; out.msg = "jwt 获取失败: " + String(e.message || e).slice(0,150); 
                  out.probes = []; fs.writeFileSync(path.join(__dirname, "../data/result.json"), JSON.stringify(out, null, 2)); return console.log(JSON.stringify(out)); }
      const H = { "User-Agent": UA_CLOUD, "jwtToken": jwt, "Cookie": "jwtToken=" + jwt,
                  "Accept": "*/*", "X-Requested-With": "XMLHttpRequest", "Referer": "https://m.mcloud.139.com/" };
      const probes = [];
      async function P(tag, url, opt) {
        try {
          const r = await fetchWithTimeout(url, Object.assign({ headers: H }, opt || {}), 25000);
          const t = await r.text();
          const cap = (tag === "page") ? 20000 : 700;
          probes.push({ tag, url: url.slice(0, 130), status: r.status, len: t.length, body: t.slice(0, cap) });
        } catch (e) { probes.push({ tag, url: url.slice(0, 130), err: String(e.message || e).slice(0, 120) }); }
      }
      const H2 = { "User-Agent": UA_CLOUD, "jwtToken": jwt, "Cookie": "jwtToken=" + jwt,
                   "Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest",
                   "Referer": "https://m.mcloud.139.com/huiyuanri/v1/index.html?path=mCloudDay",
                   "Content-Type": "application/json;charset=UTF-8" };
      async function P2(tag, url, opt) {
        try {
          const r = await fetchWithTimeout(url, Object.assign({ headers: H2 }, opt || {}), 30000);
          const t = await r.text();
          probes.push({ tag, url: url.slice(0, 130), status: r.status, len: t.length, body: t.slice(0, 3000) });
        } catch (e) { probes.push({ tag, url: url.slice(0, 130), err: String(e.message || e).slice(0, 110) }); }
      }
      const M = "https://m.mcloud.139.com/ycloud/mcloudday";
      const post = (b) => ({ method: "POST", body: JSON.stringify(b || {}) });
      // A) 活动信息（完整，看预约字段）
      await P2("activityInfo", M + "/common/activityInfo?marketName=mCloudDay");
      // B) 预约：open=true / false 两种
      await P2("reservation?open=true", M + "/common/reservation?open=true&marketName=mCloudDay", post({}));
      await P2("reservation?open=1", M + "/common/reservation?open=1&marketName=mCloudDay", post({}));
      // C) 奖品清单（完整）
      await P2("gift/list", M + "/gift/list");
      // D) 我的奖品
      await P2("myPrize", "https://m.mcloud.139.com/ycloud/prizeApi/checkPrize/getUserPrizeLogPageV2?pageNum=1&pageSize=20");
      // E) 各省/全网 extGift
      await P2("extGift", M + "/gift/list?client=app&type=ext");
      out.probes = probes;
      out.ok = true;
      out.msg = "会员日探测完成，共 " + probes.length + " 个请求";
    } else if (type === "srefresh") {
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
        try {
          const auth = await ensureAuth(a);

          // 1) 续期
          if (type === "daily") {
            const rr = await refreshToken(a.phone, decodeAuth(auth).token);
            if (rr.ok) {
              const d = decodeAuth(auth);
              a.authorization = base64Utf8Encode(`${d.prefix}:${a.phone}:${rr.data.new_token}`);
              a.expires_at = rr.data.new_expires_at;
              a.remaining_days = rr.data.remaining_days;
              a.last_refresh = nowStr();
              item.refresh = "成功，剩余 " + rr.data.remaining_days + " 天";
            } else {
              item.refresh = "失败：" + rr.error;
            }
          }

          // 2) 推进可点击任务
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

          // 3) 领气泡（真实浏览器，较慢）
          try {
            const rb = await receiveBubbles(a.authorization, a.phone, { ud_id: a.ud_id, a_k: a.a_k });
            item.receive = rb.ok ? ("+" + rb.got + "（" + rb.before + "→" + rb.after + "）") : ("失败：" + (rb.error || "未知"));
          } catch (e) { item.receive = "异常：" + String(e.message || e).slice(0, 80); }

          item.ok = !item.refresh || !String(item.refresh).startsWith("失败：");
          if (item.ok) okCount++;
        } catch (e) {
          item.ok = false; item.error = String(e.message || e).slice(0, 160);
        }
        perAccount.push(item);
        await new Promise(x => setTimeout(x, 1200));
      }
      out.perAccount = perAccount;
      if (key && ra.trusted) out.enc_accounts = await aesGcmEncryptText(key, JSON.stringify(accounts));
      if (ra.trusted) await saveStore(accounts);
      out.results = perAccount.map(x => ({ phone: x.phone, masked: x.masked, name: "", ok: x.ok,
        message: [x.refresh ? "续期" + x.refresh : "", x.tasks !== undefined ? "任务" + x.tasks + "个" : "", x.receive ? "气泡" + x.receive : "", x.error || ""].filter(Boolean).join("；") }));
      out.ok = okCount > 0;
      out.msg = "共 " + accounts.length + " 个账号，成功 " + okCount + " 个";
    } else {
      throw new Error("未知命令: " + type);
    }
  } catch (e) {
    out.ok = false;
    out.msg = String(e.message || e).slice(0, 300);
  }

  fs.writeFileSync(path.join(__dirname, "../data/result.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}

module.exports = { decodeAuth, cleanAuth, maskPhone, rsaEncrypt, pkcs7Unpad, hexToBytes, aesEcbDecryptBytes, aesGcmEncryptText, aesGcmDecryptText, deriveKey, stableJsonStringify, getJwt, cloudStatus, receiveViaApi };

if (require.main === module) main().catch(e => { console.error("FATAL:", e); process.exit(1); });
