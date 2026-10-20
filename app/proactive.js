// Proactive Max: decides what Max should bring up on its own, from the same calendar and leads the dashboard
// reads. Pure (data in, nudges out) so it's testable; main.js runs it every few minutes and speaks the nudges.
//   - a meeting/call starting within 15 minutes
//   - once a day (from 9:30): follow-ups that are due, and payments owed on agreed deals
// Each nudge has a key; main.js remembers the keys it has said so nothing repeats.
'use strict';

const OPEN = new Set(['new', 'talking', 'escalated']);
const who = (l) => String(l.contact || 'a client').replace(/^\+?\d[\d\s-]{6,}$/, 'a client');
const list = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const rupees = (n) => `${Math.round(n).toLocaleString('en-IN')} rupees`;
const hhmm = (d) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

// data: parse() output from main.js. now: Date. -> [{ key, text }]
function nudges(data, now = new Date()) {
  const out = [];
  const today = data.today || now.toISOString().slice(0, 10);
  for (const e of data.events || []) {
    if (e.date !== today || !/^\d\d:\d\d$/.test(e.start || '')) continue;
    const [h, m] = e.start.split(':').map(Number);
    const at = new Date(now); at.setHours(h, m, 0, 0);
    const mins = Math.round((at - now) / 60000);
    if (mins > 0 && mins <= 15) out.push({ key: `event:${e.id}:${today}`, text: `Heads up: ${e.title} at ${hhmm(at)}, in ${mins} minute${mins === 1 ? '' : 's'}.` });
  }
  if (now.getHours() * 60 + now.getMinutes() >= 9 * 60 + 30) {
    const due = (l) => l.next && l.next <= today;
    const follow = (data.leads || []).filter((l) => OPEN.has(l.status) && due(l));
    if (follow.length) out.push({ key: `followups:${today}`, text: `You've got ${follow.length} follow-up${follow.length === 1 ? '' : 's'} due today: ${list(follow.slice(0, 3).map(who))}${follow.length > 3 ? ' and more' : ''}. Want me to draft them?` });
    const pay = (data.leads || []).filter((l) => l.status === 'agreed' && due(l));
    for (const l of pay) out.push({ key: `payment:${l.id}:${today}`, text: `Payment from ${who(l)} is due${l.value ? `, ${rupees(l.value)}` : ''}. Want me to send them a reminder?` });
  }
  return out;
}

module.exports = { nudges };

// node proactive.js --self-test
if (require.main === module && process.argv.includes('--self-test')) {
  const now = new Date('2026-10-20T10:00:00');
  const data = {
    today: '2026-10-20',
    events: [{ id: 'E0001', date: '2026-10-20', start: '10:10', title: 'Call with the bakery' },
      { id: 'E0002', date: '2026-10-20', start: '13:00', title: 'Lunch' }, { id: 'E0003', date: '2026-10-21', start: '10:05', title: 'Tomorrow' }],
    leads: [{ id: 'L1', contact: 'Jordan', status: 'talking', next: '2026-10-19' }, { id: 'L2', contact: '+91 90000 00002', status: 'new', next: '2026-10-20' },
      { id: 'L3', contact: 'Arun', status: 'lost', next: '2026-10-01' }, { id: 'L4', contact: 'Cafe Bloom', status: 'agreed', value: 6749, next: '2026-10-20' },
      { id: 'L5', contact: 'Later', status: 'talking', next: '2026-10-25' }],
  };
  const n = nudges(data, now);
  const keys = n.map((x) => x.key);
  if (keys.join() !== 'event:E0001:2026-10-20,followups:2026-10-20,payment:L4:2026-10-20') throw new Error('keys: ' + keys);
  if (!/in 10 minutes/.test(n[0].text) || !/2 follow-ups due today: Jordan and a client/.test(n[1].text) || !/6,749 rupees/.test(n[2].text)) throw new Error('text: ' + n.map((x) => x.text).join(' | '));
  if (nudges(data, new Date('2026-10-20T08:00:00')).some((x) => x.key.startsWith('followups'))) throw new Error('too early');
  console.log('self-test ok');
}
