// ─── PRE-AWARD PROCUREMENT ROUTES (Phase 2.1) ─────────────────────────────────
// Tenders and their downstream artefacts (prequalification, bids, evaluation,
// approvals, BAFO). Mounted at /api/pre-award. Pooled connections only (../db).
// All routes require a valid JWT.
//
// AUTHORIZATION: the pre_award matrix gate is requireLivePermission('pre_award',
// <flag>) applied PER ROUTE (one clear gate, live per-request role_permissions read
// — NOT the shared enforce()). denyReadOnly (write-floor) and requireProjectScope
// (external project-scope) are complementary layers, not the matrix gate.
//
// SEALING NOTE (Phase 2.5, not here): the commercial envelope lives only in
// tender_bid_commercial / tender_bafo_commercial and is never SELECTed by these
// routes; unseal is gated separately by UNSEAL_AUTHORIZED_ROLES in the unseal route.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { dbError } = require('../utils/dbError')
const { authenticateToken } = require('../middleware/auth')
const { denyReadOnly, requireProjectScope } = require('../middleware/permissions')
const { requireLivePermission } = require('../middleware/requireLivePermission')

router.use(authenticateToken)
router.use(denyReadOnly)                          // floor: viewer/auditor barred from writes
router.param('projectId', requireProjectScope)    // external roles scoped to granted projects

// ─── AUDIT HELPER (mto.js explicit-args shape: req, action, entityType, entityId, before, after) ──
function audit(req, action, entityType, entityId, before = null, after = null) {
  const resource  = (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/)/, '')
  const projectId = Number(req.params.projectId) || null
  db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, before_value, after_value, resource, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user?.id ?? null, action, entityType, entityId, projectId,
     before ? JSON.stringify(before) : null,
     after  ? JSON.stringify(after)  : null,
     resource, req.ip ?? null]
  ).catch(e => console.error('[audit] insert failed:', e.message))
}

// ─── DOMAIN CONSTANTS (mirror the tender_packages CHECK/enum value sets exactly) ──
const PROC_MODES  = ['private_negotiated', 'private_competitive', 'mdb_funded']            // chk_tenders_mode
const DISCIPLINES = ['mechanical', 'electrical', 'instrumentation', 'civil', 'piping', 'structural'] // discipline enum
const STAGES      = ['planning', 'prequalification', 'invitation', 'clarifications', 'tendering', 'evaluation', 'recommendation', 'award'] // stage enum
const STATUSES    = ['active', 'standstill', 'awarded', 'on_hold', 'cancelled']            // chk_tenders_status
// Whitelist of sortable columns → prevents ORDER BY injection (only these are allowed).
const SAFE_SORT   = {
  ref: 'ref', title: 'title', stage: 'stage', status: 'status',
  discipline: 'discipline', estimated_value: 'estimated_value',
  created_at: 'created_at', updated_at: 'updated_at',
}
// Prequalification round_status (chk_prequal_round). 'pending' is create-only; a
// DECISION may only be one of the three terminal outcomes (see the decide route).
const ROUND_STATUSES  = ['pending', 'qualified', 'conditional', 'not_qualified']
const ROUND_DECISIONS = ['qualified', 'conditional', 'not_qualified']
// Prequal list sort whitelist (fully-qualified — the list JOINs suppliers).
const PREQUAL_SORT = {
  category: 'p.category', discipline: 'p.discipline', round_status: 'p.round_status',
  valid_to: 'p.valid_to', created_at: 'p.created_at', updated_at: 'p.updated_at',
  supplier_name: 's.name',
}

// Returns null if value is an allowed member, else a clean error string.
const badEnum = (label, val, allowed) =>
  allowed.includes(val) ? null : `Invalid ${label} — must be one of: ${allowed.join(', ')}`

// ─── LIST: tender register ────────────────────────────────────────────────────
// GET /api/pre-award/:projectId/tenders — paginated, filterable (status, mode, stage,
// q on ref/title), sortable via SAFE_SORT. Sealed commercial values are NOT joined.
router.get('/:projectId/tenders', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid    = Number(req.params.projectId)
    const page   = Math.max(1, parseInt(req.query.page  || '1', 10))
    const limit  = Math.min(1000, Math.max(1, parseInt(req.query.limit || '50', 10)))
    const offset = (page - 1) * limit

    const where = ['t.project_id = ?']; const params = [pid]
    if (req.query.status)           { where.push('t.status = ?');           params.push(req.query.status) }
    if (req.query.procurement_mode) { where.push('t.procurement_mode = ?'); params.push(req.query.procurement_mode) }
    if (req.query.stage)            { where.push('t.stage = ?');            params.push(req.query.stage) }
    if (req.query.q) {
      where.push('(t.ref LIKE ? OR t.title LIKE ?)')
      const like = `%${req.query.q}%`; params.push(like, like)
    }
    const whereSql = where.join(' AND ')

    const orderBy  = SAFE_SORT[req.query.sort_col] || 'created_at'
    const orderDir = String(req.query.sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM tender_packages t WHERE ${whereSql}`, params)
    const [rows] = await db.query(
      `SELECT t.id, t.project_id, t.ref, t.title, t.discipline, t.procurement_mode, t.stage,
              t.status, t.currency, t.estimated_value, t.wbs_code, t.owner_id,
              u.full_name AS owner_name, t.created_at, t.updated_at
         FROM tender_packages t
         LEFT JOIN users u ON u.id = t.owner_id
        WHERE ${whereSql}
        ORDER BY t.${orderBy} ${orderDir}, t.id ${orderDir}
        LIMIT ? OFFSET ?`, [...params, limit, offset])

    res.json({ rows, total, page, limit })
  } catch (e) {
    console.error('[preaward:list]', e.message); dbError(res, e)
  }
})

// ─── DETAIL: one tender ───────────────────────────────────────────────────────
// GET /api/pre-award/:projectId/tenders/:id — scoped to the project (no cross-project read).
router.get('/:projectId/tenders/:id', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const id = Number(req.params.id)
    const [[tender]] = await db.query(
      `SELECT t.id, t.project_id, t.ref, t.title, t.discipline, t.procurement_mode, t.stage,
              t.status, t.currency, t.estimated_value, t.wbs_code, t.owner_id,
              u.full_name AS owner_name, t.created_by, t.created_at, t.updated_at
         FROM tender_packages t
         LEFT JOIN users u ON u.id = t.owner_id
        WHERE t.id = ? AND t.project_id = ?`, [id, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    res.json(tender)
  } catch (e) {
    console.error('[preaward:detail]', e.message); dbError(res, e)
  }
})

// ─── CREATE: new tender ───────────────────────────────────────────────────────
// POST /api/pre-award/:projectId/tenders — required: ref, title, procurement_mode.
// Enums validated in-app for clean 400s (never let a bad value hit the DB CHECK);
// duplicate ref within the project → 409 via dbError (UNIQUE(project_id, ref)).
router.post('/:projectId/tenders', requireLivePermission('pre_award', 'can_create'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const {
      ref, title, procurement_mode,
      discipline = null, currency = 'AUD', estimated_value = null,
      wbs_code = null, owner_id = null, stage = 'planning', status = 'active',
    } = req.body || {}

    // ── required-field + enum validation → clean 400 (before the DB) ──
    if (!ref || !String(ref).trim())   return res.status(400).json({ error: 'ref is required' })
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' })
    let bad = badEnum('procurement_mode', procurement_mode, PROC_MODES); if (bad) return res.status(400).json({ error: bad })
    if (discipline != null) { bad = badEnum('discipline', discipline, DISCIPLINES); if (bad) return res.status(400).json({ error: bad }) }
    bad = badEnum('stage',  stage,  STAGES);   if (bad) return res.status(400).json({ error: bad })
    bad = badEnum('status', status, STATUSES); if (bad) return res.status(400).json({ error: bad })
    if (estimated_value != null && (isNaN(Number(estimated_value)) || Number(estimated_value) < 0))
      return res.status(400).json({ error: 'estimated_value must be a non-negative number' })

    const [result] = await db.query(
      `INSERT INTO tender_packages
         (project_id, ref, title, discipline, procurement_mode, stage, status,
          currency, estimated_value, wbs_code, owner_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pid, String(ref).trim(), String(title).trim(), discipline, procurement_mode, stage, status,
       currency || 'AUD', estimated_value, wbs_code, owner_id, req.user.id])

    const id = result.insertId
    audit(req, 'tender_created', 'tender', id, null, { ref: String(ref).trim(), procurement_mode, project_id: pid })
    const [[tender]] = await db.query('SELECT * FROM tender_packages WHERE id = ?', [id])
    res.status(201).json(tender)
  } catch (e) {
    console.error('[preaward:create]', e.message); dbError(res, e)
  }
})

// ─── UPDATE: edit a tender (partial) ──────────────────────────────────────────
// PATCH /api/pre-award/:projectId/tenders/:id — only provided fields written; any
// provided enum re-validated. Audited with before/after.
router.patch('/:projectId/tenders/:id', requireLivePermission('pre_award', 'can_edit'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const id = Number(req.params.id)
    const [[before]] = await db.query('SELECT * FROM tender_packages WHERE id = ? AND project_id = ?', [id, pid])
    if (!before) return res.status(404).json({ error: 'Tender not found' })

    const b = req.body || {}
    const sets = []; const params = []
    const put = (col, val) => { sets.push(`${col} = ?`); params.push(val) }

    if (b.title !== undefined) {
      if (!String(b.title).trim()) return res.status(400).json({ error: 'title cannot be empty' })
      put('title', String(b.title).trim())
    }
    if (b.procurement_mode !== undefined) {
      const bad = badEnum('procurement_mode', b.procurement_mode, PROC_MODES); if (bad) return res.status(400).json({ error: bad })
      put('procurement_mode', b.procurement_mode)
    }
    if (b.discipline !== undefined) {
      if (b.discipline !== null) { const bad = badEnum('discipline', b.discipline, DISCIPLINES); if (bad) return res.status(400).json({ error: bad }) }
      put('discipline', b.discipline)
    }
    if (b.stage !== undefined)  { const bad = badEnum('stage',  b.stage,  STAGES);   if (bad) return res.status(400).json({ error: bad }); put('stage',  b.stage) }
    if (b.status !== undefined) { const bad = badEnum('status', b.status, STATUSES); if (bad) return res.status(400).json({ error: bad }); put('status', b.status) }
    if (b.estimated_value !== undefined) {
      if (b.estimated_value !== null && (isNaN(Number(b.estimated_value)) || Number(b.estimated_value) < 0))
        return res.status(400).json({ error: 'estimated_value must be a non-negative number' })
      put('estimated_value', b.estimated_value)
    }
    if (b.currency  !== undefined) put('currency',  b.currency || 'AUD')
    if (b.wbs_code  !== undefined) put('wbs_code',  b.wbs_code)
    if (b.owner_id  !== undefined) put('owner_id',  b.owner_id)

    if (!sets.length) return res.status(400).json({ error: 'No updatable fields provided' })

    await db.query(`UPDATE tender_packages SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`, [...params, id, pid])
    const [[after]] = await db.query('SELECT * FROM tender_packages WHERE id = ?', [id])
    audit(req, 'tender_updated', 'tender', id, before, after)
    res.json(after)
  } catch (e) {
    console.error('[preaward:update]', e.message); dbError(res, e)
  }
})

// ═══ PREQUALIFICATION (Phase 2.2) ══════════════════════════════════════════════
// Supplier×category qualification registry — project-scoped, NOT tender-specific
// (UNIQUE(project_id, supplier_id, category)). AVL standing (suppliers.avl_status)
// is read live via JOIN, never duplicated onto the prequal row. round_status is the
// per-round OUTCOME, separate from avl_status.

// ─── LIST: prequalifications for a project ────────────────────────────────────
// GET /:projectId/prequalifications — filter category/discipline/round_status/supplier_id.
router.get('/:projectId/prequalifications', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid    = Number(req.params.projectId)
    const page   = Math.max(1, parseInt(req.query.page  || '1', 10))
    const limit  = Math.min(1000, Math.max(1, parseInt(req.query.limit || '50', 10)))
    const offset = (page - 1) * limit

    const where = ['p.project_id = ?']; const params = [pid]
    if (req.query.category)     { where.push('p.category = ?');     params.push(req.query.category) }
    if (req.query.discipline)   { where.push('p.discipline = ?');   params.push(req.query.discipline) }
    if (req.query.round_status) { where.push('p.round_status = ?'); params.push(req.query.round_status) }
    if (req.query.supplier_id)  { where.push('p.supplier_id = ?');  params.push(Number(req.query.supplier_id)) }
    const whereSql = where.join(' AND ')

    const orderBy  = PREQUAL_SORT[req.query.sort_col] || 'p.created_at'
    const orderDir = String(req.query.sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC'

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM tender_prequalifications p WHERE ${whereSql}`, params)
    const [rows] = await db.query(
      `SELECT p.id, p.project_id, p.supplier_id, s.name AS supplier_name, s.code AS supplier_code,
              s.avl_status, p.category, p.discipline, p.round_status, p.valid_from, p.valid_to,
              p.notes, p.created_by, p.created_at, p.updated_at
         FROM tender_prequalifications p
         JOIN suppliers s ON s.id = p.supplier_id
        WHERE ${whereSql}
        ORDER BY ${orderBy} ${orderDir}, p.id ${orderDir}
        LIMIT ? OFFSET ?`, [...params, limit, offset])

    res.json({ rows, total, page, limit })
  } catch (e) {
    console.error('[preaward:prequal:list]', e.message); dbError(res, e)
  }
})

// ─── SUBMIT: register a supplier for a category ───────────────────────────────
// POST /:projectId/prequalifications — required: supplier_id, category.
// round_status is NOT client-settable: forced to 'pending'. A decision can only be
// made through the can_approve /:id (decide) route — closing the create-time bypass
// where a can_create-only role could otherwise insert an already-'qualified' row.
router.post('/:projectId/prequalifications', requireLivePermission('pre_award', 'can_create'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { supplier_id, category, discipline = null, valid_from = null, valid_to = null, notes = null } = req.body || {}

    if (!supplier_id)                        return res.status(400).json({ error: 'supplier_id is required' })
    if (!category || !String(category).trim()) return res.status(400).json({ error: 'category is required' })
    if (discipline != null) { const bad = badEnum('discipline', discipline, DISCIPLINES); if (bad) return res.status(400).json({ error: bad }) }

    const [result] = await db.query(
      `INSERT INTO tender_prequalifications
         (project_id, supplier_id, category, discipline, round_status, valid_from, valid_to, notes, created_by)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [pid, Number(supplier_id), String(category).trim(), discipline, valid_from, valid_to, notes, req.user.id])

    const id = result.insertId
    audit(req, 'prequalification_submitted', 'tender_prequalification', id, null,
      { supplier_id: Number(supplier_id), category: String(category).trim(), round_status: 'pending' })
    const [[row]] = await db.query('SELECT * FROM tender_prequalifications WHERE id = ?', [id])
    res.status(201).json(row)
  } catch (e) {
    console.error('[preaward:prequal:submit]', e.message); dbError(res, e)
  }
})

// ─── DECIDE: transition round_status (authority action) ───────────────────────
// PATCH /:projectId/prequalifications/:id — can_approve (NOT can_edit): deciding a
// vendor's qualification gates who may bid. Terminal-value-only: accepts one of the
// three decision outcomes; 'pending' (and any other value) is rejected route-side.
router.patch('/:projectId/prequalifications/:id', requireLivePermission('pre_award', 'can_approve'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const id = Number(req.params.id)
    const { round_status, valid_from, valid_to, notes } = req.body || {}

    // terminal-value-only decision — 'pending' is create-only and is rejected here
    if (!ROUND_DECISIONS.includes(round_status)) {
      return res.status(400).json({ error: `Invalid decision — round_status must be one of: ${ROUND_DECISIONS.join(', ')}` })
    }

    const [[before]] = await db.query('SELECT * FROM tender_prequalifications WHERE id = ? AND project_id = ?', [id, pid])
    if (!before) return res.status(404).json({ error: 'Prequalification not found' })

    const sets = ['round_status = ?']; const params = [round_status]
    if (valid_from !== undefined) { sets.push('valid_from = ?'); params.push(valid_from) }
    if (valid_to   !== undefined) { sets.push('valid_to = ?');   params.push(valid_to) }
    if (notes      !== undefined) { sets.push('notes = ?');      params.push(notes) }

    await db.query(`UPDATE tender_prequalifications SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`, [...params, id, pid])
    const [[after]] = await db.query('SELECT * FROM tender_prequalifications WHERE id = ?', [id])
    audit(req, 'prequalification_decided', 'tender_prequalification', id, before, after)
    res.json(after)
  } catch (e) {
    console.error('[preaward:prequal:decide]', e.message); dbError(res, e)
  }
})

module.exports = router
