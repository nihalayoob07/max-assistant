#!/usr/bin/env node
// Phone API (home server): what the Max Android app talks to, over Tailscale (or adb reverse while testing).
// The desktop app reaches the server over SSH; a phone can't, so this serves the same dashboard over HTTP:
//   GET  /data                  everything the dashboard shows (same read as app/main.js)
//   POST /lead {id, action...}  owner actions on a lead (same as the desktop decision card)
//   POST /desk-mode {set?}      WhatsApp auto-send switch      POST /cal {...}  calendar add/rm
//   POST /chat {messages}       a chat turn with main Max
//   POST /token {token}         the phone's FCM token, so escalations can ring it
//   GET  /call?lead=L0002       what Max says on the call: the deal, and the question
//   POST /call/answer {lead, text}    the owner's spoken answer -> a decision to confirm (nothing happens yet)
//   POST /call/decide {lead, action, price, drop}   the confirmed decision: desk.py --owner, same as Telegram's buttons
//   POST /ring {lead}           ring the phone now (testing)
//   POST /calls {on}            switch Max's calls off (college, meetings) or back on; GET /data says which
// Every request needs "Authorization: Bearer <key>" (~/.config/max-phone/key, made on first start).
// Escalations ring the phone: every 20 s the leads file is read, and a lead that has just become "escalated"
// gets an FCM data push carrying only its id. Telegram keeps getting its own alert, so it's the fallback.
// Usage: node phone-api.js [--listen 0.0.0.0:18660]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
// Instant answers, the morning brief and its helpers, shared with the desktop app.
const { smallTalk, askedQuestion, intent, answer: quickAnswer, brief, ORDERS, parseOrders, hm12, person } = require(path.join(__dirname, '..', 'app', 'quick.js'));

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const [HOST, PORT] = arg('listen', '0.0.0.0:18660').split(':');
const CFG = path.join(process.env.HOME || '', '.config/max-phone');
const OS = `${process.env.HOME}/.local/bin/openshell`;
const log = (...a) => console.log(new Date().toISOString(), ...a);
// The owner's settings: max.config, passed in by the systemd unit (EnvironmentFile).
const SANDBOX = process.env.SANDBOX || 'max', TZ = process.env.TIMEZONE || 'UTC';
const OWNER = (process.env.OWNER_NAME || '').split(' ')[0];
// The text shows the real name; the app's voice says it as SAY_NAME (sent as a pronunciation hint with each call).
const PRONOUNCE = OWNER && process.env.SAY_NAME ? { [OWNER]: process.env.SAY_NAME } : {};
const HI = OWNER ? `Hi ${OWNER}, it's Max.` : "Hi, it's Max.";
const money = (n) => (process.env.CURRENCY || '₹') + Math.round(Number(n)).toLocaleString(process.env.LOCALE || 'en-IN');
const file = (f) => path.join(CFG, f);
const read = (f) => { try { return fs.readFileSync(file(f), 'utf8').trim(); } catch { return ''; } };
const write = (f, s) => { fs.writeFileSync(file(f) + '.tmp', s, { mode: 0o600 }); fs.renameSync(file(f) + '.tmp', file(f)); };

let KEY = '';

/* ---------- Sandbox ---------- */
function sandbox(cmd, input = '', timeout = 300000) {
  const b64 = Buffer.from(input).toString('base64');
  return new Promise((resolve, reject) => {
    const child = execFile(OS, ['sandbox', 'exec', '--name', SANDBOX, '-g', 'nemoclaw', '--no-tty', '--', '/bin/sh', '-c',
      `. /tmp/nemoclaw-proxy-env.sh; export TZ=${TZ}; cd; echo ${b64} | base64 -d | ${cmd}`],
      { timeout, maxBuffer: 4 << 20 }, (err, stdout) => (err && !stdout ? reject(new Error(err.message.slice(0, 200))) : resolve(String(stdout))));
    child.stdin.end();   // openshell forwards stdin and waits for it to close
  });
}
const sh = (script) => sandbox('sh', script);
async function desk(args) {
  const out = await sandbox(`python3 ~/.hermes/scripts/desk.py ${args}`, '{}');
  const line = out.split('\n').reverse().find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error('no answer from the front desk');
  return JSON.parse(line);
}
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/* ---------- Dashboard data (same read and parse as app/main.js) ---------- */
const READ = `
B=~/.hermes/workspace/business
echo "@@LEADS"; cat $B/leads.tsv 2>/dev/null
echo "@@TODOS"; grep -F -- '- [ ]' ~/.hermes/workspace/notes/todos.md 2>/dev/null
echo "@@TODAY"; date +%F
echo "@@CAL"; cat ~/.hermes/workspace/calendar.tsv 2>/dev/null
echo "@@SHIELD"; tail -n 60 ~/.hermes/workspace/shield.tsv 2>/dev/null
echo "@@DESK"; cat $B/desk_state.json 2>/dev/null; echo
for d in $B/*/; do s=$(basename "$d"); [ "$s" = clients ] && continue
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
      if (section === 'BIZ') { biz = { slug: m[2].trim(), profile: '', policy: [], never: '' }; data.businesses.push(biz); section = 'PROFILE'; }
      continue;
    }
    if (section === 'LEADS' && line.trim() && !line.startsWith('id\t')) {
      const [id, created, updated, business, contact, channel, status, value, next, need] = line.split('\t');
      data.leads.push({ id, created, updated, business, contact, channel, status, value: Number(value) || 0, next, need });
    } else if (section === 'TODOS' && line.trim()) data.todos.push(line.replace(/^- \[ \]\s*/, ''));
    else if (section === 'TODAY' && line.trim()) data.today = line.trim();
    else if (section === 'CAL' && line.trim() && !line.startsWith('id\t')) {
      const [id, date, start, end, title] = line.split('\t');
      data.events.push({ id, date, start, end, title });
    } else if (section === 'SHIELD' && line.trim()) {
      const [at, kind, who, detail] = line.split('\t');
      data.shield.push({ at, kind, who, detail });
    } else if (section === 'DESK' && line.trim().startsWith('{')) { try { data.desk = JSON.parse(line); } catch {} }
    else if (section === 'PROFILE' && biz) biz.profile += line + '\n';
    else if (section === 'POLICY' && biz && line.trim() && !line.startsWith('#')) {
      const [product, unit, list, floor, minQty, lead, target] = line.split('\t');
      biz.policy.push({ product, unit, list: Number(list), floor: Number(floor), minQty, lead, target: target ? Number(target) : null });
    } else if (section === 'NEVER' && biz) biz.never += line + '\n';
  }
  return data;
}
const load = async () => ({ ...parse(await sh(READ)), cfg: { currency: process.env.CURRENCY, locale: process.env.LOCALE, tz: process.env.TIMEZONE } });

// Owner actions on a lead: the same commands as the desktop card (app/main.js leadAction).
async function leadAction({ id, action, value, negotiable, firm }) {
  if (!/^L\d{4}$/.test(id || '')) throw new Error('bad lead id');
  if (action === 'price') {
    const p = Math.round(Number(value)), n = Math.round(Number(negotiable) || 0);
    if (!(p > 0)) throw new Error('enter your price');
    if (!firm && (n < 0 || n >= p)) throw new Error('"can drop by" must be less than the price');
    const r = await desk(`--owner ${id} ${p} ${firm ? '--firm' : `--negotiable ${n}`}`);
    if (!r.ok) throw new Error(r.error);
    return r;
  }
  const set = { approve: ['agreed', value], decline: ['lost', ''], paid: ['paid', ''], snooze: ['', ''] }[action];
  if (!set) throw new Error('unknown action');
  if (action === 'approve' && !(Number(value) > 0)) throw new Error('enter the agreed amount');
  await sh(`
L=~/.hermes/workspace/business/leads.tsv
d=$(date +%F); n=$(date -d '+2 days' +%F)
awk -F'\\t' -v OFS='\\t' -v id=${shq(id)} -v st=${shq(set[0])} -v val=${shq(set[1] || '')} -v d="$d" -v n="$n" -v act=${shq(action)} '
  $1 == id { if (st != "") $7 = st; if (val != "") $8 = val; if (act == "snooze") $9 = n; $3 = d } { print }' "$L" > "$L.tmp" && mv "$L.tmp" "$L"
echo ok`);
  return { ok: true };
}

async function cal(a) {
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
  const out = await sh(`${cmd} 2>&1; echo "exit=$?"`);
  if (!/exit=0\s*$/.test(out)) throw new Error(out.replace(/exit=\d+\s*$/, '').trim() || 'calendar update failed');
  return out.replace(/exit=\d+\s*$/, '').trim();
}

const MODE = path.join(process.env.HOME || '', '.config/max-desk/mode');
function deskMode(set) {
  if (set) fs.writeFileSync(MODE, set === 'auto' ? 'auto' : 'ask');
  try { return fs.readFileSync(MODE, 'utf8').trim() === 'auto' ? 'auto' : 'ask'; } catch { return 'ask'; }
}

/* ---------- Chat with main Max (its API on the host, port 8642) ---------- */
let maxToken = '';
// Small talk and the common questions (list, calendar, follow-ups, leads, brief) answered straight away, or null.
async function instant(text, asked = false) {   // asked: Max's last line was a question, so "okay" answers it
  const hello = smallTalk(text, OWNER, { tz: TZ, asked });
  if (hello) return hello;
  const want = intent(text);
  if (!want) return null;
  const [data, orders] = await Promise.all([load(), want.kind === 'brief' ? sh(ORDERS).then(parseOrders).catch(() => []) : []]);
  return quickAnswer(want, data, { owner: OWNER, orders });
}

async function chat(messages) {
  const quick = await instant(messages.filter((m) => m.role === 'user').pop()?.content, askedQuestion(messages));
  if (quick) return quick;
  if (!maxToken) {
    maxToken = await new Promise((resolve) => execFile('/bin/sh', ['-c', 'export PATH=$HOME/.local/bin:$PATH; nemohermes max gateway-token --quiet 2>/dev/null | tail -1'],
      { timeout: 30000 }, (_e, out) => resolve(String(out || '').trim())));
    if (maxToken.length < 20) { maxToken = ''; throw new Error("couldn't get Max's token"); }
  }
  const r = await fetch('http://127.0.0.1:8642/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${maxToken}` },
    body: JSON.stringify({ model: 'hermes-agent', messages: messages.slice(-20) }), signal: AbortSignal.timeout(6 * 60000),
  });
  if (r.status === 401) maxToken = '';
  if (!r.ok) throw new Error(`Max answered ${r.status}`);
  return (await r.json())?.choices?.[0]?.message?.content || '';
}

/* ---------- The call ---------- */
// Where an escalated deal stands, worked out the same way as the desktop decision card (app/ui/app.js).
const precise = (v) => { const p = Math.round(v / 50) * 50; return p % 500 === 0 ? p - 50 : p; };
async function deal(id) {
  const data = await load();
  const l = data.leads.find((x) => x.id === id);
  if (!l) throw new Error(`no lead ${id}`);
  const d = data.desk[id] || {};
  const pol = data.businesses.find((b) => b.slug === l.business)?.policy.find((p) => p.product === d.product);
  const theirs = d.theirs || l.value || 0;
  const ours = d.pts ? d.pts[d.step || 0] : pol?.list || 0;
  const floor = d.limit || pol?.floor || 0;
  const counter = theirs && ours ? Math.max(precise((theirs + ours) / 2), theirs + 50) : 0;
  const lastThem = String(d.convo || '').split('\n').map((x) => /^Customer(?: \(replying to: .*?\))?: (.*)$/.exec(x.trim())).filter(Boolean).pop()?.[1] || '';
  return { lead: id, status: l.status, contact: l.contact, business: l.business, product: d.product || '', need: l.need,
    theirs, ours, floor, counter, lastThem: lastThem.slice(0, 300), mode: deskMode() };
}
function script(c) {
  const who = /^\+?\d[\d\s]+$/.test(c.contact) ? 'A client' : c.contact;
  const s = [`${HI} ${who} on ${c.business} wants ${c.product || 'a deal'}${c.theirs ? ` at ${money(c.theirs)}` : ''}.`];
  if (c.ours) s.push(`We're at ${money(c.ours)}, and your floor is ${money(c.floor)}.`);
  if (c.lastThem) s.push(`Their last message: ${c.lastThem}`);
  s.push(`Accept${c.theirs ? ` ${money(c.theirs)}` : ''}, counter with a price, or decline?`);
  return s.join(' ');
}

// Spoken numbers: "13500", "13,500", "13.5k", "thirteen and a half", "thirteen thousand five hundred", "one lakh".
const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, a: 1 };
const SCALES = { hundred: 100, thousand: 1000, k: 1000, grand: 1000, lakh: 100000, lakhs: 100000, lac: 100000 };
function numbers(text) {
  const toks = text.toLowerCase().replace(/₹|\brs\.?|\brupees?\b/g, ' ').replace(/(\d),(?=\d)/g, '$1')
    .replace(/(\d)\s*k\b/g, '$1 k').replace(/-/g, ' ').match(/\d+(?:\.\d+)?|[a-z]+/g) || [];
  const out = [];
  let total = 0, cur = 0, any = false, dec = null;
  const flush = () => { if (any) out.push(total + cur); total = 0; cur = 0; any = false; dec = null; };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\d/.test(t)) { if (any && !SCALES[toks[i - 1]]) flush(); cur += Number(t); any = true; }
    else if (t in UNITS && (t !== 'a' || SCALES[toks[i + 1]])) {
      if (dec !== null) { cur += UNITS[t] / dec; dec *= 10; continue; }
      cur += UNITS[t]; any = true;
    } else if (t === 'point' && any) dec = 10;
    else if (t === 'and' && toks[i + 1] === 'a' && toks[i + 2] === 'half' && any) { cur += 0.5; i += 2; }
    else if (t === 'half' && any) cur += 0.5;
    else if (t in SCALES && any) {
      if (SCALES[t] === 100) cur *= 100;
      else { total += cur * SCALES[t]; cur = 0; }
      dec = null;
    } else if (t === 'and' && any) continue;
    else flush();
  }
  flush();
  return out;
}
// What the owner said -> a decision. Small numbers are thousands when the deal is in thousands ("thirteen and a half").
function understand(text, c) {
  const t = ` ${String(text).toLowerCase()} `;
  if (/\b(repeat|say (that|it) again|what was|again)\b/.test(t)) return { action: 'repeat' };
  if (/\b(decline|reject|no deal|let (it|them) go|forget it|say no|turn (it|them) down|not interested)\b/.test(t)) return { action: 'decline' };
  const drop = /\b(?:drop|down|less|room|negotiable)\b.*?(\d[\d.,]*|[a-z][a-z\s-]*)/.exec(t);
  let nums = numbers(t);
  const scale = (n) => (n > 0 && n < 1000 && Math.max(c.ours, c.theirs) >= 1000 ? n * 1000 : n);
  let dropBy = 0;
  if (drop) {   // "13800 can drop 300": the last number is the room to come down, not the price
    const after = numbers(t.slice(drop.index));
    if (nums.length > 1 && after.length) { dropBy = after[after.length - 1]; nums = nums.slice(0, nums.length - 1); }
  }
  const price = nums.length ? Math.round(scale(nums[0])) : 0;
  const firm = /\b(final|firm|last|not a rupee less|no less|no further|no more)\b/.test(t);
  if (/\b(accept|take it|go ahead|agree|yes|okay|ok|fine|sure|deal)\b/.test(t) && (!price || price === Math.round(c.theirs))) {
    return c.theirs ? { action: 'accept', price: Math.round(c.theirs) } : { action: 'unclear' };
  }
  if (/\b(counter|half ?way|split)\b/.test(t) && !price && c.counter) return { action: 'counter', price: c.counter, drop: 0 };
  if (!price) return { action: 'unclear' };
  // A misheard number shouldn't become a price: it has to sit near this deal.
  const lo = Math.min(c.theirs || price, c.floor || price) * 0.5, hi = Math.max(c.ours || price, c.theirs || price) * 2;
  if (price < lo || price > hi) return { action: 'unclear', heard: price };
  if (dropBy) dropBy = Math.round(scale(dropBy) >= price ? dropBy : scale(dropBy));
  if (dropBy >= price) dropBy = 0;
  return { action: firm ? 'final' : 'counter', price, drop: firm ? 0 : dropBy };
}
const confirmLine = (d) => ({
  accept: `Accept their ${money(d.price)} and close the deal. Right?`,
  final: `Tell them ${money(d.price)}, final, no further negotiation. Right?`,
  counter: `Counter at ${money(d.price)}${d.drop ? `, and I can come down ${money(d.drop)} more if I have to` : ''}. Right?`,
  decline: 'Decline, and mark the lead lost. Nothing goes to them. Right?',
}[d.action]);

async function decide(lead, d) {
  if (d.action === 'decline') {
    await sh(`~/.hermes/scripts/lead.sh update ${lead} status lost`);
    return { ok: true, say: `Done. ${lead} is marked lost, and nothing was sent to them.` };
  }
  const price = Math.round(Number(d.price));
  if (!(price > 0)) throw new Error('no price');
  const firm = d.action === 'accept' || d.action === 'final';
  const drop = firm ? 0 : Math.max(0, Math.round(Number(d.drop) || 0));
  const r = await desk(`--owner ${lead} ${price} ${firm ? '--firm' : `--negotiable ${drop}`}`);
  if (!r.ok) return { ok: false, say: `That didn't go through: ${r.error}` };
  const wait = deskMode() === 'auto' ? 'It goes out on WhatsApp in a moment.' : 'It is waiting for your Send on Telegram.';
  return { ok: true, status: r.status, reply: r.reply,
    say: `${r.status === 'agreed' ? 'Deal closed. ' : ''}Done. I'll tell them: ${r.reply} ${wait}` };
}

/* ---------- Ringing: FCM HTTP v1 with the Firebase service account (~/.config/max-phone/firebase.json) ---------- */
let fcmAuth = { token: '', exp: 0 };
async function fcmToken(sa) {
  if (fcmAuth.exp > Date.now() + 60000) return fcmAuth.token;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri, iat: now, exp: now + 3600 })}`;
  const jwt = `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), sa.private_key).toString('base64url')}`;
  const r = await fetch(sa.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` });
  const j = await r.json();
  if (!j.access_token) throw new Error(`google auth: ${j.error_description || j.error || r.status}`);
  fcmAuth = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return fcmAuth.token;
}
// Only "Max is calling" and the call's id go through Google; the app fetches what it's about from here.
async function ring(id) {
  const to = read('fcm-token');
  if (!to) throw new Error('the phone has not registered yet (open the app once)');
  let sa;
  try { sa = JSON.parse(fs.readFileSync(file('firebase.json'), 'utf8')); } catch { throw new Error('no Firebase key at ~/.config/max-phone/firebase.json'); }
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await fcmToken(sa)}` },
    body: JSON.stringify({ message: { token: to, data: { type: 'call', id, at: String(Date.now()) }, android: { priority: 'HIGH', ttl: '300s' } } }),
  });
  if (!r.ok) throw new Error(`FCM ${r.status}: ${(await r.text()).slice(0, 200)}`);
  log('rang the phone for', id);
}

/* ---------- The other calls: meetings and reminders, desk questions, the morning brief ---------- */
// Call ids: L0002 (a deal) · E0003@2026-10-21 (a calendar event that day) · q:c<chat id> (a desk question) · brief:2026-10-21
// me:<ms> is a call the owner started from the app.
const kindOf = (id) => (/^L\d{4}$/.test(id) ? 'deal' : /^E\d{4}@\d{4}-\d{2}-\d{2}$/.test(id) ? 'event' : /^q:c\w{1,30}$/.test(id) ? 'question'
  : /^brief:\d{4}-\d{2}-\d{2}$/.test(id) ? 'brief' : /^me:\d{1,13}$/.test(id) ? 'owner' : null);
const callId = (s) => { const id = String(s || ''); if (!kindOf(id)) throw new Error('bad call id'); return id; };

// The front desk relay (desk/desk-relay.js) holds the WhatsApp questions that wait on the owner.
async function relay(method, p, body) {
  const key = fs.readFileSync(path.join(process.env.HOME || '', '.config/max-desk/key'), 'utf8').trim();
  const r = await fetch(`http://127.0.0.1:18650${p}`, { method, headers: { 'X-Desk-Key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(240000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `desk relay said ${r.status}`);
  return j;
}
const questions = async () => (await relay('GET', '/questions')).items || [];

const isReminder = (e) => /^remind(er)?\b/i.test(e.title);

// What Max says when the call is answered, and the buttons that answer it without talking.
async function callInfo(id) {
  const kind = kindOf(id);
  if (kind === 'deal') {
    const c = await deal(id);
    const buttons = [];
    if (c.theirs) buttons.push({ label: `ACCEPT ${money(c.theirs)}`, style: 'primary', decision: { action: 'accept', price: c.theirs } });
    if (c.counter) buttons.push({ label: `COUNTER ${money(c.counter)}`, style: 'action', decision: { action: 'counter', price: c.counter, drop: 0 } });
    buttons.push({ label: 'DECLINE', style: 'danger', decision: { action: 'decline' } });
    return { id, kind, title: `${c.business}: ${c.product}`, sub: `${c.contact} · ${id}`,
      info: c.ours ? `THEIR OFFER ${money(c.theirs)} · WE'RE AT ${money(c.ours)} · FLOOR ${money(c.floor)}` : '', say: script(c), buttons, deal: c };
  }
  if (kind === 'event') {
    const [eid, date] = id.split('@');
    const e = (await load()).events.find((x) => x.id === eid && x.date === date);
    if (!e) throw new Error('that event is gone from the calendar');
    const say = isReminder(e) ? `${HI} Your reminder: ${e.title.replace(/^remind(er)?:?\s*(me\s*(to)?\s*)?/i, '')}.`
      : `${HI} ${e.title} is at ${hm12(e.start)}, in about ten minutes.`;
    return { id, kind, title: e.title, sub: `${e.start === 'allday' ? 'All day' : e.start} · ${date}`, info: '',
      say: `${say} Anything you need from me?`, buttons: [] };
  }
  if (kind === 'question') {
    const q = (await questions()).find((x) => `q:${x.id}` === id);
    if (!q) throw new Error('that question was already answered');
    if (q.kind === 'handler') return { id, kind, title: `New chat: ${q.chat}`, sub: 'WhatsApp', info: '',
      say: `${HI} A new WhatsApp chat from ${person(q.chat)}. They said: ${q.them}. Should I handle it, or will you?`,
      buttons: [{ label: 'MAX HANDLES IT', style: 'primary', decision: { action: 'handler', handler: 'max' } },
        { label: "I'LL HANDLE IT", style: 'action', decision: { action: 'handler', handler: 'me' } }] };
    return { id, kind, title: `Question: ${q.chat}`, sub: 'WhatsApp', info: q.ask,
      say: `${HI} ${person(q.chat)} on WhatsApp needs you: ${q.ask}. They said: ${q.them}. What should I tell them?`,
      buttons: [{ label: "I'LL REPLY MYSELF", style: 'action', decision: { action: 'skip' } }] };
  }
  if (kind === 'owner') return { id, kind, title: 'You called Max', sub: '', info: '', say: `${HI} What can I do for you?`, buttons: [] };
  const [data, orders] = await Promise.all([load(), sh(ORDERS).then(parseOrders).catch(() => [])]);
  return { id, kind, title: 'Your morning brief', sub: data.today, info: '', say: brief(data, orders, OWNER), buttons: [] };
}

// After a brief or a reminder the call is a conversation with main Max (each call keeps its own short history).
const talks = new Map();
// While main Max works on a call question, the phone says one short line that shows it understood ("Weekend offer,
// let me think about what'd work."). A tiny, tool-less call to the fast model, made inside the sandbox where the
// NVIDIA key is added on the way out; about a second. The phone has its own fallback if this is slow or fails.
async function ack(said) {
  const body = JSON.stringify({
    model: 'nvidia/nemotron-3.5-lightning-30b-a3b', max_tokens: 40, temperature: 0.7,
    chat_template_kwargs: { enable_thinking: false },   // it's a reasoning model: thinking alone would use up the 40 tokens
    messages: [
      { role: 'system', content: `You are Max, ${OWNER || 'the owner'}'s assistant, on a phone call with him. He just asked you something and you are working on it. ` +
        'Say ONE short, casual spoken sentence (under 12 words) that shows you understood what he asked, in your own words. ' +
        'Say what you are about to do, never that it is done, and never give the answer or any facts. Do not ask anything. ' +
        'No lists, no emoji, no quotes. Examples: "Weekend offer, let me think about what would work." / ' +
        '"Ah, the Ravi deal. Let me pull it up." / "Let me get YouTube going on your laptop." / "Okay, let me add that reminder."' },
      { role: 'user', content: String(said || '').slice(0, 400) },
    ],
  });
  const out = await sandbox(`curl -s -m 5 https://integrate.api.nvidia.com/v1/chat/completions -H 'Content-Type: application/json' -H "Authorization: Bearer $NVIDIA_INFERENCE_API_KEY" -d @-`, body, 8000);
  const line = String(JSON.parse(out)?.choices?.[0]?.message?.content || '').replace(/["*_#`]/g, '').replace(/\s+/g, ' ').trim();
  if (!line || line.length > 120 || line.includes('?')) throw new Error('no usable line');
  return { ack: line };
}

async function talk(id, said, opening) {
  if (!talks.has(id)) talks.set(id, [{ role: 'assistant', content: opening }]);
  const m = talks.get(id);
  m.push({ role: 'user', content: `(On a phone call with you, so answer in a few short spoken sentences, no lists or markdown.) ${said}` });
  const reply = await instant(said, askedQuestion(m)) || await chat(m);   // what was said, before the call note, so "hello" still matches
  m.push({ role: 'assistant', content: reply });
  if (talks.size > 20) talks.delete(talks.keys().next().value);
  return reply.replace(/[*_#`>|]/g, '').replace(/\n+/g, ' ');
}

async function answer(id, text) {
  log('heard', id, JSON.stringify(text));
  const info = await callInfo(id);
  if (info.kind === 'deal') {
    const d = understand(text, info.deal);
    if (d.action === 'repeat') return { decision: null, say: info.say };
    if (d.action === 'unclear') return { decision: null, say: d.heard ? `I heard ${money(d.heard)}, which doesn't fit this deal. Say the price again?`
      : 'Sorry, I didn\'t catch that. Say accept, counter and a price, final and a price, or decline.' };
    return { decision: d, say: confirmLine(d) };
  }
  if (info.kind === 'question') {
    const t = ` ${text.toLowerCase()} `;
    if (info.buttons.length === 2) {   // who handles the chat
      if (/\b(i'?ll|i will|myself|me|mine)\b/.test(t)) return { decision: { action: 'handler', handler: 'me' }, say: "You'll handle that chat, and I'll stay out of it. Right?" };
      if (/\b(max|you|yourself)\b/.test(t)) return { decision: { action: 'handler', handler: 'max' }, say: "I'll handle that chat. Right?" };
      return { decision: null, say: 'Should I handle it, or will you?' };
    }
    if (/\b(i'?ll reply|reply myself|skip|leave it)\b/.test(t)) return { decision: { action: 'skip' }, say: "You'll reply to them yourself. Right?" };
    return { decision: { action: 'answer', answer: text }, say: `I'll tell them: ${text}. Right?` };
  }
  return { decision: null, say: await talk(id, text, info.say) };
}

async function decideCall(id, d) {
  log('decided', id, JSON.stringify(d));
  const kind = kindOf(id);
  if (kind === 'deal') return decide(id, d);
  if (kind !== 'question') throw new Error('nothing to decide on this call');
  const qid = id.slice(2);
  if (d.action === 'skip') { await relay('POST', '/answer', { id: qid, skip: true }); return { ok: true, say: "Okay, I'll leave that one to you." }; }
  if (d.action === 'handler') {
    await relay('POST', '/answer', { id: qid, handler: d.handler === 'me' ? 'me' : 'max' });
    return { ok: true, say: d.handler === 'me' ? "Okay, it's yours. I'll stay out of that chat." : "Okay, I'll take it from here." };
  }
  if (d.action !== 'answer' || !String(d.answer || '').trim()) throw new Error('no answer');
  await relay('POST', '/answer', { id: qid, answer: String(d.answer) });
  const wait = deskMode() === 'auto' ? 'It goes out on WhatsApp in a moment.' : 'It is waiting for your Send on Telegram.';
  return { ok: true, say: `Done. I've written to them with your answer. ${wait}` };
}

/* ---------- When to ring ---------- */
// Deals: a lead that has just become "escalated" (leaving it clears the mark, so a fresh escalation rings again).
// Events: 10 minutes before a timed calendar event; one titled "Reminder: ..." at its time. Questions: as soon as the desk
// has one. Brief: once a day at ~/.config/max-phone/brief-time (default 07:30). Nothing rings in quiet hours
// (~/.config/max-phone/quiet, default 23:00-07:00) except reminders the owner set themselves; the rest waits for the morning.
// With calls switched off (~/.config/max-phone/calls = off) nothing rings, reminders included; deals and desk questions
// ring once calls are back on, a brief only if it's still within its 3 hours.
const callsOn = (set) => { if (set !== undefined) write('calls', set ? 'on' : 'off'); return read('calls') !== 'off'; };
let rung = null, once = null;
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function quiet(now) {
  const [a, b] = (read('quiet') || '23:00-07:00').split('-').map(mins);
  return a > b ? now >= a || now < b : now >= a && now < b;
}
async function watch() {
  const out = await sh(`date '+%F %H:%M'; echo @@; awk -F'\\t' '$7 == "escalated" { print $1 }' ~/.hermes/workspace/business/leads.tsv 2>/dev/null; echo @@; cat ~/.hermes/workspace/calendar.tsv 2>/dev/null`);
  const [clock, esc, calTsv] = out.split('@@\n');
  const [today, hm] = clock.trim().split(' ');
  const now = mins(hm);
  const escalated = esc.split('\n').filter((x) => /^L\d{4}$/.test(x));
  if (rung === null) {   // first look since start: don't ring for escalations that were already waiting
    try { rung = new Set(JSON.parse(read('rung.json') || 'null') ?? escalated); } catch { rung = new Set(escalated); }
    try { once = new Set(JSON.parse(read('once.json') || '[]')); } catch { once = new Set(); }
  }
  const off = !callsOn(), hush = off || quiet(now);
  const due = [];
  if (!hush) for (const id of escalated) if (!rung.has(id)) { rung.add(id); due.push(id); }
  rung = new Set([...rung].filter((id) => escalated.includes(id)));
  for (const line of (calTsv || '').split('\n')) {
    const [id, date, start, , title] = line.split('\t');
    if (date !== today || !/^\d\d:\d\d$/.test(start || '') || !/^E\d{4}$/.test(id)) continue;
    const e = { title: title || '' }, left = mins(start) - now;
    const ringNow = isReminder(e) ? left <= 0 && left > -10 : left > 0 && left <= 10;
    const key = `${id}@${date}`;
    if (ringNow && !once.has(key) && (!hush || (isReminder(e) && !off))) { once.add(key); due.push(key); }
  }
  if (!hush) {
    for (const q of await questions().catch(() => [])) {
      const key = `q:${q.id}:${q.ask.slice(0, 40)}:${q.them.slice(-40)}`;
      if (!once.has(key)) { once.add(key); due.push(`q:${q.id}`); }
    }
    const b = mins(read('brief-time') || '07:30');
    if (now >= b && now < b + 180 && !once.has(`brief:${today}`)) { once.add(`brief:${today}`); due.push(`brief:${today}`); }
  }
  write('rung.json', JSON.stringify([...rung]));
  write('once.json', JSON.stringify([...once].slice(-300)));
  for (const [i, id] of due.entries()) {   // several at once: one call at a time, a minute and a half apart
    if (i) await new Promise((r) => setTimeout(r, 90000));
    await ring(id).catch((e) => log('ring', id, e.message));
  }
}
const tick = () => watch().catch((e) => log('watch', e.message)).finally(() => setTimeout(tick, 20000));

/* ---------- HTTP ---------- */
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const authed = (req) => {
  const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  return got.length === Buffer.byteLength(KEY) && crypto.timingSafeEqual(got, Buffer.from(KEY));
};
// The call's voice: ElevenLabs, when max.config has ELEVENLABS_API_KEY. The key stays here on the server; the phone
// gets MP3 back and falls back to its own voice if this fails. Only the words Max says go to ElevenLabs.
// How fast the voice talks (0.7 to 1.2). Set from either app's Settings; the desktop reads the same file over SSH.
const voiceSpeed = (set) => {
  if (set !== undefined) {
    const v = Math.round(Number(set) * 100) / 100;
    if (!(v >= 0.7 && v <= 1.2)) throw new Error('speed goes from 0.7 to 1.2');
    write('voice-speed', String(v));
  }
  return Number(read('voice-speed')) || Number(process.env.ELEVENLABS_SPEED) || 1;
};
async function speech(text) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('no ElevenLabs key in max.config');
  const voice = process.env.ELEVENLABS_VOICE || 'q1OMOTZNtqpS50TIQtu4';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: String(text || '').slice(0, 2500), model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
      voice_settings: { speed: voiceSpeed() } }),
  });
  if (!r.ok) { log(`voice: ElevenLabs said ${r.status}`); throw new Error(`ElevenLabs said ${r.status}`); }
  const mp3 = Buffer.from(await r.arrayBuffer());
  log(`voice: ${String(text || '').length} chars -> ${mp3.length} bytes`);
  return { audio: mp3.toString('base64') };
}

const ROUTES = {
  'GET /health': async () => ({ ok: true }),
  'GET /data': async () => ({ ...(await load()), deskMode: deskMode(), callsOn: callsOn() }),
  'POST /calls': async (j) => ({ on: callsOn(!!j.on) }),
  'POST /lead': (j) => leadAction(j),
  'POST /desk-mode': async (j) => ({ mode: deskMode(j.set) }),
  'POST /cal': async (j) => ({ out: await cal(j) }),
  'POST /chat': async (j) => ({ reply: await chat(Array.isArray(j.messages) ? j.messages : []) }),
  'POST /token': async (j) => { if (!/^[\w:-]{20,4096}$/.test(j.token || '')) throw new Error('bad token'); write('fcm-token', j.token); return { ok: true }; },
  'GET /call': async (_j, q) => { const { deal: _d, ...c } = await callInfo(callId(q.get('id'))); return { ...c, pronounce: PRONOUNCE }; },
  'POST /call/answer': (j) => answer(callId(j.id), String(j.text || '').slice(0, 500)),
  'POST /call/ack': (j) => ack(j.text),
  'POST /call/decide': (j) => decideCall(callId(j.id), j),
  'POST /ring': async (j) => { await ring(callId(j.id)); return { ok: true }; },
  'POST /tts': (j) => speech(j.text),
  'POST /voice-speed': async (j) => ({ speed: voiceSpeed(j.speed) }),
};
if (require.main === module) {
  fs.mkdirSync(CFG, { recursive: true, mode: 0o700 });
  if (!read('key')) write('key', crypto.randomBytes(24).toString('base64url'));
  KEY = read('key');
  http.createServer((req, res) => {
    if (!authed(req)) return send(res, 401, { error: 'bad key' });
    const url = new URL(req.url, 'http://x');
    const route = ROUTES[`${req.method} ${url.pathname}`];
    if (!route) return send(res, 404, { error: 'not found' });
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 200000) req.destroy(); });
    req.on('end', async () => {
      let j = {};
      try { if (body) j = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }); }
      try { send(res, 200, await route(j, url.searchParams)); } catch (e) { send(res, 502, { error: e.message }); }
    });
  }).listen(Number(PORT), HOST, () => log(`phone api on ${HOST}:${PORT}`));
  tick();
}
module.exports = { numbers, understand, brief, parseOrders };
