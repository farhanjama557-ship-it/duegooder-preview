// Minimal static server emulating Vercel's cleanUrls:true + trailingSlash:false
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const ROOT = process.argv[2] || '.', PORT = +(process.argv[3] || 8090);
const TYPES = {'.html':'text/html;charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'};
const send = (res, code, body, type) => { res.writeHead(code, {'Content-Type': type || 'text/plain'}); res.end(body); };
http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname);
  if (p.length > 1 && p.endsWith('/')) { res.writeHead(308, {Location: p.slice(0, -1)}); return res.end(); }   // trailingSlash:false
  if (p.endsWith('.html')) { res.writeHead(308, {Location: p.slice(0, -5) || '/'}); return res.end(); }        // cleanUrls redirect
  const base = path.join(ROOT, p);
  const candidates = p === '/' ? [path.join(ROOT, 'index.html')] : [base, base + '.html', path.join(base, 'index.html')];
  for (const f of candidates) {
    try { if (fs.statSync(f).isFile()) return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream'); } catch (e) {}
  }
  send(res, 404, 'Not found');
}).listen(PORT, () => console.log('vercel-emul on ' + PORT));
