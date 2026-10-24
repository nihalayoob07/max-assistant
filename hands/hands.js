#!/usr/bin/env node
// Max's hands: runs commands on this computer for Max (which lives in its sandbox on the home server).
// One small HTTP server, no dependencies:
//   GET  /health                      -> { name, os, user }
//   POST /run { cmd, timeout?, confirmed? } -> { code, stdout, stderr }
//   GET  /screen                      -> { width, height, jpeg }   (Windows: primary screen, max 1280 wide)
//   POST /mouse { action, x, y, amount? } -> { code, stdout, stderr } (x, y as 0-1 fractions of the screen)
// Every request needs the shared secret in the X-Max-Token header. Commands run as the logged-in user
// (PowerShell on Windows, bash elsewhere). Anything matching CATASTROPHIC is refused unless the request
// says confirmed: true (Max only sets that after the owner said yes). Every command is logged.
//
// Usage: node hands.js --name laptop --listen 127.0.0.1:18700 --token-file <path> [--relay <listen>=<target>]
//   --relay lets the server helper also forward a second address to the laptop's reverse SSH tunnel,
//   because the sandbox can only reach the server's internal bridge address, not its loopback.
'use strict';
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const NAME = arg('name', os.hostname());
const [HOST, PORT] = arg('listen', '127.0.0.1:18700').split(':');
const LOG = arg('log', path.join(os.homedir(), `.max-hands-${NAME}.log`));
const WIN = process.platform === 'win32';

// Things that can't be undone and wreck the machine. Max must ask the owner first.
const CATASTROPHIC = [
  /\b(format|diskpart|mkfs|wipefs|fdisk|parted)\b/i,
  /\brm\s+(-\w*\s+)*-\w*r\w*\s+(-\w*\s+)*(\/|~|\$HOME|\/home|\/etc|\/usr|\/var|\/boot)(\s|\/?$)/i,
  /\bremove-item\b.*\b(c:\\?|c:\/|\$env:userprofile|~)(\s|"|'|$).*-recurse|\bremove-item\b.*-recurse.*\b(c:\\?|c:\/|\$env:userprofile)(\s|"|'|$)/i,
  /\b(shutdown|poweroff|halt|reboot|restart-computer|stop-computer)\b/i,
  /\bdd\s+.*\bof=\/dev\//i,
  /\b(reg\s+delete|bcdedit|cipher\s+\/w)\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

// Keyboard shortcuts: "win+shift+right" (window to the other monitor), "alt+tab", "ctrl+w", "volumeup"...
const VK = { win: 0x5b, shift: 0x10, ctrl: 0x11, control: 0x11, alt: 0x12, tab: 0x09, enter: 0x0d, esc: 0x1b, escape: 0x1b,
  space: 0x20, backspace: 0x08, delete: 0x2e, del: 0x2e, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28, printscreen: 0x2c, playpause: 0xb3, next: 0xb0, previous: 0xb1,
  volumeup: 0xaf, volumedown: 0xae, mute: 0xad, '.': 0xbe, period: 0xbe };
function keyCodes(combo) {
  return String(combo || '').toLowerCase().split('+').map((k) => k.trim()).filter(Boolean).map((k) =>
    VK[k] ?? (/^f([1-9]|1[0-2])$/.test(k) ? 0x6f + Number(k.slice(1)) : /^[a-z0-9]$/.test(k) ? k.toUpperCase().charCodeAt(0) : null));
}

// node hands.js --self-test: checks the catastrophic list blocks what it should and nothing ordinary.
if (process.argv.includes('--self-test')) {
  const bad = ['format c:', 'rm -rf /', 'rm -rf ~', 'shutdown /s', 'Remove-Item C:\\ -Recurse', 'sudo reboot', 'dd if=/dev/zero of=/dev/sda'];
  const ok = ['ls -la', 'Start-Process notepad', 'rm -rf ./build', 'Get-ChildItem $env:USERPROFILE\\Downloads', 'Remove-Item .\\old.txt'];
  for (const c of bad) if (!CATASTROPHIC.some((r) => r.test(c))) throw new Error(`should block: ${c}`);
  for (const c of ok) if (CATASTROPHIC.some((r) => r.test(c))) throw new Error(`should allow: ${c}`);
  const k = keyCodes('Win+Shift+Right');
  if (k.join() !== [0x5b, 0x10, 0x27].join() || keyCodes('ctrl+w').join() !== [0x11, 87].join() || !keyCodes('foo').includes(null)) throw new Error('keyCodes');
  console.log('self-test ok');
  process.exit(0);
}

const TOKEN = fs.readFileSync(arg('token-file'), 'utf8').trim();
if (TOKEN.length < 24) throw new Error('token too short');

function log(entry) {
  fs.appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', () => {});
}

// Windows won't let this background helper's children take the foreground, so apps Max opens came up behind
// whatever was in front (and a summoned Max then thought the desktop was showing). After a Start-Process,
// find what it opened (a new process with a window, or the browser for a link), tap Alt (which lifts the
// foreground lock) and bring it to the front.
const FOCUS_OPENED = `
$__w = $null
for ($__i = 0; $__i -lt 12 -and -not $__w; $__i++) {
  Start-Sleep -Milliseconds 350
  $__w = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $(try { $_.StartTime -ge $__t0 } catch { $false }) } | Sort-Object StartTime -Descending | Select-Object -First 1
  if (-not $__w -and $__url -and $__i -ge 2) { $__w = Get-Process zen, brave, chrome, msedge, firefox -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
}
if ($__w) {
  Add-Type -Namespace FO -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, int f, int e); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);'
  [FO.W]::keybd_event(0x12, 0, 0, 0); [FO.W]::keybd_event(0x12, 0, 2, 0)
  if ([FO.W]::IsIconic($__w.MainWindowHandle)) { $null = [FO.W]::ShowWindow($__w.MainWindowHandle, 9) }
  $null = [FO.W]::SetForegroundWindow($__w.MainWindowHandle)
}`;
const withFocus = (cmd) => (WIN && /\bStart-Process\b/i.test(cmd)
  ? `$__t0 = (Get-Date).AddSeconds(-1); $__url = ${/https?:|\.(com|in|org|net|io)\b/i.test(cmd) ? '$true' : '$false'}\n${cmd}\n${FOCUS_OPENED}` : cmd);

function run(cmd, timeoutMs, max = 20000) {
  return new Promise((resolve) => {
    const p = WIN
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(cmd, 'utf16le').toString('base64')], { windowsHide: true })
      : spawn('bash', ['-lc', cmd]);
    let out = '', err = '', done = false;
    const cap = (s, d) => (s.length < max + 40000 ? s + d : s);
    p.stdout.on('data', (d) => { out = cap(out, d); });
    p.stderr.on('data', (d) => { err = cap(err, d); });
    const t = setTimeout(() => { if (!done) { p.kill(); err += `\n[stopped after ${timeoutMs / 1000}s]`; } }, timeoutMs);
    p.on('close', (code) => { done = true; clearTimeout(t); resolve({ code, stdout: out.slice(0, max), stderr: err.slice(0, 8000) }); });
    p.on('error', (e) => { done = true; clearTimeout(t); resolve({ code: -1, stdout: '', stderr: e.message }); });
  });
}

// The Max app (our parent on the laptop) takes screenshots for us (Defender blocks PowerShell screen
// capture) and, while we click, hides its own windows and lets clicks through to what's under its hologram.
function askApp(msg, ms) {
  if (!process.send) return Promise.resolve({ error: 'only works when the Max app starts this helper' });
  return new Promise((r) => {
    const on = (m) => { if (m && m.re === msg.type) { clearTimeout(t); process.off('message', on); r(m); } };
    const t = setTimeout(() => { process.off('message', on); r({ error: 'the Max app did not answer' }); }, ms);
    process.on('message', on); process.send(msg);
  });
}

const DPI = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, int f, int e); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, int[] r);'; [W.U]::SetProcessDPIAware() | Out-Null;`;
let geo = null;   // last screenshot: [left, top, screenW, screenH, imageW, imageH] in physical pixels

// Screenshot the monitor he's working on: the one holding the front window (centre point, physical pixels).
async function screenshot() {
  const fg = await run(`${DPI} $r = New-Object int[] 4; $null = [W.U]::GetWindowRect([W.U]::GetForegroundWindow(), $r); "$([int](($r[0] + $r[2]) / 2)) $([int](($r[1] + $r[3]) / 2))"`, 10000);
  const [x, y] = fg.stdout.trim().split(' ').map(Number);
  const r = await askApp({ type: 'shot', at: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null }, 10000);
  if (r.error) return { error: r.error };
  geo = r.geo;
  return { width: r.width, height: r.height, jpeg: r.jpeg };
}

const MOUSE = { click: '[W.U]::mouse_event(2,0,0,0,0); [W.U]::mouse_event(4,0,0,0,0)',
  right: '[W.U]::mouse_event(8,0,0,0,0); [W.U]::mouse_event(16,0,0,0,0)', move: '' };
MOUSE.double = `${MOUSE.click}; Start-Sleep -m 90; ${MOUSE.click}`;

async function mouse(j) {
  if (j.action === 'keys') {
    const codes = keyCodes(j.keys);
    if (!codes.length || codes.length > 4 || codes.includes(null)) return { code: 1, stdout: '', stderr: `unknown keys "${j.keys}"; use names like win+shift+right, alt+tab, ctrl+w, f5` };
    // Our hologram steps aside first, so the keys reach the window he was using, not Max.
    await askApp({ type: 'aside', on: true }, 1000);
    const down = codes.map((c) => `[W.U]::keybd_event(${c},0,0,0)`).join('; ');
    const up = [...codes].reverse().map((c) => `[W.U]::keybd_event(${c},0,2,0)`).join('; ');
    // times: repeat in one go (e.g. 50 volume steps), not one PowerShell per press.
    const times = Math.max(1, Math.min(100, Math.trunc(Number(j.times) || 1)));
    const r = await run(`${DPI} 1..${times} | % { ${down}; Start-Sleep -m 30; ${up}; Start-Sleep -m 20 }; "pressed ${String(j.keys).replace(/[^\w+.]/g, '')}"`, 20000);
    setTimeout(() => askApp({ type: 'aside', on: false }, 1000), 300);
    return r;
  }
  if (!geo) return { code: 1, stdout: '', stderr: 'look at the screen first' };
  const [left, top, sw, sh] = geo;
  const f = (v) => Math.min(Math.max(Number.isFinite(Number(v)) ? Number(v) : 0.5, 0), 1);
  const x = Math.round(left + f(j.x) * (sw - 1)), y = Math.round(top + f(j.y) * (sh - 1));
  const act = j.action === 'scroll' ? `[W.U]::mouse_event(0x800,0,0,${120 * Math.max(-30, Math.min(30, Math.trunc(Number(j.amount) || -3)))},0)` : MOUSE[j.action];
  if (act === undefined) return { code: 1, stdout: '', stderr: 'action must be click, double, right, move, scroll or keys' };
  await askApp({ type: 'aside', on: true }, 1000);
  const r = await run(`${DPI} [W.U]::SetCursorPos(${x}, ${y}) | Out-Null; Start-Sleep -m 60; ${act}; "done at ${x},${y}"`, 10000);
  setTimeout(() => askApp({ type: 'aside', on: false }, 1000), 300);
  return r;
}

const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

http.createServer((req, res) => {
  if (req.headers['x-max-token'] !== TOKEN) return send(res, 401, { error: 'bad token' });
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { name: NAME, os: WIN ? 'windows' : process.platform, user: os.userInfo().username });
  if (req.method === 'GET' && req.url === '/screen') {
    if (!WIN) return send(res, 400, { error: 'screen is laptop only' });
    return screenshot().then((r) => { log({ screen: true, ok: !r.error }); send(res, r.error ? 500 : 200, r); });
  }
  if (req.method !== 'POST' || !['/run', '/mouse', '/say'].includes(req.url)) return send(res, 404, { error: 'not found' });
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 100000) req.destroy(); });
  req.on('end', async () => {
    let j;
    try { j = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }); }
    // The phone as a microphone: what was said there goes to the Max app here, as if said after "Max".
    if (req.url === '/say') {
      if (j.hold) return send(res, 200, await askApp({ type: 'hold' }, 3000));   // the phone started listening
      const text = String(j.text || '').trim().slice(0, 500);
      if (!text) return send(res, 400, { error: 'nothing to say' });
      const r = await askApp({ type: 'say', text }, 3000);
      log({ say: text.length, ok: !r.error });
      return send(res, r.error ? 500 : 200, r);
    }
    if (req.url === '/mouse') {
      if (!WIN) return send(res, 400, { error: 'mouse is laptop only' });
      const r = await mouse(j);
      log({ mouse: j.action, x: j.x, y: j.y, code: r.code });
      return send(res, 200, r);
    }
    const cmd = String(j.cmd || '').trim();
    if (!cmd) return send(res, 400, { error: 'no command' });
    if (!j.confirmed && CATASTROPHIC.some((r) => r.test(cmd))) {
      log({ cmd, refused: true });
      return send(res, 403, { error: 'This command is on the catastrophic list. Ask the owner first, then resend with confirmed.' });
    }
    const timeout = Math.min(Math.max(Number(j.timeout) || 60, 1), 600) * 1000;
    const r = await run(withFocus(cmd), timeout);
    log({ cmd, confirmed: !!j.confirmed, code: r.code });
    send(res, 200, r);
  });
}).listen(Number(PORT), HOST, () => console.log(`max-hands "${NAME}" on ${HOST}:${PORT}`));

// Optional TCP relay: --relay 172.19.0.1:18700=127.0.0.1:18700
const relay = arg('relay');
if (relay) {
  const [from, to] = relay.split('=');
  const [fh, fp] = from.split(':'); const [th, tp] = to.split(':');
  net.createServer((c) => {
    const u = net.connect(Number(tp), th);
    c.pipe(u).pipe(c);
    const end = () => { c.destroy(); u.destroy(); };
    c.on('error', end); u.on('error', end);
  }).listen(Number(fp), fh, () => console.log(`relay ${from} -> ${to}`));
}
