// Everyday PC commands answered instantly by the app itself, no AI: the time, battery, volume, brightness,
// opening and closing apps and sites, window shortcuts, lock, screenshots, timers, quick maths. Anything that
// doesn't match goes on to the YouTube commands, then to Max. They act on this laptop.
'use strict';

function clean(text) {
  return String(text || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^\w\s'%.+*/x-]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(hey |ok |okay )?max\b[ ,.]*/, '').replace(/^(please |can you |could you |now |hey )+/, '')
    .replace(/[ .]*(please|for me|now|max)?[ .?!]*$/, '').trim();
}

// Spoken name -> [how to open it, process name to close it]. Store apps open through their URL scheme.
const APPS = {
  spotify: ['spotify:', 'Spotify'], whatsapp: ['whatsapp:', 'WhatsApp'], discord: ['discord:', 'Discord'],
  zen: ['zen', 'zen'], 'zen browser': ['zen', 'zen'], browser: ['https://www.google.com', null],
  brave: ['brave', 'brave'], chrome: ['chrome', 'chrome'], edge: ['msedge', 'msedge'], firefox: ['firefox', 'firefox'],
  notepad: ['notepad', 'Notepad'], calculator: ['calc', 'CalculatorApp'], paint: ['mspaint', 'mspaint'],
  'file explorer': ['explorer', null], explorer: ['explorer', null], files: ['explorer', null],
  downloads: ['explorer shell:Downloads', null], documents: ['explorer shell:Personal', null], desktop: ['explorer shell:Desktop', null],
  settings: ['ms-settings:', 'SystemSettings'], 'task manager': ['taskmgr', 'Taskmgr'], 'control panel': ['control', null],
  terminal: ['wt', 'WindowsTerminal'], powershell: ['powershell', null], cmd: ['cmd', null], 'command prompt': ['cmd', null],
  'vs code': ['code', 'Code'], vscode: ['code', 'Code'], code: ['code', 'Code'], cursor: ['cursor', 'Cursor'],
  steam: ['steam:', 'steam'], obsidian: ['obsidian:', 'Obsidian'], word: ['winword', 'WINWORD'], excel: ['excel', 'EXCEL'],
  powerpoint: ['powerpnt', 'POWERPNT'], outlook: ['outlook', 'OUTLOOK'], 'snipping tool': ['snippingtool', 'SnippingTool'],
  camera: ['microsoft.windows.camera:', 'WindowsCamera'], photos: ['ms-photos:', 'Photos'], 'microsoft store': ['ms-windows-store:', 'WinStore.App'],
  'max dashboard': [null, null], dashboard: [null, null],
};
const SITES = {
  youtube: 'https://www.youtube.com', gmail: 'https://mail.google.com', google: 'https://www.google.com',
  github: 'https://github.com', 'whatsapp web': 'https://web.whatsapp.com', instagram: 'https://www.instagram.com',
  netflix: 'https://www.netflix.com', 'google drive': 'https://drive.google.com', drive: 'https://drive.google.com',
  maps: 'https://maps.google.com', 'google maps': 'https://maps.google.com', chatgpt: 'https://chatgpt.com', claude: 'https://claude.ai',
  linkedin: 'https://www.linkedin.com', twitter: 'https://x.com', x: 'https://x.com', reddit: 'https://www.reddit.com', amazon: 'https://www.amazon.in',
  calendar: 'https://calendar.google.com',
};

const KEYS = [
  [/^(minimi[sz]e|hide)( this| the)?( window| app)?$/, 'win+down', 'Minimised.'],
  [/^(maximi[sz]e|make it bigger|full size)( this| the)?( window| app)?$/, 'win+up', 'Maximised.'],
  [/^(show (the )?desktop|minimi[sz]e (all|everything)|hide (all|everything))$/, 'win+d', 'Desktop.'],
  [/^(switch (window|app|apps|windows)|alt tab|go back to (the )?(last|previous) (app|window))$/, 'alt+tab', 'Switched.'],
  [/^(close (this|the) (window|app)|close it|quit (this|the) app)$/, 'alt+f4', 'Closed.'],
  [/^(close (this|the) tab|close tab)$/, 'ctrl+w', 'Tab closed.'],
  [/^(new tab|open a new tab)$/, 'ctrl+t', 'New tab.'],
  [/^(reopen (the )?(last|closed) tab|undo close tab)$/, 'ctrl+shift+t', 'Reopened.'],
  [/^(refresh|reload)( (the|this) page)?$/, 'f5', 'Refreshed.'],
  [/^(go back|back)( a page)?$/, 'alt+left', 'Back.'],
  [/^(go forward|forward)( a page)?$/, 'alt+right', 'Forward.'],
  [/^(snap|move) (it |this |the window )?(to the )?left$/, 'win+left', 'Snapped left.'],
  [/^(snap|move) (it |this |the window )?(to the )?right$/, 'win+right', 'Snapped right.'],
  [/^(move|send|put) (it|this|that|the window)( to| on)? (the )?(other|second|next) (screen|monitor|display)$/, 'win+shift+right', 'Moved to the other screen.'],
  [/^(take a |take |grab a )?(screenshot|screen shot|screengrab)$/, 'win+printscreen', 'Screenshot saved to Pictures, Screenshots.'],
  [/^(snip|take a snip|screen ?shot (a|an) (part|area|region))$/, 'win+shift+s', 'Pick the area.'],
  [/^(mute|unmute)( the)?( pc| computer| laptop| sound| volume| audio)?$/, 'mute', null],
  [/^(play|pause|resume)( the)? (music|song|media)$/, 'playpause', 'Done.'],
  [/^(next|skip)( the)? (song|track)$/, 'next', 'Next.'],
  [/^previous (song|track)$/, 'previous', 'Previous.'],
  [/^(open )?(the )?(emoji|emoji picker)$/, 'win+.', 'Emoji picker.'],
];

const NUM = { zero: 0, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, max: 100, full: 100, half: 50 };
const num = (w) => (/^\d+$/.test(w) ? Number(w) : NUM[w]);
const UNIT = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600 };

// "what's 15% of 2000", "25 times 4", "120 divided by 7" -> number, or null if it isn't plain maths.
function maths(t) {
  const m = t.match(/^(what'?s|what is|calculate|how much is)? ?(.+)$/);
  let e = (m ? m[2] : t).replace(/\bpercent of\b|% of\b/g, '*0.01*').replace(/\bpercent\b|%/g, '*0.01')
    .replace(/\b(plus|and)\b/g, '+').replace(/\bminus\b/g, '-').replace(/\b(times|x|into|multiplied by)\b/g, '*')
    .replace(/\b(divided by|over)\b/g, '/').replace(/\bsquared\b/g, '**2').replace(/\s+/g, '');
  if (!/\d/.test(e) || !/[+\-*/]/.test(e) || !/^[\d.+\-*/()]+$/.test(e)) return null;
  try { const v = Function(`"use strict"; return (${e});`)(); return Number.isFinite(v) ? v : null; } catch { return null; }
}

function parse(text) {
  const t = clean(text);
  let m;
  if (/^(what'?s|what is|tell me) (the )?time( is it)?( now)?$|^what time is it( now)?$|^(the )?time$/.test(t)) return { do: 'say', what: 'time' };
  if (/^(what'?s|what is) (the |today'?s )?date( today)?$|^what day is (it|today)$|^(the |today'?s )?date$|^what'?s today$/.test(t)) return { do: 'say', what: 'date' };
  if (/^(how much )?(battery|charge)( left| level| percentage| status)?$|^(what'?s|how'?s|check) (my |the )?battery( level)?$|^is (it|the laptop) charging$/.test(t)) return { do: 'battery' };
  if (/^(how much )?(free )?(disk|storage) (space )?(left|free)?$|^(check )?(disk|storage) space$/.test(t)) return { do: 'disk' };
  if ((m = t.match(/^(set |turn |change )?(the )?volume (to |at )?(\d{1,3}|zero|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|max|full|half)( percent|%)?$/))) return { do: 'volume', to: Math.min(100, num(m[4])) };
  if ((m = t.match(/^(set |turn |change )?(the )?brightness (to |at )?(\d{1,3}|zero|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|max|full|half)( percent|%)?$/))) return { do: 'brightness', to: Math.min(100, num(m[4])) };
  if ((m = t.match(/^(brightness up|increase (the )?brightness|brighter|turn (the )?brightness up)$/))) return { do: 'brightness', by: 20 };
  if ((m = t.match(/^(brightness down|decrease (the )?brightness|dimmer|dim (the )?screen|turn (the )?brightness down)$/))) return { do: 'brightness', by: -20 };
  if (/^lock( the)?( pc| computer| laptop| screen| it)?$/.test(t)) return { do: 'lock' };
  if (/\b(this|that|the) (error|warning|popup|pop up|message|dialog|crash)\b|^(what'?s|what is) on (my|the) screen|^what am i looking at|^(explain|read( me)?) (this|that|my screen|the screen)|^how do i fix (this|that)/.test(t)) return { do: 'explain', q: t };
  for (const [re, keys, say] of KEYS) if (re.test(t)) return { do: 'keys', keys, say: say || (t.startsWith('un') ? 'Unmuted.' : 'Muted.') };
  if ((m = t.match(/^(set |start )?(a )?timer (for )?(\d+|a|an|one|two|three|five|ten|fifteen|twenty|thirty) ?(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)$/))) {
    const n = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 }[m[4]] ?? Number(m[4]);
    return { do: 'timer', secs: n * UNIT[m[5]], label: `${n} ${m[5].startsWith('h') ? 'hour' : m[5].startsWith('m') ? 'minute' : 'second'}${n === 1 ? '' : 's'}` };
  }
  if ((m = t.match(/^(google|search google for|search the web for|look up on google) (.+)$/))) return { do: 'url', url: 'https://www.google.com/search?q=' + encodeURIComponent(m[2]), say: `Googling ${m[2]}.` };
  if ((m = t.match(/^(open|launch|start|go to|show me|show) (up )?(the |my )?(.+?)( app)?$/))) {
    const name = m[4];
    if (APPS[name]) return APPS[name][0] ? { do: 'open', target: APPS[name][0], say: `Opening ${name}.` } : { do: 'dashboard' };
    if (SITES[name]) return { do: 'url', url: SITES[name], say: `Opening ${name}.` };
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(name)) return { do: 'url', url: 'https://' + name, say: `Opening ${name}.` };
  }
  if ((m = t.match(/^(close|quit|exit|kill) (the |my )?(.+?)( app)?$/)) && APPS[m[3]]?.[1]) return { do: 'close', proc: APPS[m[3]][1], say: `Closed ${m[3]}.` };
  const v = maths(t);
  if (v !== null) return { do: 'say', what: 'maths', value: v };
  return null;
}

const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;

// hands(path, body): the laptop helper. sandbox(script): runs in Max's sandbox. notify(title, body): a desktop
// notification. showDashboard(): the Max window.
async function run(cmd, { hands, sandbox, notify, showDashboard }) {
  const sh = async (c) => (await hands('/run', { cmd: c, timeout: 20 })).stdout?.trim() || '';
  const now = new Date();
  if (cmd.do === 'say' && cmd.what === 'time') return `It's ${now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}.`;
  if (cmd.do === 'say' && cmd.what === 'date') return `It's ${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;
  if (cmd.do === 'say' && cmd.what === 'maths') return `That's ${Number(cmd.value.toFixed(4)).toLocaleString('en-IN')}.`;
  if (cmd.do === 'battery') {
    const [pct, status] = (await sh('$b = Get-CimInstance Win32_Battery | select -First 1; "$($b.EstimatedChargeRemaining) $($b.BatteryStatus)"')).split(' ');
    if (!pct) return "This PC doesn't report a battery.";
    return `Battery's at ${pct} percent${status === '2' ? ', charging' : ''}.`;
  }
  if (cmd.do === 'disk') {
    const free = await sh('[math]::Round((Get-PSDrive C).Free / 1GB)');
    return `You've got ${free} gigabytes free on C.`;
  }
  if (cmd.do === 'volume') {
    // No volume API without extra installs: drop to zero, then step up (each key press is 2%).
    await hands('/mouse', { action: 'keys', keys: 'volumedown', times: 50 });
    await hands('/mouse', { action: 'keys', keys: 'volumeup', times: Math.round(cmd.to / 2) });
    return `Volume at ${cmd.to} percent.`;
  }
  if (cmd.do === 'brightness') {
    const cur = Number(await sh('(Get-CimInstance -Namespace root/wmi WmiMonitorBrightness -ErrorAction SilentlyContinue | select -First 1).CurrentBrightness'));
    if (!Number.isFinite(cur) || !(await sh('Get-CimInstance -Namespace root/wmi WmiMonitorBrightness -ErrorAction SilentlyContinue | select -First 1'))) return "I can't change brightness on this screen.";
    const to = Math.max(0, Math.min(100, cmd.to ?? cur + cmd.by));
    await sh(`Get-CimInstance -Namespace root/wmi WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = ${to} } | Out-Null`);
    return `Brightness at ${to} percent.`;
  }
  if (cmd.do === 'explain') {
    // Straight to the vision model (Nemotron VL) through screen.py: one screenshot, a spoken answer, no agent.
    const q = JSON.stringify(cmd.q).replace(/[$`\\]/g, '');
    const out = await sandbox(`python3 ~/.hermes/scripts/screen.py explain ${q} 2>&1; true`, 60000);
    return out.trim() || "I couldn't read your screen just now.";
  }
  if (cmd.do === 'lock') { await sh('rundll32.exe user32.dll,LockWorkStation'); return 'Locked.'; }
  if (cmd.do === 'keys') { await hands('/mouse', { action: 'keys', keys: cmd.keys }); return cmd.say; }
  if (cmd.do === 'open') {
    const [exe, ...args] = cmd.target.split(' ');
    await sh(`Start-Process ${ps(exe)}${args.length ? ` -ArgumentList ${ps(args.join(' '))}` : ''}`);
    return cmd.say;
  }
  if (cmd.do === 'url') { await sh(`Start-Process ${ps(cmd.url)}`); return cmd.say; }
  if (cmd.do === 'close') {
    const out = await sh(`$p = Get-Process -Name ${ps(cmd.proc)} -ErrorAction SilentlyContinue; if ($p) { $p | Stop-Process -Force; 'closed' }`);
    return out === 'closed' ? cmd.say : "It isn't open.";
  }
  if (cmd.do === 'dashboard') { showDashboard(); return 'Here you go.'; }
  if (cmd.do === 'timer') {
    setTimeout(() => notify('Timer done', `Your ${cmd.label} timer is up.`), cmd.secs * 1000);
    return `Timer set for ${cmd.label}.`;
  }
  return null;
}

module.exports = { parse, run };

// node pc.js --self-test
if (require.main === module && process.argv.includes('--self-test')) {
  const want = {
    'What time is it?': 'say', "Max, what's the time": 'say', "what's the date": 'say', 'what day is it': 'say',
    'battery': 'battery', "how's my battery": 'battery', 'set volume to 40': 'volume', 'volume 70%': 'volume',
    'brightness to fifty': 'brightness', 'dim the screen': 'brightness', 'lock the pc': 'lock', 'minimise this window': 'keys',
    'show desktop': 'keys', 'close this tab': 'keys', 'take a screenshot': 'keys', 'mute': 'keys',
    'move it to the other screen': 'keys', 'open spotify': 'open', 'open youtube': 'url', 'open github.com': 'url',
    'google best pizza near me': 'url', 'close spotify': 'close', 'set a timer for 5 minutes': 'timer',
    "what's 15% of 2000": 'say', '25 times 4': 'say', 'open the dashboard': 'dashboard',
    "Max, what's this error?": 'explain', "what's on my screen": 'explain', 'how do i fix this': 'explain', 'what does this popup mean': 'explain',
    'play the third video': null, 'pause': null, 'how are my leads doing': null, 'open the third video': null,
    'show me my shop orders': null,
  };
  for (const [s, d] of Object.entries(want)) {
    const got = parse(s)?.do ?? null;
    if (got !== d) throw new Error(`"${s}" -> ${got}, expected ${d}`);
  }
  if (parse("what's 15% of 2000").value !== 300 || parse('25 times 4').value !== 100) throw new Error('maths');
  if (parse('set a timer for 5 minutes').secs !== 300 || parse('set volume to 40').to !== 40) throw new Error('numbers');
  console.log('self-test ok');
}
