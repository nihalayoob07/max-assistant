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
// Small talk: answered instantly, but "okay" after Max's question is an answer for Max, and requests still go to Max.
const { smallTalk, askedQuestion } = require('./quick');
const o = { tz: 'Asia/Kolkata', now: new Date('2026-10-23T15:30:00Z') };   // 9 pm in India
for (const t of ['hello', 'Hello Max, how are you?', 'hey max how are you doing today', 'are you there', 'can you hear me', 'who made you',
  'are you an ai', 'tell me a joke', 'thanks so much', 'bye', 'um hello max', "i'm good", 'okay']) assert(smallTalk(t, 'Nihal', o), t);
assert.strictEqual(smallTalk('what time is it', 'Nihal', o), "It's 9:00 pm.");
assert.strictEqual(smallTalk('whats the date', 'Nihal', o), "It's Friday, 23 October.");
assert.strictEqual(smallTalk('who made you', 'Nihal', o), 'You built me, Nihal. I run privately on your own server, on NVIDIA Nemotron.');
assert.strictEqual(smallTalk('okay', 'Nihal', { ...o, asked: true }), null);
assert.strictEqual(smallTalk('hello', 'Nihal', { ...o, asked: true }) !== null, true);
for (const t of ['add milk to my list', "how's business this week", 'okay add milk to my list', 'hello can you open youtube'])
  assert.strictEqual(smallTalk(t, 'Nihal', o), null, t);
assert.strictEqual(askedQuestion([{ role: 'assistant', content: 'Should I send it?' }, { role: 'user', content: 'okay' }]), true);
assert.strictEqual(askedQuestion([{ role: 'assistant', content: 'Sent.' }]), false);
console.log('quick ok');
