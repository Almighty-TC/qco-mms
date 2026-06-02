// ─── PROCUREMENT ROUTES ───────────────────────────────────────────────────────
// Handles PO list, PO detail, line items, expeditor assignment, critical path,
// bulk upload, signed PO documents, approval chain, duplicate checks.
// All routes require a valid JWT (enforced in index.js).
// Security: parameterised queries only, role scoping enforced at API level.
// Auditability: every mutating action writes to audit_log with before/after.
const express = require('express')
const router  = express.Router()
const db      = require('../db')       // connection pool — never createConnection
const path    = require('path')
const fs      = require('fs')
const multer  = require('multer')

// ─── FILE UPLOAD CONFIG ───────────────────────────────────────────────────────
// PO documents stored in server/uploads/po_documents/<poId>/<filename>
// Max 50 MB; PDF, DOC, DOCX only for signed PO.
// Bulk upload CSV/XLSX stored temporarily then deleted after processing.
const uploadDir = path.join(__dirname, '..', 'uploads', 'po_documents')
fs.mkdirSync(uploadDir, { recursive: true })

const poDocStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadDir, String(req.params.id || 'tmp'))
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    // Prefix with timestamp to avoid collisions
    const ts   = Date.now()
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
    cb(null, `${ts}_${safe}`)
  },
})
const uploadPoDoc = multer({
  storage: poDocStorage,
  limits:  { fileSize: 50 * 1024 * 1024 },   // 50 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error('Only PDF, DOC, DOCX files are accepted for signed POs'))
  },
})

// Bulk upload: accept CSV or XLSX
const bulkUploadStorage = multer.memoryStorage()   // buffer in memory — parse then discard
const uploadBulk = multer({
  storage: bulkUploadStorage,
  limits:  { fileSize: 10 * 1024 * 1024 },   // 10 MB
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'text/csv'
      || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || file.originalname.endsWith('.csv')
      || file.originalname.endsWith('.xlsx')
    if (ok) cb(null, true)
    else cb(new Error('Only CSV or XLSX files are accepted'))
  },
})

// ─── ALLOWED ROLES ────────────────────────────────────────────────────────────
const EXPEDITOR_ASSIGN_ROLES  = new Set(['admin', 'procurement_manager', 'expediting_manager'])
const CRITICAL_PATH_ROLES     = new Set(['admin', 'project_manager', 'procurement_manager'])
const APPROVAL_ROLES          = new Set(['admin', 'procurement_manager', 'procurement_officer'])
const DOC_UPLOAD_ROLES        = new Set(['admin', 'procurement_manager', 'procurement_officer'])

// ─── PAGINATION HELPER ────────────────────────────────────────────────────────
function paginate(query) {
  const page  = Math.max(1, parseInt(query.page  || '1', 10))
  const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10)))
  return { page, limit, offset: (page - 1) * limit }
}

// ─── AUDIT HELPER ─────────────────────────────────────────────────────────────
// Writes to audit_log — non-blocking, errors logged to console only.
// Fire-and-forget (callers do NOT await). project_id resolution:
//   - use explicit `projectId` when a caller supplies it; else
//   - derive it PROVABLY from a `purchase_orders/<id>` reference in `resource`
//     (structured id → real join to purchase_orders.project_id; never a free-text guess);
//   - otherwise NULL.
async function audit(req, action, resource, before = null, after = null, entityType = 'purchase_order', projectId = null) {
  try {
    const userId = req.user?.id ?? null
    const ip     = req.ip ?? null
    let pid = Number(projectId) || null
    if (pid == null) {
      const m = /(?:^|\/)purchase_orders\/(\d+)/.exec(resource || '')
      if (m) {
        const [[po]] = await db.query('SELECT project_id FROM purchase_orders WHERE id=?', [Number(m[1])])
        pid = po?.project_id ?? null
      }
    }
    await db.query(
      `INSERT INTO audit_log (user_id, action, entity_type, project_id, resource, ip, before_value, after_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, action, entityType, pid, resource, ip,
       before ? JSON.stringify(before) : null,
       after  ? JSON.stringify(after)  : null]
    )
  } catch (e) { console.error('[audit]', action, resource, e.message) }
}

// ─── RAG COMPUTATION ──────────────────────────────────────────────────────────
// Item 1: Uses configurable at_risk_days_threshold from project settings.
// green  = no CDD, or CDD > threshold days away, or status closed/complete
// amber  = CDD within threshold days (configurable, default 30)
// red    = CDD in the past and PO not closed
function computeRag(cdd, status, atRiskDays = 30) {
  if (!cdd || status === 'closed' || status === 'complete') return 'green'
  const today   = new Date(); today.setHours(0, 0, 0, 0)
  const cddDate = new Date(cdd); cddDate.setHours(0, 0, 0, 0)
  const diff    = (cddDate - today) / 86400000   // days
  if (diff < 0)          return 'red'
  if (diff <= atRiskDays) return 'amber'
  return 'green'
}

// ─── STATUS LABELS ────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  rfq:                        'Pending approval',
  loa:                        'Letter of Award',
  'po-raised':                'Approved & Locked',
  active:                     'Active',
  closed:                     'Complete',
  cancelled:                  'Cancelled',
  on_hold:                    'On Hold',
  pending_approval:           'Pending Approval',
  pending_director_approval:  'Pending Director',
  approved:                   'Approved & Locked',
  rejected:                   'Rejected',
  draft:                      'Draft',
}

// ─── PROJECT SETTINGS HELPER ─────────────────────────────────────────────────
// Fetches at_risk_days_threshold + approval thresholds for a project.
async function getProjectSettings(projectId) {
  const [[p]] = await db.query(
    'SELECT at_risk_days_threshold, approval_threshold_1, approval_threshold_2 FROM projects WHERE id = ?',
    [projectId]
  )
  return {
    atRiskDays:   p?.at_risk_days_threshold ?? 30,
    threshold1:   p?.approval_threshold_1   ?? null,
    threshold2:   p?.approval_threshold_2   ?? null,
  }
}

// ─── STAT CARDS ───────────────────────────────────────────────────────────────
// GET /api/procurement/:projectId/stats
// Uses project's configurable at_risk_days_threshold for "At Risk" count.
router.get('/:projectId/stats', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    if (!pid) return res.status(400).json({ error: 'project_id is required' })

    const { atRiskDays } = await getProjectSettings(pid)

    const [[row]] = await db.query(`
      SELECT
        COUNT(*)                                                                    AS total,
        SUM(CASE WHEN s NOT IN ('closed','cancelled') THEN 1 ELSE 0 END)          AS ongoing,
        SUM(CASE WHEN s = 'closed' THEN 1 ELSE 0 END)                             AS complete,
        SUM(CASE
              WHEN s NOT IN ('closed','cancelled')
               AND min_cdd IS NOT NULL
               AND min_cdd < CURDATE()                                             THEN 1
              ELSE 0 END)                                                           AS breached,
        SUM(CASE
              WHEN s NOT IN ('closed','cancelled')
               AND min_cdd IS NOT NULL
               AND min_cdd >= CURDATE()
               AND DATEDIFF(min_cdd, CURDATE()) <= ?                              THEN 1
              ELSE 0 END)                                                           AS at_risk
      FROM (
        SELECT po.status AS s, MIN(l.cdd) AS min_cdd
        FROM purchase_orders po
        LEFT JOIN po_lines l ON l.po_id = po.id
        WHERE po.project_id = ?
        GROUP BY po.id, po.status
      ) AS sub
    `, [atRiskDays, pid])

    // ─── ADDITIONAL VALUE STATS ───────────────────────────────────────────────
    // totalValue: sum of all non-cancelled POs; approvedValue: locked only; pendingCount: unlocked non-terminal
    const [[valRow]] = await db.query(`
      SELECT
        SUM(CASE WHEN status NOT IN ('cancelled') THEN COALESCE(value, 0) ELSE 0 END)            AS total_value,
        SUM(CASE WHEN is_locked = 1 AND status NOT IN ('cancelled') THEN COALESCE(value, 0) ELSE 0 END) AS approved_value,
        SUM(CASE WHEN is_locked = 0 AND status NOT IN ('cancelled','closed') THEN 1 ELSE 0 END)  AS pending_count
      FROM purchase_orders
      WHERE project_id = ?
    `, [pid])

    res.json({
      total:         row.total    ?? 0,
      ongoing:       row.ongoing  ?? 0,
      complete:      row.complete ?? 0,
      breached:      row.breached ?? 0,
      atRisk:        row.at_risk  ?? 0,
      atRiskDays,    // expose so frontend can show "within X days" in legend
      totalValue:    valRow.total_value    ?? 0,
      approvedValue: valRow.approved_value ?? 0,
      pendingCount:  valRow.pending_count  ?? 0,
    })
  } catch (e) {
    console.error('[procurement:stats]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── WBS NODES FOR DROPDOWN ───────────────────────────────────────────────────
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

// ─── EXPEDITORS/USERS FOR DROPDOWN ───────────────────────────────────────────
router.get('/users/list', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, full_name, role FROM users
      WHERE is_active = 1 AND is_external = 0
        AND role IN ('admin','procurement_officer','procurement_manager',
                     'expeditor','expediting_manager','project_manager','project_director')
      ORDER BY full_name
    `)
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── DUPLICATE CHECK (single PO) ─────────────────────────────────────────────
// GET /api/procurement/pos/check-duplicate
// Item 11: Returns existing PO if po_number already exists in this project.
router.get('/pos/check-duplicate', async (req, res) => {
  try {
    const { po_number, project_id } = req.query
    if (!po_number || !project_id) {
      return res.status(400).json({ error: 'po_number and project_id are required' })
    }
    const [[po]] = await db.query(`
      SELECT po.*, s.name AS supplier_name, u.full_name AS owner_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN users u ON u.id = po.owner_id
      WHERE TRIM(LOWER(po.po_number)) = TRIM(LOWER(?)) AND po.project_id = ?
    `, [po_number, Number(project_id)])
    res.json({ exists: !!po, po: po ?? null })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── DUPLICATE CHECK BATCH (bulk upload) ─────────────────────────────────────
// POST /api/procurement/pos/check-duplicates-batch
// Item 11: Check multiple PO numbers at once before bulk import preview.
router.post('/pos/check-duplicates-batch', async (req, res) => {
  try {
    const { po_numbers, project_id } = req.body
    if (!Array.isArray(po_numbers) || !project_id) {
      return res.status(400).json({ error: 'po_numbers (array) and project_id required' })
    }
    if (po_numbers.length === 0) return res.json([])

    const [existing] = await db.query(`
      SELECT po_number, status, is_locked, id
      FROM purchase_orders
      WHERE project_id = ? AND TRIM(LOWER(po_number)) IN (${po_numbers.map(() => 'TRIM(LOWER(?))').join(',')})
    `, [Number(project_id), ...po_numbers])

    const lookup = {}
    for (const e of existing) {
      lookup[e.po_number.trim().toLowerCase()] = e
    }

    const results = po_numbers.map(pn => {
      const key   = pn.trim().toLowerCase()
      const found = lookup[key]
      return {
        po_number:  pn,
        exists:     !!found,
        locked:     found ? (!!found.is_locked || ['approved','po-raised','pending_director_approval'].includes(found.status)) : false,
        status:     found?.status ?? null,
        po_id:      found?.id ?? null,
      }
    })
    res.json(results)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── PO LIST ─────────────────────────────────────────────────────────────────
// GET /api/procurement/:projectId/pos
// Item 1: Uses project's at_risk_days_threshold for RAG computation.
router.get('/:projectId/pos', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    if (!pid) return res.status(400).json({ error: 'project_id is required' })

    const { atRiskDays } = await getProjectSettings(pid)

    const {
      status, supplier_id, wbs_id, is_critical_path, expeditor_id,
      cdd_from, cdd_to, search, rag,
      sort_col = 'po.created_at', sort_dir = 'desc',
    } = req.query

    const { page, limit, offset } = paginate(req.query)
    const params  = [pid]
    const filters = ['po.project_id = ?']

    // Vendor sees only their POs
    if (req.user.role === 'vendor' && req.user.supplier_id) {
      filters.push('po.supplier_id = ?')
      params.push(req.user.supplier_id)
    }

    // ── Status tab filter ─────────────────────────────────────────────────────
    if (status === 'approved') {
      filters.push('po.is_locked = 1')
    } else if (status === 'pending') {
      filters.push("po.status IN ('rfq','loa','pending_approval') AND po.is_locked = 0")
    } else if (status === 'completed') {
      filters.push("po.status IN ('closed','cancelled')")
    } else if (status === 'all_active') {
      filters.push("po.status NOT IN ('closed','cancelled')")
    }

    // ── RAG filter — pure WHERE on l.cdd (no aggregates) ─────────────────────
    // Joins po_lines already in the query; WHERE on l.cdd matches any line
    // with cdd in range, which is correct: a PO is breached/at-risk when any
    // of its lines is past/near its CDD.
    if (rag === 'red') {
      filters.push("po.status NOT IN ('closed','cancelled')")
      filters.push('l.cdd IS NOT NULL AND l.cdd < CURDATE()')
    } else if (rag === 'amber') {
      filters.push("po.status NOT IN ('closed','cancelled')")
      filters.push(`l.cdd IS NOT NULL AND l.cdd >= CURDATE() AND DATEDIFF(l.cdd, CURDATE()) <= ${atRiskDays}`)
    }

    if (supplier_id)        { filters.push('po.supplier_id = ?');    params.push(Number(supplier_id)) }
    if (wbs_id)             { filters.push('w.id = ?');              params.push(Number(wbs_id)) }
    if (is_critical_path === '1') { filters.push('po.is_critical_path = 1') }
    if (expeditor_id)       { filters.push('po.expeditor_id = ?');   params.push(Number(expeditor_id)) }
    if (cdd_from)           { filters.push('l.cdd >= ?');            params.push(cdd_from) }
    if (cdd_to)             { filters.push('l.cdd <= ?');            params.push(cdd_to) }

    if (search) {
      filters.push('(po.po_number LIKE ? OR po.description LIKE ? OR po.vendor_name LIKE ? OR s.name LIKE ?)')
      const q = `%${search}%`
      params.push(q, q, q, q)
    }

    const SAFE_SORT = {
      po_number: 'po.po_number', vendor: 's.name', status: 'po.status',
      ros_date: 'po.ros_date', created_at: 'po.created_at',
      cdd: 'MIN(l.cdd)', value: 'po.value', wbs: 'po.wbs_code',
      expeditor: 'exp.full_name', owner: 'own.full_name',
    }
    const orderBy  = SAFE_SORT[sort_col] ?? 'po.created_at'
    const orderDir = sort_dir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'
    const where    = filters.join(' AND ')

    // COUNT: DISTINCT because WHERE on l.cdd can produce multiple rows per PO
    const [countRows] = await db.query(`
      SELECT COUNT(DISTINCT po.id) AS total
      FROM purchase_orders po
      LEFT JOIN suppliers s   ON s.id   = po.supplier_id
      LEFT JOIN users     own ON own.id = po.owner_id
      LEFT JOIN users     exp ON exp.id = po.expeditor_id
      LEFT JOIN wbs_nodes w   ON w.code = po.wbs_code AND w.project_id = po.project_id
      LEFT JOIN po_lines  l   ON l.po_id = po.id
      WHERE ${where}
    `, params)

    const [rows] = await db.query(`
      SELECT
        po.id, po.po_number, po.po_name, po.description,
        po.vendor_name, po.supplier_id, po.currency, po.value,
        po.incoterms, po.handover_point, po.wbs_code, po.status,
        po.is_critical_path, po.is_locked, po.group_category,
        po.owner_id, po.expeditor_id, po.ros_date, po.created_at,
        own.full_name   AS owner_name,
        exp.full_name   AS expeditor_name,
        s.name          AS supplier_name,
        w.id            AS wbs_node_id,
        w.description   AS wbs_name,
        COUNT(l.id)                         AS line_count,
        MIN(l.cdd)                          AS earliest_cdd,
        MIN(l.ros_date)                     AS earliest_line_ros,
        po.milestone_po_date, po.milestone_fat_date,
        po.milestone_esd_date, po.milestone_eta_date, po.milestone_ros_date
      FROM purchase_orders po
      LEFT JOIN suppliers s   ON s.id   = po.supplier_id
      LEFT JOIN users     own ON own.id = po.owner_id
      LEFT JOIN users     exp ON exp.id = po.expeditor_id
      LEFT JOIN wbs_nodes w   ON w.code = po.wbs_code AND w.project_id = po.project_id
      LEFT JOIN po_lines  l   ON l.po_id = po.id
      WHERE ${where}
      GROUP BY
        po.id, po.po_number, po.po_name, po.description, po.vendor_name,
        po.supplier_id, po.currency, po.value, po.incoterms, po.handover_point, po.wbs_code,
        po.status, po.is_critical_path, po.is_locked, po.group_category,
        po.owner_id, po.expeditor_id, po.ros_date, po.created_at,
        own.full_name, exp.full_name, s.name, w.id, w.description,
        po.milestone_po_date, po.milestone_fat_date, po.milestone_esd_date,
        po.milestone_eta_date, po.milestone_ros_date
      ORDER BY ${orderBy} ${orderDir}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset])

    // ── FIX 1: milestone_dots removed — milestones belong in Expediting ─────────
    // Milestone dates still included so the drawer can render the milestone section.
    const data = rows.map(r => {
      return {
        id: r.id, po_number: r.po_number, po_name: r.po_name,
        description: r.description, vendor_name: r.vendor_name,
        supplier_id: r.supplier_id, supplier_name: r.supplier_name,
        currency: r.currency, value: r.value, incoterms: r.incoterms, handover_point: r.handover_point,
        wbs_code: r.wbs_code, wbs_node_id: r.wbs_node_id, wbs_name: r.wbs_name,
        ros_date: r.ros_date, status: r.status,
        statusLabel:    STATUS_LABELS[r.status] ?? r.status,
        isCriticalPath: !!r.is_critical_path,
        isLocked:       !!r.is_locked,
        group_category: r.group_category,
        owner_id: r.owner_id, owner_name: r.owner_name,
        expeditor_id: r.expeditor_id, expeditor_name: r.expeditor_name,
        line_count: r.line_count,
        cdd:  r.earliest_cdd,
        rag:  computeRag(r.earliest_cdd, r.status, atRiskDays),
        milestone_po_date: r.milestone_po_date, milestone_fat_date: r.milestone_fat_date,
        milestone_esd_date: r.milestone_esd_date, milestone_eta_date: r.milestone_eta_date,
        milestone_ros_date: r.milestone_ros_date,
        created_at: r.created_at,
      }
    })

    res.json({ rows: data, total: countRows[0].total, page, limit, atRiskDays })
  } catch (e) {
    console.error('[procurement:pos-list]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── PO DETAIL ────────────────────────────────────────────────────────────────
router.get('/pos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[po]] = await db.query(`
      SELECT po.*, own.full_name AS owner_name, exp.full_name AS expeditor_name,
        s.name AS supplier_name, s.code AS supplier_code, w.description AS wbs_name
      FROM purchase_orders po
      LEFT JOIN users     own ON own.id = po.owner_id
      LEFT JOIN users     exp ON exp.id = po.expeditor_id
      LEFT JOIN suppliers s   ON s.id   = po.supplier_id
      LEFT JOIN wbs_nodes w   ON w.code = po.wbs_code AND w.project_id = po.project_id
      WHERE po.id = ?
    `, [id])

    if (!po) return res.status(404).json({ error: 'PO not found' })
    if (req.user.role === 'vendor' && po.supplier_id !== req.user.supplier_id) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const { atRiskDays } = await getProjectSettings(po.project_id)

    const [lines] = await db.query(`
      SELECT l.*, u.code AS uom_code, u.description AS uom_name,
             COALESCE((SELECT SUM(rl.received_qty) FROM receipt_lines rl WHERE rl.po_line_id = l.id), 0) AS received_to_date,
             GREATEST(0, l.qty - COALESCE((SELECT SUM(rl.received_qty) FROM receipt_lines rl WHERE rl.po_line_id = l.id), 0)) AS remaining_qty
      FROM po_lines l LEFT JOIN units_of_measure u ON u.id = l.uom_id
      WHERE l.po_id = ? ORDER BY l.line_number
    `, [id])

    // Fetch approvals chain
    const [approvals] = await db.query(`
      SELECT a.*, u.full_name AS approver_name
      FROM po_approvals a JOIN users u ON u.id = a.approver_id
      WHERE a.po_id = ? ORDER BY a.approval_level, a.created_at
    `, [id])

    // Fetch current signed PO document
    const [docs] = await db.query(`
      SELECT pd.id, pd.file_name, pd.file_size_bytes, pd.mime_type, pd.version, pd.uploaded_at,
             u.full_name AS uploaded_by_name
      FROM po_documents pd JOIN users u ON u.id = pd.uploaded_by
      WHERE pd.po_id = ? AND pd.doc_type = 'signed_po' AND pd.is_current = 1
      ORDER BY pd.version DESC LIMIT 1
    `, [id])

    const minCdd = lines.reduce((m, l) => !m || (l.cdd && l.cdd < m) ? l.cdd : m, null)

    res.json({
      ...po,
      statusLabel:    STATUS_LABELS[po.status] ?? po.status,
      isCriticalPath: !!po.is_critical_path,
      isLocked:       !!po.is_locked,
      rag:            computeRag(minCdd, po.status, atRiskDays),
      atRiskDays,
      lines,
      approvals,
      signedDoc:      docs[0] ?? null,
    })
  } catch (e) {
    console.error('[procurement:pos-detail]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── ASSIGN EXPEDITOR ─────────────────────────────────────────────────────────
// Item 9B: Assign/reassign expeditor — logged to audit_log.
router.put('/pos/:id/expeditor', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!EXPEDITOR_ASSIGN_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Your role cannot assign expeditors' })
    }
    const { expeditor_id } = req.body
    const [[existing]] = await db.query(
      'SELECT id, po_number, expeditor_id FROM purchase_orders WHERE id = ?', [id]
    )
    if (!existing) return res.status(404).json({ error: 'PO not found' })

    const newExpId = expeditor_id ? Number(expeditor_id) : null
    await db.query(
      'UPDATE purchase_orders SET expeditor_id=?, expeditor_assigned_by=?, expeditor_assigned_at=NOW() WHERE id=?',
      [newExpId, req.user.id, id]
    )
    audit(req, 'expeditor_assigned', `purchase_orders/${id}`,
      { expeditor_id: existing.expeditor_id }, { expeditor_id: newExpId })

    let expeditorName = null
    if (newExpId) {
      const [[u]] = await db.query('SELECT full_name FROM users WHERE id=?', [newExpId])
      expeditorName = u?.full_name ?? null
    }
    res.json({ expeditor_id: newExpId, expeditor_name: expeditorName })
  } catch (e) {
    console.error('[procurement:assign-expeditor]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── TOGGLE CRITICAL PATH ─────────────────────────────────────────────────────
// Item 9A: Toggle requires a reason. Logged to audit_log.
router.put('/pos/:id/critical-path', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!CRITICAL_PATH_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Your role cannot change the critical path flag' })
    }
    const { is_critical_path, reason } = req.body
    if (typeof is_critical_path !== 'boolean') {
      return res.status(400).json({ error: 'is_critical_path must be a boolean' })
    }
    if (!reason?.trim()) {
      return res.status(400).json({ error: 'A reason is required to change the critical path flag' })
    }
    const [[existing]] = await db.query(
      'SELECT id, po_number, is_critical_path FROM purchase_orders WHERE id=?', [id]
    )
    if (!existing) return res.status(404).json({ error: 'PO not found' })

    await db.query(
      'UPDATE purchase_orders SET is_critical_path=?, critical_path_set_by=?, critical_path_set_at=NOW() WHERE id=?',
      [is_critical_path ? 1 : 0, req.user.id, id]
    )
    audit(req, is_critical_path ? 'critical_path_set' : 'critical_path_cleared',
      `purchase_orders/${id}`,
      { is_critical_path: !!existing.is_critical_path, reason: null },
      { is_critical_path, reason }
    )
    res.json({ is_critical_path, isCriticalPath: is_critical_path })
  } catch (e) {
    console.error('[procurement:critical-path]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── STAR TOGGLE (quick from list) ────────────────────────────────────────────
// Still available for backwards compat — critical path now also has PUT endpoint.
router.patch('/pos/:id/star', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[row]] = await db.query(
      'SELECT id, po_number, is_critical_path FROM purchase_orders WHERE id=?', [id]
    )
    if (!row) return res.status(404).json({ error: 'PO not found' })
    const newVal = row.is_critical_path ? 0 : 1
    await db.query(
      'UPDATE purchase_orders SET is_critical_path=?, critical_path_set_by=?, critical_path_set_at=NOW() WHERE id=?',
      [newVal, req.user.id, id]
    )
    audit(req, newVal ? 'critical_path_set' : 'critical_path_cleared',
      `purchase_orders/${id}`,
      { is_critical_path: !!row.is_critical_path },
      { is_critical_path: !!newVal }
    )
    res.json({ isCriticalPath: !!newVal })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── APPROVE PO ───────────────────────────────────────────────────────────────
// Item 10C: Value-based approval with threshold checks.
router.patch('/pos/:id/approve', async (req, res) => {
  try {
    const id   = Number(req.params.id)
    const role = req.user.role
    const { chain_note } = req.body

    const [[po]] = await db.query(
      'SELECT id, po_number, value, currency, status, project_id FROM purchase_orders WHERE id=?', [id]
    )
    if (!po) return res.status(404).json({ error: 'PO not found' })

    const { threshold1, threshold2 } = await getProjectSettings(po.project_id)
    const poValue = po.value ?? 0

    // ── Admin bypasses all thresholds ──────────────────────────────────────────
    if (role === 'admin') {
      await db.query(
        "UPDATE purchase_orders SET status='po-raised', is_locked=1 WHERE id=?", [id]
      )
      await db.query(
        'INSERT INTO po_approvals (po_id, approver_id, approval_level, status, actioned_at, comments) VALUES (?,?,1,\'approved\',NOW(),?)',
        [id, req.user.id, chain_note || 'Admin approval']
      )
      audit(req, 'po_approved', `purchase_orders/${id}`,
        { status: po.status }, { status: 'po-raised', approved_by: req.user.id })
      return res.json({ ok: true, newStatus: 'po-raised' })
    }

    // ── Determine approval path based on PO value ──────────────────────────────
    const needsManagerOnly  = !threshold1 || poValue <= threshold1
    const needsDirector     = threshold2 !== null && poValue > threshold2

    if (needsManagerOnly && !needsDirector) {
      // Single-level approval — procurement_manager or procurement_officer
      if (!APPROVAL_ROLES.has(role)) {
        return res.status(403).json({ error: 'Your role cannot approve POs' })
      }
      await db.query(
        "UPDATE purchase_orders SET status='po-raised', is_locked=1 WHERE id=?", [id]
      )
      await db.query(
        'INSERT INTO po_approvals (po_id, approver_id, approval_level, status, actioned_at, comments) VALUES (?,?,1,\'approved\',NOW(),?)',
        [id, req.user.id, chain_note || null]
      )
      audit(req, 'po_approved', `purchase_orders/${id}`,
        { status: po.status }, { status: 'po-raised' })
      return res.json({ ok: true, newStatus: 'po-raised' })
    }

    // Multi-level: submit for manager/director approval
    if (po.status === 'rfq' || po.status === 'draft') {
      // Submit for manager approval
      await db.query(
        "UPDATE purchase_orders SET status='pending_approval' WHERE id=?", [id]
      )
      await db.query(
        'INSERT INTO po_approvals (po_id, approver_id, approval_level, status) VALUES (?,?,1,\'pending\')',
        [id, req.user.id]
      )
      // In-app notification to procurement managers
      const [managers] = await db.query(
        "SELECT id FROM users WHERE role IN ('procurement_manager','admin') AND is_active=1"
      )
      for (const m of managers) {
        await db.query(
          "INSERT INTO notifications (user_id, type, message, related_entity_type, related_entity_id) VALUES (?,?,?,?,?)",
          [m.id, 'po_approval_needed', `PO ${po.po_number} requires your approval ($${poValue.toLocaleString()})`, 'purchase_order', id]
        ).catch(() => {})
      }
      return res.json({ ok: true, newStatus: 'pending_approval' })
    }

    // Manager approves pending_approval PO
    if (po.status === 'pending_approval' && role === 'procurement_manager') {
      if (needsDirector) {
        await db.query(
          "UPDATE purchase_orders SET status='pending_director_approval' WHERE id=?", [id]
        )
        await db.query(
          'INSERT INTO po_approvals (po_id, approver_id, approval_level, status, actioned_at, comments) VALUES (?,?,1,\'approved\',NOW(),?)',
          [id, req.user.id, chain_note || null]
        )
        // Notify project directors
        const [directors] = await db.query(
          "SELECT id FROM users WHERE role IN ('project_director','admin') AND is_active=1"
        )
        for (const d of directors) {
          await db.query(
            "INSERT INTO notifications (user_id, type, message, related_entity_type, related_entity_id) VALUES (?,?,?,?,?)",
            [d.id, 'po_director_approval_needed', `PO ${po.po_number} requires director approval ($${poValue.toLocaleString()})`, 'purchase_order', id]
          ).catch(() => {})
        }
        return res.json({ ok: true, newStatus: 'pending_director_approval' })
      }
      await db.query("UPDATE purchase_orders SET status='po-raised', is_locked=1 WHERE id=?", [id])
      await db.query(
        'INSERT INTO po_approvals (po_id, approver_id, approval_level, status, actioned_at, comments) VALUES (?,?,1,\'approved\',NOW(),?)',
        [id, req.user.id, chain_note || null]
      )
      return res.json({ ok: true, newStatus: 'po-raised' })
    }

    // Director approves pending_director_approval PO
    if (po.status === 'pending_director_approval' && ['project_director','admin'].includes(role)) {
      await db.query("UPDATE purchase_orders SET status='po-raised', is_locked=1 WHERE id=?", [id])
      await db.query(
        'INSERT INTO po_approvals (po_id, approver_id, approval_level, status, actioned_at, comments) VALUES (?,?,2,\'approved\',NOW(),?)',
        [id, req.user.id, chain_note || null]
      )
      audit(req, 'po_approved_director', `purchase_orders/${id}`,
        { status: po.status }, { status: 'po-raised' })
      return res.json({ ok: true, newStatus: 'po-raised' })
    }

    return res.status(400).json({ error: 'Cannot approve PO in its current state with your role' })
  } catch (e) {
    console.error('[procurement:approve]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── REJECT PO ────────────────────────────────────────────────────────────────
// Item 10D: Any approver can reject with a reason. PO reverts to draft.
router.patch('/pos/:id/reject', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { reason } = req.body
    if (!reason?.trim()) return res.status(400).json({ error: 'Rejection reason is required' })

    const [[po]] = await db.query(
      'SELECT id, po_number, status, owner_id FROM purchase_orders WHERE id=?', [id]
    )
    if (!po) return res.status(404).json({ error: 'PO not found' })

    await db.query("UPDATE purchase_orders SET status='rfq', is_locked=0 WHERE id=?", [id])
    await db.query(
      'INSERT INTO po_approvals (po_id, approver_id, approval_level, status, actioned_at, comments) VALUES (?,?,1,\'rejected\',NOW(),?)',
      [id, req.user.id, reason]
    )
    // Notify PO owner
    if (po.owner_id) {
      await db.query(
        "INSERT INTO notifications (user_id, type, message, related_entity_type, related_entity_id) VALUES (?,?,?,?,?)",
        [po.owner_id, 'po_rejected', `PO ${po.po_number} was rejected: ${reason}`, 'purchase_order', id]
      ).catch(() => {})
    }
    audit(req, 'po_rejected', `purchase_orders/${id}`,
      { status: po.status }, { status: 'rfq', rejection_reason: reason })
    res.json({ ok: true, newStatus: 'rfq' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── SIGNED PO DOCUMENT UPLOAD ────────────────────────────────────────────────
// Item 7: POST /api/procurement/pos/:id/documents
// Accepts PDF/DOC/DOCX up to 50MB. Sets previous version is_current = 0.
router.post('/pos/:id/documents', uploadPoDoc.single('file'), async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!DOC_UPLOAD_ROLES.has(req.user.role)) {
      if (req.file) fs.unlinkSync(req.file.path)
      return res.status(403).json({ error: 'Your role cannot upload PO documents' })
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const [[po]] = await db.query('SELECT id, po_number FROM purchase_orders WHERE id=?', [id])
    if (!po) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ error: 'PO not found' })
    }

    // Get current highest version number
    const [[vRow]] = await db.query(
      'SELECT COALESCE(MAX(version), 0) AS maxv FROM po_documents WHERE po_id=? AND doc_type=\'signed_po\'',
      [id]
    )
    const newVersion = (vRow?.maxv ?? 0) + 1

    // Mark previous versions as not current
    await db.query(
      "UPDATE po_documents SET is_current=0 WHERE po_id=? AND doc_type='signed_po'",
      [id]
    )

    // Insert new document record
    const relativePath = path.relative(
      path.join(__dirname, '..'),
      req.file.path
    )
    await db.query(`
      INSERT INTO po_documents
        (po_id, doc_type, file_name, file_path, file_size_bytes, mime_type,
         version, is_current, uploaded_by, uploaded_at)
      VALUES (?, 'signed_po', ?, ?, ?, ?, ?, 1, ?, NOW())
    `, [id, req.file.originalname, relativePath, req.file.size, req.file.mimetype, newVersion, req.user.id])

    audit(req, 'signed_po_uploaded', `purchase_orders/${id}`,
      { version: newVersion - 1 }, { version: newVersion, file: req.file.originalname })

    res.json({ ok: true, version: newVersion, file_name: req.file.originalname })
  } catch (e) {
    if (req.file) fs.unlinkSync(req.file.path).catch?.(() => {})
    console.error('[procurement:doc-upload]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── SIGNED PO DOWNLOAD ───────────────────────────────────────────────────────
// Item 7: Authenticated streaming download. Logs to audit_log.
router.get('/pos/:id/documents/:docId/download', async (req, res) => {
  try {
    const poId  = Number(req.params.id)
    const docId = Number(req.params.docId)

    const [[doc]] = await db.query(
      'SELECT * FROM po_documents WHERE id=? AND po_id=?',
      [docId, poId]
    )
    if (!doc) return res.status(404).json({ error: 'Document not found' })

    // Resolve absolute path — never expose file_path in response
    const absPath = path.join(__dirname, '..', doc.file_path)
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: 'File not found on server' })
    }

    audit(req, 'signed_po_downloaded', `purchase_orders/${poId}/documents/${docId}`,
      null, { file: doc.file_name, version: doc.version })

    res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name}"`)
    res.setHeader('Content-Type', doc.mime_type)
    fs.createReadStream(absPath).pipe(res)
  } catch (e) {
    console.error('[procurement:doc-download]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── BULK UPLOAD ─────────────────────────────────────────────────────────────
// Item 6: Parse CSV/XLSX upload, return preview with validation results.
router.post('/:projectId/pos/bulk-upload', uploadBulk.single('file'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const ExcelJS = require('exceljs')
    const rows = []

    if (req.file.originalname.endsWith('.xlsx')) {
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(req.file.buffer)
      const ws = wb.worksheets[0]
      if (!ws) return res.status(400).json({ error: 'No worksheet found in file' })

      // First row = headers
      let headers = []
      ws.eachRow((row, rIdx) => {
        if (rIdx === 1) {
          headers = row.values.slice(1).map(v => String(v ?? '').trim().toLowerCase())
        } else {
          const obj = {}
          row.values.slice(1).forEach((val, i) => { obj[headers[i]] = val })
          rows.push(obj)
        }
      })
    } else {
      // CSV: simple parser
      const text = req.file.buffer.toString('utf8')
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) return res.status(400).json({ error: 'File is empty or has no data rows' })
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
        const obj  = {}
        headers.forEach((h, idx) => { obj[h] = vals[idx] ?? '' })
        rows.push(obj)
      }
    }

    // ── Map flexible column names ──────────────────────────────────────────────
    const FIELD_MAP = {
      'po number': 'po_number', 'po ref': 'po_number', 'po_number': 'po_number',
      'description': 'description',
      'supplier': 'vendor_name', 'vendor': 'vendor_name', 'vendor name': 'vendor_name',
      'group': 'group_category', 'category': 'group_category', 'group/category': 'group_category',
      'currency': 'currency', 'ccy': 'currency',
      'value': 'value', 'po value': 'value', 'amount': 'value',
      'incoterms': 'incoterms', 'inco terms': 'incoterms',
      'wbs': 'wbs_code', 'wbs code': 'wbs_code',
      'ros date': 'ros_date', 'ros': 'ros_date', 'required on site': 'ros_date',
      'owner': 'owner_name',
    }

    const normalised = rows.map((r, idx) => {
      const mapped = {}
      for (const [rawKey, val] of Object.entries(r)) {
        const normKey = FIELD_MAP[rawKey.toLowerCase()] ?? rawKey.toLowerCase()
        mapped[normKey] = val
      }
      return { rowIndex: idx + 2, ...mapped }
    }).filter(r => Object.values(r).some(v => v && String(v).trim()))

    // ── Validate + duplicate check ─────────────────────────────────────────────
    const poNumbers  = normalised.map(r => r.po_number).filter(Boolean)
    const [existing] = await db.query(
      poNumbers.length
        ? `SELECT po_number, status, is_locked, id FROM purchase_orders WHERE project_id=? AND TRIM(LOWER(po_number)) IN (${poNumbers.map(() => 'TRIM(LOWER(?))').join(',')})`
        : 'SELECT NULL LIMIT 0',
      poNumbers.length ? [pid, ...poNumbers] : []
    )
    const existingMap = {}
    for (const e of existing) existingMap[e.po_number.toLowerCase()] = e

    // Detect within-file duplicates
    const seenInFile = {}
    for (const r of normalised) {
      const key = (r.po_number ?? '').toLowerCase().trim()
      if (key) seenInFile[key] = (seenInFile[key] ?? 0) + 1
    }

    const preview = normalised.map(r => {
      const errors  = []
      const key     = (r.po_number ?? '').toLowerCase().trim()
      const found   = existingMap[key]
      const inFileDup = key && seenInFile[key] > 1

      if (!r.po_number?.trim()) errors.push('PO Number is required')
      if (!r.vendor_name?.trim() && !r.supplier_id) errors.push('Supplier/Vendor is required')
      if (inFileDup)            errors.push('Duplicate within this upload file')

      let rowStatus = errors.length > 0 ? 'invalid' : 'new'
      if (!inFileDup && found) {
        const isLocked = !!found.is_locked || ['po-raised','approved','pending_director_approval'].includes(found.status)
        rowStatus = isLocked ? 'locked' : 'duplicate'
      }

      return {
        rowIndex:   r.rowIndex,
        po_number:  r.po_number,
        description: r.description,
        vendor_name: r.vendor_name,
        group_category: r.group_category,
        currency:   r.currency || 'AUD',
        value:      r.value ? Number(String(r.value).replace(/[^0-9.-]/g, '')) : null,
        incoterms:  r.incoterms,
        wbs_code:   r.wbs_code,
        ros_date:   r.ros_date || null,
        owner_name: r.owner_name,
        rowStatus,   // 'new' | 'duplicate' | 'locked' | 'invalid'
        errors,
        existingStatus: found?.status ?? null,
      }
    })

    res.json({ preview, totalRows: preview.length })
  } catch (e) {
    console.error('[procurement:bulk-upload]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── BULK UPLOAD CONFIRM ──────────────────────────────────────────────────────
// Item 6: Confirm bulk import after user reviews preview.
router.post('/:projectId/pos/bulk-confirm', async (req, res) => {
  try {
    const pid  = Number(req.params.projectId)
    const { rows, replace_duplicates = false } = req.body
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' })

    let created = 0, replaced = 0, skipped = 0, failed = 0
    const errors = []

    for (const r of rows) {
      if (r.rowStatus === 'locked' || r.rowStatus === 'invalid') { skipped++; continue }
      try {
        if (r.rowStatus === 'duplicate' && !replace_duplicates) { skipped++; continue }
        if (r.rowStatus === 'duplicate' && replace_duplicates) {
          // Replace existing unlocked PO
          const [[ex]] = await db.query(
            'SELECT id, status FROM purchase_orders WHERE project_id=? AND LOWER(po_number)=LOWER(?)',
            [pid, r.po_number]
          )
          if (ex) {
            const before = { ...ex }
            await db.query(`
              UPDATE purchase_orders SET description=?,vendor_name=?,group_category=?,
                currency=?,value=?,incoterms=?,wbs_code=?,ros_date=? WHERE id=?
            `, [r.description||null, r.vendor_name, r.group_category||null,
                r.currency||'AUD', r.value||null, r.incoterms||null, r.wbs_code||null,
                r.ros_date||null, ex.id])
            audit(req, 'po_replaced', `purchase_orders/${ex.id}`,
              before, { po_number: r.po_number })
            replaced++
            continue
          }
        }
        // Create new PO
        await db.query(`
          INSERT INTO purchase_orders
            (project_id,po_number,description,vendor_name,group_category,currency,value,incoterms,wbs_code,ros_date,status,created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,'rfq',?)
        `, [pid, r.po_number, r.description||null, r.vendor_name, r.group_category||null,
            r.currency||'AUD', r.value||null, r.incoterms||null, r.wbs_code||null,
            r.ros_date||null, req.user.id])
        audit(req, 'po_created_bulk', `procurement/${pid}/pos`,
          null, { po_number: r.po_number }, 'purchase_order', pid)
        created++
      } catch (e) {
        failed++
        errors.push({ po_number: r.po_number, error: e.message })
      }
    }

    res.json({ created, replaced, skipped, failed, errors })
  } catch (e) {
    console.error('[procurement:bulk-confirm]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── COMMODITY / EQUIPMENT ITEM SEARCH ───────────────────────────────────────
// GET /api/procurement/:projectId/items/search?q=
// Typeahead for the New PO Wizard line items: searches commodities table AND
// equipment_items table for the project. Returns [] gracefully when Foundational
// module tables haven't been created yet.
router.get('/:projectId/items/search', async (req, res) => {
  try {
    const pid  = Number(req.params.projectId)
    const q    = String(req.query.q ?? '').trim()
    if (!q || !pid) return res.json([])
    const like = `%${q}%`
    const out  = []

    // ─── BUG-6: search commodity_library and equipment_list (correct table names) ─
    try {
      const [rows] = await db.query(`
        SELECT 'commodity' AS type, code, name AS description, uom
        FROM   commodity_library
        WHERE  project_id = ? AND status = 'active'
          AND  (code LIKE ? OR name LIKE ?)
        ORDER  BY code LIMIT 10
      `, [pid, like, like])
      out.push(...rows)
    } catch { /* table not yet created */ }

    try {
      const [rows] = await db.query(`
        SELECT 'equipment' AS type, tag AS code, description, NULL AS uom
        FROM   equipment_list
        WHERE  project_id = ?
          AND  (tag LIKE ? OR description LIKE ?)
        ORDER  BY tag LIMIT 10
      `, [pid, like, like])
      out.push(...rows)
    } catch { /* table not yet created */ }

    res.json(out)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── XLSX TEMPLATE DOWNLOAD ───────────────────────────────────────────────────
// Two-section template:
//   Section 1 — PO Header (label/value pairs, rows 1–19)
//   Section 2 — Line Items (column table starting row 21)
// Orange section headers, frozen panes at line-items column header row,
// Instructions tab with field-by-field guidance.
router.get('/template/po-upload', async (req, res) => {
  try {
    const ExcelJS = require('exceljs')
    const wb = new ExcelJS.Workbook()
    wb.creator  = 'QCO MMS'
    wb.created  = new Date()

    const ORANGE   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE84E0F' } }
    const LIGHT_BG = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    const GREY_BG  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }
    const WHITE    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
    const styleSectionHeader = cell => {
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
      cell.fill      = ORANGE
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
    }
    const styleColHeader = cell => {
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      cell.fill      = ORANGE
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border    = { right: { style: 'thin', color: { argb: 'FFCC3300' } } }
    }
    const styleLabel = cell => {
      cell.font      = { bold: true, size: 10, color: { argb: 'FF334155' } }
      cell.fill      = GREY_BG
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    }
    const styleValue = cell => {
      cell.fill      = WHITE
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
      cell.border    = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } }
    }

    // ── Sheet 1: PO Upload Template ────────────────────────────────────────────
    const ws = wb.addWorksheet('PO Upload Template')
    ws.getColumn(1).width = 30   // label
    ws.getColumn(2).width = 42   // value
    ws.properties.defaultRowHeight = 18

    // ── SECTION 1: PO Header ──────────────────────────────────────────────────
    // Row 1 — section title
    ws.mergeCells('A1:B1')
    const sec1Title = ws.getCell('A1')
    sec1Title.value = '  SECTION 1 — PO HEADER'
    styleSectionHeader(sec1Title)
    ws.getRow(1).height = 22

    // Header fields: [label, placeholder/example, required?]
    const headerFields = [
      ['PO Reference *',              'e.g. PO-2025-001',                          true ],
      ['Vendor / Supplier Name *',    'e.g. Emerson Electric Co.',                 true ],
      ['PO Name / Title *',           'e.g. Control Valve Package — Unit 3',       true ],
      ['Group / Category',            'Mechanical / Electrical / Instrumentation / Civil / Piping / Structural', false],
      ['Currency',                    'AUD (default) — AUD, USD, EUR, GBP, SGD',   false],
      ['INCO Terms',                  'CIF — CIF, FOB, EXW, DAP, DDP, FCA, CPT, CIP', false],
      ['INCO Location',               'e.g. Port of Singapore',                    false],
      ['WBS Code',                    'e.g. 02.03.01',                             false],
      ['Contract / Order Number',     'e.g. CTR-2025-044',                         false],
      ['Award Date',                  'dd/mm/yyyy',                                false],
      ['CDD — Contract Delivery Date','dd/mm/yyyy',                                false],
      ['ROS — Required on Site Date', 'dd/mm/yyyy — optional, can enter in Expediting', false],
      ['FAT Date',                    'dd/mm/yyyy — Factory Acceptance Test date', false],
      ['ESD — Est. Ship Date',        'dd/mm/yyyy',                                false],
      ['Notes',                       'Any additional PO notes',                   false],
    ]
    headerFields.forEach(([label, hint, req], idx) => {
      const rowNum = idx + 2   // rows 2–16
      ws.mergeCells(`B${rowNum}:B${rowNum}`)
      const labelCell = ws.getCell(`A${rowNum}`)
      const valueCell = ws.getCell(`B${rowNum}`)
      labelCell.value = req ? `${label}` : label
      valueCell.value = hint
      styleLabel(labelCell)
      styleValue(valueCell)
      valueCell.font = { italic: true, color: { argb: 'FFAAAAAA' }, size: 9 }
      ws.getRow(rowNum).height = 18
    })

    // Row 17 — blank separator
    ws.getRow(17).height = 10

    // ── SECTION 2: Line Items ─────────────────────────────────────────────────
    // Row 18 — section title
    const lineColCount = 11
    ws.mergeCells(`A18:K18`)
    const sec2Title = ws.getCell('A18')
    sec2Title.value = '  SECTION 2 — LINE ITEMS  (add one row per line item)'
    styleSectionHeader(sec2Title)
    ws.getRow(18).height = 22

    // Row 19 — column headers
    const lineHeaders = [
      'Line #', 'Commodity Code / Tag', 'Item Description', 'Quantity',
      'UOM', 'Unit Rate', 'Total Value', 'WBS Code', 'CDD', 'ROS Date',
      'Heat No. Required (Y/N)',
    ]
    const colWidths = [8, 22, 36, 10, 8, 14, 14, 14, 14, 14, 22]
    lineHeaders.forEach((h, i) => {
      const cell = ws.getCell(19, i + 1)
      cell.value = h
      styleColHeader(cell)
      ws.getColumn(i + 1).width = colWidths[i]
    })
    ws.getRow(19).height = 28

    // Rows 20–39 — 20 blank data rows
    for (let r = 20; r <= 39; r++) {
      for (let c = 1; c <= lineColCount; c++) {
        const cell = ws.getCell(r, c)
        cell.fill = r % 2 === 0 ? LIGHT_BG : WHITE
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } },
          right:  { style: 'thin', color: { argb: 'FFEEEEEE' } },
        }
      }
      // Pre-fill line numbers
      ws.getCell(r, 1).value   = r - 19
      ws.getCell(r, 1).font    = { color: { argb: 'FF94A3B8' }, size: 9 }
      ws.getCell(r, 1).alignment = { horizontal: 'center' }
    }

    // Row 40 — example data row (muted)
    const exLine = [1, 'PIPE-CS-DN100', 'CS Seamless Pipe DN100 SCH40 6m lengths', 120, 'M', 85.00, '=D41*F41', '02.03.01', '2025-11-30', '2025-12-15', 'Y']
    exLine.forEach((v, i) => {
      const cell = ws.getCell(40, i + 1)
      cell.value = v
      cell.font  = { italic: true, color: { argb: 'FF94A3B8' }, size: 9 }
      cell.fill  = LIGHT_BG
    })
    ws.getCell('A40').value = '← Example — delete this row'

    // Freeze panes: rows 1–19 stay visible while scrolling line items
    ws.views = [{ state: 'frozen', ySplit: 19 }]

    // ─── DROPDOWN VALIDATIONS (showErrorMessage: false = guide only) ───────────
    // Header section: Currency at B6, INCO Terms at B7
    ws.dataValidations.add('B6', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"AUD,USD,EUR,GBP,JPY,SGD,CAD,NZD,CNY,HKD,INR"'],
    })
    ws.dataValidations.add('B7', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"EXW,FCA,CPT,CIP,DAP,DPU,DDP,FAS,FOB,CFR,CIF"'],
    })
    // Line items: UOM at col E (5), rows 20–500
    ws.dataValidations.add('E20:E500', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"EA,NR,KG,T,M,MM,M2,M3,L,KL,SET,LOT,PR,LM,KN"'],
    })
    // Line items: Heat No. Required at col K (11), rows 20–500
    ws.dataValidations.add('K20:K500', {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: ['"Y,N"'],
    })

    // ── Sheet 2: Reference (valid values legend) ───────────────────────────────
    const wsRef = wb.addWorksheet('Reference')
    wsRef.getColumn(1).width = 36
    wsRef.getColumn(2).width = 65
    const ORANGE_REF = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE84E0F' } }
    const refTitleCell = wsRef.getCell('A1')
    refTitleCell.value = 'QCO MMS — PO Upload Template: Valid Values Reference'
    refTitleCell.font = { bold: true, size: 12, color: { argb: 'FFE84E0F' } }
    wsRef.getRow(1).height = 22
    wsRef.addRow([])
    wsRef.addRow(['Note: These values are suggestions. You may type any value not in this list.'])
      .getCell(1).font = { italic: true, color: { argb: 'FF64748b' }, size: 10 }
    wsRef.addRow([])
    const refRows = [
      ['COLUMN', 'VALID VALUES'],
      ['Currency — header row (cell B6)',             'AUD, USD, EUR, GBP, JPY, SGD, CAD, NZD, CNY, HKD, INR'],
      ['INCO Terms — header row (cell B7)',            'EXW, FCA, CPT, CIP, DAP, DPU, DDP, FAS, FOB, CFR, CIF'],
      ['UOM — line items col E (rows 20+)',            'EA, NR, KG, T, M, MM, M2, M3, L, KL, SET, LOT, PR, LM, KN'],
      ['Heat No. Required — line items col K (rows 20+)', 'Y, N'],
    ]
    refRows.forEach((row, i) => {
      const r = wsRef.addRow(row)
      if (i === 0) r.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } } })
    })

    // ── Sheet 3: Instructions ──────────────────────────────────────────────────
    const ws2 = wb.addWorksheet('Instructions')
    ws2.getColumn(1).width = 28
    ws2.getColumn(2).width = 14
    ws2.getColumn(3).width = 55

    const instTitle = ws2.getCell('A1')
    instTitle.value = 'PO Upload Template — Instructions'
    instTitle.font  = { bold: true, size: 13 }
    ws2.getRow(1).height = 22

    ws2.addRow([])
    const instHdr = ws2.addRow(['Field', 'Required?', 'Notes'])
    instHdr.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = ORANGE; c.alignment = { horizontal: 'center' } })
    ws2.getRow(3).height = 20

    const headerInst = [
      ['PO Reference',              'Required',  'Unique PO reference number. Duplicates will be flagged before import is confirmed.'],
      ['Vendor / Supplier Name',    'Required',  'Must match a supplier name in the system, or it will be flagged for manual review.'],
      ['PO Name / Title',           'Required',  'Short title for the PO (e.g. "Control Valve Package — Unit 3").'],
      ['Group / Category',          'Optional',  'Mechanical / Electrical / Instrumentation / Civil / Piping / Structural.'],
      ['Currency',                  'Optional',  'Default: AUD. Accepted: AUD USD EUR GBP SGD JPY CNY.'],
      ['INCO Terms',                'Optional',  'CIF / FOB / EXW / DAP / DDP / FCA / CPT / CIP.'],
      ['INCO Location',             'Optional',  'Named place relevant to the INCO term (e.g. Port of Singapore for FOB).'],
      ['WBS Code',                  'Optional',  'Must match an existing WBS code in the project (e.g. 02.03.01).'],
      ['Contract / Order Number',   'Optional',  'Internal contract or order reference.'],
      ['Award Date',                'Optional',  'Format: dd/mm/yyyy or YYYY-MM-DD.'],
      ['CDD',                       'Optional',  'Contract Delivery Date — format: dd/mm/yyyy. Drives RAG status on PO Register.'],
      ['ROS',                       'Optional',  'Required on Site Date — can be entered or updated later in Expediting.'],
      ['FAT Date',                  'Optional',  'Factory Acceptance Test date — dd/mm/yyyy.'],
      ['ESD',                       'Optional',  'Estimated Ship Date — dd/mm/yyyy.'],
      ['Notes',                     'Optional',  'Any additional notes or comments for this PO.'],
    ]
    ws2.addRow([])
    ws2.addRow(['SECTION 1 — PO HEADER FIELDS']).eachCell(c => { c.font = { bold: true, color: { argb: 'FFE84E0F' } } })
    headerInst.forEach(r => {
      const row = ws2.addRow(r)
      row.getCell(1).font = { bold: true }
    })

    ws2.addRow([])
    ws2.addRow(['SECTION 2 — LINE ITEM FIELDS']).eachCell(c => { c.font = { bold: true, color: { argb: 'FFE84E0F' } } })

    const lineInst = [
      ['Line #',                    'Auto',      'Pre-filled (1, 2, 3…). You may override.'],
      ['Commodity Code / Tag',      'Optional',  'Commodity code from Commodity Library or Equipment Tag number. Leave blank if unknown — flag "not linked" in Expediting.'],
      ['Item Description',          'Required',  'Description of the line item.'],
      ['Quantity',                  'Optional',  'Numeric value (e.g. 120). No commas.'],
      ['UOM',                       'Optional',  'EA / M / M² / M³ / KG / T / LT / SET / LOT.'],
      ['Unit Rate',                 'Optional',  'Unit price numeric (e.g. 85.00). No $ or commas.'],
      ['Total Value',               'Computed',  'Quantity × Unit Rate — calculated automatically. Do not edit.'],
      ['WBS Code',                  'Optional',  'Line-level WBS (can differ from PO-level WBS).'],
      ['CDD',                       'Optional',  'Contract Delivery Date for this line — dd/mm/yyyy.'],
      ['ROS Date',                  'Optional',  'Required on Site Date for this line — dd/mm/yyyy.'],
      ['Heat No. Required (Y/N)',   'Optional',  'Y if this line item requires heat number traceability. Default N.'],
    ]
    lineInst.forEach(r => {
      const row = ws2.addRow(r)
      row.getCell(1).font = { bold: true }
    })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="PO_Upload_Template.xlsx"')
    await wb.xlsx.write(res)
    res.end()
  } catch (e) {
    console.error('[procurement:template]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── REPLACE PO ───────────────────────────────────────────────────────────────
// Item 11: Replace fields of an existing unlocked PO.
router.put('/pos/:id/replace', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[existing]] = await db.query(
      'SELECT * FROM purchase_orders WHERE id=?', [id]
    )
    if (!existing) return res.status(404).json({ error: 'PO not found' })
    const locked = !!existing.is_locked || ['po-raised','approved','pending_director_approval'].includes(existing.status)
    if (locked) return res.status(400).json({ error: 'Cannot replace an approved or locked PO. Use a variation order instead.' })

    const { description, vendor_name, group_category, currency, value, incoterms, wbs_code, ros_date, source } = req.body
    const before = { description: existing.description, vendor_name: existing.vendor_name, value: existing.value }
    await db.query(`
      UPDATE purchase_orders SET description=?,vendor_name=?,group_category=?,currency=?,value=?,incoterms=?,wbs_code=?,ros_date=?
      WHERE id=?
    `, [description||null, vendor_name||existing.vendor_name, group_category||null, currency||'AUD',
        value||null, incoterms||null, wbs_code||null, ros_date||null, id])

    audit(req, 'po_replaced', `purchase_orders/${id}`,
      before,
      { description, vendor_name, value },
      'purchase_order'
    )
    const [[updated]] = await db.query('SELECT * FROM purchase_orders WHERE id=?', [id])
    res.json({ ...updated, statusLabel: STATUS_LABELS[updated.status] ?? updated.status })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── CREATE PO ────────────────────────────────────────────────────────────────
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

    if (!po_number?.trim()) return res.status(400).json({ error: 'PO number is required' })
    if (!vendor_name?.trim() && !supplier_id) return res.status(400).json({ error: 'Vendor or supplier is required' })

    let resolvedVendor = vendor_name?.trim() || ''
    if (!resolvedVendor && supplier_id) {
      const [[sup]] = await db.query('SELECT name FROM suppliers WHERE id=?', [supplier_id])
      resolvedVendor = sup?.name ?? ''
    }

    const [result] = await db.query(`
      INSERT INTO purchase_orders
        (project_id,po_number,po_name,description,vendor_name,supplier_id,
         currency,value,incoterms,wbs_code,ros_date,owner_id,group_category,
         milestone_po_date,milestone_fat_date,milestone_esd_date,milestone_eta_date,milestone_ros_date,
         status,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'rfq',?)
    `, [pid, po_number.trim(), po_name?.trim()||null, description?.trim()||null,
        resolvedVendor, supplier_id||null, currency||'AUD', value||null, incoterms||null,
        wbs_code||null, ros_date||null, owner_id||null, group_category||null,
        milestone_po_date||null, milestone_fat_date||null, milestone_esd_date||null,
        milestone_eta_date||null, milestone_ros_date||null, req.user.id])

    const poId = result.insertId
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (!l.description?.trim()) continue
      await db.query(`
        INSERT INTO po_lines (po_id,line_number,tag_number,description,qty,uom,uom_id,unit_price,ros_date)
        VALUES (?,?,?,?,?,?,?,?,?)
      `, [poId, l.line_number||String(i+1), l.tag_number||null, l.description.trim(), l.qty||null,
          l.uom||'EA', l.uom_id||null, l.unit_price||null, l.ros_date||null])
    }

    audit(req, 'po_created', `purchase_orders/${poId}`, null, { po_number, project_id: pid })
    const [[newPO]] = await db.query('SELECT * FROM purchase_orders WHERE id=?', [poId])
    res.status(201).json({ ...newPO, statusLabel: STATUS_LABELS[newPO.status] })
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `PO number "${req.body.po_number}" already exists in this project` })
    }
    console.error('[procurement:create-po]', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ─── UPDATE PO ────────────────────────────────────────────────────────────────
router.put('/pos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[existing]] = await db.query('SELECT id,po_number,is_locked FROM purchase_orders WHERE id=?', [id])
    if (!existing) return res.status(404).json({ error: 'PO not found' })
    if (existing.is_locked) return res.status(400).json({ error: 'This PO is locked and cannot be edited' })

    const {
      po_number, po_name, description, vendor_name, supplier_id,
      currency, value, incoterms, wbs_code, ros_date, owner_id, group_category,
      milestone_po_date, milestone_fat_date, milestone_esd_date,
      milestone_eta_date, milestone_ros_date,
    } = req.body

    await db.query(`
      UPDATE purchase_orders SET
        po_number=?,po_name=?,description=?,vendor_name=?,supplier_id=?,
        currency=?,value=?,incoterms=?,wbs_code=?,ros_date=?,owner_id=?,group_category=?,
        milestone_po_date=?,milestone_fat_date=?,milestone_esd_date=?,milestone_eta_date=?,milestone_ros_date=?
      WHERE id=?
    `, [po_number, po_name||null, description||null, vendor_name, supplier_id||null,
        currency||'AUD', value||null, incoterms||null, wbs_code||null, ros_date||null,
        owner_id||null, group_category||null, milestone_po_date||null, milestone_fat_date||null,
        milestone_esd_date||null, milestone_eta_date||null, milestone_ros_date||null, id])

    audit(req, 'po_updated', `purchase_orders/${id}`, { po_number: existing.po_number }, { po_number })
    const [[updated]] = await db.query('SELECT * FROM purchase_orders WHERE id=?', [id])
    res.json({ ...updated, statusLabel: STATUS_LABELS[updated.status] ?? updated.status })
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: `PO number "${req.body.po_number}" already exists` })
    }
    res.status(500).json({ error: e.message })
  }
})

// ─── DELETE PO ────────────────────────────────────────────────────────────────
router.delete('/pos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [[existing]] = await db.query('SELECT id,po_number,is_locked FROM purchase_orders WHERE id=?', [id])
    if (!existing) return res.status(404).json({ error: 'PO not found' })
    if (existing.is_locked) return res.status(400).json({ error: 'Locked POs cannot be deleted' })
    await db.query('DELETE FROM po_lines WHERE po_id=?', [id])
    await db.query('DELETE FROM purchase_orders WHERE id=?', [id])
    audit(req, 'po_deleted', `purchase_orders/${id}`, { po_number: existing.po_number }, null)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── LINE ITEMS ───────────────────────────────────────────────────────────────
router.post('/pos/:id/lines', async (req, res) => {
  try {
    const poId = Number(req.params.id)
    const { line_number, description, qty, uom, uom_id, unit_price, ros_date, cdd } = req.body
    if (!description?.trim()) return res.status(400).json({ error: 'Description is required' })
    const [r] = await db.query(`
      INSERT INTO po_lines (po_id,line_number,description,qty,uom,uom_id,unit_price,ros_date,cdd)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, [poId, line_number||'1', description.trim(), qty||null, uom||'EA', uom_id||null, unit_price||null, ros_date||null, cdd||null])
    const [[line]] = await db.query('SELECT * FROM po_lines WHERE id=?', [r.insertId])
    res.status(201).json(line)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/pos/:id/lines/:lineId', async (req, res) => {
  try {
    const lineId = Number(req.params.lineId)
    const { line_number, description, qty, uom, uom_id, unit_price, ros_date, cdd } = req.body
    await db.query(`
      UPDATE po_lines SET line_number=?,description=?,qty=?,uom=?,uom_id=?,unit_price=?,ros_date=?,cdd=?
      WHERE id=?
    `, [line_number, description, qty||null, uom||'EA', uom_id||null, unit_price||null, ros_date||null, cdd||null, lineId])
    const [[line]] = await db.query('SELECT * FROM po_lines WHERE id=?', [lineId])
    res.json(line)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.delete('/pos/:id/lines/:lineId', async (req, res) => {
  try {
    await db.query('DELETE FROM po_lines WHERE id=?', [Number(req.params.lineId)])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── ACTION NOTES ─────────────────────────────────────────────────────────────
// GET /api/procurement/pos/:id/notes — chronological note thread for PO Detail tab
router.get('/pos/:id/notes', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [notes] = await db.query(`
      SELECT n.*, u.full_name AS author_name, u.role AS author_role
      FROM po_action_notes n
      JOIN users u ON u.id = n.created_by
      WHERE n.po_id = ?
      ORDER BY n.created_at ASC
    `, [id])
    res.json(notes)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/procurement/pos/:id/notes — add a note
router.post('/pos/:id/notes', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { note_text, note_type = 'general', is_internal = true } = req.body
    if (!note_text?.trim()) return res.status(400).json({ error: 'Note text is required' })
    const [r] = await db.query(
      'INSERT INTO po_action_notes (po_id, note_text, is_internal, created_by) VALUES (?,?,?,?)',
      [id, note_text.trim(), is_internal ? 1 : 0, req.user.id]
    )
    const [[note]] = await db.query(
      'SELECT n.*, u.full_name AS author_name, u.role AS author_role FROM po_action_notes n JOIN users u ON u.id=n.created_by WHERE n.id=?',
      [r.insertId]
    )
    audit(req, 'note_added', `purchase_orders/${id}`, null, { note_type })
    res.status(201).json(note)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── VARIATIONS ───────────────────────────────────────────────────────────────
// GET /api/procurement/pos/:id/variations
router.get('/pos/:id/variations', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [rows] = await db.query(`
      SELECT v.*, u.full_name AS requested_by_name, a.full_name AS approved_by_name
      FROM po_variations v
      LEFT JOIN users u ON u.id = v.requested_by
      LEFT JOIN users a ON a.id = v.approved_by
      WHERE v.po_id = ?
      ORDER BY v.created_at DESC
    `, [id])
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/procurement/pos/:id/variations
router.post('/pos/:id/variations', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { variation_number, reason, value_impact, schedule_impact_days } = req.body
    if (!reason?.trim()) return res.status(400).json({ error: 'Reason is required' })
    // Auto-generate variation number if not provided
    const [[{ maxv }]] = await db.query(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(variation_number,4) AS UNSIGNED)),0) AS maxv FROM po_variations WHERE po_id=?", [id]
    )
    const varNum = variation_number?.trim() || `VO-${String(maxv + 1).padStart(3, '0')}`
    const [r] = await db.query(
      'INSERT INTO po_variations (po_id, variation_number, reason, requested_by, value_impact, schedule_impact_days, status, created_by, updated_by) VALUES (?,?,?,?,?,?,\'draft\',?,?)',
      [id, varNum, reason.trim(), req.user.id, value_impact || null, schedule_impact_days || null, req.user.id, req.user.id]
    )
    audit(req, 'variation_raised', `purchase_orders/${id}`, null, { variation_number: varNum, reason })
    const [[variation]] = await db.query('SELECT * FROM po_variations WHERE id=?', [r.insertId])
    res.status(201).json(variation)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── ITP (INSPECTION & TEST PLAN) ─────────────────────────────────────────────
// GET /api/procurement/pos/:id/itp
router.get('/pos/:id/itp', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [reqs] = await db.query(
      'SELECT i.*, u.full_name AS created_by_name FROM itp_requirements i LEFT JOIN users u ON u.id=i.created_by WHERE i.po_id=? ORDER BY i.id',
      [id]
    )
    // Get items for each requirement
    for (const req_ of reqs) {
      const [items] = await db.query(
        'SELECT it.*, u.full_name AS actioned_by_name FROM itp_items it LEFT JOIN users u ON u.id=it.actioned_by WHERE it.requirement_id=? ORDER BY it.id',
        [req_.id]
      )
      req_.items = items
    }
    res.json(reqs)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/procurement/pos/:id/itp
router.post('/pos/:id/itp', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { description, inspection_type = 'review', is_mandatory = true } = req.body
    if (!description?.trim()) return res.status(400).json({ error: 'Description is required' })
    const [r] = await db.query(
      'INSERT INTO itp_requirements (po_id, description, inspection_type, is_mandatory, created_by) VALUES (?,?,?,?,?)',
      [id, description.trim(), inspection_type, is_mandatory ? 1 : 0, req.user.id]
    )
    const [[row]] = await db.query('SELECT * FROM itp_requirements WHERE id=?', [r.insertId])
    res.status(201).json({ ...row, items: [] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── KEY DATES HISTORY ────────────────────────────────────────────────────────
// GET /api/procurement/pos/:id/date-history — date_change_log for this PO
router.get('/pos/:id/date-history', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [rows] = await db.query(`
      SELECT d.*, u.full_name AS changed_by_name
      FROM date_change_log d
      LEFT JOIN users u ON u.id = d.created_by
      WHERE d.entity_type = 'purchase_order' AND d.entity_id = ?
      ORDER BY d.created_at DESC
    `, [id])
    res.json(rows)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /api/procurement/pos/:id/dates — update a milestone/key date with mandatory reason
router.put('/pos/:id/dates', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { field, value, reason } = req.body
    const ALLOWED_DATE_FIELDS = new Set([
      'milestone_po_date', 'milestone_fat_date', 'milestone_esd_date',
      'milestone_eta_date', 'milestone_ros_date', 'ros_date',
      'contract_delivery_date', 'estimated_delivery_date',
    ])
    if (!ALLOWED_DATE_FIELDS.has(field)) return res.status(400).json({ error: 'Invalid date field' })
    if (!reason?.trim()) return res.status(400).json({ error: 'A reason is required for date changes' })

    // Get old value
    const [[po]] = await db.query(`SELECT ${field} AS old_val FROM purchase_orders WHERE id=?`, [id])
    const oldVal = po?.old_val ?? null

    await db.query(`UPDATE purchase_orders SET ${field}=? WHERE id=?`, [value || null, id])

    // Record in date_change_log
    await db.query(
      'INSERT INTO date_change_log (entity_type, entity_id, field_name, old_value, new_value, change_reason, created_by) VALUES (?,?,?,?,?,?,?)',
      ['purchase_order', id, field, oldVal, value || null, reason.trim(), req.user.id]
    )
    audit(req, 'date_changed', `purchase_orders/${id}`,
      { [field]: oldVal, reason: null },
      { [field]: value || null, reason }
    )
    res.json({ ok: true, field, old: oldVal, new: value })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── DOCUMENTS LIST ───────────────────────────────────────────────────────────
// GET /api/procurement/pos/:id/documents — all documents (not just current signed PO)
router.get('/pos/:id/documents', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const [docs] = await db.query(`
      SELECT pd.*, u.full_name AS uploaded_by_name
      FROM po_documents pd
      JOIN users u ON u.id = pd.uploaded_by
      WHERE pd.po_id = ?
      ORDER BY pd.doc_type, pd.version DESC
    `, [id])
    res.json(docs)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── AUDIT TRAIL FOR SINGLE PO ────────────────────────────────────────────────
// GET /api/procurement/pos/:id/audit
router.get('/pos/:id/audit', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { page = 1, limit = 100 } = req.query
    const off = (Number(page) - 1) * Number(limit)
    const [rows] = await db.query(`
      SELECT a.*, u.full_name AS user_name, u.role AS user_role
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE (a.entity_type = 'purchase_order' AND a.entity_id = ?)
         OR a.resource LIKE ?
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `, [id, `%purchase_orders/${id}%`, Number(limit), off])
    const [[{ total }]] = await db.query(
      "SELECT COUNT(*) AS total FROM audit_log WHERE (entity_type='purchase_order' AND entity_id=?) OR resource LIKE ?",
      [id, `%purchase_orders/${id}%`]
    )
    res.json({ rows, total: total })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
