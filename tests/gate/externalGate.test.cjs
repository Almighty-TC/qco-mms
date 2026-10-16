// External role gate (phase 1) — server/lib/externalGate.js, with fake req and res and no
// database. Exit code 1 on any failure. Usage: node tests/gate/externalGate.test.cjs
// Tokens are signed here with the same secret the gate verifies with; none is printed.
const path = require('path')
const ROOT = path.join(__dirname, '../../server')
// The gate (phase 2) and permissions.js require ../db: a fake answers the gate's users-row
// lookup with an active, correctly flagged row for each external role's test id (the vendor
// linked to supplier 5), so this test never opens a connection.
const ROLE_ID = { vendor: 701, freight_forwarder: 702, site_contractor: 703, subcontractor: 704 }
let queries = 0
const fakeDb = { query: async (sql, params = []) => {
  queries++
  const role = Object.keys(ROLE_ID).find(r => ROLE_ID[r] === params[0])
  return [role ? [{ role, is_active: 1, is_external: 1, supplier_id: role === 'vendor' ? 5 : null }] : []]
} }
const dbPath = require.resolve(path.join(ROOT, 'db.js'))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb }
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'))
const { JWT_SECRET } = require(path.join(ROOT, 'middleware/auth'))
const G = require(path.join(ROOT, 'lib/externalGate'))
const P = require(path.join(ROOT, 'middleware/permissions'))

let pass = 0, fail = 0
const check = (ok, name) => { if (ok) pass++; else { fail++; console.log('FAIL ' + name) } }
const EXT = ['vendor', 'freight_forwarder', 'site_contractor', 'subcontractor']
const INTERNAL = ['admin', 'viewer', 'auditor', 'procurement_officer', 'procurement_manager', 'expeditor', 'expediting_manager', 'project_manager', 'warehouse', 'materials_engineer']
const sign = (payload, opts = { expiresIn: '10m' }) => jwt.sign(payload, JWT_SECRET, opts)
const tok = role => sign({ id: ROLE_ID[role] || 700, email: 'gate@test.invalid', full_name: 'gate', role })

// Runs the gate once (async since phase 2): 'next' when it passes the request on, else the status and body.
function run(method, url, authorization) {
  return new Promise(resolve => {
    const req = { method, originalUrl: url, url: url.replace(/^\/api/i, '') || '/', headers: authorization === undefined ? {} : { authorization } }
    const res = { status(c) { this.code = c; return this }, json(b) { resolve({ status: this.code, body: b }); return this } }
    Promise.resolve(G.externalGate(req, res, () => resolve('next'))).catch(e => resolve({ status: 'threw', body: e.message }))
  })
}
const asRole = (role, method, url) => run(method, url, 'Bearer ' + tok(role))
const DENY = { status: 403, body: { error: 'Not available to your role' } }
const denied = r => r && r !== 'next' && r.status === 403 && JSON.stringify(r.body) === JSON.stringify(DENY.body)
const allowedFor = (role, method, p) => G.ALLOW.some(e => e.method === method && e.roles.includes(role) && e.re.test(p))

;(async () => {
// ── the role list matches requireProjectScope's ──
check(JSON.stringify([...G.EXTERNAL_ROLES].sort()) === JSON.stringify([...P.EXTERNAL_ROLES].sort()), 'EXTERNAL_ROLES equals permissions.EXTERNAL_ROLES')

// ── every ALLOW entry: passes for its roles, refused for the other external roles ──
let entryChecks = 0
for (const e of G.ALLOW) {
  check(e.re.test(e.example), 'example matches its own pattern ' + e.example)
  for (const role of EXT) {
    const r = await asRole(role, e.method, '/api' + e.example), want = allowedFor(role, e.method, e.example)
    check(want ? r === 'next' : denied(r), `${e.method} ${e.example} for ${role}: expected ${want ? 'pass' : '403'}`)
    entryChecks++
  }
  for (const role of INTERNAL) check(await asRole(role, e.method, '/api' + e.example) === 'next', `internal ${role} ${e.method} ${e.example}`)
}

// ── denied samples (no external role may reach these) ──
const DENIED_ALL = [
  ['GET', '/procurement/pos/check-duplicate?po_number=X&project_id=1'], ['GET', '/expediting/forwarders'],
  ['POST', '/traceability/cert/5/version'], ['GET', '/traceability/cert/5/file'], ['POST', '/traceability/hold/3/chase'],
  ['POST', '/expediting/27/vdrl/packages'], ['POST', '/expediting/27/vdrl/documents'], ['POST', '/expediting/27/vdrl/documents/9/file'],
  ['POST', '/expediting/27/vdrl/upload'], ['PUT', '/expediting/27/vdrl/documents/9'], ['GET', '/expediting/27/vdrl/packages'],
  ['GET', '/expediting/27/vdrl/documents'], ['GET', '/expediting/27/register'], ['GET', '/expediting/27/action-log'],
  ['GET', '/procurement/27/pos'], ['GET', '/procurement/pos/5'], ['GET', '/procurement/pos/5/documents'],
  ['GET', '/procurement/pos/5/documents/2/download'], ['GET', '/procurement/27/stats'], ['GET', '/procurement/users/list'],
  ['POST', '/procurement/27/pos'], ['PUT', '/procurement/pos/5'], ['GET', '/dashboard/27'], ['GET', '/dashboard/27/exceptions'],
  ['GET', '/admin/users'], ['POST', '/admin/users'], ['GET', '/admin/suppliers'], ['GET', '/reports/27/datasets'], ['GET', '/audit'],
  ['GET', '/documents/27'], ['GET', '/documents/27/summary'], ['GET', '/documents/27/export'],
  ['GET', '/documents/27/download/vdrl:9'], ['GET', '/mto/27'], ['GET', '/mto/27/1/lines'], ['GET', '/pre-award/27/tenders'],
  ['POST', '/pending-changes/27/submit'], ['GET', '/traceability/27/summary'], ['POST', '/traceability/27/cert'],
  ['POST', '/rfi-meeting/27'], ['GET', '/rfi-meeting/27/users'], ['GET', '/rfi-meeting/27/link-options/po'], ['PATCH', '/rfi-meeting/27/5'],
  ['PATCH', '/rfi-meeting/27/5/link'], ['POST', '/rfi-meeting/27/5/actions'], ['POST', '/rfi-meeting/27/5/attendees'],
  ['DELETE', '/rfi-meeting/27/5/attendees/2'], ['PUT', '/logistics/scn/12/critical-path'], ['DELETE', '/logistics/scn/12/packages/3'],
  ['GET', '/mc/27/receipting'], ['GET', '/mc/27/transfers'], ['PUT', '/mc/27/fmr/8/approve'], ['POST', '/mc/27/fmr/8/issue'],
  ['GET', '/foundational/27/wbs/5/pos'], ['GET', '/foundational/27/commodities'], ['POST', '/foundational/27/wbs'],
  ['POST', '/projects'], ['DELETE', '/projects/27'], ['GET', '/projects/27/pos'],
]
const ROLE_DENIED = {
  vendor: [['GET', '/logistics/register/27'], ['GET', '/mc/27/stock'], ['POST', '/mc/27/fmr'], ['GET', '/foundational/27/wbs'], ['GET', '/traceability/27/heat-status'], ['GET', '/documents/27/download/logistics:4']],
  freight_forwarder: [['GET', '/mc/27/stock'], ['POST', '/mc/27/fmr'], ['GET', '/foundational/27/wbs'], ['GET', '/traceability/27/heat/H1']],
  site_contractor: [['GET', '/logistics/register/27'], ['GET', '/logistics/scn/12'], ['POST', '/logistics/scn/12/documents'], ['GET', '/documents/27/download/logistics:4']],
  subcontractor: [['GET', '/traceability/27/heat-status'], ['GET', '/traceability/27/heat/H1'], ['GET', '/foundational/27/wbs'], ['GET', '/logistics/scn/12'], ['GET', '/documents/27/download/logistics:4']],
}
const deniedPerRole = {}
for (const role of EXT) {
  deniedPerRole[role] = 0
  for (const [m, p] of [...DENIED_ALL, ...ROLE_DENIED[role]]) {
    check(!allowedFor(role, m, p.split('?')[0]), `sample is not in ALLOW for ${role}: ${m} ${p}`)
    check(denied(await asRole(role, m, '/api' + p)), `${role} refused ${m} ${p}`); deniedPerRole[role]++
  }
  check(deniedPerRole[role] >= 40, `at least 40 denied samples for ${role}`)
}
// internal roles always pass, allowed and denied samples alike
let internalChecks = 0
const queriesBefore = queries
for (const role of INTERNAL) for (const [m, p] of [...DENIED_ALL, ...Object.values(ROLE_DENIED).flat()]) { check(await asRole(role, m, '/api' + p) === 'next', `internal ${role} ${m} ${p}`); internalChecks++ }
check(queries === queriesBefore, 'internal roles: no users-row query')

// ── tokens: none, malformed, bad signature, expired, no role → passed on to the routers ──
const passOn = [
  ['no header', undefined], ['empty header', ''], ['Bearer only', 'Bearer'], ['Basic scheme', 'Basic abc'],
  ['bad signature', 'Bearer ' + jwt.sign({ id: 1, role: 'vendor' }, JWT_SECRET + 'x')], ['garbage', 'Bearer not.a.token'],
  ['expired', 'Bearer ' + sign({ id: 1, role: 'vendor' }, { expiresIn: -10 })], ['no role', 'Bearer ' + sign({ id: 1 })],
  ['role null', 'Bearer ' + sign({ id: 1, role: null })], ['role in other case', 'Bearer ' + sign({ id: 1, role: 'Vendor' })],
]
for (const [name, h] of passOn) check(await run('GET', '/api/admin/users', h) === 'next', 'passes on: ' + name)

// ── open auth routes stay outside the gate even with an external token ──
for (const role of EXT) {
  check(await asRole(role, 'POST', '/api/auth/login') === 'next', role + ' POST /auth/login passes')
  check(await asRole(role, 'POST', '/api/auth/forgot-password') === 'next', role + ' POST /auth/forgot-password passes')
  check(denied(await asRole(role, 'GET', '/api/auth/login')), role + ' GET /auth/login refused (method)')
}

// ── query strings, trailing slashes, methods, case, traversal ──
const forms = [
  ['GET', '/api/projects?sort=name&x=/api/admin', 'next'], ['GET', '/api/projects/', 'next'], ['GET', '/api/rfi-meeting/27/5/', 'next'],
  ['GET', '/api/admin/users?x=/api/projects', 'deny'], ['GET', '/api/admin/', 'deny'], ['GET', '/api/projects#frag', 'next'],
  ['POST', '/api/projects', 'deny'], ['DELETE', '/api/rfi-meeting/27/5', 'deny'], ['HEAD', '/api/projects', 'deny'], ['PUT', '/api/projects/27', 'deny'],
  ['GET', '/API/PROJECTS', 'next'], ['GET', '/api/Projects/27', 'next'], ['GET', '/api/Admin/users', 'deny'], ['GET', '/API/ADMIN/USERS', 'deny'],
  ['GET', '/api/projects/../admin', 'deny'], ['GET', '/api/projects/../admin/users', 'deny'], ['GET', '/api/projects/%2e%2e/admin', 'deny'],
  ['GET', '/api/projects/..%2fadmin', 'deny'], ['GET', '/api/projects/%2E%2E%2Fadmin', 'deny'], ['GET', '/api/projects//27', 'deny'],
  ['GET', '/api//projects', 'deny'], ['GET', '/api/rfi-meeting/27/./5', 'deny'], ['GET', '/api/projects\\..\\admin', 'deny'],
  ['GET', '/api/projects/27%00', 'deny'], ['GET', '/api/projects/27x', 'deny'], ['GET', '/api/projects/-1', 'deny'],
  ['GET', '/api/projectsX', 'deny'], ['GET', '/api/xprojects', 'deny'], ['GET', '/api/projects/27/../../admin', 'deny'],
  ['GET', '/apiprojects', 'deny'], ['GET', '/projects', 'deny'], ['GET', 'http://host/api/projects', 'deny'],
]
for (const role of EXT) for (const [m, url, want] of forms) {
  const r = await asRole(role, m, url)
  check(want === 'next' ? r === 'next' : denied(r), `${role} ${m} ${url} → ${want}`)
}
for (const role of INTERNAL.slice(0, 3)) for (const [m, url] of forms) check(await asRole(role, m, url) === 'next', `internal ${role} ${m} ${url}`)

// Forms that would match an ALLOW pattern if the path checks were missing: an allowed path
// as a suffix (start anchor), and dot or encoded segments where heat/:heat takes any segment.
for (const [role, m, url] of [['vendor', 'GET', '/api/admin/projects'], ['vendor', 'GET', '/api/admin/auth/me'], ['vendor', 'GET', '/api/x/rfi-meeting/27'],
  ['site_contractor', 'GET', '/api/traceability/27/heat/..'], ['site_contractor', 'GET', '/api/traceability/27/heat/.'],
  ['site_contractor', 'GET', '/api/traceability/27/heat/%2e%2e'], ['site_contractor', 'GET', '/api/traceability/27/heat/%2F'],
  ['site_contractor', 'GET', '/api/traceability/27/heat/x%00']]) check(denied(await asRole(role, m, url)), `${role} ${m} ${url} refused`)
for (const [p, want] of [['/projects//27', true], ['//projects', true], ['/projects\\27', true], ['/projects/%2F27', true], ['/projects/%2e', true],
  ['/projects/%5C', true], ['/projects/27%00', true], ['/projects/./27', true], ['/projects/../admin', true], ['/projects/27', false], ['/traceability/27/heat/H%20123', false]])
  check(G.unsafePath(p) === want, `unsafePath(${p}) === ${want}`)

// ── role-specific spot checks ──
check(await asRole('site_contractor', 'GET', '/api/traceability/27/heat/H%20123') === 'next', 'site_contractor heat with an encoded space')
check(denied(await asRole('subcontractor', 'GET', '/api/traceability/27/heat/H1')), 'subcontractor heat refused (no traceability grant)')
check(await asRole('subcontractor', 'GET', '/api/mc/27/stock') === 'next' && await asRole('subcontractor', 'POST', '/api/mc/27/fmr') === 'next', 'subcontractor stock and FMR raise')
check(denied(await asRole('vendor', 'POST', '/api/expediting/27/vdrl/upload')), 'vendor bulk VDRL upload refused')
// ext-1b: the forwarder may download logistics documents (documents.js checks the carrier or packer);
// only the exact form 'logistics:' followed by digits; every other module and form is refused.
for (const url of ['/api/documents/27/download/logistics:4', '/api/documents/27/download/logistics:4/', '/api/documents/27/download/logistics:1978?x=1', '/api/Documents/27/Download/LOGISTICS:4'])
  check(await asRole('freight_forwarder', 'GET', url) === 'next', `forwarder ${url} passes the gate`)
for (const url of ['/api/documents/27/download/vdrl:4', '/api/documents/27/download/traceability:4', '/api/documents/27/download/procurement:4', '/api/documents/27/download/logistics:',
  '/api/documents/27/download/logistics:4x', '/api/documents/27/download/logistics:-4', '/api/documents/27/download/logistics::4', '/api/documents/27/download/logistics:4:5',
  '/api/documents/27/download/logistics%3A4', '/api/documents/27/download/logistics:4%00', '/api/documents/27/download/../download/logistics:4', '/api/documents/27/download//logistics:4',
  '/api/documents/27/download/logistics:4/..', '/api/documents/x/download/logistics:4', '/api/documents/27/download/logistics:4/file', '/api/documents/27', '/api/documents/27/summary'])
  check(denied(await asRole('freight_forwarder', 'GET', url)), `forwarder ${url} refused`)
for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) check(denied(await asRole('freight_forwarder', m, '/api/documents/27/download/logistics:4')), `forwarder ${m} logistics download refused`)

console.log(`externalGate: ${pass} passed, ${fail} failed (${G.ALLOW.length} ALLOW entries x ${EXT.length} external roles = ${entryChecks}; denied samples per role ${EXT.map(r => r + ' ' + deniedPerRole[r]).join(', ')}; ${internalChecks} internal-role passes)`)
process.exit(fail ? 1 : 0)
})()
