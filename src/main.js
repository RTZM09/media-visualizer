import { AudioEngine } from './audio.js';
import { Scene } from './scene.js';

const container = document.getElementById('scene');

const audio = new AudioEngine();
const scene = new Scene(container);

// --- Now playing (see electron/now-playing.cjs) ---
const nowPlayingEl = document.getElementById('now-playing');
const npTitleEl = document.getElementById('np-title');
const npArtistEl = document.getElementById('np-artist');
const npPrevBtn = document.getElementById('np-prev');
const npNextBtn = document.getElementById('np-next');
const closeBtn = document.getElementById('close-btn');

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
closeBtn.addEventListener('click', () => window.close());

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
  container.style.cursor = scene.hitTestSphere(e.clientX, e.clientY) ? 'pointer' : 'default';
});

// Sphere framing: centered between the window's top and the box's top
// when the box is showing, otherwise dead-centered in the window.
function updateSphereFraming() {
  const boxVisible = hasTrack && !boxHiddenByUser;
  const targetY = boxVisible ? nowPlayingEl.getBoundingClientRect().top / 2 : window.innerHeight / 2;
  scene.setVerticalTarget(targetY);
}

function loop() {
  requestAnimationFrame(loop);
  const features = audio.update();
  updateSphereFraming();
  scene.update(features);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
  } else if (e.key === 'f' || e.key === 'F') {
    boxHiddenByUser = !boxHiddenByUser;
    updateNowPlayingVisibility();
  }
});

requestAnimationFrame(loop);
