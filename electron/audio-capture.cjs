// Captures real system audio directly via `pw-record` (a plain child
// process, no browser audio APIs involved) targeting the current default
// PipeWire sink's monitor, does FFT-based feature extraction in-process,
// and hands back simple per-frame features: bass/mid/treble/level/beat.
//
// This intentionally avoids Electron/Chromium's getUserMedia + a virtual
// PipeWire loopback device — that combination hit a client-node format
// negotiation failure (`-95 ENOTSUP`) on this system. `pw-record` against
// the real hardware-backed sink node is the path already proven to work.

const { spawn, execFileSync } = require('child_process');
const { fft, hannWindow, centerSuppressionGains } = require('./dsp.cjs');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 4; // f32
const FRAME_BYTES = CHANNELS * BYTES_PER_SAMPLE;
const FFT_SIZE = 2048;
const HOP_SIZE = 1024; // 50% overlap, ~43 feature updates/sec
const BEAT_HISTORY = 40;
const BEAT_THRESHOLD = 1.18;
const BEAT_MIN = 0.02;
const BEAT_COOLDOWN_MS = 180;
const RECORDER_NODE_NAME = 'constellation-capture';

// Per-point spectrum sent to the renderer so individual constellation
// points can react to their own frequency band instead of one global
// scale factor. Keep in sync with BAND_COUNT in src/scene.js.
const BAND_COUNT = 48;
const BAND_MIN_HZ = 40;
const BAND_MAX_HZ = 14000;

// Instrumental-only mode (toggled with `v`): centre-panned sound inside the
// vocal range is turned down before any feature is computed, so the sphere
// mostly ignores the singer. See centerSuppressionGains in dsp.cjs.
const VOCAL_SUPPRESSION = {
  loHz: 150, // below this nothing is touched, so kick/bass/beat keep the full mix
  hiHz: 6000,
  loRampHz: 50, // soft edges (100→150 Hz, 6→8 kHz) instead of a hard cutoff
  hiRampHz: 2000,
  simLo: 0.75, // L/R similarity at which a bin starts to count as "centred"…
  simHi: 0.97, // …and at which it counts as fully centred
  smoothing: 0.5, // per-bin smoothing of that similarity across frames
  strength: 0.9, // how much fully centred in-band content is cut (1 = silenced)
};

function getDefaultSinkName() {
  try {
    const out = execFileSync('pw-metadata', [], { encoding: 'utf8' });
    const m = out.match(/key:'default\.audio\.sink'\s+value:'\{\s*"name":\s*"([^"]+)"/);
    if (m) return m[1];
  } catch (err) {
    console.warn('[audio-capture] could not resolve default sink:', err.message);
  }
  return null;
}

/** Tracks a slowly-decaying running max to auto-normalize a signal to 0..1. */
class AutoGain {
  constructor(decay = 0.985, floor = 1e-3) {
    this.max = floor;
    this.decay = decay;
    this.floor = floor;
  }
  normalize(x) {
    this.max = Math.max(x, this.max * this.decay, this.floor);
    return Math.min(1, x / this.max);
  }
}

function bandAvg(mag, binHz, loHz, hiHz) {
  const lo = Math.max(1, Math.round(loHz / binHz));
  const hi = Math.min(mag.length - 1, Math.round(hiHz / binHz));
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += mag[i];
  return sum / Math.max(1, hi - lo + 1);
}

class AudioCapture {
  constructor(onFeatures, { instrumentalOnly = false } = {}) {
    this.onFeatures = onFeatures;
    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this._window = hannWindow(FFT_SIZE);
    this._lastBeatAt = 0;
    this._instrumentalOnly = !!instrumentalOnly;
    this._prevSim = new Float32Array(FFT_SIZE / 2);
    this._vocalGains = new Float32Array(FFT_SIZE / 2);

    // Log-spaced band edges from BAND_MIN_HZ to BAND_MAX_HZ, each with its
    // own auto-gain so quiet high-frequency bands are still visible.
    this._bandEdges = [];
    const logMin = Math.log2(BAND_MIN_HZ);
    const logMax = Math.log2(BAND_MAX_HZ);
    for (let i = 0; i <= BAND_COUNT; i++) {
      this._bandEdges.push(Math.pow(2, logMin + ((logMax - logMin) * i) / BAND_COUNT));
    }
    this._resetLevels();
  }

  /** Fresh auto-gains and beat history, so levels re-normalize at once. */
  _resetLevels() {
    this._gain = { bass: new AutoGain(), mid: new AutoGain(), treble: new AutoGain(), level: new AutoGain() };
    this._bandGains = Array.from({ length: BAND_COUNT }, () => new AutoGain(0.97));
    this._bassHistory = [];
    this._prevSim.fill(0);
  }

  /**
   * Switches instrumental-only mode. Levels are reset on a change because
   * removing the vocals makes the mids much quieter, and the auto-gains would
   * otherwise take a second or two to catch up.
   */
  setInstrumentalOnly(on) {
    on = !!on;
    if (on === this._instrumentalOnly) return;
    this._instrumentalOnly = on;
    this._resetLevels();
    console.log('[audio-capture] instrumental-only', on ? 'on' : 'off');
  }

  start() {
    // NOTE: `pw-record --target=<sink>` turned out to silently mis-link to
    // the wrong sink's monitor on this system (verified via `wpctl status`
    // while it was running) — it always landed on a different, silent
    // audio device regardless of the id/name passed. So instead we start
    // the recorder unlinked (`--target=0`) with a fixed node name, then
    // explicitly `pw-link` its input ports to the real sink's monitor
    // ports ourselves, which is what actually captures live audio.
    const args = [
      '-a', '--format=f32', `--rate=${SAMPLE_RATE}`, `--channels=${CHANNELS}`,
      '--target=0', '-P', `node.name=${RECORDER_NODE_NAME}`, '-',
    ];
    console.log('[audio-capture] spawning: pw-record', args.join(' '));

    this.proc = spawn('pw-record', args);
    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    this.proc.stderr.on('data', () => {}); // pw-record prints a live level meter; ignore
    this.proc.on('error', (err) => {
      console.error('[audio-capture] pw-record failed to start:', err.message);
      this.onFeatures({ error: `pw-record failed to start: ${err.message}` });
    });
    this.proc.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[audio-capture] pw-record exited with code ${code}`);
        this.onFeatures({ error: `pw-record exited (code ${code})` });
      }
    });

    this._linkedSinkName = null;
    this._ensureLinked();

    // The default sink's underlying PipeWire node can get torn down and
    // recreated (display re-negotiation, USB audio replug, etc.), which
    // silently orphans our `pw-link` connection without pw-record noticing
    // — it just goes quiet. Periodically re-check and re-link so capture
    // self-heals instead of requiring an app restart.
    this._watchdog = setInterval(() => this._ensureLinked(), 3000);
  }

  _ensureLinked(attempt = 0) {
    const sinkName = getDefaultSinkName();
    if (!sinkName) {
      if (attempt < 30) setTimeout(() => this._ensureLinked(attempt + 1), 100);
      return;
    }

    if (sinkName !== this._linkedSinkName) {
      // Best-effort cleanup of a stale link to a previous/dead sink.
      if (this._linkedSinkName) {
        for (const ch of ['FL', 'FR']) {
          try {
            execFileSync('pw-link', ['-d', `${this._linkedSinkName}:monitor_${ch}`, `${RECORDER_NODE_NAME}:input_${ch}`], { stdio: 'pipe' });
          } catch {
            // fine — the old node is probably already gone
          }
        }
      }
    }

    let ok = true;
    for (const ch of ['FL', 'FR']) {
      try {
        execFileSync('pw-link', [`${sinkName}:monitor_${ch}`, `${RECORDER_NODE_NAME}:input_${ch}`], { stdio: 'pipe' });
      } catch (err) {
        const stderr = err.stderr ? err.stderr.toString() : err.message;
        if (!/exists|already/i.test(stderr)) ok = false;
      }
    }

    if (ok) {
      if (sinkName !== this._linkedSinkName) console.log('[audio-capture] linked capture to', sinkName);
      this._linkedSinkName = sinkName;
      return;
    }

    if (attempt < 30) {
      setTimeout(() => this._ensureLinked(attempt + 1), 100);
    } else {
      console.error('[audio-capture] failed to link capture ports after retries');
      this.onFeatures({ error: 'Failed to link audio capture ports' });
    }
  }

  stop() {
    if (this._watchdog) {
      clearInterval(this._watchdog);
      this._watchdog = null;
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;

    const frameBytes = FFT_SIZE * FRAME_BYTES;
    const hopBytes = HOP_SIZE * FRAME_BYTES;
    while (this.buffer.length >= frameBytes) {
      this._processFrame(this.buffer.subarray(0, frameBytes));
      this.buffer = this.buffer.subarray(hopBytes);
    }
  }

  _processFrame(frameBuf) {
    // Buffer subarrays aren't guaranteed 4-byte aligned; copy into a fresh
    // ArrayBuffer so Float32Array can safely view it.
    const copy = Buffer.from(frameBuf);
    const samples = new Float32Array(copy.buffer, copy.byteOffset, FFT_SIZE * CHANNELS);

    const binHz = SAMPLE_RATE / FFT_SIZE;
    const { mag, level } = this._instrumentalOnly
      ? this._instrumentalSpectrum(samples, binHz)
      : this._monoSpectrum(samples);

    const bassRaw = bandAvg(mag, binHz, 20, 250);
    const midRaw = bandAvg(mag, binHz, 250, 2000);
    const trebleRaw = bandAvg(mag, binHz, 2000, 8000);

    const bass = this._gain.bass.normalize(bassRaw);
    const mid = this._gain.mid.normalize(midRaw);
    const treble = this._gain.treble.normalize(trebleRaw);
    const normLevel = this._gain.level.normalize(level);

    this._bassHistory.push(bassRaw);
    if (this._bassHistory.length > BEAT_HISTORY) this._bassHistory.shift();
    const avg = this._bassHistory.reduce((a, b) => a + b, 0) / this._bassHistory.length;

    const now = Date.now();
    let beat = false;
    if (
      bassRaw > BEAT_MIN &&
      bassRaw > avg * BEAT_THRESHOLD &&
      now - this._lastBeatAt > BEAT_COOLDOWN_MS
    ) {
      beat = true;
      this._lastBeatAt = now;
    }

    const bands = new Array(BAND_COUNT);
    for (let i = 0; i < BAND_COUNT; i++) {
      const raw = bandAvg(mag, binHz, this._bandEdges[i], this._bandEdges[i + 1]);
      bands[i] = this._bandGains[i].normalize(raw);
    }

    this.onFeatures({ bass, mid, treble, level: normLevel, beat, bands });
  }

  /** Full mix: L+R folded to mono, then one FFT. `level` is time-domain RMS. */
  _monoSpectrum(samples) {
    const mono = new Float32Array(FFT_SIZE);
    let sumSquares = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const m = (samples[i * 2] + samples[i * 2 + 1]) * 0.5;
      sumSquares += m * m;
      mono[i] = m * this._window[i];
    }
    const level = Math.sqrt(sumSquares / FFT_SIZE);

    const re = mono;
    const im = new Float32Array(FFT_SIZE);
    fft(re, im);

    const mag = new Float32Array(FFT_SIZE / 2);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i]);
    return { mag, level };
  }

  /**
   * Instrumental only: one FFT per channel, so each bin's L/R agreement can be
   * measured, then the mono spectrum (L+R)/2 — identical to _monoSpectrum's —
   * is scaled down wherever a bin is centred and inside the vocal range.
   * `level` comes from the masked spectrum's energy, since the vocals can't be
   * taken out of the time-domain signal.
   */
  _instrumentalSpectrum(samples, binHz) {
    const lRe = new Float32Array(FFT_SIZE);
    const rRe = new Float32Array(FFT_SIZE);
    let windowPower = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const w = this._window[i];
      lRe[i] = samples[i * 2] * w;
      rRe[i] = samples[i * 2 + 1] * w;
      windowPower += w * w;
    }
    const lIm = new Float32Array(FFT_SIZE);
    const rIm = new Float32Array(FFT_SIZE);
    fft(lRe, lIm);
    fft(rRe, rIm);

    const gains = this._vocalGains;
    centerSuppressionGains(lRe, lIm, rRe, rIm, binHz, this._prevSim, gains, VOCAL_SUPPRESSION);

    const mag = new Float32Array(FFT_SIZE / 2);
    let energy = 0;
    for (let i = 0; i < mag.length; i++) {
      const m = 0.5 * Math.hypot(lRe[i] + rRe[i], lIm[i] + rIm[i]) * gains[i];
      mag[i] = m;
      energy += m * m;
    }
    // Parseval over the one-sided spectrum (×2 for the mirrored half), undoing
    // the window's power loss, gives roughly the same RMS as the time domain.
    const level = Math.sqrt((2 * energy) / (FFT_SIZE * windowPower));
    return { mag, level };
  }
}

module.exports = { AudioCapture };
