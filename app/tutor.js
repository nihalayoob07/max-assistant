// Coding tutor and debugger, main-process side: which requests are for the tutor, reading the code open in your
// editor, and saving a fix you accepted back to its file. The tutor window itself is ui/tutor.*.
// Self-check: node tutor-test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---------- What was asked ----------
const LANGS = 'python|c\\+\\+|cpp|c#|c sharp|c|java|javascript|js|typescript|ts|rust|go|golang|kotlin|swift|php|ruby|sql|html|css|bash|shell|dart|r|scala|haskell|lua|perl|assembly';
const IN_LANG = new RegExp(`\\b(?:in|using|with|for)\\s+(?:${LANGS})(?![\\w+#])`, 'i');
// Programming words that don't also mean something else to Max (no "list", "files", "time", "sort"...).
const TOPIC = /\b(for[- ]?loops?|while[- ]?loops?|do[- ]while|loops?|if[- ]else|else[- ]if|if statements?|switch( case| statements?)?|arrays?|tuples?|dictionar(?:y|ies)|hash ?maps?|hash ?tables?|pointers?|recursion|recursive functions?|functions?|methods?|classes|objects? oriented|oop|structs?|unions?|enums?|variables?|data types?|operators?|ternary|lambdas?|closures?|exceptions?|try[- ]catch|try[- ]except|error handling|file handling|printf|scanf|cout|cin|malloc|calloc|free\(\)|linked lists?|stacks? and queues?|binary (?:search|trees?)|bubble sort|merge sort|quick ?sort|insertion sort|selection sort|syntax|inheritance|polymorphism|encapsulation|interfaces?|generics?|templates?|vectors?|iterators?|generators?|decorators?|async(?:hronous)?|promises?|callbacks?|list comprehensions?|slicing|regex|regular expressions?|bitwise|macros?|header files?|namespaces?|constructors?|destructors?|algorithms?|data structures?|programming|coding)\b/i;
const NOT_CODE = /\b(calendar|todos?|leads?|whatsapp|meeting|email|weather|video|youtube|song|music|remind|brief)\b/i;

// Which language was named, as Whisper hears it ("in see" is C). In a request only what follows "in/using/with"
// counts ("how do loops go" names no language); as the answer to "Which language?" the whole reply does.
const LANGUAGES = [
  ['C++', /\b(?:c|see|sea)\s*(?:\+\+|plus\s*plus)|\bcpp\b/i], ['C#', /\b(?:c|see|sea)\s*(?:#|sharp)/i],
  ['JavaScript', /\bjava\s?script\b|\bjs\b/i], ['TypeScript', /\btype\s?script\b/i], ['Java', /\bjava\b/i],
  ['Python', /\bpython\b/i], ['C', /\b(?:c|see|sea)\b/i], ['Go', /\b(?:go|golang)\b/i], ['Rust', /\brust\b/i],
  ['Kotlin', /\bkotlin\b/i], ['Swift', /\bswift\b/i], ['PHP', /\bphp\b/i], ['Ruby', /\bruby\b/i], ['SQL', /\b(?:sql|sequel)\b/i],
  ['Bash', /\b(?:bash|shell)\b/i], ['Dart', /\bdart\b/i], ['Scala', /\bscala\b/i], ['Lua', /\blua\b/i], ['Perl', /\bperl\b/i],
  ['HTML', /\bhtml\b/i], ['CSS', /\bcss\b/i], ['Assembly', /\bassembly\b/i], ['R', /^\W*(?:the\s+)?(?:r|are)\W*$/i],
];
function language(text, answer = false) {
  const t = String(text || '');
  const find = (part) => (part ? LANGUAGES.find(([, re]) => re.test(part))?.[0] || null : null);
  if (answer) return find(t);
  // "… in C", "C language", "Python programming", "teach me C", "learn Java".
  return find((/\b(?:in|using|with)\s+(.{1,24})/i.exec(t) || [])[1])
    || find((/(?:^|\s)(\S{1,12}(?:\s+(?:plus\s+plus|sharp|script))?)\s+(?:language|programming|lang)\b/i.exec(t) || [])[1])
    || find((/\b(?:teach me|tutor me (?:on|in)|learn|basics of|intro to)\s+(\S{1,12}(?:\s+(?:plus\s+plus|sharp|script))?)\s*[.?!]?$/i.exec(t) || [])[1]);
}

function intent(text) {
  const t = String(text || '').trim();
  if (/\b(debug|find (?:the |any )?(?:bugs?|errors?|mistakes?)|what'?s wrong (?:with|in) (?:my|this|the)|fix (?:my|this|the) (?:code|program|script|bugs?|errors?))\b/i.test(t)) return { kind: 'debug' };
  if (/\bexplain\b.*\b(?:this|my|a|the|that)\s+(?:code|file|program|script)\b/i.test(t)) return { kind: 'explain' };
  if (NOT_CODE.test(t)) return null;
  if (/\b(?:tutor|teach) me\b/i.test(t) || (/\b(how (?:do|can|would|should|to)|explain|what (?:is|are)|what'?s|show me|help me (?:understand|learn|write)|learn|write)\b/i.test(t) && (TOPIC.test(t) || IN_LANG.test(t)))) {
    return { kind: 'learn', topic: t, lang: language(t) };
  }
  return null;
}

// Spoken commands while the tutor is open. `waiting` is what the tutor asked last ('fix' or 'practice'), so a
// plain "yes" only goes to the tutor when it's an answer to it.
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, to: 2, too: 2, for: 4 };
function command(text, waiting) {
  const t = String(text || '').toLowerCase().replace(/[^\w\s#+']/g, ' ').replace(/\s+/g, ' ').trim();
  let m;
  // The answer to "Which language?". A short reply that names none was misheard ("right away you"): ask again rather than
  // let it reach Max, who'd answer the coding question in the corner. A longer one is a new request.
  if (waiting === 'lang') {
    const lang = language(t, true);
    if (lang) return { cmd: 'lang', lang };
    if (t.split(' ').length <= 4) return { cmd: 'relang' };
  }
  if (/^(?:next|go on|continue|carry on|next (?:line|step|one|error|bug))$/.test(t)) return { cmd: 'next' };
  if (/^(?:previous|go back|back|previous (?:line|step|one|error|bug)|last (?:line|step|one))$/.test(t)) return { cmd: 'prev' };
  if ((m = /\bfix (?:the )?(?:error |bug |mistake |problem |issue )?(?:number |no |#)?(\d+|[a-z]+)\b/.exec(t)) && (Number(m[1]) || NUM[m[1]])) return { cmd: 'fix', n: Number(m[1]) || NUM[m[1]] };
  if (waiting && /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|proceed|apply(?: it| the fix)?|save(?: it)?|let'?s go|let'?s do it|yes (?:please|do it|go ahead|proceed|apply it|save it))$/.test(t)) return { cmd: 'yes' };
  if (waiting && /^(?:no|nope|nah|cancel|don'?t|stop|no thanks|not now|leave it|skip)$/.test(t)) return { cmd: 'no' };
  if (/\b(?:simpl(?:er|e terms|e words|y)|easier|dumb it down)\b/.test(t)) return { cmd: 'simple' };
  if (/\bline by line\b|\btrace\b|\bstep through\b/.test(t)) return { cmd: 'trace' };
  if (/^(?:mute|be quiet|stop talking|quiet|shut up)$/.test(t)) return { cmd: 'mute' };
  if (/^(?:unmute|talk again|speak again)$/.test(t)) return { cmd: 'unmute' };
  if (/\b(?:close|exit|quit|hide) (?:the )?(?:tutor|editor|code)\b/.test(t)) return { cmd: 'close' };
  if (/\b(?:check|submit|run|test) (?:my|the|this) (?:answer|code|solution)\b|^check(?: it)?$|^(?:i'?m )?done$/.test(t)) return { cmd: 'check' };
  if (/\bhint\b/.test(t)) return { cmd: 'hint' };
  if (/\b(?:an? )?(?:example|practice|exercise)\b|\btry one\b/.test(t)) return { cmd: 'practice' };
  // Anything else that sounds like it's about the code on screen is a question for the tutor (asked after Max's
  // quick answers and PC commands had their turn, in main.js).
  if (!NOT_CODE.test(t) && (/\b(?:errors?|bugs?|mistakes?|line|code|program|loop|function|variable|pointer|array|syntax|compile|output|print|wrong|explain|means?|this|that|it)\b/.test(t) || TOPIC.test(t))) return { cmd: 'ask', text: String(text).trim() };
  return null;
}

// ---------- The code open in your editor ----------
// VS Code and its forks title their window "● file.c - folder - Visual Studio Code" (● = unsaved). The folder's
// full path comes from the editor's recent workspaces; the file is found inside it. The files next to it (same
// kind) come along, so Max can follow calls between them.
const EDITORS = [['Code', 'Code'], ['Code - Insiders', 'Code - Insiders'], ['Cursor', 'Cursor'], ['Windsurf', 'Windsurf'],
  ['Antigravity', 'Antigravity'], ['Antigravity', 'Antigravity IDE'], ['VSCodium', 'VSCodium']];   // [process, %APPDATA% folder]
const SOURCE = /\.(c|h|cc|cpp|cxx|hpp|hh|cs|java|kt|kts|py|js|mjs|cjs|jsx|ts|tsx|go|rs|rb|php|swift|dart|scala|lua|pl|r|sql|sh|bash|ps1|html|css|scss|vue|svelte|m|hs|asm|s)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build', 'out', 'target', 'bin', 'obj', '.idea', '.vscode', '.next']);

function editorTitles() {
  return new Promise((resolve) => {
    const names = [...new Set(EDITORS.map(([p]) => `'${p}'`))].join(',');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-Command',
      `Get-Process -Name ${names} -ErrorAction SilentlyContinue | ? { $_.MainWindowTitle } | % { $_.ProcessName + '|' + $_.MainWindowTitle }`], { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.on('close', () => resolve(out.split(/\r?\n/).filter(Boolean).map((l) => l.split(/\|(.*)/s)).map(([proc, title]) => ({ proc, title }))));
    ps.on('error', () => resolve([]));
    setTimeout(() => { ps.kill(); resolve([]); }, 8000);
  });
}
function parseTitle(title) {
  const parts = String(title).split(' - ').map((s) => s.trim());
  if (parts.length < 2) return null;
  const dirty = /^[●•]\s*/.test(parts[0]);
  const file = parts[0].replace(/^[●•]\s*/, '');
  const folder = parts.length >= 3 ? parts[1].replace(/\s*\(Workspace\)$/, '') : '';
  // A tab that isn't code in front (Release Notes, Settings): the folder still tells us the project.
  return SOURCE.test(file) ? { file, folder, dirty } : folder ? { file: null, folder, dirty: false } : null;
}
// Recently opened folders of that editor, newest first.
function recentFolders(appDirs) {
  const out = [];
  for (const dir of appDirs) {
    const ws = path.join(process.env.APPDATA || '', dir, 'User', 'workspaceStorage');
    let ids = [];
    try { ids = fs.readdirSync(ws); } catch { continue; }
    for (const id of ids) {
      try {
        const f = path.join(ws, id, 'workspace.json');
        const uri = JSON.parse(fs.readFileSync(f, 'utf8')).folder;
        if (uri?.startsWith('file:///')) out.push({ path: require('url').fileURLToPath(uri), at: fs.statSync(f).mtimeMs });
      } catch {}
    }
  }
  return out.sort((a, b) => b.at - a.at).map((x) => x.path);
}
// The file called `name` under root, or with no name the code file edited most recently.
function findFile(root, name, depth = 6) {
  const queue = [[root, 0]];
  let seen = 0, newest = null, newestAt = 0;
  while (queue.length && seen < 5000) {
    const [dir, d] = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      seen++;
      if (e.isFile() && name && e.name === name) return path.join(dir, e.name);
      if (e.isFile() && !name && SOURCE.test(e.name)) {
        const at = fs.statSync(path.join(dir, e.name)).mtimeMs;
        if (at > newestAt) { newest = path.join(dir, e.name); newestAt = at; }
      }
      if (e.isDirectory() && d < depth && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) queue.push([path.join(dir, e.name), d + 1]);
    }
  }
  return newest;
}
const MAX_BYTES = 60000;   // what goes to Max in one question
// The active file first, then source files of the same kind beside it, up to MAX_BYTES.
function readAround(file) {
  const ext = path.extname(file).toLowerCase();
  const kin = { '.h': ['.c', '.cpp', '.h', '.hpp'], '.c': ['.c', '.h'], '.cpp': ['.cpp', '.hpp', '.h', '.cc'], '.hpp': ['.cpp', '.hpp', '.h'] }[ext] || [ext];
  const files = [{ name: path.basename(file), path: file, code: fs.readFileSync(file, 'utf8') }];
  let bytes = files[0].code.length;
  let siblings = [];
  try { siblings = fs.readdirSync(path.dirname(file)).filter((n) => kin.includes(path.extname(n).toLowerCase()) && n !== path.basename(file)); } catch {}
  for (const n of siblings.slice(0, 15)) {
    const p = path.join(path.dirname(file), n);
    try {
      const st = fs.statSync(p);
      if (!st.isFile() || bytes + st.size > MAX_BYTES) continue;
      files.push({ name: n, path: p, code: fs.readFileSync(p, 'utf8') });
      bytes += st.size;
    } catch {}
  }
  return files;
}
// { editor, dirty, files: [{ name, path, code }] }, or null when no editor shows a code file.
async function editorCode() {
  for (const { proc, title } of await editorTitles()) {
    const t = parseTitle(title);
    if (!t) continue;
    const dirs = EDITORS.filter(([p]) => p === proc).map(([, d]) => d);
    const folders = recentFolders(dirs);
    const root = folders.find((f) => path.basename(f).toLowerCase() === t.folder.toLowerCase()) || (t.folder ? null : folders[0]);
    const file = root && findFile(root, t.file);
    if (file) return { editor: proc === 'Code' ? 'VS Code' : proc, dirty: t.dirty, files: readAround(file) };
  }
  return null;
}

// ---------- Saving a fix ----------
// Only files the tutor read this session (from the editor or dropped on it) can be written, and only by
// replacing text that appears exactly once, so a stale or wrong fix never lands in the wrong place.
const readable = new Set();
function allow(files) { for (const f of files) if (f.path) readable.add(path.resolve(f.path)); return files; }
function readDropped(p) {
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error("That isn't a file");
  if (st.size > MAX_BYTES) throw new Error('That file is too big for me to read in one go');
  return allow([{ name: path.basename(p), path: p, code: fs.readFileSync(p, 'utf8') }])[0];
}
function applyFix({ file, find, replace }) {
  const p = path.resolve(String(file || ''));
  if (!readable.has(p)) throw new Error("I can only change files I've read for this");
  const text = fs.readFileSync(p, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const norm = (s) => String(s).replace(/\r\n/g, '\n').replace(/\n/g, eol);
  const old = norm(find), neu = norm(replace);
  const n = old ? text.split(old).length - 1 : 0;
  if (n !== 1) throw new Error(n ? 'That code appears more than once, so I left the file alone' : 'The file changed since I read it, so I left it alone');
  const updated = text.replace(old, () => neu);
  fs.writeFileSync(p, updated);
  return updated.replace(/\r\n/g, '\n');
}

module.exports = { intent, command, language, parseTitle, editorCode, allow, readDropped, applyFix };
