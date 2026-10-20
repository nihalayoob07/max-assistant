// Voice mode: listen -> Whisper (local, in the main process) -> Max (streaming, with live tool
// readouts) -> speak the answer -> listen again. The microphone is off while Max thinks or speaks,
// so it never hears itself.
'use strict';
const $ = (s) => document.querySelector(s);
const core = $('#core');
core.innerHTML = window.orbSVG();

const VOICE_SYSTEM = [
  'The owner is talking to you out loud through the desktop app, and your answer will be read aloud by a voice.',
  'Do whatever work is needed with your tools first. Then write exactly what a sharp, friendly assistant would SAY in a real',
  'conversation: two or three short sentences, contractions, plain everyday words, the most useful thing first.',
  'Never write anything that only works on a screen: no lists, markdown, emojis, links, file names, lead IDs, slashes,',
  'symbols or abbreviations. Say "28 degrees" not "28°C", "about fifteen thousand rupees" not "₹14,999",',
  '"Monday the 20th" not "2026-10-20", "half past six" not "06:30", "or" instead of "/". Round numbers unless the exact',
  'figure matters. Refer to customers by name or business, never by ID.',
].join(' ');

let mode = 'idle';          // listening | transcribing | thinking | speaking
let history = [];
let stream, ctx, proc;
let chunks = [], preroll = [], speaking = false, lastVoice = 0, startedAt = 0, noise = 0.01;

function setMode(m, label) {
  const was = mode;
  mode = m;
  core.className = 'core ' + m;
  $('#state').textContent = label || m;
  core.style.setProperty('--lvl', 0);
  sizeCorner(was);
}

/* ---------- Corner sizes ----------
   Tucked away, Max is a tiny core while it waits or works. It grows (with dialogue boxes) when you call it
   and while it listens; once it starts working it keeps showing what it heard for 3 s, so you can say
   "Max, …" to correct a mishearing, then shrinks until it answers. After answering, the boxes stay 6 s. */
let shrinkTimer = null;
let expanding = false;   // corner -> full screen in progress: leave the corner's size alone
function sizeCorner(was) {
  if (expanding) return;
  clearTimeout(shrinkTimer);
  const quiet = mode === 'idle' || mode === 'thinking';
  const set = () => {
    const tiny = mini && quiet;
    if (mini && !tiny) window.max.voiceShape(shapeRects(false));   // open the window up before the core grows
    document.body.classList.toggle('tiny', tiny);
  };
  const linger = !mini || !quiet || document.body.classList.contains('tiny') ? 0
    : was === 'speaking' || was === 'preparing' ? 6000 : mode === 'thinking' ? 3000 : 0;
  if (linger) shrinkTimer = setTimeout(set, linger); else set();
}
// Full screen <-> corner: the core flies to its new spot (measure, switch, animate from the old spot).
// Rectangles in screen coordinates: the window itself moves and resizes between corner and full screen, so
// window-relative positions from before and after can't be compared (that made the core jump on zoom-in).
const onScreen = (el) => { const r = el.getBoundingClientRect(); return { left: r.left + window.screenX, top: r.top + window.screenY, width: r.width, height: r.height }; };
function morph(change, a = onScreen(core)) {
  document.body.classList.add('snap');   // measure the final size, not the start of the size transition
  change();
  const b = onScreen(core);
  requestAnimationFrame(() => document.body.classList.remove('snap'));
  if (!a.width || !b.width) return;
  const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
  core.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${a.width / b.width})` }, { transform: 'none' }],
    { duration: 520, easing: 'cubic-bezier(.2, .8, .2, 1)' });
}

/* ---------- Microphone and end-of-speech detection ---------- */
async function startMic() {
  // Echo-cancelled like the wake listener (mic.js): Chrome's own echo cancelling only removes sound this
  // page plays, so a video playing while you asked got mixed into what Max heard.
  ctx = new AudioContext({ sampleRate: 16000 });
  const mic = await cleanMic(ctx);
  stream = { getTracks: () => mic.streams.flatMap((s) => s.getTracks()) };
  const src = mic.node;
  proc = ctx.createScriptProcessor(2048, 1, 1);
  src.connect(proc); proc.connect(ctx.destination);
  proc.onaudioprocess = (e) => {
    if (mode !== 'listening') return;
    const d = new Float32Array(e.inputBuffer.getChannelData(0));
    let sum = 0; for (const v of d) sum += v * v;
    const rms = Math.sqrt(sum / d.length);
    core.style.setProperty('--lvl', Math.min(1, rms * 12).toFixed(3));
    const threshold = Math.max(0.015, noise * 3);
    const now = performance.now();
    if (!speaking) {
      noise = noise * 0.97 + rms * 0.03;                      // track the room's background level
      preroll.push(d); if (preroll.length > 4) preroll.shift(); // keep ~0.5 s before speech starts
      if (rms > threshold) { speaking = true; chunks = [...preroll]; lastVoice = startedAt = now; $('#state').textContent = 'listening…'; }
      return;
    }
    chunks.push(d);
    if (rms > threshold) lastVoice = now;
    if (now - lastVoice > 1100 || now - startedAt > 30000) finishListening();
  };
}

// Minimised to the corner, Max only listens after you say "Max" (or click it), so it doesn't pick up
// everything you say while you work. Full size, it listens after every answer.
let mini = false;
let awaitAnswer = false;   // Max just asked something on its own ("Want me to draft them?"): listen for the answer
function listen(woken = false) {
  chunks = []; preroll = []; speaking = false;
  if (awaitAnswer) { woken = true; awaitAnswer = false; }
  if (mini && !woken) return setMode('idle', 'Say “Max”');
  setMode('listening', 'Listening');
}
// The window shrinks to the corner only after the core has flown there, and grows to full screen before it
// flies back (main.js resizes it; the content is anchored bottom-left, so the resize itself doesn't show).
let resizeTimer = null;
async function setMini(on) {
  if (mini === on) return;
  clearTimeout(resizeTimer);
  let from;
  if (on) resizeTimer = setTimeout(() => mini && window.max.voice('mini'), 560);
  else {
    // Growing: hold the corner exactly as it is (no listening-size growth meanwhile) until the window has
    // really become full screen, then fly the core out from where it was. A fixed 60 ms wait started the
    // animation before the resize, so it played in the corner square and then jumped.
    expanding = true;
    from = onScreen(core);
    window.max.voice('full');
    await new Promise((r) => {
      const t = setTimeout(r, 600);
      window.addEventListener('resize', () => { clearTimeout(t); requestAnimationFrame(() => r()); }, { once: true });
    });
    expanding = false;
  }
  morph(() => {
    mini = on;
    document.body.classList.toggle('mini', on);
    if (on && mode === 'listening' && !speaking) listen();
    else if (!on && mode === 'idle') listen(true);
    else sizeCorner(mode);
  }, from);
}
window.max.onExpand(() => setMini(false));   // the dashboard's core or the tray asked for the full view
// Proactive Max: a nudge from main.js. Wait if Max is busy talking or working; otherwise grow, say it, and
// listen for the answer. It goes into the conversation, so "yes, do it" makes sense to Max.
window.max.onAnnounce(function announce(text) {
  if (mode === 'thinking' || mode === 'speaking' || mode === 'preparing' || speaking) return setTimeout(() => announce(text), 30000);
  growCorner();
  $('#you').textContent = '';
  $('#reply').textContent = pendingReply = text;
  history.push({ role: 'assistant', content: text });
  window.max.appendChat({ role: 'assistant', content: text });
  awaitAnswer = true;
  speak(text);
});
// "Max" heard by the always-on wake word while this is open: interrupt whatever Max is doing and listen.
// A soft two-note chime the instant Max hears its name, so you know it's listening before it says anything.
function chime() {
  player();
  out.resume();
  const t = out.currentTime;
  for (const [f, at] of [[880, 0], [1320, 0.09]]) {
    const o = out.createOscillator(), g = out.createGain();
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(0.12, t + at + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.18);
    o.connect(g).connect(out.destination); o.start(t + at); o.stop(t + at + 0.2);
  }
}
window.max.onWake((q) => {
  chime();
  if (mode === 'thinking') cancelAsk();
  else if (mode === 'speaking' || mode === 'preparing') { stopSpeaking(); $('#reply').textContent = pendingReply; }
  if (q) { growCorner(); ask(q); }   // grow to show what it heard, then shrink while working
  else listen(true);
});

async function finishListening() {
  if (mode !== 'listening') return;
  setMode('transcribing', 'Understanding');
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const audio = new Float32Array(total);
  let o = 0; for (const c of chunks) { audio.set(c, o); o += c.length; }
  chunks = [];
  let text = '';
  try { text = await window.max.transcribe(audio); } catch (e) { $('#reply').textContent = `Speech recognition failed: ${e.message}`; }
  if (!text) return listen();
  // "switch pc": flip the active computer right here, without asking Max.
  if (/^\s*(please\s+)?(switch|change|flip)\s+(the\s+)?(pc|computer|machine|device)s?\b|^\s*switch\s+to\s+(the\s+|my\s+)?(laptop|server)\b/i.test(text)) {
    const pc = await window.max.pc(/\bserver\b/i.test(text) ? 'server' : /\blaptop\b/i.test(text) ? 'laptop' : 'toggle');
    $('#you').textContent = `“${text}”`;
    pendingReply = `Switched to your ${pc}.`;
    return speak(pendingReply);
  }
  ask(text);
}

/* ---------- Asking Max, with live readouts ---------- */
let current = null, side = 0;
const lines = new Map();
window.max.onStream((d) => {
  if (d.id !== current) return;
  if (d.kind === 'delta') return;   // the answer appears with its voice, not before
  if (d.kind !== 'tool') return;
  if (d.status === 'running') {
    const col = side++ % 2 ? '#readR' : '#readL';
    const el = document.createElement('div');
    el.className = 'r';
    el.innerHTML = '<b></b> <span></span>';
    el.querySelector('b').textContent = String(d.tool || '').replace(/_/g, ' ').toUpperCase();
    el.querySelector('span').textContent = d.label ? '· ' + d.label : '';
    $(col).append(el);
    while ($(col).children.length > 9) $(col).firstChild.remove();
    lines.set(d.callId, el);
    const say = describe(d.tool, d.label);
    if (say) aside(say);
  } else lines.get(d.callId)?.classList.add('done');
});

let asking = false;
async function ask(text) {
  if (asking) return;   // one question at a time
  asking = true;
  setMode('thinking', 'Working');
  startSmallTalk();
  $('#you').textContent = `“${text}”`;
  $('#reply').textContent = '';
  history.push({ role: 'user', content: text });
  window.max.appendChat({ role: 'user', content: `🎙 ${text}` });
  const id = current = Math.random().toString(36).slice(2);
  let reply = '';
  try {
    reply = await window.max.chatStream(id, [{ role: 'system', content: VOICE_SYSTEM }, ...history.slice(-10)]);
  } catch (e) {
    reply = `I couldn't reach the server: ${e.message}`;
  }
  if (current !== id) return;   // cancelled by a click while working
  reply = reply.trim() || "I didn't get an answer from the server. Try again in a moment.";
  pendingReply = reply;
  history.push({ role: 'assistant', content: reply });
  window.max.appendChat({ role: 'assistant', content: reply });
  asking = false;
  stopAsides();   // the real answer takes over
  speak(reply);
}

/* ---------- Speaking ---------- */
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  const prefer = [/George|Ryan|Thomas/i, /Mark|Guy|David/i, /en-GB/i, /en-/i];
  for (const p of prefer) { voice = vs.find((v) => p.test(v.name) || p.test(v.lang)); if (voice) return; }
}
speechSynthesis.onvoiceschanged = pickVoice; pickVoice();

// How names should sound: fixed here, so it never depends on Max remembering.
const PRONOUNCE = {};   // names the voice says wrong, e.g. { Siobhan: 'Shivawn' }
const sayNames = (t) => t.replace(/\b[\p{L}]+\b/gu, (w) => {
  const k = Object.keys(PRONOUNCE).find((n) => n.toLowerCase() === w.toLowerCase());
  return k ? PRONOUNCE[k] : w;
});

// Last line of defence before the voice: anything screen-only that slipped through becomes words.
const speakable = (t) => t
  .replace(/https?:\/\/\S+/g, 'the link')
  .replace(/\bIST\b/g, '')
  .replace(/(\d)\s?°\s?C\b/g, '$1 degrees').replace(/(\d)\s?°\s?F\b/g, '$1 degrees Fahrenheit').replace(/°/g, ' degrees')
  .replace(/\bkm\/h\b/gi, 'kilometres per hour')
  .replace(/(\d|rupees)\s?\/\s?(day|week|month|year|hour|night|piece|person)\b/gi, '$1 per $2')
  .replace(/([\p{L}\d])\s?\/\s?([\p{L}\d])/gu, '$1 or $2').replace(/\//g, ' ')
  .replace(/\be\.g\.,?/gi, 'for example').replace(/\bi\.e\.,?/gi, 'that is').replace(/\betc\./gi, 'and so on')
  .replace(/\bvs\.?\b/gi, 'versus').replace(/&/g, ' and ').replace(/\s[-–—]\s/g, ', ')
  // Brackets make awkward pauses when read aloud: "(lost)." -> ", lost."
  .replace(/\s*\(([^)]*)\)(?=[.,!?;:])/g, ', $1')
  .replace(/\s*\(([^)]*)\)/g, ', $1,')
  .replace(/^\s*[-•*]\s+/gm, '')
  .replace(/[*_#`>|~\[\]{}]/g, '')
  .replace(/\p{Extended_Pictographic}/gu, '')
  .replace(/\bL0*(\d+)\b/g, 'lead $1')
  // Money, dates, times and numbers as words (ui/speech.js): Kokoro reads 4-digit numbers as years.
  .replace(/[\s\S]+/, (s) => window.spokenNumbers(s))
  .replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();

// Neural voice (Kokoro, generated locally in the main process): sentences arrive as audio chunks and
// play back to back. The core's level ring follows the voice. Windows' built-in voice is the fallback.
let out = null, analyser = null, playId = null, playing = [], nextAt = 0, gotLast = false, meter = 0;
function player() {
  if (out) return;
  out = new AudioContext();
  analyser = out.createAnalyser(); analyser.fftSize = 512;
  analyser.connect(out.destination);
}
function followVoice() {
  cancelAnimationFrame(meter);
  const buf = new Float32Array(analyser.fftSize);
  const step = () => {
    if (mode !== 'speaking') return core.style.setProperty('--lvl', 0);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0; for (const v of buf) sum += v * v;
    core.style.setProperty('--lvl', Math.min(1, Math.sqrt(sum / buf.length) * 6).toFixed(3));
    meter = requestAnimationFrame(step);
  };
  step();
}
window.max.onTts((d) => {
  if (d.id === asideId) return playAside(d);
  if (d.id !== playId || (mode !== 'preparing' && mode !== 'speaking')) return;
  if (mode === 'preparing') startSpeaking();
  const pcm = new Float32Array(d.pcm);
  const ab = out.createBuffer(1, pcm.length, d.rate);
  ab.copyToChannel(pcm, 0);
  const src = out.createBufferSource();
  src.buffer = ab; src.connect(analyser);
  nextAt = Math.max(nextAt, out.currentTime + 0.05);
  src.start(nextAt);
  nextAt += ab.duration;
  playing.push(src);
  if (d.last) gotLast = true;
  src.onended = () => {
    playing = playing.filter((s) => s !== src);
    if (gotLast && !playing.length && mode === 'speaking') listen();
  };
});
function stopSpeaking() {
  if (playId) window.max.cancelSpeak(playId);
  playId = null;
  playing.forEach((s) => { try { s.stop(); } catch {} });
  playing = [];
  speechSynthesis.cancel();
}

/* ---------- Small talk while Max works ----------
   A quick "On it.", then what Max is doing as a sentence ("Checking your calendar."), at most one every
   6 seconds, and a "Still on it." on long waits. Same voice; the mic stays off; the real answer cuts it off. */
let asideId = null, asidePlaying = [], asideTimers = [], lastAside = 0;
const ACKS = ['On it.', 'Sure, one sec.', 'Let me check.', 'Okay, give me a moment.', 'Got it, working on that.'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function aside(text, force = false) {
  if (mode !== 'thinking' || asidePlaying.length) return;
  if (!force && performance.now() - lastAside < 6000) return;
  lastAside = performance.now();
  player();
  out.resume();
  asideId = 'a' + Math.random().toString(36).slice(2);
  window.max.speak(asideId, text).catch(() => {});
}
function playAside(d) {
  if (mode !== 'thinking') return;
  const pcm = new Float32Array(d.pcm);
  const ab = out.createBuffer(1, pcm.length, d.rate);
  ab.copyToChannel(pcm, 0);
  const src = out.createBufferSource();
  src.buffer = ab; src.connect(analyser);
  src.start();
  asidePlaying.push(src);
  src.onended = () => { asidePlaying = asidePlaying.filter((s) => s !== src); };
}
function stopAsides() {
  asideTimers.forEach(clearTimeout);
  asideTimers = [];
  if (asideId) window.max.cancelSpeak(asideId);
  asideId = null;
  asidePlaying.forEach((s) => { try { s.stop(); } catch {} });
  asidePlaying = [];
}
function startSmallTalk() {
  stopAsides();
  lastAside = 0;
  asideTimers.push(setTimeout(() => aside(pick(ACKS), true), 900));
  asideTimers.push(setTimeout(() => aside('Still on it.', true), 25000));
  asideTimers.push(setTimeout(() => aside('Almost there, this one takes a bit.', true), 50000));
}
// What Max is doing right now, said as a sentence. null = say nothing (loading a skill and so on).
function describe(tool, label) {
  const l = String(label || '');
  if (/pc\.sh\s+which/.test(l)) return null;
  if (/pc\.sh\s+(laptop|active)/.test(l)) return 'Doing that on your laptop.';
  if (/pc\.sh\s+server/.test(l)) return 'Checking the server.';
  if (/lead\.sh|leads/.test(l)) return 'Looking at your leads.';
  if (/cal\.sh|calendar/.test(l)) return 'Checking your calendar.';
  if (/todos|notes/.test(l)) return 'Looking through your notes.';
  if (/search_files|read_file/.test(tool)) return 'Looking through your files.';
  if (/web|search/.test(tool)) return 'Searching the web.';
  if (tool === 'memory') return 'Checking what I remember.';
  if (tool === 'terminal') return 'Running a quick command.';
  return null;
}

// Stays "Working" (core spinning, no text) until the voice is ready; then text and audio together.
let pendingReply = '';
function startSpeaking() {
  setMode('speaking', 'Speaking');
  $('#reply').textContent = pendingReply;
  followVoice();
}

async function speak(text) {
  mode = 'preparing';   // keeps the thinking look and label from ask()
  stopSpeaking();
  player();
  await out.resume();
  playId = Math.random().toString(36).slice(2);
  nextAt = 0; gotLast = false;
  try {
    await window.max.speak(playId, sayNames(speakable(text)));
    if (!gotLast && !playing.length && mode === 'preparing') { $('#reply').textContent = pendingReply; listen(); }   // nothing to say
  } catch {
    // Neural voice unavailable: fall back to Windows' built-in voice.
    startSpeaking();
    const u = new SpeechSynthesisUtterance(sayNames(speakable(text)));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => { if (mode === 'speaking') listen(); };
    speechSynthesis.speak(u);
  }
}

/* ---------- Controls ---------- */
function close() {
  stopAsides();
  stopSpeaking();
  stream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  window.max.voice('close');
}
// Click while Max works: drop the question and listen again (the request is aborted in the main process).
function cancelAsk() {
  stopAsides();
  window.max.cancelChat(current);
  current = null;
  asking = false;
  history.pop();
  $('#reply').textContent = '';
  $('#you').textContent = '';
  listen();
}
core.addEventListener('click', () => {
  if (mini) { setMini(false); return; }
  if (mode === 'thinking') { cancelAsk(); return; }
  if (mode === 'speaking' || mode === 'preparing') { stopSpeaking(); $('#reply').textContent = pendingReply; listen(); }   // interrupt
  else if (mode === 'listening' && speaking) finishListening();         // done talking
});
$('#dim').addEventListener('click', () => setMini(true));
// Tucked away, the window is cut to the shape of what's showing (the core, its state line, the dialogue boxes),
// so clicks anywhere else go to the apps behind. Reported whenever any of them changes size.
let shapeTimer = null;
// The core's part of the shape is a fixed box for its size (tiny or listening), not its measured size: it
// grows and shrinks over 0.45 s, and a shape that trails the animation clipped the growing ring to the tiny
// square for half a second (seen in a screen recording). Growing opens the box before the change; shrinking
// cuts it only after the animation.
// Grow from tiny to listening size, opening the window's shape first.
function growCorner() { if (mini) window.max.voiceShape(shapeRects(false)); document.body.classList.remove('tiny'); }
// Duck the PC's other audio while Max listens or talks, so it doesn't hear videos and music as you.
setInterval(() => window.max.duck(['listening', 'transcribing', 'preparing', 'speaking'].includes(mode)), 250);
// "grown": the corner core has finished growing to listening size (0.45 s). The dialogue boxes only show
// then, never mid-growth, and go the moment it starts shrinking.
let grownTimer = null;
new MutationObserver(() => {
  const b = document.body.classList;
  // Only touch the class when it actually changes: classList.remove() of an absent class still counts as a
  // mutation, re-firing this observer forever (that froze the page before it could show anything).
  if (!b.contains('mini') || b.contains('tiny')) { clearTimeout(grownTimer); grownTimer = null; if (b.contains('grown')) b.remove('grown'); }
  else if (!b.contains('grown') && !grownTimer) grownTimer = setTimeout(() => { grownTimer = null; if (b.contains('mini') && !b.contains('tiny')) b.add('grown'); }, 470);
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
function shapeRects(tiny) {
  const H = window.innerHeight;
  const core = tiny ? { x: 0, y: H - 100, width: 100, height: 100 } : { x: 0, y: H - 215, width: 195, height: 215 };
  // Grown (listening, talking): the whole corner window. A shape that followed the dialogue boxes trailed them
  // by a frame or two each time they appeared or their text grew, so they flickered clipped ("glitchy bubbles").
  // ponytail: blocks clicks in the 620x280 corner while Max is grown; cut to the boxes again if that bothers.
  return tiny ? [core] : [{ x: 0, y: 0, width: window.innerWidth, height: H }];
}
function reportShape() {
  clearTimeout(shapeTimer);
  const tiny = document.body.classList.contains('tiny');
  shapeTimer = setTimeout(() => { if (mini) window.max.voiceShape(shapeRects(document.body.classList.contains('tiny'))); }, tiny ? 480 : 60);
}
const shapeWatch = new ResizeObserver(reportShape);
for (const el of [core, $('#state'), $('#you'), $('#reply')]) shapeWatch.observe(el);
document.addEventListener('transitionend', reportShape);
window.addEventListener('resize', reportShape);   // the window shrinking to the corner moves everything
new MutationObserver(reportShape).observe(document.body, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMini(true); });   // Esc tucks Max away; quit from the tray

// Starting tucked away (from the tray or at launch) applies before connecting, so an offline Max still sits
// small in the corner. If the server can't be reached, keep retrying quietly: the server's watchdog
// repairs Max's connection within a minute or two.
if (new URLSearchParams(location.search).get('corner')) { mini = true; document.body.classList.add('mini', 'tiny'); }
async function boot() {
  try {
    await window.max.connect();
    $('#reply').textContent = '';
    if (!stream) await startMic();
    const q = new URLSearchParams(location.search).get('q');   // "Max, play some lofi" arrives already asked
    if (q) ask(q); else listen();
  } catch (e) {
    const noMic = /Permission|NotAllowed|NotFound/i.test(e.name + e.message);
    setMode('idle', 'Offline');
    $('#reply').textContent = noMic ? 'No microphone available. Check Windows sound settings.'
      : `Can't reach Max right now (${String(e.message).replace(/^Error invoking remote method '\w+': (Error: )?/, '')}). Retrying…`;
    if (!noMic) setTimeout(boot, 20000);
  }
}
boot();

// Which computer Max is controlling, under the MAX label; follows "switch pc" from anywhere.
const showPc = (pc) => { $('#pc').textContent = `controlling: ${pc}`; document.body.dataset.pc = pc; };
window.max.pc('get').then(showPc);
window.max.onPc(showPc);
