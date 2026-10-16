// P2b — the external gate's users-row lookup (server/lib/externalGate.js) and the supplier_id
// handling in authenticateToken (server/middleware/auth.js), with a fake db. No database; tokens
// are signed here with the secret the gate verifies with and never printed. Exit code 1 on any
// failure. Usage: node tests/p2/externalLookup.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ROOT = path.join(__dirname, '../../server')
const GATE = path.join(ROOT, 'lib/externalGate.js')
const AUTH = path.join(ROOT, 'middleware/auth.js')
const GATE_SRC = fs.readFileSync(GATE, 'utf8')
const AUTH_SRC = fs.readFileSync(AUTH, 'utf8')

// ── fake db: users rows by id; FAIL makes every query throw ──
let queries = [], FAIL = false
const ROWS = {
  801: { role: 'vendor', is_active: 1, is_external: 1, supplier_id: 5 },              // linked vendor
  802: { role: 'vendor', is_active: 1, is_external: 1, supplier_id: null },           // unlinked vendor
  803: { role: 'freight_forwarder', is_active: 1, is_external: 1, supplier_id: null },
  804: { role: 'site_contractor', is_active: 1, is_external: 1, supplier_id: null },
  805: { role: 'subcontractor', is_active: 1, is_external: 1, supplier_id: null },
  806: { role: 'vendor', is_active: 0, is_external: 1, supplier_id: 5 },              // disabled
  808: { role: 'freight_forwarder', is_active: 1, is_external: 1, supplier_id: null }, // token says vendor
  809: { role: 'vendor', is_active: 1, is_external: 0, supplier_id: 5 },              // External flag wrong
  810: { role: 'vendor', is_active: 1, is_external: 1, supplier_id: '7' },            // driver returns a string
  811: { role: 'vendor', is_active: null, is_external: 1, supplier_id: 5 },           // is_active NULL
}                                                                                     // 807: no row (deleted)
const fakeDb = { query: async (sql, params = []) => {
  queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
  if (FAIL) throw new Error('fake db down')
  const r = ROWS[params[0]]
  return [r ? [{ ...r }] : [], []]
} }
const dbPath = require.resolve(path.join(ROOT, 'db.js'))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb }
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'))
const { JWT_SECRET } = require(AUTH)

function compile(file, src) {
  const m = new Module(file, module)
  m.filename = file
  m.paths = Module._nodeModulePaths(path.dirname(file))
  m._compile(src, file)
  return m.exports
}
const sign = (payload, opts = { expiresIn: '10m' }) => jwt.sign(payload, JWT_SECRET, opts)
const tok = (id, role, extra = {}) => 'Bearer ' + sign({ id, email: 'p2b@test.invalid', full_name: 'p2b', role, ...extra })

// The gate, then (when it passes) authenticateToken, on one request: { r, req, user, authResult }.
function through(G, A, method, url, authorization) {
  return new Promise(resolve => {
    const req = { method, originalUrl: url, url: url.replace(/^\/api/i, '') || '/', headers: authorization === undefined ? {} : { authorization } }
    const res = { status(c) { this.code = c; return this }, json(b) { resolve({ r: { status: this.code, body: b }, req }); return this } }
    const afterGate = () => {
      const res2 = { status(c) { this.code = c; return this }, json(b) { resolve({ r: 'next', req, authResult: { status: this.code, body: b } }); return this } }
      A.authenticateToken(req, res2, () => resolve({ r: 'next', req, user: req.user, authResult: 'next' }))
    }
    Promise.resolve(G.externalGate(req, res, afterGate)).catch(e => resolve({ r: { status: 'threw', body: e.message }, req }))
  })
}

async function suite(gateSrc, authSrc) {
  const G = compile(GATE, gateSrc), A = compile(AUTH, authSrc)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const go = async (method, url, authorization) => { queries = []; FAIL = false; return through(G, A, method, url, authorization) }
  const err = (r, status, error) => r !== 'next' && r.status === status && r.body && r.body.error === error && Object.keys(r.body).length === 1
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  // 1. internal roles, no token and invalid tokens: no query, passed on; forged claim deleted
  for (const role of ['admin', 'project_manager', 'viewer', 'materials_engineer']) {
    const x = await go('GET', '/api/admin/users', tok(700, role, { supplier_id: 99 }))
    check(x.r === 'next' && queries.length === 0 && x.req.externalScope === undefined, `${role}: passed on, 0 queries`)
    check(x.user && x.user.role === role && !('supplier_id' in x.user), `${role}: forged supplier_id claim deleted`)
  }
  for (const [name, h] of [['no header', undefined], ['Bearer only', 'Bearer'], ['garbage', 'Bearer not.a.token'],
    ['bad signature', 'Bearer ' + jwt.sign({ id: 801, role: 'vendor' }, JWT_SECRET + 'x')], ['expired', 'Bearer ' + sign({ id: 801, role: 'vendor' }, { expiresIn: -10 })]]) {
    const x = await go('GET', '/api/projects', h)
    check(x.r === 'next' && queries.length === 0, `${name}: passed on, 0 queries`)
  }
  for (const [m, u] of [['POST', '/api/auth/login'], ['POST', '/api/auth/forgot-password']]) {
    const x = await go(m, u, tok(806, 'vendor'))
    check(x.r === 'next' && queries.length === 0, `${m} ${u} with a disabled vendor's token: open, 0 queries`)
  }

  // 2. linked vendor: one exact query, scope set, the token's claim replaced by the row's value
  let x = await go('GET', '/api/projects', tok(801, 'vendor', { supplier_id: 99 }))
  check(x.r === 'next' && same(x.req.externalScope, { userId: 801, role: 'vendor', supplierId: 5 }), 'linked vendor: scope { userId, role, supplierId }')
  check(queries.length === 1 && queries[0].sql === 'SELECT role, is_active, is_external, supplier_id FROM users WHERE id = ?' && same(queries[0].params, [801]), 'one query, exact SQL and params')
  check(x.user && x.user.supplier_id === 5 && x.authResult === 'next', 'forged claim 99 replaced by the row value 5')
  x = await go('GET', '/api/procurement/27/pos', tok(801, 'vendor'))
  check(err(x.r, 403, 'Not available to your role') && queries.length === 1, 'linked vendor, denied path: allowlist 403 after the lookup')
  x = await go('GET', '/api/projects/../admin', tok(801, 'vendor'))
  check(err(x.r, 403, 'Not available to your role'), 'linked vendor, unsafe path: 403')
  x = await go('GET', '/api/projects', tok('801', 'vendor'))
  check(x.r === 'next' && x.req.externalScope.userId === 801 && same(queries[0].params, [801]), 'string id in the token: looked up as a number')
  x = await go('GET', '/api/projects', tok(810, 'vendor'))
  check(x.r === 'next' && x.req.externalScope.supplierId === 7 && x.user.supplier_id === 7, 'supplier_id from the driver as a string: a number in the scope')

  // 3. unlinked vendor: refused everywhere except its account routes
  for (const [m, u] of [['GET', '/api/projects'], ['GET', '/api/rfi-meeting/27'], ['GET', '/api/procurement/27/pos'], ['GET', '/api/auth/change-password'],
    ['POST', '/api/auth/me'], ['GET', '/api/auth/me/../projects'], ['GET', '/api/auth/me/x'], ['PUT', '/api/auth/profile/../../admin']]) {
    x = await go(m, u, tok(802, 'vendor'))
    check(err(x.r, 403, 'Your account is not linked to a supplier') && x.req.externalScope === undefined, `unlinked vendor ${m} ${u}: 403 not linked`)
  }
  for (const [m, u] of [['POST', '/api/auth/change-password'], ['PUT', '/api/auth/profile'], ['GET', '/api/auth/me'], ['GET', '/api/auth/me/'], ['GET', '/api/AUTH/ME?x=1']]) {
    x = await go(m, u, tok(802, 'vendor', { supplier_id: 5 }))
    check(x.r === 'next' && same(x.req.externalScope, { userId: 802, role: 'vendor', supplierId: null }) && x.user.supplier_id === null, `unlinked vendor ${m} ${u}: passes, supplier_id null (forged claim ignored)`)
  }

  // 4. other external roles need no supplier
  for (const [id, role, m, u] of [[803, 'freight_forwarder', 'GET', '/api/logistics/register/27'], [804, 'site_contractor', 'GET', '/api/foundational/27/wbs'], [805, 'subcontractor', 'GET', '/api/mc/27/stock']]) {
    x = await go(m, u, tok(id, role, { supplier_id: 5 }))
    check(x.r === 'next' && same(x.req.externalScope, { userId: id, role, supplierId: null }) && x.user.supplier_id === null, `${role}: passes unlinked, supplier_id null`)
  }

  // 5. refusals, before the allowlist
  for (const [m, u] of [['GET', '/api/projects'], ['GET', '/api/admin/users'], ['GET', '/api/auth/me']]) {
    x = await go(m, u, tok(806, 'vendor'))
    check(err(x.r, 401, 'Account disabled'), `disabled ${m} ${u}: 401`)
    x = await go(m, u, tok(807, 'vendor'))
    check(err(x.r, 401, 'Account disabled'), `deleted ${m} ${u}: 401`)
    x = await go(m, u, tok(808, 'vendor'))
    check(err(x.r, 401, 'Session out of date: sign in again'), `role changed ${m} ${u}: 401`)
    x = await go(m, u, tok(809, 'vendor'))
    check(err(x.r, 403, 'Account configuration error'), `External flag wrong ${m} ${u}: 403`)
  }
  x = await go('GET', '/api/projects', tok(811, 'vendor'))
  check(err(x.r, 401, 'Account disabled'), 'is_active NULL: 401')
  x = await go('GET', '/api/logistics/register/27', tok(801, 'freight_forwarder'))
  check(err(x.r, 401, 'Session out of date: sign in again'), 'token forwarder, row vendor: 401')
  for (const [name, payload] of [['no id', { role: 'vendor' }], ['id 0', { id: 0, role: 'vendor' }], ['id abc', { id: 'abc', role: 'vendor' }], ['id 1.5', { id: 1.5, role: 'vendor' }]]) {
    x = await go('GET', '/api/projects', 'Bearer ' + sign(payload))
    check(err(x.r, 401, 'Account disabled') && queries.length === 0, `${name}: 401, 0 queries`)
  }

  // 6. a query error is a 500, never passed on
  for (const [id, role, u] of [[801, 'vendor', '/api/projects'], [803, 'freight_forwarder', '/api/logistics/register/27'], [805, 'subcontractor', '/api/mc/27/stock']]) {
    queries = []; FAIL = true
    x = await through(G, A, 'GET', u, tok(id, role)); FAIL = false
    check(err(x.r, 500, 'Authorization check failed') && x.req.externalScope === undefined, `${role}: query error → 500`)
  }

  // 7. authenticateToken alone: claim deleted with no scope; set from a scope; bad token unchanged
  const authOnly = (h, scope) => new Promise(resolve => {
    const req = { headers: { authorization: h } }; if (scope) req.externalScope = scope
    const res = { status(c) { this.code = c; return this }, json(b) { resolve({ status: this.code, body: b }) } }
    A.authenticateToken(req, res, () => resolve({ next: true, user: req.user }))
  })
  let a = await authOnly(tok(801, 'vendor', { supplier_id: 99 }))
  check(a.next && !('supplier_id' in a.user) && a.user.id === 801, 'auth without a scope: claim deleted')
  a = await authOnly(tok(801, 'vendor', { supplier_id: 99 }), { userId: 801, role: 'vendor', supplierId: 5 })
  check(a.next && a.user.supplier_id === 5, 'auth with a scope: supplier_id from the scope')
  a = await authOnly(tok(802, 'vendor'), { userId: 802, role: 'vendor', supplierId: null })
  check(a.next && a.user.supplier_id === null && 'supplier_id' in a.user, 'auth with an unlinked scope: supplier_id null')
  a = await authOnly('Bearer not.a.token')
  check(a.status === 403 && a.body.error === 'Invalid or expired token', 'auth with a bad token: 403 as before')
  return { pass, fail, failed }
}

const G_MUTANTS = [
  ['inactive passes', s => s.replace('if (!row || !Number(row.is_active))', 'if (!row)')],
  ['role check removed', s => s.replace('if (row.role !== user.role)', 'if (false)')],
  ['configuration check removed', s => s.replace('if (EXTERNAL_ROLES.has(row.role) !== Boolean(Number(row.is_external)))', 'if (false)')],
  ['query error passes on', s => s.replace("return res.status(500).json({ error: 'Authorization check failed' })", 'return next()')],
  ['unlinked vendor allowed', s => s.replace("if (row.role === 'vendor' && supplierId === null &&", 'if (false &&')],
  ['no account exception', s => s.replace('!(p !== null && ACCOUNT.some(', '!(false && ACCOUNT.some(')],
  ['account exception ignores the method', s => s.replace('ACCOUNT.some(a => a.method === req.method && a.re.test(p))', 'ACCOUNT.some(a => a.re.test(p))')],
  ['supplier from the token', s => s.replace('const supplierId = row.supplier_id == null ? null : Number(row.supplier_id)', 'const supplierId = user.supplier_id == null ? null : Number(user.supplier_id)')],
  ['no number conversion', s => s.replace(': Number(row.supplier_id)', ': row.supplier_id')],
  ['allowlist before the lookup', s => s.replace('  // Phase 2: the users row, read on every external request (P2b).', '  if (p !== null && !unsafePath(p) && isAllowed(user.role, req.method, p)) return next()\n  // Phase 2: the users row, read on every external request (P2b).')],
  ['internal roles looked up', s => s.replace('if (!user || !EXTERNAL_ROLES.has(user.role)) return next()', 'if (!user) return next()')],
  ['no id check', s => s.replace("if (!Number.isInteger(userId) || userId <= 0) return res.status(401).json({ error: 'Account disabled' })", '')],
  ['scope not set', s => s.replace('req.externalScope = { userId, role: row.role, supplierId }', '')],
  ['wrong id queried', s => s.replace('FROM users WHERE id = ?\', [userId])', 'FROM users WHERE id = ?\', [Number(user.sub)])')],
]
const A_MUTANTS = [
  ['claim kept', s => s.replace('delete user.supplier_id;', '')],
  ['scope not copied', s => s.replace('if (req.externalScope) user.supplier_id = req.externalScope.supplierId;', '')],
  ['copied unconditionally', s => s.replace('if (req.externalScope) user.supplier_id = req.externalScope.supplierId;', 'user.supplier_id = (req.externalScope || {}).supplierId;')],
]

;(async () => {
  const r = await suite(GATE_SRC, AUTH_SRC)
  r.failed.forEach(n => console.log('FAIL ' + n))
  console.log(`externalLookup: ${r.pass} passed, ${r.fail} failed`)
  if (process.argv.includes('--mutation')) {
    let killed = 0, total = 0
    for (const [list, which] of [[G_MUTANTS, 'gate'], [A_MUTANTS, 'auth']]) for (const [name, mutate] of list) {
      total++
      const src = mutate(which === 'gate' ? GATE_SRC : AUTH_SRC)
      if (src === (which === 'gate' ? GATE_SRC : AUTH_SRC)) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      let res
      try { res = await (which === 'gate' ? suite(src, AUTH_SRC) : suite(GATE_SRC, src)) } catch (e) { res = { fail: 1 } }
      if (res.fail > 0) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${total} killed`)
    if (killed !== total) process.exitCode = 1
  }
  if (r.fail) process.exitCode = 1
})()
