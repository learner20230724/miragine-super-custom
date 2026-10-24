import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canvasTransformClose, compareClarityPixels, makeClarityFixtures, parseOptions } from '../tools/verify-native-clarity.mjs';

test('native clarity options keep evidence inside ignored locations', () => {
  assert.deepEqual(parseOptions([]), { channel: 'msedge', report: '.local/native-clarity-verification.json', output: 'output/playwright/native-clarity' });
  assert.equal(parseOptions(['--report', '.local/native-clarity-fresh.json']).report, '.local/native-clarity-fresh.json');
  assert.equal(parseOptions(['--output', 'output\\playwright\\native-clarity-new']).output, 'output/playwright/native-clarity-new');
  assert.equal(parseOptions(['--help']).help, true);
  for (const args of [['--bad'], ['--channel'], ['--channel', 'msedge', '--channel', 'chrome'],
    ['--report', '../proof.json'], ['--report', '.local/../proof.json'], ['--report', 'docs/proof.json'],
    ['--report', '.local/'], ['--output', '/output/playwright/proof'], ['--output', 'output/playwright/../private'],
    ['--output', 'output/playwright/proof:secret']]) assert.throws(() => parseOptions(args));
});

test('native clarity pixel metric reports exact identity without mutating arrays', () => {
  const before = new Uint8ClampedArray([0, 20, 30, 255, 90, 10, 45, 255]);
  const after = new Uint8ClampedArray(before), original = [...before];
  const result = compareClarityPixels({ width: 2, height: 1, before, after });
  assert.equal(result.changedPixels, 0); assert.equal(result.maxChannelDifference, 0);
  assert.equal(result.meanAbsoluteChannelDifference, 0);
  assert.equal(result.meanAdjacentPremultipliedLuminanceDifference.before, result.meanAdjacentPremultipliedLuminanceDifference.after);
  assert.deepEqual([...before], original); assert.deepEqual([...after], original);
});

test('native clarity edge metric distinguishes a sharp edge from a flat sample', () => {
  const before = [127, 127, 127, 255, 127, 127, 127, 255], after = [0, 0, 0, 255, 255, 255, 255, 255];
  const result = compareClarityPixels({ width: 2, height: 1, before, after });
  assert.equal(result.changedPixels, 2); assert.equal(result.changedFraction, 1);
  assert.equal(result.maxChannelDifference, 128);
  assert.equal(result.meanAdjacentPremultipliedLuminanceDifference.before, 0);
  assert.ok(Math.abs(result.meanAdjacentPremultipliedLuminanceDifference.after - 255) < 1e-8);
});

test('transparent hidden RGB does not inflate premultiplied luminance edge energy', () => {
  const before = [0, 0, 0, 0, 255, 255, 255, 0];
  const result = compareClarityPixels({ width: 2, height: 1, before, after: before });
  assert.equal(result.meanAdjacentPremultipliedLuminanceDifference.before, 0);
  assert.equal(compareClarityPixels({ width: 1, height: 1, before: [0, 0, 0, 0], after: [0, 0, 0, 0] })
    .meanAdjacentPremultipliedLuminanceDifference.after, 0);
});

test('native clarity metric rejects mismatched or empty buffers', () => {
  for (const data of [{ width: 0, height: 1, before: [], after: [] },
    { width: 1.5, height: 1, before: [], after: [] },
    { width: 1, height: 1, before: [0, 0, 0, 0], after: [0] },
    { width: 1, height: 1, before: null, after: null }]) assert.throws(() => compareClarityPixels(data));
});

test('Canvas transform comparison allows measured float32 rounding, not a displaced pixel', () => {
  assert.equal(canvasTransformClose(993.9999580383301, 994), true);
  assert.equal(canvasTransformClose(.758093321358011, .758093356265), true);
  assert.equal(canvasTransformClose(994.01, 994), false);
  assert.equal(canvasTransformClose(993, 994), false);
  assert.equal(canvasTransformClose(1, 4.96875), false);
  assert.equal(canvasTransformClose(Infinity, Infinity), false);
  assert.equal(canvasTransformClose(NaN, 0), false);
});

test('native clarity fixtures use unchanged real PNG frames with a common camera', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../generated/asset-manifest.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(manifest), fixtures = makeClarityFixtures(manifest);
  assert.equal(JSON.stringify(manifest), before);
  assert.deepEqual(fixtures.views.map(item => item.view.zoom), [.1525338745, 1, 2]);
  assert.equal(fixtures.width, 3180); assert.equal(fixtures.height, 1988);
  assert.deepEqual(fixtures.units.map(unit => unit.name), ['A0_idle', 'B3_attack', 'A14_run']);
  for (const unit of fixtures.units) {
    assert.equal(unit.entity.px, fixtures.camera.x); assert.equal(unit.entity.py, fixtures.camera.y);
    assert.equal(unit.original.file, manifest.sprites[unit.name].frames[0].file);
  }
  assert.throws(() => makeClarityFixtures({ sprites: {} }), /Missing clarity fixture/);
});

test('clarity verifier is isolated and compares actual PNG draw commands, not only backing sizes', () => {
  const source = fs.readFileSync(new URL('../tools/verify-native-clarity.mjs', import.meta.url), 'utf8');
  assert.match(source, /spriteRasterMode: 'source'/);
  assert.match(source, /setRenderScale\(scaleX, scaleY\)/);
  assert.match(source, /ctx\.drawImage = function/);
  assert.match(source, /finalCanvasReferenceDifference\.changedPixels === 0/);
  assert.match(source, /finalFrameDifference\.changedPixels > 0/);
  assert.match(source, /transparent replay can use different backend\/alpha sampling/);
  assert.match(source, /sourceBytesVerified = true/);
  assert.match(source, /existing evidence is never overwritten/);
  assert.doesNotMatch(source, /import\('\/src\/app\/main/);
  assert.doesNotMatch(source, /localStorage\.(setItem|clear|removeItem)/);
});
