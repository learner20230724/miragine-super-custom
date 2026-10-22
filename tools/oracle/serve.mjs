/** Isolated loopback-only oracle server; production does not import this file. */
import http from 'node:http';
import { readFile, appendFile, writeFile, open } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTraceComparator } from './stream_compare.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const vendor = resolve(root, '.local/oracle/vendor/ruffle');
const port = Number(process.env.ORACLE_PORT || 61981);
const sessions = new Map();
const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript',
  '.wasm':'application/wasm','.swf':'application/x-shockwave-flash','.map':'application/json'};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/favicon.ico') {response.writeHead(204).end();return;}
    if (request.method === 'POST' && url.pathname === '/frame-batch') {
      if(request.headers.origin !== `http://127.0.0.1:${port}`){response.writeHead(403).end();return;}
      const sessionId=url.searchParams.get('session');
      if(!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId||'')){response.writeHead(400).end();return;}
      let body='';
      for await(const chunk of request){body+=chunk;if(body.length>4*1024*1024)throw Error('Oversized trace batch');}
      const records=JSON.parse(body);
      if(!Array.isArray(records)||records.length>100)throw Error('Invalid trace batch');
      let state=sessions.get(sessionId);
      if(!state){
        const fixtureMetadata=JSON.parse(await readFile(resolve(root,'.local/oracle/instrumentation.json'),'utf8'));
        fixtureMetadata.emulatorFrameRate=Number(url.searchParams.get('rate'))||30;
        const traceFile=resolve(root,`.local/oracle/${sessionId}.trace.jsonl`);
        const handle=await open(traceFile,'wx');await handle.close();
        state={comparator:createTraceComparator({root,sessionId,fixtureMetadata}),traceFile,
          reportFile:resolve(root,`.local/oracle/${sessionId}.comparison.json`)};
        sessions.set(sessionId,state);
      }
      for(const record of records)state.comparator.accept(record);
      await appendFile(state.traceFile,records.map(record=>JSON.stringify(record)+'\n').join(''));
      await writeFile(state.reportFile,JSON.stringify(state.comparator.report(),null,2)+'\n');
      response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({accepted:records.length}));
      return;
    }
    let target;
    if (url.pathname === '/' || url.pathname.startsWith('/stream/')) target = resolve(root, 'tools/oracle/index.html');
    else if (url.pathname === '/super-original.swf') target = resolve(root, 'reference/super-original.swf');
    else if (url.pathname === '/super-oracle.swf') target = resolve(root, '.local/oracle/super-oracle.swf');
    else if (url.pathname.startsWith('/ruffle/')) {
      target = resolve(vendor, decodeURIComponent(url.pathname.slice('/ruffle/'.length)));
      if (!target.startsWith(vendor + '\\') && !target.startsWith(vendor + '/')) throw new Error('Unsafe vendor path');
    } else { response.writeHead(404).end(); return; }
    const data = await readFile(target);
    response.writeHead(200, {'Content-Type': types[extname(target)] || 'application/octet-stream',
      'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});
    response.end(data);
  } catch (error) {
    console.error(error.message);
    response.writeHead(404, {'Content-Type':'text/plain'}).end('Oracle resource unavailable');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Reference oracle listening at http://127.0.0.1:${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
