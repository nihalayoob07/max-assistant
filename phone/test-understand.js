// node phone/test-understand.js: what the owner says on the call -> the decision Max confirms back.
'use strict';
const assert = require('assert');
const { numbers, understand } = require('./phone-api');
const c = { theirs: 13000, ours: 13700, floor: 13600, counter: 13350 };
assert.deepStrictEqual(numbers('thirteen thousand five hundred'), [13500]);
assert.deepStrictEqual(numbers('13,500 rupees'), [13500]);
assert.deepStrictEqual(numbers('13.5k'), [13500]);
assert.deepStrictEqual(numbers('one lakh twenty thousand'), [120000]);
const u = (t) => understand(t, c);
assert.deepStrictEqual(u('counter at thirteen and a half'), { action: 'counter', price: 13500, drop: 0 });
assert.deepStrictEqual(u('Counter at 13 and a half'), { action: 'counter', price: 13500, drop: 0 });
assert.deepStrictEqual(u('counter at 13.5'), { action: 'counter', price: 13500, drop: 0 });
assert.deepStrictEqual(u('counter at 13,500'), { action: 'counter', price: 13500, drop: 0 });
assert.deepStrictEqual(u('13800 final'), { action: 'final', price: 13800, drop: 0 });
assert.deepStrictEqual(u('13800 can drop 300'), { action: 'counter', price: 13800, drop: 300 });
assert.deepStrictEqual(u('accept'), { action: 'accept', price: 13000 });
assert.deepStrictEqual(u('yeah take it'), { action: 'accept', price: 13000 });
assert.deepStrictEqual(u('accept thirteen thousand'), { action: 'accept', price: 13000 });
assert.deepStrictEqual(u('decline'), { action: 'decline' });
assert.deepStrictEqual(u('no deal'), { action: 'decline' });
assert.deepStrictEqual(u('counter'), { action: 'counter', price: 13350, drop: 0 });
assert.strictEqual(u('banana').action, 'unclear');
assert.strictEqual(u('counter at 500000').action, 'unclear');
assert.strictEqual(u('say that again').action, 'repeat');
console.log('ok');

// The morning brief reads orders to print, today's calendar, what's due, and what waits on the owner.
const { brief, parseOrders } = require('./phone-api');
const orders = parseOrders('shop\tref\tplaced\tstatus\tcustomer\n' +
  'Test Shop\tPV-1\t20 Oct\tpaid\tSam Lee\t+91\tKA\tPhone Stand x2; Keychain x1\t₹900\nTest Shop\tPV-2\t19 Oct\tpending\tRavi\t\t\tLamp x1\t₹1,200\n');
const b = brief({ today: '2026-10-21', events: [{ id: 'E1', date: '2026-10-21', start: '10:30', title: 'Call with the bakery' }],
  todos: ['pay the electricity bill (due 2026-10-20, added 2026-10-15)', 'buy filament (added 2026-10-18)'],
  leads: [{ id: 'L1', status: 'escalated' }, { id: 'L2', contact: 'Jordan', status: 'talking', next: '2026-10-21' }] }, orders);
for (const want of ['Test Shop: 1 order to make. Phone Stand x2, Keychain for Sam, from 20 Oct', '1 order waiting for payment', 'Call with the bakery at 10:30 am',
  'pay the electricity bill, which is overdue', '1 other thing on your list', '1 deal waiting', 'Follow-ups due with Jordan']) assert(b.includes(want), `${want}\n${b}`);
console.log('brief ok');
