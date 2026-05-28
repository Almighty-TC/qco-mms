// ─── MIGRATE MISSING TABLES ─────────────────────────────────
// Run once: node server/scripts/migrate-missing-tables.js
// Creates all tables required by the admin module and adds any
// missing columns to the users table. Safe to re-run (IF NOT EXISTS).
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  console.log('\nCreating missing tables and columns…\n')

  // ── user_wbs_access ──────────────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS user_wbs_access (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    project_id INT NOT NULL,
    wbs_code   VARCHAR(50) NOT NULL,
    created_by INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  )`)
  console.log('  ✓ user_wbs_access')

  // ── role_permissions ─────────────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS role_permissions (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    role       VARCHAR(50) NOT NULL,
    module     VARCHAR(50) NOT NULL,
    can_view   BOOLEAN DEFAULT FALSE,
    can_create BOOLEAN DEFAULT FALSE,
    can_edit   BOOLEAN DEFAULT FALSE,
    can_approve BOOLEAN DEFAULT FALSE,
    can_delete BOOLEAN DEFAULT FALSE,
    wbs_scoped BOOLEAN DEFAULT FALSE,
    is_default BOOLEAN DEFAULT TRUE
  )`)
  console.log('  ✓ role_permissions')

  // ── user_permission_overrides ────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS user_permission_overrides (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    module        VARCHAR(50) NOT NULL,
    can_view      BOOLEAN,
    can_create    BOOLEAN,
    can_edit      BOOLEAN,
    can_approve   BOOLEAN,
    can_delete    BOOLEAN,
    overridden_by INT NOT NULL,
    overridden_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`)
  console.log('  ✓ user_permission_overrides')

  // ── notifications ────────────────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS notifications (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    type       VARCHAR(50) NOT NULL,
    message    TEXT NOT NULL,
    is_read    BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`)
  console.log('  ✓ notifications')

  // ── delegated_permissions ────────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS delegated_permissions (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    granted_to INT NOT NULL,
    granted_by INT NOT NULL,
    permission VARCHAR(100) NOT NULL,
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (granted_to) REFERENCES users(id),
    FOREIGN KEY (granted_by) REFERENCES users(id)
  )`)
  console.log('  ✓ delegated_permissions')

  // ── password_history ─────────────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS password_history (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`)
  console.log('  ✓ password_history')

  // ── users columns ────────────────────────────────────────
  // ADD COLUMN IF NOT EXISTS is not supported on all MySQL versions,
  // so we check INFORMATION_SCHEMA first and skip existing columns.
  const DB_NAME = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'qmat'
  const [[{ db_name }]] = await db.query(`SELECT DATABASE() AS db_name`)
  const database = db_name || DB_NAME

  const userCols = [
    ['staff_id',               'VARCHAR(50)'],
    ['phone',                  'VARCHAR(20)'],
    ['contract_start',         'DATE'],
    ['contract_end',           'DATE'],
    ['is_external',            'BOOLEAN DEFAULT FALSE'],
    ['approved_by',            'INT'],
    ['approved_at',            'DATETIME'],
    ['second_approved_by',     'INT'],
    ['second_approved_at',     'DATETIME'],
    ['force_password_change',  'BOOLEAN DEFAULT FALSE'],
    ['password_expires_at',    'DATETIME'],
    ['last_login',             'DATETIME'],
    ['emergency_override',         'BOOLEAN DEFAULT FALSE'],
    ['emergency_override_reason',  'TEXT'],
  ]

  for (const [col, def] of userCols) {
    const [[exists]] = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
      [database, col]
    )
    if (exists) {
      console.log(`  – users.${col} (already exists, skipped)`)
    } else {
      await db.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`)
      console.log(`  ✓ users.${col}`)
    }
  }

  console.log('\nDone.\n')
  process.exit(0)
}

run().catch(err => {
  console.error('\nMigration failed:', err.message)
  process.exit(1)
})
