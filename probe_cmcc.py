import urllib.request, urllib.error, os, io, re, json
CK = os.environ.get("CMCC_COOKIE","")
PH = os.environ.get("CMCC_PHONE","")
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
out=[]
def p(s=""):
    out.append(str(s)); print(s, flush=True)
def get(u, ref=None, extra=None):
    h={"User-Agent":UA,"Accept":"text/html,application/xhtml+xml,application/json,*/*",
       "Accept-Language":"zh-CN,zh;q=0.9","Cookie":CK}
    if ref: h["Referer"]=ref
    if extra: h.update(extra)
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=h),timeout=45)
        return r.status, r.read().decode("utf-8","ignore"), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8","ignore"), u
    except Exception as e:
        return 0, "ERR "+str(e), u

p("Cookie 长度=%d  手机号=%s****%s" % (len(CK), PH[:3], PH[-4:] if PH else "?"))
p()
p("===== A. www.10086.cn 首页：是否认登录 =====")
s,b,fu = get("https://www.10086.cn/")
p("HTTP=%d 字节=%d 最终=%s" % (s,len(b),fu))
for kw in ["我的移动","欢迎","请登录","退出","个人中心"]:
    p("   含'%s': %s" % (kw, kw in b))
m=re.search(r'您的IP地址为\s*([0-9a-fA-F:.]+)', b)
p("   页面显示IP: %s" % (m.group(1) if m else "(无)"))
open("data/cm_home.html","w").write(b)
p()
p("===== B. 找'我的移动'链接 =====")
links=set()
for mm in re.finditer(r'href=["\']([^"\']+)["\'][^>]*>\s*([^<]{0,20})', b):
    u,t=mm.group(1),mm.group(2).strip()
    if any(k in t for k in ["我的移动","个人中心","我的","余额"]) or "my" in u.lower():
        links.add((u,t))
for u,t in list(links)[:15]: p("   %s  ->  %s" % (t,u))
p()
p("===== C. 我的移动 页面（DOM 里应有余额）=====")
cands=["https://www.10086.cn/my/","https://www.10086.cn/my/index.html",
       "https://www.10086.cn/personal/","https://www.10086.cn/mycenter/",
       "https://my.10086.cn/","https://www.10086.cn/i/"]
for u in cands:
    s2,b2,f2 = get(u, ref="https://www.10086.cn/")
    hit = [k for k in ["可用余额","账户总额","当月消费","语音剩余","流量剩余"] if k in b2]
    p("  HTTP=%d 字节=%d %s  命中:%s" % (s2,len(b2),u,hit))
    if hit:
        open("data/cm_my.html","w").write(b2)
        for k in hit:
            mm=re.search(k+r'[^0-9]{0,20}([0-9]+\.?[0-9]*)', b2)
            if mm: p("      %s = %s" % (k, mm.group(1)))
p()
p("===== D. touch 掌厅接口（旧路径对照）=====")
for u in ["https://touch.10086.cn/i/v1/fee/real/%s"%PH,
          "https://touch.10086.cn/i/v1/fee/planbal/%s"%PH,
          "https://touch.10086.cn/i/v1/cust/flowbalance/%s?channel=0705"%PH]:
    s3,b3,_ = get(u, ref="https://touch.10086.cn/i/")
    p("  HTTP=%d %s" % (s3, b3[:180].replace("\n"," ")))
p()
with io.open("data/probe_cmcc.txt","w",encoding="utf-8") as f: f.write("\n".join(out))
