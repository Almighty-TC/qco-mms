// ─── MIGRATE: project_health_weights (Dashboard C1) ───────────
// Per-project module weights that drive the configurable Health Score. The five
// modules' weights sum to 100 per project. Additive & idempotent. Reversible:
//   DROP TABLE project_health_weights;
//
// DDL + GRANT run as QCO_admin (qmat_app has no DDL/GRANT). Supply admin creds
// out-of-band; never committed:
//   DB_ADMIN_USER=QCO_admin DB_ADMIN_PASSWORD=… node server/scripts/migrate-dashboard-weights.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mysql = require('mysql2/promise')

const db = mysql.createPool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin', password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2,
})

async function run() {
  console.log('\nMigrating dashboard health weights…\n')
  await db.query(`CREATE TABLE IF NOT EXISTS project_health_weights (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    module_key VARCHAR(20) NOT NULL,
    weight TINYINT UNSIGNED NOT NULL,
    updated_by INT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_proj_module (project_id, module_key)
  )`)
  console.log('  ✓ table project_health_weights ready')
  await db.query(`GRANT SELECT, INSERT, UPDATE ON \`${process.env.DB_NAME}\`.project_health_weights TO 'qmat_app'@'%'`)
  await db.query('FLUSH PRIVILEGES')
  console.log('  ✓ qmat_app granted SELECT/INSERT/UPDATE')
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
