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
const { getAvailableQty } = require('../lib/mtoAvailability')

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
// provided enum re-validated. Audited with before/after. status 'cancelled' is refused
// here (400): cancelling goes ONLY through POST .../cancel, which releases the tender's
// reservations in the same transaction.
router.patch('/:projectId/tenders/:id', requireLivePermission('pre_award', 'can_edit'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const id = Number(req.params.id)
    const [[before]] = await db.query('SELECT * FROM tender_packages WHERE id = ? AND project_id = ?', [id, pid])
    if (!before) return res.status(404).json({ error: 'Tender not found' })

    const b = req.body || {}

    // ── STRUCTURAL-FIELD GUARD ───────────────────────────────────────────────
    // procurement_mode and discipline are frozen once the tender is COMMITTED —
    // either its criteria are locked (the evaluation scheme was finalized under the
    // current mode) or it has been awarded (stage='award'). Only an actual CHANGE is
    // blocked; other fields (title, estimated_value, …) stay editable. Distinct 409
    // message per reason (criteria-lock vs award).
    const changingMode = b.procurement_mode !== undefined && b.procurement_mode !== before.procurement_mode
    const changingDisc = b.discipline       !== undefined && b.discipline       !== before.discipline
    if (changingMode || changingDisc) {
      const field = changingMode ? 'procurement_mode' : 'discipline'
      if (before.criteria_locked_at != null)
        return res.status(409).json({ error: `Cannot change ${field}: criteria are locked for this tender` })
      if (before.stage === 'award')
        return res.status(409).json({ error: `Cannot change ${field}: the tender has been awarded` })
    }

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
    if (b.status !== undefined) {
      const bad = badEnum('status', b.status, STATUSES); if (bad) return res.status(400).json({ error: bad })
      if (b.status === 'cancelled')
        return res.status(400).json({ error: `status 'cancelled' can't be set here — use POST /api/pre-award/${pid}/tenders/${id}/cancel, which releases the tender's reservations in the same transaction` })
      put('status', b.status)
    }
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

// ═══ CRITERIA (Phase 2.3) ══════════════════════════════════════════════════════
// Weighted evaluation criteria per tender. Per-row writes (as sliders move) enforce
// only the 5-60 guardrail; the SUM(weight)=100 invariant is validated EXACTLY (no
// tolerance) at the dedicated lock action, never per-row. "Locked" is first-class
// state: criteria_locked_at IS NOT NULL. All criteria writes are rejected (409) once
// locked. DELETE of a criterion row is can_edit (composing the scheme), NOT can_delete.

// ─── LIST criteria + lock state ───────────────────────────────────────────────
router.get('/:projectId/tenders/:id/criteria', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const [[tender]] = await db.query(
      'SELECT id, criteria_locked_at, criteria_locked_by FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    const [rows] = await db.query(
      `SELECT id, tender_id, criterion_key, label, weight, mandatory, min_score, display_order, score_source, created_at, updated_at
         FROM tender_criteria WHERE tender_id = ? ORDER BY display_order, id`, [tid])
    const weight_sum = rows.reduce((s, c) => s + Number(c.weight), 0)
    res.json({ criteria: rows, weight_sum,
      locked: tender.criteria_locked_at != null,
      criteria_locked_at: tender.criteria_locked_at, criteria_locked_by: tender.criteria_locked_by })
  } catch (e) {
    console.error('[preaward:criteria:list]', e.message); dbError(res, e)
  }
})

// ─── UPSERT one criterion (per-row, as sliders move) ──────────────────────────
// PUT /:projectId/tenders/:id/criteria/:key — can_edit. 409 if criteria locked.
// weight 5-60 (route-validated before the DB CHECK); min_score 0-100.
router.put('/:projectId/tenders/:id/criteria/:key', requireLivePermission('pre_award', 'can_edit'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id); const key = String(req.params.key)
    const [[tender]] = await db.query('SELECT id, criteria_locked_at FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    if (tender.criteria_locked_at != null) return res.status(409).json({ error: 'Criteria are locked for this tender and cannot be modified' })

    const { label, weight, mandatory = 0, min_score = null, display_order = 0 } = req.body || {}
    if (!label || !String(label).trim()) return res.status(400).json({ error: 'label is required' })
    const w = Number(weight)
    if (!Number.isInteger(w) || w < 5 || w > 60) return res.status(400).json({ error: 'weight must be an integer between 5 and 60' })
    if (min_score != null && (isNaN(Number(min_score)) || Number(min_score) < 0 || Number(min_score) > 100))
      return res.status(400).json({ error: 'min_score must be between 0 and 100' })

    await db.query(
      `INSERT INTO tender_criteria (tender_id, criterion_key, label, weight, mandatory, min_score, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label=VALUES(label), weight=VALUES(weight), mandatory=VALUES(mandatory),
                               min_score=VALUES(min_score), display_order=VALUES(display_order)`,
      [tid, key, String(label).trim(), w, mandatory ? 1 : 0, min_score, Number(display_order) || 0])
    audit(req, 'criterion_upserted', 'tender_criterion', tid, null, { criterion_key: key, weight: w })
    const [[row]] = await db.query('SELECT * FROM tender_criteria WHERE tender_id = ? AND criterion_key = ?', [tid, key])
    res.json(row)
  } catch (e) {
    console.error('[preaward:criteria:upsert]', e.message); dbError(res, e)
  }
})

// ─── DELETE one criterion ─────────────────────────────────────────────────────
// can_edit (composing the scheme — NOT can_delete). 409 if criteria locked.
router.delete('/:projectId/tenders/:id/criteria/:key', requireLivePermission('pre_award', 'can_edit'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id); const key = String(req.params.key)
    const [[tender]] = await db.query('SELECT id, criteria_locked_at FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    if (tender.criteria_locked_at != null) return res.status(409).json({ error: 'Criteria are locked for this tender and cannot be modified' })
    const [[before]] = await db.query('SELECT * FROM tender_criteria WHERE tender_id = ? AND criterion_key = ?', [tid, key])
    if (!before) return res.status(404).json({ error: 'Criterion not found' })
    await db.query('DELETE FROM tender_criteria WHERE tender_id = ? AND criterion_key = ?', [tid, key])
    audit(req, 'criterion_deleted', 'tender_criterion', tid, before, null)
    res.json({ ok: true, deleted: key })
  } catch (e) {
    console.error('[preaward:criteria:delete]', e.message); dbError(res, e)
  }
})

// ─── LOCK criteria (finalize) — can_approve, exact SUM(weight)=100 gate ────────
// POST /:projectId/tenders/:id/lock-criteria. Validates SUM===100 exactly (no
// tolerance — proven necessary/achievable), sets criteria_locked_at/by. 409 if
// already locked; 400 if 0 criteria or sum!=100 (message states the actual sum).
router.post('/:projectId/tenders/:id/lock-criteria', requireLivePermission('pre_award', 'can_approve'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const [[tender]] = await db.query('SELECT id, criteria_locked_at FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    if (tender.criteria_locked_at != null) return res.status(409).json({ error: 'Criteria are already locked for this tender' })

    const [rows] = await db.query('SELECT weight FROM tender_criteria WHERE tender_id = ?', [tid])
    if (rows.length === 0) return res.status(400).json({ error: 'No criteria to lock — add criteria first' })
    const sum = rows.reduce((s, c) => s + Number(c.weight), 0)
    if (sum !== 100) return res.status(400).json({ error: `Criteria weights sum to ${sum}, must equal exactly 100` })

    await db.query('UPDATE tender_packages SET criteria_locked_at = NOW(), criteria_locked_by = ? WHERE id = ?', [req.user.id, tid])
    audit(req, 'criteria_locked', 'tender', tid, null, { criteria_count: rows.length, weight_sum: sum })
    const [[after]] = await db.query('SELECT id, criteria_locked_at, criteria_locked_by FROM tender_packages WHERE id = ?', [tid])
    res.json({ ok: true, ...after })
  } catch (e) {
    console.error('[preaward:criteria:lock]', e.message); dbError(res, e)
  }
})

// ═══ INVITATION: DOCUMENTS + CLARIFICATIONS + BIDS (Phase 2.4) ═════════════════
// Guardrail-safe mechanics ONLY — no scoring / pass-threshold / ranking. The prelim
// check is a MECHANICAL checklist over objective binary submission facts on the bid
// row itself (never reads tender_criteria). Unseal reveals data; it does not evaluate.

const DOC_STATUSES  = ['pending', 'uploaded', 'waived']
const CLAR_STATUSES = ['open', 'answered']
// Narrower than can_edit — the anti-bias keystone: only these roles may reveal a sealed
// commercial envelope (procurement_officer has can_edit but is deliberately NOT here).
const UNSEAL_AUTHORIZED_ROLES = ['procurement_manager', 'admin']

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────
router.get('/:projectId/tenders/:id/documents', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    const [rows] = await db.query(
      `SELECT id, tender_id, doc_key, label, required, status, file_path, uploaded_by, uploaded_at, created_at, updated_at
         FROM tender_documents WHERE tender_id = ? ORDER BY doc_key`, [tid])
    res.json({ documents: rows })
  } catch (e) { console.error('[preaward:doc:list]', e.message); dbError(res, e) }
})

router.put('/:projectId/tenders/:id/documents/:doc_key', requireLivePermission('pre_award', 'can_edit'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id); const key = String(req.params.doc_key)
    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    const { label, required = 0, status = 'pending', file_path = null } = req.body || {}
    if (!label || !String(label).trim()) return res.status(400).json({ error: 'label is required' })
    if (!DOC_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${DOC_STATUSES.join(', ')}` })
    const uploaded = status === 'uploaded'
    await db.query(
      `INSERT INTO tender_documents (tender_id, doc_key, label, required, status, file_path, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label=VALUES(label), required=VALUES(required), status=VALUES(status),
                               file_path=VALUES(file_path), uploaded_by=VALUES(uploaded_by), uploaded_at=VALUES(uploaded_at)`,
      [tid, key, String(label).trim(), required ? 1 : 0, status, file_path, uploaded ? req.user.id : null, uploaded ? new Date() : null])
    audit(req, 'tender_document_upserted', 'tender_document', tid, null, { doc_key: key, status })
    const [[row]] = await db.query('SELECT * FROM tender_documents WHERE tender_id = ? AND doc_key = ?', [tid, key])
    res.json(row)
  } catch (e) { console.error('[preaward:doc:upsert]', e.message); dbError(res, e) }
})

// ─── CLARIFICATIONS ───────────────────────────────────────────────────────────
router.get('/:projectId/tenders/:id/clarifications', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    const [rows] = await db.query(
      `SELECT c.id, c.tender_id, c.ref, c.supplier_id, s.name AS supplier_name, c.question, c.response,
              c.addendum, c.status, c.created_by, c.responded_by, c.responded_at, c.created_at, c.updated_at
         FROM tender_clarifications c LEFT JOIN suppliers s ON s.id = c.supplier_id
        WHERE c.tender_id = ? ORDER BY c.ref`, [tid])
    res.json({ clarifications: rows })
  } catch (e) { console.error('[preaward:clar:list]', e.message); dbError(res, e) }
})

router.post('/:projectId/tenders/:id/clarifications', requireLivePermission('pre_award', 'can_create'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    const { ref, supplier_id = null, question } = req.body || {}
    if (!ref || !String(ref).trim())         return res.status(400).json({ error: 'ref is required' })
    if (!question || !String(question).trim()) return res.status(400).json({ error: 'question is required' })
    const [r] = await db.query(
      `INSERT INTO tender_clarifications (tender_id, ref, supplier_id, question, status, created_by)
       VALUES (?, ?, ?, ?, 'open', ?)`,
      [tid, String(ref).trim(), supplier_id, String(question).trim(), req.user.id])
    audit(req, 'clarification_raised', 'tender_clarification', r.insertId, null, { ref: String(ref).trim() })
    const [[row]] = await db.query('SELECT * FROM tender_clarifications WHERE id = ?', [r.insertId])
    res.status(201).json(row)
  } catch (e) { console.error('[preaward:clar:raise]', e.message); dbError(res, e) }
})

router.patch('/:projectId/tenders/:id/clarifications/:clarId', requireLivePermission('pre_award', 'can_edit'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id); const cid = Number(req.params.clarId)
    const [[clar]] = await db.query(
      `SELECT c.id, c.status FROM tender_clarifications c JOIN tender_packages t ON t.id = c.tender_id
        WHERE c.id = ? AND c.tender_id = ? AND t.project_id = ?`, [cid, tid, pid])
    if (!clar) return res.status(404).json({ error: 'Clarification not found' })
    const { response, addendum = null } = req.body || {}
    if (!response || !String(response).trim()) return res.status(400).json({ error: 'response is required' })
    await db.query(
      `UPDATE tender_clarifications SET response = ?, addendum = ?, status = 'answered', responded_by = ?, responded_at = NOW()
        WHERE id = ?`, [String(response).trim(), addendum, req.user.id, cid])
    audit(req, 'clarification_answered', 'tender_clarification', cid, { status: clar.status }, { status: 'answered' })
    const [[row]] = await db.query('SELECT * FROM tender_clarifications WHERE id = ?', [cid])
    res.json(row)
  } catch (e) { console.error('[preaward:clar:respond]', e.message); dbError(res, e) }
})

// ─── BIDS ─────────────────────────────────────────────────────────────────────
// Sealed-envelope read rule: commercial_value is returned ONLY when unsealed_at IS
// NOT NULL — can_view can never see a sealed price.
router.get('/:projectId/tenders/:id/bids', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    const [rows] = await db.query(
      `SELECT b.id, b.tender_id, b.supplier_id, s.name AS supplier_name, b.round, b.submitted_at, b.currency,
              b.tech_doc_count, b.comm_doc_count, b.bid_bond_provided, b.prelim_status, b.prelim_reason, b.status,
              CASE WHEN c.unsealed_at IS NOT NULL THEN 'unsealed' ELSE 'sealed' END AS envelope,
              CASE WHEN c.unsealed_at IS NOT NULL THEN c.commercial_value ELSE NULL END AS commercial_value,
              c.unsealed_at, c.unsealed_by
         FROM tender_bids b
         JOIN suppliers s ON s.id = b.supplier_id
         LEFT JOIN tender_bid_commercial c ON c.bid_id = b.id
        WHERE b.tender_id = ? ORDER BY b.round, b.id`, [tid])
    // Proposed per-line quantities are TECHNICAL scope (joined to tender_bids, never to the
    // sealed tender_bid_commercial) → surfaced here ungated, visible before commercial unseal.
    const byBid = {}
    if (rows.length) {
      const ids = rows.map(b => b.id)
      const [pl] = await db.query(
        `SELECT bl.bid_id, bl.tender_line_item_id, bl.qty_proposed, t.mto_line_id, t.qty_reserved, t.status AS reservation_status
           FROM tender_bid_lines bl JOIN tender_line_items t ON t.id = bl.tender_line_item_id
          WHERE bl.bid_id IN (${ids.map(() => '?').join(',')}) ORDER BY bl.tender_line_item_id`, ids)
      for (const l of pl) (byBid[l.bid_id] ||= []).push(l)
    }
    res.json({ bids: rows.map(b => ({ ...b, proposed_lines: byBid[b.id] || [] })) })
  } catch (e) { console.error('[preaward:bids:list]', e.message); dbError(res, e) }
})

router.get('/:projectId/tenders/:id/bids/:bidId', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id); const bidId = Number(req.params.bidId)
    const [[bid]] = await db.query(
      `SELECT b.id, b.tender_id, b.supplier_id, s.name AS supplier_name, b.round, b.submitted_at, b.currency,
              b.tech_doc_count, b.comm_doc_count, b.bid_bond_provided, b.prelim_status, b.prelim_reason, b.status,
              CASE WHEN c.unsealed_at IS NOT NULL THEN 'unsealed' ELSE 'sealed' END AS envelope,
              CASE WHEN c.unsealed_at IS NOT NULL THEN c.commercial_value ELSE NULL END AS commercial_value,
              c.unsealed_at, c.unsealed_by
         FROM tender_bids b
         JOIN suppliers s ON s.id = b.supplier_id
         LEFT JOIN tender_bid_commercial c ON c.bid_id = b.id
        WHERE b.id = ? AND b.tender_id = ? AND EXISTS (SELECT 1 FROM tender_packages t WHERE t.id = b.tender_id AND t.project_id = ?)`,
      [bidId, tid, pid])
    if (!bid) return res.status(404).json({ error: 'Bid not found' })
    res.json(bid)
  } catch (e) { console.error('[preaward:bids:detail]', e.message); dbError(res, e) }
})

// SUBMIT — creates the technical bid row + the SEALED commercial row + the per-line proposed
// quantities (tender_bid_lines), all in one transaction. The bid must state a qty_proposed for
// EVERY active reserved line (completeness) and none may exceed that line's qty_reserved
// (ceiling). Proposed quantities are technical scope (visible pre-unseal), not commercial.
router.post('/:projectId/tenders/:id/bids', requireLivePermission('pre_award', 'can_create'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const { supplier_id, round = 1, submitted_at = null, currency = 'AUD',
            tech_doc_count = 0, comm_doc_count = 0, bid_bond_provided = 0, commercial_value, lines } = req.body || {}
    if (!supplier_id) return res.status(400).json({ error: 'supplier_id is required' })
    if (commercial_value == null || isNaN(Number(commercial_value)) || Number(commercial_value) < 0)
      return res.status(400).json({ error: 'commercial_value is required and must be a non-negative number' })
    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })

    // Per-line proposed quantities — validate the WHOLE payload BEFORE any write (so a bad bid
    // inserts nothing). Completeness: exactly the tender's active reserved lines, no gaps/extras.
    // Ceiling: 0 <= qty_proposed <= that line's qty_reserved.
    const [activeLines] = await db.query(
      "SELECT id, mto_line_id, qty_reserved FROM tender_line_items WHERE tender_id = ? AND status = 'active'", [tid])
    const reservedById = new Map(activeLines.map(l => [l.id, Number(l.qty_reserved)]))
    const provided = Array.isArray(lines) ? lines : []
    if (activeLines.length > 0) {
      const seen = new Set()
      for (const l of provided) {
        const tliId = Number(l?.tender_line_item_id); const q = Number(l?.qty_proposed)
        if (!Number.isInteger(tliId) || !reservedById.has(tliId))
          return res.status(400).json({ error: `tender_line_item_id ${l?.tender_line_item_id} is not an active reserved line of this tender` })
        if (seen.has(tliId)) return res.status(400).json({ error: `duplicate tender_line_item_id ${tliId} in lines` })
        seen.add(tliId)
        if (isNaN(q) || !(q >= 0)) return res.status(400).json({ error: `qty_proposed for tender_line_item_id ${tliId} must be a number >= 0` })
        if (q > reservedById.get(tliId)) return res.status(422).json({ error: `qty_proposed ${q} exceeds reserved ${reservedById.get(tliId)} on tender_line_item_id ${tliId}` })
      }
      const missing = activeLines.filter(l => !seen.has(l.id)).map(l => l.mto_line_id)
      if (missing.length) return res.status(400).json({ error: `bid must propose a quantity for every reserved line; missing mto_line_id(s): ${missing.join(', ')}` })
    } else if (provided.length > 0) {
      return res.status(400).json({ error: 'this tender has no reserved lines; do not send a lines array' })
    }

    const conn = await db.getConnection()
    let bidId
    try {
      await conn.beginTransaction()
      const [r] = await conn.query(
        `INSERT INTO tender_bids
           (tender_id, supplier_id, round, submitted_at, currency, tech_doc_count, comm_doc_count, bid_bond_provided, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
        [tid, Number(supplier_id), Number(round) || 1, submitted_at, currency || 'AUD',
         Number(tech_doc_count) || 0, Number(comm_doc_count) || 0, bid_bond_provided ? 1 : 0, req.user.id])
      bidId = r.insertId
      await conn.query('INSERT INTO tender_bid_commercial (bid_id, commercial_value) VALUES (?, ?)', [bidId, Number(commercial_value)])
      for (const l of provided) {
        await conn.query('INSERT INTO tender_bid_lines (bid_id, tender_line_item_id, qty_proposed) VALUES (?, ?, ?)',
          [bidId, Number(l.tender_line_item_id), l.qty_proposed])
      }
      await conn.commit()
    } catch (te) { await conn.rollback(); throw te } finally { conn.release() }

    audit(req, 'bid_submitted', 'tender_bid', bidId, null, { supplier_id: Number(supplier_id), round: Number(round) || 1, sealed: true, proposed_lines: provided.length })
    const [[bid]] = await db.query('SELECT * FROM tender_bids WHERE id = ?', [bidId])
    res.status(201).json({ ...bid, envelope: 'sealed', proposed_lines: provided.length })
  } catch (e) { console.error('[preaward:bid:submit]', e.message); dbError(res, e) }
})

// PRELIM CHECK — MECHANICAL checklist over objective binary submission facts on the
// bid row (tech_doc_count / comm_doc_count / bid_bond_provided). Reads NOTHING from
// tender_criteria. Sets prelim_status + prelim_reason.
router.post('/:projectId/tenders/:id/bids/:bidId/prelim-check', requireLivePermission('pre_award', 'can_edit'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id); const bidId = Number(req.params.bidId)
    const [[bid]] = await db.query(
      `SELECT b.id, b.tech_doc_count, b.comm_doc_count, b.bid_bond_provided
         FROM tender_bids b JOIN tender_packages t ON t.id = b.tender_id
        WHERE b.id = ? AND b.tender_id = ? AND t.project_id = ?`, [bidId, tid, pid])
    if (!bid) return res.status(404).json({ error: 'Bid not found' })

    const reasons = []
    if (!(bid.tech_doc_count > 0)) reasons.push('No technical documents submitted')
    if (!(bid.comm_doc_count > 0)) reasons.push('No commercial documents submitted')
    if (!bid.bid_bond_provided)    reasons.push('Bid bond not provided')
    const pass = reasons.length === 0
    const prelim_status = pass ? 'pass' : 'fail'
    const prelim_reason = pass ? null : reasons.join('; ')

    await db.query('UPDATE tender_bids SET prelim_status = ?, prelim_reason = ? WHERE id = ?', [prelim_status, prelim_reason, bidId])
    audit(req, 'bid_prelim_checked', 'tender_bid', bidId, null, { prelim_status, prelim_reason })
    res.json({ id: bidId, prelim_status, prelim_reason,
      checks: { tech_docs: bid.tech_doc_count > 0, comm_docs: bid.comm_doc_count > 0, bid_bond: !!bid.bid_bond_provided } })
  } catch (e) { console.error('[preaward:bid:prelim]', e.message); dbError(res, e) }
})

// UNSEAL — mechanical: reveal the commercial envelope. Requires can_edit AND membership
// in UNSEAL_AUTHORIZED_ROLES. Sets unsealed_at/unsealed_by (matching the Phase 1.3
// pattern). NO scoring/evaluation triggered.
router.post('/:projectId/tenders/:id/bids/:bidId/unseal', requireLivePermission('pre_award', 'can_edit'), async (req, res) => {
  try {
    if (!UNSEAL_AUTHORIZED_ROLES.includes(req.user.role))
      return res.status(403).json({ error: 'Your role is not authorized to unseal commercial envelopes' })
    const pid = Number(req.params.projectId); const tid = Number(req.params.id); const bidId = Number(req.params.bidId)
    const [[bid]] = await db.query(
      `SELECT b.id FROM tender_bids b JOIN tender_packages t ON t.id = b.tender_id
        WHERE b.id = ? AND b.tender_id = ? AND t.project_id = ?`, [bidId, tid, pid])
    if (!bid) return res.status(404).json({ error: 'Bid not found' })
    const [[comm]] = await db.query('SELECT id, unsealed_at FROM tender_bid_commercial WHERE bid_id = ?', [bidId])
    if (!comm) return res.status(404).json({ error: 'Commercial envelope not found' })
    if (comm.unsealed_at != null) return res.status(409).json({ error: 'Commercial envelope already unsealed' })

    await db.query('UPDATE tender_bid_commercial SET unsealed_at = NOW(), unsealed_by = ? WHERE bid_id = ?', [req.user.id, bidId])
    audit(req, 'bid_commercial_unsealed', 'tender_bid', bidId, null, { unsealed_by: req.user.id })
    const [[after]] = await db.query('SELECT commercial_value, unsealed_at, unsealed_by FROM tender_bid_commercial WHERE bid_id = ?', [bidId])
    res.json({ id: bidId, envelope: 'unsealed',
      commercial_value: after.commercial_value, unsealed_at: after.unsealed_at, unsealed_by: after.unsealed_by })
  } catch (e) { console.error('[preaward:bid:unseal]', e.message); dbError(res, e) }
})

// ═══ EVALUATION SCORING (Phase 3.x) ════════════════════════════════════════════
// Bulk per-criterion technical scores for one bid. can_approve — same trust level as
// the approval chain and criteria-lock (scoring decides the winner). Deliberately NO
// seal gate: technical scoring is blind to the sealed commercial value (the anti-bias
// keystone), so it happens WHILE the envelope is still sealed. Gated instead on:
//   • criteria LOCKED (409 if not) — no scoring against a still-mutable scheme;
//   • bid scorable (409 if withdrawn/rejected, or prelim_status != 'pass') — a bid
//     already excluded by the mechanical prelim-check is never scorable;
//   • every criterion_id must belong to THIS tender (400 otherwise).
// Bulk upsert on uq_evalscore_bid_criterion — re-submitting updates, never duplicates.
router.put('/:projectId/tenders/:id/bids/:bidId/scores', requireLivePermission('pre_award', 'can_approve'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id); const bidId = Number(req.params.bidId)
    const { scores } = req.body || {}
    if (!Array.isArray(scores) || scores.length === 0)
      return res.status(400).json({ error: 'scores must be a non-empty array of { criterion_id, score }' })

    // tender in project + criteria-locked gate
    const [[tender]] = await db.query('SELECT id, criteria_locked_at FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    if (tender.criteria_locked_at == null)
      return res.status(409).json({ error: 'Criteria are not locked for this tender — lock the criteria before scoring' })

    // bid belongs to tender + scorable-state gate (NOT seal state — see header)
    const [[bid]] = await db.query('SELECT id, status, prelim_status FROM tender_bids WHERE id = ? AND tender_id = ?', [bidId, tid])
    if (!bid) return res.status(404).json({ error: 'Bid not found' })
    if (bid.status === 'withdrawn' || bid.status === 'rejected')
      return res.status(409).json({ error: `Cannot score a ${bid.status} bid` })
    if (bid.prelim_status !== 'pass')
      return res.status(409).json({ error: `Cannot score a bid that has not passed the preliminary check (prelim_status = '${bid.prelim_status}')` })

    // validate payload: each criterion belongs to this tender, no dupes, score 0-100,
    // and is NOT the commercial (price) criterion — that score is computed, never entered.
    const [critRows] = await db.query('SELECT id, score_source FROM tender_criteria WHERE tender_id = ?', [tid])
    const validCritIds = new Set(critRows.map(r => r.id))
    const priceCritIds = new Set(critRows.filter(r => r.score_source === 'price').map(r => r.id))
    const seen = new Set()
    for (const s of scores) {
      const cid = Number(s?.criterion_id); const sc = Number(s?.score)
      if (!Number.isInteger(cid) || !validCritIds.has(cid))
        return res.status(400).json({ error: `criterion_id ${s?.criterion_id} is not a criterion of this tender` })
      if (priceCritIds.has(cid))
        return res.status(409).json({ error: `criterion_id ${cid} is the commercial (price) criterion — its score is computed on recommendation, not entered` })
      if (seen.has(cid)) return res.status(400).json({ error: `Duplicate criterion_id ${cid} in payload` })
      seen.add(cid)
      if (!Number.isInteger(sc) || sc < 0 || sc > 100)
        return res.status(400).json({ error: `score for criterion_id ${cid} must be an integer between 0 and 100` })
    }

    // bulk upsert in one transaction (all-or-nothing)
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      for (const s of scores) {
        await conn.query(
          `INSERT INTO tender_evaluation_scores (bid_id, criterion_id, score, scored_by)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE score = VALUES(score), scored_by = VALUES(scored_by)`,
          [bidId, Number(s.criterion_id), Number(s.score), req.user.id])
      }
      await conn.commit()
    } catch (te) { await conn.rollback(); throw te } finally { conn.release() }

    audit(req, 'bid_scored', 'tender_bid', bidId, null, { criteria: scores.map(s => Number(s.criterion_id)), count: scores.length })
    const [rows] = await db.query(
      'SELECT criterion_id, score, scored_by, scored_at, updated_at FROM tender_evaluation_scores WHERE bid_id = ? ORDER BY criterion_id', [bidId])
    res.json({ bid_id: bidId, scores: rows })
  } catch (e) { console.error('[preaward:bid:scores]', e.message); dbError(res, e) }
})

// READ existing per-criterion scores for all of a tender's bids (pre-fills the grid).
router.get('/:projectId/tenders/:id/scores', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    const [rows] = await db.query(
      `SELECT s.bid_id, s.criterion_id, s.score, s.reason, s.scored_by, s.scored_at, s.updated_at
         FROM tender_evaluation_scores s JOIN tender_bids b ON b.id = s.bid_id
        WHERE b.tender_id = ? ORDER BY s.bid_id, s.criterion_id`, [tid])
    res.json({ scores: rows })
  } catch (e) { console.error('[preaward:scores:list]', e.message); dbError(res, e) }
})

// ═══ MTO-LINE RESERVATION (Phase 3.x) ══════════════════════════════════════════
// POST reserve-lines (can_edit): a tender reserves MTO line quantity — composing its
// scope (same trust tier as the criteria editor). Body { lines:[{mto_line_id, qty_reserved}] }.
// Atomic (all-or-nothing) across the batch. Race-safe: the txn runs at READ COMMITTED and
// locks each mto_line row FOR UPDATE, then reads availability via getAvailableQty UNDER that
// lock — a concurrent request for the same line blocks, then re-reads the committed
// reservation and 422s (never a stale pre-lock read). 409 if this tender already has a row
// for a requested line (modifying a reservation is a separate action, out of scope here).
router.post('/:projectId/tenders/:id/reserve-lines', requireLivePermission('pre_award', 'can_edit'), async (req, res) => {
  const pid = Number(req.params.projectId); const tid = Number(req.params.id)
  try {
    const { lines } = req.body || {}
    if (!Array.isArray(lines) || lines.length === 0)
      return res.status(400).json({ error: 'lines must be a non-empty array of { mto_line_id, qty_reserved }' })

    // payload validation + no duplicate mto_line_id in the request
    const seen = new Set()
    for (const l of lines) {
      const mid = Number(l?.mto_line_id); const q = Number(l?.qty_reserved)
      if (!Number.isInteger(mid)) return res.status(400).json({ error: `invalid mto_line_id ${l?.mto_line_id}` })
      if (!(q > 0)) return res.status(400).json({ error: `qty_reserved for mto_line_id ${mid} must be > 0` })
      if (seen.has(mid)) return res.status(400).json({ error: `duplicate mto_line_id ${mid} in request` })
      seen.add(mid)
    }

    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })

    // scope resolved by the caller (not by getAvailableQty): each mto_line must be in this project
    const ids = lines.map(l => Number(l.mto_line_id))
    const [inProj] = await db.query(
      `SELECT l.id FROM mto_lines l JOIN mto_registers r ON r.id = l.mto_id
        WHERE r.project_id = ? AND l.is_deleted = 0 AND l.id IN (${ids.map(() => '?').join(',')})`, [pid, ...ids])
    const okIds = new Set(inProj.map(r => r.id))
    const bad = ids.filter(i => !okIds.has(i))
    if (bad.length) return res.status(400).json({ error: `mto_line_id(s) not in this project: ${bad.join(', ')}` })

    const conn = await db.getConnection()
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')  // fresh reads for the SUM-based availability
      await conn.beginTransaction()
      // stable lock order (sorted by id) so concurrent batches can't deadlock
      const ordered = [...lines].sort((a, b) => Number(a.mto_line_id) - Number(b.mto_line_id))
      const created = []
      for (const l of ordered) {
        const mid = Number(l.mto_line_id); const q = Number(l.qty_reserved)
        await conn.query('SELECT id FROM mto_lines WHERE id = ? FOR UPDATE', [mid])   // serialization point
        const [[dup]] = await conn.query('SELECT id FROM tender_line_items WHERE tender_id = ? AND mto_line_id = ?', [tid, mid])
        if (dup) { await conn.rollback(); return res.status(409).json({ error: `Tender already has a reservation for mto_line_id ${mid} — modifying a reservation is a separate action` }) }
        const a = await getAvailableQty(mid, conn)   // computed UNDER the lock, at READ COMMITTED
        if (q > a.available) {
          await conn.rollback()
          return res.status(422).json({ error: `Cannot reserve ${q} on mto_line_id ${mid}: only ${a.available} available (total ${a.total_qty}, PO-consumed ${a.po_assigned}, reserved ${a.reserved}).` })
        }
        const [ins] = await conn.query(
          "INSERT INTO tender_line_items (tender_id, mto_line_id, qty_reserved, status) VALUES (?,?,?,'active')", [tid, mid, q])
        created.push({ id: ins.insertId, mto_line_id: mid, qty_reserved: q })
      }
      await conn.commit()
      audit(req, 'tender_lines_reserved', 'tender', tid, null, { lines: created })
      return res.status(201).json({ tender_id: tid, reserved: created })
    } catch (te) { await conn.rollback(); throw te } finally { conn.release() }
  } catch (e) { console.error('[preaward:reserve-lines]', e.message); dbError(res, e) }
})

// GET scope (can_view): the Scope tab's read model. Returns this tender's OWN reservations
// (tender_line_items joined to their MTO line), with LIVE availability for the active ones
// computed by the shared getAvailableQty — the SAME formula the reserve path enforces under
// lock, so the displayed number and the enforced number can never disagree by design. Also
// returns the project's active MTO registers so the "add lines" picker can offer a register.
router.get('/:projectId/tenders/:id/scope', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  const pid = Number(req.params.projectId); const tid = Number(req.params.id)
  try {
    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })

    // The recommended (winning) bid — the EXACT lookup generate-po uses, so the preview below can
    // never disagree with what the handoff will do. legacy = the bid has no per-line quantities.
    const [[appr]] = await db.query(
      "SELECT recommended_bid_id FROM tender_approvals WHERE tender_id=? AND status='approved' AND recommended_bid_id IS NOT NULL ORDER BY id DESC LIMIT 1", [tid])
    let award = null
    if (appr) {
      const [[w]] = await db.query(
        `SELECT b.id, s.name AS supplier_name, (SELECT COUNT(*) FROM tender_bid_lines bl WHERE bl.bid_id = b.id) AS n_lines
           FROM tender_bids b JOIN suppliers s ON s.id = b.supplier_id WHERE b.id = ?`, [appr.recommended_bid_id])
      if (w) award = { recommended_bid_id: w.id, supplier_name: w.supplier_name, legacy: Number(w.n_lines) === 0 }
    }
    const hasWinner = award ? 1 : 0, legacy = award && award.legacy ? 1 : 0

    // Per line: reserved / proposed (the winner's) / awarded (stored at award) / released, all in SQL
    // so decimals stay exact. planned_* is the pre-award preview, using the handoff's own rule:
    // legacy winner → reserved/0; per-line winner → proposed / reserved − proposed; no row → NULL.
    const [rows] = await db.query(
      `SELECT t.id AS tli_id, t.mto_line_id, t.qty_reserved, t.qty_awarded, t.status, t.released_at, t.released_reason,
              CASE WHEN t.status IN ('converted','partial_released','released') THEN t.qty_reserved - COALESCE(t.qty_awarded, 0) END AS qty_released,
              bl.qty_proposed,
              CASE WHEN t.status = 'active' AND ? = 1 THEN (CASE WHEN ? = 1 THEN t.qty_reserved ELSE bl.qty_proposed END) END AS planned_qty_awarded,
              CASE WHEN t.status = 'active' AND ? = 1 THEN (CASE WHEN ? = 1 THEN CAST(0 AS DECIMAL(15,3)) ELSE t.qty_reserved - bl.qty_proposed END) END AS planned_qty_released,
              m.line_number, m.description, m.uom, r.id AS mto_id, r.reference AS mto_reference
         FROM tender_line_items t
         JOIN mto_lines m ON m.id = t.mto_line_id
         JOIN mto_registers r ON r.id = m.mto_id
         LEFT JOIN tender_bid_lines bl ON bl.tender_line_item_id = t.id AND bl.bid_id = ?
        WHERE t.tender_id = ? ORDER BY t.mto_line_id`,
      [hasWinner, legacy, hasWinner, legacy, award ? award.recommended_bid_id : null, tid])

    // Live availability only for ACTIVE reservations (converted/released rows no longer consume).
    const reservations = []
    for (const row of rows) {
      const availability = row.status === 'active' ? await getAvailableQty(row.mto_line_id) : null
      reservations.push({ ...row, availability })
    }

    const [registers] = await db.query(
      "SELECT id, name, reference, current_revision FROM mto_registers WHERE project_id = ? AND status = 'active' ORDER BY reference", [pid])

    // The PO this tender was handed off to, if any (the award→PO link is 1:1 via tender_id).
    const [[po]] = await db.query(
      'SELECT id, po_number, supplier_id, vendor_name, value, currency, status FROM purchase_orders WHERE tender_id = ? ORDER BY id DESC LIMIT 1', [tid])

    res.json({ reservations, registers, po: po || null, award })
  } catch (e) { console.error('[preaward:scope]', e.message); dbError(res, e) }
})

// GET available-lines (can_view): the "add lines" picker's data source — one register's
// current-revision lines (paginated/searchable, same shape as the MTO detail screen), each
// annotated with LIVE availability via the shared getAvailableQty (Approach A: one formula,
// called per line for the current page only — bounded by the page cap, never the whole set)
// and a flag for lines THIS tender already reserved (the picker disables them; reserve 409s).
router.get('/:projectId/tenders/:id/available-lines', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  const pid = Number(req.params.projectId); const tid = Number(req.params.id)
  try {
    const mtoId = Number(req.query.mtoId)
    if (!Number.isInteger(mtoId)) return res.status(400).json({ error: 'mtoId (query) is required' })

    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    const [[mto]] = await db.query('SELECT id, current_revision FROM mto_registers WHERE id = ? AND project_id = ?', [mtoId, pid])
    if (!mto) return res.status(404).json({ error: 'MTO register not found in this project' })

    const page   = Math.max(1, parseInt(req.query.page || '1', 10))
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit || '25', 10)))   // cap 50 — bounds the per-line availability reads
    const offset = (page - 1) * limit

    const where  = ['mto_id = ?', 'revision = ?', 'is_deleted = 0']
    const params = [mto.id, mto.current_revision]
    const search = req.query.search
    if (search) {
      const q = `%${search}%`
      where.push('(line_number LIKE ? OR description LIKE ? OR wbs_code LIKE ?)')
      params.push(q, q, q)
    }
    const whereSql = where.join(' AND ')

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM mto_lines WHERE ${whereSql}`, params)
    const [lines] = await db.query(
      `SELECT id, line_number, description, quantity, uom, wbs_code, status, inspection_class, vdrl_required
         FROM mto_lines WHERE ${whereSql} ORDER BY line_number ASC, id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset])

    // which of THESE page lines this tender already reserved (active) → picker disables them
    let mine = new Set()
    if (lines.length) {
      const ids = lines.map(l => l.id)
      const [dups] = await db.query(
        `SELECT mto_line_id FROM tender_line_items WHERE tender_id = ? AND status = 'active' AND mto_line_id IN (${ids.map(() => '?').join(',')})`,
        [tid, ...ids])
      mine = new Set(dups.map(d => d.mto_line_id))
    }

    // Approach A: reuse getAvailableQty per line (single source of truth), page-bounded.
    const data = []
    for (const l of lines) {
      const a = await getAvailableQty(l.id)
      data.push({
        ...l,
        total_qty: a.total_qty, po_assigned: a.po_assigned, reserved: a.reserved, available: a.available,
        reserved_by_this_tender: mine.has(l.id),
      })
    }

    res.json({ data, total, page, limit })
  } catch (e) { console.error('[preaward:available-lines]', e.message); dbError(res, e) }
})

// ═══ APPROVAL CHAIN (Phase 2.7) ════════════════════════════════════════════════
// Mirrors po_approvals' real threshold-gated, sequential level-1-before-level-2
// logic. tender_approvals rows are the AUTHORITATIVE per-level state (approval_level
// set at the moment of each actual approval); tender_packages.approval_status is a
// coarse denormalized summary (pending → approved/rejected) — it stays 'pending'
// mid-chain. Value gated on estimated_value vs projects.approval_threshold_1/2.

const TENDER_L1_BANDA_ROLES = ['admin', 'procurement_manager', 'procurement_officer'] // single-level (V <= threshold1)
const TENDER_L1_MULTI_ROLES = ['admin', 'procurement_manager']                        // multi-level level-1
const TENDER_L2_ROLES       = ['admin', 'project_director']                           // level-2 (director)

async function getTenderThresholds(projectId) {
  const [[p]] = await db.query('SELECT approval_threshold_1, approval_threshold_2 FROM projects WHERE id = ?', [projectId])
  return { threshold1: p?.approval_threshold_1 ?? null, threshold2: p?.approval_threshold_2 ?? null }
}

// ─── APPROVE ──────────────────────────────────────────────────────────────────
router.post('/:projectId/tenders/:id/approve', requireLivePermission('pre_award', 'can_approve'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const role = req.user.role
    const { comment = null, level: reqLevel } = req.body || {}

    const [[tender]] = await db.query('SELECT id, estimated_value, approval_status FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    if (tender.approval_status === 'approved') return res.status(409).json({ error: 'Tender is already approved' })
    if (tender.approval_status === 'rejected') return res.status(409).json({ error: 'Cannot approve: tender was rejected' })

    const { threshold1, threshold2 } = await getTenderThresholds(pid)
    const V = Number(tender.estimated_value) || 0
    const needsManagerOnly = !threshold1 || V <= Number(threshold1)
    const needsDirector    = threshold2 != null && V > Number(threshold2)

    // Option A: capture which bid is the current system recommendation at approval time.
    // rank_position=1 is the top survivor; disqualified rows have rank_position=NULL, so this
    // never picks a disqualified bid. NULL when nothing has been computed — approval still proceeds.
    const [[rec]] = await db.query(
      "SELECT bid_id FROM tender_evaluations WHERE tender_id = ? AND rank_position = 1 LIMIT 1", [tid])
    const recommendedBidId = rec ? rec.bid_id : null

    // ── Admin bypass — one action completes the chain (mirrors po_approvals) ──
    if (role === 'admin') {
      await db.query("INSERT INTO tender_approvals (tender_id, approver_id, approval_level, status, actioned_at, comments, recommended_bid_id) VALUES (?,?,1,'approved',NOW(),?,?)", [tid, req.user.id, comment || 'Admin approval', recommendedBidId])
      await db.query("UPDATE tender_packages SET approval_status='approved', stage='award', status='awarded' WHERE id = ?", [tid])
      audit(req, 'tender_approved', 'tender', tid, { approval_status: tender.approval_status }, { approval_status: 'approved', level: 1, via: 'admin' })
      return res.json({ ok: true, approval_status: 'approved', level_completed: 1, via: 'admin' })
    }

    const [approved] = await db.query("SELECT approval_level FROM tender_approvals WHERE tender_id = ? AND status = 'approved'", [tid])
    const level1Done = approved.some(r => Number(r.approval_level) === 1)
    const level2Done = approved.some(r => Number(r.approval_level) === 2)

    if (!level1Done) {
      // ── this call processes LEVEL 1 ──
      if (reqLevel != null && Number(reqLevel) === 2)
        return res.status(409).json({ error: 'Cannot approve level 2 before level 1 is approved' })
      const allowed = (needsManagerOnly && !needsDirector) ? TENDER_L1_BANDA_ROLES : TENDER_L1_MULTI_ROLES
      if (!allowed.includes(role))
        return res.status(403).json({ error: `Your role cannot approve level 1 for this tender (allowed: ${allowed.join(', ')})` })

      await db.query("INSERT INTO tender_approvals (tender_id, approver_id, approval_level, status, actioned_at, comments, recommended_bid_id) VALUES (?,?,1,'approved',NOW(),?,?)", [tid, req.user.id, comment, recommendedBidId])

      if (needsDirector) {
        // level 1 done, level 2 required → approval_status STAYS 'pending'; notify directors
        const [dirs] = await db.query("SELECT id FROM users WHERE role IN ('project_director','admin') AND is_active = 1")
        for (const d of dirs) {
          await db.query("INSERT INTO notifications (user_id, type, message, related_entity_type, related_entity_id) VALUES (?,?,?,?,?)",
            [d.id, 'tender_director_approval_needed', `Tender #${tid} requires director approval`, 'tender', tid]).catch(() => {})
        }
        audit(req, 'tender_approved_level1', 'tender', tid, null, { level: 1, approval_status: 'pending' })
        return res.json({ ok: true, approval_status: 'pending', level_completed: 1, next: 'level 2 (director)' })
      }
      // single-level / manager-only → chain complete
      await db.query("UPDATE tender_packages SET approval_status='approved', stage='award', status='awarded' WHERE id = ?", [tid])
      audit(req, 'tender_approved', 'tender', tid, null, { level: 1, approval_status: 'approved' })
      return res.json({ ok: true, approval_status: 'approved', level_completed: 1 })
    }

    // ── level 1 done: if a director level is required and not yet done, this call processes LEVEL 2 ──
    if (needsDirector && !level2Done) {
      if (!TENDER_L2_ROLES.includes(role))
        return res.status(403).json({ error: `Your role cannot approve level 2 (allowed: ${TENDER_L2_ROLES.join(', ')})` })
      await db.query("INSERT INTO tender_approvals (tender_id, approver_id, approval_level, status, actioned_at, comments, recommended_bid_id) VALUES (?,?,2,'approved',NOW(),?,?)", [tid, req.user.id, comment, recommendedBidId])
      await db.query("UPDATE tender_packages SET approval_status='approved', stage='award', status='awarded' WHERE id = ?", [tid])
      audit(req, 'tender_approved_director', 'tender', tid, null, { level: 2, approval_status: 'approved' })
      return res.json({ ok: true, approval_status: 'approved', level_completed: 2 })
    }

    return res.status(409).json({ error: 'Approval chain already complete for this tender' })
  } catch (e) { console.error('[preaward:tender:approve]', e.message); dbError(res, e) }
})

// ─── RELEASE a tender's ACTIVE reservations (inside the caller's transaction) ──
// The caller holds the tender row lock (FOR UPDATE). Reads the active rows, then releases them in
// one statement; a count mismatch throws so the caller's whole transaction rolls back. qty_awarded
// stays NULL — released without an award, which chk_tli_awarded_coherence allows.
async function releaseActiveReservations(conn, tid, reason) {
  const [rows] = await conn.query(
    "SELECT id, mto_line_id, qty_reserved FROM tender_line_items WHERE tender_id = ? AND status = 'active' ORDER BY mto_line_id", [tid])
  if (rows.length === 0) return []
  const [upd] = await conn.query(
    "UPDATE tender_line_items SET status='released', released_at=NOW(), released_reason=? WHERE tender_id = ? AND status = 'active'", [reason, tid])
  if (upd.affectedRows !== rows.length) throw new Error(`Reservation release mismatch: ${upd.affectedRows} released vs ${rows.length} active`)
  return rows.map(r => ({ tli_id: r.id, mto_line_id: r.mto_line_id, qty_reserved: r.qty_reserved }))
}

// ─── REJECT ───────────────────────────────────────────────────────────────────
// Rejection is terminal (approve refuses a rejected tender; recompute does not reset it), so the
// tender's reservations can never be awarded: its ACTIVE reservations are released in the SAME
// transaction as the rejection, with released_reason='tender_rejected' (distinct from a cancellation).
// Tender row locked first; the approval checks read the locked row.
router.post('/:projectId/tenders/:id/reject', requireLivePermission('pre_award', 'can_approve'), async (req, res) => {
  const pid = Number(req.params.projectId); const tid = Number(req.params.id)
  try {
    const { comment = null } = req.body || {}
    const conn = await db.getConnection()
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
      await conn.beginTransaction()
      const [[tender]] = await conn.query('SELECT id, approval_status FROM tender_packages WHERE id = ? AND project_id = ? FOR UPDATE', [tid, pid])
      if (!tender) { await conn.rollback(); return res.status(404).json({ error: 'Tender not found' }) }
      if (tender.approval_status === 'approved') { await conn.rollback(); return res.status(409).json({ error: 'Tender is already approved; cannot reject' }) }
      if (tender.approval_status === 'rejected') { await conn.rollback(); return res.status(409).json({ error: 'Tender is already rejected' }) }

      const [approved] = await conn.query("SELECT approval_level FROM tender_approvals WHERE tender_id = ? AND status = 'approved'", [tid])
      const level = approved.some(r => Number(r.approval_level) === 1) ? 2 : 1
      await conn.query("INSERT INTO tender_approvals (tender_id, approver_id, approval_level, status, actioned_at, comments) VALUES (?,?,?,'rejected',NOW(),?)", [tid, req.user.id, level, comment])
      await conn.query("UPDATE tender_packages SET approval_status='rejected' WHERE id = ?", [tid])
      const released = await releaseActiveReservations(conn, tid, 'tender_rejected')
      await conn.commit()
      audit(req, 'tender_rejected', 'tender', tid, { approval_status: tender.approval_status }, { approval_status: 'rejected', level, released_reservations: released })
      res.json({ ok: true, approval_status: 'rejected', level, released })
    } catch (te) { await conn.rollback(); throw te } finally { conn.release() }
  } catch (e) { console.error('[preaward:tender:reject]', e.message); dbError(res, e) }
})

// ─── CANCEL ───────────────────────────────────────────────────────────────────
// POST /api/pre-award/:projectId/tenders/:id/cancel (can_edit). Sets status='cancelled' and, in the
// SAME transaction, releases every ACTIVE reservation with released_reason='tender_cancelled'.
// Allowed at any point BEFORE award; refused (409) once awarded — status 'awarded' or the approval
// chain complete — or once a PO links the tender (a recompute after handoff resets status to
// 'active' while the PO still exists), and if already cancelled. Tender row locked first; every
// check reads the locked row.
router.post('/:projectId/tenders/:id/cancel', requireLivePermission('pre_award', 'can_edit'), async (req, res) => {
  const pid = Number(req.params.projectId); const tid = Number(req.params.id)
  try {
    const conn = await db.getConnection()
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
      await conn.beginTransaction()
      const [[tender]] = await conn.query('SELECT id, status, approval_status FROM tender_packages WHERE id = ? AND project_id = ? FOR UPDATE', [tid, pid])
      if (!tender) { await conn.rollback(); return res.status(404).json({ error: 'Tender not found' }) }
      if (tender.status === 'cancelled') { await conn.rollback(); return res.status(409).json({ error: 'Tender is already cancelled' }) }
      if (tender.status === 'awarded' || tender.approval_status === 'approved') {
        await conn.rollback()
        return res.status(409).json({ error: `Cannot cancel: the tender has been awarded (status '${tender.status}', approval '${tender.approval_status}')` })
      }
      const [[po]] = await conn.query('SELECT id, po_number FROM purchase_orders WHERE tender_id = ? LIMIT 1', [tid])
      if (po) { await conn.rollback(); return res.status(409).json({ error: `Cannot cancel: the tender has been handed off to PO ${po.po_number}` }) }

      await conn.query("UPDATE tender_packages SET status='cancelled' WHERE id = ?", [tid])
      const released = await releaseActiveReservations(conn, tid, 'tender_cancelled')
      await conn.commit()
      audit(req, 'tender_cancelled', 'tender', tid, { status: tender.status }, { status: 'cancelled', released_reservations: released })
      res.json({ tender_id: tid, status: 'cancelled', released })
    } catch (te) { await conn.rollback(); throw te } finally { conn.release() }
  } catch (e) { console.error('[preaward:tender:cancel]', e.message); dbError(res, e) }
})

// ─── LIST approval chain ──────────────────────────────────────────────────────
router.get('/:projectId/tenders/:id/approvals', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const [[tender]] = await db.query('SELECT id, approval_status, estimated_value FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    const [rows] = await db.query(
      `SELECT a.id, a.tender_id, a.approver_id, u.full_name AS approver_name, a.approval_level, a.status,
              a.comments, a.actioned_at, a.created_at
         FROM tender_approvals a LEFT JOIN users u ON u.id = a.approver_id
        WHERE a.tender_id = ? ORDER BY a.approval_level, a.id`, [tid])
    res.json({ approval_status: tender.approval_status, estimated_value: tender.estimated_value, approvals: rows })
  } catch (e) { console.error('[preaward:tender:approvals]', e.message); dbError(res, e) }
})

// ═══ EVALUATION COMPUTATION + RECOMMENDATION (Phase 3.x) ════════════════════════
// POST compute-recommendation (can_approve): derive commercial scores, apply
// mandatory/min-score gates, rank survivors, persist the tender_evaluations roll-up.
// If the tender is already approved/awarded, archive the prior computation into the
// immutable tender_evaluation_snapshots, void the approval chain (status→'unapproved'),
// and roll back approval_status/stage/status before writing the new results.
//
// GATING RULES (consolidated):
//  - criteria must be locked (409).
//  - every eligible bid must be fully scored on every MANUAL criterion (409) — the
//    anti-bias completeness guard: technical scoring is finished before prices fold in.
//  - if a 'price' criterion exists, every eligible bid must be UNSEALED (409) — this
//    endpoint does NOT unseal; unseal stays the separate, narrower-gated action.
//  - a criterion disqualifies a bid iff it has a min_score AND score < min_score;
//    the disqualification TYPE is 'mandatory' when that criterion is mandatory, else
//    'min_score' (a mandatory criterion with no min_score imposes no numeric gate).
//  - commercial score is computed ONLY for technically-compliant bids (lowest compliant
//    price = 100), so it can never exceed 100.
const crypto = require('crypto')
const round0 = n => Math.round(n)
const round2 = n => Math.round(n * 100) / 100

router.post('/:projectId/tenders/:id/compute-recommendation', requireLivePermission('pre_award', 'can_approve'), async (req, res) => {
  const pid = Number(req.params.projectId); const tid = Number(req.params.id)
  try {
    const [[tender]] = await db.query(
      'SELECT id, ref, title, currency, approval_status, stage, status, criteria_locked_at FROM tender_packages WHERE id=? AND project_id=?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    if (tender.criteria_locked_at == null)
      return res.status(409).json({ error: 'Criteria are not locked — lock the criteria before computing the recommendation' })

    const [criteria] = await db.query(
      'SELECT id, criterion_key, label, weight, mandatory, min_score, score_source FROM tender_criteria WHERE tender_id=? ORDER BY display_order, id', [tid])
    if (criteria.length === 0) return res.status(409).json({ error: 'No criteria defined for this tender' })
    const priceCrit  = criteria.find(c => c.score_source === 'price') || null
    const manualCrit = criteria.filter(c => c.score_source !== 'price')

    const [bids] = await db.query(
      `SELECT b.id, b.supplier_id, s.name supplier_name, b.status, b.prelim_status, b.currency,
              c.commercial_value, c.unsealed_at
         FROM tender_bids b JOIN suppliers s ON s.id=b.supplier_id
         LEFT JOIN tender_bid_commercial c ON c.bid_id=b.id
        WHERE b.tender_id=? AND b.status NOT IN ('withdrawn','rejected') AND b.prelim_status='pass'
        ORDER BY b.id`, [tid])
    if (bids.length === 0) return res.status(409).json({ error: 'No eligible bids (need prelim_status=pass and status not withdrawn/rejected)' })

    const bidIds = bids.map(b => b.id)
    const [scoreRows] = await db.query(
      `SELECT bid_id, criterion_id, score FROM tender_evaluation_scores WHERE bid_id IN (${bidIds.map(()=>'?').join(',')})`, bidIds)
    const manualScore = {}
    for (const r of scoreRows) (manualScore[r.bid_id] ??= {})[r.criterion_id] = Number(r.score)

    // completeness guard (manual criteria)
    for (const b of bids) for (const c of manualCrit)
      if (manualScore[b.id]?.[c.id] == null)
        return res.status(409).json({ error: `Technical scoring incomplete: bid ${b.id} has no score for criterion "${c.label}"` })

    // unseal guard (only if a price criterion exists)
    if (priceCrit) {
      const sealed = bids.filter(b => b.unsealed_at == null)
      if (sealed.length) return res.status(409).json({ error: `Unseal all eligible bids before computing — still sealed: bid(s) ${sealed.map(b=>b.id).join(', ')}` })
      const noVal = bids.filter(b => b.commercial_value == null)
      if (noVal.length) return res.status(409).json({ error: `Missing commercial value for bid(s) ${noVal.map(b=>b.id).join(', ')}` })
    }

    // helper: evaluate a criterion's gate for a score → null (pass) or {type,...}
    const gateOf = (c, sc) => {
      if (c.min_score != null && sc < Number(c.min_score))
        return { type: c.mandatory ? 'mandatory' : 'min_score', criterion_id: c.id, criterion_label: c.label, score: sc, threshold: Number(c.min_score) }
      return null
    }

    // 1) technical gates (manual criteria) → technically-compliant set
    const dq = {}            // bidId → disqualification|null
    for (const b of bids) {
      let d = null
      for (const c of manualCrit) { d = gateOf(c, manualScore[b.id][c.id]); if (d) break }
      dq[b.id] = d
    }
    const techCompliant = bids.filter(b => !dq[b.id])

    // 2) commercial scores for technically-compliant bids (lowest compliant price = 100).
    //    Pure computation here; the DB writes happen inside the transaction below.
    const commScore = {}     // bidId → 0-100 | undefined
    if (priceCrit && techCompliant.length) {
      const lowest = Math.min(...techCompliant.map(b => Number(b.commercial_value)))
      for (const b of techCompliant) commScore[b.id] = round0(lowest / Number(b.commercial_value) * 100)
      // 3) commercial gate (if the price criterion itself is gated)
      for (const b of techCompliant) { const d = gateOf(priceCrit, commScore[b.id]); if (d) dq[b.id] = d }
    }

    // 4) combined score + rank for survivors (passed every gate)
    const perCritScore = (b) => {
      const m = {}
      for (const c of manualCrit) m[c.id] = manualScore[b.id][c.id]
      if (priceCrit && commScore[b.id] != null) m[priceCrit.id] = commScore[b.id]
      return m
    }
    const survivors = bids.filter(b => !dq[b.id])
    const combinedOf = (b) => {
      const m = perCritScore(b); let sum = 0
      for (const c of criteria) if (m[c.id] != null) sum += Number(c.weight) * m[c.id]
      return round2(sum / 100)
    }
    const techScoreOf = (b) => {
      const wsum = manualCrit.reduce((s,c)=>s+Number(c.weight),0)
      if (!wsum) return null
      return round0(manualCrit.reduce((s,c)=>s+Number(c.weight)*manualScore[b.id][c.id],0) / wsum)
    }
    survivors.sort((a,b) => combinedOf(b)-combinedOf(a)
      || Number(a.commercial_value||0)-Number(b.commercial_value||0) || a.id-b.id)
    const rankOf = {}; survivors.forEach((b,i)=>rankOf[b.id]=i+1)

    // build the per-bid breakdown (stored in scores_json, and reused for the archive)
    const bidDoc = (b) => {
      const m = perCritScore(b)
      return {
        bid_id: b.id, supplier_id: b.supplier_id, supplier_name: b.supplier_name,
        status: b.status, prelim_status: b.prelim_status, commercial_value: b.commercial_value,
        eligible: !dq[b.id], disqualification: dq[b.id] || null,
        scores: criteria.map(c => ({
          criterion_id: c.id, label: c.label, weight: c.weight, score: m[c.id] ?? null,
          reason: (priceCrit && c.id === priceCrit.id) ? 'commercial-computed' : null,
          weighted: (!dq[b.id] && m[c.id] != null) ? round2(Number(c.weight)*m[c.id]/100) : null,
        })),
        tech_score: techScoreOf(b),
        comm_score: (priceCrit && commScore[b.id] != null) ? commScore[b.id] : null,
        combined_score: dq[b.id] ? null : combinedOf(b),
        rank_position: rankOf[b.id] || null,
      }
    }
    const bidsDoc = bids.map(bidDoc)
    const recommendedBidId = survivors.length ? survivors[0].id : null

    // ── transactional write (+ archive/rollback if already approved) ──
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()

      const wasApproved = tender.approval_status === 'approved' || tender.stage === 'award' || tender.status === 'awarded'
      if (wasApproved) {
        // assemble the archive from the PRIOR computation (current tender_evaluations)
        const [priorEvals] = await conn.query('SELECT bid_id, tech_score, comm_score, combined_score, rank_position, scores_json, evaluated_by, evaluated_at FROM tender_evaluations WHERE tender_id=?', [tid])
        const [priorChain] = await conn.query('SELECT id, approver_id, approval_level, status, comments, actioned_at, created_at FROM tender_approvals WHERE tender_id=? ORDER BY approval_level, id', [tid])
        const batch = crypto.randomUUID()
        const snapshot = {
          schema_version: 1,
          tender: { id: tender.id, ref: tender.ref, title: tender.title, currency: tender.currency },
          computation: { archived_reason: 'recompute_after_approval', archived_at: new Date().toISOString(),
            archived_by: req.user.id, prior_approval_status: tender.approval_status, prior_stage: tender.stage, prior_status: tender.status },
          criteria: criteria.map(c => ({ criterion_id: c.id, key: c.criterion_key, label: c.label, weight: c.weight, mandatory: c.mandatory, min_score: c.min_score, score_source: c.score_source })),
          approval_chain: priorChain,
          bids: priorEvals.map(e => ({ bid_id: e.bid_id, tech_score: e.tech_score, comm_score: e.comm_score,
            combined_score: e.combined_score, rank_position: e.rank_position,
            breakdown: typeof e.scores_json === 'string' ? JSON.parse(e.scores_json) : e.scores_json })),
        }
        await conn.query(
          `INSERT INTO tender_evaluation_snapshots (tender_id, archive_batch, recommended_bid_id, computed_by, computed_at, snapshot_data)
           VALUES (?,?,?,?,?,CAST(? AS JSON))`,
          [tid, batch, null, req.user.id, new Date(), JSON.stringify(snapshot)])
        // void the approval chain in-place (rows preserved, marked unapproved) + roll back
        await conn.query("UPDATE tender_approvals SET status='unapproved' WHERE tender_id=? AND status IN ('pending','approved')", [tid])
        await conn.query("UPDATE tender_packages SET approval_status='pending', stage='recommendation', status='active' WHERE id=?", [tid])
      }

      // persist commercial scores (upsert; reason + scored_by = triggering user)
      if (priceCrit) for (const b of techCompliant) if (commScore[b.id] != null) {
        await conn.query(
          `INSERT INTO tender_evaluation_scores (bid_id, criterion_id, score, scored_by, reason)
           VALUES (?,?,?,?, 'commercial-computed')
           ON DUPLICATE KEY UPDATE score=VALUES(score), scored_by=VALUES(scored_by), reason=VALUES(reason)`,
          [b.id, priceCrit.id, commScore[b.id], req.user.id])
      }

      // overwrite the roll-up: clear prior, write fresh
      await conn.query('DELETE FROM tender_evaluations WHERE tender_id=?', [tid])
      for (const d of bidsDoc) {
        await conn.query(
          `INSERT INTO tender_evaluations (tender_id, bid_id, tech_score, comm_score, combined_score, rank_position, scores_json, evaluated_by, evaluated_at)
           VALUES (?,?,?,?,?,?,CAST(? AS JSON),?,NOW())`,
          [tid, d.bid_id, d.tech_score, d.comm_score, d.combined_score, d.rank_position, JSON.stringify(d), req.user.id])
      }
      await conn.commit()
    } catch (te) { await conn.rollback(); throw te } finally { conn.release() }

    audit(req, 'recommendation_computed', 'tender', tid, null,
      { eligible: bids.length, survivors: survivors.length, recommended_bid_id: recommendedBidId })
    res.json({ tender_id: tid, recommended_bid_id: recommendedBidId,
      ranked: bidsDoc.filter(d => d.rank_position != null).sort((a,b)=>a.rank_position-b.rank_position),
      disqualified: bidsDoc.filter(d => d.disqualification) })
  } catch (e) { console.error('[preaward:compute-recommendation]', e.message); dbError(res, e) }
})

// ─── GET recommendation (the stored ranked result for the tab) ──────────────────
router.get('/:projectId/tenders/:id/recommendation', requireLivePermission('pre_award', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id=? AND project_id=?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    const [rows] = await db.query(
      `SELECT e.bid_id, e.tech_score, e.comm_score, e.combined_score, e.rank_position, e.scores_json,
              e.evaluated_by, e.evaluated_at, u.full_name evaluated_by_name
         FROM tender_evaluations e LEFT JOIN users u ON u.id=e.evaluated_by
        WHERE e.tender_id=? ORDER BY (e.rank_position IS NULL), e.rank_position, e.bid_id`, [tid])
    if (rows.length === 0) return res.json({ computed: false })
    const parse = r => (typeof r.scores_json === 'string' ? JSON.parse(r.scores_json) : r.scores_json) || {}
    const ranked = rows.filter(r => r.rank_position != null).map(r => ({ ...parse(r), rank_position: r.rank_position, combined_score: r.combined_score }))
    const disqualified = rows.filter(r => r.rank_position == null).map(r => { const d = parse(r); return { bid_id: r.bid_id, supplier_name: d.supplier_name, disqualification: d.disqualification, scores: d.scores } })
    res.json({
      computed: true,
      computed_at: rows[0].evaluated_at, computed_by_name: rows[0].evaluated_by_name,
      recommended_bid_id: ranked.length ? ranked[0].bid_id : null,
      ranked, disqualified,
    })
  } catch (e) { console.error('[preaward:recommendation:get]', e.message); dbError(res, e) }
})

// ═══ AWARD → PO HANDOFF (Phase 3.x) ════════════════════════════════════════════
// POST generate-po (can_approve): convert an APPROVED tender's active reservations into a
// real PO for the winning (recommended) bid's supplier. Atomic: one PO (+ tender_id back-link)
// + its po_lines (source_mto_line_id set, unit_price NULL — lump-sum bid, total on the header)
// + each tender_line_items -> 'converted' + each mto_lines -> 'po-raised', all in one txn.
// 100% of active reservations convert (bids are lump-sum; no per-line bid scope exists — see
// design memory §3a). po_number is user-provided (globally UNIQUE).
router.post('/:projectId/tenders/:id/generate-po', requireLivePermission('pre_award', 'can_approve'), async (req, res) => {
  const pid = Number(req.params.projectId); const tid = Number(req.params.id)
  try {
    const po_number = String(req.body?.po_number || '').trim()
    if (!po_number) return res.status(400).json({ error: 'po_number is required' })

    const [[tender]] = await db.query('SELECT id, approval_status, currency, wbs_code, discipline FROM tender_packages WHERE id=? AND project_id=?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })
    if (tender.approval_status !== 'approved')
      return res.status(409).json({ error: `Tender is not approved (approval_status='${tender.approval_status}') — cannot generate a PO` })

    // winning bid captured at approval
    const [[appr]] = await db.query("SELECT recommended_bid_id FROM tender_approvals WHERE tender_id=? AND status='approved' AND recommended_bid_id IS NOT NULL ORDER BY id DESC LIMIT 1", [tid])
    if (!appr || appr.recommended_bid_id == null)
      return res.status(409).json({ error: 'No recommended bid was captured at approval — nothing to award' })
    const [[bid]] = await db.query(
      `SELECT b.id, b.supplier_id, s.name AS supplier_name, c.commercial_value
         FROM tender_bids b JOIN suppliers s ON s.id=b.supplier_id
         LEFT JOIN tender_bid_commercial c ON c.bid_id=b.id WHERE b.id=?`, [appr.recommended_bid_id])
    if (!bid) return res.status(409).json({ error: 'Recommended bid not found' })

    const conn = await db.getConnection()
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
      await conn.beginTransaction()

      // idempotency: a PO already links this tender → don't double-award
      const [[existingPo]] = await conn.query('SELECT id FROM purchase_orders WHERE tender_id=? LIMIT 1', [tid])
      if (existingPo) { await conn.rollback(); return res.status(409).json({ error: `Tender already handed off to PO #${existingPo.id}` }) }

      // active reservations (locked), joined to their MTO lines for line detail
      const [resv] = await conn.query(
        `SELECT t.id AS tli_id, t.mto_line_id, t.qty_reserved, m.description, m.uom
           FROM tender_line_items t JOIN mto_lines m ON m.id=t.mto_line_id
          WHERE t.tender_id=? AND t.status='active' ORDER BY t.mto_line_id FOR UPDATE`, [tid])
      if (resv.length === 0) { await conn.rollback(); return res.status(409).json({ error: 'No active reservations to convert' }) }

      // Winning bid's per-line proposed quantities. ZERO rows = a LEGACY bid (predates this
      // feature) → full conversion, exactly the original behavior. Rows present → per-line award.
      const [bidLines] = await conn.query('SELECT tender_line_item_id, qty_proposed FROM tender_bid_lines WHERE bid_id = ?', [bid.id])
      const legacy = bidLines.length === 0
      const proposedByTli = new Map(bidLines.map(l => [l.tender_line_item_id, l.qty_proposed]))
      if (!legacy) {
        // integrity: a rows-present bid must cover every active reservation (the submit endpoint
        // guarantees this; a gap here means a reservation was added after submission or data bypassed).
        const missing = resv.filter(r => !proposedByTli.has(r.tli_id)).map(r => r.mto_line_id)
        if (missing.length) { await conn.rollback(); return res.status(409).json({ error: `Winning bid has no proposed quantity for reserved mto_line_id(s): ${missing.join(', ')} — cannot award` }) }
        if (!resv.some(r => Number(proposedByTli.get(r.tli_id)) > 0)) { await conn.rollback(); return res.status(409).json({ error: 'Winning bid proposes zero on every reserved line — nothing to award' }) }
      }

      // create the PO — tender_id back-link; value = lump-sum bid; currency/wbs from tender
      let poId
      try {
        const [po] = await conn.query(
          `INSERT INTO purchase_orders (project_id, po_number, vendor_name, supplier_id, currency, value, wbs_code, status, tender_id, created_by)
           VALUES (?,?,?,?,?,?,?,'rfq',?,?)`,
          [pid, po_number, bid.supplier_name, bid.supplier_id, tender.currency || 'AUD', bid.commercial_value ?? null, tender.wbs_code || null, tid, req.user.id])
        poId = po.insertId
      } catch (pe) {
        if (pe.code === 'ER_DUP_ENTRY') { await conn.rollback(); return res.status(409).json({ error: `PO number "${po_number}" already exists` }) }
        throw pe
      }

      // ── PHASE 1 — line-granular conversion per the winning bid's proposed quantities ──
      // full → converted; partial → convert the proposed qty + release the remainder (partial_released);
      // zero → release the whole line (no po_line). Legacy → full on every line. Records the
      // tender-line → po-line mapping for Phase 2 (only the lines that actually got a po_line).
      const converted = []
      const outcome = { converted: 0, partial_released: 0, released: 0 }
      let poLineNo = 0
      for (const r of resv) {
        const reserved = Number(r.qty_reserved)
        const rawQ = legacy ? r.qty_reserved : proposedByTli.get(r.tli_id)
        const q = Number(rawQ)
        // qty_awarded is written in the SAME statement as each status change — chk_tli_awarded_coherence
        // checks the row after every statement, so status and qty_awarded must never be split.
        if (q === 0) {                                // declined → release the whole line, no po_line; awarded 0
          await conn.query("UPDATE tender_line_items SET status='released', qty_awarded=0, released_at=NOW(), released_reason=? WHERE id=?",
            [`Not awarded: 0 of ${r.qty_reserved} reserved proposed; ${r.qty_reserved} released`, r.tli_id])
          outcome.released++
          continue
        }
        poLineNo++
        const [plRes] = await conn.query(
          `INSERT INTO po_lines (po_id, line_number, description, qty, uom, unit_price, source_mto_line_id)
           VALUES (?,?,?,?,?,NULL,?)`,
          [poId, String(poLineNo), String(r.description).slice(0, 500), rawQ, r.uom || 'EA', r.mto_line_id])
        converted.push({ tli_id: r.tli_id, po_line_id: plRes.insertId, line_number: String(poLineNo) })
        if (q === reserved) {                         // full award (incl. legacy) → awarded = the reservation itself
          await conn.query("UPDATE tender_line_items SET status='converted', qty_awarded=qty_reserved WHERE id=?", [r.tli_id])
          outcome.converted++
        } else {                                      // partial award → convert q, release the remainder
          await conn.query("UPDATE tender_line_items SET status='partial_released', qty_awarded=?, released_at=NOW(), released_reason=? WHERE id=?",
            [rawQ, `Partial award: proposed ${rawQ} of ${r.qty_reserved} reserved; ${(reserved - q).toFixed(3)} released`, r.tli_id])
          outcome.partial_released++
        }
        await conn.query("UPDATE mto_lines SET status='po-raised', po_ref=? WHERE id=?", [po_number, r.mto_line_id])
      }

      // ── PHASE 2 — VDRL transfer (runs AFTER all Phase-1 conversions, same txn + FOR UPDATE lock) ──
      // For each converted line that carries tender-defined VDRL requirements, materialise them as
      // real vdrl_documents rows under the PO's single package, each pointing at the real po_line via
      // source_po_line_id. A failure ANYWHERE here rolls the WHOLE txn back — the PO, its po_lines,
      // the reservation→converted flips, the mto_lines→po-raised flips, AND the VDRL rows — together.
      let vdrlPackageId = null       // created at most once, lazily (only if some line has requirements)
      let vdrlDocs = 0
      for (const c of converted) {
        const [reqs] = await conn.query(
          'SELECT doc_key, label, doc_type, notes FROM tender_line_documents WHERE tender_line_item_id=?', [c.tli_id])
        if (reqs.length === 0) continue                       // no requirements on this line → invent nothing
        if (vdrlPackageId == null) {
          const [[pk]] = await conn.query('SELECT id FROM vdrl_packages WHERE po_id=? AND project_id=?', [poId, pid])
          if (pk) vdrlPackageId = pk.id
          else {
            const [pkRes] = await conn.query(
              "INSERT INTO vdrl_packages (project_id, po_id, package_ref, name, status, created_by) VALUES (?,?,?,?,'active',?)",
              [pid, poId, po_number, `${po_number} VDRL Package`, req.user.id])   // package_ref = po_number (NOT NULL, globally unique)
            vdrlPackageId = pkRes.insertId
          }
        }
        for (const d of reqs) {
          await conn.query(
            `INSERT INTO vdrl_documents (package_id, doc_number, title, doc_type, discipline, status, notes, created_by, source_po_line_id)
             VALUES (?,?,?,?,?, 'Not submitted', ?,?,?)`,
            [vdrlPackageId, `${c.line_number}-${d.doc_key}`, d.label, d.doc_type, tender.discipline || null, d.notes || null, req.user.id, c.po_line_id])   // doc_number NOT NULL → line_number-doc_key (unique within the package)
          vdrlDocs++
        }
        await conn.query("UPDATE po_lines SET vdrl_required=1 WHERE id=?", [c.po_line_id])
      }

      await conn.commit()
      audit(req, 'tender_awarded_to_po', 'tender', tid, null, { po_id: poId, po_number, po_lines: poLineNo, outcome, legacy, vdrl_documents: vdrlDocs, supplier_id: bid.supplier_id })
      const [[newPo]] = await db.query('SELECT id, po_number, supplier_id, vendor_name, value, currency, status, tender_id FROM purchase_orders WHERE id=?', [poId])
      return res.status(201).json({ po: newPo, converted_lines: poLineNo, outcome, legacy, vdrl_documents: vdrlDocs })
    } catch (te) { await conn.rollback(); throw te } finally { conn.release() }
  } catch (e) { console.error('[preaward:generate-po]', e.message); dbError(res, e) }
})

module.exports = router
