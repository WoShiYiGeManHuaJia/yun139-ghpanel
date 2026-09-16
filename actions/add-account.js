// 把「待加入账号」合并进 data/accounts.enc（AES-256-GCM，密钥=SHA256(PANEL_DATA_KEY)）。
//
// 设计要点：
//   * 账号明文只通过仓库 Secret(NEW_ACCOUNTS_JSON) 传入 —— Secret 在日志中自动脱敏，
//     公开仓库也看不到；绝不走 workflow_dispatch 的 inputs（那会明文暴露在 UI 与日志里）。
//   * 按 phone 去重合并：已存在则覆盖，不存在则追加 —— 不会破坏仓库里已有的账号。
//   * 只打印掩码手机号，不输出任何凭据。
const fs = require("fs");
const path = require("path");

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
function mask(p) { p = String(p || ""); return p.length > 7 ? p.slice(0, 3) + "****" + p.slice(-4) : "***"; }
function decodeAuth(raw) {
  const b64 = String(raw || "").trim().replace(/^Basic\s+/i, "");
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) throw new Error("authorization 不是合法 Base64");
  const decoded = Buffer.from(b64, "base64").toString("utf8");
  const parts = decoded.split(":");
  if (parts.length < 3) throw new Error("authorization 解码后缺少字段(应为 pc:手机号:token)");
  const phone = parts[1].trim();
  if (!/^\d{6,15}$/.test(phone)) throw new Error("authorization 内手机号格式错误");
  return { phone };
}

(async () => {
  const dataKey = process.env.PANEL_DATA_KEY || "";
  if (!dataKey) throw new Error("未配置 PANEL_DATA_KEY");
  const rawJson = process.env.NEW_ACCOUNTS_JSON || "";
  if (!rawJson.trim()) throw new Error("NEW_ACCOUNTS_JSON 为空（Secret 未设置或已用完）");

  let incoming;
  try { incoming = JSON.parse(rawJson); } catch { throw new Error("NEW_ACCOUNTS_JSON 不是合法 JSON"); }
  if (!Array.isArray(incoming) || !incoming.length) throw new Error("NEW_ACCOUNTS_JSON 必须是非空数组");

  // 逐个校验：authorization 内手机号必须与 phone 字段一致
  const clean = incoming.map((a, i) => {
    if (!a || typeof a !== "object") throw new Error(`第 ${i + 1} 个账号格式错误`);
    const phone = String(a.phone || "").trim();
    const authorization = String(a.authorization || "").trim().replace(/^Basic\s+/i, "");
    if (!/^\d{6,15}$/.test(phone)) throw new Error(`第 ${i + 1} 个账号手机号格式错误`);
    const d = decodeAuth(authorization);
    if (d.phone !== phone) throw new Error(`第 ${i + 1} 个账号 authorization 内手机号(${d.phone})与 phone 字段(${phone})不一致`);
    return { ...a, phone, authorization };
  });

  const key = await deriveKey(dataKey);
  const STORE = path.join(__dirname, "../data/accounts.enc");
  let cur = [];
  try {
    const b = fs.readFileSync(STORE, "utf8").trim();
    if (b) {
      const arr = JSON.parse(await aesGcmDecryptText(key, b));
      if (Array.isArray(arr)) cur = arr;
    }
  } catch (e) {
    console.log("读取现有账号仓库失败（将视为空）:", String(e.message || e));
  }

  const map = new Map();
  for (const a of cur) map.set(String(a.phone).trim(), a);
  let added = 0, updated = 0;
  for (const a of clean) {
    const p = a.phone;
    if (map.has(p)) { map.set(p, { ...map.get(p), ...a }); updated++; }
    else { map.set(p, a); added++; }
  }
  const list = Array.from(map.values());

  fs.writeFileSync(STORE, await aesGcmEncryptText(key, JSON.stringify(list)), { encoding: "utf8", mode: 0o600 });
  console.log(`账号仓库更新完成：新增 ${added} / 覆盖 ${updated} / 合计 ${list.length}`);
  for (const a of list) console.log("  -", mask(a.phone), "| 有效期:", String(a.expires_at || "-"));
})().catch(e => {
  console.error("失败:", String(e.message || e));
  process.exit(1);
});
