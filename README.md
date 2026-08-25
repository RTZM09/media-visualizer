# Media Visualizer

An audio-reactive particle sphere that floats over your desktop. The window is
frameless, transparent and always-on-top, so the sphere sits directly on your
wallpaper with no chrome around it. It reacts to whatever your system is
actually playing — captured straight from PipeWire, not from a browser tab —
and shows the current track underneath, with transport controls.

Linux only. It depends on PipeWire for audio capture and MPRIS/D-Bus for track
info, both of which are Linux-specific.

## Requirements

| | |
|---|---|
| **PipeWire** | `pw-record` and `pw-metadata` must be on `PATH` — on Debian/Ubuntu these come from `pipewire-bin`; elsewhere, whichever package ships PipeWire's CLI tools |
| **D-Bus session bus** | plus any MPRIS-capable player for track info — Spotify, Firefox/Chrome, mpv, VLC |
| **Node.js** | 18, 20 or 22+ (Vite 6's supported range) |

Electron runs with `--no-sandbox` (and `sandbox: false` in `webPreferences`)
because the bundled sandbox does not start on this system. Both the npm scripts
and `launch.sh` already pass the flag.

## Install

```bash
npm install
```

## Running

```bash
npm run dev      # Vite on :5173 + Electron, with detached DevTools and hot reload
npm run build    # bundle the renderer into dist/
npm start        # run the production build
./launch.sh      # same as npm start — this is what the desktop entry calls
```

**`npm start` and `launch.sh` load `dist/`, not your source.** After editing
anything under `src/` or `index.html`, run `npm run build` or the change won't
show up. Only `npm run dev` picks up edits live.

### Desktop launcher

`media-visualizer.desktop` hardcodes absolute paths to this repo. If you move or
clone it elsewhere, update `Exec=` and `Icon=` in that file, then:

```bash
ln -sf "$(pwd)/media-visualizer.desktop" ~/.local/share/applications/
```

## Controls

| Input | Action |
|---|---|
| **Drag anywhere** | Move the window |
| **Click the sphere** | Play / pause |
| **`s`** | Open the colour menu |
| **`f`** | Show / hide the now-playing box |
| **`F11`** | Fullscreen |
| **◀ ▶** | Previous / next track |
| **`Alt`+`F4`** | Quit — there is no close button |

While the colour menu is open: `←` / `→` preview colours live, `1`–`8` jump
straight to one, `Enter` confirms, `Esc` reverts to the colour that was showing
when you opened it.

Shortcuts deliberately ignore `Ctrl` / `Alt` / `Meta` combinations, so `Ctrl+F`
and friends stay free.

## Colours

Eight options: seven flat presets (red, pink, cyan, purple, green, orange, gold)
and **rainbow**. Whatever you pick recolours the sphere *and* the now-playing
box together, and is remembered across restarts in
`~/.config/spotify-constellation-visualizer/settings.json`.

Rainbow is not a single cycling hue. The sphere is divided into 12 regions —
the same anchors that drive the audio bumps — each gets its own hue, and the
whole colour field slowly rotates around the sphere (one turn every 26s),
independently of the sphere's own spin, so the colours drift across the dots.
In this mode the far hemisphere is faded out; without that you would see the
back side's regions straight through the front and the patches would read as
confetti rather than regions.

`src/palette.js` is the single source of truth for the palette. Add an entry
there and it appears in the menu automatically — the CSS side reads the same
values through the `--box-color-rgb` custom property.

## How it works

**Main process** (`electron/`)

| File | Role |
|---|---|
| `main.cjs` | Creates the 300×300 frameless/transparent window, pins it above other windows, polls now-playing once a second |
| `audio-capture.cjs` | Spawns `pw-record` against the default sink's monitor and extracts audio features in-process |
| `dsp.cjs` | FFT and Hann window |
| `now-playing.cjs` | Reads MPRIS over D-Bus; cleans up track titles; best-effort ad detection |
| `settings.cjs` | JSON settings file in the app's `userData` dir |
| `window-drag.cjs` | Applies drag deltas to the window position |
| `preload.cjs` | Exposes `audioBridge`, `nowPlayingBridge`, `settingsBridge` and `windowBridge` over `contextBridge` |

**Renderer** (`src/`)

| File | Role |
|---|---|
| `scene.js` | The Three.js point sphere — geometry, shaders, and every look/feel tunable |
| `main.js` | Wiring: the animation loop, keyboard handling, now-playing UI |
| `palette.js` | Shared colour palette |
| `color-menu.js` | The `s` menu |
| `window-drag.js` | Pointer tracking for window dragging |
| `audio.js` | Thin receiver for audio features arriving over IPC |

### Audio pipeline

`pw-record` streams 44.1 kHz stereo float32 from the default sink's monitor.
Each 2048-sample FFT with a 1024 hop gives roughly 43 feature updates per
second. Three bands are averaged and auto-gained to 0..1 — bass (20–250 Hz),
mid (250 Hz–2 kHz), treble (2–8 kHz) — and a beat fires when bass energy
exceeds 1.18× its 40-frame running average, with a 180 ms cooldown.

The capture also computes an overall `level` and 48 log-spaced bands
(40 Hz–14 kHz) and ships them to the renderer, but the current scene only
consumes `bass`, `mid`, `treble` and `beat`. They're there for a future
per-band effect.

### The sphere

1800 points on a Fibonacci sphere. Twelve anchor points are scattered randomly
across the surface each time the app starts, and each is assigned a
characteristic (bass, mid or treble). Rather than each point picking its nearest
anchor — which would put a hard seam at every border — every point blends the
weighted influence of *all* anchors, so closer anchors dominate and distant ones
fade out. The sphere reads as one continuous surface even though each region
bumps independently.

Everything adjustable lives in the `TUNABLES` section at the top of
`src/scene.js`: sphere size and point count, per-characteristic displacement,
how sharp or blended the regions are, beat reaction, rotation and scale
response, and the rainbow constants (`REGION_SPIN_SECONDS` for speed,
`REGION_SHARPNESS` for how distinct the patches are).

## Two things that look wrong but aren't

**Audio is captured with `pw-record`, not `getUserMedia`.** The browser route,
via a virtual PipeWire loopback device, hit a client-node format negotiation
failure (`-95 ENOTSUP`) on this system. Recording from the real hardware-backed
sink node in a child process is the path that works.

**The window is dragged in JavaScript, not with `-webkit-app-region: drag`.**
A native drag region swallows `mousedown` entirely, which would break
click-the-sphere-to-play/pause. Tracking the pointer manually allows telling a
drag from a click: movement under 4px stays a click. This is why there are no
`-webkit-app-region` declarations anywhere in `index.html`.

## Troubleshooting

**The sphere sits still.** Check `pw-record --help` runs, and that
`pw-metadata` reports a `default.audio.sink`. The sphere only reacts to audio
going to the *default* sink — if your player is routed elsewhere, capture
follows the default, not the player. Launch from a terminal and look for
`[audio-capture]` lines.

**No track name appears.** The box only shows when an MPRIS player is running.
Check with `busctl --user list | grep mpris`. A player that exposes no MPRIS
interface (some web players) can't be detected.

**The window won't move.** Dragging needs `setPosition` to work, which it does
under X11 and XWayland. Under a native Wayland session (Electron started with
`--ozone-platform=wayland`) the compositor forbids programmatic window
positioning and dragging will silently do nothing.

**I can't close it.** There's no close button — `Alt`+`F4` while it's focused,
or `pkill -f media_visualiser` (the Electron binary runs from inside this repo,
so its path is enough to identify it).
