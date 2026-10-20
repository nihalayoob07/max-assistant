// The core: three rings and a pulsing centre. Shared by the dashboard and voice mode.
// Each moving part is its own <svg> layer, so the GPU spins/pulses the already-drawn layer instead of the
// page redrawing the whole glowing core every frame (that redraw is what made the rings stutter).
'use strict';
window.orbSVG = (cls = '') => {
  const layer = (c, body) => `<svg class="${c}" viewBox="0 0 200 200"><g filter="url(#gl)" fill="none" stroke="#38dbe6">${body}</g></svg>`;
  return `<div class="orb ${cls}" role="button" tabindex="0" aria-label="Talk to Max">
  <svg class="base" viewBox="0 0 200 200">
    <defs>
      <radialGradient id="cg" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#e6fdff"/><stop offset="35%" stop-color="#38dbe6"/>
        <stop offset="100%" stop-color="#38dbe6" stop-opacity="0"/>
      </radialGradient>
      <filter id="gl"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <g filter="url(#gl)" fill="none" stroke="#38dbe6">
      <circle cx="100" cy="100" r="92" stroke-opacity=".18"/>
      <circle cx="100" cy="100" r="36" stroke-opacity=".35"/>
    </g>
  </svg>
  ${layer('r1', '<circle cx="100" cy="100" r="84" stroke-width="2" stroke-dasharray="60 18 6 18" stroke-opacity=".75"/>')}
  ${layer('r2', '<circle cx="100" cy="100" r="68" stroke-width="5" stroke-dasharray="2 9" stroke-opacity=".55"/>')}
  ${layer('r3', '<circle cx="100" cy="100" r="52" stroke-width="1.5" stroke-dasharray="90 40" stroke-opacity=".9"/><path d="M100 40v10M100 150v10M40 100h10M150 100h10" stroke-width="2"/>')}
  ${layer('level', '<circle cx="100" cy="100" r="40" stroke-width="2" stroke-opacity=".8"/>')}
  <svg class="core-dot" viewBox="0 0 200 200"><circle cx="100" cy="100" r="30" fill="url(#cg)"/></svg>
</div>`;
};

// Ring rotation: Web Animations run on the compositor, so the rings keep turning smoothly even while the
// page is busy (audio, streaming, re-renders). Only the speed is steered from here: it eases between a
// slow drift (idle) and a brisk spin (thinking) over about a second. New cores pick up the shared angle.
(() => {
  const IDLE = [90, 70, 55];        // seconds per turn
  const BUSY = [7, 5, 3.5];
  const DIR = [1, -1, 1];
  const angle = [0, 0, 0];
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const spins = new Map();          // ring element -> { anim, i, rate }
  let k = 0, last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const busy = !!document.querySelector('.orb.thinking, .thinking .orb, .transcribing .orb');
    k += ((busy ? 1 : 0) - k) * Math.min(1, dt * 2.2);
    const rate = (i) => (1 - k) + k * IDLE[i] / BUSY[i];   // playback rate relative to the idle speed
    for (let i = 0; i < 3; i++) angle[i] = (angle[i] + 360 * dt * rate(i) / IDLE[i]) % 360;
    if (!still.matches) {
      for (const orb of document.querySelectorAll('.orb')) {
        for (let i = 0; i < 3; i++) {
          const ring = orb.querySelector(`.r${i + 1}`);
          if (!ring || spins.has(ring)) continue;
          const anim = ring.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${DIR[i] * 360}deg)` }],
            { duration: IDLE[i] * 1000, iterations: Infinity });
          anim.currentTime = angle[i] / 360 * IDLE[i] * 1000;
          anim.playbackRate = rate(i);
          spins.set(ring, { anim, i, rate: rate(i) });
        }
      }
      for (const [ring, s] of spins) {
        if (!ring.isConnected) { s.anim.cancel(); spins.delete(ring); continue; }
        const r = rate(s.i);
        if (Math.abs(r - s.rate) > 0.02 * s.rate) { s.anim.updatePlaybackRate(r); s.rate = r; }
      }
    }
    // Only steer every frame while the speed is changing; otherwise check 4x a second (new cores, busy state).
    const settling = Math.abs((busy ? 1 : 0) - k) > 0.01;
    if (settling) requestAnimationFrame(frame); else setTimeout(() => requestAnimationFrame(frame), 250);
  };
  requestAnimationFrame(frame);
})();
