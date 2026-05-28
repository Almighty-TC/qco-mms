// ─── SEED ROLE PERMISSIONS ───────────────────────────────────
// Replaces ALL rows in role_permissions with the canonical spec.
// Safe to re-run: deletes existing rows before inserting fresh data.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

// ─── PERMISSION SPEC ─────────────────────────────────────────
// Format per row: [role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped]
// Modules: dashboard procurement expediting vdrl logistics material_control traceability document_inbox audit admin
const T = 1
const F = 0

const PERMISSIONS = [
  // ── admin: full access to all modules ────────────────────
  ['admin','dashboard',        T,T,T,T,T,F],
  ['admin','procurement',      T,T,T,T,T,F],
  ['admin','expediting',       T,T,T,T,T,F],
  ['admin','vdrl',             T,T,T,T,T,F],
  ['admin','logistics',        T,T,T,T,T,F],
  ['admin','material_control', T,T,T,T,T,F],
  ['admin','traceability',     T,T,T,T,T,F],
  ['admin','document_inbox',   T,T,T,T,T,F],
  ['admin','audit',            T,T,T,T,T,F],
  ['admin','admin',            T,T,T,T,T,F],

  // ── ceo: view only, all modules ──────────────────────────
  ['ceo','dashboard',        T,F,F,F,F,F],
  ['ceo','procurement',      T,F,F,F,F,F],
  ['ceo','expediting',       T,F,F,F,F,F],
  ['ceo','vdrl',             T,F,F,F,F,F],
  ['ceo','logistics',        T,F,F,F,F,F],
  ['ceo','material_control', T,F,F,F,F,F],
  ['ceo','traceability',     T,F,F,F,F,F],
  ['ceo','document_inbox',   T,F,F,F,F,F],
  ['ceo','audit',            T,F,F,F,F,F],
  ['ceo','admin',            T,F,F,F,F,F],

  // ── director: view only, all modules (same as CEO) ───────
  ['director','dashboard',        T,F,F,F,F,F],
  ['director','procurement',      T,F,F,F,F,F],
  ['director','expediting',       T,F,F,F,F,F],
  ['director','vdrl',             T,F,F,F,F,F],
  ['director','logistics',        T,F,F,F,F,F],
  ['director','material_control', T,F,F,F,F,F],
  ['director','traceability',     T,F,F,F,F,F],
  ['director','document_inbox',   T,F,F,F,F,F],
  ['director','audit',            T,F,F,F,F,F],
  ['director','admin',            T,F,F,F,F,F],

  // ── project_director: view only, no admin module ─────────
  ['project_director','dashboard',        T,F,F,F,F,F],
  ['project_director','procurement',      T,F,F,F,F,F],
  ['project_director','expediting',       T,F,F,F,F,F],
  ['project_director','vdrl',             T,F,F,F,F,F],
  ['project_director','logistics',        T,F,F,F,F,F],
  ['project_director','material_control', T,F,F,F,F,F],
  ['project_director','traceability',     T,F,F,F,F,F],
  ['project_director','document_inbox',   T,F,F,F,F,F],
  ['project_director','audit',            T,F,F,F,F,F],
  ['project_director','admin',            F,F,F,F,F,F],

  // ── project_manager ──────────────────────────────────────
  ['project_manager','dashboard',        T,F,F,F,F,F],
  ['project_manager','procurement',      T,T,T,F,F,F],
  ['project_manager','expediting',       T,T,T,F,F,F],
  ['project_manager','vdrl',             T,T,T,F,F,F],
  ['project_manager','logistics',        T,T,F,F,F,F],
  ['project_manager','material_control', T,F,F,F,F,F],
  ['project_manager','traceability',     T,F,F,F,F,F],
  ['project_manager','document_inbox',   T,T,F,F,F,F],
  ['project_manager','audit',            F,F,F,F,F,F],
  ['project_manager','admin',            F,F,F,F,F,F],

  // ── procurement_manager ──────────────────────────────────
  ['procurement_manager','dashboard',        T,F,F,F,F,F],
  ['procurement_manager','procurement',      T,T,T,T,T,F],
  ['procurement_manager','expediting',       T,F,F,F,F,F],
  ['procurement_manager','vdrl',             T,T,F,F,F,F],
  ['procurement_manager','logistics',        T,F,F,F,F,F],
  ['procurement_manager','material_control', F,F,F,F,F,F],
  ['procurement_manager','traceability',     F,F,F,F,F,F],
  ['procurement_manager','document_inbox',   T,T,F,F,F,F],
  ['procurement_manager','audit',            T,F,F,F,F,F],
  ['procurement_manager','admin',            F,F,F,F,F,F],

  // ── procurement_officer ──────────────────────────────────
  ['procurement_officer','dashboard',        T,F,F,F,F,F],
  ['procurement_officer','procurement',      T,T,T,F,F,F],
  ['procurement_officer','expediting',       T,F,F,F,F,F],
  ['procurement_officer','vdrl',             T,T,F,F,F,F],
  ['procurement_officer','logistics',        F,F,F,F,F,F],
  ['procurement_officer','material_control', F,F,F,F,F,F],
  ['procurement_officer','traceability',     F,F,F,F,F,F],
  ['procurement_officer','document_inbox',   T,F,F,F,F,F],
  ['procurement_officer','audit',            F,F,F,F,F,F],
  ['procurement_officer','admin',            F,F,F,F,F,F],

  // ── expediting_manager ───────────────────────────────────
  ['expediting_manager','dashboard',        T,F,F,F,F,F],
  ['expediting_manager','procurement',      T,F,F,F,F,F],
  ['expediting_manager','expediting',       T,T,T,T,T,F],
  ['expediting_manager','vdrl',             T,T,T,F,F,F],
  ['expediting_manager','logistics',        T,T,T,F,F,F],
  ['expediting_manager','material_control', F,F,F,F,F,F],
  ['expediting_manager','traceability',     F,F,F,F,F,F],
  ['expediting_manager','document_inbox',   T,T,T,F,F,F],
  ['expediting_manager','audit',            T,F,F,F,F,F],
  ['expediting_manager','admin',            F,F,F,F,F,F],

  // ── expeditor ────────────────────────────────────────────
  ['expeditor','dashboard',        T,F,F,F,F,F],
  ['expeditor','procurement',      T,F,F,F,F,F],
  ['expeditor','expediting',       T,T,T,F,F,F],
  ['expeditor','vdrl',             T,T,F,F,F,F],
  ['expeditor','logistics',        T,F,F,F,F,F],
  ['expeditor','material_control', F,F,F,F,F,F],
  ['expeditor','traceability',     F,F,F,F,F,F],
  ['expeditor','document_inbox',   T,T,F,F,F,F],
  ['expeditor','audit',            F,F,F,F,F,F],
  ['expeditor','admin',            F,F,F,F,F,F],

  // ── logistics_manager ────────────────────────────────────
  ['logistics_manager','dashboard',        T,F,F,F,F,F],
  ['logistics_manager','procurement',      T,F,F,F,F,F],
  ['logistics_manager','expediting',       T,F,F,F,F,F],
  ['logistics_manager','vdrl',             F,F,F,F,F,F],
  ['logistics_manager','logistics',        T,T,T,T,T,F],
  ['logistics_manager','material_control', T,T,T,F,F,F],
  ['logistics_manager','traceability',     T,F,F,F,F,F],
  ['logistics_manager','document_inbox',   T,T,T,F,F,F],
  ['logistics_manager','audit',            F,F,F,F,F,F],
  ['logistics_manager','admin',            F,F,F,F,F,F],

  // ── warehouse ────────────────────────────────────────────
  ['warehouse','dashboard',        T,F,F,F,F,F],
  ['warehouse','procurement',      F,F,F,F,F,F],
  ['warehouse','expediting',       F,F,F,F,F,F],
  ['warehouse','vdrl',             F,F,F,F,F,F],
  ['warehouse','logistics',        T,F,T,F,F,F],  // view + edit (no create)
  ['warehouse','material_control', T,T,T,T,F,F],  // view+create+edit+approve
  ['warehouse','traceability',     T,T,F,F,F,F],  // view+create
  ['warehouse','document_inbox',   T,F,F,F,F,F],
  ['warehouse','audit',            F,F,F,F,F,F],
  ['warehouse','admin',            F,F,F,F,F,F],

  // ── vendor (external) ────────────────────────────────────
  ['vendor','dashboard',        F,F,F,F,F,F],
  ['vendor','procurement',      T,F,F,F,F,F],
  ['vendor','expediting',       T,F,F,F,F,F],
  ['vendor','vdrl',             T,T,F,F,F,F],
  ['vendor','logistics',        F,F,F,F,F,F],
  ['vendor','material_control', F,F,F,F,F,F],
  ['vendor','traceability',     F,F,F,F,F,F],
  ['vendor','document_inbox',   T,T,F,F,F,F],
  ['vendor','audit',            F,F,F,F,F,F],
  ['vendor','admin',            F,F,F,F,F,F],

  // ── freight_forwarder (external) ─────────────────────────
  ['freight_forwarder','dashboard',        F,F,F,F,F,F],
  ['freight_forwarder','procurement',      F,F,F,F,F,F],
  ['freight_forwarder','expediting',       F,F,F,F,F,F],
  ['freight_forwarder','vdrl',             F,F,F,F,F,F],
  ['freight_forwarder','logistics',        T,F,T,F,F,F],  // view + edit
  ['freight_forwarder','material_control', F,F,F,F,F,F],
  ['freight_forwarder','traceability',     F,F,F,F,F,F],
  ['freight_forwarder','document_inbox',   T,T,F,F,F,F],
  ['freight_forwarder','audit',            F,F,F,F,F,F],
  ['freight_forwarder','admin',            F,F,F,F,F,F],

  // ── site_contractor (external) ───────────────────────────
  ['site_contractor','dashboard',        F,F,F,F,F,F],
  ['site_contractor','procurement',      F,F,F,F,F,F],
  ['site_contractor','expediting',       F,F,F,F,F,F],
  ['site_contractor','vdrl',             F,F,F,F,F,F],
  ['site_contractor','logistics',        F,F,F,F,F,F],
  ['site_contractor','material_control', T,F,F,F,F,F],
  ['site_contractor','traceability',     T,F,F,F,F,F],
  ['site_contractor','document_inbox',   T,F,F,F,F,F],
  ['site_contractor','audit',            F,F,F,F,F,F],
  ['site_contractor','admin',            F,F,F,F,F,F],

  // ── subcontractor (external) ──────────────────────────────
  ['subcontractor','dashboard',        F,F,F,F,F,F],
  ['subcontractor','procurement',      F,F,F,F,F,F],
  ['subcontractor','expediting',       F,F,F,F,F,F],
  ['subcontractor','vdrl',             F,F,F,F,F,F],
  ['subcontractor','logistics',        F,F,F,F,F,F],
  ['subcontractor','material_control', T,F,F,F,F,F],
  ['subcontractor','traceability',     F,F,F,F,F,F],
  ['subcontractor','document_inbox',   T,F,F,F,F,F],
  ['subcontractor','audit',            F,F,F,F,F,F],
  ['subcontractor','admin',            F,F,F,F,F,F],

  // ── viewer: read-only across core modules ────────────────
  ['viewer','dashboard',        T,F,F,F,F,F],
  ['viewer','procurement',      T,F,F,F,F,F],
  ['viewer','expediting',       T,F,F,F,F,F],
  ['viewer','vdrl',             T,F,F,F,F,F],
  ['viewer','logistics',        T,F,F,F,F,F],
  ['viewer','material_control', T,F,F,F,F,F],
  ['viewer','traceability',     T,F,F,F,F,F],
  ['viewer','document_inbox',   T,F,F,F,F,F],
  ['viewer','audit',            T,F,F,F,F,F],
  ['viewer','admin',            F,F,F,F,F,F],
]

async function run() {
  // Delete all existing rows (no FK references to this table)
  const [del] = await db.query('DELETE FROM role_permissions')
  console.log(`✓ Deleted ${del.affectedRows} existing rows`)

  // Bulk-insert canonical spec
  const rows = PERMISSIONS.map(
    ([role, module, v, c, e, a, d, w]) =>
      [role, module, v, c, e, a, d, w, 1]  // is_default = 1
  )
  await db.query(
    `INSERT INTO role_permissions
       (role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, is_default)
     VALUES ?`,
    [rows]
  )
  console.log(`✓ Inserted ${rows.length} rows`)

  // Quick verify
  const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM role_permissions')
  console.log(`✓ role_permissions now has ${cnt} rows`)

  // Show summary per role
  const [summary] = await db.query(
    `SELECT role, SUM(can_view) AS views, SUM(can_create) AS creates
     FROM role_permissions GROUP BY role ORDER BY role`
  )
  summary.forEach(r => console.log(`  ${r.role}: ${r.views} view, ${r.creates} create`))

  console.log('\nDone.')
  process.exit(0)
}

run().catch(e => { console.error(e.message); process.exit(1) })
