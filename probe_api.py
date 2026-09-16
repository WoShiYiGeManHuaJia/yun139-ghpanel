import os, re, json, io
from playwright.sync_api import sync_playwright
CK=os.environ.get("CMCC_COOKIE","")
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
WANT=["cusinfomerger","flowInfoQry","creditPointQry","loginfo","mycard","optInfoQry"]
with sync_playwright() as pw:
    br=pw.chromium.launch(args=["--no-sandbox"])
    ctx=br.new_context(user_agent=UA, locale="zh-CN", viewport={"width":390,"height":844}, is_mobile=True, has_touch=True)
    ctx.add_cookies(cookies)
    pg=ctx.new_page()
    hits={}
    def on_resp(r):
        u=r.url()
        if not any(w in u for w in WANT): return
        try:
            ct=r.headers().get("content-type") or ""
            if "json" not in ct: return
            b=r.text()
        except Exception: return
        hits[u]=b
    pg.on("response", on_resp)
    try:
        pg.goto("https://touch.10086.cn/i/", wait_until="domcontentloaded", timeout=90000)
    except Exception as e: p("goto: %s"%e)
    pg.wait_for_timeout(20000)
    try: pg.mouse.wheel(0,1200)
    except Exception: pass
    pg.wait_for_timeout(8000)
    p("== 抓到 %d 条目标 API =="%len(hits))
    for u,b in hits.items():
        p()
        p("URL: %s"%u[:170])
        p("BODY(%d): %s"%(len(b), b[:1400].replace("\n"," ")))
    ctx.close(); br.close()
with io.open("data/probe_api.txt","w",encoding="utf-8") as f: f.write("\n".join(out))
