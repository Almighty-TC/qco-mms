// ─── ADD NEW ROLES MIGRATION ─────────────────────────────────
// Run once on an existing database that already has role_permissions
// seeded.  Inserts only the 4 new internal roles; skips any row that
// already exists (ON DUPLICATE KEY UPDATE is a no-op when values match).
//
//   node server/scripts/add-new-roles.js
//
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

const T = true
const F = false

// ─── NEW ROLE PERMISSIONS ────────────────────────────────────
// Format: [role, module, view, create, edit, approve, delete, wbs_scoped]
const NEW_PERMISSIONS = [
  ['ceo', 'dashboard',        T,F,F,F,F,F],
  ['ceo', 'procurement',      T,F,F,F,F,F],
  ['ceo', 'expediting',       T,F,F,F,F,F],
  ['ceo', 'vdrl',             T,F,F,F,F,F],
  ['ceo', 'logistics',        T,F,F,F,F,F],
  ['ceo', 'material_control', T,F,F,F,F,F],
  ['ceo', 'traceability',     T,F,F,F,F,F],
  ['ceo', 'document_inbox',   T,F,F,F,F,F],
  ['ceo', 'audit',            T,F,F,F,F,F],
  ['ceo', 'admin',            F,F,F,F,F,F],

  ['director', 'dashboard',        T,F,F,F,F,F],
  ['director', 'procurement',      T,F,F,F,F,F],
  ['director', 'expediting',       T,F,F,F,F,F],
  ['director', 'vdrl',             T,F,F,F,F,F],
  ['director', 'logistics',        T,F,F,F,F,F],
  ['director', 'material_control', T,F,F,F,F,F],
  ['director', 'traceability',     T,F,F,F,F,F],
  ['director', 'document_inbox',   T,F,F,F,F,F],
  ['director', 'audit',            T,F,F,F,F,F],
  ['director', 'admin',            F,F,F,F,F,F],

  ['project_director', 'dashboard',        T,F,F,F,F,F],
  ['project_director', 'procurement',      T,F,F,F,F,T],
  ['project_director', 'expediting',       T,F,F,F,F,T],
  ['project_director', 'vdrl',             T,F,F,F,F,T],
  ['project_director', 'logistics',        T,F,F,F,F,T],
  ['project_director', 'material_control', T,F,F,F,F,T],
  ['project_director', 'traceability',     T,F,F,F,F,T],
  ['project_director', 'document_inbox',   T,F,F,F,F,T],
  ['project_director', 'audit',            T,F,F,F,F,T],
  ['project_director', 'admin',            F,F,F,F,F,F],

  ['project_manager', 'dashboard',        T,F,F,F,F,F],
  ['project_manager', 'procurement',      T,T,T,F,F,T],
  ['project_manager', 'expediting',       T,T,T,F,F,T],
  ['project_manager', 'vdrl',             T,T,T,F,F,T],
  ['project_manager', 'logistics',        T,T,T,F,F,T],
  ['project_manager', 'material_control', T,F,F,F,F,T],
  ['project_manager', 'traceability',     T,F,F,F,F,T],
  ['project_manager', 'document_inbox',   T,T,F,F,F,T],
  ['project_manager', 'audit',            T,F,F,F,F,T],
  ['project_manager', 'admin',            F,F,F,F,F,F],
]

async function run() {
  try {
    const rows = NEW_PERMISSIONS.map(
      ([role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped]) =>
        [role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, true]
    )

    await db.query(
      `INSERT INTO role_permissions
         (role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, is_default)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         can_view=VALUES(can_view), can_create=VALUES(can_create),
         can_edit=VALUES(can_edit), can_approve=VALUES(can_approve),
         can_delete=VALUES(can_delete), wbs_scoped=VALUES(wbs_scoped)`,
      [rows]
    )

    console.log(`[add-new-roles] Inserted/updated ${rows.length} rows for ceo, director, project_director, project_manager`)
    process.exit(0)
  } catch (err) {
    console.error('[add-new-roles] Failed:', err.message)
    process.exit(1)
  }
}

run()
