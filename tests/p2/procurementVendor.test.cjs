// P2c — vendor scoping in server/routes/procurement.js: the real router (with its permission
// middleware) over a fake db. Vendors: own supplier's POs only, 1=0 without a supplier, list
// filters ignored, responses projected by lib/vendorView. Internal roles: every answer and every
// query identical to procurement.js at a4f82df (read with git show). No database.
// Exit code 1 on any failure. Usage: node tests/p2/procurementVendor.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const FILE = path.join(ROOT, 'routes/procurement.js')
const SOURCE = fs.readFileSync(FILE, 'utf8')
const BEFORE = execFileSync('git', ['-C', REPO, 'show', 'a4f82df:server/routes/procurement.js'], { encoding: 'utf8' })

// ── fake data ──
const PO_COLS = 'id project_id po_number po_name wbs_code group_category ros_date owner_id is_critical_path critical_path_set_by critical_path_set_at is_locked milestone_po_date milestone_fat_date milestone_esd_date milestone_eta_date milestone_ros_date vendor_name vendor_code supplier_id tender_id description value currency status expeditor_id expeditor_assigned_at expeditor_assigned_by pre_expediting_enabled rag incoterms handover_point inco_term_id warehouse_id contract_delivery_date estimated_delivery_date created_by created_at updated_at'.split(' ')
const poRow = (id, supplier) => ({ ...Object.fromEntries(PO_COLS.map(c => [c, 'S:' + c])), id, project_id: 27, supplier_id: supplier, status: 'approved', is_critical_path: 1, is_locked: 1,
  owner_name: 'Owner A', expeditor_name: 'Exp B', supplier_name: 'Supplier', supplier_code: 'SUP', wbs_name: 'WBS', expeditor_names_all: 'Exp B||Exp C' })
const POS = { 1: poRow(1, 5), 2: poRow(2, 9), 3: poRow(3, null) }
const LINE = c => ({ id: 70, po_id: 1, wbs_id: 3, line_number: 1, description: 'L', tag_number: 'T', qty: 2, uom: 'ea', cdd: c, uom_id: 1, qty_allocated: 1, qty_received: 0, unit_price: 5, total_price: 10,
  ros_date: '2026-12-01', heat_number_required: 1, supplier_name_snapshot: 'S', wbs_code_snapshot: 'W', insp_type: 'FAT', cert_required: 1, vdrl_required: 0, status: 'open', rag: 'red',
  created_at: 'x', updated_at: 'y', heat_number: 'H', forecast_ready_date: '2026-11-15', commodity_id: 4, equipment_tag: 'E', equipment_tag_ref: 'R', qty_assigned: 1, source_mto_line_id: 9,
  uom_code: 'EA', uom_name: 'each', received_to_date: 0, remaining_qty: 2 })
const LINES = [LINE('2026-11-01'), LINE('2026-10-20')]
const APPROVALS = [{ id: 1, po_id: 1, approver_id: 4, approval_level: 1, status: 'approved', comments: 'internal comment', actioned_at: 'x', created_at: 'y', approver_name: 'Approver' }]
const SIGNED = { id: 8, file_name: 'po.pdf', file_size_bytes: 10, mime_type: 'application/pdf', version: 1, uploaded_at: 'z', uploaded_by_name: 'Uploader' }
const REQS = [
  { id: 11, po_id: 1, description: 'R1', inspection_type: 'FAT', is_mandatory: 1, created_by: 4, created_at: 'x', item_number: '1', timing: 'pre', witness_required: 1, certificate_required: 1,
    planned_date: 'p', forecast_date: 'f', status: 'open', completion_date: null, completion_notes: 'done note', po_line_id: 70, is_deleted: 0, notes: 'internal note', created_by_name: 'Creator' },
  { id: 12, po_id: 1, description: 'R2 (deleted)', is_deleted: 1, notes: 'internal', created_by: 4, created_by_name: 'Creator' },
]
const ITEMS = [{ id: 21, requirement_id: 11, item_number: '1.1', description: 'I', status: 'open', actioned_by: 4, actioned_at: 'a', notes: 'internal', created_at: 'c', actioned_by_name: 'Actor' }]
const VARS = [{ id: 31, po_id: 1, variation_number: 'V1', reason: 'scope', value_impact: 100, schedule_impact_days: 5, requested_by: 4, approved_by: 4, status: 'approved', approved_at: 'a', created_at: 'c', updated_at: 'u', requested_by_name: 'Req', approved_by_name: 'App' }]
const DOCS = [{ id: 41, po_id: 1, doc_type: 'signed_po', file_name: 'po.pdf', file_path: '/srv/uploads/po.pdf', file_size_bytes: 10, mime_type: 'application/pdf', version: 1, is_current: 1, description: 'd', uploaded_by: 4, uploaded_at: 'z', uploaded_by_name: 'Uploader' }]
const LIST_ROW = id => ({ id, po_number: 'PO' + id, po_name: 'N', description: 'D', vendor_name: 'V', supplier_id: 5, currency: 'AUD', value: 1, incoterms: 'FOB', handover_point: 'H', wbs_code: 'W', status: 'approved',
  is_critical_path: 1, is_locked: 1, group_category: 'G', owner_id: 4, expeditor_id: 24, ros_date: 'r', created_at: 'c', owner_name: 'Owner A', expeditor_name: 'Exp B', expeditor_ids: '24,25',
  expeditor_names_all: 'Exp B||Exp C', supplier_name: 'Supplier', wbs_node_id: 3, wbs_name: 'WBS', line_count: 2, earliest_cdd: '2026-10-20', earliest_line_ros: 'x',
  milestone_po_date: 'a', milestone_fat_date: 'b', milestone_esd_date: 'c', milestone_eta_date: 'd', milestone_ros_date: 'e' })

let calls = []
const clone = x => JSON.parse(JSON.stringify(x))
const fakeDb = { query: async (sql, params = []) => {
  const q = sql.replace(/\s+/g, ' ').trim()
  calls.push({ q, params: clone(params) })
  if (/^SELECT can_view AS allowed FROM user_permission_overrides/.test(q)) return [[], []]
  if (/^SELECT can_view AS allowed FROM role_permissions/.test(q)) return [[{ allowed: 1 }], []]
  if (/^SELECT id FROM user_wbs_access/.test(q)) return [[{ id: 1 }], []]
  if (/^SELECT at_risk_days_threshold/.test(q)) return [[{ at_risk_days_threshold: 21, approval_threshold_1: null, approval_threshold_2: null }], []]
  if (/^SELECT project_id(, supplier_id)? FROM purchase_orders WHERE id = \?$/.test(q)) return [POS[params[0]] ? [{ project_id: 27, supplier_id: POS[params[0]].supplier_id }] : [], []]
  if (/^SELECT COUNT\(DISTINCT po\.id\) AS total/.test(q)) return [[{ total: 2 }], []]
  if (/^SELECT po\.id, po\.po_number/.test(q)) return [[LIST_ROW(1), LIST_ROW(4)], []]
  if (/^SELECT po\.\*, own\.full_name/.test(q)) return [POS[params[0]] ? [clone(POS[params[0]])] : [], []]
  if (/^SELECT l\.\*, u\.code AS uom_code/.test(q)) return [clone(LINES), []]
  if (/^SELECT a\.\*, u\.full_name AS approver_name/.test(q)) return [clone(APPROVALS), []]
  if (/^SELECT pd\.id, pd\.file_name/.test(q)) return [[clone(SIGNED)], []]
  if (/^SELECT i\.\*, u\.full_name AS created_by_name/.test(q)) return [clone(REQS), []]
  if (/^SELECT it\.\*, u\.full_name AS actioned_by_name/.test(q)) return [clone(ITEMS), []]
  if (/^SELECT v\.\*, u\.full_name AS requested_by_name/.test(q)) return [clone(VARS), []]
  if (/^SELECT pd\.\*, u\.full_name AS uploaded_by_name/.test(q)) return [clone(DOCS), []]
  throw new Error('unexpected query: ' + q.slice(0, 90))
} }
const dbPath = require.resolve(path.join(ROOT, 'db.js'))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb }

function compile(src) {
  const m = new Module(FILE, module); m.filename = FILE; m.paths = Module._nodeModulePaths(path.dirname(FILE)); m._compile(src, FILE); return m.exports
}
function call(router, user, url) {
  return new Promise(resolve => {
    const [p, qs] = url.split('?')
    const req = { method: 'GET', url, originalUrl: '/api/procurement' + url, headers: {}, query: Object.fromEntries(new URLSearchParams(qs || '')), user: { ...user }, body: {} }
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] },
      status(c) { this.statusCode = c; return this }, json(o) { resolve({ status: this.statusCode, body: clone(o === undefined ? null : o) }) }, send(o) { resolve({ status: this.statusCode, body: o }) } }
    router(req, res, err => resolve({ status: err ? 500 : 404, body: { fellThrough: true, err: err && err.message } }))
  })
}

const LIST_KEYS = 'id po_number po_name description currency value status statusLabel ros_date cdd vendor_name supplier_name incoterms handover_point wbs_code wbs_name group_category milestone_po_date milestone_fat_date milestone_esd_date milestone_eta_date milestone_ros_date rag line_count created_at'
const HEADER_KEYS = 'id po_number po_name description currency value status statusLabel ros_date cdd vendor_name supplier_name incoterms handover_point wbs_code wbs_name group_category milestone_po_date milestone_fat_date milestone_esd_date milestone_eta_date milestone_ros_date contract_delivery_date lines signedDoc'
const keys = o => JSON.stringify(Object.keys(o || {}))
const VENDOR = { id: 711, role: 'vendor', supplier_id: 5 }, UNLINKED = { id: 712, role: 'vendor', supplier_id: null }, NOKEY = { id: 713, role: 'vendor' }
const INTERNAL = [{ id: 4, role: 'admin' }, { id: 30, role: 'procurement_officer' }]
const FILTERS = '?supplier_id=9&is_critical_path=1&expeditor_id=33&wbs_id=44'

async function suite(src) {
  const R = compile(src)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const go = async (user, url) => { calls = []; return call(R, user, url) }
  const listCalls = () => calls.filter(c => /^SELECT (COUNT\(DISTINCT po\.id\)|po\.id, po\.po_number)/.test(c.q))
  const poTableQueries = () => calls.filter(c => /purchase_orders|po_lines|po_approvals|po_documents|itp_|po_variations/.test(c.q) && !/^SELECT project_id/.test(c.q))

  // ── linked vendor: list ──
  let r = await go(VENDOR, '/27/pos' + FILTERS)
  const [cnt, rows] = listCalls()
  check(r.status === 200 && rows && (rows.q.match(/po\.supplier_id = \?/g) || []).length === 1 && cnt.q.includes('po.supplier_id = ?'), 'vendor list: one po.supplier_id = ? in both queries')
  check(rows && rows.params[0] === 27 && rows.params[1] === 5 && !rows.params.includes(9) && !rows.params.includes(33) && !rows.params.includes(44), 'vendor list: supplier 5 bound, filter values not bound')
  check(rows && !/po\.is_critical_path = 1|po\.expeditor_id = \?|w\.id = \?/.test(rows.q), 'vendor list: critical path, expeditor and WBS filters ignored')
  check(keys(r.body) === '["data","total","page","limit"]', 'vendor list: no atRiskDays')
  check(r.body.data.length === 2 && r.body.data.every(d => keys(d) === JSON.stringify(LIST_KEYS.split(' '))), 'vendor list: rows projected to poListRow')
  check(r.body.data[0].cdd === '2026-10-20' && r.body.data[0].statusLabel !== undefined && typeof r.body.data[0].rag === 'string', 'vendor list: cdd, statusLabel and rag present')
  // ── vendors cannot sort by internal names (owner, expeditor): the default column instead ──
  const orderOf = () => ((listCalls()[1] || {}).q || '').match(/ORDER BY (\S+) (ASC|DESC), po\.id/)
  for (const sc of ['owner', 'expeditor']) {
    r = await go(VENDOR, `/27/pos?sort_col=${sc}&sort_dir=asc`)
    const o = orderOf()
    check(r.status === 200 && o && o[1] === 'po.created_at' && o[2] === 'ASC', `vendor list sort_col=${sc}: default column po.created_at`)
  }
  r = await go(VENDOR, '/27/pos?sort_col=po_number&sort_dir=asc')
  check(orderOf() && orderOf()[1] === 'po.po_number', 'vendor list: other sorts still apply')
  for (const [sc, col] of [['owner', 'own.full_name'], ['expeditor', 'exp.full_name']]) {
    r = await go(INTERNAL[1], `/27/pos?sort_col=${sc}`)
    check(orderOf() && orderOf()[1] === col, `internal list sort_col=${sc}: ${col} as before`)
  }
  // ── unlinked vendors: 1=0 ──
  for (const [name, u] of [['supplier_id null', UNLINKED], ['no supplier_id key', NOKEY]]) {
    r = await go(u, '/27/pos' + FILTERS)
    const [c2, r2] = listCalls()
    check(r.status === 200 && r2 && /\b1=0\b/.test(r2.q) && /\b1=0\b/.test(c2.q) && !r2.q.includes('po.supplier_id = ?') && !r2.params.includes(9), `vendor ${name} list: 1=0, no supplier filter`)
  }
  // ── linked vendor: own PO ──
  r = await go(VENDOR, '/pos/1')
  check(r.status === 200 && keys(r.body) === JSON.stringify(HEADER_KEYS.split(' ')), 'vendor detail: header, lines and signedDoc only')
  check(!calls.some(c => /po_approvals/.test(c.q)), 'vendor detail: approvals not queried')
  check(r.body.cdd === '2026-10-20' && r.body.statusLabel !== 'S:statusLabel' && r.body.lines.length === 2 && !('qty_allocated' in r.body.lines[0]) && r.body.signedDoc && !('uploaded_by' in r.body.signedDoc), 'vendor detail: cdd is the earliest line CDD; lines and document projected')
  r = await go(VENDOR, '/pos/1/itp')
  check(r.status === 200 && r.body.length === 1 && r.body[0].id === 11 && !('notes' in r.body[0]) && r.body[0].completion_notes === 'done note' && keys(r.body[0].items[0]) === '["id","item_number","description","status"]', 'vendor itp: deleted dropped, projected')
  r = await go(VENDOR, '/pos/1/variations')
  check(r.status === 200 && keys(r.body[0]) === '["id","variation_number","value_impact","schedule_impact_days","status","reason","approved_at"]', 'vendor variations projected')
  r = await go(VENDOR, '/pos/1/documents')
  check(r.status === 200 && !('file_path' in r.body[0]) && r.body[0].uploaded_by_name === 'Uploader', 'vendor documents projected (no file_path)')
  // ── another supplier's PO, a PO with no supplier, unlinked vendors: 403 ──
  for (const [u, id, name] of [[VENDOR, 2, 'other supplier'], [VENDOR, 3, 'PO without a supplier'], [UNLINKED, 1, 'unlinked vendor'], [UNLINKED, 3, 'unlinked vendor, PO without a supplier'], [NOKEY, 1, 'vendor without the key']]) {
    for (const sub of ['', '/itp', '/variations', '/documents', '/documents/41/download', '/notes', '/audit']) {
      r = await go(u, `/pos/${id}${sub}`)
      check(r.status === 403 && r.body.error === 'Access denied' && poTableQueries().length === 0, `${name}: /pos/${id}${sub} 403 Access denied, no PO data read`)
    }
  }
  r = await go(VENDOR, '/pos/99')
  check(r.status === 404 && r.body.error === 'PO not found', 'vendor, unknown PO: the handler 404 as before')
  return { pass, fail, failed, R }
}

// Internal roles: NEW against a4f82df, every answer and every query.
async function internalSame(src) {
  const N = compile(src), B = compile(BEFORE)
  let same = 0, total = 0; const diffs = []
  for (const u of INTERNAL) for (const url of ['/27/pos', '/27/pos' + FILTERS + '&sort_col=owner', '/pos/1', '/pos/2', '/pos/3', '/pos/99', '/pos/1/itp', '/pos/1/variations', '/pos/1/documents']) {
    calls = []; const n = await call(N, u, url); const nq = calls
    calls = []; const b = await call(B, u, url); const bq = calls
    total++
    if (JSON.stringify(n) === JSON.stringify(b) && JSON.stringify(nq) === JSON.stringify(bq)) same++; else diffs.push(`${u.role} ${url}`)
  }
  return { same, total, diffs }
}

const MUTANTS = [
  ['no 1=0 for unlinked vendors', s => s.replace("      else filters.push('1=0')\n", '')],
  ['no supplier filter', s => s.replace("if (req.user.supplier_id != null) { filters.push('po.supplier_id = ?'); params.push(Number(req.user.supplier_id)) }", 'if (false) {}')],
  ['supplier_id filter honoured', s => s.replace('if (supplier_id && !isVendor)', 'if (supplier_id)')],
  ['wbs_id filter honoured', s => s.replace('if (wbs_id && !isVendor)', 'if (wbs_id)')],
  ['critical path filter honoured', s => s.replace("if (is_critical_path === '1' && !isVendor)", "if (is_critical_path === '1')")],
  ['expeditor filter honoured', s => s.replace('if (expeditor_id && !isVendor)', 'if (expeditor_id)')],
  ['list not projected', s => s.replace('{ data: data.map(vendorView.poListRow), total', '{ data, total')],
  ['atRiskDays for vendors', s => s.replace('{ data: data.map(vendorView.poListRow), total: countRows[0].total, page, limit }', '{ data: data.map(vendorView.poListRow), total: countRows[0].total, page, limit, atRiskDays }')],
  ['guard: no null check', s => s.replace("  if (role === 'vendor' && req.user.supplier_id == null) return res.status(403).json({ error: 'Access denied' })\n", '')],
  ['guard: no supplier compare', s => s.replace("    if (role === 'vendor' && Number(po.supplier_id) !== Number(req.user.supplier_id)) return res.status(403).json({ error: 'Access denied' })\n", '')],
  ['approvals queried for vendors', s => s.replace('const [approvals] = isVendor ? [[]] : await db.query(', 'const [approvals] = await db.query(')],
  ['detail not projected', s => s.replace('    if (isVendor) {\n      return res.json(vendorView.poDetail(', '    if (false) {\n      return res.json(vendorView.poDetail(')],
  ['detail cdd missing', s => s.replace(', cdd: minCdd }, lines', ' }, lines')],
  ['itp not projected', s => s.replace("res.json(req.user.role === 'vendor' ? vendorView.itp(reqs) : reqs)", 'res.json(reqs)')],
  ['variations not projected', s => s.replace("res.json(req.user.role === 'vendor' ? vendorView.variations(rows) : rows)", 'res.json(rows)')],
  ['documents not projected', s => s.replace("res.json(req.user.role === 'vendor' ? vendorView.documents(docs) : docs)", 'res.json(docs)')],
  ['vendors may sort by owner or expeditor', s => s.replace("(isVendor && VENDOR_HIDDEN_SORTS.has(sort_col) ? undefined : SAFE_SORT[sort_col])", 'SAFE_SORT[sort_col]')],
  ['internal roles lose the owner sort', s => s.replace("(isVendor && VENDOR_HIDDEN_SORTS.has(sort_col) ? undefined : SAFE_SORT[sort_col])", "(VENDOR_HIDDEN_SORTS.has(sort_col) ? undefined : SAFE_SORT[sort_col])")],
  ['internal list loses atRiskDays', s => s.replace(': { data, total: countRows[0].total, page, limit, atRiskDays }', ': { data, total: countRows[0].total, page, limit }')],
]

;(async () => {
  const r = await suite(SOURCE)
  const I = await internalSame(SOURCE)
  r.failed.forEach(n => console.log('FAIL ' + n))
  I.diffs.forEach(d => console.log('FAIL internal differs from a4f82df: ' + d))
  const fail = r.fail + (I.same === I.total ? 0 : 1)
  console.log(`procurementVendor: ${r.pass + (I.same === I.total ? 1 : 0)} passed, ${fail} failed (internal roles identical to a4f82df on ${I.same} of ${I.total} requests, answers and queries)`)
  if (process.argv.includes('--mutation')) {
    let killed = 0
    for (const [name, mutate] of MUTANTS) {
      const m = mutate(SOURCE)
      if (m === SOURCE) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      let bad = false
      try { const s = await suite(m); const i = await internalSame(m); bad = s.fail > 0 || i.same !== i.total } catch (e) { bad = true }
      if (bad) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${MUTANTS.length} killed`)
    if (killed !== MUTANTS.length) process.exitCode = 1
  }
  if (fail) process.exitCode = 1
})()
