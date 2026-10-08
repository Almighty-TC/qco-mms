// parseCalendarDate (server/utils/validate.js) — no database, no dependency beyond the server's xlsx.
// Part 1: kinds and values. Part 2: old against new — every valid value reads exactly as parseSheetDate
// (routes/mto.js as of 9ef6732, copied below as the reference) read it. Exit code 1 on any failure.
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

let pass = 0, fail = 0
const ok = (v, value) => [v, 'ok', value], bad = v => [v, 'invalid', null], blank = v => [v, 'blank', null], unread = v => [v, 'unreadable', null]
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
]
for (const [v, kind, value] of cases) {
  const r = parseCalendarDate(v, XLSX)
  if (r.kind === kind && r.value === value) pass++
  else { fail++; console.log(`FAIL ${label(v)}: expected ${kind} ${value}, got ${r.kind} ${r.value}`) }
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

console.log(`parseCalendarDate: ${pass} passed, ${fail} failed (${part1} kind cases; old against new identical on ${same} of ${valid.length} valid values)`)
process.exit(fail ? 1 : 0)
