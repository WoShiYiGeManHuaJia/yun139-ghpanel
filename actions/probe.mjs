const AUTH = process.env.YUN139_AUTHORIZATION || "";
const COOKIE = process.env.YUN139_COOKIE || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString(), probes: [] };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const A = "Basic " + String(AUTH).trim().replace(/^basic /i, "").replace(/^Basic /i, "");
const H = { "User-Agent": UA, "Authorization": A, "Cookie": COOKIE,
  "Accept": "application/json, text/plain, */*", "Content-Type": "application/json",
  "Referer": "https://yun.139.com/", "Origin": "https://yun.139.com", "X-Requested-With": "XMLHttpRequest" };
const cands = [
  ["GET","/orchestration/personalCloud/hcy/file/list"],
  ["GET","/hcy/file/list"],
  ["GET","/orchestration/hcy/file/list"],
  ["GET","/orchestration/personalCloud/new/file/list"],
  ["GET","/orchestration/personalCloud/file/v1.0/list"],
  ["GET","/orchestration/personalCloud/user/v1.0/getDisk"],
  ["GET","/orchestration/personalCloud/catalog/v1.0/getDisk"],
  ["POST","/orchestration/personalCloud/hcy/file/list"],
  ["POST","/hcy/file/list"],
  ["POST","/orchestration/personalCloud/upload/v1.0/getUploadUrl"],
  ["POST","/orchestration/personalCloud/upload/v1.0/createUploadTask"],
  ["POST","/hcy/file/upload"],
  ["GET","/orchestration/personalCloud/v1.0/getDiskInfo"],
];
async function main(){
  for(const [m,p] of cands){
    try{
      const r=await fetch("https://yun.139.com"+p,{
        method:m, headers:H,
        body: m==="POST"?JSON.stringify({parentFileId:"",pageNum:1,pageSize:20}):undefined,
        signal:AbortSignal.timeout(15000)});
      const t=(await r.text()).slice(0,220);
      out.probes.push({m,p,status:r.status,body:t});
    }catch(e){ out.probes.push({m,p,err:String(e&&e.message||e)}); }
  }
}
main().catch(e=>{out.fatal=String(e&&e.message||e);})
 .finally(async()=>{
   const fs=await import("fs");
   let d=JSON.stringify(out,null,1);
   if(PHONE) d=d.split(PHONE).join(PHONE.slice(0,3)+"****"+PHONE.slice(-4));
   d=d.replace(/[A-Za-z0-9_\-]{40,}/g,m=>m.slice(0,8)+"…(打码)");
   fs.writeFileSync(new URL("../data/probe.json",import.meta.url),d);
 });
