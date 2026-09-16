import urllib.request, urllib.error, os, re, io, ssl, json

CK = os.environ.get("CMCC_CK2","")
UA = ("Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")
out=[]
def p(s=""): out.append(str(s)); print(s,flush=True)

def ctx():
    c=ssl.create_default_context(); c.check_hostname=False; c.verify_mode=ssl.CERT_NONE
    try: c.options|=0x4
    except Exception: pass
    try: c.set_ciphers("DEFAULT@SECLEVEL=1")
    except Exception: pass
    return c

def get(u, ref=None, accept="*/*"):
    h={"User-Agent":UA,"Accept":accept,"Accept-Language":"zh-CN,zh;q=0.9","Cookie":CK}
    if ref: h["Referer"]=ref
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=h),timeout=45,context=ctx())
        return r.status, r.read().decode("utf-8","ignore")
    except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8","ignore")
    except Exception as e: return 0, "ERR "+str(e)

p("===== 1. 湖南首页：找「我的移动」入口 =====")
s,b = get("http://www.10086.cn/index/hn")
p("  [%d] 字节=%d" % (s,len(b)))
if s==200:
    for m in re.findall(r'<a[^>]+href="([^"]*)"[^>]*>\s*([^<]{0,16})', b):
        if any(k in m[1] for k in ["我的移动","个人中心","话费","余量","账单","余额"]):
            p("   链接: %s  -> %s" % (m[1].strip(), m[0]))
    open("data/hn.html","w").write(b)

p()
p("===== 2. 掌厅 JS 里找解密逻辑 =====")
urls = ["https://touch.10086.cn/i/", "https://touch.10086.cn/i/home.html"]
jsset=set()
for u in urls:
    s,b = get(u)
    p("  [%d] %s 字节=%d" % (s,u,len(b)))
    if s==200:
        for s2 in re.findall(r'<script[^>]+src="([^"]+)"', b): jsset.add(s2)
p("  发现 JS: %d 个" % len(jsset))
for j in sorted(jsset)[:25]: p("    "+j)

KEYW = re.compile(r'outParam|decrypt|Decrypt|CryptoJS|AES|MODE_|padding|Utf8\.parse|enc\.|iv:|key:', re.I)
hits=[]
for j in sorted(jsset):
    if not j.startswith("http"):
        j = "https://touch.10086.cn" + j if j.startswith("/") else "https://touch.10086.cn/i/"+j
    s,b = get(j, ref="https://touch.10086.cn/i/", accept="application/javascript,*/*")
    if s!=200 or not b: continue
    if "outParam" in b or "decrypt" in b.lower():
        p("  ★ %s (字节=%d) 含解密关键词" % (j.split('/')[-1], len(b)))
        open("data/js_%s.js" % re.sub(r'[^a-z0-9]','_',j.split('/')[-1])[:40], "w").write(b)
        for m in re.finditer(r'.{160}(outParam|decrypt|Cipher|Utf8\.parse).{200}', b, re.I|re.S):
            hits.append(j.split('/')[-1]+" :: "+m.group(0).replace("\n"," ")[:340])
p()
p("===== 3. 关键片段（前 25 条）=====")
for h in hits[:25]: p("  --- "+h)

io.open("data/hunt.txt","w",encoding="utf-8").write("\n".join(out))
