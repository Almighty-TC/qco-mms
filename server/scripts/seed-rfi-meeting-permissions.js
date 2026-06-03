// ─── SEED: rfi_meeting RBAC rows + amber-threshold setting (C1) ─
// One combined module 'rfi_meeting' governs both record types (record_type is
// data, not a permission boundary). External roles are RESPOND-ONLY: can_view +
// can_edit (the "only items assigned to me" rule is enforced row-level in the C2
// handlers, not in this module-level matrix), NO can_create. Close/sign-off =
// can_approve, granted to PM/PD/leads/managers/admin. Idempotent (upsert).
//
// FMR note: site_contractor's raise capability is a Material Control thing
// (POST /mc/:pid/fmr → module 'fmr'); it is NOT granted here and stays untouched.
//
// DML only (role_permissions + system_settings) — runs as the app user, which
// already holds those grants. No admin creds needed.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

const MODULE = 'rfi_meeting'

// [role, view, create, edit, approve, delete]
const ROWS = [
  ['admin',                     1, 1, 1, 1, 1], // bypasses checks anyway; seeded for parity
  // ── raise + close (can_approve) ──
  ['project_manager',           1, 1, 1, 1, 0],
  ['project_director',          1, 1, 1, 1, 0],
  ['engineering_lead',          1, 1, 1, 1, 0],
  ['project_controls_manager',  1, 1, 1, 1, 0],
  ['procurement_manager',       1, 1, 1, 1, 0],
  ['expediting_manager',        1, 1, 1, 1, 0],
  ['logistics_manager',         1, 1, 1, 1, 0],
  // ── raise + respond (no close) ──
  ['project_control',           1, 1, 1, 0, 0],
  ['expeditor',                 1, 1, 1, 0, 0],
  ['procurement_officer',       1, 1, 1, 0, 0],
  ['materials_engineer',        1, 1, 1, 0, 0],
  ['warehouse',                 1, 1, 1, 0, 0],
  // ── external: respond-only (view + edit-assigned, NO create) ──
  ['vendor',                    1, 0, 1, 0, 0],
  ['subcontractor',             1, 0, 1, 0, 0],
  ['site_contractor',           1, 0, 1, 0, 0],
  ['freight_forwarder',         1, 0, 1, 0, 0],
  // ── read-only ──
  ['viewer',                    1, 0, 0, 0, 0],
  ['auditor',                   1, 0, 0, 0, 0],
  ['ceo',                       1, 0, 0, 0, 0],
  ['director',                  1, 0, 0, 0, 0],
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

  // ── Amber RAG threshold (global setting; default 3 days) ──
  await db.query(
    "INSERT INTO system_settings (`key`, `value`) VALUES ('rfi_amber_days', '3') ON DUPLICATE KEY UPDATE `value`=`value`")
  console.log("  ✓ system_settings 'rfi_amber_days' = 3 (kept if already set)")
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Seed failed:', e); process.exit(1) })
