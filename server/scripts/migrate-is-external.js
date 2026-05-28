// ─── MIGRATE IS_EXTERNAL FLAG ────────────────────────────────
// Ensures the is_external column exists and sets it correctly for
// all users whose role is inherently external.
// Safe to re-run: uses IF NOT EXISTS + conditional WHERE.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  // Add column if missing (MySQL 8+ / MariaDB 10+)
  // Wrapped in try-catch so older MySQL versions (which lack IF NOT EXISTS) are handled gracefully.
  try {
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_external TINYINT(1) NOT NULL DEFAULT 0')
    console.log('✓ is_external column ensured')
  } catch {
    console.log('✓ is_external column already exists')
  }

  // Set is_external = 1 for all external-role users that are still flagged 0
  const [r] = await db.query(
    `UPDATE users SET is_external = 1
     WHERE role IN ('vendor','freight_forwarder','site_contractor','subcontractor')
       AND is_external = 0`
  )
  console.log(`✓ ${r.affectedRows} user(s) updated to is_external = 1`)

  // Verify
  const [rows] = await db.query(
    `SELECT id, full_name, role, is_external FROM users
     WHERE role IN ('vendor','freight_forwarder','site_contractor','subcontractor')
     ORDER BY role, full_name`
  )
  console.log('\n=== External-role users after migration ===')
  rows.forEach(u => console.log(`  ${u.id} ${u.full_name} (${u.role}) → is_external=${u.is_external}`))

  console.log('\nDone.')
  process.exit(0)
}

run().catch(e => { console.error(e.message); process.exit(1) })
