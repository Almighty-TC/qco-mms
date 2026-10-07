// readWorkbook (server/utils/validate.js) — in-memory buffers only: no database, no endpoint,
// no dependency beyond the server's own xlsx. Exit code 1 on any failure.
// Usage: node tests/csv/readWorkbook.test.cjs
const assert = require('assert')
const path = require('path')
const SERVER = path.join(__dirname, '..', '..', 'server')
const XLSX = require(path.join(SERVER, 'node_modules', 'xlsx'))
const { readWorkbook } = require(path.join(SERVER, 'utils', 'validate.js'))

let pass = 0, fail = 0
function test(name, fn) {
  try { fn(); pass++ } catch (e) { fail++; console.log(`FAIL ${name}\n  ${e.message.split('\n').join('\n  ')}`) }
}
const cells = wb => XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null })
const utf8 = s => Buffer.from(s, 'utf8')
const H = 'Line Number,WBS Code,Description,PO Number,Tag,ROS Date'
const R1 = 'S-001,01,"Flange, 300# — Café São José",000777,1E3,01/06/2024'
const R2 = 'S-002,02.10,"He said ""hi""",PO-000123,0042,2024-05-01'
const HEAD = ['Line Number', 'WBS Code', 'Description', 'PO Number', 'Tag', 'ROS Date']
const ROW1 = ['S-001', '01', 'Flange, 300# — Café São José', '000777', '1E3', '01/06/2024']
const ROW2 = ['S-002', '02.10', 'He said "hi"', 'PO-000123', '0042', '2024-05-01']
const NOT_UTF8 = 'Save it as CSV UTF-8, or use the .xlsx template.'

// ── the CSV path: UTF-8 text, every cell kept as typed ───────
test('UTF-8 without a BOM, LF', () => assert.deepStrictEqual(cells(readWorkbook(utf8(`${H}\n${R1}\n${R2}\n`), 'a.csv')), [HEAD, ROW1, ROW2]))
test('UTF-8 with a BOM (stripped)', () => assert.deepStrictEqual(cells(readWorkbook(utf8(`﻿${H}\n${R1}\n`), 'b.csv')), [HEAD, ROW1]))
test('CRLF line endings', () => assert.deepStrictEqual(cells(readWorkbook(utf8(`${H}\r\n${R1}\r\n${R2}\r\n`), 'c.csv')), [HEAD, ROW1, ROW2]))
test('quoted comma, escaped quote, em dash and accents intact', () => {
  const r = cells(readWorkbook(utf8(`${H}\n${R1}\n${R2}\n`), 'd.csv'))
  assert.strictEqual(r[1][2], 'Flange, 300# — Café São José'); assert.strictEqual(r[2][2], 'He said "hi"')
})
test('codes keep their form: 01, 02.10, 000777, 1E3, 0042', () => {
  const r = cells(readWorkbook(utf8(`${H}\n${R1}\n${R2}\n`), 'e.csv'))
  assert.deepStrictEqual([r[1][1], r[2][1], r[1][3], r[1][4], r[2][4]], ['01', '02.10', '000777', '1E3', '0042'])
})
test('dates stay text (DD/MM/YYYY and ISO)', () => {
  const r = cells(readWorkbook(utf8(`${H}\n${R1}\n${R2}\n`), 'f.csv'))
  assert.deepStrictEqual([r[1][5], r[2][5]], ['01/06/2024', '2024-05-01'])
})
test('empty file: no data rows', () => {
  const r = cells(readWorkbook(Buffer.alloc(0), 'g.csv'))
  assert.strictEqual(r.filter(row => row.some(c => c != null && c !== '')).length, 0)
})
test('header only', () => assert.deepStrictEqual(cells(readWorkbook(utf8(`${H}\n`), 'h.csv')), [HEAD]))
test('.CSV in capitals and a name with spaces take the CSV path', () => {
  for (const name of ['TAKEOFF.CSV', 'my take off file.csv']) assert.strictEqual(cells(readWorkbook(utf8(`${H}\n${R1}\n`), name))[1][1], '01')
})
test('5,000 rows, every cell a string', () => {
  const lines = [H]
  for (let i = 1; i <= 5000; i++) lines.push(`S-${String(i).padStart(4, '0')},0${i % 9}.${String(i % 100).padStart(2, '0')},"Item ${i}, — é",000${i},${i}E3,0${1 + i % 9}/06/2024`)
  const r = cells(readWorkbook(utf8(lines.join('\n') + '\n'), 'big.csv'))
  assert.strictEqual(r.length, 5001)
  assert.ok(r.slice(1).every(row => row.every(c => typeof c === 'string')))
  assert.deepStrictEqual(r[5000], ['S-5000', '05.00', 'Item 5000, — é', '0005000', '5000E3', '06/06/2024'])
})

// ── refusals: not valid UTF-8 → Error with http 400 ──────────
const refused = (bytes, name) => assert.throws(() => readWorkbook(bytes, name), e => e.http === 400 && e.message === NOT_UTF8)
test('a Latin-1 CSV is refused with 400', () => refused(Buffer.from(`${H}\nS-003,01,Caf\xe9,1,2,3\n`, 'latin1'), 'latin1.csv'))
const smallXlsx = (() => {
  const aoa = [['Line Number', 'WBS Code', 'Description', 'Quantity', 'ROS Date', 'PO Reference', 'Doc Number'],
    ['L-1', '01', 'Pump — São José', 3, new Date(Date.UTC(2024, 4, 1)), '000777', '1E3'], ['L-2', 2.1, 'Café', 1.5, '01/06/2024', 'PO-1', 'D-2']]
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
})()
test('an .xlsx renamed .csv is refused with 400', () => refused(smallXlsx, 'really-xlsx.csv'))

// ── every other file: exactly today's XLSX.read ──────────────
const SITES = [
  ['mto parse-file', { type: 'buffer', cellDates: true }, [{ header: 1, defval: null }, { range: 0, defval: null }]],
  ['mto revision upload', { type: 'buffer', cellDates: true }, [{ header: 1, defval: null }, { range: 0, defval: null }]],
  ['expediting vdrl/upload', { type: 'buffer', cellDates: true }, [{ defval: null }]],
  ['parseImportSheet', { type: 'buffer' }, [{ header: 1, defval: '' }]],
]
for (const [site, opts, forms] of SITES) {
  test(`.xlsx equals today's read — ${site}`, () => {
    const a = XLSX.read(smallXlsx, { ...opts }), b = readWorkbook(smallXlsx, 'x.xlsx', { ...opts })   // fresh options: XLSX.read fills defaults into them
    assert.deepStrictEqual(b.SheetNames, a.SheetNames)
    for (const f of forms) assert.deepStrictEqual(XLSX.utils.sheet_to_json(b.Sheets[b.SheetNames[0]], f), XLSX.utils.sheet_to_json(a.Sheets[a.SheetNames[0]], f))
  })
}
test('CSV text in a file named .xlsx takes today\'s path', () => {
  const bytes = utf8(`${H}\n${R1}\n`), opts = { type: 'buffer', cellDates: true }
  assert.deepStrictEqual(cells(readWorkbook(bytes, 'x.xlsx', { ...opts })), cells(XLSX.read(bytes, { ...opts })))
})

console.log(`readWorkbook: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
