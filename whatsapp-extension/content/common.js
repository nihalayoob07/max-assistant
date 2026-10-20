// DOM helpers, copied from the Redstone Invoicer extension (same WhatsApp Web techniques).
// Everything finds elements by what they say (labels, placeholders, button text), never by
// screen coordinates, so window size and zoom don't matter.
(function () {
  'use strict';
  if (window.RS) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  async function waitFor(fn, timeout = 10000, every = 250) {
    const end = Date.now() + timeout;
    for (;;) {
      let v;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(every);
    }
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  }

  const visibleAll = (sel, root = document) => [...root.querySelectorAll(sel)].filter(visible);

  // Text that belongs to the element itself, not to child elements ("Party Name" in "Party Name<span>*</span>").
  function ownText(el) {
    if (!el.childElementCount) return el.textContent || '';
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t;
  }

  function byOwnText(names, root = document) {
    const keys = [].concat(names).map(norm);
    return visibleAll('body *', root).filter((el) => {
      if (/^(SCRIPT|STYLE|INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName)) return false;
      return keys.includes(norm(ownText(el)));
    });
  }

  const FIELD_SEL = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, [role=combobox]';

  // Find a form control by its placeholder / aria-label / name, or by the nearest control
  // below or to the right of a visible label with that text.
  // True when nothing (a dialog, a backdrop) covers the middle of the element.
  function onTop(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  }

  function findField(names, sel = FIELD_SEL, { topmost = false } = {}) {
    names = [].concat(names);
    const cands = visibleAll(sel).filter((el) => !el.disabled && (!topmost || onTop(el)));
    for (const n of names) {
      const k = norm(n);
      const direct = cands.find((el) =>
        [el.placeholder, el.getAttribute('aria-label'), el.name, el.id].some((v) => v && norm(v) === k));
      if (direct) return direct;
      for (const lab of visibleAll('label')) {
        if (norm(lab.textContent) === k && lab.htmlFor) {
          const t = document.getElementById(lab.htmlFor);
          if (t && visible(t)) return t;
        }
      }
      let best = null, bestScore = 220;
      for (const lab of byOwnText(n)) {
        const L = lab.getBoundingClientRect();
        for (const el of cands) {
          if (lab.contains(el)) continue;
          const I = el.getBoundingClientRect();
          if (I.bottom < L.top - 4) continue;
          const hOverlap = I.left < L.right + 12 && I.right > L.left - 12;
          const vOverlap = I.top < L.bottom && I.bottom > L.top;
          let score = null;
          if (hOverlap) {
            // Adjacent table columns overlap a header by a few px; prefer the input centred under it.
            const dxCentre = Math.abs((I.left + I.right) / 2 - (L.left + L.right) / 2);
            score = Math.max(0, I.top - L.bottom) + dxCentre * 0.25;
          }
          else if (vOverlap && I.left >= L.right - 4) score = I.left - L.right;
          if (score !== null && score < bestScore) { best = el; bestScore = score; }
        }
      }
      if (best) return best;
    }
    for (const n of names) {
      const k = norm(n);
      const partial = cands.find((el) => el.placeholder && norm(el.placeholder).includes(k));
      if (partial) return partial;
    }
    return null;
  }

  // Real-looking mouse sequence. Some Vue/React widgets ignore a bare el.click().
  function realClick(el, { scroll = true } = {}) {
    if (scroll) el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerover', o));
    el.dispatchEvent(new MouseEvent('mouseover', o));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  }

  function clickable(el) {
    return el.closest('button, a, [role=button], [role=tab], [role=option], [role=menuitem], li') || el;
  }

  function nativeSet(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  }

  function setValue(el, value) {
    el.focus();
    if (typeof el.select === 'function') el.select();
    nativeSet(el, String(value));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Character-by-character typing, for search boxes that filter as you type.
  async function typeText(el, text) {
    el.focus();
    nativeSet(el, '');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    let v = '';
    for (const ch of String(text)) {
      v += ch;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      nativeSet(el, v);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await sleep(25);
    }
  }

  // Dump what's on screen so a broken selector can be fixed from the file alone.
  function diagnose(opts = {}) {
    const rect = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); };
    const controls = visibleAll(`${FIELD_SEL}, button, a, [role=button], [role=tab], [role=option], [role=dialog], [contenteditable=true], iframe, embed, object`)
      .slice(0, 1500).map((el) => ({
        tag: el.tagName.toLowerCase(), type: el.type || undefined, role: el.getAttribute('role') || undefined,
        placeholder: el.placeholder || undefined, aria: el.getAttribute('aria-label') || undefined,
        name: el.name || undefined, id: el.id || undefined,
        cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 80) || undefined,
        text: (el.innerText || '').trim().slice(0, 60) || undefined,
        value: opts.values && 'value' in el ? String(el.value).slice(0, 60) : undefined,
        src: el.src || el.data || undefined, rect: rect(el),
      }));
    const labels = opts.labels === false ? [] : visibleAll('body *')
      .filter((el) => { const t = ownText(el).trim(); return t && t.length <= 40; })
      .slice(0, 1500).map((el) => ({ tag: el.tagName.toLowerCase(), text: ownText(el).trim(), rect: rect(el) }));
    return { url: location.href, viewport: [innerWidth, innerHeight], at: new Date().toISOString(), controls, labels };
  }

  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  const log = (text, level = 'info') => chrome.runtime.sendMessage({ type: 'log', text, level }).catch(() => {});

  window.RS = { sleep, norm, waitFor, visible, visibleAll, onTop, ownText, byOwnText, findField, realClick, clickable, setValue, typeText, diagnose, bytesToB64, b64ToBytes, log };
})();
