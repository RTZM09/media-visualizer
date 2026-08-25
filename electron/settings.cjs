// Tiny JSON settings store in the app's userData dir (~/.config/<app>/).
//
// Deliberately not localStorage: production loads the renderer over file://
// (main.cjs) while dev runs on http://localhost:5173, so web storage is both
// unreliable there and not shared between the two. Everything is best-effort
// — a broken or missing file just means defaults, never a crash.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[settings] read failed:', err.message);
    return {};
  }
}

/** Merges `patch` into whatever is on disk and writes it back. */
function writeSettings(patch) {
  try {
    const next = { ...readSettings(), ...patch };
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
    return true;
  } catch (err) {
    console.warn('[settings] write failed:', err.message);
    return false;
  }
}

module.exports = { readSettings, writeSettings, settingsPath };
