#!/usr/bin/env node
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

(async () => {
const [oldKey, newKey] = process.argv.slice(2);
if (!oldKey || !newKey || oldKey.length < 16 || newKey.length < 16) {
  console.error('用法: node tools/rotate-data-key.js <旧DATA_KEY> <新DATA_KEY>');
  process.exit(2);
}
const file = path.join(__dirname, '../data/accounts.enc');
const raw = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
if (raw.length < 13) throw new Error('accounts.enc 格式无效');
const oldHash = crypto.createHash('sha256').update(oldKey, 'utf8').digest();
const newHash = crypto.createHash('sha256').update(newKey, 'utf8').digest();
const key1 = await crypto.webcrypto.subtle.importKey('raw', oldHash, 'AES-GCM', false, ['decrypt']);
const plain = await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key1, raw.subarray(12));
JSON.parse(Buffer.from(plain).toString('utf8'));
const key2 = await crypto.webcrypto.subtle.importKey('raw', newHash, 'AES-GCM', false, ['encrypt']);
const iv = crypto.webcrypto.getRandomValues(new Uint8Array(12));
const cipher = await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key2, plain);
const tmp = path.join(__dirname, '../data/accounts.enc.tmp');
fs.writeFileSync(tmp, Buffer.concat([Buffer.from(iv), Buffer.from(cipher)]).toString('base64'), { mode: 0o600 });
fs.renameSync(tmp, file);
console.log('账号数据已成功迁移到新 DATA_KEY。请同时更新 GitHub Secret PANEL_DATA_KEY 和面板中的 DATA_KEY。');
})().catch(err => { console.error('ERROR:', err.message || err); process.exit(1); });
