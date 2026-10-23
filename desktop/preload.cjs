'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Fixed channels and bounded allowlisted data only. No paths, arbitrary IPC, or Node handles
// are exposed to the sandboxed game page.
contextBridge.exposeInMainWorld('miragineDesktop', Object.freeze({
  loadPreferences: () => ipcRenderer.invoke('miragine:preferences:load'),
  saveNeverTutorial: value => {
    if (typeof value !== 'boolean') return Promise.reject(new TypeError('Expected a boolean'));
    return ipcRenderer.invoke('miragine:preferences:save-never', value);
  },
  loadCustomSettings: () => ipcRenderer.invoke('miragine:custom-settings:load'),
  saveCustomSettings: (entries, expectedEntries) => ipcRenderer.invoke('miragine:custom-settings:save', entries, expectedEntries),
  getFullscreen: () => ipcRenderer.invoke('miragine:fullscreen:get'),
  toggleFullscreen: () => ipcRenderer.invoke('miragine:fullscreen:toggle'),
  onFullscreenChanged: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a fullscreen callback');
    let active = true;
    // Never pass the privileged Electron event object into the renderer.
    const listener = (_event, value) => { if (active && typeof value === 'boolean') callback(value); };
    ipcRenderer.on('miragine:fullscreen:changed', listener);
    return () => {
      if (!active) return;
      active = false;
      ipcRenderer.removeListener('miragine:fullscreen:changed', listener);
    };
  },
}));
