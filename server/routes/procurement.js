// ─── PROCUREMENT ROUTES ───────────────────────────────────────
// Handles PO list, PO detail, line items, and approval actions.
// All routes require an authenticated JWT (enforced in index.js).
// Project-scoped: most list endpoints require :projectId in the path.
const express = require('express')
const router  = express.Router()
const db      = require('../db')

// ─── STATUS LABELS ────────────────────────────────────────────
// Maps DB enum values to human-readable display labels.
const STATUS_LABELS = {
  rfq:       'Pending approval',
  loa:       'Letter of Award',
  'po-raised': 'Approved & Locked',
  active:    'Active',
  closed:    'Completed',
  cancelled: 'Cancelled',
}

// ─── STATS ─────────────────────────────────────────────────────
// GET /api/procurement/:projectId/stats
// Returns aggregate stat card data for the dashboard strip.
router.get('/:projectId/stats', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [[row]] = await db.query(`
      SELECT
        COUNT(*) AS total_pos,
        COALESCE(SUM(value), 0) AS committed_value,
        COALESCE(SUM(CASE WHEN is_locked = 1 THEN value ELSE 0 END), 0) AS approved_value,
        SUM(CASE WHEN status = 'rfq' OR status = 'loa' THEN 1 ELSE 0 END) AS pending_count
      FROM purchase_orders
      WHERE project_id = ?
    `, [pid])
    res.json({
      totalPOs:       row.total_pos,
      committedValue: row.committed_value,
      approvedValue:  row.approved_value,
      pendingCount:   row.pending_count,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── PO LIST ─────────────────────────────────────────────────
// GET /api/procurement/:projectId/pos
// Query params: status (tab filter), search, critical (1 = critical only)
router.get('/:projectId/pos', async (req, res) => {
  try {
    const pid    = Number(req.params.projectId)
    const { status, search, critical } = req.query

    const params = [pid]
    let where = 'po.project_id = ?'

    if (status === 'approved') {
      where += ' AND po.is_locked = 1'
    } else if (status === 'pending') {
      where += " AND po.status IN ('rfq','loa') AND po.is_locked = 0"
    } else if (status === 'completed') {
      where += " AND po.status = 'closed'"
    }

    if (critical === '1') {
      where += ' AND po.is_critical_path = 1'
    }

    if (search) {
      where += ` AND (po.po_number LIKE ? OR po.po_name LIKE ? OR po.vendor_name LIKE ? OR po.wbs_code LIKE ? OR u.full_name LIKE ?)`
      const s = `%${search}%`
      params.push(s, s, s, s, s)
    }

    const [rows] = await db.query(`
      SELECT
        po.id, po.po_number, po.po_name, po.description,
        po.vendor_name, po.supplier_id, po.currency, po.value,
        po.incoterms, po.wbs_code, po.ros_date, po.status,
        po.is_critical_path, po.is_locked, po.group_category,
        po.owner_id, po.created_at, po.updated_at,
        u.full_name AS owner_name,
        s.name AS supplier_name
      FROM purchase_orders po
      LEFT JOIN users u ON u.id = po.owner_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where}
      ORDER BY po.created_at DESC
    `, params)

    res.json(rows.map(r => ({
      ...r,
      statusLabel:      STATUS_LABELS[r.status] ?? r.status,
      isCriticalPath:   !!r.is_critical_path,
      isLocked:         !!r.is_locked,
    })))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── GET WBS NODES (for dropdown) ───────────────────────────
// GET /api/procurement/:projectId/wbs
router.get('/:projectId/wbs', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [rows] = await db.query(
      'SELECT id, code, description FROM wbs_nodes WHERE project_id = ? ORDER BY sort_order, code',
      [pid]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── GET PROCUREMENT USERS (for owner dropdown) ──────────────
// GET /api/procurement/users
router.get('/users/list', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, full_name, role FROM users
      WHERE is_active = 1 AND is_external = 0
        AND role IN ('admin','procurement_officer','senior_expeditor','project_manager')
      ORDER BY full_name
    `)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── CREATE PO ───────────────────────────────────────────────
// POST /api/procurement/:projectId/pos
router.post('/:projectId/pos', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const {
      po_number, po_name, description, vendor_name, supplier_id,
      currency, value, incoterms, wbs_code, ros_date,
      owner_id, group_category,
      milestone_po_date, milestone_fat_date, milestone_esd_date,
      milestone_eta_date, milestone_ros_date,
      lines = [],
    } = req.body

    if (!po_number) return res.status(400).json({ error: 'PO number is required' })
    if (!vendor_name && !supplier_id) return res.status(400).json({ error: 'Vendor is required' })

    // Resolve vendor_name from supplier if not provided directly
    let resolvedVendor = vendor_name
    if (!resolvedVendor && supplier_id) {
      const [[sup]] = await db.query('SELECT name FROM suppliers WHERE id = ?', [supplier_id])
      resolvedVendor = sup?.name ?? ''
    }

    const [result] = await db.query(`
      INSERT INTO purchase_orders
        (project_id, po_number, po_name, description, vendor_name, supplier_id,
         currency, value, incoterms, wbs_code, ros_date, owner_id, group_category,
         milestone_po_date, milestone_fat_date, milestone_esd_date,
         milestone_eta_date, milestone_ros_date,
         status, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'rfq',?)
    `, [
      pid, po_number, po_name ?? null, description ?? null, resolvedVendor, supplier_id ?? null,
      currency ?? 'AUD', value ?? null, incoterms ?? null, wbs_code ?? null, ros_date ?? null,
      owner_id ?? null, group_category ?? null,
      milestone_po_date ?? null, milestone_fat_date ?? null, milestone_esd_date ?? null,
      milestone_eta_date ?? null, milestone_ros_date ?? null,
      req.user.id,
    ])

    const poId = result.insertId

    // Insert line items if provided
    if (lines.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        await db.query(`
          INSERT INTO po_lines (po_id, line_number, description, qty, uom, uom_id, unit_price, ros_date)
          VALUES (?,?,?,?,?,?,?,?)
        `, [
          poId,
          l.line_number ?? String(i + 1),
          l.description ?? '',
          l.qty ?? null,
          l.uom ?? 'EA',
          l.uom_id ?? null,
          l.unit_price ?? null,
          l.ros_date ?? null,
        ])
      }
    }

    const [[newPO]] = await db.query('SELECT * FROM purchase_orders WHERE id = ?', [poId])
    res.status(201).json({ ...newPO, statusLabel: STATUS_LABELS[newPO.status] })
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `PO number "${req.body.po_number}" already exists` })
    }
    res.status(500).json({ error: e.message })
  }
})

// ─── GET SINGLE PO WITH LINES ────────────────────────────────
// GET /api/procurement/pos/:id
router.get('/pos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[po]] = await db.query(`
      SELECT po.*,
        u.full_name AS owner_name,
        s.name AS supplier_name,
        s.code AS supplier_code
      FROM purchase_orders po
      LEFT JOIN users u ON u.id = po.owner_id
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = ?
    `, [id])

    if (!po) return res.status(404).json({ error: 'PO not found' })

    const [lines] = await db.query(`
      SELECT l.*, u.code AS uom_code, u.name AS uom_name
      FROM po_lines l
      LEFT JOIN units_of_measure u ON u.id = l.uom_id
      WHERE l.po_id = ?
      ORDER BY l.line_number
    `, [id])

    res.json({
      ...po,
      statusLabel:    STATUS_LABELS[po.status] ?? po.status,
      isCriticalPath: !!po.is_critical_path,
      isLocked:       !!po.is_locked,
      lines,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── UPDATE PO ───────────────────────────────────────────────
// PUT /api/procurement/pos/:id
router.put('/pos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[existing]] = await db.query('SELECT id, is_locked FROM purchase_orders WHERE id = ?', [id])
    if (!existing) return res.status(404).json({ error: 'PO not found' })
    if (existing.is_locked) return res.status(400).json({ error: 'This PO is locked and cannot be edited' })

    const {
      po_number, po_name, description, vendor_name, supplier_id,
      currency, value, incoterms, wbs_code, ros_date,
      owner_id, group_category,
      milestone_po_date, milestone_fat_date, milestone_esd_date,
      milestone_eta_date, milestone_ros_date,
    } = req.body

    await db.query(`
      UPDATE purchase_orders SET
        po_number=?, po_name=?, description=?, vendor_name=?, supplier_id=?,
        currency=?, value=?, incoterms=?, wbs_code=?, ros_date=?,
        owner_id=?, group_category=?,
        milestone_po_date=?, milestone_fat_date=?, milestone_esd_date=?,
        milestone_eta_date=?, milestone_ros_date=?
      WHERE id = ?
    `, [
      po_number, po_name ?? null, description ?? null, vendor_name, supplier_id ?? null,
      currency ?? 'AUD', value ?? null, incoterms ?? null, wbs_code ?? null, ros_date ?? null,
      owner_id ?? null, group_category ?? null,
      milestone_po_date ?? null, milestone_fat_date ?? null, milestone_esd_date ?? null,
      milestone_eta_date ?? null, milestone_ros_date ?? null,
      id,
    ])

    const [[updated]] = await db.query('SELECT * FROM purchase_orders WHERE id = ?', [id])
    res.json({ ...updated, statusLabel: STATUS_LABELS[updated.status] })
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `PO number "${req.body.po_number}" already exists` })
    }
    res.status(500).json({ error: e.message })
  }
})

// ─── APPROVE & LOCK PO ───────────────────────────────────────
// PATCH /api/procurement/pos/:id/approve
router.patch('/pos/:id/approve', async (req, res) => {
  try {
    const id = Number(req.params.id)
    await db.query(
      "UPDATE purchase_orders SET status='po-raised', is_locked=1 WHERE id = ?",
      [id]
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── TOGGLE CRITICAL PATH STAR ───────────────────────────────
// PATCH /api/procurement/pos/:id/star
router.patch('/pos/:id/star', async (req, res) => {
  try {
    const id = Number(req.params.id)
    await db.query(
      'UPDATE purchase_orders SET is_critical_path = NOT is_critical_path WHERE id = ?',
      [id]
    )
    const [[row]] = await db.query('SELECT is_critical_path FROM purchase_orders WHERE id = ?', [id])
    res.json({ isCriticalPath: !!row.is_critical_path })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── DELETE PO ───────────────────────────────────────────────
// DELETE /api/procurement/pos/:id
router.delete('/pos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[existing]] = await db.query('SELECT id, is_locked FROM purchase_orders WHERE id = ?', [id])
    if (!existing) return res.status(404).json({ error: 'PO not found' })
    if (existing.is_locked) return res.status(400).json({ error: 'Locked POs cannot be deleted' })

    await db.query('DELETE FROM po_lines WHERE po_id = ?', [id])
    await db.query('DELETE FROM purchase_orders WHERE id = ?', [id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── LINE ITEMS ───────────────────────────────────────────────

// POST /api/procurement/pos/:id/lines
router.post('/pos/:id/lines', async (req, res) => {
  try {
    const poId = Number(req.params.id)
    const { line_number, description, qty, uom, uom_id, unit_price, ros_date } = req.body
    if (!description) return res.status(400).json({ error: 'Description is required' })

    const [r] = await db.query(`
      INSERT INTO po_lines (po_id, line_number, description, qty, uom, uom_id, unit_price, ros_date)
      VALUES (?,?,?,?,?,?,?,?)
    `, [poId, line_number ?? '1', description, qty ?? null, uom ?? 'EA', uom_id ?? null, unit_price ?? null, ros_date ?? null])

    const [[line]] = await db.query('SELECT * FROM po_lines WHERE id = ?', [r.insertId])
    res.status(201).json(line)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT /api/procurement/pos/:id/lines/:lineId
router.put('/pos/:id/lines/:lineId', async (req, res) => {
  try {
    const lineId = Number(req.params.lineId)
    const { line_number, description, qty, uom, uom_id, unit_price, ros_date } = req.body
    await db.query(`
      UPDATE po_lines SET line_number=?, description=?, qty=?, uom=?, uom_id=?, unit_price=?, ros_date=?
      WHERE id = ?
    `, [line_number, description, qty ?? null, uom ?? 'EA', uom_id ?? null, unit_price ?? null, ros_date ?? null, lineId])

    const [[line]] = await db.query('SELECT * FROM po_lines WHERE id = ?', [lineId])
    res.json(line)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/procurement/pos/:id/lines/:lineId
router.delete('/pos/:id/lines/:lineId', async (req, res) => {
  try {
    const lineId = Number(req.params.lineId)
    await db.query('DELETE FROM po_lines WHERE id = ?', [lineId])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
