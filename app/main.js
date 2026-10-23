// Max desktop: a HUD window over Max on the home server. Everything goes over SSH (key auth, no
// passwords): an SSH tunnel to Max's API for chat, and `openshell sandbox exec` to read/update the
// workspace files (leads, todos, business profiles). Nothing secret is stored by the app.
'use strict';
const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, Tray, Menu, nativeImage, Notification } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Your server's SSH login (key auth): MAX_HOST, else server.txt in the app's data folder, written on first run.
const SERVER_FILE = path.join(app.getPath('userData'), 'server.txt');
const HOST = process.env.MAX_HOST || (() => { try { return fs.readFileSync(SERVER_FILE, 'utf8').split('\n')[0].trim(); } catch { return ''; } })();
// The owner's settings: max.config on the server (name, time zone, currency, sandbox name), read once over SSH.
let CFG = { SANDBOX: 'max', TIMEZONE: 'UTC' };
let cfgReady = null;
function serverConfig() {
  cfgReady ||= run(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, 'cat ~/max-assistant/max.config'], 20000).then((out) => {
    for (const m of out.matchAll(/^([A-Z_]+)=(?:"([^"]*)"|'([^']*)'|(\S*))/gm)) CFG[m[1]] = m[2] ?? m[3] ?? m[4];
    NAMES = [...(CFG.OWNER_NAME || '').split(' '), CFG.CITY || '', ...EXTRA_NAMES].filter((n) => n.length >= 3);
    // VOICE_FIXES "Right Name=heard as|heard as; ...": each phrase matches with any spaces or dashes between its words.
    const words = (p) => p.trim().toLowerCase().split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]*');
    PHRASES = (CFG.VOICE_FIXES || '').split(';').map((e) => e.split(/=(.*)/s)).filter(([n, alts]) => n?.trim() && alts)
      .map(([n, alts]) => [new RegExp(`\\b(?:${[n, ...alts.split('|')].filter((a) => a.trim()).map(words).join('|')})\\b`, 'gi'), n.trim()]);
    // SITES "name=address; ...": more "open ..." shortcuts for the PC commands.
    pcCommands.addSites(Object.fromEntries((CFG.SITES || '').split(';').map((e) => e.split(/=(.*)/s)).filter(([n, u]) => n?.trim() && /^https?:\/\//.test(u?.trim() || ''))
      .map(([n, u]) => [n.trim().toLowerCase(), u.trim()])));
  }).catch((e) => { cfgReady = null; throw e; });
  return cfgReady;
}
const owner = () => (CFG.OWNER_NAME || '').split(' ')[0];
// Speech models get a share of the CPU sized to this machine, so a 4-core laptop isn't swamped and a
// 16-core one isn't wasted: Whisper 2-4 threads, the voice 2-8.
const CORES = require('os').availableParallelism?.() || require('os').cpus().length;
const clampThreads = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(n)));
const WHISPER_THREADS = clampThreads(CORES / 4, 2, 4), VOICE_THREADS = clampThreads(CORES / 2, 2, 8);
const PORT = 18642;   // shared with the WhatsApp extension's tunnel: if one is already open, reuse it
const API = `http://127.0.0.1:${PORT}`;
let token = '';
let tunnel = null;
let win = null;

// Run a shell snippet inside Max's sandbox. Base64 keeps quoting out of ssh -> openshell -> sh. Straight through
// OpenShell (~20 ms) rather than `nemohermes max exec` (~1.8 s of Node start-up plus a host-wide lock that queues
// every call behind the others); the proxy env file is what nemohermes would load first.
async function sandbox(script, timeoutMs = 60000) {
  await serverConfig();
  const b64 = Buffer.from(script).toString('base64');
  const remote = `export PATH=$HOME/.local/bin:$PATH; openshell sandbox exec --name ${CFG.SANDBOX} -g nemoclaw --no-tty -- /bin/sh -c '. /tmp/nemoclaw-proxy-env.sh; export TZ=${CFG.TIMEZONE}; cd; echo ${b64} | base64 -d | sh' 2>/dev/null`;
  return run(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, remote], timeoutMs);
}

function run(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn('ssh', args, { windowsHide: true });
    p.stdin.end();   // nothing to send; openshell on the far side waits for stdin to close
    let out = '', err = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('the server took too long to answer')); }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').pop() || `ssh exited ${code}`));
    });
  });
}

async function apiAlive() {
  try {
    const r = await fetch(`${API}/v1/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000) });
    return r.status;
  } catch { return 0; }
}

// The dashboard and the hologram connect at the same time at startup: share one attempt.
let connecting = null;
function connect() {
  connecting ||= connectOnce().finally(() => { connecting = null; });
  return connecting;
}
async function connectOnce() {
  if (!HOST) throw new Error(`no server set: put your SSH login (like you@192.168.1.50) in ${SERVER_FILE}`);
  await serverConfig();
  if (!token) {
    const out = await run(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST,
      `export PATH=$HOME/.local/bin:$PATH; nemohermes ${CFG.SANDBOX} gateway-token --quiet 2>/dev/null | tail -1`], 90000);   // usually 2-4 s, but 25 s+ while nemohermes waits on its host-wide lock
    token = out.trim();
    if (token.length < 20) { token = ''; throw new Error("couldn't get Max's token from the server"); }
  }
  if (await apiAlive() === 200) return { ok: true };
  if (!tunnel || tunnel.exitCode !== null) {
    tunnel = spawn('ssh', ['-N', '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes',
      '-L', `${PORT}:127.0.0.1:8642`, HOST], { windowsHide: true });
    tunnel.on('exit', () => { tunnel = null; });
  }
  const waitAlive = async (tries, ms) => {
    for (let i = 0; i < tries; i++) {
      if (await apiAlive() === 200) return true;
      await new Promise((r) => setTimeout(r, ms));
    }
    return false;
  };
  if (await waitAlive(20, 500)) return { ok: true };
  // The server answers but Max's API port is down (happens after some restarts): run NemoClaw's
  // recover, which restores it. recover itself can hang after doing its job, hence the timeout.
  const port = await run(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST,
    'curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:8642/v1/models'], 20000).catch(() => '');
  if (port.trim() === '000') {
    run(['-o', 'BatchMode=yes', HOST, `export PATH=$HOME/.local/bin:$PATH; timeout 180 nemohermes ${CFG.SANDBOX} recover >/dev/null 2>&1`], 200000).catch(() => {});
    if (await waitAlive(60, 3000)) return { ok: true };
    throw new Error("Max's connection on the server was down; a repair was started. Try again in a minute.");
  }
  throw new Error("couldn't open the tunnel to Max");
}

// One read of everything the dashboard shows. Sections are split on @@ markers.
const READ = `
B=~/.hermes/workspace/business
echo "@@LEADS"; cat $B/leads.tsv 2>/dev/null
echo "@@TODOS"; grep -F -- '- [ ]' ~/.hermes/workspace/notes/todos.md 2>/dev/null
echo "@@TODAY"; date +%F
echo "@@CAL"; cat ~/.hermes/workspace/calendar.tsv 2>/dev/null
echo "@@SHIELD"; tail -n 60 ~/.hermes/workspace/shield.tsv 2>/dev/null
echo "@@DESK"; cat $B/desk_state.json 2>/dev/null; echo
for d in $B/*/; do s=$(basename "$d"); case $s in clients|docs) continue;; esac   # quote PDFs live in docs/
  echo "@@BIZ $s"; cat "$d/profile.md" 2>/dev/null
  echo "@@POLICY"; cat "$d/policy.tsv" 2>/dev/null
  echo "@@NEVER"; cat "$d/never.md" 2>/dev/null
done
echo "@@END"`;

function parse(out) {
  const data = { leads: [], todos: [], today: '', businesses: [], events: [], shield: [], desk: {} };
  let section = null, biz = null;
  for (const line of out.split('\n')) {
    const m = /^@@(\w+)\s*(.*)$/.exec(line);
    if (m) {
      section = m[1];
      if (section === 'BIZ') { biz = { slug: m[2].trim(), profile: '', policy: [], policyNotes: [], never: '' }; data.businesses.push(biz); section = 'PROFILE'; }
      continue;
    }
    if (section === 'LEADS' && line.trim() && !line.startsWith('id\t')) {
      const [id, created, updated, business, contact, channel, status, value, next, need] = line.split('\t');
      data.leads.push({ id, created, updated, business, contact, channel, status, value: Number(value) || 0, next, need });
    } else if (section === 'TODOS' && line.trim()) data.todos.push(line.replace(/^- \[ \]\s*/, ''));
    else if (section === 'TODAY' && line.trim()) data.today = line.trim();
    else if (section === 'CAL' && line.trim() && !line.startsWith('id	')) {
      const [id, date, start, end, title] = line.split('	');
      data.events.push({ id, date, start, end, title });
    }
    else if (section === 'SHIELD' && line.trim()) {
      const [at, kind, who, detail] = line.split('\t');
      data.shield.push({ at, kind, who, detail });
    }
    else if (section === 'DESK' && line.trim().startsWith('{')) { try { data.desk = JSON.parse(line); } catch {} }
    else if (section === 'PROFILE' && biz) biz.profile += line + '\n';
    else if (section === 'POLICY' && biz && line.startsWith('#')) biz.policyNotes.push(line);   // kept when the survey rewrites the file
    else if (section === 'POLICY' && biz && line.trim()) {
      const [product, unit, list, floor, minQty, lead, target] = line.split('\t');
      biz.policy.push({ product, unit, list: Number(list), floor: Number(floor), minQty, lead, target: target ? Number(target) : null });
    } else if (section === 'NEVER' && biz) biz.never += line + '\n';
  }
  return data;
}

// Owner actions on a lead. These run from the owner's side, so "approve" may set a deal the
// AI's deal_check would refuse (that's the point of escalating it to the owner).
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
async function leadAction({ id, action, value, negotiable, firm }) {
  if (!/^L\d{4}$/.test(id || '')) throw new Error('bad lead id');
  if (action === 'price') {
    // The owner's price for an escalated offer: the front desk records it (firm, or how far Max may still come
    // down) and words a message to the client, which the WhatsApp extension pastes into their chat.
    const p = Math.round(Number(value)), n = Math.round(Number(negotiable) || 0);
    if (!(p > 0)) throw new Error('enter your price');
    if (!firm && (n < 0 || n >= p)) throw new Error('"can drop by" must be less than the price');
    const out = await sandbox(`python3 ~/.hermes/scripts/desk.py --owner ${id} ${p} ${firm ? '--firm' : `--negotiable ${n}`}`, 180000);
    const line = String(out).split('\n').reverse().find((l) => l.trim().startsWith('{'));
    const r = line ? JSON.parse(line) : { ok: false, error: 'no answer from the front desk' };
    if (!r.ok) throw new Error(r.error);
    return r;
  }
  const set = {
    approve: ['agreed', value], decline: ['lost', ''], paid: ['paid', ''], snooze: ['', ''],
  }[action];
  if (!set) throw new Error('unknown action');
  if (action === 'approve' && !(Number(value) > 0)) throw new Error('enter the agreed amount');
  return sandbox(`
L=~/.hermes/workspace/business/leads.tsv
d=$(date +%F); n=$(date -d '+2 days' +%F)
awk -F'\\t' -v OFS='\\t' -v id=${shq(id)} -v st=${shq(set[0])} -v val=${shq(set[1] || '')} -v d="$d" -v n="$n" -v act=${shq(action)} '
  $1 == id { if (st != "") $7 = st; if (val != "") $8 = val; if (act == "snooze") $9 = n; $3 = d } { print }' "$L" > "$L.tmp" && mv "$L.tmp" "$L"
echo ok`);
}

// Greetings and small talk ("hi", "thanks max") get an instant answer; see quick.js.
function quickReply(messages) {
  return instant.smallTalk(messages.filter((x) => x.role === 'user').pop()?.content, owner());
}

// YouTube commands ("pause", "next video", "search mr beast", "play the third video") run straight on the
// laptop through its helper (see youtube.js), no round trip to Max.
const youtube = require('./youtube');
const instant = require('./quick');   // small talk, list, calendar, follow-ups, leads and "brief me" straight from the data (shared with the phone)
const pcCommands = require('./pc');   // time, battery, volume, apps, windows... answered without Max
async function laptopHands(p, body) {
  const r = await fetch('http://127.0.0.1:18700' + p, { method: 'POST', body: JSON.stringify(body),
    headers: { 'X-Max-Token': fs.readFileSync(HANDS_TOKEN, 'utf8').trim(), 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`the laptop helper said ${r.status}`);
  return r.json();
}
async function quickAction(messages) {
  const quick = quickReply(messages);
  if (quick) return quick;
  const last = messages.filter((m) => m.role === 'user').pop();
  const want = instant.intent(last?.content);
  if (want) {
    const [data, orders] = await Promise.all([sandbox(READ).then(parse),
      want.kind === 'brief' ? sandbox(instant.ORDERS).then(instant.parseOrders).catch(() => []) : []]);
    const said = instant.answer(want, data, { owner: owner(), orders });
    if (said) return said;
  }
  // A misheard name at the start ("Matt, open Zen") is still Max: drop it so the commands match.
  const said = String(last?.content || '').replace(/^🎙\s*/, '').replace(new RegExp(`^\\W*((hey|hi|ok|okay|yo)\\W+)?${NAME}\\b\\W*`, 'i'), '');
  const pcCmd = pcCommands.parse(said);
  if (pcCmd) {
    const showDashboard = () => { if (!win) createMainWindow(); win.show(); win.focus(); };
    const notify = (title, body) => new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
    try { return await pcCommands.run(pcCmd, { hands: laptopHands, sandbox, notify, showDashboard }); } catch (e) { return `That didn't work: ${e.message}`; }
  }
  const cmd = youtube.parse(said);
  if (!cmd) return null;
  try { return await youtube.run(cmd, { hands: laptopHands, sandbox }); } catch (e) { return `That didn't work: ${e.message}`; }
}

async function chat(messages) {
  const quick = await quickAction(messages);
  if (quick) return quick;
  await connect();
  const r = await fetch(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: 'hermes-agent', messages: messages.slice(-20) }),
    signal: AbortSignal.timeout(6 * 60000),
  });
  if (!r.ok) throw new Error(`Max answered ${r.status}`);
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || '';
}

// Streaming chat: Max's live tool progress ("terminal: ls ...") and the answer as it's written, sent
// to the asking window as 'stream' events. Resolves with the full answer.
const inflightChats = new Map();   // id -> AbortController, so voice mode can cancel a question
async function chatStream(sender, id, messages) {
  const quick = await quickAction(messages);
  if (quick) return quick;
  await connect();
  const ctrl = new AbortController();
  inflightChats.set(id, ctrl);
  try { return await streamChat(sender, id, messages, ctrl.signal); } finally { inflightChats.delete(id); }
}
async function streamChat(sender, id, messages, cancel) {
  const r = await fetch(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: messages.slice(-20) }),
    signal: AbortSignal.any([cancel, AbortSignal.timeout(6 * 60000)]),
  });
  if (!r.ok) throw new Error(`Max answered ${r.status}`);
  const emit = (d) => { if (!sender.isDestroyed()) sender.send('stream', { id, ...d }); };
  const decoder = new TextDecoder();
  let buf = '', text = '';
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const event = (/^event: *(.*)$/m.exec(block) || [])[1] || 'message';
      const raw = (/^data: *(.*)$/m.exec(block) || [])[1];
      if (!raw || raw === '[DONE]') continue;
      let d; try { d = JSON.parse(raw); } catch { continue; }
      if (event === 'hermes.tool.progress') emit({ kind: 'tool', tool: d.tool, label: d.label || '', status: d.status, callId: d.toolCallId });
      else {
        // Hermes reports a failed turn (e.g. the model provider refused) inside the stream: surface it.
        if (d?.hermes?.failed) throw new Error(`Max hit an error: ${String(d.hermes.error || 'unknown').slice(0, 160)}`);
        const delta = d?.choices?.[0]?.delta?.content;
        if (delta) { text += delta; emit({ kind: 'delta', text: delta }); }
      }
    }
  }
  return text;
}

// Speech-to-text runs here on the laptop (Whisper base.en, ~80 MB, cached after the first run), so
// the owner's voice never leaves the machine. Loaded once, in the background, at startup.
let asrP = null;
function asr() {
  asrP ||= import('@huggingface/transformers').then(({ pipeline, env }) => {
    env.cacheDir = path.join(app.getPath('userData'), 'models');
    // Capped threads: uncapped, Whisper grabs every core and the whole PC (and the core's rings) stutters.
    // No memory arena: saves ~250 MB for ~10% slower transcription (measured).
    return pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en',
      { dtype: 'q8', session_options: { intraOpNumThreads: WHISPER_THREADS, interOpNumThreads: 1, enableCpuMemArena: false } });
  });
  return asrP;
}
async function transcribe(buffer) {
  const audio = new Float32Array(buffer);
  if (audio.length < 16000 * 0.4) return '';
  // no_repeat_ngram_size stops Whisper looping ("E-R-L-E-R-L-..."), a known failure on spelled letters.
  const out = await (await asr())(audio, { no_repeat_ngram_size: 3, max_new_tokens: 160 });
  const text = fixNames(String(out?.text || '').trim());
  // Whisper's usual noises for silence or background sound.
  return /^(\[.*\]|\(.*\)|you\.?|thank you\.?|thanks for watching!?|\.+)$/i.test(text) ? '' : text;
}

// Names the small Whisper model has never heard come out as near-misses ("Mihal", "Nehal", "M I H A L").
// Spelled letters are joined back into a word, then any word one letter away from a known name becomes
// that name: yours and your city from max.config, plus MAX_NAMES (comma separated).
const EXTRA_NAMES = (process.env.MAX_NAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
let NAMES = EXTRA_NAMES;
let PHRASES = [];   // [regex, name] from VOICE_FIXES: multi-word names Whisper splits into common words
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function fixNames(text) {
  for (const [re, name] of PHRASES) text = text.replace(re, name);
  text = text.replace(/\b[A-Za-z](?:[\s.-]+[A-Za-z]\b){2,}/g, (m) => m.replace(/[\s.-]+/g, ''));   // "A L E X" -> "ALEX"
  return text.replace(/\b[A-Za-z]{4,}\b/g, (w) => {
    const hit = NAMES.find((n) => w.toLowerCase() !== n.toLowerCase() && editDistance(w.toLowerCase(), n.toLowerCase()) <= (n.length >= 8 ? 2 : 1));
    return hit || (NAMES.find((n) => n.toLowerCase() === w.toLowerCase()) ?? w);
  });
}

// Text-to-speech also runs locally: Kokoro (82M, neural), British "George" voice. A reply is spoken
// sentence by sentence: each sentence is sent to the window as soon as it's generated, so playback
// starts ~3 s after the answer while the rest is still being made.
const VOICE = process.env.MAX_VOICE || 'bm_george';
// Built from its parts (through kokoro-js's own copy of transformers, so its tensors match) to turn off the
// memory arena and cap threads: ~190 MB less, about as fast (measured). Unloaded after 10 idle minutes.
let ttsP = null, ttsUsed = 0;
function tts() {
  ttsUsed = Date.now();
  ttsP ||= (async () => {
    const { KokoroTTS } = await import('kokoro-js');
    const T = await import(require('url').pathToFileURL(path.join(path.dirname(require.resolve('kokoro-js')), '..', 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs')).href);
    T.env.cacheDir = path.join(app.getPath('userData'), 'models');
    const id = 'onnx-community/Kokoro-82M-v1.0-ONNX';
    const model = await T.StyleTextToSpeech2Model.from_pretrained(id,
      { dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: VOICE_THREADS, interOpNumThreads: 1, enableCpuMemArena: false } });
    return new KokoroTTS(model, await T.AutoTokenizer.from_pretrained(id));
  })();
  return ttsP;
}
setInterval(async () => {
  if (!ttsP || Date.now() - ttsUsed < 10 * 60000) return;
  const p = ttsP; ttsP = null;
  (await p.catch(() => null))?.model?.dispose?.();
}, 60000);
// The ElevenLabs voice, when max.config on the server has ELEVENLABS_API_KEY (read with the rest of CFG). The text
// Max says goes to ElevenLabs to be spoken; Kokoro above stays the fallback (no key, offline, out of credits).
// Raw 24 kHz PCM comes back, turned into the same float samples Kokoro gives, so voice mode plays both alike.
let eleven = null;
// How fast the voice talks (0.7 to 1.2), set in either app's Settings. It lives on the server next to the phone API
// (~/.config/max-phone/voice-speed), so calls and the desktop always agree. Read once, then kept here.
let SPEED = null;
const SPEED_FILE = '~/.config/max-phone/voice-speed';
async function voiceSpeed(set) {
  if (set !== undefined) {
    const v = Math.round(Number(set) * 100) / 100;
    if (!(v >= 0.7 && v <= 1.2)) throw new Error('Speed goes from 0.7 to 1.2');
    await run(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, `mkdir -p ~/.config/max-phone && printf %s ${v} > ${SPEED_FILE}`], 15000);
    return (SPEED = v);
  }
  SPEED ??= Number((await run(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, `cat ${SPEED_FILE} 2>/dev/null; true`], 15000)).trim())
    || Number(CFG.ELEVENLABS_SPEED) || 1;
  return SPEED;
}
ipcMain.handle('voiceSpeed', (_e, set) => voiceSpeed(set));
async function elevenSpeech(text) {
  eleven ||= import('@elevenlabs/elevenlabs-js').then(({ ElevenLabsClient }) => new ElevenLabsClient({ apiKey: CFG.ELEVENLABS_API_KEY }));
  const stream = await (await eleven).textToSpeech.convert(CFG.ELEVENLABS_VOICE || 'q1OMOTZNtqpS50TIQtu4',
    { text, modelId: CFG.ELEVENLABS_MODEL || 'eleven_flash_v2_5', outputFormat: 'pcm_24000', voiceSettings: { speed: await voiceSpeed().catch(() => 1) } });
  const bytes = Buffer.from(await new Response(stream).arrayBuffer());
  const audio = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < audio.length; i++) audio[i] = bytes.readInt16LE(i * 2) / 32768;
  return { audio, sampling_rate: 24000 };
}

const cancelled = new Set();
async function speak(sender, id, text) {
  await serverConfig().catch(() => {});   // the key lives in the server's max.config; offline, Kokoro speaks
  let useEleven = !!CFG.ELEVENLABS_API_KEY;
  // Whole answer in one go: per-sentence generation made Max stop and start, because each piece took
  // about as long to make as to say, and lost the flow between sentences. Only long answers are split,
  // into ~350-character paragraphs at sentence ends.
  const chunks = [];
  for (const s of String(text).match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || []) {
    if (chunks.length && (chunks[chunks.length - 1] + s).length <= 350) chunks[chunks.length - 1] += s;
    else chunks.push(s);
  }
  for (let i = 0; i < chunks.length; i++) {
    if (cancelled.has(id) || sender.isDestroyed()) break;
    let out = null;
    if (useEleven) out = await elevenSpeech(chunks[i].trim()).catch((e) => { console.error('ElevenLabs:', e.message); useEleven = false; return null; });
    out ||= await (await tts()).generate(chunks[i].trim(), { voice: VOICE });
    if (cancelled.has(id) || sender.isDestroyed()) break;
    sender.send('tts', { id, rate: out.sampling_rate, pcm: out.audio.buffer.slice(0), last: i === chunks.length - 1 });
  }
  cancelled.delete(id);
}

// Voice mode: a transparent, always-on-top window with the holographic core. Full screen it covers the work
// area except a 1 px strip at the top; tucked away it shrinks to the bottom-left corner. Both matter: Windows
// tells Chrome/Brave/Electron windows that are fully covered to stop drawing (pages froze behind Max), and the
// other fix for that (99% window opacity) forces software drawing that made the rings stutter. The content is
// anchored bottom-left, so resizing between the two doesn't move it; voice.js animates around the resize.
// Tucked away it lets every click through except on the core, and never takes the keyboard.
let overlay = null;
function voiceBounds(corner) {
  // Always the main screen. Following the cursor put Max on the second monitor whenever the cursor happened to
  // be there at start-up, and the owner, working on the main screen, saw no Max at all.
  const a = screen.getPrimaryDisplay().workArea;
  return corner ? { x: a.x, y: a.y + a.height - 280, width: 620, height: 280 } : { x: a.x, y: a.y + 1, width: a.width, height: a.height - 1 };
}
function openVoice(question, corner = false) {
  if (overlay && !overlay.isDestroyed()) {
    if (!corner) overlay.webContents.send('expand');
    return;
  }
  overlay = new BrowserWindow({
    ...voiceBounds(corner), frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  const query = {};
  if (question) query.q = question;
  if (corner) { query.corner = '1'; setThrough(true); overlay.setFocusable(false); }
  overlay.loadFile(path.join(__dirname, 'ui', 'voice.html'), { query });
  // Show on the first of: ready-to-show, page loaded, or 3 s. Opened on the second monitor (125% scaling),
  // ready-to-show never fired and Max stayed invisible.
  const win0 = overlay;
  const reveal = () => {
    if (win0.isDestroyed() || win0.isVisible()) return;
    if (corner) win0.showInactive(); else { win0.show(); win0.focus(); }
  };
  overlay.once('ready-to-show', reveal);
  overlay.webContents.once('did-finish-load', () => setTimeout(reveal, 150));
  setTimeout(reveal, 3000);
  overlay.on('closed', () => { overlay = null; through = false; clearInterval(keepOnTop); });
  // Changing focusability can clear "on top" on Windows: check every few seconds and restore it only if it was
  // lost. Never force it to the front (moveTop every 2 s kept newly opened apps from coming forward).
  // Windows can also push it under another always-on-top window or a full-screen video while the flag still
  // says "on top". So every 2 s ask which window is really under the core; if it isn't Max, re-raise it
  // (re-applying topmost doesn't take focus, unlike moveTop).
  const keepOnTop = setInterval(async () => {
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
    const b = overlay.getBounds();
    const p = screen.dipToScreenPoint(through ? { x: b.x + 40, y: b.y + b.height - 40 } : { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const under = await windowAt(p.x, p.y);
    const mine = overlay && !overlay.isDestroyed() ? overlay.getNativeWindowHandle().readBigUInt64LE(0).toString() : '';
    if (under && mine && under !== mine) { overlay.setAlwaysOnTop(false); overlay.setAlwaysOnTop(true, 'screen-saver'); }
  }, 2000);
}

ipcMain.handle('chatStream', (e, id, messages) => chatStream(e.sender, id, messages));
ipcMain.on('chat-cancel', (_e, id) => inflightChats.get(id)?.abort());
ipcMain.handle('transcribe', (_e, buffer) => transcribe(buffer));
ipcMain.handle('speak', (e, id, text) => speak(e.sender, id, text));
ipcMain.on('speak-cancel', (_e, id) => cancelled.add(id));
ipcMain.on('voice', (_e, what) => {
  if (what === 'open') return openVoice();
  if (what === 'close') return overlay?.close();
  if (!overlay || overlay.isDestroyed()) return;
  // 'mini': tucked into the corner (window cut to the core's shape); 'full': over the whole screen.
  // Growing: open the shape up before resizing, or the first frames at full size are clipped to the small
  // corner cut-out (the zoom-in glitch). Shrinking: resize first, then cut.
  if (what === 'full') overlay.setShape([{ x: 0, y: 0, width: 10000, height: 10000 }]);
  overlay.setBounds(voiceBounds(what === 'mini'));
  setThrough(what === 'mini');
  overlay.setFocusable(what === 'full');
  overlay.setAlwaysOnTop(true, 'screen-saver');   // setFocusable can clear it on Windows
  if (what === 'full') overlay.focus();
});
// "Max" from anywhere opens the hologram; "Max, play some lofi" opens it already asking. If it's already
// open (full or tucked in the corner), "Max" interrupts whatever it's doing and it listens, staying where it is.
// The name as Whisper tends to hear it: "Matt, open Zen", "Mac, pause".
const NAME = "(?:max|max's|matt|mat|mac|macs|mac's|mack|maks|mags|mox|marks|mats)";
const WAKE = new RegExp(`^\\W*(?:(?:hey|hi|ok|okay|yo)\\W+)?${NAME}\\b\\W*(.*)$`, 'i');
// The wake check runs on every burst of sound the mic hears (videos included), so it only looks at the first
// 1.6 s, one at a time, decoding just a few words. It uses the main Whisper: the tiny model was faster (~0.8 s vs
// ~1.1 s) but on the owner's voice heard "Max" as "Thanks", "You", "Yeah" (tested live), so it never woke.
// The rest of a "Max, play …" burst is transcribed only after a match.
// sliding: a 2 s window cut from continuous sound (media playing). "Max" can sit anywhere in it then, so the
// name counts anywhere in the text; for a quiet-room burst it must come first ("the max price" mustn't wake it).
const NAME_ANYWHERE = new RegExp(`\\b${NAME}\\b`, 'i');
ipcMain.handle('wake', async (_e, buffer, sliding) => {
  const t0 = Date.now();
  const audio = new Float32Array(buffer);
  if (audio.length < 16000 * 0.3) return;
  const head = await (await asr())(audio.slice(0, 16000 * 2), { max_new_tokens: sliding ? 12 : 4 });
  const heard = String(head?.text || '').trim();
  const hit = sliding ? NAME_ANYWHERE.test(heard) : WAKE.test(heard);
  // Short bursts only (what "Max" or a mishearing looks like), so the log never holds conversations.
  if (heard.split(/\s+/).length <= 3 || hit) launchLog(`wake${sliding ? ' (over sound)' : ''}: heard "${hit ? heard : heard.split(/\s+/).length + ' words'}" ${hit ? '-> yes' : '-> no'} (${Date.now() - t0} ms)`);
  if (!hit) return;
  const m = !sliding && audio.length > 16000 * 1.8 ? WAKE.exec(await transcribe(buffer)) : null;   // "Max, play …": get the rest
  const rest = (m?.[1] || '').trim(), q = rest.split(/\s+/).length >= 2 ? rest : undefined;
  if (overlay && !overlay.isDestroyed()) {
    if (await frontIsDesktop()) overlay.webContents.send('expand');   // nothing open: take the stage
    overlay.webContents.send('wake', q);
  } else openVoice(q, !(await frontIsDesktop()));
});
// Is the desktop (wallpaper, taskbar) in front, rather than an app? Then a summoned Max goes full screen;
// over an app it stays in the corner. One long-lived PowerShell answers each check in milliseconds
// (starting one per check would add ~0.4 s to every "Max").
let fgPs = null;
const fgWaiters = [], topWaiters = [];
function frontIsDesktop() {
  if (!fgPs) {
    fgPs = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', '-'], { windowsHide: true });
    fgPs.stdout.setEncoding('utf8');
    let buf = '';
    fgPs.stdout.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        const line = buf.slice(0, i).trim();
        if (line.startsWith('FG:')) fgWaiters.shift()?.(line.slice(3));
        else if (line.startsWith('TOP:')) topWaiters.shift()?.(line.slice(4));
      }
    });
    fgPs.on('exit', () => { fgPs = null; while (fgWaiters.length) fgWaiters.shift()(''); });
    fgPs.stdin.write(require('./duck').loadLine + '\n');   // per-app volume control, for ducking (duck.js)
    fgPs.stdin.write(`Add-Type -Namespace FG -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n); [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(long pt); [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p);'\n`);
    fgPs.stdin.write('[MaxDuck.A]::Restore()\n');   // also puts Max's own voice back to full (duck.js)
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const t = setTimeout(() => finish(false), 1500);
    // Answer: the front window's class, its process, and the class of what shows at the middle of the main
    // screen. When Max itself had the focus (you'd clicked its corner), the front window was Max, never the
    // desktop, so it never went full screen on the wallpaper. Then the middle decides (the corner window is
    // cut to its core, so the middle shows what's really behind it).
    const DESK = /^(Progman|WorkerW|Shell_TrayWnd|Shell_SecondaryTrayWnd)$/;
    fgWaiters.push((line) => {
      clearTimeout(t);
      const [cls, pid, mid] = line.split('|');
      const mine = app.getAppMetrics().some((m) => m.pid === Number(pid));
      const desk = DESK.test(cls) || (mine && DESK.test(mid));
      launchLog(`front: ${cls}${mine ? ' (Max)' : ''}, middle: ${mid} -> ${desk ? 'desktop' : 'app'}`);
      finish(desk);
    });
    const a = screen.getPrimaryDisplay().workArea, c = screen.dipToScreenPoint({ x: a.x + a.width / 2, y: a.y + a.height / 2 });
    const pt = (BigInt(Math.round(c.y)) << 32n) | (BigInt(Math.round(c.x)) & 0xffffffffn);
    fgPs.stdin.write(`$f = [FG.W]::GetForegroundWindow(); $s = New-Object System.Text.StringBuilder 256; $null = [FG.W]::GetClassName($f, $s, 256); $p = 0; $null = [FG.W]::GetWindowThreadProcessId($f, [ref]$p); $m = New-Object System.Text.StringBuilder 256; $null = [FG.W]::GetClassName([FG.W]::GetAncestor([FG.W]::WindowFromPoint(${pt}), 2), $m, 256); 'FG:' + $s.ToString() + '|' + $p + '|' + $m.ToString()\n`);
  });
}
// Other apps' sound goes down to 15% while Max listens or talks, and back afterwards (duck.js).
let ducked = false;
ipcMain.on('duck', (_e, on) => {
  if (on === ducked) return;
  ducked = on;
  if (!fgPs) frontIsDesktop().catch(() => {});
  fgPs?.stdin.write(on ? '[MaxDuck.A]::Duck(0.15)\n' : '[MaxDuck.A]::Restore()\n');
});
// The top-level window under a screen point (physical pixels), as a handle string; '' if unknown.
function windowAt(x, y) {
  if (!fgPs) { frontIsDesktop().catch(() => {}); return Promise.resolve(''); }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(''), 1500);
    topWaiters.push(finish);
    const pt = (BigInt(Math.round(y)) << 32n) | (BigInt(Math.round(x)) & 0xffffffffn);
    fgPs.stdin.write(`'TOP:' + [FG.W]::GetAncestor([FG.W]::WindowFromPoint(${pt}), 2).ToInt64()
`);
  });
}
function startWake() {
  frontIsDesktop().catch(() => {});   // start the front-window checker now so the first "Max" isn't slowed by it
  // The wake listener asks for "screen" capture only to get Windows' loopback of what the speakers play (its
  // echo canceller's reference, ui/aec.js). Answer without a picker; it drops the video track at once.
  require('electron').session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const [src] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
      callback({ video: src, audio: 'loopback' });
    } catch { callback({}); }
  });
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  w.loadFile(path.join(__dirname, 'ui', 'wake.html'));
  w.webContents.on('render-process-gone', () => setTimeout(startWake, 5000));
}
// Voice turns also land in the main window's chat log.
ipcMain.on('chat-append', (_e, m) => { if (win && !win.isDestroyed()) win.webContents.send('chat-append', m); });
// ---------- Max's hands on this laptop ----------
// While the app is open: the hands helper listens on this laptop's loopback only, and a reverse SSH
// tunnel makes it reachable from Max's sandbox (server 127.0.0.1:18700, relayed onto the sandbox bridge
// by the server's helper). Both restart if they drop, and stop when the app closes.
// The shared secret for the hands helpers: hands/token.local (git-ignored), else the app's data folder.
// Running from the repo: hands/token.local. Installed: the app's data folder, fetched from the server over SSH
// on first run (the key never ships in the installer).
const HANDS_TOKEN = [path.join(__dirname, '..', 'hands', 'token.local'), path.join(app.getPath('userData'), 'hands_token')]
  .find((f) => !app.isPackaged && fs.existsSync(f)) || path.join(app.getPath('userData'), 'hands_token');
const HANDS_JS = app.isPackaged ? path.join(process.resourcesPath, 'hands', 'hands.js') : path.join(__dirname, '..', 'hands', 'hands.js');
const kids = { hands: null, reverse: null, desk: null };
let quitting = false;
const HANDS_LOG = path.join(app.getPath('userData'), 'hands-launch.log');
const launchLog = (line) => fs.appendFile(HANDS_LOG, `${new Date().toISOString()} ${line}\n`, () => {});
function keepAlive(name, start) {
  let again = null;
  const retry = () => { if (!quitting && !again) again = setTimeout(() => { again = null; go(); }, 10000); };
  const go = () => {
    if (quitting) return;
    let p;
    try { p = start(); } catch (e) { launchLog(`${name}: failed to start: ${e.message}`); return retry(); }
    kids[name] = p;
    let err = '';
    p.stderr?.on('data', (d) => { err = (err + d).slice(-500); });
    p.on('exit', (code) => { kids[name] = null; launchLog(`${name}: exited ${code} ${err.trim()}`); retry(); });
    p.on('error', (e) => { launchLog(`${name}: error ${e.message}`); retry(); });
    launchLog(`${name}: started pid ${p.pid}`);
  };
  go();
}
async function startHands() {
  if (!fs.existsSync(HANDS_TOKEN)) {
    try {   // first run of an installed copy: the server's helper holds the shared key
      const t = (await run(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, 'cat ~/.config/max-hands/token'], 20000)).trim();
      if (t.length >= 24) fs.writeFileSync(HANDS_TOKEN, t, { mode: 0o600 });
    } catch (e) { launchLog(`startHands: couldn't fetch the key from the server: ${e.message}`); }
  }
  const has = fs.existsSync(HANDS_TOKEN);
  launchLog(`startHands: token ${HANDS_TOKEN} ${has ? 'found' : 'MISSING'}`);
  if (!has) return;   // set up once: see hands/README.md
  keepAlive('hands', () => {
    const c = spawn(process.execPath,
      [HANDS_JS, '--name', 'laptop', '--listen', '127.0.0.1:18700', '--token-file', HANDS_TOKEN],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    c.on('message', async (m) => {
      if (m?.type === 'aside') { standAside(m.on); c.send({ re: 'aside' }); }
      if (m?.type === 'shot') c.send({ re: 'shot', ...await captureScreen(m.at).catch((e) => ({ error: e.message })) });
    });
    return c;
  });
  // Two tunnels, not one: with ExitOnForwardFailure, a reverse port still held on the server by a dead session
  // took the WhatsApp front desk down with it.
  const tunnelArgs = (...fwd) => ['-N', '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', '-o', 'ExitOnForwardFailure=yes', ...fwd, HOST];
  keepAlive('reverse', () => spawn('ssh', tunnelArgs('-R', '18700:127.0.0.1:18700'), { windowsHide: true, stdio: 'ignore' }));
  keepAlive('desk', () => spawn('ssh', tunnelArgs('-L', '18650:127.0.0.1:18650'), { windowsHide: true, stdio: 'ignore' }));   // the WhatsApp extension's front desk
}

// Max looking at / clicking on this screen: our own windows drop out of screenshots and the hologram lets
// clicks through, so Max sees and touches what's underneath.
// Tucked away, the hologram's window is cut to the shape of the core and its dialogue boxes (voice.js reports
// their rectangles), so every other click lands on the apps behind it. This replaced click-through with
// { forward: true }, which on Windows installs a system-wide mouse hook answered by this process's main
// thread: whenever Whisper or the voice kept that thread busy, the whole PC's cursor stuttered.
let through = false;   // tucked away in the corner
function setThrough(on) {
  through = on;
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setIgnoreMouseEvents(false);
  const { width, height } = overlay.getContentBounds();
  overlay.setShape(on ? [{ x: 0, y: height - 110, width: 110, height: 110 }] : [{ x: 0, y: 0, width, height }]);   // until voice.js reports
}
ipcMain.on('voice-shape', (_e, rects) => {
  if (!through || !overlay || overlay.isDestroyed() || !Array.isArray(rects) || !rects.length) return;
  overlay.setShape(rects.slice(0, 6).map((r) => ({ x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), width: Math.ceil(r.width), height: Math.ceil(r.height) })));
});
function standAside(on) {
  for (const w of BrowserWindow.getAllWindows()) w.setContentProtection(on);
  if (overlay && !overlay.isDestroyed()) {
    overlay.setIgnoreMouseEvents(on);   // only while Max clicks or types for you; no forwarding hook
    if (on && overlay.isFocused()) overlay.blur();   // keys Max presses go to the window he was using
  }
}
// at: a point in physical screen pixels (the front window's centre); its monitor is captured. geo is that
// monitor's physical rectangle, which the helper uses to turn click spots into screen coordinates.
async function captureScreen(at) {
  const d = at ? screen.getDisplayNearestPoint(screen.screenToDipPoint(at)) : screen.getPrimaryDisplay();
  const pb = screen.dipToScreenRect(null, d.bounds);
  const pw = pb.width, ph = pb.height;
  const iw = Math.min(1280, pw), ih = Math.round(ph * iw / pw);
  standAside(true);
  try {
    const all = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: iw, height: ih } });
    // Windows often leaves display_id empty; the sources then come in getAllDisplays() order (checked on the
    // two-monitor laptop), so match by position. The old "else the first one" grabbed the wrong monitor.
    const idx = screen.getAllDisplays().findIndex((x) => x.id === d.id);
    const img = (all.find((x) => x.display_id === String(d.id)) || all[idx] || all[0]).thumbnail;
    const { width, height } = img.getSize();
    return { width, height, jpeg: img.toJPEG(75).toString('base64'), geo: [pb.x, pb.y, pw, ph, width, height] };
  } finally { standAside(false); }
}

// ---------- Which computer is active ("switch pc") ----------
// A plain switch, no AI: remembered here and written to the sandbox, where Max's pc tool reads it.
const ACTIVE_FILE = path.join(app.getPath('userData'), 'active_pc');
let activePc = (() => { try { return fs.readFileSync(ACTIVE_FILE, 'utf8').trim() === 'server' ? 'server' : 'laptop'; } catch { return 'laptop'; } })();
async function setActive(pc) {
  activePc = pc === 'server' ? 'server' : 'laptop';
  try { fs.writeFileSync(ACTIVE_FILE, activePc); } catch {}
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('pc-changed', activePc);
  sandbox(`echo ${activePc} > ~/.hermes/workspace/active_pc`).catch(() => {});
  return activePc;
}
ipcMain.handle('pc', (_e, what) => (what === 'get' ? activePc : setActive(what === 'toggle' ? (activePc === 'laptop' ? 'server' : 'laptop') : what)));

ipcMain.handle('connect', () => connect());
ipcMain.handle('cfg', () => serverConfig().then(() => ({ owner: CFG.OWNER_NAME || '', sayName: CFG.SAY_NAME || '' })));
ipcMain.handle('load', async () => ({ ...parse(await sandbox(READ)), cfg: { currency: CFG.CURRENCY, locale: CFG.LOCALE, tz: CFG.TIMEZONE } }));

// ---------- Proactive Max ----------
// Every 5 minutes: read the calendar and leads, and say one new nudge (see proactive.js) from the hologram.
// What's been said is remembered for 3 days so restarts don't repeat it.
const proactive = require('./proactive');
const NUDGED = path.join(app.getPath('userData'), 'nudged.json');
async function checkNudges() {
  let said = {};
  try { said = JSON.parse(fs.readFileSync(NUDGED, 'utf8')); } catch {}
  for (const [k, at] of Object.entries(said)) if (Date.now() - at > 3 * 86400000) delete said[k];
  const next = proactive.nudges(parse(await sandbox(READ))).find((n) => !said[n.key]);
  if (next) {
    said[next.key] = Date.now();
    if (!overlay || overlay.isDestroyed()) { openVoice(undefined, true); await new Promise((r) => overlay.webContents.once('did-finish-load', r)); }
    overlay.webContents.send('announce', next.text);
  }
  fs.writeFileSync(NUDGED, JSON.stringify(said));
}
function startNudges() {
  const tick = () => checkNudges().catch((e) => launchLog(`nudges: ${e.message}`));
  setTimeout(tick, 90000);
  setInterval(tick, 5 * 60000);
}
ipcMain.handle('chat', (_e, messages) => chat(messages));
ipcMain.handle('lead', (_e, a) => leadAction(a));
// WhatsApp auto-send switch: a file on the server that the desk relay reads for every reply ("auto" = Max
// sends replies itself, "ask" = each one waits for Send on the Max Desk Telegram bot). Same switch as /mode there.
ipcMain.handle('deskMode', async (_e, set) => {
  const f = '~/.config/max-desk/mode';
  const cmd = set ? `printf %s ${set === 'auto' ? 'auto' : 'ask'} > ${f}; cat ${f}` : `cat ${f} 2>/dev/null || echo ask`;
  return (await run(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, cmd], 15000)).trim() === 'auto' ? 'auto' : 'ask';
});
// Calendar edits from the app go through the same cal.sh Max uses, so both stay in one file.
ipcMain.handle('cal', async (_e, a) => {
  const C = '~/.hermes/scripts/cal.sh';
  let cmd;
  if (a.action === 'rm') {
    if (!/^E\d{4}$/.test(a.id || '')) throw new Error('bad event id');
    cmd = `${C} rm ${a.id}`;
  } else if (a.action === 'add') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) throw new Error('Pick a date');
    if (!String(a.title || '').trim()) throw new Error('Give the event a name');
    const time = /^\d{2}:\d{2}$/.test(a.time || '') ? a.time : 'allday';
    const until = time !== 'allday' && /^\d{2}:\d{2}$/.test(a.end || '') ? ` until ${a.end}` : '';
    cmd = `${C} add ${a.date} ${time}${until} ${shq(String(a.title).trim().slice(0, 200))}`;
  } else throw new Error('unknown calendar action');
  const out = await sandbox(`${cmd} 2>&1; echo "exit=$?"`);
  if (!/exit=0\s*$/.test(out)) throw new Error(out.replace(/exit=\d+\s*$/, '').trim() || 'calendar update failed');
  return out.replace(/exit=\d+\s*$/, '').trim();
});
// Add or edit a business from the dashboard's survey. The three files go to private/business/<slug>/ on the server
// (what max-fixup syncs from) and straight into the sandbox, so Max uses them at once without a fixup.
// ponytail: files ride in the ssh command line, fine for profiles up to ~15 KB; pipe them over stdin if one grows past that.
ipcMain.handle('biz', async (_e, b) => {
  if (!/^[a-z0-9-]{1,40}$/.test(b?.slug || '')) throw new Error('Business id: use lowercase letters, digits and dashes');
  const put = (dir) => ['profile.md', 'policy.tsv', 'never.md']
    .map((f) => `printf %s ${Buffer.from(String(b.files?.[f] ?? '')).toString('base64')} | base64 -d > ${dir}/${f}`).join(' && ');
  await run(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, `d=~/max-assistant/private/business/${b.slug}; mkdir -p $d && ${put('$d')}`], 20000);
  const out = await sandbox(`d=~/.hermes/workspace/business/${b.slug}; mkdir -p $d && ${put('$d')} && echo saved`);
  if (!/saved/.test(out)) throw new Error('Saved on the server, but Max has not picked it up yet: run max-fixup');
});
ipcMain.on('win', (_e, what) => {
  if (!win) return;
  if (what === 'min') win.minimize();
  else if (what === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (what === 'close') win.close();
});

app.setAppUserModelId('Max');   // taskbar shows Max's icon and name, not Electron's
// The dashboard window. Closing it really closes it (frees its memory); Max keeps running in the tray with the
// tiny core in the corner, and the tray or the core brings the window back.
function createMainWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 980, minHeight: 640,
    frame: false, backgroundColor: '#02060b', title: 'Max', icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('closed', () => {
    win = null;
    if (reallyQuit || process.env.MAX_SHOT) app.quit();
    else openVoice(undefined, true);   // to the tray
  });
}
// One Max at a time: opening it again (shortcut, Start menu) brings up the dashboard of the running one.
if (!process.env.MAX_SMOKE && !app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (!win) createMainWindow(); win.show(); win.focus(); });

// MAX_SMOKE=<file>: check the speech models load and run (e.g. in an installed build), write the result, quit.
if (process.env.MAX_SMOKE) app.whenReady().then(async () => {
  const out = [];
  try {
    // Load both together, voice first, like startup does: the order once broke a shared native library.
    const [t] = await Promise.all([tts(), asr()]);
    out.push('whisper: ' + JSON.stringify(await transcribe(new Float32Array(16000).buffer)));
    out.push('voice: ' + (await t.generate('Max is ready.', { voice: VOICE })).audio.length + ' samples');
    // The hologram page must load and reach its corner layout (a script loop once froze it, leaving only the
    // footer text on screen).
    const h = new BrowserWindow({ width: 620, height: 280, show: false, webPreferences: { offscreen: true, preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
    h.loadFile(path.join(__dirname, 'ui', 'voice.html'), { query: { corner: '1' } });
    await new Promise((r) => setTimeout(r, 2500));
    out.push('hologram: ' + await Promise.race([h.webContents.executeJavaScript('document.body.className'),
      new Promise((r) => setTimeout(() => r('FROZEN'), 3000))]));
  } catch (e) { out.push('FAILED: ' + e.stack); }
  fs.writeFileSync(process.env.MAX_SMOKE, out.join('\n') + '\n');
  app.exit(0);
});
else app.whenReady().then(async () => {
  if (!HOST) {
    const { dialog, shell } = require('electron');
    if (!fs.existsSync(SERVER_FILE)) fs.writeFileSync(SERVER_FILE, 'you@192.168.1.50\n');
    await dialog.showMessageBox({ type: 'info', title: 'Max', message: 'Which server is Max on?',
      detail: `Notepad opens server.txt. Replace the first line with your SSH login on the server where you ran bin/install `
        + `(like alex@192.168.1.50 or alex@my-server), save it, and start Max again.\n\nThis PC needs SSH key access to it: see "Desktop app" in docs/SETUP.md.` });
    await shell.openPath(SERVER_FILE);
    return app.exit(0);
  }
  // Max starts tucked into the bottom-left corner; the tray icon (or clicking the core) opens the dashboard.
  if (process.env.MAX_SHOT) createMainWindow(); else openVoice(undefined, true);
  // Normal priority on purpose: below-normal made the "Max" check take ~3 s whenever the PC was busy. The mouse
  // stutter came from the old click-through mouse hook (gone), not from this process's priority.
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Max');
  const showWin = () => { if (!win) createMainWindow(); win.show(); win.focus(); };
  tray.on('click', showWin);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Max', click: showWin },
    { label: 'Quit Max', click: () => { reallyQuit = true; app.quit(); } },
  ]));
  // Voice from anywhere: Ctrl+Shift+Space opens the hologram. Whisper warms up in the background.
  globalShortcut.register('Control+Shift+Space', openVoice);
  setTimeout(() => { asr().catch(() => {}); tts().catch(() => {}); }, 3000);   // warm the voice models
  if (!process.env.MAX_SHOT) {
    startHands();
    startWake();
    startNudges();
    setTimeout(() => setActive(activePc), 5000);   // tell Max which computer is active
  }
  // MAX_VOICE_TEST=file.wav (16 kHz mono) + MAX_SHOT=dir: run the wav through Whisper and voice mode,
  // screenshot the hologram while Max works and after, then quit.
  if (process.env.MAX_VOICE_TEST) {
    win.webContents.once('did-finish-load', async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const fs = require('fs');
      const wav = fs.readFileSync(process.env.MAX_VOICE_TEST);
      const pcm = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length - ((wav.length - 44) % 2)));
      const t = Date.now();
      const heard = await transcribe(Float32Array.from(pcm, (v) => v / 32768).buffer);
      console.log(`VOICE-TEST heard (${Date.now() - t} ms): ${heard}`);
      openVoice();
      await wait(6000);
      overlay.webContents.executeJavaScript(`mode = 'paused'; ask(${JSON.stringify(heard)})`);   // mute the mic for the test
      const shot = async (name) => fs.writeFileSync(path.join(process.env.MAX_SHOT, name), (await overlay.webContents.capturePage()).toPNG());
      await wait(9000); await shot('voice-working.png');
      for (let i = 0; i < 90 && await overlay.webContents.executeJavaScript(`mode === 'thinking'`); i++) await wait(2000);
      await wait(2500); await shot('voice-answer.png');
      console.log('VOICE-TEST reply:', await overlay.webContents.executeJavaScript(`document.querySelector('#reply').textContent`));
      for (let i = 0; i < 40 && !await overlay.webContents.executeJavaScript('gotLast'); i++) await wait(1000);
      console.log('VOICE-TEST neural voice finished generating:', await overlay.webContents.executeJavaScript('gotLast'), '| mode:', await overlay.webContents.executeJavaScript('mode'));
      await wait(8000);
      app.quit();
    });
  }
  // MAX_SHOT=dir: screenshot every screen once data has loaded, then quit (for checking the UI).
  if (process.env.MAX_SHOT && !process.env.MAX_VOICE_TEST) {
    win.webContents.once('did-finish-load', async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(15000);
      if (process.env.MAX_SHOT_CHAT) {   // also try one real chat turn
        await win.webContents.executeJavaScript(`send(${JSON.stringify(process.env.MAX_SHOT_CHAT)})`);
        await wait(5000);
        for (let i = 0; i < 60 && await win.webContents.executeJavaScript('thinking'); i++) await wait(2000);
      }
      const open = (id) => `go('inbox'); document.getElementById('${id}').showPopover()`;   // the top-bar bubbles
      const shots = { inbox: "go('inbox')", chat: "go('chat')", leads: "go('leads')", shield: "go('shield')", business: "go('business')", voice: "go('voice')",
        calendar: open('calPop'), 'calendar-add': open('calPop') + "; document.getElementById('addWrap').open = true", settings: open('setPop'), survey: "startSurvey(data.businesses[0]?.slug)" };
      for (const [v, js] of Object.entries(shots)) {
        await win.webContents.executeJavaScript(`document.querySelectorAll(':popover-open').forEach((p) => p.hidePopover()); ${js}`);
        await wait(1500);
        await win.webContents.capturePage();   // the first capture can still show the previous screen
        await wait(300);
        const img = await win.webContents.capturePage();
        require('fs').writeFileSync(path.join(process.env.MAX_SHOT, `${v}.png`), img.toPNG());
      }
      app.quit();
    });
  }
});
let tray = null, reallyQuit = false;
app.on('before-quit', () => { reallyQuit = true; });
app.on('window-all-closed', () => { if (reallyQuit) app.quit(); });   // the tray keeps Max alive
app.on('will-quit', () => {
  quitting = true;
  // Give apps their sound back, then let the PowerShell finish and exit on its own (killing it could skip that).
  if (fgPs) { try { fgPs.stdin.write('[MaxDuck.A]::Restore()\nexit\n'); } catch {} }
  for (const p of [tunnel, kids.hands, kids.reverse, kids.desk]) if (p) p.kill();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
