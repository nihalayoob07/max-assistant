// WhatsApp Web side of Max: spot new messages from customers, hand them to the background, and put
// Max's reply in the chat (pasted; sent only when auto-send is on). Chat-opening and row-reading follow
// the Redstone Invoicer extension.
(function () {
  'use strict';
  if (window.__maxWhatsApp) return;
  window.__maxWhatsApp = true;
  const { sleep, norm, waitFor, visibleAll, realClick, log } = window.RS;

  const SEND = '#main footer [data-icon="send"], #main footer [data-icon="wds-ic-send-filled"], #main footer [aria-label="Send"]';
  const MAX_AGE_MIN = 60;   // never answer messages older than this (e.g. a backlog when first switched on)
  // Chats waiting on Max. A request can die (extension reloaded mid-answer), so an entry older than
  // 6 minutes no longer blocks the chat. Unreachable Max -> try that chat again after 2 minutes.
  const inflight = new Map();
  const pending = {
    add: (t) => inflight.set(t, Date.now()),
    delete: (t) => inflight.delete(t),
    has: (t) => inflight.has(t) && Date.now() - inflight.get(t) < 6 * 60000,
  };
  const retryAfter = new Map();
  // A new version starts with a clean "seen" list, so a message lost to the reload gets answered.
  chrome.storage.local.get('seenVersion').then(({ seenVersion }) => {
    const v = chrome.runtime.getManifest().version;
    if (seenVersion !== v) chrome.storage.local.set({ seen: {}, seenVersion: v });
  });

  const isPhone = (s) => /^\+?[\d\s()-]{8,}$/.test(String(s || '').trim());
  const contactOf = (title) => (isPhone(title) ? '+' + title.replace(/\D/g, '') : title.trim());
  const chatKey = (s) => norm(String(s || '').replace(/\(\s*you\s*\)\s*$/i, ''));

  function chatTitle() {
    const h = document.querySelector('#main header');
    return h ? ((h.innerText || '').split('\n').map((s) => s.trim()).find(Boolean) || '') : '';
  }
  // A group's header lists its members ("Ann, Bob, You") under the name.
  function isGroup() {
    const lines = ((document.querySelector('#main header') || {}).innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return lines.slice(1).some((l) => l.includes(','));
  }
  // Own chat: "Alex (You)" in the list, or a header that says "(You)" / "Message yourself".
  const selfHeader = () => /\(\s*you\s*\)|message yourself/i.test(document.querySelector('#main header')?.innerText || '');
  const isSelf = (title) => /\(\s*you\s*\)\s*$/i.test(title || '') || (!!title && chatKey(title) === chatKey(chatTitle()) && selfHeader());
  function eligible(title, s) {
    if (!title) return false;
    if ((s.ignored || []).some((k) => chatKey(k) === chatKey(title))) return false;   // the owner is handling it
    if (isSelf(title)) return !!s.selfTest;   // own chat only in test mode, and only for "test:" messages
    return s.unsavedOnly ? isPhone(title) : true;
  }
  const composing = () => !!(document.querySelector('#main footer [contenteditable="true"]')?.innerText || '').trim();

  // Chat list rows. A row's first line of text is the chat name ("Nuha", then time, then preview);
  // the preview also carries a title attribute, so span[title] alone can't tell them apart.
  const chatRows = () => {
    const items = document.querySelectorAll('#pane-side [role="listitem"]');
    return [...(items.length ? items : document.querySelectorAll('#pane-side [role="row"]'))];
  };
  // First real line; skips WhatsApp's screen-reader labels such as "1 unread message".
  // My own chat's row reads the owner's name with "(You)" on its own line: keep them together so it's recognised.
  const firstLine = (el) => {
    const lines = ((el && el.innerText) || '').split('\n').map((s) => s.trim()).filter((s) => s && !/^\d+ unread messages?$/i.test(s));
    return (lines[0] || '') + (/^\(\s*you\s*\)$/i.test(lines[1] || '') ? ' (You)' : '');
  };

  async function openChat(name) {
    const want = chatKey(name);
    if (chatKey(chatTitle()) === want) return true;
    const row = chatRows().find((r) => chatKey(firstLine(r)) === want);
    if (!row) return false;
    const title = [...row.querySelectorAll('span, div')].reverse().find((e) => chatKey(e.innerText) === want) || row;
    for (let el = title, i = 0; el && i < 10 && !el.matches('#pane-side'); el = el.parentElement, i++) {
      realClick(el, { scroll: false });
      if (await waitFor(() => chatKey(chatTitle()) === want, 1200, 150)) break;
    }
    if (chatKey(chatTitle()) !== want) return false;
    await waitFor(() => document.querySelectorAll('#main [role="row"]').length, 15000);
    await sleep(600);
    return true;
  }

  // Mine or theirs? Only my messages carry delivery ticks, and bubbles have an in/out tail; a quoted
  // message inside a reply has neither (it does carry the quoted message's id, so ids can't be trusted).
  // Last, alignment: my bubbles hug the right edge. A long message of mine reaches past the middle, so
  // compare which edge the bubble is closer to, not where it starts.
  const TICKS = '[data-icon*="dblcheck"], [data-icon*="msg-check"], [data-icon="msg-time"], [data-icon*="status-check"]';
  function align(row) {
    const M = document.querySelector('#main').getBoundingClientRect();
    const r = (row.querySelector('[data-pre-plain-text]') || row).getBoundingClientRect();
    return { right: Math.round(M.right - r.right), left: Math.round(r.left - M.left) };
  }
  function fromMe(row) {
    if (row.querySelector(TICKS)) return true;
    if (row.querySelector('[data-icon="tail-out"], .message-out')) return true;
    if (row.querySelector('[data-icon="tail-in"], .message-in')) return false;
    const a = align(row);
    return a.right < a.left;
  }

  // One-click diagnosis from the popup: how the last few messages of the open chat are read.
  function debugChat() {
    const rows = [...document.querySelectorAll('#main [role="row"]')].slice(-4);
    return {
      title: chatTitle(), self: isSelf(chatTitle()),
      rows: rows.map((row) => {
        const preEl = row.querySelector('[data-pre-plain-text]');
        const icons = [...row.querySelectorAll('[data-icon]')].map((e) => e.getAttribute('data-icon')).join(',');
        return `${fromMe(row) ? 'MINE' : 'THEIRS'} | icons: ${icons || '-'} | edge gap L${align(row).left}/R${align(row).right} | pre: ${(preEl?.getAttribute('data-pre-plain-text') || '-').slice(0, 30)} | "${(row.innerText || '').replace(/\s+/g, ' ').slice(0, 40)}"`;
      }),
    };
  }

  // "[10:42 pm, 17/10/2026] +91 …: " -> Date, or null if WhatsApp's format is different.
  function stamp(pre) {
    const m = /\[(\d{1,2}):(\d{2})\s*([ap]m)?,\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\]/i.exec(pre || '');
    if (!m) return null;
    let h = Number(m[1]) % 12;
    if (!m[3]) h = Number(m[1]); else if (m[3].toLowerCase() === 'pm') h += 12;
    return new Date(Number(m[6]), Number(m[5]) - 1, Number(m[4]), h, Number(m[2]));
  }

  function chatMessages() {
    return [...document.querySelectorAll('#main [role="row"]')].map((row) => {
      const preEl = row.querySelector('[data-pre-plain-text]');
      // A reply quotes the earlier message first; the message's own text is the last text block.
      const texts = preEl ? [...preEl.querySelectorAll('.selectable-text')].filter((e) => !e.parentElement.closest('.selectable-text')) : [];
      const body = texts[texts.length - 1] || preEl;
      const quote = texts.length > 1 ? (texts[0].innerText || '').trim() : '';
      return { pre: preEl?.getAttribute('data-pre-plain-text') || '', text: (body?.innerText || '').trim(), quote, me: fromMe(row) };
    });
  }

  // Max needs the conversation, not just the newest line: the last few messages before the new block,
  // labelled by who said them, and what each new message replies to.
  const HISTORY = 12;
  const clip = (t, n) => (t.length > n ? t.slice(0, n) + '…' : t);
  const asLine = (r, who, text) => `${who}${r.quote ? ` (replying to: "${clip(r.quote, 140)}")` : ''}: ${clip(text, 500)}`;
  function block(rows, start, isCustomer, strip = (t) => t) {
    // A reply to an older message: reach back to that message and the 4 before it, so Max sees what
    // was being answered even when it's further back than the usual window.
    let from = Math.max(0, start - HISTORY);
    for (const r of rows.slice(start)) {
      const q = r.quote.replace(/…$/, '').slice(0, 60);
      if (!q) continue;
      const k = rows.findIndex((x, j) => j < start && strip(x.text).startsWith(q));
      if (k >= 0) from = Math.min(from, Math.max(0, k - 4));
    }
    const history = rows.slice(from, start)
      .map((r) => asLine(r, isCustomer(r) ? 'Customer' : 'Us', strip(r.text))).join('\n');
    const fresh = rows.slice(start);
    const last = fresh[fresh.length - 1];
    return { key: last.pre + last.text, history, text: fresh.map((r) => asLine(r, 'Customer', strip(r.text))).join('\n'), when: stamp(last.pre) };
  }

  // Incoming messages since my last outgoing one, with the conversation before them.
  function newIncoming() {
    const rows = chatMessages().filter((r) => r.text);
    let i = rows.length - 1;
    while (i >= 0 && !rows[i].me) i--;
    return i + 1 < rows.length ? block(rows, i + 1, (r) => !r.me) : null;
  }

  // Test mode, own chat: the trailing run of messages starting with "test:" plays the customer (one
  // block, like a customer's burst). Max's replies never start with "test:", so it can't answer itself.
  function selfTestMessage() {
    const rows = chatMessages().filter((r) => r.text);
    const isTest = (r) => /^test:/i.test(r.text);
    let i = rows.length;
    while (i > 0 && isTest(rows[i - 1])) i--;
    return i < rows.length ? block(rows, i, isTest, (t) => t.replace(/^test:\s*/i, '')) : null;
  }

  // People send a thought as several messages. Wait until the chat has been quiet this long, then
  // send everything since my last sent message to Max as one block, so it answers once.
  const QUIET_MS = 12000;
  const firstSeen = new Map();

  // Returns true when a block went to Max, 'wait' while a burst may still be coming, false otherwise.
  async function considerOpenChat(s) {
    const title = chatTitle();
    if (!eligible(title, s) || isGroup() || pending.has(title)) return false;
    const msg = isSelf(title) ? selfTestMessage() : newIncoming();
    if (!msg) { if (s.selfTest && isSelf(title)) note(`${title}: own chat open, waiting for a "test:" message`); return false; }
    const { seen = {} } = await chrome.storage.local.get('seen');
    if (seen[title] === msg.key) return false;
    if (msg.when && Date.now() - msg.when.getTime() > MAX_AGE_MIN * 60000) {
      seen[title] = msg.key;
      await chrome.storage.local.set({ seen });
      log(`${title}: skipped a message older than ${MAX_AGE_MIN} min`);
      return false;
    }
    const f = firstSeen.get(title);
    if (!f || f.key !== msg.key) { firstSeen.set(title, { key: msg.key, at: Date.now() }); return 'wait'; }
    if (Date.now() - f.at < QUIET_MS) return 'wait';
    if ((retryAfter.get(title) || 0) > Date.now()) return false;
    firstSeen.delete(title);
    pending.add(title);   // marked seen only when the background says it was handled (wa.done)
    const contact = isSelf(title) ? '+910000000000' : contactOf(title);   // test-mode leads stay apart from real ones
    chrome.runtime.sendMessage({ type: 'wa.incoming', chat: title, contact, key: msg.key, text: msg.text.slice(0, 3000), history: msg.history.slice(-10000) });
    return true;
  }

  // Same log line at most once every 5 minutes, so a skipped chat doesn't flood the log.
  const noted = new Map();
  function note(text) {
    if (Date.now() - (noted.get(text) || 0) < 300000) return;
    noted.set(text, Date.now());
    log(text);
  }
  log(`watching WhatsApp Web (v${chrome.runtime.getManifest().version})`);

  let busy = false, lastOutbox = 0;
  async function tick() {
    if (busy || !document.querySelector('#pane-side')) return;
    busy = true;
    try {
      const s = await chrome.runtime.sendMessage({ type: 'settings' }).catch(() => null);
      if (!s?.enabled) return;
      if (Date.now() - lastOutbox > 30000 && !composing()) {   // the owner's decisions, waiting to go to clients
        lastOutbox = Date.now();
        chrome.runtime.sendMessage({ type: 'outbox' }).catch(() => {});
      }
      if (await considerOpenChat(s)) return;   // sent, or waiting out a burst: stay on this chat
      if ([...inflight.keys()].some((t) => pending.has(t))) return;   // one chat at a time: wait for its reply
      if (composing()) return;   // never switch chats while the owner is typing
      for (const badge of visibleAll('#pane-side [aria-label*="unread message" i]')) {
        const row = chatRows().find((r) => r.contains(badge));
        const title = firstLine(row);
        if (!title) { note('found an unread chat but not its name (WhatsApp layout changed?)'); continue; }
        if ((s.ignored || []).some((k) => chatKey(k) === chatKey(title))) continue;   // the owner's; not even a note
        if (!eligible(title, s)) { note(`${title}: skipped (saved contact or own chat; untick "Only unsaved numbers" to include)`); continue; }
        if (pending.has(title)) continue;
        if (await openChat(title)) { await considerOpenChat(s); return; }
        note(`${title}: couldn't open the chat`);
      }
      // Chats already read (no unread bubble) whose last message is theirs (no ticks in the preview)
      // and from the last hour. Each is opened once per new preview, so nothing gets reopened in a loop.
      let opened = 0;
      for (const row of chatRows()) {
        const title = firstLine(row);
        if (!eligible(title, s) || pending.has(title) || row.querySelector(TICKS)) continue;
        const sig = (row.innerText || '').replace(/\s+/g, ' ');
        if (checked.get(title) === sig) continue;
        checked.set(title, sig);
        if (!recentRow(row) || opened++ >= 3) continue;
        if (await openChat(title) && await considerOpenChat(s)) return;
      }
      // Test mode: my own "test:" messages never show as unread (I sent them), and on the server nobody
      // has the chat open, so open my own chat when its preview starts with "test:".
      if (s.selfTest) {
        for (const row of chatRows()) {
          const title = firstLine(row);
          if (!isSelf(title) || pending.has(title) || !/\btest:/i.test(row.innerText || '')) continue;
          const sig = (row.innerText || '').replace(/\s+/g, ' ');
          if (checked.get(title) === sig) continue;
          checked.set(title, sig);
          if (await openChat(title) && await considerOpenChat(s)) return;
        }
      }
    } finally { busy = false; }
  }

  const checked = new Map();
  // The chat list shows "11:14 PM" for today, "Yesterday" or a date otherwise. Within the hour only.
  function recentRow(row) {
    const t = row.innerText || '';
    if (/yesterday|\d{1,2}\/\d{1,2}\/\d{2,4}|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i.test(t)) return false;
    const m = /\b(\d{1,2}):(\d{2})\s*([ap]m)?\b/i.exec(t);
    if (!m) return false;
    let h = Number(m[1]);
    if (m[3]) h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
    const d = new Date(); d.setHours(h, Number(m[2]), 0, 0);
    return Date.now() - d.getTime() < MAX_AGE_MIN * 60000 && Date.now() >= d.getTime() - 60000;
  }
  setInterval(tick, 5000);

  // Max's last pasted (unsent) draft per chat. A newer answer replaces it instead of piling up; text the
  // owner typed is never touched.
  const lastPasted = new Map();
  const squash = (t) => String(t || '').replace(/\s+/g, '');

  async function putReply({ chat, reply, autoSend }) {
    try {
      if (composing() && chatKey(chatTitle()) !== chatKey(chat)) throw new Error('you were typing in another chat');
      if (!(await openChat(chat))) throw new Error(`couldn't open the chat "${chat}"`);
      const box = await waitFor(() => document.querySelector('#main footer [contenteditable="true"]'), 8000);
      if (!box) throw new Error('message box not found');
      if ((box.innerText || '').trim()) {
        if (squash(box.innerText) !== squash(lastPasted.get(chat))) throw new Error('the message box already has text in it');
        box.focus();
        document.execCommand('selectAll');
        document.execCommand('delete');
        if (!(await waitFor(() => !(box.innerText || '').trim(), 2000))) throw new Error("couldn't clear Max's previous draft");
      }
      box.focus();
      const dt = new DataTransfer(); dt.setData('text/plain', reply);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      if (!(await waitFor(() => (box.innerText || '').trim(), 1500))) document.execCommand('insertText', false, reply);
      if (!(await waitFor(() => (box.innerText || '').includes(reply.slice(0, 20)), 3000))) throw new Error("the reply didn't appear in the box");
      lastPasted.set(chat, reply);
      if (!autoSend) return { sent: false };
      lastPasted.delete(chat);
      const btn = await waitFor(() => { const i = document.querySelector(SEND); return i && (i.closest('button, [role="button"]') || i); }, 4000);
      if (!btn) throw new Error('send button not found (the reply is in the box)');
      realClick(btn);
      // Sent = the box emptied after the click (WhatsApp's chat list is virtualised, so counting rows can stay flat)
      const ok = await waitFor(() => !(box.innerText || '').trim(), 8000);
      // Mark our own message as seen, so the next tick doesn't treat the conversation as new.
      const { seen = {} } = await chrome.storage.local.get('seen');
      seen[chat] = (newIncoming() || {}).key || seen[chat];
      await chrome.storage.local.set({ seen });
      return { sent: !!ok };
    } finally {
      pending.delete(chat);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'wa.done') {
      pending.delete(msg.chat);
      if (msg.handled) {
        chrome.storage.local.get('seen').then(({ seen = {} }) => { seen[msg.chat] = msg.key; chrome.storage.local.set({ seen }); });
      } else {
        retryAfter.set(msg.chat, Date.now() + 120000);
      }
      return false;
    }
    if (msg.type === 'wa.debug') { sendResponse(debugChat()); return false; }
    if (msg.type !== 'wa.reply') return false;
    putReply(msg).then((r) => sendResponse({ ok: true, ...r }), (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  });
})();
