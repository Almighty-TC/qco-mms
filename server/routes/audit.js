// ─── AUDIT VIEWER ROUTES ──────────────────────────────────────────────────────
// Global, read-only viewer over audit_log (the immutable, append-only trail).
// READ gate: requirePermission('audit','can_view') — admin + the oversight roles
//   (auditor/ceo/director/expediting_manager/procurement_manager/project_director).
//   The lowest-privilege 'viewer' role was revoked audit.view (rbac seed correction).
// audit_log is NEVER written from any route here. QA sign-off (C2) writes go to a
// SEPARATE audit_review table and gate on requirePermission('audit_review',...).
// Security: parameterised queries only; pooled connection (require('../db')).
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { dbError } = require('../utils/dbError')
const { authenticateToken } = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')
const { sealCheckpoint, verifyChain } = require('../lib/auditChain')

router.use(authenticateToken)

// ─── GET /api/audit/verify ── chain + content integrity for both tables ──
// Read-only; gated like the viewer. Returns { status, tables:{ audit_log, audit_review } }.
router.get('/verify', requirePermission('audit', 'can_view'), async (req, res) => {
  try {
    const tables = {}
    for (const t of ['audit_log', 'audit_review']) tables[t] = await verifyChain(db, t)
    const status = Object.values(tables).every(v => v.status === 'verified') ? 'verified' : 'broken'
    res.json({ status, tables })
  } catch (e) {
    console.error('[audit:verify]', e.message)
    dbError(res, e)
  }
})

// ─── POST /api/audit/checkpoint ── seal a new chain anchor (admin/auditor) ──
// Appends an audit_checkpoint for each table. Gated to the reviewer set
// (audit_review.can_create = admin + auditor). NOT behind denyReadOnly.
router.post('/checkpoint', requirePermission('audit_review', 'can_create'), async (req, res) => {
  try {
    const sealed = {}
    for (const t of ['audit_log', 'audit_review']) sealed[t] = await sealCheckpoint(db, t, req.user.id)
    res.status(201).json(sealed)
  } catch (e) {
    console.error('[audit:checkpoint]', e.message)
    dbError(res, e)
  }
})

// ─── WHITELISTED SORT ────────────────────────────────────────
// Maps UI keys → real columns; never interpolate raw input. Every paginated query
// ends ORDER BY with the unique a.id tiebreaker (rollout standing rule) so OFFSET
// windows can't overlap/drop rows with equal created_at.
const SAFE_SORT = {
  created_at: 'a.created_at', action: 'a.action', entity_type: 'a.entity_type',
  user: 'u.full_name', project: 'p.name', entity_id: 'a.entity_id',
}

// ─── GET /api/audit ──────────────────────────────────────────
// Paginated, filtered, sorted list. Envelope { data, total, page, limit }.
// Read-only — no writes to audit_log anywhere in this handler.
router.get('/', requirePermission('audit', 'can_view'), async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1', 10))
    const limit  = Math.min(100000, Math.max(1, parseInt(req.query.limit || '50', 10)))
    const offset = (page - 1) * limit

    // ─── FILTERS (server-side, whole-set) ───
    const where  = ['1=1']
    const params = []
    const { action, entity_type, user_id, date_from, date_to, search, project_id } = req.query
    if (action)  { where.push('a.action = ?'); params.push(action) }
    // entity_type: explicit "(none)" sentinel matches the NULL bucket
    if (entity_type === '(none)') where.push('a.entity_type IS NULL')
    else if (entity_type)         { where.push('a.entity_type = ?'); params.push(entity_type) }
    if (user_id)   { where.push('a.user_id = ?'); params.push(Number(user_id)) }
    if (date_from) { where.push('a.created_at >= ?'); params.push(date_from) }
    if (date_to)   { where.push('a.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(date_to) } // inclusive of the whole end day
    // project_id: "unscoped" sentinel matches NULL project rows
    if (project_id === 'unscoped') where.push('a.project_id IS NULL')
    else if (project_id)           { where.push('a.project_id = ?'); params.push(Number(project_id)) }
    if (search) {
      const q = `%${search}%`
      where.push('(a.resource LIKE ? OR a.reason_detail LIKE ? OR a.reason_category LIKE ? OR a.action LIKE ? OR a.entity_type LIKE ?)')
      params.push(q, q, q, q, q)
    }
    const whereSql = where.join(' AND ')

    const orderBy  = SAFE_SORT[req.query.sort_col] || 'a.created_at'
    const orderDir = String(req.query.sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC' // default DESC (newest first)

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE ${whereSql}`, params
    )

    // ─── LATEST-REVIEW JOIN ──────────────────────────────────
    // Full-history model: each audit row may have many audit_review rows. For the
    // displayed status we join only the MOST RECENT one (reviewed_at DESC, id DESC
    // tiebreaker → deterministic single row), using idx_ar_latest. All review rows
    // stay queryable via /:auditLogId/review-history. review_count drives the UI's
    // "history" affordance. (This is a read concern — no audit_log writes.)
    const [rows] = await db.query(
      `SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.project_id,
              a.before_value, a.after_value, a.reason_category, a.reason_detail,
              a.resource, a.ip, a.created_at,
              u.full_name AS user_name, u.role AS user_role,
              p.name AS project_name, p.code AS project_code,
              rv.review_status AS review_status, rv.reviewed_at AS reviewed_at,
              rv.review_note AS review_note, ru.full_name AS reviewed_by_name,
              (SELECT COUNT(*) FROM audit_review arc WHERE arc.audit_log_id = a.id) AS review_count
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN projects p ON p.id = a.project_id
       LEFT JOIN audit_review rv ON rv.id = (
         SELECT ar2.id FROM audit_review ar2
         WHERE ar2.audit_log_id = a.id
         ORDER BY ar2.reviewed_at DESC, ar2.id DESC LIMIT 1
       )
       LEFT JOIN users ru ON ru.id = rv.reviewed_by
       WHERE ${whereSql}
       ORDER BY ${orderBy} ${orderDir}, a.id ${orderDir}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    res.json({ data: rows, total, page, limit })
  } catch (e) {
    console.error('[audit:list]', e.message)
    dbError(res, e)
  }
})

// ─── GET /api/audit/filters ──────────────────────────────────
// Distinct values from real data to populate the filter dropdowns. Read-only.
router.get('/filters', requirePermission('audit', 'can_view'), async (req, res) => {
  try {
    const [actions]  = await db.query(`SELECT action, COUNT(*) AS c FROM audit_log GROUP BY action ORDER BY c DESC`)
    const [entities] = await db.query(`SELECT entity_type, COUNT(*) AS c FROM audit_log GROUP BY entity_type ORDER BY c DESC`)
    const [users]    = await db.query(
      `SELECT DISTINCT u.id, u.full_name FROM audit_log a JOIN users u ON u.id = a.user_id ORDER BY u.full_name`)
    const [projects] = await db.query(
      `SELECT DISTINCT p.id, p.name, p.code FROM audit_log a JOIN projects p ON p.id = a.project_id ORDER BY p.name`)
    res.json({
      actions:      actions.map(r => ({ value: r.action, count: r.c })),
      // null entity_type surfaced as the "(none)" sentinel the list endpoint understands
      entity_types: entities.map(r => ({ value: r.entity_type === null ? '(none)' : r.entity_type, count: r.c })),
      users,
      projects,
    })
  } catch (e) {
    console.error('[audit:filters]', e.message)
    dbError(res, e)
  }
})

// ═══════════════════════════════════════════════════════════════
// QA SIGN-OFF — audit_review (APPEND-ONLY, full history)
// Writes go ONLY to audit_review; audit_log is never touched. The review layer is
// itself auditable, so reviews are appended (never UPDATE/UPSERT/DELETE) — a
// flag→clear sequence is preserved as two rows.
// Gating: requirePermission('audit_review','can_create') = admin + auditor.
// CRITICAL: these write routes are NOT behind denyReadOnly (permissions.js floor
// blocks 'auditor' on writes) — that would lock out the role that owns this flow.
// ═══════════════════════════════════════════════════════════════
const REVIEW_STATUSES = new Set(['reviewed', 'flagged'])

// ─── POST /api/audit/review/batch ── append one review row per audit_log_id ──
// Registered before /:auditLogId/review so the literal path always wins.
router.post('/review/batch', requirePermission('audit_review', 'can_create'), async (req, res) => {
  try {
    const { audit_log_ids, review_status, review_note } = req.body || {}
    if (!Array.isArray(audit_log_ids) || audit_log_ids.length === 0) return res.status(400).json({ error: 'audit_log_ids[] required' })
    if (!REVIEW_STATUSES.has(review_status)) return res.status(400).json({ error: "review_status must be 'reviewed' or 'flagged'" })
    const ids = audit_log_ids.map(Number).filter(Number.isFinite)
    if (!ids.length) return res.status(400).json({ error: 'no valid audit_log_ids' })
    // Validate the target rows exist (FK would reject, but give a clean 4xx)
    const [found] = await db.query(`SELECT id FROM audit_log WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    if (found.length !== ids.length) return res.status(404).json({ error: 'one or more audit_log_ids not found' })
    const values = ids.map(id => [id, req.user.id, review_status, review_note || null])
    const [r] = await db.query(
      `INSERT INTO audit_review (audit_log_id, reviewed_by, review_status, review_note) VALUES ?`, [values])
    res.status(201).json({ inserted: r.affectedRows, review_status })
  } catch (e) {
    console.error('[audit:review:batch]', e.message)
    dbError(res, e)
  }
})

// ─── POST /api/audit/:auditLogId/review ── append a single review row ──
router.post('/:auditLogId/review', requirePermission('audit_review', 'can_create'), async (req, res) => {
  try {
    const auditLogId = Number(req.params.auditLogId)
    const { review_status, review_note } = req.body || {}
    if (!Number.isFinite(auditLogId)) return res.status(400).json({ error: 'invalid auditLogId' })
    if (!REVIEW_STATUSES.has(review_status)) return res.status(400).json({ error: "review_status must be 'reviewed' or 'flagged'" })
    const [[exists]] = await db.query('SELECT id FROM audit_log WHERE id = ?', [auditLogId])
    if (!exists) return res.status(404).json({ error: 'audit_log entry not found' })
    // APPEND — never update an existing review row.
    const [r] = await db.query(
      `INSERT INTO audit_review (audit_log_id, reviewed_by, review_status, review_note) VALUES (?,?,?,?)`,
      [auditLogId, req.user.id, review_status, review_note || null])
    const [[row]] = await db.query(
      `SELECT ar.id, ar.audit_log_id, ar.review_status, ar.reviewed_at, ar.reviewed_by, ar.review_note,
              u.full_name AS reviewed_by_name
       FROM audit_review ar LEFT JOIN users u ON u.id = ar.reviewed_by WHERE ar.id = ?`, [r.insertId])
    res.status(201).json(row)
  } catch (e) {
    console.error('[audit:review:create]', e.message)
    dbError(res, e)
  }
})

// ─── GET /api/audit/:auditLogId/review-history ── full review trail, newest first ──
// Read concern — gated like the viewer. Uses idx_ar_latest (audit_log_id, reviewed_at).
router.get('/:auditLogId/review-history', requirePermission('audit', 'can_view'), async (req, res) => {
  try {
    const auditLogId = Number(req.params.auditLogId)
    const [rows] = await db.query(
      `SELECT ar.id, ar.audit_log_id, ar.review_status, ar.reviewed_at, ar.reviewed_by, ar.review_note,
              u.full_name AS reviewed_by_name, u.role AS reviewed_by_role
       FROM audit_review ar LEFT JOIN users u ON u.id = ar.reviewed_by
       WHERE ar.audit_log_id = ?
       ORDER BY ar.reviewed_at DESC, ar.id DESC`, [auditLogId])
    res.json({ data: rows })
  } catch (e) {
    console.error('[audit:review:history]', e.message)
    dbError(res, e)
  }
})

module.exports = router
