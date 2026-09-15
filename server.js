const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const mime = { '.html':'text/html; charset=utf-8', '.png':'image/png', '.json':'application/json; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.md':'text/plain; charset=utf-8' };

function safePath(urlPath) {
  let pathname;
  try { pathname = decodeURIComponent((urlPath || '/').split('?')[0]); }
  catch { return null; } // 非法 % 编码按 400 拒绝，而不是 500
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.resolve(root, rel);
  return full.startsWith(root + path.sep) ? full : null;
}

const server = http.createServer((req, res) => {
  try {
    if (req.url === '/healthz') {
      res.writeHead(200, {'content-type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ok:true}));
      return;
    }
    const file = safePath(req.url);
    if (!file) { res.writeHead(400); res.end('Bad Request'); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, {'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-cache'});
      fs.createReadStream(file).pipe(res);
    });
  } catch { res.writeHead(500); res.end('Internal Server Error'); }
});
server.listen(port, host, () => console.log(`yun139 panel listening on http://${host}:${port}`));
