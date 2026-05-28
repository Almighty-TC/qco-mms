// ─── MIGRATE AUDIT LOG TABLE ─────────────────────────────────
// Run once: node server/scripts/migrate-audit-log.js
// Creates the audit_log table for persistent admin action logging.
// Safe to re-run: CREATE TABLE IF NOT EXISTS.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  console.log('\nCreating audit_log table…\n')

  await db.query(`CREATE TABLE IF NOT EXISTS audit_log (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL,
    action     VARCHAR(100) NOT NULL,
    resource   VARCHAR(500) NOT NULL,
    ip         VARCHAR(64),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id  (user_id),
    INDEX idx_action   (action),
    INDEX idx_created  (created_at)
  )`)

  console.log('  ✓ audit_log\n\nDone.\n')
  process.exit(0)
}

run().catch(err => {
  console.error('\nMigration failed:', err.message)
  process.exit(1)
})
