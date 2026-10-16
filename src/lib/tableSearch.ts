// ─── TABLE SEARCH — browser matcher ──────────────────────────
// Mirror of server/lib/tableSearch.js — keep in sync. Both are checked against the
// shared cases in tests/tableSearch/cases.json and must give identical results.
// Adds highlightSegments (browser only); the server adds escapeLike and likeClause.
//
// Query syntax (parse):
//   words           every word must match somewhere in the row (AND)
//   OR  or  |       an uppercase OR, or a |, separates groups; a row matches if any
//                   group matches (AND binds tighter than OR). A lowercase "or" is an
//                   ordinary word.
//   field:value     checks only that field (aliases come from the screen's fieldMap)
//   "two words"     a phrase; also field:"two words". An unbalanced quote makes the
//                   rest of the query the phrase.
// q is capped at 200 characters and 10 terms (extra terms ignored, truncated: true).
//
// Matching (matchRow): a word matches when it is a substring of any column, or, for
// letters-only words of 5 or more characters, when a word in a column is within edit
// distance 1 (substitution, insertion, deletion or adjacent transposition). A word with
// a digit never gets typo tolerance — near-miss codes are different items (P-101A and
// P-101B, V-102 and V-103) — so it matches only as an exact substring. Phrases match as
// substrings only. Field flags: "code" = prefix at a dot boundary ("02" matches "02"
// and "02.01.01", not "12.02"); "enum" = the whole value. Text is compared after
// normalise(): lower case, accents stripped, spaces collapsed.
//
// No regular expression is built from user text: the scanner walks characters and
// matching uses includes / startsWith / a bounded edit-distance check. The two
// regular expressions below are fixed character classes.

export const MAX_CHARS = 200
export const MAX_TERMS = 10
export const FUZZY_MIN = 5

export type TermKind = 'word' | 'phrase' | 'field'
export interface Term { kind: TermKind; value: string; text: string; field?: string; quoted?: boolean }
export interface Parsed { groups: Term[][]; truncated: boolean }
export type FieldFlag = 'code' | 'enum'
export type FieldSpec = string | { key: string; flag?: FieldFlag | null; column?: string | null }
export type FieldMap = Record<string, FieldSpec>
export type Row = Record<string, unknown>
export interface MatchResult { match: boolean; matchedTerms: string[]; error?: string }
export interface Segment { text: string; hit: boolean }

type Token =
  | { type: 'or' }
  | { type: 'word'; raw: string }
  | { type: 'phrase'; raw: string }
  | { type: 'field'; field: string; raw: string; quoted: boolean }
interface Span { cps: string[]; start: number; end: number }
interface Resolved { key: string; flag: FieldFlag | null; column: string | null }
interface Cell { norm: string; words: ArrayLike<string>[] | null }

const SPACE_CHAR = /\s/u
const ALNUM_CHAR = /[\p{L}\p{N}]/u
const DIGIT_CHAR = /\p{N}/u
// ASCII is tested by character code (same result as the classes, much faster).
const isSpace = (ch: string) => { const c = ch.charCodeAt(0); return c < 128 ? c === 32 || (c >= 9 && c <= 13) : SPACE_CHAR.test(ch) }
const isAlnum = (ch: string) => {
  const c = ch.charCodeAt(0)
  return c < 128 ? (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) : ALNUM_CHAR.test(ch)
}

// ─── NORMALISE ───────────────────────────────────────────────
// One character at a time: decompose, lower-case, drop combining accents (U+0300–U+036F).
function foldChar(ch: string): string {
  let out = ''
  for (const c of ch.normalize('NFD').toLowerCase()) {
    const cp = c.codePointAt(0) as number
    if (cp >= 0x300 && cp <= 0x36f) continue
    out += c
  }
  return out
}

// Fast path for ASCII-only text (most cells): lower-case, then collapse and trim
// whitespace — the same result as the character-by-character path below. null when
// the text has any non-ASCII character.
function asciiNormalise(s: string): string | null {
  let clean = true
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 127) return null
    const space = c === 32 || (c >= 9 && c <= 13)
    if (space && (c !== 32 || i === 0 || i === s.length - 1 || s.charCodeAt(i + 1) === 32 || (s.charCodeAt(i + 1) >= 9 && s.charCodeAt(i + 1) <= 13))) clean = false
  }
  const lower = s.toLowerCase()
  if (clean) return lower
  const words: string[] = []
  let start = -1
  for (let i = 0; i <= lower.length; i++) {
    const c = i < lower.length ? lower.charCodeAt(i) : 32
    const space = c === 32 || (c >= 9 && c <= 13)
    if (!space && start < 0) start = i
    if (space && start >= 0) { words.push(lower.slice(start, i)); start = -1 }
  }
  return words.join(' ')
}

export function normalise(text: unknown): string {
  const s = text == null ? '' : String(text)
  const fast = asciiNormalise(s)
  if (fast !== null) return fast
  let out = ''
  let pendingSpace = false
  for (const ch of s) {
    if (isSpace(ch)) { if (out) pendingSpace = true; continue }
    const f = foldChar(ch)
    if (!f) continue
    if (pendingSpace) { out += ' '; pendingSpace = false }
    out += f
  }
  return out
}

// ─── PARSE ───────────────────────────────────────────────────
// A field name is an ASCII letter followed by ASCII letters, digits or underscores.
function isFieldName(name: string): boolean {
  if (!name) return false
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    const letter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    const digit = c >= 48 && c <= 57
    if (i === 0 ? !letter : !(letter || digit || c === 95)) return false
  }
  return true
}

// `buf` is exactly "name:" with a valid field name → the lower-cased name, else null.
function fieldPrefix(buf: string): string | null {
  const idx = buf.indexOf(':')
  if (idx < 1 || idx !== buf.length - 1) return null
  const name = buf.slice(0, idx)
  return isFieldName(name) ? name.toLowerCase() : null
}

function scan(chars: string[]): Token[] {
  const tokens: Token[] = []
  const n = chars.length
  let i = 0
  const readPhrase = (from: number) => {     // from = index after the opening quote
    let buf = ''
    let j = from
    while (j < n && chars[j] !== '"') { buf += chars[j]; j++ }
    return { text: buf, next: j < n ? j + 1 : n }
  }
  while (i < n) {
    const ch = chars[i]
    if (isSpace(ch)) { i++; continue }
    if (ch === '|') { tokens.push({ type: 'or' }); i++; continue }
    if (ch === '"') {
      const p = readPhrase(i + 1)
      tokens.push({ type: 'phrase', raw: p.text })
      i = p.next
      continue
    }
    let buf = ''
    let j = i
    let done = false
    while (j < n && !isSpace(chars[j]) && chars[j] !== '|') {
      if (chars[j] === '"') {
        const name = fieldPrefix(buf)
        if (name) {                           // field:"two words"
          const p = readPhrase(j + 1)
          tokens.push({ type: 'field', field: name, raw: p.text, quoted: true })
          j = p.next
          done = true
          break
        }
      }
      buf += chars[j]                         // a quote inside a word is literal (16")
      j++
    }
    i = j
    if (done) continue
    if (buf === 'OR') { tokens.push({ type: 'or' }); continue }
    const idx = buf.indexOf(':')
    if (idx > 0 && idx < buf.length - 1 && isFieldName(buf.slice(0, idx))) {
      tokens.push({ type: 'field', field: buf.slice(0, idx).toLowerCase(), raw: buf.slice(idx + 1), quoted: false })
    } else {
      tokens.push({ type: 'word', raw: buf })
    }
  }
  return tokens
}

function makeTerm(t: Exclude<Token, { type: 'or' }>): Term | null {
  const value = normalise(t.raw)
  if (!value) return null
  if (t.type === 'word') return { kind: 'word', value, text: value }
  if (t.type === 'phrase') return { kind: 'phrase', value, text: '"' + value + '"' }
  return { kind: 'field', field: t.field, value, quoted: t.quoted, text: t.field + ':' + (t.quoted ? '"' + value + '"' : value) }
}

export function parse(q: unknown): Parsed {
  const result: Parsed = { groups: [], truncated: false }
  let chars = Array.from(q == null ? '' : String(q))
  if (chars.length > MAX_CHARS) { chars = chars.slice(0, MAX_CHARS); result.truncated = true }
  let group: Term[] = []
  let count = 0
  for (const t of scan(chars)) {
    if (t.type === 'or') { if (group.length) result.groups.push(group); group = []; continue }
    const term = makeTerm(t)
    if (!term) continue
    if (count >= MAX_TERMS) { result.truncated = true; continue }
    count++
    group.push(term)
  }
  if (group.length) result.groups.push(group)
  return result
}

// ─── WORDS AND EDIT DISTANCE ─────────────────────────────────
// Words of a normalised text, with their code-unit spans: each space-separated token
// with its leading/trailing punctuation trimmed, plus its letter/digit runs when it
// has more than one ("v-102" → "v-102", "v", "102").
function wordSpans(norm: string): Span[] {
  const out: Span[] = []
  const cps = Array.from(norm)
  let unit = 0
  let k = 0
  while (k < cps.length) {
    if (cps[k] === ' ') { unit += 1; k++; continue }
    const tok: { c: string; at: number }[] = []
    while (k < cps.length && cps[k] !== ' ') { tok.push({ c: cps[k], at: unit }); unit += cps[k].length; k++ }
    let a = 0
    let b = tok.length
    while (a < b && !isAlnum(tok[a].c)) a++
    while (b > a && !isAlnum(tok[b - 1].c)) b--
    if (b > a) out.push(spanOf(tok, a, b))
    const runs: [number, number][] = []
    let r0 = -1
    for (let x = 0; x <= tok.length; x++) {
      const inRun = x < tok.length && isAlnum(tok[x].c)
      if (inRun && r0 < 0) r0 = x
      if (!inRun && r0 >= 0) { runs.push([r0, x]); r0 = -1 }
    }
    if (runs.length > 1) for (const [s, e] of runs) out.push(spanOf(tok, s, e))
  }
  return out
}

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false
  return true
}

// The words of wordSpans as values for withinOne: an ASCII word as a string (one
// character per code unit), any other word as an array of code points.
function wordsForMatch(norm: string): ArrayLike<string>[] {
  if (!isAscii(norm)) return wordSpans(norm).map(w => w.cps)
  const out: string[] = []
  for (const tok of norm.split(' ')) {
    if (!tok) continue
    let plain = true                          // only letters and digits: the token is the word
    for (let x = 0; x < tok.length; x++) if (!asciiAlnum(tok.charCodeAt(x))) { plain = false; break }
    if (plain) { out.push(tok); continue }
    let a = 0
    let b = tok.length
    while (a < b && !asciiAlnum(tok.charCodeAt(a))) a++
    while (b > a && !asciiAlnum(tok.charCodeAt(b - 1))) b--
    if (b > a) out.push(tok.slice(a, b))
    const runs: string[] = []
    let r0 = -1
    for (let x = 0; x <= tok.length; x++) {
      const inRun = x < tok.length && asciiAlnum(tok.charCodeAt(x))
      if (inRun && r0 < 0) r0 = x
      if (!inRun && r0 >= 0) { runs.push(tok.slice(r0, x)); r0 = -1 }
    }
    if (runs.length > 1) for (const r of runs) out.push(r)
  }
  return out
}

const asciiAlnum = (c: number) => (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90)

const forMatch = (value: string): ArrayLike<string> => (isAscii(value) ? value : Array.from(value))

function spanOf(tok: { c: string; at: number }[], a: number, b: number): Span {
  const cps = tok.slice(a, b).map(t => t.c)
  return { cps, start: tok[a].at, end: tok[b - 1].at + tok[b - 1].c.length }
}

// True when a and b (code-point arrays, or ASCII strings) are within one substitution, insertion,
// deletion or adjacent transposition.
function withinOne(a: ArrayLike<string>, b: ArrayLike<string>): boolean {
  const la = a.length
  const lb = b.length
  if (la > lb) return withinOne(b, a)
  if (lb - la > 1) return false
  let i = 0
  while (i < la && a[i] === b[i]) i++
  if (i === la) return true                   // equal, or b has one extra character at the end
  if (la === lb) {
    let same = true
    for (let k = i + 1; k < la; k++) if (a[k] !== b[k]) { same = false; break }
    if (same) return true                     // one substitution
    if (i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i]) {
      for (let k = i + 2; k < la; k++) if (a[k] !== b[k]) return false
      return true                             // one adjacent transposition
    }
    return false
  }
  for (let k = i; k < la; k++) if (a[k] !== b[k + 1]) return false
  return true                                 // one insertion into a
}

// ─── FIELD MAP ───────────────────────────────────────────────
// fieldMap: { alias: 'rowKey' } or { alias: { key, flag?: 'code' | 'enum', column? } }.
// Aliases are lower case. `column` is used only by the server's likeClause.
function resolveField(fieldMap: FieldMap | null | undefined, alias: string): Resolved | null {
  if (!fieldMap || !Object.prototype.hasOwnProperty.call(fieldMap, alias)) return null
  const e = fieldMap[alias]
  if (typeof e === 'string') return { key: e, flag: null, column: null }
  return { key: e.key, flag: e.flag || null, column: e.column || null }
}

function unknownFieldError(parsed: Parsed, fieldMap: FieldMap | null | undefined): string | null {
  for (const g of parsed.groups) {
    for (const t of g) {
      if (t.kind === 'field' && !resolveField(fieldMap, t.field as string)) {
        const allowed = Object.keys(fieldMap || {})
        return 'Unknown field "' + t.field + '". Allowed: ' + (allowed.length ? allowed.join(', ') : '(none)')
      }
    }
  }
  return null
}

function codeMatches(text: string, value: string): boolean {
  if (value.endsWith('.')) return text.startsWith(value)
  return text === value || text.startsWith(value + '.')
}

// A digit is any number character (ASCII 0-9 by code, others by the fixed class).
function hasDigit(s: string): boolean {
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (c < 128 ? c >= 48 && c <= 57 : DIGIT_CHAR.test(ch)) return true
  }
  return false
}

// Typo tolerance: unquoted words and plain field values of 5+ characters with no digit.
function fuzzyEligible(t: Term): boolean {
  return (t.kind === 'word' || (t.kind === 'field' && !t.quoted)) && Array.from(t.value).length >= FUZZY_MIN && !hasDigit(t.value)
}

// ─── MATCH ROW ───────────────────────────────────────────────
export function matchRow(row: Row | null | undefined, parsed: Parsed | null | undefined, fieldMap?: FieldMap | null): MatchResult {
  if (!parsed || !parsed.groups || parsed.groups.length === 0) return { match: true, matchedTerms: [] }
  const error = unknownFieldError(parsed, fieldMap)
  if (error) return { match: false, matchedTerms: [], error }
  const cells = new Map<string, Cell>()
  const cell = (key: string) => {
    let c = cells.get(key)
    if (!c) { c = { norm: normalise(row ? row[key] : null), words: null }; cells.set(key, c) }
    return c
  }
  const wordsOf = (c: Cell) => { if (!c.words) c.words = wordsForMatch(c.norm); return c.words }
  const fuzzyIn = (c: Cell, value: ArrayLike<string>) => { for (const w of wordsOf(c)) if (withinOne(w, value)) return true; return false }
  const keys = Object.keys(row || {})

  const termMatches = (t: Term): boolean => {
    if (t.kind === 'field') {
      const f = resolveField(fieldMap, t.field as string) as Resolved
      const c = cell(f.key)
      if (f.flag === 'code') return codeMatches(c.norm, t.value)
      if (f.flag === 'enum') return c.norm === t.value
      if (c.norm.includes(t.value)) return true
      return fuzzyEligible(t) && fuzzyIn(c, forMatch(t.value))
    }
    for (const k of keys) if (cell(k).norm.includes(t.value)) return true
    if (!fuzzyEligible(t)) return false
    const value = forMatch(t.value)
    for (const k of keys) if (fuzzyIn(cell(k), value)) return true
    return false
  }

  const matchedTerms: string[] = []
  let match = false
  for (const g of parsed.groups) {
    let all = true
    for (const t of g) {
      if (termMatches(t)) { if (!matchedTerms.includes(t.text)) matchedTerms.push(t.text) }
      else all = false
    }
    if (all) match = true
  }
  return { match, matchedTerms }
}

// ─── HIGHLIGHT (browser only) ────────────────────────────────
// Splits one cell's text into hit / non-hit segments for the parsed query. Words and
// phrases highlight in every column; a field:value term only in its own column —
// fieldKey is the column's row key when fieldMap is given, otherwise the alias.
// Substring hits mark the matched text; a fuzzy hit (no substring in this cell) marks
// the whole word; "code" marks the matching prefix and "enum" the whole value.
export function highlightSegments(text: unknown, parsed: Parsed | null | undefined, fieldKey?: string | null, fieldMap?: FieldMap | null): Segment[] {
  const orig = Array.from(text == null ? '' : String(text))
  if (!orig.length) return []
  // Normalised text with, for each code unit, the index of the original character.
  let norm = ''
  const map: number[] = []
  let pendingSpace = -1
  for (let i = 0; i < orig.length; i++) {
    const ch = orig[i]
    if (isSpace(ch)) { if (norm && pendingSpace < 0) pendingSpace = i; continue }
    const f = foldChar(ch)
    if (!f) continue
    if (pendingSpace >= 0) { norm += ' '; map.push(pendingSpace); pendingSpace = -1 }
    norm += f
    for (let u = 0; u < f.length; u++) map.push(i)
  }
  const hits: boolean[] = orig.map(() => false)
  const mark = (start: number, end: number) => {   // code-unit range [start, end) of norm
    if (end <= start) return
    for (let x = map[start]; x <= map[end - 1]; x++) hits[x] = true
  }
  const whole = normalise(text)
  let spans: Span[] | null = null

  for (const g of parsed?.groups ?? []) {
    for (const t of g) {
      let flag: FieldFlag | null = null
      if (t.kind === 'field') {
        const f = resolveField(fieldMap, t.field as string)
        const applies = fieldMap ? !!f && f.key === fieldKey : t.field === fieldKey
        if (!applies) continue
        flag = f ? f.flag : null
      }
      if (flag === 'code') { if (codeMatches(whole, t.value)) mark(0, Math.min(t.value.length, whole.length)); continue }
      if (flag === 'enum') { if (whole === t.value) mark(0, whole.length); continue }
      let found = false
      let from = 0
      for (;;) {
        const at = norm.indexOf(t.value, from)
        if (at < 0) break
        mark(at, at + t.value.length)
        found = true
        from = at + t.value.length
      }
      if (found || !fuzzyEligible(t)) continue
      const cps = Array.from(t.value)
      if (!spans) spans = wordSpans(norm)
      for (const w of spans) if (withinOne(w.cps, cps)) mark(w.start, w.end)
    }
  }

  const out: Segment[] = []
  for (let i = 0; i < orig.length; i++) {
    const last = out[out.length - 1]
    if (last && last.hit === hits[i]) last.text += orig[i]
    else out.push({ text: orig[i], hit: hits[i] })
  }
  return out
}
