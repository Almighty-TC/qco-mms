// ─── EXPEDITING ROUTES ────────────────────────────────────────
// Register, milestone forecasting, line items, child items, VDRL,
// action notes. All routes require a valid JWT via authenticateToken.
// RAG status computed server-side from milestone dates.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken } = require('../middleware/auth')

router.use(authenticateToken)
router.use(require('../middleware/permissions').denyReadOnly) // C-a: viewer/auditor barred from writes
router.use(require('../middleware/permissions').enforce(p => p.includes('/vdrl') ? 'vdrl' : 'expediting')) // C-b2: vdrl routes→vdrl, else expediting

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
       status || 'Not submitted', notes || null, req.user.id]
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

// ─── WAREHOUSES ───────────────────────────────────────────────
// Returns all warehouses for use in the SCN wizard destination selector.
router.get('/:projectId/warehouses', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name, code, type, location, manager, phone FROM warehouses ORDER BY name')
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── CREATE SCN ───────────────────────────────────────────────
// Creates a Shipment Control Note, updates qty_assigned on selected lines,
// inserts any additional items not on the PO, and (Heat/Lot P1) records the
// shipment's declared heats. All writes run in one pooled transaction so a
// later insert failure never leaves a half-created SCN.
router.post('/:projectId/scn', async (req, res) => {
  const pid = Number(req.params.projectId)
  const {
    po_id, selected_lines = [], additional_items = [],
    pickup_location, destination_warehouse_id, grid_bay,
    cdd, etd, eta, transport_mode, forwarder_name, incoterms,
    packages = [], notify_forwarder,
    heats = [],   // ── Heat/Lot P1: per-shipment declared heats (additive) ──
  } = req.body

  if (!po_id) return res.status(400).json({ error: 'po_id required' })

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // Generate SCN ref
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM shipment_control_notes')
    const scnRef = `SCN-${new Date().getFullYear()}-${String(n + 1).padStart(4, '0')}`

    // Insert SCN
    const [r] = await conn.query(
      `INSERT INTO shipment_control_notes
        (scn_ref, po_id, project_id, origin_location, destination_warehouse_id,
         etd, eta, mode, forwarder_name, incoterms, status, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,'draft',?,?)`,
      [scnRef, po_id, pid, pickup_location || null, destination_warehouse_id || null,
       etd || null, eta || null, transport_mode || null, forwarder_name || null,
       incoterms || null, null, req.user.id]
    )
    const scnId = r.insertId

    // Update po_lines qty_assigned for each selected line
    for (const { po_line_id, qty_allocated } of selected_lines) {
      await conn.query(
        'UPDATE po_lines SET qty_assigned = COALESCE(qty_assigned,0) + ? WHERE id = ? AND po_id = ?',
        [Number(qty_allocated) || 0, po_line_id, po_id]
      )
    }

    // Insert additional items (not on PO)
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

    await conn.commit()
    res.status(201).json({ id: scnId, scn_ref: scnRef, status: 'draft' })
  } catch (e) {
    await conn.rollback()
    console.error('[scn:create]', e.message)
    res.status(500).json({ error: e.message })
  } finally {
    conn.release()
  }
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
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }) }
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
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }) }
})

// ─── VDRL UPLOAD ──────────────────────────────────────────────
// Parses an uploaded .xlsx file and imports VDRL documents.
// Supports ?dryRun=true for preview without writing to DB.
const uploadVDRL = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.xlsx')) cb(null, true)
    else cb(new Error('Only .xlsx files'))
  },
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
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }) }
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
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
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
