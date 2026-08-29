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
      `SELECT id, tender_id, criterion_key, label, weight, mandatory, min_score, display_order, created_at, updated_at
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
    res.json({ bids: rows })
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

// SUBMIT — creates the technical bid row + the SEALED commercial row in one transaction.
router.post('/:projectId/tenders/:id/bids', requireLivePermission('pre_award', 'can_create'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId); const tid = Number(req.params.id)
    const { supplier_id, round = 1, submitted_at = null, currency = 'AUD',
            tech_doc_count = 0, comm_doc_count = 0, bid_bond_provided = 0, commercial_value } = req.body || {}
    if (!supplier_id) return res.status(400).json({ error: 'supplier_id is required' })
    if (commercial_value == null || isNaN(Number(commercial_value)) || Number(commercial_value) < 0)
      return res.status(400).json({ error: 'commercial_value is required and must be a non-negative number' })
    const [[tender]] = await db.query('SELECT id FROM tender_packages WHERE id = ? AND project_id = ?', [tid, pid])
    if (!tender) return res.status(404).json({ error: 'Tender not found' })

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
      await conn.commit()
    } catch (te) { await conn.rollback(); throw te } finally { conn.release() }

    audit(req, 'bid_submitted', 'tender_bid', bidId, null, { supplier_id: Number(supplier_id), round: Number(round) || 1, sealed: true })
    const [[bid]] = await db.query('SELECT * FROM tender_bids WHERE id = ?', [bidId])
    res.status(201).json({ ...bid, envelope: 'sealed' })
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

module.exports = router
