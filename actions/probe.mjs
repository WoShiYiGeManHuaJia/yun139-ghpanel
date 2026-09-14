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
  JWT = j2.result.token;
}
async function req(p, host, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch((host === H7071 ? CY7071 : CY) + p, { headers: hJ(host), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t.slice(0, 600) };
    } catch (e) { last = e; await new Promise(r2 => setTimeout(r2, 1200 * (i + 1))); }
  }
  return { status: 0, raw: "失败:" + String((last && last.message) || last) };
}
const flat = (j) => { const a = []; for (const v of Object.values((j && j.result) || {})) if (Array.isArray(v)) for (const t of v) a.push(t); return a; };

async function main() {
  await getJwt(); log("jwt", "ok");
  // ① 领取前快照：找出所有任务的 state 与可疑"待领取"字段
  const before = await req("/market/signin/task/taskList?marketname=sign_in_3", HN, 3);
  const list0 = flat(before.j);
  log("① 任务数", list0.length);
  // 打印 106（刚完成的上传任务）完整字段，以及所有 state 分布
  const states = {};
  for (const t of list0) states[t.state] = (states[t.state] || 0) + 1;
  log("① state 分布", states);
  const t106 = list0.find(t => String(t.id) === "106");
  if (t106) { log("① 106(刚完成) 字段", { state: t106.state, currstep: t106.currstep, process: t106.process,
    cloudId: t106.cloudId, limitCloud: t106.limitCloud, recordid: t106.recordid, taskType: t106.taskType,
    hasNda: t106.hasNda, hasBak: t106.hasBak, stepTypeSet: JSON.stringify(t106.stepTypeSet),
    button: JSON.stringify(t106.button).slice(0,300), rule: JSON.stringify(t106.rule).slice(0,250),
    show: JSON.stringify(t106.show).slice(0,250) }); }
  // 找所有非 WAIT/FINISH 的任务（可能是待领取态）
  const odd = list0.filter(t => t.state !== "WAIT" && t.state !== "FINISH");
  log("① 异常 state 任务", odd.map(t => ({ id: t.id, name: String(t.name||"").replace(/<[^>]*>/g,""), state: t.state })));
  // ② 尝试一批领取接口（记录响应）
  const cands = [
    ["/market/signin/task/click?key=award&id=106", HN],
    ["/market/signin/task/click?key=receive&id=106", HN],
    ["/market/signin/task/click?key=cloud&id=106", HN],
    ["/market/signin/task/click?key=task&id=106", HN],
    ["/market/signin/page/receive", HN],
    ["/market/signin/task/receive?id=106", HN],
    ["/market/signin/task/award?id=106", HN],
    ["/market/signin/cloud/receive?id=106", HN],
    ["/market/signin/task/click?key=award&id=106", H7071],
    ["/market/signin/page/receive", H7071],
  ];
  const res = [];
  for (const [p, host] of cands) {
    const r = await req(p, host, 2);
    res.push({ p: p.slice(0, 60), host: host === H7071 ? ":7071" : "默认", status: r.status,
      code: r.j ? r.j.code : null, msg: r.j ? r.j.msg : null, body: r.raw.slice(0, 150) });
  }
  log("② 领取接口尝试", res);
  // ③ 领取后再查，看 state 是否变化
  const after = await req("/market/signin/task/taskList?marketname=sign_in_3", HN, 3);
  const list1 = flat(after.j);
  const a106 = list1.find(t => String(t.id) === "106");
  log("③ 106 领取后", a106 ? { state: a106.state, currstep: a106.currstep, cloudId: a106.cloudId } : "未找到");
  const states1 = {};
  for (const t of list1) states1[t.state] = (states1[t.state] || 0) + 1;
  log("③ state 分布(后)", states1);
  // 变化对比
  const diff = [];
  for (const t0 of list0) { const t1 = list1.find(x => String(x.id) === String(t0.id));
    if (t1 && JSON.stringify({s:t0.state,c:t0.currstep}) !== JSON.stringify({s:t1.state,c:t1.currstep}))
      diff.push({ id: t0.id, name: String(t0.name||"").replace(/<[^>]*>/g,""), from: t0.state+"/"+t0.currstep, to: t1.state+"/"+t1.currstep }); }
  log("③ 前后变化", diff.length ? diff : "无变化");
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
