// ============================================================================
// PALETTE — the single source of truth for the app's color.
//
// The sphere (src/scene.js, as a shader uniform) and the now-playing box
// (index.html, via the --box-color-rgb custom property) both read from here,
// so there's nothing left to keep in sync by hand. Press `s` in the app to
// switch between these at runtime (src/color-menu.js).
//
// Add your own entry here and it shows up in the menu automatically.
// ============================================================================

export const PALETTE = [
  { key: 'red',    label: 'Red',    hex: 0xff2b44 },
  { key: 'pink',   label: 'Pink',   hex: 0xff6688 },
  { key: 'cyan',   label: 'Cyan',   hex: 0x66eeff },
  { key: 'purple', label: 'Purple', hex: 0xaa66ff },
  { key: 'green',  label: 'Green',  hex: 0x5affa0 },
  { key: 'orange', label: 'Orange', hex: 0xff9d4d },
  { key: 'gold',   label: 'Gold',   hex: 0xffd166 },
];

// Not a fixed color — picking this slowly cycles the hue instead (see
// RAINBOW_* in src/scene.js for the speed/saturation).
export const RAINBOW_KEY = 'rainbow';

export const DEFAULT_KEY = 'purple';

/** All selectable keys, in menu order: the presets, then rainbow last. */
export const COLOR_KEYS = [...PALETTE.map((c) => c.key), RAINBOW_KEY];

/** 'purple' -> 0xaa66ff. Unknown keys (and 'rainbow') fall back to the default. */
export function hexFromKey(key) {
  const entry = PALETTE.find((c) => c.key === key);
  return entry ? entry.hex : PALETTE.find((c) => c.key === DEFAULT_KEY).hex;
}

/** 0xaa66ff -> '170, 102, 255', the form --box-color-rgb wants for rgba(). */
export function rgbTriplet(hex) {
  return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
}

/** '#aa66ff' — for CSS backgrounds on the menu swatches. */
export function cssHex(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
