import urllib.request, urllib.error, os, io, re, json
CK=os.environ.get("YUN139_COOKIE","")
UAW=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
     "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
UAM=("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
     "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
out=[]
def p(s=""):
    out.append(str(s)); print(s,flush=True)
def get(u,ua=UAW,ref="https://yun.139.com/m/"):
    h={"User-Agent":ua,"Accept":"application/json, text/plain, */*","Accept-Language":"zh-CN,zh;q=0.9",
       "Cookie":CK,"Referer":ref,"Origin":"https://yun.139.com"}
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=h),timeout=40)
        return r.status, r.read().decode("utf-8","ignore")
    except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8","ignore")
    except Exception as e: return 0,"ERR "+str(e)

p("云盘Cookie长度=%d"%len(CK))
p()
p("== A. 云盘首页 HTML 里有没有余额 ==")
for u in ["https://yun.139.com/m/","https://yun.139.com/m/#/main","https://yun.139.com/"]:
    s,b=get(u,ua=UAM)
    p("  HTTP=%d len=%d %s"%(s,len(b),u))
    for kw in ["话费","余额","流量","通话","积分"]:
        if kw in b: p("      含'%s'"%kw)
    if "话费" in b or "余额" in b: open("data/yun_home.html","w").write(b)
p()
p("== B. 云盘侧可能的余额/权益接口 ==")
cands=[
 "https://yun.139.com/orchestration/group-rebuild/member/v1.0/queryAvailableBenefit",
 "https://yun.139.com/orchestration/personal-rebuild/user/v1.0/queryUserInfo",
 "https://yun.139.com/orchestration/business-rebuild/balance/v1.0/query",
 "https://yun.139.com/orchestration/business-rebuild/fee/v1.0/queryBalance",
 "https://yun.139.com/orchestration/mobile-rebuild/fee/v1.0/queryFee",
 "https://yun.139.com/orchestration/mobile-rebuild/flow/v1.0/queryFlow",
 "https://user-njs.yun.139.com/user/getUser",
 "https://yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken",
]
for u in cands:
    s,b=get(u)
    p("  HTTP=%d %s"%(s, b[:220].replace("\n"," ")))
    p("       %s"%u.split("139.com")[1][:70])
p()
p("== C. 云盘首页 JS 里的 API 路径 ==")
s,b=get("https://yun.139.com/m/",ua=UAM)
paths=sorted(set(re.findall(r'["\'](/orchestration/[a-zA-Z0-9\-_/]+)["\']', b)))
for x in paths[:40]: p("   "+x)
p("   共%d条"%len(paths))
with io.open("data/probe_yun.txt","w",encoding="utf-8") as f: f.write("\n".join(out))
