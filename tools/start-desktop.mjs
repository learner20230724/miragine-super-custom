import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {root,localEnvironment} from './environment.mjs';
const require=createRequire(import.meta.url);
let executable;
try{executable=require('electron');}catch{throw Error('Electron is not installed. Run npm run setup:electron once.');}
const child=spawn(executable,[root],{cwd:root,env:localEnvironment(),stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
