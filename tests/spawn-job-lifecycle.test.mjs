import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lifecycleCases, exerciseLifecycle, verifyRetainedState } from './fixtures/spawn-job-gc.mjs';

for (const kind of lifecycleCases) {
  test(`spawn job ${kind} retains only its progress receipt and preserves both armies`, () => {
    verifyRetainedState(exerciseLifecycle(kind));
  });

  test(`spawn job ${kind} allows abandoned simulation GC while editor/controller stay alive`, () => {
    const child = spawnSync(process.execPath, ['--expose-gc',
      fileURLToPath(new URL('./fixtures/spawn-job-gc.mjs', import.meta.url)), kind], {
      encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const report = JSON.parse(child.stdout.trim());
    assert.equal(report.kind, kind);
    assert.equal(report.collected, true);
    assert.equal(report.liveEditor, true);
    assert.equal(report.currentArmyUnchanged, true);
  });
}
