// ─── SEED: pre_award RBAC rows (Phase 2.0) ─────────────────────────────────────
// Registers the new 'pre_award' permission module in role_permissions, mirroring
// the LIVE 'procurement' grants (pre-award is upstream of procurement, so the same
// roles that run POs run the tenders that precede them) — with deliberate,
// pre-award-specific deviations:
//   • viewer  = view-only (locked read-only; no edit on tender/prequal/eval data)
//   • vendor + all externals = NO access (bidders must not see the tender register
//     or evaluation internals during a live tender — anti-bias)
//   • downstream-of-award functions = NO access (no legitimate reason to see
//     pre-award data): expediting_manager, expeditor, logistics_manager,
//     materials_engineer, warehouse
//
// UNSEAL NOTE (design, enforced later in the Phase-2.5 route, NOT here): revealing
// sealed commercial envelopes requires BOTH can_edit=1 on pre_award AND the user's
// role being in an explicit route-file allowlist
//   UNSEAL_AUTHORIZED_ROLES = ['procurement_manager', 'admin']
// i.e. unseal is a manager-level control, deliberately narrower than can_edit
// (procurement_officer/project_manager can edit a tender but cannot unseal).
//
// DML only (role_permissions upsert) — runs as the regular app user (qmat_app) via
// require('../db') + server/.env, exactly like seed-rfi-meeting-permissions.js.
// qmat_app already holds SELECT/INSERT/UPDATE/DELETE on role_permissions — NO admin
// creds, NO .env.admin, NO fresh GRANT needed. Idempotent (ON DUPLICATE KEY UPDATE).
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

const MODULE = 'pre_award'

// [role, view, create, edit, approve, delete]   (wbs_scoped=0, is_default=1 fixed)
const ROWS = [
  ['admin',                     1, 1, 1, 1, 1],  // full
  ['procurement_manager',       1, 1, 1, 1, 1],  // full — runs pre-award + unseal-authorized
  ['procurement_officer',       1, 1, 1, 1, 0],  // create/edit/approve, no delete
  ['project_manager',           1, 1, 1, 0, 0],  // create/edit
  ['project_director',          1, 0, 0, 1, 0],  // view + approve (award chain)
  // ── oversight / audit — view only ──
  ['ceo',                       1, 0, 0, 0, 0],
  ['director',                  1, 0, 0, 0, 0],
  ['auditor',                   1, 0, 0, 0, 0],  // must be able to audit pre-award
  ['project_controls_manager',  1, 0, 0, 0, 0],  // tender cost oversight
  ['project_control',           1, 0, 0, 0, 0],
  ['engineering_lead',          1, 0, 0, 0, 0],  // technical-evaluation input
  ['viewer',                    1, 0, 0, 0, 0],  // read-only
  // ── NO pre-award involvement (downstream-of-award functions) — all zero ──
  ['logistics_manager',         0, 0, 0, 0, 0],
  ['materials_engineer',        0, 0, 0, 0, 0],
  ['expediting_manager',        0, 0, 0, 0, 0],
  ['expeditor',                 0, 0, 0, 0, 0],
  ['warehouse',                 0, 0, 0, 0, 0],
  ['vendor',                    0, 0, 0, 0, 0],  // anti-bias: bidders get no module access
  ['freight_forwarder',         0, 0, 0, 0, 0],
  ['site_contractor',           0, 0, 0, 0, 0],
  ['subcontractor',             0, 0, 0, 0, 0],
]

async function run() {
  console.log(`\nSeeding ${MODULE} RBAC rows…\n`)
  for (const [role, v, c, e, a, d] of ROWS) {
    await db.query(
      `INSERT INTO role_permissions
         (role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
       ON DUPLICATE KEY UPDATE
         can_view=VALUES(can_view), can_create=VALUES(can_create), can_edit=VALUES(can_edit),
         can_approve=VALUES(can_approve), can_delete=VALUES(can_delete)`,
      [role, MODULE, v, c, e, a, d])
  }
  console.log(`  ✓ ${ROWS.length} role rows upserted for module '${MODULE}'`)

  // Verify: row count + a spot-check of the security-critical rows
  const [[cnt]] = await db.query('SELECT COUNT(*) AS n FROM role_permissions WHERE module=?', [MODULE])
  console.log(`  ✓ role_permissions now holds ${cnt.n} rows for '${MODULE}'`)
  const [chk] = await db.query(
    `SELECT role, can_view v, can_create c, can_edit e, can_approve a, can_delete d
       FROM role_permissions
      WHERE module=? AND role IN ('procurement_manager','vendor','expediting_manager','viewer','project_director','logistics_manager','materials_engineer')
      ORDER BY role`, [MODULE])
  console.log('  spot-check:')
  chk.forEach(r => console.log(`    ${r.role.padEnd(20)} v${r.v} c${r.c} e${r.e} a${r.a} d${r.d}`))
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Seed failed:', e); process.exit(1) })
