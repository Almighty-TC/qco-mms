// ─── MIGRATE: Reports saved views (report_saved_views) ───────
// Net-new, optional table backing the Reports module's "saved views" feature. The
// route degrades gracefully without it (lists return empty; create returns 503), so
// this can be run any time. Additive & idempotent (CREATE TABLE IF NOT EXISTS).
// Reversible:  DROP TABLE report_saved_views;
//
// DDL + GRANT run as the OWNER/DDL account (QCO_admin) — the runtime user qmat_app
// has no DDL/GRANT. Supply admin creds out-of-band (never committed):
//   DB_ADMIN_USER=QCO_admin DB_ADMIN_PASSWORD=… node server/scripts/migrate-report-views.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mysql = require('mysql2/promise')

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin',
  password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 2,
  multipleStatements: true,
})

const DDL = `CREATE TABLE IF NOT EXISTS report_saved_views (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  dataset_id VARCHAR(64) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rsv_owner (user_id, project_id),
  KEY idx_rsv_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`

// Least-privilege grant for the runtime app user (matches the project convention).
const APP_USER = process.env.DB_USER || 'qmat_app'
const GRANT = `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${process.env.DB_NAME}\`.report_saved_views TO '${APP_USER}'@'%';`

;(async () => {
  const conn = await db.getConnection()
  try {
    await conn.query(DDL)
    console.log('✓ report_saved_views ready (CREATE TABLE IF NOT EXISTS)')
    try {
      await conn.query(GRANT)
      await conn.query('FLUSH PRIVILEGES;')
      console.log(`✓ granted SELECT/INSERT/UPDATE/DELETE to ${APP_USER}`)
    } catch (g) {
      console.warn('⚠ grant step skipped/failed (may already be covered):', g.message)
    }
    const [[r]] = await conn.query('SELECT COUNT(*) n FROM report_saved_views')
    console.log(`✓ row count: ${r.n}`)
  } catch (e) {
    console.error('✗ migration failed:', e.message)
    process.exitCode = 1
  } finally {
    conn.release(); await db.end()
  }
})()
