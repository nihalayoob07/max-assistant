#!/usr/bin/env node
// Front-desk relay (home server): the WhatsApp extension posts customer messages here and gets the reply
// back. It only runs scripts/desk.py inside Max's sandbox; it never talks to main Max's agent, so a
// customer can't reach Max's tools or the computer helpers.
//   POST /desk  { contact, channel, to, history, text }  with header X-Desk-Key
//   GET  /outbox        messages ready to go into a chat (owner decisions; with the desk bot: approved drafts)
//   POST /outbox/done  { id }   that one is in the chat now
//   GET  /health
// With a desk bot token (~/.config/max-desk/bot-token, a second Telegram bot: one poller per bot, and
// main Max polls the first), the server runs WhatsApp itself (desk/max-wa.sh) and nothing is sent without
// the owner's tap, unless they switch auto-send on: in "ask" mode every reply comes to them as a draft with
// Send / Edit / Skip; in "auto" mode it's sent straight away and they get a copy. The switch is the file
// ~/.config/max-desk/mode (auto|ask), flipped with /mode on Telegram or the dashboard's Auto-send switch.
// Escalated prices always come with Accept / Counter / My price buttons.
//   POST /draft { chat, contact, reply, summary, text }    POST /tg/photo { png, caption }    POST /tg/text { text }
// Usage: node desk-relay.js --listen 127.0.0.1:18650 --key-file ~/.config/max-desk/key
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const [HOST, PORT] = arg('listen', '127.0.0.1:18650').split(':');
const KEY_FILE = arg('key-file');
const KEY = fs.readFileSync(KEY_FILE, 'utf8').trim();
const CFG = path.dirname(KEY_FILE);
// Straight through OpenShell: ~20 ms instead of nemohermes's ~1.8 s start-up and host-wide lock.
const OS = `${process.env.HOME}/.local/bin/openshell`;
const log = (...a) => console.log(new Date().toISOString(), ...a);
// The owner's settings: max.config, passed in by the systemd unit (EnvironmentFile).
const SANDBOX = process.env.SANDBOX || 'max', TZ = process.env.TIMEZONE || 'UTC';
const money = (n) => (process.env.CURRENCY || '₹') + Math.round(Number(n)).toLocaleString(process.env.LOCALE || 'en-IN');

function sandbox(cmd, input = '') {
  const b64 = Buffer.from(input).toString('base64');
  return new Promise((resolve, reject) => {
    const child = execFile(OS, ['sandbox', 'exec', '--name', SANDBOX, '-g', 'nemoclaw', '--no-tty', '--', '/bin/sh', '-c',
      `. /tmp/nemoclaw-proxy-env.sh; export TZ=${TZ}; cd; echo ${b64} | base64 -d | ${cmd}`],
      { timeout: 300000, maxBuffer: 1 << 20 }, (err, stdout) => (err && !stdout ? reject(new Error(err.message.slice(0, 200))) : resolve(String(stdout))));
    child.stdin.end();   // openshell forwards stdin and waits for it to close
  });
}
async function desk(input, args = '') {
  const out = await sandbox(`python3 ~/.hermes/scripts/desk.py ${args}`, JSON.stringify(input));
  const line = out.split('\n').reverse().find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error('no answer from the desk');
  return JSON.parse(line);
}

/* ---------- Desk bot (Telegram) ---------- */
const read = (f) => { try { return fs.readFileSync(path.join(CFG, f), 'utf8').trim(); } catch { return ''; } };
const TOKEN = read('bot-token');
let owner = read('owner-chat');
const DRAFTS = path.join(CFG, 'drafts.json');
let drafts = {};
try { drafts = JSON.parse(fs.readFileSync(DRAFTS, 'utf8')); } catch {}
const saveDrafts = () => {
  for (const [id, d] of Object.entries(drafts)) if (d.done && Date.now() - d.at > 3 * 864e5) delete drafts[id];
  fs.writeFileSync(DRAFTS + '.tmp', JSON.stringify(drafts)); fs.renameSync(DRAFTS + '.tmp', DRAFTS);
};
let awaiting = null;
const mode = () => (read('mode') === 'auto' ? 'auto' : 'ask');
// The WhatsApp extension's switches, set from either app or by asking Max (phone/phone-api.js). Only the ones set
// here go out with the outbox and win over the extension's own; the rest show the server defaults (desk/max-wa.sh).
const WA_DEFAULTS = { enabled: true, unsavedOnly: false, selfTest: true };
const waSet = () => { try { return JSON.parse(read('extension.json')) || {}; } catch { return {}; } };
const waState = () => ({ ...WA_DEFAULTS, ...waSet(), autoSend: mode() === 'auto',
  chats: Object.values(chats).map((c) => ({ id: c.id, chat: c.chat, handler: c.handler })) });
const setMode = (m) => fs.writeFileSync(path.join(CFG, 'mode'), m === 'auto' ? 'auto' : 'ask');
const modeText = () => (mode() === 'auto'
  ? '🟢 Auto-send is ON: Max sends replies itself and you get a copy here.'
  : '🟡 Ask me first: every reply waits for your Send / Edit / Skip.');   // what the owner's next typed message answers: { kind: 'edit', id } | { kind: 'price', lead }

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, body instanceof FormData
    ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) log('telegram', method, j.description || r.status);
  return j.result;
}
const say = (text, extra = {}) => owner && tg('sendMessage', { chat_id: owner, text: text.slice(0, 4000), ...extra });
const buttons = (rows) => ({ reply_markup: { inline_keyboard: rows.map((r) => r.map(([text, data]) => ({ text, callback_data: data }))) } });

async function newDraft({ chat, contact, reply, summary, them }) {
  const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const auto = mode() === 'auto';
  drafts[id] = { chat, contact, reply, at: Date.now(), state: auto ? 'approved' : 'pending' };
  const head = `${auto ? '📤 Sending to' : '💬'} ${chat}${summary ? ` · ${summary}` : ''}\n\n${them ? `Them: ${them.slice(-500)}\n\n` : ''}Max: ${reply}`;
  const m = await say(head, auto ? buttons([[['⏳ sending…', 'noop']]])
    : buttons([[['✅ Send', `s:${id}`], ['✏️ Edit', `e:${id}`], ['✖ Skip', `k:${id}`]]]));
  drafts[id].msg = m?.message_id;
  saveDrafts();
  return id;
}

/* ---------- Who handles each chat ----------
   The first message from a customer asks the owner: Max or them? If they take it, Max stays out of that chat
   (each new message still shows up here, with a button to hand it to Max). In a Max chat, questions only
   he can answer (his orders, his promises), or any message after he replied in the chat himself, come
   to him first: he types the answer and Max sends it in its voice. */
const CHATS = path.join(CFG, 'chats.json');
let chats = {};
try { chats = JSON.parse(fs.readFileSync(CHATS, 'utf8')); } catch {}
const saveChats = () => { fs.writeFileSync(CHATS + '.tmp', JSON.stringify(chats)); fs.renameSync(CHATS + '.tmp', CHATS); };
function chatRec(contact, chat) {
  if (!chats[contact]) chats[contact] = { id: 'c' + Date.now().toString(36), handler: 'ask', chat: chat || contact };
  if (chat) chats[contact].chat = chat;
  return chats[contact];
}
const byId = (id) => Object.entries(chats).find(([, c]) => c.id === id) || [];
// Did the owner type something in this chat themselves? = an "Us" line that isn't one of Max's sent replies.
function ownerSpoke(input) {
  const mine = Object.values(drafts).filter((d) => d.contact === input.contact && ['sent', 'approved'].includes(d.state))
    .map((d) => d.reply.replace(/\s+/g, ' ').slice(0, 50));
  return String(input.history || '').split('\n').some((l) => {
    const m = /^Us(?: \(replying to: .*?\))?: (.*)$/.exec(l.trim());
    return m && !mine.some((t) => m[1].replace(/\s+/g, ' ').startsWith(t));
  });
}
const them = (input) => String(input.text || '').replace(/^Customer: /gm, '').slice(-400);
async function newChatCard(c, input) {
  await say(`🆕 New chat: ${c.chat}\nThem: ${them(input)}\n\nWho handles this one?`,
    buttons([[['🤖 Max handles it', `h:${c.id}:max`], ["🙋 I'll handle it", `h:${c.id}:me`]]]));
}
async function questionCard(c, input, ask) {
  c.ask = ask; saveChats();
  await say(`❓ ${c.chat} needs you: ${ask}\nThem: ${them(input)}\n\nTell me the answer and Max replies to them with it.`,
    buttons([[['✍️ Answer', `q:${c.id}:ans`]], [['🤖 Let Max answer', `q:${c.id}:max`], ["🙋 I'll reply myself", `q:${c.id}:me`]]]));
}
// Run a customer's message through the desk from here (after a button), and draft whatever it says.
async function runFor(contact, input, extra = {}) {
  const c = chats[contact];
  const r = await desk({ ...input, buttons: true, owner_spoke: ownerSpoke(input), ...extra }).catch((e) => ({ error: e.message }));
  if (r.error) return say(`Couldn't get Max's reply for ${c.chat}: ${r.error}`);
  if (r.ask_owner) { c.pending = input; saveChats(); return questionCard(c, input, r.ask_owner); }
  c.pending = null; c.ask = null; saveChats();
  if (r.decision) await decisionCard(r.decision, r.summary, input.text);
  if (r.reply) await newDraft({ chat: c.chat, contact, reply: r.reply, summary: r.summary, them: them(input) });
  else if (!r.decision) await say(`Max has nothing to send ${c.chat} (${r.summary || 'no reply'}).`);
}

// Escalated price: the haggle at a glance, with the owner's answers as buttons.
async function decisionCard(d, summary, them) {
  const rows = [];
  if (d.theirs) rows.push([[`✅ Accept ${money(d.theirs)}`, `a:${d.lead}:${Math.round(d.theirs)}`]]);
  if (d.counter) rows.push([[`↔ Counter ${money(d.counter)}`, `c:${d.lead}:${d.counter}`], [`🔒 ${money(d.counter)} final`, `f:${d.lead}:${d.counter}`]]);
  rows.push([['✍️ My price…', `p:${d.lead}`], ['✖ Decline', `x:${d.lead}`]]);
  await say(`⚠️ Decision · ${d.lead} · ${d.product}\nTheir offer ${money(d.theirs)} · we're at ${money(d.ours)} · floor ${money(d.floor)}\n\n` +
    `${them ? `Them: ${them.slice(-400)}\n` : ''}${summary || ''}`, buttons(rows));
}

// Owner decisions write a message into the sandbox outbox; pull those in as drafts to approve.
async function pullSandboxOutbox() {
  const r = await desk({}, '--outbox').catch(() => ({ items: [] }));
  for (const it of r.items || []) {
    await newDraft({ chat: it.chat || '', contact: it.contact, reply: it.reply, summary: `${it.lead} · your price` });
    await desk({}, `--outbox done ${it.id}`).catch(() => {});
  }
}

async function ownerPrice(lead, price, opts, cbMsg) {
  await say(`Writing to ${lead} at ${money(price)}${opts.firm ? ' (final)' : opts.drop ? ` (can drop ${money(opts.drop)})` : ''}…`);
  const args = `--owner ${lead} ${Math.round(price)} ${opts.firm ? '--firm' : `--negotiable ${Math.round(opts.drop || 0)}`}`;
  const r = await desk({}, args).catch((e) => ({ ok: false, error: e.message }));
  if (!r.ok) return say(`Couldn't do that: ${r.error}`);
  if (r.status === 'agreed') await say(`Deal closed ✓ The quote PDF is on its way.`);
  await pullSandboxOutbox();
}

async function onCallback(q) {
  if (String(q.from.id) !== owner) return tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Not for you.' });
  const [act, a, b] = q.data.split(':');
  if (act === 'm') {
    setMode(a);
    await tg('answerCallbackQuery', { callback_query_id: q.id, text: a === 'auto' ? 'Auto-send on' : 'Ask me first' });
    return tg('editMessageText', { chat_id: owner, message_id: q.message.message_id, text: modeText(), ...modeButtons() });
  }
  const done = (note) => tg('editMessageReplyMarkup', { chat_id: owner, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: note, callback_data: 'noop' }]] } });
  await tg('answerCallbackQuery', { callback_query_id: q.id });
  if (act === 'h' || act === 'q') {
    const [contact, c] = byId(a);
    if (!c) return done('(that chat is gone)');
    if (act === 'h' && b === 'max') {
      c.handler = 'max'; saveChats(); await done(`🤖 Max handles ${c.chat}`);
      return c.pending ? runFor(contact, c.pending) : null;
    }
    if (act === 'h' && b === 'me') { Object.assign(c, { handler: 'me', pending: null }); saveChats(); return done(`🙋 You're handling ${c.chat}; Max stays out`); }
    if (act === 'q' && b === 'ans') { awaiting = { kind: 'answer', contact }; return say(`Your answer for ${c.chat}? Just the facts ("I'll deliver it tomorrow evening"); Max words it.`, { reply_markup: { force_reply: true } }); }
    if (act === 'q' && b === 'max') { await done('🤖 Max answers'); return c.pending && runFor(contact, c.pending, { force: true }); }
    if (act === 'q' && b === 'me') { c.pending = null; saveChats(); return done("🙋 You're replying yourself"); }
  }
  const d = drafts[a];
  if (act === 's' && d && d.state === 'pending') { d.state = 'approved'; saveDrafts(); return done('⏳ sending…'); }
  if (act === 'k' && d && d.state === 'pending') { d.state = 'skipped'; d.done = true; saveDrafts(); return done('✖ skipped'); }
  if (act === 'e' && d && d.state === 'pending') { awaiting = { kind: 'edit', id: a }; return say(`Send me the message for ${d.chat} as you want it sent.`, { reply_markup: { force_reply: true } }); }
  if (act === 'a') { await done(`✅ accepting ${money(b)}`); return ownerPrice(a, Number(b), { firm: true }); }
  if (act === 'c') { await done(`↔ countering ${money(b)}`); return ownerPrice(a, Number(b), { drop: 0 }); }
  if (act === 'f') { await done(`🔒 ${money(b)} final`); return ownerPrice(a, Number(b), { firm: true }); }
  if (act === 'p') { awaiting = { kind: 'price', lead: a }; return say(`Your price for ${a}? e.g. "13800", "13800 drop 300" or "13800 final".`, { reply_markup: { force_reply: true } }); }
  if (act === 'x') {
    await done('✖ declined');
    await sandbox(`~/.hermes/scripts/lead.sh update ${a} status lost`).catch(() => {});
    return say(`${a} marked lost. Nothing was sent to them.`);
  }
}

const modeButtons = () => buttons([[[`${mode() === 'auto' ? '● ' : ''}Auto-send`, 'm:auto'], [`${mode() === 'ask' ? '● ' : ''}Ask me first`, 'm:ask']]]);

async function onText(m) {
  if (String(m.from.id) !== owner) return;
  const t = (m.text || '').trim();
  if (/^\/chats\b/i.test(t)) {   // who handles which chat, with a switch for each
    const list = Object.values(chats).slice(-12);
    if (!list.length) return say('No chats yet.');
    return say('Who handles each chat:', buttons(list.map((c) => [[`${c.handler === 'max' ? '🤖' : c.handler === 'me' ? '🙋' : '❔'} ${c.chat}`, 'noop'],
      [c.handler === 'max' ? '🙋 Me' : '🤖 Max', `h:${c.id}:${c.handler === 'max' ? 'me' : 'max'}`]])));
  }
  if (/^\/(auto|ask|mode|start)\b/i.test(t)) {
    const c = t.slice(1).split(/[\s@]/)[0].toLowerCase();
    if (c === 'auto' || c === 'ask') setMode(c);
    return say(`${c === 'start' ? "Max Desk is ready. Customer replies and price decisions come here.\n\n" : ''}${modeText()}`, modeButtons());
  }
  if (!awaiting) return say('Use the buttons on a draft or a decision. Ask main Max for anything else.');
  const w = awaiting; awaiting = null;
  if (w.kind === 'edit' && drafts[w.id]?.state === 'pending') {
    Object.assign(drafts[w.id], { reply: t, state: 'approved' }); saveDrafts();
    return say(`⏳ Sending your version to ${drafts[w.id].chat}.`);
  }
  if (w.kind === 'answer' && chats[w.contact]?.pending) {
    await say(`Writing to ${chats[w.contact].chat} with your answer…`);
    return runFor(w.contact, chats[w.contact].pending, { owner_answer: t });
  }
  if (w.kind === 'price') {
    const p = /^₹?\s*([\d,]+)\s*(?:(final|firm)|drop\s*₹?\s*([\d,]+))?$/i.exec(t);
    if (!p) { awaiting = w; return say('Send just a number, like "13800", "13800 drop 300" or "13800 final".'); }
    const n = (s) => Number(String(s).replace(/,/g, ''));
    return ownerPrice(w.lead, n(p[1]), { firm: !!p[2], drop: p[3] ? n(p[3]) : 0 });
  }
}

async function poll() {
  let offset = Number(read('tg-offset')) || 0;
  if (!owner) {   // the owner is the first allowed user of main Max's bot (not a secret: a Telegram user id)
    const env = await sandbox('grep -h "^TELEGRAM_ALLOWED_USERS=" ~/.hermes/.env').catch(() => '');
    owner = (env.split('=')[1] || '').split(',')[0].replace(/["'\s]/g, '');
    if (owner) fs.writeFileSync(path.join(CFG, 'owner-chat'), owner);
  }
  log(`desk bot on; owner ${owner ? 'known' : 'UNKNOWN'}`);
  for (;;) {
    try {
      const ups = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }) || [];
      for (const u of ups) {
        offset = u.update_id + 1;
        fs.writeFileSync(path.join(CFG, 'tg-offset'), String(offset));
        if (u.callback_query) await onCallback(u.callback_query).catch((e) => log('callback', e.message));
        else if (u.message?.text) await onText(u.message).catch((e) => log('text', e.message));
      }
    } catch (e) { log('poll', e.message); await new Promise((r) => setTimeout(r, 5000)); }
  }
}
if (TOKEN) {
  poll();
  setInterval(() => pullSandboxOutbox().catch(() => {}), 30000);   // decisions made in the dashboard
}

/* ---------- HTTP ---------- */
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const ROUTES = ['/wa', '/desk', '/outbox/done', '/draft', '/tg/photo', '/tg/text', '/tg/qr', '/answer'];
// The linking QR: one Telegram message, its picture swapped for every new code (they expire in ~20 s).
let qrMsg = null;
async function showQr(png) {
  const f = new FormData();
  const caption = 'WhatsApp on the server needs linking. On your phone: WhatsApp → Linked devices → Link a device → ' +
    'scan this. It refreshes by itself every ~20 seconds; scan whatever is showing.';
  f.append('chat_id', owner);
  if (qrMsg && Date.now() - qrMsg.at < 15 * 60000) {
    f.append('message_id', qrMsg.id);
    f.append('media', JSON.stringify({ type: 'photo', media: 'attach://qr', caption }));
    f.append('qr', new Blob([png], { type: 'image/png' }), 'qr.png');
    if (await tg('editMessageMedia', f)) return true;
  }
  const g = new FormData();
  g.append('chat_id', owner); g.append('caption', caption);
  g.append('photo', new Blob([png], { type: 'image/png' }), 'qr.png');
  const m = await tg('sendPhoto', g);
  if (m) qrMsg = { id: m.message_id, at: Date.now() };
  return !!m;
}
http.createServer((req, res) => {
  if (req.headers['x-desk-key'] !== KEY) return send(res, 401, { error: 'bad key' });
  if (req.method === 'GET' && req.url === '/questions') {   // what the phone rings the owner about: who handles a new chat, or a question only they can answer
    const items = Object.entries(chats).filter(([, c]) => c.pending && (c.handler === 'ask' || c.ask))
      .map(([, c]) => ({ id: c.id, chat: c.chat, kind: c.ask ? 'question' : 'handler', ask: c.ask || '', them: them(c.pending) }));
    return send(res, 200, { items });
  }
  if (req.method === 'GET' && req.url === '/wa') return send(res, 200, waState());
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, bot: !!TOKEN, mode: mode() });
  if (req.method === 'GET' && req.url === '/outbox') {
    if (TOKEN) {   // only what the owner approved; these are sent, not just pasted
      const items = Object.entries(drafts).filter(([, d]) => d.state === 'approved')
        .map(([id, d]) => ({ id, chat: d.chat, contact: d.contact, reply: d.reply, send: true }));
      // chats the owner is handling: the extension never opens or reads them until handed back to Max
      const ignored = [...new Set(Object.entries(chats).filter(([, c]) => c.handler === 'me').flatMap(([k, c]) => [k, c.chat]))];
      return send(res, 200, { items, ignored, settings: waSet() });
    }
    return desk({}, '--outbox').then((r) => send(res, 200, r), (e) => send(res, 502, { error: e.message }));
  }
  if (req.method !== 'POST' || !ROUTES.includes(req.url)) return send(res, 404, { error: 'not found' });
  let body = '';
  const max = req.url.startsWith('/tg/') ? 3e6 : 50000;
  req.on('data', (d) => { body += d; if (body.length > max) req.destroy(); });
  req.on('end', async () => {
    let j;
    try { j = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }); }
    try {
      if (req.url === '/outbox/done') {
        const id = String(j.id || '');
        if (drafts[id]) {
          Object.assign(drafts[id], { state: 'sent', done: true }); saveDrafts();
          if (drafts[id].msg) tg('editMessageReplyMarkup', { chat_id: owner, message_id: drafts[id].msg, reply_markup: { inline_keyboard: [[{ text: '✓ sent', callback_data: 'noop' }]] } });
          return send(res, 200, { ok: true });
        }
        if (!/^L\d{4}-\d+$/.test(id)) return send(res, 400, { error: 'bad id' });
        return send(res, 200, await desk({}, `--outbox done ${id}`));
      }
      if (req.url === '/wa') {   // { set: { enabled, unsavedOnly, selfTest, autoSend } } and/or { chat: id, handler: 'max'|'me' }
        const set = j.set || {};
        const keep = Object.fromEntries(Object.keys(WA_DEFAULTS).filter((k) => typeof set[k] === 'boolean').map((k) => [k, set[k]]));
        if (Object.keys(keep).length) fs.writeFileSync(path.join(CFG, 'extension.json'), JSON.stringify({ ...waSet(), ...keep }));
        if (typeof set.autoSend === 'boolean') setMode(set.autoSend ? 'auto' : 'ask');
        if (j.chat) {
          const [contact, c] = byId(String(j.chat));
          if (!c) return send(res, 404, { error: 'no such chat' });
          if (j.handler === 'me') { Object.assign(c, { handler: 'me', pending: null, ask: null }); saveChats(); Promise.resolve(say(`🙋 You're handling ${c.chat}; Max stays out`)).catch(() => {}); }
          else if (j.handler === 'max') {
            c.handler = 'max'; saveChats(); Promise.resolve(say(`🤖 Max handles ${c.chat}`)).catch(() => {});
            if (c.pending) runFor(contact, c.pending).catch((e) => log('runFor', e.message));
          } else return send(res, 400, { error: 'handler is max or me' });
        }
        return send(res, 200, waState());
      }
      if (!TOKEN && req.url !== '/desk') return send(res, 409, { error: 'no desk bot configured' });
      if (req.url === '/answer') {   // The owner answered on a phone call: { id, handler: 'max'|'me' } or { id, answer }
        const [contact, c] = byId(String(j.id || ''));
        if (!c || !c.pending) return send(res, 404, { error: 'that question is already answered' });
        if (j.skip) { Object.assign(c, { pending: null, ask: null }); saveChats(); return send(res, 200, { ok: true }); }   // "I'll reply myself" to this one
        if (j.handler === 'me') { Object.assign(c, { handler: 'me', pending: null, ask: null }); saveChats(); await say(`🙋 You're handling ${c.chat} (answered on a call)`); return send(res, 200, { ok: true }); }
        if (j.handler === 'max') { c.handler = 'max'; saveChats(); await say(`🤖 Max handles ${c.chat} (answered on a call)`); await runFor(contact, c.pending); return send(res, 200, { ok: true }); }
        const answer = String(j.answer || '').trim().slice(0, 1000);
        if (!answer) return send(res, 400, { error: 'no answer' });
        await say(`Writing to ${c.chat} with your answer (from a call): ${answer}`);
        await runFor(contact, c.pending, { owner_answer: answer });
        return send(res, 200, { ok: true });
      }
      if (req.url === '/draft') return send(res, 200, { id: await newDraft({ chat: String(j.chat || ''), contact: String(j.contact || ''),
        reply: String(j.reply || '').slice(0, 1500), summary: String(j.summary || '').slice(0, 200), them: String(j.text || '') }) });
      if (req.url === '/tg/text') { const sent = await say(String(j.text || '')); return send(res, sent ? 200 : 502, { ok: !!sent }); }
      if (req.url === '/tg/qr') {
        if (j.done) { if (qrMsg) tg('deleteMessage', { chat_id: owner, message_id: qrMsg.id }); qrMsg = null; return send(res, 200, { ok: true }); }
        const ok = await showQr(Buffer.from(String(j.png || ''), 'base64'));
        return send(res, ok ? 200 : 502, { ok });
      }
      if (req.url === '/tg/photo') {
        const f = new FormData();
        f.append('chat_id', owner); f.append('caption', String(j.caption || '').slice(0, 1000));
        f.append('photo', new Blob([Buffer.from(String(j.png || ''), 'base64')], { type: 'image/png' }), 'qr.png');
        const sent = await tg('sendPhoto', f);
        return send(res, sent ? 200 : 502, { ok: !!sent });
      }
      if (!j.contact || !j.text) return send(res, 400, { error: 'contact and text required' });
      const input = { contact: String(j.contact).slice(0, 80), channel: String(j.channel || 'whatsapp').slice(0, 20),
        to: String(j.to || '').slice(0, 40), history: String(j.history || '').slice(-10000), text: String(j.text).slice(0, 3000),
        buttons: !!TOKEN };
      if (TOKEN) {   // who handles this chat? (see "Who handles each chat" above)
        const c = chatRec(input.contact, String(j.chat || '').slice(0, 80));
        if (c.handler !== 'max') {
          const first = !c.pending;
          c.pending = input; saveChats();
          if (c.handler === 'ask' && first) newChatCard(c, input).catch((e) => log('card', e.message));
          if (c.handler === 'me') say(`🙋 ${c.chat} (you're handling it): ${them(input)}`, buttons([[['🤖 Hand to Max', `h:${c.id}:max`]]])).catch(() => {});
          return send(res, 200, { reply: null, summary: c.handler === 'me' ? 'the owner is handling this chat' : 'waiting for the owner: who handles this chat' });
        }
        input.owner_spoke = ownerSpoke(input);
      }
      const r = await desk(input);
      if (TOKEN && r.ask_owner) {
        const c = chats[input.contact];
        c.pending = input; saveChats();
        questionCard(c, input, r.ask_owner).catch((e) => log('card', e.message));
      }
      if (TOKEN && r.decision) decisionCard(r.decision, r.summary, input.text).catch((e) => log('card', e.message));
      else if (TOKEN && r.escalated) say(`⚠️ ${r.summary}\nThem: ${input.text.slice(-400)}`).catch(() => {});
      send(res, 200, r);
    } catch (e) { send(res, 502, { error: e.message }); }
  });
}).listen(Number(PORT), HOST, () => log(`front desk relay on ${HOST}:${PORT}${TOKEN ? ' (desk bot on)' : ''}`));
