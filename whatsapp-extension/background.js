// Max for WhatsApp: the content script hands over new customer messages; this asks Max (over the SSH
// tunnel to the home server) and hands the reply back. One message at a time, so replies never cross.
'use strict';

const DEFAULTS = {
  enabled: false,
  autoSend: false,          // false = paste the reply and let the owner press send
  unsavedOnly: true,        // only chats whose name is a phone number, so friends never reach the AI
  selfTest: false,          // own (You) chat: messages starting with "test:" act as a customer
  apiUrl: 'http://127.0.0.1:18650',   // the front desk relay (customer messages never reach main Max)
  token: '',
  ownerName: '',            // a reply that names the owner is never put in the chat
  businessNumber: '',       // the number customers write to (set in max.config / the popup)
  ignored: [],              // chats the owner is handling (from the relay): never opened or read
  approval: 'paste',        // 'paste' = into the chat for the owner to send (laptop); 'telegram' = a draft to
                            // approve on Telegram, sent from here once approved (server, desk/max-wa.sh)
};
// Optional config.local.json next to the manifest (git-ignored) holds the setup: the front desk's address
// and key. It wins over the popup for those two, so an address or key saved before the front desk existed
// (main Max's API on :18642, which answers /desk with 404) can't linger; the popup still sets everything else.
async function localConfig() {
  try { return await (await fetch(chrome.runtime.getURL('config.local.json'))).json(); } catch { return {}; }
}
const settings = async () => {
  const local = await localConfig();
  const pinned = Object.fromEntries(['apiUrl', 'token'].filter((k) => local[k]).map((k) => [k, local[k]]));
  return { ...DEFAULTS, ...local, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))), ...pinned };
};

async function log(text, level = 'info') {
  const { log: entries = [] } = await chrome.storage.local.get('log');
  entries.unshift({ at: new Date().toLocaleTimeString('en-IN'), text, level });
  await chrome.storage.local.set({ log: entries.slice(0, 40) });
}

function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/48.png', title, message: message.slice(0, 250) });
}

// Customer messages go to the front desk (desk.py behind the server's relay), never to main Max: the desk's
// AI has no tools, and code makes every price and lead decision. Its key is not main Max's key.
async function askDesk(s, payload) {
  const res = await fetch(`${s.apiUrl.replace(/\/+$/, '')}/desk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Desk-Key': s.token },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5 * 60000),   // a stuck request is retried by the content script
  });
  if (!res.ok) throw new Error(`the front desk answered ${res.status}. Is the tunnel running and the key right?`);
  return res.json();   // { reply: string|null, summary, escalated }
}

let queue = Promise.resolve();

// Messages Max starts itself: the owner's answer to an escalated price, decided in the dashboard. The
// content script asks every 30 s; each one is pasted into its chat (sent only with auto-send on) and
// then marked done on the server.
const warned = new Set();
async function pollOutbox(tabId) {
  const s = await settings();
  if (!s.enabled || !s.token) return;
  const base = s.apiUrl.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', 'X-Desk-Key': s.token };
  let items = [];
  try {
    const r = await (await fetch(`${base}/outbox`, { headers })).json();
    items = r.items || [];
    if (Array.isArray(r.ignored)) await chrome.storage.local.set({ ignored: r.ignored });
  } catch { return; }
  const { chats = {} } = await chrome.storage.local.get('chats');
  const done = (id) => fetch(`${base}/outbox/done`, { method: 'POST', headers, body: JSON.stringify({ id }) }).catch(() => {});
  for (const it of items) {
    // the chat's WhatsApp title; the relay may only know the contact ("+91…"), which isn't a chat name
    const chat = (it.chat && it.chat !== it.contact ? it.chat : '') || chats[it.contact];
    if (!chat) {   // never seen this chat here: hand it to the owner instead of guessing
      await log(`${it.contact}: Max's message (paste it yourself): "${it.reply.slice(0, 120)}"`, 'error');
      notify(`Max's reply for ${it.contact} (paste it yourself)`, it.reply);
      await done(it.id);
      continue;
    }
    queue = queue.then(async () => {
      // it.send: the owner approved this exact text on Telegram, so it's sent, not left in the box
      const r = await chrome.tabs.sendMessage(tabId, { type: 'wa.reply', chat, reply: it.reply, autoSend: s.autoSend || !!it.send }).catch((e) => ({ ok: false, error: e.message }));
      if (r?.ok) {
        await done(it.id);
        await log(`${chat}: your decision ${r.sent ? 'sent' : 'pasted (press send)'}: "${it.reply.slice(0, 100)}"`);
        if (!r.sent) notify(`Max drafted your answer for ${chat}`, it.reply);
      } else if (!warned.has(it.id)) {   // retried on the next poll; tell the owner once
        warned.add(it.id);
        await log(`${chat}: couldn't paste your decision yet (${r?.error || 'no answer from the tab'}), will retry`, 'error');
      }
    }).catch(() => {});
  }
}

async function handle({ chat, contact, text, history }, tabId) {
  const s = await settings();
  if (!s.enabled) return false;
  if (!s.token) { await log('No token set: open the extension and paste it.', 'error'); return false; }
  await log(`${chat}: "${text.slice(0, 80)}"`);
  // Which WhatsApp chat is this contact? Needed later to paste a message Max starts itself (outbox).
  const { chats = {} } = await chrome.storage.local.get('chats');
  if (chats[contact] !== chat) { chats[contact] = chat; await chrome.storage.local.set({ chats }); }
  let answer;
  try {
    answer = await askDesk(s, { contact, chat, channel: 'whatsapp', to: s.businessNumber, history: history || '', text });
  } catch (e) {
    await log(`${chat}: couldn't reach the front desk: ${e.message}`, 'error');
    notify('Max for WhatsApp', `Couldn't reach the front desk: ${e.message}`);
    return false;   // not handled: the content script retries later
  }
  const reply = String(answer?.reply || '').trim();
  const summary = String(answer?.summary || '');
  if (!reply) { await log(`${chat}: no reply (${summary.slice(0, 120)})`); return; }
  // Hard check in code, not just a rule for the AI: the owner's name never goes to a client.
  if (s.ownerName && new RegExp(`\\b${s.ownerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(reply)) {
    await log(`${chat}: blocked a reply naming ${s.ownerName}: "${reply.slice(0, 120)}"`, 'error');
    notify('Max for WhatsApp: reply blocked', `It named ${s.ownerName}. Reply to ${chat} yourself.`);
    return;
  }
  if (reply.length > 1200) { await log(`${chat}: reply too long (${reply.length} chars), not pasted`, 'error'); return; }
  if (s.approval === 'telegram') {   // nothing goes out until the owner taps Send on Telegram
    const base = s.apiUrl.replace(/\/+$/, '');
    const ok = await fetch(`${base}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Desk-Key': s.token },
      body: JSON.stringify({ chat, contact, reply, summary, text }) }).then((x) => x.ok, () => false);
    await log(`${chat}: ${ok ? 'draft sent to Telegram for approval' : "couldn't send the draft to Telegram"} · ${summary.slice(0, 100)}`, ok ? 'info' : 'error');
    return ok ? undefined : false;
  }
  const r = await chrome.tabs.sendMessage(tabId, { type: 'wa.reply', chat, reply, autoSend: s.autoSend }).catch((e) => ({ ok: false, error: e.message }));
  if (r?.ok) {
    await log(`${chat}: ${r.sent ? 'sent' : 'pasted (press send)'} · ${summary.slice(0, 120)}`);
    if (!r.sent) notify(`Max drafted a reply for ${chat}`, reply);
  } else {
    await log(`${chat}: couldn't put the reply in the chat: ${r?.error || 'no answer from the WhatsApp tab'}`, 'error');
    notify(`Max's reply for ${chat} (paste it yourself)`, reply);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'wa.incoming' && sender.tab) {
    const tabId = sender.tab.id;
    // "done" carries the message key back; the content script marks it seen only when it was handled.
    queue = queue.then(() => handle(msg, tabId))
      .then((r) => r !== false, (e) => { log(`error: ${e.message}`, 'error'); return true; })
      .then((handled) => chrome.tabs.sendMessage(tabId, { type: 'wa.done', chat: msg.chat, key: msg.key, handled }).catch(() => {}));
    sendResponse({ ok: true });
  } else if (msg.type === 'outbox' && sender.tab) {
    pollOutbox(sender.tab.id);
  } else if (msg.type === 'settings') {
    settings().then(sendResponse);
    return true;
  } else if (msg.type === 'test') {
    settings().then(async (s) => {
      try {
        const res = await fetch(`${s.apiUrl.replace(/\/+$/, '')}/health`, { headers: { 'X-Desk-Key': s.token } });
        sendResponse({ ok: res.ok, status: res.status });
      } catch (e) { sendResponse({ ok: false, error: e.message }); }
    });
    return true;
  } else if (msg.type === 'log') {
    log(msg.text, msg.level);
  }
  return false;
});
