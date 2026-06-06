// ─── MEETING / RFI ROUTES (C2) ────────────────────────────────
// One register, two record types (record_type: 'rfi' | 'meeting') sharing the
// workflow spine. Mounted at /api/rfi-meeting. Pooled connections only (../db).
// All routes require a valid JWT. Reads gated on can_view; writes via the matrix
// (create=can_create, edits/transitions=can_edit, close=can_approve). External
// roles are respond-only AND row-restricted to records assigned to them.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { dbError } = require('../utils/dbError')
const { authenticateToken } = require('../middleware/auth')
const { enforce, denyReadOnly, requirePermission } = require('../middleware/permissions')

router.use(authenticateToken)
router.use(denyReadOnly)            // viewer/auditor barred from writes (floor)
router.use(enforce('rfi_meeting'))  // POST→can_create, PATCH→can_edit, DELETE→can_delete; GET passes

// ─── AUDIT HELPER (mirrors the house writeAudit) ──────────────
async function writeAudit(userId, action, entity, id, before, after, resource, projectId = null) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id,action,entity_type,entity_id,project_id,before_value,after_value,resource) VALUES (?,?,?,?,?,?,?,?)`,
      [userId, action, entity, id, (Number(projectId) || null),
       before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, resource])
  } catch (e) { console.error('[audit] insert failed:', e.message) }
}
const resourceOf = req => (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/)/, '')

// ─── DOMAIN CONSTANTS ─────────────────────────────────────────
const EXTERNAL_ROLES = new Set(['vendor', 'subcontractor', 'site_contractor', 'freight_forwarder'])
const TYPE_PREFIX    = { rfi: 'RFI', meeting: 'MTG' }
const INITIAL_STATUS = { rfi: 'draft', meeting: 'scheduled' }
const LINK_TABLE     = { wbs: { t: 'wbs_nodes', label: 'code' }, po: { t: 'purchase_orders', label: 'po_number' }, scn: { t: 'shipment_control_notes', label: 'scn_ref' } }

// Legal transitions per record_type. The empty arrays are terminal states.
const TRANSITIONS = {
  rfi: {
    draft:    ['open', 'cancelled'],
    open:     ['assigned', 'answered', 'cancelled'],
    assigned: ['answered', 'cancelled'],
    answered: ['closed', 'cancelled'],
    closed:   [], cancelled: [],
  },
  meeting: {
    scheduled:    ['held', 'cancelled'],
    held:         ['actions_open', 'closed', 'cancelled'],
    actions_open: ['closed', 'cancelled'],
    closed:       [], cancelled: [],
  },
}
const CLOSING_STATES = new Set(['closed']) // closing requires can_approve

// ─── PERMISSION HELPERS ───────────────────────────────────────
// Boolean mirror of requirePermission's resolution (override → role default;
// admin bypass) for the in-handler close gate.
async function hasApprove(req) {
  if (req.user.role === 'admin') return true
  const [[ov]] = await db.query(
    'SELECT can_approve AS a FROM user_permission_overrides WHERE user_id=? AND module=? LIMIT 1', [req.user.id, 'rfi_meeting'])
  if (ov && ov.a !== null) return !!ov.a
  const [[p]] = await db.query(
    'SELECT can_approve AS a FROM role_permissions WHERE role=? AND module=? LIMIT 1', [req.user.role, 'rfi_meeting'])
  return !!(p && p.a)
}
const isExternal = req => EXTERNAL_ROLES.has(req.user.role)

// ─── RAG / OVERDUE DERIVATION (computed on read, like progress_pct) ──
async function amberDays() {
  const [[s]] = await db.query("SELECT `value` AS v FROM system_settings WHERE `key`='rfi_amber_days'")
  const n = parseInt(s?.v ?? '3', 10)
  return Number.isFinite(n) ? n : 3
}
// red = overdue (due < today AND not closed/cancelled/answered); amber = due within
// amberDays; green = otherwise / no due date / resolved.
function deriveRag(row, todayMs, amber) {
  const settled = ['closed', 'cancelled', 'answered'].includes(row.status)
  if (!row.due_date || settled) return { is_overdue: false, rag: 'green' }
  const days = Math.floor((new Date(row.due_date).getTime() - todayMs) / 86400000)
  if (days < 0)      return { is_overdue: true,  rag: 'red' }
  if (days <= amber) return { is_overdue: false, rag: 'amber' }
  return { is_overdue: false, rag: 'green' }
}

// ─── LIST (paginated, filtered, sorted) ───────────────────────
// Returns { data, total, page, limit }. Server-side filters; whitelisted sort with
// a unique id tiebreaker on every ORDER BY. Overdue is filtered in SQL so paging
// stays correct across the full set.
router.get('/:projectId', requirePermission('rfi_meeting', 'can_view'), async (req, res) => {
  try {
    const pid    = Number(req.params.projectId)
    const page   = Math.max(1, parseInt(req.query.page || '1', 10))
    const limit  = Math.min(100000, Math.max(1, parseInt(req.query.limit || '50', 10)))
    const offset = (page - 1) * limit

    const where = ['project_id = ?']; const params = [pid]
    if (req.query.type)     { where.push('record_type = ?'); params.push(req.query.type) }
    if (req.query.status)   { where.push('status = ?');      params.push(req.query.status) }
    if (req.query.assignee) { where.push('assigned_to = ?'); params.push(Number(req.query.assignee)) }
    if (req.query.overdue === 'true') {
      where.push("due_date < CURDATE() AND status NOT IN ('closed','cancelled','answered')")
    }
    if (req.query.q) {
      where.push('(ref LIKE ? OR title LIKE ? OR link_label LIKE ?)')
      const like = `%${req.query.q}%`; params.push(like, like, like)
    }
    const whereSql = where.join(' AND ')

    const SAFE_SORT = { ref: 'ref', title: 'title', status: 'status', priority: 'priority',
      raised_date: 'raised_date', due_date: 'due_date', assigned_to: 'assigned_to', record_type: 'record_type' }
    const orderBy  = SAFE_SORT[req.query.sort_col] || 'raised_date'
    const orderDir = String(req.query.sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM rfi_meeting_records WHERE ${whereSql}`, params)
    const [rows] = await db.query(
      `SELECT r.id, r.project_id, r.record_type, r.ref, r.title, r.status, r.priority,
              r.link_type, r.link_id, r.link_label, r.raised_by, r.assigned_to,
              ur.full_name AS raised_by_name, ua.full_name AS assigned_to_name,
              DATE_FORMAT(r.raised_date,'%Y-%m-%d') AS raised_date,
              DATE_FORMAT(r.due_date,'%Y-%m-%d')    AS due_date,
              DATE_FORMAT(r.closed_date,'%Y-%m-%d') AS closed_date
       FROM rfi_meeting_records r
       LEFT JOIN users ur ON ur.id = r.raised_by
       LEFT JOIN users ua ON ua.id = r.assigned_to
       WHERE ${whereSql}
       ORDER BY r.${orderBy} ${orderDir}, r.id ${orderDir}
       LIMIT ? OFFSET ?`, [...params, limit, offset])

    const amber = await amberDays(); const todayMs = new Date(new Date().toISOString().slice(0, 10)).getTime()
    res.json({ data: rows.map(r => ({ ...r, ...deriveRag(r, todayMs, amber) })), total, page, limit })
  } catch (e) { dbError(res, e) }
})

// ─── PROJECT USERS (assignee dropdown) ────────────────────────
// Defined BEFORE GET /:projectId/:id so '/users' isn't captured as an :id.
router.get('/:projectId/users', requirePermission('rfi_meeting', 'can_view'), async (_req, res) => {
  try {
    const [rows] = await db.query('SELECT id, full_name AS name, role FROM users WHERE is_active=1 ORDER BY full_name')
    res.json(rows)
  } catch (e) { dbError(res, e) }
})

// ─── LINK-PICKER OPTIONS (project-scoped target lists) ────────
router.get('/:projectId/link-options/:type', requirePermission('rfi_meeting', 'can_view'), async (req, res) => {
  try {
    const cfg = LINK_TABLE[req.params.type]
    if (!cfg) return res.status(400).json({ error: 'Invalid link type' })
    const [rows] = await db.query(
      `SELECT id, \`${cfg.label}\` AS label FROM ${cfg.t} WHERE project_id=? ORDER BY \`${cfg.label}\` LIMIT 500`,
      [Number(req.params.projectId)])
    res.json(rows)
  } catch (e) { dbError(res, e) }
})

// ─── GET ONE ──────────────────────────────────────────────────
router.get('/:projectId/:id', requirePermission('rfi_meeting', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const [[row]] = await db.query(
      `SELECT r.*, ur.full_name AS raised_by_name, ua.full_name AS assigned_to_name
       FROM rfi_meeting_records r
       LEFT JOIN users ur ON ur.id = r.raised_by
       LEFT JOIN users ua ON ua.id = r.assigned_to
       WHERE r.id=? AND r.project_id=?`, [Number(req.params.id), pid])
    if (!row) return res.status(404).json({ error: 'Record not found in this project' })
    const amber = await amberDays(); const todayMs = new Date(new Date().toISOString().slice(0, 10)).getTime()
    res.json({ ...row, ...deriveRag(row, todayMs, amber) })
  } catch (e) { dbError(res, e) }
})

// ─── CREATE (auto-gen ref RFI-0001 / MTG-0001 per project+type) ──
router.post('/:projectId', async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const uid = req.user.id
    const { record_type, title, description, priority, due_date, assigned_to } = req.body
    if (!TYPE_PREFIX[record_type]) return res.status(400).json({ error: "record_type must be 'rfi' or 'meeting'" })
    if (!title || !title.trim())   return res.status(422).json({ error: 'Title is required' })

    const prefix = TYPE_PREFIX[record_type]
    const [[{ mx }]] = await db.query(
      'SELECT COALESCE(MAX(CAST(SUBSTRING(ref, ?) AS UNSIGNED)),0) AS mx FROM rfi_meeting_records WHERE project_id=? AND record_type=?',
      [prefix.length + 2, pid, record_type])
    const ref = `${prefix}-${String(Number(mx) + 1).padStart(4, '0')}` // Number(): CAST result returns as a string

    const [r] = await db.query(
      `INSERT INTO rfi_meeting_records
         (project_id, record_type, ref, title, description, status, priority,
          raised_by, assigned_to, raised_date, due_date, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,CURDATE(),?,?)`,
      [pid, record_type, ref, title.trim(), description || null, INITIAL_STATUS[record_type],
       priority || 'normal', uid, assigned_to || null, due_date || null, uid])

    await writeAudit(uid, 'rfi_meeting_created', 'rfi_meeting_record', r.insertId, null,
      { record_type, ref, title: title.trim() }, resourceOf(req), pid)
    res.status(201).json({ id: r.insertId, ref, status: INITIAL_STATUS[record_type] })
  } catch (e) { dbError(res, e) }
})

// ─── WORKFLOW TRANSITION (validated state machine) ────────────
// PATCH → enforce maps to can_edit. Closing additionally needs can_approve.
// External roles may only transition records assigned to them.
router.patch('/:projectId/:id/transition', async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const uid = req.user.id
    const { to, response, assigned_to } = req.body
    const [[rec]] = await db.query('SELECT * FROM rfi_meeting_records WHERE id=? AND project_id=?', [Number(req.params.id), pid])
    if (!rec) return res.status(404).json({ error: 'Record not found in this project' })

    if (isExternal(req) && rec.assigned_to !== uid)
      return res.status(403).json({ error: 'You can only act on records assigned to you' })

    const legal = TRANSITIONS[rec.record_type]?.[rec.status] || []
    if (!legal.includes(to))
      return res.status(409).json({ error: `Illegal transition: ${rec.record_type} cannot go ${rec.status} → ${to}` })

    if (CLOSING_STATES.has(to) && !(await hasApprove(req)))
      return res.status(403).json({ error: 'Closing requires confirmer (can_approve) permission' })

    const before = { status: rec.status, assigned_to: rec.assigned_to }
    const sets = ['status=?']; const vals = [to]
    if (to === 'assigned' && assigned_to) { sets.push('assigned_to=?'); vals.push(Number(assigned_to)) }
    if (response !== undefined)           { sets.push('response=?');    vals.push(response || null) }
    if (CLOSING_STATES.has(to))           { sets.push('closed_date=CURDATE()') }
    vals.push(rec.id)
    await db.query(`UPDATE rfi_meeting_records SET ${sets.join(', ')} WHERE id=?`, vals)

    await writeAudit(uid, `rfi_meeting_${to}`, 'rfi_meeting_record', rec.id, before, { status: to }, resourceOf(req), pid)
    res.json({ id: rec.id, status: to })
  } catch (e) { dbError(res, e) }
})

// ─── SET / CLEAR POLYMORPHIC LINK (FK + snapshot label) ───────
router.patch('/:projectId/:id/link', async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const uid = req.user.id
    const { link_type, link_id } = req.body
    if (!['project', 'wbs', 'po', 'scn'].includes(link_type)) return res.status(400).json({ error: 'Invalid link_type' })

    const [[rec]] = await db.query('SELECT id, assigned_to, link_type, link_label FROM rfi_meeting_records WHERE id=? AND project_id=?', [Number(req.params.id), pid])
    if (!rec) return res.status(404).json({ error: 'Record not found in this project' })
    if (isExternal(req) && rec.assigned_to !== uid)
      return res.status(403).json({ error: 'You can only act on records assigned to you' })

    let lid = null, label = null
    if (link_type !== 'project') {
      const cfg = LINK_TABLE[link_type]
      const [[tgt]] = await db.query(`SELECT \`${cfg.label}\` AS label FROM ${cfg.t} WHERE id=? AND project_id=?`, [Number(link_id), pid])
      if (!tgt) return res.status(404).json({ error: `${link_type.toUpperCase()} not found in this project` })
      lid = Number(link_id); label = tgt.label   // snapshot the label at write time
    }
    const before = { link_type: rec.link_type, link_label: rec.link_label }
    await db.query('UPDATE rfi_meeting_records SET link_type=?, link_id=?, link_label=? WHERE id=?', [link_type, lid, label, rec.id])
    await writeAudit(uid, 'rfi_meeting_linked', 'rfi_meeting_record', rec.id, before, { link_type, link_id: lid, link_label: label }, resourceOf(req), pid)
    res.json({ id: rec.id, link_type, link_id: lid, link_label: label })
  } catch (e) { dbError(res, e) }
})

// ─── EDIT FIELDS / RESPOND (no status change) ─────────────────
// can_edit floor (enforce) + assigned-only for external roles.
router.patch('/:projectId/:id', async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const uid = req.user.id
    const [[rec]] = await db.query('SELECT * FROM rfi_meeting_records WHERE id=? AND project_id=?', [Number(req.params.id), pid])
    if (!rec) return res.status(404).json({ error: 'Record not found in this project' })
    if (isExternal(req) && rec.assigned_to !== uid)
      return res.status(403).json({ error: 'You can only act on records assigned to you' })

    const EDITABLE = { title: 'title', description: 'description', priority: 'priority',
      due_date: 'due_date', assigned_to: 'assigned_to', response: 'response' }
    const sets = []; const vals = []; const after = {}
    for (const [k, col] of Object.entries(EDITABLE)) {
      if (req.body[k] !== undefined) { sets.push(`${col}=?`); vals.push(req.body[k] || null); after[k] = req.body[k] }
    }
    if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' })
    vals.push(rec.id)
    await db.query(`UPDATE rfi_meeting_records SET ${sets.join(', ')} WHERE id=?`, vals)
    await writeAudit(uid, 'rfi_meeting_edited', 'rfi_meeting_record', rec.id, null, after, resourceOf(req), pid)
    res.json({ id: rec.id, ...after })
  } catch (e) { dbError(res, e) }
})

// ═══ MEETING CHILDREN (C5: attendees + action items) ═══════════
// Permission story: POST (add) = can_create → internal owners; PATCH (update) =
// can_edit → internal + external assignees (row-restricted); DELETE = can_delete →
// admin. The backend stays the enforcer; the UI presents accordingly.
const ACTION_TRANSITIONS = { open: ['in_progress', 'done', 'cancelled'], in_progress: ['done', 'cancelled'], done: [], cancelled: [] }

// Loads a meeting record scoped to project (404 if missing / not a meeting).
async function loadMeeting(pid, id) {
  const [[m]] = await db.query("SELECT id, record_type, assigned_to FROM rfi_meeting_records WHERE id=? AND project_id=?", [id, pid])
  if (!m) return { err: [404, 'Meeting not found in this project'] }
  if (m.record_type !== 'meeting') return { err: [400, 'Attendees and actions apply to meetings only'] }
  return { m }
}

// ─── ATTENDEES ────────────────────────────────────────────────
router.get('/:projectId/:id/attendees', requirePermission('rfi_meeting', 'can_view'), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, user_id, attendee_name, attendee_org, attended FROM meeting_attendees WHERE record_id=? ORDER BY id', [Number(req.params.id)])
    res.json(rows)
  } catch (e) { dbError(res, e) }
})
router.post('/:projectId/:id/attendees', async (req, res) => {
  try {
    const pid = Number(req.params.projectId), id = Number(req.params.id), uid = req.user.id
    const { m, err } = await loadMeeting(pid, id); if (err) return res.status(err[0]).json({ error: err[1] })
    const { attendee_name, attendee_org, user_id, attended } = req.body
    if (!attendee_name || !attendee_name.trim()) return res.status(422).json({ error: 'Attendee name is required' })
    const [r] = await db.query('INSERT INTO meeting_attendees (record_id, user_id, attendee_name, attendee_org, attended) VALUES (?,?,?,?,?)',
      [m.id, user_id || null, attendee_name.trim(), attendee_org || null, attended === false ? 0 : 1])
    await writeAudit(uid, 'meeting_attendee_added', 'rfi_meeting_record', id, null, { attendee_name: attendee_name.trim() }, resourceOf(req), pid)
    res.status(201).json({ id: r.insertId })
  } catch (e) { dbError(res, e) }
})
router.delete('/:projectId/:id/attendees/:attendeeId', async (req, res) => {
  try {
    const pid = Number(req.params.projectId), id = Number(req.params.id)
    const { err } = await loadMeeting(pid, id); if (err) return res.status(err[0]).json({ error: err[1] })
    await db.query('DELETE FROM meeting_attendees WHERE id=? AND record_id=?', [Number(req.params.attendeeId), id])
    await writeAudit(req.user.id, 'meeting_attendee_removed', 'rfi_meeting_record', id, null, { attendee_id: Number(req.params.attendeeId) }, resourceOf(req), pid)
    res.json({ ok: true })
  } catch (e) { dbError(res, e) }
})

// ─── ACTION ITEMS (each its own mini-workflow) ────────────────
router.get('/:projectId/:id/actions', requirePermission('rfi_meeting', 'can_view'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.id, a.seq, a.description, a.assigned_to, u.full_name AS assigned_to_name, a.status,
              DATE_FORMAT(a.due_date,'%Y-%m-%d') AS due_date, DATE_FORMAT(a.closed_date,'%Y-%m-%d') AS closed_date
       FROM meeting_actions a LEFT JOIN users u ON u.id = a.assigned_to
       WHERE a.record_id=? ORDER BY a.seq`, [Number(req.params.id)])
    res.json(rows)
  } catch (e) { dbError(res, e) }
})
router.post('/:projectId/:id/actions', async (req, res) => {
  try {
    const pid = Number(req.params.projectId), id = Number(req.params.id), uid = req.user.id
    const { m, err } = await loadMeeting(pid, id); if (err) return res.status(err[0]).json({ error: err[1] })
    const { description, assigned_to, due_date } = req.body
    if (!description || !description.trim()) return res.status(422).json({ error: 'Action description is required' })
    const [[{ mx }]] = await db.query('SELECT COALESCE(MAX(seq),0) AS mx FROM meeting_actions WHERE record_id=?', [m.id])
    const [r] = await db.query('INSERT INTO meeting_actions (record_id, project_id, seq, description, assigned_to, due_date) VALUES (?,?,?,?,?,?)',
      [m.id, pid, Number(mx) + 1, description.trim(), assigned_to || null, due_date || null])
    await writeAudit(uid, 'meeting_action_added', 'rfi_meeting_record', id, null, { seq: Number(mx) + 1, description: description.trim() }, resourceOf(req), pid)
    res.status(201).json({ id: r.insertId, seq: Number(mx) + 1 })
  } catch (e) { dbError(res, e) }
})
router.patch('/:projectId/:id/actions/:actionId', async (req, res) => {
  try {
    const pid = Number(req.params.projectId), id = Number(req.params.id), uid = req.user.id
    const { err } = await loadMeeting(pid, id); if (err) return res.status(err[0]).json({ error: err[1] })
    const [[act]] = await db.query('SELECT * FROM meeting_actions WHERE id=? AND record_id=?', [Number(req.params.actionId), id])
    if (!act) return res.status(404).json({ error: 'Action not found' })
    // external roles may only update actions assigned to them
    if (isExternal(req) && act.assigned_to !== uid) return res.status(403).json({ error: 'You can only update actions assigned to you' })

    const { to, description, assigned_to, due_date } = req.body
    const sets = []; const vals = []; const after = {}
    if (to !== undefined) {
      if (!(ACTION_TRANSITIONS[act.status] || []).includes(to))
        return res.status(409).json({ error: `Illegal action transition: ${act.status} → ${to}` })
      sets.push('status=?'); vals.push(to); after.status = to
      if (to === 'done') sets.push('closed_date=CURDATE()')
    }
    for (const [k, col] of [['description', 'description'], ['assigned_to', 'assigned_to'], ['due_date', 'due_date']]) {
      if (req.body[k] !== undefined) { sets.push(`${col}=?`); vals.push(req.body[k] || null); after[k] = req.body[k] }
    }
    if (!sets.length) return res.status(400).json({ error: 'No changes supplied' })
    vals.push(act.id)
    await db.query(`UPDATE meeting_actions SET ${sets.join(', ')} WHERE id=?`, vals)
    await writeAudit(uid, 'meeting_action_updated', 'rfi_meeting_record', id, { status: act.status }, after, resourceOf(req), pid)
    res.json({ id: act.id, ...after })
  } catch (e) { dbError(res, e) }
})

module.exports = router
