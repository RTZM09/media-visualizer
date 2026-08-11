// Now-playing track info, sourced from MPRIS over D-Bus (works with Spotify
// desktop, Firefox/Chrome tabs playing YouTube, mpv, VLC — anything
// exposing org.mpris.MediaPlayer2). Exposes a single `getCurrentTrack()`
// you can poll on an interval.

const dbus = require('dbus-next');

// ---------------------------------------------------------------------------
// 1. Title/artist cleanup
// ---------------------------------------------------------------------------

// Matches "feat. X", "ft X", "featuring X" — parenthetical/bracketed groups
// containing this are kept; everything else in () or [] is upload noise
// ("(Official Video)", "[HD]", "(Lyrics)", etc.) and gets dropped entirely.
const FEATURING_PATTERN = /\b(feat\.?|ft\.?|featuring)\b/i;

function stripBracketedNoise(text) {
  return text
    .replace(/\(([^()]*)\)/g, (whole, inner) => (FEATURING_PATTERN.test(inner) ? whole : ''))
    .replace(/\[([^[\]]*)\]/g, (whole, inner) => (FEATURING_PATTERN.test(inner) ? whole : ''));
}

// Pipe-separated noise, e.g. "Song Title | Official Music Video" — not
// parenthetical, so handled separately.
const PIPE_NOISE_PATTERNS = [
  /\s*\|\s*official[^|]*$/gi,
  /\s*\|\s*lyrics?[^|]*$/gi,
  /\s*\|\s*audio[^|]*$/gi,
];

// YouTube auto-generated "topic" channels append this to artist names.
const TOPIC_SUFFIX = /\s*-\s*topic\s*$/i;

function cleanTitle(rawTitle) {
  let out = stripBracketedNoise(rawTitle || '');
  for (const pattern of PIPE_NOISE_PATTERNS) out = out.replace(pattern, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}

function cleanArtist(rawArtist) {
  return (rawArtist || '').replace(TOPIC_SUFFIX, '').trim();
}

// ---------------------------------------------------------------------------
// 2. MPRIS (D-Bus) — find whatever's playing and read its metadata
// ---------------------------------------------------------------------------

const MPRIS_PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';

let cachedBus = null;
function getBus() {
  if (!cachedBus) cachedBus = dbus.sessionBus();
  return cachedBus;
}

async function listMprisPlayers(bus) {
  const dbusProxy = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
  const dbusIface = dbusProxy.getInterface('org.freedesktop.DBus');
  const names = await dbusIface.ListNames();
  return names.filter((n) => n.startsWith('org.mpris.MediaPlayer2.'));
}

/** Finds an actively-playing MPRIS player, falling back to any available one. */
async function findActivePlayer() {
  const bus = getBus();
  const names = await listMprisPlayers(bus);
  if (names.length === 0) return null;

  let fallback = null;
  for (const name of names) {
    try {
      const proxy = await bus.getProxyObject(name, MPRIS_PATH);
      const props = proxy.getInterface('org.freedesktop.DBus.Properties');
      const status = await props.Get(MPRIS_PLAYER_IFACE, 'PlaybackStatus');
      const entry = { name, proxy, props };
      if (!fallback) fallback = entry;
      if (status.value === 'Playing') return entry;
    } catch {
      // This name might not actually implement the Player interface; skip it.
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// 3. Ad detection (best-effort — MPRIS has no standard "this is an ad" flag)
// ---------------------------------------------------------------------------

// Spotify gives ads a trackid/url under an "/ad/" (or "spotify:ad:") path
// instead of the normal "/track/" one — this is the same signal
// spicetify-style ad-blockers key off of. Other players don't expose
// anything like this, so this only actually fires for Spotify.
const AD_MARKER_PATTERN = /\/ad[:/]|spotify:ad:/i;

function looksLikeAdvertisement(meta) {
  const trackId = meta['mpris:trackid'] ? String(meta['mpris:trackid'].value) : '';
  const url = meta['xesam:url'] ? String(meta['xesam:url'].value) : '';
  return AD_MARKER_PATTERN.test(trackId) || AD_MARKER_PATTERN.test(url);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Polls the current MPRIS player and returns its cleaned title/artist. */
async function getCurrentTrack() {
  const player = await findActivePlayer();
  if (!player) return { hasTrack: false };

  const [metaVariant, statusVariant] = await Promise.all([
    player.props.Get(MPRIS_PLAYER_IFACE, 'Metadata'),
    player.props.Get(MPRIS_PLAYER_IFACE, 'PlaybackStatus'),
  ]);

  const meta = metaVariant.value;
  const playing = statusVariant.value === 'Playing';

  if (looksLikeAdvertisement(meta)) {
    return { hasTrack: true, title: 'Advertisement', artist: '', playing, isAd: true };
  }

  const rawTitle = meta['xesam:title'] ? meta['xesam:title'].value : '';
  const artistValue = meta['xesam:artist'] ? meta['xesam:artist'].value : [];
  const rawArtist = Array.isArray(artistValue) ? artistValue.join(', ') : String(artistValue || '');

  const title = cleanTitle(rawTitle);
  if (!title) return { hasTrack: false };

  return {
    hasTrack: true,
    title,
    artist: cleanArtist(rawArtist),
    playing,
    isAd: false,
  };
}

/** Gets the Player interface (methods, not properties) for the active player, or null. */
async function getActiveControls() {
  const player = await findActivePlayer();
  return player ? player.proxy.getInterface(MPRIS_PLAYER_IFACE) : null;
}

/**
 * Toggles play/pause on whatever MPRIS player is currently active. Prefers
 * the combined PlayPause() method (implemented by virtually every player);
 * falls back to explicit Play()/Pause() based on current status for the
 * rare player that only implements those.
 */
async function togglePlayPause() {
  const player = await findActivePlayer();
  if (!player) return false;

  const controls = player.proxy.getInterface(MPRIS_PLAYER_IFACE);
  try {
    await controls.PlayPause();
  } catch {
    const status = await player.props.Get(MPRIS_PLAYER_IFACE, 'PlaybackStatus');
    if (status.value === 'Playing') await controls.Pause();
    else await controls.Play();
  }
  return true;
}

async function nextTrack() {
  const controls = await getActiveControls();
  if (!controls) return false;
  await controls.Next();
  return true;
}

async function previousTrack() {
  const controls = await getActiveControls();
  if (!controls) return false;
  await controls.Previous();
  return true;
}

module.exports = { getCurrentTrack, togglePlayPause, nextTrack, previousTrack, cleanTitle, cleanArtist };
