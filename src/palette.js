// ============================================================================
// PALETTE — the single source of truth for the app's color.
//
// Every option is a combination of colors: the sphere hands them out across
// its regions (the same anchors that drive the audio bumps) and slowly turns
// the whole color field around itself (see REGION_* in src/scene.js). The
// now-playing box (index.html, via --box-color-rgb) follows whichever color
// is facing you. Press `s` in the app to switch (src/color-menu.js).
//
// The combinations are based on popular published palettes, keeping only
// their bright colors: the dots are drawn with additive blending over the
// desktop, so a dark navy or near-black would simply vanish.
//
// Add your own entry here and it shows up in the menu automatically. Three to
// five colors works best: the 12 regions are dealt them in turn, so each
// color gets two to four patches.
// ============================================================================

export const PALETTE = [
  // Synthwave sunset: hot pink and orange sun over a blue-violet sky.
  { key: 'synthwave', label: 'Synthwave', colors: [0xff1493, 0xdd517f, 0xe68e36, 0x7998ee, 0x00f5ff] },
  // Cyberpunk: electric cyan, magenta and violet.
  { key: 'cyberpunk', label: 'Cyberpunk', colors: [0x00e5ff, 0xff2bd6, 0x7c4dff] },
  // Vaporwave: soft purples, lilac and teal.
  { key: 'vaporwave', label: 'Vaporwave', colors: [0xa653f5, 0x8f8cf2, 0x65b8bf, 0xf96cff, 0xfa92fb] },
  // Cyber sunset: coral, orange and yellow against sky blue and violet.
  { key: 'sunset', label: 'Cyber Sunset', colors: [0xff6f61, 0xff9a00, 0xffea00, 0x00bfff, 0x6a00ff] },
  // Aurora: northern-lights green and turquoise with blue and a pink edge.
  { key: 'aurora', label: 'Aurora', colors: [0x7cff6b, 0x40e0d0, 0x4da6ff, 0xe387b8] },
  // Ocean: turquoise shallows to steel and pale sea blue.
  { key: 'ocean', label: 'Ocean', colors: [0x40e0d0, 0x1a7fc4, 0x6497b1, 0xb3cde0] },
  // Lava: red, crimson, ember and glowing orange.
  { key: 'lava', label: 'Lava', colors: [0xe42217, 0xc01855, 0xf58d5d, 0xffa633] },
  // Tropical: mango, orchid pink, lagoon blue and lime.
  { key: 'tropical', label: 'Tropical', colors: [0xf18600, 0xff77ff, 0x6db9d5, 0xa4c100] },
];

// Not a fixed list: the sphere spreads 12 hues evenly around the color wheel
// instead (see REGION_SATURATION / REGION_LIGHTNESS in src/scene.js).
export const RAINBOW_KEY = 'rainbow';

export const DEFAULT_KEY = RAINBOW_KEY;

/** All selectable keys, in menu order: the combinations, then rainbow last. */
export const COLOR_KEYS = [...PALETTE.map((c) => c.key), RAINBOW_KEY];

/**
 * 'ocean' -> [0x40e0d0, ...]. Returns null for rainbow, and for unknown keys
 * (e.g. an old single-color pick still in settings.json), which therefore
 * fall back to rainbow too.
 */
export function colorsFromKey(key) {
  const entry = PALETTE.find((c) => c.key === key);
  return entry ? entry.colors : null;
}

/** 0xaa66ff -> '170, 102, 255', the form --box-color-rgb wants for rgba(). */
export function rgbTriplet(hex) {
  return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
}

/** '#aa66ff' — for CSS backgrounds on the menu swatches. */
export function cssHex(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** A pie of the given colors, for a menu swatch. */
export function swatchCss(colors) {
  const stops = colors.map(cssHex);
  return `conic-gradient(${[...stops, stops[0]].join(', ')})`;
}
