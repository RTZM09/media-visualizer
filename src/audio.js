// Thin receiver for audio features computed natively in the Electron main
// process (see electron/audio-capture.cjs) via `pw-record`, delivered over
// IPC. No browser audio APIs are involved here — see the architecture note
// in that file for why.

// Must match BAND_COUNT in electron/audio-capture.cjs.
export const BAND_COUNT = 48;

export class AudioEngine {
  constructor() {
    this.features = { bass: 0, mid: 0, treble: 0, level: 0, beat: false, bands: new Array(BAND_COUNT).fill(0) };
    this.error = null;
    this.connected = false;

    window.audioBridge?.onFeatures((f) => {
      if (f.error) {
        this.error = f.error;
        return;
      }
      this.error = null;
      this.connected = true;
      this.features = f;
    });
  }

  /** Call once per animation frame; returns the latest known features. */
  update() {
    return this.features;
  }
}
