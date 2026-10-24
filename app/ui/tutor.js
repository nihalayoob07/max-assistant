// Max's coding tutor and debugger. Opened by main.js with a job: a lesson ("how do I write a while loop"), the
// code from your editor to debug, or a box to drop or paste a program into. Max (the model) only writes JSON:
// the example, the steps and which line each is about, the errors and their fixes. This page does the rest in
// code: colours, the arrow, which part is editable, finding the lines, applying fixes.
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// `name` in Max's text shows as code.
const rich = (s) => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>');

const SYSTEM = [
  "You are Max's coding tutor and debugger, shown in a code panel in the desktop app. You know every programming language.",
  'Reply with ONE JSON object and nothing else: no markdown fences, no words before or after it. Do not use any tools.',
  'Every "say" is read aloud: one or two complete, friendly sentences in plain spoken English, like a teacher talking (not notes or fragments), under 35 words. Put code names in `backticks`.',
  'Line numbers are 1-based and count the lines of the code exactly as given.',
].join(' ');

const S = {
  kind: null,        // lesson | explain | practice | debug
  lang: '', title: '',
  files: [], fi: 0,  // [{ name, path?, code }]
  notes: [], at: 0,  // the steps or errors: [{ fi, line, text, say, simple?, vars?, n?, kind?, title?, find?, replace?, fixed? }]
  simple: false, traced: false,
  answer: null,      // a reply to a question, shown in place of the current note: { line, say }
  showFix: false,
  practice: null,    // { question, before, blank, after, hint, answer, result }
  waiting: null,     // what Max just asked: 'practice' | 'fix'
  offer: false,      // the lesson's last step asks "Want to try an example?"
};
function setWaiting(w) { S.waiting = w; window.max.tutorState(w); }

/* ---------- Asking Max ---------- */
let reqId = null, busyTimer = null;
function busy(label) {
  clearInterval(busyTimer);
  $('#busy').hidden = !label;
  if (!label) return;
  const t0 = Date.now();
  const tick = () => { $('#busy span').textContent = `${label}… ${Math.round((Date.now() - t0) / 1000)} s`; };
  tick();
  busyTimer = setInterval(tick, 1000);
}
window.max.onStream((d) => { if (d.id === reqId && d.kind === 'delta') $('#busy span').dataset.writing = '1'; });
function parseJSON(text) {
  const t = String(text).replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON');
  return JSON.parse(t.slice(a, b + 1));
}
// One question to Max; a garbled answer is asked once more. Returns null if a newer question replaced it.
async function askMax(prompt, label) {
  const id = reqId = Math.random().toString(36).slice(2);
  busy(label);
  task(null);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await window.max.tutorAsk(id, [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }]);
      if (id !== reqId) return null;
      try { return parseJSON(text); } catch {}
    }
    throw new Error("Max's answer came back garbled. Try again.");
  } catch (e) {
    if (id === reqId) { task(String(e.message).replace(/^Error invoking remote method '\w+': (Error: )?/, ''), 'bad'); say("Sorry, that didn't work."); }
    return null;
  } finally { if (id === reqId) busy(null); }
}
function cancelAsk() { if (reqId) window.max.cancelChat(reqId); reqId = null; busy(null); }

/* ---------- Lines ---------- */
const numbered = (code) => code.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
// Text copied from a numbered listing loses its "  12| " prefixes (only if every line has one).
const unnumber = (s) => { const ls = String(s ?? '').split('\n'); return ls.every((l) => !l.trim() || /^\s*\d+\s*\|/.test(l)) ? ls.map((l) => l.replace(/^\s*\d+\s*\| ?/, '')).join('\n') : String(s ?? ''); };
const tidy = (code) => String(code ?? '').replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '');
// The line a step is about: Max gives a number and the line's text; the text wins when the number is off.
function locate(code, line, text) {
  const lines = code.split('\n');
  const n = Math.min(Math.max(1, Math.round(Number(line)) || 1), lines.length);
  const t = unnumber(text || '').split('\n')[0].trim();
  if (!t || lines[n - 1].trim() === t) return n;
  let best = 0, dist = Infinity;
  lines.forEach((l, i) => { if (l.trim() === t && Math.abs(i + 1 - n) < dist) { best = i + 1; dist = Math.abs(i + 1 - n); } });
  if (!best) lines.forEach((l, i) => { if (t.length > 3 && l.includes(t) && Math.abs(i + 1 - n) < dist) { best = i + 1; dist = Math.abs(i + 1 - n); } });
  return best || n;
}
const LANG_BY_EXT = { c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', cs: 'C#', java: 'Java', kt: 'Kotlin', py: 'Python', js: 'JavaScript',
  mjs: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', swift: 'Swift', dart: 'Dart',
  scala: 'Scala', lua: 'Lua', pl: 'Perl', r: 'R', sql: 'SQL', sh: 'Bash', ps1: 'PowerShell', html: 'HTML', css: 'CSS', hs: 'Haskell' };
const langOf = (name) => LANG_BY_EXT[String(name).split('.').pop().toLowerCase()] || '';

/* ---------- Drawing ---------- */
function task(text, cls = '', label = '') {
  $('#task').hidden = !text;
  $('#task').className = 'task ' + cls;
  $('#task').innerHTML = text ? (label ? `<span class="lab">${esc(label)}</span>` : '') + rich(text) : '';
}
const btn = (label, act, cls = '', disabled = false) => `<button class="btn ${cls}" data-act="${act}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
const current = () => S.notes[S.at];

function noteHTML() {
  if (S.answer) return `<div class="note"><div class="head">MAX</div>${rich(S.answer.say)}<div class="acts">${btn('Back', 'back', 'p')}</div></div>`;
  const n = current();
  if (!n) return '';
  const last = S.at === S.notes.length - 1;
  const nav = btn('‹ Previous', 'prev', '', S.at === 0) + (last ? '' : btn('Next ›', 'next', 'p'));
  if (S.kind === 'debug') {
    const head = `<div class="head ${n.fixed ? 'ok' : 'bad'}">#${n.n} · ${esc(n.kind || 'error').toUpperCase()}${n.title ? ' · ' + esc(n.title) : ''}${n.fixed ? ' · FIXED' : ''}</div>`;
    if (S.showFix && !n.fixed) {
      const diff = n.find.split('\n').map((l) => `<div class="del">- ${esc(l)}</div>`).join('') + n.replace.split('\n').map((l) => `<div class="add">+ ${esc(l)}</div>`).join('');
      return `<div class="note">${head}The fix for #${n.n}:<div class="diff">${diff}</div><div class="ask">${n.path ? `Apply it and save ${esc(n.fileName)}?` : 'Apply it?'}</div>`
        + `<div class="acts">${btn('Cancel', 'nofix')}${btn('Apply fix', 'apply', 'p')}</div></div>`;
    }
    const fix = !n.fixed && n.find ? btn(`Fix #${n.n}`, 'fix', last ? 'p' : '') : '';
    return `<div class="note">${head}${rich(n.say)}<div class="acts">${btn('‹ Previous', 'prev', '', S.at === 0)}${fix}${last ? '' : btn('Next ›', 'next', fix ? '' : 'p')}</div></div>`;
  }
  const text = S.simple && n.simple ? n.simple : n.say;
  const vars = n.vars ? `<div class="vars">${esc(n.vars)}</div>` : '';
  const offer = last && S.offer ? `<div class="ask">Want to try an example?</div><div class="acts">${btn('‹ Previous', 'prev', '', S.at === 0)}${btn('Not now', 'nope')}${btn('Try an example', 'practice', 'p')}</div>` : `<div class="acts">${nav}</div>`;
  return `<div class="note">${S.traced ? `<div class="head">STEP ${S.at + 1} OF ${S.notes.length}</div>` : ''}${rich(text)}${vars}${offer}</div>`;
}

function render() {
  $('#what').textContent = [S.lang, S.title].filter(Boolean).join(' · ') || 'Code';
  const lessonish = S.kind === 'lesson' || S.kind === 'explain';
  $('#simple').hidden = !lessonish || S.traced || !S.notes.length;
  $('#simple').classList.toggle('on', S.simple);
  $('#trace').hidden = !lessonish || !S.files.length;
  $('#trace').classList.toggle('on', S.traced);
  $('#check').hidden = $('#hint').hidden = S.kind !== 'practice';
  // Files: only when debugging more than one.
  $('#tabs').hidden = S.files.length < 2;
  $('#tabs').innerHTML = S.files.map((f, i) => {
    const open = S.notes.filter((n) => n.fi === i && !n.fixed).length;
    return `<button data-file="${i}" class="${i === S.fi ? 'on' : ''}">${esc(f.name)}${open ? `<b>${open}</b>` : ''}</button>`;
  }).join('');
  if (S.kind === 'practice') return renderPractice();
  const f = S.files[S.fi];
  if (!f) { $('#code').innerHTML = ''; return; }
  const cur = current();
  const arrow = S.answer ? S.answer.line : cur && cur.fi === S.fi ? cur.line : 0;
  const badges = {};
  if (S.kind === 'debug') for (const n of S.notes) if (n.fi === S.fi) (badges[n.line] ||= []).push(n);
  const fix = S.kind === 'debug' && S.showFix && cur && !cur.fixed ? cur : null;
  const fixLines = fix ? new Set(Array.from({ length: fix.find.split('\n').length }, (_, i) => fix.line + i)) : new Set();
  $('#code').innerHTML = hl(f.code, S.lang).map((html, i) => {
    const no = i + 1, on = no === arrow;
    const b = (badges[no] || []).map((n) => `<b class="${n.fixed ? 'ok' : ''}">${n.fixed ? '✓' : n.n}</b>`).join('');
    const cls = ['ln', on ? 'on' : '', badges[no]?.some((n) => !n.fixed) || fixLines.has(no) ? 'bad' : ''].join(' ');
    return `<div class="${cls}" data-line="${no}"><span class="g">${b}${on ? '▶ ' : ''}${no}</span><span class="tx">${html || ' '}</span></div>`
      + (on ? noteHTML() : '');
  }).join('');
  $('#code .ln.on')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Practice: the code above and below is locked; only the middle (e.g. a loop's body) can be typed in.
function renderPractice() {
  const p = S.practice;
  const before = p.before ? hl(p.before, S.lang) : [], after = p.after ? hl(p.after, S.lang) : [];
  const bad = new Set((p.result?.mistakes || []).map((m) => m.at));
  const row = (html, no) => `<div class="ln locked${bad.has(no) ? ' bad' : ''}" data-line="${no}"><span class="g">${no}</span><span class="tx">${html || ' '}</span></div>`;
  $('#code').innerHTML = before.map((h, i) => row(h, i + 1)).join('')
    + '<div class="edit"><div class="eg"></div><div class="ew"><pre></pre><textarea spellcheck="false" autocomplete="off" aria-label="Your answer"></textarea></div></div>'
    + '<div id="after"></div><div id="result"></div>';
  const ta = $('#code textarea');
  ta.value = p.answer ?? p.blank;
  const paint = () => {
    p.answer = ta.value;
    const lines = Math.max(1, ta.value.split('\n').length);
    $('#code .edit pre').innerHTML = hl(ta.value, S.lang).join('\n') + '\n';
    $('#code .eg').innerHTML = Array.from({ length: lines }, (_, i) => before.length + i + 1).map((no) => `<div${bad.has(no) ? ' class="bad"' : ''}>${no}</div>`).join('');
    $('#after').innerHTML = after.map((h, i) => row(h, before.length + lines + i + 1)).join('');
  };
  ta.addEventListener('input', paint);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); check(); }
  });
  paint();
  const r = p.result;
  if (r) {
    const list = (r.mistakes || []).map((m) => `<li>Line ${m.at}: ${rich(m.say)}</li>`).join('');
    $('#result').innerHTML = `<div class="note"><div class="head ${r.correct ? 'ok' : 'bad'}">${r.correct ? 'CORRECT' : 'NOT QUITE'}</div>${rich(r.say)}`
      + (r.output ? `<div class="out">${esc(r.output)}</div>` : '') + (list ? `<ul>${list}</ul>` : '')
      + `<div class="acts">${r.correct ? btn('Done', 'done') + btn('Another one', 'practice', 'p') : btn('Show a hint', 'hint') + btn('Check again', 'check', 'p')}</div></div>`;
    $('#result').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else ta.focus();
}

/* ---------- Voice ---------- */
// Max says each explanation in the ElevenLabs voice (main.js); the mute button silences it.
let muted = false;
try { muted = localStorage.getItem('tutorMuted') === '1'; } catch {}
let out = null, playId = null, playing = [], nextAt = 0;
function stopVoice() {
  if (playId) window.max.cancelSpeak(playId);
  playId = null;
  playing.forEach((s) => { try { s.stop(); } catch {} });
  playing = [];
}
function say(text) {
  stopVoice();
  if (muted || !text) return;
  out ||= new AudioContext();
  out.resume();
  playId = Math.random().toString(36).slice(2);
  nextAt = 0;
  window.max.speak(playId, String(text).replace(/`/g, '')).catch(() => {});
}
window.max.onTts((d) => {
  if (d.id !== playId) return;
  const pcm = new Float32Array(d.pcm);
  const ab = out.createBuffer(1, pcm.length, d.rate);
  ab.copyToChannel(pcm, 0);
  const src = out.createBufferSource();
  src.buffer = ab; src.connect(out.destination);
  nextAt = Math.max(nextAt, out.currentTime + 0.05);
  src.start(nextAt);
  nextAt += ab.duration;
  playing.push(src);
  src.onended = () => { playing = playing.filter((s) => s !== src); };
});
function setMuted(on) {
  muted = on;
  try { localStorage.setItem('tutorMuted', on ? '1' : '0'); } catch {}
  $('#mute').classList.toggle('muted', on);
  $('#mute').title = on ? 'Unmute Max' : 'Mute Max';
  if (on) stopVoice();
}
setMuted(muted);

/* ---------- Moving through the steps ---------- */
function sayCurrent() {
  const n = current();
  if (!n) return;
  if (S.kind === 'debug') return say(`Number ${n.n}, line ${n.line}${n.fileName && S.files.length > 1 ? ` of ${n.fileName}` : ''}. ${n.say}`);
  const text = S.simple && n.simple ? n.simple : n.say;
  say(S.at === S.notes.length - 1 && S.offer ? `${text} Want to try an example?` : text);
}
function go(i) {
  if (!S.notes.length) return;
  S.at = Math.max(0, Math.min(S.notes.length - 1, i));
  S.answer = null; S.showFix = false;
  S.fi = current().fi;
  setWaiting(S.kind !== 'debug' && S.offer && S.at === S.notes.length - 1 ? 'practice' : null);
  render();
  sayCurrent();
}
function reset(kind) {
  cancelAsk(); stopVoice();
  Object.assign(S, { kind, lang: '', title: '', files: [], fi: 0, notes: [], at: 0, simple: false, traced: false, answer: null, showFix: false, practice: null, offer: false });
  setWaiting(null);
  task(null);
}
const steps = (list, code) => (Array.isArray(list) ? list : []).filter((s) => s && s.say)
  .map((s) => ({ fi: 0, line: locate(code, s.line, s.text), text: s.text, say: String(s.say), simple: s.simple && String(s.simple), vars: s.vars && String(s.vars) }));

/* ---------- Lessons ---------- */
async function lesson(topic) {
  reset('lesson');
  S.title = 'Lesson';
  render();
  const r = await askMax(`The user asked: "${topic}".
Teach it with ONE short, simple example program (5 to 15 lines) in the language they named (Python if they named none). Simple syntax gets a simple program.
Reply exactly in this shape:
{"lang":"Python","title":"for loops","code":"the whole program","steps":[{"line":3,"text":"the exact text of line 3","say":"what this line does","simple":"the same, for a complete beginner"}]}
3 to 6 steps, in order, each on the line it explains. The first step may give the big idea in one sentence.`, 'Max is writing an example');
  if (!r) return;
  S.lang = String(r.lang || ''); S.title = String(r.title || topic);
  S.files = [{ name: 'example', code: tidy(r.code) }];
  S.notes = steps(r.steps, S.files[0].code).sort((a, b) => a.line - b.line);   // top to bottom, whatever order Max sent
  S.offer = true;
  if (!S.notes.length) return task("Max didn't send any steps. Ask again?", 'bad');
  go(0);
}
// Explaining a program you dropped or pasted.
async function explain(file) {
  reset('explain');
  S.files = [file]; S.lang = langOf(file.name); S.title = file.name;
  render();
  const r = await askMax(`Explain this program to a student, top to bottom, focusing on the important parts.
${S.lang ? `Language: ${S.lang}.` : 'Say which language it is.'}
Code (with line numbers):
${numbered(file.code)}
Reply exactly in this shape:
{"lang":"C","title":"what the program does, in 2 to 5 words","steps":[{"line":1,"text":"the exact text of that line","say":"what it does","simple":"the same, for a complete beginner"}]}
3 to 10 steps, in order.`, 'Max is reading your code');
  if (!r) return;
  S.lang ||= String(r.lang || ''); S.title = r.title ? `${file.name} · ${r.title}` : file.name;
  S.notes = steps(r.steps, file.code).sort((a, b) => a.line - b.line);
  S.offer = true;
  go(0);
}
async function trace() {
  if (S.kind !== 'lesson' && S.kind !== 'explain') return;
  if (S.traced) { S.traced = false; S.notes = S.saved; return go(0); }
  const code = S.files[0].code;
  const r = await askMax(`Trace this ${S.lang} program line by line as it runs, like a debugger stepping through it (at most 20 steps; for long loops show the first rounds, then say how it continues).
Code (with line numbers):
${numbered(code)}
Reply exactly in this shape:
{"steps":[{"line":1,"text":"the exact text of that line","say":"what happens on this line right now","vars":"the variables after it, like i = 0, total = 3"}]}`, 'Max is tracing it line by line');
  if (!r) return;
  S.saved = S.notes;
  S.notes = steps(r.steps, code);
  S.traced = true;
  go(0);
}

/* ---------- Practice ---------- */
async function practice() {
  const topic = S.title, lang = S.lang || 'Python', example = S.files[0]?.code || '';
  setWaiting(null);
  const r = await askMax(`Write one simple practice exercise on "${topic}" in ${lang}, for a student who just saw this example:
${example}
The student fills in ONLY the part being practised (for example just the loop body); everything else is given. Keep it small: simple syntax gets a simple program.
Reply exactly in this shape:
{"question":"what to do and what the program should print, in one or two sentences","before":"the code above the part they write","blank":"what's in the editable part at the start: one comment line saying what to do, never the code itself","after":"the code below it","hint":"one helpful hint that doesn't give the answer away"}`, 'Max is making an exercise');
  if (!r) return;
  cancelAsk();
  S.kind = 'practice'; S.lang = lang; S.notes = []; S.answer = null;
  S.practice = { question: String(r.question || ''), before: tidy(r.before), blank: String(r.blank ?? '').replace(/^\n+|\s+$/g, ''), after: tidy(r.after), hint: String(r.hint || ''), answer: null, result: null };
  task(S.practice.question, '', 'PRACTICE');
  render();
  say(`${S.practice.question} Type your answer in the highlighted part, then say check my answer.`);
}
async function check() {
  const p = S.practice;
  if (!p) return;
  const parts = [p.before, p.answer ?? p.blank, p.after].filter((x) => x !== '');
  const program = parts.join('\n');
  const from = p.before ? p.before.split('\n').length + 1 : 1, to = from + (p.answer ?? p.blank).split('\n').length - 1;
  const r = await askMax(`Exercise: ${p.question}
The student's program (${S.lang}); lines ${from} to ${to} are what they wrote:
${numbered(program)}
Don't run it: work through it carefully in your head, like the computer would, and check it does what the exercise asks.
Reply exactly in this shape:
{"correct":true,"output":"what it prints, or the error it stops with","say":"your verdict in one or two sentences, without writing the answer for them","mistakes":[{"line":5,"text":"the exact text of that line","say":"what's wrong there and how to think about fixing it, without giving the whole answer"}]}`, 'Max is checking your answer');
  task(p.question, '', 'PRACTICE');
  if (!r) return;
  p.result = { correct: !!r.correct, output: String(r.output || ''), say: String(r.say || ''),
    mistakes: (r.mistakes || []).filter((m) => m?.say).map((m) => ({ at: locate(program, m.line, m.text), say: String(m.say) })) };
  renderPractice();
  say(p.result.say + (p.result.correct ? ' Want another one?' : ''));
  setWaiting(p.result.correct ? 'practice' : null);
}
function hint() { if (S.practice?.hint) { task(`${S.practice.question}\nHint: ${S.practice.hint}`, '', 'PRACTICE'); say(S.practice.hint); } }

/* ---------- Debugging ---------- */
async function debug(files, { editor, dirty } = {}) {
  reset('debug');
  S.files = files.map((f) => ({ ...f, code: f.code.replace(/\r\n/g, '\n') }));
  S.lang = langOf(files[0].name); S.title = files[0].name;
  render();
  const listing = S.files.map((f) => `=== ${f.name} ===\n${numbered(f.code)}`).join('\n\n');
  const r = await askMax(`Debug this code. Find every real problem: syntax errors, runtime errors (crashes, out-of-bounds, null or uninitialised use, infinite loops, wrong types) and logic errors (it doesn't do what it's clearly meant to). Don't run anything: trace it in your head. No style nitpicks.
${S.files.length > 1 ? `These files belong together; the first is the one open in the editor.` : ''}
${listing}
Reply exactly in this shape:
{"lang":"C","summary":"one sentence overall","errors":[{"file":"main.c","line":12,"text":"the exact text of that line","kind":"syntax","title":"two to five words","say":"what's wrong and why, in plain words","find":"the exact line or lines to replace, copied from the file without line numbers","replace":"the corrected line or lines"}]}
kind is syntax, runtime or logic. Order errors by file, then line. If there are none, errors is [].`, `Max is debugging ${S.files.length > 1 ? `${S.files.length} files` : files[0].name}`);
  if (!r) return;
  const unsaved = dirty ? ` (${files[0].name} has unsaved changes in ${editor || 'your editor'}: I read the saved version.)` : '';
  S.lang ||= String(r.lang || '');
  S.notes = (r.errors || []).filter((e) => e?.say).map((e) => {
    const fi = Math.max(0, S.files.findIndex((f) => f.name === e.file));
    const f = S.files[fi];
    return { fi, line: locate(f.code, e.line, e.text), text: e.text, say: String(e.say), kind: String(e.kind || 'error'), title: String(e.title || ''),
      find: unnumber(e.find).replace(/\r\n/g, '\n'), replace: unnumber(e.replace ?? '').replace(/\r\n/g, '\n'), path: f.path, fileName: f.name };
  }).map((n, i) => ({ ...n, n: i + 1 }));
  for (const n of S.notes) if (n.find && !S.files[n.fi].code.includes(n.find)) n.find = '';   // can't place it: no Fix button
  if (!S.notes.length) {
    task((r.summary || 'No problems found.') + unsaved, '', 'ALL CLEAR');
    render();
    return say(String(r.summary || "I couldn't find any problems in it."));
  }
  task(`${S.notes.length} problem${S.notes.length > 1 ? 's' : ''}: ${r.summary || ''}`.trim() + unsaved, 'bad', 'DEBUG');
  S.at = 0; S.fi = S.notes[0].fi;
  render();
  say(`I found ${S.notes.length === 1 ? 'one problem' : `${S.notes.length} problems`}. Number 1, line ${S.notes[0].line}. ${S.notes[0].say}`);
}
function showFix(n) {
  const i = S.notes.findIndex((x) => x.n === n);
  if (S.kind !== 'debug' || i < 0) return say(S.kind === 'debug' ? `There's no error number ${n}.` : '');
  S.at = i; S.fi = S.notes[i].fi; S.answer = null;
  const note = S.notes[i];
  if (note.fixed) { render(); return say(`Number ${n} is already fixed.`); }
  if (!note.find) { render(); return say(`I can't pin down the exact code for number ${n}, so fix it by hand: ${note.say}`); }
  S.showFix = true;
  setWaiting('fix');
  render();
  say(`Here's the fix for number ${n}. Should I apply it?`);
}
async function applyFix() {
  const n = current();
  if (!n || !S.showFix) return;
  const f = S.files[n.fi];
  try {
    if (f.path) f.code = await window.max.tutorSave({ file: f.path, find: n.find, replace: n.replace });
    else f.code = f.code.replace(n.find, () => n.replace);
  } catch (e) {
    S.showFix = false; setWaiting(null); render();
    return say(String(e.message).replace(/^Error invoking remote method '\w+': (Error: )?/, ''));
  }
  n.fixed = true; S.showFix = false;
  setWaiting(null);
  // The other errors' lines may have moved: find them again by their text.
  for (const o of S.notes) if (o !== n && o.fi === n.fi) o.line = locate(f.code, o.line + (o.line > n.line ? n.replace.split('\n').length - n.find.split('\n').length : 0), o.text);
  n.line = locate(f.code, n.line, n.replace.split('\n')[0]);
  render();
  const left = S.notes.filter((x) => !x.fixed).length;
  say(`Done${f.path ? `, saved to ${f.name}` : ''}.${left ? ` ${left} to go.` : ' That was the last one.'}`);
}

/* ---------- Questions ---------- */
async function question(q) {
  if (!q.trim()) return;
  const f = S.kind === 'practice' ? null : S.files[S.fi];
  const code = S.kind === 'practice' ? [S.practice.before, S.practice.answer ?? S.practice.blank, S.practice.after].filter(Boolean).join('\n') : f?.code || '';
  const n = current();
  const r = await askMax(`${code ? `The ${S.lang || ''} code on screen (with line numbers):\n${numbered(code)}\n` : ''}${S.practice ? `The exercise: ${S.practice.question}\n` : ''}${n && !S.practice ? `Max's note on screen, at line ${n.line}: ${n.say}\n` : ''}
The student asks: "${q}"
Answer it like a patient tutor. If the question is about a coding topic not on screen, still answer it briefly.
Reply exactly in this shape:
{"say":"your answer, at most three short sentences","line":4,"text":"the exact text of the line your answer is about, or empty"}`, 'Max is thinking');
  if (!r) return;
  if (S.kind === 'practice') { task(`${S.practice.question}\n${r.say}`, '', 'PRACTICE'); return say(String(r.say || '')); }
  S.answer = { line: code ? locate(code, r.line || n?.line || 1, r.text) : 0, say: String(r.say || '') };
  if (!code) task(S.answer.say);
  render();
  say(S.answer.say);
}

/* ---------- Dropping or pasting a program ---------- */
let dropThen = 'explain';
function showDrop(then, note) {
  reset(null);
  dropThen = then;
  $('#dropTitle').textContent = note || 'Drop the file here, or paste the program';
  $('#dropExplain').className = 'btn' + (then === 'explain' ? ' p' : '');
  $('#dropDebug').className = 'btn' + (then === 'debug' ? ' p' : '');
  $('#paste').value = '';
  $('#drop').hidden = false;
  render();
  $('#paste').focus();
}
function fromDrop(file, how) {
  $('#drop').hidden = true;
  (how === 'debug' ? debug([file]) : explain(file));
}
$('#dropCancel').onclick = () => { $('#drop').hidden = true; };
for (const [id, how] of [['#dropExplain', 'explain'], ['#dropDebug', 'debug']]) {
  $(id).onclick = () => {
    const code = tidy($('#paste').value);
    if (!code) { $('#dropTitle').textContent = 'Paste a program first, or drop a file here'; return $('#paste').focus(); }
    fromDrop({ name: 'pasted code', code }, how);
  };
}
const box = $('#dropbox');
box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('over'); });
box.addEventListener('dragleave', () => box.classList.remove('over'));
box.addEventListener('drop', async (e) => {
  e.preventDefault();
  box.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  try { fromDrop(await window.max.tutorRead(window.max.filePath(file)), dropThen); }
  catch (err) { $('#dropTitle').textContent = String(err.message).replace(/^Error invoking remote method '\w+': (Error: )?/, ''); }
});
// Dropping anywhere else in the window shouldn't open the file in it.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

/* ---------- Controls ---------- */
function act(a) {
  if (a === 'next') return go(S.at + 1);
  if (a === 'prev') return go(S.at - 1);
  if (a === 'back') { S.answer = null; return render(); }
  if (a === 'practice') return practice();
  if (a === 'nope' || a === 'done') { setWaiting(null); stopVoice(); return say('Okay. Ask me anything else about it.'); }
  if (a === 'fix') return showFix(current()?.n);
  if (a === 'apply') return applyFix();
  if (a === 'nofix') { S.showFix = false; setWaiting(null); render(); return say('Okay, I left it.'); }
  if (a === 'check') return check();
  if (a === 'hint') return hint();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) act(b.dataset.act);
  const tab = e.target.closest('[data-file]');
  if (tab) { S.fi = Number(tab.dataset.file); S.answer = null; render(); }
});
$('#simple').onclick = () => { S.simple = !S.simple; render(); sayCurrent(); };
$('#trace').onclick = () => trace();
$('#check').onclick = () => check();
$('#hint').onclick = () => hint();
$('#mute').onclick = () => setMuted(!muted);
$('#pin').onclick = async () => $('#pin').classList.toggle('on', await window.max.tutorWin('pin'));
$('#close').onclick = () => { stopVoice(); cancelAsk(); window.max.tutorWin('close'); };
$('#q').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = $('#q').value;
  $('#q').value = '';
  question(q);
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.key === 'ArrowRight') go(S.at + 1);
  if (e.key === 'ArrowLeft') go(S.at - 1);
  if (e.key === 'Escape') $('#drop').hidden = true;
});

// Jobs and spoken commands from main.js.
window.max.onTutor((job) => {
  if (job.kind === 'learn') return lesson(job.topic);
  if (job.kind === 'debug') return debug(job.files, job);
  if (job.kind === 'drop') return showDrop(job.then, job.note);
  if (job.kind !== 'cmd') return;
  const c = job.cmd;
  if (c === 'next' || c === 'prev') return act(c);
  if (c === 'simple') { S.simple = true; render(); return sayCurrent(); }
  if (c === 'trace') return trace();
  if (c === 'fix') return showFix(job.n);
  if (c === 'yes') return S.waiting === 'fix' ? applyFix() : practice();
  if (c === 'no') return act(S.waiting === 'fix' ? 'nofix' : 'nope');
  if (c === 'mute' || c === 'unmute') return setMuted(c === 'mute');
  if (c === 'check') return check();
  if (c === 'hint') return hint();
  if (c === 'practice') return practice();
  if (c === 'ask') return question(job.text);
});
render();
