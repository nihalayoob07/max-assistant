// Instant answers: common questions answered straight from the dashboard data in well under a second, instead of a
// round trip to Max's model (a minute or more when NVIDIA's hosted queue is busy). Used by the desktop app (main.js)
// and the phone API on the server (phone/phone-api.js). Only short, whole questions match; anything with more to it
// ("add milk to my list", "how's business this week?") still goes to Max. Pure functions, so they're testable.
'use strict';

const hm12 = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const list = (a) => (a.length <= 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
const person = (c) => (/^\+?\d[\d\s-]{6,}$/.test(String(c || '')) ? 'a client' : c);
const dayName = (d) => new Date(d + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
const addDays = (d, n) => { const x = new Date(d + 'T00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const todoItems = (todos) => todos.map((t) => ({ title: t.replace(/\s*\((due|added)[^)]*\)/g, '').trim(), due: (/\(due (\d{4}-\d{2}-\d{2})/.exec(t) || [])[1] || '' }));
const greet = (owner, now) => { const h = now.getHours(); return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}${owner ? ` ${owner}` : ''}, it's Max.`; };

// The day in a few sentences, from the dashboard data and any shop's orders table (skills/shop-orders).
function brief(data, orders = [], owner = '', hello = `Good morning${owner ? ` ${owner}` : ''}, it's Max.`) {
  const today = data.today;
  const s = [`${hello} Here's your day.`];
  const shops = [...new Set(orders.map((o) => o.shop))], shop = shops.length === 1 && shops[0] ? `${shops[0]}: ` : '';
  const toPrint = orders.filter((o) => o.status === 'paid'), printing = orders.filter((o) => o.status === 'printing');
  const unpaid = orders.filter((o) => o.status === 'pending');
  if (toPrint.length) s.push(`${shop}${plural(toPrint.length, 'order')} to make. ${toPrint.slice(0, 3).map((o) => `${o.items} for ${o.customer.split(' ')[0]}, from ${o.placed.split(/ \d{4}/)[0]}`).join('. ')}${toPrint.length > 3 ? ', and more' : ''}.`);
  if (printing.length) s.push(`${plural(printing.length, 'order')} still printing.`);
  if (unpaid.length) s.push(`${plural(unpaid.length, 'order')} waiting for payment.`);
  if (orders.length && !toPrint.length && !printing.length) s.push(`No orders waiting${shop ? ` at ${shops[0]}` : ''}.`);
  const evs = data.events.filter((e) => e.date === today).sort((a, b) => a.start.localeCompare(b.start));
  if (evs.length) s.push(`On your calendar: ${list(evs.map((e) => (e.start === 'allday' ? e.title : `${e.title} at ${hm12(e.start)}`)))}.`);
  else s.push('Your calendar is clear today.');
  const todos = todoItems(data.todos), due = todos.filter((t) => t.due && t.due <= today);
  if (due.length) s.push(`Due today: ${list(due.slice(0, 3).map((t) => t.title + (t.due < today ? ', which is overdue' : '')))}.`);
  if (todos.length > due.length) s.push(`${plural(todos.length - due.length, 'other thing')} on your list.`);
  const waiting = data.leads.filter((l) => l.status === 'escalated');
  if (waiting.length) s.push(`${plural(waiting.length, 'deal')} waiting for your decision.`);
  const follow = data.leads.filter((l) => ['new', 'talking'].includes(l.status) && l.next && l.next <= today);
  if (follow.length) s.push(`Follow-ups due with ${list(follow.slice(0, 3).map((l) => person(l.contact)))}.`);
  const pay = data.leads.filter((l) => l.status === 'agreed' && l.next && l.next <= today);
  if (pay.length) s.push(`Payment due from ${list(pay.slice(0, 3).map((l) => person(l.contact)))}.`);
  s.push('Anything you want me to do?');
  return s.join(' ');
}

// Each business's orders, with the shop's name (its profile's first line) in front. Run inside the sandbox.
const ORDERS = `echo shop; for f in ~/.hermes/workspace/business/*/orders.tsv; do [ -f "$f" ] || continue
  n=$(head -1 "\${f%/orders.tsv}/profile.md" 2>/dev/null | sed 's/^# *//'); awk -v n="$n" -F'\\t' 'FNR > 1 { print n "\\t" $0 }' "$f"; done`;
const parseOrders = (out) => out.split('\n').slice(1).filter((l) => l.trim()).map((l) => {
  const [shop, ref, placed, status, customer, , , items, total] = l.split('\t');
  return { shop, ref, placed, status, customer: customer || 'a customer', items: (items || '').replace(/ x1\b/g, '').replace(/;/g, ','), total };
});

// Which instant answer a message asks for, or null. Cheap: callers only fetch the data when this matches.
const INTENTS = [
  ['brief', /^(brief me|(give me )?(a |the |my )?(daily |morning )?brief(ing)?|what'?s my day( look like)?|how'?s my day( looking)?|what'?s (on )?today)$/],
  ['todos', /^((what'?s|what is|read|show|tell me)( me)? (on )?my (to ?do )?(list|todos?|tasks?)|(my|any) (to ?dos?|todos?|tasks)|what do i (have|need) to do)$/],
  ['calendar', /^((what'?s|what is|anything) (on )?my (calendar|schedule)|(what do i have|any meetings|my (calendar|schedule))( on)?)( (today|tomorrow))?$/],
  ['followups', /^((any|my) )?follow ?ups?( due)?( today)?$|^who (do|should) i follow up( with)?$/],
  ['leads', /^((any|how many) (new )?(leads|deals|enquiries)( today)?|(any )?deals? waiting( for me)?|(what|anything) needs (me|my decision))$/],
];
const normal = (text) => String(text || '').toLowerCase().replace(/^🎙\s*/u, '').replace(/[’‘]/g, "'").replace(/[^\w\s']/g, ' ')
  .replace(/\s+/g, ' ').trim().replace(/^((hey|ok|okay|hi) )?max\b ?/, '').replace(/ (max|please)$/, '').replace(/^please /, '').trim();
// Greetings and small talk. Only exact short phrases match, so anything with a real request in it still goes to Max.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
let named = (s) => s;   // set per call by smallTalk(): puts the owner's first name in, or drops it
const SMALL_TALK = [
  [/^(hi|hello|hey|hiya|yo|sup|hey there|hello there|wassup|whats up|what's up)$/, () => {
    const h = new Date().getHours();
    return named(pick([`${h < 12 ? 'Morning' : h < 17 ? 'Hey' : 'Evening'}, {name}. What do you need?`, 'Hey {name}. What can I do for you?', "Hey. I'm here, what's up?"]));
  }],
  [/^good (morning|afternoon|evening)$/, (m) => named(`Good ${m[1]}, {name}. What's first?`)],
  [/^(how are you|how are you doing|hows it going|how's it going|you good|how r u)$/, () => pick(['All good and ready to go. What do you need?', "Running smooth. What's up?"])],
  [/^(thanks|thank you|thx|ty|cheers|thanks a lot|thank you so much|nice one)$/, () => pick(['Anytime.', 'Happy to help.', 'No problem.'])],
  [/^(ok|okay|cool|nice|great|got it|alright|perfect|awesome|sounds good)$/, () => pick(['Sure.', 'Cool.', 'Got it.'])],
  [/^(bye|goodbye|see you|see ya|later|cya)$/, () => named(pick(['Later, {name}.', 'See you.']))],
  [/^(good night|gn|night)$/, () => named('Good night, {name}.')],
  [/^(who are you|what are you)$/, () => "I'm Max, your assistant. I run your businesses' inboxes and leads, keep your calendar, and control your laptop and server."],
  [/^(what can you do|help)$/, () => 'I can reply to clients, track leads, manage your calendar, research things, and control your laptop and server. Just ask.'],
];
function smallTalk(text, owner = '') {
  named = (s) => (owner ? s.replace('{name}', owner) : s.replace(/,? ?{name}/, ''));
  const t = normal(text) || 'hi';
  for (const [re, say] of SMALL_TALK) { const hit = re.exec(t); if (hit) return say(hit); }
  return null;
}

function intent(text) {
  const t = normal(text);
  const hit = INTENTS.find(([, re]) => re.test(t));
  return hit ? { kind: hit[0], tomorrow: /\btomorrow$/.test(t) } : null;
}

function answer(want, data, { owner = '', orders = [], now = new Date() } = {}) {
  const today = data.today;
  const todos = todoItems(data.todos);
  const due = (t) => (!t.due ? '' : t.due < today ? ' (overdue)' : t.due === today ? ' (due today)' : ` (due ${dayName(t.due)})`);
  switch (want.kind) {
    case 'brief': return brief(data, orders, owner, greet(owner, now));
    case 'todos':
      return todos.length ? `You have ${plural(todos.length, 'thing')} on your list: ${list(todos.map((t) => t.title + due(t)))}.` : 'Your list is empty.';
    case 'calendar': {
      const day = want.tomorrow ? addDays(today, 1) : today, when = want.tomorrow ? 'tomorrow' : 'today';
      const evs = data.events.filter((e) => e.date === day).sort((a, b) => a.start.localeCompare(b.start));
      const dl = todos.filter((t) => t.due === day);
      const parts = [];
      if (evs.length) parts.push(`${when === 'today' ? 'Today' : 'Tomorrow'} you have ${list(evs.map((e) => (e.start === 'allday' ? e.title : `${e.title} at ${hm12(e.start)}`)))}.`);
      if (dl.length) parts.push(`${list(dl.map((t) => t.title))} ${dl.length === 1 ? 'is' : 'are'} due.`);
      return parts.join(' ') || `Nothing on your calendar ${when}.`;
    }
    case 'followups': {
      const f = data.leads.filter((l) => ['new', 'talking'].includes(l.status) && l.next && l.next <= today);
      return f.length ? `Follow-ups due with ${list(f.map((l) => `${person(l.contact)} (${l.business})`))}.` : 'No follow-ups due.';
    }
    case 'leads': {
      const waiting = data.leads.filter((l) => l.status === 'escalated').length;
      const fresh = data.leads.filter((l) => l.status === 'new').length;
      const open = data.leads.filter((l) => ['new', 'talking', 'escalated'].includes(l.status)).length;
      if (!open) return 'No open leads right now.';
      return [`${plural(open, 'open lead')}`, fresh ? `${fresh} new` : '', waiting ? `${plural(waiting, 'deal')} waiting for your decision` : ''].filter(Boolean).join(', ') + '.';
    }
  }
  return null;
}

module.exports = { smallTalk, intent, answer, brief, ORDERS, parseOrders, hm12, plural, list, person };
