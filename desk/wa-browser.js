#!/usr/bin/env node
// WhatsApp Web on the home server, so the laptop can stay closed. Runs inside the Playwright container
// (desk/max-wa.sh starts it): a headless Chromium with a persistent profile and the Max WhatsApp extension
// loaded, exactly as in the laptop browser. The extension does the work; this only keeps the page alive
// and handles linking: when WhatsApp shows a QR code, it goes to the owner on Telegram (via the desk relay) to
// scan from his phone, and he hears when the link is back.
//   env: RELAY (http://127.0.0.1:18650), KEY_FILE, EXT (extension dir), PROFILE (Chromium profile dir)
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const RELAY = process.env.RELAY || 'http://127.0.0.1:18650';
const KEY = fs.readFileSync(process.env.KEY_FILE, 'utf8').trim();
const EXT = process.env.EXT, PROFILE = process.env.PROFILE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function relay(path, body) {
  try {
    const r = await fetch(RELAY + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Desk-Key': KEY }, body: JSON.stringify(body) });
    return r.ok;
  } catch (e) { log('relay', path, e.message); return false; }
}

async function main() {
  // WhatsApp refuses "HeadlessChrome", so present as the same Chromium version, headed.
  const ver = execFileSync(chromium.executablePath(), ['--version']).toString().match(/[\d.]+/)[0];
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true, channel: 'chromium',   // new headless mode: extensions work
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${process.env.LOCALE || 'en-US'}`],
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`,
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2,   // a sharp QR survives Telegram's compression
    locale: process.env.LOCALE || 'en-US', timezoneId: process.env.TZ || 'UTC',
  });
  ctx.on('close', () => { log('browser closed'); process.exit(1); });   // the container restarts us
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('console', (m) => { if (/^\[Max\]/.test(m.text())) log(m.text()); });
  await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 120000 });
  log(`WhatsApp Web opened (Chromium ${ver})`);
  const sw = ctx.serviceWorkers().length ? ctx.serviceWorkers() : [await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null)].filter(Boolean);
  log(sw.length ? `Max extension loaded (${sw[0].url().split('/')[2]})` : 'WARNING: the Max extension did not load');

  let state = 'starting', lastQr = '', since = Date.now(), qrChanged = Date.now(), sawQr = false;
  for (;;) {
    await sleep(5000);
    if (fs.existsSync(`${PROFILE}/../shot`)) {   // touch ~/.config/max-desk/shot to get a screenshot of the page
      fs.rmSync(`${PROFILE}/../shot`);
      await page.screenshot({ path: `${PROFILE}/../wa-shot.png` }).catch((e) => log('shot', e.message));
      // and the extension's own log (newest first), which is otherwise only visible in its popup
      const ext = ctx.serviceWorkers()[0];
      const xl = ext && await ext.evaluate(async () => (await chrome.storage.local.get('log')).log || []).catch((e) => [{ text: e.message }]);
      for (const l of (xl || []).slice(0, 12).reverse()) log(`[ext ${l.at || ''}] ${l.level === 'error' ? 'ERROR ' : ''}${l.text}`);
      const st = ext && await ext.evaluate(async () => { const s = await settings(); return { enabled: s.enabled, selfTest: s.selfTest, approval: s.approval, unsavedOnly: s.unsavedOnly, token: !!s.token, chats: (await chrome.storage.local.get('chats')).chats }; }).catch((e) => e.message);
      const dom = await page.evaluate(() => {
        const items = document.querySelectorAll('#pane-side [role="listitem"]'), rows = document.querySelectorAll('#pane-side [role="row"]');
        const list = [...(items.length ? items : rows)].slice(0, 4).map((r) => (r.innerText || '').split('\n').slice(0, 3).join(' / '));
        return { paneSide: !!document.querySelector('#pane-side'), listitems: items.length, rows: rows.length, first: list };
      }).catch((e) => e.message);
      log(`[debug] settings ${JSON.stringify(st)} dom ${JSON.stringify(dom)}`);
      log('screenshot saved: ~/.config/max-desk/wa-shot.png');
    }
    // Nobody is there to close WhatsApp's pop-ups ("What's new", tips), and they block every click the
    // extension makes, so press their Continue / OK / close buttons.
    const closed = await page.evaluate(() => {
      const n = [];
      for (const d of document.querySelectorAll('[role="dialog"], [data-animate-modal-popup="true"]')) {
        const b = [...d.querySelectorAll('button, [role="button"]')].find((x) =>
          /^(continue|ok|got it|close|not now|dismiss)$/i.test((x.innerText || x.getAttribute('aria-label') || '').trim()));
        if (b) { b.click(); n.push((d.innerText || '').split('\n')[0].slice(0, 60)); }
      }
      return n;
    }).catch(() => []);
    if (closed.length) log(`closed pop-up: ${closed.join(' | ')}`);
    if (fs.existsSync(`${PROFILE}/../eval.js`)) {   // debugging: run ~/.config/max-desk/eval.js in the extension, log the result
      const code = fs.readFileSync(`${PROFILE}/../eval.js`, 'utf8'); fs.rmSync(`${PROFILE}/../eval.js`);
      const ext = ctx.serviceWorkers()[0];
      const out = ext ? await ext.evaluate(`(async () => { ${code} })()`).catch((e) => 'ERR ' + e.message) : 'no extension';
      log(`[eval] ${JSON.stringify(out)}`.slice(0, 2000));
    }
    let now;
    try {
      now = await page.evaluate(() => {
        if (document.querySelector('#pane-side')) return { s: 'linked' };
        const qr = document.querySelector('[data-ref]');
        if (qr && qr.querySelector('canvas')) return { s: 'qr', ref: qr.getAttribute('data-ref') };
        return { s: 'loading' };
      });
    } catch (e) { log('page', e.message); now = { s: 'loading' }; }

    if (now.s === 'qr' && now.ref === lastQr && Date.now() - qrChanged > 90000) {
      // WhatsApp stops making new codes after a few minutes and waits for a click: reload for fresh ones.
      log('QR stopped refreshing, reloading');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
      qrChanged = Date.now();
      continue;
    }
    if (now.s === 'qr' && now.ref !== lastQr) {
      // WhatsApp makes a new code every ~20 s and the old one stops working, so every new code goes out:
      // the relay swaps it into the same Telegram message rather than sending a new one each time.
      lastQr = now.ref; qrChanged = Date.now();
      const box = await page.locator('[data-ref]').boundingBox().catch(() => null);
      const png = box && await page.screenshot({ timeout: 10000, clip: {   // with a white margin: scanners need one
        x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 24), width: box.width + 48, height: box.height + 48 } }).catch(() => null);
      if (png) {
        const ok = await relay('/tg/qr', { png: png.toString('base64') });
        log(ok ? 'QR updated on Telegram' : 'QR waiting: Telegram not reachable (desk bot token, or press Start on the bot)');
      }
    }
    if (now.s !== state) {
      log(`state ${state} -> ${now.s}`);
      if (now.s === 'qr') sawQr = true;
      if (now.s === 'linked' && sawQr) {   // via "Loading your chats" after a scan, too
        sawQr = false;
        await relay('/tg/qr', { done: true });
        await relay('/tg/text', { text: 'WhatsApp on the server is linked ✓ Max is watching for customers.' });
      }
      if (now.s === 'qr' && state === 'linked') log('logged out');
      state = now.s; since = Date.now();
    }
    if (state === 'loading' && Date.now() - since > 600000) {   // stuck (the first sync after linking can take minutes): reload
      log('stuck loading, reloading');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
      since = Date.now();
    }
  }
}

main().catch((e) => { log('fatal', e.message); process.exit(1); });
