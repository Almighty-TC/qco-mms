// 3T172 — scope fix 3 of 3: for a freight_forwarder, server/routes/logistics.js's register list, its total and its
// pipeline counts include the SCNs where the forwarder is the delegated packer (packaging_delegated_to = the user id,
// isPackagingDelegate's meaning), as the detail check forwarderLinkedToScn does; without the delegation column, carrier
// only. Internal roles' answers and queries equal the file at 6183bc4 (git show). The real router over node:sqlite (in
// memory, no database); the information_schema check is answered by the test. Exit code 1 on any failure.
// Usage: node tests/p2/forwarderRegister.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')
const { DatabaseSync } = require('node:sqlite')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const LG = path.join(ROOT, 'routes/logistics.js')
const SRC = fs.readFileSync(LG, 'utf8')
const OLD = execFileSync('git', ['-C', REPO, 'show', '6183bc4:server/routes/logistics.js'], { encoding: 'utf8' })   // the file before 3T172

// ── fake SCNs: [id, project, carrier, delegated packer, status, packaging_status, mode, critical] ──
// 685: carrier only (1, 5, 11), packer only (2, 6: no carrier), both (3); 712: carrier only (2, 4, 9); 9: packer only (9);
// 686: nothing; 10 has neither; project 28 (7, 8) must never leak into project 27.
const SCNS = [
  [1, 27, 685, null, 'draft', null, 'sea', 0], [2, 27, 712, 685, 'pending', 'pending', 'air', 1], [3, 27, 685, 685, 'in-transit', 'complete', 'sea', 0],
  [4, 27, 712, null, 'customs_review', null, 'road', 0], [5, 27, 685, null, 'arrived', null, 'sea', 1], [6, 27, null, 685, 'received', 'pending', 'air', 0],
  [7, 28, 685, 685, 'draft', 'pending', 'sea', 0], [8, 28, 712, 685, 'closed', null, 'sea', 0], [9, 27, 712, 9, 'draft', 'pending', 'sea', 0],
  [10, 27, null, null, 'closed', null, 'road', 0], [11, 27, 685, null, 'received', null, 'air', 0],
]
const DISPLAY = { draft: 'pending_pickup', pending: 'pending_pickup', 'in-transit': 'in_transit', customs_review: 'customs_review', arrived: 'pending_delivery', received: 'delivered', closed: 'delivered' }
function makeDb(withCol) {
  const d = new DatabaseSync(':memory:')
  d.exec(`CREATE TABLE shipment_control_notes (id INTEGER PRIMARY KEY, project_id INT, po_id INT, destination_warehouse_id INT, scn_ref TEXT, status TEXT,
    rag TEXT, mode TEXT, etd TEXT, eta TEXT, atd TEXT, ata TEXT, origin_location TEXT, incoterms TEXT, forwarder_name TEXT, forwarder_user_id INT,
    packed_by_type TEXT, ${withCol ? 'packaging_delegated_to INT,' : ''} packaging_status TEXT, is_critical_path INT, total_packages INT, total_weight_kg REAL,
    bl_number TEXT, container_ref TEXT, notes TEXT, forwarder_notified INT, forwarder_notified_at TEXT, created_at TEXT, updated_at TEXT, vendor_name TEXT);
    CREATE TABLE purchase_orders (id INTEGER PRIMARY KEY, po_number TEXT, vendor_name TEXT);
    CREATE TABLE warehouses (id INTEGER PRIMARY KEY, name TEXT, code TEXT);
    INSERT INTO purchase_orders VALUES (1, 'PO-1', 'Vendor A'), (2, 'PO-2', 'Vendor B');
    INSERT INTO warehouses VALUES (1, 'Site Laydown', 'WH1');`)
  const ins = d.prepare(`INSERT INTO shipment_control_notes (id, project_id, po_id, destination_warehouse_id, scn_ref, status, mode, forwarder_user_id, packed_by_type,
    ${withCol ? 'packaging_delegated_to,' : ''} packaging_status, is_critical_path, created_at, origin_location) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ${withCol ? '?,' : ''} ?, ?, ?, ?)`)
  for (const [id, p, carrier, packer, status, pkg, mode, crit] of SCNS) {
    const v = [id, p, 1 + (id % 2), 'SCN-' + String(id).padStart(3, '0'), status, mode, carrier, packer ? 'forwarder' : 'internal']
    ins.run(...v, ...(withCol ? [packer] : []), pkg, crit, `2026-10-${String(10 + (id % 4)).padStart(2, '0')} 08:00:00`, 'Origin ' + id)
  }
  return d
}
const norm = s => s.replace(/\s+/g, ' ').trim()
let calls = [], sqlite = null, infoCol = 1
const fakeDb = { query: async (sql, params = []) => {
  const q = norm(sql)
  calls.push({ q, params })
  if (/information_schema\.columns/.test(q)) return [[{ n: /column_name = 'packaging_delegated_to'/.test(q) ? infoCol : 0 }], []]
  return [sqlite.prepare(q).all(...params).map(r => ({ ...r })), []]
} }
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
const pass = (req, res, next) => next()
stub(require.resolve(path.join(ROOT, 'db.js')), fakeDb)
stub(require.resolve(path.join(ROOT, 'middleware/auth.js')), { authenticateToken: pass })
stub(require.resolve(path.join(ROOT, 'middleware/permissions.js')), { denyReadOnly: pass, enforce: () => pass, requirePermission: () => pass, requireProjectScope: pass })
stub(require.resolve(path.join(ROOT, 'lib/blobStore.js')), { persist: async () => { throw new Error('no writes in this test') } })
stub(require.resolve(path.join(ROOT, 'lib/sealGovernance.js')), { setSealNo: async () => {}, setContainerNo: async () => {}, SealGovernanceError: class extends Error {} })
const MKDIR = "if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })"   // no directory is created by the test
function compile(src) {
  if (!src.includes(MKDIR)) throw new Error('upload-dir line not found')
  const m = new Module(LG, module); m.filename = LG; m.paths = Module._nodeModulePaths(path.dirname(LG)); m._compile(src.replace(MKDIR, ''), LG); return m.exports
}
function call(router, user, url) {
  return new Promise(resolve => {
    const [p, qs] = url.split('?')
    const req = { method: 'GET', url, originalUrl: '/api/logistics' + url, path: p, headers: {}, query: Object.fromEntries(new URLSearchParams(qs || '')), body: {}, ip: '127.0.0.1', user }
    const res = { statusCode: 200, headersSent: false, status(c) { this.statusCode = c; return this }, json(o) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(o)) }) }, setHeader() {}, getHeader() {} }
    router(req, res, err => resolve({ status: err ? 500 : 404, body: { fellThrough: true } }))
  })
}
const quiet = async fn => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }
const FF = id => ({ id, role: 'freight_forwarder' })
const INTERNAL = [{ id: 4, role: 'admin' }, { id: 24, role: 'project_manager' }, { id: 26, role: 'logistics_manager' }, { id: 27, role: 'viewer' }]
const QUERIES = ['', '?page=2&limit=3', '?status=pending_pickup', '?packaging=pending', '?search=SCN-00', '?sort_col=scn_ref&sort_dir=asc', '?critical_only=true', '?mode=sea']

async function suite(src) {
  const R = () => compile(src)   // a fresh module per scenario: scnHasDelegateCol caches a present column
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const ids = b => (b.data || []).map(r => r.id).sort((x, y) => x - y)
  const allPages = async (r, u, extra = '') => {
    const out = []; let page = 1, first
    for (;;) { calls = []; const a = await quiet(() => call(r, u, `/register/27?limit=2&page=${page}${extra}`)); if (!first) first = a; if (a.status !== 200) return { status: a.status, out, first, pages: page }
      out.push(...a.body.data.map(x => x.id)); if (a.body.data.length < 2) break; page++ }
    return { status: 200, out, first, pages: page }
  }
  for (const [withCol, info, label] of [[true, 1, 'column present'], [true, 0, 'column reported absent']]) {
    sqlite = makeDb(withCol); infoCol = info
    const r = R(), isDel = r.isPackagingDelegate
    const expectIds = uid => SCNS.filter(s => s[1] === 27 && ((s[2] != null && s[2] === uid) || (info === 1 && isDel(s[3], uid)))).map(s => s[0]).sort((x, y) => x - y)
    for (const uid of [685, 712, 9, 686]) {
      const exp = expectIds(uid)
      calls = []; const a = await call(r, FF(uid), '/register/27')
      check(a.status === 200 && JSON.stringify(ids(a.body)) === JSON.stringify(exp), `${label}: forwarder ${uid} register ids ${JSON.stringify(exp)}`)
      check(a.body.total === exp.length, `${label}: forwarder ${uid} total ${exp.length}`)
      const pc = { pending_pickup: 0, in_transit: 0, customs_review: 0, pending_delivery: 0, delivered: 0, total: exp.length }
      exp.forEach(id => pc[DISPLAY[SCNS.find(s => s[0] === id)[4]]]++)
      check(JSON.stringify(a.body.pipeline_counts) === JSON.stringify(pc), `${label}: forwarder ${uid} pipeline counts`)
      const where = calls.filter(c => /^SELECT COUNT\(\*\) as total/.test(c.q) || /^SELECT (s\.)?status FROM shipment_control_notes/.test(c.q))
      check(where.length === 2 && where.every(c => /packaging_delegated_to/.test(c.q) === (info === 1)), `${label}: forwarder ${uid} the list and the counts ${info ? 'match the packer' : 'name no delegate column'}`)
      const linked = []; for (const s of SCNS.filter(x => x[1] === 27)) if (await r.forwarderLinkedToScn(fakeDb, s[0], uid)) linked.push(s[0])
      check(JSON.stringify(linked) === JSON.stringify(exp), `${label}: forwarder ${uid} register equals the detail check`)
      const pg = await allPages(r, FF(uid))
      check(pg.status === 200 && JSON.stringify([...pg.out].sort((x, y) => x - y)) === JSON.stringify(exp) && new Set(pg.out).size === pg.out.length && pg.first.body.total === exp.length, `${label}: forwarder ${uid} paging (limit 2) covers each SCN once`)
      for (const [qs, keep] of [['&status=pending_pickup', s => ['draft', 'pending'].includes(s[4])], ['&packaging=pending', s => s[5] === 'pending'], ['&critical_only=true', s => s[7] === 1], ['&mode=air', s => s[6] === 'air']]) {
        const f = await call(r, FF(uid), '/register/27?limit=50' + qs)
        const e2 = exp.filter(id => keep(SCNS.find(s => s[0] === id)))
        check(f.status === 200 && JSON.stringify(ids(f.body)) === JSON.stringify(e2) && f.body.total === e2.length && f.body.pipeline_counts.total === exp.length, `${label}: forwarder ${uid} filter ${qs.slice(1)}`)
      }
    }
    const o = compile(OLD)
    for (const uid of [712, 686]) {   // no packer-only SCN: the same answer as before
      const a = await call(r, FF(uid), '/register/27'), b = await call(o, FF(uid), '/register/27')
      check(JSON.stringify(a) === JSON.stringify(b), `${label}: forwarder ${uid} answer unchanged`)
    }
    const other = await call(r, FF(685), '/register/28')
    check(JSON.stringify(ids(other.body)) === JSON.stringify(info ? [7, 8] : [7]), `${label}: project 28 lists its own SCNs only`)
  }
  // the column really absent: the row SELECT already names packaging_delegated_to, so the register fails as before
  sqlite = makeDb(false); infoCol = 0
  for (const u of [FF(685), INTERNAL[0]]) {
    calls = []; const a = await quiet(() => call(R(), u, '/register/27')); const qa = calls.filter(c => !/information_schema/.test(c.q)).map(c => c.q)
    calls = []; const b = await quiet(() => call(compile(OLD), u, '/register/27')); const qb = calls.filter(c => !/information_schema/.test(c.q)).map(c => c.q)
    check(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(qa) === JSON.stringify(qb), `column absent: ${u.role} answer and queries as before`)
  }
  return { pass, fail, failed }
}
async function sameAsBase(src) {   // internal roles: answers and queries equal to 6183bc4
  sqlite = makeDb(true); infoCol = 1
  let same = 0, total = 0; const diffs = []
  for (const u of INTERNAL) for (const qs of QUERIES) {
    total++
    calls = []; const a = await call(compile(src), u, '/register/27' + qs); const qa = JSON.stringify(calls)
    calls = []; const b = await call(compile(OLD), u, '/register/27' + qs); const qb = JSON.stringify(calls)
    if (a.status === 200 && JSON.stringify(a) === JSON.stringify(b) && qa === qb) same++; else diffs.push(`${u.role} ${qs || '(default)'}`)
  }
  return { same, total, diffs }
}
const MUTANTS = [
  ['carrier only', s => s.replace('      conditions.push(ff.sql)\n      params.push(...ff.params)', "      conditions.push('s.forwarder_user_id = ?')\n      params.push(uid)")],
  ['packer without the guard', s => s.replace("  if (!(await scnHasDelegateCol(conn))) return { sql: 's.forwarder_user_id = ?', params: [userId] }\n", '')],
  ['counts not updated', s => s.replace('      ? `SELECT s.status FROM shipment_control_notes s WHERE s.project_id = ? AND ${ff.sql}`', "      ? 'SELECT status FROM shipment_control_notes WHERE project_id = ? AND forwarder_user_id = ?'").replace('const pipelineParams = ff ? [pid, ...ff.params] : [pid]', 'const pipelineParams = ff ? [pid, uid] : [pid]')],
  ['OR without parentheses', s => s.replace("'(s.forwarder_user_id = ? OR s.packaging_delegated_to = ?)'", "'s.forwarder_user_id = ? OR s.packaging_delegated_to = ?'")],
  ['internal roles narrowed', s => s.replace("const ff = role === 'freight_forwarder' ? await forwarderScnFilter(db, uid) : null", 'const ff = await forwarderScnFilter(db, uid)')],
  ['packer on the carrier column', s => s.replace("'(s.forwarder_user_id = ? OR s.packaging_delegated_to = ?)'", "'(s.forwarder_user_id = ? OR s.forwarder_user_id = ?)'")],
]
;(async () => {
  const r = await suite(SRC), I = await sameAsBase(SRC)
  r.failed.forEach(n => console.log('FAIL ' + n)); I.diffs.forEach(d => console.log('FAIL differs from 6183bc4: ' + d))
  const fail = r.fail + (I.same === I.total ? 0 : 1)
  console.log(`forwarderRegister: ${r.pass + (I.same === I.total ? 1 : 0)} passed, ${fail} failed (internal roles identical to 6183bc4 on ${I.same} of ${I.total} requests, answers and queries)`)
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
