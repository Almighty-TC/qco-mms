// P2d — vendor scoping of VDRL in server/routes/expediting.js and the vdrl download in
// server/routes/documents.js: the real routers over a fake db (multer, blob store, schema check
// and the Azure SDK stubbed; no database, no files). Internal roles: answers and queries equal to
// both files at b20d85c (git show; queries compared with whitespace collapsed), except PUT, which
// gains the project check for every role. Exit code 1 on any failure.
// Usage: node tests/p2/vdrlVendor.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const EXP = path.join(ROOT, 'routes/expediting.js')
const DOC = path.join(ROOT, 'routes/documents.js')
const EXP_SRC = fs.readFileSync(EXP, 'utf8'), DOC_SRC = fs.readFileSync(DOC, 'utf8')
const show = f => execFileSync('git', ['-C', REPO, 'show', 'b20d85c:server/' + f], { encoding: 'utf8' })
const EXP_BEFORE = show('routes/expediting.js'), DOC_BEFORE = show('routes/documents.js')

// ── fake data: packages 1 (project 27, supplier 5), 2 (27, supplier 9), 3 (28, supplier 5) ──
const PKGS = { 1: { project: 27, supplier: 5 }, 2: { project: 27, supplier: 9 }, 3: { project: 28, supplier: 5 } }
const DOCS0 = { 11: [1, 'Not submitted'], 12: [1, 'Overdue'], 13: [1, 'Resubmit'], 14: [1, 'Under review'], 15: [1, 'Approved'], 21: [2, 'Not submitted'], 31: [3, 'Not submitted'] }
let DOCS = {}
const PKG_COLS = 'id project_id po_id package_ref name vendor_name po_number status total_docs submitted overdue abf_total abf_cleared progress_pct supplier_user_id created_by created_at updated_at'.split(' ')
const DOC_COLS = 'id package_id doc_number title doc_type discipline revision purpose status required_date promised_date submitted_date abf_required abf_cleared cert_required mdr_required review_days transmittal_ref spec_reference tag_number po_line_ref notes created_by created_at updated_at file_path file_name file_size mime_type source_po_line_id'.split(' ')
const pkgRow = id => ({ ...Object.fromEntries(PKG_COLS.map(c => [c, 'S:' + c])), id, project_id: PKGS[id].project, po_number: 'PO' + id, vendor_name: 'V', doc_count: 2, submitted_count: 1, overdue_count: 0 })
const docRow = id => ({ ...Object.fromEntries(DOC_COLS.map(c => [c, 'S:' + c])), id, package_id: DOCS[id][0], status: DOCS[id][1], package_name: 'P', po_number: 'PO', vendor_name: 'V', days_overdue: 3 })
let calls = [], RACE = false, FAIL_UPDATE = false, FAIL_PROJECTION = false, txEvents = []
const norm = s => s.replace(/\s+/g, ' ').trim()
const VENDOR_DENIED = new Set(['can_edit', 'can_approve', 'can_delete'])
const fakeDb = { query: async (sql, params = []) => {
  const q = norm(sql)
  calls.push({ q, params })
  let m
  if ((m = q.match(/^SELECT (\w+) AS allowed FROM role_permissions/))) return [[{ allowed: params[0] === 'vendor' && VENDOR_DENIED.has(m[1]) ? 0 : 1 }], []]
  if (/^SELECT \w+ AS allowed FROM user_permission_overrides/.test(q)) return [[], []]
  if (/^SELECT id FROM user_wbs_access/.test(q)) return [[{ id: 1 }], []]
  if (/^SELECT COUNT\(d\.id\) AS total_docs/.test(q)) return [[{ total_docs: 4, submitted_count: 2, overdue_count: 1, abf_cleared_count: 1 }], []]
  if (/^SELECT p\.\*, po\.po_number, po\.vendor_name, COUNT\(d\.id\) AS doc_count/.test(q)) return [[pkgRow(1), pkgRow(2)], []]
  if (/^SELECT p\.id FROM vdrl_packages p JOIN purchase_orders po ON po\.id = p\.po_id WHERE p\.id = \? AND p\.project_id = \? AND po\.supplier_id = \?$/.test(q)) {
    const p = PKGS[params[0]]; return [p && p.project === params[1] && p.supplier === params[2] ? [{ id: params[0] }] : [], []]
  }
  if (/^SELECT d\.\*, p\.name AS package_name, po\.po_number, po\.vendor_name, DATEDIFF\(CURDATE\(\), d\.required_date\) AS days_overdue FROM vdrl_documents d JOIN vdrl_packages p ON p\.id = d\.package_id (LEFT )?JOIN purchase_orders po ON po\.id = p\.po_id WHERE p\.project_id/.test(q)) return [[docRow(11), docRow(12)], []]
  if (/^SELECT po\.id, po\.po_number, po\.po_name, po\.vendor_name, COUNT\(DISTINCT pkg\.id\)/.test(q)) return [[{ id: 100, po_number: 'PO1', po_name: 'N', vendor_name: 'V', package_count: '1', total_docs: '2', submitted_count: '1', overdue_count: '0', is_locked: 1, owner_id: 4 }], []]
  if (/^SELECT d\.status FROM vdrl_documents d JOIN vdrl_packages p ON p\.id = d\.package_id JOIN purchase_orders po ON po\.id = p\.po_id WHERE d\.id = \? AND p\.project_id = \? AND po\.supplier_id = \?$/.test(q)) {
    const d = DOCS[params[0]], p = d && PKGS[d[0]]; return [p && p.project === params[1] && p.supplier === params[2] ? [{ status: d[1] }] : [], []]
  }
  if (/^SELECT d\.id FROM vdrl_documents d JOIN vdrl_packages p ON p\.id = d\.package_id WHERE d\.id=\? AND p\.project_id=\?$/.test(q)) {
    const d = DOCS[params[0]]; return [d && PKGS[d[0]].project === params[1] ? [{ id: params[0] }] : [], []]
  }
  if ((m = q.match(/^UPDATE vdrl_documents SET file_name=\?, file_path=\?, file_size=\?, mime_type=\?, status='Under review'.* WHERE id=\? AND status IN \(\?,\?,\?\)$/))) {
    if (FAIL_UPDATE) throw new Error('fake update failure')
    const id = params[4]; if (RACE) { DOCS[id][1] = 'Approved'; return [{ affectedRows: 0 }, undefined] }
    if (params.slice(5).includes(DOCS[id][1])) { DOCS[id][1] = 'Under review'; return [{ affectedRows: 1 }, undefined] }
    return [{ affectedRows: 0 }, undefined]
  }
  if (/^UPDATE vdrl_documents/.test(q)) return [{ affectedRows: 1 }, undefined]
  if (/^INSERT INTO (audit_log|vdrl_documents|vdrl_packages)/.test(q)) return [{ insertId: 77 }, undefined]
  if (/^SELECT status FROM vdrl_documents WHERE id=\?$/.test(q)) return [DOCS[params[0]] ? [{ status: DOCS[params[0]][1] }] : [], []]
  if (/^SELECT d\.\*, p\.name AS package_name, po\.po_number, po\.vendor_name, DATEDIFF\(CURDATE\(\), d\.required_date\) AS days_overdue FROM vdrl_documents d JOIN vdrl_packages p ON p\.id = d\.package_id LEFT JOIN purchase_orders po ON po\.id = p\.po_id WHERE d\.id=\?$/.test(q)) {
    if (FAIL_PROJECTION) throw new Error('fake projection failure')
    return [[docRow(params[0])], []]
  }
  if (/^SELECT \* FROM vdrl_documents WHERE id=\?$/.test(q)) return [DOCS[params[0]] ? [docRow(params[0])] : [], []]
  if (/^SELECT \* FROM vdrl_packages WHERE id=\?$/.test(q)) return [[pkgRow(1)], []]
  if (/^SELECT d\.file_name, d\.file_path, d\.mime_type FROM vdrl_documents d JOIN vdrl_packages p ON p\.id = d\.package_id WHERE d\.id=\? AND p\.project_id=\?$/.test(q)) {
    const d = DOCS[params[0]]; return [d && PKGS[d[0]].project === params[1] ? [{ file_name: 'f.pdf', file_path: 'uploads/vdrl-documents/f.pdf', mime_type: 'application/pdf' }] : [], []]
  }
  if (/^SELECT po\.supplier_id FROM vdrl_documents d JOIN vdrl_packages p ON p\.id = d\.package_id JOIN purchase_orders po ON po\.id = p\.po_id WHERE d\.id=\?$/.test(q)) {
    const d = DOCS[params[0]]; return [d ? [{ supplier_id: PKGS[d[0]].supplier }] : [], []]
  }
  throw new Error('unexpected query: ' + q.slice(0, 100))
}, getConnection: async () => {
  txEvents.push('get')
  return { query: (s, p) => { txEvents.push('q'); return fakeDb.query(s, p) }, beginTransaction: async () => { txEvents.push('begin') },
    commit: async () => { txEvents.push('commit') }, rollback: async () => { txEvents.push('rollback') }, release: () => { txEvents.push('release') } }
} }

// ── stubs: db, multer (a request's _file becomes req.file), blob store, schema check, Azure SDK, fs.unlinkSync ──
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve(path.join(ROOT, 'db.js')), fakeDb)
const fakeMulter = () => ({ single: () => (req, res, next) => { if (req._file) req.file = req._file; next() } })
fakeMulter.memoryStorage = () => ({}); fakeMulter.diskStorage = () => ({}); fakeMulter.MulterError = class extends Error {}
stub(require.resolve('multer', { paths: [ROOT] }), fakeMulter)
let STORE = 'disk', persisted = [], blobDeletes = [], unlinks = []
stub(require.resolve(path.join(ROOT, 'lib/blobStore.js')), {
  CONTAINER: 'test-container', isEnabled: () => false, putFile: async () => null,
  keyFor: (m, p) => `${m}/${path.basename(String(p))}`, getFile: async () => ({ pipe: res => res.end('FILE') }),
  persist: async o => { persisted.push(o.diskAbsPath); return STORE === 'blob' ? { value: o.key, where: 'blob' } : { value: o.diskValue, where: 'disk' } },
})
stub(require.resolve(path.join(ROOT, 'lib/schemaColumns.js')), { fileColumns: async () => new Set(['vdrl_documents.file_path']), fileColumnsReady: async () => true })
stub(require.resolve('@azure/storage-blob', { paths: [ROOT] }), { BlobServiceClient: { fromConnectionString: () => ({ getContainerClient: () => ({ getBlockBlobClient: k => ({ deleteIfExists: async () => { blobDeletes.push(k) } }) }) }) } })
const realUnlink = fs.unlinkSync
fs.unlinkSync = p => { if (String(p).includes('vdrl-documents')) unlinks.push(p); else return realUnlink(p) }
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'))
const { JWT_SECRET } = require(path.join(ROOT, 'middleware/auth'))

function compile(file, src) {
  const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(src, file); return m.exports
}
const FILE = { originalname: 'a.pdf', size: 3, mimetype: 'application/pdf', buffer: Buffer.from('abc') }
function call(router, base, user, method, url, { file, scope } = {}) {
  return new Promise(resolve => {
    const [p, qs] = url.split('?')
    const req = { method, url, originalUrl: base + url, headers: { authorization: 'Bearer ' + jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '10m' }) },
      query: Object.fromEntries(new URLSearchParams(qs || '')), body: { title: 'T', package_id: 1, name: 'N', status: 'Approved' }, ip: '127.0.0.1', _file: file }
    if (user.role === 'vendor') req.externalScope = { userId: user.id, role: 'vendor', supplierId: user.supplier_id ?? null }   // as the P2b gate sets it
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] },
      status(c) { this.statusCode = c; return this }, json(o) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(o ?? null)) }) }, end(b) { resolve({ status: this.statusCode, body: String(b) }) } }
    router(req, res, err => resolve({ status: err ? 500 : 404, body: { fellThrough: true, err: err && err.message } }))
  })
}
const V5 = { id: 711, role: 'vendor', supplier_id: 5 }, V9 = { id: 696, role: 'vendor', supplier_id: 9 }, VNULL = { id: 712, role: 'vendor', supplier_id: null }
const INTERNAL = [{ id: 4, role: 'admin' }, { id: 24, role: 'project_manager' }, { id: 30, role: 'expeditor' }]
const K = s => JSON.stringify(s.split(' '))
const DOC_KEYS = K('id package_id package_name po_number doc_number title doc_type revision status required_date promised_date submitted_date days_overdue file_name abf_required abf_cleared tag_number po_line_ref')

async function suite(expSrc, docSrc) {
  const E = compile(EXP, expSrc), D = compile(DOC, docSrc)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const reset = () => { DOCS = JSON.parse(JSON.stringify(DOCS0)); RACE = false; FAIL_UPDATE = false; FAIL_PROJECTION = false; txEvents = []; STORE = 'disk'; persisted = []; blobDeletes = []; unlinks = [] }
  const go = async (user, method, url, opts) => { calls = []; return call(E, '/api/expediting', user, method, url, opts) }
  const dl = async (user, id) => { calls = []; return call(D, '/api/documents', user, 'GET', `/27/download/vdrl:${id}`) }
  const q1 = re => calls.find(c => re.test(c.q))
  const writes = () => calls.filter(c => /^(INSERT|UPDATE|DELETE)/.test(c.q))
  reset()

  // reads: own supplier only, projected
  let r = await go(V5, 'GET', '/27/vdrl/stats')
  let c = q1(/^SELECT COUNT\(d\.id\)/)
  check(r.status === 200 && c && /JOIN purchase_orders po ON po\.id = p\.po_id WHERE p\.project_id = \? AND po\.supplier_id = \?$/.test(c.q) && JSON.stringify(c.params) === '[27,5]', 'vendor stats: own supplier through the PO')
  check(keysOf(r.body) === K('total_docs submitted_count submitted_pct overdue_count abf_cleared_count progress_pct'), 'vendor stats projected')
  r = await go(VNULL, 'GET', '/27/vdrl/stats')
  check(r.status === 200 && JSON.stringify(r.body) === '{"total_docs":0,"submitted_count":0,"submitted_pct":0,"overdue_count":0,"abf_cleared_count":0,"progress_pct":0}' && !q1(/^SELECT COUNT\(d\.id\)/), 'unlinked vendor stats: zeros without SQL')
  r = await go(V5, 'GET', '/27/vdrl/packages'); c = q1(/^SELECT p\.\*, po\.po_number/)
  check(c && / FROM vdrl_packages p JOIN purchase_orders po ON po\.id = p\.po_id /.test(c.q) && !/LEFT JOIN purchase_orders/.test(c.q) && /WHERE p\.project_id = \? AND po\.supplier_id = \? GROUP BY/.test(c.q) && JSON.stringify(c.params) === '[27,5]', 'vendor packages: INNER JOIN on the PO, own supplier')
  check(r.status === 200 && r.body.every(p => keysOf(p) === K('id package_ref name status po_id po_number vendor_name doc_count submitted_count overdue_count created_at')), 'vendor packages projected (no supplier_user_id, created_by)')
  r = await go(VNULL, 'GET', '/27/vdrl/packages')
  check(r.status === 200 && JSON.stringify(r.body) === '[]' && !q1(/^SELECT p\.\*, po\.po_number/), 'unlinked vendor packages: [] without SQL')
  r = await go(V5, 'GET', '/27/vdrl/documents?status=Overdue'); c = q1(/^SELECT d\.\*, p\.name AS package_name/)
  check(c && /JOIN vdrl_packages p ON p\.id = d\.package_id JOIN purchase_orders po/.test(c.q) && /WHERE p\.project_id = \? AND po\.supplier_id = \? AND d\.status = \?/.test(c.q) && JSON.stringify(c.params) === '[27,5,"Overdue"]', 'vendor documents: own supplier, filters kept')
  check(r.status === 200 && r.body.every(d => keysOf(d) === DOC_KEYS), 'vendor documents projected (no file_path, notes, created_by)')
  r = await go(V5, 'GET', '/27/vdrl/documents?package_id=1')
  check(r.status === 200, 'vendor documents, own package filter: 200')
  for (const pkg of [2, 3, 99]) {
    r = await go(V5, 'GET', `/27/vdrl/documents?package_id=${pkg}`)
    check(r.status === 403 && r.body.error === 'Access denied' && !q1(/^SELECT d\.\*, p\.name AS package_name/), `vendor documents, package ${pkg} not its own: 403`)
  }
  for (const u of ['/27/vdrl/documents', '/27/vdrl/documents?package_id=1']) {
    r = await go(VNULL, 'GET', u)
    check(r.status === 200 && JSON.stringify(r.body) === '[]' && !q1(/^SELECT (d\.\*|p\.id)/), `unlinked vendor ${u}: [] without SQL`)
  }
  r = await go(VNULL, 'GET', '/27/vdrl/po-list')
  check(r.status === 200 && JSON.stringify(r.body) === '[]' && !q1(/^SELECT po\.id/), 'unlinked vendor po-list: [] without SQL')
  r = await go(V5, 'GET', '/27/vdrl/po-list'); c = q1(/^SELECT po\.id, po\.po_number/)
  check(c && /po\.is_locked = 1 AND po\.supplier_id = \? GROUP BY/.test(c.q) && JSON.stringify(c.params) === '[27,27,5]', 'vendor po-list: own supplier')
  check(r.status === 200 && keysOf(r.body[0]) === K('id po_number po_name vendor_name package_count total_docs submitted_count overdue_count progress_pct') && r.body[0].total_docs === 2, 'vendor po-list projected (numbers cast)')

  // writes a vendor may not make
  for (const [m, u] of [['POST', '/27/vdrl/documents'], ['POST', '/27/vdrl/packages'], ['POST', '/27/vdrl/upload']]) {
    r = await go(V5, m, u, { file: FILE })
    check(r.status === 403 && r.body.error === 'Vendors attach files to existing rows' && writes().length === 0, `vendor ${m} ${u}: 403, no write`)
  }
  // file attach: own document in an allowed status
  for (const id of [11, 12, 13]) {
    reset()
    r = await go(V5, 'POST', `/27/vdrl/documents/${id}/file`, { file: FILE })
    const u = q1(/^UPDATE vdrl_documents/)
    check(r.status === 201 && keysOf(r.body) === DOC_KEYS && persisted.length === 1, `vendor file on own doc ${id} (${DOCS0[id][1]}): 201, projected`)
    check(u && /status='Under review'/.test(u.q) && JSON.stringify(u.params.slice(4)) === JSON.stringify([id, 'Not submitted', 'Overdue', 'Resubmit']), `vendor file on doc ${id}: conditional UPDATE`)
    check(JSON.stringify(txEvents) === '["get","begin","q","q","commit","release"]' && unlinks.length === 0 && calls.some(x => x.q.startsWith('INSERT INTO audit_log')), `vendor file on doc ${id}: UPDATE and projection in one committed transaction, audited`)
  }
  for (const id of [14, 15]) {
    reset()
    r = await go(V5, 'POST', `/27/vdrl/documents/${id}/file`, { file: FILE })
    check(r.status === 409 && r.body.error === `A file cannot be uploaded while the document is ${DOCS0[id][1]}` && persisted.length === 0 && writes().length === 0, `vendor file on doc ${id} (${DOCS0[id][1]}): 409 before anything is stored`)
  }
  for (const [u, id, name] of [[V5, 21, 'another supplier\'s document'], [V5, 31, 'a document in another project'], [V5, 99, 'an unknown document'], [V9, 11, 'supplier 9 on supplier 5\'s document'], [VNULL, 11, 'unlinked vendor']]) {
    reset()
    r = await go(u, 'POST', `/27/vdrl/documents/${id}/file`, { file: FILE })
    check(r.status === 403 && r.body.error === 'Access denied' && persisted.length === 0 && writes().length === 0, `${name}: 403, nothing stored`)
  }
  // the conditional UPDATE losing a race: 409, the stored file removed (disk and blob), no audit
  for (const mode of ['disk', 'blob']) {
    reset(); RACE = true; STORE = mode
    r = await go(V5, 'POST', '/27/vdrl/documents/11/file', { file: FILE })
    check(r.status === 409 && r.body.error === 'A file cannot be uploaded while the document is Approved' && persisted.length === 1, `race (${mode}): 409 with the current status`)
    check(mode === 'disk' ? unlinks.length === 1 && blobDeletes.length === 0 : blobDeletes.length === 1 && blobDeletes[0].startsWith('vdrl/') && unlinks.length === 0, `race (${mode}): the stored file removed`)
    check(!calls.some(x => x.q.startsWith('INSERT INTO audit_log')) && txEvents.includes('rollback') && !txEvents.includes('commit') && txEvents.includes('release'), `race (${mode}): rolled back, no audit entry`)
  }
  for (const [flag, name] of [['update', 'the conditional UPDATE throws'], ['projection', 'the projection query throws']]) {
    for (const mode of ['disk', 'blob']) {
      reset(); STORE = mode; if (flag === 'update') FAIL_UPDATE = true; else FAIL_PROJECTION = true
      r = await go(V5, 'POST', '/27/vdrl/documents/11/file', { file: FILE })
      const removed = mode === 'disk' ? unlinks.length === 1 && blobDeletes.length === 0 : blobDeletes.length === 1 && unlinks.length === 0
      check(r.status === 500 && persisted.length === 1 && removed && txEvents.includes('rollback') && !txEvents.includes('commit') && txEvents.includes('release') && !calls.some(x => x.q.startsWith('INSERT INTO audit_log')), `${name} (${mode}): rolled back, the stored file removed, 500, no audit`)
    }
  }
  // PUT: the URL's project for every role; vendors refused by the matrix as before
  reset()
  for (const u of INTERNAL) {
    r = await go(u, 'PUT', '/27/vdrl/documents/31', {})
    check(r.status === 404 && r.body.error === 'VDRL document not found in this project' && writes().length === 0, `${u.role} PUT a document of another project: 404`)
    r = await go(u, 'PUT', '/27/vdrl/documents/11', {})
    const up = q1(/^UPDATE vdrl_documents SET/)
    check(r.status === 200 && up && /WHERE id=\?$/.test(up.q) && up.params[up.params.length - 1] === 11, `${u.role} PUT in the project: updated as before`)
  }
  r = await go(V5, 'PUT', '/27/vdrl/documents/11', {})
  check(r.status === 403 && writes().length === 0, 'vendor PUT: refused by the matrix (can_edit 0)')
  // documents.js vdrl download
  reset()
  r = await dl(V5, 11); check(r.status === 200 && r.body === 'FILE', 'vendor download, own document: 200')
  for (const [u, id, name] of [[V5, 21, 'another supplier'], [V9, 11, 'supplier 9 on 5\'s document'], [VNULL, 11, 'unlinked vendor']]) {
    r = await dl(u, id); check(r.status === 403 && r.body.error === 'Access denied', `vendor download, ${name}: 403`)
  }
  r = await dl(V5, 31); check(r.status === 404, 'vendor download, another project: 404 as before')
  return { pass, fail, failed }
}
const keysOf = o => JSON.stringify(Object.keys(o || {}))

// Internal roles: NEW against b20d85c (answers and whitespace-collapsed queries).
async function internalSame(expSrc, docSrc) {
  const EN = compile(EXP, expSrc), EB = compile(EXP, EXP_BEFORE), DN = compile(DOC, docSrc), DB = compile(DOC, DOC_BEFORE)
  const realNow = Date.now; Date.now = () => 1760000000000   // package_ref and stored names use Date.now()
  try { return await internalCompare(EN, EB, DN, DB) } finally { Date.now = realNow }
}
async function internalCompare(EN, EB, DN, DB) {
  let same = 0, total = 0; const diffs = []
  const REQS = [['GET', '/27/vdrl/stats'], ['GET', '/27/vdrl/packages'], ['GET', '/27/vdrl/documents'], ['GET', '/27/vdrl/documents?package_id=2&status=Overdue'],
    ['GET', '/27/vdrl/po-list'], ['POST', '/27/vdrl/documents'], ['POST', '/27/vdrl/packages'], ['POST', '/27/vdrl/upload'], ['POST', '/27/vdrl/documents/15/file', true], ['POST', '/27/vdrl/documents/21/file', true]]
  for (const u of INTERNAL) {
    for (const [m, url, withFile] of REQS) {
      DOCS = JSON.parse(JSON.stringify(DOCS0)); calls = []; const n = await call(EN, '/api/expediting', u, m, url, { file: withFile ? FILE : undefined }); const nq = calls
      DOCS = JSON.parse(JSON.stringify(DOCS0)); calls = []; const b = await call(EB, '/api/expediting', u, m, url, { file: withFile ? FILE : undefined }); const bq = calls
      total++; if (JSON.stringify(n) === JSON.stringify(b) && JSON.stringify(nq) === JSON.stringify(bq)) same++; else diffs.push(`${u.role} ${m} ${url}`)
    }
    for (const id of [11, 21, 31]) {
      calls = []; const n = await call(DN, '/api/documents', u, 'GET', `/27/download/vdrl:${id}`); const nq = calls
      calls = []; const b = await call(DB, '/api/documents', u, 'GET', `/27/download/vdrl:${id}`); const bq = calls
      total++; if (JSON.stringify(n) === JSON.stringify(b) && JSON.stringify(nq) === JSON.stringify(bq)) same++; else diffs.push(`${u.role} download vdrl:${id}`)
    }
  }
  return { same, total, diffs }
}

const E_MUTANTS = [
  ['no supplier predicate', s => s.replace("return { sql: ' AND po.supplier_id = ?', params: [Number(req.user.supplier_id)] }", "return { sql: '', params: [] }")],
  ['stats query run without a supplier', s => s.replace("    if (vendorWithoutSupplier(req)) {\n      return res.json(vendorView.vdrlStats(", "    if (false) {\n      return res.json(vendorView.vdrlStats(")],
  ['packages query run without a supplier', s => s.replace("    if (vendorWithoutSupplier(req)) return res.json([])\n    const v = isVendor(req) ? vendorSupplier(req) : null   // P2d: INNER JOIN", "    const v = isVendor(req) ? vendorSupplier(req) : null   // P2d: INNER JOIN")],
  ['documents query run without a supplier', s => s.replace("    if (vendorWithoutSupplier(req)) return res.json([])\n    const v = isVendor(req) ? vendorSupplier(req) : null   // P2d: own supplier's packages", "    const v = isVendor(req) ? vendorSupplier(req) : null   // P2d: own supplier's packages")],
  ['po-list query run without a supplier', s => s.replace("    if (vendorWithoutSupplier(req)) return res.json([])\n    const v = isVendor(req) ? vendorSupplier(req) : null   // P2d: own supplier's POs", "    const v = isVendor(req) ? vendorSupplier(req) : null   // P2d: own supplier's POs")],
  ['a failure keeps the file', s => s.replace("        if (conn) { try { await conn.rollback() } catch (_) { /* already rolled back */ } }\n        await removeStoredVdrlFile(storedWhere, relPath, vdrlDiskAbs)\n", "        if (conn) { try { await conn.rollback() } catch (_) { /* already rolled back */ } }\n")],
  ['a failure is not rolled back', s => s.replace("        if (conn) { try { await conn.rollback() } catch (_) { /* already rolled back */ } }\n        await removeStoredVdrlFile", "        await removeStoredVdrlFile")],
  ['projection outside the transaction', s => s.replace(";[[vd]] = await conn.query(", ";[[vd]] = await db.query(")],
  ['packages LEFT JOIN for vendors', s => s.replace("${v ? 'JOIN' : 'LEFT JOIN'} purchase_orders po ON po.id = p.po_id\n      LEFT JOIN vdrl_documents d", "LEFT JOIN purchase_orders po ON po.id = p.po_id\n      LEFT JOIN vdrl_documents d")],
  ['packages not projected', s => s.replace('res.json(v ? pkgs.map(vendorView.vdrlPackage) : pkgs)', 'res.json(pkgs)')],
  ['documents not projected', s => s.replace('res.json(v ? docs.map(vendorView.vdrlDocument) : docs)', 'res.json(docs)')],
  ['stats not projected', s => s.replace('res.json(v ? vendorView.vdrlStats(body) : body)', 'res.json(v ? { ...body, internal: 1 } : body)')],
  ['po-list not projected', s => s.replace('res.json(v ? cast.map(vendorView.vdrlPoRow) : cast)', 'res.json(cast)')],
  ['package filter not checked', s => s.replace("if (!own) return res.status(403).json({ error: 'Access denied' })", '')],
  ['vendors may create documents', s => s.replace("router.post('/:projectId/vdrl/documents', refuseVendorWrites, async", "router.post('/:projectId/vdrl/documents', async")],
  ['vendors may create packages', s => s.replace("router.post('/:projectId/vdrl/packages', refuseVendorWrites, async", "router.post('/:projectId/vdrl/packages', async")],
  ['vendors may bulk upload', s => s.replace("router.post('/:projectId/vdrl/upload', refuseVendorWrites, uploadVDRL", "router.post('/:projectId/vdrl/upload', uploadVDRL")],
  ['no file gate', s => s.replace("router.post('/:projectId/vdrl/documents/:docId/file', vendorVdrlFileGate, uploadVdrlFile", "router.post('/:projectId/vdrl/documents/:docId/file', uploadVdrlFile")],
  ['no status check', s => s.replace('if (!VENDOR_UPLOAD_STATUSES.includes(doc.status)) return', 'if (false) return')],
  ['unconditional vendor UPDATE', s => s.replace('WHERE id=? AND status IN (?,?,?)`,\n          [req.file.originalname, relPath, req.file.size, req.file.mimetype, docId, ...VENDOR_UPLOAD_STATUSES])', 'WHERE id=?`,\n          [req.file.originalname, relPath, req.file.size, req.file.mimetype, docId])')],
  ['race keeps the file', s => s.replace('        await removeStoredVdrlFile(storedWhere, relPath, vdrlDiskAbs)\n', '')],
  ['race answered 201', s => s.replace("        return res.status(409).json({ error: `A file cannot be uploaded while the document is ${now ? now.status : 'changed'}` })", '        void now')],
  ['vendor response not projected', s => s.replace('return res.status(201).json(vendorView.vdrlDocument(vd))', 'return res.status(201).json(vd)')],
  ['no PUT project check', s => s.replace("if (!inProject) return res.status(404).json({ error: 'VDRL document not found in this project' })", '')],
]
const D_MUTANTS = [
  ['download: no vendor check', s => s.replace("    if (user?.role === 'vendor') {\n      const [[o]] = user.supplier_id == null ? [[]] : await db.query(\n        `SELECT po.supplier_id FROM vdrl_documents d", "    if (false) {\n      const [[o]] = user.supplier_id == null ? [[]] : await db.query(\n        `SELECT po.supplier_id FROM vdrl_documents d")],
  ['download: null supplier passes', s => s.replace("if (!o || Number(o.supplier_id) !== Number(user.supplier_id)) return { code: 'forbidden', error: 'Access denied' }", "if (o && Number(o.supplier_id) !== Number(user.supplier_id)) return { code: 'forbidden', error: 'Access denied' }")],
]

;(async () => {
  const r = await suite(EXP_SRC, DOC_SRC)
  const I = await internalSame(EXP_SRC, DOC_SRC)
  r.failed.forEach(n => console.log('FAIL ' + n)); I.diffs.forEach(d => console.log('FAIL internal differs from b20d85c: ' + d))
  const fail = r.fail + (I.same === I.total ? 0 : 1)
  console.log(`vdrlVendor: ${r.pass + (I.same === I.total ? 1 : 0)} passed, ${fail} failed (internal roles identical to b20d85c on ${I.same} of ${I.total} requests, answers and queries)`)
  if (process.argv.includes('--mutation')) {
    let killed = 0, total = 0
    for (const [list, which] of [[E_MUTANTS, 'exp'], [D_MUTANTS, 'doc']]) for (const [name, mutate] of list) {
      total++
      const base = which === 'exp' ? EXP_SRC : DOC_SRC, m = mutate(base)
      if (m === base) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      let bad
      try { const s = which === 'exp' ? await suite(m, DOC_SRC) : await suite(EXP_SRC, m); const i = which === 'exp' ? await internalSame(m, DOC_SRC) : await internalSame(EXP_SRC, m); bad = s.fail > 0 || i.same !== i.total } catch (e) { bad = true }
      if (bad) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${total} killed`)
    if (killed !== total) process.exitCode = 1
  }
  if (fail) process.exitCode = 1
})()
