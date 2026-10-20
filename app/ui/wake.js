// Wake word: a hidden window keeps the mic open and sends sound to the main process, which runs it through
// local Whisper and opens the hologram when it starts with "Max". Nothing leaves the laptop.
// - A short burst in a quiet room is checked once, as soon as it stops (0.35 s of quiet).
// - During continuous sound (a video or music playing), there is never a gap to wait for, so the last 2 s are
//   checked every 1.4 s instead: a ~0.5 s "Max" always lands whole inside one window. This used to skip
//   anything longer than 6 s, which is why Max couldn't hear its name over media.
// - Over people talking in a video, Whisper follows their voice, not yours. So what the speakers play is
//   captured too (Windows loopback) and subtracted from the mic by an echo canceller (ui/aec.js) before any
//   of this. That needs the raw mic: Chrome's own echo/noise/gain processing would break the subtraction.
'use strict';
(async () => {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const { node: input } = await cleanMic(ctx);   // mic.js
  input.connect(proc); proc.connect(ctx.destination);
  const WINDOW = 16000 * 2, STRIDE_MS = 1400, MAX_BURST = 16000 * 6;
  let noise = 0.01, speaking = false, chunks = [], preroll = [], lastVoice = 0, startedAt = 0, lastCheck = 0, busy = false, long = false;
  const join = (list) => {
    const a = new Float32Array(list.reduce((n, c) => n + c.length, 0));
    let o = 0; for (const c of list) { a.set(c, o); o += c.length; }
    return a;
  };
  const check = (audio, sliding) => { busy = true; window.max.wake(audio, sliding).catch(() => {}).finally(() => { busy = false; }); };
  proc.onaudioprocess = (e) => {
    const d = new Float32Array(e.inputBuffer.getChannelData(0));
    let sum = 0; for (const v of d) sum += v * v;
    const rms = Math.sqrt(sum / d.length);
    const threshold = Math.max(0.015, noise * 3), now = performance.now();
    if (!speaking) {
      noise = noise * 0.97 + rms * 0.03;
      preroll.push(d); if (preroll.length > 4) preroll.shift();
      if (rms > threshold) { speaking = true; long = false; chunks = [...preroll]; lastVoice = startedAt = lastCheck = now; }
      return;
    }
    chunks.push(d);
    if (rms > threshold) lastVoice = now;
    // keep only the last 6 s of a long stretch; the sliding checks below cover the rest
    let total = chunks.reduce((n, c) => n + c.length, 0);
    while (total > MAX_BURST) { total -= chunks.shift().length; long = true; }
    if (now - lastVoice >= 350) {   // it stopped: check the whole burst once (unless it was long and already covered)
      speaking = false;
      if (!busy && !long && now - startedAt >= 300) check(join(chunks));
      chunks = [];
      return;
    }
    // still going: slide a 2 s window across it
    if (now - startedAt > 2000 && now - lastCheck >= STRIDE_MS && !busy) {
      lastCheck = now;
      const win = [];
      for (let i = chunks.length - 1, n = 0; i >= 0 && n < WINDOW; i--) { win.unshift(chunks[i]); n += chunks[i].length; }
      check(join(win), true);
    }
  };
})();
