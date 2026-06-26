// ─── LOGISTICS ROUTES ─────────────────────────────────────────
// SCN Register, status transitions, packages, documents, timeline.
// All routes require a valid JWT via authenticateToken.
// Status mapping: DB enum values → display labels handled here.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { dbError } = require('../utils/dbError')
const { authenticateToken } = require('../middleware/auth')
const { setSealNo, setContainerNo, SealGovernanceError } = require('../lib/sealGovernance') // Q4.3 shared seal governance
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')

router.use(authenticateToken)
router.use(require('../middleware/permissions').denyReadOnly) // C-a: viewer/auditor barred from writes
// ─── LOGISTICS MATRIX GATE (+ scoped SCN-documents carve-out) ───────────────────
// Normal rule: enforce('logistics') maps method→action (POST→can_create, etc.).
// Carve-out: the SCN *documents* sub-route (upload/delete) is treated as needing
// only can_VIEW — so a logistics VIEWER (e.g. an expeditor opening an SCN from the
// PO) can attach the deferred docs, WITHOUT being granted broader logistics
// create/delete. Mirrors the procurement expeditor-assign carve-out. Tightly
// anchored to /scn/:id/documents(/:docId) only — every other write stays gated,
// and can_view is still required (zero-logistics-access roles are NOT let in).
const { enforce, requirePermission } = require('../middleware/permissions')
const SCN_DOCS_RE = /\/scn\/\d+\/documents(\/\d+)?$/

// ─── PACKAGE-ROUTE AUTHORIZATION CARVE-OUT (forwarder-delegated packaging) ─────
// THE SECURITY CORE. Package create/edit/read (+ seal) is normally internal, gated by
// the logistics matrix via enforce('logistics'). A freight_forwarder is an EXTERNAL role
// with NO blanket package access — but when an expeditor delegates an SCN's packing to a
// specific forwarder (shipment_control_notes.packaging_delegated_to = that forwarder's
// user id), that forwarder may read/create/edit packages + set seals on THAT SCN ONLY.
//
// Why this lives at the ROUTER level (not route middleware): enforce('logistics') maps
// POST→can_create, which freight_forwarder lacks, so a forwarder's package POST is killed
// at this router gate BEFORE any route-level middleware runs. The carve-out therefore
// replaces the matrix gate for forwarders here. It also REPLACES the old blunt
// requireInternalLogistics on the package POST (removed deliberately, paired with this
// scoped predicate — not a bare removal).
//
// ⚠ The predicate keys off the URL :scnId, NEVER req.body. A forwarder must not reach
//   packages on any SCN not delegated to them. DELETE is intentionally NOT carved out —
//   it falls through to enforce('logistics')→can_delete (forwarder=0 → 403), so a
//   forwarder can pack but cannot delete packages.
const SCN_PKG_RE = /\/scn\/(\d+)\/packages(\/\d+)?$/

// Capability-detect the delegation column (deploy-tolerance). Cached sticky-true. If the
// column isn't live yet (code-before-migration), NO SCN can be delegated → forwarders are
// denied (fail-closed); internal roles are unaffected (they never hit this path).
let _delegateColPresent = false
async function scnHasDelegateCol(conn = db) {
  if (_delegateColPresent) return true
  const [[r]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'shipment_control_notes'
       AND column_name = 'packaging_delegated_to'`)
  _delegateColPresent = r.n > 0
  return _delegateColPresent
}

// 3b-4: trace-back read — has the receipt-provenance column landed? Gates the per-package
// "received from this package" rollup on SCN detail (reads only; degrades to none if absent).
let _recvProvCol = false
async function recvProvLive() {
  if (_recvProvCol) return true
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'receipt_lines' AND column_name = 'source_scn_package_id'`)
  _recvProvCol = r.n > 0
  return _recvProvCol
}

// THE ownership predicate (shared by D2 package authz + D4 hand-back) — a forwarder is
// the delegated packer iff the SCN's packaging_delegated_to equals their user id. Kept as
// a one-liner so the two call sites can NEVER drift.
function isPackagingDelegate(delegatedTo, userId) {
  return delegatedTo != null && delegatedTo === userId
}

// True iff the calling forwarder is the delegated packer for the SCN named in the URL.
// scnId comes from the URL path ONLY — req.body is never consulted, so a forged body
// scnId cannot redirect the check. `conn` is injectable for transactional proofs.
async function forwarderOwnsScnPackaging(req, conn = db) {
  const pth = (req.originalUrl || req.url || '').split('?')[0]
  const m = pth.match(SCN_PKG_RE)               // ← scnId from URL, NEVER req.body
  const scnId = m ? Number(m[1]) : NaN
  if (!scnId) return false
  if (!(await scnHasDelegateCol(conn))) return false           // pre-migration → fail-closed
  const [[scn]] = await conn.query(
    'SELECT packaging_delegated_to FROM shipment_control_notes WHERE id = ?', [scnId])
  return !!scn && isPackagingDelegate(scn.packaging_delegated_to, req.user.id)
}

// ─── HAND-BACK LIFECYCLE (D4) ─────────────────────────────────
// Mark an SCN's delegated packaging complete. Pure unit (operates on the given conn) so
// the route is a thin wrapper and the proofs exercise THIS exact logic in a rolled-back
// txn. scnId comes from the route's URL param (never the body).
//   • Forwarder may complete ONLY their delegated SCN — the SAME predicate as D2
//     (isPackagingDelegate, keyed off the URL :scnId). Internal roles may set too.
//   • Only delegated-packaging SCNs have a lifecycle (packaging_status NOT NULL).
//   • IDEMPOTENT: re-completing an already-complete SCN is a no-op that PRESERVES the
//     original packaging_completed_at (tolerant of double-submit). (Alternative: reject
//     with 409 — flagged for TC; idempotent chosen so a double-click can't error or
//     re-stamp the timestamp.)
// Returns { ok:true, idempotent, packaging_status, packaging_completed_at } or { ok:false, status, error }.
async function completePackaging(conn, { scnId, userId, role }) {
  const [[scn]] = await conn.query(
    'SELECT id, packaging_status, packaging_completed_at, packaging_delegated_to FROM shipment_control_notes WHERE id = ?', [scnId])
  if (!scn) return { ok: false, status: 404, error: 'SCN not found.' }
  // Authorization: forwarder must be the delegate (D2 predicate, URL :scnId). Internal
  // roles already cleared enforce('logistics') can_edit at the router gate.
  if (role === 'freight_forwarder' && !isPackagingDelegate(scn.packaging_delegated_to, userId)) {
    return { ok: false, status: 403, error: 'You are not the delegated packer for this SCN.' }
  }
  if (scn.packaging_status == null) {
    return { ok: false, status: 409, error: 'This SCN does not have delegated packaging to complete.' }
  }
  if (scn.packaging_status === 'complete') {   // idempotent no-op — preserve original timestamp
    return { ok: true, idempotent: true, packaging_status: 'complete', packaging_completed_at: scn.packaging_completed_at }
  }
  // D5.1 HARD-BLOCK: every allocatable line must be FULLY packed before hand-back. Same
  // allocation computation the rest of the system uses (packed = SUM scn_package_lines.qty
  // per scn_line, vs the line's SCN qty). A line packed below its qty — or nothing packed
  // at all (packed=0 < qty) — blocks completion. (Reuses the contents B writes; build order
  // matters: without B's allocation this would lock forwarders out.)
  const [[{ unpacked, total_lines }]] = await conn.query(
    `SELECT
       COUNT(*) AS total_lines,
       SUM(CASE WHEN sl.qty > COALESCE((SELECT SUM(qty) FROM scn_package_lines WHERE scn_line_id = sl.id), 0) + 1e-9
                THEN 1 ELSE 0 END) AS unpacked
     FROM scn_lines sl WHERE sl.scn_id = ?`, [scnId])
  if (Number(total_lines) === 0 || Number(unpacked) > 0) {
    return { ok: false, status: 422, error: 'All lines must be fully packed before marking complete.' }
  }
  await conn.query(
    "UPDATE shipment_control_notes SET packaging_status='complete', packaging_completed_at=NOW() WHERE id=? AND packaging_status='pending'", [scnId])
  const [[u]] = await conn.query('SELECT packaging_status, packaging_completed_at FROM shipment_control_notes WHERE id=?', [scnId])
  return { ok: true, idempotent: false, packaging_status: u.packaging_status, packaging_completed_at: u.packaging_completed_at }
}

router.use((req, res, next) => {
  const p = (req.originalUrl || req.url).split('?')[0]
  // Package read/create/edit by a freight_forwarder → authorized by DELEGATION, not the
  // matrix. (DELETE excluded → falls through to enforce → can_delete=0 → 403.)
  if (req.method !== 'DELETE' && SCN_PKG_RE.test(p) && req.user?.role === 'freight_forwarder') {
    return forwarderOwnsScnPackaging(req)
      .then(ok => ok ? next() : res.status(403).json({ error: 'You are not the delegated packer for this SCN.' }))
      .catch(e => { console.error('[pkg-authz]', e.message); return res.status(500).json({ error: 'Authorization check failed' }) })
  }
  // Documents carve-out (existing): non-GET docs need only can_view.
  if (req.method !== 'GET' && SCN_DOCS_RE.test(p)) {
    return requirePermission('logistics', 'can_view')(req, res, next)
  }
  return enforce('logistics')(req, res, next)   // internal roles unchanged
})
router.param('projectId', require('../middleware/permissions').requireProjectScope) // Stage 1: external roles WBS-scoped to granted projects

// ─── ROLE HELPERS ─────────────────────────────────────────────
// Freight forwarder can update status/dates on their SCNs, nothing else.
// Packages, documents: internal team only.
function requireInternalLogistics(req, res, next) {
  const r = req.user?.role
  if (r === 'freight_forwarder') return res.status(403).json({ error: 'Freight forwarders cannot perform this action' })
  next()
}

// ─── STATUS HELPERS ───────────────────────────────────────────
// Map DB enum values → logical display status used in the pipeline.
// DB: draft, pending, in-transit, customs_review, arrived, received, closed
// Display: pending_pickup, in_transit, customs_review, pending_delivery, delivered
function dbToDisplay(dbStatus) {
  const map = {
    draft:          'pending_pickup',
    pending:        'pending_pickup',
    'in-transit':   'in_transit',
    customs_review: 'customs_review',
    arrived:        'pending_delivery',
    partially_received: 'delivered',  // goods physically arrived (receipt in progress)
    received:       'delivered',
    closed:         'delivered',
    // new unified values (stored directly once set via this API)
    pending_pickup:    'pending_pickup',
    in_transit:        'in_transit',
    pending_delivery:  'pending_delivery',
    delivered:         'delivered',
  }
  return map[dbStatus] || dbStatus
}

function displayToDb(display) {
  const map = {
    pending_pickup:   'pending',
    in_transit:       'in-transit',
    customs_review:   'customs_review',
    pending_delivery: 'arrived',
    delivered:        'received',
  }
  return map[display] || display
}

// Valid next statuses from current display status.
// Arrival now ALWAYS routes through customs review: an in-transit shipment can
// only advance to customs_review (recording arrival at destination). Customs
// must then be cleared before pending_delivery / delivered. See the status PUT.
const NEXT_STATUSES = {
  pending_pickup:   ['in_transit'],
  in_transit:       ['customs_review'],
  customs_review:   ['pending_delivery'],
  pending_delivery: ['delivered'],
  delivered:        [],
}

// ─── RAG CALCULATION ──────────────────────────────────────────
// Compute RAG from status + eta relative to today.
function computeRAG(dbStatus, eta) {
  const displayStatus = dbToDisplay(dbStatus)
  if (displayStatus === 'delivered') return 'green'
  if (!eta) return 'amber'
  const today = new Date()
  const etaDate = new Date(eta)
  const diffDays = Math.ceil((etaDate - today) / 86400000)
  if (displayStatus === 'in_transit'    && diffDays < 3)  return 'red'
  if (displayStatus === 'pending_pickup' && diffDays < 7)  return 'red'
  if (diffDays < 0)  return 'red'
  if (diffDays < 7)  return 'amber'
  return 'green'
}

// ─── AUDIT HELPER ─────────────────────────────────────────────
async function writeAudit(userId, action, entityType, entityId, before, after, resource, projectId = null) {
  try {
    // project_id: explicit when supplied, else derived PROVABLY from the SCN id
    // (scn id → join to shipment_control_notes.project_id); never a free-text guess.
    let pid = Number(projectId) || null
    if (pid == null && entityType === 'scn' && entityId) {
      const [[scn]] = await db.query('SELECT project_id FROM shipment_control_notes WHERE id=?', [entityId])
      pid = scn?.project_id ?? null
    }
    await db.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, before_value, after_value, resource)
       VALUES (?,?,?,?,?,?,?,?)`,
      [userId, action, entityType, entityId, pid,
       before ? JSON.stringify(before) : null,
       after  ? JSON.stringify(after)  : null,
       resource]
    )
  } catch (e) { console.error('[audit] insert failed:', e.message) } // non-blocking
}

// ─── FILE UPLOAD SETUP ────────────────────────────────────────
const uploadDir = path.join(__dirname, '../uploads/scn-documents')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
})
const { fileFilter } = require('../utils/upload')
const { dateOrder } = require('../utils/validate')
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: fileFilter('document') })

// ═══════════════════════════════════════════════════════════════
// REGISTER
// ═══════════════════════════════════════════════════════════════

// GET /api/logistics/register/:projectId
// Returns paginated SCN list with pipeline counts.
router.get('/register/:projectId', async (req, res) => {
  try {
    const pid  = Number(req.params.projectId)
    const role = req.user?.role
    const uid  = req.user?.id
    const { status, search, critical_only, mode, arrival_days, sort_col, sort_dir, page = 1 } = req.query
    const lim    = Math.min(100000, Math.max(1, parseInt(req.query.limit || '50', 10)))
    const offset = (Math.max(1, Number(page)) - 1) * lim

    // Build WHERE clause
    const conditions = ['s.project_id = ?']
    const params = [pid]

    // ─── FREIGHT FORWARDER: only see their assigned SCNs ─────
    if (role === 'freight_forwarder') {
      conditions.push('s.forwarder_user_id = ?')
      params.push(uid)
    }

    // Status filter — match against both DB value and display mapping
    if (status) {
      const dbStatuses = []
      // Map display status to DB values
      const statusMap = {
        pending_pickup:   ['draft','pending'],
        in_transit:       ['in-transit'],
        customs_review:   ['customs_review'],
        pending_delivery: ['arrived'],
        delivered:        ['received','closed'],
      }
      if (statusMap[status]) {
        dbStatuses.push(...statusMap[status])
      } else {
        dbStatuses.push(status)
      }
      conditions.push(`s.status IN (${dbStatuses.map(() => '?').join(',')})`)
      params.push(...dbStatuses)
    }

    if (critical_only === 'true') {
      conditions.push('s.is_critical_path = 1')
    }

    // Forwarder-delegated packaging filter (D5): ?packaging=pending|complete — drives the
    // forwarder's "delegated to me, pending packing" view (combined with the forwarder
    // scoping above) and the expeditor's review filters.
    if (req.query.packaging === 'pending' || req.query.packaging === 'complete') {
      conditions.push('s.packaging_status = ?'); params.push(req.query.packaging)
    }

    // Mode + arrival-window filters (moved server-side so they're correct across pages)
    if (mode && mode !== 'all') { conditions.push('s.mode = ?'); params.push(mode) }
    if (arrival_days) {
      const d = parseInt(arrival_days, 10)
      if (!isNaN(d)) { conditions.push('s.eta IS NOT NULL AND s.eta <= DATE_ADD(CURDATE(), INTERVAL ? DAY)'); params.push(d) }
    }

    if (search) {
      const q = `%${search}%`
      conditions.push('(s.scn_ref LIKE ? OR po.po_number LIKE ? OR s.vendor_name LIKE ? OR s.forwarder_name LIKE ? OR s.origin_location LIKE ? OR w.name LIKE ?)')
      params.push(q, q, q, q, q, q)
    }

    const where = conditions.join(' AND ')

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total
       FROM shipment_control_notes s
       LEFT JOIN purchase_orders po ON s.po_id = po.id
       LEFT JOIN warehouses w ON s.destination_warehouse_id = w.id
       WHERE ${where}`,
      params
    )

    // ─── WHITELISTED SORT (+ unique s.id tiebreaker — stable OFFSET windows) ───
    const SAFE_SORT = {
      scn_ref: 's.scn_ref', status: 's.status', mode: 's.mode',
      etd: 's.etd', eta: 's.eta', origin: 's.origin_location',
      forwarder: 's.forwarder_name', vendor: 's.vendor_name',
      destination: 'w.name', created_at: 's.created_at',
    }
    const orderDir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC' // default DESC (preserve current)
    const orderBy  = SAFE_SORT[sort_col] || 's.created_at'
    const orderClause = `${orderBy} ${orderDir}, s.id ${orderDir}`

    const [rows] = await db.query(
      `SELECT
         s.id, s.scn_ref, s.status, s.rag, s.mode,
         s.etd, s.eta, s.atd, s.ata,
         s.origin_location, s.incoterms,
         s.forwarder_name, s.forwarder_user_id,
         s.packed_by_type, s.packaging_delegated_to, s.packaging_status,
         s.is_critical_path, s.total_packages, s.total_weight_kg,
         s.bl_number, s.container_ref, s.notes,
         s.forwarder_notified, s.forwarder_notified_at,
         s.created_at, s.updated_at,
         po.po_number AS po_ref,
         COALESCE(s.vendor_name, po.vendor_name) AS vendor_name,
         w.name AS destination_name, w.code AS destination_code
       FROM shipment_control_notes s
       LEFT JOIN purchase_orders po ON s.po_id = po.id
       LEFT JOIN warehouses w ON s.destination_warehouse_id = w.id
       WHERE ${where}
       ORDER BY ${orderClause}
       LIMIT ? OFFSET ?`,
      [...params, lim, offset]
    )

    // Recalculate + return display_status with each row
    const data = rows.map(r => ({
      ...r,
      display_status: dbToDisplay(r.status),
      rag: computeRAG(r.status, r.eta),
    }))

    // Pipeline counts — scoped to forwarder if applicable
    const pipelineSql = role === 'freight_forwarder'
      ? 'SELECT status FROM shipment_control_notes WHERE project_id = ? AND forwarder_user_id = ?'
      : 'SELECT status FROM shipment_control_notes WHERE project_id = ?'
    const pipelineParams = role === 'freight_forwarder' ? [pid, uid] : [pid]
    const [allStatuses] = await db.query(pipelineSql, pipelineParams)
    const pipeline_counts = {
      pending_pickup:   0,
      in_transit:       0,
      customs_review:   0,
      pending_delivery: 0,
      delivered:        0,
      total:            allStatuses.length,
    }
    allStatuses.forEach(r => {
      const d = dbToDisplay(r.status)
      if (d in pipeline_counts) pipeline_counts[d]++
    })

    res.json({ total: Number(total), page: Number(page), limit: lim, data, pipeline_counts })
  } catch (e) {
    console.error('[logistics:register]', e.message)
    dbError(res, e)
  }
})

// ═══════════════════════════════════════════════════════════════
// SCN DETAIL
// ═══════════════════════════════════════════════════════════════

// GET /api/logistics/scn/:scnId
router.get('/scn/:scnId', async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)

    const [[scn]] = await db.query(
      `SELECT s.*,
         po.po_number AS po_ref,
         COALESCE(s.vendor_name, po.vendor_name) AS vendor_display,
         w.name AS destination_name, w.code AS destination_code,
         u.full_name AS forwarder_user_name
       FROM shipment_control_notes s
       LEFT JOIN purchase_orders po ON s.po_id = po.id
       LEFT JOIN warehouses w ON s.destination_warehouse_id = w.id
       LEFT JOIN users u ON s.forwarder_user_id = u.id
       WHERE s.id = ?`,
      [scnId]
    )
    if (!scn) return res.status(404).json({ error: 'SCN not found' })

    // PRE-EXISTING BUG FIX (not part of Q1/Q2/Q3): scope the "PO Lines" block to the
    // lines THIS SCN actually allocated, via scn_lines. The old query pulled EVERY line
    // of the parent PO (`WHERE pl.po_id = ?`) with the PO-WIDE `pl.qty_assigned` (summed
    // across all SCNs) — so an SCN that allocated one line showed all the PO's lines with
    // inflated assigned qtys. `qty_assigned` here = THIS SCN's allocation (SUM scn_lines.qty).
    // Off-PO children (scn_lines.po_line_id IS NULL) are excluded — they render in the
    // separate "Additional Items" section.
    const [lines] = await db.query(
      `SELECT pl.id, pl.line_number, pl.description, pl.qty,
              COALESCE(SUM(sl.qty), 0) AS qty_assigned,
              pl.uom
       FROM scn_lines sl
       JOIN po_lines pl ON pl.id = sl.po_line_id
       WHERE sl.scn_id = ?
       GROUP BY pl.id, pl.line_number, pl.description, pl.qty, pl.uom
       ORDER BY pl.line_number`,
      [scnId]
    )

    // Off-PO additional items — LEFT JOIN the parent po_line so the read side can
    // render parent-linked variations ("for: Line N — <desc>"), matching the wizard.
    // is_variation/parent_po_line_id come from scn_additional_items; legacy unlinked
    // rows return NULL parent fields and render as a generic "Additional item".
    const [additional_items] = await db.query(
      `SELECT ai.*, pl.line_number AS parent_line_number, pl.description AS parent_description
       FROM scn_additional_items ai
       LEFT JOIN po_lines pl ON pl.id = ai.parent_po_line_id
       WHERE ai.scn_id = ?`,
      [scnId]
    )

    // Packages
    const [packages] = await db.query(
      'SELECT * FROM scn_packages WHERE scn_id = ? ORDER BY id',
      [scnId]
    )

    // ── Stage 4: per-package contents (scn_package_lines → scn_lines → PO line / off-PO item).
    // Legacy packages (no contents) simply get an empty array — graceful, never an error. ──
    if (packages.length) {
      const [contents] = await db.query(
        `SELECT spl.package_id, spl.qty, spl.uom,
                sl.id AS scn_line_id, sl.po_line_id, sl.additional_item_id,
                pol.line_number, pol.description AS po_description, pol.uom AS po_uom,
                ai.description AS ai_description, ai.uom AS ai_uom
         FROM scn_package_lines spl
         JOIN scn_lines sl ON sl.id = spl.scn_line_id
         LEFT JOIN po_lines pol ON pol.id = sl.po_line_id
         LEFT JOIN scn_additional_items ai ON ai.id = sl.additional_item_id
         WHERE spl.package_id IN (?)`,
        [packages.map(p => p.id)]
      )
      const byPkg = {}
      for (const c of contents) {
        ;(byPkg[c.package_id] = byPkg[c.package_id] || []).push({
          scn_line_id: c.scn_line_id, qty: c.qty,
          uom: c.uom || c.po_uom || c.ai_uom || null,
          label: c.po_line_id ? `Line ${c.line_number} — ${(c.po_description || '').trim()}`.replace(/—\s*$/, '').trim()
                              : (c.ai_description || 'Off-PO item'),
          kind: c.po_line_id ? 'po' : 'offpo',
        })
      }
      for (const p of packages) p.contents = byPkg[p.id] || []

      // 3b-4: per-package received rollup — what has actually been received FROM each
      // package, traced via receipt_lines.source_scn_package_id (append-only provenance).
      // Capability-detected (degrades to no rollup pre-migration); reads only.
      if (await recvProvLive()) {
        const [recv] = await db.query(
          `SELECT rl.source_scn_package_id AS package_id,
                  COUNT(*) AS receipt_count,
                  SUM(rl.received_qty) AS qty_received,
                  COUNT(DISTINCT rl.scn_heat_id) AS heat_count
           FROM receipt_lines rl
           WHERE rl.source_scn_package_id IN (?)
           GROUP BY rl.source_scn_package_id`,
          [packages.map(p => p.id)]
        )
        const recvByPkg = {}
        for (const r of recv) recvByPkg[r.package_id] = r
        for (const p of packages) {
          const r = recvByPkg[p.id]
          p.received = r
            ? { receipt_count: Number(r.receipt_count), qty_received: Number(r.qty_received) || 0,
                heat_count: Number(r.heat_count) }
            : null
        }
      }
    }

    // Per-SCN line allocation (how much of each line is on this SCN + how much packed across boxes).
    const [scn_lines] = await db.query(
      `SELECT sl.id, sl.po_line_id, sl.additional_item_id, sl.qty, sl.uom,
              pol.line_number, pol.description AS po_description,
              ai.description AS ai_description,
              COALESCE((SELECT SUM(qty) FROM scn_package_lines WHERE scn_line_id = sl.id), 0) AS packed_qty
       FROM scn_lines sl
       LEFT JOIN po_lines pol ON pol.id = sl.po_line_id
       LEFT JOIN scn_additional_items ai ON ai.id = sl.additional_item_id
       WHERE sl.scn_id = ? ORDER BY sl.id`, [scnId])

    // Documents
    const [documents] = await db.query(
      `SELECT d.*, u.full_name AS uploaded_by_name
       FROM scn_documents d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.scn_id = ?
       ORDER BY d.uploaded_at DESC`,
      [scnId]
    )

    // Status log
    const [status_log] = await db.query(
      `SELECT l.*, u.full_name AS changed_by_name
       FROM scn_status_log l
       LEFT JOIN users u ON l.changed_by = u.id
       WHERE l.scn_id = ?
       ORDER BY l.changed_at DESC`,
      [scnId]
    )

    // Date change log
    const [date_changes] = await db.query(
      `SELECT dcl.*, u.full_name AS changed_by_name
       FROM date_change_log dcl
       LEFT JOIN users u ON dcl.created_by = u.id
       WHERE dcl.entity_type = 'scn' AND dcl.entity_id = ?
       ORDER BY dcl.created_at DESC`,
      [scnId]
    )

    // 3a: declared heats (incl. optional package_id once the migration is live) — drives
    // the per-package heat display. SELECT * is deploy-safe (returns whatever columns exist).
    const [heats] = await db.query(
      'SELECT * FROM scn_heats WHERE scn_id = ? ORDER BY heat_number', [scnId])

    res.json({
      ...scn,
      display_status: dbToDisplay(scn.status),
      rag: computeRAG(scn.status, scn.eta),
      lines,
      additional_items,
      packages,
      scn_lines,   // Stage 4: per-SCN line allocation (qty on this SCN + packed across boxes)
      documents,
      status_log,
      date_changes,
      heats,
    })
  } catch (e) {
    console.error('[logistics:scn-detail]', e.message)
    dbError(res, e)
  }
})

// ═══════════════════════════════════════════════════════════════
// REFERENCE — container types (Q4 packaging UI pickers)
// ═══════════════════════════════════════════════════════════════

// GET /api/logistics/container-types — active ISO container types (display-only dims) for
// the container-type pickers (wizard + PackagesTab). GET → enforce can_view (forwarders +
// internal roles with logistics view). Capability-tolerant: empty list if not migrated.
router.get('/container-types', async (req, res) => {
  try {
    const [[col]] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='container_types'`)
    if (!col.n) return res.json([])
    const [rows] = await db.query(
      `SELECT id, code, description, outer_length_mm, outer_width_mm, outer_height_mm,
              inner_length_mm, inner_width_mm, inner_height_mm, tare_weight_kg, capacity_m3, max_payload_kg
       FROM container_types WHERE is_active = 1 ORDER BY id`)
    res.json(rows)
  } catch (e) { dbError(res, e) }
})

// ═══════════════════════════════════════════════════════════════
// STATUS UPDATE
// ═══════════════════════════════════════════════════════════════

// PUT /api/logistics/scn/:scnId/status
router.put('/scn/:scnId/status', async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)
    const { status: newDisplayStatus, notes, proof_of_custody, customs_cleared } = req.body
    const userId = req.user?.id || 1

    if (!newDisplayStatus) return res.status(400).json({ error: 'status is required' })

    const [[scn]] = await db.query('SELECT id, status, eta, ata, customs_cleared FROM shipment_control_notes WHERE id = ?', [scnId])
    if (!scn) return res.status(404).json({ error: 'SCN not found' })

    const currentDisplay = dbToDisplay(scn.status)
    const validNext = NEXT_STATUSES[currentDisplay] || []

    if (!validNext.includes(newDisplayStatus)) {
      return res.status(400).json({
        error: `Invalid status transition: cannot move from "${currentDisplay}" to "${newDisplayStatus}". Valid next statuses: ${validNext.join(', ') || 'none'}`,
      })
    }

    // ── Customs clearance gate ───────────────────────────────
    // Leaving customs_review (→ pending_delivery) REQUIRES ticking "Customs
    // cleared". Delivery is blocked until customs is cleared. This is what keeps
    // a shipment visibly stuck in customs_review until someone clears it.
    let markCleared = false
    if (newDisplayStatus === 'pending_delivery' && currentDisplay === 'customs_review') {
      if (!customs_cleared) {
        return res.status(400).json({ error: 'Tick "Customs cleared" to release this shipment from customs review.' })
      }
      markCleared = true
    }
    if (newDisplayStatus === 'delivered' && !scn.customs_cleared) {
      if (!customs_cleared) {
        return res.status(400).json({ error: 'Customs must be cleared before a shipment can be marked delivered. Tick "Customs cleared" first.' })
      }
      markCleared = true   // legacy SCNs that reached pending_delivery before the gate existed
    }

    const newDbStatus = displayToDb(newDisplayStatus)
    const rag = computeRAG(newDbStatus, scn.eta)

    // Stamp actual arrival (ATA) when the shipment reaches the destination —
    // i.e. on entering customs_review (or delivered, if it skipped customs in
    // legacy data). COALESCE so a real arrival date is never overwritten.
    const sets = ['status = ?', 'rag = ?']
    const vals = [newDbStatus, rag]
    if (newDisplayStatus === 'customs_review' || newDisplayStatus === 'delivered') {
      sets.push('ata = COALESCE(ata, CURDATE())')
    }
    if (markCleared) {
      sets.push('customs_cleared = 1', 'customs_cleared_date = COALESCE(customs_cleared_date, CURDATE())', 'customs_cleared_by = ?')
      vals.push(userId)
    }
    vals.push(scnId)
    await db.query(`UPDATE shipment_control_notes SET ${sets.join(', ')} WHERE id = ?`, vals)

    await db.query(
      `INSERT INTO scn_status_log (scn_id, from_status, to_status, changed_by, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [scnId, currentDisplay, newDisplayStatus, userId, notes || null]
    )

    await writeAudit(userId, 'status_update', 'scn', scnId,
      { status: currentDisplay }, { status: newDisplayStatus, notes, ...(markCleared ? { customs_cleared: true } : {}) },
      `/logistics/scn/${scnId}/status`)

    const [[updated]] = await db.query(
      `SELECT s.*, po.po_number AS po_ref, w.name AS destination_name
       FROM shipment_control_notes s
       LEFT JOIN purchase_orders po ON s.po_id = po.id
       LEFT JOIN warehouses w ON s.destination_warehouse_id = w.id
       WHERE s.id = ?`,
      [scnId]
    )
    res.json({ success: true, scn: { ...updated, display_status: dbToDisplay(updated.status), rag } })
  } catch (e) {
    console.error('[logistics:status-update]', e.message)
    dbError(res, e)
  }
})

// ═══════════════════════════════════════════════════════════════
// DATE UPDATE
// ═══════════════════════════════════════════════════════════════

// PUT /api/logistics/scn/:scnId/dates
router.put('/scn/:scnId/dates', async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)
    const { etd, eta, crd, ccd, reason } = req.body
    const userId = req.user?.id || 1

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A reason is required when updating shipment dates' })
    }

    const [[scn]] = await db.query('SELECT id, etd, eta, cargo_ready_date AS crd, cargo_collection_date AS ccd, status FROM shipment_control_notes WHERE id = ?', [scnId])
    if (!scn) return res.status(404).json({ error: 'SCN not found' })

    // Logical date ordering across the effective (unchanged + new) values.
    const eff = (v, cur) => v !== undefined ? v : cur
    const dateErr = dateOrder([
      ['CRD', eff(crd, scn.crd)], ['CCD', eff(ccd, scn.ccd)],
      ['ETD', eff(etd, scn.etd)], ['ETA', eff(eta, scn.eta)],
    ])
    if (dateErr) return res.status(400).json({ error: dateErr })

    const updates = []
    const vals = []
    if (crd !== undefined) { updates.push('cargo_ready_date = ?');      vals.push(crd || null) }
    if (ccd !== undefined) { updates.push('cargo_collection_date = ?'); vals.push(ccd || null) }
    if (etd !== undefined) { updates.push('etd = ?'); vals.push(etd || null) }
    if (eta !== undefined) { updates.push('eta = ?'); vals.push(eta || null) }
    if (!updates.length) return res.status(400).json({ error: 'At least one date (CRD, CCD, ETD or ETA) is required' })

    const newEta = eta !== undefined ? eta : scn.eta
    const newRag = computeRAG(scn.status, newEta)
    updates.push('rag = ?'); vals.push(newRag)
    vals.push(scnId)

    await db.query(`UPDATE shipment_control_notes SET ${updates.join(',')} WHERE id = ?`, vals)

    // date_change_log entries
    if (etd !== undefined && etd !== scn.etd) {
      await db.query(
        `INSERT INTO date_change_log (entity_type, entity_id, field_name, old_value, new_value, change_reason, created_by)
         VALUES ('scn', ?, 'etd', ?, ?, ?, ?)`,
        [scnId, scn.etd || null, etd || null, reason.trim(), userId]
      ).catch(() => {})
    }
    if (eta !== undefined && eta !== scn.eta) {
      await db.query(
        `INSERT INTO date_change_log (entity_type, entity_id, field_name, old_value, new_value, change_reason, created_by)
         VALUES ('scn', ?, 'eta', ?, ?, ?, ?)`,
        [scnId, scn.eta || null, eta || null, reason.trim(), userId]
      ).catch(() => {})
    }
    const fmtD = (d) => d ? new Date(d).toISOString().slice(0, 10) : null
    if (crd !== undefined && fmtD(crd) !== fmtD(scn.crd)) {
      await db.query(
        `INSERT INTO date_change_log (entity_type, entity_id, field_name, old_value, new_value, change_reason, created_by)
         VALUES ('scn', ?, 'cargo_ready_date', ?, ?, ?, ?)`,
        [scnId, fmtD(scn.crd), crd || null, reason.trim(), userId]
      ).catch(() => {})
    }
    if (ccd !== undefined && fmtD(ccd) !== fmtD(scn.ccd)) {
      await db.query(
        `INSERT INTO date_change_log (entity_type, entity_id, field_name, old_value, new_value, change_reason, created_by)
         VALUES ('scn', ?, 'cargo_collection_date', ?, ?, ?, ?)`,
        [scnId, fmtD(scn.ccd), ccd || null, reason.trim(), userId]
      ).catch(() => {})
    }

    await db.query(
      `INSERT INTO scn_status_log (scn_id, from_status, to_status, changed_by, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [scnId, dbToDisplay(scn.status), dbToDisplay(scn.status), userId, `Date update — ${reason.trim()}`]
    )

    await writeAudit(userId, 'date_update', 'scn', scnId,
      { etd: scn.etd, eta: scn.eta }, { etd, eta, reason },
      `/logistics/scn/${scnId}/dates`)

    const [[updated]] = await db.query('SELECT * FROM shipment_control_notes WHERE id = ?', [scnId])

    // Date change counts
    const [[etdCount]] = await db.query(
      'SELECT COUNT(*) as n FROM date_change_log WHERE entity_type=? AND entity_id=? AND field_name=?',
      ['scn', scnId, 'etd']
    )
    const [[etaCount]] = await db.query(
      'SELECT COUNT(*) as n FROM date_change_log WHERE entity_type=? AND entity_id=? AND field_name=?',
      ['scn', scnId, 'eta']
    )

    res.json({
      success: true,
      scn: { ...updated, display_status: dbToDisplay(updated.status) },
      etd_change_count: etdCount.n,
      eta_change_count: etaCount.n,
    })
  } catch (e) {
    console.error('[logistics:dates]', e.message)
    dbError(res, e)
  }
})

// PUT /api/logistics/scn/:scnId/packaging/complete — hand-back (D4)
// The delegated forwarder (or an internal role) marks the SCN's packaging complete.
// NOTE: not a /packages route → not caught by the D2 package carve-out; it flows through
// the router-level enforce('logistics') (forwarder passes via can_edit), then the SAME
// D2 ownership predicate is applied inside completePackaging (URL :scnId, never body) so
// a forwarder can complete ONLY their delegated SCN. Capability-detected for deploy-tolerance.
router.put('/scn/:scnId/packaging/complete', async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)            // ← URL param only
    const userId = req.user?.id
    if (!(await scnHasDelegateCol())) {
      return res.status(409).json({ error: 'Delegated packaging is unavailable until the migration is applied.' })
    }
    const result = await completePackaging(db, { scnId, userId, role: req.user?.role })
    if (!result.ok) return res.status(result.status).json({ error: result.error })

    if (!result.idempotent) {
      // Light lifecycle audit (not the seal tamper-evidence path) — non-blocking is fine.
      writeAudit(userId, 'packaging_completed', 'scn', scnId,
        { packaging_status: 'pending' }, { packaging_status: 'complete' },
        `/logistics/scn/${scnId}/packaging/complete`)
    }
    res.json({ success: true, scn_id: scnId, ...result })
  } catch (e) {
    console.error('[logistics:packaging-complete]', e.message)
    dbError(res, e)
  }
})

// ═══════════════════════════════════════════════════════════════
// PACKAGES
// ═══════════════════════════════════════════════════════════════

// GET /api/logistics/scn/:scnId/packages
router.get('/scn/:scnId/packages', async (req, res) => {
  try {
    const [pkgs] = await db.query(
      'SELECT * FROM scn_packages WHERE scn_id = ? ORDER BY id',
      [req.params.scnId]
    )
    res.json(pkgs)
  } catch (e) { dbError(res, e) }
})

// POST /api/logistics/scn/:scnId/packages
// Authorization handled at the router level (carve-out): internal roles via
// enforce('logistics')→can_create; a delegated freight_forwarder via the delegation
// predicate. requireInternalLogistics is intentionally NOT here — the scoped predicate
// replaces it (see the carve-out near the top of this file).
// Accepts Q4 fields: container_type_id (typed container), parent_package_id (nesting),
// container_no (free), seal_no (GOVERNED via setSealNo). Typed-hierarchy validated here
// (mirrors the create-txn guard, applied to this single add): a container is top-level;
// a sub-package's parent must be a typed container that is itself top-level (depth-3 cap).
// Transactional so a governed seal write + the insert commit/rollback together.
router.post('/scn/:scnId/packages', async (req, res) => {
  const scnId = Number(req.params.scnId)
  const { description, length_mm, width_mm, height_mm, gross_weight_kg, net_weight_kg,
          is_dangerous_goods, dg_class, dg_un_number, marks_numbers,
          container_type_id, parent_package_id, container_no, seal_no, seal_reason } = req.body
  const resource = (req.originalUrl || '').split('?')[0].replace(/^\/api(?=\/)/, '')
  const isContainer = container_type_id != null && container_type_id !== ''

  // Dimensions are required for ordinary packages; a typed container's dims are
  // display-only (read from container_types) so they're optional here.
  if (!isContainer) {
    if (length_mm <= 0 || width_mm <= 0 || height_mm <= 0)
      return res.status(400).json({ error: 'Dimensions must be greater than 0' })
    if (gross_weight_kg <= 0)
      return res.status(400).json({ error: 'Gross weight must be greater than 0' })
  }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    // ── Typed-hierarchy validation ──
    if (isContainer && parent_package_id) {
      await conn.rollback(); return res.status(422).json({ error: 'A container must be top-level — it cannot be nested inside another package.' })
    }
    let parentId = null
    if (parent_package_id) {
      const [[parent]] = await conn.query(
        'SELECT id, container_type_id, parent_package_id FROM scn_packages WHERE id=? AND scn_id=?', [Number(parent_package_id), scnId])
      if (!parent) { await conn.rollback(); return res.status(422).json({ error: 'Parent package not found on this SCN.' }) }
      if (parent.container_type_id == null) { await conn.rollback(); return res.status(422).json({ error: 'A sub-package must be nested under a container, not an ordinary package.' }) }
      if (parent.parent_package_id != null) { await conn.rollback(); return res.status(422).json({ error: 'Exceeds the 3-level limit (container → sub-package → items).' }) }
      parentId = parent.id
    }

    const [[{ maxNum }]] = await conn.query(
      'SELECT COALESCE(MAX(CAST(package_number AS UNSIGNED)),0) AS maxNum FROM scn_packages WHERE scn_id = ?', [scnId])
    const pkgNum = String((parseInt(maxNum) || 0) + 1).padStart(2, '0')

    // Insert (new columns value-gated for deploy-tolerance; seal_no NOT here — governed below).
    const cols = ['scn_id', 'package_number', 'description', 'length_mm', 'width_mm', 'height_mm',
      'gross_weight_kg', 'net_weight_kg', 'is_dangerous_goods', 'dg_class', 'dg_un_number', 'marks_numbers']
    const vals = [scnId, pkgNum, description || null, length_mm || null, width_mm || null, height_mm || null,
      gross_weight_kg || null, net_weight_kg || null, is_dangerous_goods ? 1 : 0, dg_class || null, dg_un_number || null, marks_numbers || null]
    if (isContainer) { cols.push('container_type_id'); vals.push(Number(container_type_id)) }
    if (parentId != null) { cols.push('parent_package_id'); vals.push(parentId) }
    if (container_no != null && String(container_no).trim() !== '') { cols.push('container_no'); vals.push(String(container_no).trim()) }
    const [result] = await conn.query(
      `INSERT INTO scn_packages (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`, vals)
    const packageId = result.insertId

    // seal_no → governed path (set-once, audited; container-only is enforced inside).
    if (seal_no != null && String(seal_no).trim() !== '') {
      const [[scnRow]] = await conn.query('SELECT project_id FROM shipment_control_notes WHERE id=?', [scnId])
      await setSealNo(conn, { packageId, scnId, newSeal: seal_no, reason: seal_reason, userId: req.user.id, resource, ip: req.ip, projectId: scnRow?.project_id ?? null })
    }

    // ── D5.1 forwarder packing: persist per-line contents (scn_package_lines), mirroring
    //    the create-txn shape (expediting.js:1198). Each content references an existing
    //    scn_lines row on THIS scn; we never over-allocate a line beyond its SCN qty
    //    (counts already-packed across ALL packages, including rows inserted earlier in
    //    this same loop — the SUM sees them because each insert precedes the next check). ──
    const contents = Array.isArray(req.body.contents)
      ? req.body.contents.filter(c => c && c.scn_line_id != null && Number(c.qty) > 0)
      : []
    for (const c of contents) {
      const scnLineId = Number(c.scn_line_id)
      const [[sl]] = await conn.query('SELECT id, qty FROM scn_lines WHERE id=? AND scn_id=?', [scnLineId, scnId])
      if (!sl) { await conn.rollback(); return res.status(422).json({ error: `Package contents reference an unknown line (${scnLineId}) on this SCN.` }) }
      const [[{ packed }]] = await conn.query(
        'SELECT COALESCE(SUM(qty),0) AS packed FROM scn_package_lines WHERE scn_line_id = ?', [scnLineId])
      if (Number(packed) + Number(c.qty) > Number(sl.qty) + 1e-9) {
        await conn.rollback()
        return res.status(422).json({ error: `Allocating ${c.qty} exceeds the line's remaining balance (${Number(sl.qty) - Number(packed)} left of ${sl.qty}).` })
      }
      await conn.query(
        'INSERT INTO scn_package_lines (package_id, scn_line_id, qty, uom) VALUES (?,?,?,?)',
        [packageId, scnLineId, Number(c.qty), c.uom || null])
    }

    await conn.query(
      `UPDATE shipment_control_notes SET
         total_packages = (SELECT COUNT(*) FROM scn_packages WHERE scn_id=?),
         total_weight_kg = (SELECT COALESCE(SUM(gross_weight_kg),0) FROM scn_packages WHERE scn_id=?)
       WHERE id = ?`, [scnId, scnId, scnId])
    await conn.commit()
    const [[pkg]] = await db.query('SELECT * FROM scn_packages WHERE id = ?', [packageId])
    res.status(201).json(pkg)
  } catch (e) {
    await conn.rollback()
    if (e instanceof SealGovernanceError) return res.status(e.status).json({ error: e.message })
    console.error('[logistics:add-package]', e.message)
    dbError(res, e)
  } finally { conn.release() }
})

// PUT /api/logistics/scn/:scnId/packages/:packageId
// Dimensional/DG fields are free COALESCE updates. container_no is free-edit; seal_no
// is GOVERNED — routed through the SHARED lib/sealGovernance (set-once + reasoned,
// audited, atomic), the SAME path Expediting uses. The whole edit runs in ONE
// transaction so a governed seal change and its audit row commit/rollback together.
// ⚠⚠ seal_no MUST NEVER be added to the blanket COALESCE below: that is exactly the
//    silent-overwrite hole this closes (it would replace an existing seal with no
//    reason and no audit). Route seal_no through setSealNo ONLY.
// NB: this route is NOT internal-only — freight forwarders retain access (TC ruling:
// the forwarder is often the party that physically seals the container). The seal is
// protected by governance (set-once + reasoned, audited re-seal), not by barring a role.
router.put('/scn/:scnId/packages/:packageId', async (req, res) => {
  const { scnId, packageId } = req.params
  const { description, length_mm, width_mm, height_mm, gross_weight_kg, net_weight_kg,
          is_dangerous_goods, dg_class, dg_un_number, marks_numbers,
          container_no, seal_no, seal_reason } = req.body
  const resource = (req.originalUrl || '').split('?')[0].replace(/^\/api(?=\/)/, '')
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    // project_id for the audit — derived from the SCN, never guessed.
    const [[scn]] = await conn.query('SELECT project_id FROM shipment_control_notes WHERE id=?', [scnId])
    const pid = scn?.project_id ?? null

    // Free dimensional/DG fields. ⚠ Do NOT add seal_no to this COALESCE (see header).
    await conn.query(
      `UPDATE scn_packages SET
         description=COALESCE(?,description), length_mm=COALESCE(?,length_mm),
         width_mm=COALESCE(?,width_mm), height_mm=COALESCE(?,height_mm),
         gross_weight_kg=COALESCE(?,gross_weight_kg), net_weight_kg=COALESCE(?,net_weight_kg),
         is_dangerous_goods=COALESCE(?,is_dangerous_goods), dg_class=COALESCE(?,dg_class),
         dg_un_number=COALESCE(?,dg_un_number), marks_numbers=COALESCE(?,marks_numbers)
       WHERE id=? AND scn_id=?`,
      [description, length_mm, width_mm, height_mm, gross_weight_kg, net_weight_kg,
       is_dangerous_goods !== undefined ? (is_dangerous_goods ? 1 : 0) : null,
       dg_class, dg_un_number, marks_numbers, packageId, scnId]
    )

    // container_no: free-edit (identifier). seal_no: GOVERNED — same shared path as Expediting.
    if (container_no !== undefined) await setContainerNo(conn, { packageId, scnId, newContainerNo: container_no, userId: req.user.id, resource, ip: req.ip, projectId: pid })
    if (seal_no !== undefined)      await setSealNo(conn,      { packageId, scnId, newSeal: seal_no, reason: seal_reason, userId: req.user.id, resource, ip: req.ip, projectId: pid })

    await conn.query(
      `UPDATE shipment_control_notes SET
         total_weight_kg = (SELECT SUM(gross_weight_kg) FROM scn_packages WHERE scn_id=?)
       WHERE id = ?`,
      [scnId, scnId]
    )
    await conn.commit()
    const [[pkg]] = await db.query('SELECT * FROM scn_packages WHERE id = ?', [packageId])
    res.json(pkg)
  } catch (e) {
    await conn.rollback()
    if (e instanceof SealGovernanceError) return res.status(e.status).json({ error: e.message })
    dbError(res, e)
  } finally { conn.release() }
})

// Migration tolerance: does scn_packages.parent_package_id exist yet? Cached sticky-
// true (re-checked only while false → self-heals after the migration without a
// restart, negligible cost). Lets the delete route work in EITHER deploy order:
// column present → hierarchy-aware (409/cascade); column absent → old flat delete
// (no column can exist → every package is a leaf), so a code-before-migration deploy
// never breaks existing package deletes.
let _parentColPresent = false
async function scnPackagesHasParentCol() {
  if (_parentColPresent) return true
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'scn_packages' AND column_name = 'parent_package_id'`)
  _parentColPresent = r.n > 0
  return _parentColPresent
}

// DELETE /api/logistics/scn/:scnId/packages/:packageId[?cascade=1]
// Q2 nested packaging: DEFAULT-DENY a container delete. If the package has
// sub-packages, return a clean 409 ("remove sub-packages first, or delete with
// contents"); the FK is ON DELETE RESTRICT so a bare delete would otherwise throw a
// raw constraint error. `?cascade=1` opts in to atomically delete the package + all
// descendant sub-packages (their scn_package_lines cascade via the package_id FK).
// Default-deny, opt-in to cascade — same shape as the WBS node-delete wizard.
// Order-tolerant: falls back to flat delete when parent_package_id isn't live yet.
router.delete('/scn/:scnId/packages/:packageId', async (req, res) => {
  const { scnId, packageId } = req.params
  const cascade = req.query.cascade === '1' || req.query.cascade === 'true'
  const hierarchy = await scnPackagesHasParentCol()
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [[pkg]] = await conn.query('SELECT id FROM scn_packages WHERE id=? AND scn_id=? FOR UPDATE', [packageId, scnId])
    if (!pkg) { await conn.rollback(); return res.status(404).json({ error: 'Package not found on this SCN.' }) }

    // Pre-migration fallback: no parent_package_id column → no containers possible →
    // every package is a leaf → plain single-row delete (preserves old behaviour).
    let toDelete = [Number(packageId)]
    let hasChildren = false
    if (hierarchy) {
      // Collect descendants (multi-level) via parent_package_id — BFS, level by level.
      let frontier = [Number(packageId)]
      while (frontier.length) {
        const [kids] = await conn.query(
          `SELECT id FROM scn_packages WHERE parent_package_id IN (${frontier.map(() => '?').join(',')})`, frontier)
        const ids = kids.map(k => k.id)
        if (!ids.length) break
        toDelete.push(...ids); frontier = ids
      }
      hasChildren = toDelete.length > 1
      if (hasChildren && !cascade) {
        await conn.rollback()
        return res.status(409).json({
          error: 'This package contains sub-packages. Remove the sub-packages first, or delete the container with its contents.',
          child_count: toDelete.length - 1,
        })
      }
    }

    // Delete deepest-first so ON DELETE RESTRICT (parent_package_id) is never violated;
    // each scn_packages delete cascades its scn_package_lines via the package_id FK.
    for (const id of toDelete.reverse()) {
      await conn.query('DELETE FROM scn_packages WHERE id=?', [id])
    }
    await conn.query(
      `UPDATE shipment_control_notes SET
         total_packages = (SELECT COUNT(*) FROM scn_packages WHERE scn_id=?),
         total_weight_kg = (SELECT COALESCE(SUM(gross_weight_kg),0) FROM scn_packages WHERE scn_id=?)
       WHERE id = ?`,
      [scnId, scnId, scnId]
    )
    await conn.commit()
    res.json({ success: true, deleted_packages: toDelete.length, cascaded: hasChildren })
  } catch (e) {
    try { await conn.rollback() } catch (_) { /* already rolled back */ }
    dbError(res, e)
  } finally { conn.release() }
})

// ═══════════════════════════════════════════════════════════════
// DOCUMENTS
// ═══════════════════════════════════════════════════════════════

// 3a: does scn_documents have the package_id/heat_id link columns yet? Cached sticky-true.
let _scnDocLinkCols = false
async function scnDocLinkColsLive() {
  if (_scnDocLinkCols) return true
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'scn_documents' AND column_name = 'package_id'`)
  _scnDocLinkCols = r.n > 0
  return _scnDocLinkCols
}

// POST /api/logistics/scn/:scnId/documents
router.post('/scn/:scnId/documents', requireInternalLogistics, upload.single('file'), async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)
    const { document_type, notes, package_id, heat_id } = req.body
    const userId = req.user?.id || 1

    if (!document_type) return res.status(400).json({ error: 'document_type is required' })

    const fileName = req.file?.originalname || null
    const filePath = req.file?.path || null

    // 3a: optionally link the doc (e.g. a Mill Test Certificate) to a package and/or heat.
    // Value-gated + capability-detected so legacy uploads + pre-migration deploys are unaffected.
    const cols = ['scn_id', 'document_type', 'file_name', 'file_path', 'uploaded_by', 'notes']
    const vals = [scnId, document_type, fileName, filePath, userId, notes || null]
    if (await scnDocLinkColsLive()) {
      cols.push('package_id', 'heat_id')
      vals.push(package_id ? Number(package_id) : null, heat_id ? Number(heat_id) : null)
    }
    const [result] = await db.query(
      `INSERT INTO scn_documents (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`, vals
    )
    const [[doc]] = await db.query(
      `SELECT d.*, u.full_name AS uploaded_by_name
       FROM scn_documents d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.id = ?`,
      [result.insertId]
    )
    res.status(201).json(doc)
  } catch (e) {
    console.error('[logistics:upload-doc]', e.message)
    dbError(res, e)
  }
})

// DELETE /api/logistics/scn/:scnId/documents/:docId
router.delete('/scn/:scnId/documents/:docId', async (req, res) => {
  try {
    const { scnId, docId } = req.params
    const [[doc]] = await db.query(
      'SELECT file_path FROM scn_documents WHERE id=? AND scn_id=?', [docId, scnId]
    )
    if (!doc) return res.status(404).json({ error: 'Document not found' })

    await db.query('DELETE FROM scn_documents WHERE id=? AND scn_id=?', [docId, scnId])
    // Optional: delete file from disk
    if (doc.file_path && fs.existsSync(doc.file_path)) {
      try { fs.unlinkSync(doc.file_path) } catch (_) {}
    }
    res.json({ success: true })
  } catch (e) { dbError(res, e) }
})

// ─── CRITICAL PATH TOGGLE ────────────────────────────────────
router.put('/scn/:scnId/critical-path', async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)
    const { is_critical_path } = req.body
    await db.query('UPDATE shipment_control_notes SET is_critical_path=? WHERE id=?',
      [is_critical_path ? 1 : 0, scnId])
    res.json({ success: true, is_critical_path: is_critical_path ? 1 : 0 })
  } catch (e) { dbError(res, e) }
})

module.exports = router
// Exported for the D2/D4 authorization proofs (exercise the EXACT predicate, no drift).
module.exports.forwarderOwnsScnPackaging = forwarderOwnsScnPackaging
module.exports.completePackaging = completePackaging          // D4 hand-back
module.exports.isPackagingDelegate = isPackagingDelegate      // shared predicate
