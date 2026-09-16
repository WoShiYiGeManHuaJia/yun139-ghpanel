import urllib.request, urllib.error, os, re, io, ssl, base64, json

CK = os.environ.get("CMCC_CK2","")
PHONE = "17274079953"
UA = ("Mozilla/5.0 (Linux; Android 12; Mi 10 Pro) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")
out=[]
def p(s=""): out.append(str(s)); print(s,flush=True)

def ctx():
    c = ssl.create_default_context()
    c.check_hostname = False
    c.verify_mode = ssl.CERT_NONE
    try: c.options |= 0x4   # OP_LEGACY_SERVER_CONNECT
    except Exception: pass
    try: c.set_ciphers("DEFAULT@SECLEVEL=1")
    except Exception: pass
    return c

def get(u, ref=None, accept="text/html,application/xhtml+xml,*/*"):
    h={"User-Agent":UA,"Accept":accept,"Accept-Language":"zh-CN,zh;q=0.9",
       "Cookie":CK,"Connection":"keep-alive"}
    if ref: h["Referer"]=ref
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=h),timeout=45,context=ctx())
        return r.status, r.read().decode("utf-8","ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8","ignore")
    except Exception as e:
        return 0, "ERR "+str(e)

p("Cookie 长度=%d" % len(CK))
p()
p("===== A. www.10086.cn 首页（SSL 修复后）=====")
for u in ["https://www.10086.cn/","https://www.10086.cn/index.html"]:
    s,b = get(u)
    p("  [%d] %s 字节=%d" % (s,u,len(b)))
    if s==200:
        for kw in ["请登录","欢迎您","我的移动","个人中心","退出"]:
            p("      含 '%s': %s" % (kw, kw in b))
        ms = re.findall(r'>\s*([a-z0-9_\-]*my[a-z0-9_\-/]*\.html?)', b, re.I)[:10]
        p("      含 my 的链接: %s" % ms)
        a = re.findall(r'<a[^>]+href="([^"]+)"[^>]*>\s*(我的移动|个人中心|话费|余量)', b)
        p("      导航链接: %s" % a[:8])
        open("data/idx.html","w").write(b)
        break
p()
p("===== B. touch 接口：取完整 outParam =====")
for name,u in [("fee/real","https://touch.10086.cn/i/v1/fee/real/"+PHONE),
               ("fee/planbal","https://touch.10086.cn/i/v1/fee/planbal/"+PHONE)]:
    s,b = get(u, ref="https://touch.10086.cn/i/", accept="application/json, text/plain, */*")
    try:
        j=json.loads(b); op=(j.get("data") or {}).get("outParam","")
    except Exception:
        op=""
    p("  [%d] %s outParam长度=%d" % (s,name,len(op)))
    if op:
        open("data/op_%s.txt"%name.replace("/","_"),"w").write(op)
        raw=base64.b64decode(op+"==")
        p("      解码首32字节: %s" % repr(raw[:32]))
        p("      是否含明文数字: %s" % bool(re.search(rb'\d{2,}\.\d{2}', raw)))
p()
p("===== C. 尝试常见密钥解密 outParam =====")
try:
    from Crypto.Cipher import AES
    op=open("data/op_fee_real.txt").read() if os.path.exists("data/op_fee_real.txt") else ""
    if op:
        raw=base64.b64decode(op+"==")
        rd=re.search(r'rdmdmd5=([0-9A-Fa-f]{32})', CK)
        keys=[]
        if rd: keys.append(("rdmdmd5",rd.group(1).encode()))
        keys += [("rdmdmd5.lower",rd.group(1).lower().encode())] if rd else []
        for kn,k in keys:
            for mode,iv in [("ECB",None),("CBC",k[:16])]:
                try:
                    c=AES.new(k, AES.MODE_ECB if mode=="ECB" else AES.MODE_CBC, iv) if mode=="CBC" else AES.new(k, AES.MODE_ECB)
                    d=c.decrypt(raw[:len(raw)//16*16])
                    if re.search(rb'\d{2,}\.\d{2}', d): p("  ★ %s %s 疑似解密成功: %s"%(kn,mode,repr(d[:120])))
                except Exception as e: pass
        p("  (若无 ★ 则说明不是固定密钥 AES)")
except ImportError:
    p("  pycryptodome 未安装")
except Exception as e:
    p("  ERR %s"%e)

io.open("data/pm3.txt","w",encoding="utf-8").write("\n".join(out))
