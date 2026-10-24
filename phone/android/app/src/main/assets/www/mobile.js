// Phone-only additions to the desktop dashboard (app.js): the Setup checklist that lets Max ring through a
// Vivo's battery savers and the lock screen, and a refresh when the app comes back to the front.
'use strict';
const SETUP_DONE = (k) => { try { return localStorage.getItem('setup:' + k) === '1'; } catch { return false; } };
let serverOk = null;

function setupItems() {
  let p = {};
  try { p = JSON.parse(Android.permissions()); } catch {}
  const items = [
    ['mic', 'Microphone', 'So you can answer Max by voice on a call.', p.mic],
    ['notifications', 'Notifications', 'Calls arrive as a notification first.', p.notifications],
    ['fullScreen', 'Full-screen calls', 'Lets the call screen pop up over other apps and the lock screen ("Display over other apps").', p.fullScreen],
    ['battery', 'Battery optimisation off', 'Choose “Allow”, so Android never puts Max to sleep.', p.battery],
  ];
  if (p.vivo) items.push(
    ['autostart', 'Vivo: Autostart', 'Turn Max on in the Autostart list, so pushes can wake it.', SETUP_DONE('autostart'), true],
    ['bgpower', 'Vivo: High background power', 'Battery → High background power consumption → turn Max on.', SETUP_DONE('bgpower'), true],
    ['lockscreen', 'Vivo: Lock screen & pop-ups', 'In Max’s permissions, allow “Display on lock screen” and “Display pop-up windows”.', SETUP_DONE('lockscreen'), true],
  );
  items.push(['speech', 'Offline English voice', 'Download English (India) for offline speech: faster and private.', SETUP_DONE('speech'), true]);
  return { p, items };
}

function setupView() {
  const { p, items } = setupItems();
  const left = items.filter((i) => !i[3]).length;
  if (serverOk === null) window.max.connect().then(() => { serverOk = true; }, () => { serverOk = false; }).finally(() => view === 'setup' && render());
  return `
    <h1>Setup</h1>
    <div class="sub">${left ? `${left} step${left > 1 ? 's' : ''} left so Max can ring you` : 'All set: Max can ring you'}</div>
    <section class="group"><h2>So Max can call you</h2>
      <div class="cards">${items.map(([k, name, how, ok, manual]) => `
        <div class="card ${ok ? 'new' : 'escalated'}">
          <div class="top"><span class="who">${esc(name)}</span><span class="tag ${ok ? 'green' : 'amber'}">${ok ? 'done' : 'to do'}</span></div>
          <div class="need">${esc(how)}</div>
          <div class="actions">
            <button class="hud ${ok ? '' : 'amber'}" data-setup="${k}">${ok ? 'Open again' : 'Open'}</button>
            ${manual ? `<button class="hud" data-setup-done="${k}">${ok ? 'Not done' : 'I did this'}</button>` : ''}
          </div>
        </div>`).join('')}</div>
    </section>
    <div class="panel gap-above"><h2>Connection</h2>
      <ul class="hudlist">
        <li>Home server: <span class="tag ${serverOk ? 'green' : serverOk === false ? 'red' : 'dim'}">${serverOk ? 'reachable' : serverOk === false ? 'not reachable (Tailscale on?)' : 'checking…'}</span></li>
        <li>Push (Firebase): <span class="tag ${p.push ? 'green' : 'red'}">${p.push ? 'set up' : 'not in this build yet'}</span>
          <span class="tag ${p.registered ? 'green' : 'amber'}">${p.registered ? 'phone registered' : 'not registered'}</span></li>
      </ul>
      <div class="actions gap-above">
        <button class="hud amber" data-test-call="local">Test call in 8 s (lock the screen)</button>
        <button class="hud" data-test-call="server">Ring me from the server</button>
        <button class="hud" data-test-call="brief">Morning brief now</button>
        ${p.push && !p.registered ? '<button class="hud" data-register>Register this phone</button>' : ''}
      </div>
    </div>`;
}
VIEWS.setup = setupView;

// Inbox: call Max yourself, and switch Max's calls off (college, meetings). While off, deals and desk questions
// wait and ring once calls are back on; Telegram still gets every alert.
const callsBar = () => {
  const on = data?.callsOn !== false;
  return `<div class="panel callbar">
      <button class="hud amber" data-call-max>Call Max</button>
      <button class="hud" data-remote>Remote</button>
      <button class="switch ${on ? 'on' : ''}" data-calls role="switch" aria-checked="${on}">
        <span class="knob"></span><span>Max's calls ${on ? 'on' : 'off (Telegram only)'}</span></button>
    </div>`;
};
const inboxView = VIEWS.inbox;
VIEWS.inbox = () => inboxView().replace('<div class="grid home">', callsBar() + '<div class="grid home">');

// Old Android WebViews have no popovers: the top-bar buttons open the bubbles with a class instead.
if (!HTMLElement.prototype.showPopover) {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[popovertarget]'), inside = e.target.closest('.pop');
    document.querySelectorAll('.pop.open').forEach((p) => { if (p !== inside && p.id !== btn?.getAttribute('popovertarget')) p.classList.remove('open'); });
    if (btn) document.getElementById(btn.getAttribute('popovertarget')).classList.toggle('open');
    if (e.target.closest('.pop [data-view]')) inside.classList.remove('open');
  }, true);
}

const testLead = () => (data?.leads || []).find((l) => l.status === 'escalated')?.id || (data?.leads || []).slice(-1)[0]?.id || 'L0002';
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.setup) return Android.request(t.dataset.setup);
  if (t.dataset.setupDone) {
    const k = 'setup:' + t.dataset.setupDone;
    try { SETUP_DONE(t.dataset.setupDone) ? localStorage.removeItem(k) : localStorage.setItem(k, '1'); } catch {}
    return render();
  }
  if (t.dataset.register !== undefined) { Android.register(); return toast('Registering…'); }
  if (t.dataset.callMax !== undefined) return Android.callMax();
  if (t.dataset.remote !== undefined) return remoteOpen();
  if (t.dataset.calls !== undefined) {
    try {
      data.callsOn = await window.max.calls(data.callsOn === false);
      toast(data.callsOn ? 'Calls ON: Max rings you again' : 'Calls OFF: Max only messages you on Telegram');
      render();
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (t.dataset.testCall === 'local') { Android.testCall(testLead(), 8); return toast('Lock the screen now: Max rings in 8 seconds'); }
  if (t.dataset.testCall === 'brief') {
    try { await window.max.ring(`brief:${data?.today || new Date().toISOString().slice(0, 10)}`); toast('Max will call you with the brief…'); } catch (err) { toast(err.message, true); }
    return;
  }
  if (t.dataset.testCall === 'server') {
    try { await window.max.ring(testLead()); toast('Ringing through Firebase…'); } catch (err) { toast(err.message, true); }
  }
});

window.maxNative = { onResume() { serverOk = null; if (view === 'setup') render(); else refresh(true); } };

// First run: open on Setup until the must-haves are done.
if (location.hash === '#chat') go('chat');   // "Chat" on a ringing call
else if (setupItems().items.some((i) => !i[3] && !i[4])) go('setup');

// Remote: the phone as the microphone for Max on the laptop. Nothing runs here: the phone's recogniser (better than the
// laptop's Whisper at hearing you) turns speech into words and the server hands them to the laptop app, which acts as
// if you'd said "Max, …" there. One tap, one request; tap the mic again for the next.
const remoteEl = document.createElement('div');
remoteEl.className = 'remote';
remoteEl.hidden = true;
remoteEl.innerHTML = `<div class="remote-box">
    <div class="remote-head"><b>Remote</b><span>talking to Max on the laptop</span></div>
    <div class="remote-said" id="remoteSaid"></div>
    <div class="remote-status" id="remoteStatus"></div>
    <button class="remote-mic" id="remoteMic" aria-label="Talk to Max on the laptop">
      <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>
    <ul class="remote-log" id="remoteLog"></ul>
    <button class="hud" id="remoteClose">Close</button>
  </div>`;
document.body.append(remoteEl);
const $r = (id) => document.getElementById(id);
let remoteBusy = false;
function remoteStatus(text, cls = '') { $r('remoteStatus').textContent = text; $r('remoteStatus').className = 'remote-status ' + cls; }
function remoteListen() {
  if (remoteBusy) return;
  $r('remoteSaid').textContent = '';
  remoteEl.classList.add('listening');
  remoteStatus('Listening…');
  window.max.remoteHold().catch(() => {});   // the laptop stops listening meanwhile, so it doesn't answer too
  Android.remoteListen();
}
function remoteOpen() { remoteEl.hidden = false; remoteListen(); }
window.__remote = async (kind, text) => {
  if (remoteEl.hidden) return;
  if (kind === 'ready') return remoteStatus('Speak now');
  if (kind === 'hearing') return remoteStatus('Hearing you…');
  if (kind === 'partial') { $r('remoteSaid').textContent = text; return; }
  remoteEl.classList.remove('listening');
  if (kind === 'error' || !text.trim()) return remoteStatus(text || "Didn't catch that. Tap the mic and try again", 'bad');
  $r('remoteSaid').textContent = text;
  remoteBusy = true;
  remoteStatus('Sending to the laptop…');
  try {
    await window.max.remote(text);
    remoteStatus('Sent. Max on the laptop is on it.', 'ok');
    const li = document.createElement('li');
    li.textContent = text;
    $r('remoteLog').prepend(li);
    while ($r('remoteLog').children.length > 5) $r('remoteLog').lastChild.remove();
  } catch (e) { remoteStatus(String(e.message || e), 'bad'); }
  remoteBusy = false;
};
$r('remoteMic').addEventListener('click', remoteListen);
$r('remoteClose').addEventListener('click', () => { Android.remoteStop(); remoteEl.classList.remove('listening'); remoteEl.hidden = true; });
