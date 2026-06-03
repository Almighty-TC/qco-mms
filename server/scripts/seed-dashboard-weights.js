// ─── SEED: default health weights + save-gate (Dashboard C1) ──
// Seeds an EPC-sensible default weight set for every existing project so the
// Health Score works before anyone configures it (the endpoint also falls back to
// these defaults in code if a project has no rows). Idempotent (upsert; won't
// stomp a project that's already been tuned — INSERT IGNORE on the unique key).
//
// Save-gate: reweighting changes the headline number everyone sees, so it's gated
// to dashboard.can_edit. admin already holds it; this grants it to project_manager
// and project_director too. DML only — runs as the app user.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

const DEFAULTS = { procurement: 25, expediting: 25, logistics: 20, materials: 15, traceability: 15 } // = 100

async function run() {
  console.log('\nSeeding dashboard health weights…\n')
  const [projects] = await db.query('SELECT id FROM projects')
  let n = 0
  for (const p of projects) {
    for (const [module_key, weight] of Object.entries(DEFAULTS)) {
      // INSERT IGNORE: seed defaults but never overwrite a project that's been tuned.
      const [r] = await db.query(
        'INSERT IGNORE INTO project_health_weights (project_id, module_key, weight) VALUES (?,?,?)',
        [p.id, module_key, weight])
      n += r.affectedRows
    }
  }
  console.log(`  ✓ seeded ${n} default weight rows across ${projects.length} projects (existing untouched)`)

  // ── Save-gate: dashboard.can_edit for project_manager + project_director ──
  for (const role of ['project_manager', 'project_director']) {
    await db.query(
      `INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, is_default)
       VALUES (?, 'dashboard', 1, 0, 1, 0, 0, 0, 1)
       ON DUPLICATE KEY UPDATE can_edit=1`, [role])
  }
  console.log("  ✓ dashboard.can_edit granted to project_manager + project_director (admin already had it)")
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Seed failed:', e); process.exit(1) })
