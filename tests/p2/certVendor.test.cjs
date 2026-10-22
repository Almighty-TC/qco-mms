// P2e — vendor scoping of certificates in server/routes/traceability.js (summary, list, detail, tags,
// upload, version, file) and the certificate download in server/routes/documents.js, plus the
// version-upload storage fix (§15 (cd)); P2g: the vendor's summary and list cover the categories vdrl and approval
// (§15 (cs)). The real routers over a fake db that applies the scoping, category and status conditions
// itself; multer, the blob store, the schema check and the Azure SDK are stubbed (no database, no
// files). Internal roles: answers and queries equal to both files at 4b23db9 (git show; queries
// compared with whitespace collapsed), except the version upload. Exit code 1 on any failure.
// Usage: node tests/p2/certVendor.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const TR = path.join(ROOT, 'routes/traceability.js'), DOC = path.join(ROOT, 'routes/documents.js')
const TR_SRC = fs.readFileSync(TR, 'utf8'), DOC_SRC = fs.readFileSync(DOC, 'utf8')
const show = f => execFileSync('git', ['-C', REPO, 'show', '4b23db9:server/' + f], { encoding: 'utf8' })
const TR_BEFORE = show('routes/traceability.js'), DOC_BEFORE = show('routes/documents.js')

// ── fake data: POs 100 (project 27, supplier 5), 200 (27, supplier 9), 300 (28, supplier 5) ──
const POS = { 100: { project: 27, supplier: 5, po_number: 'PO-100', vendor_name: 'Vendor Five' }, 200: { project: 27, supplier: 9, po_number: 'PO-200', vendor_name: 'Vendor Nine' }, 300: { project: 28, supplier: 5, po_number: 'PO-300', vendor_name: 'Vendor Five' } }
// [project, po_id, status, category (vdrl when absent)]; 9 and 10 are approval certificates, 11 an unlisted category.
const CERTS = { 1: [27, 100, 'pending'], 2: [27, 100, 'received'], 3: [27, 100, 'verified'], 4: [27, 100, 'overdue'], 5: [27, 100, 'rejected'], 6: [27, 200, 'pending'], 7: [27, null, 'pending'], 8: [28, 300, 'pending'],
  9: [27, 100, 'pending', 'approval'], 10: [27, 100, 'rejected', 'approval'], 11: [27, 100, 'pending', 'mtc'], 12: [27, 200, 'overdue', 'approval'] }
const catOf = id => CERTS[id][3] || 'vdrl'
// The category and status conditions in a query, as the database would apply them (null: no condition).
const catSet = q => { let m = q.match(/category IN \(([^)]*)\)/); if (m) return new Set(m[1].split(',').map(x => x.trim().replace(/'/g, ''))); m = q.match(/category='(\w+)'/); return m ? new Set([m[1]]) : null }
const statusSet = q => { if (/status IN \('received','verified'\)/.test(q)) return new Set(['received', 'verified']); const m = q.match(/ status='(\w+)'/); return m ? new Set([m[1]]) : null }
const CERT_COLS = 'id project_id category po_id po_ref vendor_name tag document_name cert_type item_scope heat_ref applies_to issue_date due_date received_date is_required uploader file_name file_size status priority uploaded_by uploaded_date verified_by verified_date reject_reason notes created_at file_path mime_type'.split(' ')
const certRowOf = id => ({ ...Object.fromEntries(CERT_COLS.map(c => [c, 'S:' + c])), id, project_id: CERTS[id][0], po_id: CERTS[id][1], status: CERTS[id][2], file_path: null })
const ownPo = (poId, project, supplier) => poId != null && POS[poId] && POS[poId].project === project && POS[poId].supplier === supplier
let calls = [], FAIL_VERSION_INSERT = false
const norm = s => s.replace(/\s+/g, ' ').trim()
const DENIED = { vendor: new Set(['can_edit', 'can_approve', 'can_delete']) }
const fakeDb = { query: async (sql, params = []) => {
  const q = norm(sql)
  calls.push({ q, params })
  let m
  if ((m = q.match(/^SELECT (\w+) AS allowed FROM role_permissions/))) return [[{ allowed: DENIED[params[0]] && DENIED[params[0]].has(m[1]) ? 0 : 1 }], []]
  if (/^SELECT \w+ AS allowed FROM user_permission_overrides/.test(q)) return [[], []]
  if (/^SELECT id FROM user_wbs_access WHERE user_id = \? AND project_id = \?/.test(q)) return [Number(params[1]) === 27 ? [{ id: 1 }] : [], []]
  if ((m = q.match(/^SELECT SUM\((category(?:='\w+'| IN \([^)]*\))) AND status IN \('received','verified'\)\) AS vdrl_received/))) {
    const cats = catSet(m[1]), none = / AND 1=0$/.test(q), scoped = /po_id IN \(SELECT id FROM purchase_orders WHERE supplier_id = \? AND project_id = \?\)$/.test(q)
    const ids = Object.keys(CERTS).map(Number).filter(id => !none && CERTS[id][0] === params[0] && cats.has(catOf(id)) && (!scoped || ownPo(CERTS[id][1], params[2], params[1])))
    const n = st => String(ids.filter(id => st.includes(CERTS[id][2])).length)
    return [[{ vdrl_received: n(['received', 'verified']), vdrl_pending: n(['pending']), vdrl_overdue: n(['overdue']) }], []]
  }
  if (/^SELECT COUNT\(\*\) AS active_holds FROM traceability_holds/.test(q)) return [[{ active_holds: 4 }], []]
  if (/^SELECT c\.id AS cert_id/.test(q)) {
    if (/WHERE c\.id=\?$/.test(q)) return [[{ cert_id: params[0], verified_by: 'Verifier Name', vendor_name_should_not_matter: 1, ...Object.fromEntries(CERT_COLS.filter(c => c !== 'id' && c !== 'verified_by').map(c => [c, 'S:' + c])) }], []]
    // WHERE c.id IN (SELECT id FROM traceability_certs WHERE <conds>[ AND po_id IN (...) | AND 1=0])
    const scoped = /po_id IN \(SELECT id FROM purchase_orders WHERE supplier_id = \? AND project_id = \?\)\)/.test(q), none = / AND 1=0\)/.test(q)
    const [sup, proj] = scoped ? params.slice(-2) : [null, null]
    const single = /WHERE id=\? AND project_id=\?/.test(q)
    const cats = catSet(q), sts = statusSet(q)
    const ids = Object.keys(CERTS).map(Number).filter(id => !none && (single ? id === params[0] && CERTS[id][0] === params[1] : CERTS[id][0] === params[0]) && scoped && ownPo(CERTS[id][1], proj, sup)
      && (!cats || cats.has(catOf(id))) && (!sts || sts.has(CERTS[id][2])))
    return [ids.map(id => ({ cert_id: id, verified_by: 'Verifier Name', ...Object.fromEntries(CERT_COLS.filter(c => c !== 'id' && c !== 'verified_by').map(c => [c, 'S:' + c])), status: CERTS[id][2] })), []]
  }
  if (/^SELECT id AS cert_id, po_ref, vendor_name, tag/.test(q)) return [Object.keys(CERTS).map(Number).filter(id => CERTS[id][0] === params[0]).map(id => ({ cert_id: id, po_ref: 'R', vendor_name: 'V', status: CERTS[id][2] })), []]
  if (/^SELECT id, po_ref, vendor_name, tag, document_name, cert_type, item_scope/.test(q)) return [CERTS[params[0]] && CERTS[params[0]][0] === params[1] ? [certRowOf(params[0])] : [], []]
  if (/FROM traceability_cert_versions WHERE cert_id=\? ORDER BY rev$/.test(q)) return [[{ id: 61, rev: 'A', heat_ref: 'H', applies_to: 'x', file_name: 'a.pdf', file_size: 9, status: 'received', uploaded_by: 'Uploader', uploaded_date: 'd', verified_by: 'Verifier', verified_date: 'e' }], []]
  if (/^SELECT DISTINCT tag FROM traceability_trace_lifecycle/.test(q)) return [[{ tag: 'T1' }], []]
  if (/^SELECT id, status FROM traceability_certs WHERE id=\? AND project_id=\?( AND 1=0| AND po_id IN \(SELECT id FROM purchase_orders WHERE supplier_id = \? AND project_id = \?\))$/.test(q)) {
    const id = params[0], c = CERTS[id]; return [c && c[0] === params[1] && params.length === 4 && ownPo(c[1], params[3], params[2]) ? [{ id, status: c[2] }] : [], []]
  }
  if (/^SELECT received_date FROM traceability_certs WHERE id=\?$/.test(q)) return [CERTS[params[0]] ? [{ received_date: null }] : [], []]
  if (/^SELECT id, po_number, vendor_name FROM purchase_orders WHERE id=\? AND project_id=\? AND supplier_id=\?$/.test(q)) {
    const p = POS[params[0]]; return [p && p.project === params[1] && p.supplier === params[2] ? [{ id: params[0], po_number: p.po_number, vendor_name: p.vendor_name }] : [], []]
  }
  if (/^SELECT \* FROM traceability_certs WHERE id=\? AND project_id=\?$/.test(q)) return [CERTS[params[0]] && CERTS[params[0]][0] === params[1] ? [certRowOf(params[0])] : [], []]
  if (/^SELECT project_id, po_id, status FROM traceability_certs WHERE id = \?$/.test(q)) { const c = CERTS[params[0]]; return [c ? [{ project_id: c[0], po_id: c[1], status: c[2] }] : [], []] }
  if (/^SELECT id FROM purchase_orders WHERE id = \? AND project_id = \? AND supplier_id = \?$/.test(q)) return [ownPo(params[0], params[1], params[2]) ? [{ id: params[0] }] : [], []]
  if (/^SELECT id, document_name FROM traceability_certs WHERE id=\?$/.test(q)) return [CERTS[params[0]] ? [{ id: params[0], document_name: 'D' }] : [], []]
  if (/^SELECT COUNT\(\*\) AS n FROM traceability_cert_versions/.test(q)) return [[{ n: 1 }], []]
  if (/^SELECT \* FROM traceability_certs WHERE id=\?$/.test(q)) return [CERTS[params[0]] ? [certRowOf(params[0])] : [], []]
  if (/^INSERT INTO traceability_cert_versions/.test(q) && FAIL_VERSION_INSERT) throw new Error('fake insert failure')
  if (/^(INSERT|UPDATE) /.test(q)) return [{ insertId: 900, affectedRows: 1 }, undefined]
  if (/^SELECT file_name, file_path, mime_type FROM traceability_certs WHERE id=\? AND project_id=\?$/.test(q)) return [CERTS[params[0]] && CERTS[params[0]][0] === params[1] ? [{ file_name: 'c.pdf', file_path: 'uploads/traceability/c.pdf', mime_type: 'application/pdf' }] : [], []]
  if (/^SELECT c\.id FROM traceability_certs c JOIN purchase_orders po ON po\.id = c\.po_id WHERE c\.id=\? AND po\.supplier_id=\?$/.test(q)) { const c = CERTS[params[0]]; return [c && c[1] != null && POS[c[1]].supplier === params[1] ? [{ id: params[0] }] : [], []] }
  throw new Error('unexpected query: ' + q.slice(0, 110))
} }

// ── stubs ──
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
stub(require.resolve(path.join(ROOT, 'lib/schemaColumns.js')), { fileColumns: async () => new Set(['traceability_certs.file_path']), fileColumnsReady: async () => true })
stub(require.resolve('@azure/storage-blob', { paths: [ROOT] }), { BlobServiceClient: { fromConnectionString: () => ({ getContainerClient: () => ({ getBlockBlobClient: k => ({ deleteIfExists: async () => { blobDeletes.push(k) } }) }) }) } })
const realUnlink = fs.unlinkSync
fs.unlinkSync = p => { if (String(p).includes('uploads/traceability')) unlinks.push(p); else return realUnlink(p) }
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'))
const { JWT_SECRET } = require(path.join(ROOT, 'middleware/auth'))

function compile(file, src) {
  const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(src, file); return m.exports
}
const FILE = { originalname: 'cert.pdf', size: 5, mimetype: 'application/pdf', buffer: Buffer.from('%PDF-') }
function call(router, base, user, method, url, { file, body } = {}) {
  return new Promise(resolve => {
    const [, qs] = url.split('?')
    const req = { method, url, originalUrl: base + url, headers: { authorization: 'Bearer ' + jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '10m' }) },
      query: Object.fromEntries(new URLSearchParams(qs || '')), body: body || {}, ip: '127.0.0.1', _file: file }
    if (user.role === 'vendor') req.externalScope = { userId: user.id, role: 'vendor', supplierId: user.supplier_id ?? null }
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] },
      status(c) { this.statusCode = c; return this }, json(o) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(o ?? null)) }) },
      send(b) { resolve({ status: this.statusCode, body: Buffer.isBuffer(b) ? 'PDF:' + b.length : b }) }, end(b) { resolve({ status: this.statusCode, body: String(b) }) } }
    router(req, res, err => resolve({ status: err ? 500 : 404, body: { fellThrough: true, err: err && err.message } }))
  })
}
const V5 = { id: 711, role: 'vendor', supplier_id: 5 }, V9 = { id: 696, role: 'vendor', supplier_id: 9 }, VNULL = { id: 712, role: 'vendor', supplier_id: null }
const INTERNAL = [{ id: 4, role: 'admin' }, { id: 687, role: 'materials_engineer' }, { id: 30, role: 'expeditor' }]
const K = s => JSON.stringify(s.split(' '))
const CERT_KEYS = K('cert_id po_ref document_name cert_type heat_ref applies_to tag is_required file_name status issue_date due_date received_date uploaded_date verified_date verified_by reject_reason')
const VER_KEYS = K('id rev heat_ref applies_to file_name status uploaded_date verified_date verified_by')
const keysOf = o => JSON.stringify(Object.keys(o || {}))
const BODY_REQ = id => ({ heat_ref: 'H-1', document_requirement_id: String(id), po_ref: 'FORGED', vendor_name: 'FORGED' })
const BODY_ADHOC = po => ({ heat_ref: 'H-1', po_id: po == null ? undefined : String(po), po_ref: 'FORGED', vendor_name: 'FORGED', document_name: 'Ad hoc' })

async function suite(trSrc, docSrc) {
  const T = compile(TR, trSrc), D = compile(DOC, docSrc)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const reset = () => { STORE = 'disk'; persisted = []; blobDeletes = []; unlinks = []; FAIL_VERSION_INSERT = false }
  const go = async (user, method, url, opts) => { calls = []; return call(T, '/api/traceability', user, method, url, opts) }
  const q1 = re => calls.find(c => re.test(c.q))
  const writes = () => calls.filter(c => /^(INSERT|UPDATE|DELETE)/.test(c.q))
  reset()

  // summary, list, detail, tags
  let r = await go(V5, 'GET', '/27/summary')
  let c = q1(/^SELECT SUM\(category/), h = q1(/^SELECT COUNT\(\*\) AS active_holds/)
  check(r.status === 200 && keysOf(r.body) === K('vdrl_received vdrl_pending vdrl_overdue active_holds'), 'vendor summary projected')
  check(c && /WHERE project_id=\? AND po_id IN \(SELECT id FROM purchase_orders WHERE supplier_id = \? AND project_id = \?\)$/.test(c.q) && JSON.stringify(c.params) === '[27,5,27]', 'vendor summary counts: own POs')
  check(c && (c.q.match(/category IN \('vdrl','approval'\)/g) || []).length === 3 && !/category='vdrl'/.test(c.q), 'P2g vendor summary: the explicit category list vdrl, approval in all three counts')
  check(JSON.stringify(r.body) === '{"vdrl_received":2,"vdrl_pending":2,"vdrl_overdue":1,"active_holds":4}', 'P2g vendor summary: both categories counted (pending 1 and 9), the unlisted category (11) and other suppliers (12) not')
  check(h && /JOIN traceability_certs c ON c\.id = h\.related_cert_id/.test(h.q) && /c\.po_id IN \(SELECT id FROM purchase_orders/.test(h.q) && JSON.stringify(h.params) === '[27,5,27]', 'vendor active holds: holds on its own certificates')
  r = await go(VNULL, 'GET', '/27/summary'); c = q1(/^SELECT SUM\(category/); h = q1(/^SELECT COUNT\(\*\) AS active_holds/)
  check(c && / AND 1=0$/.test(c.q) && h && / AND 1=0$/.test(h.q), 'unlinked vendor summary: 1=0')
  check(r.body.vdrl_received === 0 && r.body.vdrl_pending === 0 && r.body.vdrl_overdue === 0, 'P2g unlinked vendor summary: zero counts')
  r = await go(V5, 'GET', '/27/vdrl')
  check(r.status === 200 && JSON.stringify(r.body.data.map(x => x.cert_id).sort((a, b) => a - b)) === '[1,2,3,4,5,9,10]', 'P2g vendor list: its POs only, categories vdrl and approval (not 11 of an unlisted category, not 6 or 12 of another supplier, not 7 without a PO)')
  c = q1(/^SELECT c\.id AS cert_id/); check(c && /category IN \('vdrl','approval'\)/.test(c.q) && !/category='vdrl'/.test(c.q), 'P2g vendor list: the explicit category list in the query')
  check(r.body.data.every(x => keysOf(x) === CERT_KEYS) && r.body.data[0].verified_by === 'Verifier Name', 'vendor list projected (verifier name)')
  r = await go(V5, 'GET', '/27/vdrl?status=pending&q=abc'); c = q1(/^SELECT c\.id AS cert_id/)
  check(c && JSON.stringify(c.params) === '[27,"%abc%","%abc%","%abc%","%abc%",5,27]', 'vendor list: filters kept, scope appended')
  r = await go(V5, 'GET', '/27/vdrl?status=pending')
  check(JSON.stringify(r.body.data.map(x => x.cert_id).sort((a, b) => a - b)) === '[1,9]', 'P2g vendor list, status pending: both categories (1 vdrl, 9 approval), not 11')
  r = await go(V5, 'GET', '/27/vdrl?status=received')
  check(JSON.stringify(r.body.data.map(x => x.cert_id).sort((a, b) => a - b)) === '[2,3]', 'P2g vendor list, status received: received and verified')
  r = await go(VNULL, 'GET', '/27/vdrl')
  check(r.status === 200 && r.body.data.length === 0, 'unlinked vendor list: nothing')
  r = await go(V5, 'GET', '/27/cert/1')
  check(r.status === 200 && keysOf(r.body) === '["cert","versions"]' && keysOf(r.body.cert) === CERT_KEYS && r.body.versions.every(v => keysOf(v) === VER_KEYS), 'vendor detail, own certificate: projected')
  for (const [u, id, name] of [[V5, 6, 'another supplier'], [V5, 7, 'no PO'], [V5, 8, 'another project'], [VNULL, 1, 'unlinked'], [V9, 1, 'supplier 9 on 5\'s certificate']]) {
    r = await go(u, 'GET', `/27/cert/${id}`)
    check(r.status === 404 && r.body.error === 'Certificate not found' && !q1(/FROM traceability_cert_versions/), `vendor detail, ${name}: 404`)
  }
  r = await go(V5, 'GET', '/27/tags')
  check(r.status === 200 && JSON.stringify(r.body) === '{"tags":[]}' && !q1(/traceability_trace_lifecycle/), 'vendor tags: [] without a query')

  // POST :pid/cert
  for (const id of [1, 4, 5]) {
    reset(); r = await go(V5, 'POST', '/27/cert', { file: FILE, body: BODY_REQ(id) })
    check(r.status === 201 && keysOf(r.body) === CERT_KEYS && persisted.length === 1 && q1(/^UPDATE traceability_certs SET status='received'/), `vendor upload against its own ${CERTS[id][2]} requirement: 201, projected`)
  }
  for (const id of [2, 3]) {
    reset(); r = await go(V5, 'POST', '/27/cert', { file: FILE, body: BODY_REQ(id) })
    check(r.status === 409 && r.body.error === `A certificate cannot be uploaded while the requirement is ${CERTS[id][2]}` && persisted.length === 0 && writes().length === 0, `vendor upload against its own ${CERTS[id][2]} requirement: 409, nothing stored`)
  }
  for (const [id, name] of [[6, 'another supplier\'s requirement'], [7, 'a requirement without a PO'], [8, 'a requirement in another project']]) {
    reset(); r = await go(V5, 'POST', '/27/cert', { file: FILE, body: BODY_REQ(id) })
    check(r.status === 403 && r.body.error === 'Access denied' && persisted.length === 0 && writes().length === 0, `vendor upload against ${name}: 403, nothing stored`)
  }
  reset(); r = await go(V5, 'POST', '/27/cert', { file: FILE, body: BODY_ADHOC(100) })
  const ins = q1(/^INSERT INTO traceability_certs/)
  check(r.status === 201 && ins && ins.params[1] === 100 && ins.params[2] === 'PO-100' && ins.params[3] === 'Vendor Five' && /'received', 0/.test(ins.q), 'vendor ad hoc on its own PO: po_ref and vendor_name from the PO, status server-set')
  check(keysOf(r.body) === CERT_KEYS, 'vendor ad hoc: projected response')
  for (const [po, name, code] of [[200, 'another supplier\'s PO', 403], [300, 'a PO in another project', 403], [null, 'no PO', 422]]) {
    reset(); r = await go(V5, 'POST', '/27/cert', { file: FILE, body: BODY_ADHOC(po) })
    check(r.status === code && persisted.length === 0 && writes().length === 0, `vendor ad hoc with ${name}: ${code}, nothing stored`)
  }
  reset(); r = await go(VNULL, 'POST', '/27/cert', { file: FILE, body: BODY_ADHOC(100) })
  check(r.status === 403 && persisted.length === 0, 'unlinked vendor upload: 403')

  // version upload: scope, status, the storage fix
  for (const id of [1, 4, 5]) {
    reset(); r = await go(V5, 'POST', `/cert/${id}/version`, { file: FILE, body: { heat_ref: 'H-2' } })
    const up = q1(/^UPDATE traceability_certs SET file_name=\?, file_size=\?, file_path=\?, mime_type=\? WHERE id=\?$/)
    check(r.status === 201 && persisted.length === 1 && q1(/^INSERT INTO traceability_cert_versions/) && up && up.params[2] === 'uploads/traceability/' + path.basename(persisted[0]) && up.params[4] === id, `vendor version on ${CERTS[id][2]} certificate ${id}: stored and recorded`)
    const rc = q1(/^UPDATE traceability_certs SET status='received', received_date=\? WHERE id=\? AND status IN \(\?,\?,\?\)$/)
    check(rc && /^\d{4}-\d{2}-\d{2}$/.test(rc.params[0]) && JSON.stringify(rc.params.slice(1)) === JSON.stringify([id, 'pending', 'overdue', 'rejected']), `vendor version on ${CERTS[id][2]} certificate ${id}: back to received with today's received_date (conditional)`)
    const dc = q1(/^INSERT INTO date_change_log/)
    check(dc && dc.params[0] === 'traceability_cert' && dc.params[1] === id && dc.params[2] === 'received_date' && dc.params[5] === 'Cert received via version upload', `vendor version on certificate ${id}: date-change entry as the first upload writes`)
  }
  for (const id of [2, 3]) {
    reset(); r = await go(V5, 'POST', `/cert/${id}/version`, { file: FILE, body: { heat_ref: 'H-2' } })
    check(r.status === 409 && r.body.error === `A version cannot be added while the certificate is ${CERTS[id][2]}` && persisted.length === 0 && writes().length === 0, `vendor version on ${CERTS[id][2]}: 409, nothing stored`)
  }
  for (const [u, id, code, err, name] of [[V5, 6, 403, 'Access denied', 'another supplier'], [V5, 7, 403, 'Access denied', 'no PO'], [V5, 8, 403, 'No project access', 'another project without a grant'],
    [V5, 999, 404, 'Certificate not found', 'unknown'], [VNULL, 1, 403, 'Access denied', 'unlinked']]) {
    reset(); r = await go(u, 'POST', `/cert/${id}/version`, { file: FILE, body: { heat_ref: 'H-2' } })
    check(r.status === code && r.body.error === err && persisted.length === 0 && writes().length === 0, `vendor version, ${name}: ${code}`)
  }
  for (const u of INTERNAL.filter(x => x.role !== 'materials_engineer')) {
    reset(); r = await go(u, 'POST', '/cert/2/version', { file: FILE, body: { heat_ref: 'H-2' } })
    const up = q1(/^UPDATE traceability_certs SET file_name=\?, file_size=\?, file_path=\?, mime_type=\? WHERE id=\?$/)
    check(r.status === 201 && persisted.length === 1 && up && !q1(/^SELECT project_id, po_id, status FROM traceability_certs/), `${u.role} version: the file stored and recorded, no scope query`)
    check(!q1(/^UPDATE traceability_certs SET status='received'/) && !q1(/^INSERT INTO date_change_log/), `${u.role} version: the certificate status unchanged`)
  }
  for (const mode of ['disk', 'blob']) {
    reset(); STORE = mode; FAIL_VERSION_INSERT = true
    r = await go(INTERNAL[0], 'POST', '/cert/2/version', { file: FILE, body: { heat_ref: 'H-2' } })
    check(r.status === 500 && persisted.length === 1 && (mode === 'disk' ? unlinks.length === 1 && blobDeletes.length === 0 : blobDeletes.length === 1 && blobDeletes[0].startsWith('traceability/')), `version insert failure (${mode}): the stored file removed`)
  }
  // certificate file
  r = await go(V5, 'GET', '/cert/1/file'); check(r.status === 200, 'vendor file, own certificate: 200')
  for (const [u, id, code, name] of [[V5, 6, 403, 'another supplier'], [V5, 7, 403, 'no PO'], [V5, 8, 403, 'another project'], [V5, 999, 404, 'unknown'], [VNULL, 1, 403, 'unlinked']]) {
    r = await go(u, 'GET', `/cert/${id}/file`); check(r.status === code, `vendor file, ${name}: ${code}`)
  }
  // documents.js certificate download
  const dl = async (u, id) => { calls = []; return call(D, '/api/documents', u, 'GET', `/27/download/traceability:${id}`) }
  r = await dl(V5, 1); check(r.status === 200 && r.body === 'FILE', 'vendor download, own certificate: 200')
  for (const [u, id, name] of [[V5, 6, 'another supplier'], [V5, 7, 'no PO'], [VNULL, 1, 'unlinked']]) {
    r = await dl(u, id); check(r.status === 403 && r.body.error === 'Access denied', `vendor download, ${name}: 403`)
  }
  return { pass, fail, failed }
}

// Internal roles: NEW against 4b23db9, except the version upload (the fix).
async function internalSame(trSrc, docSrc) {
  const TN = compile(TR, trSrc), TB = compile(TR, TR_BEFORE), DN = compile(DOC, docSrc), DB = compile(DOC, DOC_BEFORE)
  const realNow = Date.now; Date.now = () => 1760000000000
  let same = 0, total = 0; const diffs = []
  try {
    const REQS = [['GET', '/27/summary'], ['GET', '/27/vdrl'], ['GET', '/27/vdrl?status=pending&q=abc'], ['GET', '/27/cert/1'], ['GET', '/27/cert/7'], ['GET', '/27/cert/99'], ['GET', '/27/tags'],
      ['POST', '/27/cert', BODY_REQ(1)], ['POST', '/27/cert', BODY_ADHOC(200)], ['GET', '/cert/1/file'], ['GET', '/cert/99/file']]
    for (const u of INTERNAL) {
      for (const [m, url, body] of REQS) {
        persisted = []; calls = []; const n = await call(TN, '/api/traceability', u, m, url, { body, file: m === 'POST' ? FILE : undefined }); const nq = calls
        persisted = []; calls = []; const b = await call(TB, '/api/traceability', u, m, url, { body, file: m === 'POST' ? FILE : undefined }); const bq = calls
        total++; if (JSON.stringify(n) === JSON.stringify(b) && JSON.stringify(nq) === JSON.stringify(bq)) same++; else diffs.push(`${u.role} ${m} ${url}`)
      }
      for (const id of [1, 6, 7, 99]) {
        calls = []; const n = await call(DN, '/api/documents', u, 'GET', `/27/download/traceability:${id}`); const nq = calls
        calls = []; const b = await call(DB, '/api/documents', u, 'GET', `/27/download/traceability:${id}`); const bq = calls
        total++; if (JSON.stringify(n) === JSON.stringify(b) && JSON.stringify(nq) === JSON.stringify(bq)) same++; else diffs.push(`${u.role} download traceability:${id}`)
      }
    }
  } finally { Date.now = realNow }
  return { same, total, diffs }
}

const T_MUTANTS = [
  ['no supplier scope', s => s.replace("return { sql: ` AND ${col} IN (SELECT id FROM purchase_orders WHERE supplier_id = ? AND project_id = ?)`, params: [Number(req.user.supplier_id), Number(pid)] }", "return { sql: '', params: [] }")],
  ['no 1=0 without a supplier', s => s.replace("if (req.user.supplier_id == null) return { sql: ' AND 1=0', params: [] }\n  return { sql: ` AND ${col}", "if (req.user.supplier_id == null) return { sql: '', params: [] }\n  return { sql: ` AND ${col}")],
  ['holds not scoped', s => s.replace("WHERE h.project_id=? AND h.status='active'${vendorPoScope(req, pid, 'c.po_id').sql}`, [pid, ...v.params])", "WHERE h.project_id=? AND h.status='active'`, [pid])")],
  ['summary not projected', s => s.replace('res.json(v ? vendorView.certSummary(body) : body)', 'res.json(v ? { ...body, extra: 1 } : body)')],
  ['list not projected', s => s.replace('return res.json({ data: vrows.map(vendorView.certRow) })', 'return res.json({ data: vrows })')],
  ['detail not scoped', s => s.replace("`${VENDOR_CERT_SELECT} WHERE c.id IN (SELECT id FROM traceability_certs WHERE id=? AND project_id=?${v.sql})`,\n        [certId, pid, ...v.params])", "`${VENDOR_CERT_SELECT} WHERE c.id IN (SELECT id FROM traceability_certs WHERE id=? AND project_id=?)`,\n        [certId, pid])")],
  ['versions not projected', s => s.replace('versions: vversions.map(vendorView.certVersion)', 'versions: vversions')],
  ['tags shown', s => s.replace("    if (isVendor(req)) return res.json({ tags: [] })   // P2e: the tag list is hidden from vendors\n", '')],
  ['requirement not checked', s => s.replace("        if (!own) return res.status(403).json({ error: 'Access denied' })\n        // 3T130", "        // 3T130").replace("if (!VENDOR_VERSION_STATUSES.includes(own.status)) {", "if (own && !VENDOR_VERSION_STATUSES.includes(own.status)) {")],
  ['ad hoc PO not required', s => s.replace("if (!po_id) return res.status(422).json({ error: 'A PO is required' })", '')],
  ['ad hoc PO not checked', s => s.replace("        if (!po) return res.status(403).json({ error: 'Access denied' })\n        vendorPo = po", '        vendorPo = po || null')],
  ['po_ref from the body', s => s.replace("vendorPo ? vendorPo.po_number : (po_ref || null)", "(po_ref || null)")],
  ['vendor_name from the body', s => s.replace("vendorPo ? vendorPo.vendor_name : (vendor_name || null)", "(vendor_name || null)")],
  ['upload response not projected', s => s.replace('return res.status(201).json(vendorView.certRow(row))', 'return res.status(201).json(row)')],
  ['no version scope', s => s.replace("router.post('/cert/:certId/version', certScope({ version: true }), upload", "router.post('/cert/:certId/version', upload")],
  ['no version status rule', s => s.replace('if (version && !VENDOR_VERSION_STATUSES.includes(c.status)) {', 'if (false) {')],
  ['no grant check', s => s.replace("if (!grant.length) return res.status(403).json({ error: 'No project access' })", '')],
  ['no PO ownership on versions', s => s.replace("        if (!po) return res.status(403).json({ error: 'Access denied' })\n        if (version", '        if (version')],
  ['version file not stored', s => s.replace('    stored = { ...(await blobStore.persist({', '    stored = { ...({ value: null, where: "none" } || await blobStore.persist({')],
  ['version path not recorded', s => s.replace("await db.query(`UPDATE traceability_certs SET file_name=?, file_size=?, file_path=?, mime_type=? WHERE id=?`,", "if (false) await db.query(`UPDATE traceability_certs SET file_name=?, file_size=?, file_path=?, mime_type=? WHERE id=?`,")],
  ['failed insert keeps the file', s => s.replace('    if (stored) await removeStoredCertFile(stored)\n', '')],
  ['vendor may fulfil any requirement', s => s.replace("        if (!VENDOR_VERSION_STATUSES.includes(own.status)) {\n          return res.status(409)", "        if (false) {\n          return res.status(409)")],
  ['version leaves the status', s => s.replace("    if (isVendor(req)) {\n      const [[prev]] = await db.query('SELECT received_date FROM traceability_certs WHERE id=?', [certId])", "    if (false) {\n      const [[prev]] = await db.query('SELECT received_date FROM traceability_certs WHERE id=?', [certId])")],
  ['received unconditionally', s => s.replace("`UPDATE traceability_certs SET status='received', received_date=? WHERE id=? AND status IN (?,?,?)`,\n        [today(), certId, ...VENDOR_VERSION_STATUSES])", "`UPDATE traceability_certs SET status='received', received_date=? WHERE id=?`,\n        [today(), certId])")],
  ['no date-change entry', s => s.replace("        await writeDateChange(uid, 'traceability_cert', certId, 'received_date', prev ? prev.received_date : null, today(),\n          'Cert received via version upload')", '        void prev')],
  ['no file scope', s => s.replace("requirePermission('traceability', 'can_view'), certScope({ version: false }), async", "requirePermission('traceability', 'can_view'), async")],
  ['P2g: vdrl only', s => s.replace("const VENDOR_CERT_CATEGORIES = \"category IN ('vdrl','approval')\"", "const VENDOR_CERT_CATEGORIES = \"category='vdrl'\"")],
  ['P2g: no category filter', s => s.replace("const VENDOR_CERT_CATEGORIES = \"category IN ('vdrl','approval')\"", "const VENDOR_CERT_CATEGORIES = \"1=1\"")],
  ['P2g: approval only', s => s.replace("const VENDOR_CERT_CATEGORIES = \"category IN ('vdrl','approval')\"", "const VENDOR_CERT_CATEGORIES = \"category='approval'\"")],
  ['P2g: list keeps vdrl only', s => s.replace("isVendor(req) ? VENDOR_CERT_CATEGORIES : \"category='vdrl'\"]", "\"category='vdrl'\"]")],
  ['P2g: summary keeps vdrl only', s => s.replace("const cat = v ? VENDOR_CERT_CATEGORIES : \"category='vdrl'\"", "const cat = \"category='vdrl'\"")],
]
const D_MUTANTS = [
  ['download: no vendor certificate check', s => s.replace("    if (user?.role === 'vendor') {\n      const [[o]] = user.supplier_id == null ? [[]] : await db.query(\n        `SELECT c.id FROM traceability_certs c", "    if (false) {\n      const [[o]] = user.supplier_id == null ? [[]] : await db.query(\n        `SELECT c.id FROM traceability_certs c")],
]

;(async () => {
  const r = await suite(TR_SRC, DOC_SRC)
  const I = await internalSame(TR_SRC, DOC_SRC)
  r.failed.forEach(n => console.log('FAIL ' + n)); I.diffs.forEach(d => console.log('FAIL internal differs from 4b23db9: ' + d))
  const fail = r.fail + (I.same === I.total ? 0 : 1)
  console.log(`certVendor: ${r.pass + (I.same === I.total ? 1 : 0)} passed, ${fail} failed (internal roles identical to 4b23db9 on ${I.same} of ${I.total} requests, answers and queries; the version upload excluded)`)
  if (process.argv.includes('--mutation')) {
    let killed = 0, total = 0
    for (const [list, which] of [[T_MUTANTS, 'tr'], [D_MUTANTS, 'doc']]) for (const [name, mutate] of list) {
      total++
      const base = which === 'tr' ? TR_SRC : DOC_SRC, m = mutate(base)
      if (m === base) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      let bad
      try { const s = which === 'tr' ? await suite(m, DOC_SRC) : await suite(TR_SRC, m); const i = which === 'tr' ? await internalSame(m, DOC_SRC) : await internalSame(TR_SRC, m); bad = s.fail > 0 || i.same !== i.total } catch (e) { bad = true }
      if (bad) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${total} killed`)
    if (killed !== total) process.exitCode = 1
  }
  if (fail) process.exitCode = 1
})()
