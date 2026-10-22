import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml',
  '.wav':'audio/wav', '.mp3':'audio/mpeg', '.ttf':'font/ttf', '.woff':'font/woff', '.woff2':'font/woff2', '.ico':'image/x-icon' };
const directories = new Set(['src','assets','generated','config']);

export function createDevServer(root = projectRoot) {
  const realRoot = fs.realpathSync(root);
  return http.createServer((request,response) => {
    try {
      if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const url = new URL(request.url, 'http://127.0.0.1');
      const name = decodeURIComponent(url.pathname);
      if (name.includes('\\') || name.includes('\0') || name.split('/').some(p=>p.startsWith('.'))) {
        response.writeHead(404); response.end('Not found'); return;
      }
      const relative = name === '/' ? 'index.html' : name.replace(/^\/+/, '');
      if (relative !== 'index.html' && !directories.has(relative.split('/')[0])) {
        response.writeHead(404); response.end('Not found'); return;
      }
      const file = path.resolve(realRoot,relative);
      if (!file.startsWith(realRoot+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404); response.end('Not found'); return;
      }
      const realFile = fs.realpathSync(file);
      if (!realFile.startsWith(realRoot+path.sep) || !mime[path.extname(file)] || path.extname(file)==='.swf') {
        response.writeHead(404); response.end('Not found'); return;
      }
      response.writeHead(200, {'Content-Type':mime[path.extname(file)], 'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
        'Content-Security-Policy': "frame-ancestors 'none'"});
      if (request.method==='HEAD') response.end(); else fs.createReadStream(realFile).pipe(response);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--port');
  const port=index>=0 ? Number(process.argv[index+1]) : 51286;
  if (!Number.isInteger(port) || port<0 || port>65535) throw new Error('Invalid port');
  const server=createDevServer();
  server.listen(port,'127.0.0.1',()=>{
    const actual=server.address().port;
    fs.mkdirSync(path.join(projectRoot,'.local'),{recursive:true});
    fs.writeFileSync(path.join(projectRoot,'.local/dev-server.json'),JSON.stringify({pid:process.pid,url:`http://127.0.0.1:${actual}/`},null,2));
    console.log(`Super Miragine War development server: http://127.0.0.1:${actual}/`);
  });
}
