// 探测 16 号会员日（mCloudDay）活动接口 —— 跑在 GitHub Actions（境外 IP 需验证）
import fs from "fs";
const RAW = process.env.PROBE_AUTH;
const PHONE = process.env.PROBE_PHONE;
const CY_HOSTS=["https://caiyun.feixin.10086.cn:7071","https://caiyun.feixin.10086.cn","https://yun.139.com"];
function cleanAuth(r){return String(r||"").replace(/\s+/g,"").replace(/^Basic\s+/i,"");}

async function getJwt(){
  const auth="Basic "+cleanAuth(RAW);
  const r=await fetch("https://orches.yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken",{
    method:"POST",
    headers:{Authorization:auth,"Content-Type":"application/json",Accept:"application/json","Host":"orches.yun.139.com",
      "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0"},
    body:JSON.stringify({account:PHONE,toSourceId:"001005"})});
  const j=await r.json();
  if(String(j.code)!=="0")throw new Error("querySpecToken code="+j.code+" raw="+JSON.stringify(j).slice(0,200));
  const sso=j.data&&j.data.token;
  for(const h of CY_HOSTS){
    try{
      const r2=await fetch(`${h}/portal/auth/tyrzLogin.action?ssoToken=${encodeURIComponent(sso)}`,{
        headers:{Host:h.replace("https://",""),Accept:"*/*","User-Agent":"okhttp/4.12.0"},signal:AbortSignal.timeout(20000)});
      const j2=await r2.json();
      if(j2&&j2.result&&j2.result.token)return {jwt:j2.result.token,host:h,sso};
    }catch(e){}
  }
  throw new Error("换 JWT 失败");
}

(async()=>{
  const out={ts:new Date().toISOString(),steps:[],found:[]};
  const L=(k,v)=>{out.steps.push(k+": "+v);console.log("■ "+k+": "+v);};
  try{
    const {jwt,host,sso}=await getJwt();
    L("JWT","获取成功 "+jwt.slice(0,30)+"... host="+host);
    out.jwtPrefix=jwt.slice(0,20);

    const H=(h)=>({Authorization:"Bearer "+jwt,Accept:"application/json, text/plain, */*",
      "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      "Content-Type":"application/json",...(h||{})});

    // 候选活动接口（猜路径 + 已知模式）
    const cands=[
      [host,"/portal/market/signin/task/taskList?marketname=mCloudDay"],
      [host,"/portal/market/signin/task/taskList?marketname=member_day"],
      [host,"/portal/market/signin/task/taskList?marketname=sign_in_3"],
      [host,"/portal/ycloud/memberday/page/info"],
      [host,"/portal/ycloud/memberday/page/index"],
      [host,"/portal/ycloud/memberday/page/prizeList"],
      [host,"/portal/ycloud/huiyuanri/page/info"],
      [host,"/portal/ycloud/signin/page/infoV3?client=app"],
      [host,"/portal/ycloud/signin/page/getCloudNum"],
      ["https://m.mcloud.139.com","/ycloud/memberday/page/info"],
      ["https://m.mcloud.139.com","/caiyunday/v1/page/info"],
    ];
    for(const [h,p] of cands){
      try{
        const r=await fetch(h+p,{headers:H(),signal:AbortSignal.timeout(15000)});
        const t=await r.text();
        const ok=r.ok&&t.trim().startsWith("{");
        L("GET "+p.slice(0,60), r.status+" "+(ok?t.slice(0,180):"非JSON/失败"));
        if(ok&&t.length>10&&!/"code"\s*:\s*"-?[1-9]/.test(t.slice(0,120))){
          out.found.push({host:h,path:p,resp:t.slice(0,500)});
        }
      }catch(e){L("GET "+p.slice(0,60),"异常 "+String(e.message).slice(0,50));}
    }
  }catch(e){L("致命错误",String(e.message).slice(0,200)); out.error=String(e.message);}
  console.log("\n===FOUND===");
  console.log(JSON.stringify(out.found,null,1).slice(0,2000));
  require("fs").writeFileSync("data/probe_mcd.json", JSON.stringify(out,null,2));
})();
