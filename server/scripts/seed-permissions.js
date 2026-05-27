// ─── SEED ROLE PERMISSIONS ──────────────────────────────────
// Run once: node server/scripts/seed-permissions.js
// Inserts default permissions into role_permissions.
// Safe to re-run: skips if data already exists (checks row count).
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

// ─── PERMISSION MATRIX DEFINITION ───────────────────────────
// Each entry: [role, module, view, create, edit, approve, delete, wbs_scoped]
// Roles: admin, ceo, director, project_director, project_manager,
//        procurement_manager, procurement_officer,
//        expediting_manager, expeditor, logistics_manager,
//        warehouse, vendor, freight_forwarder, site_contractor, viewer
// Modules: dashboard, procurement, expediting, vdrl, logistics,
//          material_control, traceability, document_inbox, audit, admin
const T = true
const F = false

const PERMISSIONS = [
  // ── admin: full access, nothing WBS-scoped ──────────────
  ['admin', 'dashboard',        T,T,T,T,T,F],
  ['admin', 'procurement',      T,T,T,T,T,F],
  ['admin', 'expediting',       T,T,T,T,T,F],
  ['admin', 'vdrl',             T,T,T,T,T,F],
  ['admin', 'logistics',        T,T,T,T,T,F],
  ['admin', 'material_control', T,T,T,T,T,F],
  ['admin', 'traceability',     T,T,T,T,T,F],
  ['admin', 'document_inbox',   T,T,T,T,T,F],
  ['admin', 'audit',            T,T,T,T,T,F],
  ['admin', 'admin',            T,T,T,T,T,F],

  // ── procurement_manager ─────────────────────────────────
  ['procurement_manager', 'dashboard',        T,F,F,F,F,F],
  ['procurement_manager', 'procurement',      T,T,T,T,T,F],
  ['procurement_manager', 'expediting',       T,F,F,F,F,F],
  ['procurement_manager', 'vdrl',             T,T,T,T,F,F],
  ['procurement_manager', 'logistics',        T,F,F,F,F,F],
  ['procurement_manager', 'material_control', T,F,F,F,F,F],
  ['procurement_manager', 'traceability',     T,F,F,F,F,F],
  ['procurement_manager', 'document_inbox',   T,T,T,F,F,F],
  ['procurement_manager', 'audit',            T,F,F,F,F,F],
  ['procurement_manager', 'admin',            F,F,F,F,F,F],

  // ── procurement_officer ─────────────────────────────────
  ['procurement_officer', 'dashboard',        T,F,F,F,F,F],
  ['procurement_officer', 'procurement',      T,T,T,F,F,F],
  ['procurement_officer', 'expediting',       T,F,F,F,F,F],
  ['procurement_officer', 'vdrl',             T,T,F,F,F,F],
  ['procurement_officer', 'logistics',        T,F,F,F,F,F],
  ['procurement_officer', 'material_control', F,F,F,F,F,F],
  ['procurement_officer', 'traceability',     F,F,F,F,F,F],
  ['procurement_officer', 'document_inbox',   T,T,F,F,F,F],
  ['procurement_officer', 'audit',            F,F,F,F,F,F],
  ['procurement_officer', 'admin',            F,F,F,F,F,F],

  // ── expediting_manager ──────────────────────────────────
  ['expediting_manager', 'dashboard',        T,F,F,F,F,F],
  ['expediting_manager', 'procurement',      T,F,F,F,F,F],
  ['expediting_manager', 'expediting',       T,T,T,T,T,F],
  ['expediting_manager', 'vdrl',             T,F,F,F,F,F],
  ['expediting_manager', 'logistics',        T,F,F,F,F,F],
  ['expediting_manager', 'material_control', T,F,F,F,F,F],
  ['expediting_manager', 'traceability',     T,F,F,F,F,F],
  ['expediting_manager', 'document_inbox',   T,T,T,F,F,F],
  ['expediting_manager', 'audit',            T,F,F,F,F,F],
  ['expediting_manager', 'admin',            F,F,F,F,F,F],

  // ── expeditor (WBS-scoped on operational modules) ───────
  ['expeditor', 'dashboard',        T,F,F,F,F,F],
  ['expeditor', 'procurement',      T,F,F,F,F,T],
  ['expeditor', 'expediting',       T,T,T,F,F,T],
  ['expeditor', 'vdrl',             T,F,F,F,F,T],
  ['expeditor', 'logistics',        T,F,F,F,F,T],
  ['expeditor', 'material_control', F,F,F,F,F,F],
  ['expeditor', 'traceability',     F,F,F,F,F,F],
  ['expeditor', 'document_inbox',   T,T,F,F,F,T],
  ['expeditor', 'audit',            F,F,F,F,F,F],
  ['expeditor', 'admin',            F,F,F,F,F,F],

  // ── logistics_manager ───────────────────────────────────
  ['logistics_manager', 'dashboard',        T,F,F,F,F,F],
  ['logistics_manager', 'procurement',      T,F,F,F,F,F],
  ['logistics_manager', 'expediting',       T,F,F,F,F,F],
  ['logistics_manager', 'vdrl',             T,F,F,F,F,F],
  ['logistics_manager', 'logistics',        T,T,T,T,T,F],
  ['logistics_manager', 'material_control', T,F,T,F,F,F],
  ['logistics_manager', 'traceability',     T,F,T,F,F,F],
  ['logistics_manager', 'document_inbox',   T,T,T,F,F,F],
  ['logistics_manager', 'audit',            T,F,F,F,F,F],
  ['logistics_manager', 'admin',            F,F,F,F,F,F],

  // ── warehouse (WBS-scoped) ──────────────────────────────
  ['warehouse', 'dashboard',        T,F,F,F,F,F],
  ['warehouse', 'procurement',      F,F,F,F,F,F],
  ['warehouse', 'expediting',       F,F,F,F,F,F],
  ['warehouse', 'vdrl',             F,F,F,F,F,F],
  ['warehouse', 'logistics',        T,F,F,F,F,T],
  ['warehouse', 'material_control', T,F,T,F,F,T],
  ['warehouse', 'traceability',     T,F,F,F,F,T],
  ['warehouse', 'document_inbox',   T,F,F,F,F,F],
  ['warehouse', 'audit',            F,F,F,F,F,F],
  ['warehouse', 'admin',            F,F,F,F,F,F],

  // ── vendor (external, WBS-scoped) ───────────────────────
  ['vendor', 'dashboard',        T,F,F,F,F,T],
  ['vendor', 'procurement',      T,F,F,F,F,T],
  ['vendor', 'expediting',       F,F,F,F,F,F],
  ['vendor', 'vdrl',             T,F,F,F,F,T],
  ['vendor', 'logistics',        F,F,F,F,F,F],
  ['vendor', 'material_control', F,F,F,F,F,F],
  ['vendor', 'traceability',     F,F,F,F,F,F],
  ['vendor', 'document_inbox',   T,F,F,F,F,T],
  ['vendor', 'audit',            F,F,F,F,F,F],
  ['vendor', 'admin',            F,F,F,F,F,F],

  // ── freight_forwarder (external, WBS-scoped) ────────────
  ['freight_forwarder', 'dashboard',        T,F,F,F,F,T],
  ['freight_forwarder', 'procurement',      F,F,F,F,F,F],
  ['freight_forwarder', 'expediting',       F,F,F,F,F,F],
  ['freight_forwarder', 'vdrl',             T,F,F,F,F,T],
  ['freight_forwarder', 'logistics',        T,T,F,F,F,T],
  ['freight_forwarder', 'material_control', F,F,F,F,F,F],
  ['freight_forwarder', 'traceability',     F,F,F,F,F,F],
  ['freight_forwarder', 'document_inbox',   T,T,F,F,F,T],
  ['freight_forwarder', 'audit',            F,F,F,F,F,F],
  ['freight_forwarder', 'admin',            F,F,F,F,F,F],

  // ── site_contractor (external, WBS-scoped) ──────────────
  ['site_contractor', 'dashboard',        T,F,F,F,F,T],
  ['site_contractor', 'procurement',      F,F,F,F,F,F],
  ['site_contractor', 'expediting',       F,F,F,F,F,F],
  ['site_contractor', 'vdrl',             F,F,F,F,F,F],
  ['site_contractor', 'logistics',        F,F,F,F,F,F],
  ['site_contractor', 'material_control', T,F,F,F,F,T],
  ['site_contractor', 'traceability',     T,F,F,F,F,T],
  ['site_contractor', 'document_inbox',   T,F,F,F,F,T],
  ['site_contractor', 'audit',            F,F,F,F,F,F],
  ['site_contractor', 'admin',            F,F,F,F,F,F],

  // ── viewer: read-only across core modules ───────────────
  ['viewer', 'dashboard',        T,F,F,F,F,F],
  ['viewer', 'procurement',      T,F,F,F,F,F],
  ['viewer', 'expediting',       T,F,F,F,F,F],
  ['viewer', 'vdrl',             T,F,F,F,F,F],
  ['viewer', 'logistics',        T,F,F,F,F,F],
  ['viewer', 'material_control', T,F,F,F,F,F],
  ['viewer', 'traceability',     T,F,F,F,F,F],
  ['viewer', 'document_inbox',   T,F,F,F,F,F],
  ['viewer', 'audit',            F,F,F,F,F,F],
  ['viewer', 'admin',            F,F,F,F,F,F],

  // ── ceo: read-only across ALL modules, all projects ─────
  // No WBS scoping — CEO sees the full portfolio.
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

  // ── director: same as CEO ────────────────────────────────
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

  // ── project_director: read-only, WBS scoped ─────────────
  // Dashboard is not WBS-scoped (portfolio overview is always visible).
  // All operational modules are scoped to assigned projects.
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

  // ── project_manager: view+create+edit on operational modules, WBS scoped
  // Can create and edit in Procurement, Expediting, VDRL, Logistics.
  // View-only on Material Control, Traceability, Document Inbox, Audit.
  // No admin access. No delete anywhere.
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

async function seed() {
  try {
    const [[{ count }]] = await db.query('SELECT COUNT(*) AS count FROM role_permissions')
    if (count > 0) {
      console.log(`[seed] role_permissions already has ${count} rows — skipping`)
      process.exit(0)
    }

    const rows = PERMISSIONS.map(
      ([role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped]) =>
        [role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, true]
    )

    await db.query(
      `INSERT INTO role_permissions
         (role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, is_default)
       VALUES ?`,
      [rows]
    )

    console.log(`[seed] Inserted ${rows.length} role_permissions rows`)
    process.exit(0)
  } catch (err) {
    console.error('[seed] Failed:', err.message)
    process.exit(1)
  }
}

seed()
