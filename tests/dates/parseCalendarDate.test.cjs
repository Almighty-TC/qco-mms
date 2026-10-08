// parseCalendarDate (server/utils/validate.js) — no database, no dependency beyond the server's xlsx.
// Part 1: kinds and values. Part 2: old against new — every valid value reads exactly as parseSheetDate
// (routes/mto.js as of 9ef6732, copied below as the reference) read it. Part 3: a corpus of 300+ date
// strings against parseCalendarDate as of c85ebbb (copied below), which still had the lenient fallback:
// only the expected forms may change. Part 4: the same corpus against 68ca3a7 (date-2, copied below):
// only the two-digit-year forms may change, from unreadable to invalid. Exit code 1 on any failure.
// Usage: node tests/dates/parseCalendarDate.test.cjs
const path = require('path')
const SERVER = path.join(__dirname, '..', '..', 'server')
const XLSX = require(path.join(SERVER, 'node_modules', 'xlsx'))
const { parseCalendarDate } = require(path.join(SERVER, 'utils', 'validate.js'))

// parseSheetDate as of 9ef6732 (the reference for valid values).
const _MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
function oldParseSheetDate(v, XLSX) {
  if (v == null || v === '') return null
  const ymd = (y, m, d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  if (v instanceof Date) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate())  // local components — no UTC shift
  if (typeof v === 'number') { const e = XLSX.SSF.parse_date_code(v); return e ? ymd(e.y, e.m, e.d) : null }
  const s = String(v).trim()
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) { const [y,m,d] = s.slice(0,10).split('-'); return ymd(y, Number(m), Number(d)) }
  let m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{4})$/)   // 31-Aug-2025
  if (m && _MONTHS[m[2].slice(0,3).toLowerCase()]) return ymd(m[3], _MONTHS[m[2].slice(0,3).toLowerCase()], Number(m[1]))
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)                // DD/MM/YYYY (AU)
  if (m) return ymd(m[3], Number(m[2]), Number(m[1]))
  const d = new Date(s); return isNaN(d.getTime()) ? null : ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

// parseCalendarDate as of c85ebbb (the lenient JavaScript Date fallback still in place).
const C85_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
function c85ParseCalendarDate(v, XLSX) {
  const invalid = { value: null, kind: 'invalid' }
  if (v == null || (typeof v === 'string' && v.trim() === '')) return { value: null, kind: 'blank' }
  const calendar = (y, m, d) => {
    y = Number(y); m = Number(m); d = Number(d)
    if (![y, m, d].every(Number.isInteger) || y < 1900 || y > 2100 || m < 1 || m > 12) return invalid
    if (d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return invalid
    return { value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, kind: 'ok' }
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? invalid : calendar(v.getFullYear(), v.getMonth() + 1, v.getDate())
  if (typeof v === 'number') { const e = XLSX.SSF.parse_date_code(v); return e ? calendar(e.y, e.m, e.d) : invalid }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return calendar(m[1], m[2], m[3])
  m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{4})$/)
  if (m && C85_MONTHS[m[2].slice(0, 3).toLowerCase()]) return calendar(m[3], C85_MONTHS[m[2].slice(0, 3).toLowerCase()], m[1])
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return calendar(m[3], m[2], m[1])
  const d = new Date(s)
  return isNaN(d.getTime()) ? { value: null, kind: 'unreadable' } : calendar(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

// parseCalendarDate as of 68ca3a7 (date-2: no lenient fallback; two-digit years unreadable).
const D2_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
function d2ParseCalendarDate(v, XLSX) {
  const invalid = { value: null, kind: 'invalid' }
  if (v == null || (typeof v === 'string' && v.trim() === '')) return { value: null, kind: 'blank' }
  const calendar = (y, m, d) => {
    y = Number(y); m = Number(m); d = Number(d)
    if (![y, m, d].every(Number.isInteger) || y < 1900 || y > 2100 || m < 1 || m > 12) return invalid
    if (d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return invalid
    return { value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, kind: 'ok' }
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? invalid : calendar(v.getFullYear(), v.getMonth() + 1, v.getDate())
  if (typeof v === 'number') { const e = XLSX.SSF.parse_date_code(v); return e ? calendar(e.y, e.m, e.d) : invalid }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return calendar(m[1], m[2], m[3])
  m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{4})$/)
  if (m && D2_MONTHS[m[2].slice(0, 3).toLowerCase()]) return calendar(m[3], D2_MONTHS[m[2].slice(0, 3).toLowerCase()], m[1])
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return calendar(m[3], m[2], m[1])
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (m) return calendar(m[3], m[2], m[1])
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (m) return calendar(m[1], m[2], m[3])
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/)
  if (m && D2_MONTHS[m[1].slice(0, 3).toLowerCase()]) return calendar(m[3], D2_MONTHS[m[1].slice(0, 3).toLowerCase()], m[2])
  return { value: null, kind: 'unreadable' }
}

let pass = 0, fail = 0
const ok = (v, value) => [v, 'ok', value], bad = v => [v, 'invalid', null, 'not-a-date'], blank = v => [v, 'blank', null], unread = v => [v, 'unreadable', null]
const two = v => [v, 'invalid', null, 'two-digit-year']
const label = v => v instanceof Date ? `Date(${isNaN(v.getTime()) ? 'invalid' : v.getFullYear() + '-' + (v.getMonth() + 1) + '-' + v.getDate()})` : JSON.stringify(v)

// ── Part 1: kinds and values ─────────────────────────────────
const cases = [
  // month lengths
  ok('31/01/2024', '2024-01-31'), bad('32/01/2024'), ok('31/03/2024', '2024-03-31'), ok('30/04/2024', '2024-04-30'), bad('31/04/2024'),
  ok('31/05/2024', '2024-05-31'), ok('30/06/2024', '2024-06-30'), bad('31/06/2024'), ok('31/07/2024', '2024-07-31'), ok('31/08/2024', '2024-08-31'),
  bad('31/09/2024'), ok('31/10/2024', '2024-10-31'), bad('31/11/2024'), ok('31/12/2024', '2024-12-31'), ok('28/02/2023', '2023-02-28'),
  // leap years
  ok('29/02/2024', '2024-02-29'), ok('29/02/2000', '2000-02-29'), bad('29/02/2023'), bad('29/02/1900'), bad('29/02/2100'), bad('30/02/2024'), bad('31/02/2024'),
  // single-digit and padded D/M/Y, D-M-Y
  ok('1/6/2024', '2024-06-01'), ok('01/06/2024', '2024-06-01'), ok('1/06/2024', '2024-06-01'), ok('01/6/2024', '2024-06-01'),
  ok('01-06-2024', '2024-06-01'), ok('1-6-2024', '2024-06-01'), bad('13-13-2024'),
  // impossible day or month
  bad('13/13/2024'), bad('00/01/2024'), bad('01/00/2024'), bad('01/13/2024'),
  // DD-Mon-YYYY and "D Mon YYYY"
  ok('31-Aug-2025', '2025-08-31'), ok('01-May-2024', '2024-05-01'), ok('1 May 2024', '2024-05-01'), ok('1-Sept-2024', '2024-09-01'), bad('31-Feb-2024'), bad('29 Feb 2023'),
  // ISO, with and without a time
  ok('2024-05-01', '2024-05-01'), ok('2024-5-1', '2024-05-01'), ok('2024-05-01T10:00:00Z', '2024-05-01'), ok('2024-05-01 10:00', '2024-05-01'), ok('  2024-05-01  ', '2024-05-01'),
  bad('2024-13-13'), bad('2024-02-30'), bad('2024-00-10'),
  // the year range
  ok('01/01/1900', '1900-01-01'), ok('31/12/2100', '2100-12-31'), bad('31/12/1899'), bad('01/01/2101'), bad('1899-12-31'), bad('2101-01-01'),
  // Excel serials, as SheetJS reads them (0 → 1900-01-00, 60 → Excel's 1900-02-29)
  ok(45413, '2024-05-01'), ok(45413.75, '2024-05-01'), ok(1, '1900-01-01'), bad(0), bad(60), ok(61, '1900-03-01'), bad(-1), bad(2958466),
  // Date objects (their local day)
  ok(new Date(2024, 4, 1), '2024-05-01'), ok(new Date(2024, 1, 29, 23, 59, 59), '2024-02-29'), bad(new Date('not a date')), bad(new Date(1899, 11, 31)), bad(new Date(2101, 0, 1)),
  // blank
  blank(null), blank(undefined), blank(''), blank('   '), blank('\t'),
  // unreadable text
  unread('TBA'), unread('TBC'), unread('n/a'), unread('unknown'),
  // other text JavaScript's Date reads
  ok('May 1, 2024', '2024-05-01'),
  // every explicit text form (date-2: no lenient fallback)
  ok('2024-05-01', '2024-05-01'), ok('2024/05/01', '2024-05-01'), ok('2024/5/1', '2024-05-01'), bad('2024/02/30'),
  ok('01.05.2024', '2024-05-01'), ok('1.5.2024', '2024-05-01'), ok('15.05.2024', '2024-05-15'), bad('31.02.2024'), bad('13.13.2024'),
  ok('June 15, 2024', '2024-06-15'), ok('Jun 15 2024', '2024-06-15'), ok('Jan. 5, 2024', '2024-01-05'), ok('September 30, 2024', '2024-09-30'),
  bad('Feb 30 2024'), bad('Feb 29, 2023'), ok('Feb 29, 2024', '2024-02-29'), unread('Foo 5, 2024'), unread('2024-05'),
  // the survey strings
  unread('TBA 2025'), unread('Q3 2025'), unread('Week 12'), unread('1'), unread('2024'), unread('May 2025'), unread('ASAP'),
  unread('TBC 15/06/2024'), ok('15 June 2024', '2024-06-15'), ok('Sept 5 2024', '2024-09-05'), bad('30 Feb 2024'),
  unread('5/2024'), unread('05-2024'),
  // placeholders
  unread('N/A'), unread('-'), unread('?'), unread('pending'),
  // two-digit years (date-3): refused, whether or not the day and month are real
  two('01/05/24'), two('1/5/24'), two('31/12/99'), two('29/02/23'), two('13/13/24'), two('31/02/24'), two('00/00/00'),   // D/M/YY
  two('01-05-24'), two('1-5-24'), two('31-02-24'), two('24-05-01'),                                                       // D-M-YY
  two('01.05.24'), two('1.5.24'), two('32.01.24'),                                                                        // D.M.YY
  two('1-May-24'), two('01-May-24'), two('31-Aug-25'), two('1-Sept-24'), two('1-may-24'), two('1-MAY-24'), two('31-Feb-24'), // D-Mon-YY
  two('1 May 24'), two('15 June 24'), two('30 Feb 24'), two('  1 May 24  '), two('1-May 24'),                            // "D Mon YY"
  // still unreadable: not dates, or outside the two-digit forms
  unread('TBA'), unread('Week 12'), unread('1'), unread('2024'), unread('May 2025'), unread('5/2024'), unread('05-2024'),
  unread('May 1, 24'), unread('1/May/24'), unread('1-Foo-24'), unread('1-May-245'), unread('01/05/2'), unread('001/05/24'), unread('01/05/124'),
  // four-digit forms unchanged
  ok('01/05/2024', '2024-05-01'), ok('1-May-2024', '2024-05-01'), ok('1 May 2024', '2024-05-01'), ok('01.05.2024', '2024-05-01'), ok('2024-05-01', '2024-05-01'),
]
for (const [v, kind, value, reason] of cases) {
  const r = parseCalendarDate(v, XLSX)
  if (r.kind === kind && r.value === value && (reason === undefined || r.reason === reason)) pass++
  else { fail++; console.log(`FAIL ${label(v)}: expected ${kind} ${value}${reason ? ' ' + reason : ''}, got ${r.kind} ${r.value} ${r.reason || ''}`) }
}
const part1 = cases.length

// ── Part 2: old against new on valid values ──────────────────
const valid = [
  '01/01/2024', '15/01/2024', '31/01/2024', '01/02/2024', '28/02/2024', '29/02/2024', '01/03/2024', '31/03/2024', '30/04/2024', '15/05/2024',
  '30/06/2024', '04/07/2024', '31/08/2024', '30/09/2024', '31/10/2024', '30/11/2024', '25/12/2024', '1/6/2024', '01-06-2024', '1-6-2024',
  '31-Aug-2025', '01-May-2024', '1 May 2024', '15 Jan 2025', '1-Sept-2024', '2024-05-01', '2024-5-1', '2024-12-31', '2024-05-01T10:00:00Z',
  '2000-02-29', '1900-01-01', '2100-12-31', 'May 1, 2024', 'June 30, 2025', 45413, 45413.5, 1, 61, 73050,
  new Date(2024, 4, 1), new Date(2024, 11, 31, 23, 0, 0), new Date(2000, 1, 29),
]
console.log('old parseSheetDate → new parseCalendarDate (valid values)')
let same = 0
for (const v of valid) {
  const o = oldParseSheetDate(v, XLSX), n = parseCalendarDate(v, XLSX)
  const equal = n.kind === 'ok' && n.value === o
  if (equal) { same++; pass++ } else { fail++ }
  console.log(`  ${label(v).padEnd(28)} ${String(o).padEnd(12)} ${String(n.value).padEnd(12)} ${equal ? 'same' : 'DIFFERENT (' + n.kind + ')'}`)
}

// ── Part 3: a corpus against c85ebbb (the lenient fallback) ─
const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const p2 = n => String(n).padStart(2, '0')
const DATES = [[2024, 5, 1], [2024, 6, 15], [2024, 12, 31], [2024, 2, 29], [2025, 1, 1], [2025, 8, 31], [2023, 11, 30], [2024, 7, 4], [2024, 9, 9], [2024, 10, 10],
  [2026, 3, 13], [2024, 1, 12], [2024, 12, 1], [2000, 2, 29], [1900, 1, 1], [2100, 12, 31], [2024, 4, 30], [2025, 6, 5], [2024, 11, 11], [2030, 8, 20]]
const FORMS = {   // form → [text(y, m, d), may change against c85ebbb]
  'YYYY-MM-DD': [(y, m, d) => `${y}-${p2(m)}-${p2(d)}`, false], 'YYYY-M-D': [(y, m, d) => `${y}-${m}-${d}`, false],
  'YYYY-MM-DDThh:mm': [(y, m, d) => `${y}-${p2(m)}-${p2(d)}T10:30:00`, false], 'YYYY/MM/DD': [(y, m, d) => `${y}/${p2(m)}/${p2(d)}`, false],
  'DD/MM/YYYY': [(y, m, d) => `${p2(d)}/${p2(m)}/${y}`, false], 'D/M/YYYY': [(y, m, d) => `${d}/${m}/${y}`, false], 'DD-MM-YYYY': [(y, m, d) => `${p2(d)}-${p2(m)}-${y}`, false],
  'D Mon YYYY': [(y, m, d) => `${d} ${MON[m]} ${y}`, false], 'DD-Mon-YYYY': [(y, m, d) => `${p2(d)}-${MON[m]}-${y}`, false],
  'Mon D, YYYY': [(y, m, d) => `${MON[m]} ${d}, ${y}`, false], 'Mon D YYYY': [(y, m, d) => `${MON[m]} ${d} ${y}`, false], 'Month D, YYYY': [(y, m, d) => `${MONTH[m]} ${d}, ${y}`, false],
  'DD.MM.YYYY': [(y, m, d) => `${p2(d)}.${p2(m)}.${y}`, true], 'D.M.YYYY': [(y, m, d) => `${d}.${m}.${y}`, true],
  'DD/MM/YY': [(y, m, d) => `${p2(d)}/${p2(m)}/${String(y).slice(2)}`, true], 'D-Mon-YY': [(y, m, d) => `${d}-${MON[m]}-${String(y).slice(2)}`, true],
}
const corpus = []
for (const [form, [fmt, mayChange]] of Object.entries(FORMS)) for (const [y, m, d] of DATES) corpus.push({ form, text: fmt(y, m, d), want: `${y}-${p2(m)}-${p2(d)}`, mayChange, twoDigit: /[^Y]YY$/.test(form) })   // DD/MM/YY, D-Mon-YY (not …YYYY)
for (const t of ['TBA', 'TBC', 'N/A', '-', '?', 'pending', 'TBA 2025', 'Q3 2025', 'Week 12', '1', '2024', 'May 2025', 'ASAP', '5/2024', '05-2024', 'TBC 15/06/2024'])
  corpus.push({ form: 'placeholder', text: t, want: null, mayChange: true })
const changed = []
let corpusFail = 0
for (const c of corpus) {
  const o = c85ParseCalendarDate(c.text, XLSX), n = parseCalendarDate(c.text, XLSX)
  const differs = o.kind !== n.kind || o.value !== n.value
  if (differs) changed.push(`${JSON.stringify(c.text)} [${c.form}]: ${o.kind} ${o.value} → ${n.kind} ${n.value}`)
  let good = c.mayChange || !differs                                   // fixed forms: identical to c85ebbb
  if (c.want && !c.twoDigit) good = good && n.kind === 'ok' && n.value === c.want   // every 4-digit-year form reads the intended day
  if (c.form === 'placeholder') good = good && n.kind === 'unreadable'
  if (c.twoDigit) good = good && n.kind === 'invalid' && n.reason === 'two-digit-year'   // date-3: refused, not guessed
  if (good) pass++; else { corpusFail++; fail++; console.log(`FAIL corpus ${JSON.stringify(c.text)} [${c.form}]: c85ebbb ${o.kind} ${o.value}, now ${n.kind} ${n.value}`) }
}
console.log(`corpus: ${corpus.length} strings in ${Object.keys(FORMS).length} forms plus placeholders; ${changed.length} changed against c85ebbb:`)
for (const line of changed) console.log('  ' + line)

// ── Part 4: the same corpus against 68ca3a7 (date-2) ─────────
const changedD2 = []
let d2Fail = 0
for (const c of corpus) {
  const o = d2ParseCalendarDate(c.text, XLSX), n = parseCalendarDate(c.text, XLSX)
  const differs = o.kind !== n.kind || o.value !== n.value
  if (differs) changedD2.push(`${c.text} [${c.form}]: ${o.kind} → ${n.kind} ${n.reason || ''}`)
  const good = differs ? c.twoDigit && o.kind === 'unreadable' && n.kind === 'invalid' && n.reason === 'two-digit-year' : true
  if (good) pass++; else { d2Fail++; fail++; console.log(`FAIL corpus vs 68ca3a7 ${JSON.stringify(c.text)} [${c.form}]: ${o.kind} ${o.value}, now ${n.kind} ${n.value}`) }
}
console.log(`corpus against 68ca3a7: ${changedD2.length} changed:`)
for (const line of changedD2) console.log('  ' + line)

console.log(`parseCalendarDate: ${pass} passed, ${fail} failed (${part1} kind cases; old against new identical on ${same} of ${valid.length} valid values; corpus ${corpus.length - corpusFail} of ${corpus.length}; against 68ca3a7 ${corpus.length - d2Fail} of ${corpus.length})`)
process.exit(fail ? 1 : 0)
