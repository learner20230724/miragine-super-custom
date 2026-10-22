import {spawn} from 'node:child_process';
import path from 'node:path';
import {root,localEnvironment} from './environment.mjs';
const child=spawn(process.execPath,[path.join(root,'node_modules/electron/install.js')],
  {cwd:root,env:localEnvironment(),stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
