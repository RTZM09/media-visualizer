import { AudioEngine } from './audio.js';
import { Scene } from './scene.js';
import { createColorMenu } from './color-menu.js';
import { COLOR_KEYS, DEFAULT_KEY } from './palette.js';
import { initWindowDrag } from './window-drag.js';

const container = document.getElementById('scene');

const audio = new AudioEngine();
const scene = new Scene(container);

// Drag the window from anywhere on it, not just a strip at the top.
const windowDrag = initWindowDrag();

// --- Color (press `s`) ---
// The menu recolors the sphere and the now-playing box together; the pick is
// persisted through the main process (see electron/settings.cjs).
const colorMenu = createColorMenu({
  scene,
  onChange: (key) => window.settingsBridge?.setColor(key),
  onPaint: () => syncBoxColorToSphere(),
});

let instrumentalOnly = false; // `v` mode, see toggleInstrumentalOnly below

// Restore the saved color and instrumental-only mode. Async, so the very
// first frames may show the default color before it lands — not noticeable,
// and it falls back cleanly when the bridge isn't there (e.g. the page opened
// outside Electron).
(async () => {
  let saved;
  try {
    saved = await window.settingsBridge?.get();
  } catch {
    saved = null;
  }
  // An unknown key (e.g. one of the old single colors) falls back to the default.
  const savedKey = COLOR_KEYS.includes(saved?.colorKey) ? saved.colorKey : DEFAULT_KEY;
  colorMenu.select(savedKey, { persist: false });
  instrumentalOnly = !!saved?.instrumentalOnly;
})();

// --- Instrumental only (press `v`) ---
// The vocals are filtered out in the main process (electron/audio-capture.cjs,
// which also starts in the saved mode by itself); this side only flips the
// switch and briefly says which mode is now on. The saved value is restored
// alongside the color above.
const modeToastEl = document.getElementById('mode-toast');
let modeToastTimer = null;

function toggleInstrumentalOnly() {
  instrumentalOnly = !instrumentalOnly;
  window.settingsBridge?.setInstrumental(instrumentalOnly);
  modeToastEl.textContent = instrumentalOnly ? 'Instrumental only' : 'Full mix';
  modeToastEl.classList.add('visible');
  clearTimeout(modeToastTimer);
  modeToastTimer = setTimeout(() => modeToastEl.classList.remove('visible'), 1200);
}

// --- Now playing (see electron/now-playing.cjs) ---
const nowPlayingEl = document.getElementById('now-playing');
const npTitleEl = document.getElementById('np-title');
const npArtistEl = document.getElementById('np-artist');
const npPrevBtn = document.getElementById('np-prev');
const npNextBtn = document.getElementById('np-next');

let hasTrack = false;
let boxHiddenByUser = false;

function updateNowPlayingVisibility() {
  nowPlayingEl.classList.toggle('visible', hasTrack && !boxHiddenByUser);
}

window.nowPlayingBridge?.onUpdate((info) => {
  hasTrack = !!(info && info.hasTrack);
  if (hasTrack) {
    npTitleEl.textContent = info.title;
    npArtistEl.textContent = info.artist;
    nowPlayingEl.classList.toggle('ad', !!info.isAd);
  }
  updateNowPlayingVisibility();
});

npPrevBtn.addEventListener('click', () => window.nowPlayingBridge?.previousTrack());
npNextBtn.addEventListener('click', () => window.nowPlayingBridge?.nextTrack());

// --- Click the sphere to play/pause whatever's playing ---
// The visual pulse fires immediately on click, independent of the actual
// (async, D-Bus round-trip) toggle — so it always feels instant regardless
// of how long that takes.
container.addEventListener('click', (e) => {
  if (!scene.hitTestSphere(e.clientX, e.clientY)) return;
  scene.pulse();
  window.nowPlayingBridge?.togglePlayPause();
});

container.addEventListener('mousemove', (e) => {
  if (windowDrag.isDragging()) return; // the drag cursor wins while a drag is in flight
  container.style.cursor = scene.hitTestSphere(e.clientX, e.clientY) ? 'pointer' : 'default';
});

// Sphere framing: centered between the window's top and the box's top
// when the box is showing, otherwise dead-centered in the window.
function updateSphereFraming() {
  const boxVisible = hasTrack && !boxHiddenByUser;
  const targetY = boxVisible ? nowPlayingEl.getBoundingClientRect().top / 2 : window.innerHeight / 2;
  scene.setVerticalTarget(targetY);
}

// The now-playing box's halo and buttons track the sphere's color (index.html
// draws them from --box-color-rgb). Called both on pick (so it lands even if
// frames are throttled) and every frame (so the box follows the color field as
// it turns), but only writes when the value actually changes.
let lastBoxTriplet = null;
function syncBoxColorToSphere() {
  const triplet = scene.getColorRgbTriplet();
  if (triplet === lastBoxTriplet) return;
  lastBoxTriplet = triplet;
  document.documentElement.style.setProperty('--box-color-rgb', triplet);
}

function loop() {
  requestAnimationFrame(loop);
  const features = audio.update();
  updateSphereFraming();
  scene.update(features);
  syncBoxColorToSphere();
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // The menu gets first refusal on arrows/Enter/Escape/digits while it's open.
  if (colorMenu.handleKey(e)) {
    e.preventDefault();
    return;
  }

  if (e.key === 'F11') {
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
  } else if (e.key === 'f' || e.key === 'F') {
    boxHiddenByUser = !boxHiddenByUser;
    updateNowPlayingVisibility();
  } else if (e.key === 's' || e.key === 'S') {
    colorMenu.toggle();
  } else if (e.key === 'v' || e.key === 'V') {
    toggleInstrumentalOnly();
  }
});

requestAnimationFrame(loop);
