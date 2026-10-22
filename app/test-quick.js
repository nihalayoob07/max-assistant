// node app/test-quick.js: instant answers match only short, whole questions, and read the data right.
'use strict';
const assert = require('assert');
const { intent, answer } = require('./quick');

const kind = (t) => intent(t)?.kind || null;
assert.strictEqual(kind("What's on my list?"), 'todos');
assert.strictEqual(kind('🎙 hey max, whats on my to do list'), 'todos');
assert.strictEqual(kind('Brief me'), 'brief');
assert.strictEqual(kind("What's on my calendar tomorrow?"), 'calendar');
assert.strictEqual(intent('what do i have tomorrow').tomorrow, true);
assert.strictEqual(kind('Any follow-ups due?'), 'followups');
assert.strictEqual(kind('any new leads'), 'leads');
// Requests and open questions still go to Max.
for (const t of ['add buy milk to my list', "how's business this week?", 'remind me to call Ravi at 5', 'what is on my list for the bakery job'])
  assert.strictEqual(kind(t), null, t);

const data = {
  today: '2026-10-23',
  todos: ['online activity', 'hackathon submission (due 2026-10-30, added 2026-10-18)'],
  events: [{ id: 'E1', date: '2026-10-24', start: '15:00', title: 'Call the supplier' }],
  leads: [{ id: 'L1', business: 'printvault', contact: 'Ravi', status: 'talking', next: '2026-10-22' }, { id: 'L2', status: 'escalated' }],
};
assert.strictEqual(answer(intent("what's on my list"), data), 'You have 2 things on your list: online activity and hackathon submission (due Friday, 30 Oct).');
assert.strictEqual(answer(intent("what's on my calendar today"), data), 'Nothing on your calendar today.');
assert.strictEqual(answer(intent('what do i have tomorrow'), data), 'Tomorrow you have Call the supplier at 3 pm.');
assert.strictEqual(answer(intent('any follow ups'), data), 'Follow-ups due with Ravi (printvault).');
assert.strictEqual(answer(intent('any leads'), data), '2 open leads, 1 deal waiting for your decision.');
assert(answer(intent('brief me'), data, { owner: 'Nihal', now: new Date('2026-10-23T20:00') }).startsWith("Good evening Nihal, it's Max. Here's your day."));
console.log('quick ok');
