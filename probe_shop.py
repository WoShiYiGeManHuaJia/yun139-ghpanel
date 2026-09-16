import os, io, time
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
TARGETS=[
 ("shop余量","https://shop.10086.cn/i/?f=packremainqry"),
 ("shop我的移动","https://shop.10086.cn/i/?f=home"),
 ("touch掌厅","https://touch.10086.cn/i/"),
]
with sync_playwright() as pw:
    br=pw.chromium.launch(args=["--no-sandbox"])
    ctx=br.new_context(user_agent=UA, locale="zh-CN", viewport={"width":390,"height":844}, is_mobile=True, has_touch=True)
    ctx.add_cookies(cookies)
    pg=ctx.new_page()
    apis={}
    def on_resp(r):
        u=r.url
        if "/v1/" in u or "json" in ((r.headers or {}).get("content-type") or ""):
            apis[u]=r.status
    pg.on("response", on_resp)
    for name,u in TARGETS:
        p(); p("=== %s ==="%name); p("URL: %s"%u)
        try:
            pg.goto(u, wait_until="domcontentloaded", timeout=90000)
        except Exception as e: p("goto: %s"%str(e)[:120])
        pg.wait_for_timeout(18000)
        try: pg.mouse.wheel(0,1000)
        except Exception: pass
        pg.wait_for_timeout(6000)
        p("title: %s"%pg.title())
        try:
            txt=pg.inner_text("body")
        except Exception:
            txt=""
        p("文本长度=%d"%len(txt))
        for line in txt.split("\n"):
            L=line.strip()
            if not L: continue
            if any(k in L for k in ["元","GB","MB","分钟","余额","流量","语音","登录","验证","欢迎"]):
                p("  | %s"%L[:110])
    p(); p("== API 清单 ==")
    for u,s in apis.items(): p("  %s %s"%(s,u[:150]))
    ctx.close(); br.close()
with io.open("data/probe_shop.txt","w",encoding="utf-8") as f: f.write("\n".join(out))
