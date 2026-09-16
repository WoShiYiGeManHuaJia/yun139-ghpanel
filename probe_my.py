import urllib.request, urllib.error, os, re, io, json

CK = os.environ.get("CMCC_CK2","")
UA = ("Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")
UAD= ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
PHONE = "17274079953"
out=[]
def p(s=""): out.append(str(s)); print(s,flush=True)

def get(u, ua=UA, ref=None, accept="text/html,application/xhtml+xml,*/*"):
    h={"User-Agent":ua,"Accept":accept,"Accept-Language":"zh-CN,zh;q=0.9","Cookie":CK}
    if ref: h["Referer"]=ref
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=h),timeout=45)
        return r.status, r.read().decode("utf-8","ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8","ignore")
    except Exception as e:
        return 0, "ERR "+str(e)

MONEY = re.compile(r'([\d]+\.?\d*)\s*元')
KEY = ["可用余额","账户总额","当月消费","语音剩余","流量剩余","套餐余量","152.87","258.07","75.20","698"]

p("Cookie 长度=%d" % len(CK))
p()
p("===== A. 个人中心页面候选（看是否 SSR 出数字）=====")
cands = [
 "https://www.10086.cn/my/",
 "https://www.10086.cn/my/index.html",
 "https://www.10086.cn/personal/",
 "https://www.10086.cn/personal/index.html",
 "https://www.10086.cn/index.html",
 "https://www.10086.cn/",
 "https://shop.10086.cn/i/?f=home",
 "https://shop.10086.cn/i/",
]
for u in cands:
    s,b = get(u, ua=UA)
    hit=[k for k in KEY if k in b]
    p("  [%d] %-45s 字节=%-7d 命中=%s" % (s, u.replace("https://",""), len(b), ",".join(hit) if hit else "无"))
    if hit:
        p("      >>> 页面有数据！保存 HTML")
        open("data/my_%s.html" % u.replace("https://","").replace("/","_"),"w").write(b)
        # 提取金额上下文
        for m in re.finditer(r'.{40}(152\.87|258\.07|75\.20|698).{40}', b):
            p("      片段: %s" % m.group(0).replace("\n"," ").strip()[:110])
p()
p("===== B. touch 掌厅 v1 接口（带新 Cookie 重试）=====")
apis = [
 "https://touch.10086.cn/i/v1/fee/real/"+PHONE,
 "https://touch.10086.cn/i/v1/fee/planbal/"+PHONE,
 "https://touch.10086.cn/i/v1/cust/flowbalance/"+PHONE+"?channel=0705",
 "https://touch.10086.cn/i/v1/cust/userFlowInfoQry/"+PHONE,
]
for u in apis:
    s,b = get(u, ua=UA, ref="https://touch.10086.cn/i/", accept="application/json, text/plain, */*")
    p("  [%d] %s" % (s, u.split('/i')[-1]))
    p("       %s" % b[:220].replace("\n"," "))
p()
p("===== C. 10086.cn 自有余量接口探测 =====")
for u in ["https://www.10086.cn/api/my/balance",
          "https://www.10086.cn/my/api/balance",
          "https://www.10086.cn/rest/my/balance",
          "https://shop.10086.cn/i/v1/fee/real/"+PHONE]:
    s,b = get(u, ua=UA, accept="application/json, text/plain, */*")
    p("  [%d] %-50s %s" % (s, u.replace("https://",""), b[:150].replace("\n"," ")))

io.open("data/probe_my.txt","w",encoding="utf-8").write("\n".join(out))
