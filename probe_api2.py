import urllib.request, urllib.error, os, io, json, base64, time
CK=os.environ.get("CMCC_COOKIE","")
UA=("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
PH="17274079953"
enc=base64.b64encode(base64.b64encode(PH.encode()).decode().encode()).decode()
out=[]
def p(s=""):
    out.append(str(s)); print(s,flush=True)
def get(u):
    h={"User-Agent":UA,"Accept":"application/json, text/plain, */*","Accept-Language":"zh-CN,zh;q=0.9",
       "Cookie":CK,"Referer":"https://touch.10086.cn/i/","X-Requested-With":"XMLHttpRequest"}
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=h),timeout=40)
        return r.status, r.read().decode("utf-8","ignore")
    except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8","ignore")
    except Exception as e: return 0,"ERR "+str(e)

p("明文=%s  一层b64=%s  两层b64=%s"%(PH, base64.b64encode(PH.encode()).decode(), enc))
p("抓包里的串 = RGhxY25xZklxVGQxd1BzVjRHdUhWUT09  匹配: %s"%(enc=="RGhxY25xZklxVGQxd1BzVjRHdUhWUT09"))
p()
ts=str(int(time.time()*1000))
T=[
 ("话费/客户信息", "https://touch.10086.cn/i/v1/fee/cusinfomerger/%s?time=%s&channel=02"%(enc,ts)),
 ("流量",         "https://touch.10086.cn/i/v1/cust/flow/flowInfoQry/%s?time=%s"%(enc,ts)),
 ("积分",         "https://touch.10086.cn/i/v1/cust/creditPointQry/%s?time=%s"%(enc,ts)),
 ("登录信息",     "https://touch.10086.cn/i/v1/auth/loginfo"),
 ("我的卡片",     "https://touch.10086.cn/i/v1/cust/mycard/%s?channel=02&time=%s"%(enc,ts)),
 ("旧real接口",   "https://touch.10086.cn/i/v1/fee/real/%s"%PH),
 ("旧planbal",    "https://touch.10086.cn/i/v1/fee/planbal/%s"%PH),
]
for name,u in T:
    s,b=get(u)
    p("--- %s"%name)
    p("    %s"%u[:150])
    p("    HTTP=%d len=%d"%(s,len(b)))
    p("    BODY: %s"%b[:1200].replace("\n"," "))
    p()
with io.open("data/probe_api2.txt","w",encoding="utf-8") as f: f.write("\n".join(out))
