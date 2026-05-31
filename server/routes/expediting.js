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
      po_lines: lines,   // Frontend expects po_lines
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
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  } catch (e) { res.status(500).json({ error: e.message }) }
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
       status || 'not_submitted', notes || null, req.user.id]
    )
    const [[doc]] = await db.query('SELECT * FROM vdrl_documents WHERE id=?', [r.insertId])
    res.status(201).json(doc)
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  } catch (e) { res.status(500).json({ error: e.message }) }
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
  } catch (e) { res.status(500).json({ error: e.message }) }
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
