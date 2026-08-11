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
