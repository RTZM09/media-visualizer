// Minimal dependency-free DSP helpers: an in-place iterative radix-2
// Cooley-Tukey FFT (`n` must be a power of two), a Hann window, and the
// centre-channel mask behind instrumental-only mode.

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe;

        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;

        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Per-bin gains that turn down centre-panned content inside a frequency range,
 * a cheap real-time stand-in for vocal removal (lead vocals are almost always
 * mixed dead centre, while most instruments have some stereo width).
 *
 * Inputs are the FFT spectra of the left and right channels. For each bin,
 * `sim = 2·Re(L·conj(R)) / (|L|² + |R|²)` is 1 only when both channels agree in
 * level *and* phase, i.e. the sound sits exactly in the centre; it falls off
 * for panned or wide content and goes negative for out-of-phase content.
 * `prevSim` (length = out.length) carries a per-bin running average between
 * calls so the mask doesn't flicker frame to frame; it is mutated.
 *
 * opts: { loHz, hiHz, loRampHz, hiRampHz, simLo, simHi, smoothing, strength }
 *   - the band is [loHz, hiHz], fading in over loRampHz below loHz and out
 *     over hiRampHz above hiHz; outside it the gain is exactly 1
 *   - simLo..simHi is the similarity range mapped (smoothstep) to "centred"
 *   - smoothing is the weight given to the previous frame's similarity
 *   - strength is how much a fully centred in-band bin is cut (1 = silenced)
 */
function centerSuppressionGains(lRe, lIm, rRe, rIm, binHz, prevSim, out, opts) {
  const { loHz, hiHz, loRampHz, hiRampHz, simLo, simHi, smoothing, strength } = opts;
  for (let i = 0; i < out.length; i++) {
    const f = i * binHz;
    let bandWeight;
    if (f < loHz - loRampHz || f > hiHz + hiRampHz) bandWeight = 0;
    else if (f < loHz) bandWeight = (f - (loHz - loRampHz)) / loRampHz;
    else if (f > hiHz) bandWeight = 1 - (f - hiHz) / hiRampHz;
    else bandWeight = 1;

    if (bandWeight <= 0) {
      out[i] = 1;
      prevSim[i] = 0;
      continue;
    }

    const cross = lRe[i] * rRe[i] + lIm[i] * rIm[i]; // Re(L · conj(R))
    const power = lRe[i] * lRe[i] + lIm[i] * lIm[i] + rRe[i] * rRe[i] + rIm[i] * rIm[i];
    const rawSim = power > 1e-12 ? Math.max(0, (2 * cross) / power) : 0;
    const sim = smoothing * prevSim[i] + (1 - smoothing) * rawSim;
    prevSim[i] = sim;

    out[i] = 1 - strength * smoothstep(simLo, simHi, sim) * bandWeight;
  }
}

module.exports = { fft, hannWindow, centerSuppressionGains };
