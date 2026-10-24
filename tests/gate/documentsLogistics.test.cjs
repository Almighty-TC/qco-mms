// ext-1b — logistics document downloads for freight forwarders: server/routes/documents.js (carrier or
// delegated packer only) and the gate entry in server/lib/externalGate.js. The real documents router
// over a fake db with a stubbed blob store (no database, no files); internal roles compared with
// documents.js at 1a81ce6 (git show). Tokens are signed here and never printed.
// Exit code 1 on any failure. Usage: node tests/gate/documentsLogistics.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const DOCS = path.join(ROOT, 'routes/documents.js')
const GATE = path.join(ROOT, 'lib/externalGate.js')
const DOCS_SRC = fs.readFileSync(DOCS, 'utf8')
const GATE_SRC = fs.readFileSync(GATE, 'utf8')
const DOCS_BEFORE = execFileSync('git', ['-C', REPO, 'show', '1a81ce6:server/routes/documents.js'], { encoding: 'utf8' })

// ── fakes: documents on SCNs (carrier 685; delegated packer 690 on SCN 3, carrier 691); no file on 12 ──
const DOCS_ROWS = { 10: { scn: 1, file: 'uploads/logistics/a.pdf' }, 11: { scn: 2, file: 'uploads/logistics/b.pdf' }, 12: { scn: 1, file: null }, 13: { scn: 3, file: 'uploads/logistics/c.pdf' } }
const SCNS = { 1: { forwarder_user_id: 685, packaging_delegated_to: null }, 2: { forwarder_user_id: 712, packaging_delegated_to: null }, 3: { forwarder_user_id: 691, packaging_delegated_to: 690 } }
let calls = []
const fakeDb = { query: async (sql, params = []) => {
  const q = sql.replace(/\s+/g, ' ').trim()
  calls.push({ q, params })
  if (/^SELECT id FROM user_wbs_access/.test(q)) return [[{ id: 1 }], []]
  if (/^SELECT d\.file_name, d\.file_path FROM scn_documents d JOIN shipment_control_notes s ON s\.id = d\.scn_id WHERE d\.id=\? AND s\.project_id=\?$/.test(q)) {
    const d = DOCS_ROWS[params[0]]; return [d && params[1] === 27 && SCNS[d.scn] ? [{ file_name: 'doc.pdf', file_path: d.file }] : [], []]
  }
  if (/^SELECT s\.forwarder_user_id, s\.packaging_delegated_to FROM scn_documents d JOIN shipment_control_notes s ON s\.id = d\.scn_id WHERE d\.id=\?$/.test(q)) {
    const d = DOCS_ROWS[params[0]]; return [d && SCNS[d.scn] ? [{ ...SCNS[d.scn] }] : [], []]
  }
  if (/^INSERT INTO audit_log/.test(q)) return [{ insertId: 1 }, undefined]
  throw new Error('unexpected query: ' + q.slice(0, 90))
} }
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve(path.join(ROOT, 'db.js')), fakeDb)
stub(require.resolve(path.join(ROOT, 'lib/blobStore.js')), {
  getFile: async () => ({ pipe: res => res.end('FILE') }), keyFor: (m, p) => `${m}/${path.basename(String(p))}`,
  persist: async () => { throw new Error('no writes in this test') },
})
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'))
const { JWT_SECRET } = require(path.join(ROOT, 'middleware/auth'))
const tok = (id, role) => 'Bearer ' + jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '10m' })

function compile(file, src) {
  const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(src, file); return m.exports
}
const download = (router, id, role, url) => new Promise(resolve => {
  const req = { method: 'GET', url, originalUrl: '/api/documents' + url, headers: { authorization: tok(id, role) }, query: {}, body: {}, ip: '127.0.0.1' }
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] },
    status(c) { this.statusCode = c; return this }, json(o) { resolve({ status: this.statusCode, body: o }) }, end(b) { resolve({ status: this.statusCode, body: String(b), headers: this.headers }) } }
  router(req, res, err => resolve({ status: err ? 500 : 404, body: { fellThrough: true } }))
})

async function suite(docsSrc, gateSrc) {
  const R = compile(DOCS, docsSrc), G = compile(GATE, gateSrc)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const go = async (id, role, url) => { calls = []; return download(R, id, role, url) }
  const linkQueries = () => calls.filter(c => c.q.startsWith('SELECT s.forwarder_user_id')).length

  // route: the carrier, the delegated packer, unlinked forwarders, a document with no SCN or no file
  let r = await go(685, 'freight_forwarder', '/27/download/logistics:10')
  check(r.status === 200 && r.body === 'FILE', 'carrier 685, its SCN: file streamed')
  r = await go(690, 'freight_forwarder', '/27/download/logistics:13')
  check(r.status === 200 && r.body === 'FILE', 'delegated packer 690 (not the carrier): file streamed')
  r = await go(691, 'freight_forwarder', '/27/download/logistics:13')
  check(r.status === 200, 'carrier 691 of the delegated SCN: file streamed')
  for (const [id, doc, name] of [[685, 11, 'another carrier\'s SCN'], [690, 10, 'a packer on another SCN'], [712, 10, 'forwarder 712 on 685\'s SCN'], [685, 13, 'neither carrier nor packer']]) {
    r = await go(id, 'freight_forwarder', `/27/download/logistics:${doc}`)
    check(r.status === 403 && r.body.error === 'You are not linked to this SCN.' && !calls.some(c => c.q.startsWith('INSERT INTO audit_log')), `${name}: 403, no download audited`)
  }
  r = await go(712, 'freight_forwarder', '/27/download/logistics:12')
  check(r.status === 403, 'unlinked forwarder, document without a file: 403 before the file check')
  r = await go(685, 'freight_forwarder', '/27/download/logistics:12')
  check(r.status === 404 && r.body.error === 'No file is stored for this document yet', 'carrier, no file: 404 as before')
  r = await go(685, 'freight_forwarder', '/27/download/logistics:99')
  check(r.status === 404 && r.body.error === 'Document not found in this project' && linkQueries() === 0, 'a document with no SCN: 404, no link query')
  // internal roles: no link query; same answers as 1a81ce6
  for (const [id, role] of [[4, 'admin'], [24, 'project_manager'], [26, 'logistics_manager']]) {
    for (const doc of [10, 11, 12, 13, 99]) {
      r = await go(id, role, `/27/download/logistics:${doc}`)
      check(linkQueries() === 0 && r.status === (doc === 12 || doc === 99 ? 404 : 200), `${role} logistics:${doc}: answered without the link check`)
    }
  }
  // gate entry
  check(G.isAllowed('freight_forwarder', 'GET', '/documents/27/download/logistics:4'), 'gate: forwarder GET logistics:<digits> allowed')
  for (const role of ['vendor', 'site_contractor', 'subcontractor']) check(!G.isAllowed(role, 'GET', '/documents/27/download/logistics:4'), `gate: ${role} refused`)
  for (const p of ['/documents/27/download/logistics:4x', '/documents/27/download/logistics:', '/documents/27/download/vdrl:4', '/documents/27/download/logistics:4/x', '/documents/x/download/logistics:4'])
    check(!G.isAllowed('freight_forwarder', 'GET', p), `gate: forwarder ${p} refused`)
  check(!G.isAllowed('freight_forwarder', 'POST', '/documents/27/download/logistics:4'), 'gate: forwarder POST refused')
  return { pass, fail, failed, R }
}

// Internal roles: every answer equal to documents.js at 1a81ce6.
async function internalSame(docsSrc) {
  const N = compile(DOCS, docsSrc), B = compile(DOCS, DOCS_BEFORE)
  let same = 0, total = 0
  for (const [id, role] of [[4, 'admin'], [24, 'project_manager'], [26, 'logistics_manager']]) for (const doc of [10, 11, 12, 13, 99]) {
    calls = []; const n = await download(N, id, role, `/27/download/logistics:${doc}`); const nq = calls
    calls = []; const b = await download(B, id, role, `/27/download/logistics:${doc}`); const bq = calls
    total++; if (JSON.stringify(n) === JSON.stringify(b) && JSON.stringify(nq) === JSON.stringify(bq)) same++
  }
  return { same, total }
}

const DOC_MUTANTS = [
  ['no forwarder check', s => s.replace("if (user?.role === 'freight_forwarder') {", 'if (false) {')],
  ['carrier only', s => s.replace("if (!carrier && !(s && isPackagingDelegate(s.packaging_delegated_to, user.id))) {", 'if (!carrier) {')],
  ['packer only', s => s.replace('const carrier = !!s && s.forwarder_user_id != null && s.forwarder_user_id === user.id', 'const carrier = false')],
  ['carrier compared loosely', s => s.replace('s.forwarder_user_id === user.id', 's.forwarder_user_id != null')],
  ['check after the file check', s => s.replace("    if (!d) return { code: 'not_found' }\n    // ext-1b:", "    if (!d) return { code: 'not_found' }\n    if (!d.file_path) return { code: 'no_file' }\n    // ext-1b:")],
  ['forbidden answered as 404', s => s.replace("if (r.code === 'forbidden') return res.status(403).json({ error: r.error })", "if (r.code === 'forbidden') return res.status(404).json({ error: 'Document not found in this project' })")],
  ['user not passed', s => s.replace('const r = await resolver(id, pid, req.user)', 'const r = await resolver(id, pid)')],
  ['every role checked', s => s.replace("if (user?.role === 'freight_forwarder') {", 'if (user) {')],
]
const GATE_MUTANTS = [
  ['loose pattern', s => s.replace('re(`/documents/${ID}/download/logistics:${ID}`)', 're(`/documents/${ID}/download/logistics:[^/]+`)')],
  ['any module', s => s.replace('re(`/documents/${ID}/download/logistics:${ID}`)', 're(`/documents/${ID}/download/[a-z]+:${ID}`)')],
  ['all external roles', s => s.replace("{ roles: FF, method: 'GET',    re: re(`/documents/", "{ roles: ALL, method: 'GET',    re: re(`/documents/")],
  ['entry removed', s => s.replace(/ {2}\{ roles: FF, method: 'GET', {4}re: re\(`\/documents\/[^\n]*\n/, '')],
]

;(async () => {
  const r = await suite(DOCS_SRC, GATE_SRC)
  const I = await internalSame(DOCS_SRC)
  r.failed.forEach(n => console.log('FAIL ' + n))
  const fail = r.fail + (I.same === I.total ? 0 : 1)
  console.log(`documentsLogistics: ${r.pass + (I.same === I.total ? 1 : 0)} passed, ${fail} failed (internal roles identical to 1a81ce6 on ${I.same} of ${I.total} downloads, answers and queries)`)
  if (process.argv.includes('--mutation')) {
    let killed = 0, total = 0
    for (const [list, which] of [[DOC_MUTANTS, 'docs'], [GATE_MUTANTS, 'gate']]) for (const [name, mutate] of list) {
      total++
      const base = which === 'docs' ? DOCS_SRC : GATE_SRC, m = mutate(base)
      if (m === base) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      let bad
      try { const s = which === 'docs' ? await suite(m, GATE_SRC) : await suite(DOCS_SRC, m); const i = which === 'docs' ? await internalSame(m) : I; bad = s.fail > 0 || i.same !== i.total } catch (e) { bad = true }
      if (bad) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${total} killed`)
    if (killed !== total) process.exitCode = 1
  }
  if (fail) process.exitCode = 1
})()
