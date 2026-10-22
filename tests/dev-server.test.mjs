import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDevServer} from '../tools/dev-server.mjs';

test('loopback server exposes game files, not reference SWFs, chats or tools',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'miragine-server-test-'));
  fs.mkdirSync(path.join(root,'src')); fs.mkdirSync(path.join(root,'.local')); fs.mkdirSync(path.join(root,'reference'));
  fs.writeFileSync(path.join(root,'index.html'),'<title>fixture</title>');
  fs.writeFileSync(path.join(root,'src/app.mjs'),'export const fixture = 1;');
  fs.writeFileSync(path.join(root,'.local/chat.json'),'private fixture');
  fs.writeFileSync(path.join(root,'reference/original.swf'),'not served');
  const server=createDevServer(root);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/')).status,200);
    const module=await fetch(base+'/src/app.mjs');
    assert.equal(module.status,200); assert.match(module.headers.get('content-type'),/javascript/);
    for(const name of ['/.local/chat.json','/reference/original.swf','/tools/dev-server.mjs','/src/%2e%2e%5c.local%5cchat.json'])
      assert.equal((await fetch(base+name)).status,404,name);
    assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    const resolved=fs.realpathSync(root);
    assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
