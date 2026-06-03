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
const { authenticateToken } = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

router.use(authenticateToken)

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
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)))
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

    const [rows] = await db.query(
      `SELECT a.id, a.user_id, a.action, a.entity_type, a.entity_id, a.project_id,
              a.before_value, a.after_value, a.reason_category, a.reason_detail,
              a.resource, a.ip, a.created_at,
              u.full_name AS user_name, u.role AS user_role,
              p.name AS project_name, p.code AS project_code
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN projects p ON p.id = a.project_id
       WHERE ${whereSql}
       ORDER BY ${orderBy} ${orderDir}, a.id ${orderDir}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    res.json({ data: rows, total, page, limit })
  } catch (e) {
    console.error('[audit:list]', e.message)
    res.status(500).json({ error: e.message })
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
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
