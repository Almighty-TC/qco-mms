// P2c — server/lib/vendorView.js: each projection against a fake row holding every column of its
// table (as read from information_schema on 2026-10-16), every joined alias and a zz_new_column,
// all with sentinel values. The expected key lists are written out here from TC's answers, not
// imported, so widening an allowlist fails this test. Exit code 1 on any failure.
// Usage: node tests/p2/vendorView.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const FILE = path.join(__dirname, '../../server/lib/vendorView.js')
const SOURCE = fs.readFileSync(FILE, 'utf8')

const COLS = {
  purchase_orders: 'id project_id po_number po_name wbs_code group_category ros_date owner_id is_critical_path critical_path_set_by critical_path_set_at is_locked milestone_po_date milestone_fat_date milestone_esd_date milestone_eta_date milestone_ros_date vendor_name vendor_code supplier_id tender_id description value currency status expeditor_id expeditor_assigned_at expeditor_assigned_by pre_expediting_enabled rag incoterms handover_point inco_term_id warehouse_id contract_delivery_date estimated_delivery_date created_by created_at updated_at',
  po_lines: 'id po_id wbs_id line_number description tag_number qty uom cdd uom_id qty_allocated qty_received unit_price total_price ros_date heat_number_required supplier_name_snapshot wbs_code_snapshot insp_type cert_required vdrl_required status rag created_at updated_at heat_number forecast_ready_date commodity_id equipment_tag equipment_tag_ref qty_assigned source_mto_line_id',
  po_documents: 'id po_id doc_type file_name file_path file_size_bytes mime_type version is_current description uploaded_by uploaded_at',
  po_variations: 'id po_id variation_number reason value_impact schedule_impact_days requested_by approved_by status approved_at created_at updated_at',
  itp_requirements: 'id po_id description inspection_type is_mandatory created_by created_at item_number timing witness_required certificate_required planned_date forecast_date status completion_date completion_notes po_line_id is_deleted notes',
  itp_items: 'id requirement_id item_number description status actioned_by actioned_at notes created_at',
}
const LIST_ALIASES = 'statusLabel isCriticalPath isLocked owner_name expeditor_name expeditor_ids expeditor_names expeditor_names_all supplier_name supplier_code wbs_node_id wbs_name line_count earliest_cdd earliest_line_ros cdd atRiskDays approvals'
const fake = (cols, extra = '') => Object.fromEntries([...cols.split(' '), ...extra.split(' ').filter(Boolean), 'zz_new_column'].map(k => [k, 'S:' + k]))

const EXPECT = {
  poListRow: 'id po_number po_name description currency value status statusLabel ros_date cdd vendor_name supplier_name incoterms handover_point wbs_code wbs_name group_category milestone_po_date milestone_fat_date milestone_esd_date milestone_eta_date milestone_ros_date rag line_count created_at',
  poHeader: 'id po_number po_name description currency value status statusLabel ros_date cdd vendor_name supplier_name incoterms handover_point wbs_code wbs_name group_category milestone_po_date milestone_fat_date milestone_esd_date milestone_eta_date milestone_ros_date contract_delivery_date',
  line: 'line_number description tag_number equipment_tag equipment_tag_ref qty uom uom_code uom_name unit_price total_price cdd ros_date forecast_ready_date insp_type cert_required vdrl_required heat_number_required heat_number status qty_received received_to_date remaining_qty',
  signedDoc: 'id file_name file_size_bytes mime_type version uploaded_at uploaded_by_name',
  requirement: 'id item_number description inspection_type is_mandatory timing witness_required certificate_required planned_date forecast_date status completion_date completion_notes items',
  item: 'id item_number description status',
  variation: 'id variation_number value_impact schedule_impact_days status reason approved_at',
  document: 'id doc_type file_name file_size_bytes mime_type version is_current uploaded_at uploaded_by_name',
}
const NEVER = 'owner_id owner_name expeditor_id expeditor_name expeditor_ids expeditor_names expeditor_names_all is_critical_path isCriticalPath critical_path_set_by critical_path_set_at is_locked isLocked tender_id approvals file_path notes created_by created_by_name actioned_by actioned_by_name requested_by requested_by_name approved_by approved_by_name qty_allocated qty_assigned source_mto_line_id commodity_id atRiskDays zz_new_column supplier_id project_id'.split(' ')

function load(src) {
  const m = new Module(FILE, module); m.filename = FILE; m.paths = Module._nodeModulePaths(path.dirname(FILE)); m._compile(src, FILE); return m.exports
}

function suite(src) {
  const V = load(src)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const keysAre = (o, list, name) => check(o && JSON.stringify(Object.keys(o)) === JSON.stringify(list.split(' ')), `${name}: keys equal the allowlist`)
  const sentinels = (o, keys, name) => check(keys.every(k => o[k] === 'S:' + k), `${name}: values carried unchanged`)
  const neverIn = (o, name) => { const bad = NEVER.filter(k => Object.prototype.hasOwnProperty.call(o, k)); check(bad.length === 0, `${name}: none of the hidden fields (${bad.join(', ') || 'none'})`) }

  // PO list row: every purchase_orders column, every list alias, the mapped keys
  const listRow = fake(COLS.purchase_orders, LIST_ALIASES)
  const L = V.poListRow(listRow)
  keysAre(L, EXPECT.poListRow, 'poListRow'); sentinels(L, EXPECT.poListRow.split(' '), 'poListRow'); neverIn(L, 'poListRow')
  check(L !== listRow, 'poListRow builds a new object')

  // PO detail: header, lines, signed document; no approvals
  const po = fake(COLS.purchase_orders, LIST_ALIASES + ' lines signedDoc')
  const lines = [fake(COLS.po_lines, 'uom_code uom_name received_to_date remaining_qty'), fake(COLS.po_lines, 'uom_code uom_name received_to_date remaining_qty')]
  const doc = fake(COLS.po_documents, 'uploaded_by_name')
  const D = V.poDetail(po, lines, doc)
  keysAre(D, EXPECT.poHeader + ' lines signedDoc', 'poDetail'); sentinels(D, EXPECT.poHeader.split(' '), 'poDetail header'); neverIn(D, 'poDetail')
  check(!('rag' in D) && !('line_count' in D) && !('created_at' in D), 'poDetail: no rag, line_count or created_at')
  check(D.lines.length === 2 && D.lines.every(l => JSON.stringify(Object.keys(l)) === JSON.stringify(EXPECT.line.split(' '))), 'poDetail lines: keys equal the allowlist')
  sentinels(D.lines[0], EXPECT.line.split(' '), 'poDetail line'); D.lines.forEach((l, i) => neverIn(l, `poDetail line ${i}`))
  check(!('id' in D.lines[0]) && !('wbs_id' in D.lines[0]) && !('rag' in D.lines[0]), 'poDetail lines: no id, wbs_id or rag')
  keysAre(D.signedDoc, EXPECT.signedDoc, 'signedDoc'); sentinels(D.signedDoc, EXPECT.signedDoc.split(' '), 'signedDoc'); neverIn(D.signedDoc, 'signedDoc')
  check(V.poDetail(po, [], null).signedDoc === null && V.poDetail(po, undefined, undefined).lines.length === 0, 'poDetail: no lines, no document')

  // ITP: deleted requirements dropped, items projected
  const req = (id, del) => ({ ...fake(COLS.itp_requirements, 'created_by_name'), id, is_deleted: del,
    items: [fake(COLS.itp_items, 'actioned_by_name'), fake(COLS.itp_items, 'actioned_by_name')] })
  const I = V.itp([req(1, 0), req(2, 1), req(3, null), req(4, '1'), req(5, '0')])
  check(JSON.stringify(I.map(r => r.id)) === '[1,3,5]', 'itp: is_deleted 1 (number or string) dropped; 0, null kept')
  I.forEach(r => { keysAre(r, EXPECT.requirement, `itp requirement ${r.id}`); neverIn(r, `itp requirement ${r.id}`) })
  sentinels(I[0], EXPECT.requirement.split(' ').filter(k => k !== 'id' && k !== 'items'), 'itp requirement')
  check(I.every(r => r.items.length === 2 && r.items.every(it => JSON.stringify(Object.keys(it)) === JSON.stringify(EXPECT.item.split(' ')))), 'itp items: keys equal the allowlist')
  I[0].items.forEach((it, k) => { sentinels(it, EXPECT.item.split(' '), `itp item ${k}`); neverIn(it, `itp item ${k}`) })
  check(V.itp([{ id: 9, is_deleted: 0 }])[0].items.length === 0, 'itp: a requirement without items gets []')

  // variations and documents
  const vr = V.variations([fake(COLS.po_variations, 'requested_by_name approved_by_name')])
  keysAre(vr[0], EXPECT.variation, 'variation'); sentinels(vr[0], EXPECT.variation.split(' '), 'variation'); neverIn(vr[0], 'variation')
  const dr = V.documents([fake(COLS.po_documents, 'uploaded_by_name'), fake(COLS.po_documents, 'uploaded_by_name')])
  check(dr.length === 2, 'documents: every row'); dr.forEach((d, k) => { keysAre(d, EXPECT.document, `document ${k}`); neverIn(d, `document ${k}`) })
  sentinels(dr[0], EXPECT.document.split(' '), 'document')

  // pick: null for a missing key, a new object, never the row's other keys; frozen lists
  const p = V.pick({ a: 1, b: 2 }, ['a', 'c'])
  check(JSON.stringify(p) === '{"a":1,"c":null}' && p.c === null, 'pick: null for a missing key, nothing else')
  check(JSON.stringify(V.pick(null, ['a'])) === '{"a":null}', 'pick: a null row gives nulls')
  check(Object.values(V.KEYS).every(Object.isFrozen) && Object.isFrozen(V.KEYS), 'allowlists frozen')
  const input = { id: 1 }; const out = V.poListRow(input); out.zz = 1
  check(!('zz' in input), 'output is not the input object')
  check(JSON.stringify(V.variations(undefined)) === '[]' && JSON.stringify(V.documents(null)) === '[]' && JSON.stringify(V.itp(undefined)) === '[]', 'empty inputs give []')
  return { pass, fail, failed }
}

const MUTANTS = [
  ['pick spreads the row', s => s.replace('const out = {}', 'const out = { ...row }')],
  ['pick undefined for a missing key', s => s.replace('? row[k] : null', '? row[k] : undefined')],
  ['owner_name added to the list row', s => s.replace("'rag', 'line_count', 'created_at',\n])", "'rag', 'line_count', 'created_at', 'owner_name',\n])")],
  ['cdd dropped from the list row', s => s.replace("'ros_date', 'cdd', 'vendor_name'", "'ros_date', 'vendor_name'")],
  ['detail keeps rag', s => s.replace("['rag', 'line_count', 'created_at'].includes(k)", "['line_count', 'created_at'].includes(k)")],
  ['detail without contract_delivery_date', s => s.replace("), 'contract_delivery_date',\n])", "),\n])")],
  ['lines not projected', s => s.replace('lines: (lines || []).map(l => pick(l, PO_LINE))', 'lines: (lines || []).map(l => l)')],
  ['qty_allocated on lines', s => s.replace("'status', 'qty_received', 'received_to_date', 'remaining_qty',", "'status', 'qty_received', 'received_to_date', 'remaining_qty', 'qty_allocated',")],
  ['signedDoc not projected', s => s.replace('signedDoc: signedDoc ? pick(signedDoc, SIGNED_DOC) : null', 'signedDoc: signedDoc || null')],
  ['deleted ITP rows kept', s => s.replace('.filter(r => !Number(r.is_deleted))', '.filter(r => true)')],
  ['deleted check on truthiness only', s => s.replace('.filter(r => !Number(r.is_deleted))', '.filter(r => r.is_deleted !== 1)')],
  ['ITP items not projected', s => s.replace('items: (r.items || []).map(it => pick(it, ITP_ITEM))', 'items: r.items || []')],
  ['ITP notes shown', s => s.replace("'status', 'completion_date', 'completion_notes',\n])", "'status', 'completion_date', 'completion_notes', 'notes',\n])")],
  ['variation approver shown', s => s.replace("'status', 'reason', 'approved_at'])", "'status', 'reason', 'approved_at', 'approved_by_name'])")],
  ['document file_path shown', s => s.replace("'is_current', 'uploaded_at', 'uploaded_by_name'])", "'is_current', 'uploaded_at', 'uploaded_by_name', 'file_path'])")],
  ['documents not projected', s => s.replace('const documents = rows => (rows || []).map(r => pick(r, DOCUMENT))', 'const documents = rows => rows || []')],
  ['list not frozen', s => s.replace('const PO_LIST_ROW = Object.freeze([', 'const PO_LIST_ROW = ([')],
]

const r = suite(SOURCE)
r.failed.forEach(n => console.log('FAIL ' + n))
console.log(`vendorView: ${r.pass} passed, ${r.fail} failed`)
if (process.argv.includes('--mutation')) {
  let killed = 0
  for (const [name, mutate] of MUTANTS) {
    const m = mutate(SOURCE)
    if (m === SOURCE) { console.log(`mutant "${name}": NOT APPLIED`); continue }
    let res; try { res = suite(m) } catch (e) { res = { fail: 1 } }
    if (res.fail > 0) killed++; else console.log(`mutant "${name}": SURVIVED`)
  }
  console.log(`mutation: ${killed}/${MUTANTS.length} killed`)
  if (killed !== MUTANTS.length) process.exitCode = 1
}
if (r.fail) process.exitCode = 1
