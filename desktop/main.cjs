'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createStaticServer } = require('./static-server.cjs');

function portablePaths(appRoot, executable, isPackaged) {
  const root = path.resolve(appRoot);
  const portableRoot = isPackaged ? path.dirname(path.resolve(executable)) : root;
  return {
    appRoot: root, portableRoot,
    data: path.join(portableRoot, 'userdata'), temp: path.join(portableRoot, '.tmp'),
    custom: path.join(portableRoot, 'config', 'custom.json'),
    helper: path.join(portableRoot, 'ui-helper', 'original-graphics.js'),
  };
}

/** Seed a missing portable file atomically; never truncate an existing edit. */
function seedEditableFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.writeFileSync(destination, fs.readFileSync(source), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST' && fs.statSync(destination).isFile()) return false;
    throw error;
  }
}

async function startDesktop({ electron = require('electron'), appRoot = path.resolve(__dirname, '..') } = {}) {
  const { app, BrowserWindow, Menu, dialog } = electron;
  const locations = portablePaths(appRoot, process.execPath, app.isPackaged);
  let server;
  try {
    const { data, temp } = locations;
    for (const directory of [data, temp, ...['logs', 'crashes', 'session', 'cache'].map((name) => path.join(data, name))]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    Object.assign(process.env, { TEMP: temp, TMP: temp, TMPDIR: temp });
    app.setPath('userData', data);
    app.setPath('sessionData', path.join(data, 'session'));
    app.setPath('temp', temp);
    app.setPath('crashDumps', path.join(data, 'crashes'));
    app.setAppLogsPath(path.join(data, 'logs'));
    app.commandLine.appendSwitch('disable-background-networking');
    app.commandLine.appendSwitch('disk-cache-dir', path.join(data, 'cache'));
    if (app.isPackaged) {
      seedEditableFile(path.join(locations.appRoot, 'config', 'custom.json'), locations.custom);
      seedEditableFile(path.join(locations.appRoot, 'generated', 'ui', 'original-graphics.js'), locations.helper);
    }
    const closeServer = () => {
      if (server) {
        server.close();
        server.closeAllConnections?.();
        server = null;
      }
    };
    app.on('before-quit', closeServer);
    app.on('window-all-closed', () => { closeServer(); app.quit(); });
    await app.whenReady();
    server = createStaticServer(locations.appRoot, app.isPackaged ? {
      customFile: locations.custom, helperFile: locations.helper, externalRoot: locations.portableRoot,
    } : {});
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    Menu.setApplicationMenu(null);
    const win = new BrowserWindow({
      width: 1280, height: 960, minWidth: 480, minHeight: 360, show: false,
      title: '超级米拉奇战记', backgroundColor: '#0e0e0e',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, webviewTag: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('will-redirect', (event) => event.preventDefault());
    win.webContents.on('will-attach-webview', (event) => event.preventDefault());
    const session = win.webContents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      let permitted = false;
      try { permitted = new URL(details.url).origin === origin; } catch { /* Deny malformed requests. */ }
      callback({ cancel: !permitted });
    });
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        event.preventDefault();
        win.setFullScreen(!win.isFullScreen());
      }
    });
    win.once('ready-to-show', () => win.show());
    await win.loadURL(`${origin}/`);
    return { window: win, server, locations };
  } catch (error) {
    if (server) { server.close(); server.closeAllConnections?.(); }
    console.error(error);
    dialog?.showErrorBox('无法启动游戏 / Unable to start', String(error.message || error));
    app.quit();
    throw error;
  }
}

module.exports = { portablePaths, seedEditableFile, startDesktop };
if (require.main === module) startDesktop().catch(() => { process.exitCode = 1; });
