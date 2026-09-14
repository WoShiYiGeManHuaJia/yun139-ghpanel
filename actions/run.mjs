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

// ---------------- 通用工具 ----------------
function b64encode(bytes) { return Buffer.from(bytes).toString("base64"); }
function utf8B64(str) { return Buffer.from(str, "utf8").toString("base64"); }
function cleanAuth(raw) {
  raw = String(raw || "").replace(/\s+/g, "");
  raw = raw.replace(/^basic/i, "");
  return raw;
}
function decodeAuth(raw) {
  let decoded;
  try { decoded = Buffer.from(cleanAuth(raw), "base64").toString("utf8"); } catch (e) { throw new Error("authorization 不是合法 Base64"); }
  const parts = decoded.split(":");
  if (parts.length < 3) throw new Error("authorization 解码后缺少字段(应为 pc:手机号:token)");
  return { prefix: parts[0], phone: parts[1], token: parts.slice(2).join(":") };
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
  const ps = [];
  for (let i = 0; i < psLen; i++) ps.push(1 + Math.floor(Math.random() * 255));
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
  const raw = Buffer.from(b64, "base64");
  const iv = new Uint8Array(raw.slice(0, 12));
  const ct = new Uint8Array(raw.slice(12));
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

// ---------------- 短信登录链路 (含会话cookie修复 + RSA发码) ----------------
async function getJsession() {
  const r = await fetch("https://mail.10086.cn/Login/Login.ashx", {
    redirect: "manual",
    headers: { "User-Agent": UA_EDGE, "Accept": "text/html,application/xhtml+xml" },
  });
  const sc = r.headers.get("set-cookie") || "";
  const m = sc.match(/JSESSIONID=([^;]+)/);
  return m ? m[1] : "";
}
async function sendSmsCodeByScene(phone) {
  const encPhone = rsaEncrypt(SMS_RSA_N, SMS_RSA_E, phone);
  const cguid = Date.now();
  const body = `<object><string name="loginName">${encPhone}</string><string name="fv">4</string><string name="clientId">1003</string><string name="eMode">1</string><string name="loginFailureUrl"></string><string name="loginSuccessUrl"></string><string name="verifyCode"></string><string name="version">1.0</string><string name="scene">5</string></object>`;
  const r = await fetch(`https://mail.10086.cn/s?func=login:sendSmsCodeByScene&cguid=${cguid}`, {
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
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { code: text.slice(0, 200) }; }
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
  const r = await fetch("https://mail.10086.cn/Login/Login.ashx", {
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
  const cj = {};
  const scAll = r.headers.get("set-cookie") || "";
  for (const seg of scAll.split(",")) {
    const mm = seg.match(/([^=;]+)=([^;]*)/);
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
  const r = await fetch(url, {
    method: "POST",
    headers: { "Host": "smsrebuild1.mail.10086.cn", "Cookie": `RMKEY=${rmkey}`, "Content-Type": "text/xml; charset=utf-8", "User-Agent": "okhttp/4.12.0" },
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = {}; }
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
  const r = await fetch("https://user-njs.yun.139.com/user/thirdlogin", {
    method: "POST",
    headers: {
      "hcy-cool-flag": "1", "x-huawei-channelSrc": "10246600", "x-MM-Source": "0",
      "x-UserAgent": "android|23116PN5BC|android15|1.2.6|||1440x3200|10246600",
      "x-DeviceInfo": "4|127.0.0.1|5|1.2.6|Xiaomi|23116PN5BC||02-00-00-00-00-00|android 15|1440x3200|android|||",
      "Content-Type": "text/plain;charset=UTF-8", "Host": "user-njs.yun.139.com", "User-Agent": "okhttp/3.12.2",
    },
    body: payload,
  });
  const text = await r.text();
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
  const key2 = hexToBytes(KEY_HEX_2);
  const dec = await aesEcbDecrypt(innerBytes, key2);
  const finalJson = new TextDecoder().decode(pkcs7Unpad(dec));
  let fj; try { fj = JSON.parse(finalJson); } catch { fj = {}; }
  const authToken = fj.authToken || ""; const account = fj.account || "";
  if (!authToken || !account) throw new Error(`thirdlogin 结果缺少 token: ${finalJson.slice(0, 80)}`);
  const authorization = btoa(unescape(encodeURIComponent(`pc:${account}:${authToken}`)));
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
  const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: phone, toSourceId: "001005" }),
  });
  const j = await r.json();
  if (String(j.code) !== "0") throw new Error(`querySpecToken 失败 code=${j.code} msg=${j.message}`);
  const ssoToken = j.data.token;
  for (const h of CY_HOSTS) {
    try {
      const r2 = await fetch(`${h}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(ssoToken)}`, {
        headers: { "Host": h.replace("https://", ""), "Accept": "*/*" }, signal: AbortSignal.timeout(20000),
      });
      const j2 = await r2.json();
      if (j2 && j2.result && j2.result.token) return j2.result.token;
    } catch (e) { /* 换下一个主机 */ }
  }
  throw new Error("tyrzLogin 所有主机均失败");
}
async function getJwt(authorization, phone) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await getJwtOnce(authorization, phone); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
}
async function signOne(authorization, phone) {
  try {
    const jwt = await getJwt(authorization, phone);
    const r = await fetch(`https://m.mcloud.139.com/ycloud/signin/page/startSignIn?client=app&deviceId=${encodeURIComponent(DEFAULT_DEVICE)}`, {
      method: "POST",
      headers: { "Host": "m.mcloud.139.com", "jwtToken": jwt, "Origin": "https://m.mcloud.139.com", "Referer": "https://m.mcloud.139.com/", "Accept": "application/json, text/plain, */*", "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json();
    return { ok: true, message: j.msg || "已提交签到", data: { code: j.code, result: String(j.result || "").slice(0, 200) } };
  } catch (e) {
    return { ok: false, message: String(e.message || e).slice(0, 300) };
  }
}
async function refreshToken(phone, token) {
  const body = `<root><token>${token}</token><account>${phone}</account><clienttype>656</clienttype></root>`;
  const r = await fetch("https://aas.caiyun.feixin.10086.cn:443/tellin/authTokenRefresh.do", {
    method: "POST",
    headers: { "Content-Type": "application/xml;charset=UTF-8", "User-Agent": "okhttp/4.12.0", "Accept": "application/xml" },
    body,
  });
  const text = await r.text();
  const mRet = text.match(/<return[^>]*>([^<]*)<\/return>/);
  const mTok = text.match(/<token[^>]*>([^<]*)<\/token>/);
  const mDesc = text.match(/<desc[^>]*>([^<]*)<\/desc>/);
  if (!mRet || mRet[1] !== "0" || !mTok) return { ok: false, error: `续期失败 return=${mRet ? mRet[1] : "?"} desc=${mDesc ? mDesc[1] : "未知"}` };
  const newTok = mTok[1];
  const strs = newTok.split("|");
  let exp = null, remain = null;
  if (strs.length >= 4) {
    const expMs = parseInt(strs[3], 10);
    exp = fmtDate(new Date(expMs));
    remain = Math.round((expMs - Date.now()) / 86400000 * 10) / 10;
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
  if (!b.length) return b;
  const pad = b[b.length - 1];
  if (pad > 0 && pad <= 16 && pad <= b.length) return b.slice(0, b.length - pad);
  return b;
}
function hexToBytes(hex) {
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
      const r = await fetch(h + "/market/signin/task/taskList?marketname=sign_in_3", { headers: cyHeaders(jwt, h), signal: AbortSignal.timeout(20000) });
      j = await r.json();
      if (String(j.code) === "0") break;
      j = null;
    } catch (e) { lastErr = e; }
  }
  if (!j) throw new Error("所有主机均不可用: " + String((lastErr && lastErr.message) || "未知"));
  if (String(j.code) !== "0") throw new Error("任务列表获取失败: " + j.msg);
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
      const r = await fetch(h + "/market/signin/task/click?key=task&id=" + id, { headers: cyHeaders(jwt, h), signal: AbortSignal.timeout(20000) });
      txt = await r.text(); got = true; break;
    } catch (e) { lastErr = e; }
  }
  if (!got) throw new Error("点击失败: " + String((lastErr && lastErr.message) || "未知"));
  let j = {}; try { j = JSON.parse(txt); } catch { j = { msg: txt.slice(0, 120) }; }
  return { ok: String(j.code) === "0", code: j.code, msg: j.msg || "" };
}

async function main() {
  const type = process.env.EVENT_TYPE || "";
  let payload = {};
  try { payload = JSON.parse(process.env.PAYLOAD || "{}"); } catch {}
  const dataKey = process.env.PANEL_DATA_KEY || "";
  const key = dataKey ? await deriveKey(dataKey) : null;

  let out = { ts: nowStr(), type, ok: false, msg: "" };

  async function decryptAccounts() {
    if (!key || !payload.cipher) throw new Error("缺少加密数据或密钥");
    const plain = await aesGcmDecryptText(key, payload.cipher);
    const arr = JSON.parse(plain);
    if (!Array.isArray(arr)) throw new Error("解密结果不是账号列表");
    return arr;
  }
  // 定时运行时没有前端 cipher，回退读仓库 Secret
  async function pickCreds() {
    const ea = process.env.YUN139_AUTHORIZATION, ep = process.env.YUN139_PHONE;
    if (ea && ep) return { authorization: ea, phone: ep };
    const accounts = await decryptAccounts();
    if (!accounts.length) throw new Error("无可用的账号令牌");
    return { authorization: accounts[0].authorization, phone: accounts[0].phone };
  }

  try {
    if (type === "send_code") {
      const phone = String(payload.phone || "").trim();
      if (!/^1\d{10}$/.test(phone)) throw new Error("手机号格式错误");
      const j = await sendSmsCodeByScene(phone);
      out.phone = phone;
      out.msg = (j.summary || j.code || "unknown");
      out.ok = true;
    } else if (type === "do_login") {
      const phone = String(payload.phone || "").trim();
      const code = String(payload.code || "").trim();
      if (!key) throw new Error("未配置 PANEL_DATA_KEY, 无法回传新令牌");
      const authorization = await loginBySms(phone, code);
      const accounts = await decryptAccounts();
      const dec = decodeAuth(authorization);
      const strs = dec.token.split("|");
      const expMs = strs.length >= 4 ? parseInt(strs[3], 10) : 0;
      const newAcc = {
        id: String(Date.now() % 1000000),
        name: payload.name || `139-${phone.slice(-4)}`,
        phone,
        authorization,
        expires_at: fmtDate(new Date(expMs)),
        remaining_days: expMs ? Math.round((expMs - Date.now()) / 86400000 * 10) / 10 : null,
        created_at: nowStr(),
      };
      accounts.push(newAcc);
      out.enc_accounts = await aesGcmEncryptText(key, JSON.stringify(accounts));
      out.phone = phone;
      out.msg = "登录成功, 已抓取令牌";
      out.ok = true;
    } else if (type === "sign" || type === "refresh") {
      const accounts = await decryptAccounts();
      const results = [];
      const updated = [];
      for (const a of accounts) {
        const phone = a.phone;
        const row = { phone, masked: maskPhone(phone), name: a.name || "" };
        try {
          if (type === "sign") {
            const r = await signOne(a.authorization, phone);
            row.ok = r.ok; row.message = r.message;
          } else {
            const r = await refreshToken(phone, decodeAuth(a.authorization).token);
            if (r.ok) {
              const newAuth = btoa(unescape(encodeURIComponent(`${decodeAuth(a.authorization).prefix}:${phone}:${r.data.new_token}`)));
              a.authorization = newAuth; a.expires_at = r.data.new_expires_at; a.remaining_days = r.data.remaining_days; a.last_refresh = nowStr();
              row.ok = true; row.message = `续期成功, 剩余 ${r.data.remaining_days} 天`;
            } else { row.ok = false; row.message = r.error; }
          }
        } catch (e) { row.ok = false; row.message = String(e.message || e).slice(0, 200); }
        results.push(row);
        updated.push(a);
      }
      out.results = results;
      out.enc_accounts = await aesGcmEncryptText(key, JSON.stringify(updated));
      out.msg = type === "sign" ? "签到完成" : "续期完成";
      out.ok = true;
    } else if (type === "task") {
      const accounts = await decryptAccounts();
      const wanted = Array.isArray(payload.tasks) && payload.tasks.length ? payload.tasks : ["sign"];
      const results = [];
      for (const a of accounts) {
        const phone = a.phone;
        for (const t of wanted) {
          const row = { phone, masked: maskPhone(phone), name: a.name || "", task: t };
          try {
            if (t === "sign") {
              const r = await signOne(a.authorization, phone);
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
      out.ok = true;
    } else if (type === "list") {
      const c = await pickCreds();
      const jwt = await getJwt(c.authorization, c.phone);
      out.tasks = await fetchTaskList(jwt);
      out.msg = "已获取 " + out.tasks.length + " 个真实任务";
      out.ok = true;
    } else if (type === "srefresh") {
      const c = await pickCreds();
      const rr = await refreshToken(c.phone, decodeAuth(c.authorization).token);
      out.ok = !!rr.ok;
      out.msg = rr.ok ? ("续期成功，剩余 " + rr.data.remaining_days + " 天") : (rr.error || "续期失败");
      if (rr.ok) out.new_expires_at = rr.data.new_expires_at;
    } else if (type === "rtask" || type === "daily") {
      const c = await pickCreds();
      if (type === "daily") {
        const rr = await refreshToken(c.phone, decodeAuth(c.authorization).token);
        out.refresh = rr.ok ? ("成功，剩余 " + rr.data.remaining_days + " 天") : (rr.error || "失败");
        if (rr.ok) out.new_expires_at = rr.data.new_expires_at;
      }
      const jwt = await getJwt(c.authorization, c.phone);
      const before = await fetchTaskList(jwt);
      const wanted = Array.isArray(payload.tasks) && payload.tasks.length ? payload.tasks.map(String) : [];
      const results = [];
      for (const t of before) {
        if (wanted.length && !wanted.includes(String(t.id))) continue;
        if (t.state === "FINISH") { results.push({ id: t.id, name: t.name, reward: t.reward, ok: true, msg: "已完成" }); continue; }
        if (t.steps.indexOf("click") < 0) { results.push({ id: t.id, name: t.name, reward: t.reward, ok: false, msg: "需真实操作(" + t.steps.join("/") + ")" }); continue; }
        const r = await clickTask(jwt, t.id);
        results.push({ id: t.id, name: t.name, reward: t.reward, ok: r.ok, msg: r.msg });
        await new Promise(x => setTimeout(x, 600));
      }
      const after = await fetchTaskList(jwt);
      const map = {}; for (const t of after) map[t.id] = t;
      for (const r of results) { const a = map[r.id]; if (a) { r.afterProcess = a.process; r.afterState = a.state; } }
      out.results = results; out.tasks = after;
      out.msg = (out.refresh ? "续期" + out.refresh + "；" : "") + "处理 " + results.length + " 个任务";
      out.ok = true;
    } else {
      throw new Error("未知命令: " + type);
    }
  } catch (e) {
    out.ok = false;
    out.msg = String(e.message || e).slice(0, 300);
  }

  const fs = await import("fs");
  fs.writeFileSync(new URL("../data/result.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
