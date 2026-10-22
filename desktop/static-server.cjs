'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const mime = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
});
const publicDirectories = new Set(['src', 'assets', 'generated', 'config']);

function isWithin(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isPublicPath(relative) {
  const parts = relative.split('/');
  if (parts.some((part) => !part || part.startsWith('.') || ['recovered', 'reference'].includes(part)) || relative.includes('\\') || relative.includes('\0')) return false;
  if (relative !== 'index.html' && !publicDirectories.has(parts[0])) return false;
  if (parts[0] === 'config' && !['config/custom.json', 'config/defaults.generated.json'].includes(relative)) return false;
  return Object.hasOwn(mime, path.posix.extname(relative).toLowerCase());
}

/**
 * Local-only game server. Electron's patched fs.realpathSync/stat/read APIs
 * support files inside app.asar; never trust lexical paths after realpath fails.
 * Reference/recovered files are never public routes. Editable overrides must
 * remain inside the explicitly authorized config/ or ui-helper/ directory.
 */
function createStaticServer(root, { customFile = null, helperFile = null, externalRoot = null } = {}) {
  const realRoot = fs.realpathSync(path.resolve(root));
  const overrides = new Map();
  if (customFile || helperFile) {
    if (!externalRoot) throw new TypeError('externalRoot is required for editable overrides');
    const lexicalExternalRoot = path.resolve(externalRoot);
    const realExternalRoot = fs.realpathSync(lexicalExternalRoot);
    for (const [route, file] of [['config/custom.json', customFile], ['generated/ui/original-graphics.js', helperFile]]) {
      if (!file) continue;
      const absolute = path.resolve(file);
      if (!isWithin(lexicalExternalRoot, absolute)) throw new RangeError('Override is outside externalRoot');
      const directory = path.relative(lexicalExternalRoot, path.dirname(absolute));
      overrides.set(route, { file: absolute, allowedDirectory: path.join(realExternalRoot, directory) });
    }
  }
  const securityHeaders = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY',
  };
  const server = http.createServer((request, response) => {
    const fail = (status, body = 'Not found') => {
      response.writeHead(status, { ...securityHeaders, ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      const address = server.address();
      if (!address || request.headers.host !== `127.0.0.1:${address.port}`) { fail(403, 'Forbidden'); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { fail(405, 'Method not allowed'); return; }
      // Validate raw path before URL normalization could erase dot segments.
      const raw = request.url.split(/[?#]/, 1)[0];
      if (!raw.startsWith('/') || raw.startsWith('//')) { fail(404); return; }
      const decoded = decodeURIComponent(raw);
      if (/[\\\u0000-\u001f\u007f%]/.test(decoded)) { fail(404); return; }
      const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
      if (!isPublicPath(relative)) { fail(404); return; }
      const override = overrides.get(relative);
      const file = override ? override.file : path.resolve(realRoot, relative);
      if (!override && !isWithin(realRoot, file)) { fail(404); return; }
      const realFile = fs.realpathSync(file);
      if (override) {
        if (!isWithin(override.allowedDirectory, realFile)) { fail(404); return; }
      } else {
        if (!isWithin(realRoot, realFile)) { fail(404); return; }
        const actual = path.relative(realRoot, realFile).split(path.sep).join('/');
        if (!isPublicPath(actual)) { fail(404); return; }
      }
      const stat = fs.statSync(realFile);
      if (!stat.isFile()) { fail(404); return; }
      response.writeHead(200, {
        ...securityHeaders, 'Content-Type': mime[path.posix.extname(relative).toLowerCase()],
        'Content-Length': stat.size,
      });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = fs.createReadStream(realFile);
      stream.once('error', () => response.destroy());
      response.once('close', () => stream.destroy());
      stream.pipe(response);
    } catch {
      if (!response.headersSent) fail(404);
      else response.destroy();
    }
  });
  return server;
}

module.exports = { createStaticServer, isPublicPath, isWithin };
