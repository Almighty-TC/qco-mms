// 3T169 — contractor WBS scoping: server/lib/wbsGrant.js (grants, covers, isNarrowed) and its use for
// site_contractor and subcontractor in materialcontrol.js (stock list and stat cards, FMR list and counts, FMR
// detail, item picker), foundational.js (WBS tree) and traceability.js (heat-status, heat detail); the
// POST /api/admin/wbs-access validation; 3T170: the FMR detail's lines and the list's line values for covered lines only,
// and the FMR create check through the helper; 3T171: no pickups for an FMR with hidden lines, quantities as strings;
// 3T174: the FMR list's wbs_scopes for contractors only (internal roles, vendor and forwarder also equal to e2a5a63). Grants ALL, one code, two codes, an underscore code (LIKE escaping); the
// dot boundary (FLO.01 does not cover FLO.010). Internal roles, vendors and forwarders: answers and queries equal to
// the files at c99b441 (git show). The real routers over a fake db that evaluates the WHERE conditions itself (no
// database). Exit code 1 on any failure.
// Usage: node tests/p2/wbsGrant.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const BASE = 'c99b441'   // the files before 3T169
const F = { grant: 'lib/wbsGrant.js', mc: 'routes/materialcontrol.js', fd: 'routes/foundational.js', tr: 'routes/traceability.js', ad: 'routes/admin.js' }
const SRC = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, fs.readFileSync(path.join(ROOT, f), 'utf8')]))
const OLD = Object.fromEntries(['mc', 'fd', 'tr'].map(k => [k, execFileSync('git', ['-C', REPO, 'show', `${BASE}:server/${F[k]}`], { encoding: 'utf8' })]))
const MC_E2A = execFileSync('git', ['-C', REPO, 'show', 'e2a5a63:server/routes/materialcontrol.js'], { encoding: 'utf8' })   // 3T174: the file before wbs_scopes

// ── fake data, project 27 (and a few rows in project 28) ──
const NODES = [[1, 'FLO', null], [2, 'FLO.01', 1], [3, 'FLO.01.02', 2], [4, 'FLO.010', 1], [5, 'FLO.02', 1], [6, 'GRD', null], [7, 'GRD.01', 6],
  [8, 'GRD_X', null], [9, 'GRD_X.01', 8], [10, 'GRDYX', null], [11, 'GRDYX.01', 10]].map(([id, code, parent_id]) => ({ id, project_id: 27, code, parent_id, description: 'Node ' + code, owner_id: null }))
NODES.push({ id: 20, project_id: 28, code: 'FLO.01', parent_id: null, description: 'Other project', owner_id: null })
const STOCK = [[1, 'FLO.01', 'H1'], [2, 'FLO.01.02', 'H1'], [3, 'FLO.010', 'H2'], [4, 'FLO.02', 'H3', { qty_available: 0 }], [5, 'GRD.01', 'H4', { condition_status: 'quarantine' }],
  [6, 'GRD_X.01', 'H5'], [7, 'GRDYX.01', 'H6'], [8, null, 'H7'], [9, 'FLO.01', 'H1', { project_id: 28 }]].map(([id, wbs_code, heat_number, o]) => ({ id, project_id: 27, warehouse_id: 1, item_code: 'I' + id,
  description: 'Item ' + id, wbs_code, qty: 10, qty_available: 5, condition_status: 'good', trace_hold: 0, location_code: 'L' + id, hold_reason: null, vendor_name: 'V', heat_number, additional_item_id: null, ...o }))
const FMRS = [[1, 'FLO.01'], [2, 'GRD.01', { status: 'issued' }], [3, 'FLO.010'], [4, 'GRD.01'], [5, 'GRDYX.01'], [6, 'FLO.01', { project_id: 28 }]].map(([id, wbs_code, o]) => ({ id, project_id: 27, warehouse_id: 1,
  fmr_ref: 'FMR-' + id, item_code: 'I' + id, description: 'FMR ' + id, wbs_code, status: 'pending_approval', required_date: '2026-11-01', requested_by_name: 'R', requested_by_company: null, requested_by_user: 693, ...o }))
const LINES = [[1, 1, 'FLO.01', 1], [2, 1, 'GRD.01', 2], [3, 2, 'GRD.01'], [4, 3, 'FLO.010'], [5, 4, 'GRD.01'], [6, 4, 'FLO.01.02'], [7, 5, 'GRDYX.01'], [8, 6, 'FLO.01'], [9, 1, 'FLO.010']]
  .map(([id, fmr_id, wbs_code, package_id]) => ({ id, fmr_id, wbs_code, item_code: id === 6 ? 'I2' : 'L' + id, description: 'Line ' + id, qty_requested: id * 10, qty_approved: id, qty_issued: id === 1 ? 4 : 0, uom: 'EA' + id, line_status: 'pending', package_id: package_id || null }))
const PACKAGES = [{ id: 1, fmr_id: 1 }, { id: 2, fmr_id: 1 }, { id: 3, fmr_id: 1 }]   // 1: line 1's, 2: line 2's (GRD.01), 3: no line
const PICKUPS = [{ id: 1, fmr_id: 1, qty_issued: '4.000' }, { id: 2, fmr_id: 4, qty_issued: '0.000' }]   // request-level: no line link
for (const f of FMRS) { const ls = LINES.filter(l => l.fmr_id === f.id); Object.assign(f, { item_code: ls[0].item_code, description: ls[0].description, uom: ls[0].uom, qty_requested: ls.reduce((s, l) => s + l.qty_requested, 0), qty_issued: ls.reduce((s, l) => s + l.qty_issued, 0), approved_qty: f.id === 1 ? ls.reduce((s, l) => s + l.qty_approved, 0) : null }) }
const CERTS = [[1, 'H1', 'verified'], [2, 'h2 ', 'pending'], [3, 'H3', 'rejected'], [4, 'H4', 'verified'], [5, 'H5', 'verified'], [6, 'H6', 'verified'], [7, 'H7', 'verified'], [8, 'H9', 'pending']].map(([id, heat_ref, status]) => ({ id, project_id: 27, heat_ref, status, category: 'approval' }))
const ISSUES = [[1, 1, 'H1', 'FLO.01'], [2, 2, 'H1', 'GRD.01'], [3, 6, 'H1', 'FLO.01']].map(([id, fmr_id, heat_number, wbs_code]) => ({ id, fmr_id, heat_number, wbs_code, qty: 1 }))
const TRANSFERS = [[1, 'H1', 'FLO.01.02'], [2, 'H1', 'GRD.01'], [3, 'H1', 'FLO.01', 28]].map(([id, heat_number, wbs_code, p]) => ({ id, project_id: p || 27, transfer_ref: 'T' + id, heat_number, wbs_code, qty: 1 }))
let GRANTS = {}                                  // user id → list of wbs_code rows on project 27
const ADMIN_GRANTS = []                          // rows inserted by POST /wbs-access in this run
const USERS = new Set([4, 24, 711, 685, 713, 714, 801])
const PROJECTS = new Set([27, 28])

// ── a small WHERE evaluator ──
const norm = s => s.replace(/--[^\n]*\n/g, ' ').replace(/\s+/g, ' ').trim()
const qmarks = s => (s.match(/\?/g) || []).length
function splitTop(s, sep) {
  const out = []; let depth = 0, cur = '', inQ = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === "'") inQ = !inQ
    if (!inQ) { if (ch === '(') depth++; else if (ch === ')') depth-- }
    if (!inQ && depth === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue }
    cur += ch
  }
  out.push(cur); return out.map(x => x.trim())
}
const wrapped = c => { if (!c.startsWith('(') || !c.endsWith(')')) return false; let d = 0; for (let i = 0; i < c.length - 1; i++) { if (c[i] === '(') d++; else if (c[i] === ')') d--; if (d === 0) return false } return true }
const up = v => String(v ?? '').trim().toUpperCase()
function likeRe(p, esc) {
  let r = ''
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]
    if (esc && ch === '!') { r += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue }
    r += ch === '%' ? '.*' : ch === '_' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + r + '$', 's')
}
const col = (row, c) => row[c.replace(/^\w+\./, '')]
function evalCond(c, row, ps) {
  if (wrapped(c)) {
    const parts = splitTop(c.slice(1, -1), ' OR ')
    if (parts.length > 1) { let i = 0; return parts.some(p => { const n = qmarks(p), r = evalCond(p, row, ps.slice(i, i + n)); i += n; return r }) }
    return evalWhere(c.slice(1, -1), row, ps)
  }
  if (c === '1=1') return true
  if (c === '1=0') return false
  let m
  if ((m = c.match(/^EXISTS \(SELECT 1 FROM fmr_lines l WHERE l\.fmr_id=f\.id AND (.*)\)$/))) return LINES.filter(l => l.fmr_id === row.id).some(l => evalWhere(m[1], l, ps))
  if ((m = c.match(/^UPPER\(TRIM\(([\w.]+)\)\) IN \(SELECT UPPER\(TRIM\(s\.heat_number\)\) FROM warehouse_stock s WHERE (.*)\)$/))) {
    const heats = new Set(STOCK.filter(s => evalWhere(m[2], s, ps)).map(s => up(s.heat_number))); return heats.has(up(col(row, m[1])))
  }
  if ((m = c.match(/^UPPER\(TRIM\(([\w.]+)\)\) = UPPER\(TRIM\(\?\)\)$/))) return up(col(row, m[1])) === up(ps[0])
  if ((m = c.match(/^([\w.]+) ?= ?\?$/))) { const v = col(row, m[1]); return v != null && String(v) === String(ps[0]) }
  if ((m = c.match(/^([\w.]+) LIKE \?( ESCAPE '!')?$/))) { const v = col(row, m[1]); return v != null && likeRe(String(ps[0]), !!m[2]).test(String(v)) }
  if ((m = c.match(/^([\w.]+) IS NOT NULL$/))) return col(row, m[1]) != null
  if ((m = c.match(/^TRIM\(([\w.]+)\)<>''$/))) return String(col(row, m[1]) ?? '').trim() !== ''
  if ((m = c.match(/^([\w.]+) (NOT )?IN \(([^?()]*)\)$/))) { const list = m[3].split(',').map(x => x.trim().replace(/'/g, '')); const inn = list.includes(col(row, m[1])); return m[2] ? !inn : inn }
  if ((m = c.match(/^([\w.]+) > 0$/))) return Number(col(row, m[1])) > 0
  if ((m = c.match(/^([\w.]+) != '(\w+)'$/))) return col(row, m[1]) !== m[2]
  throw new Error('unexpected condition: ' + c)
}
function evalWhere(where, row, params) {
  const conds = splitTop(where, ' AND '); let i = 0, ok = true
  for (const c of conds) { const n = qmarks(c); if (!evalCond(c, row, params.slice(i, i + n))) ok = false; i += n }
  return ok
}
const sel = (rows, where, params) => rows.filter(r => evalWhere(where, r, params))

let calls = []
const fakeDb = { query: async (sql, params = []) => {
  const q = norm(sql)
  calls.push({ q, params })
  let m
  if (/^SELECT \w+ AS allowed FROM user_permission_overrides/.test(q)) return [[], []]
  if (/^SELECT \w+ AS allowed FROM role_permissions/.test(q)) return [[{ allowed: 1 }], []]
  if (/^SELECT id FROM user_wbs_access WHERE user_id = \? AND project_id = \? LIMIT 1$/.test(q)) return [Number(params[1]) === 27 && (GRANTS[params[0]] || []).length ? [{ id: 1 }] : [], []]
  if (/^SELECT wbs_code FROM user_wbs_access WHERE user_id=\? AND project_id=\?$/.test(q)) return [Number(params[1]) === 27 ? [...(GRANTS[params[0]] || []), ...ADMIN_GRANTS.filter(g => g.user_id === Number(params[0]) && g.project_id === Number(params[1])).map(g => g.wbs_code)].map(wbs_code => ({ wbs_code })) : [], []]
  if (/^SELECT COUNT\(\*\) AS n FROM information_schema\.columns/.test(q)) return [[{ n: 0 }], []]
  // stock
  if ((m = q.match(/^SELECT COUNT\(\*\) AS total FROM warehouse_stock s WHERE (.*)$/))) return [[{ total: sel(STOCK, m[1], params).length }], []]
  if ((m = q.match(/^SELECT s\.\*, \(s\.additional_item_id IS NOT NULL\) AS is_child, .* FROM warehouse_stock s JOIN warehouses w ON s\.warehouse_id = w\.id WHERE (.*) ORDER BY .* LIMIT \? OFFSET \?$/))) {
    const [limit, offset] = params.slice(-2)
    return [sel(STOCK, m[1], params.slice(0, -2)).sort((a, b) => a.id - b.id).slice(offset, offset + limit).map(s => ({ ...s, is_child: 0, warehouse_name: 'W1', warehouse_code: 'W1' })), []]
  }
  if ((m = q.match(/^SELECT COUNT\(\*\) AS total_items, .* FROM warehouse_stock s WHERE (.*)$/))) { const r = sel(STOCK, m[1], params); return [[{ total_items: r.length, warehouse_count: r.length ? 1 : 0, trace_hold_count: 0, condition_issues: r.filter(s => s.condition_status !== 'good').length }], []] }
  // FMR list, counts, detail
  if ((m = q.match(/^SELECT COUNT\(\*\) AS total FROM fmr_requests f WHERE (.*)$/))) return [[{ total: sel(FMRS, m[1], params).length }], []]
  if ((m = q.match(/^SELECT f\.\*, w\.code AS warehouse_code, w\.name AS warehouse_name, \(SELECT COUNT\(\*\) FROM fmr_lines WHERE fmr_id=f\.id\) AS line_count, .* FROM fmr_requests f LEFT JOIN warehouses w ON w\.id = f\.warehouse_id WHERE (.*) ORDER BY .* LIMIT \? OFFSET \?$/))) {
    const [limit, offset] = params.slice(-2)
    const soh = code => STOCK.filter(s => s.item_code === code && s.project_id === 27 && s.condition_status === 'good' && s.trace_hold === 0).reduce((s, x) => s + x.qty_available, 0)
    return [sel(FMRS, m[1], params.slice(0, -2)).sort((a, b) => a.id - b.id).slice(offset, offset + limit).map(f => ({ ...f, warehouse_code: 'W1', warehouse_name: 'W1', line_count: LINES.filter(l => l.fmr_id === f.id).length,
      total_qty_requested: String(LINES.filter(l => l.fmr_id === f.id).reduce((s, l) => s + l.qty_requested, 0)), stock_on_hand: String(soh(f.item_code)) })), []]
  }
  if ((m = q.match(/^SELECT COUNT\(\*\) AS total, SUM\(CASE WHEN status='pending_approval' .* FROM fmr_requests(?: f)? WHERE (.*)$/))) { const r = sel(FMRS, m[1], params); return [[{ total: r.length, active_count: r.filter(f => f.status === 'pending_approval').length }], []] }
  if (/^SELECT f\.\*, w\.code AS warehouse_code, w\.name AS warehouse_name FROM fmr_requests f LEFT JOIN warehouses w ON w\.id=f\.warehouse_id WHERE f\.id=\? AND f\.project_id=\?$/.test(q)) { const f = FMRS.find(x => x.id === params[0] && x.project_id === params[1]); return [f ? [{ ...f, warehouse_code: 'W1' }] : [], []] }
  if ((m = q.match(/^SELECT f\.id FROM fmr_requests f WHERE (.*)$/))) return [sel(FMRS, m[1], params).map(f => ({ id: f.id })), []]
  if (/^SELECT id, item_id, item_code, item_type, description, wbs_code, .* FROM fmr_lines WHERE fmr_id=\? ORDER BY id$/.test(q)) return [LINES.filter(l => l.fmr_id === params[0]).map(({ fmr_id, ...l }) => ({ ...l })), []]
  if (/^SELECT fmr_id, item_code, description, wbs_code, qty_requested, qty_approved, qty_issued, uom FROM fmr_lines WHERE fmr_id IN \(\?\) ORDER BY fmr_id, id$/.test(q)) return [LINES.filter(l => params[0].includes(l.fmr_id)).sort((a, b) => a.fmr_id - b.fmr_id || a.id - b.id).map(l => ({ fmr_id: l.fmr_id, item_code: l.item_code, description: l.description, wbs_code: l.wbs_code, qty_requested: l.qty_requested, qty_approved: l.qty_approved, qty_issued: l.qty_issued, uom: l.uom })), []]
  if (/^SELECT item_code, COALESCE\(SUM\(qty_available\),0\) AS q FROM warehouse_stock WHERE project_id=\? AND condition_status='good' AND trace_hold=0 AND item_code IN \(\?\) GROUP BY item_code$/.test(q)) {
    const g = {}; for (const s of STOCK) if (s.project_id === params[0] && s.condition_status === 'good' && s.trace_hold === 0 && params[1].includes(s.item_code)) g[s.item_code] = (g[s.item_code] || 0) + s.qty_available
    return [Object.entries(g).map(([item_code, q]) => ({ item_code, q: String(q) })), []]
  }
  if (/FROM fmr_packages p /.test(q)) return [PACKAGES.filter(p => p.fmr_id === params[0]).map(p => ({ id: p.id, package_number: 'P' + p.id })), []]
  if (/FROM fmr_pickups pk /.test(q)) return [PICKUPS.filter(p => p.fmr_id === params[0]).map(p => ({ ...p })), []]
  if (/FROM fmr_issue_lines WHERE fmr_id=\? GROUP BY/.test(q)) return [[], []]
  // FMR create
  if (/^SELECT COALESCE\(MAX\(id\),0\) AS maxId FROM fmr_requests WHERE project_id=\?$/.test(q)) return [[{ maxId: 6 }], []]
  if (/^INSERT INTO fmr_requests /.test(q)) return [{ insertId: 700 }, undefined]
  if (/^INSERT INTO fmr_lines /.test(q)) return [{ insertId: 800 }, undefined]
  if (/^SELECT \* FROM fmr_requests WHERE id=\?$/.test(q)) return [[{ id: params[0], fmr_ref: 'FMR-NEW' }], []]
  // item picker
  if ((m = q.match(/^SELECT s\.id AS item_id, .* FROM warehouse_stock s LEFT JOIN warehouses w ON w\.id = s\.warehouse_id LEFT JOIN equipment_list e ON .* WHERE (.*) ORDER BY s\.warehouse_id, s\.item_code$/))) return [sel(STOCK, m[1], params).map(s => ({ item_id: s.id, wbs_code: s.wbs_code })), []]
  // WBS tree
  if ((m = q.match(/^SELECT w\.\*, u\.full_name AS owner_name, .* WHERE (w\.project_id = \?.*) ORDER BY w\.code$/))) return [sel(NODES, m[1], params).sort((a, b) => a.code.localeCompare(b.code)).map(n => ({ ...n, owner_name: null, po_qty: 0 })), []]
  // heats
  if ((m = q.match(/^SELECT UPPER\(TRIM\(c\.heat_ref\)\) AS heat_key, .* FROM traceability_certs c WHERE (.*) GROUP BY UPPER\(TRIM\(c\.heat_ref\)\)$/))) {
    const g = {}; for (const c of sel(CERTS, m[1], params)) { const k = up(c.heat_ref); (g[k] = g[k] || []).push(c) }
    return [Object.entries(g).map(([heat_key, cs]) => ({ heat_key, verified: cs.filter(c => c.status === 'verified').length, rejected: cs.filter(c => c.status === 'rejected').length, pending: cs.filter(c => c.status === 'pending').length, cert_count: cs.length, active_holds: 0 })), []]
  }
  if ((m = q.match(/^SELECT s\.id FROM warehouse_stock s WHERE (.*) LIMIT 1$/))) return [sel(STOCK, m[1], params).slice(0, 1).map(s => ({ id: s.id })), []]
  if ((m = q.match(/^SELECT id AS cert_id, category, .* FROM traceability_certs WHERE (.*) ORDER BY id$/))) return [sel(CERTS, m[1], params).map(c => ({ cert_id: c.id, heat_ref: c.heat_ref, status: c.status })), []]
  if (/FROM traceability_holds WHERE project_id=\? AND related_cert_id IN/.test(q)) return [[], []]
  if ((m = q.match(/^SELECT s\.id AS stock_id, .* FROM warehouse_stock s LEFT JOIN warehouses w ON w\.id=s\.warehouse_id WHERE (.*) ORDER BY s\.id$/))) return [sel(STOCK, m[1], params).map(s => ({ stock_id: s.id, location_code: s.location_code, wbs: s.wbs_code })), []]
  if ((m = q.match(/^SELECT fil\.id, .* FROM fmr_issue_lines fil JOIN fmr_requests f ON f\.id=fil\.fmr_id WHERE (.*) ORDER BY fil\.id$/))) {
    const rows = ISSUES.map(i => ({ ...i, project_id: FMRS.find(f => f.id === i.fmr_id).project_id }))
    return [sel(rows, m[1], params).map(i => ({ id: i.id, wbs_code: i.wbs_code })), []]
  }
  if ((m = q.match(/^SELECT id, transfer_ref, .* FROM warehouse_transfers WHERE (.*) ORDER BY id$/))) return [sel(TRANSFERS, m[1], params).map(t => ({ id: t.id, wbs_code: t.wbs_code })), []]
  // admin
  if (/^SELECT id FROM users WHERE id=\?$/.test(q)) return [USERS.has(Number(params[0])) ? [{ id: Number(params[0]) }] : [], []]
  if (/^SELECT id FROM projects WHERE id=\?$/.test(q)) return [PROJECTS.has(Number(params[0])) ? [{ id: Number(params[0]) }] : [], []]
  if (/^SELECT id FROM wbs_nodes WHERE project_id=\? AND code=\? LIMIT 1$/.test(q)) { const n = NODES.find(x => x.project_id === Number(params[0]) && x.code === params[1]); return [n ? [{ id: n.id }] : [], []] }
  if (/^INSERT INTO user_wbs_access /.test(q)) {
    const [user_id, project_id, wbs_code] = params
    if ([...(Number(project_id) === 27 ? GRANTS[user_id] || [] : []), ...ADMIN_GRANTS.filter(g => g.user_id === Number(user_id) && g.project_id === Number(project_id)).map(g => g.wbs_code)].includes(wbs_code)) { const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e }
    ADMIN_GRANTS.push({ user_id: Number(user_id), project_id: Number(project_id), wbs_code }); return [{ insertId: 950 + ADMIN_GRANTS.length }, undefined]
  }
  if (/^SELECT \* FROM user_wbs_access WHERE id=\?$/.test(q)) return [[{ id: params[0] }], []]
  if (/^INSERT INTO audit_log /.test(q)) return [{ insertId: 1 }, undefined]
  throw new Error('unexpected query: ' + q.slice(0, 140))
} }

// ── stubs, compile, call ──
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve(path.join(ROOT, 'db.js')), fakeDb)
const fakeMulter = () => ({ single: () => (req, res, next) => next(), array: () => (req, res, next) => next(), fields: () => (req, res, next) => next(), any: () => (req, res, next) => next() })
fakeMulter.memoryStorage = () => ({}); fakeMulter.diskStorage = () => ({}); fakeMulter.MulterError = class extends Error {}
stub(require.resolve('multer', { paths: [ROOT] }), fakeMulter)
stub(require.resolve(path.join(ROOT, 'lib/blobStore.js')), { CONTAINER: 'c', isEnabled: () => false, putFile: async () => null, keyFor: (mm, p) => `${mm}/${path.basename(String(p))}`, getFile: async () => null, persist: async o => ({ value: o.diskValue, where: 'disk' }) })
stub(require.resolve(path.join(ROOT, 'lib/schemaColumns.js')), { fileColumns: async () => new Set(), fileColumnsReady: async () => true })
stub(require.resolve('@azure/storage-blob', { paths: [ROOT] }), { BlobServiceClient: { fromConnectionString: () => ({ getContainerClient: () => ({}) }) } })
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'))
const { JWT_SECRET } = require(path.join(ROOT, 'middleware/auth'))
function compileAt(rel, src) {
  const file = path.join(ROOT, rel), m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(src, file); return m.exports
}
function load(srcs) {   // the grant helper first (the routers require it at compile time), then the routers
  stub(path.join(ROOT, F.grant), compileAt(F.grant, srcs.grant))
  return { grant: require.cache[path.join(ROOT, F.grant)].exports, mc: compileAt(F.mc, srcs.mc), fd: compileAt(F.fd, srcs.fd), tr: compileAt(F.tr, srcs.tr), ad: srcs.ad ? compileAt(F.ad, srcs.ad) : null }
}
function call(router, base, user, method, url, body) {
  return new Promise(resolve => {
    const [, qs] = url.split('?')
    const req = { method, url, originalUrl: base + url, headers: { authorization: 'Bearer ' + jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '10m' }) },
      query: Object.fromEntries(new URLSearchParams(qs || '')), body: body || {}, ip: '127.0.0.1' }
    if (base === '/api/admin') req.user = { id: user.id, role: user.role }
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] },
      status(c) { this.statusCode = c; return this }, json(o) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(o ?? null)) }) },
      send(b) { resolve({ status: this.statusCode, body: b }) }, end(b) { resolve({ status: this.statusCode, body: String(b) }) } }
    router(req, res, err => resolve({ status: err ? 500 : 404, body: { fellThrough: true, err: err && err.message } }))
  })
}
const SC = { id: 713, role: 'site_contractor' }, SUB = { id: 714, role: 'subcontractor' }
const ids = (arr, key = 'id') => JSON.stringify((arr || []).map(x => x[key]).sort((a, b) => a - b))

async function suite(srcs) {
  const R = load(srcs), G = R.grant
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  // ── the helper ──
  check(['site_contractor', 'subcontractor'].every(G.isNarrowed) && !['vendor', 'freight_forwarder', 'admin', 'project_manager', 'materials_engineer', undefined].some(G.isNarrowed), 'isNarrowed: the two contractor roles only')
  let cv = G.covers('x.c', { all: true, codes: ['A'] }); check(cv.sql === '1=1' && cv.params.length === 0, 'covers: ALL is 1=1')
  cv = G.covers('x.c', { all: false, codes: [] }); check(cv.sql === '1=0' && cv.params.length === 0, 'covers: no grant is 1=0')
  cv = G.covers('x.c', { all: false, codes: ['FLO.01', 'GRD'] })
  check(cv.sql === "((x.c = ? OR x.c LIKE ? ESCAPE '!') OR (x.c = ? OR x.c LIKE ? ESCAPE '!'))" && JSON.stringify(cv.params) === '["FLO.01","FLO.01.%","GRD","GRD.%"]', 'covers: one (col = ? OR col LIKE ? ESCAPE \'!\') per code, the dot boundary')
  cv = G.covers('x.c', { all: false, codes: ['A_B%!'] }); check(JSON.stringify(cv.params) === '["A_B%!","A!_B!%!!.%"]', 'covers: LIKE wildcards escaped with !')
  GRANTS = { 713: ['FLO.01', 'ALL', 'FLO.01'] }; let g = await G.grants(fakeDb, 713, 27)
  check(g.all === true && JSON.stringify(g.codes) === '["FLO.01"]', 'grants: ALL detected, codes de-duplicated')
  GRANTS = {}; g = await G.grants(fakeDb, 713, 27); check(g.all === false && g.codes.length === 0, 'grants: no rows')
  // ── the routes, both roles, each grant ──
  const CASES = [
    ['ALL', ['ALL'], { stock: [1, 2, 3, 4, 5, 6, 7, 8], fmr: [1, 2, 3, 4, 5], items: [1, 2, 3, 6, 7, 8], wbs: NODES.filter(n => n.project_id === 27).map(n => n.id), heats: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H9'], H1: { stock: [1, 2], issues: [1, 2], transfers: [1, 2] }, open: [1, 3, 4, 5], H9: true }],
    ['FLO.01', ['FLO.01'], { stock: [1, 2], fmr: [1, 4], items: [1, 2], wbs: [2, 3], heats: ['H1'], H1: { stock: [1, 2], issues: [1], transfers: [1] }, open: [1, 4] }],
    ['FLO.01 and GRD', ['FLO.01', 'GRD'], { stock: [1, 2, 5], fmr: [1, 2, 4], items: [1, 2], wbs: [2, 3, 6, 7], heats: ['H1', 'H4'], H1: { stock: [1, 2], issues: [1, 2], transfers: [1, 2] }, open: [1, 4] }],
    ['GRD_X (escaping)', ['GRD_X'], { stock: [6], fmr: [], items: [6], wbs: [8, 9], heats: ['H5'], H1: null, open: [] }],
  ]
  for (const u of [SC, SUB]) for (const [name, rows, want] of CASES) {
    GRANTS = { [u.id]: rows }
    const tag = `${u.role} ${name}`
    let r = await call(R.mc, '/api/mc', u, 'GET', '/27/stock?limit=1000')
    check(r.status === 200 && ids(r.body.data) === JSON.stringify(want.stock) && r.body.total === want.stock.length, `${tag}: stock list`)
    check(r.body.totals && r.body.totals.total_items === want.stock.length, `${tag}: stock stat cards under the grant`)
    check(u.role !== 'subcontractor' || r.body.data.every(s => s.location_code === null), `${tag}: subcontractor stock without location`)
    check(u.role !== 'site_contractor' || r.body.data.every(s => s.location_code !== null), `${tag}: site contractor stock keeps location`)
    check(JSON.stringify(r.body.wbs_scopes) === JSON.stringify(rows.includes('ALL') ? [] : rows), `${tag}: wbs_scopes`)
    r = await call(R.mc, '/api/mc', u, 'GET', '/27/fmr?view=all&limit=1000')
    check(r.status === 200 && ids(r.body.data) === JSON.stringify(want.fmr) && r.body.total === want.fmr.length && r.body.counts.total === want.fmr.length, `${tag}: FMR list (request's WBS or a line's), total and counts`)
    check(JSON.stringify(r.body.wbs_scopes) === JSON.stringify(rows.includes('ALL') ? [] : rows), `${tag}: FMR list wbs_scopes ${rows.includes('ALL') ? '[]' : JSON.stringify(rows)}, as the stock list`)
    r = await call(R.mc, '/api/mc', u, 'GET', '/27/fmr?limit=1000')
    check(ids(r.body.data) === JSON.stringify(want.open), `${tag}: FMR list, default view`)
    for (const f of [1, 2, 3, 4, 5, 6]) {
      r = await call(R.mc, '/api/mc', u, 'GET', `/27/fmr/${f}/detail`)
      const vis = want.fmr.includes(f)
      check(vis ? r.status === 200 && r.body.fmr.id === f : r.status === 404 && r.body.error === 'FMR not found', `${tag}: FMR ${f} detail ${vis ? '200' : '404'}`)
    }
    // 3T170: the detail shows the covered lines only; the header follows them when lines are hidden
    const LN = { ALL: { 1: [1, 2, 9], 4: [5, 6] }, 'FLO.01': { 1: [1], 4: [6] }, 'FLO.01 and GRD': { 1: [1, 2], 4: [5, 6] } }[name]
    if (LN) for (const f of [1, 4]) {
      r = await call(R.mc, '/api/mc', u, 'GET', `/27/fmr/${f}/detail`)
      const shown = LINES.filter(l => LN[f].includes(l.id)), all = LINES.filter(l => l.fmr_id === f), hid = shown.length < all.length, sum = (ls, k) => ls.reduce((s, l) => s + l[k], 0)
      check(ids(r.body.lines) === JSON.stringify(LN[f]), `${tag}: FMR ${f} detail lines ${JSON.stringify(LN[f])}`)
      check(JSON.stringify(Object.keys(r.body)) === '["fmr","lines","packages","pickups"]', `${tag}: FMR ${f} detail keeps its shape`)
      const h = r.body.fmr
      check(hid ? h.qty_requested === sum(shown, 'qty_requested').toFixed(3) && h.qty_issued === sum(shown, 'qty_issued').toFixed(3) : h.qty_requested === FMRS.find(x => x.id === f).qty_requested && h.qty_issued === FMRS.find(x => x.id === f).qty_issued, `${tag}: FMR ${f} header quantities from the lines shown (strings like the DECIMAL columns)`)
      check(f !== 1 || (hid ? h.approved_qty === sum(shown, 'qty_approved').toFixed(3) : h.approved_qty === FMRS[0].approved_qty), `${tag}: FMR 1 approved quantity from the lines shown`)
      check(JSON.stringify(r.body.pickups.map(p => p.id)) === JSON.stringify(hid ? [] : PICKUPS.filter(p => p.fmr_id === f).map(p => p.id)), `${tag}: FMR ${f} pickups ${hid ? 'empty (not attributable to the lines shown)' : 'unchanged'}`)
      check(f !== 4 || FMRS[3].approved_qty !== null || h.approved_qty === null, `${tag}: FMR 4 approved quantity stays empty`)
      check(h.item_code === shown[0].item_code && h.wbs_code === (hid ? shown[0].wbs_code : FMRS.find(x => x.id === f).wbs_code) && h.status === FMRS.find(x => x.id === f).status, `${tag}: FMR ${f} header summary is the first line shown, status unchanged`)
      if (f === 1) check(ids(r.body.packages) === JSON.stringify(name === 'FLO.01' ? [1, 3] : [1, 2, 3]), `${tag}: FMR 1 packages of the lines shown or of no line`)
    }
    if (LN) {
      r = await call(R.mc, '/api/mc', u, 'GET', '/27/fmr?view=all&limit=1000')
      for (const f of [1, 4]) {
        const row = r.body.data.find(x => x.id === f), shown = LINES.filter(l => LN[f].includes(l.id)), all = LINES.filter(l => l.fmr_id === f), hid = shown.length < all.length
        const tq = shown.reduce((s, l) => s + l.qty_requested, 0)
        check(row.line_count === shown.length && typeof row.total_qty_requested === 'string' && (hid ? row.total_qty_requested === tq.toFixed(3) : Number(row.total_qty_requested) === tq), `${tag}: FMR ${f} list line_count and total_qty_requested (a string) count the lines shown`)
        check(row.item_code === shown[0].item_code && (hid ? row.qty_requested === tq.toFixed(3) : row.qty_requested === FMRS.find(x => x.id === f).qty_requested), `${tag}: FMR ${f} list header summary from the lines shown`)
        check(f !== 4 || Number(row.stock_on_hand) === (hid ? 5 : 0), `${tag}: FMR 4 list stock_on_hand of the first line shown`)
      }
    }
    r = await call(R.mc, '/api/mc', u, 'GET', '/27/fmr/items')
    check(r.status === 200 && ids(r.body.data, 'item_id') === JSON.stringify(want.items), `${tag}: item picker`)
    r = await call(R.fd, '/api/foundational', u, 'GET', '/27/wbs')
    check(r.status === 200 && ids(r.body) === JSON.stringify(want.wbs), `${tag}: WBS tree, granted subtrees only`)
    r = await call(R.tr, '/api/traceability', u, 'GET', '/27/heat-status')
    check(r.status === 200 && JSON.stringify(Object.keys(r.body.data).sort()) === JSON.stringify(want.heats), `${tag}: heat-status, heats with stock under the grant`)
    r = await call(R.tr, '/api/traceability', u, 'GET', '/27/heat/h1')
    if (want.H1) check(r.status === 200 && ids(r.body.stock, 'stock_id') === JSON.stringify(want.H1.stock) && ids(r.body.issues) === JSON.stringify(want.H1.issues) && ids(r.body.transfers) === JSON.stringify(want.H1.transfers) && r.body.certs.length === 1, `${tag}: heat H1 detail, rows filtered by WBS`)
    else check(r.status === 404 && r.body.error === 'Heat not found', `${tag}: heat H1 without stock under the grant: 404`)
    calls = []; r = await call(R.tr, '/api/traceability', u, 'GET', '/27/heat/H9')
    if (want.H9) check(r.status === 200 && r.body.certs.length === 1 && r.body.stock.length === 0, `${tag}: heat with certificates but no stock: 200 (ALL is not narrowed)`)
    else check(r.status === 404 && r.body.error === 'Heat not found' && !calls.some(c => /FROM traceability_certs WHERE/.test(c.q)), `${tag}: heat with certificates but no stock: 404, nothing else read`)
  }
  // 3T170: the create check through the helper (every line; the request's own WBS is its first line's)
  const BODY = (...wbs) => ({ warehouse_id: 1, required_date: '2026-12-01', lines: wbs.map((w, i) => ({ item_code: 'N' + (i + 1), wbs_code: w, qty_requested: 2 })) })
  for (const u of [SC, SUB]) for (const [grant, wbs, code, err, label] of [
    [['FLO.01'], ['FLO.01'], 201, null, 'its own code'], [['FLO.01'], ['FLO.01.02', 'FLO.01'], 201, null, 'a descendant'],
    [['FLO.01'], ['FLO.01', 'FLO.010'], 422, 'Line 2 (N2): WBS FLO.010 is outside your granted WBS', 'FLO.010 under FLO.01 (the dot boundary)'],
    [['FLO.01'], ['GRD.01', 'FLO.01'], 422, 'Line 1 (N1): WBS GRD.01 is outside your granted WBS', 'the request\'s own WBS (first line) outside'],
    [['GRD_X'], ['GRD_X.01'], 201, null, 'an underscore code'], [['GRD_X'], ['GRDYX.01'], 422, 'Line 1 (N1): WBS GRDYX.01 is outside your granted WBS', 'GRDYX.01 under GRD_X (escaping)'],
    [['ALL'], ['FLO.010', 'GRDYX.01'], 201, null, 'ALL']]) {
    GRANTS = { [u.id]: grant }; calls = []
    const res = await call(R.mc, '/api/mc', u, 'POST', '/27/fmr', BODY(...wbs))
    const wrote = calls.some(c => /^INSERT INTO fmr_requests/.test(c.q))
    check(res.status === code && (err ? res.body.error === err && !wrote : wrote), `${u.role} create, ${label}: ${code}`)
  }
  GRANTS = { 713: ['FLO.01'] }
  let r = await call(R.tr, '/api/traceability', SC, 'GET', '/27/heat/H2')
  check(r.status === 404, 'site_contractor FLO.01: heat H2 (stock on FLO.010 only): 404, the dot boundary')
  GRANTS = {}
  r = await call(R.mc, '/api/mc', SC, 'GET', '/27/stock')
  check(r.status === 403, 'contractor without any row: no project access (403)')
  // ── admin validation ──
  if (R.ad) {
    const A = { id: 4, role: 'admin' }
    GRANTS = { 713: ['ALL'], 714: ['FLO.01'] }; ADMIN_GRANTS.length = 0
    const post = body => { calls = []; return call(R.ad, '/api/admin', A, 'POST', '/wbs-access', body) }
    const inserted = () => calls.some(c => /^INSERT INTO user_wbs_access/.test(c.q))
    for (const [body, code, err, name] of [
      [{ userId: 999, projectId: 27, wbsCode: 'ALL' }, 422, 'User not found', 'unknown user'],
      [{ userId: 801, projectId: 99, wbsCode: 'ALL' }, 422, 'Project not found', 'unknown project'],
      [{ userId: 801, projectId: 27, wbsCode: 'NOPE.1' }, 422, 'WBS code not found in this project', 'a code not in the project'],
      [{ userId: 801, projectId: 28, wbsCode: 'GRD' }, 422, 'WBS code not found in this project', 'a code of another project'],
      [{ userId: 713, projectId: 27, wbsCode: 'FLO.01' }, 409, 'The user already has the whole project (ALL); revoke first', 'a code when the user has ALL'],
      [{ userId: 714, projectId: 27, wbsCode: 'ALL' }, 409, 'The user has WBS code grants on this project; revoke first', 'ALL when the user has codes'],
      [{ userId: 714, projectId: 27, wbsCode: 'FLO.01' }, 409, 'WBS access already exists for this user/project', 'a duplicate (unique index)'],
      [{ userId: 801, projectId: 27 }, 400, 'userId, projectId and wbsCode are required', 'a missing field'],
    ]) { r = await post(body); check(r.status === code && r.body.error === err && (code === 409 && /already exists/.test(err) ? true : !inserted()), `admin grant, ${name}: ${code}`) }
    r = await post({ userId: 714, projectId: 27, wbsCode: ' GRD ' })
    check(r.status === 201 && inserted() && calls.some(c => /^INSERT INTO audit_log/.test(c.q) && c.params[1] === 'wbs.grant'), 'admin grant, a second code: 201, audited wbs.grant')
    check(calls.find(c => /^INSERT INTO user_wbs_access/.test(c.q)).params[2] === 'GRD', 'admin grant: the code trimmed')
    r = await post({ userId: 801, projectId: 27, wbsCode: 'ALL' })
    check(r.status === 201, 'admin grant, ALL for a user without grants: 201')
    r = await post({ userId: 801, projectId: 27, wbsCode: 'FLO.01' })
    check(r.status === 409 && /revoke first/.test(r.body.error), 'admin grant, a code after the new ALL: 409')
  }
  return { pass, fail, failed }
}

// Internal roles, vendors and forwarders: answers and queries equal to the files at c99b441.
async function sameAsBase(srcs) {
  const N = load(srcs), O = load({ grant: srcs.grant, ...OLD })
  GRANTS = { 711: ['ALL'], 685: ['ALL'] }
  const users = [{ id: 4, role: 'admin' }, { id: 24, role: 'project_manager' }, { id: 687, role: 'materials_engineer' }, { id: 711, role: 'vendor' }, { id: 685, role: 'freight_forwarder' }]
  const reqs = [['mc', '/api/mc', '/27/stock?limit=1000'], ['mc', '/api/mc', '/27/stock?wbs_code=FLO.01&search=I'], ['mc', '/api/mc', '/27/fmr?view=all&limit=1000'], ['mc', '/api/mc', '/27/fmr?search=FMR'],
    ['mc', '/api/mc', '/27/fmr/1/detail'], ['mc', '/api/mc', '/27/fmr/6/detail'], ['mc', '/api/mc', '/27/fmr/items'], ['mc', '/api/mc', '/27/fmr/items?q=I1'],
    ['fd', '/api/foundational', '/27/wbs'], ['tr', '/api/traceability', '/27/heat-status'], ['tr', '/api/traceability', '/27/heat/h1'], ['tr', '/api/traceability', '/27/heat/H9']]
  reqs.push(['mc', '/api/mc', '/27/fmr', { warehouse_id: 1, required_date: '2026-12-01', lines: [{ item_code: 'X', wbs_code: 'FLO.010', qty_requested: 2 }, { item_code: 'Y', wbs_code: 'GRDYX.01', qty_requested: 1 }] }])
  let same = 0, total = 0; const diffs = []
  for (const u of users) for (const [k, base, url, body] of reqs) {
    total++
    const method = body ? 'POST' : 'GET'
    calls = []; const a = await call(N[k], base, u, method, url, body); const qa = calls.map(c => c.q + JSON.stringify(c.params))
    calls = []; const b = await call(O[k], base, u, method, url, body); const qb = calls.map(c => c.q + JSON.stringify(c.params))
    if (JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(qa) === JSON.stringify(qb)) same++; else diffs.push(`${u.role} ${base}${url} ${a.status}/${b.status}`)
  }
  // 3T174: the FMR list for these roles also equal to e2a5a63 (no wbs_scopes key for them)
  const E = load({ ...srcs, mc: MC_E2A })
  for (const u of users) for (const url of ['/27/fmr?view=all&limit=1000', '/27/fmr', '/27/fmr?search=FMR']) {
    total++
    calls = []; const a = await call(N.mc, '/api/mc', u, 'GET', url); const qa = calls.map(c => c.q + JSON.stringify(c.params))
    calls = []; const b = await call(E.mc, '/api/mc', u, 'GET', url); const qb = calls.map(c => c.q + JSON.stringify(c.params))
    if (JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(qa) === JSON.stringify(qb) && !('wbs_scopes' in (a.body || {}))) same++; else diffs.push(`${u.role} e2a5a63 /api/mc${url} ${a.status}/${b.status}`)
  }
  return { same, total, diffs }
}

const M = (k, name, a, b) => [name, k, s => s.replace(a, b)]
const MUTANTS = [
  M('grant', 'prefix without the dot', "escapeLike(c) + '.%'", "escapeLike(c) + '%'"),
  M('grant', 'ALL treated as none', "  if (g.all) return { sql: '1=1', params: [] }\n", ''),
  M('grant', 'subcontractor only', "new Set(['site_contractor', 'subcontractor'])", "new Set(['subcontractor'])"),
  M('grant', 'no LIKE escaping', "const escapeLike = s => String(s).replace(/[!%_]/g, ch => '!' + ch)", 'const escapeLike = s => String(s)'),
  M('grant', 'no grant covers everything', "  if (!g.codes.length) return { sql: '1=0', params: [] }\n", "  if (!g.codes.length) return { sql: '1=1', params: [] }\n"),
  M('mc', 'stock: no helper', '      conditions.push(scope.sql); params.push(...scope.params)\n      subWbsCodes', '      subWbsCodes'),
  M('mc', 'stock stat cards: no helper', "FROM warehouse_stock s WHERE s.project_id = ?${scope ? ' AND ' + scope.sql : ''}`,\n        [pid, ...(scope ? scope.params : [])]),", 'FROM warehouse_stock s WHERE s.project_id = ?`,\n        [pid]),'),
  M('mc', 'FMR list: no helper', '    if (scope) { conditions.push(scope.sql); params.push(...scope.params) }\n', ''),
  M('mc', 'FMR counts: no helper', "FROM fmr_requests${scope ? ' f' : ''} WHERE project_id = ?${scope ? ' AND ' + scope.sql : ''}`,\n      [pid, ...(scope ? scope.params : [])]),", 'FROM fmr_requests WHERE project_id = ?`,\n      [pid]),'),
  M('mc', 'FMR scope: the header only', 'return { sql: `(${h.sql} OR EXISTS (SELECT 1 FROM fmr_lines l WHERE l.fmr_id=f.id AND ${l.sql}))`, params: [...h.params, ...l.params] }', 'return { sql: h.sql, params: h.params }'),
  M('mc', 'FMR detail: no helper', "    if (g) {   // 3T169: outside the contractor's grant → 404", '    if (false) {'),
  M('mc', 'item picker: no helper', "    const narrowed = wbsGrant.isNarrowed(req.user?.role)   // 3T169: contractors through the grant helper", '    const narrowed = false'),
  M('fd', 'WBS tree: no helper', "    const cov = wbsGrant.isNarrowed(req.user?.role) ? wbsGrant.covers('w.code', await wbsGrant.grants(db, req.user.id, pid)) : null", '    const cov = null'),
  M('tr', 'heat-status: no helper', "    const cov = g && !g.all ? wbsGrant.covers('s.wbs_code', g) : null", '    const cov = null'),
  M('tr', 'heat-status: ALL narrowed', "    const cov = g && !g.all ? wbsGrant.covers('s.wbs_code', g) : null", "    const cov = g ? wbsGrant.covers('s.wbs_code', g) : null"),
  M('tr', 'heat detail: ALL narrowed', '    if (g && g.all) g = null\n', ''),
  M('tr', 'heat detail: no 404', "      if (!has) return res.status(404).json({ error: 'Heat not found' })\n", ''),
  M('tr', 'heat detail: stock unfiltered', "= ${norm}${and(sS)} ORDER BY s.id`, [pid, heat, ...sS.params])", '= ${norm} ORDER BY s.id`, [pid, heat])'),
  M('tr', 'heat detail: issues unfiltered', "= ${norm}${and(sI)} ORDER BY fil.id`, [pid, heat, ...sI.params])", '= ${norm} ORDER BY fil.id`, [pid, heat])'),
  M('tr', 'heat detail: transfers unfiltered', "= ${norm}${and(sT)} ORDER BY id`, [pid, heat, ...sT.params])", '= ${norm} ORDER BY id`, [pid, heat])'),
  M('grant', '3T170: coversCode without the dot', "code.startsWith(c + '.')", 'code.startsWith(c)'),
  M('mc', '3T170: detail, no line filter', 'const lines = g ? allLines.filter(l => wbsGrant.coversCode(g, l.wbs_code)) : allLines', 'const lines = allLines'),
  M('mc', '3T170: detail, header not recomputed', 'fmr: hidden ? narrowedHeader(fmr, lines) : fmr, lines,', 'fmr, lines,'),
  M('mc', '3T170: detail, packages not filtered', 'packages: hidden ? packages.filter(p => shownPkgs.has(p.id) || !linkedPkgs.has(p.id)) : packages, pickups', 'packages, pickups'),
  M('mc', '3T170: list, counts not narrowed', 'const data = g ? await narrowFmrList(fmrs, g, pid) : fmrs', 'const data = fmrs'),
  M('mc', '3T170: list, stock_on_hand not recomputed', '    for (const r of moved) r.stock_on_hand = by[r.item_code] ?? 0\n', ''),
  M('mc', '3T170: create unchecked', 'if (narrowed ? !wbsGrant.coversCode(g, wbs) : !inScope(scope, wbs))', 'if (narrowed ? false : !inScope(scope, wbs))'),
  M('mc', '3T170: create, the old prefix check for contractors', "    const narrowed = wbsGrant.isNarrowed(req.user?.role)   // 3T170: contractors through the grant helper\n    const g = narrowed", "    const narrowed = false\n    const g = narrowed"),
  M('mc', '3T171: pickups kept with hidden lines', 'pickups: hidden ? [] : pickups })', 'pickups })'),
  M('mc', '3T171: quantities as numbers', "const qtySum = (ls, k) => ls.reduce((s, l) => s + Number(l[k] || 0), 0).toFixed(3)", 'const qtySum = (ls, k) => ls.reduce((s, l) => s + Number(l[k] || 0), 0)'),
  M('mc', '3T174: no wbs_scopes in the FMR list', "res.json(g ? { data, total, page, limit, counts, wbs_scopes: g.all ? [] : g.codes } : { data, total, page, limit, counts })", 'res.json({ data, total, page, limit, counts })'),
  M('mc', '3T174: wbs_scopes for every role', "res.json(g ? { data, total, page, limit, counts, wbs_scopes: g.all ? [] : g.codes } : { data, total, page, limit, counts })", 'res.json({ data, total, page, limit, counts, wbs_scopes: g ? (g.all ? [] : g.codes) : [] })'),
  M('mc', '3T174: ALL gives codes', 'wbs_scopes: g.all ? [] : g.codes } :', 'wbs_scopes: g.codes.length ? g.codes : [\'ALL\'] } :'),
  M('ad', 'validation: no user check', "    if (!u) return res.status(422).json({ error: 'User not found' })\n", ''),
  M('ad', 'validation: no project check', "    if (!p) return res.status(422).json({ error: 'Project not found' })\n", ''),
  M('ad', 'validation: no code check', "      if (!n) return res.status(422).json({ error: 'WBS code not found in this project' })\n", ''),
  M('ad', 'validation: a code allowed beside ALL', "    if (code !== 'ALL' && held.some(h => h.wbs_code === 'ALL'))\n      return res.status(409).json({ error: 'The user already has the whole project (ALL); revoke first' })\n", ''),
  M('ad', 'validation: ALL allowed beside codes', "    if (code === 'ALL' && held.some(h => h.wbs_code !== 'ALL'))\n      return res.status(409).json({ error: 'The user has WBS code grants on this project; revoke first' })\n", ''),
]

;(async () => {
  const r = await suite(SRC)
  const I = await sameAsBase(SRC)
  r.failed.forEach(n => console.log('FAIL ' + n)); I.diffs.forEach(d => console.log('FAIL differs from c99b441: ' + d))
  const fail = r.fail + (I.same === I.total ? 0 : 1)
  console.log(`wbsGrant: ${r.pass + (I.same === I.total ? 1 : 0)} passed, ${fail} failed (internal roles, vendor and forwarder identical to c99b441, the FMR list also to e2a5a63, on ${I.same} of ${I.total} requests, answers and queries)`)
  if (process.argv.includes('--mutation')) {
    let killed = 0
    for (const [name, k, mutate] of MUTANTS) {
      const mutated = mutate(SRC[k])
      if (mutated === SRC[k]) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      const srcs = { ...SRC, [k]: mutated }
      let bad
      try { const s = await suite(srcs); const i = await sameAsBase(srcs); bad = s.fail > 0 || i.same !== i.total } catch { bad = true }
      if (bad) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${MUTANTS.length} killed`)
    if (killed !== MUTANTS.length) process.exitCode = 1
  }
  if (fail) process.exitCode = 1
})()
