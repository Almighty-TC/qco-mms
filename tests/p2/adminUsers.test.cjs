// P2a — server/routes/admin.js user routes: supplierId and the role/External consistency
// check, through the real router with a fake db, bcrypt and email (no database, no mail).
// Exit code 1 on any failure. Usage: node tests/p2/adminUsers.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ROOT = path.join(__dirname, '../../server')
const ADMIN = path.join(ROOT, 'routes/admin.js')
const SOURCE = fs.readFileSync(ADMIN, 'utf8')

// ── fakes ─────────────────────────────────────────────────────────────────────
let calls = []
let USERS = {}
const SUPPLIERS = new Set([3, 5, 7])
const norm = s => s.replace(/\s+/g, ' ').trim()
const fakeDb = {
  query: async (sql, params = []) => {
    const q = norm(sql)
    calls.push({ q, params })
    if (/^SELECT COUNT\(\*\) AS total FROM users u/.test(q)) return [[{ total: 1 }], []]
    if (/^SELECT u\.id, u\.full_name AS fullName/.test(q)) return [[{ id: 30, fullName: 'V', supplierId: 3, supplierName: 'Supplier 3' }], []]
    if (/^SELECT full_name, email, role, is_active, is_external, supplier_id FROM users WHERE id=\?$/.test(q)) return [USERS[params[0]] ? [{ ...USERS[params[0]] }] : [], []]
    if (/^SELECT id FROM suppliers WHERE id = \?$/.test(q)) return [SUPPLIERS.has(params[0]) ? [{ id: params[0] }] : [], []]
    if (/^SELECT id, full_name AS fullName/.test(q)) return [[{ id: params[0], fullName: 'x' }], []]
    if (/^INSERT INTO users /.test(q)) return [{ insertId: 901 }, undefined]
    if (/^(UPDATE users SET|INSERT INTO audit_log|INSERT INTO password_history|DELETE FROM password_history)/.test(q)) return [{ affectedRows: 1 }, undefined]
    throw new Error('unexpected query: ' + q.slice(0, 90))
  },
}
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(path.join(ROOT, 'db.js'), fakeDb)
stub(require.resolve('bcryptjs', { paths: [ROOT] }), { hash: async () => 'fake-hash', compare: async () => false })
stub(path.join(ROOT, 'services/email.js'), { sendEmail: async () => {}, sendAlert: async () => {}, html: () => '' })

function loadRouter(src) {
  const m = new Module(ADMIN, module)
  m.filename = ADMIN
  m.paths = Module._nodeModulePaths(path.dirname(ADMIN))
  m._compile(src, ADMIN)
  return m.exports
}

function call(router, method, url, { body = {}, role = 'admin', query = {} } = {}) {
  return new Promise(resolve => {
    const req = { method, url, originalUrl: '/api/admin' + url, headers: {}, body, query, ip: '127.0.0.1', user: { id: 4, email: 'admin@test.invalid', role } }
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] },
      status(c) { this.statusCode = c; return this },
      json(o) { this.body = o; resolve(this) }, send(o) { this.body = o; resolve(this) }, end() { resolve(this) },
    }
    router(req, res, err => resolve({ statusCode: err ? 500 : 404, body: { fellThrough: true, err: err && err.message } }))
  })
}

// Pairs each column of a captured INSERT or UPDATE with its parameter.
function columns(q, params) {
  const out = {}; let i = 0
  if (q.startsWith('INSERT INTO users')) {
    const cols = q.match(/INSERT INTO users \(([^)]*)\)/)[1].split(',').map(s => s.trim())
    const vals = q.match(/VALUES \(([^)]*)\)/)[1].split(',').map(s => s.trim())
    cols.forEach((c, k) => { out[c] = vals[k] === '?' ? params[i++] : vals[k] })
  } else {
    const sets = q.match(/SET (.*) WHERE id=\?/)[1].split(',').map(s => s.trim())
    sets.forEach(s => { const [c, v] = s.split('='); out[c] = v === '?' ? params[i++] : v })
    out['WHERE id'] = params[i++]
  }
  if (i !== params.length) out.__misaligned = `${i} placeholders, ${params.length} params`
  return out
}
const writesOf = () => calls.filter(c => /^(INSERT|UPDATE|DELETE)/.test(c.q))
const userWrite = () => { const w = calls.find(c => /^(INSERT INTO users|UPDATE users SET)/.test(c.q)); return w ? columns(w.q, w.params) : null }
const lookups = () => calls.filter(c => c.q.startsWith('SELECT id FROM suppliers')).map(c => c.params[0])
const auditText = () => calls.filter(c => c.q.startsWith('INSERT INTO audit_log')).map(c => c.params[2]).join(' | ')

const EXT = ['vendor', 'freight_forwarder', 'site_contractor', 'subcontractor']
const INTERNAL = ['admin', 'ceo', 'director', 'project_director', 'project_manager', 'procurement_manager', 'procurement_officer', 'expediting_manager',
  'expeditor', 'logistics_manager', 'warehouse', 'viewer', 'engineering_lead', 'project_control', 'project_controls_manager', 'auditor', 'materials_engineer']

async function suite(src) {
  const router = loadRouter(src)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const run = async (method, url, opts) => { calls = []; return call(router, method, url, opts) }
  const reset = () => {
    USERS = {
      30: { full_name: 'V', email: 'v@test.invalid', role: 'vendor', is_active: 1, is_external: 1, supplier_id: 3 },
      31: { full_name: 'F', email: 'f@test.invalid', role: 'freight_forwarder', is_active: 1, is_external: 1, supplier_id: null },
      32: { full_name: 'P', email: 'p@test.invalid', role: 'project_manager', is_active: 1, is_external: 0, supplier_id: null },
    }
  }
  reset()
  const P = (role, extra = {}) => ({ fullName: 'P2a Test', email: 'p2a@test.invalid', role, isExternal: EXT.includes(role), ...extra })
  const U = (role, extra = {}) => ({ fullName: 'V', email: 'v@test.invalid', role, isExternal: EXT.includes(role), isActive: true, contractStart: '2026-01-01', ...extra })

  // ── GET /users ──
  let r = await run('GET', '/users')
  const rowsSql = calls.find(c => c.q.startsWith('SELECT u.id'))?.q || ''
  check(r.statusCode === 200 && /u\.supplier_id AS supplierId/.test(rowsSql) && /s\.name AS supplierName/.test(rowsSql), 'GET /users selects supplierId and supplierName')
  check(/FROM users u LEFT JOIN suppliers s ON s\.id = u\.supplier_id WHERE/.test(rowsSql), 'GET /users LEFT JOINs suppliers')
  check(r.body.rows[0].supplierId === 3 && r.body.rows[0].supplierName === 'Supplier 3', 'GET /users passes the fields through')

  // ── POST /users ──
  r = await run('POST', '/users', { body: P('vendor', { supplierId: 5 }) })
  let w = userWrite()
  check(r.statusCode === 201 && w && w.supplier_id === 5 && w.is_external === 1 && !w.__misaligned, 'POST vendor with supplierId stores it')
  check(w && w.contract_start === null && w.force_password_change === '1' && w.role === 'vendor', 'POST columns stay aligned')
  check(JSON.stringify(lookups()) === '[5]', 'POST vendor with supplierId: one supplier lookup')
  r = await run('POST', '/users', { body: P('vendor', { supplierId: '5' }) }); w = userWrite()
  check(r.statusCode === 201 && w.supplier_id === 5, 'POST supplierId as a digit string')
  r = await run('POST', '/users', { body: P('vendor') }); w = userWrite()
  check(r.statusCode === 201 && w.supplier_id === null && lookups().length === 0, 'POST vendor without supplierId stores NULL (allowed)')
  for (const v of [null, '']) {
    r = await run('POST', '/users', { body: P('vendor', { supplierId: v }) }); w = userWrite()
    check(r.statusCode === 201 && w.supplier_id === null && lookups().length === 0, `POST supplierId ${JSON.stringify(v)} stores NULL`)
  }
  for (const role of ['freight_forwarder', 'admin', 'project_manager']) {
    r = await run('POST', '/users', { body: P(role, { supplierId: 5 }) })
    check(r.statusCode === 400 && r.body.error === 'Only vendor users link to a supplier' && writesOf().length === 0 && lookups().length === 0, `POST ${role} with supplierId: 400, 0 writes`)
  }
  r = await run('POST', '/users', { body: P('freight_forwarder', { supplierId: null }) }); w = userWrite()
  check(r.statusCode === 201 && w.supplier_id === null, 'POST non-vendor with supplierId null: allowed, NULL')
  r = await run('POST', '/users', { body: P('vendor', { supplierId: 999 }) })
  check(r.statusCode === 400 && r.body.error === 'Unknown supplier' && writesOf().length === 0 && JSON.stringify(lookups()) === '[999]', 'POST unknown supplier: 400, 0 writes')
  for (const v of ['abc', -1, 0, 1.5, true, '5x', {}]) {
    r = await run('POST', '/users', { body: P('vendor', { supplierId: v }) })
    check(r.statusCode === 400 && r.body.error === 'Unknown supplier' && writesOf().length === 0 && lookups().length === 0, `POST supplierId ${JSON.stringify(v)}: 400, no lookup`)
  }
  for (const role of EXT) {
    r = await run('POST', '/users', { body: P(role, { isExternal: false }) })
    check(r.statusCode === 400 && r.body.error === `Role ${role} requires External = yes` && writesOf().length === 0, `POST ${role} External no: 400`)
    r = await run('POST', '/users', { body: P(role) })
    check(r.statusCode === 201, `POST ${role} External yes: 201`)
  }
  for (const role of INTERNAL) {
    r = await run('POST', '/users', { body: P(role, { isExternal: true }) })
    check(r.statusCode === 400 && r.body.error === `Role ${role} requires External = no` && writesOf().length === 0, `POST ${role} External yes: 400`)
    r = await run('POST', '/users', { body: P(role) })
    check(r.statusCode === 201, `POST ${role} External no: 201`)
  }
  r = await run('POST', '/users', { body: { fullName: 'x', email: 'x@test.invalid', role: 'vendor' } })
  check(r.statusCode === 400 && r.body.error === 'Role vendor requires External = yes', 'POST isExternal absent for vendor: 400')
  r = await run('POST', '/users', { body: { email: 'x@test.invalid', role: 'vendor', isExternal: false } })
  check(r.statusCode === 400 && r.body.error === 'Full name is required', 'POST existing validation still first')

  // ── PUT /users/:id ──
  r = await run('PUT', '/users/30', { body: U('vendor') }); w = userWrite()
  check(r.statusCode === 200 && w && !('supplier_id' in w) && w['WHERE id'] === 30 && w.contract_start === '2026-01-01' && !w.__misaligned, 'PUT supplierId absent: column untouched')
  check(!/supplier:/.test(auditText()), 'PUT absent: no supplier audit entry')
  r = await run('PUT', '/users/30', { body: U('vendor', { supplierId: 7 }) }); w = userWrite()
  check(r.statusCode === 200 && w.supplier_id === 7 && w.contract_start === '2026-01-01' && w['WHERE id'] === 30 && !w.__misaligned, 'PUT supplierId sets it')
  check(/supplier: 3→7/.test(auditText()) && JSON.stringify(lookups()) === '[7]', 'PUT audit supplier 3→7')
  r = await run('PUT', '/users/30', { body: U('vendor', { supplierId: null }) }); w = userWrite()
  check(r.statusCode === 200 && w.supplier_id === null && /supplier: 3→none/.test(auditText()), 'PUT supplierId null clears it')
  r = await run('PUT', '/users/30', { body: U('vendor', { supplierId: '' }) }); w = userWrite()
  check(r.statusCode === 200 && w.supplier_id === null, 'PUT supplierId empty clears it')
  r = await run('PUT', '/users/30', { body: U('vendor', { supplierId: 3 }) }); w = userWrite()
  check(r.statusCode === 200 && w.supplier_id === 3 && !/supplier:/.test(auditText()), 'PUT same supplier: written, no audit entry')
  r = await run('PUT', '/users/30', { body: U('freight_forwarder') }); w = userWrite()
  check(r.statusCode === 200 && 'supplier_id' in w && w.supplier_id === null, 'PUT vendor → freight_forwarder clears supplier_id')
  check(/role: vendor→freight_forwarder/.test(auditText()) && /supplier: 3→none/.test(auditText()), 'PUT role change audit has role and supplier')
  r = await run('PUT', '/users/30', { body: U('project_manager') }); w = userWrite()
  check(r.statusCode === 200 && w.supplier_id === null && w.is_external === 0, 'PUT vendor → project_manager clears supplier_id')
  r = await run('PUT', '/users/32', { body: U('project_manager') }); w = userWrite()
  check(r.statusCode === 200 && !('supplier_id' in w), 'PUT non-vendor unchanged: column untouched')
  r = await run('PUT', '/users/31', { body: U('vendor', { supplierId: 5 }) }); w = userWrite()
  check(r.statusCode === 200 && w.supplier_id === 5 && /supplier: none→5/.test(auditText()) && /role: freight_forwarder→vendor/.test(auditText()), 'PUT forwarder → vendor with supplier')
  r = await run('PUT', '/users/31', { body: U('freight_forwarder', { supplierId: 5 }) })
  check(r.statusCode === 400 && r.body.error === 'Only vendor users link to a supplier' && writesOf().length === 0 && calls.length === 0, 'PUT non-vendor with supplierId: 400, 0 writes')
  r = await run('PUT', '/users/30', { body: U('vendor', { supplierId: 999 }) })
  check(r.statusCode === 400 && r.body.error === 'Unknown supplier' && writesOf().length === 0, 'PUT unknown supplier: 400, 0 writes')
  r = await run('PUT', '/users/30', { body: U('vendor', { supplierId: 'abc' }) })
  check(r.statusCode === 400 && r.body.error === 'Unknown supplier' && calls.length === 0, 'PUT bad supplierId: 400, no query')
  r = await run('PUT', '/users/30', { body: U('vendor', { supplierId: 7, password: 'New-Pass-1!' }) }); w = userWrite()
  check(r.statusCode === 200 && w.password_hash === 'fake-hash' && w.supplier_id === 7 && w.contract_start === '2026-01-01' && !w.__misaligned, 'PUT with password: supplier_id set, columns aligned')
  r = await run('PUT', '/users/30', { body: U('vendor', { isExternal: false }) })
  check(r.statusCode === 400 && r.body.error === 'Role vendor requires External = yes' && calls.length === 0, 'PUT mismatch (external role, External no): 400')
  r = await run('PUT', '/users/32', { body: U('project_manager', { isExternal: true }) })
  check(r.statusCode === 400 && r.body.error === 'Role project_manager requires External = no' && calls.length === 0, 'PUT mismatch (internal role, External yes): 400')
  r = await run('PUT', '/users/99', { body: U('vendor', { supplierId: 5 }) })
  check(r.statusCode === 404 && writesOf().length === 0 && lookups().length === 0, 'PUT unknown user: 404 before the supplier check')

  // ── non-admin ──
  for (const role of ['project_manager', 'vendor']) {
    for (const [m, u, b] of [['GET', '/users', {}], ['POST', '/users', P('vendor', { supplierId: 5 })], ['PUT', '/users/30', U('vendor', { supplierId: 5 })]]) {
      r = await run(m, u, { body: b, role })
      check(r.statusCode === 403 && r.body.error === 'Admin access required' && calls.length === 0, `${role} ${m} ${u}: 403, no query`)
    }
  }
  return { pass, fail, failed }
}

const nth = (s, find, repl, n) => { let i = -1; for (let k = 0; k <= n; k++) { i = s.indexOf(find, i + 1); if (i < 0) return s } return s.slice(0, i) + repl + s.slice(i + find.length) }
const MUTANTS = [
  ['no consistency check', s => s.replace('return needs === Boolean(isExternal) ? null', 'return true ? null')],
  ['yes/no swapped', s => s.replace("External = ${needs ? 'yes' : 'no'}", "External = ${needs ? 'no' : 'yes'}")],
  ['POST mismatch not enforced', s => nth(s, 'if (mismatch) return res.status(400).json({ error: mismatch })', '', 0)],
  ['PUT mismatch not enforced', s => nth(s, 'if (mismatch) return res.status(400).json({ error: mismatch })', '', 1)],
  ['no vendor-only rule', s => s.replace("if (role !== 'vendor') return { error: 'Only vendor users link to a supplier' }", '')],
  ["'' not clearing", s => s.replace("if (v === null || v === '') return", 'if (v === null) return')],
  ['absent treated as null', s => s.replace('return { present: false }', 'return { present: true, value: null }')],
  ['number format loosened', s => s.replace('Number.isInteger(v) && v > 0', 'v > 0')],
  ['string id not converted', s => s.replace('return { present: true, value: Number(v) }', 'return { present: true, value: v }')],
  ['POST no existence check', s => nth(s, 'if (supplier.value != null && !(await supplierExists(supplier.value))) {', 'if (false) {', 0)],
  ['PUT no existence check', s => nth(s, 'if (supplier.value != null && !(await supplierExists(supplier.value))) {', 'if (false) {', 1)],
  ['role change keeps supplier', s => s.replace("const leftVendor  = current.role === 'vendor' && role !== 'vendor'", 'const leftVendor  = false')],
  ['PUT always writes supplier', s => s.replace('const setSupplier = supplier.present || leftVendor', 'const setSupplier = true')],
  ['POST stores NULL always', s => s.replace('isExternal ? 1 : 0, supplier.value ?? null,', 'isExternal ? 1 : 0, null,')],
  ['no supplier audit', s => s.replace('if (setSupplier && (current.supplier_id ?? null) !== supplierId) changes.push', 'if (false) changes.push')],
  ['GET no supplierId', s => s.replace('u.supplier_id                                  AS supplierId,', '')],
  ['GET no join', s => s.replace('LEFT JOIN suppliers s ON s.id = u.supplier_id\n', '')],
  ['PUT password variant without supplier', s => s.replace('is_active=?,is_external=?${supSql},contract_start=?,contract_end=?', 'is_active=?,is_external=?,contract_start=?,contract_end=?')],
]

;(async () => {
  const r = await suite(SOURCE)
  r.failed.forEach(n => console.log('FAIL ' + n))
  console.log(`adminUsers: ${r.pass} passed, ${r.fail} failed`)
  if (process.argv.includes('--mutation')) {
    let killed = 0
    for (const [name, mutate] of MUTANTS) {
      const m = mutate(SOURCE)
      if (m === SOURCE) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      let res
      try { res = await suite(m) } catch (e) { res = { fail: 1 } }
      if (res.fail > 0) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${MUTANTS.length} killed`)
    if (killed !== MUTANTS.length) process.exitCode = 1
  }
  if (r.fail) process.exitCode = 1
})()
