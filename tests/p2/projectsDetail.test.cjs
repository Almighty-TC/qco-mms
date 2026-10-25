// 3T177 — external roles (vendor, freight_forwarder, site_contractor, subcontractor) receive only id, code, name and
// phase from GET /projects/:id in server/routes/projects.js (the identity keys GET / returns), with the values of the
// project row; the refusals (403 without a grant, 404) and every internal-role answer and query equal the file at
// 1285c0d (git show). The real router over a fake db (no database). Exit code 1 on any failure.
// Usage: node tests/p2/projectsDetail.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const PJ = path.join(ROOT, 'routes/projects.js')
const SRC = fs.readFileSync(PJ, 'utf8')
const OLD = execFileSync('git', ['-C', REPO, 'show', '1285c0d:server/routes/projects.js'], { encoding: 'utf8' })   // the file before 3T177

const PROJECTS = [27, 28].map(id => ({ id, code: 'P' + id, name: 'Project ' + id, phase: 'Build', status: 'active', traceability_required: 1, traceability_set_by: 4, traceability_set_at: null,
  rag: id === 27 ? 'red' : 'amber', client: 'Client', start_date: '2026-01-01', end_date: '2027-01-01', total_pos: 12, at_risk: 3, breached: 2, progress_pct: '40.00', created_by: 4,
  created_at: '2026-01-01', updated_at: '2026-01-02', at_risk_days_threshold: 30, approval_threshold_1: '1000.00', approval_threshold_2: '5000.00' }))
const GRANTED = { 711: [27], 685: [27, 99], 713: [27], 714: [27] }   // 99: granted, no such project
const listRow = p => ({ id: p.id, code: p.code, name: p.name, rag: p.rag, phase: p.phase, totalPOs: 12, breached: 2, atRisk: 3 })
const norm = s => s.replace(/\s+/g, ' ').trim()
let calls = []
const fakeDb = { query: async (sql, params = []) => {
  const q = norm(sql)
  calls.push({ q, params })
  if (/^SELECT p\.id, p\.code, p\.name, p\.rag, p\.phase, .* FROM projects p WHERE p\.id IN \(SELECT a\.project_id FROM user_wbs_access a WHERE a\.user_id = \?\) ORDER BY p\.created_at DESC$/.test(q)) return [PROJECTS.filter(p => (GRANTED[params[0]] || []).includes(p.id)).map(listRow), []]
  if (/^SELECT p\.id, p\.code, p\.name, p\.rag, p\.phase, .* FROM projects p ORDER BY p\.created_at DESC$/.test(q)) return [PROJECTS.map(listRow), []]
  if (/^SELECT 1 FROM user_wbs_access WHERE user_id = \? AND project_id = \? LIMIT 1$/.test(q)) return [(GRANTED[params[0]] || []).includes(Number(params[1])) ? [{ 1: 1 }] : [], []]
  if (/^SELECT \* FROM projects WHERE id = \?$/.test(q)) { const p = PROJECTS.find(x => x.id === Number(params[0])); return [p ? [{ ...p }] : [], []] }
  throw new Error('unexpected query: ' + q.slice(0, 120))
} }
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve(path.join(ROOT, 'db.js')), fakeDb)
function compile(src) { const m = new Module(PJ, module); m.filename = PJ; m.paths = Module._nodeModulePaths(path.dirname(PJ)); m._compile(src, PJ); return m.exports }
function call(router, user, url) {
  return new Promise(resolve => {
    const req = { method: 'GET', url, originalUrl: '/api/projects' + url, headers: {}, query: {}, body: {}, ip: '127.0.0.1', user }
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(o) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(o)) }) }, setHeader() {}, getHeader() {} }
    router(req, res, err => resolve({ status: err ? 500 : 404, body: { fellThrough: true } }))
  })
}
const EXT = [{ id: 711, role: 'vendor' }, { id: 685, role: 'freight_forwarder' }, { id: 713, role: 'site_contractor' }, { id: 714, role: 'subcontractor' }]
const INTERNAL = [{ id: 4, role: 'admin' }, { id: 24, role: 'project_manager' }, { id: 27, role: 'viewer' }]
const KEYS = ['id', 'code', 'name', 'phase']

async function suite(src) {
  const R = compile(src), O = compile(OLD)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  for (const u of EXT) {
    const d = await call(R, u, '/27'), row = PROJECTS.find(p => p.id === 27)
    check(d.status === 200 && JSON.stringify(Object.keys(d.body)) === JSON.stringify(KEYS), `${u.role} detail: only id, code, name and phase`)
    check(KEYS.every(k => d.body[k] === row[k]), `${u.role} detail: the values of the project row`)
    for (const url of ['/28', '/99']) {
      calls = []; const a = await call(R, u, url); const qa = JSON.stringify(calls)
      calls = []; const b = await call(O, u, url); const qb = JSON.stringify(calls)
      check(JSON.stringify(a) === JSON.stringify(b) && qa === qb, `${u.role} ${url}: the refusal unchanged (${a.status} ${a.body.error})`)
    }
    calls = []; const l = await call(R, u, '/'); const ql = JSON.stringify(calls)
    calls = []; const m = await call(O, u, '/'); const qm = JSON.stringify(calls)
    check(JSON.stringify(l) === JSON.stringify(m) && ql === qm, `${u.role} list unchanged`)
  }
  for (const u of INTERNAL) {
    const d = await call(R, u, '/27')
    check(d.status === 200 && JSON.stringify(d.body) === JSON.stringify(PROJECTS.find(p => p.id === 27)), `${u.role} detail: the whole row`)
  }
  return { pass, fail, failed }
}
async function sameAsBase(src) {   // internal roles: answers and queries equal to 1285c0d
  const R = compile(src), O = compile(OLD)
  let same = 0, total = 0; const diffs = []
  for (const u of INTERNAL) for (const url of ['/', '/27', '/28', '/99']) {
    total++
    calls = []; const a = await call(R, u, url); const qa = JSON.stringify(calls)
    calls = []; const b = await call(O, u, url); const qb = JSON.stringify(calls)
    if (JSON.stringify(a) === JSON.stringify(b) && qa === qb) same++; else diffs.push(`${u.role} ${url}`)
  }
  return { same, total, diffs }
}
const MUTANTS = [
  ['all keys kept', s => s.replace('res.json(external ? identityOf(rows[0]) : rows[0]);', 'res.json(rows[0]);')],
  ['the trim applied to internal roles', s => s.replace('res.json(external ? identityOf(rows[0]) : rows[0]);', 'res.json(identityOf(rows[0]));')],
  ['PO health only nulled (1285c0d)', s => s.replace('res.json(external ? identityOf(rows[0]) : rows[0]);', "res.json(external ? withoutPoHealth(rows[0], ['rag', 'total_pos', 'at_risk', 'breached']) : rows[0]);")],
  ['phase dropped', s => s.replace("const IDENTITY = ['id', 'code', 'name', 'phase'];", "const IDENTITY = ['id', 'code', 'name'];")],
  ['grant check removed', s => s.replace("      if (!grant.length) return res.status(403).json({ error: 'No project access' });\n", '')],
]
;(async () => {
  const r = await suite(SRC), I = await sameAsBase(SRC)
  r.failed.forEach(n => console.log('FAIL ' + n)); I.diffs.forEach(d => console.log('FAIL differs from 1285c0d: ' + d))
  const fail = r.fail + (I.same === I.total ? 0 : 1)
  console.log(`projectsDetail: ${r.pass + (I.same === I.total ? 1 : 0)} passed, ${fail} failed (internal roles identical to 1285c0d on ${I.same} of ${I.total} requests, answers and queries)`)
  if (process.argv.includes('--mutation')) {
    let killed = 0
    for (const [name, mutate] of MUTANTS) {
      const m = mutate(SRC)
      if (m === SRC) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      let bad
      try { const s = await suite(m), i = await sameAsBase(m); bad = s.fail > 0 || i.same !== i.total } catch { bad = true }
      if (bad) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${MUTANTS.length} killed`)
    if (killed !== MUTANTS.length) process.exitCode = 1
  }
  if (fail) process.exitCode = 1
})()
