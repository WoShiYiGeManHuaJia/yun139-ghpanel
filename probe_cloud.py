import urllib.request, urllib.error, os, io, re, json

CK = os.environ.get("CLOUD139_COOKIE","")
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
UAW = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
out=[]
def p(s=""): out.append(str(s)); print(s,flush=True)

def get(u, ua=UA, ref=None, hdrs=None):
    h={"User-Agent":ua,"Accept":"application/json, text/plain, */*",
       "Accept-Language":"zh-CN,zh;q=0.9","Cookie":CK,
       "Origin": "https://cloud.139.com" if "cloud.139.com" in u else "https://yun.139.com"}
    if ref: h["Referer"]=ref
    if hdrs: h.update(hdrs)
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=h),timeout=45)
        return r.status, r.read().decode("utf-8","ignore"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8","ignore"), dict(e.headers)
    except Exception as e:
        return 0, "ERR "+str(e), {}

p("Cookie 长度=%d" % len(CK))
p()
p("===== A. cloud.139.com 首页：判断是否登录 =====")
st,b,h = get("https://cloud.139.com/", ua=UAW)
p("HTTP=%d 字节=%d" % (st,len(b)))
for kw in ["登录","云手机","未登录","退出","中国移动","我的"]:
    p("   含 '%s' : %s" % (kw, kw in b))
p("   标题片段: %s" % (re.search(r'<title>(.*?)</title>',b,re.S).group(1).strip() if re.search(r'<title>(.*?)</title>',b,re.S) else "(无)"))
open("data/cloud_home.html","w").write(b)
p()
p("===== B. 云应用广场 / 应用列表 API 探测 =====")
cands = [
 "https://cloud.139.com/cloudapp/api/app/list",
 "https://cloud.139.com/api/cloudapp/list",
 "https://cloud.139.com/cloudphone/api/app/list",
 "https://cloud.139.com/cloudapp/api/list",
 "https://cloud.139.com/orchestration/cloudapp/v1.0/appList",
 "https://cloud.139.com/orchestration/cloudphone/v1.0/queryUserCloudPhone",
 "https://cloud.139.com/orchestration/cloudphone/v1.0/list",
]
for u in cands:
    s2,b2,_ = get(u, ua=UAW, ref="https://cloud.139.com/")
    p("  HTTP=%d %s" % (s2, b2[:130].replace("\n"," ")))
p()
p("===== C. 页面内 JS 里的 API 路径 =====")
for m in sorted(set(re.findall(r'["\'](/[a-z0-9\-_/]*(?:api|orchestration|v1\.0)[a-z0-9\-_/]*)["\']', b)))[:40]:
    p("   "+m)
p()
p("===== D. 云盘域：能否拿到话费/流量（对照）=====")
for u in ["https://yun.139.com/orchestration/auth-rebuild/token/v1.0/querySpecToken",
          "https://user-njs.yun.139.com/user/getUser",
          "https://yun.139.com/orchestration/group-rebuild/member/v1.0/queryAvailableBenefit"]:
    s3,b3,_ = get(u, ua=UAW, ref="https://yun.139.com/m/")
    p("  HTTP=%d %s" % (s3, b3[:200].replace("\n"," ")))
p()
with io.open("data/probe_cloud.txt","w",encoding="utf-8") as f: f.write("\n".join(out))
