// ─── EXPEDITING ROUTES ────────────────────────────────────────
// Expediting register, milestone forecasting, line items, child items,
// action notes. All routes require a valid JWT via authenticateToken.
// RAG status computed server-side from milestone dates.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken } = require('../middleware/auth')

router.use(authenticateToken)

// ─── RAG HELPERS ──────────────────────────────────────────────
// Computes the milestone-level status based on date fields.
function computeMilestoneStatus(m) {
  if (m.actual_date) return 'complete'
  const today = new Date()
  if (m.forecast_date) {
    const fd = new Date(m.forecast_date)
    const daysUntil = (fd - today) / 86400000
    if (fd < today) return 'breached'
    if (daysUntil <= 14) return 'at_risk'
    return 'in_progress'
  }
  if (m.planned_date) {
    const pd = new Date(m.planned_date)
    if (pd < today && !m.actual_date) return 'at_risk'
  }
  return 'not_started'
}

// Computes the overall PO RAG from its milestones.
function computePORag(milestones) {
  const statuses = milestones.map(m => computeMilestoneStatus(m))
  if (statuses.includes('breached')) return 'red'
  if (statuses.includes('at_risk'))  return 'amber'
  if (statuses.every(s => s === 'complete')) return 'complete'
  if (statuses.some(s => s === 'in_progress' || s === 'complete')) return 'green'
  return 'grey'
}

// ─── STATS ────────────────────────────────────────────────────
// Returns summary counts for stat cards on the Expediting screen.
router.get('/:projectId/stats', async (req, res) => {
  try {
    const { projectId } = req.params
    const [[row]] = await db.query(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('po-raised','active') THEN 1 ELSE 0 END) AS ongoing,
        SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS complete
       FROM purchase_orders WHERE project_id=? AND is_locked=1`,
      [projectId]
    )
    res.json({ total: row.total, ongoing: row.ongoing || 0, complete: row.complete || 0, breached: 0, atRisk: 0 })
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

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM purchase_orders WHERE project_id=? AND is_locked=1`,
      [projectId]
    )

    const [pos] = await db.query(
      `SELECT
        po.id, po.po_number, po.po_name, po.wbs_code,
        po.description AS material_description,
        po.ros_date, po.contract_delivery_date,
        po.is_critical_path, po.is_locked, po.status,
        po.currency, po.value, po.group_category,
        po.vendor_name,
        COALESCE(s.name, po.vendor_name) AS vendor_display,
        own.full_name AS owner_name,
        exp.full_name AS expeditor_name,
        po.created_at, po.updated_at
       FROM purchase_orders po
       LEFT JOIN suppliers s   ON s.id   = po.supplier_id
       LEFT JOIN users own     ON own.id = po.owner_id
       LEFT JOIN users exp     ON exp.id = po.expeditor_id
       WHERE po.project_id=? AND po.is_locked=1
       ORDER BY po.po_number
       LIMIT ? OFFSET ?`,
      [projectId, limit, offset]
    )

    const result = []
    for (const po of pos) {
      const [milestones] = await db.query(
        `SELECT * FROM po_milestones WHERE po_id=? AND is_deleted=0 ORDER BY step_order`,
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
// Full PO detail including milestones, lines, child items, notes.
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
        po.vendor_name,
        COALESCE(s.name, po.vendor_name) AS vendor_display,
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

    // Milestones
    const [milestones] = await db.query(
      `SELECT * FROM po_milestones WHERE po_id=? AND is_deleted=0 ORDER BY step_order`,
      [poId]
    )
    const enrichedMilestones = milestones.map(m => ({ ...m, status: computeMilestoneStatus(m) }))

    // Lines with commodity info
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

    // Action notes
    const [notes] = await db.query(
      `SELECT n.*, u.full_name AS created_by_name
       FROM po_action_notes n
       LEFT JOIN users u ON u.id = n.created_by
       WHERE n.po_id=? ORDER BY n.created_at DESC`,
      [poId]
    )

    // VDRL package (first active)
    let vdrl_package = null
    try {
      const [[vp]] = await db.query(
        `SELECT * FROM vdrl_packages WHERE po_id=? LIMIT 1`,
        [poId]
      )
      if (vp) {
        const [vdocs] = await db.query(
          `SELECT * FROM vdrl_documents WHERE package_id=? ORDER BY doc_number LIMIT 5`,
          [vp.id]
        )
        vdrl_package = { ...vp, documents: vdocs }
      }
    } catch (_) { /* vdrl tables may not exist */ }

    res.json({
      ...po,
      rag: computePORag(milestones),
      milestones: enrichedMilestones,
      lines,
      action_notes: notes,
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
      `SELECT * FROM po_milestones WHERE id=?`,
      [milestoneId]
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
    const { text } = req.body
    if (!text || !text.trim()) return res.status(400).json({ error: 'Note text is required' })

    const [result] = await db.query(
      `INSERT INTO po_action_notes (po_id, text, created_by, created_at)
       VALUES (?, ?, ?, NOW())`,
      [poId, text.trim(), req.user?.id || null]
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
    const { poId, lineId } = req.params
    const { description, qty, uom, cdd, notes } = req.body

    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM expediting_child_items WHERE po_line_id=?`,
      [lineId]
    )
    const sub_number = (countRow.cnt || 0) + 1

    const [result] = await db.query(
      `INSERT INTO expediting_child_items
        (po_line_id, sub_number, description, qty, uom, cdd, status, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW())`,
      [lineId, sub_number, description || '', qty || 0, uom || '', cdd || null, notes || '', req.user?.id || null]
    )
    const [[child]] = await db.query(
      `SELECT * FROM expediting_child_items WHERE id=?`,
      [result.insertId]
    )
    res.json(child)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// ─── LINK COMMODITY ───────────────────────────────────────────
// Links a commodity or equipment tag to a PO line.
router.put('/:projectId/po/:poId/lines/:lineId/link-commodity', async (req, res) => {
  try {
    const { poId, lineId } = req.params
    const { commodity_id, equipment_tag } = req.body

    await db.query(
      `UPDATE po_lines SET commodity_id=?, equipment_tag=? WHERE id=? AND po_id=?`,
      [commodity_id || null, equipment_tag || null, lineId, poId]
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

module.exports = router
