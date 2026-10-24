// Syntax colours like VS Code's Dark+ theme for any language, without a parser: comments, strings, numbers,
// preprocessor lines, keywords (one list for the common languages), function calls, types and names.
// hl(code, lang) -> one HTML string per line. Works in the page (window.hl) and in Node for tutor-test.js.
'use strict';
(function (root) {
  const CONTROL = new Set(('if else elif for while do switch case default break continue return goto try catch except finally throw throws raise ' +
    'yield await import from export include using in of with as match when loop foreach then fi done esac pass').split(' '));
  const KEYWORD = new Set(('int char float double long short unsigned signed void bool boolean string var let const auto static extern register ' +
    'volatile struct union enum typedef class interface extends implements public private protected def fn func function lambda new delete ' +
    'this self super true false null nullptr None True False NULL undefined and or not is sizeof typeof instanceof namespace template ' +
    'typename virtual override final abstract package module mut pub impl trait where val fun async defer chan print_r echo').split(' '));
  const HASH = /^(py|python|rb|ruby|sh|bash|shell|zsh|perl|pl|r|yaml|yml|powershell|ps1|toml|make|makefile|elixir|julia|nim|coffee)/;
  const DASH = /^(sql|lua|haskell|hs|ada)/;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function hl(code, lang = '') {
    const l = String(lang).toLowerCase();
    const line = HASH.test(l) ? '#.*' : DASH.test(l) ? '--.*' : '\\/\\/.*';
    const re = new RegExp([
      '(\\/\\*[\\s\\S]*?(?:\\*\\/|$(?![\\s\\S])))',   // 1 block comment (to the end if unclosed)
      `(${line})`,                                         // 2 line comment
      '("""[\\s\\S]*?(?:"""|$(?![\\s\\S]))|\'\'\'[\\s\\S]*?(?:\'\'\'|$(?![\\s\\S]))|"(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?|`(?:\\\\.|[^`\\\\])*`?)',   // 3 strings
      '(^[ \\t]*#[ \\t]*\\w+)',                            // 4 preprocessor (C family; # is a comment above for the others)
      '(\\b0[xX][\\da-fA-F]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?[a-zA-Z]*\\b)',   // 5 numbers
      '([A-Za-z_$][\\w$]*)(?=\\s*\\()',                    // 6 a call
      '([A-Za-z_$][\\w$]*)',                               // 7 a name
    ].join('|'), 'gm');
    const toks = [];
    let at = 0, m;
    const src = String(code);
    while ((m = re.exec(src))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (m.index > at) toks.push(['', src.slice(at, m.index)]);
      const w = m[6] || m[7];
      const cls = m[1] || m[2] ? 'c' : m[3] ? 's' : m[4] ? 'cf' : m[5] ? 'n'
        : CONTROL.has(w) ? 'cf' : KEYWORD.has(w) ? 'k' : m[6] ? 'f' : /^[A-Z][a-z0-9]/.test(w) ? 't' : 'v';
      toks.push([cls, m[0]]);
      at = m.index + m[0].length;
    }
    if (at < src.length) toks.push(['', src.slice(at)]);
    // Split into lines, closing and reopening spans that cross a line break (block comments, long strings).
    const lines = [''];
    for (const [cls, text] of toks) {
      text.split('\n').forEach((part, i) => {
        if (i) lines.push('');
        if (part) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
      });
    }
    return lines;
  }
  if (typeof module !== 'undefined') module.exports = hl; else root.hl = hl;
})(typeof window !== 'undefined' ? window : globalThis);
