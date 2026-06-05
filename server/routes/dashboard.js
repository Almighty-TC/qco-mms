// ─── DASHBOARD (project-view aggregate) ───────────────────────
// One gated endpoint returns every band in a single round-trip — all band counts
// fire in parallel (Promise.all) on pooled connections, because at this volume the
// queries are cheap and the real cost is round-trips to the remote DB.
//
// Honest, deterministic derivation: the Health Score is a weighted blend of real
// per-module health (computed from actual overdue/breached/hold counts); exceptions
// are real records. Nothing here is "AI" — they are computed facts.
//
// RBAC: gated on dashboard.can_view (external roles have can_view=0 → blocked).
// Per-module figures are OMITTED (null) for any module the viewer can't see in its
// own screen — never a misleading zero, never a leak. "Mine" is always per-user.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken, } = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')

router.use(authenticateToken)

async function writeAudit(userId, action, entity, id, before, after, resource, projectId = null) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id,action,entity_type,entity_id,project_id,before_value,after_value,resource) VALUES (?,?,?,?,?,?,?,?)`,
      [userId, action, entity, id, (Number(projectId) || null), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, resource])
  } catch (e) { console.error('[audit] insert failed:', e.message) }
}
const resourceOf = req => (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/)/, '')

// ─── PERMISSION RESOLUTION (one pass; override beats role; admin bypass) ──
const PERM_MODULES = ['procurement', 'expediting', 'logistics', 'material_control', 'traceability', 'mto', 'fmr']
async function visibleSet(req) {
  if (req.user.role === 'admin') return new Set(PERM_MODULES)
  const [[roleRows], [ovr]] = await Promise.all([
    db.query('SELECT module, can_view FROM role_permissions WHERE role=? AND module IN (?)', [req.user.role, PERM_MODULES]),
    db.query('SELECT module, can_view FROM user_permission_overrides WHERE user_id=? AND module IN (?)', [req.user.id, PERM_MODULES]),
  ])
  const ov = new Map(ovr.filter(o => o.can_view !== null).map(o => [o.module, o.can_view]))
  const set = new Set()
  for (const m of PERM_MODULES) {
    if (ov.has(m)) { if (ov.get(m)) set.add(m); continue }
    const r = roleRows.find(x => x.module === m)
    if (r && r.can_view) set.add(m)
  }
  return set
}

// ─── HEALTH DERIVATION RULES (per module) ─────────────────────
// Each module: score = total>0 ? 100*(1 - problems/total) : 100 (100 = healthy);
// rag = green ≥80 / amber 50–79 / red <50. Problem definitions (real records):
//   procurement   problems = PO lines past ROS not yet received/closed
//   expediting    problems = VDRL docs Overdue, or Not-submitted past required date
//   logistics     problems = SCNs held in customs review
//   materials     problems = stock lines at/under zero qty OR on trace hold
//   traceability  problems = certs overdue or rejected
const DEFAULT_WEIGHTS = { procurement: 25, expediting: 25, logistics: 20, materials: 15, traceability: 15 }
const scoreOf = (total, problems) => total > 0 ? Math.round(100 * (1 - problems / total)) : 100
const ragOf   = s => (s >= 80 ? 'green' : s >= 50 ? 'amber' : 'red')

// ─── GET /:projectId — the aggregate ──────────────────────────
router.get('/:projectId', requirePermission('dashboard', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const uid = req.user.id
    const role = req.user.role
    const vis = await visibleSet(req)
    const num = ([r]) => Number(r[0]?.n || 0)

    // All band counts in one parallel batch (cheap queries, minimize round-trips).
    const Q = {
      // stats + pipeline + procurement health
      mto_lines:      db.query('SELECT COUNT(*) n FROM mto_lines l JOIN mto_registers r ON r.id=l.mto_id WHERE r.project_id=?', [pid]),
      pos_awarded:    db.query("SELECT COUNT(*) n FROM purchase_orders WHERE project_id=? AND status IN ('po-raised','active','closed')", [pid]),
      po_total:       db.query('SELECT COUNT(*) n FROM po_lines pl JOIN purchase_orders po ON po.id=pl.po_id WHERE po.project_id=?', [pid]),
      po_overdue:     db.query("SELECT COUNT(*) n FROM po_lines pl JOIN purchase_orders po ON po.id=pl.po_id WHERE po.project_id=? AND pl.ros_date < CURDATE() AND pl.status NOT IN ('received','closed')", [pid]),
      po_breached:    db.query("SELECT COUNT(*) n FROM po_lines pl JOIN purchase_orders po ON po.id=pl.po_id WHERE po.project_id=? AND pl.cdd < CURDATE() AND pl.status NOT IN ('received','closed')", [pid]),
      // ─── MATERIALS FUNNEL (one grain: po_lines.status lifecycle) ───
      // raised ⊇ expedited ⊇ received are NESTED supersets of the same po_lines rows,
      // so the funnel is monotonic by construction (each stage ≤ the prior). The
      // status enum is ordered not-started→rfq→po-raised→in-production→shipped→received→closed.
      po_raised:      db.query("SELECT COUNT(DISTINCT pl.id) n FROM po_lines pl JOIN purchase_orders po ON po.id=pl.po_id WHERE po.project_id=? AND pl.status IN ('po-raised','in-production','shipped','received','closed')", [pid]),
      po_expedited:   db.query("SELECT COUNT(DISTINCT pl.id) n FROM po_lines pl JOIN purchase_orders po ON po.id=pl.po_id WHERE po.project_id=? AND pl.status IN ('in-production','shipped','received','closed')", [pid]),
      po_received:    db.query("SELECT COUNT(DISTINCT pl.id) n FROM po_lines pl JOIN purchase_orders po ON po.id=pl.po_id WHERE po.project_id=? AND pl.status IN ('received','closed')", [pid]),
      po_pending_rcv: db.query("SELECT COUNT(*) n FROM po_lines pl JOIN purchase_orders po ON po.id=pl.po_id WHERE po.project_id=? AND pl.status='in-production'", [pid]),
      // expediting (VDRL)
      vdrl_total:     db.query('SELECT COUNT(*) n FROM vdrl_documents d JOIN vdrl_packages p ON p.id=d.package_id WHERE p.project_id=?', [pid]),
      vdrl_overdue:   db.query("SELECT COUNT(*) n FROM vdrl_documents d JOIN vdrl_packages p ON p.id=d.package_id WHERE p.project_id=? AND (d.status='Overdue' OR (d.status='Not submitted' AND d.required_date < CURDATE()))", [pid]),
      // logistics (SCN)
      scn_total:      db.query('SELECT COUNT(*) n FROM shipment_control_notes WHERE project_id=?', [pid]),
      scn_holds:      db.query("SELECT COUNT(*) n FROM shipment_control_notes WHERE project_id=? AND status='customs_review'", [pid]),
      // materials (stock)
      stock_total:    db.query('SELECT COUNT(*) n FROM warehouse_stock WHERE project_id=?', [pid]),
      stock_problem:  db.query('SELECT COUNT(*) n FROM warehouse_stock WHERE project_id=? AND (qty<=0 OR trace_hold=1)', [pid]),
      stockouts:      db.query('SELECT COUNT(*) n FROM warehouse_stock WHERE project_id=? AND qty=0', [pid]),
      negative_stock: db.query('SELECT COUNT(*) n FROM warehouse_stock WHERE project_id=? AND qty<0', [pid]),
      // traceability
      cert_total:     db.query('SELECT COUNT(*) n FROM traceability_certs WHERE project_id=?', [pid]),
      cert_problem:   db.query("SELECT COUNT(*) n FROM traceability_certs WHERE project_id=? AND status IN ('overdue','rejected')", [pid]),
      // FMR
      fmr_open:       db.query("SELECT COUNT(*) n FROM fmr_requests WHERE project_id=? AND status NOT IN ('issued','rejected')", [pid]),
      // exceptions: RFIs / actions
      rfi_overdue:    db.query("SELECT COUNT(*) n FROM rfi_meeting_records WHERE project_id=? AND due_date < CURDATE() AND status NOT IN ('closed','cancelled','answered')", [pid]),
      act_overdue:    db.query("SELECT COUNT(*) n FROM meeting_actions WHERE project_id=? AND due_date < CURDATE() AND status IN ('open','in_progress')", [pid]),
      // project rollups
      proj:           db.query('SELECT at_risk, breached FROM projects WHERE id=?', [pid]),
      // mine (per-user)
      my_approvals:   db.query("SELECT COUNT(*) n FROM po_approvals a JOIN purchase_orders po ON po.id=a.po_id WHERE po.project_id=? AND a.approver_id=? AND a.status='pending'", [pid, uid]),
      my_confirms:    db.query("SELECT COUNT(*) n FROM pending_changes WHERE project_id=? AND status='pending' AND required_confirmer_role=? AND requested_by<>?", [pid, role, uid]),
      my_rfis:        db.query("SELECT COUNT(*) n FROM rfi_meeting_records WHERE project_id=? AND record_type='rfi' AND assigned_to=? AND status NOT IN ('closed','cancelled')", [pid, uid]),
      my_actions:     db.query("SELECT COUNT(*) n FROM meeting_actions WHERE project_id=? AND assigned_to=? AND status IN ('open','in_progress')", [pid, uid]),
      // weights
      weights:        db.query('SELECT module_key, weight FROM project_health_weights WHERE project_id=?', [pid]),
    }
    const keys = Object.keys(Q)
    const results = await Promise.all(keys.map(k => Q[k]))
    const c = {}; keys.forEach((k, i) => { c[k] = results[i] })
    const n = k => num(c[k])

    // ── weights (fall back to defaults if unconfigured) ──
    const wMap = { ...DEFAULT_WEIGHTS }
    for (const r of c.weights[0]) wMap[r.module_key] = r.weight

    // ── per-module health (only modules the viewer can see) ──
    const MODS = [
      { key: 'procurement',  perm: 'procurement',     total: n('po_total'),    problems: n('po_overdue') },
      { key: 'expediting',   perm: 'expediting',      total: n('vdrl_total'),  problems: n('vdrl_overdue') },
      { key: 'logistics',    perm: 'logistics',       total: n('scn_total'),   problems: n('scn_holds') },
      { key: 'materials',    perm: 'material_control', total: n('stock_total'), problems: n('stock_problem') },
      { key: 'traceability', perm: 'traceability',    total: n('cert_total'),  problems: n('cert_problem') },
    ]
    const visMods = MODS.filter(m => vis.has(m.perm))
    const modulesOut = visMods.map(m => {
      const s = scoreOf(m.total, m.problems)
      return { key: m.key, rag: ragOf(s), score: s, counts: { total: m.total, problems: m.problems } }
    })
    // project score = weighted over the VISIBLE modules (weights renormalised).
    const wSum = visMods.reduce((a, m) => a + (wMap[m.key] || 0), 0)
    const projScore = wSum > 0 ? Math.round(visMods.reduce((a, m) => a + scoreOf(m.total, m.problems) * (wMap[m.key] || 0), 0) / wSum) : null
    const band = projScore == null ? null : projScore >= 85 ? 'Excellent' : projScore >= 70 ? 'Good' : projScore >= 50 ? 'At risk' : 'Critical'

    const seeProc = vis.has('procurement'), seeExp = vis.has('expediting'), seeLog = vis.has('logistics'), seeMat = vis.has('material_control'), seeMto = vis.has('mto'), seeFmr = vis.has('fmr')
    const gate = (ok, v) => ok ? v : null   // omit (null), never a misleading zero

    res.json({
      health: {
        score: projScore, band, delta: null,   // delta omitted: no score history stored yet — not fabricated
        weights: Object.entries(wMap).map(([module, weight]) => ({ module, weight })),
        modules: modulesOut,
      },
      stats: {
        mto_lines:   gate(seeMto, n('mto_lines')),
        pos_awarded: gate(seeProc, n('pos_awarded')),
        at_risk:     gate(seeProc, c.proj[0][0]?.at_risk ?? 0),
        breached:    gate(seeProc, c.proj[0][0]?.breached ?? 0),
      },
      mine: {   // always per-user
        approvals_pos:   n('my_approvals'),
        confirmer_queue: n('my_confirms'),
        rfis_assigned:   n('my_rfis'),
        actions_assigned: n('my_actions'),
      },
      attention: {
        overdue_pos:        gate(seeProc, n('po_overdue')),
        breached_milestones: gate(seeProc, n('po_breached')),
        at_risk_deliveries: gate(seeExp, n('vdrl_overdue')),
        overdue_rfis:       n('rfi_overdue'),
        overdue_actions:    n('act_overdue'),
        stockouts:          gate(seeMat, n('stockouts')),
        negative_stock:     gate(seeMat, n('negative_stock')),
        pending_receipts:   gate(seeProc, n('po_pending_rcv')),
        open_fmrs:          gate(seeFmr, n('fmr_open')),
      },
      // Monotonic single-grain chain (raised ⊇ expedited ⊇ received over po_lines.status).
      // `demand` (MTO lines) is UPSTREAM and NOT chained — no FK links po_lines back to
      // mto_lines, so it is shown separately, never as a funnel parent. There is no
      // honest "issued" stage: fmr_issue_lines/warehouse_stock.po_line_id carry no data
      // to trace issuance back to a po_line, so a count there would be a phantom — omitted.
      pipeline: {
        demand:    gate(seeMto, n('mto_lines')),
        po_raised: gate(seeProc, n('po_raised')),
        expedited: gate(seeProc, n('po_expedited')),
        received:  gate(seeProc, n('po_received')),
      },
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── GET /:projectId/exceptions — the real records behind the Attention counts ──
// Deterministic: every item is an actual overdue/breached/held record (NOT AI).
// Same gating as the aggregate — categories for modules the viewer can't see are
// omitted. Each category capped (detail paging can be a later slice).
router.get('/:projectId/exceptions', requirePermission('dashboard', 'can_view'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const vis = await visibleSet(req)
    const CAP = 25
    const rows = ([r]) => r
    // [key, label, module-gate, page, query] — query returns {primary, secondary}
    const defs = [
      ['overdue_pos', 'Overdue POs', 'procurement', 'procurement',
        db.query(`SELECT po.po_number AS pri, CONCAT('Line ', pl.line_number, ' · ROS ', DATE_FORMAT(pl.ros_date,'%Y-%m-%d')) AS sec
                  FROM po_lines pl JOIN purchase_orders po ON po.id=pl.po_id
                  WHERE po.project_id=? AND pl.ros_date < CURDATE() AND pl.status NOT IN ('received','closed') ORDER BY pl.ros_date LIMIT ${CAP}`, [pid])],
      ['breached_milestones', 'Breached milestones', 'procurement', 'procurement',
        db.query(`SELECT po.po_number AS pri, CONCAT('Line ', pl.line_number, ' · CDD ', DATE_FORMAT(pl.cdd,'%Y-%m-%d')) AS sec
                  FROM po_lines pl JOIN purchase_orders po ON po.id=pl.po_id
                  WHERE po.project_id=? AND pl.cdd < CURDATE() AND pl.status NOT IN ('received','closed') ORDER BY pl.cdd LIMIT ${CAP}`, [pid])],
      ['at_risk_deliveries', 'At-risk deliveries', 'expediting', 'expediting',
        db.query(`SELECT d.doc_number AS pri, d.title AS sec
                  FROM vdrl_documents d JOIN vdrl_packages p ON p.id=d.package_id
                  WHERE p.project_id=? AND (d.status='Overdue' OR (d.status='Not submitted' AND d.required_date < CURDATE())) LIMIT ${CAP}`, [pid])],
      ['overdue_rfis', 'Overdue RFIs', null, 'rfi-meeting',
        db.query(`SELECT ref AS pri, title AS sec FROM rfi_meeting_records
                  WHERE project_id=? AND due_date < CURDATE() AND status NOT IN ('closed','cancelled','answered') ORDER BY due_date LIMIT ${CAP}`, [pid])],
      ['overdue_actions', 'Overdue actions', null, 'rfi-meeting',
        db.query(`SELECT CONCAT('Action #', seq) AS pri, description AS sec FROM meeting_actions
                  WHERE project_id=? AND due_date < CURDATE() AND status IN ('open','in_progress') ORDER BY due_date LIMIT ${CAP}`, [pid])],
      ['stockouts', 'Stock-outs', 'material_control', 'mc-stock',
        db.query(`SELECT item_code AS pri, description AS sec FROM warehouse_stock WHERE project_id=? AND qty=0 LIMIT ${CAP}`, [pid])],
      ['negative_stock', 'Negative stock', 'material_control', 'mc-stock',
        db.query(`SELECT item_code AS pri, CONCAT(description, ' (qty ', qty, ')') AS sec FROM warehouse_stock WHERE project_id=? AND qty<0 LIMIT ${CAP}`, [pid])],
      ['open_fmrs', 'Open FMRs', 'fmr', 'mc-fmr',
        db.query(`SELECT fmr_ref AS pri, status AS sec FROM fmr_requests WHERE project_id=? AND status NOT IN ('issued','rejected') ORDER BY required_date LIMIT ${CAP}`, [pid])],
    ]
    const results = await Promise.all(defs.map(d => d[4]))
    const groups = defs
      .map((d, i) => ({ key: d[0], label: d[1], module: d[2], page: d[3], items: rows(results[i]) }))
      .filter(g => g.module === null || vis.has(g.module))   // omit categories the viewer can't see
      .filter(g => g.items.length > 0)
      .map(({ key, label, page, items }) => ({ key, label, page, count: items.length, capped: items.length === CAP, items }))
    res.json({ groups })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ─── PUT /:projectId/weights — reweight (gated, total=100, audited) ──
router.put('/:projectId/weights', requirePermission('dashboard', 'can_edit'), async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const body = req.body?.weights ?? req.body
    const w = Array.isArray(body) ? Object.fromEntries(body.map(x => [x.module, Number(x.weight)])) : body
    const keys = ['procurement', 'expediting', 'logistics', 'materials', 'traceability']
    if (!keys.every(k => Number.isInteger(w?.[k]) && w[k] >= 0 && w[k] <= 100))
      return res.status(422).json({ error: 'Each of the 5 modules needs an integer weight 0–100' })
    const total = keys.reduce((a, k) => a + w[k], 0)
    if (total !== 100) return res.status(422).json({ error: `Weights must total 100 (got ${total})` })

    for (const k of keys) {
      await db.query(
        `INSERT INTO project_health_weights (project_id, module_key, weight, updated_by) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE weight=VALUES(weight), updated_by=VALUES(updated_by)`, [pid, k, w[k], req.user.id])
    }
    await writeAudit(req.user.id, 'dashboard_weights_updated', 'project', pid, null, w, resourceOf(req), pid)
    res.json({ ok: true, weights: w })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
