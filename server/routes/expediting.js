// ─── EXPEDITING ROUTES ────────────────────────────────────────
// Register, milestone forecasting, line items, child items, VDRL,
// action notes. All routes require a valid JWT via authenticateToken.
// RAG status computed server-side from milestone dates.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken } = require('../middleware/auth')

router.use(authenticateToken)

// ─── ACCESS CONTROL ───────────────────────────────────────────
// Roles that can see all POs; others see only their assigned ones.
function canSeeAllPOs(role) {
  return ['admin','project_manager','project_director','procurement_manager','expediting_manager'].includes(role)
}

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
    const [pos] = await db.query(
      `SELECT po.id FROM purchase_orders po WHERE po.project_id=? AND po.is_locked=1`,
      [projectId]
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
    res.status(500).json({ error: e.message })
  }
})

// ─── REGISTER ─────────────────────────────────────────────────
// Returns paginated list of locked POs with milestones and RAG.
router.get('/:projectId/register', async (req, res) => {
  try {
    const { projectId } = req.params
    const page  = parseInt(req.query.page  || '1', 10)
    const limit = parseInt(req.query.limit || '50', 10)
    const offset = (page - 1) * limit

    let extraWhere = ''
    const extraParams = []
    if (!canSeeAllPOs(req.user?.role)) {
      extraWhere = ' AND po.expeditor_id=?'
      extraParams.push(req.user.id)
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM purchase_orders po WHERE po.project_id=? AND po.is_locked=1${extraWhere}`,
      [projectId, ...extraParams]
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
       WHERE po.project_id=? AND po.is_locked=1${extraWhere}
       ORDER BY po.po_number
       LIMIT ? OFFSET ?`,
      [projectId, ...extraParams, limit, offset]
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
    res.status(500).json({ error: e.message })
  }
})

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
        po.vendor_name, po.incoterms,
        po.milestone_po_date, po.milestone_fat_date,
        po.milestone_esd_date, po.milestone_eta_date, po.milestone_ros_date,
        COALESCE(s.name, po.vendor_name) AS vendor_display,
        s.address AS supplier_address,
        s.contact_name AS supplier_contact,
        own.full_name AS owner_name,
        exp.full_name AS expeditor_name,
        po.created_at, po.updated_at
       FROM purchase_orders po
       LEFT JOIN suppliers s   ON s.id   = po.supplier_id
       LEFT JOIN users own     ON own.id = po.owner_id
       LEFT JOIN users exp     ON exp.id = po.expeditor_id
       WHERE po.id=? AND po.project_id=?`,
      [poId, projectId]
    )
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
      `SELECT l.*, cm.name AS commodity_name, cm.trace_level
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

    res.json({
      ...po,
      rag: computePORag(milestones),
      milestones: enrichedMilestones,
      lines,
      itp_items,
      action_notes: notes,
      forecast_history,
      vdrl_package,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
