// 网络诊断：判断是移动服务器拒绝、还是 GitHub Actions 出口网络问题
const fs = require("node:fs");
const path = require("node:path");

const out = { steps: [] };
function log(s) { out.steps.push(String(s).slice(0, 400)); }

const TARGETS = [
  { name: "移动鉴权 orches.yun.139.com", url: "https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", method: "POST" },
  { name: "移动签到页 m.mcloud.139.com", url: "https://m.mcloud.139.com/portal/mobilecloud/index.html", method: "GET" },
  { name: "云朵接口 caiyun.feixin.10086.cn", url: "https://caiyun.feixin.10086.cn", method: "GET" },
  { name: "对照-公网 example.com", url: "https://example.com", method: "GET" },
  { name: "对照-GitHub api", url: "https://api.github.com", method: "GET" },
];

async function testOne(t) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(t.url, {
      method: t.method,
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
        "Accept": "*/*",
      },
    });
    clearTimeout(timer);
    log(`✅ ${t.name} → HTTP ${r.status}（${Date.now() - t0}ms）`);
  } catch (e) {
    clearTimeout(timer);
    const msg = String(e.message || e);
    const cause = e.cause ? (" cause=" + String(e.cause.code || e.cause.message || e.cause).slice(0, 80)) : "";
    log(`❌ ${t.name} → ${msg}（${Date.now() - t0}ms）${cause}`);
  }
}

async function main() {
  log("=== 网络诊断 " + new Date().toISOString() + " ===");
  // 1) DNS 解析测试
  try {
    const dns = require("node:dns").promises;
    for (const h of ["orches.yun.139.com", "m.mcloud.139.com", "example.com"]) {
      try {
        const r = await dns.lookup(h);
        log(`DNS ${h} → ${r.address}`);
      } catch (e) { log(`DNS ${h} 失败: ${e.code || e.message}`); }
    }
  } catch (e) { log("DNS 模块异常: " + e.message); }

  // 2) 连通性测试
  for (const t of TARGETS) {
    await testOne(t);
    await new Promise(r => setTimeout(r, 800));
  }

  const p = path.join(__dirname, "../data/probe_net.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { out.steps.push("FATAL: " + e.message); console.log(JSON.stringify(out, null, 2)); });
