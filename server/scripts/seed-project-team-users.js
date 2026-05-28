// ─── SEED PROJECT TEAM DUMMY USERS ───────────────────────────
// Adds 4 project-team users (is_external=0, company != 'QCO Group').
// Safe to re-run: uses INSERT IGNORE so duplicate emails are skipped.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

// bcrypt hash for "password"
const PW = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'

const USERS = [
  {
    email:          'james.oconnor@pilbaragas.com.au',
    full_name:      "James O'Connor",
    role:           'project_manager',
    company:        'Pilbara Gas Co',
    phone:          '+61 400 200 001',
    contract_start: '2024-01-01',
    is_external:    0,
  },
  {
    email:          'sarah.lim@huntervalley.com.au',
    full_name:      'Sarah Lim',
    role:           'project_director',
    company:        'Hunter Valley Energy',
    phone:          '+61 400 200 002',
    contract_start: '2024-06-01',
    is_external:    0,
  },
  {
    email:          'david.nguyen@ordriver.com.au',
    full_name:      'David Nguyen',
    role:           'viewer',
    company:        'Ord River Authority',
    phone:          '+61 400 200 003',
    contract_start: '2023-01-01',
    is_external:    0,
  },
  {
    email:          'michelle.park@porthedland.com.au',
    full_name:      'Michelle Park',
    role:           'project_manager',
    company:        'Port Hedland LNG',
    phone:          '+61 400 200 004',
    contract_start: '2025-01-01',
    is_external:    0,
  },
]

async function run() {
  let inserted = 0
  let skipped  = 0

  for (const u of USERS) {
    const [r] = await db.query(
      `INSERT IGNORE INTO users
         (email, full_name, password_hash, role, company, phone, contract_start, is_external, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [u.email, u.full_name, PW, u.role, u.company, u.phone, u.contract_start, u.is_external]
    )
    if (r.affectedRows > 0) {
      console.log(`✓ Inserted: ${u.full_name} (${u.role}) — ${u.company}`)
      inserted++
    } else {
      console.log(`  Skipped (already exists): ${u.email}`)
      skipped++
    }
  }

  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped.`)

  const [rows] = await db.query(
    `SELECT id, full_name, role, company, is_external FROM users
     WHERE company != 'QCO Group' AND is_external = 0 ORDER BY company, full_name`
  )
  console.log('\n=== Project Team users (is_external=0, company != QCO Group) ===')
  rows.forEach(u => console.log(`  ${u.id} ${u.full_name} (${u.role}) — ${u.company}`))

  process.exit(0)
}

run().catch(e => { console.error(e.message); process.exit(1) })
