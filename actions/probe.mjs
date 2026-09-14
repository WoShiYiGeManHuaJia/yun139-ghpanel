const AUTH = process.env.YUN139_AUTHORIZATION || "";
const COOKIE = process.env.YUN139_COOKIE || "";
const PHONE = process.env.YUN139_PHONE || "";
const out = { ts: new Date().toISOString() };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const B = "https://caiyun.feixin.10086.cn:7071";
const add = (k,v)=>{ out[k]=v; };

// 1) 续期测试：能否延长令牌
async function testRefresh(){
  try{
    const raw=String(AUTH).trim().replace(/^basic /i,"").replace(/^Basic /i,"");
    const dec=Buffer.from(raw,"base64").toString("utf8");
    const token=dec.split(":").slice(2).join(":");
    const body=`<root><token>${token}</token><account>${PHONE}</account><clienttype>656</clienttype></root>`;
    const r=await fetch("https://aas.caiyun.feixin.10086.cn:443/tellin/authTokenRefresh.do",{
      method:"POST",
      headers:{"Content-Type":"application/xml;charset=UTF-8","User-Agent":"okhttp/4.12.0","Accept":"application/xml"},
      body, signal:AbortSignal.timeout(20000)});
    const t=await r.text();
    const mRet=t.match(/<return[^>]*>([^<]*)<\/return>/);
    const mTok=t.match(/<token[^>]*>([^<]*)<\/token>/);
    const mDesc=t.match(/<desc[^>]*>([^<]*)<\/desc>/);
    add("refresh",{ok:mRet&&mRet[1]==="0",ret:mRet?mRet[1]:"?",desc:mDesc?mDesc[1]:"",hasNew:!!mTok});
    if(mTok){
      const s=mTok[1].split("|");
      if(s.length>=4) add("refresh_new_expire", new Date(parseInt(s[3],10)).toISOString());
    }
    add("refresh_raw_sample", t.slice(0,120));
  }catch(e){ add("refresh_err",String(e&&e.message||e)); }
}

// 2) 从 yun.139.com 网页 JS 找上传接口
async function findUpload(){
  const found=new Set();
  try{
    const pr=await fetch("https://yun.139.com/",{headers:{"User-Agent":UA},signal:AbortSignal.timeout(20000)});
    const html=await pr.text();
    add("web_status",pr.status);
    const srcs=[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m=>m[1]);
    add("web_scripts",srcs);
    for(const s of srcs.slice(0,20)){
      let u; try{ u=new URL(s,"https://yun.139.com/").href; }catch{ continue; }
      try{
        const rr=await fetch(u,{headers:{"User-Agent":UA},signal:AbortSignal.timeout(20000)});
        if(!rr.ok) continue;
        const js=await rr.text();
        if(js.length>5_000_000) continue;
        for(const m of js.matchAll(/["'`]([^"'`]*(?:upload|Upload|UPLOAD)[A-Za-z0-9_\/\-\.\?&=]{0,90})["'`]/g)){
          if(m[1].length>6 && m[1].length<130) found.add(m[1]);
        }
      }catch(e){}
    }
  }catch(e){ add("web_err",String(e&&e.message||e)); }
  add("upload_paths",[...found].slice(0,60));
}

// 3) 试候选上传接口
async function tryUpload(jwt){
  const H={"User-Agent":UA,"Cookie":COOKIE,"Accept":"application/json, text/plain, */*",
    "Content-Type":"application/json","Referer":"https://yun.139.com/","Origin":"https://yun.139.com"};
  const cands=[
    ["GET","https://yun.139.com/orchestration/personalCloud/user/v1.0/getDiskInfo"],
    ["GET","https://yun.139.com/orchestration/personalCloud/catalog/v1.0/getUserCatalog"],
    ["POST","https://yun.139.com/orchestration/file-upload/uploadFile"],
    ["POST","https://yun.139.com/orchestration/file-upload/v1.0/uploadFile"],
    ["POST","https://yun.139.com/orchestration/personalCloud/file/v1.0/upload"],
    ["POST","https://yun.139.com/orchestration/upload/uploadFile"],
  ];
  const res=[];
  for(const [m,u] of cands){
    try{
      const r=await fetch(u,{method:m,headers:H,body:m==="POST"?"{}":undefined,signal:AbortSignal.timeout(15000)});
      const t=(await r.text()).slice(0,180);
      res.push({m,u:u.replace("https://yun.139.com",""),status:r.status,body:t});
    }catch(e){ res.push({m,u:u.replace("https://yun.139.com",""),err:String(e&&e.message||e)}); }
  }
  add("upload_probe",res);
}
async function main(){
  await testRefresh();
  await findUpload();
  await tryUpload("");
}
main().catch(e=>{out.fatal=String(e&&e.message||e);})
 .finally(async()=>{
   const fs=await import("fs");
   let d=JSON.stringify(out,null,1);
   if(PHONE) d=d.split(PHONE).join(PHONE.slice(0,3)+"****"+PHONE.slice(-4));
   d=d.replace(/[A-Za-z0-9_\-]{40,}/g,m=>m.slice(0,8)+"…(打码)");
   fs.writeFileSync(new URL("../data/probe.json",import.meta.url),d);
 });
