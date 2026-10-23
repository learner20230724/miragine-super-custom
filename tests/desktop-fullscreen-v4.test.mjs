import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { isTrustedPreferenceRequest } = require('../desktop/preferences.cjs');
const read = file => fs.readFileSync(new URL(`../desktop/${file}`, import.meta.url), 'utf8');

function preloadFixture() {
  let bridge;
  const calls = [], removed = [];
  const renderer = new EventEmitter();
  renderer.invoke = (...args) => { calls.push(args); return Promise.resolve(true); };
  const remove = renderer.removeListener.bind(renderer);
  renderer.removeListener = (channel, listener) => { removed.push(channel); return remove(channel, listener); };
  vm.runInNewContext(read('preload.cjs'), { require(name) {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'miragineDesktop'); bridge = value; } }, ipcRenderer: renderer };
  } });
  return { bridge, calls, renderer, removed };
}

async function desktopFixture() {
  const handlers = new Map();
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, setPath() {}, setAppLogsPath() {},
    commandLine: { appendSwitch() {} }, async whenReady() {}, quit() {},
  });
  const server = { once() {}, listen(_port, _host, ready) { ready(); }, address() { return { port: 53210 }; }, close() {}, closeAllConnections() {} };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.fullscreen = false;
      this.transitions = [];
      this.sent = [];
      this.contentsDestroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: '' }, setWindowOpenHandler() {},
        session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } },
        isDestroyed: () => this.contentsDestroyed,
        send: (...args) => this.sent.push(args),
      });
    }
    isFullScreen() { return this.fullscreen; }
    setFullScreen(value) {
      this.transitions.push(value);
      if (this.fullscreen === value) return;
      this.fullscreen = value;
      this.emit(value ? 'enter-full-screen' : 'leave-full-screen');
    }
    show() {}
    async loadURL(url) { this.webContents.mainFrame.url = url; }
  }
  const electron = { app, BrowserWindow: Window, Menu: { setApplicationMenu() {} }, dialog: {},
    ipcMain: { handle(channel, handler) { assert.equal(handlers.has(channel), false); handlers.set(channel, handler); }, removeHandler(channel) { handlers.delete(channel); } },
  };
  const module = { exports: {} };
  const dependencies = {
    'node:fs': { mkdirSync() {} }, 'node:path': path,
    './static-server.cjs': { createStaticServer: () => server },
    './preferences.cjs': { isTrustedPreferenceRequest, readPreferences() {}, saveNeverTutorial() {} },
    './custom-settings.cjs': { readCustomSettings() {}, saveCustomSettings() {} },
  };
  vm.runInNewContext(read('main.cjs'), {
    module, require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
    __dirname: '/fixture/desktop', process: { execPath: '/fixture/game', env: {} }, console,
  });
  const { window } = await module.exports.startDesktop({ electron, appRoot: '/fixture' });
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { handlers, window, event, app };
}

test('fullscreen preload has only fixed get/toggle channels and a frozen bounded bridge', async () => {
  const { bridge, calls } = preloadFixture();
  assert.equal(Object.isFrozen(bridge), true);
  assert.deepEqual(Object.keys(bridge).sort(), [
    'getFullscreen', 'loadCustomSettings', 'loadPreferences', 'onFullscreenChanged',
    'saveCustomSettings', 'saveNeverTutorial', 'toggleFullscreen',
  ]);
  assert.equal(await bridge.getFullscreen('ignored arbitrary channel'), true);
  assert.equal(await bridge.toggleFullscreen('ignored window method'), true);
  assert.deepEqual(calls, [['miragine:fullscreen:get'], ['miragine:fullscreen:toggle']]);
});

test('fullscreen subscriptions expose only boolean state, never the Electron event, and unsubscribe idempotently', () => {
  const { bridge, renderer, removed } = preloadFixture();
  const seen = [];
  const unsubscribe = bridge.onFullscreenChanged((...args) => seen.push(args));
  const listener = renderer.listeners('miragine:fullscreen:changed')[0];
  const privilegedEvent = { sender: { secret: true } };
  for (const value of [false, true, 'true', 1, null, {}, undefined]) renderer.emit('miragine:fullscreen:changed', privilegedEvent, value);
  assert.deepEqual(seen, [[false], [true]]);
  unsubscribe(); unsubscribe();
  renderer.emit('miragine:fullscreen:changed', privilegedEvent, false);
  listener(privilegedEvent, false);
  assert.deepEqual(seen, [[false], [true]]);
  assert.equal(renderer.listenerCount('miragine:fullscreen:changed'), 0);
  assert.deepEqual(removed, ['miragine:fullscreen:changed']);
  for (const callback of [null, 42, {}, 'callback']) assert.throws(() => bridge.onFullscreenChanged(callback), /Expected a fullscreen callback/);
});

test('fullscreen IPC requires the exact owned window, main frame and loopback origin', async () => {
  const { handlers, window, event } = await desktopFixture();
  const get = handlers.get('miragine:fullscreen:get'), toggle = handlers.get('miragine:fullscreen:toggle');
  assert.equal(get(event), false);
  for (const bad of [{}, { ...event, sender: {} }, { ...event, senderFrame: { url: event.senderFrame.url } }]) {
    assert.throws(() => get(bad), /Untrusted fullscreen request/);
    assert.throws(() => toggle(bad), /Untrusted fullscreen request/);
  }
  const originalURL = event.senderFrame.url;
  for (const url of ['http://127.0.0.1:53211/', 'https://example.invalid/', 'file:///fixture/index.html', 'not a URL']) {
    event.senderFrame.url = url;
    assert.throws(() => get(event), /Untrusted fullscreen request/);
    assert.throws(() => toggle(event), /Untrusted fullscreen request/);
  }
  event.senderFrame.url = originalURL;
  assert.deepEqual(window.transitions, []);
  assert.equal(toggle(event), true);
  assert.equal(get(event), true);
});

test('the visible button and native F11 use the same fullscreen state and events', async () => {
  const { handlers, window, event } = await desktopFixture();
  const get = handlers.get('miragine:fullscreen:get'), toggle = handlers.get('miragine:fullscreen:toggle');
  assert.equal(toggle(event), true);
  let prevented = 0;
  window.webContents.emit('before-input-event', { preventDefault() { prevented++; } }, { type: 'keyDown', key: 'F11', isAutoRepeat: false });
  assert.equal(prevented, 1);
  assert.equal(get(event), false);
  assert.equal(toggle(event), true);
  assert.deepEqual(window.transitions, [true, false, true]);
  assert.deepEqual(window.sent, [
    ['miragine:fullscreen:changed', true], ['miragine:fullscreen:changed', false], ['miragine:fullscreen:changed', true],
  ]);
});

test('held F11 does not flicker or leak auto-repeat keydown into the game renderer', async () => {
  const { window } = await desktopFixture();
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  const input = { type: 'keyDown', key: 'F11', isAutoRepeat: false };
  window.webContents.emit('before-input-event', event, input);
  for (let index = 0; index < 20; index++) window.webContents.emit('before-input-event', event, { ...input, isAutoRepeat: true });
  assert.equal(prevented, 21);
  assert.deepEqual(window.transitions, [true]);
  window.webContents.emit('before-input-event', event, { ...input, type: 'keyUp' });
  window.webContents.emit('before-input-event', event, { ...input, key: 'F2' });
  assert.equal(prevented, 21);
  window.webContents.emit('before-input-event', event, input);
  assert.deepEqual(window.transitions, [true, false]);
});

test('native fullscreen changes publish state unless the renderer has already been destroyed', async () => {
  const { window } = await desktopFixture();
  window.fullscreen = true;
  window.emit('enter-full-screen');
  window.fullscreen = false;
  window.emit('leave-full-screen');
  assert.deepEqual(window.sent, [['miragine:fullscreen:changed', true], ['miragine:fullscreen:changed', false]]);
  window.contentsDestroyed = true;
  window.fullscreen = true;
  window.emit('enter-full-screen');
  assert.equal(window.sent.length, 2);
});

test('quitting removes fullscreen handlers without removing existing preference and custom-store support early', async () => {
  const { handlers, app } = await desktopFixture();
  assert.deepEqual([...handlers.keys()].sort(), [
    'miragine:custom-settings:load', 'miragine:custom-settings:save',
    'miragine:fullscreen:get', 'miragine:fullscreen:toggle',
    'miragine:preferences:load', 'miragine:preferences:save-never',
  ]);
  app.emit('will-quit');
  assert.equal(handlers.size, 0);
});
