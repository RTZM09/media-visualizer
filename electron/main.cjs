const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { AudioCapture } = require('./audio-capture.cjs');
const { getCurrentTrack, togglePlayPause, nextTrack, previousTrack } = require('./now-playing.cjs');
const { readSettings, writeSettings } = require('./settings.cjs');
const { registerWindowDragHandlers } = require('./window-drag.cjs');

const isDev = process.env.NODE_ENV === 'development';
const NOW_PLAYING_POLL_MS = 1000;

let capture = null;
let nowPlayingTimer = null;
let currentWin = null;

async function pollNowPlaying() {
  if (!currentWin || currentWin.isDestroyed()) return;
  try {
    const info = await getCurrentTrack();
    currentWin.webContents.send('now-playing', info);
  } catch (err) {
    console.warn('[now-playing] poll failed:', err.message);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 300,
    height: 300,
    alwaysOnTop: true,
    transparent: true, // lets the sphere/box float over the desktop instead of a solid backdrop
    frame: false, // no native title bar — index.html draws its own tiny close button instead
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed alongside --no-sandbox on this system (see README)
    },
  });
  currentWin = win;

  // The plain `alwaysOnTop: true` constructor option above doesn't always
  // stick on Linux/GNOME (Mutter), especially combined with a frameless
  // window — this explicit call with an X11/Wayland layer hint is the more
  // reliable way to actually pin it above other windows.
  win.setAlwaysOnTop(true, 'screen-saver');

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
    win.webContents.on('console-message', (_e, _level, message) => {
      console.log('[renderer]', message);
    });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  capture = new AudioCapture((features) => {
    if (!win.isDestroyed()) win.webContents.send('audio-features', features);
  });
  win.webContents.once('did-finish-load', () => capture.start());

  if (nowPlayingTimer) clearInterval(nowPlayingTimer);
  nowPlayingTimer = setInterval(pollNowPlaying, NOW_PLAYING_POLL_MS);

  win.on('closed', () => {
    if (capture) capture.stop();
    capture = null;
    if (nowPlayingTimer) clearInterval(nowPlayingTimer);
    nowPlayingTimer = null;
    if (currentWin === win) currentWin = null;
  });
}

ipcMain.handle('toggle-play-pause', async () => {
  try {
    await togglePlayPause();
    pollNowPlaying(); // refresh immediately instead of waiting for the next tick, so the UI catches up right away
    return true;
  } catch (err) {
    console.warn('[now-playing] toggle-play-pause failed:', err.message);
    return false;
  }
});

ipcMain.handle('next-track', async () => {
  try {
    await nextTrack();
    pollNowPlaying();
    return true;
  } catch (err) {
    console.warn('[now-playing] next-track failed:', err.message);
    return false;
  }
});

ipcMain.handle('previous-track', async () => {
  try {
    await previousTrack();
    pollNowPlaying();
    return true;
  } catch (err) {
    console.warn('[now-playing] previous-track failed:', err.message);
    return false;
  }
});

registerWindowDragHandlers();

ipcMain.handle('get-settings', () => readSettings());

ipcMain.handle('set-color', (_event, colorKey) => writeSettings({ colorKey }));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (capture) capture.stop();
  if (nowPlayingTimer) clearInterval(nowPlayingTimer);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
