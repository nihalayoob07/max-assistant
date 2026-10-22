// Max HUD renderer. Data comes from window.max (preload): load() reads leads/todos/businesses from the
// sandbox, chat() talks to Max, lead() applies an owner decision. Customer text is always escaped.
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (data?.cfg?.currency || '₹') + Number(n || 0).toLocaleString(data?.cfg?.locale || 'en-IN');
const CLOSED = ['paid', 'lost', 'junk'];

let data = null;
let view = 'inbox';
let thinking = false;
let leadFilter = { business: 'all', status: 'all' };
let deskMode = null;   // WhatsApp replies: 'auto' (Max sends) or 'ask' (wait for Send on Telegram)
let chat = [];
try { chat = JSON.parse(localStorage.getItem('chat') || '[]'); } catch { chat = []; }
const saveChat = () => { try { localStorage.setItem('chat', JSON.stringify(chat.slice(-60))); } catch {} };

const orb = (extra = '') => window.orbSVG(`${thinking ? 'thinking' : ''} ${extra}`);

function toast(text, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

function setStatus(kind, text) {
  $('#dot').className = 'dot ' + kind;
  $('#statusText').textContent = text;
}

const today = () => data?.today || new Date().toISOString().slice(0, 10);
const isDue = (l) => l.next && l.next <= today() && !CLOSED.includes(l.status) && l.status !== 'escalated';
// Todos read like "hackathon submission (due 2026-10-30, added 2026-10-18)": a due date puts them on the calendar.
const todoItems = () => (data?.todos || []).map((t) => ({
  title: t.replace(/\s*\((?:due|added)[^)]*\)\s*$/, '') || t, due: (/\(due (\d{4}-\d{2}-\d{2})/.exec(t) || [])[1] || '',
}));
const deadlines = () => todoItems().filter((t) => t.due).map((t) => ({ date: t.due, start: 'due', title: t.title }));
function weekAgo() { const d = new Date(today()); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); }
const statusTag = (s) => `<span class="tag ${{ escalated: 'amber', agreed: 'green', paid: 'green', lost: 'red', junk: 'dim', new: 'green' }[s] || ''}">${esc(s)}</span>`;

/* ---------- Decisions ----------
   A price the front desk handed to you: where the haggle stands, the last few messages, and your answer.
   "Accept" closes at their offer; "Counter" fills in a suggested price you can change; "Send my price"
   has Max tell them on WhatsApp (firm, or with room to come down a little, only as a last resort). */
const precise = (v) => { const p = Math.round(v / 50) * 50; return p % 500 === 0 ? p - 50 : p; };
function chatLines(convo) {
  return String(convo || '').split('\n').map((l) => /^(Customer|Us)(?: \(replying to: .*?\))?: (.*)$/.exec(l.trim()))
    .filter(Boolean).slice(-4).map((m) => ({ us: m[1] === 'Us', text: m[2] }));
}
function decision(l) {
  const d = data?.desk?.[l.id] || {};
  const pol = (data?.businesses || []).find((b) => b.slug === l.business)?.policy.find((p) => p.product === d.product);
  const theirs = d.theirs || l.value || 0;
  const ours = d.pts ? d.pts[d.step || 0] : pol?.list;
  const floor = d.limit || pol?.floor;
  const counter = theirs && ours ? Math.max(precise((theirs + ours) / 2), theirs + 50) : '';
  const id = esc(l.id);
  return `
    <div class="card escalated decision">
      <div class="top">
        <span class="who">${esc(l.contact)}</span>${d.product ? `<span class="tag amber">${esc(d.product)}</span>` : ''}
        <span class="meta">${esc(l.business)}, ${esc(l.channel)}, ${esc(l.updated)} (${id})</span>
      </div>
      <div class="prices">
        <div class="pbox them"><span>Their offer</span><b>${theirs ? money(theirs) : '—'}</b></div>
        <div class="pbox"><span>We're at</span><b>${ours ? money(ours) : '—'}</b></div>
        <div class="pbox dim"><span>${d.limit ? 'Your limit' : 'Floor'}</span><b>${floor ? money(floor) : '—'}</b></div>
        ${theirs && ours ? `<div class="gap">${money(ours - theirs)} apart${floor && theirs < floor ? ` · ${money(floor - theirs)} under the floor` : ''}</div>` : ''}
      </div>
      ${chatLines(d.convo).length ? `<div class="excerpt">${chatLines(d.convo).map((m) => `<div class="line ${m.us ? 'us' : 'them'}"><i>${m.us ? 'Max' : 'Them'}</i>${esc(m.text)}</div>`).join('')}</div>` : `<div class="need">${esc(l.need)}</div>`}
      <div class="actions">
        ${theirs ? `<button class="hud green" data-act="price" data-id="${id}" data-preset="${theirs}" data-preset-firm="1"
          title="Closes the deal at their price; the quote goes to your Telegram">Accept ${money(theirs)}</button>` : ''}
        ${counter ? `<button class="hud" data-fill="${id}" data-value="${counter}" title="Fills in a price halfway between you">Counter ${money(counter)}</button>` : ''}
        <button class="hud" data-ask="${id}">Ask Max</button>
        <button class="hud red" data-act="decline" data-id="${id}">Decline</button>
      </div>
      <div class="actions answer">
        <input class="hud-input" placeholder="Your price…" aria-label="Your price" data-amount="${id}" inputmode="numeric" autocomplete="off" value="${counter}">
        <input class="hud-input" placeholder="Can drop by…" aria-label="Can drop by" data-drop="${id}" inputmode="numeric" autocomplete="off"
          title="How much below your price Max may still go, in small steps and only as a last resort">
        <label class="firm"><input type="checkbox" data-firm="${id}"> Final price</label>
        <button class="hud amber" data-act="price" data-id="${id}"
          title="Max tells them your price on WhatsApp. If their offer already meets it, the deal closes.">Send my price</button>
      </div>
    </div>`;
}

/* ---------- Inbox (home) ---------- */
function inbox() {
  const leads = data?.leads || [];
  const esc8 = leads.filter((l) => l.status === 'escalated');
  const due = leads.filter(isDue);
  const fresh = leads.filter((l) => l.status === 'new' && !isDue(l));
  const won = leads.filter((l) => ['agreed', 'paid'].includes(l.status) && l.updated >= weekAgo()).reduce((s, l) => s + l.value, 0);
  const needs = esc8.length;
  const card = (l, kind) => `
    <div class="card ${kind}">
      <div class="top">
        <span class="who">${esc(l.contact)}</span>${l.value ? `<span class="tag">${money(l.value)}</span>` : ''}
        <span class="meta">${esc(l.business)}, ${esc(l.channel)}, ${esc(l.updated)} (${esc(l.id)})</span>
      </div>
      <div class="need">${esc(l.need)}</div>
      <div class="actions">
        ${kind === 'due' ? `
          <button class="hud amber" data-ask="${esc(l.id)}" data-prompt="Draft a short, polite follow-up message for this client.">Draft follow-up</button>
          <button class="hud" data-act="snooze" data-id="${esc(l.id)}">Snooze 2 days</button>` : ''}
        <button class="hud" data-ask="${esc(l.id)}">Ask Max</button>
        ${kind === 'due' ? `<button class="hud red" data-act="decline" data-id="${esc(l.id)}">Mark lost</button>` : ''}
      </div>
    </div>`;
  // Only sections with something in them show; when all are empty, one line says so.
  const group = (title, items, draw) => items.length
    ? `<section class="group"><h2>${title}<span class="count">${items.length}</span></h2><div class="cards">${items.map(draw).join('')}</div></section>` : '';
  const feed = group('Needs your decision', esc8, decision) + group('Follow-ups due', due, (l) => card(l, 'due')) +
    group('New conversations', fresh, (l) => card(l, 'new'));
  // The next 2 weeks of events and todo deadlines (overdue deadlines stay until done), and every open todo.
  const end = new Date(today() + 'T00:00'); end.setDate(end.getDate() + 14);
  const agenda = [...(data?.events || []), ...deadlines()]
    .filter((e) => e.date <= ymd(end) && (e.date >= today() || e.start === 'due'))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const dayWord = (d) => (d < today() ? 'Overdue' : d === today() ? 'Today' : dayLabel(d));
  const dueTag = (d) => `<span class="tag ${d <= today() ? 'amber' : ''}">${d < today() ? 'Overdue' : d === today() ? 'Due today' : 'Due ' + esc(dayLabel(d))}</span>`;
  return `
    <h1>Inbox</h1>
    <div class="sub">${esc(new Date(today() + 'T00:00').toLocaleDateString(data?.cfg?.locale || 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
    <div class="grid home">
      <aside class="core">
        ${orb()}
        <div class="line">${thinking ? 'Thinking…' : needs ? `${needs} decision${needs > 1 ? 's' : ''} waiting` : 'All clear, sir'}</div>
        <div class="hint">Click the core or press Ctrl+Shift+Space to talk</div>
        <div class="stats">
          <div class="stat ${needs ? 'warn' : ''}"><b>${needs}</b><span>Needs you</span></div>
          <div class="stat"><b>${due.length}</b><span>Follow-ups</span></div>
          <div class="stat"><b>${money(won)}</b><span>Won, 7 days</span></div>
        </div>
        ${deskMode ? `<button class="switch ${deskMode === 'auto' ? 'on' : ''}" id="deskMode" role="switch" aria-checked="${deskMode === 'auto'}"
          title="${deskMode === 'auto' ? 'Max sends WhatsApp replies itself; you get a copy on Telegram' : 'Each WhatsApp reply waits for your Send on Telegram'}">
          <span class="knob"></span><span>WhatsApp auto-send ${deskMode === 'auto' ? 'on' : 'off'}</span></button>` : ''}
        <button class="hud amber brief" data-chip="Brief me">Brief me now</button>
      </aside>
      <div>
        ${feed || '<div class="empty lead"><b>Nothing needs a decision.</b> New leads, follow-ups and price questions show up here.</div>'}
        <div class="grid two ${feed ? 'gap-above' : ''}">
          <section class="panel"><h2>Coming up</h2>
            ${agenda.length ? `<ul class="hudlist agenda">${agenda.map((e) => `<li><span class="when ${e.date < today() ? 'late' : ''}">${esc(dayWord(e.date))}</span>
              <span class="t">${e.start === 'due' ? 'Due' : esc(when(e))}</span><span class="what">${esc(e.title)}</span></li>`).join('')}</ul>`
              : '<div class="empty">Nothing in the next 2 weeks.</div>'}
          </section>
          <section class="panel"><h2>Todos<span class="count">${todoItems().length}</span></h2>
            ${todoItems().length ? `<ul class="hudlist">${todoItems().map((t) => `<li><span class="what">${esc(t.title)}</span>${t.due ? dueTag(t.due) : ''}</li>`).join('')}</ul>`
              : '<div class="empty">Nothing on your list. Tell Max to add something.</div>'}
          </section>
        </div>
      </div>
    </div>`;
}

/* ---------- Chat ---------- */
function chatView() {
  return `
    <div class="chat">
      <div class="chat-head">${orb()}<div><h1 class="flush">Chat</h1><div class="sub">${thinking ? 'Thinking… this can take a minute' : 'Ask anything: captures, research, your businesses.'}</div></div>
        ${chat.length ? '<button class="hud red" id="clearChat">Clear chat</button>' : ''}</div>
      <div class="log" id="log" aria-live="polite">
        ${chat.map((m) => `<div class="msg ${m.role === 'user' ? 'user' : 'max'}${m.err ? ' err' : ''}">${esc(m.content)}</div>`).join('') ||
          '<div class="empty">Try “brief me”, “what’s on my list?” or “how’s business this week?”</div>'}
        ${thinking ? `<div class="msg max live"><div class="steps" id="liveSteps">${(live?.steps || []).map((t) => `<div>${esc(t)}</div>`).join('')}</div><div id="liveText">${esc(live?.text || 'Working on it…')}</div></div>` : ''}
      </div>
      <div>
        <div class="chips gap-below">
          ${['Brief me', "What's on my list?", "How's business this week?", 'Any follow-ups due?'].map((c) => `<button class="hud" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}
        </div>
        <div class="compose">
          <textarea id="input" aria-label="Message Max" placeholder="Message Max… (Shift+Enter for a new line)" ${thinking ? 'disabled' : ''}></textarea>
          <button class="hud amber" id="send" ${thinking ? 'disabled' : ''}>Send</button>
        </div>
      </div>
    </div>`;
}

// "switch pc" / "switch to the server": a plain switch, handled here without asking Max.
const SWITCH = /^\s*(please\s+)?(switch|change|flip)\s+(the\s+)?(pc|computer|machine|device)s?\b|^\s*switch\s+to\s+(the\s+|my\s+)?(laptop|server)\b/i;
const switchTarget = (t) => (/\bserver\b/i.test(t) ? 'server' : /\blaptop\b/i.test(t) ? 'laptop' : 'toggle');
const showPc = (pc) => { $('#pcName').textContent = pc[0].toUpperCase() + pc.slice(1); document.body.dataset.pc = pc; };
window.max.pc('get').then(showPc);
window.max.onPc(showPc);

async function send(text) {
  text = String(text || '').trim();
  if (!text || thinking) return;
  if (SWITCH.test(text)) {
    if ($('#input')) $('#input').value = '';
    const pc = await window.max.pc(switchTarget(text));
    toast(`Now controlling your ${pc}`);
    return;
  }
  chat.push({ role: 'user', content: text });
  saveChat();
  if ($('#input')) $('#input').value = '';   // clear before the redraw, which keeps whatever is typed
  thinking = true;
  setStatus('busy', 'Thinking…');
  go('chat');
  try {
    live = { id: Math.random().toString(36).slice(2), steps: [], text: '' };
    const reply = await window.max.chatStream(live.id, chat.map(({ role, content }) => ({ role, content })));
    chat.push({ role: 'assistant', content: reply || '(no answer)' });
    saveChat();
    setStatus('on', 'Online');
  } catch (e) {
    chat.push({ role: 'assistant', content: `Couldn't reach Max: ${e.message}`, err: true });
    setStatus('off', 'Offline');
  } finally {
    thinking = false;
    live = null;
    render();
    refresh(true);
  }
}

// While Max works, the chat shows its live steps and the answer as it's written (same stream as
// voice mode). Updates touch only the live bubble, so the rest of the screen doesn't redraw.
let live = null;
window.max.onStream((d) => {
  if (!live || d.id !== live.id) return;
  if (d.kind === 'tool' && d.status === 'running') {
    live.steps = [...live.steps, `${String(d.tool || '').replace(/_/g, ' ')}${d.label ? ' · ' + d.label : ''}`].slice(-4);
  } else if (d.kind === 'delta') live.text += d.text;
  const steps = $('#liveSteps'), text = $('#liveText');
  if (!steps || !text) return;
  steps.replaceChildren(...live.steps.map((t) => Object.assign(document.createElement('div'), { textContent: t })));
  text.textContent = live.text || 'Working on it…';
  const log = $('#log'); if (log) log.scrollTop = log.scrollHeight;
});

function askAbout(id, prompt) {
  const l = (data?.leads || []).find((x) => x.id === id);
  if (!l) return;
  go('chat');
  const input = $('#input');
  if (input) {
    input.value = `About lead ${l.id} (${l.business}, ${l.contact} on ${l.channel}, status ${l.status}${l.value ? ', ' + money(l.value) : ''}, need: "${l.need}"): ${prompt || ''}`;
    input.focus();
  }
}

/* ---------- Leads ---------- */
function leadsView() {
  const leads = data?.leads || [];
  const businesses = [...new Set(leads.map((l) => l.business))];
  const statuses = ['new', 'talking', 'escalated', 'agreed', 'paid', 'lost', 'junk'];
  const shown = leads.filter((l) => (leadFilter.business === 'all' || l.business === leadFilter.business) &&
    (leadFilter.status === 'all' || l.status === leadFilter.status)).slice().reverse();
  const open = shown.filter((l) => !CLOSED.includes(l.status) && l.status !== 'agreed').length;
  const won = shown.filter((l) => ['agreed', 'paid'].includes(l.status)).reduce((s, l) => s + l.value, 0);
  const pick = (kind, all, opts) => `<select class="hud-input" data-filter="${kind}" aria-label="Filter by ${kind}">
    ${['all', ...opts].map((v) => `<option value="${esc(v)}" ${leadFilter[kind] === v ? 'selected' : ''}>${v === 'all' ? all : esc(v)}</option>`).join('')}</select>`;
  return `
    <h1>Leads</h1>
    <div class="sub">Every conversation, every business</div>
    <div class="filters">
      ${pick('business', 'All businesses', businesses)}${pick('status', 'Any status', statuses)}
      <div class="totals"><span>Leads<b>${shown.length}</b></span><span>Open<b>${open}</b></span><span>Agreed + paid<b>${money(won)}</b></span></div>
    </div>
    <div class="panel">
      ${shown.length ? `<table>
        <tr><th>Contact</th><th>Business</th><th>Status</th><th class="num">Value</th><th>Next</th><th>Need</th></tr>
        ${shown.map((l) => `<tr><td>${esc(l.contact)}<small>${esc(l.channel)}, ${esc(l.id)}</small></td><td>${esc(l.business)}</td>
          <td>${statusTag(l.status)}</td><td class="num">${l.value ? money(l.value) : '-'}</td><td class="date">${esc(l.next || '-')}</td><td>${esc(l.need)}</td></tr>`).join('')}
      </table>` : '<div class="empty">No leads match these filters.</div>'}
    </div>`;
}

/* ---------- Shield ----------
   What Max's guards caught: customers trying to steer the AI, lowballs it countered or turned down, drafts the
   safety check stopped, escalations handed to you, and risky commands it refused to run without you. */
const SHIELD_KINDS = {
  injection: ['Steering attempt', 'red'], blocked: ['Draft stopped', 'red'], refused: ['Command refused', 'red'],
  lowball: ['Lowball countered', 'amber'], declined: ['Lowball declined', 'amber'], escalated: ['Sent to you', 'dim'],
  owner: ['Your price sent', 'green'], muted: ['Troll muted', 'red'],
};
function shieldView() {
  const items = [...(data?.shield || [])].reverse();
  const count = (k) => items.filter((s) => s.kind === k).length;
  return `
    <h1>Shield</h1>
    <div class="sub">What Max's guards caught. Customer messages are data, never instructions, and risky commands wait for you.</div>
    <div class="stats shield-stats">
      <div class="stat ${count('injection') ? 'warn' : ''}"><b>${count('injection')}</b><span>Steering attempts</span></div>
      <div class="stat"><b>${count('lowball') + count('declined')}</b><span>Lowballs handled</span></div>
      <div class="stat"><b>${count('blocked') + count('refused')}</b><span>Stopped by checks</span></div>
    </div>
    <div class="panel gap-above"><h2>Recent</h2>
      ${items.length ? `<ul class="hudlist">${items.map((s) => {
        const [label, tone] = SHIELD_KINDS[s.kind] || [s.kind, 'dim'];
        return `<li><span class="tag ${tone}">${esc(label)}</span><span class="what">${esc(s.detail)}</span><span class="meta">${esc(s.who)}, ${esc(s.at)}</span></li>`;
      }).join('')}</ul>` : '<div class="empty">Nothing caught yet.</div>'}
    </div>`;
}

/* ---------- Calendar ---------- */
let calMonth = null;   // 'YYYY-MM' shown in the month grid
let calDay = null;     // selected day 'YYYY-MM-DD'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayLabel = (s) => new Date(s + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const when = (e) => (e.start === 'allday' ? 'All day' : e.start + (e.end ? ' to ' + e.end : ''));

// The calendar bubble (top bar): month grid, the picked day's events and todo deadlines, and a quick add.
let calPicked = false;   // you picked a day or month, so stop following today
let calAdd = false;   // the add-event form stays open across redraws once you open it
document.addEventListener('toggle', (e) => {
  if (e.target.id !== 'addWrap') return;
  calAdd = e.target.open;
  if (calAdd) $('#evTitle')?.focus();
}, true);
function calBody() {
  const events = (data?.events || []).slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const dues = deadlines();
  if (!calPicked) { calDay = today(); calMonth = calDay.slice(0, 7); }   // follows today (and its time zone) until you pick
  const [y, m] = calMonth.split('-').map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;      // weeks start on Monday
  const days = new Date(y, m, 0).getDate();
  const busy = new Set(events.map((e) => e.date));
  const due = new Set(dues.map((e) => e.date));
  const cells = [...Array(lead).fill(''), ...Array.from({ length: days }, (_, i) => ymd(new Date(y, m - 1, i + 1)))];
  const row = (e) => `<li class="ev ${e.id ? '' : 'is-due'}"><span class="ev-time">${e.start === 'due' ? 'Due' : esc(when(e))}</span><span class="ev-title">${esc(e.title)}</span>
    ${e.id ? `<button class="ev-rm" data-cal-rm="${esc(e.id)}" aria-label="Delete ${esc(e.title)}" title="Delete">×</button>` : ''}</li>`;
  const dayItems = [...events, ...dues].filter((e) => e.date === calDay);
  const cell = (c) => (c
    ? `<button class="day ${c === calDay ? 'sel' : ''} ${c === today() ? 'now' : ''} ${busy.has(c) ? 'has' : ''} ${due.has(c) ? 'due' : ''} ${[0, 6].includes(new Date(c + 'T00:00').getDay()) ? 'we' : ''}" data-day="${c}">${Number(c.slice(8))}</button>`
    : '<div></div>');
  return `
    <div class="month-head">
      <h2>${MONTHS[m - 1]} <span>${y}</span></h2>
      <button class="cal-nav" data-month="-1" aria-label="Previous month">‹</button>
      <button class="cal-nav" data-month="1" aria-label="Next month">›</button>
    </div>
    <div class="month">
      ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="dow">${d}</div>`).join('')}
      ${cells.map(cell).join('')}
    </div>
    <h3 class="cal-day">${esc(new Date(calDay + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric' }))}</h3>
    ${dayItems.length ? `<ul class="evs">${dayItems.map(row).join('')}</ul>` : '<div class="empty">Nothing on this day.</div>'}
    <details class="add-wrap" id="addWrap" ${calAdd ? 'open' : ''}><summary><span class="o">+ Add event</span><span class="c">Cancel</span></summary>
    <form class="add-ev" id="addEv">
      <input class="hud-input wide" id="evTitle" placeholder="Add an event…" aria-label="Event" autocomplete="off">
      <input class="hud-input" type="date" id="evDate" value="${calDay}" aria-label="Date">
      <input class="hud-input" type="time" id="evTime" aria-label="Start time">
      <input class="hud-input" type="time" id="evEnd" aria-label="End time (optional)">
      <button class="hud amber" type="submit">Add</button>
    </form></details>`;
}

/* ---------- Businesses ----------
   Each business is three files on the server (profile.md, policy.tsv, never.md). The survey below adds one or edits
   one a question at a time; profile lines it doesn't know about ride along in "Anything else", so nothing is lost. */
const BIZ_KEYS = [['sells', 'Sells'], ['website', 'Website'], ['channels', 'Channels'], ['negotiation', 'Negotiation'], ['payment', 'Payment terms'], ['tone', 'Tone']];
const keyLine = (profile, key) => (new RegExp(`^${key}:\\s*(.*)$`, 'mi').exec(profile) || [])[1] || '';
const bizName = (b) => (/^# (.*)$/m.exec(b.profile) || [])[1] || b.slug;

function businessView() {
  return `
    <div class="page-head"><div><h1>Businesses</h1>
      <div class="sub">Profiles and price limits Max works within.</div></div>
      ${window.max.biz ? '<button class="hud amber" data-biz-new>Add business</button>' : ''}</div>
    <div class="grid two">
      ${(data?.businesses || []).map((b) => `
        <div class="panel biz">
          <div class="biz-head"><h3>${esc(bizName(b))}</h3>${window.max.biz ? `<button class="hud mini" data-biz-edit="${esc(b.slug)}">Edit</button>` : ''}</div>
          <div class="sells">${esc(keyLine(b.profile, 'Sells'))}</div>
          <div class="actions gap-below"><span class="tag">Negotiation: ${esc(keyLine(b.profile, 'Negotiation').split(/[.,]/)[0] || '-')}</span></div>
          ${b.policy.length ? `<h2>Price limits</h2><table>
            <tr><th>Product</th><th class="num">List</th><th class="num">Target</th><th class="num">Floor</th><th>Min days</th></tr>
            ${b.policy.map((p) => `<tr><td>${esc(p.product)}</td><td class="num">${money(p.list)}</td><td class="num">${p.target ? money(p.target) : '-'}</td><td class="num">${money(p.floor)}</td><td>${esc(p.lead)}</td></tr>`).join('')}
          </table>` : '<div class="empty">No price list: Max sends price questions to you.</div>'}
          ${((nv) => nv.length ? `<h2>Never agree to</h2><ul class="hudlist">${nv.map((l) => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>` : '')(
            b.never.split('\n').filter((l) => l.startsWith('- ')))}
        </div>`).join('') || '<div class="empty">No businesses yet. Add your first one.</div>'}
    </div>`;
}

const STEPS = [
  { k: 'name', q: "What's the business called?", help: 'The name your customers know.', ph: 'Sunrise Bakery', need: true },
  { k: 'sells', q: 'What do you sell?', help: 'A sentence or two. Max reads this to answer customers.', ph: 'Custom cakes and cupcakes, baked fresh to order.', area: true, need: true },
  { k: 'website', q: 'Do you have a website?', help: 'Optional. Max links customers to it.', ph: 'https://sunrisebakery.example' },
  { k: 'channels', q: 'Where do customers reach you?', help: 'Email and WhatsApp number. With several businesses, this is how Max tells them apart.', ph: 'hello@shop.in, WhatsApp +91 90000 00000', need: true },
  { k: 'payment', q: 'How do customers pay?', help: 'Optional. Printed on quotes and invoices.', ph: '50% advance by UPI, the rest before dispatch.' },
  { k: 'tone', q: 'How should Max sound?', help: 'A few words is enough.', ph: 'Warm, short, helpful. Prices in ₹.', need: true },
  { k: 'negotiation', q: 'Can Max negotiate prices?', help: 'Pick one, or write your own rule.', need: true,
    choices: [['No, fixed prices', 'none. Never discount; price questions come to me.'], ['Yes, within my price list', 'yes, within policy.tsv.']] },
  { k: 'rows', q: 'What are your prices?', help: 'List: what Max quotes first. Floor: the lowest it may ever agree to. Target (optional): where you want to stay. Leave it empty if Max never negotiates.', table: true },
  { k: 'never', q: 'What must Max never agree to?', help: 'One per line. These always come to you instead.', ph: 'Refunds after printing has started\nFree delivery', area: true },
  { k: 'more', q: 'Anything else Max should know?', help: 'FAQs, delivery times, return policy. Optional.', area: true, big: true },
];
const POLICY_NOTES = ['# product\tunit\tlist_price\tfloor_price\tmin_qty\tmin_lead_days\ttarget_price'];
const NEVER_HEAD = '# Never agree to (escalate to the owner instead)';
const COLS = [['product', 'Product'], ['unit', 'Unit'], ['list', 'List'], ['floor', 'Floor'], ['target', 'Target'], ['minQty', 'Min qty'], ['lead', 'Min days']];
let survey = null;   // { slug, isNew, step, f: the answers, err }

function startSurvey(slug) {
  const b = (data?.businesses || []).find((x) => x.slug === slug);
  const f = { name: '', more: '', rows: [], never: '', notes: POLICY_NOTES, neverHead: NEVER_HEAD };
  if (b) {
    const rest = [];
    for (const l of b.profile.replace(/\n+$/, '').split('\n')) {
      const t = /^# (.*)$/.exec(l), k = BIZ_KEYS.find(([key, label]) => f[key] === undefined && l.startsWith(label + ':'));
      if (t && !f.name) f.name = t[1];
      else if (k) f[k[0]] = l.slice(k[1].length + 1).trim();
      else rest.push(l);
    }
    f.name ||= b.slug;
    f.more = rest.join('\n').trim();
    f.rows = b.policy.map((p) => ({ ...p, target: p.target ?? '' }));
    if (b.policyNotes?.length) f.notes = b.policyNotes;
    const nv = b.never.split('\n');
    f.never = nv.filter((l) => l.startsWith('- ')).map((l) => l.slice(2)).join('\n');
    f.neverHead = nv.find((l) => l.startsWith('#')) || NEVER_HEAD;
  }
  survey = { slug: b?.slug || '', isNew: !b, step: 0, f, err: '' };
  go('survey');
}

function surveyView() {
  const s = survey, last = s.step === STEPS.length, st = STEPS[s.step], v = st ? (s.f[st.k] ?? '') : '';
  const money0 = (x) => (x === '' || x == null ? '-' : money(Number(String(x).replace(/[^\d.]/g, ''))));
  let input = '';
  if (st?.table) input = `
      <div class="ptable">
        <div class="prow head">${COLS.map(([, l]) => `<span>${l}</span>`).join('')}<span></span></div>
        ${s.f.rows.map((r, i) => `<div class="prow">${COLS.map(([c, l]) => `<input class="hud-input" data-row="${i}" data-col="${c}" aria-label="${l}"
          value="${esc(r[c] ?? '')}" ${c === 'product' || c === 'unit' ? '' : 'inputmode="numeric"'} autocomplete="off">`).join('')}
          <button class="hud red mini" data-row-rm="${i}" aria-label="Remove ${esc(r.product || 'row')}">Remove</button></div>`).join('')}
      </div>
      <button class="hud" data-row-add>Add a product</button>`;
  else if (st?.choices) input = `
      <div class="choices">${st.choices.map(([label, rule]) => `<button class="choice ${v === rule ? 'on' : ''}" data-choice="${esc(rule)}">${label}<small>${esc(rule)}</small></button>`).join('')}</div>
      <input class="hud-input q-in" data-f="${st.k}" value="${esc(v)}" aria-label="Your own rule" placeholder="Or write your own rule…" autocomplete="off">`;
  else if (st?.area) input = `<textarea class="hud-input q-in ${st.big ? 'big' : ''}" data-f="${st.k}" aria-label="${esc(st.q)}" placeholder="${esc(st.ph || '')}">${esc(v)}</textarea>`;
  else if (st) input = `<input class="hud-input q-in" data-f="${st.k}" value="${esc(v)}" aria-label="${esc(st.q)}" placeholder="${esc(st.ph || '')}" autocomplete="off">`;
  const review = !last ? '' : `<dl class="review">${STEPS.map((x, i) => `<div><dt>${esc(x.q)}</dt><dd>${esc(x.table
    ? (s.f.rows.length ? s.f.rows.map((r) => `${r.product} ${money0(r.list)} (floor ${money0(r.floor)})`).join(', ') : 'No price list')
    : (s.f[x.k] || '-'))}</dd><button class="hud mini" data-goto="${i}">Change</button></div>`).join('')}</dl>`;
  return `
    <div class="survey">
      <div class="survey-top"><button class="hud mini red" data-survey-cancel>Cancel</button>
        <progress max="${STEPS.length}" value="${s.step}" aria-label="Progress"></progress>
        <span class="count">${last ? 'Review' : `${s.step + 1} of ${STEPS.length}`}</span></div>
      <div class="q-page">
        <div class="q-kicker">${s.isNew ? 'New business' : esc(s.f.name || s.slug)}</div>
        <h1>${last ? 'Check it over' : esc(st.q)}</h1>
        <p class="sub">${last ? 'Save to hand it to Max. It uses it straight away.' : esc(st.help)}</p>
        ${input}${review}
        <div class="q-err" aria-live="polite">${esc(s.err)}</div>
        <div class="actions q-nav">
          ${s.step ? '<button class="hud" data-survey="back">Back</button>' : ''}
          <button class="hud amber" data-survey="${last ? 'save' : 'next'}">${last ? (s.isNew ? 'Add business' : 'Save changes') : 'Next'}</button>
          ${last ? '' : `<span class="q-hint">${st.area ? 'Ctrl+Enter' : 'Enter'} for next</span>`}
        </div>
      </div>
    </div>`;
}

// Copy what's on screen into the answers, then check this page. Returns an error message, or ''.
function grabSurvey() {
  const s = survey, st = STEPS[s.step];
  document.querySelectorAll('[data-f]').forEach((el) => { s.f[el.dataset.f] = el.value.trim(); });
  document.querySelectorAll('[data-row]').forEach((el) => { s.f.rows[el.dataset.row][el.dataset.col] = el.value.trim(); });
  if (!st) return '';
  if (st.need && !s.f[st.k]) return 'Fill this in to continue.';
  if (st.k === 'name' && s.isNew) {
    s.slug = s.f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!s.slug) return 'Use at least one letter or digit in the name.';
    if ((data?.businesses || []).some((b) => b.slug === s.slug)) return 'You already have a business with this name.';
  }
  if (st.table) {
    const n = (x) => Number(String(x ?? '').replace(/[^\d.]/g, ''));
    s.f.rows = s.f.rows.filter((r) => COLS.some(([c]) => String(r[c] ?? '').trim()));
    for (const r of s.f.rows) {
      if (!r.product) return 'Every row needs a product name.';
      if (!(n(r.list) > 0) || !(n(r.floor) > 0)) return `${r.product}: fill in the list and floor prices.`;
      if (n(r.floor) > n(r.list)) return `${r.product}: the floor can't be above the list price.`;
      if (String(r.target ?? '') !== '' && (n(r.target) < n(r.floor) || n(r.target) > n(r.list))) return `${r.product}: the target goes between the floor and the list price.`;
    }
  }
  return '';
}

async function saveSurvey(btn) {
  const f = survey.f, one = (x) => String(x ?? '').replace(/\s*\n\s*/g, ' ').trim();
  const num = (x) => String(x ?? '').replace(/[^\d.]/g, '');
  const files = {
    'profile.md': `# ${one(f.name)}\n\n${BIZ_KEYS.filter(([k]) => one(f[k])).map(([k, label]) => `${label}: ${one(f[k])}`).join('\n')}\n${f.more ? '\n' + f.more + '\n' : ''}`,
    'policy.tsv': [...f.notes, ...f.rows.map((r) => [one(r.product), one(r.unit) || 'piece', num(r.list), num(r.floor), num(r.minQty) || '1', num(r.lead) || '0', num(r.target)]
      .join('\t').replace(/\t$/, ''))].join('\n') + '\n',
    'never.md': [f.neverHead, ...f.never.split('\n').map(one).filter(Boolean).map((l) => '- ' + l)].join('\n') + '\n',
  };
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await window.max.biz({ slug: survey.slug, files });
    toast(`${one(f.name)} saved. Max uses it from now on.`);
    survey = null;
    await refresh();
    go('business');
  } catch (err) {
    survey.err = err.message.replace(/^Error invoking remote method '\w+': (Error: )?/, '');
    render();
  }
}

/* ---------- Plumbing ---------- */
const VIEWS = { inbox, chat: chatView, leads: leadsView, shield: shieldView, business: businessView, survey: surveyView };

function render() {
  const main = $('#view');
  const keep = $('#input')?.value;
  main.innerHTML = VIEWS[view]();
  // Entrance animation only when the page (or survey question) changes, not on the background refresh.
  const page = view === 'survey' ? `survey${survey?.step}` : view;
  if (main.dataset.page !== page) {
    main.classList.toggle('back', view === 'survey' && Number(main.dataset.page?.slice(6)) > survey?.step);
    main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
    main.dataset.page = page;
  }
  document.querySelectorAll('.rail button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#setBtn')?.classList.toggle('active', ['shield', 'business', 'survey'].includes(view));
  const cal = $('#calPop');   // desktop only; left alone while you're typing an event into it
  if (cal && !document.activeElement?.matches('#calPop input')) cal.innerHTML = calBody();
  const n = (data?.leads || []).filter((l) => l.status === 'escalated').length;
  $('#badge').hidden = !n;
  $('#badge').textContent = n;
  if (view === 'survey') ($('.q-in') || [...document.querySelectorAll('[data-col="product"]')].pop())?.focus();
  if (view === 'chat') {
    const log = $('#log'); log.scrollTop = log.scrollHeight;
    if (keep && $('#input')) $('#input').value = keep;
    if (!matchMedia('(pointer: coarse)').matches) $('#input')?.focus();   // no keyboard popping up on a phone
  }
}
function go(v) { view = v; render(); }

async function refresh(quiet = false) {
  try {
    data = await window.max.load();
    deskMode = await window.max.deskMode().catch(() => deskMode);
    if (!thinking) setStatus('on', 'Online');
    if (!(view === 'chat' && $('#input')?.value) && view !== 'survey') render();   // never wipe half-typed answers
  } catch (e) {
    setStatus('off', 'Offline');
    if (!quiet) toast(`Couldn't read from the server: ${e.message}`, true);
  }
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('.orb')) return window.max.voice('open');   // the core opens voice mode
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.win) return window.max.win(t.dataset.win);
  if (t.id === 'pcPill') { const pc = await window.max.pc('toggle'); return toast(`Now controlling your ${pc}`); }
  if (t.dataset.view) { if (t.closest('#setPop')) $('#setPop').hidePopover?.(); return go(t.dataset.view); }
  if (t.dataset.bizNew !== undefined) return startSurvey(null);
  if (t.dataset.bizEdit) return startSurvey(t.dataset.bizEdit);
  if (t.dataset.surveyCancel !== undefined) { survey = null; return go('business'); }
  if (survey && (t.dataset.survey || t.dataset.goto || t.dataset.choice || t.dataset.rowAdd !== undefined || t.dataset.rowRm)) {
    const err = grabSurvey();
    if (t.dataset.survey === 'save') return saveSurvey(t);
    if (t.dataset.survey === 'next' && err) { survey.err = err; return render(); }
    survey.err = '';
    if (t.dataset.survey) survey.step += t.dataset.survey === 'next' ? 1 : -1;
    if (t.dataset.goto) survey.step = Number(t.dataset.goto);
    if (t.dataset.choice) survey.f[STEPS[survey.step].k] = t.dataset.choice;
    if (t.dataset.rowAdd !== undefined) survey.f.rows.push({ product: '', unit: '', list: '', floor: '', target: '', minQty: '', lead: '' });
    if (t.dataset.rowRm) survey.f.rows.splice(Number(t.dataset.rowRm), 1);
    return render();
  }
  if (t.dataset.chip) return send(t.dataset.chip);
  if (t.dataset.ask) return askAbout(t.dataset.ask, t.dataset.prompt);
  if (t.dataset.reload !== undefined) return location.reload();
  if (t.dataset.day) { calDay = t.dataset.day; calPicked = true; return render(); }
  if (t.dataset.month) {
    const [y, m] = calMonth.split('-').map(Number);
    calMonth = ymd(new Date(y, m - 1 + Number(t.dataset.month), 1)).slice(0, 7); calPicked = true;
    return render();
  }
  if (t.dataset.calRm) {
    t.disabled = true;
    try { await window.max.cal({ action: 'rm', id: t.dataset.calRm }); toast('Event removed'); await refresh(); }
    catch (err) { toast(err.message.replace(/^Error invoking remote method '\w+': (Error: )?/, ''), true); t.disabled = false; }
    return;
  }
  if (t.id === 'send') return send($('#input').value);
  if (t.closest('#deskMode')) {
    try {
      deskMode = await window.max.deskMode(deskMode === 'auto' ? 'ask' : 'auto');
      toast(deskMode === 'auto' ? 'Auto-send ON: Max sends WhatsApp replies itself' : 'Auto-send OFF: replies wait for your Send on Telegram');
      render();
    } catch (err) { toast(err.message.replace(/^Error invoking remote method '\w+': (Error: )?/, ''), true); }
    return;
  }
  if (t.id === 'clearChat') { chat = []; saveChat(); return render(); }
  if (t.dataset.fill) {
    const box = document.querySelector(`[data-amount="${t.dataset.fill}"]`);
    if (box) { box.value = t.dataset.value; box.focus(); }
    return;
  }
  if (t.dataset.act) {
    const id = t.dataset.id;
    const num = (sel) => (document.querySelector(sel)?.value || '').replace(/[^\d.]/g, '');
    const value = t.dataset.act === 'price' ? (t.dataset.preset || num(`[data-amount="${id}"]`)) : '';
    const negotiable = t.dataset.preset ? '' : num(`[data-drop="${id}"]`);
    const firm = !!t.dataset.presetFirm || !!document.querySelector(`[data-firm="${id}"]`)?.checked;
    t.disabled = true;
    if (t.dataset.act === 'price') t.textContent = 'Writing to them…';
    try {
      const r = await window.max.lead({ id, action: t.dataset.act, value, negotiable, firm });
      toast(r?.reply ? `${id}: ${r.status === 'agreed' ? 'deal closed, ' : ''}message queued for WhatsApp: "${r.reply.slice(0, 90)}"` : `${id}: ${t.textContent.trim().toLowerCase()} ✓`);
      await refresh();
    } catch (err) {
      toast(err.message.replace(/^Error invoking remote method '\w+': (Error: )?/, ''), true);
      t.disabled = false;
    }
  }
});
document.addEventListener('change', (e) => {
  if (e.target.dataset.filter) { leadFilter[e.target.dataset.filter] = e.target.value; render(); }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'addEv') return;
  e.preventDefault();
  const v = (id) => document.getElementById(id).value.trim();
  const a = { action: 'add', date: v('evDate'), time: v('evTime'), end: v('evEnd'), title: v('evTitle') };
  try {
    await window.max.cal(a);
    calDay = a.date; calMonth = a.date.slice(0, 7); calAdd = false; calPicked = true;
    document.activeElement?.blur();   // so the bubble redraws with the new event
    toast('Added to your calendar');
    await refresh();
  } catch (err) { toast(err.message.replace(/^Error invoking remote method '\w+': (Error: )?/, ''), true); }
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('.orb') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return window.max.voice('open'); }
  if (e.target.id === 'input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e.target.value); }
  // Survey: Enter (Ctrl+Enter in a text box) goes to the next question.
  if (view === 'survey' && e.key === 'Enter' && e.target.matches('.q-in, [data-row]') && (e.ctrlKey || e.target.tagName !== 'TEXTAREA')) {
    e.preventDefault(); $('[data-survey="next"]')?.click();
  }
});

// Voice turns show up in the chat log too.
window.max.onChatAppend((m) => { chat.push(m); saveChat(); if (view === 'chat') render(); });

// The title-bar clock (desktop only: the phone shows its own).
if ($('#clock')) {
  const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString(data?.cfg?.locale || undefined, { timeZone: data?.cfg?.tz || undefined, hour12: false }); };
  setInterval(tick, 1000); tick();
}

async function boot() {
  $('#view').innerHTML = `<div class="boot"><div>${orb('thinking')}<p>Waking Max up…</p></div></div>`;
  setStatus('busy', 'Connecting…');
  try {
    await window.max.connect();
    await refresh();
    setInterval(() => refresh(true), 60000);
  } catch (e) {
    setStatus('off', 'Offline');
    $('#view').innerHTML = `<div class="boot"><div>${orb()}<p class="err">Couldn't reach Max: ${esc(e.message)}</p>
      <p>Check the home server is on and reachable, then try again.</p><button class="hud amber" data-reload>Try again</button></div></div>`;
  }
}
boot();
