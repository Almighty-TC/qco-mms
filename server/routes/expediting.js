// ─── EXPEDITING ROUTES ────────────────────────────────────────
// Register, milestone forecasting, line items, child items, VDRL,
// action notes. All routes require a valid JWT via authenticateToken.
// RAG status computed server-side from milestone dates.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { dbError } = require('../utils/dbError')
const { authenticateToken } = require('../middleware/auth')
const { fileFilter } = require('../utils/upload')
const { dateOrder } = require('../utils/validate')
const { setSealNo, setContainerNo, SealGovernanceError } = require('../lib/sealGovernance') // Q4.3 shared seal governance

// ─── Q3 CHILD-STOCK CAPABILITY DETECT ─────────────────────────
// Did migrate-child-stock.js run? Cached sticky-true (re-checked only while false →
// self-heals after the migration without a restart). Lets the create path degrade
// gracefully when the inheritance columns aren't live yet (child created as before,
// no inherit/block) instead of erroring on a missing column.
let _childStockCols = false
async function childStockColsLive() {
  if (_childStockCols) return true
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'scn_additional_items' AND column_name = 'wbs_code_snapshot'`)
  _childStockCols = r.n > 0
  return _childStockCols
}

// Did migrate-delegated-packaging.js run? Cached sticky-true (D3 deploy-tolerance). Lets
// the SCN-create path degrade gracefully when the delegation columns aren't live yet
// (SCN created without delegation fields) instead of erroring on a missing column.
let _delegCols = false
async function scnDelegationColsLive() {
  if (_delegCols) return true
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'shipment_control_notes' AND column_name = 'packaging_delegated_to'`)
  _delegCols = r.n > 0
  return _delegCols
}

// ─── DELEGATION VALIDATION (forwarder-delegated packaging, D3) ─────────────────
// Pure verdict (uses conn only for the freight_forwarder lookup) — the SCN-create route
// calls it; exported so the D3 proofs run THIS exact code (no drift).
//   packed_by_type='forwarder' → packaging_delegated_to MUST be an ACTIVE freight_forwarder
//     user; on success forwarder_user_id is set to the delegate (visibility scoping) and
//     packaging_status starts 'pending' (hand-back lifecycle, D4).
//   packed_by_type='internal'|'vendor' → packaging_delegated_to MUST be empty (NULL) —
//     no external write access (vendor packages are entered by the expeditor).
// Returns { ok:true, packedBy, delegateId, packagingStatus, forwarderUserId }
//      or { ok:false, status, error } (caller maps !ok → status).
async function resolveDelegation(packed_by_type, packaging_delegated_to, conn) {
  const PACKED_TYPES = new Set(['internal', 'vendor', 'forwarder'])
  const packedBy = packed_by_type || 'internal'
  if (!PACKED_TYPES.has(packedBy)) {
    return { ok: false, status: 422, error: "packed_by_type must be 'internal', 'vendor', or 'forwarder'." }
  }
  if (packedBy === 'forwarder') {
    const delegateId = Number(packaging_delegated_to) || null
    if (!delegateId) {
      return { ok: false, status: 422, error: 'packed_by_type=forwarder requires packaging_delegated_to (an active freight forwarder).' }
    }
    const [[ff]] = await conn.query(
      "SELECT id FROM users WHERE id = ? AND role = 'freight_forwarder' AND is_active = 1", [delegateId])
    if (!ff) {
      return { ok: false, status: 422, error: 'packaging_delegated_to must be an active freight_forwarder user.' }
    }
    // forwarder_user_id = the delegate → existing forwarder visibility scoping surfaces it.
    return { ok: true, packedBy, delegateId, packagingStatus: 'pending', forwarderUserId: delegateId }
  }
  // internal / vendor → must NOT name a delegate (no external write access).
  if (packaging_delegated_to != null && packaging_delegated_to !== '') {
    return { ok: false, status: 422, error: 'packaging_delegated_to must be empty unless packed_by_type=forwarder.' }
  }
  return { ok: true, packedBy, delegateId: null, packagingStatus: null, forwarderUserId: null }
}

router.use(authenticateToken)
router.use(require('../middleware/permissions').denyReadOnly) // C-a: viewer/auditor barred from writes
router.use(require('../middleware/permissions').enforce(p => p.includes('/vdrl') ? 'vdrl' : 'expediting')) // C-b2: vdrl routes→vdrl, else expediting
router.param('projectId', require('../middleware/permissions').requireProjectScope) // Stage 1: external roles WBS-scoped to granted projects

// GET /api/expediting/forwarders — active freight_forwarder users for the delegation
// picker (D5). GET → enforce('expediting') can_view (expeditors have it). Read-only,
// no project param (forwarders aren't project-scoped). Returns id + name + company.
router.get('/forwarders', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, full_name, company, email FROM users
       WHERE role = 'freight_forwarder' AND is_active = 1 ORDER BY full_name`)
    res.json(rows)
  } catch (e) { dbError(res, e) }
})

// ─── ACCESS CONTROL ───────────────────────────────────────────
// Roles that can see all POs; others see only their assigned ones.
function canSeeAllPOs(role) {
  return ['admin','project_manager','project_director','procurement_manager','expediting_manager'].includes(role)
}

// True when the user is one of the PO's assigned expeditors (co-assignment).
async function isAssignedExpeditor(userId, poId) {
  if (!userId || !poId) return false
  const [[m]] = await db.query('SELECT 1 FROM po_expeditors WHERE po_id=? AND user_id=? LIMIT 1', [Number(poId), Number(userId)])
  return !!m
}

// ─── PER-PO ACCESS GUARD ──────────────────────────────────────
// Every route carrying :poId is gated here in one place. Managers (canSeeAllPOs)
// pass; everyone else must be an ASSIGNED expeditor on that PO, else 403. This
// covers the detail view AND all milestone / action-note / ITP / line writes,
// so an unassigned expeditor cannot open or edit another expeditor's PO even by
// hitting the URL/API directly.
router.param('poId', async (req, res, next, poId) => {
  try {
    if (canSeeAllPOs(req.user?.role)) return next()
    if (await isAssignedExpeditor(req.user?.id, poId)) return next()
    return res.status(403).json({ error: 'This PO is not assigned to you.' })
  } catch (e) { next(e) }
})

// ─── RAG HELPERS ──────────────────────────────────────────────
// Computes the milestone-level status based on date fields.
function computeMilestoneStatus(m) {
  if (m.actual_date) return 'complete'
  const today = new Date(); today.setHours(0,0,0,0)
  if (m.forecast_date) {
    const fd = new Date(m.forecast_date); fd.setHours(0,0,0,0)
    const days = (fd - today) / 86400000
    if (fd < today) return 'breached'
    if (days <= 14) return 'at_risk'
    return 'in_progress'
  }
  return 'not_started'
}

// Computes the overall PO RAG from its milestones.
function computePORag(milestones) {
  const statuses = milestones.map(m => computeMilestoneStatus(m))
  if (statuses.some(s => s === 'breached')) return 'red'
  if (statuses.some(s => s === 'at_risk'))  return 'amber'
  if (statuses.every(s => s === 'complete')) return 'complete'
  if (statuses.some(s => s === 'in_progress' || s === 'complete')) return 'blue'
  return 'grey'
}

// ─── STATS ────────────────────────────────────────────────────
// Returns summary counts for stat cards on the Expediting screen.
router.get('/:projectId/stats', async (req, res) => {
  try {
    const { projectId } = req.params
    // Stats mirror the register's visibility: non-managers count only POs they're
    // assigned to, so the headline figures match the list they can actually see.
    const scoped = !canSeeAllPOs(req.user?.role)
    const [pos] = await db.query(
      `SELECT po.id FROM purchase_orders po
       WHERE po.project_id=? AND po.is_locked=1
       ${scoped ? 'AND EXISTS (SELECT 1 FROM po_expeditors pe WHERE pe.po_id=po.id AND pe.user_id=?)' : ''}`,
      scoped ? [projectId, req.user.id] : [projectId]
    )
    const counts = { total_pos: pos.length, ongoing: 0, complete: 0, breached: 0, at_risk: 0 }

    for (const { id } of pos) {
      const [milestones] = await db.query(
        `SELECT actual_date, forecast_date FROM po_milestones WHERE po_id=? AND is_deleted=0`,
        [id]
      )
      const rag = computePORag(milestones)
      if (rag === 'complete') counts.complete++
      else if (rag === 'red') { counts.breached++; counts.ongoing++ }
      else if (rag === 'amber') { counts.at_risk++; counts.ongoing++ }
      else counts.ongoing++
    }
    res.json(counts)
  } catch (e) {
    console.error(e)
    dbError(res, e)
  }
})

// ─── REGISTER ─────────────────────────────────────────────────
// Returns paginated list of locked POs with milestones and RAG.
router.get('/:projectId/register', async (req, res) => {
  try {
    const { projectId } = req.params
    const page   = Math.max(1, parseInt(req.query.page  || '1', 10))
    const limit  = Math.min(100000, Math.max(1, parseInt(req.query.limit || '50', 10)))
    const offset = (page - 1) * limit

    // ─── FILTERS (server-side, whole-set) ───
    const filters = ['po.project_id=?', 'po.is_locked=1']
    const params  = [projectId]
    if (!canSeeAllPOs(req.user?.role)) { filters.push('EXISTS (SELECT 1 FROM po_expeditors pe WHERE pe.po_id=po.id AND pe.user_id=?)'); params.push(req.user.id) }

    const { search, critical_only, ros_from, ros_to, rag, sub_tab } = req.query
    if (search) {
      const q = `%${search}%`
      filters.push('(po.po_number LIKE ? OR po.po_name LIKE ? OR po.vendor_name LIKE ? OR s.name LIKE ? OR po.wbs_code LIKE ? OR po.description LIKE ?)')
      params.push(q, q, q, q, q, q)
    }
    if (critical_only === 'true') filters.push('po.is_critical_path=1')
    if (ros_from) { filters.push('po.ros_date >= ?'); params.push(ros_from) }
    if (ros_to)   { filters.push('po.ros_date <= ?'); params.push(ros_to) }

    // ─── RAG / sub-tab filters ───
    // Milestone-derived RAG computed in SQL to match the JS computePORag() /
    // computeMilestoneStatus() exactly (forecast_date, 14-day at-risk window).
    const M          = `FROM po_milestones m WHERE m.po_id=po.id AND m.is_deleted=0`
    const BREACHED   = `EXISTS(SELECT 1 ${M} AND m.actual_date IS NULL AND m.forecast_date IS NOT NULL AND m.forecast_date < CURDATE())`
    const ATRISK     = `EXISTS(SELECT 1 ${M} AND m.actual_date IS NULL AND m.forecast_date IS NOT NULL AND m.forecast_date >= CURDATE() AND DATEDIFF(m.forecast_date, CURDATE()) <= 14)`
    const HASOPEN    = `EXISTS(SELECT 1 ${M} AND m.actual_date IS NULL)`
    const HASTOUCHED = `EXISTS(SELECT 1 ${M} AND (m.actual_date IS NOT NULL OR m.forecast_date IS NOT NULL))`
    const COMPLETE   = `(NOT ${BREACHED} AND NOT ${ATRISK} AND NOT ${HASOPEN})` // empty milestones → complete (matches every())
    const RAG_WHERE  = {
      red:      BREACHED,
      amber:    `(NOT ${BREACHED} AND ${ATRISK})`,
      complete: COMPLETE,
      blue:     `(NOT ${BREACHED} AND NOT ${ATRISK} AND ${HASOPEN} AND ${HASTOUCHED})`,
      grey:     `(NOT ${BREACHED} AND NOT ${ATRISK} AND ${HASOPEN} AND NOT ${HASTOUCHED})`,
    }
    if (rag && RAG_WHERE[rag]) filters.push(RAG_WHERE[rag])
    if (sub_tab === 'complete')     filters.push(COMPLETE)
    else if (sub_tab === 'ongoing') filters.push(`NOT ${COMPLETE}`)

    const whereSql = filters.join(' AND ')

    // ─── WHITELISTED SORT (+ unique po.id tiebreaker) ───
    const SAFE_SORT = {
      po_number: 'po.po_number', vendor: 'vendor_display', ros_date: 'po.ros_date',
      status: 'po.status', value: 'po.value', wbs: 'po.wbs_code',
    }
    const orderBy  = SAFE_SORT[req.query.sort_col] || 'po.po_number'
    const orderDir = String(req.query.sort_dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC'

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE ${whereSql}`,
      params
    )

    const [pos] = await db.query(
      `SELECT
        po.id, po.po_number, po.po_name, po.wbs_code,
        po.description AS material_description,
        po.ros_date, po.contract_delivery_date,
        po.is_critical_path, po.is_locked, po.status,
        po.currency, po.value, po.group_category,
        po.pre_expediting_enabled,
        po.vendor_name,
        COALESCE(s.name, po.vendor_name) AS vendor_display,
        own.full_name AS owner_name,
        exp.full_name AS expeditor_name
       FROM purchase_orders po
       LEFT JOIN suppliers s   ON s.id   = po.supplier_id
       LEFT JOIN users own     ON own.id = po.owner_id
       LEFT JOIN users exp     ON exp.id = po.expeditor_id
       WHERE ${whereSql}
       ORDER BY ${orderBy} ${orderDir}, po.id ${orderDir}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )

    const result = []
    for (const po of pos) {
      const [milestones] = await db.query(
        `SELECT id, label, step_order, planned_date, forecast_date, actual_date, forecast_changed_count
         FROM po_milestones WHERE po_id=? AND is_deleted=0 ORDER BY step_order`,
        [po.id]
      )
      const enriched = milestones.map(m => ({ ...m, status: computeMilestoneStatus(m) }))
      result.push({ ...po, rag: computePORag(milestones), milestones: enriched })
    }

    res.json({ total, page, limit, data: result })
  } catch (e) {
    console.error(e)
    dbError(res, e)
  }
})

// Friendly SCN status for the PO-detail SCN list. Mirrors logistics.js dbToDisplay
// so the PO "Line Items & SCNs" tab can reuse the same status-pill labels.
const scnDisplayStatus = (s) => ({
  draft: 'pending_pickup', pending: 'pending_pickup', 'in-transit': 'in_transit',
  customs_review: 'customs_review', arrived: 'pending_delivery',
  partially_received: 'delivered', received: 'delivered', closed: 'delivered',
  pending_pickup: 'pending_pickup', in_transit: 'in_transit', pending_delivery: 'pending_delivery', delivered: 'delivered',
}[s] || s)

// ─── PO DETAIL ────────────────────────────────────────────────
// Full PO detail including milestones, lines, child items, notes, VDRL.
router.get('/:projectId/po/:poId', async (req, res) => {
  try {
    const { projectId, poId } = req.params

    const [[po]] = await db.query(
      `SELECT
        po.id, po.po_number, po.po_name, po.wbs_code,
        po.description AS material_description,
        po.ros_date, po.contract_delivery_date,
        po.is_critical_path, po.is_locked, po.status,
        po.currency, po.value, po.group_category,
        po.pre_expediting_enabled,
        po.supplier_id,
        po.vendor_name, po.incoterms,
        po.milestone_po_date, po.milestone_fat_date,
        po.milestone_esd_date, po.milestone_eta_date, po.milestone_ros_date,
        COALESCE(s.name, po.vendor_name) AS vendor_display,
        s.address AS supplier_address,
        s.contact_name AS supplier_contact,
        own.full_name AS owner_name,
        exp.full_name AS expeditor_name,
        -- All assigned expeditors (co-assignment), lead first.
        (SELECT GROUP_CONCAT(u2.full_name ORDER BY pe.assigned_at SEPARATOR '||')
           FROM po_expeditors pe JOIN users u2 ON u2.id = pe.user_id
           WHERE pe.po_id = po.id) AS expeditor_names_all,
        po.created_at, po.updated_at
       FROM purchase_orders po
       LEFT JOIN suppliers s   ON s.id   = po.supplier_id
       LEFT JOIN users own     ON own.id = po.owner_id
       LEFT JOIN users exp     ON exp.id = po.expeditor_id
       WHERE po.id=? AND po.project_id=?`,
      [poId, projectId]
    )
    if (po) {
      po.expeditor_names = po.expeditor_names_all ? po.expeditor_names_all.split('||')
        : (po.expeditor_name ? [po.expeditor_name] : [])
      delete po.expeditor_names_all
    }
    if (!po) return res.status(404).json({ error: 'PO not found' })

    // ─── MILESTONES ───────────────────────────────────────────
    const [milestones] = await db.query(
      `SELECT m.*, h.old_value AS last_forecast_old, h.changed_at AS last_changed_at
       FROM po_milestones m
       LEFT JOIN (
         SELECT entity_id, old_value, changed_at
         FROM expediting_forecast_history
         WHERE entity_type='milestone'
         ORDER BY changed_at DESC
       ) h ON h.entity_id = m.id
       WHERE m.po_id=? AND m.is_deleted=0
       ORDER BY m.step_order`,
      [poId]
    )
    const enrichedMilestones = milestones.map(m => ({ ...m, status: computeMilestoneStatus(m) }))

    // ─── LINES ────────────────────────────────────────────────
    const [lines] = await db.query(
      `SELECT l.*, cm.name AS commodity_name, cm.trace_level,
        COALESCE(l.qty_assigned, 0) AS qty_assigned,
        GREATEST(0, COALESCE(l.qty, 0) - COALESCE(l.qty_assigned, 0)) AS qty_available
       FROM po_lines l
       LEFT JOIN commodity_library cm ON cm.id = l.commodity_id
       WHERE l.po_id=? ORDER BY l.line_number`,
      [poId]
    )
    for (const line of lines) {
      const [children] = await db.query(
        `SELECT * FROM expediting_child_items WHERE po_line_id=? ORDER BY sub_number`,
        [line.id]
      )
      line.child_items = children
    }

    // ─── ITP ITEMS ────────────────────────────────────────────
    let itp_items = []
    try {
      const [rows] = await db.query(
        `SELECT i.*, r.description AS requirement_description, r.inspection_type
         FROM itp_items i
         JOIN itp_requirements r ON r.id = i.requirement_id
         WHERE r.po_id=? ORDER BY i.item_number`,
        [poId]
      )
      itp_items = rows
    } catch (_) {}

    // ─── ACTION NOTES ─────────────────────────────────────────
    const [notes] = await db.query(
      `SELECT n.*, u.full_name AS created_by_name
       FROM po_action_notes n
       LEFT JOIN users u ON u.id = n.created_by
       WHERE n.po_id=? ORDER BY n.created_at DESC`,
      [poId]
    )

    // ─── FORECAST HISTORY ─────────────────────────────────────
    const [forecast_history] = await db.query(
      `SELECT h.*, u.full_name AS changed_by_name
       FROM expediting_forecast_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.entity_type='milestone'
       ORDER BY h.changed_at DESC
       LIMIT 50`,
    )

    // ─── VDRL ─────────────────────────────────────────────────
    let vdrl_package = null
    const [[vp]] = await db.query(
      `SELECT * FROM vdrl_packages WHERE po_id=? LIMIT 1`, [poId]
    )
    if (vp) {
      const [vdocs] = await db.query(
        `SELECT * FROM vdrl_documents WHERE package_id=? ORDER BY doc_number`,
        [vp.id]
      )
      vdrl_package = { ...vp, documents: vdocs }
    }

    // ─── SUPPLIER PICKUP ADDRESSES ────────────────────────────
    // The SCN pickup location comes from the VENDOR/SUPPLIER's own address(es)
    // (supplier_addresses), not the project warehouses. Primary first.
    let supplier_addresses = []
    if (po.supplier_id) {
      const [addrs] = await db.query(
        `SELECT id, type, address_line1, address_line2, city, state, postcode, country, is_primary
         FROM supplier_addresses WHERE supplier_id=?
         ORDER BY is_primary DESC, id`, [po.supplier_id])
      supplier_addresses = addrs.map(a => ({
        ...a,
        label: [a.address_line1, a.address_line2, a.city, a.state, a.postcode, a.country].filter(Boolean).join(', '),
      }))
    }
    // Fallback: the suppliers.address one-liner, if no structured addresses exist.
    if (!supplier_addresses.length && po.supplier_address) {
      supplier_addresses = [{ id: 0, type: 'primary', label: po.supplier_address, is_primary: 1 }]
    }

    // ── SCNs raised against this PO (read-only) — for the "Line Items & SCNs" tab.
    // display_status mirrors Logistics' friendly status so the tab reuses the pills. ──
    const [scns] = await db.query(
      `SELECT id, scn_ref, status, mode, eta, ata, total_packages, created_at
       FROM shipment_control_notes WHERE po_id=? AND project_id=? ORDER BY created_at DESC`,
      [Number(poId), Number(projectId)]
    )
    for (const s of scns) s.display_status = scnDisplayStatus(s.status)

    res.json({
      ...po,
      rag: computePORag(milestones),
      milestones: enrichedMilestones,
      po_lines: lines,   // Frontend expects po_lines
      supplier_addresses,
      itp_items,
      action_notes: notes,
      forecast_history,
      vdrl_package,
      scns,
    })
  } catch (e) {
    console.error(e)
    dbError(res, e)
  }
})

// ─── FORECAST UPDATE ──────────────────────────────────────────
// Updates milestone forecast date and records history entry.
router.put('/:projectId/po/:poId/milestone/:milestoneId/forecast', async (req, res) => {
  try {
    const { poId, milestoneId } = req.params
    const { forecast_date, reason } = req.body
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Reason is required' })

    const [[old]] = await db.query(
      `SELECT forecast_date FROM po_milestones WHERE id=? AND po_id=?`,
      [milestoneId, poId]
    )
    if (!old) return res.status(404).json({ error: 'Milestone not found' })

    await db.query(
      `INSERT INTO expediting_forecast_history
        (entity_type, entity_id, field_name, old_value, new_value, reason, changed_by, changed_at)
       VALUES ('milestone', ?, 'forecast_date', ?, ?, ?, ?, NOW())`,
      [milestoneId, old.forecast_date, forecast_date, reason.trim(), req.user?.id || null]
    )

    await db.query(
      `UPDATE po_milestones
       SET forecast_date=?, forecast_changed_count=forecast_changed_count+1, updated_at=NOW()
       WHERE id=? AND po_id=?`,
      [forecast_date, milestoneId, poId]
    )

    const [[updated]] = await db.query(
      `SELECT * FROM po_milestones WHERE id=?`, [milestoneId]
    )
    res.json({ ...updated, status: computeMilestoneStatus(updated) })
  } catch (e) {
    console.error(e)
    dbError(res, e)
  }
})

// ─── ACTUAL UPDATE ────────────────────────────────────────────
// Records actual completion date for a milestone.
router.put('/:projectId/po/:poId/milestone/:milestoneId/actual', async (req, res) => {
  try {
    const { poId, milestoneId } = req.params
    const { actual_date, reason } = req.body
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Reason is required' })

    const [[ms]] = await db.query(
      `SELECT m.actual_date, po.pre_expediting_enabled, po.is_locked
       FROM po_milestones m JOIN purchase_orders po ON po.id=m.po_id
       WHERE m.id=? AND m.po_id=?`,
      [milestoneId, poId]
    )
    if (!ms) return res.status(404).json({ error: 'Milestone not found' })

    await db.query(
      `INSERT INTO expediting_forecast_history
        (entity_type, entity_id, field_name, old_value, new_value, reason, changed_by, changed_at)
       VALUES ('milestone', ?, 'actual_date', ?, ?, ?, ?, NOW())`,
      [milestoneId, ms.actual_date, actual_date, reason.trim(), req.user?.id || null]
    )

    await db.query(
      `UPDATE po_milestones SET actual_date=?, updated_at=NOW() WHERE id=? AND po_id=?`,
      [actual_date, milestoneId, poId]
    )

    const [[updated]] = await db.query(
      `SELECT * FROM po_milestones WHERE id=?`, [milestoneId]
    )
    res.json({ ...updated, status: computeMilestoneStatus(updated) })
  } catch (e) {
    console.error(e)
    dbError(res, e)
  }
})

// ─── FORECAST HISTORY ─────────────────────────────────────────
// Returns all forecast change history for a milestone.
router.get('/:projectId/po/:poId/milestone/:milestoneId/forecast-history', async (req, res) => {
  try {
    const { milestoneId } = req.params
    const [rows] = await db.query(
      `SELECT h.*, u.full_name AS changed_by_name
       FROM expediting_forecast_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.entity_type='milestone' AND h.entity_id=?
       ORDER BY h.changed_at DESC`,
      [milestoneId]
    )
    res.json(rows)
  } catch (e) {
    console.error(e)
    dbError(res, e)
  }
})

// ─── ACTION NOTES ─────────────────────────────────────────────
// Posts a new action note against a PO.
router.post('/:projectId/po/:poId/action-notes', async (req, res) => {
  try {
    const { poId } = req.params
    const { note_text } = req.body
    if (!note_text || !note_text.trim()) return res.status(400).json({ error: 'Note text is required' })

    const [result] = await db.query(
      `INSERT INTO po_action_notes (po_id, note_text, created_by, created_at)
       VALUES (?, ?, ?, NOW())`,
      [poId, note_text.trim(), req.user?.id || null]
    )
    const [[note]] = await db.query(
      `SELECT n.*, u.full_name AS created_by_name
       FROM po_action_notes n LEFT JOIN users u ON u.id=n.created_by
       WHERE n.id=?`,
      [result.insertId]
    )
    res.json(note)
  } catch (e) {
    console.error(e)
    dbError(res, e)
  }
})

// ─── CHILD ITEMS ──────────────────────────────────────────────
// Adds a child item to a PO line.
router.post('/:projectId/po/:poId/lines/:lineId/child-items', async (req, res) => {
  try {
    const { lineId } = req.params
    const { description, qty, uom, cdd, notes } = req.body

    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM expediting_child_items WHERE po_line_id=?`, [lineId]
    )
    const sub_number = String((countRow.cnt || 0) + 1).padStart(3, '0')

    const [result] = await db.query(
      `INSERT INTO expediting_child_items
        (po_line_id, sub_number, description, qty, uom, cdd, status, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW())`,
      [lineId, sub_number, description || '', qty || 0, uom || '', cdd || null, notes || '', req.user?.id || null]
    )
    const [[child]] = await db.query(
      `SELECT * FROM expediting_child_items WHERE id=?`, [result.insertId]
    )
    res.json(child)
  } catch (e) {
    console.error(e)
    dbError(res, e)
  }
})

// ─── LINK COMMODITY ───────────────────────────────────────────
// Links a commodity or equipment tag ref to a PO line.
router.put('/:projectId/po/:poId/lines/:lineId/link', async (req, res) => {
  try {
    const { poId, lineId } = req.params
    const { commodity_id, equipment_tag_ref } = req.body

    await db.query(
      `UPDATE po_lines SET commodity_id=?, equipment_tag_ref=? WHERE id=? AND po_id=?`,
      [commodity_id || null, equipment_tag_ref || null, lineId, poId]
    )
    const [[line]] = await db.query(
      `SELECT l.*, cm.name AS commodity_name, cm.trace_level
       FROM po_lines l LEFT JOIN commodity_library cm ON cm.id=l.commodity_id
       WHERE l.id=?`,
      [lineId]
    )
    res.json(line)
  } catch (e) {
    console.error(e)
    dbError(res, e)
  }
})

// ─── VDRL STATS ───────────────────────────────────────────────
// Summary counts for VDRL KPI strip on ExpeditingScreen.
router.get('/:projectId/vdrl/stats', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [[stats]] = await db.query(`
      SELECT
        COUNT(d.id) AS total_docs,
        SUM(CASE WHEN d.submitted_date IS NOT NULL THEN 1 ELSE 0 END) AS submitted_count,
        SUM(CASE WHEN d.status='Overdue' THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN d.abf_required=1 AND d.abf_cleared=1 THEN 1 ELSE 0 END) AS abf_cleared_count
      FROM vdrl_documents d
      JOIN vdrl_packages p ON p.id = d.package_id
      WHERE p.project_id = ?
    `, [pid])
    const total = stats.total_docs || 0
    const submitted = stats.submitted_count || 0
    res.json({
      total_docs: total,
      submitted_count: submitted,
      submitted_pct: total ? Math.round(submitted / total * 100) : 0,
      overdue_count: stats.overdue_count || 0,
      abf_cleared_count: stats.abf_cleared_count || 0,
      progress_pct: total ? Math.round(submitted / total * 100) : 0,
    })
  } catch (e) { dbError(res, e) }
})

// ─── VDRL PACKAGES LIST ───────────────────────────────────────
// All packages for a project with doc counts and PO info.
router.get('/:projectId/vdrl/packages', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [pkgs] = await db.query(`
      SELECT p.*, po.po_number, po.vendor_name,
        COUNT(d.id) AS doc_count,
        SUM(CASE WHEN d.submitted_date IS NOT NULL THEN 1 ELSE 0 END) AS submitted_count,
        SUM(CASE WHEN d.status='overdue' THEN 1 ELSE 0 END) AS overdue_count
      FROM vdrl_packages p
      LEFT JOIN purchase_orders po ON po.id = p.po_id
      LEFT JOIN vdrl_documents d ON d.package_id = p.id
      WHERE p.project_id = ?
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [pid])
    res.json(pkgs)
  } catch (e) { dbError(res, e) }
})

// ─── VDRL PACKAGE CREATE ──────────────────────────────────────
// Creates a new VDRL package for the given project.
router.post('/:projectId/vdrl/packages', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { name, po_id } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'Package name is required' })
    // Generate a simple package_ref from name
    const pkgRef = name.trim().replace(/[^a-zA-Z0-9]/g, '-').toUpperCase().slice(0, 20) + '-' + Date.now().toString().slice(-5)
    const [r] = await db.query(
      'INSERT INTO vdrl_packages (project_id, po_id, package_ref, name, status, created_by) VALUES (?,?,?,?,?,?)',
      [pid, po_id || null, pkgRef, name.trim(), 'active', req.user.id]
    )
    const [[pkg]] = await db.query('SELECT * FROM vdrl_packages WHERE id=?', [r.insertId])
    res.status(201).json(pkg)
  } catch (e) { dbError(res, e) }
})

// ─── VDRL DOCUMENTS LIST ──────────────────────────────────────
// Filterable list of VDRL documents for a project.
router.get('/:projectId/vdrl/documents', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { package_id, status, doc_type, discipline, search } = req.query

    let where = 'p.project_id = ?'
    const params = [pid]
    if (package_id) { where += ' AND d.package_id = ?'; params.push(package_id) }
    if (status)     { where += ' AND d.status = ?';     params.push(status) }
    if (doc_type)   { where += ' AND d.doc_type = ?';   params.push(doc_type) }
    if (discipline) { where += ' AND d.discipline = ?'; params.push(discipline) }
    if (search) {
      where += ' AND (d.doc_number LIKE ? OR d.title LIKE ?)';
      params.push(`%${search}%`, `%${search}%`)
    }

    const [docs] = await db.query(`
      SELECT d.*,
        p.name AS package_name,
        po.po_number, po.vendor_name,
        DATEDIFF(CURDATE(), d.required_date) AS days_overdue
      FROM vdrl_documents d
      JOIN vdrl_packages p ON p.id = d.package_id
      LEFT JOIN purchase_orders po ON po.id = p.po_id
      WHERE ${where}
      ORDER BY d.doc_number
    `, params)
    res.json(docs)
  } catch (e) { dbError(res, e) }
})

// ─── VDRL DOCUMENT CREATE ─────────────────────────────────────
// Adds a new document to a VDRL package.
router.post('/:projectId/vdrl/documents', async (req, res) => {
  try {
    const { package_id, doc_number, title, doc_type, discipline, revision,
            required_date, promised_date, notes, status } = req.body
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })
    if (!package_id)    return res.status(400).json({ error: 'Package is required' })
    const [r] = await db.query(
      `INSERT INTO vdrl_documents (package_id, doc_number, title, doc_type, discipline,
        revision, required_date, promised_date, status, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [package_id, doc_number || null, title.trim(), doc_type || null,
       discipline || null, revision || 'R0', required_date || null, promised_date || null,
       status || 'Not submitted', notes || null, req.user.id]
    )
    const [[doc]] = await db.query('SELECT * FROM vdrl_documents WHERE id=?', [r.insertId])
    res.status(201).json(doc)
  } catch (e) { dbError(res, e) }
})

// ─── VDRL DOCUMENT UPDATE ─────────────────────────────────────
// Partial update of a VDRL document's fields.
router.put('/:projectId/vdrl/documents/:docId', async (req, res) => {
  try {
    const docId = Number(req.params.docId)
    const fields = ['title','doc_type','discipline','revision','required_date','promised_date','submitted_date','status','abf_required','abf_cleared','notes','owner']
    const sets = [], vals = []
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]) }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' })
    vals.push(docId)
    await db.query(`UPDATE vdrl_documents SET ${sets.join(',')}, updated_at=NOW() WHERE id=?`, vals)
    const [[doc]] = await db.query('SELECT * FROM vdrl_documents WHERE id=?', [docId])
    res.json(doc)
  } catch (e) { dbError(res, e) }
})

// ─── VDRL DOCUMENT FILE ATTACH ────────────────────────────────
// Stores the ACTUAL deliverable file against a VDRL requirement row (until now
// VDRL rows were metadata only). Saved to disk under uploads/vdrl-documents; the
// Document Inbox then streams it via /api/documents/:pid/download/vdrl:<id>.
// Marks the document submitted so the register reflects the received deliverable.
const fsVdrl   = require('fs')
const pathVdrl = require('path')
const vdrlFileDir = pathVdrl.join(__dirname, '../uploads/vdrl-documents')
const uploadVdrlFile = require('multer')({
  storage: require('multer').diskStorage({
    destination: (_req, _file, cb) => { fsVdrl.mkdirSync(vdrlFileDir, { recursive: true }); cb(null, vdrlFileDir) },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_')}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: fileFilter('document'),
})
router.post('/:projectId/vdrl/documents/:docId/file', uploadVdrlFile.single('file'), async (req, res) => {
  try {
    const pid   = Number(req.params.projectId)
    const docId = Number(req.params.docId)
    if (!req.file) return res.status(400).json({ error: 'No file provided' })

    // Confirm the document belongs to this project before writing anything.
    const [[doc]] = await db.query(
      `SELECT d.id FROM vdrl_documents d JOIN vdrl_packages p ON p.id = d.package_id
       WHERE d.id=? AND p.project_id=?`, [docId, pid])
    if (!doc) { fsVdrl.unlinkSync(req.file.path); return res.status(404).json({ error: 'VDRL document not found in this project' }) }

    // Storage columns arrive via migrate-document-files.js — fail honestly (not a
    // 500) and discard the upload if the migration hasn't been applied yet.
    if (!(await require('../lib/schemaColumns').fileColumnsReady('vdrl_documents'))) {
      fsVdrl.unlinkSync(req.file.path)
      return res.status(503).json({ error: 'Document storage is not yet provisioned (pending DB migration)' })
    }

    const relPath = pathVdrl.relative(pathVdrl.join(__dirname, '..'), req.file.path)  // uploads/vdrl-documents/<stored>
    await db.query(
      `UPDATE vdrl_documents
         SET file_name=?, file_path=?, file_size=?, mime_type=?,
             status=CASE WHEN status IN ('Not submitted','Overdue') THEN 'Under review' ELSE status END,
             submitted_date=COALESCE(submitted_date, CURDATE()), updated_at=NOW()
       WHERE id=?`,
      [req.file.originalname, relPath, req.file.size, req.file.mimetype, docId])

    db.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, after_value, resource, ip)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, 'vdrl_file_attached', 'vdrl_document', docId, pid,
       JSON.stringify({ file: req.file.originalname }),
       (req.originalUrl || '').split('?')[0].replace(/^\/api(?=\/)/, ''), req.ip]
    ).catch(e => console.error('[expediting:vdrl-file audit]', e.message))

    const [[updated]] = await db.query('SELECT * FROM vdrl_documents WHERE id=?', [docId])
    res.status(201).json(updated)
  } catch (e) {
    if (req.file) { try { fsVdrl.unlinkSync(req.file.path) } catch (_) {} }
    dbError(res, e)
  }
})

// ─── ACTION LOG ───────────────────────────────────────────────
// Cross-PO action notes for all locked POs in a project.
router.get('/:projectId/action-log', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [notes] = await db.query(`
      SELECT n.id, n.po_id, n.note_text, n.created_at,
        po.po_number, po.vendor_name,
        u.full_name AS created_by_name, u.role AS created_by_role
      FROM po_action_notes n
      JOIN purchase_orders po ON po.id = n.po_id
      LEFT JOIN users u ON u.id = n.created_by
      WHERE po.project_id = ? AND po.is_locked = 1
      ORDER BY n.created_at DESC
      LIMIT 100
    `, [pid])
    res.json(notes)
  } catch (e) { dbError(res, e) }
})

// ─── PO AUDIT TRAIL ───────────────────────────────────────────
// Combined milestone forecast history + action notes for a PO.
router.get('/:projectId/po/:poId/audit', async (req, res) => {
  try {
    const poId = Number(req.params.poId)
    const [histRows] = await db.query(`
      SELECT h.id, h.entity_type, h.entity_id, h.field_name,
        h.old_value, h.new_value, h.reason, h.changed_at,
        u.full_name AS user_name,
        m.label AS milestone_label
      FROM expediting_forecast_history h
      LEFT JOIN users u ON u.id = h.changed_by
      LEFT JOIN po_milestones m ON m.id = h.entity_id AND h.entity_type = 'milestone'
      WHERE h.entity_id IN (
        SELECT id FROM po_milestones WHERE po_id = ?
      ) AND h.entity_type = 'milestone'
      ORDER BY h.changed_at DESC
    `, [poId])

    const [noteRows] = await db.query(`
      SELECT n.id, n.note_text, n.created_at,
        u.full_name AS user_name, u.role AS user_role
      FROM po_action_notes n
      LEFT JOIN users u ON u.id = n.created_by
      WHERE n.po_id = ?
      ORDER BY n.created_at DESC
    `, [poId])

    const combined = [
      ...histRows.map(h => ({
        id: `ms-${h.id}`, type: 'milestone_forecast',
        action: `Forecast updated: ${h.milestone_label}`,
        field: h.field_name, old_value: h.old_value, new_value: h.new_value,
        reason: h.reason, user_name: h.user_name, timestamp: h.changed_at,
      })),
      ...noteRows.map(n => ({
        id: `note-${n.id}`, type: 'note_added',
        action: 'Note added', field: null,
        old_value: null, new_value: n.note_text,
        reason: null, user_name: n.user_name, timestamp: n.created_at,
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    res.json(combined)
  } catch (e) { dbError(res, e) }
})

// ─── WAREHOUSES ───────────────────────────────────────────────
// Returns all warehouses for use in the SCN wizard destination selector.
router.get('/:projectId/warehouses', async (req, res) => {
  try {
    // Project-scoped: a project only sees warehouses it owns (warehouses.project_id).
    const [rows] = await db.query("SELECT id, name, code, type, CONCAT_WS(', ', city, state) AS location, manager, phone FROM warehouses WHERE project_id=? ORDER BY name", [Number(req.params.projectId)])
    res.json(rows)
  } catch (e) { dbError(res, e) }
})

// ─── CREATE SCN ───────────────────────────────────────────────
// Creates a Shipment Control Note, updates qty_assigned on selected lines,
// inserts any additional items not on the PO, and (Heat/Lot P1) records the
// shipment's declared heats. All writes run in one pooled transaction so a
// later insert failure never leaves a half-created SCN.
router.post('/:projectId/scn', async (req, res) => {
  const pid = Number(req.params.projectId)
  const {
    po_id, selected_lines = [], additional_items = [], variations = [],
    pickup_location, destination_warehouse_id, grid_bay,
    cdd, crd, ccd, etd, eta, transport_mode, forwarder_name, incoterms,
    packages = [], notify_forwarder,
    packed_by_type, packaging_delegated_to,   // ── Forwarder-delegated packaging (D3) ──
    heats = [],   // ── Heat/Lot P1: per-shipment declared heats (additive) ──
  } = req.body

  if (!po_id) return res.status(400).json({ error: 'po_id required' })

  // Per-PO access: only managers or an assigned expeditor can raise an SCN
  // against this PO (the PO id arrives in the body, so router.param can't gate it).
  if (!canSeeAllPOs(req.user?.role) && !(await isAssignedExpeditor(req.user?.id, po_id))) {
    return res.status(403).json({ error: 'This PO is not assigned to you.' })
  }

  // Logical date ordering: cargo ready → collected → departs → arrives.
  const dateErr = dateOrder([['CRD', crd], ['CCD', ccd], ['ETD', etd], ['ETA', eta]])
  if (dateErr) return res.status(400).json({ error: dateErr })

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // Generate SCN ref
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM shipment_control_notes')
    const scnRef = `SCN-${new Date().getFullYear()}-${String(n + 1).padStart(4, '0')}`

    // ── Forwarder-delegated packaging (D3): validate packed_by_type + delegate ──
    // Verdict computed by the pure resolveDelegation() (defined + exported below, so the
    // D3 proofs exercise THIS exact code). 'forwarder' delegates packing to a freight
    // forwarder (who gets scoped write access via the D2 carve-out) and needs a valid
    // ACTIVE freight_forwarder; 'vendor'/'internal' must NOT name a delegate.
    const deleg = await resolveDelegation(packed_by_type, packaging_delegated_to, conn)
    if (!deleg.ok) { await conn.rollback(); return res.status(deleg.status).json({ error: deleg.error }) }
    const { packedBy, delegateId, packagingStatus, forwarderUserId } = deleg

    // Insert SCN (delegation columns appended only when live — deploy-tolerant).
    const cols = ['scn_ref', 'po_id', 'project_id', 'origin_location', 'destination_warehouse_id',
      'cargo_ready_date', 'cargo_collection_date', 'etd', 'eta', 'mode', 'forwarder_name', 'incoterms', 'status', 'notes', 'created_by']
    const vals = [scnRef, po_id, pid, pickup_location || null, destination_warehouse_id || null,
      crd || null, ccd || null, etd || null, eta || null, transport_mode || null, forwarder_name || null,
      incoterms || null, 'draft', null, req.user.id]
    if (await scnDelegationColsLive()) {
      cols.push('forwarder_user_id', 'packed_by_type', 'packaging_delegated_to', 'packaging_status')
      vals.push(forwarderUserId, packedBy, delegateId, packagingStatus)
    } else if (packedBy === 'forwarder') {
      // Can't delegate without the columns live — fail clearly rather than silently dropping it.
      await conn.rollback(); return res.status(409).json({ error: 'Delegated packaging is unavailable until the delegation migration is applied.' })
    }
    const [r] = await conn.query(
      `INSERT INTO shipment_control_notes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`, vals)
    const scnId = r.insertId

    // Update po_lines qty_assigned for each selected line.
    // GUARD (Commit 1): row-lock the line (FOR UPDATE — concurrency-safe) and reject any
    // allocation that would push qty_assigned over qty. Reject = rollback the whole txn
    // (the SCN insert + any prior line updates), never a partial write.
    // ── Packing-contents (Stage 2): map each allocatable line's client line_ref to
    // the scn_lines row created for it, plus its SCN qty, so scn_package_lines can
    // reference them. PO lines use ref 'po:<po_line_id>' (derived); off-PO variations
    // use the client-supplied line_ref (their additional_item id doesn't exist yet). ──
    const refToScnLineId = {}   // line_ref → scn_lines.id
    const refToScnQty    = {}   // line_ref → that line's SCN qty (for D3 server-side cap)

    const assignments = [] // Commit 2: collect for the audit row
    for (const { po_line_id, qty_allocated, uom } of selected_lines) {
      const add = Number(qty_allocated) || 0
      const [[ln]] = await conn.query(
        'SELECT line_number, qty, uom, COALESCE(qty_assigned,0) AS qa FROM po_lines WHERE id = ? AND po_id = ? FOR UPDATE',
        [po_line_id, po_id]
      )
      if (!ln) { await conn.rollback(); return res.status(404).json({ error: `PO line ${po_line_id} not found on PO ${po_id}` }) }
      const remaining = Number(ln.qty) - Number(ln.qa)
      if (add > remaining) {
        await conn.rollback()
        return res.status(422).json({ error: `Cannot assign ${add} to line ${ln.line_number}: only ${remaining} remaining (qty ${ln.qty}, already assigned ${ln.qa}).` })
      }
      await conn.query(
        'UPDATE po_lines SET qty_assigned = COALESCE(qty_assigned,0) + ? WHERE id = ? AND po_id = ?',
        [add, po_line_id, po_id]
      )
      // Per-SCN line allocation (D4=(i)) — how much of this PO line is on THIS SCN.
      const [sl] = await conn.query(
        'INSERT INTO scn_lines (scn_id, po_line_id, qty, uom) VALUES (?,?,?,?)',
        [scnId, po_line_id, add, uom || ln.uom || null]
      )
      const ref = `po:${po_line_id}`
      refToScnLineId[ref] = sl.insertId
      refToScnQty[ref]    = add
      assignments.push({ po_line_id, line_number: ln.line_number, qty_allocated: add, new_qty_assigned: Number(ln.qa) + add })
    }

    // ── Off-PO variations (now in the SAME txn — retires the old 2-phase POST) ──
    // Each is a NEW item tied to a parent PO line (is_variation=1), then gets its own
    // scn_lines row so it's allocatable into packages. Validated against this project.
    // Q3: a child inherits its parent PO line's identity (commodity/tag) + WBS snapshot
    // at write (immutable). Blocked if the parent is unlinked or has no WBS. Gated on the
    // child-stock columns being live (pre-migration → old behaviour, no inherit/block).
    const childCols = await childStockColsLive()
    for (const v of variations) {
      const desc = (v.description || '').trim()
      const parentId = Number(v.parent_po_line_id) || null
      if (!desc) { await conn.rollback(); return res.status(422).json({ error: 'Each off-PO variation needs a description.' }) }
      if (!parentId) { await conn.rollback(); return res.status(422).json({ error: 'Each off-PO variation must name its parent PO line.' }) }
      // Fetch the parent line's identity + WBS snapshot (for the block guard + inheritance).
      const [[pl]] = await conn.query(
        'SELECT pl.id, pl.line_number, pl.commodity_id, pl.equipment_tag, pl.tag_number, pl.wbs_code_snapshot FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE pl.id=? AND p.project_id=?',
        [parentId, pid]
      )
      if (!pl) { await conn.rollback(); return res.status(404).json({ error: `Parent PO line ${parentId} not found in this project` }) }

      // ── BLOCK-ON-UNLINKED (Q3, only when child-stock is live) ──
      // A child must inherit a real identity + WBS to become tracked stock, so the
      // parent must be linked (commodity/tag) AND have a WBS. Name the missing field.
      if (childCols) {
        const linked = pl.commodity_id != null || (pl.equipment_tag || '').trim() || (pl.tag_number || '').trim()
        if (!linked) {
          await conn.rollback()
          return res.status(422).json({ error: `Cannot add off-PO item under line ${pl.line_number}: that line has no commodity/tag link — link a commodity or equipment tag to it first.` })
        }
        if (!(pl.wbs_code_snapshot || '').trim()) {
          await conn.rollback()
          return res.status(422).json({ error: `Cannot add off-PO item under line ${pl.line_number}: that line has no WBS — set its WBS first.` })
        }
      }

      const vqty = Number(v.qty) || 0
      const rosDate = (v.ros_date || '').trim() || null   // user-supplied, NOT inherited
      const [ai] = childCols
        ? await conn.query(
            `INSERT INTO scn_additional_items
               (scn_id, parent_po_line_id, is_variation, description, qty, uom, notes, created_by,
                commodity_id, equipment_tag, tag_number, wbs_code_snapshot, ros_date)
             VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?)`,
            [scnId, parentId, desc, vqty || null, v.uom || 'EA', v.notes || null, req.user.id,
             pl.commodity_id ?? null, pl.equipment_tag ?? null, pl.tag_number ?? null, pl.wbs_code_snapshot ?? null, rosDate])
        : await conn.query(
            `INSERT INTO scn_additional_items (scn_id, parent_po_line_id, is_variation, description, qty, uom, notes, created_by)
             VALUES (?,?,1,?,?,?,?,?)`,
            [scnId, parentId, desc, vqty || null, v.uom || 'EA', v.notes || null, req.user.id])
      const [sl] = await conn.query(
        'INSERT INTO scn_lines (scn_id, additional_item_id, qty, uom) VALUES (?,?,?,?)',
        [scnId, ai.insertId, vqty, v.uom || 'EA']
      )
      if (v.line_ref) { refToScnLineId[v.line_ref] = sl.insertId; refToScnQty[v.line_ref] = vqty }
    }

    // Legacy unlinked additional items (back-compat — no line_ref / not allocatable).
    for (const item of additional_items) {
      if (!item.description?.trim()) continue
      await conn.query(
        'INSERT INTO scn_additional_items (scn_id, description, qty, uom, created_by) VALUES (?,?,?,?,?)',
        [scnId, item.description.trim(), item.qty || null, item.uom || 'EA', req.user.id]
      )
    }

    // ── Heat/Lot P1: record the shipment's declared heats (additive) ──
    // Optional — an empty list is fine (heats may be unknown at SCN creation).
    // The receipting dropdown (P2) reads these scoped by scn_id. source='declared'.
    for (const h of heats) {
      const heatNo = (h.heat_number || '').trim()
      if (!heatNo) continue
      await conn.query(
        `INSERT INTO scn_heats (scn_id, heat_number, material_grade, mill_cert_ref, source, po_line_id, created_by)
         VALUES (?,?,?,?,'declared',?,?)`,
        [scnId, heatNo,
         (h.material_grade || '').trim() || null,
         (h.mill_cert_ref || '').trim() || null,
         h.po_line_id || null, req.user.id]
      )
    }

    // ── Persist packages declared in the wizard (one row per physical package) ──
    // Previously the wizard collected packages but the create endpoint dropped them,
    // so the Logistics Packages tab showed nothing. scn_packages has no qty column,
    // so a "qty N" line is expanded into N numbered package rows.
    const num = v => (v == null || v === '') ? null : Number(v)
    let pkgNum = 0, contentRows = 0
    const allocated = {}   // line_ref → running total packed across all packages (D3 cap)
    // Q2 hierarchy: a package may carry a client `ref` and a `parent_ref` (the ref of
    // its container). parent_package_id is persisted ONLY when parent_ref is present —
    // so flat payloads never touch the new column (deploy-safe pre-migration).
    const insertPkg = async (p, n, parentId) => {
      const cols = ['scn_id', 'package_number', 'description', 'length_mm', 'width_mm', 'height_mm', 'gross_weight_kg', 'is_dangerous_goods']
      const vals = [scnId, String(n).padStart(2, '0'), (p.type || '').trim() || null,
        num(p.length), num(p.width), num(p.height), num(p.weight), p.is_dg ? 1 : 0]
      if (parentId != null) { cols.push('parent_package_id'); vals.push(parentId) }   // ⚠ needs the migration applied
      // Q4: persist the container type when declared. Value-gated like parent_package_id
      // so flat/Q2 payloads never touch the new column (deploy-safe pre migrate-containers).
      if (p.container_type_id != null && p.container_type_id !== '') { cols.push('container_type_id'); vals.push(Number(p.container_type_id)) }
      // D5.1: optional container_no at creation (plain, value-gated).
      if (p.container_no != null && String(p.container_no).trim() !== '') { cols.push('container_no'); vals.push(String(p.container_no).trim()) }
      const [pr] = await conn.query(
        `INSERT INTO scn_packages (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`, vals)
      const packageId = pr.insertId
      // D5.1: optional seal_no at creation → routes through the SAME governance as the
      // post-creation paths (setSealNo: set-once, reasoned, atomic audit; container-only
      // enforced inside). In-txn → a seal/audit failure rolls back the whole SCN create.
      if (p.seal_no != null && String(p.seal_no).trim() !== '') {
        await setSealNo(conn, { packageId, scnId, newSeal: p.seal_no, reason: p.seal_reason,
          userId: req.user.id, resource: (req.originalUrl || '').split('?')[0].replace(/^\/api(?=\/)/, ''), ip: req.ip, projectId: pid })
      }
      return packageId
    }

    // ── HIERARCHY RULES (Q2 leaf-only EXTENDED to Q4 three-level typed) — payload-level,
    //    the create txn is the ONLY write path into scn_packages/scn_package_lines
    //    (census-confirmed), so this is complete. The verdict is computed by the pure
    //    validatePackageHierarchy() (defined + exported below); a reject rolls back BEFORE
    //    any insert, so the reject path never touches parent_package_id/container_type_id. ──
    const hierarchyVerdict = validatePackageHierarchy(packages)
    if (!hierarchyVerdict.ok) {
      await conn.rollback()
      return res.status(422).json({ error: hierarchyVerdict.error })
    }

    // ── Persist packages. Contract: parents appear BEFORE their children in the payload
    //    (so parent ids resolve single-pass); the wizard guarantees this ordering. ──
    const refToPkgId = {}   // client ref → inserted scn_packages.id
    for (const p of (packages || [])) {
      const parentRef = (p.parent_ref != null && p.parent_ref !== '') ? String(p.parent_ref) : null
      if (parentRef && refToPkgId[parentRef] === undefined) {
        await conn.rollback()
        return res.status(422).json({ error: `Package parent "${parentRef}" must be listed before its sub-packages.` })
      }
      const parentId = parentRef ? refToPkgId[parentRef] : null
      const contents = (p.contents || []).filter(c => c && c.line_ref && Number(c.qty) > 0)
      if (contents.length) {
        // Itemized package (a leaf) = ONE physical box; record its contents.
        pkgNum++
        const packageId = await insertPkg(p, pkgNum, parentId)
        if (p.ref != null) refToPkgId[String(p.ref)] = packageId
        for (const c of contents) {
          const ref = c.line_ref
          const scnLineId = refToScnLineId[ref]
          if (!scnLineId) { await conn.rollback(); return res.status(422).json({ error: `Package contents reference an unknown line (${ref}).` }) }
          const q = Number(c.qty)
          allocated[ref] = (allocated[ref] || 0) + q
          if (allocated[ref] > Number(refToScnQty[ref]) + 1e-9) {  // D3: never pack more than the line's SCN qty
            await conn.rollback()
            return res.status(422).json({ error: `Allocated ${allocated[ref]} of line ${ref} exceeds its SCN qty ${refToScnQty[ref]}.` })
          }
          await conn.query(
            'INSERT INTO scn_package_lines (package_id, scn_line_id, qty, uom) VALUES (?,?,?,?)',
            [packageId, scnLineId, q, c.uom || null])
          contentRows++
        }
      } else if (p.ref != null || parentId != null) {
        // A container or an empty leaf that participates in the hierarchy → ONE row.
        pkgNum++
        const id = await insertPkg(p, pkgNum, parentId)
        if (p.ref != null) refToPkgId[String(p.ref)] = id
      } else {
        // Non-itemized flat package: a "qty N" row expands into N numbered rows (legacy).
        const count = Math.min(500, Math.max(1, Math.floor(Number(p.qty) || 1)))
        for (let k = 0; k < count; k++) { pkgNum++; await insertPkg(p, pkgNum, null) }
      }
    }
    if (pkgNum > 0) {
      await conn.query(
        `UPDATE shipment_control_notes SET
           total_packages  = (SELECT COUNT(*) FROM scn_packages WHERE scn_id=?),
           total_weight_kg = (SELECT COALESCE(SUM(gross_weight_kg),0) FROM scn_packages WHERE scn_id=?)
         WHERE id = ?`, [scnId, scnId, scnId])
    }

    // Seed the SCN's Timeline with its creation event: an scn_status_log row matching the
    // shape the Logistics status route writes (scn_id, from_status, to_status, changed_by,
    // notes). 'pending_pickup' is the display status of a freshly-created 'draft' SCN — so
    // the Timeline starts at creation instead of being empty until a later status/date edit.
    // In-txn (a committed SCN always carries its creation event) but NON-FATAL — a failure
    // here must not break SCN creation (mirrors the robustness of the create's direct inserts).
    try {
      await conn.query(
        `INSERT INTO scn_status_log (scn_id, from_status, to_status, changed_by, notes)
         VALUES (?,?,?,?,?)`,
        [scnId, null, 'pending_pickup', req.user.id, 'SCN created'])
    } catch (e) { console.error('[scn:create] timeline seed (non-fatal):', e.message) }

    // Commit 2: project-scoped audit of the SCN creation + line assignments (in-txn).
    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, after_value, resource, ip)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, 'scn_created', 'scn', scnId, pid,
       JSON.stringify({ scn_ref: scnRef, po_id, assignments, variations: (variations || []).length, additional_items: (additional_items || []).length, packages: pkgNum, package_contents: contentRows }),
       (req.originalUrl || '').split('?')[0].replace(/^\/api(?=\/)/, ''), req.ip]
    )

    await conn.commit()
    res.status(201).json({ id: scnId, scn_ref: scnRef, status: 'draft' })
  } catch (e) {
    await conn.rollback()
    if (e instanceof SealGovernanceError) return res.status(e.status).json({ error: e.message })   // D5.1: governed seal reject → clean 4xx
    console.error('[scn:create]', e.message)
    dbError(res, e)
  } finally {
    conn.release()
  }
})

// ─── OFF-PO VARIATION (Commit 3) ──────────────────────────────
// Records an off-PO item (e.g. a specialised crate) as a NEW line tied to a parent
// PO line + description, flagged is_variation=1. Required link (parent_po_line_id).
// Does NOT touch the parent line's qty_assigned/totals (off-PO never rolls into the PO).
router.post('/:projectId/scn/:scnId/variation', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const scnId = Number(req.params.scnId)
    const { parent_po_line_id, description, qty, uom, notes } = req.body
    if (!parent_po_line_id) return res.status(422).json({ error: 'parent_po_line_id is required — every off-PO variation must name its parent PO line' })
    if (!description || !description.trim()) return res.status(422).json({ error: 'description is required' })
    // validate the SCN + parent line belong to this project
    const [[scn]] = await db.query('SELECT id FROM shipment_control_notes WHERE id=? AND project_id=?', [scnId, pid])
    if (!scn) return res.status(404).json({ error: 'SCN not found in this project' })
    const [[pl]] = await db.query(
      'SELECT pl.id FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE pl.id=? AND p.project_id=?',
      [Number(parent_po_line_id), pid]
    )
    if (!pl) return res.status(404).json({ error: 'parent PO line not found in this project' })
    const [r] = await db.query(
      `INSERT INTO scn_additional_items (scn_id, parent_po_line_id, is_variation, description, qty, uom, notes, created_by)
       VALUES (?,?,1,?,?,?,?,?)`,
      [scnId, Number(parent_po_line_id), description.trim(), qty || null, uom || 'EA', notes || null, req.user.id]
    )
    // project-scoped audit (does NOT modify the parent po_line)
    db.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, after_value, resource, ip)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, 'scn_variation_added', 'scn_additional_item', r.insertId, pid,
       JSON.stringify({ scn_id: scnId, parent_po_line_id: Number(parent_po_line_id), description: description.trim(), is_variation: 1 }),
       (req.originalUrl || '').split('?')[0].replace(/^\/api(?=\/)/, ''), req.ip]
    ).catch(e => console.error('[audit] insert failed:', e.message))
    res.status(201).json({ id: r.insertId, scn_id: scnId, parent_po_line_id: Number(parent_po_line_id), is_variation: 1 })
  } catch (e) {
    console.error('[scn:variation]', e.message)
    dbError(res, e)
  }
})

// ─── EDIT CONTAINER IDENTIFIERS (container_no / seal_no) — Q4.3 ────────────────
// Both Expediting and Logistics can set a container's number/seal. seal_no is GOVERNED
// (set-once + reasoned, audited re-seal — atomic) via the SHARED lib/sealGovernance so
// the two modules cannot drift; container_no is free-edit. The whole edit runs in ONE
// transaction so the seal change and its audit row commit/rollback together.
// Body: { container_no?, seal_no?, seal_reason? }. seal_reason is required only when
// CHANGING an existing seal (enforced inside setSealNo).
router.put('/:projectId/scn/:scnId/packages/:packageId/identifiers', async (req, res) => {
  const pid = Number(req.params.projectId)
  const scnId = Number(req.params.scnId)
  const packageId = Number(req.params.packageId)
  const { container_no, seal_no, seal_reason } = req.body
  const resource = (req.originalUrl || '').split('?')[0].replace(/^\/api(?=\/)/, '')
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    // Package must belong to an SCN in THIS project (project-scope check the shared lib
    // can't do). The container-only rule is enforced inside setSealNo/setContainerNo
    // (the single governance point), so it isn't duplicated here.
    const [[pkg]] = await conn.query(
      `SELECT sp.id FROM scn_packages sp
       JOIN shipment_control_notes s ON s.id = sp.scn_id
       WHERE sp.id=? AND sp.scn_id=? AND s.project_id=?`, [packageId, scnId, pid])
    if (!pkg) { await conn.rollback(); return res.status(404).json({ error: 'Container not found on this SCN in this project.' }) }

    const out = {}
    if (container_no !== undefined) out.container_no = await setContainerNo(conn, { packageId, scnId, newContainerNo: container_no, userId: req.user.id, resource, ip: req.ip, projectId: pid })
    if (seal_no !== undefined)      out.seal_no      = await setSealNo(conn,      { packageId, scnId, newSeal: seal_no, reason: seal_reason, userId: req.user.id, resource, ip: req.ip, projectId: pid })

    await conn.commit()
    const [[fresh]] = await db.query('SELECT id, container_no, seal_no FROM scn_packages WHERE id=?', [packageId])
    res.json({ ...fresh, result: out })
  } catch (e) {
    await conn.rollback()
    if (e instanceof SealGovernanceError) return res.status(e.status).json({ error: e.message })
    console.error('[scn:identifiers]', e.message)
    dbError(res, e)
  } finally { conn.release() }
})

// ─── VDRL PO LIST ─────────────────────────────────────────────
// Returns locked POs that have VDRL packages, with doc counts and progress.
router.get('/:projectId/vdrl/po-list', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [rows] = await db.query(`
      SELECT
        po.id, po.po_number, po.po_name, po.vendor_name,
        COUNT(DISTINCT pkg.id) AS package_count,
        COUNT(d.id) AS total_docs,
        SUM(CASE WHEN d.status IN ('approved','submitted') THEN 1 ELSE 0 END) AS submitted_count,
        SUM(CASE WHEN d.required_date IS NOT NULL AND d.required_date < CURDATE()
                  AND d.status NOT IN ('approved','submitted') THEN 1 ELSE 0 END) AS overdue_count
      FROM purchase_orders po
      JOIN vdrl_packages pkg ON pkg.po_id = po.id AND pkg.project_id = ?
      LEFT JOIN vdrl_documents d ON d.package_id = pkg.id
      WHERE po.project_id = ? AND po.is_locked = 1
      GROUP BY po.id
      ORDER BY po.po_number
    `, [pid, pid])
    // ─── CAST NUMERIC FIELDS ──────────────────────────────────────
    // MySQL node driver returns COUNT/SUM columns as strings; cast to
    // numbers here so the frontend reduce() sums correctly.
    const cast = rows.map(r => ({
      ...r,
      package_count:   parseInt(r.package_count)   || 0,
      total_docs:      parseInt(r.total_docs)       || 0,
      submitted_count: parseInt(r.submitted_count)  || 0,
      overdue_count:   parseInt(r.overdue_count)    || 0,
      progress_pct:    r.total_docs > 0
        ? Math.round((parseInt(r.submitted_count) || 0) / (parseInt(r.total_docs) || 1) * 100)
        : 0,
    }))
    res.json(cast)
  } catch (e) { console.error(e); dbError(res, e) }
})

// ─── VDRL TEMPLATE DOWNLOAD ───────────────────────────────────
// Generates and streams a formatted .xlsx upload template.
router.get('/:projectId/vdrl/template', async (req, res) => {
  try {
    const ExcelJS = require('exceljs')
    const wb = new ExcelJS.Workbook()
    wb.creator = 'QCO MMS'

    // Sheet 1: VDRL Documents
    const ws = wb.addWorksheet('VDRL Documents', { views: [{ state: 'frozen', ySplit: 2 }] })
    ws.columns = [
      { key: 'po_reference',    width: 18 }, { key: 'package_name',   width: 30 },
      { key: 'doc_number',      width: 18 }, { key: 'document_title', width: 40 },
      { key: 'document_type',   width: 18 }, { key: 'revision',       width: 10 },
      { key: 'required_date',   width: 20 }, { key: 'promised_date',  width: 20 },
      { key: 'abf_required',    width: 15 }, { key: 'discipline',     width: 20 },
      { key: 'owner',           width: 20 }, { key: 'notes',          width: 40 },
    ]

    // Row 1: orange title banner
    ws.mergeCells('A1:L1')
    const titleCell = ws.getCell('A1')
    titleCell.value = 'QCO MMS — VDRL Document Upload Template'
    titleCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14, name: 'Calibri' }
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE84E0F' } }
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' }
    ws.getRow(1).height = 28

    // Row 2: column headers (dark blue bg)
    const headers = ['PO Reference','Package Name','Doc Number','Document Title','Document Type','Revision','Required Date (dd/mm/yyyy)','Promised Date (dd/mm/yyyy)','ABF Required (Y/N)','Discipline','Owner','Notes']
    const hRow = ws.getRow(2)
    headers.forEach((h, i) => {
      const c = hRow.getCell(i + 1)
      c.value = h
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } }
      c.alignment = { vertical: 'middle', horizontal: 'left' }
      c.border = { bottom: { style: 'thin', color: { argb: 'FF334155' } } }
    })
    hRow.height = 20

    // Helper: grey italic style for example rows
    function exStyle(cell) {
      cell.font = { italic: true, color: { argb: 'FF94a3b8' }, size: 10, name: 'Calibri' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F8F8' } }
    }

    // Rows 3-5: example rows
    const examples = [
      ['PO-2024-001','Control Valve VDRL Package','CV-MDRA-001','Mechanical Data Book','Data Book','R0','30/06/2025','15/06/2025','Y','Instrumentation','J. Smith','Required before shipment'],
      ['PO-2024-001','Control Valve VDRL Package','CV-DWG-001','GA Drawing','Drawing','R1','15/07/2025','01/07/2025','N','Mechanical','',''],
      ['PO-2024-002','Structural Steel VDRL Package','SS-CERT-001','Mill Test Reports','Certificate','R0','14/06/2025','','Y','Structural','',''],
    ]
    examples.forEach((ex, i) => {
      const row = ws.getRow(3 + i)
      ex.forEach((val, j) => { const c = row.getCell(j + 1); c.value = val; exStyle(c) })
      row.height = 18
    })

    // Rows 6-25: blank data rows
    for (let r = 6; r <= 25; r++) ws.getRow(r).height = 18

    // ─── DROPDOWN VALIDATIONS (rows 3–500, showErrorMessage: false = guide only) ─
    // col E (5) — Document Type (applies from example rows through data rows)
    ws.dataValidations.add('E3:E500', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"Drawing,Datasheet,Certificate,Report,ITP,Manual,Procedure,Specification,Other"'],
    })
    // col I (9) — ABF Required (Yes/No)
    ws.dataValidations.add('I3:I500', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"Yes,No"'],
    })

    // ── Reference sheet (valid values legend) ─────────────────────────────────
    const wsRef = wb.addWorksheet('Reference')
    wsRef.getColumn(1).width = 28
    wsRef.getColumn(2).width = 70
    const refTitleCell = wsRef.getCell('A1')
    refTitleCell.value = 'QCO MMS — VDRL Template: Valid Values Reference'
    refTitleCell.font = { bold: true, size: 12, color: { argb: 'FFE84E0F' } }
    wsRef.getRow(1).height = 22
    wsRef.addRow([])
    wsRef.addRow(['Note: These values are suggestions. You may type any value not in this list.'])
      .getCell(1).font = { italic: true, color: { argb: 'FF64748b' }, size: 10 }
    wsRef.addRow([])
    const refRows = [
      ['COLUMN', 'VALID VALUES'],
      ['Document Type (col E)', 'Drawing, Datasheet, Certificate, Report, ITP, Manual, Procedure, Specification, Other'],
      ['ABF Required (col I)',  'Yes, No'],
    ]
    refRows.forEach((row, i) => {
      const r = wsRef.addRow(row)
      if (i === 0) r.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } } })
    })

    // Sheet 3: Instructions
    const ws2 = wb.addWorksheet('Instructions')
    ws2.getColumn(1).width = 80
    const instrLines = [
      ['QCO MMS — VDRL Template Instructions', true, 'FFE84E0F', 13],
      ['', false, null, 10],
      ['HOW TO USE', true, 'FF1e3a5f', 11],
      ['1. Do not change column headers in row 2.', false, null, 10],
      ['2. Delete the 3 grey example rows (rows 3-5) before uploading.', false, null, 10],
      ['3. PO Reference must match an existing approved PO in the system.', false, null, 10],
      ['4. Package Name: if a package exists for that PO, docs are added to it; otherwise a new package is created.', false, null, 10],
      ['5. Doc Number must be unique per package.', false, null, 10],
      ['6. Required Date / Promised Date format: dd/mm/yyyy (e.g. 30/06/2025).', false, null, 10],
      ['7. ABF Required: Yes = document must be AFC before construction proceeds; No = not an ABF gate document.', false, null, 10],
      ['8. Save as .xlsx before uploading.', false, null, 10],
    ]
    instrLines.forEach(([text, bold, color, size], i) => {
      const c = ws2.getCell(i + 1, 1)
      c.value = text
      c.font = { bold, size, name: 'Calibri', color: color ? { argb: color } : { argb: 'FF0f172a' } }
      c.alignment = { wrapText: true }
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="QCO_VDRL_Template.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (e) { console.error(e); dbError(res, e) }
})

// ─── VDRL UPLOAD ──────────────────────────────────────────────
// Parses an uploaded .xlsx file and imports VDRL documents.
// Supports ?dryRun=true for preview without writing to DB.
const uploadVDRL = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter('spreadsheet'),
})

router.post('/:projectId/vdrl/upload', uploadVDRL.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })
  const pid = Number(req.params.projectId)
  const dryRun = req.query.dryRun === 'true'

  try {
    const XLSX_LIB = require('xlsx')
    const wb = XLSX_LIB.read(req.file.buffer, { type: 'buffer', cellDates: true })
    const sheetName = wb.SheetNames.includes('VDRL Documents') ? 'VDRL Documents' : wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const rawRows = XLSX_LIB.utils.sheet_to_json(ws, { defval: null })

    function norm(k) { return k.trim().toLowerCase().replace(/\s+/g, '_') }

    const results = []
    let created = 0, skipped = 0

    for (const [idx, rawRow] of rawRows.entries()) {
      const row = {}
      for (const [k, v] of Object.entries(rawRow)) row[norm(k)] = v

      const rowNum = idx + 3 // offset for header rows
      const poRef  = String(row.po_reference || '').trim()
      const pkgName = String(row.package_name || row.package || '').trim()
      const docNum = String(row.doc_number || '').trim()
      const title  = String(row.document_title || row.title || '').trim()
      const docType = String(row.document_type || '').trim()

      // Skip example rows
      if (['CV-MDRA-001', 'CV-DWG-001', 'SS-CERT-001'].includes(docNum)) {
        results.push({ row: rowNum, status: 'skip', message: 'Example row skipped', poRef, docNum })
        skipped++; continue
      }

      // Skip blank rows
      if (!poRef && !docNum && !title) { skipped++; continue }

      // Validate PO reference
      if (!poRef) { results.push({ row: rowNum, status: 'error', message: 'PO Reference is required', poRef, docNum }); continue }
      const [[po]] = await db.query(
        'SELECT id, po_name, vendor_name FROM purchase_orders WHERE po_number=? AND project_id=? AND is_locked=1',
        [poRef, pid]
      )
      if (!po) { results.push({ row: rowNum, status: 'error', message: `PO ${poRef} not found or not approved`, poRef, docNum }); continue }

      if (!title) { results.push({ row: rowNum, status: 'error', message: 'Document Title is required', poRef, docNum }); continue }

      if (!dryRun) {
        // Lookup or create package for this PO
        const finalPkgName = pkgName || `${po.po_name || poRef} VDRL Package`
        let [[pkg]] = await db.query('SELECT id FROM vdrl_packages WHERE po_id=? AND project_id=?', [po.id, pid])
        if (!pkg) {
          const [r] = await db.query(
            'INSERT INTO vdrl_packages (project_id, po_id, name, status, created_by) VALUES (?,?,?,?,?)',
            [pid, po.id, finalPkgName, 'active', req.user.id]
          )
          pkg = { id: r.insertId }
        }

        // Check for duplicate doc_number within this package
        if (docNum) {
          const [[dup]] = await db.query('SELECT id FROM vdrl_documents WHERE package_id=? AND doc_number=?', [pkg.id, docNum])
          if (dup) {
            results.push({ row: rowNum, status: 'skip', message: `Doc number ${docNum} already exists in this package`, poRef, docNum })
            skipped++; continue
          }
        }

        // Parse dd/mm/yyyy or ISO dates
        const parseDate = (v) => {
          if (!v) return null
          if (v instanceof Date) return v.toISOString().slice(0, 10)
          const s = String(v).trim()
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}` }
          const p = new Date(s); return isNaN(p.getTime()) ? null : p.toISOString().slice(0, 10)
        }
        const abfReq = ['y', 'yes', '1'].includes(String(row.abf_required || '').toLowerCase()) ? 1 : 0

        await db.query(
          `INSERT INTO vdrl_documents
            (package_id, doc_number, title, doc_type, discipline, revision,
             required_date, promised_date, status, abf_required, notes, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [pkg.id, docNum || null, title, docType || null,
           row.discipline || null, row.revision || 'R0',
           parseDate(row.required_date), parseDate(row.promised_date),
           'Not submitted', abfReq, row.notes || null, req.user.id]
        )
        created++
      }

      results.push({ row: rowNum, status: 'ok', message: 'Ready to import', poRef, docNum, title, docType })
    }

    const hasErrors = results.some(r => r.status === 'error')
    res.json({
      total: rawRows.length,
      created: dryRun ? 0 : created,
      skipped,
      errors: results.filter(r => r.status === 'error'),
      preview: results.slice(0, 15),
      hasErrors,
      dryRun,
    })
  } catch (e) { console.error(e); dbError(res, e) }
})

// ─── ITP CRUD ─────────────────────────────────────────────────
// Full CRUD on itp_requirements (used as PO-level ITP items).
// NOTE: itp_requirements.inspection_type enum uses 'hold_point','witness',
// 'review','document' — these map to the UI labels Hold/Witness/Review/Info.

// GET /:projectId/po/:poId/itp — list all ITP items for a PO
router.get('/:projectId/po/:poId/itp', async (req, res) => {
  try {
    const poId = Number(req.params.poId)
    const [items] = await db.query(
      `SELECT r.*, pl.description AS line_description,
              (SELECT COUNT(*) FROM date_change_log dcl
               WHERE dcl.entity_type='itp_item' AND dcl.entity_id=r.id AND dcl.field_name='forecast_date') AS forecast_changed_count
       FROM itp_requirements r
       LEFT JOIN po_lines pl ON r.po_line_id = pl.id
       WHERE r.po_id = ? AND (r.is_deleted IS NULL OR r.is_deleted = 0)
       ORDER BY r.item_number ASC`,
      [poId]
    )
    res.json({ items })
  } catch (e) {
    console.error('[itp:list]', e.message)
    dbError(res, e)
  }
})

// POST /:projectId/po/:poId/itp — create a new ITP item
router.post('/:projectId/po/:poId/itp', async (req, res) => {
  try {
    const poId = Number(req.params.poId)
    const { description, inspection_type, po_line_id, planned_date, forecast_date,
            timing, witness_required, certificate_required, notes } = req.body

    if (!description || !description.trim()) return res.status(400).json({ error: 'Description is required' })
    if (!inspection_type) return res.status(400).json({ error: 'Inspection type is required' })
    if (!timing) return res.status(400).json({ error: 'Timing is required' })

    // item_number = MAX + 1 for this po_id, or 1 if none
    const [[{ maxNum }]] = await db.query(
      'SELECT COALESCE(MAX(item_number),0) AS maxNum FROM itp_requirements WHERE po_id=? AND (is_deleted IS NULL OR is_deleted=0)',
      [poId]
    )
    const itemNumber = (parseInt(maxNum) || 0) + 1

    const userId = req.user?.id || 1
    const [result] = await db.query(
      `INSERT INTO itp_requirements
        (po_id, item_number, description, inspection_type, timing, witness_required, certificate_required,
         planned_date, forecast_date, po_line_id, notes, status, is_deleted, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'not_started',0,?)`,
      [poId, itemNumber, description.trim(), inspection_type,
       timing, witness_required ? 1 : 0, certificate_required ? 1 : 0,
       planned_date || null, forecast_date || null,
       po_line_id || null, notes || null, userId]
    )
    // Audit log
    await db.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, after_value, resource)
       VALUES (?,?,?,?,?,?,?)`,
      [userId, 'create', 'itp_requirement', result.insertId, Number(req.params.projectId) || null,
       JSON.stringify({ description, inspection_type, timing }),
       `/expediting/${req.params.projectId}/po/${poId}/itp`]
    ).catch(() => {}) // audit failure is non-blocking

    const [[newItem]] = await db.query(
      `SELECT r.*, pl.description AS line_description
       FROM itp_requirements r
       LEFT JOIN po_lines pl ON r.po_line_id = pl.id
       WHERE r.id = ?`,
      [result.insertId]
    )
    res.status(201).json(newItem)
  } catch (e) {
    console.error('[itp:create]', e.message)
    dbError(res, e)
  }
})

// PUT /:projectId/po/:poId/itp/:itemId — update an ITP item
router.put('/:projectId/po/:poId/itp/:itemId', async (req, res) => {
  try {
    const { poId, itemId } = req.params
    const [[existing]] = await db.query(
      'SELECT * FROM itp_requirements WHERE id=? AND po_id=?',
      [itemId, poId]
    )
    if (!existing) return res.status(404).json({ error: 'ITP item not found' })

    const {
      description, inspection_type, po_line_id, planned_date, forecast_date,
      timing, witness_required, certificate_required, notes,
      status, completion_date, completion_notes, forecast_reason,
    } = req.body

    // If forecast_date is changing, require a reason
    const forecastChanging = forecast_date !== undefined && forecast_date !== existing.forecast_date
    if (forecastChanging && (!forecast_reason || !forecast_reason.trim())) {
      return res.status(400).json({ error: 'A reason is required when changing the forecast date' })
    }

    const userId = req.user?.id || 1

    await db.query(
      `UPDATE itp_requirements SET
         description       = COALESCE(?, description),
         inspection_type   = COALESCE(?, inspection_type),
         timing            = COALESCE(?, timing),
         witness_required  = COALESCE(?, witness_required),
         certificate_required = COALESCE(?, certificate_required),
         planned_date      = ?,
         forecast_date     = ?,
         po_line_id        = ?,
         notes             = ?,
         status            = COALESCE(?, status),
         completion_date   = ?,
         completion_notes  = ?
       WHERE id = ?`,
      [
        description ? description.trim() : null,
        inspection_type || null,
        timing || null,
        witness_required !== undefined ? (witness_required ? 1 : 0) : null,
        certificate_required !== undefined ? (certificate_required ? 1 : 0) : null,
        planned_date !== undefined ? (planned_date || null) : existing.planned_date,
        forecast_date !== undefined ? (forecast_date || null) : existing.forecast_date,
        po_line_id !== undefined ? (po_line_id || null) : existing.po_line_id,
        notes !== undefined ? (notes || null) : existing.notes,
        status || null,
        completion_date !== undefined ? (completion_date || null) : existing.completion_date,
        completion_notes !== undefined ? (completion_notes || null) : existing.completion_notes,
        itemId,
      ]
    )

    // Record forecast date change
    if (forecastChanging) {
      await db.query(
        `INSERT INTO date_change_log (entity_type, entity_id, field_name, old_value, new_value, change_reason, created_by)
         VALUES ('itp_item', ?, 'forecast_date', ?, ?, ?, ?)`,
        [itemId, existing.forecast_date || null, forecast_date || null, forecast_reason.trim(), userId]
      ).catch(() => {})
    }

    // Audit log
    await db.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, before_value, after_value, resource)
       VALUES (?,?,?,?,?,?,?,?)`,
      [userId, 'update', 'itp_requirement', itemId, Number(req.params.projectId) || null,
       JSON.stringify({ description: existing.description, status: existing.status }),
       JSON.stringify({ description, status }),
       `/expediting/${req.params.projectId}/po/${poId}/itp/${itemId}`]
    ).catch(() => {})

    const [[updated]] = await db.query(
      `SELECT r.*, pl.description AS line_description
       FROM itp_requirements r
       LEFT JOIN po_lines pl ON r.po_line_id = pl.id
       WHERE r.id = ?`,
      [itemId]
    )
    res.json({ success: true, item: updated })
  } catch (e) {
    console.error('[itp:update]', e.message)
    dbError(res, e)
  }
})

// DELETE /:projectId/po/:poId/itp/:itemId — soft delete
router.delete('/:projectId/po/:poId/itp/:itemId', async (req, res) => {
  try {
    const { poId, itemId } = req.params
    const [[item]] = await db.query(
      'SELECT id FROM itp_requirements WHERE id=? AND po_id=?', [itemId, poId]
    )
    if (!item) return res.status(404).json({ error: 'ITP item not found' })

    const userId = req.user?.id || 1
    await db.query('UPDATE itp_requirements SET is_deleted=1 WHERE id=?', [itemId])
    await db.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, resource)
       VALUES (?,?,?,?,?,?)`,
      [userId, 'delete', 'itp_requirement', itemId, Number(req.params.projectId) || null,
       `/expediting/${req.params.projectId}/po/${poId}/itp/${itemId}`]
    ).catch(() => {})

    res.json({ success: true })
  } catch (e) {
    console.error('[itp:delete]', e.message)
    dbError(res, e)
  }
})

// GET /:projectId/po/:poId/itp/:itemId/date-history — forecast date change history
router.get('/:projectId/po/:poId/itp/:itemId/date-history', async (req, res) => {
  try {
    const { itemId } = req.params
    const [history] = await db.query(
      `SELECT dcl.*, u.full_name AS changed_by_name
       FROM date_change_log dcl
       LEFT JOIN users u ON dcl.created_by = u.id
       WHERE dcl.entity_type = 'itp_item' AND dcl.entity_id = ? AND dcl.field_name = 'forecast_date'
       ORDER BY dcl.created_at DESC`,
      [itemId]
    )
    res.json({ history })
  } catch (e) {
    console.error('[itp:date-history]', e.message)
    dbError(res, e)
  }
})

// ─── HEAT NUMBER ──────────────────────────────────────────────
// Updates the heat number on a PO line.
router.put('/:projectId/po/:poId/lines/:lineId/heat-number', async (req, res) => {
  try {
    const { poId, lineId } = req.params
    const { heat_number } = req.body

    await db.query(
      `UPDATE po_lines SET heat_number=? WHERE id=? AND po_id=?`,
      [heat_number || null, lineId, poId]
    )
    const [[line]] = await db.query(`SELECT * FROM po_lines WHERE id=?`, [lineId])
    res.json(line)
  } catch (e) {
    console.error(e)
    dbError(res, e)
  }
})

// ─── PACKAGE HIERARCHY GUARD (Q2 leaf-only EXTENDED to Q4 three-level typed) ───
// Pure verdict function (no DB/no res) — the SCN-create txn calls it before any insert,
// so a reject never touches parent_package_id/container_type_id (provable pre-migration).
// Exported so the Q4.2 proof harness exercises THIS exact code (no drifting copy).
//   Model: container (typed: container_type_id set) → sub-package → items.
//     • A container MUST be top-level (no parent_ref) and hold NO items; it only parents sub-packages.
//     • A nested package's parent must exist, be top-level, and be a container — enforcing the
//       depth-3 cap (no container-in-container; no sub-package under a sub-package).
//     • A loose top-level package (untyped, no parent) may hold items directly (mixed shipment).
// Returns { ok:true } or { ok:false, error } (caller maps !ok → 422).
function validatePackageHierarchy (packages) {
  const list = packages || []
  const isTypedContainer = q => q && q.container_type_id != null && q.container_type_id !== ''
  const hasParentRef     = q => q && q.parent_ref != null && q.parent_ref !== ''
  const byRef = new Map()
  list.forEach(p => { if (p.ref != null && p.ref !== '') byRef.set(String(p.ref), p) })
  const containerRefs = new Set()
  list.forEach(p => { if (hasParentRef(p)) containerRefs.add(String(p.parent_ref)) })
  for (const p of list) {
    const myRef = p.ref != null ? String(p.ref) : ''
    const isReferencedAsParent = myRef !== '' && containerRefs.has(myRef)
    const hasContents = (p.contents || []).some(c => c && c.line_ref && Number(c.qty) > 0)

    // (Q4) A typed container is top-level and items-free; it only parents sub-packages.
    if (isTypedContainer(p)) {
      if (hasParentRef(p)) return { ok: false, error: `Package "${(p.type || myRef)}" is a container and must be top-level — a container cannot be nested inside another package.` }
      if (hasContents)     return { ok: false, error: `Package "${(p.type || myRef)}" is a container and cannot hold items directly — allocate items to its sub-packages.` }
    }
    // (Q2, retained) A package that parents others must not also hold items directly.
    if (isReferencedAsParent && hasContents) return { ok: false, error: `Package "${(p.type || myRef)}" holds sub-packages and cannot hold items directly — allocate items to its sub-packages.` }
    // (Q4) A nested package's parent must exist, be top-level, and be a container.
    //      Parent-with-a-parent ⇒ depth-4 (reject); parent-not-a-container ⇒ invalid nest.
    if (hasParentRef(p)) {
      const parent = byRef.get(String(p.parent_ref))
      if (!parent || parent === p) return { ok: false, error: `Package parent_ref "${p.parent_ref}" does not match any package in this shipment.` }
      if (hasParentRef(parent))    return { ok: false, error: `Package "${(p.type || myRef)}" exceeds the 3-level limit (container → sub-package → items) — sub-packages cannot be nested under other sub-packages.` }
      if (!isTypedContainer(parent)) return { ok: false, error: `Package "${(p.type || myRef)}" must be nested under a container — its parent "${p.parent_ref}" is not a container.` }
    }
  }
  return { ok: true }
}

module.exports = router
module.exports.validatePackageHierarchy = validatePackageHierarchy
module.exports.resolveDelegation = resolveDelegation   // D3 proofs
