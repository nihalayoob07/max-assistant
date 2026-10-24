// Self-check for the tutor's request matching (tutor.js) and syntax colours (ui/hl.js): node tutor-test.js
'use strict';
const assert = require('assert');
const { intent, command, parseTitle } = require('./tutor');
const hl = require('./ui/hl');

const kind = (t) => intent(t)?.kind || null;
assert.equal(kind('how do I write a while loop'), 'learn');
assert.equal(kind('what is a pointer in C'), 'learn');
assert.equal(kind('tutor me on recursion'), 'learn');
assert.equal(kind('how do I read a file in python'), 'learn');
assert.equal(kind('explain for loops in C++'), 'learn');
assert.equal(kind('debug my code'), 'debug');
assert.equal(kind("what's wrong with my program"), 'debug');
assert.equal(kind('explain this code'), 'explain');
assert.equal(kind("what's on my list"), null);
assert.equal(kind("what's on my calendar tomorrow"), null);
assert.equal(kind('how do I get to the station'), null);
assert.equal(kind('open youtube'), null);

// Which language: asked when none was named; Whisper hears "C" as "see".
assert.equal(intent('how do I write a while loop').lang, null);
assert.equal(intent('how do I write a while loop in see').lang, 'C');
assert.equal(intent('explain for loops in C++').lang, 'C++');
assert.equal(intent('teach me binary search in java').lang, 'Java');
// A whole language is a course; a topic in a language is one lesson.
assert.deepEqual(intent('can you teach me C language'), { kind: 'course', lang: 'C' });
assert.deepEqual(intent('teach me python programming'), { kind: 'course', lang: 'Python' });
assert.deepEqual(intent('teach me C++'), { kind: 'course', lang: 'C++' });
assert.deepEqual(intent('continue my C course'), { kind: 'course', lang: 'C' });
assert.deepEqual(intent('i want to learn java'), { kind: 'course', lang: 'Java' });
assert.equal(intent('teach me pointers in C').kind, 'learn');
assert.deepEqual(command('next lesson'), { cmd: 'nextLesson' });
assert.deepEqual(command('lesson 5'), { cmd: 'lesson', n: 5 });
assert.deepEqual(command('go to lesson three'), { cmd: 'lesson', n: 3 });
assert.deepEqual(command('show me the lessons'), { cmd: 'menu' });
assert.deepEqual(command('continue', 'course'), { cmd: 'continue' });
assert.deepEqual(command('skip it'), { cmd: 'skip' });
assert.equal(intent('teach me recursion').lang, null);
assert.deepEqual(command('See.', 'lang'), { cmd: 'lang', lang: 'C' });
assert.deepEqual(command('see plus plus', 'lang'), { cmd: 'lang', lang: 'C++' });
assert.equal(command('C', null), null);
assert.deepEqual(command('right away you', 'lang'), { cmd: 'relang' });   // misheard: ask again, never on to Max
assert.equal(command('actually what is on my calendar today', 'lang'), null);

assert.deepEqual(command('fix error number 2'), { cmd: 'fix', n: 2 });
assert.deepEqual(command('Fix error one.'), { cmd: 'fix', n: 1 });
assert.deepEqual(command('fix #3'), { cmd: 'fix', n: 3 });
assert.equal(command('yes', null), null);
assert.deepEqual(command('yes, go ahead', 'fix'), { cmd: 'yes' });
assert.equal(command('yes but explain it first', 'fix').cmd, 'ask');
assert.deepEqual(command('Go ahead.', 'fix'), { cmd: 'yes' });
assert.deepEqual(command('next'), { cmd: 'next' });
assert.deepEqual(command('Previous.'), { cmd: 'prev' });
assert.deepEqual(command('explain it in simpler terms'), { cmd: 'simple' });
assert.deepEqual(command('go through it line by line'), { cmd: 'trace' });
assert.equal(command('why is line 4 wrong').cmd, 'ask');
assert.equal(command('play some music'), null);

assert.deepEqual(parseTitle('● main.c - homework - Visual Studio Code'), { file: 'main.c', folder: 'homework', dirty: true });
assert.deepEqual(parseTitle('Release Notes: 1.143.1 - homework - Visual Studio Code'), { file: null, folder: 'homework', dirty: false });
assert.equal(parseTitle('Visual Studio Code'), null);

const c = hl('#include <stdio.h>\nint main() { /* a\nb */ printf("hi %d", 42); }', 'c');
assert.equal(c.length, 3);
assert.match(c[0], /class="cf">#include/);
assert.match(c[1], /class="k">int<\/span> <span class="f">main/);
assert.match(c[1], /class="c">\/\* a<\/span>$/);   // a comment across lines is closed and reopened
assert.match(c[2], /^<span class="c">b \*\/<\/span>/);
assert.match(c[2], /class="s">"hi %d"/);
assert.match(c[2], /class="n">42/);
const py = hl('for n in nums:  # loop\n    print(n)', 'python');
assert.match(py[0], /class="cf">for<\/span> <span class="v">n<\/span> <span class="cf">in/);
assert.match(py[0], /class="c"># loop/);
assert.match(py[1], /class="f">print/);
assert.match(hl('a < b && c', 'c')[0], /&lt; .*&amp;&amp;/);
console.log('tutor-test: all good');
