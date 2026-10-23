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
  .replace(/\s+/g, ' ').trim().replace(/^((um|uh|so|oh) )+/, '').replace(/^((hey|ok|okay|hi|hello|yo) )?max\b ?/, '').replace(/ (max|please)$/, '').replace(/^please /, '').trim();
// Greetings and small talk. Only whole short phrases match, so anything with a real request in it still goes to Max.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
let named = (s) => s;   // set per call by smallTalk(): puts the owner's first name in, or drops it
let clock = { tz: undefined, now: () => new Date() };   // set per call: the owner's time zone
const hour = () => Number(clock.now().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: clock.tz })) % 24;
const HELLO = 'hi|hello|hey|hiya|heya|yo|sup|howdy|hey there|hello there|hi there|wassup|whats up|what\'s up|namaste|hola';
const HOW = 'how are you|how are you doing|how are you today|how are you doing today|how you doing|how r u|hru|how\'s it going|hows it going|' +
  'how are things|how have you been|how\'s your day|hows your day|how\'s your day going|how was your day|how\'s everything|you good|you alright|all good|what\'s good|whats good';
const fine = () => pick(['All good and ready to go. What do you need?', "Running smooth. What's up?", 'Doing well. What can I do for you?']);
const JOKES = [
  "I told the printer a joke. It didn't get it, but it made three copies just in case.",
  'Why did the website go to therapy? Too many unresolved issues.',
  "I'd tell you a UDP joke, but you might not get it.",
  'My calendar and I have a lot in common. We both have no free time.',
];
// [pattern, reply, kind]. kind 'ack' means it could be an answer to a question Max just asked, so it's skipped then.
const SMALL_TALK = [
  [new RegExp(`^(${HELLO})$`), () => named(pick([`${hour() < 12 ? 'Morning' : hour() < 17 ? 'Hey' : 'Evening'}, {name}. What do you need?`,
    'Hey {name}. What can I do for you?', "Hey. I'm here, what's up?"]))],
  [new RegExp(`^(${HELLO}) (${HOW})$`), () => named(pick(['Hey {name}, all good here. What do you need?', "Hey {name}. I'm good, what's up?"]))],
  [/^(assalamualaikum|assalamu alaikum|salaam|salam|as salaam alaikum)$/, () => named('Walaikum assalam, {name}. What do you need?')],
  [/^good (morning|afternoon|evening)$/, (m) => named(`Good ${m[1]}, {name}. What's first?`)],
  [new RegExp(`^(${HOW})$`), fine],
  [/^(what are you doing|what're you doing|whatcha doing|wyd|what are you up to|what's up with you|whats up with you)$/,
    () => pick(['Keeping an eye on your inbox and calendar. What do you need?', 'Just watching the inbox. What can I do for you?'])],
  [/^(are you there|you there|can you hear me|hello hello|hello are you there|testing|test|testing testing|mic check|do you hear me)$/,
    () => pick(["I'm here.", 'Loud and clear.', "Yep, I'm here. Go ahead."])],
  [/^(i'm good|im good|i'm fine|im fine|i'm great|im great|doing well|doing good|not bad|pretty good|good|great|fine)$/, () => 'Good to hear. What can I do for you?', 'ack'],
  [/^(thanks|thank you|thx|ty|tysm|thank u|cheers|thanks a lot|thank you so much|thanks so much|nice one|appreciate it|much appreciated|thanks man|thanks bro|thanks buddy|great thanks|ok thanks|okay thanks|thanks again)$/,
    () => pick(['Anytime.', 'Happy to help.', 'No problem.'])],
  [/^(ok|okay|k|kk|okie|cool|nice|great|got it|alright|all right|perfect|awesome|sounds good|sure|fine|noted|understood|makes sense|fair enough|right|oh ok|oh okay|ah ok|i see)$/,
    () => pick(['Sure.', 'Cool.', 'Got it.']), 'ack'],
  [/^(good job|well done|nice work|great job|great work|good work|you're the best|youre the best|you're awesome|youre awesome|you're smart|smart|love you|i love you|good boy|legend|you rock)$/,
    () => named(pick(['Thanks, {name}.', 'Appreciate it.', 'Glad it helped.']))],
  [/^(sorry|my bad|never mind|nevermind|nvm|forget it|forget about it|no worries|nothing|it's nothing|its nothing|ignore that)$/, () => pick(['No worries.', 'All good.']), 'ack'],
  [/^(i'm back|im back|back|i am back)$/, () => named("Welcome back, {name}. What's next?")],
  [/^(lol|haha|hahaha|lmao|hehe|funny)$/, () => 'Ha.'],
  [/^(bye|goodbye|bye bye|bye max|see you|see ya|see you later|later|cya|ttyl|talk later|talk to you later|catch you later|gotta go|got to go|i'm off|im off)$/,
    () => named(pick(['Later, {name}.', 'See you.', 'Talk soon.']))],
  [/^(good night|goodnight|gn|night|nighty night|sleep well)$/, () => named('Good night, {name}.')],
  [/^(who are you|what are you|introduce yourself|tell me about yourself)$/,
    () => "I'm Max, your assistant. I run your businesses' inboxes and leads, keep your calendar, and control your laptop and server."],
  [/^(what's your name|whats your name|what is your name|your name)$/, () => "I'm Max."],
  [/^(who made you|who built you|who created you|who designed you|who's your creator|whos your creator|who owns you)$/,
    () => named('You built me, {name}. I run privately on your own server, on NVIDIA Nemotron.')],
  [/^(are you an ai|are you a bot|are you a robot|are you real|are you human|are you a person)$/,
    () => "I'm an AI: Max, running privately on your own server."],
  [/^(what can you do|help|what do you do|how can you help|how can you help me|what are you good at)$/,
    () => 'I can reply to clients, track leads, manage your calendar, research things, and control your laptop and server. Just ask.'],
  [/^(tell me a joke|say something funny|make me laugh|joke|another joke|tell me another joke)$/, () => pick(JOKES)],
  [/^(what time is it|what's the time|whats the time|time|the time|current time|time now|what time is it now)$/,
    () => `It's ${clock.now().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: clock.tz })}.`],
  [/^(what's the date|whats the date|what is the date|what's today's date|whats today's date|todays date|today's date|what day is it|what day is it today|what's the day today|whats the day today)$/,
    () => `It's ${clock.now().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: clock.tz })}.`],
];
// Max's last line in a conversation was a question: then "okay", "fine", "nothing" are answers to it.
const askedQuestion = (messages) => /\?\s*$/.test(String(messages.filter((m) => m.role === 'assistant').pop()?.content || ''));
// asked: Max's last line was a question, so "okay", "fine", "nothing" are answers to it and go to Max.
function smallTalk(text, owner = '', { tz, now, asked = false } = {}) {
  named = (s) => (owner ? s.replaceAll('{name}', owner) : s.replace(/,? ?\{name\}('s)?/g, (_m, s2) => (s2 ? 'your' : '')));
  clock = { tz, now: now ? () => now : () => new Date() };
  const t = normal(text) || 'hi';
  for (const [re, say, kind] of SMALL_TALK) {
    if (kind === 'ack' && asked) continue;
    const hit = re.exec(t);
    if (hit) return say(hit);
  }
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

// The WhatsApp extension, managed by asking ("pause whatsapp", "turn on auto send", "I'll handle Nuha", "you can
// handle Raahil", "whatsapp settings"). waCommand only reads the words; waApply changes it through the desk relay
// (call = (method, path, body) => relay's JSON) and says what changed, or null when no chat has that name.
const WA = "(?:the )?(?:whats ?app|wa)(?: (?:extension|bot|replies|desk))?";
const onOff = (w) => w === 'on';
const NOT_A_CHAT = /^(it|that|this|them|those|these|everything|all|a look)$/;
function waCommand(text) {
  const t = normal(text);
  let m;
  if (new RegExp(`^(?:pause|stop|turn off|switch off|disable|mute) ${WA}$|^${WA} off$`).test(t)) return { set: { enabled: false } };
  if (new RegExp(`^(?:resume|start|unpause|turn on|switch on|enable) ${WA}(?: again)?$|^${WA} (?:on|back on)$`).test(t)) return { set: { enabled: true } };
  if ((m = /^(?:turn |switch )?(on|off) auto ?send$|^(?:turn |switch )?auto ?send (on|off)$/.exec(t))) return { set: { autoSend: onOff(m[1] || m[2]) } };
  if ((m = /^(?:turn |switch )?(on|off) test mode$|^(?:turn |switch )?test mode (on|off)$/.exec(t))) return { set: { selfTest: onOff(m[1] || m[2]) } };
  if ((m = /^(?:turn |switch )?(on|off) only unsaved(?: numbers)?$|^(?:turn |switch )?only unsaved(?: numbers)? (on|off)$/.exec(t))) return { set: { unsavedOnly: onOff(m[1] || m[2]) } };
  if (/^only (?:reply to |answer )?unsaved numbers$/.test(t)) return { set: { unsavedOnly: true } };
  if (/^(?:reply to|answer|include) saved contacts(?: too)?$/.test(t)) return { set: { unsavedOnly: false } };
  if (new RegExp(`^${WA} (?:settings|status)$|^how(?:'s| is) ${WA} (?:set up|doing)$`).test(t)) return { show: true };
  const chat = (name, handler) => { name = name.replace(/^(?:the )?(?:chat with |chat )/, '').replace(/ (?:chat|myself|from now on|for me)$/, '').trim(); return name && !NOT_A_CHAT.test(name) ? { chat: name, handler } : null; };
  if ((m = /^(?:i'?ll|i will|let me|i'?m going to|i'?m gonna) (?:handle|deal with|reply to|answer|talk to|take over) (.+)$|^stay out of (.+)$/.exec(t))) return chat(m[1] || m[2], 'me');
  if ((m = /^(?:you|max) (?:can |should )?(?:handle|take over|deal with|reply to|answer) (.+)$|^(?:hand|give|pass) (.+?) (?:back )?to(?: you| max)?$|^take over (.+)$/.exec(t))) return chat(m[1] || m[2] || m[3], 'max');
  return null;
}
const chatName = (s) => String(s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
async function waApply(cmd, call) {
  if (cmd.chat) {
    const { chats = [] } = await call('GET', '/wa');
    const c = chats.find((x) => chatName(x.chat) === cmd.chat) || chats.find((x) => chatName(x.chat).startsWith(cmd.chat + ' '));
    if (!c) return null;
    await call('POST', '/wa', { chat: c.id, handler: cmd.handler });
    return cmd.handler === 'me' ? `Okay, ${c.chat} is yours. I won't read that chat again until you hand it back.` : `Got it, I'll handle ${c.chat} from now on.`;
  }
  const s = cmd.show ? await call('GET', '/wa') : await call('POST', '/wa', { set: cmd.set });
  const set = cmd.set || {};
  if ('enabled' in set) return set.enabled ? "WhatsApp's back on. I'll pick up new messages." : "Okay, WhatsApp's paused. I won't read or answer any chats until you turn it back on.";
  if ('autoSend' in set) return set.autoSend ? "Auto-send's on: I'll send WhatsApp replies myself and give you a copy." : 'Auto-send is off: every reply waits for your okay on Telegram.';
  if ('selfTest' in set) return `Test mode's ${set.selfTest ? 'on' : 'off'}.`;
  if ('unsavedOnly' in set) return set.unsavedOnly ? "Okay, I'll only answer unsaved numbers." : "Okay, I'll answer saved contacts too.";
  const mine = (s.chats || []).filter((c) => c.handler === 'me').map((c) => c.chat);
  return `WhatsApp is ${s.enabled ? 'on' : 'paused'}, auto-send is ${s.autoSend ? 'on' : 'off'}, ${s.unsavedOnly ? 'only unsaved numbers' : 'all chats'}` +
    `${s.selfTest ? ', test mode on' : ''}. ${mine.length ? `You're handling ${list(mine.slice(0, 5))}${mine.length > 5 ? ` and ${mine.length - 5} more` : ''}.` : "You aren't handling any chats yourself."}`;
}

module.exports = { waCommand, waApply, smallTalk, askedQuestion, intent, answer, brief, ORDERS, parseOrders, hm12, plural, list, person };
