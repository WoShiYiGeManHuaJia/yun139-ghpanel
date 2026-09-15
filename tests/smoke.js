const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { decodeAuth, rsaEncrypt, pkcs7Unpad, hexToBytes, aesEcbDecryptBytes, aesGcmEncryptText, aesGcmDecryptText, deriveKey, stableJsonStringify } = require('../actions/run.js');

(async () => {

const phone = '13800138000';
const token = 'TOKEN|1|RCS|1799999999999|payload';
const auth = Buffer.from(`pc:${phone}:${token}`, 'utf8').toString('base64');
const d = decodeAuth(auth);
assert.equal(d.phone, phone);
assert.equal(d.token, token);
assert.throws(() => decodeAuth('not-base64!!'));
assert.equal(Buffer.from(rsaEncrypt('9ec3874c5b705b9aeaffc80684f94ce59dd13dd78dfddf856081dbe4999c7c1382a335ee4fc73ed1a9efc6d923ce0862c703659e606e84df0e61f4bbf3d62e1ffa917906c70bb39d962b0b8a574d58f1d135461c3dad16de55d21b7fbcd425caec50d73ef5e8e6e6f0d86a956c8b1c70c6ab2357727d7762e084e2097be633dc1805d52cf725eda28ae1969c98508d8657c1cdb108d62bd3f94191d3de8c79432fa68d19afbfa4541492cf38c90e4bfa466740f00b5ca9159071b2d5b4fdfb55ba974e9865af5bb276fdedddab703f52f2240b861463f7622f5c22821271d46f4c89144e2128cd32f372503493a8f272e75ebe977b201c46dcd3aed0209c7635', 65537, phone), 'base64').length, 256);
assert.deepEqual(Buffer.from(hexToBytes('00ff10')), Buffer.from([0,255,16]));
assert.throws(() => hexToBytes('0'));
assert.deepEqual(pkcs7Unpad(new Uint8Array([...new Uint8Array(15).fill(1), 1])).length, 15);
assert.throws(() => pkcs7Unpad(new Uint8Array(16).fill(0)));

// 手写 AES-ECB 实现与 node:crypto 对照（关闭自动填充，逐字节一致才算通过，防原语回归）
const aesKey = crypto.randomBytes(24);            // AES-192，与 thirdPartyLogin 内层同规格
const aesPt = crypto.randomBytes(48);             // 16 的倍数
const aesCipher = crypto.createCipheriv('aes-192-ecb', aesKey, null);
aesCipher.setAutoPadding(false);
const aesCt = Buffer.concat([aesCipher.update(aesPt), aesCipher.final()]);
const aesDec = Buffer.from(aesEcbDecryptBytes(new Uint8Array(aesCt), new Uint8Array(aesKey)));
assert.equal(aesDec.equals(aesPt), true, 'AES-192-ECB 手写解密应与 node:crypto 一致');
const aesCipher2 = crypto.createCipheriv('aes-128-ecb', aesKey.subarray(0, 16), null);
aesCipher2.setAutoPadding(false);
const aesCt2 = Buffer.concat([aesCipher2.update(aesPt), aesCipher2.final()]);
const aesDec2 = Buffer.from(aesEcbDecryptBytes(new Uint8Array(aesCt2), new Uint8Array(aesKey.subarray(0, 16))));
assert.equal(aesDec2.equals(aesPt), true, 'AES-128-ECB 手写解密应与 node:crypto 一致');
assert.throws(() => aesEcbDecryptBytes(new Uint8Array(15), new Uint8Array(16)));

const key = await deriveKey('smoke-test-key');
const plain = JSON.stringify({ hello: '世界', n: 123 });
const cipher = await aesGcmEncryptText(key, plain);
assert.equal(await aesGcmDecryptText(key, cipher), plain);
assert.notEqual(await aesGcmEncryptText(key, plain), cipher);
assert.equal(stableJsonStringify({b:1,a:2}), '{"a":2,"b":1}');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
assert.match(html, /requestId/);
assert.doesNotMatch(html, /localStorage\.setItem\(LS_TOKEN/);
assert.doesNotMatch(html, /return;\s*applyCloudCache/);
assert.match(html, /armPending\(\{ type: "rtask"/);
assert.match(html, /armPending\(\{ type: "send_code", kind: "send" \}/);

const resultPath = require('node:path').join(__dirname, '../data/result.json');
assert.ok(fs.existsSync(resultPath));
console.log('PASS: smoke tests');
})().catch(err => { console.error(err); process.exit(1); });
