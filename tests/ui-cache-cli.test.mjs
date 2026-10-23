import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonDescription, parseOptions } from '../tools/verify-ui-cache.mjs';

test('UI cache CLI defaults to strict RGBA equality', () => {
  assert.deepEqual(parseOptions([]), { channel: 'msedge', maxChannelDifference: 0 });
  assert.equal(parseOptions(['--help']).help, true);
});

test('UI cache CLI requires an explicit integer 0, 1 or 2 channel allowance', () => {
  assert.equal(parseOptions(['--max-channel-difference', '0']).maxChannelDifference, 0);
  assert.equal(parseOptions(['--max-channel-difference', '1']).maxChannelDifference, 1);
  assert.equal(parseOptions(['--max-channel-difference', '2']).maxChannelDifference, 2);
  for (const value of ['3', '85', '-1', '0.5', '1.0', '2.0', '01', '02', 'NaN', 'Infinity']) {
    assert.throws(() => parseOptions(['--max-channel-difference', value]), /exactly 0, 1 or 2/);
  }
});

test('UI cache report describes custom allowance 2 separately from strict0 and bounded1', () => {
  assert.equal(comparisonDescription(0), 'Strict RGBA equality');
  assert.match(comparisonDescription(1), /at most 1\/255/);
  assert.doesNotMatch(comparisonDescription(1), /custom numeric/);
  assert.match(comparisonDescription(2), /custom numeric compositing tolerance/);
  assert.match(comparisonDescription(2), /not strict RGBA identity or <=1 bounded rounding/);
  assert.match(comparisonDescription(2), /exact alpha, hotspots and simulation frame required/);
  assert.throws(() => comparisonDescription(3), /must be 0, 1 or 2/);
});

test('UI cache CLI accepts only unauthenticated HTTP loopback origins', () => {
  assert.equal(parseOptions(['--url', 'http://127.0.0.1:51286/a?b=c']).url, 'http://127.0.0.1:51286');
  assert.equal(parseOptions(['--url', 'http://localhost:51286']).url, 'http://localhost:51286');
  for (const url of ['https://localhost', 'http://example.com', 'http://user:password@localhost', 'file:///test']) {
    assert.throws(() => parseOptions(['--url', url]), /HTTP loopback origin/);
  }
});

test('UI cache CLI rejects missing values, obsolete diagnostics and unknown options', () => {
  for (const option of ['--url', '--channel', '--max-channel-difference']) {
    assert.throws(() => parseOptions([option]), /Missing value/);
    assert.throws(() => parseOptions([option, '--help']), /Missing value/);
  }
  assert.throws(() => parseOptions(['--diagnostic-only']), /Unknown option/);
  assert.throws(() => parseOptions(['--allow-all-differences']), /Unknown option/);
});
