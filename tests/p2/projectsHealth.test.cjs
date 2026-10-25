// 3T174 — TC's answer: external roles (vendor, freight_forwarder, site_contractor, subcontractor) do not receive a
// project's project-wide PO health from server/routes/projects.js: GET / returns rag, totalPOs, breached and atRisk
// as null for them, GET /:id rag, total_pos, at_risk and breached as null (the keys stay: the Home cards read absent
// counts as 0); every other key and every internal-role answer equal to the file at e2a5a63 (git show). The real
// router over a fake db (no database). Exit code 1 on any failure.
// Usage: node tests/p2/projectsHealth.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const PJ = path.join(ROOT, 'routes/projects.js')
const SRC = fs.readFileSync(PJ, 'utf8')
const OLD = execFileSync('git', ['-C', REPO, 'show', 'e2a5a63:server/routes/projects.js'], { encoding: 'utf8' })   // the file before 3T174

const PROJECTS = [27, 28].map(id => ({ id, code: 'P' + id, name: 'Project ' + id, phase: 'Build', status: 'active', traceability_required: 1, traceability_set_by: 4, traceability_set_at: null,
  rag: id === 27 ? 'red' : 'amber', client: 'Client', start_date: '2026-01-01', end_date: '2027-01-01', total_pos: 12, at_risk: 3, breached: 2, progress_pct: '40.00', created_by: 4,
  created_at: '2026-01-01', updated_at: '2026-01-02', at_risk_days_threshold: 30, approval_threshold_1: '1000.00', approval_threshold_2: '5000.00' }))
const GRANTED = { 711: [27], 685: [27], 713: [27], 714: [27] }
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
const LIST_HEALTH = ['rag', 'totalPOs', 'breached', 'atRisk'], ROW_HEALTH = ['rag', 'total_pos', 'at_risk', 'breached']

async function suite(src) {
  const R = compile(src), O = compile(OLD)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  for (const u of EXT) {
    const a = await call(R, u, '/'), b = await call(O, u, '/')
    check(a.status === 200 && a.body.length === 1 && a.body[0].id === 27, `${u.role} list: its granted project only`)
    check(a.body.every(r => LIST_HEALTH.every(k => k in r && r[k] === null)), `${u.role} list: rag, totalPOs, breached and atRisk are null`)
    check(a.body.every((r, i) => JSON.stringify(Object.keys(r)) === JSON.stringify(Object.keys(b.body[i])) && Object.keys(r).filter(k => !LIST_HEALTH.includes(k)).every(k => r[k] === b.body[i][k])), `${u.role} list: the same keys, the other values unchanged`)
    const d = await call(R, u, '/27'), e = await call(O, u, '/27')
    check(d.status === 200 && ROW_HEALTH.every(k => k in d.body && d.body[k] === null), `${u.role} detail: rag, total_pos, at_risk and breached are null`)
    check(JSON.stringify(Object.keys(d.body)) === JSON.stringify(Object.keys(e.body)) && Object.keys(d.body).filter(k => !ROW_HEALTH.includes(k)).every(k => d.body[k] === e.body[k]), `${u.role} detail: the same keys, the other values unchanged`)
    const n = await call(R, u, '/28')
    check(n.status === 403 && n.body.error === 'No project access', `${u.role} detail of a project without a grant: 403`)
  }
  for (const u of INTERNAL) {
    const a = await call(R, u, '/')
    check(a.body.length === 2 && a.body.every(r => r.rag !== null && r.totalPOs === 12 && r.breached === 2 && r.atRisk === 3), `${u.role} list: PO health present`)
    const d = await call(R, u, '/27')
    check(d.body.rag === 'red' && d.body.total_pos === 12 && d.body.at_risk === 3 && d.body.breached === 2, `${u.role} detail: PO health present`)
  }
  return { pass, fail, failed }
}
async function sameAsBase(src) {   // internal roles: answers and queries equal to e2a5a63
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
  ['list not narrowed', s => s.replace('res.json(external ? rows.map(r => withoutPoHealth(r, LIST_HEALTH)) : rows);', 'res.json(rows);')],
  ['detail not narrowed', s => s.replace('res.json(external ? withoutPoHealth(rows[0], ROW_HEALTH) : rows[0]);', 'res.json(rows[0]);')],
  ['list keeps the RAG', s => s.replace("const LIST_HEALTH = ['rag', 'totalPOs', 'breached', 'atRisk'];", "const LIST_HEALTH = ['totalPOs', 'breached', 'atRisk'];")],
  ['list keeps totalPOs', s => s.replace("const LIST_HEALTH = ['rag', 'totalPOs', 'breached', 'atRisk'];", "const LIST_HEALTH = ['rag', 'breached', 'atRisk'];")],
  ['detail keeps at_risk', s => s.replace("const ROW_HEALTH = ['rag', 'total_pos', 'at_risk', 'breached'];", "const ROW_HEALTH = ['rag', 'total_pos', 'breached'];")],
  ['keys omitted instead of null', s => s.replace('const withoutPoHealth = (row, keys) => ({ ...row, ...Object.fromEntries(keys.map(k => [k, null])) });', 'const withoutPoHealth = (row, keys) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));')],
  ['internal roles narrowed too', s => s.replace('res.json(external ? rows.map(r => withoutPoHealth(r, LIST_HEALTH)) : rows);', 'res.json(rows.map(r => withoutPoHealth(r, LIST_HEALTH)));')],
]
;(async () => {
  const r = await suite(SRC), I = await sameAsBase(SRC)
  r.failed.forEach(n => console.log('FAIL ' + n)); I.diffs.forEach(d => console.log('FAIL differs from e2a5a63: ' + d))
  const fail = r.fail + (I.same === I.total ? 0 : 1)
  console.log(`projectsHealth: ${r.pass + (I.same === I.total ? 1 : 0)} passed, ${fail} failed (internal roles identical to e2a5a63 on ${I.same} of ${I.total} requests, answers and queries)`)
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
