// node app/test-quick.js: instant answers match only short, whole questions, and read the data right.
'use strict';
const assert = require('assert');
const { intent, answer, waCommand, waApply } = require('./quick');

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
// WhatsApp extension commands: switches, who handles a chat, and nothing else.
const wa = (t) => JSON.stringify(waCommand(t));
assert.strictEqual(wa('pause whatsapp'), '{"set":{"enabled":false}}');
assert.strictEqual(wa('turn off auto-send'), '{"set":{"autoSend":false}}');
assert.strictEqual(wa("I'll handle Nuha"), '{"chat":"nuha","handler":"me"}');
assert.strictEqual(wa('hand Nuha back to max'), '{"chat":"nuha","handler":"max"}');
for (const t of ["I'll handle it", 'pause the music', 'I will take a look', "what's on my list"]) assert.strictEqual(waCommand(t), null, t);
(async () => {
  const sent = [];
  const call = async (m, p, b) => { sent.push(b); return { chats: [{ id: 'c1', chat: 'Nuha', handler: 'ask' }], enabled: true }; };
  assert.match(await waApply(waCommand("I'll handle nuha"), call), /Nuha is yours/);
  assert.deepStrictEqual(sent.pop(), { chat: 'c1', handler: 'me' });
  assert.strictEqual(await waApply(waCommand("I'll handle Zed"), call), null);   // no such chat: Max answers instead
  console.log('quick ok');
})();
