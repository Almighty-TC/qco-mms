// GET /api/foundational/:projectId/wbs/:nodeId/pos (server/routes/foundational.js) — the WBS Focus
// panel's PO list. The real router with a fake db that, like MySQL, refuses a column purchase_orders
// does not have (column list read from information_schema on 2026-10-16). Before the fix the query
// selected vendor and total_value, which do not exist. Exit code 1 on any failure.
// Usage: node tests/p2/foundationalPos.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ROOT = path.join(__dirname, '../../server')
const FILE = path.join(ROOT, 'routes/foundational.js')
const SOURCE = fs.readFileSync(FILE, 'utf8')
const PO_COLS = new Set('id project_id po_number po_name wbs_code group_category ros_date owner_id is_critical_path critical_path_set_by critical_path_set_at is_locked milestone_po_date milestone_fat_date milestone_esd_date milestone_eta_date milestone_ros_date vendor_name vendor_code supplier_id tender_id description value currency status expeditor_id expeditor_assigned_at expeditor_assigned_by pre_expediting_enabled rag incoterms handover_point inco_term_id warehouse_id contract_delivery_date estimated_delivery_date created_by created_at updated_at'.split(' '))

let calls = []
const NODES = { 2630: 'ZZ-1.2', 2631: 'ZZ-EMPTY' }
const fakeDb = { query: async (sql, params = []) => {
  const q = sql.replace(/\s+/g, ' ').trim()
  calls.push({ q, params })
  if (/^SELECT code FROM wbs_nodes WHERE id=\?$/.test(q)) return [NODES[params[0]] ? [{ code: NODES[params[0]] }] : [], []]
  const m = q.match(/^SELECT (.*) FROM purchase_orders WHERE/)
  if (m) {
    const cols = m[1].split(',').map(s => s.trim())
    for (const c of cols) {
      const src = c.split(/\s+AS\s+/i)[0].trim()
      if (!PO_COLS.has(src)) { const e = new Error(`Unknown column '${src}' in 'field list'`); e.code = 'ER_BAD_FIELD_ERROR'; e.errno = 1054; throw e }
    }
    if (params[1] === 'ZZ-EMPTY') return [[], []]
    const row = { id: 1, po_number: 'PO-1', vendor_name: 'Vendor A', status: 'approved', value: 1000, currency: 'AUD' }
    const out = cols.map(c => { const [src, alias] = c.split(/\s+AS\s+/i).map(s => s.trim()); return [alias || src, row[src] ?? null] })
    return [[Object.fromEntries(out), { ...Object.fromEntries(out), id: 2, po_number: 'PO-2' }], []]
  }
  if (/^SELECT can_view AS allowed/.test(q)) return [[{ allowed: 1 }], []]
  throw new Error('unexpected query: ' + q.slice(0, 80))
} }
const dbPath = require.resolve(path.join(ROOT, 'db.js'))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb }
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'))
const { JWT_SECRET } = require(path.join(ROOT, 'middleware/auth'))
const token = role => 'Bearer ' + jwt.sign({ id: role === 'admin' ? 4 : 24, role }, JWT_SECRET, { expiresIn: '10m' })

function compile(src) {
  const m = new Module(FILE, module); m.filename = FILE; m.paths = Module._nodeModulePaths(path.dirname(FILE)); m._compile(src, FILE); return m.exports
}
const call = (router, role, url) => new Promise(resolve => {
  const req = { method: 'GET', url, originalUrl: '/api/foundational' + url, headers: { authorization: token(role) }, query: {}, body: {} }
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] },
    status(c) { this.statusCode = c; return this }, json(o) { resolve({ status: this.statusCode, body: o }) }, send(o) { resolve({ status: this.statusCode, body: o }) } }
  router(req, res, err => resolve({ status: err ? 500 : 404, body: { fellThrough: true } }))
})

async function suite(src) {
  const R = compile(src)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  for (const role of ['admin', 'project_manager']) {
    calls = []
    const r = await call(R, role, '/27/wbs/2630/pos')
    const q = calls.find(c => c.q.includes('FROM purchase_orders'))
    check(r.status === 200, `${role}: 200 (no unknown column)`)
    check(Array.isArray(r.body) && r.body.length === 2 && r.body.every(x => JSON.stringify(Object.keys(x)) === '["id","po_number","vendor","status","total_value","currency"]'), `${role}: keys id, po_number, vendor, status, total_value, currency`)
    check(Array.isArray(r.body) && r.body[0].vendor === 'Vendor A' && r.body[0].total_value === 1000, `${role}: vendor from vendor_name, total_value from value`)
    check(q && /WHERE project_id=\? AND wbs_code=\? ORDER BY po_number$/.test(q.q) && JSON.stringify(q.params) === '[27,"ZZ-1.2"]', `${role}: same WHERE, order and parameters`)
  }
  let r = await call(R, 'admin', '/27/wbs/2631/pos')
  check(r.status === 200 && Array.isArray(r.body) && r.body.length === 0, 'a node with no POs: []')
  r = await call(R, 'admin', '/27/wbs/9999/pos')
  check(r.status === 404 && r.body.error === 'Node not found', 'an unknown node: 404 as before')
  return { pass, fail, failed }
}

const MUTANTS = [
  ['the old columns', s => s.replace('SELECT id, po_number, vendor_name AS vendor, status, value AS total_value, currency', 'SELECT id, po_number, vendor, status, total_value, currency')],
  ['no vendor alias', s => s.replace('vendor_name AS vendor,', 'vendor_name,')],
  ['no total_value alias', s => s.replace('value AS total_value,', 'value,')],
  ['order changed', s => s.replace("WHERE project_id=? AND wbs_code=?\n       ORDER BY po_number`", "WHERE project_id=? AND wbs_code=?\n       ORDER BY id`")],
]

;(async () => {
  const r = await suite(SOURCE)
  r.failed.forEach(n => console.log('FAIL ' + n))
  console.log(`foundationalPos: ${r.pass} passed, ${r.fail} failed`)
  if (process.argv.includes('--mutation')) {
    let killed = 0
    for (const [name, mutate] of MUTANTS) {
      const m = mutate(SOURCE)
      if (m === SOURCE) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      let res; try { res = await suite(m) } catch (e) { res = { fail: 1 } }
      if (res.fail > 0) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${MUTANTS.length} killed`)
    if (killed !== MUTANTS.length) process.exitCode = 1
  }
  if (r.fail) process.exitCode = 1
})()
