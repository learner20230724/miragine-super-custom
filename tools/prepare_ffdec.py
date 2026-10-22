"""Install a pinned portable FFDec under this project's cache, not system-wide."""
import hashlib
import json
import pathlib
import time
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION = '26.4.0'
URL = f'https://github.com/jindrapetrik/jpexs-decompiler/releases/download/version{VERSION}/ffdec_{VERSION}.zip'
EXPECTED = '56ce960aeafc7caf034e2052ba49f878a883f7c7ca690da6eeffca9587b5e4b9'
SIZE = 21917740
CACHE = ROOT/'.cache/ffdec'


if __name__ == '__main__':
    CACHE.mkdir(parents=True,exist_ok=True)
    target = CACHE/f'ffdec_{VERSION}.zip'
    part = target.with_suffix('.zip.part')
    if not target.exists():
        for attempt in range(8):
            offset = part.stat().st_size if part.exists() else 0
            headers = {'User-Agent':'Local source reconstruction setup'}
            if offset:
                headers['Range'] = f'bytes={offset}-'
            try:
                with urllib.request.urlopen(urllib.request.Request(URL,headers=headers),timeout=20) as response:
                    append = offset and response.status == 206
                    if append and not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):
                        raise RuntimeError('Invalid resumed range')
                    reconnect = time.monotonic()+35
                    with part.open('ab' if append else 'wb') as output:
                        while chunk := response.read1(512*1024):
                            output.write(chunk)
                            if output.tell()>SIZE:
                                raise RuntimeError('Oversized archive')
                            if time.monotonic()>reconnect:
                                raise TimeoutError('Reconnect interrupted or slow transfer')
                if part.stat().st_size!=SIZE:
                    raise RuntimeError('Incomplete archive')
                with part.open('rb') as source:
                    actual = hashlib.file_digest(source,'sha256').hexdigest()
                if actual!=EXPECTED:
                    raise RuntimeError('Official release archive checksum mismatch')
                part.replace(target)
                break
            except Exception as error:
                print(f'Attempt {attempt+1}: {error}; retained {part.stat().st_size if part.exists() else 0} bytes',flush=True)
                if attempt==7:
                    raise
    with target.open('rb') as source:
        assert hashlib.file_digest(source,'sha256').hexdigest()==EXPECTED
    destination = CACHE/f'version{VERSION}'
    destination.mkdir(exist_ok=True)
    with zipfile.ZipFile(target) as archive:
        assert sum(item.file_size for item in archive.infolist())<200*1024*1024
        for item in archive.infolist():
            resolved=(destination/item.filename).resolve()
            if not resolved.is_relative_to(destination.resolve()):
                raise RuntimeError('Unsafe ZIP member')
        archive.extractall(destination)
    (ROOT/'.tmp').mkdir(exist_ok=True)
    (ROOT/'.cache/ffdec-home').mkdir(exist_ok=True)
    metadata={'name':'JPEXS Free Flash Decompiler','version':VERSION,'url':URL,'bytes':SIZE,'sha256':EXPECTED,
              'official_cli':'https://github.com/jindrapetrik/jpexs-decompiler/wiki/Commandline-arguments'}
    (ROOT/'docs/tools.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'verified':True,'version':VERSION,'sha256':EXPECTED,'jar_found':bool(list(destination.rglob('ffdec.jar')))}),flush=True)
