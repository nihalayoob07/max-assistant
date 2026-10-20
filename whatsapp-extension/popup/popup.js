'use strict';
const $ = (id) => document.getElementById(id);
const FIELDS = ['enabled', 'unsavedOnly', 'selfTest', 'autoSend', 'apiUrl', 'token', 'ownerName', 'businessNumber'];
const say = (t) => { $('status').textContent = t; };

async function load() {
  const s = await chrome.runtime.sendMessage({ type: 'settings' });
  for (const f of FIELDS) $(f)[$(f).type === 'checkbox' ? 'checked' : 'value'] = s[f];
  renderLog();
}

async function renderLog() {
  const { log = [] } = await chrome.storage.local.get('log');
  $('log').replaceChildren(...log.map((e) => {
    const li = document.createElement('li');
    li.className = e.level;
    const t = document.createElement('time'); t.textContent = e.at;
    li.append(t, e.text);
    return li;
  }));
}

async function save() {
  const s = {};
  for (const f of FIELDS) s[f] = $(f).type === 'checkbox' ? $(f).checked : $(f).value.trim();
  await chrome.storage.local.set(s);
  say('Saved');
}

for (const f of ['enabled', 'unsavedOnly', 'selfTest', 'autoSend']) $(f).addEventListener('change', save);
$('save').addEventListener('click', save);
$('test').addEventListener('click', async () => {
  await save();
  say('Testing…');
  const r = await chrome.runtime.sendMessage({ type: 'test' });
  say(r.ok ? 'Connected to Max' : r.status === 401 ? 'Wrong token' : `Can't reach Max${r.error ? ': ' + r.error : ` (${r.status})`}. Is the tunnel running?`);
});
chrome.storage.onChanged.addListener((c) => { if (c.log) renderLog(); });
load();

// Shows how the open WhatsApp chat's last messages are read (mine/theirs, icons, alignment).
$('debug').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!tab) { say('No WhatsApp Web tab open'); return; }
  const r = await chrome.tabs.sendMessage(tab.id, { type: 'wa.debug' }).catch((e) => ({ error: e.message }));
  if (r.error) { say(`Reload WhatsApp (F5): ${r.error}`); return; }
  const lines = [`debug ${r.title}${r.self ? ' (own chat)' : ''}:`, ...r.rows];
  for (const text of lines.reverse()) await chrome.runtime.sendMessage({ type: 'log', text });
  say('Debug info added to the log below');
});
