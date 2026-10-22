"""Prepare a pinned Ruffle reference runtime, never a production dependency."""
import hashlib
import json
from pathlib import Path
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.local/oracle'
URL = 'https://github.com/ruffle-rs/ruffle/releases/download/v0.7.1/ruffle-0.7.1-web-selfhosted.zip'
SIZE = 10527427
SHA256 = 'ef12edbee135d581a9cd523837d746da30a07a64dbf1cf472d2e472c656f4b5e'


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    destination = WORK / 'ruffle-0.7.1-web-selfhosted.zip'
    partial = destination.with_suffix('.zip.part')
    if not destination.exists():
        for attempt in range(6):
            offset = partial.stat().st_size if partial.exists() else 0
            headers = {'User-Agent': 'Local-SWF-reference-oracle'}
            if offset: headers['Range'] = f'bytes={offset}-'
            try:
                request = urllib.request.Request(URL, headers=headers)
                with urllib.request.urlopen(request, timeout=15) as response:
                    append = offset > 0 and response.status == 206
                    if append and not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
                        raise RuntimeError('Bad resumed Content-Range')
                    with partial.open('ab' if append else 'wb') as output:
                        started = time.monotonic()
                        while chunk := response.read1(512 * 1024):
                            output.write(chunk)
                            if output.tell() > SIZE: raise RuntimeError('Oversized runtime archive')
                            if time.monotonic() - started > 45: raise TimeoutError('Reconnect slow transfer')
                if partial.stat().st_size != SIZE: raise RuntimeError('Incomplete runtime archive')
                if hashlib.sha256(partial.read_bytes()).hexdigest() != SHA256:
                    raise RuntimeError('Runtime digest differs from official GitHub asset digest')
                partial.replace(destination)
                break
            except Exception as error:
                print(f'Runtime download attempt {attempt + 1}: {error}', flush=True)
                if attempt == 5: raise
    if hashlib.sha256(destination.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError('Cached runtime digest mismatch')
    vendor = WORK / 'vendor/ruffle'
    vendor.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination) as archive:
        if sum(member.file_size for member in archive.infolist()) > 120 * 1024 * 1024:
            raise RuntimeError('Unexpected uncompressed runtime size')
        for member in archive.infolist():
            if not (vendor / member.filename).resolve().is_relative_to(vendor.resolve()):
                raise RuntimeError('Unsafe ZIP path')
        archive.extractall(vendor)
    report = {
        'runtime': 'Ruffle', 'version': '0.7.1', 'releasePublishedAt': '2026-10-07T18:55:42Z',
        'officialRelease': 'https://github.com/ruffle-rs/ruffle/releases/tag/v0.7.1',
        'downloadUrl': URL, 'bytes': SIZE, 'sha256': SHA256,
        'purpose': 'Local reference oracle only; never production game execution',
        'limits': ['Ruffle is an emulator, not Adobe Flash Player; successful emulation is not Adobe parity proof.'],
    }
    (WORK / 'runtime.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
