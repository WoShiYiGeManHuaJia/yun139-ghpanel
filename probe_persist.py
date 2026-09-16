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
LONG=["defaultloginuser_p","rdmdmd5","WT_FPC","gdp_user_id"]
p("== 长效凭证是否存在 ==")
names={c["name"] for c in cookies}
for k in LONG: p("  %-20s %s"%(k, "有" if k in names else "无"))
p()
TARGETS=[
 ("登录首页(带记住我)", "https://login.10086.cn/"),
 ("掌厅(经登录跳转)",  "https://touch.10086.cn/i/"),
]
with sync_playwright() as pw:
    br=pw.chromium.launch(args=["--no-sandbox"])
    ctx=br.new_context(user_agent=UA, locale="zh-CN", viewport={"width":390,"height":844}, is_mobile=True, has_touch=True)
    ctx.add_cookies(cookies)
    pg=ctx.new_page()
    for name,u in TARGETS:
        p(); p("=== %s ==="%name); p("URL: %s"%u)
        try: pg.goto(u, wait_until="domcontentloaded", timeout=90000)
        except Exception as e: p("goto: %s"%str(e)[:100])
        pg.wait_for_timeout(15000)
        p("title: %s"%pg.title())
        p("最终URL: %s"%pg.url[:130])
        try:
            ck={c["name"]:c["value"][:28] for c in ctx.cookies()}
            p("现有cookie: %s"%", ".join(sorted(ck)))
            for k in ["c","cmccssotoken","jsessionid-cmcc","is_login"]:
                if k in ck: p("   %s = %s..."%(k,ck[k]))
        except Exception as e: p("cookie读失败 %s"%e)
        try:
            txt=pg.inner_text("body")
            p("文本长度=%d"%len(txt))
            for line in txt.split("\n"):
                L=line.strip()
                if L and any(k in L for k in ["元","GB","MB","分钟","余额","流量","语音","登录"]):
                    p("  | %s"%L[:100])
        except Exception: pass
        # 若在登录页，尝试点一下"短信随机码登录"看是否自动带出号码
        if "登录" in pg.title():
            p(">> 仍在登录页，检查是否自动识别号码")
            try:
                v=pg.eval_on_selector_all("input","els=>els.map(e=>e.value)")
                p("   input值: %s"%[x for x in v if x])
            except Exception: pass
    ctx.close(); br.close()
with io.open("data/probe_persist.txt","w",encoding="utf-8") as f: f.write("\n".join(out))
