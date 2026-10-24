import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parseOptions, compareUiPixels } from '../tools/verify-native-ui.mjs';

test('native UI oracle requires explicit reference and fresh ignored evidence locations', () => {
  assert.equal(parseOptions(['--help']).help, true);
  const options = parseOptions(['--reference', 'dist/reference/view.mjs']);
  assert.equal(options.maxChannelDifference, 0); assert.equal(options.channel, 'msedge');
  assert.equal(parseOptions(['--reference', 'a', '--software-canvas', '--reverse']).softwareCanvas, true);
  assert.equal(parseOptions(['--reference', 'a', '--diagnostic']).diagnostic, true);
  assert.equal(parseOptions(['--reference', 'view.mjs', '--max-channel-difference', '1']).maxChannelDifference, 1);
  for (const args of [[], ['--unknown'], ['--reference'], ['--reference', 'a', '--reference', 'b'],
    ['--reference', 'a', '--max-channel-difference', '2'], ['--reference', 'a', '--report', 'docs/x.json'],
    ['--reference', 'a', '--output', 'output/playwright/../private'], ['--reference', 'a', '--report', '.local/x:secret']]) {
    assert.throws(() => parseOptions(args));
  }
});

test('UI pixel oracle distinguishes strict identity from explicit RGB rounding', () => {
  const before = new Uint8ClampedArray([25, 50, 75, 255]), after = new Uint8ClampedArray([26, 50, 75, 255]);
  const strict = compareUiPixels({ width: 1, height: 1, before, after });
  assert.equal(strict.changedPixels, 1); assert.equal(strict.changedChannels, 1);
  assert.equal(strict.strictRgbaEquality, false); assert.equal(strict.withinBoundedRounding, true);
  assert.equal(strict.withinConfiguredTolerance, false); assert.equal(strict.worstDifference.channel, 0);
  assert.equal(compareUiPixels({ width: 1, height: 1, before, after, maxChannelDifference: 1 }).withinConfiguredTolerance, true);
  assert.deepEqual([...before], [25, 50, 75, 255]);
});

test('UI pixel oracle never tolerates alpha changes or malformed buffers', () => {
  const result = compareUiPixels({ width: 1, height: 1, before: [1, 2, 3, 4], after: [1, 2, 3, 5], maxChannelDifference: 1 });
  assert.equal(result.alphaChangedPixels, 1); assert.equal(result.withinConfiguredTolerance, false);
  for (const bad of [{ width: 0, height: 1, before: [], after: [] },
    { width: 1, height: 1, before: [0], after: [0] },
    { width: 1, height: 1, before: [0, 0, 0, 0], after: [0, 0, 0, 0], maxChannelDifference: 2 }]) assert.throws(() => compareUiPixels(bad));
});

test('UI oracle covers cursor animation and transparency without loading production main or audio', () => {
  const source = fs.readFileSync(new URL('../tools/verify-native-ui.mjs', import.meta.url), 'utf8');
  assert.match(source, /frame < 10/); assert.match(source, /cursor-continuous-/);
  assert.match(source, /title-menu-mid-slide/); assert.match(source, /controller\.underOverlay = 'tutorial'/);
  assert.match(source, /\[1920, 1440, false\]/); assert.match(source, /sourceBytesVerified = true/);
  assert.match(source, /headless: true/); assert.match(source, /browser\.close\(\)/);
  assert.match(source, /c\.getContext\('2d', \{ alpha: false \}\)/);
  assert.match(source, /allCanvasWillReadFrequently: softwareCanvas/);
  assert.doesNotMatch(source, /import\('\/src\/app\/(main|audio)/);
  assert.doesNotMatch(source, /localStorage\.(setItem|clear|removeItem)/);
});

test('pre-optimization native UI reference is byte-exact and explicitly test-only', () => {
  const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/native-view-before-optimization.json', import.meta.url), 'utf8'));
  const source = fs.readFileSync(new URL('./fixtures/native-view-before-optimization.mjs', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), metadata.sha256);
  assert.match(metadata.limits, /not original Flash source/);
  assert.match(metadata.limits, /never a production import/);
  assert.match(metadata.reproduce, /--reference tests\/fixtures\/native-view-before-optimization.mjs/);
});
