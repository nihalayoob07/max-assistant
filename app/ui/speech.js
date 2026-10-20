// Numbers, dates, times and money as words, the way an Indian English speaker says them, before the voice
// engine sees them. Kokoro's own rules read any 4-digit number as a year ("₹6,749" became "sixty-seven
// forty-nine rupees") and read times and dates oddly, so numbers never reach it as digits except years.
// Works in the page (window.spokenNumbers) and in Node for the self-test: node speech.js --self-test
'use strict';
(function (root) {
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function under100(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''); }
  function under1000(n, and = true) {
    const h = Math.floor(n / 100), r = n % 100;
    if (!h) return under100(r);
    return `${ONES[h]} hundred` + (r ? `${and ? ' and' : ''} ${under100(r)}` : '');
  }
  // Indian grouping: crore, lakh, thousand.
  function words(n) {
    n = Math.round(n);
    if (n < 0) return 'minus ' + words(-n);
    if (n < 1000) return under1000(n);
    const parts = [];
    for (const [size, name] of [[1e7, 'crore'], [1e5, 'lakh'], [1e3, 'thousand']]) {
      const q = Math.floor(n / size);
      if (q) { parts.push(`${words(q)} ${name}`); n %= size; }
    }
    if (n) parts.push((n < 100 ? 'and ' : '') + under1000(n));
    return parts.join(' ');
  }
  function decimal(s) {
    const [i, f] = s.split('.');
    return words(Number(i)) + (f ? ' point ' + f.split('').map((d) => ONES[d]).join(' ') : '');
  }
  function ordinal(n) {
    const w = words(n);
    const irregular = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
    const last = w.split(/[\s-]/).pop();
    const fixed = irregular[last] || (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th');
    return w.slice(0, w.length - last.length) + fixed;
  }
  function year(y) {
    if (y >= 2000 && y < 2010) return words(y);
    const hi = Math.floor(y / 100), lo = y % 100;
    return `${under100(hi)} ${lo === 0 ? 'hundred' : lo < 10 ? 'oh ' + ONES[lo] : under100(lo)}`;
  }
  function time(h, m, ap) {
    h = Number(h); m = Number(m);
    let s = under100(h === 0 && !ap ? 0 : h) + (m === 0 ? (ap ? '' : " o'clock") : m < 10 ? ` oh ${ONES[m]}` : ` ${under100(m)}`);
    if (ap) s += ap.toLowerCase().startsWith('a') ? ' a m' : ' p m';
    return s;
  }
  const date = (d, m, y) => `the ${ordinal(Number(d))} of ${m}${y ? ' ' + year(Number(y)) : ''}`;
  const monthRe = MONTHS.join('|') + '|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
  const fullMonth = (m) => MONTHS.find((x) => x.toLowerCase().startsWith(m.toLowerCase().slice(0, 3)));
  const digits = (s) => s.replace(/\D/g, '').split('').map((d) => ONES[d]).join(' ');

  function spokenNumbers(t) {
    return String(t)
      // dates: 2026-10-18, 18 October 2026, October 18, 2026, 18 Oct
      .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => date(d, MONTHS[Number(m) - 1] || '', y))
      .replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (${monthRe})\\.?,? ?(\\d{4})?\\b`, 'gi'), (_, d, m, y) => date(d, fullMonth(m), y))
      .replace(new RegExp(`\\b(${monthRe})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? ?(\\d{4})?\\b`, 'gi'), (_, m, d, y) => date(d, fullMonth(m), y))
      // times: 9:05 pm, 21:30, 8:00
      .replace(/\b(\d{1,2}):(\d{2})\s?([ap]\.?m)?\b(?![:])/gi, (_, h, m, ap) => time(h, m, ap && ap.replace(/\./g, '')))
      .replace(/\b(\d{1,2})\s?([ap])\.?m\b/gi, (_, h, ap) => time(h, 0, ap + 'm'))
      // phone numbers: digit by digit
      .replace(/\+?\d[\d -]{8,}\d/g, (s) => (s.replace(/\D/g, '').length >= 10 ? digits(s) : s))
      // money: ₹6,749 / Rs. 6749 / 6,749 rupees
      .replace(/(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d+)?)/gi, (_, n) => `${decimal(n.replace(/,/g, ''))} rupees`)
      .replace(/\$\s?(\d[\d,]*(?:\.\d+)?)/g, (_, n) => `${decimal(n.replace(/,/g, ''))} dollars`)
      // ordinals and percentages
      .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, (_, n) => ordinal(Number(n)))
      .replace(/(\d[\d,]*(?:\.\d+)?)\s?%/g, (_, n) => `${decimal(n.replace(/,/g, ''))} percent`)
      // plain numbers: years stay years; everything else becomes words
      .replace(/\b\d[\d,]*(?:\.\d+)?\b/g, (s) => {
        const n = s.replace(/,/g, '');
        if (/^(19|20)\d\d$/.test(n) && !s.includes(',')) return year(Number(n));
        return decimal(n);
      });
  }

  root.spokenNumbers = spokenNumbers;
  if (typeof module !== 'undefined') module.exports = { spokenNumbers, words };
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module && process.argv.includes('--self-test')) {
    const cases = {
      '₹6,749 for the basic site.': 'six thousand seven hundred and forty-nine rupees for the basic site.',
      'That comes to ₹2,50,000.': 'That comes to two lakh fifty thousand rupees.',
      'Rs. 499': 'four hundred and ninety-nine rupees',
      "It's 9:05 pm.": "It's nine oh five p m.",
      'Meet at 8:00': "Meet at eight o'clock",
      'at 4 pm': 'at four p m',
      "It's Sunday, 18 October 2026.": "It's Sunday, the eighteenth of October twenty twenty-six.",
      'due 2026-10-25': 'due the twenty-fifth of October twenty twenty-six',
      'on Oct 3': 'on the third of October',
      'the 2nd video': 'the second video',
      'Call +91 90000 12345': 'Call nine one nine zero zero zero zero one two three four five',
      '15% off': 'fifteen percent off',
      '77 percent': 'seventy-seven percent',
      'You have 57 gigabytes free': 'You have fifty-seven gigabytes free',
      'in 1999': 'in nineteen ninety-nine',
      '7.5 out of 10': 'seven point five out of ten',
      '$250,000': 'two lakh fifty thousand dollars',
    };
    for (const [input, want] of Object.entries(cases)) {
      const got = spokenNumbers(input);
      if (got !== want) throw new Error(`"${input}" -> "${got}", expected "${want}"`);
    }
    console.log('self-test ok');
  }
})(typeof window !== 'undefined' ? window : globalThis);
