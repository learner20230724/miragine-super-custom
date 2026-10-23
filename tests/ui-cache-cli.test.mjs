import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions } from '../tools/verify-ui-cache.mjs';

test('UI cache CLI defaults to strict RGBA equality', () => {
  assert.deepEqual(parseOptions([]), { channel: 'msedge', maxChannelDifference: 0 });
  assert.equal(parseOptions(['--help']).help, true);
});

test('UI cache CLI requires explicit 0 or 1 channel allowance', () => {
  assert.equal(parseOptions(['--max-channel-difference', '0']).maxChannelDifference, 0);
  assert.equal(parseOptions(['--max-channel-difference', '1']).maxChannelDifference, 1);
  for (const value of ['2', '85', '-1', '0.5', '1.0', '01', 'NaN', 'Infinity']) {
    assert.throws(() => parseOptions(['--max-channel-difference', value]), /exactly 0 or 1/);
  }
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
