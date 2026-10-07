// ─── TABLE SEARCH — server matcher (CommonJS) ────────────────
// Mirror of src/lib/tableSearch.ts — keep in sync. Both are checked against the
// shared cases in tests/tableSearch/cases.json and must give identical results.
//
// Query syntax (parse):
//   words           every word must match somewhere in the row (AND)
//   OR  or  |       an uppercase OR, or a |, separates groups; a row matches if any
//                   group matches (AND binds tighter than OR). A lowercase "or" is an
//                   ordinary word.
//   field:value     checks only that field (aliases come from the route's fieldMap)
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
//
// likeClause is the non-fuzzy path for large tables (the audit log): SQL LIKE on the
// fieldMap's columns only, with bound parameters and escapeLike on every value.

const MAX_CHARS = 200
const MAX_TERMS = 10
const FUZZY_MIN = 5

const SPACE_CHAR = /\s/u
const ALNUM_CHAR = /[\p{L}\p{N}]/u
const DIGIT_CHAR = /\p{N}/u
// ASCII is tested by character code (same result as the classes, much faster).
const isSpace = (ch) => { const c = ch.charCodeAt(0); return c < 128 ? c === 32 || (c >= 9 && c <= 13) : SPACE_CHAR.test(ch) }
const isAlnum = (ch) => {
  const c = ch.charCodeAt(0)
  return c < 128 ? (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) : ALNUM_CHAR.test(ch)
}

// ─── NORMALISE ───────────────────────────────────────────────
// One character at a time: decompose, lower-case, drop combining accents (U+0300–U+036F).
function foldChar(ch) {
  let out = ''
  for (const c of ch.normalize('NFD').toLowerCase()) {
    const cp = c.codePointAt(0)
    if (cp >= 0x300 && cp <= 0x36f) continue
    out += c
  }
  return out
}

// Fast path for ASCII-only text (most cells): lower-case, then collapse and trim
// whitespace — the same result as the character-by-character path below. null when
// the text has any non-ASCII character.
function asciiNormalise(s) {
  let clean = true
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 127) return null
    const space = c === 32 || (c >= 9 && c <= 13)
    if (space && (c !== 32 || i === 0 || i === s.length - 1 || s.charCodeAt(i + 1) === 32 || (s.charCodeAt(i + 1) >= 9 && s.charCodeAt(i + 1) <= 13))) clean = false
  }
  const lower = s.toLowerCase()
  if (clean) return lower
  const words = []
  let start = -1
  for (let i = 0; i <= lower.length; i++) {
    const c = i < lower.length ? lower.charCodeAt(i) : 32
    const space = c === 32 || (c >= 9 && c <= 13)
    if (!space && start < 0) start = i
    if (space && start >= 0) { words.push(lower.slice(start, i)); start = -1 }
  }
  return words.join(' ')
}

function normalise(text) {
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
function isFieldName(name) {
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
function fieldPrefix(buf) {
  const idx = buf.indexOf(':')
  if (idx < 1 || idx !== buf.length - 1) return null
  const name = buf.slice(0, idx)
  return isFieldName(name) ? name.toLowerCase() : null
}

function scan(chars) {
  const tokens = []
  const n = chars.length
  let i = 0
  const readPhrase = (from) => {           // from = index after the opening quote
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

function makeTerm(t) {
  const value = normalise(t.raw)
  if (!value) return null
  if (t.type === 'word') return { kind: 'word', value, text: value }
  if (t.type === 'phrase') return { kind: 'phrase', value, text: '"' + value + '"' }
  return { kind: 'field', field: t.field, value, quoted: t.quoted, text: t.field + ':' + (t.quoted ? '"' + value + '"' : value) }
}

function parse(q) {
  const result = { groups: [], truncated: false }
  let chars = Array.from(q == null ? '' : String(q))
  if (chars.length > MAX_CHARS) { chars = chars.slice(0, MAX_CHARS); result.truncated = true }
  let group = []
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
function wordSpans(norm) {
  const out = []
  const cps = Array.from(norm)
  let unit = 0
  let k = 0
  while (k < cps.length) {
    if (cps[k] === ' ') { unit += 1; k++; continue }
    const tok = []                            // [{ c, at }] for one token
    while (k < cps.length && cps[k] !== ' ') { tok.push({ c: cps[k], at: unit }); unit += cps[k].length; k++ }
    let a = 0
    let b = tok.length
    while (a < b && !isAlnum(tok[a].c)) a++
    while (b > a && !isAlnum(tok[b - 1].c)) b--
    if (b > a) out.push(spanOf(tok, a, b))
    const runs = []
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

function isAscii(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false
  return true
}

// The words of wordSpans as values for withinOne: an ASCII word as a string (one
// character per code unit), any other word as an array of code points.
function wordsForMatch(norm) {
  if (!isAscii(norm)) return wordSpans(norm).map(w => w.cps)
  const out = []
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
    const runs = []
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

const asciiAlnum = (c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90)

const forMatch = (value) => (isAscii(value) ? value : Array.from(value))

function spanOf(tok, a, b) {
  const cps = tok.slice(a, b).map(t => t.c)
  return { cps, start: tok[a].at, end: tok[b - 1].at + tok[b - 1].c.length }
}

// True when a and b (code-point arrays, or ASCII strings) are within one substitution, insertion,
// deletion or adjacent transposition.
function withinOne(a, b) {
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
// Aliases are lower case. `column` is used only by likeClause (server SQL).
function resolveField(fieldMap, alias) {
  if (!fieldMap || !Object.prototype.hasOwnProperty.call(fieldMap, alias)) return null
  const e = fieldMap[alias]
  if (typeof e === 'string') return { key: e, flag: null, column: null }
  return { key: e.key, flag: e.flag || null, column: e.column || null }
}

function unknownFieldError(parsed, fieldMap) {
  for (const g of parsed.groups) {
    for (const t of g) {
      if (t.kind === 'field' && !resolveField(fieldMap, t.field)) {
        const allowed = Object.keys(fieldMap || {})
        return 'Unknown field "' + t.field + '". Allowed: ' + (allowed.length ? allowed.join(', ') : '(none)')
      }
    }
  }
  return null
}

function codeMatches(text, value) {
  if (value.endsWith('.')) return text.startsWith(value)
  return text === value || text.startsWith(value + '.')
}

// A digit is any number character (ASCII 0-9 by code, others by the fixed class).
function hasDigit(s) {
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (c < 128 ? c >= 48 && c <= 57 : DIGIT_CHAR.test(ch)) return true
  }
  return false
}

// Typo tolerance: unquoted words and plain field values of 5+ characters with no digit.
function fuzzyEligible(t) {
  return (t.kind === 'word' || (t.kind === 'field' && !t.quoted)) && Array.from(t.value).length >= FUZZY_MIN && !hasDigit(t.value)
}

// ─── MATCH ROW ───────────────────────────────────────────────
function matchRow(row, parsed, fieldMap) {
  if (!parsed || !parsed.groups || parsed.groups.length === 0) return { match: true, matchedTerms: [] }
  const error = unknownFieldError(parsed, fieldMap)
  if (error) return { match: false, matchedTerms: [], error }
  const cells = new Map()
  const cell = (key) => {
    let c = cells.get(key)
    if (!c) { c = { norm: normalise(row ? row[key] : null), words: null }; cells.set(key, c) }
    return c
  }
  const wordsOf = (c) => { if (!c.words) c.words = wordsForMatch(c.norm); return c.words }
  const fuzzyIn = (c, value) => { for (const w of wordsOf(c)) if (withinOne(w, value)) return true; return false }
  const keys = Object.keys(row || {})

  const termMatches = (t) => {
    if (t.kind === 'field') {
      const f = resolveField(fieldMap, t.field)
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

  const matchedTerms = []
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

// ─── SQL LIKE PATH (no fuzzy matching) ───────────────────────
function escapeLike(s) {
  let out = ''
  for (const ch of String(s == null ? '' : s)) out += (ch === '\\' || ch === '%' || ch === '_') ? '\\' + ch : ch
  return out
}

// Returns { sql, params } (sql '' when there is nothing to filter) or { error }.
// Column names come only from fieldMap; every value is a bound parameter.
function likeClause(parsed, fieldMap) {
  if (!parsed || !parsed.groups || parsed.groups.length === 0) return { sql: '', params: [] }
  const error = unknownFieldError(parsed, fieldMap)
  if (error) return { error }
  const anyColumns = []
  for (const alias of Object.keys(fieldMap || {})) {
    const f = resolveField(fieldMap, alias)
    if (f.column && !anyColumns.includes(f.column)) anyColumns.push(f.column)
  }
  const params = []
  const groupSql = []
  for (const g of parsed.groups) {
    const parts = []
    for (const t of g) {
      if (t.kind === 'field') {
        const f = resolveField(fieldMap, t.field)
        if (!f.column) return { error: 'Field "' + t.field + '" cannot be searched here' }
        if (f.flag === 'enum') { parts.push(f.column + ' = ?'); params.push(t.value) }
        else if (f.flag === 'code' && t.value.endsWith('.')) { parts.push(f.column + ' LIKE ?'); params.push(escapeLike(t.value) + '%') }
        else if (f.flag === 'code') { parts.push('(' + f.column + ' = ? OR ' + f.column + ' LIKE ?)'); params.push(t.value, escapeLike(t.value) + '.%') }
        else { parts.push(f.column + ' LIKE ?'); params.push('%' + escapeLike(t.value) + '%') }
      } else {
        if (!anyColumns.length) return { error: 'No searchable columns' }
        parts.push('(' + anyColumns.map(c => c + ' LIKE ?').join(' OR ') + ')')
        for (let k = 0; k < anyColumns.length; k++) params.push('%' + escapeLike(t.value) + '%')
      }
    }
    groupSql.push('(' + parts.join(' AND ') + ')')
  }
  return { sql: groupSql.length === 1 ? groupSql[0] : '(' + groupSql.join(' OR ') + ')', params }
}

module.exports = { parse, normalise, matchRow, escapeLike, likeClause, MAX_CHARS, MAX_TERMS, FUZZY_MIN }
