// ─── MTO REGISTER ROUTES ──────────────────────────────────────────────────────
// Handles MTO list, detail, line items (CRUD), revision history, revision diff,
// and file upload for new revisions.
// All routes require a valid JWT (enforced via authenticateToken middleware).
// Security: parameterised queries only.
// Auditability: every mutating action writes to audit_log.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken } = require('../middleware/auth')
const multer  = require('multer')
const XLSX    = require('xlsx')

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
router.use(authenticateToken)

// ─── FILE UPLOAD CONFIG ───────────────────────────────────────────────────────
// New-revision files accepted in memory buffer — parsed then discarded.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'text/csv'
      || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || file.originalname.endsWith('.csv')
      || file.originalname.endsWith('.xlsx')
    if (ok) cb(null, true)
    else cb(new Error('Only CSV or XLSX files are accepted'))
  },
})

// ─── AUDIT HELPER ────────────────────────────────────────────────────────────
// Non-blocking — errors are logged to console only.
function audit(req, action, entityType, entityId, before = null, after = null) {
  db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, before_value, after_value, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user?.id ?? null, action, entityType, entityId,
     before ? JSON.stringify(before) : null,
     after  ? JSON.stringify(after)  : null,
     req.ip ?? null]
  ).catch(e => console.warn('audit_log insert failed:', e.message))
}

// ─── NEXT REVISION HELPER ────────────────────────────────────────────────────
// Returns the letter after the supplied revision (A→B, B→C, …, Z→AA).
function nextRevision(current) {
  if (!current) return 'B'
  const upper = current.toUpperCase()
  if (upper === 'Z') return 'AA'
  return String.fromCharCode(upper.charCodeAt(upper.length - 1) + 1)
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIST / CREATE
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /:projectId — list all MTO registers for a project ──────────────────
router.get('/:projectId', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, project_id, name, reference, current_revision, owner, description,
              status, line_count, created_by, created_at, updated_at
       FROM mto_registers
       WHERE project_id = ?
       ORDER BY status DESC, reference ASC`,
      [req.params.projectId]
    )
    res.json(rows)
  } catch (e) {
    console.error('GET /mto/:projectId', e.message)
    res.status(500).json({ error: 'Failed to load MTO registers' })
  }
})

// ─── POST /:projectId — create a new MTO register ────────────────────────────
router.post('/:projectId', async (req, res) => {
  const { name, reference, current_revision, owner, description } = req.body
  if (!name || !reference) return res.status(400).json({ error: 'name and reference are required' })
  try {
    const [result] = await db.query(
      `INSERT INTO mto_registers (project_id, name, reference, current_revision, owner, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.projectId, name, reference, current_revision || 'A', owner || null, description || null, req.user.id]
    )
    const newId = result.insertId

    // Seed the first revision record
    await db.query(
      `INSERT INTO mto_revisions (mto_id, revision, uploaded_by, notes, line_count)
       VALUES (?, ?, ?, ?, 0)`,
      [newId, current_revision || 'A', req.user.id, 'Initial revision']
    )

    const [[mto]] = await db.query(`SELECT * FROM mto_registers WHERE id = ?`, [newId])
    audit(req, 'CREATE', 'mto_register', newId, null, mto)
    res.status(201).json(mto)
  } catch (e) {
    console.error('POST /mto/:projectId', e.message)
    res.status(500).json({ error: 'Failed to create MTO register' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE MTO — DETAIL + LINES + REVISIONS + DIFF
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /:projectId/:mtoId — MTO detail with current revision lines ──────────
router.get('/:projectId/:mtoId', async (req, res) => {
  try {
    const [[mto]] = await db.query(
      `SELECT * FROM mto_registers WHERE id = ? AND project_id = ?`,
      [req.params.mtoId, req.params.projectId]
    )
    if (!mto) return res.status(404).json({ error: 'MTO not found' })

    const [lines] = await db.query(
      `SELECT * FROM mto_lines
       WHERE mto_id = ? AND revision = ? AND is_deleted = 0
       ORDER BY line_number ASC`,
      [mto.id, mto.current_revision]
    )
    res.json({ ...mto, lines })
  } catch (e) {
    console.error('GET /mto/:projectId/:mtoId', e.message)
    res.status(500).json({ error: 'Failed to load MTO detail' })
  }
})

// ─── GET /:projectId/:mtoId/lines?revision=X — lines for a specific revision ──
router.get('/:projectId/:mtoId/lines', async (req, res) => {
  try {
    const [[mto]] = await db.query(
      `SELECT * FROM mto_registers WHERE id = ? AND project_id = ?`,
      [req.params.mtoId, req.params.projectId]
    )
    if (!mto) return res.status(404).json({ error: 'MTO not found' })

    const revision = req.query.revision || mto.current_revision
    const [lines] = await db.query(
      `SELECT * FROM mto_lines
       WHERE mto_id = ? AND revision = ? AND is_deleted = 0
       ORDER BY line_number ASC`,
      [mto.id, revision]
    )
    res.json(lines)
  } catch (e) {
    console.error('GET /mto/:projectId/:mtoId/lines', e.message)
    res.status(500).json({ error: 'Failed to load lines' })
  }
})

// ─── GET /:projectId/:mtoId/revisions — revision history ─────────────────────
router.get('/:projectId/:mtoId/revisions', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.id, r.mto_id, r.revision, r.notes, r.line_count, r.created_at,
              u.full_name AS uploaded_by_name
       FROM mto_revisions r
       LEFT JOIN users u ON u.id = r.uploaded_by
       WHERE r.mto_id = ?
       ORDER BY r.created_at ASC`,
      [req.params.mtoId]
    )
    res.json(rows)
  } catch (e) {
    console.error('GET /mto/:projectId/:mtoId/revisions', e.message)
    res.status(500).json({ error: 'Failed to load revisions' })
  }
})

// ─── GET /:projectId/:mtoId/diff?from=A&to=B — compare two revisions ──────────
// Returns: { added, modified, deleted, unchanged }
// A line is "added"    if line_number exists in 'to' but not 'from'.
// A line is "deleted"  if line_number exists in 'from' but not 'to'.
// A line is "modified" if it exists in both but qty/wbs/description/ros_date/
//                      inspection_class changed.
router.get('/:projectId/:mtoId/diff', async (req, res) => {
  const { from, to } = req.query
  if (!from || !to) return res.status(400).json({ error: 'from and to revision params required' })
  try {
    const [fromLines] = await db.query(
      `SELECT * FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0`,
      [req.params.mtoId, from]
    )
    const [toLines] = await db.query(
      `SELECT * FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0`,
      [req.params.mtoId, to]
    )

    const fromMap = new Map(fromLines.map(l => [l.line_number, l]))
    const toMap   = new Map(toLines.map(l => [l.line_number, l]))

    const added    = []
    const deleted  = []
    const modified = []
    let   unchanged = 0

    // Lines in 'to' — check if new or modified
    for (const [ln, line] of toMap) {
      if (!fromMap.has(ln)) {
        added.push(line)
      } else {
        const prev = fromMap.get(ln)
        const changes = {}
        const FIELDS = ['description','quantity','wbs_code','ros_date','inspection_class','uom']
        for (const f of FIELDS) {
          const pv = prev[f] == null ? null : String(prev[f])
          const nv = line[f] == null ? null : String(line[f])
          if (pv !== nv) changes[f] = { from: prev[f], to: line[f] }
        }
        if (Object.keys(changes).length > 0) {
          modified.push({ ...line, changes })
        } else {
          unchanged++
        }
      }
    }

    // Lines in 'from' not in 'to' — deleted
    for (const [ln, line] of fromMap) {
      if (!toMap.has(ln)) deleted.push(line)
    }

    res.json({ added, modified, deleted, unchanged })
  } catch (e) {
    console.error('GET /mto/:projectId/:mtoId/diff', e.message)
    res.status(500).json({ error: 'Failed to compute diff' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// LINE ITEM CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /:projectId/:mtoId/lines — add a line to current revision ───────────
router.post('/:projectId/:mtoId/lines', async (req, res) => {
  try {
    const [[mto]] = await db.query(
      `SELECT * FROM mto_registers WHERE id = ? AND project_id = ?`,
      [req.params.mtoId, req.params.projectId]
    )
    if (!mto) return res.status(404).json({ error: 'MTO not found' })

    const { line_number, wbs_code, description, quantity, uom, ros_date,
            inspection_class, vdrl_required, po_ref, status } = req.body
    if (!line_number || !description) {
      return res.status(400).json({ error: 'line_number and description are required' })
    }

    const [result] = await db.query(
      `INSERT INTO mto_lines
       (mto_id, revision, line_number, wbs_code, description, quantity, uom,
        ros_date, inspection_class, vdrl_required, po_ref, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [mto.id, mto.current_revision, line_number, wbs_code || null, description,
       quantity || null, uom || null, ros_date || null,
       inspection_class || 'Class II', vdrl_required ? 1 : 0,
       po_ref || null, status || 'not-started']
    )

    // Update line_count on register
    await db.query(
      `UPDATE mto_registers SET line_count = (
         SELECT COUNT(*) FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0
       ) WHERE id = ?`,
      [mto.id, mto.current_revision, mto.id]
    )

    const [[line]] = await db.query(`SELECT * FROM mto_lines WHERE id = ?`, [result.insertId])
    audit(req, 'CREATE', 'mto_line', result.insertId, null, line)
    res.status(201).json(line)
  } catch (e) {
    console.error('POST /mto/:projectId/:mtoId/lines', e.message)
    res.status(500).json({ error: 'Failed to add line' })
  }
})

// ─── PUT /:projectId/:mtoId/lines/:lineId — update a line ────────────────────
router.put('/:projectId/:mtoId/lines/:lineId', async (req, res) => {
  try {
    const [[line]] = await db.query(
      `SELECT l.* FROM mto_lines l
       JOIN mto_registers r ON r.id = l.mto_id
       WHERE l.id = ? AND r.project_id = ?`,
      [req.params.lineId, req.params.projectId]
    )
    if (!line) return res.status(404).json({ error: 'Line not found' })

    // Locked lines (po-raised) can only update ros_date, vdrl_required, notes
    const locked = line.status === 'po-raised'
    const { line_number, wbs_code, description, quantity, uom, ros_date,
            inspection_class, vdrl_required, po_ref, status } = req.body

    let sql, params
    if (locked) {
      sql = `UPDATE mto_lines SET ros_date = ?, vdrl_required = ? WHERE id = ?`
      params = [ros_date ?? line.ros_date, vdrl_required != null ? (vdrl_required ? 1 : 0) : line.vdrl_required, line.id]
    } else {
      sql = `UPDATE mto_lines SET
               line_number = ?, wbs_code = ?, description = ?, quantity = ?, uom = ?,
               ros_date = ?, inspection_class = ?, vdrl_required = ?, po_ref = ?, status = ?
             WHERE id = ?`
      params = [
        line_number ?? line.line_number,
        wbs_code    ?? line.wbs_code,
        description ?? line.description,
        quantity    ?? line.quantity,
        uom         ?? line.uom,
        ros_date    ?? line.ros_date,
        inspection_class ?? line.inspection_class,
        vdrl_required != null ? (vdrl_required ? 1 : 0) : line.vdrl_required,
        po_ref      ?? line.po_ref,
        status      ?? line.status,
        line.id
      ]
    }

    await db.query(sql, params)
    const [[updated]] = await db.query(`SELECT * FROM mto_lines WHERE id = ?`, [line.id])
    audit(req, 'UPDATE', 'mto_line', line.id, line, updated)
    res.json(updated)
  } catch (e) {
    console.error('PUT /mto/:projectId/:mtoId/lines/:lineId', e.message)
    res.status(500).json({ error: 'Failed to update line' })
  }
})

// ─── DELETE /:projectId/:mtoId/lines/:lineId — soft-delete a line ─────────────
router.delete('/:projectId/:mtoId/lines/:lineId', async (req, res) => {
  try {
    const [[line]] = await db.query(
      `SELECT l.* FROM mto_lines l
       JOIN mto_registers r ON r.id = l.mto_id
       WHERE l.id = ? AND r.project_id = ?`,
      [req.params.lineId, req.params.projectId]
    )
    if (!line) return res.status(404).json({ error: 'Line not found' })
    if (line.status === 'po-raised') {
      return res.status(403).json({ error: 'Cannot delete a line with a raised PO' })
    }

    await db.query(`UPDATE mto_lines SET is_deleted = 1 WHERE id = ?`, [line.id])

    // Refresh line_count
    await db.query(
      `UPDATE mto_registers SET line_count = (
         SELECT COUNT(*) FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0
       ) WHERE id = ?`,
      [line.mto_id, line.revision, line.mto_id]
    )

    audit(req, 'DELETE', 'mto_line', line.id, line, null)
    res.json({ ok: true })
  } catch (e) {
    console.error('DELETE /mto/:projectId/:mtoId/lines/:lineId', e.message)
    res.status(500).json({ error: 'Failed to delete line' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD NEW REVISION
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /:projectId/:mtoId/upload — upload XLSX/CSV as new revision ─────────
// Expected columns (case-insensitive):
//   line_number, wbs_code, description, quantity, uom, ros_date,
//   inspection_class, vdrl_required, po_ref, status
router.post('/:projectId/:mtoId/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const [[mto]] = await db.query(
      `SELECT * FROM mto_registers WHERE id = ? AND project_id = ?`,
      [req.params.mtoId, req.params.projectId]
    )
    if (!mto) return res.status(404).json({ error: 'MTO not found' })

    const newRev   = req.body.revision || nextRevision(mto.current_revision)
    const notes    = req.body.notes    || `Rev ${newRev} upload`

    // ─── Parse workbook ───────────────────────────────────────────
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null })

    if (!rows.length) return res.status(400).json({ error: 'File is empty or unreadable' })

    // ─── Normalise header keys ─────────────────────────────────────
    function norm(key) { return key.trim().toLowerCase().replace(/\s+/g, '_') }
    const lines = rows.map(row => {
      const n = {}
      for (const [k, v] of Object.entries(row)) n[norm(k)] = v
      return n
    })

    // ─── Insert new revision record ───────────────────────────────
    await db.query(
      `INSERT INTO mto_revisions (mto_id, revision, uploaded_by, notes, line_count)
       VALUES (?, ?, ?, ?, ?)`,
      [mto.id, newRev, req.user.id, notes, lines.length]
    )

    // ─── Insert lines ──────────────────────────────────────────────
    for (const l of lines) {
      if (!l.line_number || !l.description) continue
      await db.query(
        `INSERT INTO mto_lines
         (mto_id, revision, line_number, wbs_code, description, quantity, uom,
          ros_date, inspection_class, vdrl_required, po_ref, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mto.id, newRev,
         String(l.line_number),
         l.wbs_code     || null,
         String(l.description),
         l.quantity     || null,
         l.uom          || null,
         l.ros_date     || null,
         l.inspection_class || 'Class II',
         l.vdrl_required ? 1 : 0,
         l.po_ref       || null,
         l.status       || 'not-started']
      )
    }

    // ─── Promote current revision on register ─────────────────────
    await db.query(
      `UPDATE mto_registers
       SET current_revision = ?, line_count = ?, updated_at = NOW()
       WHERE id = ?`,
      [newRev, lines.length, mto.id]
    )

    audit(req, 'UPLOAD_REVISION', 'mto_register', mto.id, { revision: mto.current_revision }, { revision: newRev })
    res.json({ ok: true, revision: newRev, linesImported: lines.length })
  } catch (e) {
    console.error('POST /mto/:projectId/:mtoId/upload', e.message)
    res.status(500).json({ error: e.message || 'Upload failed' })
  }
})

module.exports = router
