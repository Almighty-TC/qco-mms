// C-b — RBAC matrix: new roles + split modules + corrections. Idempotent.
// Run from server/: node ../scripts/rbac_matrix_seed.cjs [apply]
//   (no arg = DRY RUN: print what WOULD change; 'apply' = run inside a transaction)
// Changes role_permissions (RBAC config). Signed via CHECKPOINT 2. Pooled conn only.
const db = require('../server/db')
const APPLY = process.argv[2] === 'apply'

// role_permissions cols: role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, is_default
// row helper: [role, module, V,C,E,A,D, wbs_scoped]
const NEW_ROLES = ['engineering_lead', 'project_control', 'project_controls_manager', 'auditor', 'materials_engineer']
const DELIVERY_MODULES = ['dashboard','wbs','commodity','equipment','mto','procurement','expediting','logistics','material_control','traceability','vdrl','document_inbox']
const ALL_MODULES = [...DELIVERY_MODULES, 'admin', 'audit', 'audit_review']

const rows = []
const add = (role, module, V=0,C=0,E=0,A=0,D=0,W=0) => rows.push([role, module, V,C,E,A,D,W])

// ── View baseline for the 5 new roles (can_view on delivery modules) ──
for (const r of ['engineering_lead','project_control','project_controls_manager','materials_engineer'])
  for (const m of DELIVERY_MODULES) add(r, m, 1,0,0,0,0,0)
// auditor: view on ALL modules + audit_review write
for (const m of ALL_MODULES) add('auditor', m, 1,0,0,0,0,0)

// ── New split modules: write rows (create+delete via confirmation; edits free) ──
// wbs: project_control proposes C/D; project_controls_manager confirms (can_approve)
add('admin','wbs',1,1,1,1,1,0); add('project_control','wbs',1,1,1,1,1,0); add('project_controls_manager','wbs',1,0,0,1,0,0)
add('site_contractor','wbs',1,0,0,0,0,1) // read-only, wbs_scoped
// commodity/equipment/mto: engineering_lead proposes C/E/D + confirms (person-level segregation in code)
for (const m of ['commodity','equipment','mto']) { add('admin',m,1,1,1,1,1,0); add('engineering_lead',m,1,1,1,1,1,0) }
add('project_manager','mto',1,0,0,1,0,0) // PM escalation/confirm on mto
// audit_review: auditor writes (flag/comment/review)
add('admin','audit_review',1,1,1,1,1,0); add('auditor','audit_review',1,1,1,0,0,0)

// ── NARROW `fmr` module: grants ONLY FMR-raise (POST /mc/:projectId/fmr) ──
// Closes the matrix-vs-behavior drift: contractors legitimately raise field FMRs
// (MCFMRScreen "Contractor view: raise new FMRs against assigned WBS scope").
// This is NOT material_control broadly — it does not allow transfers/receipts.
// Contractors are wbs_scoped; internal ops who raise on-site are also granted.
add('site_contractor','fmr',1,1,0,0,0,1); add('subcontractor','fmr',1,1,0,0,0,1)
for (const r of ['admin','warehouse','logistics_manager','expeditor','expediting_manager','procurement_officer','procurement_manager','project_manager','project_director'])
  add(r,'fmr',1,1,0,0,0,0)

// ── CORRECTIONS to existing matrix (the C-a over-block fix; signed) ──
// material_control: broad internal operational set may write
for (const r of ['expeditor','expediting_manager','procurement_officer','procurement_manager','project_manager','project_director'])
  add(r,'material_control',1,1,1,0,1,0)
// traceability: uploaders (supplier/expeditor) create; materials_engineer approves (segregation)
add('vendor','traceability',1,1,0,0,0,0)        // 'vendor' is the supplier role string in this system
add('expeditor','traceability',1,1,0,0,0,0)
add('materials_engineer','traceability',1,0,0,1,0,0) // technical review/approve/reject
// procurement: officer may approve POs (C-d #3) — value-threshold ceiling still enforced inline
add('procurement_officer','procurement',1,1,1,1,0,0)
// procurement: project_director approves the DIRECTOR tier of multi-level PO approval (C-d/A routing fix)
add('project_director','procurement',1,0,0,1,0,0)
// procurement: expeditor-assignment handled by MODULE-MOVE at the route (gate that route with
// requirePermission('expediting','can_edit')) — so NO procurement matrix change needed for it.
// (Reported as the chosen option; nothing to insert here.)

async function main() {
  const conn = await db.getConnection()
  try {
    // Idempotent: remove any prior rows for the roles/modules we manage, then insert.
    const managedRoles = [...NEW_ROLES]
    const correctionPairs = rows // includes corrections on existing roles/new modules
    if (APPLY) await conn.beginTransaction()

    // delete prior rows for new roles (any module) + for the new modules (any role) + the specific corrections
    if (APPLY) {
      await conn.query(`DELETE FROM role_permissions WHERE role IN (${managedRoles.map(()=>'?').join(',')})`, managedRoles)
      await conn.query(`DELETE FROM role_permissions WHERE module IN ('wbs','commodity','equipment','mto','audit_review','fmr')`)
      // corrections: remove existing rows for the corrected (role,module) pairs so re-insert is clean
      for (const [role,module] of [['expeditor','material_control'],['expediting_manager','material_control'],['procurement_officer','material_control'],['procurement_manager','material_control'],['project_manager','material_control'],['project_director','material_control'],['vendor','traceability'],['expeditor','traceability'],['materials_engineer','traceability'],['project_manager','mto'],['procurement_officer','procurement'],['project_director','procurement']])
        await conn.query('DELETE FROM role_permissions WHERE role=? AND module=?', [role, module])
    }

    // Dedupe by (role,module) — write rows are added AFTER the view-baseline, so last wins.
    const dedup = new Map()
    for (const r of rows) dedup.set(r[0] + '|' + r[1], r)
    const finalRows = [...dedup.values()]

    let inserted = 0
    for (const [role,module,V,C,E,A,D,W] of finalRows) {
      console.log(`  ${APPLY?'INSERT':'WOULD INSERT'} ${role} / ${module}  view=${V} create=${C} edit=${E} approve=${A} delete=${D} wbs_scoped=${W}`)
      if (APPLY) { await conn.query('INSERT INTO role_permissions (role,module,can_view,can_create,can_edit,can_approve,can_delete,wbs_scoped,is_default) VALUES (?,?,?,?,?,?,?,?,1)', [role,module,V,C,E,A,D,W]); inserted++ }
    }
    if (APPLY) { await conn.commit(); console.log(`\n✅ APPLIED ${inserted} rows (transactional).`) }
    else console.log(`\nDRY RUN — ${rows.length} rows would be written. Re-run with 'apply' to execute.`)
  } catch (e) { try { await conn.rollback() } catch {} console.error('ERROR:', e.message); process.exitCode = 1 }
  finally { conn.release() }
}
main().then(()=>process.exit(process.exitCode||0))
