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
    ['fullScreen', 'Full-screen calls', 'Lets the call screen open over the lock screen.', p.fullScreen],
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
    <div class="panel"><h2>So Max can call you</h2>
      <div class="cards">${items.map(([k, name, how, ok, manual]) => `
        <div class="card ${ok ? 'new' : 'escalated'}">
          <div class="top"><span class="who">${esc(name)}</span><span class="tag ${ok ? 'green' : 'amber'}">${ok ? 'done' : 'to do'}</span></div>
          <div class="need">${esc(how)}</div>
          <div class="actions">
            <button class="hud ${ok ? '' : 'amber'}" data-setup="${k}">${ok ? 'Open again' : 'Open'}</button>
            ${manual ? `<button class="hud" data-setup-done="${k}">${ok ? 'Not done' : 'I did this'}</button>` : ''}
          </div>
        </div>`).join('')}</div>
    </div>
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
if (setupItems().items.some((i) => !i[3] && !i[4])) go('setup');
