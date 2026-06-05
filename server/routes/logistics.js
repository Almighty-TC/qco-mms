// ─── LOGISTICS ROUTES ─────────────────────────────────────────
// SCN Register, status transitions, packages, documents, timeline.
// All routes require a valid JWT via authenticateToken.
// Status mapping: DB enum values → display labels handled here.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { dbError } = require('../utils/dbError')
const { authenticateToken } = require('../middleware/auth')
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')

router.use(authenticateToken)
router.use(require('../middleware/permissions').denyReadOnly) // C-a: viewer/auditor barred from writes
router.use(require('../middleware/permissions').enforce('logistics')) // C-b2: matrix gate

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

// Valid next statuses from current display status
const NEXT_STATUSES = {
  pending_pickup:   ['in_transit'],
  in_transit:       ['customs_review', 'pending_delivery'],
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
    const lim    = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)))
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

    // PO lines assigned to this SCN
    const [lines] = await db.query(
      `SELECT pl.id, pl.line_number, pl.description, pl.qty, pl.qty_assigned, pl.uom
       FROM po_lines pl
       WHERE pl.po_id = ? ORDER BY pl.line_number`,
      [scn.po_id || 0]
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

    res.json({
      ...scn,
      display_status: dbToDisplay(scn.status),
      rag: computeRAG(scn.status, scn.eta),
      lines,
      additional_items,
      packages,
      documents,
      status_log,
      date_changes,
    })
  } catch (e) {
    console.error('[logistics:scn-detail]', e.message)
    dbError(res, e)
  }
})

// ═══════════════════════════════════════════════════════════════
// STATUS UPDATE
// ═══════════════════════════════════════════════════════════════

// PUT /api/logistics/scn/:scnId/status
router.put('/scn/:scnId/status', async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)
    const { status: newDisplayStatus, notes, proof_of_custody } = req.body
    const userId = req.user?.id || 1

    if (!newDisplayStatus) return res.status(400).json({ error: 'status is required' })

    const [[scn]] = await db.query('SELECT id, status FROM shipment_control_notes WHERE id = ?', [scnId])
    if (!scn) return res.status(404).json({ error: 'SCN not found' })

    const currentDisplay = dbToDisplay(scn.status)
    const validNext = NEXT_STATUSES[currentDisplay] || []

    if (!validNext.includes(newDisplayStatus)) {
      return res.status(400).json({
        error: `Invalid status transition: cannot move from "${currentDisplay}" to "${newDisplayStatus}". Valid next statuses: ${validNext.join(', ') || 'none'}`,
      })
    }

    const newDbStatus = displayToDb(newDisplayStatus)
    const rag = computeRAG(newDbStatus, scn.eta)

    // For delivered: set ata to today if not set
    const ataUpdate = newDisplayStatus === 'delivered' ? ', ata = CURDATE()' : ''

    await db.query(
      `UPDATE shipment_control_notes SET status = ?, rag = ? ${ataUpdate} WHERE id = ?`,
      [newDbStatus, rag, scnId]
    )

    await db.query(
      `INSERT INTO scn_status_log (scn_id, from_status, to_status, changed_by, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [scnId, currentDisplay, newDisplayStatus, userId, notes || null]
    )

    await writeAudit(userId, 'status_update', 'scn', scnId,
      { status: currentDisplay }, { status: newDisplayStatus, notes },
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
router.post('/scn/:scnId/packages', requireInternalLogistics, async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)
    const { description, length_mm, width_mm, height_mm, gross_weight_kg, net_weight_kg,
            is_dangerous_goods, dg_class, dg_un_number, marks_numbers } = req.body

    if (length_mm <= 0 || width_mm <= 0 || height_mm <= 0)
      return res.status(400).json({ error: 'Dimensions must be greater than 0' })
    if (gross_weight_kg <= 0)
      return res.status(400).json({ error: 'Gross weight must be greater than 0' })

    const [[{ maxNum }]] = await db.query(
      'SELECT COALESCE(MAX(CAST(package_number AS UNSIGNED)),0) AS maxNum FROM scn_packages WHERE scn_id = ?',
      [scnId]
    )
    const pkgNum = String((parseInt(maxNum) || 0) + 1).padStart(2, '0')

    const [result] = await db.query(
      `INSERT INTO scn_packages (scn_id, package_number, description, length_mm, width_mm, height_mm,
        gross_weight_kg, net_weight_kg, is_dangerous_goods, dg_class, dg_un_number, marks_numbers)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [scnId, pkgNum, description || null, length_mm, width_mm, height_mm,
       gross_weight_kg, net_weight_kg || null,
       is_dangerous_goods ? 1 : 0, dg_class || null, dg_un_number || null, marks_numbers || null]
    )

    // Update totals on SCN
    await db.query(
      `UPDATE shipment_control_notes SET
         total_packages = (SELECT COUNT(*) FROM scn_packages WHERE scn_id=?),
         total_weight_kg = (SELECT SUM(gross_weight_kg) FROM scn_packages WHERE scn_id=?)
       WHERE id = ?`,
      [scnId, scnId, scnId]
    )

    const [[pkg]] = await db.query('SELECT * FROM scn_packages WHERE id = ?', [result.insertId])
    res.status(201).json(pkg)
  } catch (e) {
    console.error('[logistics:add-package]', e.message)
    dbError(res, e)
  }
})

// PUT /api/logistics/scn/:scnId/packages/:packageId
router.put('/scn/:scnId/packages/:packageId', async (req, res) => {
  try {
    const { scnId, packageId } = req.params
    const { description, length_mm, width_mm, height_mm, gross_weight_kg, net_weight_kg,
            is_dangerous_goods, dg_class, dg_un_number, marks_numbers } = req.body

    await db.query(
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
    await db.query(
      `UPDATE shipment_control_notes SET
         total_weight_kg = (SELECT SUM(gross_weight_kg) FROM scn_packages WHERE scn_id=?)
       WHERE id = ?`,
      [scnId, scnId]
    )
    const [[pkg]] = await db.query('SELECT * FROM scn_packages WHERE id = ?', [packageId])
    res.json(pkg)
  } catch (e) { dbError(res, e) }
})

// DELETE /api/logistics/scn/:scnId/packages/:packageId
router.delete('/scn/:scnId/packages/:packageId', async (req, res) => {
  try {
    const { scnId, packageId } = req.params
    await db.query('DELETE FROM scn_packages WHERE id=? AND scn_id=?', [packageId, scnId])
    await db.query(
      `UPDATE shipment_control_notes SET
         total_packages = (SELECT COUNT(*) FROM scn_packages WHERE scn_id=?),
         total_weight_kg = (SELECT COALESCE(SUM(gross_weight_kg),0) FROM scn_packages WHERE scn_id=?)
       WHERE id = ?`,
      [scnId, scnId, scnId]
    )
    res.json({ success: true })
  } catch (e) { dbError(res, e) }
})

// ═══════════════════════════════════════════════════════════════
// DOCUMENTS
// ═══════════════════════════════════════════════════════════════

// POST /api/logistics/scn/:scnId/documents
router.post('/scn/:scnId/documents', requireInternalLogistics, upload.single('file'), async (req, res) => {
  try {
    const scnId = Number(req.params.scnId)
    const { document_type, notes } = req.body
    const userId = req.user?.id || 1

    if (!document_type) return res.status(400).json({ error: 'document_type is required' })

    const fileName = req.file?.originalname || null
    const filePath = req.file?.path || null

    const [result] = await db.query(
      `INSERT INTO scn_documents (scn_id, document_type, file_name, file_path, uploaded_by, notes)
       VALUES (?,?,?,?,?,?)`,
      [scnId, document_type, fileName, filePath, userId, notes || null]
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
