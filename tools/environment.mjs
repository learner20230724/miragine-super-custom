import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function localEnvironment(){
  const temp=path.join(root,'.tmp');
  const cache=path.join(root,'.cache');
  fs.mkdirSync(temp,{recursive:true});fs.mkdirSync(cache,{recursive:true});
  const env={...process.env,TEMP:temp,TMP:temp,TMPDIR:temp,
    ELECTRON_CACHE:path.join(cache,'electron'),electron_config_cache:path.join(cache,'electron'),
    npm_config_cache:path.join(cache,'npm'),PLAYWRIGHT_BROWSERS_PATH:path.join(cache,'playwright')};
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
