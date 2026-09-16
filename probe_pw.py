import os, re, json, io
from playwright.sync_api import sync_playwright
CK=os.environ.get("CMCC_COOKIE",""); PH=os.environ.get("CMCC_PHONE","")
UA=("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
out=[]
def p(s=""):
    out.append(str(s)); print(s,flush=True)
cookies=[]
for part in CK.split(";"):
    if "=" in part:
        k,v=part.strip().split("=",1)
        if k: cookies.append({"name":k,"value":v,"domain":".10086.cn","path":"/"})

URLS=[
 "https://touch.10086.cn/i/",
 "https://touch.10086.cn/i/mybalance.html",
 "https://touch.10086.cn/i/balance.html",
 "https://touch.10086.cn/i/home.html",
 "https://touch.10086.cn/i/index.html",
]
KWS=["可用余额","账户余额","话费余额","余额","流量","语音","套餐","剩余","当月消费","积分"]

with sync_playwright() as pw:
    br=pw.chromium.launch(args=["--no-sandbox"])
    ctx=br.new_context(user_agent=UA, locale="zh-CN", viewport={"width":390,"height":844})
    ctx.add_cookies(cookies)
    pg=ctx.new_page()
    api=[]
    pg.on("response", lambda r: api.append((r.status,r.url)) if ("json" in (r.headers.get("content-type") or "") or "/v1/" in r.url) else None)
    for u in URLS:
        p("--- %s"%u)
        try:
            pg.goto(u, wait_until="networkidle", timeout=60000)
        except Exception as e:
            p("   goto: %s"%e)
        try: pg.wait_for_timeout(4000)
        except Exception: pass
        try: txt=pg.inner_text("body")
        except Exception: txt=""
        p("   title=%s"%(pg.title() or ""))
        p("   文本长度=%d"%len(txt))
        hits=[]
        for kw in KWS:
            for m in re.finditer(re.escape(kw), txt):
                seg=txt[max(0,m.start()-15):m.start()+45].replace("\n"," ")
                hits.append(seg); break
        for h in hits[:12]: p("      | %s"%h)
        if hits:
            open("data/pw_%s.txt"%u.split("/")[-1],"w").write(txt)
        p("   抓到API %d 条"%len(api))
    p()
    p("== 本轮 API 清单 ==")
    seen=set()
    for st,u in api:
        if u in seen: continue
        seen.add(u); p("   %d %s"%(st,u[:150]))
    ctx.close(); br.close()
with io.open("data/probe_pw.txt","w",encoding="utf-8") as f: f.write("\n".join(out))
