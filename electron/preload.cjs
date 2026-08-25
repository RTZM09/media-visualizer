const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('audioBridge', {
  onFeatures: (callback) => {
    ipcRenderer.on('audio-features', (_event, features) => callback(features));
  },
});

contextBridge.exposeInMainWorld('nowPlayingBridge', {
  onUpdate: (callback) => {
    ipcRenderer.on('now-playing', (_event, info) => callback(info));
  },
  togglePlayPause: () => ipcRenderer.invoke('toggle-play-pause'),
  nextTrack: () => ipcRenderer.invoke('next-track'),
  previousTrack: () => ipcRenderer.invoke('previous-track'),
});

// Persisted preferences (currently just the color picked with `s`).
contextBridge.exposeInMainWorld('settingsBridge', {
  get: () => ipcRenderer.invoke('get-settings'),
  setColor: (colorKey) => ipcRenderer.invoke('set-color', colorKey),
});

// Window dragging from anywhere on the app (see src/window-drag.js).
contextBridge.exposeInMainWorld('windowBridge', {
  dragStart: () => ipcRenderer.send('window-drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('window-drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('window-drag-end'),
});
