// ─── REPORTS (ANALYTICS, READ-ONLY) ──────────────────────────────────────────
// Curated + ad-hoc reporting across every module. This module owns no business
// data: it runs whitelisted, project-scoped queries (reports/datasets.js) through
// one injection-safe engine (reports/engine.js). Saved views are the only thing it
// persists (report_saved_views), and that table is optional — absent → views just
// return empty until the migration runs.
//
// AUTHZ (two gates, both enforced):
//   1. enforce('reports') — opens the module to roles with reports.can_view.
//   2. per dataset, the caller must ALSO have can_view on that dataset's SOURCE
//      module (datasets.js `module`). So a role that can open Reports but cannot
//      see e.g. procurement gets 403 on PO datasets — Reports is never a backdoor.
// Pooled connections only; parameterised queries only.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const ExcelJS = require('exceljs')
const { authenticateToken } = require('../middleware/auth')
const { denyReadOnly, enforce, hasPermission, requireProjectScope } = require('../middleware/permissions')
const { DATASETS, publicDataset } = require('../reports/datasets')
const { runReport } = require('../reports/engine')
const { CATALOG, byId, publicCatalog } = require('../reports/catalog')

router.use(authenticateToken)
router.use(denyReadOnly)            // viewer/auditor barred from any write (saved-view create/delete)
router.use(enforce('reports'))      // module-level gate: GET→can_view, POST→can_create, DELETE→can_delete
router.param('projectId', requireProjectScope) // Stage 1: external roles WBS-scoped to granted projects

// Own-property-only registry lookup: a plain DATASETS[k]/byId[k] truthy check lets
// inherited keys (constructor, __proto__, toString…) resolve to Object internals.
// Every registry membership test goes through own() so those reject cleanly (404).
const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)

// ─── DATASET SOURCE-MODULE GUARD ─────────────────────────────────────────────
// Resolve a datasetId → 403 unless the caller can_view its source module.
async function guardDataset(req, res, datasetId) {
  if (!own(DATASETS, datasetId)) { res.status(404).json({ error: `Unknown dataset "${datasetId}"` }); return null }
  const ds = DATASETS[datasetId]
  if (!(await hasPermission(req.user, ds.module, 'can_view'))) {
    res.status(403).json({ error: `Access denied to ${ds.module} data` }); return null
  }
  return ds
}

// ─── GET /:projectId/catalog ─────────────────────────────────────────────────
// Datasets + curated reports the CALLER may actually run (filtered by source-module
// can_view), so the UI never offers a report that would 403. Categories included.
router.get('/:projectId/catalog', async (req, res) => {
  try {
    // which distinct source modules can this user view?
    const modules = [...new Set(Object.values(DATASETS).map(d => d.module))]
    const allowed = {}
    for (const m of modules) allowed[m] = await hasPermission(req.user, m, 'can_view')

    const datasets = Object.keys(DATASETS)
      .filter(id => allowed[DATASETS[id].module])
      .map(id => publicDataset(id))

    const allowedDatasetIds = new Set(datasets.map(d => d.id))
    const reports = publicCatalog().filter(r =>
      r.composite ? true : allowedDatasetIds.has(r.datasetId))

    const CATS = [
      { id: 'procurement', label: 'Procurement & Expediting' },
      { id: 'materials',   label: 'Materials & Logistics' },
      { id: 'quality',     label: 'Quality & Traceability' },
      { id: 'health',      label: 'Project Health' },
    ]
    res.json({ categories: CATS, datasets, reports })
  } catch (e) {
    console.error('[reports] catalog:', e.message)
    res.status(500).json({ error: 'Failed to load report catalogue' })
  }
})

// ─── POST /:projectId/run ────────────────────────────────────────────────────
// Ad-hoc run. Body = engine config { datasetId, columns, filters, groupBy,
// aggregations, sort, limit, offset }. Source-module guarded.
router.post('/:projectId/run', async (req, res) => {
  const pid = Number(req.params.projectId)
  const cfg = req.body || {}
  const ds = await guardDataset(req, res, cfg.datasetId)
  if (!ds) return
  let conn
  try {
    conn = await db.getConnection()
    const out = await runReport(conn, pid, cfg)
    res.json(out)
  } catch (e) {
    if (e.status === 422) return res.status(422).json({ error: e.message })
    console.error('[reports] run:', e.message)
    res.status(500).json({ error: 'Failed to run report' })
  } finally { if (conn) conn.release() }
})

// ─── POST /:projectId/report/:reportId/run ───────────────────────────────────
// Curated run. Merges optional client overrides (extra filters / paging / sort)
// onto the preset config. Composite reports (project_health) computed specially.
router.post('/:projectId/report/:reportId/run', async (req, res) => {
  const pid = Number(req.params.projectId)
  if (!own(byId, req.params.reportId)) return res.status(404).json({ error: 'Unknown report' })
  const rep = byId[req.params.reportId]

  if (rep.composite && rep.id === 'project_health') return projectHealth(req, res, pid)

  const ds = await guardDataset(req, res, rep.config.datasetId)
  if (!ds) return
  const ov = req.body || {}
  const cfg = {
    ...rep.config,
    filters: [...(rep.config.filters || []), ...(ov.extraFilters || [])],
    sort: ov.sort || rep.config.sort,
    limit: ov.limit, offset: ov.offset,
  }
  let conn
  try {
    conn = await db.getConnection()
    const out = await runReport(conn, pid, cfg)
    res.json({ ...out, report: { id: rep.id, name: rep.name } })
  } catch (e) {
    if (e.status === 422) return res.status(422).json({ error: e.message })
    console.error('[reports] curated run:', e.message)
    res.status(500).json({ error: 'Failed to run report' })
  } finally { if (conn) conn.release() }
})

// ─── COMPOSITE: PROJECT HEALTH ───────────────────────────────────────────────
// One cross-module rollup row per area the caller can_view. Each row carries the
// area total, RAG breakdown where applicable, and a "needs attention" count. Shape
// matches the generic table renderer so it exports like any other report.
async function projectHealth(req, res, pid) {
  // [module, area label, query producing {total, red, amber, green, attention}]
  const probes = [
    ['procurement', 'Purchase Orders',
      `SELECT COUNT(*) total,
        SUM(rag='red') red, SUM(rag='amber') amber, SUM(rag='green') green,
        SUM(status NOT IN ('closed','cancelled') AND rag='red') attention
       FROM purchase_orders WHERE project_id=?`],
    ['logistics', 'Shipments',
      `SELECT COUNT(*) total, SUM(rag='red') red, SUM(rag='amber') amber, SUM(rag='green') green,
        SUM(status NOT IN ('received','closed') AND rag='red') attention
       FROM shipment_control_notes WHERE project_id=?`],
    ['material_control', 'Stock',
      `SELECT COUNT(*) total, NULL red, NULL amber, NULL green, SUM(trace_hold=1) attention
       FROM warehouse_stock WHERE project_id=?`],
    ['traceability', 'Certificates',
      `SELECT COUNT(*) total, NULL red, NULL amber, NULL green,
        SUM(is_required=1 AND received_date IS NULL AND due_date < CURDATE()) attention
       FROM traceability_certs WHERE project_id=?`],
    ['vdrl', 'Vendor Documents',
      `SELECT COUNT(*) total, NULL red, NULL amber, NULL green, SUM(d.status='Overdue') attention
       FROM vdrl_documents d JOIN vdrl_packages p ON p.id=d.package_id WHERE p.project_id=?`],
    ['wbs', 'WBS Nodes',
      `SELECT COUNT(*) total, SUM(rag='red') red, SUM(rag='amber') amber, SUM(rag='green') green,
        SUM(rag='red') attention FROM wbs_nodes WHERE project_id=?`],
    ['rfi_meeting', 'Open RFIs',
      `SELECT COUNT(*) total, NULL red, NULL amber, NULL green,
        SUM(closed_date IS NULL) attention
       FROM rfi_meeting_records WHERE project_id=? AND record_type='rfi'`],
  ]
  try {
    const rows = []
    for (const [mod, label, sql] of probes) {
      if (!(await hasPermission(req.user, mod, 'can_view'))) continue
      const [[r]] = await db.query(sql, [pid])
      rows.push({
        area: label, total: Number(r.total) || 0,
        red: r.red == null ? null : Number(r.red),
        amber: r.amber == null ? null : Number(r.amber),
        green: r.green == null ? null : Number(r.green),
        attention: Number(r.attention) || 0,
      })
    }
    res.json({
      grouped: true,
      columns: [
        { key: 'area', label: 'Area', type: 'string' },
        { key: 'total', label: 'Total', type: 'number' },
        { key: 'red', label: 'Red', type: 'number' },
        { key: 'amber', label: 'Amber', type: 'number' },
        { key: 'green', label: 'Green', type: 'number' },
        { key: 'attention', label: 'Needs attention', type: 'number' },
      ],
      rows, total: rows.length,
      report: { id: 'project_health', name: 'Project health overview' },
    })
  } catch (e) {
    console.error('[reports] project_health:', e.message)
    res.status(500).json({ error: 'Failed to build project health overview' })
  }
}

// ─── EXPORT (CSV / XLSX) ─────────────────────────────────────────────────────
// POST /:projectId/export  body { format, datasetId|reportId, ...config }
// Runs the same engine path, then streams. PDF is produced client-side (print view)
// so no heavy server renderer is needed.
router.post('/:projectId/export', async (req, res) => {
  const pid = Number(req.params.projectId)
  const b = req.body || {}
  const format = (b.format || 'csv').toLowerCase()
  if (!['csv', 'xlsx'].includes(format)) return res.status(422).json({ error: 'Unsupported format' })

  let conn, out, name = 'report'
  try {
    if (b.reportId) {
      if (!own(byId, b.reportId)) return res.status(404).json({ error: 'Unknown report' })
      const rep = byId[b.reportId]
      name = rep.id
      if (rep.composite && rep.id === 'project_health') {
        // reuse the composite computation by faking a sub-response collector
        return res.status(422).json({ error: 'Export the project health overview from the on-screen view' })
      }
      const ds = await guardDataset(req, res, rep.config.datasetId); if (!ds) return
      conn = await db.getConnection()
      out = await runReport(conn, pid, { ...rep.config, limit: 5000, offset: 0,
        filters: [...(rep.config.filters || []), ...(b.extraFilters || [])], sort: b.sort || rep.config.sort })
    } else {
      const ds = await guardDataset(req, res, b.datasetId); if (!ds) return
      name = b.datasetId
      conn = await db.getConnection()
      out = await runReport(conn, pid, { ...b, limit: 5000, offset: 0 })
    }
  } catch (e) {
    if (conn) conn.release()
    if (e.status === 422) return res.status(422).json({ error: e.message })
    console.error('[reports] export run:', e.message)
    return res.status(500).json({ error: 'Failed to build export' })
  }
  try {
    const fname = `${name}_p${pid}_${new Date().toISOString().slice(0,10)}`
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${fname}.csv"`)
      return res.send(toCsv(out.columns, out.rows))
    }
    // xlsx
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Report')
    ws.columns = out.columns.map(c => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 2) }))
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE84E0F' } }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    for (const r of out.rows) ws.addRow(r)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`)
    await wb.xlsx.write(res)
    res.end()
  } catch (e) {
    console.error('[reports] export write:', e.message)
    if (!res.headersSent) res.status(500).json({ error: 'Failed to write export' })
  } finally { if (conn) conn.release() }
})

// CSV from the engine's normalised {columns, rows}.
function toCsv(columns, rows) {
  const esc = v => {
    if (v == null) return ''
    let s = String(v)
    // CSV formula-injection guard: a cell starting with = + - @ (or tab/CR) is
    // executed as a formula by Excel/Sheets. Prefix with ' so it renders as text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = columns.map(c => esc(c.label)).join(',')
  const body = rows.map(r => columns.map(c => esc(r[c.key])).join(',')).join('\n')
  return head + '\n' + body
}

// ─── SAVED VIEWS (optional table — degrades to empty if not migrated) ─────────
// report_saved_views: id, user_id, project_id, name, dataset_id, config_json, created_at.
// Migration: server/scripts/migrate-report-views.js (owner/DDL account).
router.get('/:projectId/views', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, dataset_id AS datasetId, config_json AS config, created_at
       FROM report_saved_views WHERE project_id=? AND user_id=? ORDER BY name`,
      [Number(req.params.projectId), req.user.id])
    res.json(rows.map(r => ({ ...r, config: safeParse(r.config) })))
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return res.json([])   // migration not yet run
    console.error('[reports] views list:', e.message)
    res.status(500).json({ error: 'Failed to load saved views' })
  }
})

router.post('/:projectId/views', async (req, res) => {
  const { name, datasetId, config } = req.body || {}
  if (!name || !datasetId || !config) return res.status(422).json({ error: 'name, datasetId and config are required' })
  if (!own(DATASETS, datasetId)) return res.status(404).json({ error: 'Unknown dataset' })
  if (!(await hasPermission(req.user, DATASETS[datasetId].module, 'can_view')))
    return res.status(403).json({ error: 'Access denied to that data' })
  try {
    const [r] = await db.query(
      `INSERT INTO report_saved_views (user_id, project_id, name, dataset_id, config_json, created_at)
       VALUES (?,?,?,?,?,NOW())`,
      [req.user.id, Number(req.params.projectId), String(name).slice(0,120), datasetId, JSON.stringify(config)])
    res.status(201).json({ id: r.insertId, name, datasetId, config })
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE')
      return res.status(503).json({ error: 'Saved views are not available yet (migration pending).' })
    console.error('[reports] views create:', e.message)
    res.status(500).json({ error: 'Failed to save view' })
  }
})

router.delete('/:projectId/views/:id', async (req, res) => {
  try {
    const [r] = await db.query(
      `DELETE FROM report_saved_views WHERE id=? AND project_id=? AND user_id=?`,
      [Number(req.params.id), Number(req.params.projectId), req.user.id])
    if (!r.affectedRows) return res.status(404).json({ error: 'Saved view not found' })
    res.json({ ok: true })
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return res.status(404).json({ error: 'Saved view not found' })
    console.error('[reports] views delete:', e.message)
    res.status(500).json({ error: 'Failed to delete saved view' })
  }
})

function safeParse(s) { try { return JSON.parse(s) } catch { return null } }

module.exports = router
