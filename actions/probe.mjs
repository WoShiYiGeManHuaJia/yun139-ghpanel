const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY7071 = "https://caiyun.feixin.10086.cn:7071", CY = "https://caiyun.feixin.10086.cn";
const H7071 = "caiyun.feixin.10086.cn:7071", HN = "caiyun.feixin.10086.cn";
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
  if (!j2 || !j2.result || !j2.result.token) throw new Error("tyrzLogin 失败");
  JWT = j2.result.token;
}
async function req(p, host, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch((host === H7071 ? CY7071 : CY) + p, { headers: hJ(host), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t.slice(0, 400) };
    } catch (e) { last = e; await new Promise(r2 => setTimeout(r2, 1200 * (i + 1))); }
  }
  return { status: 0, raw: "失败:" + String((last && last.message) || last) };
}
async function main() {
  await getJwt(); log("jwt", "ok");
  // 不同 marketname 的任务列表
  for (const mn of ["sign_in_3", "newsign_139mail", "sign_in_4", "sign_in"]) {
    const r = await req(`/market/signin/task/taskList?marketname=${mn}`, HN, 2);
    if (r.status === 200 && r.j && String(r.j.code) === "0") {
      const res = r.j.result || {};
      const groups = {};
      for (const [k, v] of Object.entries(res)) {
        if (Array.isArray(v)) groups[k] = v.map(t => ({ id: t.id, name: String(t.name||"").replace(/<[^>]*>/g,""), state: t.state, currstep: t.currstep, step: (t.stepTypeSet||[]).join("/"), reward: t.content_display2||"" }));
        else groups[k] = { _type: typeof v, _val: JSON.stringify(v).slice(0, 150) };
      }
      log("marketname=" + mn, groups);
    } else log("marketname=" + mn, { status: r.status, raw: r.raw.slice(0, 120) });
  }
  // 拿一个 FINISH 任务的完整 button 字段（找气泡 link）
  const r = await req("/market/signin/task/taskList?marketname=sign_in_3", HN, 3);
  const all = [];
  for (const arr of Object.values((r.j && r.j.result) || {})) if (Array.isArray(arr)) for (const t of arr) all.push(t);
  const fin = all.find(t => t.state === "FINISH" && t.content_display2);
  if (fin) {
    log("FINISH任务完整", { id: fin.id, name: String(fin.name||"").replace(/<[^>]*>/g,""), state: fin.state,
      currstep: fin.currstep, process: fin.process, cloudId: fin.cloudId, limitCloud: fin.limitCloud,
      recordid: fin.recordid, hasNda: fin.hasNda, hasBak: fin.hasBak, taskType: fin.taskType,
      button: JSON.stringify(fin.button).slice(0, 400), rule: JSON.stringify(fin.rule).slice(0, 200),
      show: JSON.stringify(fin.show).slice(0, 200) });
  }
  // 试 hecheng1T 在 7071
  const hc = await req("/market/signin/hecheng1T/info?op=info", H7071, 2);
  log("云朵大作战[:7071]", { status: hc.status, raw: hc.raw.slice(0, 200) });
  // 试 prizeApi（待领取奖品）
  const pz = await req("/market/prizeApi/checkPrize/getUserPrizeLogPage?currPage=1&pageSize=15", HN, 2);
  log("待领取奖品", { status: pz.status, raw: pz.raw.slice(0, 300) });
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
