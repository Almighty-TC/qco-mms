// ─── USERS TABLE MIGRATION ──────────────────────────────────
// Run once: node server/scripts/migrate-users-columns.js
// Adds all columns introduced after the initial users table creation
// and creates supporting tables (password_history, system_settings).
// Safe to re-run: each column/table is only added if absent.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

// ─── COLUMN DEFINITIONS ─────────────────────────────────────
// Each entry: [columnName, DDL to append after ALTER TABLE users ADD COLUMN]
const USER_COLUMNS = [
  ['staff_id',                 'VARCHAR(50) NULL AFTER email'],
  ['phone',                    'VARCHAR(20) NULL AFTER staff_id'],
  ['is_external',              'TINYINT(1) NOT NULL DEFAULT 0 AFTER role'],
  ['contract_start',           'DATE NULL AFTER company'],
  ['contract_end',             'DATE NULL AFTER contract_start'],
  ['approved_by',              'INT NULL AFTER is_external'],
  ['approved_at',              'DATETIME NULL AFTER approved_by'],
  ['second_approved_by',       'INT NULL AFTER approved_at'],
  ['second_approved_at',       'DATETIME NULL AFTER second_approved_by'],
  ['last_login',               'DATETIME NULL'],
  ['force_password_change',    'TINYINT(1) NOT NULL DEFAULT 0'],
  ['password_expires_at',      'DATETIME NULL'],
  ['emergency_override',       'TINYINT(1) NOT NULL DEFAULT 0'],
  ['emergency_override_reason','TEXT NULL'],
]

// ─── EXISTING COLUMNS QUERY ──────────────────────────────────
async function getExistingColumns(dbName, tableName) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, tableName]
  )
  return new Set(rows.map(r => r.COLUMN_NAME.toLowerCase()))
}

// ─── TABLE EXISTS CHECK ──────────────────────────────────────
async function tableExists(dbName, tableName) {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`,
    [dbName, tableName]
  )
  return rows.length > 0
}

// ─── MAIN MIGRATION ──────────────────────────────────────────
async function run() {
  const dbName = process.env.DB_NAME
  if (!dbName) { console.error('DB_NAME not set in .env'); process.exit(1) }

  console.log(`\nMigrating database: ${dbName}\n`)

  // ── users table columns ──────────────────────────────────
  const existing = await getExistingColumns(dbName, 'users')
  let added = 0

  for (const [col, ddl] of USER_COLUMNS) {
    if (existing.has(col.toLowerCase())) {
      console.log(`  ✓  users.${col} already exists`)
    } else {
      await db.query(`ALTER TABLE users ADD COLUMN ${col} ${ddl}`)
      console.log(`  +  users.${col} added`)
      added++
    }
  }

  // ── password_history table ───────────────────────────────
  if (await tableExists(dbName, 'password_history')) {
    console.log(`  ✓  password_history already exists`)
  } else {
    await db.query(`
      CREATE TABLE password_history (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT NOT NULL,
        hash       VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ph_user (user_id)
      )
    `)
    console.log(`  +  password_history created`)
    added++
  }

  // ── system_settings table ────────────────────────────────
  if (await tableExists(dbName, 'system_settings')) {
    console.log(`  ✓  system_settings already exists`)
  } else {
    await db.query(`
      CREATE TABLE system_settings (
        \`key\`       VARCHAR(100) NOT NULL PRIMARY KEY,
        \`value\`     TEXT,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)
    await db.query(`
      INSERT IGNORE INTO system_settings (\`key\`, \`value\`) VALUES ('escalation_email', '')
    `)
    console.log(`  +  system_settings created with seed row`)
    added++
  }

  console.log(`\nDone — ${added} change(s) applied.\n`)
  process.exit(0)
}

run().catch(err => {
  console.error('\nMigration failed:', err.message)
  process.exit(1)
})
