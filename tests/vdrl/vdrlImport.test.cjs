// VDRL upload checks — readVdrlSheet, checkVdrlRows and vdrlRefusal (server/lib/vdrlImport.js).
// In-memory files only: no database, no endpoint, no dependency beyond the server's own xlsx.
// Exit code 1 on any failure. Usage: node tests/vdrl/vdrlImport.test.cjs
const assert = require('assert')
const path = require('path')
const SERVER = path.join(__dirname, '..', '..', 'server')
const XLSX = require(path.join(SERVER, 'node_modules', 'xlsx'))
const { readVdrlSheet, checkVdrlRows, vdrlRefusal, normHeader, HEADER_NOT_FOUND } = require(path.join(SERVER, 'lib', 'vdrlImport.js'))

let pass = 0, fail = 0
function test(name, fn) {
  try { fn(); pass++ } catch (e) { fail++; console.log(`FAIL ${name}\n  ${e.message.split('\n').join('\n  ')}`) }
}
const eq = (a, b) => assert.deepStrictEqual(a, b)

// ── files ─────────────────────────────────────────────────────
const BANNER = ['QCO MMS — VDRL Document Upload Template']
const H = ['PO Reference', 'Package Name', 'Doc Number', 'Document Title', 'Document Type', 'Revision', 'Required Date (dd/mm/yyyy)', 'Promised Date (dd/mm/yyyy)', 'ABF Required (Y/N)', 'Discipline', 'Owner', 'Notes']
const EXAMPLES = [['PO-2024-001', 'Control Valve VDRL Package', 'CV-MDRA-001', 'Mechanical Data Book', 'Data Book', 'R0', '30/06/2025', '15/06/2025', 'Y', 'Instrumentation', 'J. Smith', 'Required before shipment']]
const xlsxBook = (aoa, sheet = 'VDRL Documents') => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) }
const q = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const csvBuf = aoa => Buffer.from(aoa.map(r => r.map(q).join(',')).join('\n') + '\n', 'utf8')
const row = (o = {}) => [o.po ?? 'PO-1', o.pkg ?? '', o.doc ?? 'DOC-1', o.title ?? 'A document', o.type ?? 'Drawing', o.rev ?? '', o.req ?? '', o.prom ?? '', o.abf ?? '', o.disc ?? '', '', o.notes ?? '']
const POS = new Map([['po-1', { id: 11, po_number: 'PO-1', po_name: 'Pump PO' }], ['po-2', { id: 12, po_number: 'PO-2', po_name: 'Valve PO' }]])
const EXISTING = new Set(['11|doc-exists'])
function run(dataRows, { banner = true, examples = false, file = 'xlsx', existing = EXISTING } = {}) {
  const aoa = [...(banner ? [BANNER] : []), H, ...(examples ? EXAMPLES : []), ...dataRows]
  const sheet = file === 'csv' ? readVdrlSheet(csvBuf(aoa), 'v.csv', XLSX) : readVdrlSheet(xlsxBook(aoa), 'v.xlsx', XLSX)
  if (sheet.error) return sheet
  return checkVdrlRows({ rows: sheet.rows, pos: POS, existingDocs: existing, XLSX })
}
const one = (o, opts) => run([row(o)], opts).results[0]
const NOT_DATE = (l, v) => `${l} '${v}' is not a valid date (use DD/MM/YYYY or YYYY-MM-DD)`
const TWO_DIGIT = (l, v) => `${l} '${v}' has a two-digit year (use a four-digit year: DD/MM/YYYY or YYYY-MM-DD)`
const UNREAD = (l, v) => `${l} '${v}' can't be read; it will be stored blank`

// ── the header row and normalised headers ─────────────────────
test('normHeader: parenthesised suffixes and spaces', () => eq(['Required Date (dd/mm/yyyy)', 'ABF Required (Y/N)', '  PO   Reference ', 'Doc Number', 'Promised Date (dd/mm/yyyy)'].map(normHeader), ['required_date', 'abf_required', 'po_reference', 'doc_number', 'promised_date']))
test('normHeader: only a trailing (...) is removed', () => eq(normHeader('Notes (optional) extra'), 'notes_(optional)_extra'))
test('the template layout: banner in row 1, header in row 2, data from row 3', () => { const r = run([row()]); eq([r.total, r.results[0].row, r.results[0].status], [1, 3, 'ok']) })
test('the banner deleted: header in row 1, data from row 2', () => eq(run([row()], { banner: false }).results[0].row, 2))
test('the template\'s example row is skipped with its message', () => { const r = run([row()], { examples: true }); eq([r.results[0].status, r.results[0].message, r.results[0].row, r.results[1].row, r.skipped], ['skip', 'Example row skipped', 3, 4, 1]) })
test('a header in row 10 is found', () => { const aoa = [...Array(9).fill(['note']), H, row()]; const s = readVdrlSheet(xlsxBook(aoa), 'v.xlsx', XLSX); eq(s.rows[0].row, 11) })
test('a header in row 11 is not found', () => { const aoa = [...Array(10).fill(['note']), H, row()]; eq(readVdrlSheet(xlsxBook(aoa), 'v.xlsx', XLSX), { error: HEADER_NOT_FOUND }) })
test('no PO Reference header', () => eq(readVdrlSheet(xlsxBook([['Doc Number', 'Title'], ['D-1', 'x']]), 'v.xlsx', XLSX), { error: HEADER_NOT_FOUND }))
test('the error text', () => eq(HEADER_NOT_FOUND, "Header row with 'PO Reference' not found. Use the downloaded template."))
test('a sheet named VDRL Documents is preferred over the first sheet', () => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Reference']]), 'Reference'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, row()]), 'VDRL Documents'); eq(readVdrlSheet(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'v.xlsx', XLSX).rows.length, 1) })
test('a CSV with the banner reads the same as the .xlsx', () => { const a = run([row({ req: '30/06/2025' })]), b = run([row({ req: '30/06/2025' })], { file: 'csv' }); eq(b.results.map(x => [x.row, x.status, x.requiredDate]), a.results.map(x => [x.row, x.status, x.requiredDate])) })
test('a duplicated header: the first column wins', () => { const s = readVdrlSheet(xlsxBook([[...H, 'Notes'], [...row({ notes: 'first' }), 'second']]), 'v.xlsx', XLSX); eq(s.rows[0].cells.notes, 'first') })

// ── rows: blank, skipped, row numbers ─────────────────────────
test('blank lines are not counted and keep the sheet row numbers', () => { const r = run([row({ doc: 'A' }), [], [], row({ doc: 'B' })]); eq([r.total, r.results.map(x => x.row)], [2, [3, 6]]) })
test('a row with only notes is skipped and counted', () => { const r = run([row({ po: '', doc: '', title: '', type: '', notes: 'just a note' })]); eq([r.total, r.skipped, r.results.length], [1, 1, 0]) })
test('toImport holds the ok rows in file order', () => eq(run([row({ doc: 'A' }), row({ doc: 'B', po: 'PO-9' }), row({ doc: 'C' })]).toImport.map(x => x.docNum), ['A', 'C']))
test('an ok row keeps the old keys and message', () => { const r = one({}); eq([r.status, r.message, r.poRef, r.docNum, r.title, r.docType], ['ok', 'Ready to import', 'PO-1', 'DOC-1', 'A document', 'Drawing']) })

// ── PO and title ──────────────────────────────────────────────
test('PO Reference missing', () => eq(one({ po: '' }).errors, ['PO Reference is required']))
test('PO not found or not approved', () => eq(one({ po: 'PO-9' }).errors, ['PO PO-9 not found or not approved']))
test('PO reference in different case and with spaces is found', () => { const r = one({ po: ' po-1 ' }); eq([r.status, r.poId], ['ok', 11]) })
test('Document Title missing', () => eq(one({ title: '' }).errors, ['Document Title is required']))
test('PO missing and title missing: two errors', () => eq(one({ po: '', title: '' }).errors, ['PO Reference is required', 'Document Title is required']))

// ── dates ─────────────────────────────────────────────────────
test('DD/MM/YYYY', () => eq(one({ req: '30/06/2025', prom: '15/06/2025' }).requiredDate, '2025-06-30'))
test('D/M/YYYY reads day first', () => eq(one({ req: '1/6/2024' }).requiredDate, '2024-06-01'))
test('ISO', () => eq(one({ req: '2024-06-01' }).requiredDate, '2024-06-01'))
test('D-Mon-YYYY', () => eq(one({ req: '1-May-2024' }).requiredDate, '2024-05-01'))
test('an Excel date cell reads its own day', () => { const aoa = [BANNER, H, row()]; const ws = XLSX.utils.aoa_to_sheet(aoa); ws.G3 = { t: 'n', v: 45444, z: 'dd/mm/yyyy' }; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'VDRL Documents'); const s = readVdrlSheet(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'v.xlsx', XLSX); eq(checkVdrlRows({ rows: s.rows, pos: POS, existingDocs: EXISTING, XLSX }).results[0].requiredDate, '2024-06-01') })
test('the promised date is read too', () => eq(one({ prom: '15/06/2025' }).promisedDate, '2025-06-15'))
for (const v of ['13/13/2024', '31/02/2024', '2024-02-30', '31/12/1899'])
  test(`required ${v} is not a date`, () => { const r = one({ req: v }); eq([r.status, r.errors, r.requiredDate], ['error', [NOT_DATE('Required date', v)], null]) })
for (const v of ['1-May-24', '1/May/24', '01/05/24', 'May 1, 24'])
  test(`required ${v} has a two-digit year`, () => eq(one({ req: v }).errors, [TWO_DIGIT('Required date', v)]))
test('promised 31/02/2024 is not a date', () => eq(one({ prom: '31/02/2024' }).errors, [NOT_DATE('Promised date', '31/02/2024')]))
test('TBA is a warning, stored blank, the row still imports', () => { const r = one({ req: 'TBA' }); eq([r.status, r.errors, r.warnings, r.requiredDate], ['ok', [], [UNREAD('Required date', 'TBA')], null]) })
test('blank dates are null, no warning', () => { const r = one({}); eq([r.requiredDate, r.promisedDate, r.warnings], [null, null, []]) })

// ── duplicates and existing documents ─────────────────────────
test('a document number twice for one PO names the first row', () => eq(run([row({ doc: 'D-7' }), row({ doc: 'D-7' })]).results[1].errors, ['Duplicate document number "D-7" for PO PO-1 (first on row 3)']))
test('a duplicate in different case', () => eq(run([row({ doc: 'D-7' }), row({ doc: 'd-7' })]).results[1].status, 'error'))
test('the same number on two POs is fine', () => run([row({ doc: 'D-7' }), row({ doc: 'D-7', po: 'PO-2' })]).results.forEach(r => eq(r.status, 'ok')))
test('blank document numbers are never duplicates', () => run([row({ doc: '' }), row({ doc: '' })]).results.forEach(r => eq(r.status, 'ok')))
test('a document number already in the package: a warning, skipped', () => { const r = run([row({ doc: 'DOC-EXISTS' })]); eq([r.results[0].status, r.results[0].warnings, r.skipped, r.toImport.length], ['skip', ['Doc number DOC-EXISTS already exists in this package'], 1, 0]) })
test('an existing number on another PO is not a match', () => eq(one({ doc: 'DOC-EXISTS', po: 'PO-2' }).status, 'ok'))
test('an existing number with an error is an error', () => eq(one({ doc: 'DOC-EXISTS', title: '' }).status, 'error'))

// ── values to insert ──────────────────────────────────────────
test('ABF Y, yes, 1 → 1; N, No, blank → 0', () => eq(['Y', 'yes', '1', 'N', 'No', ''].map(abf => one({ abf }).abf), [1, 1, 1, 0, 0, 0]))
test('revision defaults to R0; package, discipline and notes carried', () => { const r = one({ pkg: 'Valve package', disc: 'Mechanical', notes: 'n' }); eq([r.revision, r.pkgName, r.discipline, r.notes], ['R0', 'Valve package', 'Mechanical', 'n']) })

// ── the real upload's refusal ─────────────────────────────────
test('refusal: first 10 messages, then "and K more"', () => { const b = vdrlRefusal(run(Array.from({ length: 12 }, (_, i) => row({ doc: `D-${i}`, title: '' }))).results); eq([b.error.split('; ').length, b.error.startsWith('Row 3: Document Title is required; Row 4: '), b.error.endsWith('; and 2 more'), b.rows.length], [11, true, true, 12]) })
test('refusal: two errors on one row are two messages', () => eq(vdrlRefusal(run([row({ po: '', title: '' })]).results).error, 'Row 3: PO Reference is required; Row 3: Document Title is required'))
test('refusal rows: row, poRef, docNum, errors', () => eq(vdrlRefusal(run([row({ po: 'PO-9' })]).results).rows, [{ row: 3, poRef: 'PO-9', docNum: 'DOC-1', errors: ['PO PO-9 not found or not approved'] }]))

console.log(`vdrlImport: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
