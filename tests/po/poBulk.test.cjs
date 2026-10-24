// PO bulk upload checks — poRowsFromSheet and checkPoRows (server/lib/poBulk.js), read through
// parseImportSheet (server/utils/validate.js). In-memory files only: no database, no endpoint, no
// dependency beyond the server's own xlsx. Exit code 1 on any failure. Usage: node tests/po/poBulk.test.cjs
const assert = require('assert')
const path = require('path')
const SERVER = path.join(__dirname, '..', '..', 'server')
const XLSX = require(path.join(SERVER, 'node_modules', 'xlsx'))
const { parseImportSheet } = require(path.join(SERVER, 'utils', 'validate.js'))
const { checkPoRows, poRowsFromSheet, bulkLocked } = require(path.join(SERVER, 'lib', 'poBulk.js'))

let pass = 0, fail = 0
function test(name, fn) {
  try { fn(); pass++ } catch (e) { fail++; console.log(`FAIL ${name}\n  ${e.message.split('\n').join('\n  ')}`) }
}
const eq = (a, b) => assert.deepStrictEqual(a, b)

// ── files ─────────────────────────────────────────────────────
const H = ['PO Number', 'Supplier', 'Description', 'Group', 'Currency', 'Value', 'Incoterms', 'WBS', 'ROS Date', 'Owner']
const q = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const csvFile = (aoa, eol = '\n', bom = '') => ({ originalname: 'pos.csv', buffer: Buffer.from(bom + aoa.map(r => r.map(q).join(',')).join(eol) + eol, 'utf8') })
const book = (aoa, type) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'POs'); return XLSX.write(wb, { type: 'buffer', bookType: type }) }
const xlsxFile = aoa => ({ originalname: 'pos.xlsx', buffer: book(aoa, 'xlsx') })
const xlsFile = aoa => ({ originalname: 'pos.xls', buffer: book(aoa, 'biff8') })
const row = (o = {}) => [o.po ?? 'ZP-1', o.vendor ?? 'Acme', o.desc ?? 'Pumps', o.group ?? '', o.ccy ?? '', o.value ?? '', o.inco ?? '', o.wbs ?? '', o.ros ?? '', o.owner ?? '']
const PID = 1
const EXISTING = new Map([
  ['zp-dup', { id: 501, project_id: 1, po_number: 'ZP-DUP', status: 'rfq', is_locked: 0, tender_id: null }],
  ['zp-locked', { id: 502, project_id: 1, po_number: 'ZP-LOCKED', status: 'active', is_locked: 1, tender_id: null }],
  ['zp-raised', { id: 503, project_id: 1, po_number: 'ZP-RAISED', status: 'po-raised', is_locked: 0, tender_id: null }],
  ['zp-tender', { id: 504, project_id: 1, po_number: 'ZP-TENDER', status: 'rfq', is_locked: 0, tender_id: 9 }],
  ['zp-other', { id: 505, project_id: 2, po_number: 'ZP-OTHER', status: 'rfq', is_locked: 0, tender_id: null }],
])
function preview(rows, { file = csvFile, header = H } = {}) {
  const parsed = parseImportSheet(file([header, ...rows]), [])
  if (parsed.error) return parsed
  return checkPoRows({ rows: poRowsFromSheet(parsed), existing: EXISTING, pid: PID, XLSX }).results
}
const one = (o, opts) => preview([row(o)], opts)[0]
const confirm = (posted) => checkPoRows({ rows: posted.map((r, i) => ({ row: r.rowIndex ?? i + 2, cells: r })), existing: EXISTING, pid: PID, XLSX, confirm: true }).results
const okPost = (o = {}) => ({ rowIndex: 2, po_number: 'ZP-9', vendor_name: 'Acme', description: 'x', currency: 'AUD', value: 10, ros_date: null, rowStatus: 'new', ...o })
const NOT_DATE = v => `ROS date '${v}' is not a valid date (use DD/MM/YYYY or YYYY-MM-DD)`
const TWO = v => `ROS date '${v}' has a two-digit year (use a four-digit year: DD/MM/YYYY or YYYY-MM-DD)`

// ── reading ───────────────────────────────────────────────────
test('CSV: a quoted comma stays in its column', () => { const r = one({ vendor: 'Acme, Pty Ltd', ros: '01/06/2024' }); eq([r.vendor_name, r.description, r.ros_date], ['Acme, Pty Ltd', 'Pumps', '2024-06-01']) })
test('CSV: a BOM before the header', () => eq(preview([row()], { file: aoa => csvFile(aoa, '\n', '\ufeff') })[0].po_number, 'ZP-1'))
test('CSV: CRLF line endings', () => eq(preview([row({ po: 'ZP-2' })], { file: aoa => csvFile(aoa, '\r\n') })[0].po_number, 'ZP-2'))
test('CSV: accents kept (UTF-8)', () => eq(one({ vendor: 'Café São José' }).vendor_name, 'Café São José'))
test('CSV: a Latin-1 file is refused', () => eq(parseImportSheet({ originalname: 'l.csv', buffer: Buffer.from(`${H.join(',')}\nZP-1,Caf\xe9,x,,,,,,,\n`, 'latin1') }, []), { error: 'Save it as CSV UTF-8, or use the .xlsx template.' }))
test('.xls reads like .xlsx', () => { const rows = [row({ po: 'ZP-3', vendor: 'Acme, Pty Ltd', value: 1500 })]; eq(preview(rows, { file: xlsFile }).map(r => [r.po_number, r.vendor_name, r.value]), preview(rows, { file: xlsxFile }).map(r => [r.po_number, r.vendor_name, r.value])) })
test('.xlsx reads like CSV', () => { const rows = [row({ po: 'ZP-4', ros: '30/06/2025' })]; eq(preview(rows, { file: xlsxFile }), preview(rows)) })
test('header aliases map as before', () => { const r = preview([['ZP-5', 'Beta', 'X', 'civil', 'USD', '12', 'FOB', '01.01', '2025-06-30']], { header: ['PO Ref', 'Vendor', 'Description', 'Category', 'CCY', 'Amount', 'Inco Terms', 'WBS Code', 'Required On Site'] })[0]; eq([r.po_number, r.vendor_name, r.group_category, r.currency, r.value, r.incoterms, r.wbs_code, r.ros_date], ['ZP-5', 'Beta', 'civil', 'USD', 12, 'FOB', '01.01', '2025-06-30']) })
test('rowIndex is the sheet row, after blank rows', () => eq(preview([row({ po: 'A1' }), ['', '', ''], row({ po: 'A2' })]).map(r => r.rowIndex), [2, 4]))
test('the preview keeps the old keys and adds warnings', () => eq(Object.keys(one({})), ['rowIndex', 'po_number', 'description', 'vendor_name', 'group_category', 'currency', 'value', 'incoterms', 'wbs_code', 'ros_date', 'owner_name', 'rowStatus', 'errors', 'warnings', 'existingStatus']))

// ── the checks kept from before ──────────────────────────────
test('PO Number required', () => eq(one({ po: '' }).errors, ['PO Number is required']))
test('Supplier/Vendor required', () => eq(one({ vendor: '' }).errors, ['Supplier/Vendor is required']))
test('a supplier_id stands in for the vendor', () => eq(confirm([okPost({ vendor_name: '', supplier_id: 4 })])[0].errors, []))
test('a PO number twice in the file: both copies are errors', () => eq(preview([row({ po: 'ZP-7' }), row({ po: 'ZP-7' })]).map(r => r.errors), [['Duplicate within this upload file'], ['Duplicate within this upload file']]))
test('twice in different case and spacing', () => eq(preview([row({ po: 'ZP-8' }), row({ po: ' zp-8 ' })]).map(r => r.rowStatus), ['invalid', 'invalid']))
test('an unlocked PO in this project is a duplicate', () => { const r = one({ po: 'ZP-DUP' }); eq([r.rowStatus, r.existingStatus], ['duplicate', 'rfq']) })
test('a locked PO is locked', () => eq(one({ po: 'ZP-LOCKED' }).rowStatus, 'locked'))
test('a po-raised PO is locked', () => eq(one({ po: 'zp-raised' }).rowStatus, 'locked'))
test('a tender-generated PO is locked', () => eq(one({ po: 'ZP-TENDER' }).rowStatus, 'locked'))
test('a PO number used by another project is an error', () => { const r = one({ po: 'ZP-OTHER' }); eq([r.rowStatus, r.errors, r.existingStatus], ['invalid', ['PO number ZP-OTHER is already used by another project'], null]) })
test('a new PO is new', () => eq(one({}).rowStatus, 'new'))
test('bulkLocked: is_locked, approval statuses, tender', () => eq([{ is_locked: 1 }, { status: 'approved' }, { status: 'pending_director_approval' }, { tender_id: 3 }, { status: 'rfq' }].map(bulkLocked), [true, true, true, true, false]))

// ── ROS dates ─────────────────────────────────────────────────
for (const v of ['13/13/2024', '31/02/2024', '2024-02-30'])
  test(`ROS ${v} is not a date`, () => { const r = one({ ros: v }); eq([r.rowStatus, r.errors, r.ros_date], ['invalid', [NOT_DATE(v)], null]) })
for (const v of ['1-May-24', '1/May/24', '01/05/24'])
  test(`ROS ${v} has a two-digit year`, () => eq(one({ ros: v }).errors, [TWO(v)]))
test('ROS TBA is a warning, stored blank', () => { const r = one({ ros: 'TBA' }); eq([r.rowStatus, r.errors, r.warnings, r.ros_date], ['new', [], ["ROS date 'TBA' can't be read; it will be stored blank"], null]) })
test('ROS 1/6/2024 reads day first', () => eq(one({ ros: '1/6/2024' }).ros_date, '2024-06-01'))
test('ROS 01/06/2024', () => eq(one({ ros: '01/06/2024' }).ros_date, '2024-06-01'))
test('ROS 2024-06-01', () => eq(one({ ros: '2024-06-01' }).ros_date, '2024-06-01'))
test('ROS as an Excel date cell (.xlsx)', () => { const aoa = [H, row()]; const ws = XLSX.utils.aoa_to_sheet(aoa); ws.I2 = { t: 'n', v: 45444, z: 'dd/mm/yyyy' }; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'POs'); const parsed = parseImportSheet({ originalname: 'd.xlsx', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) }, []); eq(checkPoRows({ rows: poRowsFromSheet(parsed), existing: EXISTING, pid: PID, XLSX }).results[0].ros_date, '2024-06-01') })
test('ROS blank is null', () => { const r = one({}); eq([r.ros_date, r.warnings], [null, []]) })

// ── confirm: the server checks the posted rows again ─────────
test('confirm: a valid ISO ros_date', () => { const r = confirm([okPost({ ros_date: '2024-06-01' })])[0]; eq([r.rowStatus, r.ros_date], ['new', '2024-06-01']) })
test('confirm: ros_date must be YYYY-MM-DD', () => eq(confirm([okPost({ ros_date: '01/06/2024' })])[0].errors, ["ROS date '01/06/2024' must be a YYYY-MM-DD date"]))
test('confirm: an impossible ISO date', () => eq(confirm([okPost({ ros_date: '2024-02-30' })])[0].errors, [NOT_DATE('2024-02-30')]))
test('confirm: TBA is refused (not a computed value)', () => eq(confirm([okPost({ ros_date: 'TBA' })])[0].rowStatus, 'invalid'))
test('confirm: the client\'s rowStatus is ignored (invalid labelled new)', () => eq(confirm([okPost({ po_number: '', rowStatus: 'new' })])[0].rowStatus, 'invalid'))
test('confirm: the client\'s rowStatus is ignored (new labelled locked)', () => eq(confirm([okPost({ rowStatus: 'locked' })])[0].rowStatus, 'new'))
test('confirm: a locked PO relabelled new is locked', () => eq(confirm([okPost({ po_number: 'ZP-LOCKED', rowStatus: 'new' })])[0].rowStatus, 'locked'))
test('confirm: posted duplicates in the body', () => eq(confirm([okPost(), okPost()]).map(r => r.rowStatus), ['invalid', 'invalid']))

// ── value ─────────────────────────────────────────────────────
test('value 1,234.50', () => eq(one({ value: '1,234.50' }).value, 1234.5))
test('value $2,000', () => eq(one({ value: '$2,000' }).value, 2000))
test('value abc is not a number', () => eq(one({ value: 'abc' }).errors, ["Value 'abc' is not a number"]))
test('value 1.2.3 is not a number', () => eq(one({ value: '1.2.3' }).errors, ["Value '1.2.3' is not a number"]))
test('value too large for decimal(15,2)', () => eq(one({ value: '99999999999999' }).errors, ["Value '99999999999999' is too large"]))
test('value blank is null, 0 is 0', () => eq([one({ value: '' }).value, one({ value: '0' }).value], [null, 0]))
test('value from a number cell (.xlsx)', () => eq(preview([row({ value: 1500.25 })], { file: xlsxFile })[0].value, 1500.25))

// ── column lengths, group, defaults ───────────────────────────
test('description 500 is fine, 501 is too long', () => eq([one({ desc: 'd'.repeat(500) }).errors, one({ desc: 'd'.repeat(501) }).errors], [[], ['Description is longer than 500 characters (501)']]))
test('currency longer than 10', () => eq(one({ ccy: 'AUSTRALIAN$' }).errors, ['Currency is longer than 10 characters (11)']))
test('PO number longer than 100', () => eq(one({ po: 'P'.repeat(101) }).errors, ['PO Number is longer than 100 characters (101)']))
test('WBS code longer than 50', () => eq(one({ wbs: 'W'.repeat(51) }).errors, ['WBS code is longer than 50 characters (51)']))
test('vendor longer than 255', () => eq(one({ vendor: 'V'.repeat(256) }).errors, ['Supplier/Vendor is longer than 255 characters (256)']))
test('incoterms longer than 20', () => eq(one({ inco: 'I'.repeat(21) }).errors, ['Incoterms is longer than 20 characters (21)']))
test('group in any case is stored lower case', () => eq(one({ group: 'Mechanical' }).group_category, 'mechanical'))
test('a group outside the list', () => eq(one({ group: 'Plumbing' }).errors, ["Group/Category 'Plumbing' is not one of mechanical, electrical, instrumentation, civil, piping, structural"]))
test('currency defaults to AUD', () => eq(one({}).currency, 'AUD'))
test('fields are trimmed', () => { const r = one({ po: '  ZP-10 ', vendor: ' Acme ' }); eq([r.po_number, r.vendor_name], ['ZP-10', 'Acme']) })

console.log(`poBulk: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
