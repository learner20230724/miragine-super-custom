import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(read('generated/asset-manifest.json'));
const retainedBounds = JSON.parse(read(manifest.generation.boundsEvidenceFile));

function pngSize(data) {
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(data.subarray(12, 16).toString(), 'IHDR');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function symbols(file) {
  return Object.fromEntries(read(file).toString('utf8').trim().split(/\r?\n/).map((line) => {
    const match = /^(\d+);"([^"]+)"$/.exec(line);
    assert.notEqual(match, null, `Valid symbol CSV row: ${line}`);
    return [match[2], Number(match[1])];
  }));
}

function walk(relativeDirectory) {
  return readdirSync(path.join(root, relativeDirectory), { withFileTypes: true }).flatMap((entry) => {
    const name = `${relativeDirectory}/${entry.name}`;
    return entry.isDirectory() ? walk(name) : [name];
  }).sort();
}

test('all 128 original A/B unit states are mapped exactly once', () => {
  const table = symbols('recovered/unit-media/symbolClass/symbols.csv');
  let states = 0;
  for (const team of ['A', 'B']) {
    for (let index = 0; index < 16; index++) {
      for (const state of ['idle', 'run', 'attack', 'dead']) {
        const name = `${team}${index}_${state}`;
        const sprite = manifest.sprites[name];
        assert.equal(sprite.kind, 'unit', name);
        assert.equal(sprite.team, team, name);
        assert.equal(sprite.unitIndex, index, name);
        assert.equal(sprite.state, state, name);
        assert.equal(sprite.characterId, table[name], name);
        assert.equal(sprite.sourceSymbol, name);
        states++;
      }
    }
  }
  assert.equal(states, 128);
  assert.equal(Object.values(manifest.sprites).filter((sprite) => sprite.kind === 'unit').length, 128);
  assert.equal(manifest.counts.unitStates, 128);
});

test('134 sprite definitions and all 594 frames match recovered assets XML', () => {
  const definitions = new Map();
  const xml = read('recovered/assets.xml').toString('utf8');
  for (const [tag] of xml.matchAll(/<item\b[^>]*\btype="DefineSpriteTag"[^>]*>/g)) {
    const attributes = Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
    definitions.set(Number(attributes.spriteId), Number(attributes.frameCount));
  }
  assert.equal(definitions.size, 134);
  assert.equal(Object.keys(manifest.sprites).length, definitions.size);
  let totalFrames = 0;
  for (const [name, sprite] of Object.entries(manifest.sprites)) {
    assert.equal(sprite.frameCount, definitions.get(sprite.characterId), name);
    assert.equal(sprite.frames.length, sprite.frameCount, name);
    assert.deepEqual(sprite.frames.map((frame) => frame.index), Array.from({ length: sprite.frameCount }, (_, i) => i + 1));
    totalFrames += sprite.frameCount;
  }
  assert.equal(totalFrames, 594);
  assert.equal(walk('recovered/unit-sprites').filter((file) => file.endsWith('.png')).length, totalFrames);
  assert.equal(manifest.counts.frames, totalFrames);
});

test('crystals, original projectiles, and the embedded shadow are retained', () => {
  for (const team of ['A', 'B']) {
    const crystal = manifest.sprites[`${team}_crystal`];
    assert.equal(crystal.kind, 'crystal');
    assert.equal(crystal.frameCount, 1);
    assert.equal(crystal.animation.speed, 1);
    assert.equal(crystal.animation.loop, true);
    assert.deepEqual(crystal.states, ['idle', 'run', 'attack', 'dead']);
  }
  for (const name of ['fireball', 'thunderball', 'storm']) {
    assert.equal(manifest.sprites[name].kind, 'projectile');
    assert.equal(manifest.sprites[name].animation.speed, name === 'fireball' ? 0.15 : 1);
    assert.equal(manifest.sprites[name].animation.loop, true);
  }
  assert.equal(manifest.sprites.shadow.characterId, 77);
  assert.equal(manifest.sprites.shadow.sourceSymbol, null);
  assert.equal(manifest.sprites.shadow.animation, null);
});

test('source animation rates and loop flags are not replaced by invented FPS', () => {
  const expected = { idle: [0.15, true], run: [0.3, true], attack: [0.3, false], dead: [0.2, false] };
  for (const sprite of Object.values(manifest.sprites).filter((entry) => entry.kind === 'unit')) {
    assert.equal(sprite.animation.speed, expected[sprite.state][0]);
    assert.equal(sprite.animation.loop, expected[sprite.state][1]);
    assert.equal(sprite.animation.speedUnit, 'frames-per-Symbol.step');
    const sourceLine = read(sprite.animation.source.file).toString('utf8').split(/\r?\n/)[sprite.animation.source.line - 1];
    assert.ok(sourceLine.includes(`createActionFromMovieClip("${sprite.state}"`));
    assert.ok(sourceLine.includes(`,${sprite.animation.loop},${sprite.animation.speed});`));
  }
});

test('every PNG frame remains byte-identical to the preserved source export', () => {
  for (const sprite of Object.values(manifest.sprites)) {
    for (const frame of sprite.frames) {
      const original = read(frame.sourceFile);
      const copied = read(frame.file);
      assert.deepEqual(copied, original, frame.file);
      assert.equal(hash(copied), frame.sha256, frame.file);
      assert.equal(copied.length, frame.bytes);
      assert.deepEqual(pngSize(copied), { width: frame.width, height: frame.height });
    }
  }
});

test('float bounds, SVG export extents, and PNG canvas dimensions stay distinct', () => {
  assert.equal(Object.keys(retainedBounds.frames).length, 594);
  for (const sprite of Object.values(manifest.sprites)) {
    for (const frame of sprite.frames) {
      const evidence = retainedBounds.frames[frame.sourceFile];
      assert.deepEqual(frame.bounds, evidence.bounds, frame.file);
      assert.match(evidence.svgSha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(frame.bounds, sprite.bounds, frame.file);
      assert.equal(frame.width, Math.ceil(frame.bounds.width));
      assert.equal(frame.height, Math.ceil(frame.bounds.height));
      assert.ok(frame.bounds.width > 0 && frame.bounds.height > 0);
    }
  }
  const frame = manifest.sprites.A8_attack.frames[0];
  assert.deepEqual(frame.bounds, { xMin: -56, yMin: -66, width: 88, height: 71.65 });
  assert.equal(frame.height, 72, 'PNG extent is not silently substituted for the original float extent');
});

test('SpriteSheet scale and integer coercions preserve truncation toward zero', () => {
  const source = read('recovered/as3/scripts/dragonforce/core/SpriteSheet.as').toString('utf8');
  const map = read('recovered/as3/scripts/dragonforce/core/SpriteMap.as').toString('utf8');
  assert.match(source, /var _loc5_:Number = 0\.9;/);
  assert.match(map, /offX:int/);
  assert.match(map, /offY:int/);
  for (const sprite of Object.values(manifest.sprites)) {
    const raster = sprite.rasterized;
    const bounds = sprite.bounds;
    assert.equal(raster.scale, 0.9);
    assert.equal(raster.offX, Math.trunc(bounds.xMin * 0.9));
    assert.equal(raster.offY, Math.trunc(bounds.yMin * 0.9));
    assert.equal(raster.width, Math.trunc(bounds.width * 0.9));
    assert.equal(raster.height, Math.trunc(bounds.height * 0.9));
    assert.equal(raster.matrix.tx, -bounds.xMin * 0.9);
    assert.equal(raster.matrix.ty, -bounds.yMin * 0.9);
    assert.equal(raster.validatedAgainstFlashGetRect, false);
  }
  assert.equal(manifest.sprites.A8_attack.rasterized.offX, -50);
  assert.equal(manifest.sprites.A8_attack.rasterized.offY, -59);
  assert.equal(manifest.sprites.A8_attack.rasterized.width, 79);
  assert.equal(manifest.sprites.A8_attack.rasterized.height, 64);
});

test('named scenery and every named sound use the original symbol CSV IDs', () => {
  const units = symbols('recovered/unit-media/symbolClass/symbols.csv');
  const game = symbols('recovered/game-media/symbolClass/symbols.csv');
  assert.deepEqual(Object.keys(manifest.images).sort(), ['bg1', 'bg2', 'door', 'terrain', 'terrain2']);
  for (const [name, image] of Object.entries(manifest.images)) {
    assert.equal(image.characterId, units[name]);
    assert.deepEqual(pngSize(read(image.file)), { width: image.width, height: image.height });
  }
  const expectedSounds = [
    'SD_cheer', 'SD_btns', 'SD_Timer', 'SD_dead6', 'SD_dead5', 'SD_dao',
    'SD_dead1', 'SD_dead3', 'SD_dead2', 'SD_cha', 'SD_dead4',
    'mainLoop', 'sd_win', 'sd_lose', 'gameLoop',
  ];
  assert.equal(manifest.counts.namedSounds, expectedSounds.length);
  for (const name of expectedSounds) {
    const sound = manifest.sounds[name];
    assert.equal(sound.characterId, (sound.sourceDomain === 'unit' ? units : game)[name]);
    assert.equal(sound.sourceSymbol, name);
  }
  assert.equal(Object.keys(manifest.sounds).length, 16);
  assert.equal(manifest.sounds['game-sound-0028'].sourceSymbol, null);
});

test('UI bitmap resources and original embedded font subsets are retained', () => {
  assert.equal(Object.keys(manifest.uiImages).length, 56);
  assert.equal(Object.keys(manifest.fonts).length, 6);
  for (const image of Object.values(manifest.uiImages)) {
    assert.deepEqual(pngSize(read(image.file)), { width: image.width, height: image.height });
  }
  for (const font of Object.values(manifest.fonts)) {
    assert.equal(font.subset, true);
    assert.ok(font.file.endsWith('.ttf'));
  }
});

test('all production files have safe paths and verified hashes, sizes, and source copies', () => {
  let bytes = 0;
  const paths = new Set();
  for (const file of manifest.files) {
    assert.ok(file.file.startsWith('assets/generated/'));
    assert.match(file.file, /^[a-z0-9/.-]+$/);
    assert.ok(!file.file.split('/').includes('..'));
    assert.ok(!paths.has(file.file), file.file);
    paths.add(file.file);
    const content = read(file.file);
    assert.equal(hash(content), file.sha256, file.file);
    assert.equal(content.length, file.bytes, file.file);
    if (file.sourceFile) assert.deepEqual(content, read(file.sourceFile), file.file);
    bytes += content.length;
  }
  assert.equal(bytes, manifest.counts.bytes);
  assert.equal(paths.size, manifest.counts.files);
  assert.deepEqual([...paths].sort(), walk('assets/generated'));
});

test('production assets do not require a SWF player or a SWF file', () => {
  assert.equal(manifest.generation.runtimeSwfDependency, false);
  assert.equal(manifest.fidelity.pixelPerfectValidated, false);
  for (const file of walk('assets/generated')) {
    assert.ok(['.png', '.mp3', '.ttf', '.json'].includes(path.extname(file)), file);
    assert.ok(!file.toLowerCase().endsWith('.swf'), file);
  }
  for (const source of manifest.generation.sourceFiles) {
    assert.ok(!source.file.toLowerCase().endsWith('.swf'));
    assert.equal(hash(read(source.file)), source.sha256);
  }
  assert.ok(!JSON.stringify(manifest).includes('.local/'));
  assert.ok(!JSON.stringify(manifest).includes('C:\\'));
});
