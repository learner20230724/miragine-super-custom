"""Pinned, reproducible static exports. Never writes custom configuration/code."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import time

ROOT=pathlib.Path(__file__).resolve().parents[1]

JOBS={
    'as3': ('reference/super-original.swf',['-format','script:as','-export','script','recovered/as3']),
    'pcode': ('reference/super-original.swf',['-format','script:pcode','-export','script','recovered/pcode']),
    'xml': ('reference/super-original.swf',['-swf2xml','reference/super-original.swf','recovered/super.xml']),
    'assets-as3': ('reference/super-assets-original.swf',['-format','script:as','-export','script','recovered/assets-as3']),
    'game-media': ('reference/super-original.swf',['-format','image:png,sound:mp3_wav,font:ttf,shape:svg','-export','image,sound,font,shape,symbolClass','recovered/game-media']),
    'unit-media': ('reference/super-assets-original.swf',['-format','image:png,sound:mp3_wav,font:ttf,shape:svg','-export','image,sound,font,shape,symbolClass','recovered/unit-media']),
    'unit-sprites': ('reference/super-assets-original.swf',['-format','sprite:png','-export','sprite','recovered/unit-sprites']),
    'unit-sprite-bounds': ('reference/super-assets-original.swf',['-format','sprite:svg','-export','sprite','.local/unit-sprite-bounds']),
    'assets-xml': ('reference/super-assets-original.swf',['-swf2xml','reference/super-assets-original.swf','recovered/assets.xml']),
    'game-canvas': ('reference/super-original.swf',['-format','frame:canvas','-export','frame','recovered/game-canvas']),
}


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('jobs',nargs='+',choices=JOBS)
    args=parser.parse_args()
    baseline=json.loads((ROOT/'reference/baseline.json').read_text(encoding='utf-8'))
    for key in ['game','assets']:
        record=baseline[key]
        path=ROOT/'reference'/record['path']
        assert hashlib.sha256(path.read_bytes()).hexdigest()==record['sha256']
    jar=ROOT/'.cache/ffdec/version26.4.0/ffdec.jar'
    assert jar.exists()
    (ROOT/'.local/export-logs').mkdir(parents=True,exist_ok=True)
    (ROOT/'recovered').mkdir(exist_ok=True)
    reports=[]
    for name in args.jobs:
        source,command=JOBS[name]
        if name not in ('xml','assets-xml'):
            command=command+[source]
        java=shutil.which('java')
        assert java
        invocation=[java,'-Xmx1536m','-Djava.awt.headless=true',
                    '-Duser.home='+str(ROOT/'.cache/ffdec-home'),
                    '-Djava.io.tmpdir='+str(ROOT/'.tmp'),'-jar',str(jar),
                    '-onerror','abort','-timeout','120','-exportTimeout','900',*command]
        started=time.monotonic()
        log=ROOT/'.local/export-logs'/f'{name}.log'
        print(f'Exporting {name}...',flush=True)
        with log.open('w',encoding='utf-8') as output:
            result=subprocess.run(invocation,cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,timeout=1000)
        report={'job':name,'exitCode':result.returncode,'seconds':round(time.monotonic()-started,2),
                'source':source,'arguments':command,'tool':'JPEXS FFDec 26.4.0'}
        reports.append(report)
        print(json.dumps(report),flush=True)
        if result.returncode:
            print(log.read_text(encoding='utf-8',errors='replace')[-5000:],flush=True)
            raise SystemExit(result.returncode)
    reports_dir=ROOT/'recovered/export-reports';reports_dir.mkdir(exist_ok=True)
    (reports_dir/('-'.join(args.jobs)+'.json')).write_text(json.dumps(reports,indent=2)+'\n',encoding='utf-8')
