// Echo canceller for the wake word: removes what the PC itself is playing (captured as system "loopback"
// audio) from the microphone, so "Max" can be heard over a video with people talking. Whisper alone can't:
// with two voices at once it follows the video's (tested). Video-call apps do this for their own audio
// only; this does it for everything the PC plays.
//
// Two parts:
//  - delay: the speakers-to-mic path lags the loopback by tens to hundreds of ms. Found by cross-correlating
//    the last second of mic and loopback (FFT), re-checked every 2 s while something is playing.
//  - an NLMS adaptive filter (512 taps = 32 ms of room echo around that delay) that learns how the speaker
//    sound arrives at the mic and subtracts it. It only adapts while the PC is playing something and the mic
//    isn't much louder than the predicted echo (that's you talking), so it doesn't learn to cancel you.
//
// Runs as an AudioWorklet in the wake window (input 0 = mic, input 1 = loopback, output = cleaned mic), and
// in Node for the offline test (test-aec.mjs).
'use strict';

function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// Lag (in samples, 0..maxLag) by which mic trails ref, or -1 if there's no clear peak.
function estimateDelay(mic, ref, maxLag) {
  let n = 1; while (n < mic.length + ref.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(mic); br.set(ref);
  fft(ar, ai, false); fft(br, bi, false);
  // cross-spectrum with PHAT weighting (sharp peak even for speech)
  for (let k = 0; k < n; k++) {
    const r = ar[k] * br[k] + ai[k] * bi[k], i = ai[k] * br[k] - ar[k] * bi[k];
    const m = Math.hypot(r, i) + 1e-12;
    ar[k] = r / m; ai[k] = i / m;
  }
  fft(ar, ai, true);
  let best = -1, bestV = 0, sum = 0;
  for (let lag = 0; lag <= maxLag; lag++) { const v = ar[lag]; sum += Math.abs(v); if (v > bestV) { bestV = v; best = lag; } }
  return bestV > 4 * (sum / (maxLag + 1)) ? best : -1;   // a peak well above the average, or nothing
}

class EchoCanceller {
  constructor({ taps = 512, maxDelay = 8000, mu = 0.25, pre = 64 } = {}) {
    this.L = taps; this.pre = pre; this.mu = mu; this.maxDelay = maxDelay;
    this.w = new Float32Array(taps);
    this.hist = new Float32Array(maxDelay + taps + 2048);   // loopback history (ring)
    this.pos = 0; this.delay = -1;
    this.micBuf = new Float32Array(16000); this.refBuf = new Float32Array(16000); this.fill = 0;
    this.sinceCheck = 0; this.refPow = 0; this.errPow = 1e-6; this.echoPow = 1e-6; this.micPow = 1e-6;
  }
  // mic, ref: Float32Array blocks of the same length. Returns the cleaned mic block.
  process(mic, ref) {
    const out = new Float32Array(mic.length), H = this.hist, N = H.length, L = this.L;
    for (let n = 0; n < mic.length; n++) {
      H[this.pos] = ref[n];
      this.refPow = 0.999 * this.refPow + 0.001 * ref[n] * ref[n];
      // keep a second of both for the delay check
      this.micBuf[this.fill] = mic[n]; this.refBuf[this.fill] = ref[n]; this.fill = (this.fill + 1) % 16000;
      let e = mic[n];
      if (this.delay >= 0) {
        // the filter covers loopback from (delay - pre) to (delay - pre + L) samples ago
        // norm starts at a floor (about -50 dBFS of speaker signal across the filter): with a near-silent
        // speaker in a pause, mic noise divided by a tiny norm blew the filter apart and it lost ~30 dB.
        let y = 0, norm = L * 1e-5;
        let idx = this.pos - (this.delay - this.pre); if (idx < 0) idx += N;
        for (let k = 0; k < L; k++) { const x = H[idx]; y += this.w[k] * x; norm += x * x; if (--idx < 0) idx = N - 1; }
        e = mic[n] - y;
        this.echoPow = 0.995 * this.echoPow + 0.005 * y * y;
        this.errPow = 0.995 * this.errPow + 0.005 * e * e;
        this.micPow = 0.995 * this.micPow + 0.005 * mic[n] * mic[n];
        // adapt only while the PC plays something and the mic isn't much louder than the echo (you talking)
        const playing = this.refPow > 1e-5 && norm > 2 * L * 1e-5;   // the speakers are actually playing
        // You talking = the leftover is suddenly much louder than the predicted echo. Only judged once the filter
        // already cancels something (>6 dB); before that its prediction is ~0 and everything would look like you.
        const converged = this.micPow > 4 * this.errPow;
        const nearEnd = converged && this.errPow > 4 * this.echoPow;
        if (playing && !nearEnd) {
          const g = this.mu * e / norm;
          idx = this.pos - (this.delay - this.pre); if (idx < 0) idx += N;
          for (let k = 0; k < L; k++) { this.w[k] += g * H[idx]; if (--idx < 0) idx = N - 1; }
        }
      }
      out[n] = e;
      this.pos = (this.pos + 1) % N;
    }
    // re-check the delay every 2 s while something is playing
    this.sinceCheck += mic.length;
    if (this.sinceCheck >= 32000 && this.refPow > 1e-6) {
      this.sinceCheck = 0;
      const rot = (b) => { const o = new Float32Array(16000); o.set(b.subarray(this.fill)); o.set(b.subarray(0, this.fill), 16000 - this.fill); return o; };
      const d = estimateDelay(rot(this.micBuf), rot(this.refBuf), this.maxDelay);
      if (d >= 0 && (this.delay < 0 || Math.abs(d - this.delay) > 48)) { this.delay = Math.max(this.pre, d); this.w.fill(0); }
    }
    return out;
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor('max-aec', class extends AudioWorkletProcessor {
    constructor() { super(); this.aec = new EchoCanceller(); }
    process(inputs, outputs) {
      const mic = inputs[0][0], ref = inputs[1] && inputs[1][0], out = outputs[0][0];
      if (!mic || !out) return true;
      out.set(ref ? this.aec.process(mic, ref) : mic);
      return true;
    }
  });
}
if (typeof module !== 'undefined') module.exports = { EchoCanceller, estimateDelay };
