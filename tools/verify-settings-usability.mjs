/** Real-key/pointer regression for editor usability. Does not inject game state. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, _electron } from 'playwright';
import { createDevServer } from './dev-server.mjs';
import { visibleHotspotCenter } from './verify-settings-v4.mjs';
import { readSettingsStartup, matchesSettingsStartup } from './settings-startup-profile.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=process.argv[2] ? path.resolve(process.argv[2]) : null;
const out=path.resolve(root,process.argv[3]??'.local/settings-usability.json');
const relativeOutput = path.relative(root, out);
if (path.isAbsolute(relativeOutput) || !['.local', 'artifacts', 'output'].includes(relativeOutput.split(path.sep)[0]) || path.extname(out) !== '.json') {
 throw Error('Use a JSON report path inside .local, artifacts, or output');
}
let app,browser,server,page;const report={status:'running',mode:dir?'portable':'browser',checks:[],errors:[],dialogs:[],startedAt:new Date().toISOString()};
const check=(ok,name,detail)=>{report.checks.push({name,passed:Boolean(ok),...(detail===undefined?{}:{detail})});if(!ok)throw Error(name);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 if(dir){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:path.join(dir,'MiragineSuper.exe'),cwd:dir,env,args:['--mute-audio'],timeout:60000});page=await app.firstWindow();report.build=JSON.parse(fs.readFileSync(path.join(dir,'build-info.json'),'utf8'));}
 else{server=createDevServer(root);await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({channel:'msedge',headless:false,args:['--mute-audio']});page=await browser.newPage({viewport:{width:1500,height:1000},deviceScaleFactor:1.25});await page.goto(`http://127.0.0.1:${server.address().port}`);}
 page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',async d=>{report.dialogs.push(d.message());await d.accept();});
 await page.waitForFunction(()=>window.__MIRAGINE__?.getState().ready,null,{timeout:60000});
 const state=()=>page.evaluate(()=>window.__MIRAGINE__.getState());
 const act=name=>page.locator(`[data-settings-action="${name}"]`);
 const field=p=>page.locator(`[data-field-path="${p}"]`);
 const control=name=>page.locator(`[data-action="${name}"]`);
 async function hit(action,matches={}){
  await page.waitForFunction(({action,matches})=>window.__MIRAGINE__.getHotspots().some(h=>h.action===action&&Object.entries(matches).every(([k,v])=>h[k]===v)),{action,matches});await wait(400);
  const {hotspot,fit}=await page.evaluate(({action,matches})=>({hotspot:window.__MIRAGINE__.getHotspots().find(h=>h.action===action&&Object.entries(matches).every(([k,v])=>h[k]===v)),fit:window.__MIRAGINE__.getState().viewport}),{action,matches});
  const p=visibleHotspotCenter(hotspot);await page.mouse.click(fit.clientLeft+fit.left+p.x*fit.scale,fit.clientTop+fit.top+p.y*fit.scale);await wait(150);
 }
 await hit('music');check((await state()).muted,'music switched off by first game interaction');
 const {expected:startupExpected}=await readSettingsStartup(page,dir);report.startupConfiguration=startupExpected.evidence;
 await hit('single');await hit('difficulty',{value:3});if((await state()).overlay==='tutorial')await hit('tutorial-okay');
 await page.keyboard.press('F2');await wait(250);
 check(matchesSettingsStartup(await state(),startupExpected),'native invincible difficulty retains exact externally configured startup rules',startupExpected.evidence);
 check((await act('tab-sandbox').textContent()).length>0 && /不可战胜/.test(await page.locator('[data-battle-summary]').textContent()),'summary explicitly displays actual invincible difficulty');
 async function type(locator,text){await locator.click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type(text,{delay:80});await wait(250);check(await locator.inputValue()===text,`real typing remains visible: ${text}`);}
 await type(control('speed-number'),'2.5');check((await state()).customization.speed===2.5,'typed fractional speed applies without Enter or blur');
 await type(control('speed-number'),'1');await page.keyboard.press('Enter');
 await control('pause').click();check((await state()).customization.paused,'manual pause stays explicit');
 const before=(await state()).customization.editor.battle;
 await type(field('config.rules.incomeLimit'),'12345');await page.keyboard.press('Enter');await wait(150);
 check((await state()).customization.editor.applied.config.rules.incomeLimit===12345,'common income limit commits with actual Enter');
 await type(field('config.rules.populationLimit'),'678');await control('speed-number').click();await wait(150);
 check((await state()).customization.editor.applied.config.rules.populationLimit===678,'common population limit commits on actual blur');
 const after=(await state()).customization.editor.battle;
 check(before.left.money===after.left.money&&before.left.population===after.left.population,'rule limits do not rewrite current resources');
 check(/不可战胜/.test(await page.locator('[data-battle-summary]').textContent())&&/自定义/.test(await page.locator('[data-battle-summary]').textContent()),'custom rules label does not replace difficulty');
 check(!/Enter|离开输入框/.test(await field('config.rules.incomeLimit').locator('..').textContent()),'per-field help no longer repeats page editing instructions');
 const dialogCount=report.dialogs.length;
 for(const name of ['clear-left','clear-right','clear-all']){await act(name).click();await wait(100);}
 check(report.dialogs.length===dialogCount,'all three clear buttons have no confirmation dialog');
 await type(field('config.rules.incomeLimit'),'23456');await page.keyboard.press('Enter');await wait(100);
 check((await state()).customization.editor.applied.config.rules.incomeLimit===23456,'real keyboard input still works after all clear buttons');
 fs.mkdirSync(path.join(root,'output/playwright'),{recursive:true});
 report.basicsScreenshot=`output/playwright/settings-usability-${report.mode}-basics.png`;
 await page.screenshot({path:path.join(root,report.basicsScreenshot)});
 await act('tab-difficulties').click();
 for(const id of ['0','1','2','3']){await page.locator('[data-entry-select="difficulties"]').selectOption(id);check(await page.locator('[data-ai-difficulty]').count()===1&&await field(`config.difficulties.${id}.counterSelectionProbability`).isVisible(),`AI menu shows only difficulty ${id}`);}
 await page.locator('[data-ai-category]').selectOption('thresholds');
 check(await field('config.difficulties.3.ai.forcedUnitId').evaluate(n=>n.tagName)==='SELECT','AI single-unit choice uses named menu');
 await type(field('config.difficulties.3.ai.forceOverlordMoneyThreshold'),'800');await page.keyboard.press('Tab');
 await page.locator('[data-ai-category]').selectOption('candidates');await page.locator('[data-ai-candidate-select]').selectOption('counterChoices.5');
 check(await page.locator('[data-candidate-unit]').count()===16,'only selected candidate table is expanded');
 await page.locator('[data-entry-select="difficulties"]').selectOption('2');await page.locator('[data-entry-select="difficulties"]').selectOption('3');
 check((await state()).customization.editor.draft.config.difficulties[3].ai.forceOverlordMoneyThreshold===800,'menu navigation preserves pending draft');
 check((await state()).difficulty===3,'AI editing selector never changes current difficulty');
 report.aiScreenshot=`output/playwright/settings-usability-${report.mode}-ai.png`;
 await page.screenshot({path:path.join(root,report.aiScreenshot)});
 await page.keyboard.press('F2');await wait(200);
 const point=async(x,y)=>{const f=(await state()).viewport;return{x:f.clientLeft+f.left+x*f.scale,y:f.clientTop+f.top+y*f.scale};};
 const p=await point(350,220);const start=(await state()).customization.displayCamera;
 await page.mouse.click(p.x,p.y);await wait(150);check((await state()).customization.displayCamera.mode===start.mode,'battlefield click alone does not switch camera mode');
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+80,p.y+15,{steps:12});await page.mouse.up();await wait(200);
 const moved=(await state()).customization.displayCamera;check(moved.mode==='manual'&&moved.centerX!==start.centerX,'left drag pans main battlefield and enters free observation');
 await page.mouse.move(p.x+130,p.y);await wait(100);check((await state()).customization.displayCamera.centerX===moved.centerX,'releasing left drag stops camera movement');
 await page.mouse.wheel(0,160);await wait(150);check((await state()).customization.displayCamera.zoom!==moved.zoom,'wheel still changes zoom');
 const mapBefore=(await state()).customization.displayCamera.centerX;await hit('minimap');check((await state()).customization.displayCamera.centerX!==mapBefore,'minimap navigation remains available');
 check((await state()).config.frameRate===30&&(await state()).presentationStats.mode==='native-resolution','native rendering and 30 Hz logic retained');
 check((await state()).muted&&report.errors.length===0,'no runtime errors and test music stays off');
 fs.mkdirSync(path.join(root,'output/playwright'),{recursive:true});report.screenshot=`output/playwright/settings-usability-${report.mode}.png`;await page.screenshot({path:path.join(root,report.screenshot)});
 report.status='passed';
}catch(e){report.status='failed';report.failure=String(e.message).replaceAll(root,'[workspace]').replaceAll(dir??'\0','[portable]');process.exitCode=1;}
finally{await app?.close();await browser?.close();if(server)await new Promise(r=>server.close(r));report.closedOwnedApplication=true;report.finishedAt=new Date().toISOString();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure}));}
