import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAutoOptions, correctAutoOrder, autoTiming, typeByMouseAndKeyboard,
  answerSettingsConfirmation, withHeldKeys } from '../tools/verify-settings-auto.mjs';

const args = ['--dir', 'dist/settings-auto-proof/MiragineSuper', '--version', '0.7.2-preview.1', '--commit', 'a'.repeat(40)];
test('automatic-settings verifier requires explicit provenance and safe local outputs', () => {
  assert.equal(parseAutoOptions(args).out, '.local/keyboard-controls-qa.json');
  assert.equal(parseAutoOptions(args).screenshotPrefix, 'settings-auto-keyboard-controls');
  assert.throws(() => parseAutoOptions(args.slice(0, 4)), /Supply/);
  assert.throws(() => parseAutoOptions([...args, '--unknown', 'x']), /Expected/);
  assert.throws(() => parseAutoOptions([...args, '--out', 'README.json']), /ignored output/);
  assert.throws(() => parseAutoOptions([...args, '--screenshot-prefix', '../escape']), /safe/);
});
test('automatic-settings verifier checks actual homepage order and both sides', () => {
  const parts = [{ kind: 'summary' }, { title: '生成士兵 / 清场' }, { title: '通用基础规则' }, { sides: ['left', 'right'] }];
  assert.equal(correctAutoOrder(parts), true);
  assert.equal(correctAutoOrder([parts[0], parts[2], parts[1], parts[3]]), false);
  assert.equal(correctAutoOrder([...parts.slice(0, 3), { sides: ['left'] }]), false);
});
test('high-target observation reports measured throughput instead of assuming target achieved', () => {
  const result = autoTiming({ at: 100, frame: 10 }, { at: 600, frame: 40 }, 100);
  assert.equal(result.simulationHz, 60); assert.equal(result.actualSpeed, 2); assert.equal(result.target, 100);
  assert.equal(result.logicalHz, 30); assert.equal(result.advancing, true);
  assert.equal(autoTiming({ at: 0, frame: 0 }, { at: 100, frame: 0 }, 0).frozen, true);
  assert.throws(() => autoTiming({ at: 10, frame: 0 }, { at: 10, frame: 0 }, 1), /Invalid/);
  assert.throws(() => autoTiming({ at: 0, frame: 0 }, { at: 100, frame: 1 }, 101), /Invalid/);
});

function keyboardFixture({ windowFocused = true, controlFocused = true, acceptsTyping = true } = {}) {
  const calls = [], data = { value: 'old value' };
  const document = { hasFocus: () => windowFocused, activeElement: null };
  const node = { ownerDocument: document };
  Object.defineProperty(node, 'value', { get: () => data.value,
    set() { throw new Error('The read-only focus/value probe must not write the input'); } });
  const forbidden = method => () => { throw new Error(`Forbidden locator method: ${method}`); };
  const control = {
    async click() { calls.push(['click']); document.activeElement = controlFocused ? node : null; },
    async evaluate(callback) {
      calls.push(['evaluate']);
      return callback(node);
    },
    fill: forbidden('fill'), focus: forbidden('focus'), press: forbidden('press'),
  };
  const page = { keyboard: {
    async press(key) { calls.push(['keyboard.press', key]); },
    async type(value) {
      calls.push(['keyboard.type', value]);
      if (acceptsTyping) data.value = value;
    },
  } };
  return { page, control, calls };
}

test('numeric acceptance really clicks, verifies focus, types and commits with page keyboard', async () => {
  const fixture = keyboardFixture();
  await typeByMouseAndKeyboard({ ...fixture, value: 123.5 });
  assert.deepEqual(fixture.calls, [['click'], ['evaluate'], ['keyboard.press', 'Control+A'],
    ['keyboard.type', '123.5'], ['evaluate'], ['keyboard.press', 'Enter']]);
});

test('numeric acceptance can commit by leaving the input with Tab', async () => {
  const fixture = keyboardFixture();
  await typeByMouseAndKeyboard({ ...fixture, value: '411', commitKey: 'Tab' });
  assert.deepEqual(fixture.calls, [['click'], ['evaluate'], ['keyboard.press', 'Control+A'],
    ['keyboard.type', '411'], ['evaluate'], ['keyboard.press', 'Tab']]);
});

for (const options of [{ windowFocused: false }, { controlFocused: false }]) {
  test(`numeric acceptance refuses to type when ${Object.keys(options)[0]} is false`, async () => {
    const fixture = keyboardFixture(options);
    await assert.rejects(typeByMouseAndKeyboard({ ...fixture, value: 1200 }));
    assert.deepEqual(fixture.calls, [['click'], ['evaluate']]);
  });
}

test('numeric acceptance fails before commit if keyboard text did not reach the input', async () => {
  const fixture = keyboardFixture({ acceptsTyping: false });
  await assert.rejects(typeByMouseAndKeyboard({ ...fixture, value: 1300 }));
  assert.deepEqual(fixture.calls, [['click'], ['evaluate'], ['keyboard.press', 'Control+A'],
    ['keyboard.type', '1300'], ['evaluate']]);
});

function confirmationFixture(message = '将全部面板参数恢复为原版默认并自动保存？') {
  const calls = [];
  let visible = true;
  const dialog = {
    async waitFor(options) {
      calls.push(['waitFor', options]);
      assert.equal(visible, options.state === 'visible');
    },
    async textContent() { calls.push(['textContent']); return message; },
  };
  const page = {
    locator(selector) {
      calls.push(['locator', selector]);
      if (selector === '[data-settings-confirm]') return dialog;
      assert.ok(['[data-settings-confirm-accept]', '[data-settings-confirm-cancel]'].includes(selector),
        'Confirmation must target the visible DOM controls');
      return { async click() { calls.push(['click', selector]); assert.equal(visible, true); visible = false; } };
    },
    keyboard: { async press(key) {
      calls.push(['keyboard.press', key]); assert.equal(key, 'Escape'); assert.equal(visible, true); visible = false;
    } },
  };
  return { page, calls, message, isVisible: () => visible };
}

for (const choice of ['accept', 'cancel', 'escape']) {
  test(`settings confirmation uses the visible ${choice} action and waits for closure`, async () => {
    const fixture = confirmationFixture();
    const options = { page: fixture.page, expectedText: /恢复为原版默认/ };
    if (choice !== 'accept') options.choice = choice; // Exercise the default affirmative choice too.
    const result = await answerSettingsConfirmation(options);
    const action = choice === 'escape' ? [['keyboard.press', 'Escape']]
      : [['locator', `[data-settings-confirm-${choice}]`], ['click', `[data-settings-confirm-${choice}]`]];
    assert.deepEqual(fixture.calls, [['locator', '[data-settings-confirm]'],
      ['waitFor', { state: 'visible', timeout: 10000 }], ['textContent'], ...action,
      ['waitFor', { state: 'hidden', timeout: 10000 }]]);
    assert.deepEqual(result, { type: 'dom', choice, message: fixture.message });
    assert.equal(fixture.isVisible(), false);
  });
}

test('settings confirmation refuses an unexpected message without accepting or dismissing it', async () => {
  const fixture = confirmationFixture('结束当前战局并返回主菜单？');
  await assert.rejects(answerSettingsConfirmation({ page: fixture.page, expectedText: /恢复为原版默认/ }),
    /Unexpected settings confirmation text/);
  assert.deepEqual(fixture.calls, [['locator', '[data-settings-confirm]'],
    ['waitFor', { state: 'visible', timeout: 10000 }], ['textContent']]);
  assert.equal(fixture.isVisible(), true);
});

test('settings confirmation rejects an unknown choice before interacting with the page', async () => {
  const fixture = confirmationFixture();
  await assert.rejects(answerSettingsConfirmation({ page: fixture.page, choice: 'native-accept' }),
    /Unknown confirmation choice/);
  assert.deepEqual(fixture.calls, []);
});

function heldKeysFixture({ downFailureKey = null, upFailureKey = null } = {}) {
  const calls = [], held = new Set();
  const downError = new Error('keydown failed'), upError = new Error('keyup failed');
  const keyboard = {
    async down(key) {
      calls.push(['down', key]);
      if (key === downFailureKey) throw downError;
      assert.equal(held.has(key), false, 'A held key must not receive synthetic repeat keydown events');
      held.add(key);
    },
    async up(key) {
      calls.push(['up', key]);
      assert.equal(held.has(key), true, 'Only successfully pressed keys should be released');
      held.delete(key);
      if (key === upFailureKey) throw upError;
    },
    async press() { throw new Error('Held keys require down/up, not keyboard.press'); },
    async type() { throw new Error('Held keys require down/up, not keyboard.type'); },
  };
  return { keyboard, calls, held, downError, upError };
}

test('held-key acceptance presses each key once, awaits one observation and releases in reverse order', async () => {
  const fixture = heldKeysFixture(), keys = ['Shift', 'j', 'l'];
  let observations = 0;
  await withHeldKeys({ keyboard: fixture.keyboard, keys, during: async () => {
    observations++; fixture.calls.push(['during', 'start']);
    assert.deepEqual([...fixture.held], keys);
    await Promise.resolve();
    assert.deepEqual([...fixture.held], keys, 'Keys must stay down until the asynchronous observation finishes');
    fixture.calls.push(['during', 'end']);
  } });
  assert.equal(observations, 1);
  assert.deepEqual(fixture.calls, [['down', 'Shift'], ['down', 'j'], ['down', 'l'],
    ['during', 'start'], ['during', 'end'], ['up', 'l'], ['up', 'j'], ['up', 'Shift']]);
  assert.equal(fixture.held.size, 0);
  assert.deepEqual(keys, ['Shift', 'j', 'l'], 'Cleanup must not reverse the caller-owned key list in place');
});

test('held-key acceptance releases all pressed keys when its observation fails', async () => {
  const fixture = heldKeysFixture(), failure = new Error('observation failed');
  let observations = 0;
  await assert.rejects(withHeldKeys({ keyboard: fixture.keyboard, keys: ['j', 'l'], during: async () => {
    observations++; fixture.calls.push(['during']); throw failure;
  } }), error => error === failure);
  assert.equal(observations, 1);
  assert.deepEqual(fixture.calls, [['down', 'j'], ['down', 'l'], ['during'], ['up', 'l'], ['up', 'j']]);
  assert.equal(fixture.held.size, 0);
});

test('held-key acceptance releases prior successful keys if a later keydown fails', async () => {
  const fixture = heldKeysFixture({ downFailureKey: 'l' });
  await assert.rejects(withHeldKeys({ keyboard: fixture.keyboard, keys: ['Shift', 'j', 'l', 'i'], during() {
    fixture.calls.push(['during']);
  } }), error => error === fixture.downError);
  assert.deepEqual(fixture.calls, [['down', 'Shift'], ['down', 'j'], ['down', 'l'], ['up', 'j'], ['up', 'Shift']]);
  assert.equal(fixture.held.size, 0);
});

test('held-key acceptance does not observe or release unpressed keys if the first keydown fails', async () => {
  const fixture = heldKeysFixture({ downFailureKey: 'j' });
  await assert.rejects(withHeldKeys({ keyboard: fixture.keyboard, keys: ['j', 'l'], during() {
    fixture.calls.push(['during']);
  } }), error => error === fixture.downError);
  assert.deepEqual(fixture.calls, [['down', 'j']]);
  assert.equal(fixture.held.size, 0);
});

test('held-key acceptance rejects empty, duplicate or non-string key lists before sending input', async () => {
  for (const keys of [undefined, null, 'j', [], [''], ['j', ''], ['j', 1], [null], ['j', 'j']]) {
    const fixture = heldKeysFixture();
    await assert.rejects(withHeldKeys({ keyboard: fixture.keyboard, keys, during() { fixture.calls.push(['during']); } }));
    assert.deepEqual(fixture.calls, [], `Invalid keys must not cause any input: ${JSON.stringify(keys)}`);
  }
});

test('held-key acceptance requires an observation callback before sending input', async () => {
  for (const during of [undefined, null, 0, 'observe', {}]) {
    const fixture = heldKeysFixture();
    await assert.rejects(withHeldKeys({ keyboard: fixture.keyboard, keys: ['j'], during }));
    assert.deepEqual(fixture.calls, []);
  }
});

test('held-key acceptance keeps releasing other keys after a keyup failure', async () => {
  const fixture = heldKeysFixture({ upFailureKey: 'l' });
  await assert.rejects(withHeldKeys({ keyboard: fixture.keyboard, keys: ['Shift', 'j', 'l'], during() {
    fixture.calls.push(['during']);
  } }), error => error === fixture.upError);
  assert.deepEqual(fixture.calls, [['down', 'Shift'], ['down', 'j'], ['down', 'l'], ['during'],
    ['up', 'l'], ['up', 'j'], ['up', 'Shift']]);
  assert.equal(fixture.held.size, 0);
});

test('held-key acceptance preserves its observation error even if keyup also fails', async () => {
  const fixture = heldKeysFixture({ upFailureKey: 'l' }), failure = new Error('original observation failure');
  await assert.rejects(withHeldKeys({ keyboard: fixture.keyboard, keys: ['j', 'l'], during() {
    fixture.calls.push(['during']); throw failure;
  } }), error => error === failure);
  assert.deepEqual(fixture.calls, [['down', 'j'], ['down', 'l'], ['during'], ['up', 'l'], ['up', 'j']]);
  assert.equal(fixture.held.size, 0);
});
