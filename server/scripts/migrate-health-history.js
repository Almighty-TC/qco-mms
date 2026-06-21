// ─── MIGRATE: project_health_history (Dashboard — weekly delta) ───────────────
// Stores a CANONICAL (viewer-independent) project health score snapshot, written
// at most once/day per project by the dashboard route (snapshot-on-view). The
// "vs last week" delta = today's canonical score − the most recent snapshot ≥7
// days old. Additive & idempotent. Reversible:
//   DROP TABLE project_health_history;
//
// DDL + GRANT run as QCO_admin (qmat_app has no DDL/GRANT). Supply admin creds
// out-of-band; never committed:
//   DB_ADMIN_USER=QCO_admin DB_ADMIN_PASSWORD=… node server/scripts/migrate-health-history.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mysql = require('mysql2/promise')

const db = mysql.createPool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin', password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2,
})

async function run() {
  console.log('\nMigrating project_health_history…\n')
  // score is the canonical 0–100 health score (TINYINT UNSIGNED, like project_health_weights.weight).
  // Index (project_id, recorded_at) serves both lookups: the once/day "today" check
  // and the "most recent snapshot ≥7 days old" delta query.
  await db.query(`CREATE TABLE IF NOT EXISTS project_health_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    score TINYINT UNSIGNED NOT NULL,
    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_proj_recorded (project_id, recorded_at)
  )`)
  console.log('  ✓ table project_health_history ready')
  // Runtime needs SELECT (today-check + delta lookup) and INSERT (the daily snapshot).
  // No UPDATE/DELETE — snapshots are append-only.
  await db.query(`GRANT SELECT, INSERT ON \`${process.env.DB_NAME}\`.project_health_history TO 'qmat_app'@'%'`)
  await db.query('FLUSH PRIVILEGES')
  console.log('  ✓ qmat_app granted SELECT/INSERT')
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
