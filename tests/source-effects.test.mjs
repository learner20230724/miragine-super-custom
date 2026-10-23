import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { drawSourceEffect, sourceEffectLayout } from '../src/render/source-effects.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file));
const hash = data => createHash('sha256').update(data).digest('hex');
const metadata = JSON.parse(read('generated/source-effects.json'));
const assets = JSON.parse(read('generated/asset-manifest.json'));
const records = Object.values(metadata.sprites).flatMap(frames => Object.values(frames));
const images = records.filter(frame => frame.file);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);

function walk(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : [file];
  }).sort();
}

test('only 25 original effect bitmaps are copied byte-for-byte into their independent namespace', () => {
  assert.equal(metadata.schemaVersion, 1);
  assert.deepEqual(Object.keys(metadata.sprites).sort(), ['storm', 'thunderball']);
  assert.deepEqual(Object.keys(metadata.sprites.thunderball).map(Number), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(Object.keys(metadata.sprites.storm).map(Number), Array.from({ length: 10 }, (_, i) => i + 1));
  assert.equal(images.length, 25);
  assert.deepEqual([...new Set(images.map(frame => frame.file))].sort(), walk('assets/generated/source-effects'));
  for (const frame of images) {
    assert.ok(frame.file.startsWith('assets/generated/source-effects/'));
    assert.ok(frame.source.file.startsWith('recovered/unit-media/images/'));
    assert.equal(path.isAbsolute(frame.file), false);
    assert.equal(path.isAbsolute(frame.source.file), false);
    const bytes = read(frame.file);
    assert.deepEqual(bytes, read(frame.source.file));
    assert.equal(bytes.length, frame.bytes);
    assert.equal(hash(bytes), frame.sha256);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), frame.width);
    assert.equal(bytes.readUInt32BE(20), frame.height);
  }
  assert.equal(metadata.counts.images, 25);
  assert.equal(metadata.counts.frames, 26);
  assert.equal(metadata.counts.emptyFrames, 1);
  assert.equal(metadata.counts.imageBytes, images.reduce((sum, frame) => sum + frame.bytes, 0));
});

test('source SWF and metadata inputs have repository-relative reproducible provenance', () => {
  for (const source of [metadata.generation.sourceSwf, ...metadata.generation.sources]) {
    const bytes = read(source.file);
    assert.equal(path.isAbsolute(source.file), false);
    assert.equal(source.bytes, bytes.length);
    assert.equal(source.sha256, hash(bytes));
  }
  assert.equal(metadata.generation.sourceSwf.sha256, '31f0fc1a147bac308d794fcecb087ff47260ee830ea6b9287bad98c93e7b5a2e');
  assert.equal(metadata.generation.operation, 'byte-identical-source-copy-no-resampling');
});

test('the active XML bitmap fill, exact rectangle and 20-twip conversion retain original source geometry', () => {
  const xml = read('recovered/assets.xml').toString('utf8');
  for (const [name, frames] of Object.entries(metadata.sprites)) {
    for (const frame of Object.values(frames).filter(value => !value.empty)) {
      assert.equal(frame.source.spriteId, assets.sprites[name].characterId);
      assert.equal(frame.source.fillStyleType, 67);
      assert.equal(frame.smoothing, false);
      assert.ok(xml.includes(`shapeId="${frame.source.shapeId}"`));
      assert.ok(xml.includes(`bitmapId="${frame.source.bitmapId}" fillStyleType="67"`));
      const matrix = frame.source.bitmapMatrixTwips;
      assert.deepEqual(frame.matrix, [Number(matrix.scaleX ?? 1) / 20,
        Number(matrix.rotateSkew0 ?? 0) / 20, Number(matrix.rotateSkew1 ?? 0) / 20,
        Number(matrix.scaleY ?? 1) / 20, Number(matrix.translateX ?? 0) / 20,
        Number(matrix.translateY ?? 0) / 20]);
      assert.deepEqual(frame.source.placementMatrix, [1, 0, 0, 1, 0, 0]);
    }
  }
  for (const frame of Object.values(metadata.sprites.thunderball)) {
    assert.deepEqual([frame.width, frame.height], [128, 128]);
    assert.deepEqual(frame.matrix, [.25, 0, 0, .25, 0, 0]);
    assert.deepEqual(frame.clip, { xMin: 0, yMin: 0, xMax: 32, yMax: 32 });
  }
  for (const frame of Object.values(metadata.sprites.storm).filter(value => !value.empty)) {
    assert.deepEqual([frame.width, frame.height], [153, 261]);
    assert.deepEqual(frame.matrix, [0, -.32118225, .32118225, 0, -7.55, 44.7]);
    assert.deepEqual(frame.clip, { xMin: -7.55, yMin: -4.45, xMax: 76.3, yMax: 44.7 });
  }
});

test('storm frame 10 remains truly transparent rather than repeating frame 9', () => {
  const blank = metadata.sprites.storm['10'];
  assert.equal(blank.empty, true);
  assert.equal(blank.file, undefined);
  assert.equal(blank.source.timeline, 'empty-after-RemoveObject2');
  assert.deepEqual(metadata.generation.emptyFrames, ['storm:10']);
  const png = read(assets.sprites.storm.frames.find(frame => frame.index === 10).file);
  const chunks = [];
  for (let cursor = 8; cursor < png.length;) {
    const size = png.readUInt32BE(cursor);
    if (png.subarray(cursor + 4, cursor + 8).toString() === 'IDAT') chunks.push(png.subarray(cursor + 8, cursor + 8 + size));
    cursor += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  assert.equal(raw.length, (84 * 4 + 1) * 50);
  assert.ok(raw.every(value => value === 0));
  assert.deepEqual(sourceEffectLayout(null, blank), { empty: true });
  assert.equal(drawSourceEffect(null, null, null, blank), false);
});

test('thunderball keeps its original 28×28 int raster clip while using its 128×128 source', () => {
  const layout = sourceEffectLayout(assets.sprites.thunderball, metadata.sprites.thunderball['1']);
  assert.deepEqual(layout.rasterClip, { x: 0, y: 0, width: 28, height: 28 });
  assert.deepEqual(layout.shapeClip, { x: 0, y: 0, width: 28.8, height: 28.8 });
  assert.deepEqual(layout.matrix, [.225, 0, 0, .225, 0, 0]);
});

test('storm preserves rotation, the int(-6,-4) foot anchor and original 75×44 raster clipping', () => {
  const layout = sourceEffectLayout(assets.sprites.storm, metadata.sprites.storm['1']);
  assert.deepEqual(layout.rasterClip, { x: -6, y: -4, width: 75, height: 44 });
  const expected = [0, -.289064025, .289064025, 0, -6, 40.235];
  layout.matrix.forEach((value, i) => near(value, expected[i]));
  near(layout.shapeClip.x, -6); near(layout.shapeClip.y, -4);
  near(layout.shapeClip.width, 75.465); near(layout.shapeClip.height, 44.235);
});

function contextFixture({ fail = false } = {}) {
  const calls = [];
  const context = { depth: 0, imageSmoothingEnabled: true,
    save() { this.depth++; calls.push(['save']); },
    restore() { this.depth--; this.imageSmoothingEnabled = true; calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    rect(...args) { calls.push(['rect', ...args]); },
    clip() { calls.push(['clip']); },
    transform(...args) { calls.push(['transform', ...args]); },
    drawImage(...args) { calls.push(['drawImage', ...args]); if (fail) throw new Error('synthetic source draw failure'); },
  };
  return { context, calls };
}

test('source drawing clips before transforming, performs one direct draw and restores caller state', () => {
  const { context, calls } = contextFixture();
  const image = { originalImage: true };
  assert.equal(drawSourceEffect(context, image, assets.sprites.storm, metadata.sprites.storm['1']), true);
  assert.deepEqual(calls.map(call => call[0]), ['save', 'beginPath', 'rect', 'clip', 'beginPath', 'rect', 'clip', 'transform', 'drawImage', 'restore']);
  assert.deepEqual(calls.find(call => call[0] === 'drawImage'), ['drawImage', image, 0, 0]);
  assert.deepEqual(calls.filter(call => call[0] === 'rect')[0], ['rect', -6, -4, 75, 44]);
  assert.equal(context.depth, 0);
  assert.equal(context.imageSmoothingEnabled, true);
});

test('failed source drawing restores the caller transform and no source metadata is mutated', () => {
  const { context } = contextFixture({ fail: true });
  const record = metadata.sprites.thunderball['2'], sprite = assets.sprites.thunderball;
  const before = JSON.stringify({ record, sprite });
  assert.throws(() => drawSourceEffect(context, {}, sprite, record), /synthetic source draw failure/);
  assert.equal(context.depth, 0);
  assert.equal(JSON.stringify({ record, sprite }), before);
});

test('malformed source metadata fails rather than guessing geometry', () => {
  const sprite = assets.sprites.thunderball, frame = metadata.sprites.thunderball['1'];
  assert.throws(() => sourceEffectLayout(sprite, null), /frame is required/);
  assert.throws(() => sourceEffectLayout({}, frame), /raster metadata/);
  assert.throws(() => sourceEffectLayout(sprite, { ...frame, matrix: [1, 0, 0] }), /six-value/);
  assert.throws(() => sourceEffectLayout(sprite, { ...frame, matrix: [1, 0, 0, 1, NaN, 0] }), /finite/);
  assert.throws(() => sourceEffectLayout(sprite, { ...frame, clip: { xMin: 0, yMin: 0, xMax: 0, yMax: 1 } }), /non-empty/);
  assert.throws(() => sourceEffectLayout(sprite, { ...frame, width: 0 }), /positive integer/);
});

test('source effect build --check reproduces every output without changing its bytes or mtime', () => {
  const files = ['generated/source-effects.json', ...images.map(frame => frame.file)];
  const snapshot = () => files.map(file => [file, hash(read(file)), statSync(path.join(root, file)).mtimeMs]);
  const before = snapshot();
  const result = spawnSync('python', ['-B', 'tools/build_source_effects.py', '--check'],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Verified 25 byte-identical source images, 26 frames \(1 empty\)/);
  assert.deepEqual(snapshot(), before);
});
