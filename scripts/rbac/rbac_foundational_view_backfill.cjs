// ─── FOUNDATIONAL READ BACKFILL (pairs with C-e strict read gating) ──────────
// C-e made enforce() gate GET on can_view. The foundational modules (mto, commodity,
// equipment, wbs) had a sparse matrix — only the engineering roles held a can_view
// row — so strict gating 403'd ~14 INTERNAL roles that legitimately need to read
// reference/planning data. This backfills view-ONLY rows (can_view=1, every other
// capability 0) for the internal roles, so the app is not broken for them, WITHOUT
// re-opening the external read leak: the 4 external roles (vendor, subcontractor,
// freight_forwarder, site_contractor) get NO grant here and stay denied. The one
// deliberate exception — site_contractor's pre-existing wbs can_view=1 — is left
// untouched (this script never downgrades or writes external roles).
//
// Idempotent: INSERT ... ON DUPLICATE KEY UPDATE can_view=1 only flips view on; it
// never alters can_create/edit/approve/delete on the engineering roles that already
// hold full rows. Re-runnable. Read-only on everything except the targeted view bit.
// Usage (from scripts/rbac/):  node rbac_foundational_view_backfill.cjs [--dry]
const m = require('../../server/node_modules/mysql2/promise')
require('../../server/node_modules/dotenv').config({ path: '../../server/.env' })

const MODULES = ['mto', 'commodity', 'equipment', 'wbs']
// Internal QCO roles that should retain read access to foundational reference data.
const INTERNAL = [
  'admin', 'auditor', 'ceo', 'director', 'engineering_lead', 'expediting_manager',
  'expeditor', 'logistics_manager', 'materials_engineer', 'procurement_manager',
  'procurement_officer', 'project_control', 'project_controls_manager',
  'project_director', 'project_manager', 'viewer', 'warehouse',
]
// 3rd-party/external roles — deliberately excluded (stay read-denied on foundational).
const EXTERNAL = ['vendor', 'subcontractor', 'freight_forwarder', 'site_contractor']

;(async () => {
  const dry = process.argv.includes('--dry')
  const c = await m.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: { rejectUnauthorized: false } })

  // Safety assertion: never write an external role here.
  for (const r of INTERNAL) if (EXTERNAL.includes(r)) throw new Error(`role ${r} is in both INTERNAL and EXTERNAL`)

  const before = {}
  for (const mod of MODULES) {
    const [[r]] = await c.query('SELECT COUNT(*) n FROM role_permissions WHERE module=? AND can_view=1', [mod])
    before[mod] = r.n
  }

  let applied = 0
  if (!dry) {
    for (const mod of MODULES) {
      for (const role of INTERNAL) {
        const [res] = await c.query(
          `INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, is_default)
           VALUES (?, ?, 1, 0, 0, 0, 0, 0, 1)
           ON DUPLICATE KEY UPDATE can_view = 1`,   // only ever flips view ON; leaves create/edit/approve/delete intact
          [role, mod])
        applied += res.affectedRows
      }
    }
  }

  const out = []
  for (const mod of MODULES) {
    const [[r]] = await c.query('SELECT COUNT(*) n FROM role_permissions WHERE module=? AND can_view=1', [mod])
    // confirm no external role gained view (except site_contractor.wbs which pre-existed)
    const [ext] = await c.query('SELECT role FROM role_permissions WHERE module=? AND can_view=1 AND role IN (?)', [mod, EXTERNAL])
    out.push([mod, before[mod], r.n, ext.map(x => x.role).join(',') || '—'])
  }
  await c.end()

  console.log(`FOUNDATIONAL VIEW BACKFILL${dry ? ' (DRY RUN — no writes)' : ''}`)
  console.log('  module'.padEnd(14) + 'view=1 before'.padEnd(15) + 'view=1 after'.padEnd(14) + 'external w/ view')
  for (const [mod, b, a, ext] of out) console.log('  ' + mod.padEnd(12) + String(b).padEnd(15) + String(a).padEnd(14) + ext)
  console.log(`\n  upsert affectedRows: ${applied} (insert=1, update-existing=2 per row)`)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
