// window.max for the phone: the calls the desktop preload offers (app/preload.js), served by the phone API on the
// home server through the native bridge (an https page can't fetch the plain-HTTP server itself).
'use strict';
(() => {
  const waiting = new Map();
  let n = 0;
  window.__apiDone = (id, ok, payload) => {
    const p = waiting.get(id);
    if (!p) return;
    waiting.delete(id);
    let j;
    try { j = JSON.parse(payload); } catch { j = { error: payload }; }
    ok ? p.resolve(j) : p.reject(new Error(j.error || 'failed'));
  };
  const api = (method, path, body) => new Promise((resolve, reject) => {
    const id = ++n;
    waiting.set(id, { resolve, reject });
    Android.api(id, method, path, body ? JSON.stringify(body) : '');
  });
  const noop = () => {};
  const ask = (messages) => api('POST', '/chat', { messages }).then((r) => r.reply);
  window.max = {
    connect: () => api('GET', '/health'),
    load: () => api('GET', '/data'),
    chat: ask,
    chatStream: (_id, messages) => ask(messages),   // no streaming on the phone: the answer arrives whole
    lead: (a) => api('POST', '/lead', a),
    deskMode: (set) => api('POST', '/desk-mode', { set }).then((r) => r.mode),
    cal: (a) => api('POST', '/cal', a),
    ring: (id) => api('POST', '/ring', { id }),   // phone only: the Setup screen's server tests
    calls: (on) => api('POST', '/calls', { on }).then((r) => r.on),   // phone only: Max's calls on/off
    pc: async () => 'phone',
    voice: () => window.go?.('chat'),   // the core opens Chat (the voice conversation is the call screen)
    onStream: noop, cancelChat: noop, onChatAppend: noop, onPc: noop, win: noop,
  };
  // A still core: the desktop's spinning, blurred rings cost too much on a slow phone.
  window.orbSVG = (cls = '') => `<div class="orb lite ${cls}" role="button" aria-label="Chat with Max">
    <svg viewBox="0 0 200 200" fill="none" stroke="#2fa6d6">
      <circle cx="100" cy="100" r="84" stroke-width="2" stroke-dasharray="60 18 6 18" stroke-opacity=".75"/>
      <circle cx="100" cy="100" r="64" stroke-width="4" stroke-dasharray="2 9" stroke-opacity=".5"/>
      <circle cx="100" cy="100" r="46" stroke-width="1.5" stroke-dasharray="90 40" stroke-opacity=".9"/>
      <circle cx="100" cy="100" r="24" fill="#4fb8e0" fill-opacity=".55" stroke="none"/>
    </svg></div>`;
})();
