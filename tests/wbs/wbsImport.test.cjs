// WBS import checks — checkWbsRows (server/lib/wbsImport.js) and parseImportSheet's sheetRows
// (server/utils/validate.js). In-memory files only: no database, no endpoint, no dependency beyond
// the server's own xlsx. Part 1: checkWbsRows, refusal, normCode. Part 2: parseImportSheet against
// its copy as of 24d9372 (below): headers, rows, dataRows and col unchanged, sheetRows the sheet's
// row numbers. Exit code 1 on any failure. Usage: node tests/wbs/wbsImport.test.cjs
const assert = require('assert')
const path = require('path')
const SERVER = path.join(__dirname, '..', '..', 'server')
const XLSX = require(path.join(SERVER, 'node_modules', 'xlsx'))
const { parseImportSheet, readWorkbook, fileNotEmpty } = require(path.join(SERVER, 'utils', 'validate.js'))
const { checkWbsRows, existingCodes, normCode, refusal } = require(path.join(SERVER, 'lib', 'wbsImport.js'))

let pass = 0, fail = 0
function test(name, fn) {
  try { fn(); pass++ } catch (e) { fail++; console.log(`FAIL ${name}\n  ${e.message.split('\n').join('\n  ')}`) }
}

// ── files ─────────────────────────────────────────────────────
const q = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const csvFile = aoa => ({ originalname: 'wbs.csv', buffer: Buffer.from(aoa.map(r => r.map(q).join(',')).join('\n') + '\n', 'utf8') })
const xlsxFile = aoa => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'WBS'); return { originalname: 'wbs.xlsx', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) } }
const xlsxFrom = (aoa, startRow) => {   // a sheet whose range starts at startRow (1-based)
  const ws = {}
  aoa.forEach((r, i) => r.forEach((v, j) => { if (v !== '' && v != null) ws[XLSX.utils.encode_cell({ r: startRow - 1 + i, c: j })] = { t: typeof v === 'number' ? 'n' : 's', v } }))
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: startRow - 1, c: 0 }, e: { r: startRow - 2 + aoa.length, c: Math.max(...aoa.map(r => r.length)) - 1 } })
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'WBS')
  return { originalname: 'wbs.xlsx', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) }
}

// ── Part 1: checkWbsRows ──────────────────────────────────────
const H = ['code', 'description', 'parent_string', 'parent_id', 'ROS']
const EXISTING = [{ id: 101, code: '01' }, { id: 102, code: '01.01' }, { id: 103, code: '02.Á' }, { id: 104, code: 'ZZ.A' }]
function check(rows, { existing = EXISTING, file = csvFile, header = H } = {}) {
  const parsed = parseImportSheet(file([header, ...rows]), ['code', 'description'])
  if (parsed.error) throw new Error('parseImportSheet: ' + parsed.error)
  return checkWbsRows({ ...parsed, existing: existingCodes(existing), XLSX })
}
const one = (row, opts) => check([row], opts).results[0]
const eq = (a, b) => assert.deepStrictEqual(a, b)
const okRow = r => { eq(r.errors, []); eq(r.warnings, []); eq(r.status, 'ok') }
const NOT_SEEN = p => `Parent "${p}" not yet seen — must appear before this row`
const CIRCULAR = 'Circular reference: parent code is same as or child of this code'
const EXISTS = c => `WBS code '${c}' already exists in this project`
const NOT_DATE = v => `ROS date '${v}' is not a valid date (use DD/MM/YYYY or YYYY-MM-DD)`
const TWO_DIGIT = v => `ROS date '${v}' has a two-digit year (use a four-digit year: DD/MM/YYYY or YYYY-MM-DD)`
const UNREAD = v => `ROS date '${v}' can't be read; it will be stored blank`

// required fields and lengths
test('a good row', () => { const r = one(['03', 'Mechanical', '', '', '2025-06-30']); okRow(r); eq([r.row, r.code, r.description, r.parent, r.ros, r.rosDate], [2, '03', 'Mechanical', '', '2025-06-30', '2025-06-30']) })
test('missing code', () => eq(one(['', 'Mechanical']).errors, ['Missing WBS code']))
test('missing description', () => eq(one(['03', '']).errors, ['Missing description']))
test('both missing (a row with only a parent)', () => eq(one(['', '', '01']).errors, ['Missing WBS code', 'Missing description']))
test('a whitespace-only code is missing', () => eq(one(['   ', 'Mechanical']).errors, ['Missing WBS code']))
test('code and description are trimmed', () => { const r = one(['  03  ', '  Mechanical  ']); okRow(r); eq([r.code, r.description], ['03', 'Mechanical']) })
test('a 50-character code is allowed', () => okRow(one(['C'.repeat(50), 'X'])))
test('a 51-character code', () => eq(one(['C'.repeat(51), 'X']).errors, ['WBS code is longer than 50 characters (51)']))
test('a 500-character description is allowed', () => okRow(one(['03', 'd'.repeat(500)])))
test('a 501-character description', () => eq(one(['03', 'd'.repeat(501)]).errors, ['Description is longer than 500 characters (501)']))
test('length counts characters, not UTF-16 units (300 emoji)', () => okRow(one(['03', '😀'.repeat(300)])))
test('501 emoji is too long', () => eq(one(['03', '😀'.repeat(501)]).errors, ['Description is longer than 500 characters (501)']))
test('the full description is returned (the validate route shortens it)', () => eq(one(['03', 'x'.repeat(120)]).description.length, 120))

// duplicates within the file
test('a duplicate code names the first row', () => { const r = check([['03', 'A'], ['03', 'B']]).results; okRow(r[0]); eq(r[1].errors, ['Duplicate code "03" (first on row 2)']) })
test('duplicate in different case', () => eq(check([['05.A', 'A'], ['05.a', 'B']]).results[1].errors, ['Duplicate code "05.a" (first on row 2)']))
test('duplicate with a different accent', () => eq(check([['05.É', 'A'], ['05.e', 'B']]).results[1].errors, ['Duplicate code "05.e" (first on row 2)']))
test('duplicate with surrounding spaces', () => eq(check([['06', 'A'], [' 06 ', 'B']]).results[1].errors, ['Duplicate code "06" (first on row 2)']))
test('three copies all name the first row', () => { const r = check([['07', 'A'], ['07', 'B'], ['07', 'C']]).results; eq([r[1].errors, r[2].errors], [['Duplicate code "07" (first on row 2)'], ['Duplicate code "07" (first on row 2)']]) })
test('07.1 and 07.10 are different codes', () => check([['07.1', 'A'], ['07.10', 'B']]).results.forEach(okRow))
test('1 and 01 are different codes', () => okRow(one(['1', 'One'])))

// codes already in the project
test('an existing code', () => eq(one(['01', 'X']).errors, [EXISTS('01')]))
test('an existing code with spaces', () => eq(one([' 01 ', 'X']).errors, [EXISTS('01')]))
test('an existing code in different case', () => eq(one(['zz.a', 'X']).errors, [EXISTS('zz.a')]))
test('an existing code without its accent', () => eq(one(['02.A', 'X']).errors, [EXISTS('02.A')]))
test('an existing code in different case and accent', () => eq(one(['02.á', 'X']).errors, [EXISTS('02.á')]))
test('an existing code twice: exists, then duplicate', () => { const r = check([['01', 'A'], ['01', 'B']]).results; eq([r[0].errors, r[1].errors], [[EXISTS('01')], ['Duplicate code "01" (first on row 2)']]) })
test('no existing nodes: nothing exists', () => okRow(one(['01', 'X'], { existing: [] })))

// parents (parent_string only)
test('a parent that exists in the project', () => { const r = one(['01.02', 'X', '01']); okRow(r); eq(r.parent, '01') })
test('an existing parent in different case', () => okRow(one(['ZZ.A.1', 'X', 'zz.a'])))
test('an existing parent without its accent', () => okRow(one(['02.A.1', 'X', '02.A'])))
test('a parent earlier in the file', () => check([['03', 'A'], ['03.01', 'B', '03']]).results.forEach(okRow))
test('a parent earlier in the file, in different case', () => check([['05.A', 'A'], ['05.A.1', 'B', '05.a']]).results.forEach(okRow))
test('a parent later in the file', () => { const r = check([['03.01', 'B', '03'], ['03', 'A']]).results; eq(r[0].errors, [NOT_SEEN('03')]); okRow(r[1]) })
test('a parent found nowhere', () => eq(one(['03.01', 'B', '99']).errors, [NOT_SEEN('99')]))
test('a parent that is the node itself', () => eq(one(['03', 'A', '03']).errors, [CIRCULAR]))
test('a parent that is the node itself, in different case', () => eq(one(['05.a', 'A', '05.A']).errors, [CIRCULAR]))
test('a parent that is a child of the node', () => eq(one(['03', 'A', '03.01']).errors, [CIRCULAR]))
test('03.010 is not a child of 03.01', () => eq(one(['03.01', 'A', '03.010']).errors, [NOT_SEEN('03.010')]))
test('parent_id only', () => eq(one(['03.01', 'B', '', '17']).errors, ['Parent given only as parent_id "17" — put the parent\'s code in parent_string']))
test('parent_id with parent_string: parent_string is used', () => { const r = one(['01.02', 'B', '01', '17']); okRow(r); eq(r.parent, '01') })
test('a sheet with a parent_id column and no parent_string column', () => eq(check([['03.01', 'B', 5]], { header: ['code', 'description', 'parent_id'] }).results[0].errors, ['Parent given only as parent_id "5" — put the parent\'s code in parent_string']))
test('a parent on an earlier row that has its own error still resolves', () => { const r = check([['03', ''], ['03.01', 'B', '03']]).results; eq(r[0].errors, ['Missing description']); okRow(r[1]) })
test('a top-level node (no parent)', () => { const r = one(['09', 'Top']); okRow(r); eq(r.parent, '') })

// ROS dates
test('ROS ISO', () => eq(one(['03', 'A', '', '', '2025-06-30']).rosDate, '2025-06-30'))
test('ROS DD/MM/YYYY reads day first, no warning', () => { const r = one(['03', 'A', '', '', '30/06/2025']); okRow(r); eq([r.ros, r.rosDate], ['2025-06-30', '2025-06-30']) })
test('ROS as an Excel date cell (.xlsx)', () => { const r = one(['03', 'A', '', '', new Date(2025, 5, 30)], { file: xlsxFile }); okRow(r); eq(r.rosDate, '2025-06-30') })
test('ROS 1-May-2024', () => eq(one(['03', 'A', '', '', '1-May-2024']).rosDate, '2024-05-01'))
test('ROS 15.05.2024 reads day first', () => eq(one(['03', 'A', '', '', '15.05.2024']).rosDate, '2024-05-15'))
for (const v of ['13/13/2024', '31/02/2024', '2024-02-30', '31/12/1899', '01/01/2101'])
  test(`ROS ${v} is not a date`, () => { const r = one(['03', 'A', '', '', v]); eq(r.errors, [NOT_DATE(v)]); eq([r.ros, r.rosDate, r.status], [v, null, 'error']) })
for (const v of [0, 60])
  test(`ROS serial ${v} (.xlsx) is not a date`, () => eq(one(['03', 'A', '', '', v], { file: xlsxFile }).errors, [NOT_DATE(String(v))]))
for (const v of ['1-May-24', '01/05/24', '1 May 24', '31/12/99'])
  test(`ROS ${v} has a two-digit year`, () => { const r = one(['03', 'A', '', '', v]); eq(r.errors, [TWO_DIGIT(v)]); eq(r.rosDate, null) })
for (const v of ['TBA', 'May 2025'])
  test(`ROS ${v} is a warning, stored blank`, () => { const r = one(['03', 'A', '', '', v]); eq(r.errors, []); eq(r.warnings, [UNREAD(v)]); eq([r.status, r.ros, r.rosDate], ['warning', v, null]) })
test('ROS blank', () => { const r = one(['03', 'A', '', '', '']); okRow(r); eq([r.ros, r.rosDate], ['', null]) })
test('no ROS column', () => { const r = check([['03', 'A']], { header: ['code', 'description'] }).results[0]; okRow(r); eq([r.ros, r.rosDate], ['', null]) })
test('an error and a warning on one row: status error', () => { const r = one(['03', '', '', '', 'TBA']); eq([r.status, r.errors, r.warnings], ['error', ['Missing description'], [UNREAD('TBA')]]) })

// sheet row numbers
test('a blank row before a bad row (CSV): the sheet row', () => eq(check([['03', 'A'], ['', ''], ['04', '']]).results.map(r => r.row), [2, 4]))
test('a blank row before a bad row (.xlsx): the sheet row', () => eq(check([['03', 'A'], [], ['04', '']], { file: xlsxFile }).results.map(r => [r.row, r.errors]), [[2, []], [4, ['Missing description']]]))
test('a duplicate after a blank row names the first sheet row', () => eq(check([['03', 'A'], ['', ''], ['', ''], ['03', 'B']]).results[1], { row: 5, code: '03', description: 'B', parent: '', ros: '', rosDate: null, status: 'error', errors: ['Duplicate code "03" (first on row 2)'], warnings: [] }))
test('a sheet whose range starts at row 3', () => {
  const parsed = parseImportSheet(xlsxFrom([H, ['03', 'A'], [], ['04', '']], 3), ['code', 'description'])
  const r = checkWbsRows({ ...parsed, existing: existingCodes([]), XLSX }).results
  eq(r.map(x => [x.row, x.status]), [[4, 'ok'], [6, 'error']])
})
test('without sheetRows, rows fall back to index + 2', () => {
  const parsed = parseImportSheet(csvFile([H, ['03', 'A'], ['', ''], ['04', 'B']]), ['code', 'description'])
  eq(checkWbsRows({ ...parsed, sheetRows: undefined, existing: new Map(), XLSX }).results.map(r => r.row), [2, 3])
})

// result shape and summary
test('result keys', () => eq(Object.keys(one(['03', 'A'])), ['row', 'code', 'description', 'parent', 'ros', 'rosDate', 'status', 'errors', 'warnings']))
test('summary counts', () => eq(check([['03', 'A'], ['04', 'B', '', '', 'TBA'], ['05', ''], ['01', 'X'], ['06', 'C']]).summary, { total: 5, ready: 2, warnings: 1, errors: 2 }))

// refusal (the import's 400 and 409 body)
test('refusal: first 10 messages, then "and K more"', () => {
  const body = refusal(check(Array.from({ length: 12 }, (_, i) => [`1${i}`, ''])).results)
  eq(body.error.split('; ').length, 11); assert.ok(body.error.startsWith('Row 2: Missing description; Row 3: Missing description')); assert.ok(body.error.endsWith('; and 2 more'))
  eq(body.rows.length, 12); eq(body.rows[0], { row: 2, code: '10', errors: ['Missing description'] })
})
test('refusal: two errors on one row are two messages', () => eq(refusal(check([['', '', '', '', '2025-06-30']]).results).error, 'Row 2: Missing WBS code; Row 2: Missing description'))
test('refusal: rows capped at 500', () => eq(refusal(check(Array.from({ length: 600 }, (_, i) => [`R${i}`, '']), {}).results).rows.length, 500))
test('refusal: rows without errors are not listed', () => eq(refusal(check([['03', 'A'], ['01', 'X']]).results).rows, [{ row: 3, code: '01', errors: [EXISTS('01')] }]))

// normCode and existingCodes
test('normCode: trim, lower case, no accents', () => eq([normCode(' 01.Á '), normCode('ZZ.a'), normCode('É'), normCode(null)], ['01.a', 'zz.a', 'e', '']))
test('existingCodes: normalised keys, the first id wins', () => eq([...existingCodes([{ id: 1, code: 'A.B' }, { id: 2, code: 'a.b' }, { id: 3, code: 'Ç' }])], [['a.b', 1], ['c', 3]]))
const part1 = pass + fail

// ── Part 2: parseImportSheet against its copy as of 24d9372 ──
function oldParseImportSheet(file, requiredHeaders = []) {
  const fe = fileNotEmpty(file)
  if (fe) return { error: fe }
  let rows
  try {
    const wb = readWorkbook(file.buffer, file.originalname, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) return { error: 'The spreadsheet has no readable sheet.' }
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  } catch (e) {
    if (e.http) return { error: e.message }
    return { error: 'Could not read the file — it may be corrupt or not a real spreadsheet.' }
  }
  if (!rows.length) return { error: 'The spreadsheet is empty.' }
  const headers = (rows[0] || []).map(h => String(h).toLowerCase().trim())
  const missing = requiredHeaders.filter(h => !headers.includes(h))
  if (missing.length) {
    return { error: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected columns include: ${requiredHeaders.join(', ')}.` }
  }
  const dataRows = rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''))
  if (!dataRows.length) return { error: 'The spreadsheet has a header row but no data rows.' }
  const col = name => headers.findIndex(h => h === name)
  return { headers, rows, dataRows, col }
}
const NAMES = ['code', 'description', 'parent_string', 'parent_id', 'ros', 'missing']
function sameAsOld(file, req, sheetRows) {
  const o = oldParseImportSheet(file, req), n = parseImportSheet(file, req)
  if (o.error) { eq(n, o); return }
  eq(Object.keys(n), [...Object.keys(o), 'sheetRows'])
  eq(n.headers, o.headers); eq(n.rows, o.rows); eq(n.dataRows, o.dataRows)
  eq(NAMES.map(n.col), NAMES.map(o.col))
  eq(n.sheetRows, sheetRows)
}
const R = ['code', 'description']
const body = [H, ['01', 'Civil', '', '', '2025-06-30'], ['01.01', 'Foundations', '01', '', '2025-03-31'], ['01.01.01', 'Piling', '01.01', '', '2024-12-31']]
const gaps = [H, ['01', 'Civil'], ['', ''], ['01.01', 'Foundations', '01'], ['', '', '', '', ''], ['', ''], ['01.01.01', 'Piling', '01.01']]
test('parseImportSheet: CSV, no blank rows', () => sameAsOld(csvFile(body), R, [2, 3, 4]))
test('parseImportSheet: CSV, blank rows', () => sameAsOld(csvFile(gaps), R, [2, 4, 7]))
test('parseImportSheet: .xlsx, no blank rows', () => sameAsOld(xlsxFile(body), R, [2, 3, 4]))
test('parseImportSheet: .xlsx, blank rows', () => sameAsOld(xlsxFile([H, ['01', 'Civil'], [], ['01.01', 'Foundations', '01'], [], [], ['01.01.01', 'Piling', '01.01']]), R, [2, 4, 7]))
test('parseImportSheet: .xlsx range starting at row 3 (decode_range)', () => {
  const file = xlsxFrom([H, ['01', 'Civil'], [], ['01.01', 'Foundations', '01']], 3)
  const ws = XLSX.read(file.buffer, { type: 'buffer' }).Sheets.WBS
  eq(XLSX.utils.decode_range(ws['!ref']).s.r, 2)
  sameAsOld(file, R, [4, 6])
})
test('parseImportSheet: a whitespace-only row is skipped', () => sameAsOld(csvFile([H, ['01', 'Civil'], ['  ', ' '], ['02', 'Mech']]), R, [2, 4]))
test('parseImportSheet: refusals unchanged', () => {
  for (const [file, req] of [[{ originalname: 'e.csv', buffer: Buffer.alloc(0) }, R], [csvFile([H]), R], [csvFile([['name', 'x'], ['a', 'b']]), R],
    [{ originalname: 'l.csv', buffer: Buffer.from('code,description\n01,Caf\xe9\n', 'latin1') }, R], [{ originalname: 'x.xlsx', buffer: Buffer.from('not a workbook') }, R], [null, R]]) sameAsOld(file, req)
})
test('parseImportSheet: 1,000 rows, every 7th blank', () => {
  const aoa = [H], want = []
  for (let i = 1; i <= 1000; i++) { if (i % 7 === 0) aoa.push(['', '']); else { aoa.push([`N${i}`, `Node ${i}`]); want.push(i + 1) } }
  sameAsOld(csvFile(aoa), R, want); sameAsOld(xlsxFile(aoa), R, want)
})

console.log(`wbsImport: ${pass} passed, ${fail} failed (${part1} checkWbsRows/refusal/normCode cases, ${pass + fail - part1} parseImportSheet cases)`)
process.exit(fail ? 1 : 0)
