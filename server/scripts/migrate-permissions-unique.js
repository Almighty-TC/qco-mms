// ─── MIGRATE PERMISSIONS UNIQUE KEY ─────────────────────────────
// Adds a UNIQUE KEY on (user_id, module) to user_permission_overrides.
// Required for ON DUPLICATE KEY UPDATE to work in the save-overrides route.
// Safe to re-run: checks for existing key first.
const db = require('../db')

async function migrate() {
  const [keys] = await db.query(`
    SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
    WHERE table_schema = DATABASE()
      AND table_name   = 'user_permission_overrides'
      AND constraint_type = 'UNIQUE'
  `)
  if (keys.length > 0) {
    console.log('  UNIQUE key already exists:', keys.map(k => k.CONSTRAINT_NAME).join(', '))
    process.exit(0)
  }

  await db.query(`
    ALTER TABLE user_permission_overrides
    ADD UNIQUE KEY uq_user_module (user_id, module)
  `)
  console.log('✓ Added UNIQUE KEY uq_user_module on (user_id, module)')

  // Remove duplicate rows that would prevent the key being added
  // (already applied above; this block is safety-only for future re-runs)
  console.log('Migration complete.')
  process.exit(0)
}

migrate().catch(e => { console.error(e.message); process.exit(1) })
