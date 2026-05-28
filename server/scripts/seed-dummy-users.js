// ─── SEED DUMMY USERS ────────────────────────────────────────
// Run once: node server/scripts/seed-dummy-users.js
// Inserts one user per role that currently has no representative,
// plus a second user for expeditor and warehouse.
// Safe to re-run: INSERT IGNORE skips existing emails.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  // ── Same bcrypt hash used by all existing seed users ────────
  // Hash of "password" — bcrypt cost 10 (Laravel default test hash)
  const hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'

  const users = [
    // ── New roles (no existing users) ─────────────────────────
    ['david.chen@qcogroup.com.au',    hash, 'David Chen',   'ceo',                'QCO Group', '+61 400 000 001'],
    ['rachel.white@qcogroup.com.au',  hash, 'Rachel White', 'director',           'QCO Group', '+61 400 000 002'],
    ['paul.harris@qcogroup.com.au',   hash, 'Paul Harris',  'project_director',   'QCO Group', '+61 400 000 003'],
    ['kate.nguyen@qcogroup.com.au',   hash, 'Kate Nguyen',  'project_manager',    'QCO Group', '+61 400 000 004'],
    ['ben.smith@qcogroup.com.au',     hash, 'Ben Smith',    'procurement_officer','QCO Group', '+61 400 000 005'],
    ['tony.hall@qcogroup.com.au',     hash, 'Tony Hall',    'logistics_manager',  'QCO Group', '+61 400 000 006'],
    ['claire.wong@qcogroup.com.au',   hash, 'Claire Wong',  'viewer',             'QCO Group', '+61 400 000 007'],
    // ── Second user for existing roles ────────────────────────
    ['mark.jones@qcogroup.com.au',    hash, 'Mark Jones',   'expeditor',          'QCO Group', '+61 400 000 008'],
    ['peter.brown@qcogroup.com.au',   hash, 'Peter Brown',  'warehouse',          'QCO Group', '+61 400 000 009'],
  ]

  const [result] = await db.query(
    `INSERT IGNORE INTO users (email, password_hash, full_name, role, company, phone, is_active)
     VALUES ?`,
    [users.map(u => [...u, 1])]
  )

  console.log(`\n[seed-dummy-users] ${result.affectedRows} user(s) inserted, ${result.warningCount} skipped (already exist).\n`)
  process.exit(0)
}

run().catch(err => {
  console.error('[seed-dummy-users] Failed:', err.message)
  process.exit(1)
})
