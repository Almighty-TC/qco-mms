// ─── REPORTS MATRIX SEED (new 'reports' module) ──────────────────────────────
// The Reports module is gated by enforce('reports'): GET→can_view, POST→can_create
// (save a view), DELETE→can_delete (remove own view). This seeds the role_permissions
// rows so the module opens for INTERNAL roles and stays closed for EXTERNAL ones.
// (Data-level safety is independent: the route re-checks can_view on each dataset's
// SOURCE module, so even a granted role only sees data it could already see.)
//
// DML only (role_permissions is a data table) → runs as the runtime user (DB_USER),
// no DDL/admin account needed. Idempotent: INSERT … ON DUPLICATE KEY UPDATE.
// Usage (from scripts/rbac/):  node rbac_reports_matrix_seed.cjs [--dry]
const m = require('../../server/node_modules/mysql2/promise')
require('../../server/node_modules/dotenv').config({ path: '../../server/.env' })

const MODULE = 'reports'
// Internal QCO roles — may open Reports + manage their own saved views.
const INTERNAL = [
  'admin', 'auditor', 'ceo', 'director', 'engineering_lead', 'expediting_manager',
  'expeditor', 'logistics_manager', 'materials_engineer', 'procurement_manager',
  'procurement_officer', 'project_control', 'project_controls_manager',
  'project_director', 'project_manager', 'viewer', 'warehouse',
]
// External/3rd-party roles — deliberately get NO reports row (stay 403 on the module).
const EXTERNAL = ['vendor', 'subcontractor', 'freight_forwarder', 'site_contractor']
// Read-only internal roles: open Reports (view) but may NOT save/delete views. The
// denyReadOnly floor already blocks their writes; this keeps the matrix honest too.
const VIEW_ONLY = new Set(['viewer', 'auditor'])

;(async () => {
  const dry = process.argv.includes('--dry')
  const c = await m.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: { rejectUnauthorized: false } })

  for (const r of INTERNAL) if (EXTERNAL.includes(r)) throw new Error(`role ${r} in both lists`)

  const [[{ before }]] = await c.query('SELECT COUNT(*) `before` FROM role_permissions WHERE module=?', [MODULE])

  let applied = 0
  if (!dry) {
    for (const role of INTERNAL) {
      // Full roles: view + create + delete (manage own saved views). View-only roles
      // (viewer/auditor): view only. edit/approve N/A. ON DUPLICATE uses VALUES() so a
      // re-run aligns any existing row to these exact bits (idempotent + corrective).
      const w = VIEW_ONLY.has(role) ? 0 : 1
      const [res] = await c.query(
        `INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, is_default)
         VALUES (?, ?, 1, ?, 0, 0, ?, 0, 1)
         ON DUPLICATE KEY UPDATE can_view=1, can_create=VALUES(can_create), can_delete=VALUES(can_delete)`,
        [role, MODULE, w, w])
      applied += res.affectedRows
    }
  }

  const [[{ after }]] = await c.query('SELECT COUNT(*) `after` FROM role_permissions WHERE module=?', [MODULE])
  const [ext] = await c.query('SELECT role FROM role_permissions WHERE module=? AND role IN (?)', [MODULE, EXTERNAL])
  await c.end()

  console.log(`REPORTS MATRIX SEED${dry ? ' (DRY RUN — no writes)' : ''}`)
  console.log(`  reports rows before: ${before}   after: ${after}`)
  console.log(`  external roles with a reports row: ${ext.map(x => x.role).join(',') || '— (correct)'}`)
  console.log(`  upsert affectedRows: ${applied}`)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
