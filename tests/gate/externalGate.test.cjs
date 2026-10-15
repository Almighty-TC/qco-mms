// External role gate (phase 1) — server/lib/externalGate.js, with fake req and res and no
// database. Exit code 1 on any failure. Usage: node tests/gate/externalGate.test.cjs
// Tokens are signed here with the same secret the gate verifies with; none is printed.
const path = require('path')
const ROOT = path.join(__dirname, '../../server')
// permissions.js requires ../db: give it a stub so this test never opens a connection.
const dbPath = require.resolve(path.join(ROOT, 'db.js'))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => { throw new Error('no database in this test') } } }
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'))
const { JWT_SECRET } = require(path.join(ROOT, 'middleware/auth'))
const G = require(path.join(ROOT, 'lib/externalGate'))
const P = require(path.join(ROOT, 'middleware/permissions'))

let pass = 0, fail = 0
const check = (ok, name) => { if (ok) pass++; else { fail++; console.log('FAIL ' + name) } }
const EXT = ['vendor', 'freight_forwarder', 'site_contractor', 'subcontractor']
const INTERNAL = ['admin', 'viewer', 'auditor', 'procurement_officer', 'procurement_manager', 'expeditor', 'expediting_manager', 'project_manager', 'warehouse', 'materials_engineer']
const sign = (payload, opts = { expiresIn: '10m' }) => jwt.sign(payload, JWT_SECRET, opts)
const tok = role => sign({ id: 700, email: 'gate@test.invalid', full_name: 'gate', role })

// Runs the gate once: 'next' when it passes the request on, else the status and body.
function run(method, url, authorization) {
  let result = null
  const req = { method, originalUrl: url, url: url.replace(/^\/api/i, '') || '/', headers: authorization === undefined ? {} : { authorization } }
  const res = { status(c) { this.code = c; return this }, json(b) { result = { status: this.code, body: b }; return this } }
  G.externalGate(req, res, () => { result = 'next' })
  return result
}
const asRole = (role, method, url) => run(method, url, 'Bearer ' + tok(role))
const DENY = { status: 403, body: { error: 'Not available to your role' } }
const denied = r => r && r !== 'next' && r.status === 403 && JSON.stringify(r.body) === JSON.stringify(DENY.body)
const allowedFor = (role, method, p) => G.ALLOW.some(e => e.method === method && e.roles.includes(role) && e.re.test(p))

// ── the role list matches requireProjectScope's ──
check(JSON.stringify([...G.EXTERNAL_ROLES].sort()) === JSON.stringify([...P.EXTERNAL_ROLES].sort()), 'EXTERNAL_ROLES equals permissions.EXTERNAL_ROLES')

// ── every ALLOW entry: passes for its roles, refused for the other external roles ──
let entryChecks = 0
for (const e of G.ALLOW) {
  check(e.re.test(e.example), 'example matches its own pattern ' + e.example)
  for (const role of EXT) {
    const r = asRole(role, e.method, '/api' + e.example), want = allowedFor(role, e.method, e.example)
    check(want ? r === 'next' : denied(r), `${e.method} ${e.example} for ${role}: expected ${want ? 'pass' : '403'}`)
    entryChecks++
  }
  for (const role of INTERNAL) check(asRole(role, e.method, '/api' + e.example) === 'next', `internal ${role} ${e.method} ${e.example}`)
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
  ['GET', '/documents/27'], ['GET', '/documents/27/summary'], ['GET', '/documents/27/export'], ['GET', '/documents/27/download/logistics:4'],
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
  vendor: [['GET', '/logistics/register/27'], ['GET', '/mc/27/stock'], ['POST', '/mc/27/fmr'], ['GET', '/foundational/27/wbs'], ['GET', '/traceability/27/heat-status']],
  freight_forwarder: [['GET', '/mc/27/stock'], ['POST', '/mc/27/fmr'], ['GET', '/foundational/27/wbs'], ['GET', '/traceability/27/heat/H1']],
  site_contractor: [['GET', '/logistics/register/27'], ['GET', '/logistics/scn/12'], ['POST', '/logistics/scn/12/documents']],
  subcontractor: [['GET', '/traceability/27/heat-status'], ['GET', '/traceability/27/heat/H1'], ['GET', '/foundational/27/wbs'], ['GET', '/logistics/scn/12']],
}
const deniedPerRole = {}
for (const role of EXT) {
  deniedPerRole[role] = 0
  for (const [m, p] of [...DENIED_ALL, ...ROLE_DENIED[role]]) {
    check(!allowedFor(role, m, p.split('?')[0]), `sample is not in ALLOW for ${role}: ${m} ${p}`)
    check(denied(asRole(role, m, '/api' + p)), `${role} refused ${m} ${p}`); deniedPerRole[role]++
  }
  check(deniedPerRole[role] >= 40, `at least 40 denied samples for ${role}`)
}
// internal roles always pass, allowed and denied samples alike
let internalChecks = 0
for (const role of INTERNAL) for (const [m, p] of [...DENIED_ALL, ...Object.values(ROLE_DENIED).flat()]) { check(asRole(role, m, '/api' + p) === 'next', `internal ${role} ${m} ${p}`); internalChecks++ }

// ── tokens: none, malformed, bad signature, expired, no role → passed on to the routers ──
const passOn = [
  ['no header', undefined], ['empty header', ''], ['Bearer only', 'Bearer'], ['Basic scheme', 'Basic abc'],
  ['bad signature', 'Bearer ' + jwt.sign({ id: 1, role: 'vendor' }, JWT_SECRET + 'x')], ['garbage', 'Bearer not.a.token'],
  ['expired', 'Bearer ' + sign({ id: 1, role: 'vendor' }, { expiresIn: -10 })], ['no role', 'Bearer ' + sign({ id: 1 })],
  ['role null', 'Bearer ' + sign({ id: 1, role: null })], ['role in other case', 'Bearer ' + sign({ id: 1, role: 'Vendor' })],
]
for (const [name, h] of passOn) check(run('GET', '/api/admin/users', h) === 'next', 'passes on: ' + name)

// ── open auth routes stay outside the gate even with an external token ──
for (const role of EXT) {
  check(asRole(role, 'POST', '/api/auth/login') === 'next', role + ' POST /auth/login passes')
  check(asRole(role, 'POST', '/api/auth/forgot-password') === 'next', role + ' POST /auth/forgot-password passes')
  check(denied(asRole(role, 'GET', '/api/auth/login')), role + ' GET /auth/login refused (method)')
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
  const r = asRole(role, m, url)
  check(want === 'next' ? r === 'next' : denied(r), `${role} ${m} ${url} → ${want}`)
}
for (const role of INTERNAL.slice(0, 3)) for (const [m, url] of forms) check(asRole(role, m, url) === 'next', `internal ${role} ${m} ${url}`)

// Forms that would match an ALLOW pattern if the path checks were missing: an allowed path
// as a suffix (start anchor), and dot or encoded segments where heat/:heat takes any segment.
for (const [role, m, url] of [['vendor', 'GET', '/api/admin/projects'], ['vendor', 'GET', '/api/admin/auth/me'], ['vendor', 'GET', '/api/x/rfi-meeting/27'],
  ['site_contractor', 'GET', '/api/traceability/27/heat/..'], ['site_contractor', 'GET', '/api/traceability/27/heat/.'],
  ['site_contractor', 'GET', '/api/traceability/27/heat/%2e%2e'], ['site_contractor', 'GET', '/api/traceability/27/heat/%2F'],
  ['site_contractor', 'GET', '/api/traceability/27/heat/x%00']]) check(denied(asRole(role, m, url)), `${role} ${m} ${url} refused`)
for (const [p, want] of [['/projects//27', true], ['//projects', true], ['/projects\\27', true], ['/projects/%2F27', true], ['/projects/%2e', true],
  ['/projects/%5C', true], ['/projects/27%00', true], ['/projects/./27', true], ['/projects/../admin', true], ['/projects/27', false], ['/traceability/27/heat/H%20123', false]])
  check(G.unsafePath(p) === want, `unsafePath(${p}) === ${want}`)

// ── role-specific spot checks ──
check(asRole('site_contractor', 'GET', '/api/traceability/27/heat/H%20123') === 'next', 'site_contractor heat with an encoded space')
check(denied(asRole('subcontractor', 'GET', '/api/traceability/27/heat/H1')), 'subcontractor heat refused (no traceability grant)')
check(asRole('subcontractor', 'GET', '/api/mc/27/stock') === 'next' && asRole('subcontractor', 'POST', '/api/mc/27/fmr') === 'next', 'subcontractor stock and FMR raise')
check(denied(asRole('vendor', 'POST', '/api/expediting/27/vdrl/upload')), 'vendor bulk VDRL upload refused')
check(denied(asRole('freight_forwarder', 'GET', '/api/documents/27/download/logistics:4')), 'forwarder logistics document download refused (documents.js)')

console.log(`externalGate: ${pass} passed, ${fail} failed (${G.ALLOW.length} ALLOW entries x ${EXT.length} external roles = ${entryChecks}; denied samples per role ${EXT.map(r => r + ' ' + deniedPerRole[r]).join(', ')}; ${internalChecks} internal-role passes)`)
process.exit(fail ? 1 : 0)
