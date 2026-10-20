// YouTube on the laptop, instantly: plain commands ("pause", "next video", "search mr beast", "play the third
// video") are recognised here and done straight through the laptop helper, without a round trip to Max.
// Anything that doesn't match goes to Max as usual. Only "like" and "play the Nth video on screen" need eyes:
// they ask the sandbox's screen.py to find and click the spot (a few seconds, still no thinking).
'use strict';

const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, top: 1,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10 };
const ordinal = (w) => ORD[w] || (/^\d+$/.test(w) ? Number(w) : 0);
const ORDS = '(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|top|\\d+(?:st|nd|rd|th)?)';

function clean(text) {
  return String(text || '').toLowerCase().replace(/[^\w\s'+-]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(hey |ok |okay )?max\b ?/, '').replace(/^(please |can you |could you |now )+/, '')
    .replace(/ (please|for me|now)$/, '').replace(/ (on|in) youtube$/, '').replace(/^youtube /, '').trim();
}

// -> { do, ... } or null. Pure, so it's testable (see the self-test at the bottom).
function parse(text) {
  const t = clean(text);
  let m;
  if (/^(pause|stop)( the| this)?( video| it| music| song)?$/.test(t)) return { do: 'keys', keys: 'playpause', say: 'Paused.' };
  if (/^(play|resume|continue|unpause|start)( the| this)?( video| it| music| song)?( again)?$/.test(t)) return { do: 'keys', keys: 'playpause', say: 'Playing.' };
  if (/^(next|skip)( the)?( video| one| song| track)?$|^play (the )?next( video| one)?$/.test(t)) return { do: 'keys', keys: 'shift+n', focus: true, say: 'Next video.' };
  if (/^(previous|prev|go back|back|last)( video| one| song| track)?$|^play (the )?previous( video| one)?$/.test(t)) return { do: 'keys', keys: 'previous', say: 'Previous video.' };
  if (/^(volume up|turn (it |the volume )?up|louder|increase (the )?volume|raise (the )?volume)$/.test(t)) return { do: 'keys', keys: 'volumeup', times: 5, say: 'Louder.' };
  if (/^(volume down|turn (it |the volume )?down|quieter|softer|decrease (the )?volume|lower (the )?volume)$/.test(t)) return { do: 'keys', keys: 'volumedown', times: 5, say: 'Quieter.' };
  if (/^(full ?screen|go full ?screen|make it full ?screen|exit full ?screen|leave full ?screen)$/.test(t)) return { do: 'keys', keys: 'f', focus: true, say: 'Done.' };
  if (/^((turn|switch) (on|off) )?(the )?(captions|subtitles|cc)( on| off)?$|^(enable|disable|show|hide) (the )?(captions|subtitles)$/.test(t)) return { do: 'keys', keys: 'c', focus: true, say: 'Captions toggled.' };
  if (/^(like|like (this|the|that) video|like it|thumbs up)$/.test(t)) return { do: 'tap', what: 'the Like (thumbs-up) button under the video', say: 'Liked.' };
  if (/^(copy|share|get|grab)( me)?( the)?( video)?( share)? link( to (this|the) video)?$|^copy (the )?video (url|link)$/.test(t)) return { do: 'link', say: 'Link copied.' };
  if ((m = t.match(/^(search|find|look up|look for)( for)?( youtube for)? (.+)$/))) return { do: 'search', q: m[4] };
  if ((m = t.match(new RegExp(`^(play|open|click)( on)? (the )?${ORDS} (video|one|result)( on (the |my )?screen)?$`)))) return { do: 'pick', n: ordinal(m[4]) };
  if ((m = t.match(new RegExp(`^play (the )?${ORDS} (.+?) video$`)))) return { do: 'play', n: ordinal(m[2]), q: m[3] };
  if ((m = t.match(/^play (.+)$/)) && !/\b(it|this|that|the video)\b$/.test(m[1])) return { do: 'play', n: 1, q: m[1].replace(/ video$/, '') };
  return null;
}

// Top results for a search: [{ id, title }]. YouTube's page embeds them as JSON.
async function search(q) {
  const r = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } });
  const html = await r.text();
  const out = [], seen = new Set();
  for (const m of html.matchAll(/"videoRenderer":\{"videoId":"([\w-]{11})"/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const title = html.slice(m.index, m.index + 4000).match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
    out.push({ id: m[1], title: title ? JSON.parse(`"${title[1]}"`) : '' });
  }
  return out;
}

const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;
// Always his default browser (Zen), like every other link Max opens: mixing browsers lost track of the video.
const openUrl = (url) => `Start-Process ${ps(url)}`;
// Bring the browser window showing YouTube to the front, whichever browser it is (default: Zen). Windows won't
// let a background helper do that (it says yes, nothing moves) unless Alt is tapped first.
const focusYouTube = `Add-Type -Namespace YT -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, int f, int e); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);'
$t = Get-Process | ? { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match 'YouTube' } | sort { $_.ProcessName -ne 'zen' } | select -First 1
if (-not $t) { $t = Get-Process zen -ErrorAction SilentlyContinue | ? { $_.MainWindowHandle -ne 0 } | select -First 1 }
if ($t) { [YT.K]::keybd_event(0x12,0,0,0); [YT.K]::keybd_event(0x12,0,2,0); if ([YT.K]::IsIconic($t.MainWindowHandle)) { $null = [YT.K]::ShowWindow($t.MainWindowHandle, 9) }; $null = [YT.K]::SetForegroundWindow($t.MainWindowHandle) }
Start-Sleep -m 250`;

// Right after "search X", "play the video" / "play it" means the top result, not un-pausing.
let lastSearch = null;

// hands(path, body) talks to the laptop helper; sandbox(script) runs in Max's sandbox.
async function run(cmd, { hands, sandbox }) {
  if (cmd.keys === 'playpause' && cmd.say === 'Playing.' && lastSearch && Date.now() - lastSearch.at < 10 * 60000) cmd = { do: 'play', n: 1, q: lastSearch.q };
  lastSearch = cmd.do === 'search' ? { q: cmd.q, at: Date.now() } : null;
  const keys = (k, times = 1) => hands('/mouse', { action: 'keys', keys: k, times });
  if (cmd.do === 'keys') {
    if (cmd.focus) await hands('/run', { cmd: focusYouTube, timeout: 10 });
    await keys(cmd.keys, cmd.times);
    return cmd.say;
  }
  if (cmd.do === 'link') {
    await hands('/run', { cmd: focusYouTube, timeout: 10 });
    await keys('ctrl+l'); await keys('ctrl+c'); await keys('escape');
    const r = await hands('/run', { cmd: 'Get-Clipboard', timeout: 10 });
    const url = String(r.stdout || '').trim();
    return /youtu/.test(url) ? `Link copied: ${url}` : "I copied the address bar, but it doesn't look like a YouTube link. Is the video tab in front?";
  }
  if (cmd.do === 'search') {
    await hands('/run', { cmd: openUrl('https://www.youtube.com/results?search_query=' + encodeURIComponent(cmd.q)), timeout: 15 });
    return `Here's YouTube for ${cmd.q}.`;
  }
  if (cmd.do === 'play') {
    const vids = await search(cmd.q);
    const v = vids[cmd.n - 1];
    if (!v) return `I couldn't find a ${cmd.n > 1 ? 'video that far down' : 'video'} for ${cmd.q}.`;
    await hands('/run', { cmd: openUrl('https://www.youtube.com/watch?v=' + v.id), timeout: 15 });
    return `Playing ${v.title || cmd.q}.`;
  }
  if (cmd.do === 'pick') {
    // The vision model lists the videos it sees; screen.py counts them in reading order (it miscounted when
    // asked for "the fifth" directly, and counted Shorts). The reply names the video so a wrong pick is obvious.
    await hands('/run', { cmd: focusYouTube, timeout: 10 });
    const out = await sandbox(`python3 ~/.hermes/scripts/screen.py pick ${cmd.n} 2>&1; true`, 60000);
    const m = out.match(/^tapped \S+ \| (.*)$/m);
    return m ? `Playing ${m[1] || 'it'}.` : `I couldn't pick it: ${out.trim().split('\n').pop() || 'no answer from the screen reader'}.`;
  }
  if (cmd.do === 'tap') {
    await hands('/run', { cmd: focusYouTube, timeout: 10 });   // the video list must be the front window to be seen
    // 2>&1; true: screen.py explains failures on stderr and exits 1, which sandbox() would turn into a bare
    // "ssh exited 1". Keep its message so the reply says what went wrong.
    const out = await sandbox(`python3 ~/.hermes/scripts/screen.py tap ${JSON.stringify(cmd.what).replace(/[$`]/g, '')} 2>&1; true`, 60000);
    return /^tapped/m.test(out) ? cmd.say : `I couldn't spot it on your screen${out ? `: ${out.trim().split('\n').pop()}` : ''}.`;
  }
  return null;
}

module.exports = { parse, run, search };

// node youtube.js --self-test
if (require.main === module && process.argv.includes('--self-test')) {
  const want = {
    'pause': 'keys', 'Max, pause the video.': 'keys', 'next video': 'keys', 'volume up': 'keys', 'turn on captions': 'keys',
    'full screen': 'keys', 'like this video': 'tap', 'copy the video link': 'link', 'search mr beast': 'search',
    'Search for MrBeast on YouTube.': 'search', 'play the third video': 'pick', 'play the 2nd mr beast video': 'play',
    'play lofi beats': 'play', 'play it': 'keys', 'what is the weather': null, 'play the video': 'keys',
  };
  for (const [s, d] of Object.entries(want)) {
    const got = parse(s)?.do ?? null;
    if (got !== d) throw new Error(`"${s}" -> ${got}, expected ${d}`);
  }
  const p = parse('play the 2nd mr beast video');
  if (p.n !== 2 || p.q !== 'mr beast') throw new Error('ordinal play');
  if (parse('search mr beast').q !== 'mr beast') throw new Error('search query');
  console.log('self-test ok');
}
