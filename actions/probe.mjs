const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY7071 = "https://caiyun.feixin.10086.cn:7071", CY = "https://caiyun.feixin.10086.cn";
const H7071 = "caiyun.feixin.10086.cn:7071", HN = "caiyun.feixin.10086.cn";
const MM = "https://m.mcloud.139.com", HM = "m.mcloud.139.com";
let JWT = "";
const hJ = (host) => ({ "User-Agent": UA, "Host": host, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest", "jwtToken": JWT, "Cookie": "jwtToken=" + JWT });
const log = (k, v) => out.steps.push({ k, v });
async function getJwt() {
  const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
    method: "POST", headers: { "Authorization": "Basic " + A, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
    body: JSON.stringify({ account: PHONE, toSourceId: "001005" }) });
  const j = await r.json();
  if (String(j.code) !== "0") throw new Error("querySpecToken 失败 " + j.code);
  const r2 = await fetch(`${CY7071}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(j.data.token)}`, { headers: { "Host": H7071, "Accept": "*/*" }, signal: AbortSignal.timeout(20000) });
  const j2 = await r2.json();
  JWT = j2.result.token;
}
async function req(url, host, tries) {
  let last;
  for (let i = 0; i < (tries || 2); i++) {
    try { const r = await fetch(url, { headers: hJ(host), signal: AbortSignal.timeout(18000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t.slice(0, 350) };
    } catch (e) { last = e; await new Promise(z => setTimeout(z, 1000)); }
  }
  return { status: 0, raw: "失败:" + String(((last && last.message) || last) || "").slice(0, 80) };
}
const at = (base, host, p, tries) => req(base + p, host, tries);
async function main() {
  await getJwt(); log("jwt", "ok");
  // ★ 关键测试：m.mcloud.139.com 域名是否也认这套 API
  const t1 = await at(MM, HM, "/market/signin/task/taskList?marketname=sign_in_3", 2);
  log("★ m.mcloud taskList", { status: t1.status, code: t1.j ? t1.j.code : null, raw: t1.raw.slice(0, 200) });
  const t2 = await at(MM, HM, "/market/signin/page/info?client=app", 2);
  log("★ m.mcloud page/info", { status: t2.status, code: t2.j ? t2.j.code : null, raw: t2.raw.slice(0, 250) });
  const t3 = await at(MM, HM, "/market/signin/page/receive", 2);
  log("★ m.mcloud page/receive", { status: t3.status, code: t3.j ? t3.j.code : null, raw: t3.raw.slice(0, 250) });
  // prizeApi（待领取奖品）
  const t4 = await at(CY, HN, "/market/prizeApi/checkPrize/getUserPrizeLogPage?currPage=1&pageSize=15", 2);
  log("prizeApi 奖品记录", { status: t4.status, code: t4.j ? t4.j.code : null, raw: t4.raw.slice(0, 300) });
  // 云豆余额：试 m.mcloud 域
  const bal = [];
  for (const p of ["/market/signin/page/info", "/market/signin/user/cloud", "/market/signin/cloud/info",
                   "/market/signin/total", "/market/signin/index", "/market/signin/home",
                   "/market/signin/page/init", "/market/signin/page/home"]) {
    const r = await at(MM, HM, p, 1);
    if (r.status === 200) bal.push({ p, raw: r.raw.slice(0, 250) });
  }
  log("★ 余额接口(m.mcloud)", bal.length ? bal : "全部404");
  // 再试 caiyun 域的 page/info 各种变体
  const bal2 = [];
  for (const p of ["/market/signin/page/info?client=app&marketname=sign_in_3", "/market/signin/page/info?marketname=sign_in_3",
                   "/market/signin/page/info?client=app&sourceid=1427", "/market/signin/info?client=app"]) {
    const r = await at(CY, HN, p, 1);
    if (r.status === 200) bal2.push({ p, raw: r.raw.slice(0, 250) });
  }
  log("★ 余额接口(caiyun变体)", bal2.length ? bal2 : "全部404");
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
