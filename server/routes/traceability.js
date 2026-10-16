// ─── TRACEABILITY ROUTES ──────────────────────────────────────
// VDRL register, cert approvals, trace chain, and holds.
// Mounted at /api/traceability. Pooled connections only (../db).
// All routes require a valid JWT via authenticateToken.
const express = require('express')
const router  = express.Router()
const path    = require('path')
const fs      = require('fs')
const multer  = require('multer')
const db      = require('../db')
const { fileColumnsReady } = require('../lib/schemaColumns')
const { authenticateToken } = require('../middleware/auth')

router.use(authenticateToken)
router.use(require('../middleware/permissions').denyReadOnly) // C-a: viewer/auditor barred from writes
router.use(require('../middleware/permissions').enforce('traceability')) // C-b2: upload=supplier/expeditor (can_create); verify/reject=materials_engineer (can_approve)
router.param('projectId', require('../middleware/permissions').requireProjectScope) // Stage 1: external roles WBS-scoped to granted projects

// ─── VENDOR SCOPE (P2e) ───────────────────────────────────────
// Vendors see and upload only certificates on their own supplier's POs (req.user.supplier_id,
// set from the users row by the external gate); certificates with no po_id are invisible.
// Internal roles are unchanged: every vendor fragment below is empty for them.
const vendorView = require('../lib/vendorView')
const { EXTERNAL_ROLES } = require('../middleware/permissions')
const VENDOR_VERSION_STATUSES = ['pending', 'overdue', 'rejected']
const isVendor = req => req.user?.role === 'vendor'
// "<col> IN (the vendor's POs in the project)", or 1=0 without a supplier.
function vendorPoScope(req, pid, col = 'po_id') {
  if (req.user.supplier_id == null) return { sql: ' AND 1=0', params: [] }
  return { sql: ` AND ${col} IN (SELECT id FROM purchase_orders WHERE supplier_id = ? AND project_id = ?)`, params: [Number(req.user.supplier_id), Number(pid)] }
}
// The vendor's certificate row (vendorView.certRow): verified_by is the verifier's name.
const VENDOR_CERT_SELECT = `SELECT c.id AS cert_id, c.po_ref, c.document_name, c.cert_type, c.heat_ref, c.applies_to, c.tag,
         c.is_required, c.file_name, c.status,
         DATE_FORMAT(c.issue_date, '%Y-%m-%d') AS issue_date, DATE_FORMAT(c.due_date, '%Y-%m-%d') AS due_date,
         DATE_FORMAT(c.received_date, '%Y-%m-%d') AS received_date, DATE_FORMAT(c.uploaded_date, '%Y-%m-%d') AS uploaded_date,
         DATE_FORMAT(c.verified_date, '%Y-%m-%d') AS verified_date, vu.full_name AS verified_by, c.reject_reason
       FROM traceability_certs c LEFT JOIN users vu ON vu.id = c.verified_by`

// ─── UPLOAD STORAGE ───────────────────────────────────────────
// Cert files land in uploads/traceability. 25 MB cap matches the
// foundational cert uploader.
const uploadDir = path.join(__dirname, '../uploads/traceability')
const blobStore = require('../lib/blobStore')   // blob migration
const { fileFilter } = require('../utils/upload')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: fileFilter('document') })

// ─── AUDIT HELPER ─────────────────────────────────────────────
// Mirrors the writeAudit used across the other route files.
async function writeAudit(userId, action, entity, id, before, after, resource, projectId = null) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id,action,entity_type,entity_id,project_id,before_value,after_value,resource) VALUES (?,?,?,?,?,?,?,?)`,
      [userId, action, entity, id, (Number(projectId) || null),
       before ? JSON.stringify(before) : null,
       after  ? JSON.stringify(after)  : null,
       resource]
    )
  } catch (e) { console.error('[audit] insert failed:', e.message) }
}

// ─── DATE-CHANGE LOG HELPER ───────────────────────────────────
// Records cert received / verification dates against date_change_log.
async function writeDateChange(userId, entity, id, field, oldVal, newVal, reason) {
  try {
    await db.query(
      `INSERT INTO date_change_log (entity_type, entity_id, field_name, old_value, new_value, change_reason, created_by) VALUES (?,?,?,?,?,?,?)`,
      [entity, id, field, oldVal, newVal, reason, userId]
    )
  } catch (_) {}
}

const today = () => new Date().toISOString().slice(0, 10)

// ═══════════════════════════════════════════════════════════════
// SUMMARY — KPI strip
// ═══════════════════════════════════════════════════════════════
// GET /api/traceability/:projectId/summary
router.get('/:projectId/summary', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const v = isVendor(req) ? vendorPoScope(req, pid) : null   // P2e: the vendor's own POs only
    const [[counts]] = await db.query(
      `SELECT
         SUM(category='vdrl' AND status IN ('received','verified')) AS vdrl_received,
         SUM(category='vdrl' AND status='pending')                  AS vdrl_pending,
         SUM(category='vdrl' AND status='overdue')                  AS vdrl_overdue
       FROM traceability_certs WHERE project_id=?${v ? v.sql : ''}`, [pid, ...(v ? v.params : [])])
    // Holds link to certificates (related_cert_id); for vendors only holds on their own certificates.
    const [[holds]] = v
      ? await db.query(
        `SELECT COUNT(*) AS active_holds FROM traceability_holds h JOIN traceability_certs c ON c.id = h.related_cert_id
         WHERE h.project_id=? AND h.status='active'${vendorPoScope(req, pid, 'c.po_id').sql}`, [pid, ...v.params])
      : await db.query(
        `SELECT COUNT(*) AS active_holds FROM traceability_holds WHERE project_id=? AND status='active'`, [pid])
    const body = {
      vdrl_received: Number(counts.vdrl_received) || 0,
      vdrl_pending:  Number(counts.vdrl_pending)  || 0,
      vdrl_overdue:  Number(counts.vdrl_overdue)  || 0,
      active_holds:  Number(holds.active_holds)   || 0,
    }
    res.json(v ? vendorView.certSummary(body) : body)
  } catch (e) {
    res.status(500).json({ error: 'Could not load traceability summary: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// VDRL — Vendor Document Requirements List
// ═══════════════════════════════════════════════════════════════
// GET /api/traceability/:projectId/vdrl?status=all|received|pending|overdue&q=
router.get('/:projectId/vdrl', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { status = 'all', q } = req.query
    const conds = ['project_id=?', "category='vdrl'"]
    const params = [pid]

    if (status === 'received') conds.push("status IN ('received','verified')")
    else if (status === 'pending') conds.push("status='pending'")
    else if (status === 'overdue') conds.push("status='overdue'")

    if (q && q.trim()) {
      const like = `%${q.trim()}%`
      conds.push('(po_ref LIKE ? OR vendor_name LIKE ? OR tag LIKE ? OR document_name LIKE ?)')
      params.push(like, like, like, like)
    }

    if (isVendor(req)) {   // P2e: the vendor's own POs only, projected
      const v = vendorPoScope(req, pid)
      const [vrows] = await db.query(
        `${VENDOR_CERT_SELECT}
         WHERE c.id IN (SELECT id FROM traceability_certs WHERE ${conds.join(' AND ')}${v.sql})
         ORDER BY FIELD(c.status,'overdue','pending','received','verified','rejected'), c.due_date`,
        [...params, ...v.params])
      return res.json({ data: vrows.map(vendorView.certRow) })
    }

    const [rows] = await db.query(
      `SELECT id AS cert_id, po_ref, vendor_name, tag, document_name, is_required, status,
              DATE_FORMAT(due_date, '%Y-%m-%d')      AS due_date,
              DATE_FORMAT(received_date, '%Y-%m-%d')  AS received_date
       FROM traceability_certs
       WHERE ${conds.join(' AND ')}
       ORDER BY FIELD(status,'overdue','pending','received','verified','rejected'), due_date`,
      params
    )
    res.json({ data: rows })
  } catch (e) {
    res.status(500).json({ error: 'Could not load VDRL register: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// CERT DETAIL — cert + versions
// ═══════════════════════════════════════════════════════════════
// GET /api/traceability/:projectId/cert/:certId
router.get('/:projectId/cert/:certId', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const certId = Number(req.params.certId)
    if (isVendor(req)) {   // P2e: only a certificate on the vendor's own PO; projected
      const v = vendorPoScope(req, pid)
      const [[vc]] = await db.query(
        `${VENDOR_CERT_SELECT} WHERE c.id IN (SELECT id FROM traceability_certs WHERE id=? AND project_id=?${v.sql})`,
        [certId, pid, ...v.params])
      if (!vc) return res.status(404).json({ error: 'Certificate not found' })
      const [vversions] = await db.query(
        `SELECT id, rev, heat_ref, applies_to, file_name, status,
                DATE_FORMAT(created_date, '%Y-%m-%d')  AS uploaded_date,
                verified_by_name AS verified_by,
                DATE_FORMAT(verified_date, '%Y-%m-%d') AS verified_date
         FROM traceability_cert_versions WHERE cert_id=? ORDER BY rev`, [certId])
      return res.json({ cert: vendorView.certRow(vc), versions: vversions.map(vendorView.certVersion) })
    }
    const [[cert]] = await db.query(
      `SELECT id, po_ref, vendor_name, tag, document_name, cert_type, item_scope,
              heat_ref, applies_to, file_name, file_size, status, priority, verified_by,
              DATE_FORMAT(issue_date, '%Y-%m-%d')    AS issue_date,
              DATE_FORMAT(due_date, '%Y-%m-%d')      AS due_date,
              DATE_FORMAT(received_date, '%Y-%m-%d')  AS received_date,
              DATE_FORMAT(uploaded_date, '%Y-%m-%d')  AS uploaded_date,
              DATE_FORMAT(verified_date, '%Y-%m-%d')  AS verified_date
       FROM traceability_certs WHERE id=? AND project_id=?`, [certId, pid])
    if (!cert) return res.status(404).json({ error: 'Certificate not found' })

    const [versions] = await db.query(
      `SELECT id, rev, heat_ref, applies_to, file_name, file_size, status,
              created_by_name AS uploaded_by,
              DATE_FORMAT(created_date, '%Y-%m-%d')  AS uploaded_date,
              verified_by_name AS verified_by,
              DATE_FORMAT(verified_date, '%Y-%m-%d') AS verified_date
       FROM traceability_cert_versions WHERE cert_id=? ORDER BY rev`, [certId])

    res.json({ cert, versions })
  } catch (e) {
    res.status(500).json({ error: 'Could not load certificate detail: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// UPLOAD CERT — multipart
// ═══════════════════════════════════════════════════════════════
// POST /api/traceability/:projectId/cert
// body: po_id, po_ref, vendor_name, tag, document_requirement_id (nullable),
//       document_name, heat_ref (required), issue_date, applies_to, notes, file (required)
router.post('/:projectId/cert', upload.single('file'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const uid = req.user?.id
    const { po_id, po_ref, vendor_name, tag, document_requirement_id,
            document_name, heat_ref, issue_date, applies_to, notes } = req.body

    if (!heat_ref || !heat_ref.trim()) return res.status(422).json({ error: 'Heat / batch / ref number is required' })
    if (!req.file) return res.status(422).json({ error: 'A certificate file is required' })

    // P2e: a vendor uploads only against a requirement on its own PO in this project, or ad hoc
    // for its own PO (po_ref and vendor_name then come from that PO) — checked before storing.
    let vendorPo = null
    if (isVendor(req)) {
      if (req.user.supplier_id == null) return res.status(403).json({ error: 'Access denied' })
      const v = vendorPoScope(req, pid)
      if (document_requirement_id && Number(document_requirement_id)) {
        const [[own]] = await db.query(`SELECT id, status FROM traceability_certs WHERE id=? AND project_id=?${v.sql}`,
          [Number(document_requirement_id), pid, ...v.params])
        if (!own) return res.status(403).json({ error: 'Access denied' })
        // 3T130: a vendor fulfils a requirement only while it is pending, overdue or rejected.
        if (!VENDOR_VERSION_STATUSES.includes(own.status)) {
          return res.status(409).json({ error: `A certificate cannot be uploaded while the requirement is ${own.status}` })
        }
      } else {
        if (!po_id) return res.status(422).json({ error: 'A PO is required' })
        const [[po]] = await db.query('SELECT id, po_number, vendor_name FROM purchase_orders WHERE id=? AND project_id=? AND supplier_id=?',
          [Number(po_id), pid, Number(req.user.supplier_id)])
        if (!po) return res.status(403).json({ error: 'Access denied' })
        vendorPo = po
      }
    }

    const fileName = req.file.originalname
    const fileSize = req.file.size
    // Blob migration: persist to blob (key) or disk (legacy relative shape — unchanged).
    const traceStoredName = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.\-]+/g, '_')}`
    const traceDiskAbs = path.join(uploadDir, traceStoredName)
    const { value: filePath } = await blobStore.persist({
      key: blobStore.keyFor('traceability', traceStoredName),
      diskAbsPath: traceDiskAbs, buffer: req.file.buffer, contentType: req.file.mimetype,
      diskValue: path.relative(path.join(__dirname, '..'), traceDiskAbs),
    })
    const mimeType = req.file.mimetype
    const reqId = document_requirement_id && Number(document_requirement_id)

    let certId
    if (reqId) {
      // ── Mark an existing VDRL requirement as received ─────────
      const [[reqRow]] = await db.query(
        `SELECT * FROM traceability_certs WHERE id=? AND project_id=?`, [reqId, pid])
      if (!reqRow) return res.status(404).json({ error: 'VDRL requirement not found' })
      const before = { status: reqRow.status, received_date: reqRow.received_date }
      await db.query(
        `UPDATE traceability_certs
           SET status='received', received_date=?, heat_ref=?, applies_to=?, file_name=?, file_size=?,
               issue_date=?, notes=?, uploaded_by=?, uploaded_date=NOW()
         WHERE id=?`,
        [today(), heat_ref.trim(), applies_to || null, fileName, fileSize,
         issue_date || null, notes || null, uid, reqId])
      certId = reqId
      await writeDateChange(uid, 'traceability_cert', certId, 'received_date', reqRow.received_date, today(),
        'Cert received via upload')
      await writeAudit(uid, 'cert_received', 'traceability_cert', certId, before,
        { status: 'received', heat_ref: heat_ref.trim(), file_name: fileName },
        `VDRL ${reqRow.document_name} marked received`, Number(req.params.projectId) || null)
    } else {
      // ── Ad-hoc cert ───────────────────────────────────────────
      const [r] = await db.query(
        `INSERT INTO traceability_certs
           (project_id, category, po_id, po_ref, vendor_name, tag, document_name, cert_type,
            heat_ref, applies_to, issue_date, file_name, file_size, status, is_required,
            uploaded_by, uploaded_date, received_date, notes)
         VALUES (?, 'vdrl', ?, ?, ?, ?, ?, 'Certificate', ?, ?, ?, ?, ?, 'received', 0, ?, NOW(), ?, ?)`,
        [pid, vendorPo ? vendorPo.id : (po_id || null), vendorPo ? vendorPo.po_number : (po_ref || null),
         vendorPo ? vendorPo.vendor_name : (vendor_name || null), tag || null,
         document_name || 'Ad-hoc certificate', heat_ref.trim(), applies_to || null, issue_date || null,
         fileName, fileSize, uid, today(), notes || null])
      certId = r.insertId
      await writeAudit(uid, 'cert_uploaded', 'traceability_cert', certId, null,
        { document_name: document_name || 'Ad-hoc certificate', heat_ref: heat_ref.trim() },
        `Ad-hoc cert uploaded`, Number(req.params.projectId) || null)
    }

    // ── First version row ──────────────────────────────────────
    await db.query(
      `INSERT INTO traceability_cert_versions
         (cert_id, rev, heat_ref, applies_to, file_name, file_size, status, created_by, created_date)
       VALUES (?, 'A', ?, ?, ?, ?, 'received', ?, NOW())`,
      [certId, heat_ref.trim(), applies_to || null, fileName, fileSize, uid])

    // ── Record the on-disk path so the cert streams from the Document Inbox ──
    // Gated on the migration so this never regresses cert upload if the file_path
    // column isn't present yet (the file itself is already saved by multer).
    if (await fileColumnsReady('traceability_certs')) {
      await db.query(`UPDATE traceability_certs SET file_path=?, mime_type=? WHERE id=?`,
        [filePath, mimeType, certId])
    }

    if (isVendor(req)) {
      const [[row]] = await db.query(`${VENDOR_CERT_SELECT} WHERE c.id=?`, [certId])
      return res.status(201).json(vendorView.certRow(row))
    }
    res.status(201).json({ ok: true, cert_id: certId })
  } catch (e) {
    res.status(500).json({ error: 'Could not upload certificate: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// ADD CERT VERSION — multipart
// ═══════════════════════════════════════════════════════════════
// POST /api/traceability/cert/:certId/version
// P2e: routes keyed by a certificate id take the project from the certificate and apply the
// project grant check requireProjectScope applies (internal roles pass without a query; the
// handler answers an unknown id with 404 as before). Externals: 404 for an unknown certificate,
// 403 without a grant; vendors also need the certificate on their own PO and, to add a version,
// a pending, overdue or rejected status (409 otherwise) — checked before the upload is read.
function certScope({ version }) {
  return async (req, res, next) => {
    const role = req.user?.role
    if (!role) return res.status(401).json({ error: 'Not authenticated' })
    if (role === 'admin' || !EXTERNAL_ROLES.has(role)) return next()
    try {
      const [[c]] = await db.query('SELECT project_id, po_id, status FROM traceability_certs WHERE id = ?', [Number(req.params.certId)])
      if (!c) return res.status(404).json({ error: 'Certificate not found' })
      const [grant] = await db.query('SELECT id FROM user_wbs_access WHERE user_id = ? AND project_id = ? LIMIT 1', [req.user.id, c.project_id])
      if (!grant.length) return res.status(403).json({ error: 'No project access' })
      if (role === 'vendor') {
        if (req.user.supplier_id == null || c.po_id == null) return res.status(403).json({ error: 'Access denied' })
        const [[po]] = await db.query('SELECT id FROM purchase_orders WHERE id = ? AND project_id = ? AND supplier_id = ?',
          [c.po_id, c.project_id, Number(req.user.supplier_id)])
        if (!po) return res.status(403).json({ error: 'Access denied' })
        if (version && !VENDOR_VERSION_STATUSES.includes(c.status)) {
          return res.status(409).json({ error: `A version cannot be added while the certificate is ${c.status}` })
        }
      }
      next()
    } catch (e) {
      console.error('[traceability] certificate scope check failed:', e.message)
      res.status(500).json({ error: 'Permission check failed' })
    }
  }
}

// Removes a file stored by blobStore.persist when recording it failed (blobStore has no
// delete): disk → unlink; blob → deleteIfExists in the same container.
async function removeStoredCertFile({ where, value, diskAbs }) {
  try {
    if (where === 'disk') { fs.unlinkSync(diskAbs); return }
    const { BlobServiceClient } = require('@azure/storage-blob')
    await BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING)
      .getContainerClient(blobStore.CONTAINER).getBlockBlobClient(value).deleteIfExists()
  } catch (e) { console.error('[traceability] could not remove the stored file:', e.message) }
}

router.post('/cert/:certId/version', certScope({ version: true }), upload.single('file'), async (req, res) => {
  let stored = null
  try {
    const uid = req.user?.id
    const certId = Number(req.params.certId)
    const { heat_ref, applies_to } = req.body
    if (!heat_ref || !heat_ref.trim()) return res.status(422).json({ error: 'Heat / batch / ref number is required' })
    if (!req.file) return res.status(422).json({ error: 'A certificate file is required' })

    const [[cert]] = await db.query(`SELECT id, document_name FROM traceability_certs WHERE id=?`, [certId])
    if (!cert) return res.status(404).json({ error: 'Certificate not found' })

    // Next rev letter
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM traceability_cert_versions WHERE cert_id=?`, [certId])
    const rev = String.fromCharCode(65 + n) // A, B, C…

    // §15 (cd) fix (P2e): store the file as the first upload does (blob or disk, same limits).
    const verStoredName = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.\-]+/g, '_')}`
    const verDiskAbs = path.join(uploadDir, verStoredName)
    stored = { ...(await blobStore.persist({
      key: blobStore.keyFor('traceability', verStoredName),
      diskAbsPath: verDiskAbs, buffer: req.file.buffer, contentType: req.file.mimetype,
      diskValue: path.relative(path.join(__dirname, '..'), verDiskAbs),
    })), diskAbs: verDiskAbs }

    await db.query(
      `INSERT INTO traceability_cert_versions
         (cert_id, rev, heat_ref, applies_to, file_name, file_size, status, created_by, created_date)
       VALUES (?, ?, ?, ?, ?, ?, 'received', ?, NOW())`,
      [certId, rev, heat_ref.trim(), applies_to || null, req.file.originalname, req.file.size, uid])

    // The certificate's file becomes this version (the versions table has no path column).
    if (await fileColumnsReady('traceability_certs')) {
      await db.query(`UPDATE traceability_certs SET file_name=?, file_size=?, file_path=?, mime_type=? WHERE id=?`,
        [req.file.originalname, req.file.size, stored.value, req.file.mimetype, certId])
    }
    stored = null   // recorded: keep the file

    // 3T130: a vendor's new version puts the certificate back to received for re-verification,
    // with received_date as the first upload sets it (copied from POST /:projectId/cert's
    // requirement branch: status='received', received_date=today(), and its date-change entry).
    // Conditional on the statuses a vendor may add a version to, so a concurrent verification stands.
    if (isVendor(req)) {
      const [[prev]] = await db.query('SELECT received_date FROM traceability_certs WHERE id=?', [certId])
      const [rcv] = await db.query(
        `UPDATE traceability_certs SET status='received', received_date=? WHERE id=? AND status IN (?,?,?)`,
        [today(), certId, ...VENDOR_VERSION_STATUSES])
      if (rcv.affectedRows) {
        await writeDateChange(uid, 'traceability_cert', certId, 'received_date', prev ? prev.received_date : null, today(),
          'Cert received via version upload')
      }
    }

    await writeAudit(uid, 'cert_version_added', 'traceability_cert', certId, null,
      { rev, heat_ref: heat_ref.trim() }, `Version ${rev} added to ${cert.document_name}`, Number(req.params.projectId) || null)

    res.status(201).json({ ok: true, rev })
  } catch (e) {
    if (stored) await removeStoredCertFile(stored)
    res.status(500).json({ error: 'Could not add cert version: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// APPROVALS — cert approval queue
// ═══════════════════════════════════════════════════════════════
// GET /api/traceability/:projectId/approvals
router.get('/:projectId/approvals', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [rows] = await db.query(
      `SELECT id AS cert_id, file_name, cert_type, item_scope, applies_to,
              vendor_name, uploader, DATE_FORMAT(uploaded_date, '%Y-%m-%d') AS uploaded_date, priority
       FROM traceability_certs
       WHERE project_id=? AND category='approval' AND status='received'
       ORDER BY FIELD(priority,'high','normal'), uploaded_date DESC`, [pid])
    res.json({ data: rows })
  } catch (e) {
    res.status(500).json({ error: 'Could not load cert approvals: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// VERIFY CERT — releases related hold
// ═══════════════════════════════════════════════════════════════
// POST /api/traceability/cert/:certId/verify
// body: checklist {heat_match, signed_dated, spec_meets}, qa_notes
router.post('/cert/:certId/verify', async (req, res) => {
  try {
    const uid = req.user?.id
    const certId = Number(req.params.certId)
    const { checklist, qa_notes } = req.body || {}

    // All three checklist items must be confirmed (guards a quick-verify bypass).
    const ck = checklist || {}
    if (!ck.heat_match || !ck.signed_dated || !ck.spec_meets) {
      return res.status(422).json({ error: 'All three QA checklist items must be confirmed before verifying' })
    }

    const [[cert]] = await db.query(`SELECT * FROM traceability_certs WHERE id=?`, [certId])
    if (!cert) return res.status(404).json({ error: 'Certificate not found' })

    await db.query(
      `UPDATE traceability_certs SET status='verified', verified_by=?, verified_date=NOW(), notes=? WHERE id=?`,
      [uid, qa_notes || cert.notes || null, certId])

    // ── Release any holds tied to this cert ─────────────────────
    const [released] = await db.query(
      `UPDATE traceability_holds SET status='released', released_by=?, released_date=NOW()
       WHERE related_cert_id=? AND status='active'`, [uid, certId])

    await writeAudit(uid, 'cert_verified', 'traceability_cert', certId,
      { status: cert.status }, { status: 'verified', released_holds: released.affectedRows },
      `Cert ${cert.file_name || cert.document_name} verified${released.affectedRows ? ` · ${released.affectedRows} hold(s) released` : ''}`, Number(req.params.projectId) || null)

    res.json({ ok: true, holds_released: released.affectedRows })
  } catch (e) {
    res.status(500).json({ error: 'Could not verify certificate: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// REJECT CERT — mandatory reason
// ═══════════════════════════════════════════════════════════════
// POST /api/traceability/cert/:certId/reject  body: reason (MANDATORY)
router.post('/cert/:certId/reject', async (req, res) => {
  try {
    const uid = req.user?.id
    const certId = Number(req.params.certId)
    const { reason } = req.body || {}
    if (!reason || !reason.trim()) return res.status(422).json({ error: 'A rejection reason is required' })

    const [[cert]] = await db.query(`SELECT * FROM traceability_certs WHERE id=?`, [certId])
    if (!cert) return res.status(404).json({ error: 'Certificate not found' })

    await db.query(
      `UPDATE traceability_certs SET status='rejected', reject_reason=? WHERE id=?`,
      [reason.trim(), certId])
    await writeAudit(uid, 'cert_rejected', 'traceability_cert', certId,
      { status: cert.status }, { status: 'rejected', reason: reason.trim() },
      `Cert ${cert.file_name || cert.document_name} rejected`, Number(req.params.projectId) || null)

    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'Could not reject certificate: ' + e.message })
  }
})

// ─── GET /cert/:certId/file — open / download a certificate's file ────────────
// Streams the uploaded file when one exists on disk; otherwise returns a generated
// placeholder PDF (seeded/demo certs carry a file_name but no real file). Gated by
// traceability.can_view so document access follows the matrix.
router.get('/cert/:certId/file', require('../middleware/permissions').requirePermission('traceability', 'can_view'), certScope({ version: false }), async (req, res) => {
  try {
    const certId = Number(req.params.certId)
    const [[cert]] = await db.query('SELECT * FROM traceability_certs WHERE id=?', [certId])
    if (!cert) return res.status(404).json({ error: 'Certificate not found' })
    const fname = (cert.file_name || `cert-${certId}.pdf`).replace(/["\r\n]/g, '')
    // Real uploaded file → DUAL-READ FALLBACK (blob migration): blob first, then disk.
    if (cert.file_path) {
      const blobStream = await blobStore.getFile(blobStore.keyFor('traceability', cert.file_path))
      if (blobStream) {
        res.setHeader('Content-Type', cert.mime_type || 'application/octet-stream')
        res.setHeader('Content-Disposition', `inline; filename="${fname}"`)
        return blobStream.pipe(res)
      }
      const abs = path.join(__dirname, '..', cert.file_path)
      if (fs.existsSync(abs)) {
        res.setHeader('Content-Type', cert.mime_type || 'application/octet-stream')
        res.setHeader('Content-Disposition', `inline; filename="${fname}"`)
        return fs.createReadStream(abs).pipe(res)
      }
    }
    // No real file → generate a placeholder PDF on the fly
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${fname.replace(/\.[^.]*$/, '')}.pdf"`)
    res.send(stubCertPdf(cert))
  } catch (e) {
    res.status(500).json({ error: 'Could not open certificate file: ' + e.message })
  }
})

// Minimal dependency-free one-page PDF for demo certs that have no real file.
function stubCertPdf(cert) {
  const lines = [
    'MILL TEST CERTIFICATE  —  DEMO PLACEHOLDER',
    '',
    'Document  : ' + (cert.document_name || cert.file_name || ''),
    'Type      : ' + (cert.cert_type || 'MTC'),
    'Heat/Batch: ' + (cert.heat_ref || ''),
    'Vendor    : ' + (cert.vendor_name || ''),
    'PO Ref    : ' + (cert.po_ref || ''),
    'Tag       : ' + (cert.tag || ''),
    'Status    : ' + (cert.status || ''),
    '',
    'Generated placeholder for seeded/demo data — not a real mill',
    'certificate. Upload a real file to replace it.',
  ]
  const esc = s => String(s).replace(/([()\\])/g, '\\$1')
  let content = 'BT /F1 12 Tf 56 740 Td 16 TL\n'
  for (const ln of lines) content += '(' + esc(ln) + ') Tj T*\n'
  content += 'ET'
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    '<</Length ' + Buffer.byteLength(content) + '>>\nstream\n' + content + '\nendstream',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n' })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n'
  for (const off of offsets) pdf += String(off).padStart(10, '0') + ' 00000 n \n'
  pdf += 'trailer\n<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF'
  return Buffer.from(pdf, 'latin1')
}

// ═══════════════════════════════════════════════════════════════
// TRACE CHAIN — lifecycle per tag
// ═══════════════════════════════════════════════════════════════
// GET /api/traceability/:projectId/trace/:tag
router.get('/:projectId/trace/:tag', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const tag = req.params.tag
    const [rows] = await db.query(
      `SELECT stage, ref, event_date AS date, actor, detail, node_state, badge
       FROM traceability_trace_lifecycle
       WHERE project_id=? AND tag=? ORDER BY sort_order`, [pid, tag])
    res.json({ tag, lifecycle: rows })
  } catch (e) {
    res.status(500).json({ error: 'Could not load trace chain: ' + e.message })
  }
})

// GET /api/traceability/:projectId/tags — distinct tags with a lifecycle
router.get('/:projectId/tags', async (req, res) => {
  try {
    if (isVendor(req)) return res.json({ tags: [] })   // P2e: the tag list is hidden from vendors
    const pid = Number(req.params.projectId)
    const [rows] = await db.query(
      `SELECT DISTINCT tag FROM traceability_trace_lifecycle WHERE project_id=? ORDER BY tag`, [pid])
    res.json({ tags: rows.map(r => r.tag) })
  } catch (e) {
    res.status(500).json({ error: 'Could not load tags: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// HOLDS
// ═══════════════════════════════════════════════════════════════
// GET /api/traceability/:projectId/holds
// ─── SERVER-SIDE PAGINATION: active trace holds ───────────────────────────────
// Returns { data, total, page, limit }. Whitelisted sort (+ unique id tiebreaker);
// default age_days DESC (oldest/most-aged holds first).
router.get('/:projectId/holds', async (req, res) => {
  try {
    const pid    = Number(req.params.projectId)
    const page   = Math.max(1, parseInt(req.query.page  || '1', 10))
    const limit  = Math.min(100000, Math.max(1, parseInt(req.query.limit || '50', 10)))
    const offset = (page - 1) * limit

    const SAFE_SORT = {
      tag: 'tag', item: 'item', hold_reason: 'hold_reason',
      location: 'location', since_date: 'since_date', age_days: 'age_days',
    }
    const orderBy  = SAFE_SORT[req.query.sort_col] || 'age_days'
    const orderDir = String(req.query.sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC' // default DESC

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM traceability_holds WHERE project_id=? AND status='active'`, [pid]
    )
    const [rows] = await db.query(
      `SELECT id AS hold_id, tag, item, hold_reason, location,
              DATE_FORMAT(since_date, '%Y-%m-%d') AS since_date, age_days,
              chase_count, related_cert_id, vendor_name, vendor_email
       FROM traceability_holds
       WHERE project_id=? AND status='active'
       ORDER BY ${orderBy} ${orderDir}, id ${orderDir}
       LIMIT ? OFFSET ?`, [pid, limit, offset])
    res.json({ data: rows, total, page, limit })
  } catch (e) {
    res.status(500).json({ error: 'Could not load holds: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// CHASE CERT — record + optional email
// ═══════════════════════════════════════════════════════════════
// POST /api/traceability/hold/:holdId/chase
// body: send_email (bool), recipient, subject, body
router.post('/hold/:holdId/chase', async (req, res) => {
  try {
    const uid = req.user?.id
    const holdId = Number(req.params.holdId)
    const { send_email, recipient, subject, body } = req.body || {}

    const [[hold]] = await db.query(`SELECT * FROM traceability_holds WHERE id=?`, [holdId])
    if (!hold) return res.status(404).json({ error: 'Hold not found' })

    // Record the chase regardless of whether an email goes out.
    await db.query(
      `INSERT INTO traceability_chases (hold_id, sent_email, recipient, subject, body, created_by)
       VALUES (?,?,?,?,?,?)`,
      [holdId, send_email ? 1 : 0, recipient || hold.vendor_email || null, subject || null, body || null, uid])

    await db.query(`UPDATE traceability_holds SET chase_count = chase_count + 1 WHERE id=?`, [holdId])

    await writeAudit(uid, send_email ? 'hold_chase_emailed' : 'hold_chase_logged',
      'traceability_hold', holdId, { chase_count: hold.chase_count },
      { chase_count: hold.chase_count + 1, recipient: recipient || hold.vendor_email },
      `Chase #${hold.chase_count + 1} on hold ${hold.tag || hold.item}${send_email ? ' (email sent)' : ' (logged only)'}`, Number(req.params.projectId) || null)

    // Email queueing is mocked — no SMTP wired in this environment.
    res.json({ ok: true, chase_count: hold.chase_count + 1, emailed: !!send_email })
  } catch (e) {
    res.status(500).json({ error: 'Could not record chase: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// HEAT ⇄ CERT LINKAGE (Heat/Lot P5) — read-only joins
// ═══════════════════════════════════════════════════════════════
// The join is NORMALISED and case-insensitive on purpose:
//   UPPER(TRIM(heat_number)) = UPPER(TRIM(heat_ref))
// so "a24-887 " on a holding still links to cert heat_ref "A24-887".
// Pure reads — never mutates stock / receipts / transfers / issues.

// GET /api/traceability/:projectId/heat/:heat — everything tied to one heat:
// certs (+status), holds (via the matched certs), and where the material is now
// (stock holdings, FMR issues, transfers). Lists ALL rows (no collapsing).
router.get('/:projectId/heat/:heat', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const heat = req.params.heat
    const norm = 'UPPER(TRIM(?))'

    const [certs] = await db.query(
      `SELECT id AS cert_id, category, po_ref, vendor_name, tag, document_name, cert_type,
              heat_ref, applies_to, status, DATE_FORMAT(issue_date,'%Y-%m-%d') AS issue_date,
              DATE_FORMAT(received_date,'%Y-%m-%d') AS received_date
       FROM traceability_certs
       WHERE project_id=? AND UPPER(TRIM(heat_ref)) = ${norm} ORDER BY id`, [pid, heat])

    // Holds reached via the matched certs (holds have no heat column).
    let holds = []
    if (certs.length) {
      const ids = certs.map(c => c.cert_id)
      const [hrows] = await db.query(
        `SELECT id AS hold_id, tag, item, hold_reason, status, related_cert_id,
                DATE_FORMAT(since_date,'%Y-%m-%d') AS since_date, age_days
         FROM traceability_holds
         WHERE project_id=? AND related_cert_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
        [pid, ...ids])
      holds = hrows
    }

    const [stock] = await db.query(
      `SELECT s.id AS stock_id, s.item_code, s.description, s.heat_number, s.location_code,
              s.qty, s.qty_available, s.condition_status, s.trace_hold, w.name AS warehouse_name
       FROM warehouse_stock s LEFT JOIN warehouses w ON w.id=s.warehouse_id
       WHERE s.project_id=? AND UPPER(TRIM(s.heat_number)) = ${norm} ORDER BY s.id`, [pid, heat])

    const [issues] = await db.query(
      `SELECT fil.id, fil.fmr_id, f.fmr_ref, fil.qty, fil.heat_number, fil.location_code, fil.item_code, fil.wbs_code,
              DATE_FORMAT(fil.issued_at,'%Y-%m-%d') AS issued_at
       FROM fmr_issue_lines fil JOIN fmr_requests f ON f.id=fil.fmr_id
       WHERE f.project_id=? AND UPPER(TRIM(fil.heat_number)) = ${norm} ORDER BY fil.id`, [pid, heat])

    const [transfers] = await db.query(
      `SELECT id, transfer_ref, item_code, heat_number, qty, uom, status, from_location, to_location
       FROM warehouse_transfers
       WHERE project_id=? AND UPPER(TRIM(heat_number)) = ${norm} ORDER BY id`, [pid, heat])

    res.json({ heat, certs, holds, stock, issues, transfers })
  } catch (e) {
    res.status(500).json({ error: 'Could not load heat linkage: ' + e.message })
  }
})

// GET /api/traceability/:projectId/heat-status — batch: per declared cert-heat,
// an aggregate cert status (+ active-hold flag) for the Stock Register to badge
// holdings in ONE round-trip. Keyed by the NORMALISED heat (UPPER(TRIM)).
router.get('/:projectId/heat-status', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [rows] = await db.query(
      `SELECT UPPER(TRIM(c.heat_ref)) AS heat_key,
              SUM(c.status='verified') AS verified,
              SUM(c.status='rejected') AS rejected,
              SUM(c.status IN ('pending','received','overdue')) AS pending,
              COUNT(*) AS cert_count,
              SUM(EXISTS(SELECT 1 FROM traceability_holds h WHERE h.related_cert_id=c.id AND h.status='active')) AS active_holds
       FROM traceability_certs c
       WHERE c.project_id=? AND c.heat_ref IS NOT NULL AND TRIM(c.heat_ref)<>''
       GROUP BY UPPER(TRIM(c.heat_ref))`, [pid])
    // Aggregate to one badge status per heat: hold > rejected > pending > verified.
    const map = {}
    for (const r of rows) {
      const status = Number(r.active_holds) > 0 ? 'hold'
        : Number(r.rejected) > 0 ? 'rejected'
        : Number(r.pending) > 0 ? 'pending'
        : Number(r.verified) > 0 ? 'verified' : 'none'
      map[r.heat_key] = { status, cert_count: Number(r.cert_count), has_hold: Number(r.active_holds) > 0 }
    }
    res.json({ data: map })
  } catch (e) {
    res.status(500).json({ error: 'Could not load heat status: ' + e.message })
  }
})

module.exports = router
