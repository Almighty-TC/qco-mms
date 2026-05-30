// ─── FOUNDATIONAL ROUTES ────────────────────────────────────
// WBS, Commodity Library, Equipment List, Certificates
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken } = require('../middleware/auth')
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')

router.use(authenticateToken)

// Multer for certificate uploads
const certStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/certificates')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
  },
})
const uploadCert = multer({ storage: certStorage, limits: { fileSize: 25 * 1024 * 1024 } })

// ─── HELPER: audit ───────────────────────────────────────────────────────────
function audit(req, action, entity, before, after) {
  db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, before_state, after_state, ip_address)
     VALUES (?,?,?,?,?,?,?)`,
    [req.user.id, action, entity.split('/')[0], entity.split('/')[1] || null,
     JSON.stringify(before), JSON.stringify(after), req.ip]
  ).catch(() => {})
}

// ═══════════════════════════════════════════════════════════════
// WBS ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// GET /api/foundational/:projectId/wbs — full tree
router.get('/:projectId/wbs', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [rows] = await db.query(
      `SELECT w.*, u.full_name AS owner_name
       FROM wbs_nodes w
       LEFT JOIN users u ON u.id = w.owner_id
       WHERE w.project_id = ?
       ORDER BY w.code`,
      [pid]
    )
    res.json(rows)
  } catch (e) {
    console.error('[foundational:wbs:get]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/foundational/:projectId/wbs/impact/:id — delete impact check
router.get('/:projectId/wbs/impact/:id', async (req, res) => {
  try {
    const nodeId = Number(req.params.id)
    const pid    = Number(req.params.projectId)

    // Count descendants
    const [children] = await db.query(
      'SELECT COUNT(*) AS cnt FROM wbs_nodes WHERE parent_id = ? AND project_id = ?',
      [nodeId, pid]
    )

    // Get node's code to find all POs referencing it (and its children)
    const [[node]] = await db.query('SELECT code FROM wbs_nodes WHERE id=?', [nodeId])

    // Affected POs (by wbs_code starting with this node's code)
    const [affectedPOs] = await db.query(
      `SELECT id, po_number, wbs_code, status FROM purchase_orders
       WHERE project_id=? AND wbs_code LIKE ?`,
      [pid, `${node.code}%`]
    )

    // Affected PO lines
    const [affectedLines] = await db.query(
      `SELECT l.id, l.line_number, l.description, l.qty, l.uom, l.wbs_code_snapshot,
              p.po_number, p.id AS po_id
       FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id
       WHERE p.project_id=? AND l.wbs_code_snapshot LIKE ?`,
      [pid, `${node.code}%`]
    )

    res.json({
      childCount: children[0].cnt,
      affectedPOs,
      affectedLines,
      codesCovered: node.code,
    })
  } catch (e) {
    console.error('[foundational:wbs:impact]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/foundational/:projectId/wbs/allocation-check/:targetId — for reallocation warning
router.get('/:projectId/wbs/allocation-check/:targetId', async (req, res) => {
  try {
    const targetId = Number(req.params.targetId)
    const pid      = Number(req.params.projectId)
    const [[node]] = await db.query('SELECT code FROM wbs_nodes WHERE id=?', [targetId])
    const [lines]  = await db.query(
      `SELECT SUM(l.qty) AS allocated_qty FROM po_lines l
       JOIN purchase_orders p ON p.id = l.po_id
       WHERE p.project_id=? AND l.wbs_code_snapshot=?`,
      [pid, node.code]
    )
    res.json({ wbsCode: node.code, allocatedQty: lines[0].allocated_qty || 0 })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/foundational/:projectId/wbs — create node
router.post('/:projectId/wbs', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { code, description, parent_id, rag, ros_date, notes, owner_id, planned_start, planned_end } = req.body
    if (!code?.trim() || !description?.trim()) {
      return res.status(400).json({ error: 'Code and description are required' })
    }
    // Check duplicate code in project
    const [[dup]] = await db.query(
      'SELECT id FROM wbs_nodes WHERE project_id=? AND code=?', [pid, code.trim()]
    )
    if (dup) return res.status(409).json({ error: `WBS code ${code} already exists in this project` })

    const [r] = await db.query(
      `INSERT INTO wbs_nodes (project_id, parent_id, code, description, rag, ros_date, notes, owner_id, planned_start, planned_end)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [pid, parent_id || null, code.trim(), description.trim(),
       rag || null, ros_date || null, notes || null, owner_id || null,
       planned_start || null, planned_end || null]
    )
    audit(req, 'wbs_created', `wbs_nodes/${r.insertId}`, {}, { code, description, project_id: pid })
    const [[created]] = await db.query('SELECT * FROM wbs_nodes WHERE id=?', [r.insertId])
    res.status(201).json(created)
  } catch (e) {
    console.error('[foundational:wbs:create]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/foundational/:projectId/wbs/:id — update node (notes + ros)
router.patch('/:projectId/wbs/:id', async (req, res) => {
  try {
    const id  = Number(req.params.id)
    const pid = Number(req.params.projectId)
    const { notes, ros_date, rag } = req.body
    const [[before]] = await db.query('SELECT * FROM wbs_nodes WHERE id=? AND project_id=?', [id, pid])
    if (!before) return res.status(404).json({ error: 'WBS node not found' })

    await db.query(
      'UPDATE wbs_nodes SET notes=?, ros_date=?, rag=?, updated_at=NOW() WHERE id=?',
      [notes ?? before.notes, ros_date ?? before.ros_date, rag ?? before.rag, id]
    )
    audit(req, 'wbs_updated', `wbs_nodes/${id}`, { notes: before.notes, ros_date: before.ros_date }, { notes, ros_date })
    const [[updated]] = await db.query('SELECT * FROM wbs_nodes WHERE id=?', [id])
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/foundational/:projectId/wbs/:id/reallocate — move PO lines to new WBS
router.patch('/:projectId/wbs/:id/reallocate', async (req, res) => {
  try {
    const id  = Number(req.params.id)
    const pid = Number(req.params.projectId)
    const { reallocations } = req.body  // [{lineId, newWbsNodeId, newWbsCode}]
    for (const r of (reallocations || [])) {
      await db.query(
        'UPDATE po_lines SET wbs_code_snapshot=? WHERE id=?',
        [r.newWbsCode, r.lineId]
      )
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/foundational/:projectId/wbs/:id — delete node
router.delete('/:projectId/wbs/:id', async (req, res) => {
  try {
    const id  = Number(req.params.id)
    const pid = Number(req.params.projectId)
    const [[node]] = await db.query('SELECT * FROM wbs_nodes WHERE id=? AND project_id=?', [id, pid])
    if (!node) return res.status(404).json({ error: 'WBS node not found' })

    await db.query('DELETE FROM wbs_nodes WHERE id=?', [id])
    audit(req, 'wbs_deleted', `wbs_nodes/${id}`, node, {})
    res.json({ ok: true })
  } catch (e) {
    console.error('[foundational:wbs:delete]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// COMMODITY LIBRARY ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// GET /api/foundational/:projectId/commodities
router.get('/:projectId/commodities', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [rows] = await db.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM foundational_certificates fc
               WHERE fc.entity_type='commodity' AND fc.entity_id=c.id) AS cert_count
       FROM commodity_library c
       WHERE c.project_id=?
       ORDER BY c.code`,
      [pid]
    )
    res.json(rows)
  } catch (e) {
    console.error('[foundational:commodities:get]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/foundational/:projectId/commodities
router.post('/:projectId/commodities', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { code, name, uom, wbs_code, wbs_node_id, estimated_qty, trace_level, preservation, preferred_vendor, notes } = req.body
    if (!code?.trim() || !name?.trim()) return res.status(400).json({ error: 'Code and name are required' })
    if (!wbs_code?.trim()) return res.status(400).json({ error: 'WBS code is required' })

    const [[dup]] = await db.query(
      'SELECT id FROM commodity_library WHERE project_id=? AND code=?', [pid, code.trim()]
    )
    if (dup) return res.status(409).json({ error: `Commodity code ${code} already exists` })

    const [r] = await db.query(
      `INSERT INTO commodity_library (project_id, code, name, uom, wbs_code, wbs_node_id, estimated_qty, trace_level, preservation, preferred_vendor, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, code.trim(), name.trim(), uom || 'EA', wbs_code?.trim() || null, wbs_node_id || null,
       estimated_qty || null, trace_level || 'None', preservation || 'None',
       preferred_vendor || null, notes || null, req.user.id]
    )
    audit(req, 'commodity_created', `commodity_library/${r.insertId}`, {}, { code, name })
    const [[created]] = await db.query('SELECT * FROM commodity_library WHERE id=?', [r.insertId])
    res.status(201).json(created)
  } catch (e) {
    console.error('[foundational:commodities:create]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/foundational/:projectId/commodities/:id
router.patch('/:projectId/commodities/:id', async (req, res) => {
  try {
    const id  = Number(req.params.id)
    const pid = Number(req.params.projectId)
    const [[before]] = await db.query('SELECT * FROM commodity_library WHERE id=? AND project_id=?', [id, pid])
    if (!before) return res.status(404).json({ error: 'Commodity not found' })

    const fields = ['name','uom','wbs_code','wbs_node_id','estimated_qty','trace_level','preservation','preferred_vendor','notes','status']
    const sets = []
    const vals = []
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]) }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' })
    vals.push(id)
    await db.query(`UPDATE commodity_library SET ${sets.join(',')}, updated_at=NOW() WHERE id=?`, vals)
    audit(req, 'commodity_updated', `commodity_library/${id}`, before, req.body)
    const [[updated]] = await db.query('SELECT * FROM commodity_library WHERE id=?', [id])
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/foundational/:projectId/commodities/:id
router.delete('/:projectId/commodities/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[row]] = await db.query('SELECT * FROM commodity_library WHERE id=? AND project_id=?', [id, Number(req.params.projectId)])
    if (!row) return res.status(404).json({ error: 'Commodity not found' })
    await db.query('DELETE FROM commodity_library WHERE id=?', [id])
    audit(req, 'commodity_deleted', `commodity_library/${id}`, row, {})
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// EQUIPMENT LIST ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// GET /api/foundational/:projectId/equipment
router.get('/:projectId/equipment', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [rows] = await db.query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM foundational_certificates fc
               WHERE fc.entity_type='equipment' AND fc.entity_id=e.id) AS cert_count
       FROM equipment_list e
       WHERE e.project_id=?
       ORDER BY e.tag`,
      [pid]
    )
    res.json(rows)
  } catch (e) {
    console.error('[foundational:equipment:get]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/foundational/:projectId/equipment
router.post('/:projectId/equipment', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { tag, equipment_type, wbs_code, wbs_node_id, description, area_location, criticality, spec, trace_class, po_reference, vendor, weight_kg, size_lwh, notes } = req.body
    if (!tag?.trim() || !description?.trim()) return res.status(400).json({ error: 'Tag and description are required' })
    if (!wbs_code?.trim()) return res.status(400).json({ error: 'WBS code is required' })

    const [[dup]] = await db.query(
      'SELECT id FROM equipment_list WHERE project_id=? AND tag=?', [pid, tag.trim()]
    )
    if (dup) return res.status(409).json({ error: `Equipment tag ${tag} already exists in this project` })

    const [r] = await db.query(
      `INSERT INTO equipment_list (project_id, tag, equipment_type, wbs_code, wbs_node_id, description, area_location, criticality, spec, trace_class, po_reference, vendor, weight_kg, size_lwh, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, tag.trim(), equipment_type || 'Vessel', wbs_code?.trim() || null, wbs_node_id || null,
       description.trim(), area_location || null, criticality || 'C-Standard',
       spec || null, trace_class || 'None', po_reference || null, vendor || null,
       weight_kg || null, size_lwh || null, notes || null, req.user.id]
    )
    audit(req, 'equipment_created', `equipment_list/${r.insertId}`, {}, { tag, description })
    const [[created]] = await db.query('SELECT * FROM equipment_list WHERE id=?', [r.insertId])
    res.status(201).json(created)
  } catch (e) {
    console.error('[foundational:equipment:create]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/foundational/:projectId/equipment/:id
router.patch('/:projectId/equipment/:id', async (req, res) => {
  try {
    const id  = Number(req.params.id)
    const pid = Number(req.params.projectId)
    const [[before]] = await db.query('SELECT * FROM equipment_list WHERE id=? AND project_id=?', [id, pid])
    if (!before) return res.status(404).json({ error: 'Equipment not found' })

    const fields = ['equipment_type','wbs_code','wbs_node_id','description','area_location','criticality','spec','trace_class','po_reference','vendor','weight_kg','size_lwh','notes','status']
    const sets = []; const vals = []
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f}=?`); vals.push(req.body[f]) }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' })
    vals.push(id)
    await db.query(`UPDATE equipment_list SET ${sets.join(',')}, updated_at=NOW() WHERE id=?`, vals)
    audit(req, 'equipment_updated', `equipment_list/${id}`, before, req.body)
    const [[updated]] = await db.query('SELECT * FROM equipment_list WHERE id=?', [id])
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/foundational/:projectId/equipment/:id
router.delete('/:projectId/equipment/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[row]] = await db.query('SELECT * FROM equipment_list WHERE id=? AND project_id=?', [id, Number(req.params.projectId)])
    if (!row) return res.status(404).json({ error: 'Equipment not found' })
    await db.query('DELETE FROM equipment_list WHERE id=?', [id])
    audit(req, 'equipment_deleted', `equipment_list/${id}`, row, {})
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// CERTIFICATES ENDPOINTS (shared by commodity + equipment)
// ═══════════════════════════════════════════════════════════════

// GET /api/foundational/:projectId/certificates/:entityType/:entityId
router.get('/:projectId/certificates/:entityType/:entityId', async (req, res) => {
  try {
    const { entityType, entityId } = req.params
    const [rows] = await db.query(
      `SELECT fc.*, u.full_name AS uploaded_by_name
       FROM foundational_certificates fc
       LEFT JOIN users u ON u.id = fc.uploaded_by
       WHERE fc.entity_type=? AND fc.entity_id=?
       ORDER BY fc.cert_type, fc.uploaded_at DESC`,
      [entityType, Number(entityId)]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/foundational/:projectId/certificates/:entityType/:entityId
router.post('/:projectId/certificates/:entityType/:entityId', uploadCert.single('file'), async (req, res) => {
  try {
    const { entityType, entityId, projectId } = req.params
    const { cert_type, ref_number, applies_to, issue_date, status } = req.body
    if (!cert_type) return res.status(400).json({ error: 'Certificate type is required' })

    const filename  = req.file?.filename || null
    const file_size = req.file?.size || null

    const [r] = await db.query(
      `INSERT INTO foundational_certificates (entity_type, entity_id, project_id, cert_type, ref_number, applies_to, issue_date, filename, file_size, status, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [entityType, Number(entityId), Number(projectId), cert_type,
       ref_number || null, applies_to || null, issue_date || null,
       filename, file_size, status || 'Pending QA', req.user.id]
    )
    const [[created]] = await db.query(
      `SELECT fc.*, u.full_name AS uploaded_by_name FROM foundational_certificates fc
       LEFT JOIN users u ON u.id=fc.uploaded_by WHERE fc.id=?`, [r.insertId]
    )
    res.status(201).json(created)
  } catch (e) {
    console.error('[foundational:certs:create]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/foundational/:projectId/certificates/:id/status
router.patch('/:projectId/certificates/:id/status', async (req, res) => {
  try {
    const { status } = req.body
    await db.query('UPDATE foundational_certificates SET status=? WHERE id=?', [status, Number(req.params.id)])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/foundational/:projectId/certificates/:id
router.delete('/:projectId/certificates/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[cert]] = await db.query('SELECT * FROM foundational_certificates WHERE id=?', [id])
    if (!cert) return res.status(404).json({ error: 'Certificate not found' })
    if (cert.filename) {
      const fp = path.join(__dirname, '../uploads/certificates', cert.filename)
      fs.unlink(fp, () => {})
    }
    await db.query('DELETE FROM foundational_certificates WHERE id=?', [id])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/foundational/:projectId/certificates/:id/download
router.get('/:projectId/certificates/:id/download', async (req, res) => {
  try {
    const [[cert]] = await db.query('SELECT * FROM foundational_certificates WHERE id=?', [Number(req.params.id)])
    if (!cert?.filename) return res.status(404).json({ error: 'File not found' })
    const fp = path.join(__dirname, '../uploads/certificates', cert.filename)
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not on disk' })
    res.download(fp, cert.filename.replace(/^\d+-/, ''))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
