import { COLOR_KEYS, PALETTE, RAINBOW_KEY, colorsFromKey, swatchCss } from './palette.js';

// The `s` menu: a row of swatches, one per color combination, that recolors
// the sphere and the now-playing box together. Arrow keys preview live;
// Escape puts back whatever was showing when the menu opened.

const RAINBOW_SWATCH_CSS = 'conic-gradient(#ff2b44, #ff9d4d, #ffd166, #5affa0, #66eeff, #aa66ff, #ff2b44)';

/**
 * Builds the menu into #color-menu and returns the handle main.js drives.
 * `onChange(key)` fires only for committed picks (not live previews), so
 * it's the right place to persist. `onPaint()` is called whenever the sphere's
 * color changes, to push it straight through to the now-playing box.
 */
export function createColorMenu({ scene, onChange, onPaint }) {
  const el = document.getElementById('color-menu');

  const entries = [
    ...PALETTE.map((c) => ({ key: c.key, label: c.label, background: swatchCss(c.colors) })),
    { key: RAINBOW_KEY, label: 'Rainbow', background: RAINBOW_SWATCH_CSS },
  ];

  const buttons = entries.map((entry, i) => {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.dataset.key = entry.key;
    btn.style.background = entry.background;
    btn.title = `${entry.label} (${i + 1})`;
    btn.setAttribute('aria-label', entry.label);
    btn.addEventListener('click', () => {
      select(entry.key);
      close();
    });
    el.appendChild(btn);
    return btn;
  });

  let open = false;
  let currentKey = null; // what's on screen right now (may be an unconfirmed preview)
  let committedKey = null; // what was on screen when the menu opened / was last confirmed

  /**
   * Points the sphere at a color combination, then syncs the now-playing box to it
   * immediately rather than waiting for the next animation frame — frames
   * are throttled while the window is occluded, and a pick shouldn't leave
   * the box on the old color until the window is looked at again. (The
   * per-frame sync stays too: the box follows the color field as it turns,
   * and it de-dupes.) The very first paint (the saved pick, at startup)
   * snaps instead of crossfading from the default.
   */
  function paint(key) {
    scene.setPalette(colorsFromKey(key), { instant: currentKey === null });
    currentKey = key;
    for (const btn of buttons) btn.classList.toggle('active', btn.dataset.key === key);
    onPaint?.();
  }

  /** Show a color without committing to it — used while arrowing through the row. */
  function preview(key) {
    if (!COLOR_KEYS.includes(key)) return;
    paint(key);
  }

  /** Show a color and keep it: this is what gets persisted. */
  function select(key, { persist = true } = {}) {
    if (!COLOR_KEYS.includes(key)) return;
    const changed = committedKey !== key;
    paint(key);
    committedKey = key;
    if (changed && persist) onChange?.(key);
  }

  function setVisible(next) {
    open = next;
    el.classList.toggle('visible', next);
    el.setAttribute('aria-hidden', String(!next));
  }

  function show() {
    committedKey = currentKey;
    setVisible(true);
  }

  /** Closing keeps whatever is currently previewing (Escape reverts first). */
  function close() {
    if (!open) return;
    setVisible(false);
    if (currentKey && currentKey !== committedKey) select(currentKey);
  }

  function cancel() {
    if (!open) return;
    setVisible(false);
    if (committedKey && committedKey !== currentKey) paint(committedKey);
  }

  function step(delta) {
    const from = COLOR_KEYS.indexOf(currentKey);
    const next = (from + delta + COLOR_KEYS.length) % COLOR_KEYS.length;
    preview(COLOR_KEYS[next]);
  }

  /**
   * Keys the menu claims while it's open. Returns true if it handled the
   * event, so main.js's handler can stop there.
   */
  function handleKey(e) {
    if (!open) return false;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': step(1); return true;
      case 'ArrowLeft': case 'ArrowUp': step(-1); return true;
      case 'Enter': case ' ': close(); return true;
      case 'Escape': cancel(); return true;
      default: {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= COLOR_KEYS.length) {
          select(COLOR_KEYS[n - 1]);
          close();
          return true;
        }
        return false;
      }
    }
  }

  return {
    toggle: () => (open ? close() : show()),
    close,
    isOpen: () => open,
    handleKey,
    /** Apply a saved/initial color without opening the menu (pass { persist: false } to avoid writing it straight back). */
    select,
  };
}
