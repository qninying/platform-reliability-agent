// Reads TypeScript source text well enough to tell code from comments and strings. Pure: no file access.
//
// Comments are blanked to spaces (newlines kept, so line numbers still match the file), and every string or
// template literal is recorded as a span, so a caller can ignore a name that is only mentioned in a comment or
// a string. A '/' is read as a regex literal after an operator or keyword and as division after a value,
// because a quote inside a regex (`/'/g`) would otherwise open a string that never closes.

export interface Scanned { code: string; strings: Array<[number, number]>; balanced: boolean }

const WORD = /[A-Za-z0-9_$]/;
const REGEX_AFTER = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'instanceof', 'new', 'do', 'else', 'yield', 'await', 'throw']);

function regexStartsAt(t: string, at: number): boolean {
  let k = at - 1;
  while (k >= 0 && /\s/.test(t[k])) k--;
  if (k < 0) return true;
  if (WORD.test(t[k])) {
    let w = k;
    while (w >= 0 && WORD.test(t[w])) w--;
    return REGEX_AFTER.has(t.slice(w + 1, k + 1));
  }
  return !')]}.\'"`'.includes(t[k]);
}

function regexEnd(t: string, at: number): number {
  let inClass = false;
  for (let k = at + 1; k < t.length && t[k] !== '\n'; k++) {
    const c = t[k];
    if (c === '\\') { k++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') inClass = true;
    else if (c === '/') { k++; while (k < t.length && /[a-z]/.test(t[k])) k++; return k; }
  }
  return -1;
}

export function scan(src: string): Scanned {
  const t = src.replace(/\r\n/g, '\n');
  const out = t.split('');
  const strings: Array<[number, number]> = [];
  // Each frame is code (with its brace depth) or a template literal.
  const stack: Array<{ tpl: boolean; depth: number; start: number }> = [{ tpl: false, depth: 0, start: 0 }];
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < t.length) {
    const top = stack[stack.length - 1];
    const c = t[i];
    if (top.tpl) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { strings.push([top.start, i + 1]); stack.pop(); i++; continue; }
      if (c === '$' && t[i + 1] === '{') { strings.push([top.start, i]); stack.push({ tpl: false, depth: 0, start: i }); i += 2; continue; }
      i++; continue;
    }
    if (c === '`') { stack.push({ tpl: true, depth: 0, start: i }); i++; continue; }
    if (c === '{') { top.depth++; i++; continue; }
    if (c === '}') {
      if (top.depth === 0 && stack.length > 1) { stack.pop(); stack[stack.length - 1].start = i + 1; } else top.depth = Math.max(0, top.depth - 1);
      i++; continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      i++;
      while (i < t.length && t[i] !== c && t[i] !== '\n') i += t[i] === '\\' ? 2 : 1;
      if (t[i] === c) i++;
      strings.push([start, i]);
      continue;
    }
    if (c === '/' && t[i + 1] === '*') {
      const end = t.indexOf('*/', i + 2);
      const stop = end < 0 ? t.length : end + 2;
      blank(i, stop); i = stop; continue;
    }
    if (c === '/' && t[i + 1] === '/') {
      const nl = t.indexOf('\n', i);
      const stop = nl < 0 ? t.length : nl;
      blank(i, stop); i = stop; continue;
    }
    if (c === '/' && regexStartsAt(t, i)) {
      const end = regexEnd(t, i);
      if (end > 0) { i = end; continue; }
    }
    i++;
  }
  return { code: out.join(''), strings, balanced: stack.length === 1 };
}

export const inString = (s: Scanned, at: number) => s.strings.some(([a, b]) => at >= a && at < b);
export const lineOf = (text: string, at: number) => text.slice(0, at).split('\n').length;

// The text of the call's first argument, starting at its '(' and stopping at the first top-level ',' or the
// closing ')'. Null when the call does not close.
export function firstArgument(code: string, open: number): { text: string; end: ',' | ')' } | null {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < code.length && code[i] !== c) i += code[i] === '\\' ? 2 : 1;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (--depth === 0) return { text: code.slice(open + 1, i).trim(), end: ')' }; }
    else if (c === ',' && depth === 1) return { text: code.slice(open + 1, i).trim(), end: ',' };
  }
  return null;
}

// The balanced text from the bracket at `open` to its match, inclusive. Null when it does not close.
export function balanced(code: string, open: number): string | null {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const close = pairs[code[open]];
  if (!close) return null;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < code.length && code[i] !== c) i += code[i] === '\\' ? 2 : 1;
      continue;
    }
    if (c === code[open]) depth++;
    else if (c === close && --depth === 0) return code.slice(open, i + 1);
  }
  return null;
}
