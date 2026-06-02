// ─── FOUNDATIONAL ROUTES ────────────────────────────────────
// WBS, Commodity Library, Equipment List, Certificates
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken } = require('../middleware/auth')
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')
const XLSX    = require('xlsx')

router.use(authenticateToken)
router.use(require('../middleware/permissions').denyReadOnly) // C-a: viewer/auditor barred from writes
router.use(require('../middleware/permissions').enforce(p => p.includes('/certificate') ? null : p.includes('/commodit') ? 'commodity' : p.includes('/equipment') ? 'equipment' : 'wbs')) // C-b2: wbs/commodity/equipment per path; certificates→deny-floor residual
router.use(require('../middleware/permissions').queueGate(/\/foundational\/\d+\/(wbs|commodities|equipment)$/, /\/foundational\/\d+\/(wbs|commodities|equipment)\/\d+$/)) // C-c D1: proposers (project_control) must use approval queue for create/delete; admin direct

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
// Writes an audit_log row. Fire-and-forget (NOT awaited) so an audit failure can
// never 500 a real user action — but failures are logged, never swallowed silently.
// `entity` is a "type/id" string (e.g. "wbs_nodes/123"): split into entity_type/
// entity_id for structured filtering. `resource` (NOT NULL) is the request path
// (query string stripped), matching the path-only convention of existing rows.
function audit(req, action, entity, before, after) {
  // path-only, no /api mount prefix — matches the existing audit_log convention
  const resource = (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/)/, '')
  // project_id from the route param (all foundational routes are /:projectId/...);
  // provable-only → NULL if absent (never guessed).
  const projectId = Number(req.params.projectId) || null
  db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, before_value, after_value, resource, ip)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [req.user.id, action, entity.split('/')[0], entity.split('/')[1] || null, projectId,
     JSON.stringify(before), JSON.stringify(after),
     resource, req.ip]
  ).catch(e => console.error('[audit] insert failed:', e.message))
}

// ═══════════════════════════════════════════════════════════════
// WBS ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// GET /api/foundational/:projectId/wbs — full tree with per-node PO qty stats
router.get('/:projectId/wbs', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [rows] = await db.query(
      `SELECT w.*, u.full_name AS owner_name,
        COALESCE(po_agg.po_qty, 0) AS po_qty
       FROM wbs_nodes w
       LEFT JOIN users u ON u.id = w.owner_id
       LEFT JOIN (
         SELECT l.wbs_code_snapshot AS code, p.project_id, SUM(l.qty) AS po_qty
         FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id
         GROUP BY l.wbs_code_snapshot, p.project_id
       ) po_agg ON po_agg.code = w.code AND po_agg.project_id = w.project_id
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

    // Affected POs (by wbs_code starting with this node's code).
    // is_locked surfaced so the Impact/Reallocate UI (Phase 2) can flag locked
    // POs — a locked PO hard-blocks deletion (see DELETE guard c).
    const [affectedPOs] = await db.query(
      `SELECT id, po_number, wbs_code, status, is_locked FROM purchase_orders
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
    const { code, description, parent_id, rag, ros_date, notes, owner_id, planned_start, planned_end, forecast_start, forecast_end, actual_start, actual_end } = req.body
    if (!code?.trim() || !description?.trim()) {
      return res.status(400).json({ error: 'Code and description are required' })
    }
    const [[dup]] = await db.query('SELECT id FROM wbs_nodes WHERE project_id=? AND code=?', [pid, code.trim()])
    if (dup) return res.status(409).json({ error: `WBS code ${code} already exists in this project` })

    const [r] = await db.query(
      `INSERT INTO wbs_nodes (project_id, parent_id, code, description, rag, ros_date, notes, owner_id, planned_start, planned_end, forecast_start, forecast_end, actual_start, actual_end)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, parent_id || null, code.trim(), description.trim(),
       rag || null, ros_date || null, notes || null, owner_id || null,
       planned_start || null, planned_end || null,
       forecast_start || null, forecast_end || null,
       actual_start || null, actual_end || null]
    )
    audit(req, 'wbs_created', `wbs_nodes/${r.insertId}`, {}, { code, description, project_id: pid })
    const [[created]] = await db.query('SELECT * FROM wbs_nodes WHERE id=?', [r.insertId])
    res.status(201).json(created)
  } catch (e) {
    console.error('[foundational:wbs:create]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/foundational/:projectId/wbs/:id — update node (notes, ros, rag, forecast/actual dates)
router.patch('/:projectId/wbs/:id', async (req, res) => {
  try {
    const id  = Number(req.params.id)
    const pid = Number(req.params.projectId)
    const { notes, ros_date, rag, forecast_start, forecast_end, actual_start, actual_end, planned_start, planned_end } = req.body
    const [[before]] = await db.query('SELECT * FROM wbs_nodes WHERE id=? AND project_id=?', [id, pid])
    if (!before) return res.status(404).json({ error: 'WBS node not found' })

    await db.query(
      `UPDATE wbs_nodes SET
        notes=?, ros_date=?, rag=?,
        planned_start=?, planned_end=?,
        forecast_start=?, forecast_end=?,
        actual_start=?, actual_end=?,
        updated_at=NOW()
       WHERE id=?`,
      [
        notes ?? before.notes,
        ros_date ?? before.ros_date,
        rag ?? before.rag,
        planned_start !== undefined ? (planned_start || null) : before.planned_start,
        planned_end   !== undefined ? (planned_end   || null) : before.planned_end,
        forecast_start !== undefined ? (forecast_start || null) : before.forecast_start,
        forecast_end   !== undefined ? (forecast_end   || null) : before.forecast_end,
        actual_start   !== undefined ? (actual_start   || null) : before.actual_start,
        actual_end     !== undefined ? (actual_end     || null) : before.actual_end,
        id,
      ]
    )
    audit(req, 'wbs_updated', `wbs_nodes/${id}`, before, req.body)
    const [[updated]] = await db.query('SELECT * FROM wbs_nodes WHERE id=?', [id])
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PATCH /api/foundational/:projectId/wbs/:id/reallocate — move PO lines to new WBS
// Step-2 "apply reallocations" call. Hardened (A3 Phase 1):
//   - ONE pooled transaction: either every line moves or none does (no half-apply).
//   - VALIDATE each target newWbsCode exists in this project (else reject the batch).
//   - SCOPE: only move lines that are genuinely affected lines of the node being
//     reallocated FROM — current snapshot = node.code OR LIKE node.code.'%' (precise,
//     dotted-child match; NOT the loose prefix that would catch siblings like 02.011).
//   - REFUSE moving a line whose PO is_locked=1 (consistent with the DELETE locked
//     guard; otherwise reallocate could move a locked line and let a later delete
//     bypass guard c). Hard refuse, no override.
//   - Writes wbs_code_snapshot only (the real link); wbs_id stays as-is/NULL.
router.patch('/:projectId/wbs/:id/reallocate', async (req, res) => {
  const id  = Number(req.params.id)
  const pid = Number(req.params.projectId)
  const { reallocations } = req.body  // [{lineId, newWbsNodeId, newWbsCode}]
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // The node we are reallocating FROM — defines which lines are in scope.
    const [[node]] = await conn.query(
      'SELECT code FROM wbs_nodes WHERE id=? AND project_id=?', [id, pid]
    )
    if (!node) { await conn.rollback(); return res.status(404).json({ error: 'WBS node not found' }) }

    for (const r of (reallocations || [])) {
      // Target WBS must exist in this project.
      const [[target]] = await conn.query(
        'SELECT id FROM wbs_nodes WHERE project_id=? AND code=?', [pid, r.newWbsCode]
      )
      if (!target) {
        await conn.rollback()
        return res.status(400).json({ error: `Target WBS code ${r.newWbsCode} does not exist in this project` })
      }

      // Line must be a genuine affected line of THIS node (project-scoped, precise match).
      const [[ln]] = await conn.query(
        `SELECT l.id, p.po_number, p.is_locked
         FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id
         WHERE l.id=? AND p.project_id=?
           AND (l.wbs_code_snapshot = ? OR l.wbs_code_snapshot LIKE CONCAT(?, '.%'))`,
        [r.lineId, pid, node.code, node.code]
      )
      if (!ln) {
        await conn.rollback()
        return res.status(400).json({ error: `Line ${r.lineId} is not an affected line of WBS ${node.code} — cannot reallocate` })
      }
      if (ln.is_locked === 1) {
        await conn.rollback()
        return res.status(409).json({ error: `Cannot reallocate — line belongs to locked PO ${ln.po_number}.` })
      }

      await conn.query('UPDATE po_lines SET wbs_code_snapshot=? WHERE id=?', [r.newWbsCode, r.lineId])
    }

    await conn.commit()
    res.json({ ok: true })
  } catch (e) {
    await conn.rollback()
    res.status(500).json({ error: e.message })
  } finally {
    conn.release()
  }
})

// DELETE /api/foundational/:projectId/wbs/:id — delete node
// Hardened (A3 Phase 1): a guarded, transactional delete so a node can NEVER be
// removed in a way that orphans PO lines or detaches a locked PO's lines.
// Guard order (most-actionable message first): a) children → c) locked PO → b) orphan lines.
//   a) NO CHILDREN — refuse parent deletion (replaces the prior raw 500 from the
//      parent_id self-FK). User must delete/move children first. No cascade (locked decision 2).
//   c) LOCKED PO — if any affected line belongs to a locked PO, hard refuse (decision 1, no override).
//   b) NO ORPHANED LINES — if any line still references this node (precise exact-or-dotted-child
//      match, decision 3), refuse. Reallocation rewrites the snapshot to a non-matching code,
//      so post-reallocate this guard passes.
// All checks + the delete + audit run in ONE pooled transaction; any failure rolls back
// with ZERO mutation. Pooled connection only — never createConnection().
router.delete('/:projectId/wbs/:id', async (req, res) => {
  const id  = Number(req.params.id)
  const pid = Number(req.params.projectId)
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [[node]] = await conn.query(
      'SELECT * FROM wbs_nodes WHERE id=? AND project_id=? FOR UPDATE', [id, pid]
    )
    if (!node) { await conn.rollback(); return res.status(404).json({ error: 'WBS node not found' }) }

    // GUARD a) NO CHILDREN
    const [[kids]] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM wbs_nodes WHERE parent_id=? AND project_id=?', [id, pid]
    )
    if (kids.cnt > 0) {
      await conn.rollback()
      return res.status(409).json({ error: 'Cannot delete a parent node — delete or move its child nodes first.' })
    }

    // Affected PO lines of THIS node — precise exact-or-dotted-child match (NOT loose prefix).
    const [affected] = await conn.query(
      `SELECT l.id, p.po_number, p.is_locked
       FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id
       WHERE p.project_id=? AND (l.wbs_code_snapshot = ? OR l.wbs_code_snapshot LIKE CONCAT(?, '.%'))`,
      [pid, node.code, node.code]
    )

    // GUARD c) LOCKED PO
    const locked = affected.find(r => r.is_locked === 1)
    if (locked) {
      await conn.rollback()
      return res.status(409).json({ error: `Cannot delete — affected PO ${locked.po_number} is locked. Unlock or reallocate via an authorised process.` })
    }

    // GUARD b) NO ORPHANED LINES
    if (affected.length > 0) {
      await conn.rollback()
      return res.status(409).json({ error: 'Reallocate all affected PO lines before deleting this node.' })
    }

    await conn.query('DELETE FROM wbs_nodes WHERE id=?', [id])
    // Audit row written inside the same transaction (atomic with the delete).
    // Audit row written inside the same transaction (atomic with the delete).
    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, resource, before_value, after_value, ip)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [req.user.id, 'wbs_deleted', 'wbs_nodes', id, (Number(pid) || null), `wbs_nodes/${id}`,
       JSON.stringify(node), JSON.stringify({}), req.ip]
    )

    await conn.commit()
    res.json({ ok: true })
  } catch (e) {
    await conn.rollback()
    console.error('[foundational:wbs:delete]', e.message)
    res.status(500).json({ error: e.message })
  } finally {
    conn.release()
  }
})

// GET /api/foundational/:projectId/wbs/milestones — ROS milestone markers for Gantt
router.get('/:projectId/wbs/milestones', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [rows] = await db.query(
      `SELECT id AS node_id, code, description AS name, ros_date, rag
       FROM wbs_nodes WHERE project_id=? AND ros_date IS NOT NULL ORDER BY ros_date`,
      [pid]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/foundational/:projectId/wbs/template — XLSX download
router.get('/:projectId/wbs/template', async (req, res) => {
  try {
    const wb = XLSX.utils.book_new()

    // ── Main data sheet ───────────────────────────────────────
    const headerStyle = { fill: { fgColor: { rgb: 'E84E0F' } }, font: { bold: true, color: { rgb: 'FFFFFF' } } }
    const headers = ['id','project_id','level','code','description','wbs_string','parent_string','parent_id','WBS Title','wbs.1','wbs.2','wbs.3','wbs.4','wbs.5','wbs.6','wbs.7','wbs.8','ROS']
    const examples = [
      ['','','1','01','Civil & Structural','01','','','Civil & Structural','01','','','','','','','','2025-06-30'],
      ['','','2','01.01','Foundations','01.01','01','','Foundations','01','01','','','','','','','2025-03-31'],
      ['','','3','01.01.01','Piling Works','01.01.01','01.01','','Piling Works','01','01','01','','','','','','2024-12-31'],
      ['','','4','01.01.01.01','Bored Piles','01.01.01.01','01.01.01','','Bored Piles','01','01','01','01','','','','','2024-10-31'],
      ['','','5','01.01.01.01.01','Pile Design','01.01.01.01.01','01.01.01.01','','Pile Design','01','01','01','01','01','','','','2024-08-31'],
    ]
    const wsData = [headers, ...examples]
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Column widths
    ws['!cols'] = headers.map((h,i) => ({ wch: ['description','WBS Title'].includes(h) ? 30 : h.startsWith('wbs') ? 8 : 12 }))
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }  // freeze top row

    // Orange header row styling (xlsx only supports limited styling)
    XLSX.utils.book_append_sheet(wb, ws, 'WBS Template')

    // ── Instructions sheet ────────────────────────────────────
    const instrData = [
      ['Column', 'Required', 'Description'],
      ['id', 'No', 'Leave blank — auto-assigned on import'],
      ['project_id', 'No', 'Leave blank — assigned from project context'],
      ['level', 'Yes', 'Numeric depth (1=top-level, 2=child, 3=grandchild etc.)'],
      ['code', 'Yes', 'Dotted WBS code e.g. 01, 01.01, 01.01.01. Must be unique per project.'],
      ['description', 'Yes', 'Node label / name e.g. "Civil & Structural"'],
      ['wbs_string', 'Yes', 'Same as code — full dotted path'],
      ['parent_string', 'Yes*', 'Parent\'s code. Leave blank for top-level nodes (level=1).'],
      ['parent_id', 'No', 'Leave blank — resolved from parent_string on import'],
      ['WBS Title', 'No', 'Alternate display name (optional)'],
      ['wbs.1 – wbs.8', 'No', 'Individual code segments split by level (auto-split on import)'],
      ['ROS', 'No', 'Required On Site date in YYYY-MM-DD format e.g. 2025-06-30'],
      ['', '', ''],
      ['NOTES', '', ''],
      ['• One row per WBS node', '', ''],
      ['• Codes must be in hierarchical order (parents before children)', '', ''],
      ['• Duplicate codes within a project will cause an error', '', ''],
      ['• Maximum 8 levels of nesting supported', '', ''],
      ['• Date format: YYYY-MM-DD', '', ''],
    ]
    const wsInstr = XLSX.utils.aoa_to_sheet(instrData)
    wsInstr['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Disposition', 'attachment; filename="WBS_Upload_Template.xlsx"')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.send(buf)
  } catch (e) {
    console.error('[wbs:template]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/foundational/:projectId/wbs/validate — validate upload before import
const uploadWBS = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })
router.post('/:projectId/wbs/validate', uploadWBS.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (rows.length < 2) return res.status(400).json({ error: 'File appears empty' })

    const headers = rows[0].map(h => String(h).toLowerCase().trim())
    const codeIdx = headers.findIndex(h => h === 'code')
    const descIdx = headers.findIndex(h => h === 'description')
    const parentIdx = headers.findIndex(h => h === 'parent_string' || h === 'parent_id')
    const rosIdx  = headers.findIndex(h => h === 'ros')

    const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''))
    const seenCodes = new Set()
    const results = []

    for (let i = 0; i < dataRows.length; i++) {
      const r    = dataRows[i]
      const code = codeIdx >= 0 ? String(r[codeIdx] || '').trim() : ''
      const desc = descIdx >= 0 ? String(r[descIdx] || '').trim() : ''
      const parent = parentIdx >= 0 ? String(r[parentIdx] || '').trim() : ''
      const ros  = rosIdx  >= 0 ? String(r[rosIdx]  || '').trim() : ''
      const rowNum = i + 2  // 1-indexed + header

      const errors = []; const warnings = []

      if (!code)  errors.push('Missing WBS code')
      if (!desc)  errors.push('Missing description')
      if (code && seenCodes.has(code)) errors.push(`Duplicate code "${code}"`)

      // Parent must appear before child
      if (parent && !seenCodes.has(parent)) {
        errors.push(`Parent "${parent}" not yet seen — must appear before this row`)
      }

      // Circular reference check: code must not start with itself as prefix
      if (code && parent && (parent === code || parent.startsWith(code + '.'))) {
        errors.push('Circular reference: parent code is same as or child of this code')
      }

      // ROS date format
      if (ros && !/^\d{4}-\d{2}-\d{2}$/.test(ros)) {
        warnings.push(`ROS date "${ros}" should be YYYY-MM-DD format`)
      }

      if (code) seenCodes.add(code)

      results.push({
        row: rowNum, code, description: desc.slice(0, 50), parent, ros,
        status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
        errors, warnings,
      })
    }

    const readyCount   = results.filter(r => r.status === 'ok').length
    const warningCount = results.filter(r => r.status === 'warning').length
    const errorCount   = results.filter(r => r.status === 'error').length

    res.json({ results, summary: { total: results.length, ready: readyCount, warnings: warningCount, errors: errorCount } })
  } catch (e) {
    console.error('[wbs:validate]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/foundational/:projectId/wbs/import — import validated file
router.post('/:projectId/wbs/import', uploadWBS.single('file'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const headers = rows[0].map(h => String(h).toLowerCase().trim())
    const codeIdx  = headers.findIndex(h => h === 'code')
    const descIdx  = headers.findIndex(h => h === 'description')
    const parentIdx = headers.findIndex(h => h === 'parent_string')
    const rosIdx   = headers.findIndex(h => h === 'ros')

    const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''))
    const codeToId = {}
    let imported = 0

    for (const r of dataRows) {
      const code   = String(r[codeIdx] || '').trim()
      const desc   = String(r[descIdx] || '').trim()
      const parent = parentIdx >= 0 ? String(r[parentIdx] || '').trim() : ''
      const ros    = rosIdx >= 0 ? String(r[rosIdx] || '').trim() : ''
      if (!code || !desc) continue

      const parentId = parent && codeToId[parent] ? codeToId[parent] : null
      const [result] = await db.query(
        `INSERT IGNORE INTO wbs_nodes (project_id, parent_id, code, description, ros_date) VALUES (?,?,?,?,?)`,
        [pid, parentId, code, desc, ros || null]
      )
      if (result.insertId) { codeToId[code] = result.insertId; imported++ }
    }
    audit(req, 'wbs_imported', `projects/${pid}`, {}, { imported })
    res.json({ ok: true, imported })
  } catch (e) {
    console.error('[wbs:import]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/foundational/:projectId/wbs/:nodeId/pos — POs referencing this node
router.get('/:projectId/wbs/:nodeId/pos', async (req, res) => {
  try {
    const pid    = Number(req.params.projectId)
    const nodeId = Number(req.params.nodeId)
    const [[node]] = await db.query('SELECT code FROM wbs_nodes WHERE id=?', [nodeId])
    if (!node) return res.status(404).json({ error: 'Node not found' })

    const [pos] = await db.query(
      `SELECT id, po_number, vendor, status, total_value, currency
       FROM purchase_orders
       WHERE project_id=? AND wbs_code=?
       ORDER BY po_number`,
      [pid, node.code]
    )
    res.json(pos)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/foundational/:projectId/wbs/export?ids=1,2,3 — export selected nodes to XLSX
router.get('/:projectId/wbs/export', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean)
    if (!ids.length) return res.status(400).json({ error: 'No IDs provided' })

    const [rows] = await db.query(
      `SELECT w.code, w.description, w.rag, w.ros_date, w.planned_start, w.planned_end,
              w.forecast_start, w.forecast_end, w.actual_start, w.actual_end,
              w.notes, u.full_name AS owner
       FROM wbs_nodes w
       LEFT JOIN users u ON u.id = w.owner_id
       WHERE w.project_id=? AND w.id IN (${ids.map(() => '?').join(',')})
       ORDER BY w.code`,
      [pid, ...ids]
    )

    const wb = XLSX.utils.book_new()
    const headers = ['Code','Description','RAG','ROS Date','Planned Start','Planned End','Forecast Start','Forecast End','Actual Start','Actual End','Owner','Notes']
    const data = [headers, ...rows.map(r => [r.code, r.description, r.rag, r.ros_date, r.planned_start, r.planned_end, r.forecast_start, r.forecast_end, r.actual_start, r.actual_end, r.owner, r.notes])]
    const ws = XLSX.utils.aoa_to_sheet(data)
    ws['!cols'] = headers.map(() => ({ wch: 18 }))
    XLSX.utils.book_append_sheet(wb, ws, 'WBS Export')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Disposition', 'attachment; filename="WBS_Export.xlsx"')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.send(buf)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/foundational/:projectId/wbs/bulk-rag — change RAG for multiple nodes
router.post('/:projectId/wbs/bulk-rag', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { ids, rag } = req.body
    if (!ids?.length) return res.status(400).json({ error: 'No IDs provided' })
    await db.query(
      `UPDATE wbs_nodes SET rag=?, updated_at=NOW() WHERE project_id=? AND id IN (${ids.map(() => '?').join(',')})`,
      [rag, pid, ...ids]
    )
    res.json({ ok: true, updated: ids.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/foundational/:projectId/wbs/bulk-impact — check impact for multiple nodes
// Accepts ?ids=1,2,3
router.get('/:projectId/wbs/bulk-impact', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean)
    if (!ids.length) return res.status(400).json({ error: 'No IDs provided' })

    const results = []
    for (const id of ids) {
      const [[node]] = await db.query('SELECT id, code, description, rag FROM wbs_nodes WHERE id=? AND project_id=?', [id, pid])
      if (!node) continue
      const [[{ child_count }]] = await db.query('SELECT COUNT(*) AS child_count FROM wbs_nodes WHERE parent_id=?', [id])
      const [[{ po_count }]]    = await db.query('SELECT COUNT(*) AS po_count FROM purchase_orders WHERE project_id=? AND wbs_code=?', [pid, node.code])
      const [[{ comm_count }]]  = await db.query('SELECT COUNT(*) AS comm_count FROM commodity_library WHERE wbs_node_id=?', [id])
      const [[{ equip_count }]] = await db.query('SELECT COUNT(*) AS equip_count FROM equipment_list WHERE wbs_node_id=?', [id])
      results.push({ id: node.id, code: node.code, description: node.description, rag: node.rag, childCount: child_count, poCount: po_count, commCount: comm_count, equipCount: equip_count })
    }
    res.json(results)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/foundational/:projectId/wbs/bulk-delete — delete nodes with reason; checks deps first
router.post('/:projectId/wbs/bulk-delete', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { nodeIds, reason, ids } = req.body
    // Support both new nodeIds param and legacy ids param
    const targetIds = nodeIds || ids
    if (!targetIds?.length) return res.status(400).json({ error: 'No IDs provided' })

    // Check for blocked nodes
    const blocked = []
    for (const id of targetIds) {
      const [[node]] = await db.query('SELECT id, code, description FROM wbs_nodes WHERE id=? AND project_id=?', [id, pid])
      if (!node) continue
      const [[{ child_count }]] = await db.query('SELECT COUNT(*) AS child_count FROM wbs_nodes WHERE parent_id=?', [id])
      const [[{ po_count }]]    = await db.query('SELECT COUNT(*) AS po_count FROM purchase_orders WHERE project_id=? AND wbs_code=?', [pid, node.code])
      const [[{ comm_count }]]  = await db.query('SELECT COUNT(*) AS comm_count FROM commodity_library WHERE wbs_node_id=?', [id])
      const [[{ equip_count }]] = await db.query('SELECT COUNT(*) AS equip_count FROM equipment_list WHERE wbs_node_id=?', [id])
      const reasons = []
      if (child_count > 0) reasons.push(`${child_count} child node${child_count !== 1 ? 's' : ''}`)
      if (po_count > 0) reasons.push(`${po_count} PO reference${po_count !== 1 ? 's' : ''}`)
      if (comm_count > 0) reasons.push(`${comm_count} commodity link${comm_count !== 1 ? 's' : ''}`)
      if (equip_count > 0) reasons.push(`${equip_count} equipment link${equip_count !== 1 ? 's' : ''}`)
      if (reasons.length > 0) blocked.push({ id, code: node.code, reason: reasons.join(', ') })
    }

    // If using new nodeIds param and any blocked, return 400
    if (nodeIds && blocked.length > 0) {
      return res.status(400).json({ error: 'Dependencies exist', blocked })
    }

    // Sort by code length DESC to delete children before parents
    const sortedIds = [...targetIds].sort((a, b) => {
      // We'll just delete in reverse order based on what we know
      return b - a
    })

    const deleted = []
    const skipped = []
    for (const id of sortedIds) {
      const [[node]] = await db.query('SELECT code, description FROM wbs_nodes WHERE id=? AND project_id=?', [id, pid])
      if (!node) { skipped.push(id); continue }
      const [[{ child_count }]] = await db.query('SELECT COUNT(*) AS child_count FROM wbs_nodes WHERE parent_id=?', [id])
      const [[{ po_count }]]    = await db.query('SELECT COUNT(*) AS po_count FROM purchase_orders WHERE project_id=? AND wbs_code=?', [pid, node.code])
      const [[{ comm_count }]]  = await db.query('SELECT COUNT(*) AS comm_count FROM commodity_library WHERE wbs_node_id=?', [id])
      const [[{ equip_count }]] = await db.query('SELECT COUNT(*) AS equip_count FROM equipment_list WHERE wbs_node_id=?', [id])
      if (child_count > 0 || po_count > 0 || comm_count > 0 || equip_count > 0) { skipped.push(id); continue }
      await db.query('DELETE FROM wbs_nodes WHERE id=?', [id])
      audit(req, 'wbs_bulk_deleted', `wbs_nodes/${id}`, { code: node.code, description: node.description }, { reason: reason || 'bulk delete' })
      deleted.push(id)
    }
    res.json({ ok: true, deleted, skipped: skipped.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/foundational/:projectId/wbs/:nodeId/readiness — node readiness summary
router.get('/:projectId/wbs/:nodeId/readiness', async (req, res) => {
  try {
    const pid    = Number(req.params.projectId)
    const nodeId = Number(req.params.nodeId)
    const [[node]] = await db.query(
      `SELECT w.*, u.full_name AS owner_name FROM wbs_nodes w LEFT JOIN users u ON u.id = w.owner_id WHERE w.id=? AND w.project_id=?`,
      [nodeId, pid]
    )
    if (!node) return res.status(404).json({ error: 'Node not found' })

    // ─── COMMITTED MATERIALS ─────────────────────────────────────────────────────
    // Sum po_lines.qty where wbs_code_snapshot matches this node OR any child (prefix).
    const [[matRow]] = await db.query(
      `SELECT COALESCE(SUM(l.qty), 0) AS committed
       FROM po_lines l JOIN purchase_orders p ON p.id = l.po_id
       WHERE p.project_id=? AND (l.wbs_code_snapshot=? OR l.wbs_code_snapshot LIKE ?)`,
      [pid, node.code, `${node.code}.%`]
    )

    // ─── POs LINKED TO THIS WBS NODE (exact + children prefix match) ─────────
    // Uses contract_delivery_date (not the deprecated cdd alias) for RAG.
    const today = node.ros_date ? node.ros_date : new Date().toISOString().slice(0, 10)
    const [posRows] = await db.query(
      `SELECT po_number, vendor_name AS supplier_name, status, contract_delivery_date AS cdd, ros_date,
        CASE
          WHEN ros_date IS NOT NULL AND ros_date < ? THEN 'red'
          WHEN contract_delivery_date IS NOT NULL AND contract_delivery_date < ? THEN 'red'
          WHEN contract_delivery_date IS NOT NULL AND contract_delivery_date < DATE_ADD(?, INTERVAL 30 DAY) THEN 'amber'
          ELSE 'green'
        END AS rag
       FROM purchase_orders
       WHERE project_id=? AND (wbs_code=? OR wbs_code LIKE ?)
       ORDER BY contract_delivery_date ASC`,
      [today, today, today, pid, node.code, `${node.code}.%`]
    )

    res.json({
      node,
      materials: { committed: matRow.committed, received: 0, required: 0, outstanding: 0 },
      pos: posRows,
      actions: [],
    })
  } catch (e) {
    console.error('[foundational:wbs:readiness]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// GET /api/foundational/:projectId/wbs/:nodeId/materials — tooltip + panel data
router.get('/:projectId/wbs/:nodeId/materials', async (req, res) => {
  try {
    const pid    = Number(req.params.projectId)
    const nodeId = Number(req.params.nodeId)
    const [[node]] = await db.query('SELECT code FROM wbs_nodes WHERE id=?', [nodeId])
    if (!node) return res.status(404).json({ error: 'Node not found' })

    const [commodities] = await db.query(
      'SELECT code, name, uom FROM commodity_library WHERE project_id=? AND wbs_node_id=? AND status="active" LIMIT 20',
      [pid, nodeId]
    )
    const [equipment] = await db.query(
      'SELECT tag, description, status FROM equipment_list WHERE project_id=? AND wbs_node_id=? LIMIT 20',
      [pid, nodeId]
    )
    res.json({ wbsCode: node.code, commodities, equipment })
  } catch (e) {
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
    // ─── BUG-9: override status with computed_status from po_lines.tag_number ─
    const [rows] = await db.query(
      `SELECT e.id, e.project_id, e.tag, e.equipment_type, e.wbs_code, e.wbs_node_id,
              e.description, e.area_location, e.criticality, e.spec, e.trace_class,
              e.po_reference, e.vendor, e.weight_kg, e.size_lwh, e.notes,
              e.created_by, e.created_at, e.updated_at,
              (SELECT COUNT(*) FROM foundational_certificates fc
               WHERE fc.entity_type='equipment' AND fc.entity_id=e.id) AS cert_count,
              CASE WHEN EXISTS(
                SELECT 1 FROM po_lines pl
                JOIN purchase_orders po ON po.id = pl.po_id
                WHERE po.project_id = e.project_id AND pl.tag_number = e.tag
              ) THEN 'PO raised' ELSE e.status END AS status
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

// ═══════════════════════════════════════════════════════════════
// COMMODITY VALIDATE + IMPORT
// ═══════════════════════════════════════════════════════════════

// POST /api/foundational/:projectId/commodities/validate — validate upload before import
const uploadCommodity = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })
router.post('/:projectId/commodities/validate', uploadCommodity.single('file'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (rows.length < 2) return res.status(400).json({ error: 'File appears empty' })

    // Normalise header names
    const headers = rows[0].map(h => String(h).toLowerCase().trim())
    const col = name => headers.findIndex(h => h === name)
    const codeIdx = col('commodity code')
    const wbsIdx  = col('wbs code')
    const nameIdx = col('name/description') >= 0 ? col('name/description') : col('description')

    const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''))

    // Fetch existing codes + valid WBS codes for this project
    const [existingRows] = await db.query('SELECT code FROM commodity_library WHERE project_id=?', [pid])
    const existingCodes = new Set(existingRows.map(r => r.code.toLowerCase()))
    const [wbsRows] = await db.query('SELECT code FROM wbs_nodes WHERE project_id=?', [pid])
    const validWbs = new Set(wbsRows.map(r => r.code))

    const seenInFile = {}
    const results = []

    for (let i = 0; i < dataRows.length; i++) {
      const r    = dataRows[i]
      const code = codeIdx >= 0 ? String(r[codeIdx] || '').trim() : ''
      const name = nameIdx >= 0 ? String(r[nameIdx] || '').trim() : ''
      const wbs  = wbsIdx  >= 0 ? String(r[wbsIdx]  || '').trim() : ''
      const rowNum = i + 2

      const errors = []; const warnings = []

      if (!code) errors.push('Missing commodity code')
      if (!name) errors.push('Missing name/description')
      if (code && seenInFile[code.toLowerCase()]) errors.push(`Duplicate code "${code}" within this file`)
      if (code) {
        seenInFile[code.toLowerCase()] = true
        if (existingCodes.has(code.toLowerCase())) warnings.push(`Code "${code}" already exists in project (will update)`)
      }
      if (wbs && !validWbs.has(wbs)) warnings.push(`WBS code "${wbs}" not found in project`)

      results.push({
        row: rowNum, code, name: name.slice(0, 60), wbs,
        status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
        errors, warnings,
      })
    }

    const readyCount   = results.filter(r => r.status === 'ok').length
    const warningCount = results.filter(r => r.status === 'warning').length
    const errorCount   = results.filter(r => r.status === 'error').length
    res.json({ results, summary: { total: results.length, ready: readyCount, warnings: warningCount, errors: errorCount } })
  } catch (e) {
    console.error('[commodities:validate]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/foundational/:projectId/commodities/import — import validated file
router.post('/:projectId/commodities/import', uploadCommodity.single('file'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const headers = rows[0].map(h => String(h).toLowerCase().trim())
    const col = name => headers.findIndex(h => h === name)
    const codeIdx = col('commodity code')
    const wbsIdx  = col('wbs code')
    const nameIdx = col('name/description') >= 0 ? col('name/description') : col('description')
    const uomIdx  = col('unit of measure')

    // Resolve WBS node IDs
    const [wbsRows] = await db.query('SELECT id, code FROM wbs_nodes WHERE project_id=?', [pid])
    const wbsMap = {}
    for (const w of wbsRows) wbsMap[w.code] = w.id

    const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''))
    let imported = 0, skipped = 0

    for (const r of dataRows) {
      const code = codeIdx >= 0 ? String(r[codeIdx] || '').trim() : ''
      const name = nameIdx >= 0 ? String(r[nameIdx] || '').trim() : ''
      const wbs  = wbsIdx  >= 0 ? String(r[wbsIdx]  || '').trim() : ''
      const uom  = uomIdx  >= 0 ? String(r[uomIdx]  || '').trim() : 'EA'
      if (!code || !name) { skipped++; continue }
      const wbsNodeId = wbs && wbsMap[wbs] ? wbsMap[wbs] : null
      await db.query(
        `INSERT INTO commodity_library (project_id, code, name, uom, wbs_code, wbs_node_id, created_by)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), uom=VALUES(uom), wbs_code=VALUES(wbs_code), wbs_node_id=VALUES(wbs_node_id)`,
        [pid, code, name, uom || 'EA', wbs || null, wbsNodeId, req.user.id]
      )
      imported++
    }
    audit(req, 'commodities_imported', `projects/${pid}`, {}, { imported, skipped })
    res.json({ ok: true, imported, skipped })
  } catch (e) {
    console.error('[commodities:import]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// COMMODITY TEMPLATE DOWNLOAD
// ═══════════════════════════════════════════════════════════════

// GET /api/foundational/:projectId/commodities/template — XLSX download
// ─── Uses ExcelJS for dropdown data validation support. ──────────────────────
router.get('/:projectId/commodities/template', async (req, res) => {
  try {
    const ExcelJS = require('exceljs')
    const wb = new ExcelJS.Workbook()
    wb.creator = 'QCO MMS'

    // ── Sheet 1: Commodity Template ────────────────────────────────────────────
    const ws = wb.addWorksheet('Commodity Template', { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = [
      { key: 'commodity_code', header: 'Commodity Code', width: 20 },
      { key: 'wbs_code',       header: 'WBS Code',        width: 14 },
      { key: 'name',           header: 'Name/Description', width: 40 },
      { key: 'uom',            header: 'Unit of Measure',  width: 18 },
      { key: 'qty',            header: 'Estimated Qty',    width: 16 },
      { key: 'trace_level',    header: 'Trace Level',      width: 22 },
      { key: 'preservation',   header: 'Preservation',     width: 22 },
      { key: 'vendor',         header: 'Preferred Vendor', width: 22 },
      { key: 'notes',          header: 'Notes',            width: 35 },
    ]

    // Style header row
    const ORANGE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE84E0F' } }
    ws.getRow(1).eachCell(c => {
      c.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' }
      c.fill  = ORANGE
      c.alignment = { vertical: 'middle', horizontal: 'left' }
    })
    ws.getRow(1).height = 22

    // Example rows (grey italic)
    const examples = [
      { commodity_code: 'CS-PLATE-001',  wbs_code: '02.01.01', name: 'Carbon Steel Plate A516 Gr70',  uom: 'T',  qty: '12.5', trace_level: 'heat_number', preservation: 'Dry storage',       vendor: 'LIBERTY Steel',   notes: 'Material cert required' },
      { commodity_code: 'WELD-CONS-001', wbs_code: '02.01.01', name: 'Welding Consumables ER70S-6',   uom: 'KG', qty: '200',  trace_level: 'drum_number',  preservation: 'None',              vendor: 'Lincoln Electric', notes: '' },
      { commodity_code: 'HV-CABLE-001',  wbs_code: '03.01.01', name: 'HV Cable 11kV 3Cx150mm2 XLPE', uom: 'M',  qty: '500',  trace_level: 'drum_number',  preservation: 'Dry storage',       vendor: 'Prysmian',         notes: '' },
    ]
    examples.forEach(ex => {
      const row = ws.addRow(ex)
      row.eachCell(c => { c.font = { italic: true, color: { argb: 'FF94a3b8' }, size: 10, name: 'Calibri' } })
      row.height = 18
    })

    // ─── DROPDOWN VALIDATIONS (rows 2–500, showErrorMessage: false = guide only) ─
    // col D (4) — Unit of Measure
    ws.dataValidations.add('D2:D500', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"EA,NR,KG,T,M,MM,M2,M3,L,KL,SET,LOT,PR,LM,KN"'],
    })
    // col F (6) — Trace Level
    ws.dataValidations.add('F2:F500', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"none,lot,heat_number,drum_number,serial_number"'],
    })
    // col G (7) — Preservation
    ws.dataValidations.add('G2:G500', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"Dry storage,Climate controlled,Outdoor,Bonded,Refrigerated,None"'],
    })

    // ── Sheet 2: Reference (valid values legend) ───────────────────────────────
    const wsRef = wb.addWorksheet('Reference')
    wsRef.getColumn(1).width = 26
    wsRef.getColumn(2).width = 65
    const refTitle = wsRef.getCell('A1')
    refTitle.value = 'QCO MMS — Commodity Template: Valid Values Reference'
    refTitle.font = { bold: true, size: 12, color: { argb: 'FFE84E0F' } }
    wsRef.getRow(1).height = 22
    wsRef.addRow([])
    wsRef.addRow(['Note: These values are suggestions. You may type any value not in this list.'])
      .getCell(1).font = { italic: true, color: { argb: 'FF64748b' }, size: 10 }
    wsRef.addRow([])
    const refData = [
      ['COLUMN', 'VALID VALUES'],
      ['Unit of Measure (col D)', 'EA, NR, KG, T, M, MM, M2, M3, L, KL, SET, LOT, PR, LM, KN'],
      ['Trace Level (col F)',     'none, lot, heat_number, drum_number, serial_number'],
      ['Preservation (col G)',    'Dry storage, Climate controlled, Outdoor, Bonded, Refrigerated, None'],
    ]
    refData.forEach((row, i) => {
      const r = wsRef.addRow(row)
      if (i === 0) r.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } } })
    })

    // ── Sheet 3: Instructions ──────────────────────────────────────────────────
    const wsI = wb.addWorksheet('Instructions')
    wsI.getColumn(1).width = 22
    wsI.getColumn(2).width = 10
    wsI.getColumn(3).width = 60
    const instrData = [
      ['Column', 'Required', 'Description'],
      ['Commodity Code', 'Yes', 'Unique code per project e.g. CS-PLATE-001'],
      ['WBS Code',       'Yes', 'Dotted WBS code this commodity belongs to e.g. 02.01.01'],
      ['Name/Description', 'Yes', 'Material name or description'],
      ['Unit of Measure', 'Yes', 'Select from dropdown or type: EA, M, M2, M3, KG, T, SET, LOT etc.'],
      ['Estimated Qty',  'No',  'Estimated quantity (numeric)'],
      ['Trace Level',    'No',  'Select from dropdown: none | lot | heat_number | drum_number | serial_number'],
      ['Preservation',   'No',  'Select from dropdown: Dry storage | Climate controlled | Outdoor | Bonded | Refrigerated | None'],
      ['Preferred Vendor', 'No', 'Preferred vendor name (optional)'],
      ['Notes',          'No',  'Additional notes (optional)'],
    ]
    instrData.forEach((row, i) => {
      const r = wsI.addRow(row)
      if (i === 0) r.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = ORANGE })
    })

    res.setHeader('Content-Disposition', 'attachment; filename="Commodity_Upload_Template.xlsx"')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    await wb.xlsx.write(res)
    res.end()
  } catch (e) {
    console.error('[commodities:template]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// EQUIPMENT VALIDATE + IMPORT
// ═══════════════════════════════════════════════════════════════

// POST /api/foundational/:projectId/equipment/validate — validate upload before import
const uploadEquipment = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })
router.post('/:projectId/equipment/validate', uploadEquipment.single('file'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (rows.length < 2) return res.status(400).json({ error: 'File appears empty' })

    const headers = rows[0].map(h => String(h).toLowerCase().trim())
    const col = name => headers.findIndex(h => h === name)
    const tagIdx  = col('equipment tag')
    const descIdx = col('description')
    const wbsIdx  = col('wbs code')

    const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''))

    const [existingRows] = await db.query('SELECT tag FROM equipment_list WHERE project_id=?', [pid])
    const existingTags = new Set(existingRows.map(r => r.tag.toLowerCase()))
    const [wbsRows] = await db.query('SELECT code FROM wbs_nodes WHERE project_id=?', [pid])
    const validWbs = new Set(wbsRows.map(r => r.code))

    const seenInFile = {}
    const results = []

    for (let i = 0; i < dataRows.length; i++) {
      const r    = dataRows[i]
      const tag  = tagIdx  >= 0 ? String(r[tagIdx]  || '').trim() : ''
      const desc = descIdx >= 0 ? String(r[descIdx] || '').trim() : ''
      const wbs  = wbsIdx  >= 0 ? String(r[wbsIdx]  || '').trim() : ''
      const rowNum = i + 2

      const errors = []; const warnings = []

      if (!tag)  errors.push('Missing equipment tag')
      if (!desc) errors.push('Missing description')
      if (tag && seenInFile[tag.toLowerCase()]) errors.push(`Duplicate tag "${tag}" within this file`)
      if (tag) {
        seenInFile[tag.toLowerCase()] = true
        if (existingTags.has(tag.toLowerCase())) warnings.push(`Tag "${tag}" already exists in project (will update)`)
      }
      if (wbs && !validWbs.has(wbs)) warnings.push(`WBS code "${wbs}" not found in project`)

      results.push({
        row: rowNum, tag, description: desc.slice(0, 60), wbs,
        status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
        errors, warnings,
      })
    }

    const readyCount   = results.filter(r => r.status === 'ok').length
    const warningCount = results.filter(r => r.status === 'warning').length
    const errorCount   = results.filter(r => r.status === 'error').length
    res.json({ results, summary: { total: results.length, ready: readyCount, warnings: warningCount, errors: errorCount } })
  } catch (e) {
    console.error('[equipment:validate]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /api/foundational/:projectId/equipment/import — import validated file
router.post('/:projectId/equipment/import', uploadEquipment.single('file'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const headers = rows[0].map(h => String(h).toLowerCase().trim())
    const col = name => headers.findIndex(h => h === name)
    const tagIdx   = col('equipment tag')
    const typeIdx  = col('equipment type')
    const wbsIdx   = col('wbs code')
    const descIdx  = col('description')
    const areaIdx  = col('area/location')
    const critIdx  = col('criticality')
    const poIdx    = col('po reference')
    const vendIdx  = col('vendor')
    const wtIdx    = col('weight (kg)')
    const sizeIdx  = col('overall size (lxwxh)')
    const notesIdx = col('notes')

    const [wbsRows] = await db.query('SELECT id, code FROM wbs_nodes WHERE project_id=?', [pid])
    const wbsMap = {}
    for (const w of wbsRows) wbsMap[w.code] = w.id

    const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''))
    let imported = 0, skipped = 0

    for (const r of dataRows) {
      const tag  = tagIdx  >= 0 ? String(r[tagIdx]  || '').trim() : ''
      const desc = descIdx >= 0 ? String(r[descIdx] || '').trim() : ''
      const wbs  = wbsIdx  >= 0 ? String(r[wbsIdx]  || '').trim() : ''
      if (!tag || !desc) { skipped++; continue }
      const wbsNodeId = wbs && wbsMap[wbs] ? wbsMap[wbs] : null
      const equipType = typeIdx >= 0 ? String(r[typeIdx] || '').trim() || 'Vessel' : 'Vessel'
      await db.query(
        `INSERT INTO equipment_list (project_id, tag, equipment_type, wbs_code, wbs_node_id, description, area_location, criticality, po_reference, vendor, weight_kg, size_lwh, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE description=VALUES(description), equipment_type=VALUES(equipment_type), wbs_code=VALUES(wbs_code), wbs_node_id=VALUES(wbs_node_id)`,
        [pid, tag, equipType, wbs || null, wbsNodeId, desc,
         areaIdx  >= 0 ? (String(r[areaIdx]  || '').trim() || null) : null,
         critIdx  >= 0 ? (String(r[critIdx]  || '').trim() || 'C-Standard') : 'C-Standard',
         poIdx    >= 0 ? (String(r[poIdx]    || '').trim() || null) : null,
         vendIdx  >= 0 ? (String(r[vendIdx]  || '').trim() || null) : null,
         wtIdx    >= 0 ? (Number(r[wtIdx]) || null) : null,
         sizeIdx  >= 0 ? (String(r[sizeIdx] || '').trim() || null) : null,
         notesIdx >= 0 ? (String(r[notesIdx]|| '').trim() || null) : null,
         req.user.id]
      )
      imported++
    }
    audit(req, 'equipment_imported', `projects/${pid}`, {}, { imported, skipped })
    res.json({ ok: true, imported, skipped })
  } catch (e) {
    console.error('[equipment:import]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// EQUIPMENT TEMPLATE DOWNLOAD
// ═══════════════════════════════════════════════════════════════

// GET /api/foundational/:projectId/equipment/template — XLSX download
// ─── Uses ExcelJS for dropdown data validation support. ──────────────────────
router.get('/:projectId/equipment/template', async (req, res) => {
  try {
    const ExcelJS = require('exceljs')
    const wb = new ExcelJS.Workbook()
    wb.creator = 'QCO MMS'

    // ── Sheet 1: Equipment Template ────────────────────────────────────────────
    const ws = wb.addWorksheet('Equipment Template', { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = [
      { key: 'tag',         header: 'Equipment Tag',        width: 18 },
      { key: 'type',        header: 'Equipment Type',       width: 22 },
      { key: 'wbs_code',    header: 'WBS Code',             width: 14 },
      { key: 'description', header: 'Description',          width: 35 },
      { key: 'location',    header: 'Area/Location',        width: 18 },
      { key: 'criticality', header: 'Criticality',          width: 16 },
      { key: 'po_ref',      header: 'PO Reference',         width: 18 },
      { key: 'vendor',      header: 'Vendor',               width: 20 },
      { key: 'weight',      header: 'Weight (kg)',          width: 14 },
      { key: 'size',        header: 'Overall Size (LxWxH)', width: 22 },
      { key: 'notes',       header: 'Notes',                width: 30 },
    ]

    // Style header row
    const ORANGE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE84E0F' } }
    ws.getRow(1).eachCell(c => {
      c.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' }
      c.fill  = ORANGE
      c.alignment = { vertical: 'middle', horizontal: 'left' }
    })
    ws.getRow(1).height = 22

    // Example rows (grey italic)
    const examples = [
      { tag: 'V-101',  type: 'Vessel', wbs_code: '02.01.01', description: 'HP Separator 1st Stage',      location: 'Train 1',    criticality: 'A-Critical', po_ref: 'PO-2024-003', vendor: 'GHD Fabricators', weight: '12500', size: '4500x2200x2200', notes: 'ASME VIII Div 1' },
      { tag: 'P-101A', type: 'Pump',   wbs_code: '02.02.01', description: 'Feed Pump — Duty',             location: 'Pump Stn',   criticality: 'A-Critical', po_ref: 'PO-TEST-001', vendor: 'Flowserve',       weight: '850',   size: '1200x500x700',   notes: 'API 610 OH2' },
      { tag: 'SW-001', type: 'Panel',  wbs_code: '03.01.01', description: '11kV MV Switchboard Panel A', location: 'Substation', criticality: 'A-Critical', po_ref: 'PO-2024-004', vendor: 'ABB',             weight: '2100',  size: '2100x600x2300',  notes: 'IEC 62271-200' },
    ]
    examples.forEach(ex => {
      const row = ws.addRow(ex)
      row.eachCell(c => { c.font = { italic: true, color: { argb: 'FF94a3b8' }, size: 10, name: 'Calibri' } })
      row.height = 18
    })

    // ─── DROPDOWN VALIDATIONS (rows 2–500, showErrorMessage: false = guide only) ─
    // col B (2) — Equipment Type
    ws.dataValidations.add('B2:B500', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"Vessel,Pump,Compressor,Heat exchanger,Tank,Filter,Valve,Motor,Skid,Instrument,Pipe spool,Structural,Cable drum,Panel,Package"'],
    })
    // col F (6) — Criticality
    ws.dataValidations.add('F2:F500', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"A-Critical,B-Major,C-Standard"'],
    })

    // ── Sheet 2: Reference (valid values legend) ───────────────────────────────
    const wsRef = wb.addWorksheet('Reference')
    wsRef.getColumn(1).width = 28
    wsRef.getColumn(2).width = 70
    const refTitle = wsRef.getCell('A1')
    refTitle.value = 'QCO MMS — Equipment Template: Valid Values Reference'
    refTitle.font = { bold: true, size: 12, color: { argb: 'FFE84E0F' } }
    wsRef.getRow(1).height = 22
    wsRef.addRow([])
    wsRef.addRow(['Note: These values are suggestions. You may type any value not in this list.'])
      .getCell(1).font = { italic: true, color: { argb: 'FF64748b' }, size: 10 }
    wsRef.addRow([])
    const refData = [
      ['COLUMN', 'VALID VALUES'],
      ['Equipment Type (col B)', 'Vessel, Pump, Compressor, Heat exchanger, Tank, Filter, Valve, Motor, Skid, Instrument, Pipe spool, Structural, Cable drum, Panel, Package'],
      ['Criticality (col F)',    'A-Critical, B-Major, C-Standard'],
    ]
    refData.forEach((row, i) => {
      const r = wsRef.addRow(row)
      if (i === 0) r.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } } })
    })

    // ── Sheet 3: Instructions ──────────────────────────────────────────────────
    const wsI = wb.addWorksheet('Instructions')
    wsI.getColumn(1).width = 24
    wsI.getColumn(2).width = 10
    wsI.getColumn(3).width = 80
    const instrData = [
      ['Column', 'Required', 'Description'],
      ['Equipment Tag',    'Yes', 'Unique tag number per project e.g. V-101, P-101A, SW-001'],
      ['Equipment Type',   'Yes', 'Select from dropdown: Vessel | Pump | Compressor | Heat exchanger | Tank | Filter | Valve | Motor | Skid | Instrument | Pipe spool | Structural | Cable drum | Panel | Package'],
      ['WBS Code',         'Yes', 'Dotted WBS code this equipment belongs to e.g. 02.01.01'],
      ['Description',      'Yes', 'Equipment description'],
      ['Area/Location',    'No',  'Area or location tag e.g. Train 1, Substation, Pump Stn'],
      ['Criticality',      'No',  'Select from dropdown: A-Critical | B-Major | C-Standard'],
      ['PO Reference',     'No',  'PO number if already raised e.g. PO-2024-003'],
      ['Vendor',           'No',  'Equipment vendor or manufacturer'],
      ['Weight (kg)',      'No',  'Approximate weight in kilograms (numeric)'],
      ['Overall Size (LxWxH)', 'No', 'Approximate envelope dimensions in mm e.g. 4500x2200x2200'],
      ['Notes',            'No',  'Any relevant notes, specs or references'],
    ]
    instrData.forEach((row, i) => {
      const r = wsI.addRow(row)
      if (i === 0) r.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = ORANGE })
    })

    res.setHeader('Content-Disposition', 'attachment; filename="Equipment_Upload_Template.xlsx"')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    await wb.xlsx.write(res)
    res.end()
  } catch (e) {
    console.error('[equipment:template]', e.message)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
