const { BrowserWindow, ipcMain } = require('electron');

// Window dragging (see src/window-drag.js for the renderer half).
//
// The renderer reports how far the pointer has moved since the gesture began;
// we apply that to wherever the window was when it began. A native
// `-webkit-app-region: drag` region would be simpler but eats mousedown, which
// would break click-the-sphere-to-play/pause.

let dragOrigin = null;

function registerWindowDragHandlers() {
  ipcMain.on('window-drag-start', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const [x, y] = win.getPosition();
    dragOrigin = { x, y };
  });

  ipcMain.on('window-drag-move', (event, dx, dy) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !dragOrigin) return;
    win.setPosition(dragOrigin.x + Math.round(dx), dragOrigin.y + Math.round(dy));
  });

  ipcMain.on('window-drag-end', () => {
    dragOrigin = null;
  });
}

module.exports = { registerWindowDragHandlers };
