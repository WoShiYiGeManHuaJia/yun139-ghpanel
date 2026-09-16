import urllib.request, urllib.error, os, io, re, json, base64
CK=os.environ.get("CMCC_COOKIE",""); PH=os.environ.get("CMCC_PHONE","")
UA=("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
out=[]
def p(s=""):
    out.append(str(s)); print(s,flush=True)
def get(u,ref=None,extra=None):
    h={"User-Agent":UA,"Accept":"application/json, text/plain, */*",
       "Accept-Language":"zh-CN,zh;q=0.9","Cookie":CK}
    if ref: h["Referer"]=ref
    if extra: h.update(extra)
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=h),timeout=45)
        return r.status, r.read().decode("utf-8","ignore")
    except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8","ignore")
    except Exception as e: return 0,"ERR "+str(e)

p("== 1. 取完整 outParam ==")
s,b = get("https://touch.10086.cn/i/v1/fee/real/%s"%PH, ref="https://touch.10086.cn/i/")
p("HTTP=%d  len=%d"%(s,len(b)))
op=""
try: op=json.loads(b)["data"]["outParam"]
except Exception as e: p("解析失败 "+str(e))
p("outParam 长度=%d"%len(op))
p("前200: "+op[:200])
open("data/outparam.txt","w").write(op)

p()
p("== 2. 基础解码尝试 ==")
for name,fn in [("base64",lambda x:base64.b64decode(x)),
                ("base64+urlsafe",lambda x:base64.urlsafe_b64decode(x+"="*(-len(x)%4)))]:
    try:
        d=fn(op); p("  %s -> %d 字节, 前80: %r"%(name,len(d),d[:80]))
    except Exception as e: p("  %s 失败: %s"%(name,e))

p()
p("== 3. 抓掌厅 JS 找 AES 密钥/算法 ==")
for u in ["https://touch.10086.cn/i/js/common.js","https://touch.10086.cn/i/js/aes.js",
          "https://touch.10086.cn/i/js/crypto.js","https://touch.10086.cn/i/js/config.js",
          "https://touch.10086.cn/i/js/app.js"]:
    s2,b2 = get(u, ref="https://touch.10086.cn/i/")
    if s2==200 and len(b2)>200:
        p("  %s OK %d 字节"%(u.split('/')[-1],len(b2)))
        for kw in ["AES","CryptoJS","outParam","decrypt","secretKey","iv","mode","padding"]:
            if kw in b2: p("     含 %s"%kw)
        open("data/js_%s"%u.split('/')[-1],"w").write(b2)
    else:
        p("  %s HTTP=%d"%(u.split('/')[-1],s2))

p()
p("== 4. 掌厅首页 HTML 里的 JS 引用 ==")
s3,b3 = get("https://touch.10086.cn/i/", ref="https://touch.10086.cn/")
p("首页 HTTP=%d len=%d"%(s3,len(b3)))
js=re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', b3)
for j in js[:30]: p("   "+j)
open("data/touch_home.html","w").write(b3)
with io.open("data/probe_dec.txt","w",encoding="utf-8") as f: f.write("\n".join(out))
