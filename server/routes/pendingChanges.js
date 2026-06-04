// ─── PENDING CHANGES (C-c confirmation workflow) ──────────────
// Stages create/delete for wbs/commodity/equipment/mto until a domain confirmer
// applies them. Edits are free (not staged). Domain routing + baseline-major
// escalation + requester≠confirmer + batch-confirm. Pooled connection only.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken } = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

router.use(authenticateToken)

// module → real table + domain confirmer
const MODULE_TABLE = { wbs: 'wbs_nodes', commodity: 'commodity_library', equipment: 'equipment_list', mto: 'mto_registers' }
const ALLOWED_TABLES = new Set(['wbs_nodes', 'commodity_library', 'equipment_list', 'mto_registers', 'mto_lines'])
// Tables with a NOT-NULL project_id the proposer payload doesn't carry — injected from
// the pending_changes row on apply. (mto_lines excluded: scoped via mto_id, no project_id column.)
const PROJECT_SCOPED = new Set(['wbs_nodes', 'commodity_library', 'equipment_list', 'mto_registers'])
const DOMAIN_CONFIRMER = { wbs: 'project_controls_manager', commodity: 'engineering_lead', equipment: 'engineering_lead', mto: 'engineering_lead' }

// audit row (correct columns + project_id, C3 convention)
function audit(req, action, entityType, entityId, projectId, before, after) {
  const resource = (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/)/, '')
  db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, before_value, after_value, resource, ip)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [req.user.id, action, entityType, entityId, projectId || null,
     before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, resource, req.ip]
  ).catch(e => console.error('[audit] insert failed:', e.message))
}

// Signed baseline-major definition (create/delete scope; edit cases are out of
// the create+delete workflow — see C-c report flag).
async function isBaselineMajor(conn, module, action, entityId) {
  if (action !== 'delete' || !entityId) return false // a fresh create has no downstream links
  if (module === 'wbs') {
    const [[n]] = await conn.query('SELECT code FROM wbs_nodes WHERE id=?', [entityId])
    if (!n) return false
    const [[kids]] = await conn.query('SELECT COUNT(*) c FROM wbs_nodes WHERE parent_id=?', [entityId])
    const [[poRef]] = await conn.query("SELECT COUNT(*) c FROM po_lines WHERE wbs_code_snapshot=? OR wbs_code_snapshot LIKE CONCAT(?, '.%')", [n.code, n.code])
    const [[mtoRef]] = await conn.query('SELECT COUNT(*) c FROM mto_lines WHERE wbs_code=?', [n.code])
    return kids.c > 0 || poRef.c > 0 || mtoRef.c > 0
  }
  if (module === 'commodity') { const [[r]] = await conn.query('SELECT COUNT(*) c FROM po_lines WHERE commodity_id=?', [entityId]); return r.c > 0 }
  if (module === 'equipment') {
    const [[e]] = await conn.query('SELECT tag FROM equipment_list WHERE id=?', [entityId]); if (!e) return false
    const [[r]] = await conn.query('SELECT (SELECT COUNT(*) FROM po_lines WHERE equipment_tag=?) + (SELECT COUNT(*) FROM warehouse_stock WHERE equipment_tag=?) c', [e.tag, e.tag]); return r.c > 0
  }
  if (module === 'mto') { const [[r]] = await conn.query('SELECT COUNT(*) c FROM mto_lines WHERE mto_id=?', [entityId]); return r.c > 0 }
  return false
}

// ─── POST /submit — stage a create/delete (NOT applied to the real table) ──────
router.post('/:projectId/submit', async (req, res) => {
  const conn = await db.getConnection()
  try {
    const pid = Number(req.params.projectId)
    const { module, entity_type, action, entity_id, proposed, batch_id } = req.body
    if (!MODULE_TABLE[module]) return res.status(400).json({ error: 'Invalid module' })
    if (!['create', 'delete'].includes(action)) return res.status(400).json({ error: 'action must be create or delete (edits are free)' })
    const table = entity_type || MODULE_TABLE[module]
    if (!ALLOWED_TABLES.has(table)) return res.status(400).json({ error: 'Invalid entity_type' })

    // authorize the proposer: must have can_create/can_delete on the module (matrix check)
    const act = action === 'create' ? 'can_create' : 'can_delete'
    if (req.user.role !== 'admin') {
      const [[perm]] = await conn.query(`SELECT ${act} AS a FROM role_permissions WHERE role=? AND module=? LIMIT 1`, [req.user.role, module])
      if (!perm || !perm.a) return res.status(403).json({ error: `Your role cannot ${action} ${module}` })
    }

    const major = await isBaselineMajor(conn, module, action, entity_id)
    const required = major ? 'project_manager' : DOMAIN_CONFIRMER[module]
    const [r] = await conn.query(
      `INSERT INTO pending_changes (project_id, module, entity_type, entity_id, action, proposed, is_baseline_major, required_confirmer_role, batch_id, requested_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [pid, module, table, entity_id || null, action, proposed ? JSON.stringify(proposed) : null, major ? 1 : 0, required, batch_id || null, req.user.id]
    )
    audit(req, `pending_${action}_submitted`, table, entity_id || r.insertId, pid, null, { module, action, required_confirmer_role: required, is_baseline_major: major })
    res.status(201).json({ id: r.insertId, status: 'pending', is_baseline_major: major, required_confirmer_role: required })
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.msg })
    res.status(500).json({ error: e.message })
  } finally { conn.release() }
})

// ─── GET / — queue (only rows THIS user may confirm) ──────────────────────────
router.get('/:projectId/queue', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const role = req.user.role, uid = req.user.id
    // admin sees all pending; others only rows whose required role they hold
    const where = role === 'admin'
      ? 'pc.project_id=? AND pc.status=?'
      : 'pc.project_id=? AND pc.status=? AND pc.required_confirmer_role=?'
    const params = role === 'admin' ? [pid, 'pending'] : [pid, 'pending', role]
    const [rows] = await db.query(
      `SELECT pc.*, ru.full_name AS requested_by_name
       FROM pending_changes pc LEFT JOIN users ru ON ru.id=pc.requested_by
       WHERE ${where} ORDER BY pc.requested_at DESC`, params)
    // mark which this user may actually action (requester≠confirmer)
    res.json(rows.map(r => ({ ...r, can_action: r.requested_by !== uid })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── helper: apply one staged change to the real table (within a txn) ─────────
async function applyChange(conn, row) {
  if (!ALLOWED_TABLES.has(row.entity_type)) throw new Error('blocked entity_type')
  if (row.action === 'create') {
    const payload = typeof row.proposed === 'string' ? JSON.parse(row.proposed) : { ...row.proposed }
    // carry the authoritative project scope from the pending_changes row — the proposer
    // payload omits project_id (NOT NULL, no default), which fails the INSERT otherwise.
    if (PROJECT_SCOPED.has(row.entity_type) && payload.project_id == null) payload.project_id = row.project_id
    const [r] = await conn.query('INSERT INTO ?? SET ?', [row.entity_type, payload])
    return r.insertId
  }
  await conn.query('DELETE FROM ?? WHERE id=?', [row.entity_type, row.entity_id])
  return row.entity_id
}

// authority: confirmer must satisfy required role (admin always) AND not be requester
function authorityError(row, user) {
  if (row.status !== 'pending') return 'Change is not pending'
  if (row.requested_by === user.id) return 'You cannot confirm a change you proposed'
  if (user.role === 'admin') return null
  if (user.role !== row.required_confirmer_role) return `Requires ${row.required_confirmer_role}`
  return null
}

// ─── POST /:id/confirm ────────────────────────────────────────────────────────
router.post('/:projectId/confirm/:id', async (req, res) => {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [[row]] = await conn.query('SELECT * FROM pending_changes WHERE id=? AND project_id=? FOR UPDATE', [Number(req.params.id), Number(req.params.projectId)])
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Pending change not found' }) }
    const err = authorityError(row, req.user)
    if (err) { await conn.rollback(); return res.status(403).json({ error: err }) }
    const appliedId = await applyChange(conn, row)
    await conn.query("UPDATE pending_changes SET status='confirmed', confirmed_by=?, confirmed_at=NOW(), confirm_comment=? WHERE id=?", [req.user.id, req.body.comment || null, row.id])
    // audit inside txn (correct columns + project_id)
    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, before_value, after_value, resource, ip)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [req.user.id, `${row.module}_${row.action}_confirmed`, row.entity_type, appliedId, row.project_id,
       row.before_value == null ? null : JSON.stringify(row.before_value),
       row.proposed == null ? null : JSON.stringify(row.proposed),
       (req.originalUrl||'').split('?')[0].replace(/^\/api(?=\/)/,''), req.ip])
    await conn.commit()
    res.json({ ok: true, applied_entity_id: appliedId })
  } catch (e) { await conn.rollback(); res.status(500).json({ error: e.message }) }
  finally { conn.release() }
})

// ─── POST /:id/reject ─────────────────────────────────────────────────────────
router.post('/:projectId/reject/:id', async (req, res) => {
  try {
    const [[row]] = await db.query('SELECT * FROM pending_changes WHERE id=? AND project_id=?', [Number(req.params.id), Number(req.params.projectId)])
    if (!row) return res.status(404).json({ error: 'Pending change not found' })
    const err = authorityError(row, req.user)
    if (err) return res.status(403).json({ error: err })
    await db.query("UPDATE pending_changes SET status='rejected', confirmed_by=?, confirmed_at=NOW(), confirm_comment=? WHERE id=?", [req.user.id, req.body.comment || null, row.id])
    audit(req, `${row.module}_${row.action}_rejected`, row.entity_type, row.entity_id, row.project_id, row.before_value, null)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── POST /batch/:batchId/confirm — confirm all pending in a batch ────────────
router.post('/:projectId/batch/:batchId/confirm', async (req, res) => {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query("SELECT * FROM pending_changes WHERE project_id=? AND batch_id=? AND status='pending' FOR UPDATE", [Number(req.params.projectId), req.params.batchId])
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'No pending changes in batch' }) }
    for (const row of rows) {
      const err = authorityError(row, req.user)
      if (err) { await conn.rollback(); return res.status(403).json({ error: `Row ${row.id}: ${err}` }) }
    }
    let applied = 0
    for (const row of rows) {
      const appliedId = await applyChange(conn, row)
      await conn.query("UPDATE pending_changes SET status='confirmed', confirmed_by=?, confirmed_at=NOW() WHERE id=?", [req.user.id, row.id])
      await conn.query(`INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, after_value, resource, ip) VALUES (?,?,?,?,?,?,?,?)`,
        [req.user.id, `${row.module}_${row.action}_confirmed`, row.entity_type, appliedId, row.project_id, row.proposed == null ? null : JSON.stringify(row.proposed), (req.originalUrl||'').split('?')[0].replace(/^\/api(?=\/)/,''), req.ip])
      applied++
    }
    await conn.commit()
    res.json({ ok: true, confirmed: applied })
  } catch (e) { await conn.rollback(); res.status(500).json({ error: e.message }) }
  finally { conn.release() }
})

module.exports = router
