"""Build an explicitly modified trace fixture, never overwrite the original SWF.

Replaces only DragonForce.as in a local TEST COPY using FFDec. Changes are
limited to constant random inputs and observer serialization after each step.
The fixture is not a production executable or author-original source release.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.local/oracle'
EXPECTED = '6cd4a86045d828517c5eaabacfa04ae16719733778f8b20b3c855e5f03df7149'

OBSERVER = r'''
      private var oracleFrameCounter:int = 0;

      private function oracleRandom() : Number
      {
         return 0.5;
      }

      private function oracleEmit() : void
      {
         ++this.oracleFrameCounter;
         if(this.oracleFrameCounter > __ORACLE_MAX_FRAMES__)
         {
            return;
         }
         var rows:Array = [];
         var c:Object;
         var row:Object;
         var action:String;
         var i:int = 0;
         while(i < scene.numChildren)
         {
            c = scene.getChildAt(i);
            row = {px:c.px,py:c.py,pz:c.pz,sx:c.sx,sy:c.sy,currentFrame:c.currentFrame};
            row.action = null;
            if(c.spriteMap)
            {
               for each(action in ["idle","run","attack","dead"])
               {
                  if(c.spriteSheet.map(action) == c.spriteMap)
                  {
                     row.action = action;
                     break;
                  }
               }
            }
            if(c is Isometric2DEntity)
            {
               row.kind = (c == this.redBoss || c == this.blueBoss) ? "base" : "unit";
               row.side = c == this.redBoss ? "left" : (c == this.blueBoss ? "right" : c.data);
               row.id = c.id;
               row.nowHP = c.nowHP;
               row.maxHP = c.maxHP;
            }
            else
            {
               row.kind = "attack";
               row.side = c.father == this.redBoss ? "left" : (c.father == this.blueBoss ? "right" : c.father.data);
               row.delay = c.delay;
               row.life = c.life;
               row.visible = c.visible;
            }
            rows.push(row);
            ++i;
         }
         trace("ORACLE_FRAME " + JSON.stringify({frame:this.oracleFrameCounter,round:this.round,
            stopTimer:this.stopTimer,singlePlay:this.singlePlay,difficulty:this.difficulty,
            leftMoney:this.leftMoney,leftIncome:this.leftIncome,leftPopulation:this.leftPopulation,
            rightMoney:this.rightMoney,rightIncome:this.rightIncome,rightPopulation:this.rightPopulation,
            gameOverTime:this.gameOverTime,p1:this.p1,p2:this.p2,
            redBossHP:this.redBoss.nowHP,blueBossHP:this.blueBoss.nowHP,
            terminal:this.gameOverTime == 0 && (this.redBoss.nowHP == 0 || this.blueBoss.nowHP == 0),
            camera:{x:camera.x,y:camera.y,width:camera.width,height:camera.height},children:rows}));
      }

'''


def method_closing_brace(source, method):
    position = source.index('function ' + method + '(')
    position = source.index('{', position)
    depth = 1
    position += 1
    while depth:
        depth += (source[position] == '{') - (source[position] == '}')
        position += 1
    return position - 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-frames', type=int, default=20000)
    options = parser.parse_args()
    if options.max_frames < 1 or options.max_frames > 100000:
        raise ValueError('Trace cap must be 1..100000 frames')
    original = ROOT / 'reference/super-original.swf'
    if hashlib.sha256(original.read_bytes()).hexdigest() != EXPECTED:
        raise RuntimeError('Original baseline changed')
    source = (ROOT / 'recovered/as3/scripts/DragonForce.as').read_text(encoding='utf-8')
    replacements = source.count('Math.random()')
    if replacements != 23:
        raise RuntimeError(f'Unexpected Math.random call-site count: {replacements}')
    source = source.replace('Math.random()', 'this.oracleRandom()')
    observer = OBSERVER.replace('__ORACLE_MAX_FRAMES__', str(options.max_frames))
    source = source.replace('      public function DragonForce()', observer + '      public function DragonForce()', 1)
    closing = method_closing_brace(source, 'step')
    source = source[:closing] + '   this.oracleEmit();\n      ' + source[closing:]
    scripts = WORK / 'test-scripts'
    scripts.mkdir(parents=True, exist_ok=True)
    target = scripts / 'DragonForce.as'
    target.write_text(source, encoding='utf-8', newline='\n')
    home = WORK / 'ffdec-home'
    temp = WORK / 'tmp'
    for directory in (home, temp): directory.mkdir(exist_ok=True)
    environment = dict(os.environ, APPDATA=str(home / 'AppData/Roaming'),
                       LOCALAPPDATA=str(home / 'AppData/Local'), TEMP=str(temp), TMP=str(temp))
    for name in ('APPDATA', 'LOCALAPPDATA'): Path(environment[name]).mkdir(parents=True, exist_ok=True)
    output = WORK / 'super-oracle.swf'
    args = [shutil.which('java'), '-Xmx1536m', '-Djava.awt.headless=true',
            '-Duser.home=' + str(home), '-Djava.io.tmpdir=' + str(temp),
            '-jar', str(ROOT / '.cache/ffdec/version26.4.0/ffdec.jar'),
            '-onerror', 'abort', '-importScript', str(original), str(output), str(scripts)]
    with (WORK / 'instrument-build.log').open('w', encoding='utf-8') as log:
        result = subprocess.run(args, cwd=ROOT, env=environment, stdout=log,
                                stderr=subprocess.STDOUT, timeout=180)
    print((WORK / 'instrument-build.log').read_text(encoding='utf-8', errors='replace')[-9000:], flush=True)
    if result.returncode: raise SystemExit(result.returncode)
    if not output.exists(): raise RuntimeError('FFDec produced no fixture')
    if hashlib.sha256(original.read_bytes()).hexdigest() != EXPECTED:
        raise RuntimeError('Baseline hash changed after import')
    report = {'originalSha256': EXPECTED, 'fixtureSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
              'fixtureBytes': output.stat().st_size, 'tool': 'JPEXS FFDec 26.4.0',
              'changes': ['DragonForce Math.random call sites replaced with constant 0.5',
                          f'Post-step observer emits JSON state; max {options.max_frames} frames'],
              'maxTraceFrames': options.max_frames,
              'randomCallSites': replacements,
              'modifiedClass': 'DragonForce', 'originalPreserved': True,
              'limits': ['Instrumented test copy, not unmodified original execution',
                         'Ruffle execution is not Adobe Flash parity proof']}
    (WORK / 'instrumentation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__': main()
