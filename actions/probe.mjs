const AUTH = process.env.YUN139_AUTHORIZATION || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), steps: [] };
const A = String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const UA = "Mozilla/5.0 (Linux; Android 12; Mi 10 Pro Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 MCloudApp/10.3.0";
const CY7071 = "https://caiyun.feixin.10086.cn:7071";
const MM = "https://m.mcloud.139.com", HM = "m.mcloud.139.com";
let JWT = "";
const hJ = () => ({ "User-Agent": UA, "Host": HM, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest", "jwtToken": JWT, "Cookie": "jwtToken=" + JWT });
const log = (k, v) => out.steps.push({ k, v });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJwt() {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken", {
        method: "POST", headers: { "Authorization": "Basic " + A, "Content-Type": "application/json", "Host": "orches.yun.139.com" },
        body: JSON.stringify({ account: PHONE, toSourceId: "001005" }), signal: AbortSignal.timeout(25000) });
      const j = await r.json();
      if (String(j.code) !== "0") throw new Error("code=" + j.code);
      const r2 = await fetch(`${CY7071}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(j.data.token)}`, { headers: { "Host": "caiyun.feixin.10086.cn:7071", "Accept": "*/*" }, signal: AbortSignal.timeout(25000) });
      const j2 = await r2.json();
      if (!j2 || !j2.result || !j2.result.token) throw new Error("无token");
      JWT = j2.result.token; return;
    } catch (e) { last = e; await sleep(2500 * (i + 1)); }
  }
  throw new Error("getJwt 失败");
}
async function G(p, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch(MM + p, { headers: hJ(), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t };
    } catch (e) { last = e; await sleep(1200); }
  }
  return { status: 0, j: null, raw: "失败" };
}
async function P(p, body, tries) {
  let last;
  for (let i = 0; i < (tries || 3); i++) {
    try { const r = await fetch(MM + p, { method: "POST", headers: { ...hJ(), "Content-Type": "application/json;charset=UTF-8" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, j, raw: t };
    } catch (e) { last = e; await sleep(1200); }
  }
  return { status: 0, j: null, raw: "失败" };
}
async function main() {
  await getJwt(); log("jwt", "ok");
  const b1 = await G("/ycloud/signin/page/getCloudNum", 3);
  const BEFORE = b1.j && b1.j.result;
  log("① 余额 BEFORE", BEFORE);
  // ★ infoV3 完整打印 receiveList
  const iv = await G("/ycloud/signin/page/infoV3?client=app", 3);
  const R = (iv.j && iv.j.result) || {};
  log("② toReceive", R.toReceive);
  log("② ★receiveList 原始", JSON.stringify(R.receiveList));
  log("② receiveList 类型", Array.isArray(R.receiveList) ? ("数组 len=" + R.receiveList.length) : typeof R.receiveList);
  const rl = Array.isArray(R.receiveList) ? R.receiveList : [];
  // ★ 按 receiveList 每项领取
  const results = [];
  for (const item of rl.slice(0, 10)) {
    const keys = Object.keys(item);
    const id = item.taskId || item.id || item.taskid;
    if (id === undefined) { results.push({ item, skip: "无 id 字段", keys }); continue; }
    const r = await G(`/ycloud/signin/page/receiveTask?taskId=${id}`, 3);
    results.push({ id, keys, code: r.j && r.j.code, msg: r.j && r.j.msg, result: r.j && r.j.result, raw: r.raw.slice(0, 140) });
    await sleep(700);
  }
  log("③ ★按 receiveList 领取", results);
  // 若 receiveList 为空，试 POST receiveV3
  if (rl.length === 0) {
    const rv = await P("/ycloud/signin/page/receiveV3", {}, 3);
    log("③ 备选 receiveV3(POST)", { status: rv.status, code: rv.j && rv.j.code, msg: rv.j && rv.j.msg, res: JSON.stringify(rv.j && rv.j.result).slice(0, 200) });
    const rv2 = await P("/ycloud/signin/page/receiveV3", { marketname: "sign_in_3" }, 2);
    log("③ 备选 receiveV3(marketname)", { status: rv2.status, code: rv2.j && rv2.j.code, msg: rv2.j && rv2.j.msg, res: JSON.stringify(rv2.j && rv2.j.result).slice(0, 200) });
  }
  // 再查余额
  const b2 = await G("/ycloud/signin/page/getCloudNum", 3);
  const AFTER = b2.j && b2.j.result;
  log("④ 余额 AFTER", AFTER);
  const iv2 = await G("/ycloud/signin/page/infoV3?client=app", 3);
  const R2 = (iv2.j && iv2.j.result) || {};
  log("⑤ 领取后 toReceive", R2.toReceive);
  log("⑥ ★结论", { before: BEFORE, after: AFTER, 变化: (BEFORE != null && AFTER != null) ? AFTER - BEFORE : "?",
    toReceive前: R.toReceive, toReceive后: R2.toReceive });
}
main().catch(e => { out.fatal = String(e && e.message || e); })
  .finally(async () => { const fs = await import("fs");
    let d = JSON.stringify(out, null, 1);
    if (PHONE) d = d.split(PHONE).join(PHONE.slice(0,3) + "****" + PHONE.slice(-4));
    d = d.replace(/[A-Za-z0-9_\-]{40,}/g, m => m.slice(0,8) + "…(打码)");
    fs.writeFileSync(new URL("../data/probe.json", import.meta.url), d); });
