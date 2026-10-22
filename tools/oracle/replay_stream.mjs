/** Replay a locally retained source JSONL trace against a fresh production core. */
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTraceComparator } from './stream_compare.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(root,process.argv[2]||'.local/oracle/normal-rng05-rate240-v1.trace.jsonl');
const name=basename(source).replace(/\.trace\.jsonl$/,'');
const onlineReport=resolve(root,`.local/oracle/${name}.comparison.json`);
const previous=JSON.parse(await readFile(onlineReport,'utf8'));
const comparator=createTraceComparator({root,sessionId:name,
  fixtureMetadata:previous.provenance.fixture});
const rawHash=createHash('sha256');
const input=createReadStream(source);
input.on('data',chunk=>rawHash.update(chunk));
const lines=createInterface({input,crlfDelay:Infinity});
for await(const line of lines)if(line.trim())comparator.accept(JSON.parse(line));
const report=comparator.report();
report.traceFileSha256=rawHash.digest('hex');
report.traceFileName=basename(source);
report.transportEqualsNormalizedJsonl=report.traceFileSha256===report.sourceJsonlSha256;
report.replayedFromLocalTrace=true;
const destination=resolve(root,`.local/oracle/${name}.replay.comparison.json`);
await writeFile(destination,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
