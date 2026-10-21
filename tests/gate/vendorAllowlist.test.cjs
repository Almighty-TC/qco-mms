// P2f — the vendor entries of the external gate's allowlist (server/lib/externalGate.js): each entry
// allowed for a linked vendor and refused for the other external roles; every route outside them
// (PO notes, audit, date history, expeditors, stats, templates, VDRL creation, the documents list,
// other modules, wrong methods, traversal and encoded forms) refused; the non-vendor entries
// unchanged against 7bed3d5 (git show). Fake users-row db; tokens signed here, never printed.
// Exit code 1 on any failure. Usage: node tests/gate/vendorAllowlist.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const GATE = path.join(ROOT, 'lib/externalGate.js')
const SOURCE = fs.readFileSync(GATE, 'utf8')
const BEFORE = execFileSync('git', ['-C', REPO, 'show', '7bed3d5:server/lib/externalGate.js'], { encoding: 'utf8' })

const IDS = { vendor: 711, freight_forwarder: 702, site_contractor: 703, subcontractor: 704 }
const fakeDb = { query: async (sql, params = []) => {
  const role = Object.keys(IDS).find(r => IDS[r] === params[0])
  return [role ? [{ role, is_active: 1, is_external: 1, supplier_id: role === 'vendor' ? 326 : null }] : []]
} }
const dbPath = require.resolve(path.join(ROOT, 'db.js'))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb }
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'))
const { JWT_SECRET } = require(path.join(ROOT, 'middleware/auth'))
const tok = role => 'Bearer ' + jwt.sign({ id: IDS[role], role }, JWT_SECRET, { expiresIn: '10m' })
function compile(src) { const m = new Module(GATE, module); m.filename = GATE; m.paths = Module._nodeModulePaths(path.dirname(GATE)); m._compile(src, GATE); return m.exports }
const run = (G, role, method, url) => new Promise(resolve => {
  const req = { method, originalUrl: url, url: url.replace(/^\/api/i, '') || '/', headers: { authorization: tok(role) } }
  const res = { status(c) { this.code = c; return this }, json(b) { resolve({ status: this.code, body: b }); return this } }
  Promise.resolve(G.externalGate(req, res, () => resolve('next'))).catch(e => resolve({ status: 'threw', body: e.message }))
})
const denied = r => r && r !== 'next' && r.status === 403 && r.body && r.body.error === 'Not available to your role'

// The vendor routes (method, a matching path, and more forms of it).
const VENDOR = [
  ['GET', '/procurement/27/pos', ['/procurement/1/pos?page=2&q=status:approved', '/procurement/27/pos/']],
  ['GET', '/procurement/pos/5', ['/procurement/pos/2059', '/PROCUREMENT/POS/5']],
  ['GET', '/procurement/pos/5/itp', ['/procurement/pos/2101/itp']],
  ['GET', '/procurement/pos/5/variations', ['/procurement/pos/2059/variations/']],
  ['GET', '/procurement/pos/5/documents', ['/procurement/pos/1990/documents']],
  ['GET', '/procurement/pos/5/documents/2/download', ['/procurement/pos/1990/documents/7/download']],
  ['GET', '/expediting/27/vdrl/packages', ['/expediting/27/vdrl/packages?x=1']],
  ['GET', '/expediting/27/vdrl/documents', ['/expediting/27/vdrl/documents?package_id=3&status=Overdue']],
  ['GET', '/expediting/27/vdrl/stats', []], ['GET', '/expediting/27/vdrl/po-list', []],
  ['POST', '/expediting/27/vdrl/documents/9/file', ['/expediting/27/vdrl/documents/3810/file']],
  ['GET', '/documents/27/download/vdrl:9', ['/documents/27/download/vdrl:3810']],
  ['GET', '/traceability/27/summary', []], ['GET', '/traceability/27/vdrl', ['/traceability/27/vdrl?status=pending&q=x']], ['GET', '/traceability/27/tags', []],
  ['GET', '/traceability/27/cert/5', ['/traceability/27/cert/3301']], ['POST', '/traceability/27/cert', []],
  ['POST', '/traceability/cert/5/version', ['/traceability/cert/3301/version']], ['GET', '/traceability/cert/5/file', ['/traceability/cert/3301/file']],
  ['GET', '/documents/27/download/traceability:5', ['/documents/27/download/traceability:3301']],
]
// Refused for the vendor: excluded routes, wrong methods, other modules, traversal and encoded forms.
const REFUSED = [
  // PO routes outside the view
  ['GET', '/procurement/pos/5/notes'], ['POST', '/procurement/pos/5/notes'], ['GET', '/procurement/pos/5/audit'], ['GET', '/procurement/pos/5/date-history'],
  ['GET', '/procurement/pos/5/expeditors'], ['POST', '/procurement/pos/5/expeditors'], ['DELETE', '/procurement/pos/5/expeditors/3'], ['PUT', '/procurement/pos/5/expeditor'],
  ['GET', '/procurement/27/stats'], ['GET', '/procurement/template/po-upload'], ['PUT', '/procurement/pos/5'], ['DELETE', '/procurement/pos/5'],
  ['POST', '/procurement/pos/5/documents'], ['POST', '/procurement/pos/5/itp'], ['POST', '/procurement/pos/5/variations'], ['POST', '/procurement/pos/5/lines'],
  ['PATCH', '/procurement/pos/5/approve'], ['PATCH', '/procurement/pos/5/reject'], ['PATCH', '/procurement/pos/5/star'], ['PUT', '/procurement/pos/5/critical-path'],
  ['PUT', '/procurement/pos/5/owner'], ['PUT', '/procurement/pos/5/replace'], ['POST', '/procurement/27/pos'], ['GET', '/procurement/pos/check-duplicate'],
  ['GET', '/procurement/users/list'], ['GET', '/procurement/27/wbs'],
  // VDRL creation, edits, template, register
  ['POST', '/expediting/27/vdrl/documents'], ['POST', '/expediting/27/vdrl/packages'], ['POST', '/expediting/27/vdrl/upload'], ['PUT', '/expediting/27/vdrl/documents/9'],
  ['GET', '/expediting/27/vdrl/template'], ['GET', '/expediting/27/register'], ['GET', '/expediting/27/action-log'], ['GET', '/expediting/forwarders'],
  // the documents list and other modules' downloads
  ['GET', '/documents/27'], ['GET', '/documents/27/summary'], ['GET', '/documents/27/export'], ['GET', '/documents/27/download/logistics:4'],
  ['GET', '/documents/27/download/procurement:4'], ['GET', '/documents/27/download/mto:4'],
  // traceability outside the view
  ['GET', '/traceability/27/approvals'], ['POST', '/traceability/cert/5/verify'], ['POST', '/traceability/cert/5/reject'], ['GET', '/traceability/27/holds'],
  ['POST', '/traceability/hold/3/chase'], ['GET', '/traceability/27/trace/T1'], ['GET', '/traceability/27/heat/H1'], ['GET', '/traceability/27/heat-status'],
  // wrong methods on vendor paths
  ['POST', '/procurement/pos/5/itp/x'], ['DELETE', '/expediting/27/vdrl/documents/9/file'], ['GET', '/expediting/27/vdrl/documents/9/file'], ['PUT', '/traceability/cert/5/file'],
  ['GET', '/traceability/cert/5/version'], ['POST', '/traceability/27/summary'], ['DELETE', '/traceability/27/cert/5'], ['HEAD', '/procurement/27/pos'], ['PATCH', '/documents/27/download/vdrl:9'],
  // other modules
  ['GET', '/admin/users'], ['GET', '/mto/27'], ['GET', '/pre-award/27/tenders'], ['GET', '/logistics/register/27'], ['GET', '/mc/27/stock'], ['GET', '/dashboard/27'],
  ['GET', '/reports/27/datasets'], ['GET', '/audit'], ['POST', '/pending-changes/27/submit'], ['GET', '/foundational/27/wbs'],
  // traversal, encoded and malformed forms
  ['GET', '/procurement/pos/5/../5'], ['GET', '/procurement//27/pos'], ['GET', '/procurement/pos/5%2F'], ['GET', '/procurement/pos/%2e%2e/5'], ['GET', '/procurement/pos/5x'],
  ['GET', '/procurement/pos/-5'], ['GET', '/procurement/pos/5/documents/2/download/x'], ['GET', '/documents/27/download/vdrl:9x'], ['GET', '/documents/27/download/vdrl:'],
  ['GET', '/documents/27/download/vdrl%3A9'], ['GET', '/documents/27/download/traceability:5/..'], ['GET', '/documents/27/download/vdrl:9%00'],
  ['GET', '/traceability/cert/5/file\\..'], ['GET', '/expediting/27/vdrl/./packages'], ['GET', '/traceability/27/cert/5/extra'], ['POST', '/traceability/cert/x/version'],
]

async function suite(src) {
  const G = compile(src)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  for (const [m, p, more] of VENDOR) {
    for (const u of [p, ...more]) check(await run(G, 'vendor', m, '/api' + u) === 'next', `vendor ${m} ${u} allowed`)
    for (const role of ['freight_forwarder', 'site_contractor', 'subcontractor']) check(denied(await run(G, role, m, '/api' + p)), `${role} ${m} ${p} refused`)
  }
  check(G.ALLOW.filter(e => e.roles.length === 1 && e.roles[0] === 'vendor').length === VENDOR.length, `${VENDOR.length} vendor-only entries`)
  let refusedCount = 0
  for (const [m, p] of REFUSED) { check(denied(await run(G, 'vendor', m, '/api' + p)), `vendor ${m} ${p} refused`); refusedCount++ }
  check(refusedCount >= 60, `at least 60 refused vendor samples (${refusedCount})`)
  // every non-vendor entry exactly as at 7bed3d5
  const shape = e => JSON.stringify([e.roles, e.method, e.re.source, e.re.flags, e.example])
  const before = compile(BEFORE).ALLOW.map(shape), now = G.ALLOW.filter(e => !(e.roles.length === 1 && e.roles[0] === 'vendor')).map(shape)
  check(JSON.stringify(before) === JSON.stringify(now), 'forwarder, contractor and common entries unchanged')
  return { pass, fail, failed, refusedCount }
}

const MUTANTS = [
  ['PO id any segment', s => s.replace("re: re(`/procurement/pos/${ID}`), example: '/procurement/pos/5' }", "re: re(`/procurement/pos/[^/]+`), example: '/procurement/pos/5' }")],
  ['vdrl download any id', s => s.replace('re(`/documents/${ID}/download/vdrl:${ID}`)', 're(`/documents/${ID}/download/vdrl:[^/]+`)')],
  ['any download module for vendors', s => s.replace('re(`/documents/${ID}/download/traceability:${ID}`)', 're(`/documents/${ID}/download/[a-z]+:${ID}`)')],
  ['vendor entry for all roles', s => s.replace("{ roles: V, method: 'GET',  re: re(`/procurement/${ID}/pos`)", "{ roles: ALL, method: 'GET',  re: re(`/procurement/${ID}/pos`)")],
  ['V includes the forwarder', s => s.replace("const V = ['vendor']", "const V = ['vendor', 'freight_forwarder']")],
  ['entry removed', s => s.replace(/ {2}\{ roles: V, method: 'GET', {2}re: re\(`\/traceability\/\$\{ID\}\/summary`\)[^\n]*\n/, '')],
  ['file upload as GET', s => s.replace("{ roles: V, method: 'POST', re: re(`/expediting/${ID}/vdrl/documents/${ID}/file`)", "{ roles: V, method: 'GET', re: re(`/expediting/${ID}/vdrl/documents/${ID}/file`)")],
  ['vendor documents list', s => s.replace("re(`/expediting/${ID}/vdrl/documents`), example", "re(`/expediting/${ID}/vdrl/documents(/.*)?`), example")],
  ['PO notes for vendors', s => s.replace("{ roles: V, method: 'GET',  re: re(`/procurement/pos/${ID}/itp`)", "{ roles: V, method: 'GET',  re: re(`/procurement/pos/${ID}/(itp|notes)`)")],
  ['vendor on the logistics register', s => s.replace("{ roles: FF, method: 'GET',    re: re(`/logistics/register/${ID}`)", "{ roles: [...FF, 'vendor'], method: 'GET',    re: re(`/logistics/register/${ID}`)")],
]
// (Removing the unsafe-path check is an equivalent mutant here: every vendor pattern takes digits
// only, so no unsafe path can match one; tests/gate/externalGate.test.cjs covers that check
// through the site_contractor heat/<any> entry.)

;(async () => {
  const r = await suite(SOURCE)
  r.failed.forEach(n => console.log('FAIL ' + n))
  console.log(`vendorAllowlist: ${r.pass} passed, ${r.fail} failed (${VENDOR.length} vendor entries, ${r.refusedCount} refused vendor samples)`)
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
