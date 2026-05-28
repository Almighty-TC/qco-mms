// ─── MIGRATE PROJECTS COLUMNS ───────────────────────────────────
// Adds client, start_date, end_date columns to the projects table.
// Safe to re-run: uses IF NOT EXISTS / SHOW COLUMNS guard.
const db = require('../db')

async function migrate() {
  const [[{ count: hasClient }]]   = await db.query(`SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'projects' AND column_name = 'client'`)
  const [[{ count: hasStart }]]    = await db.query(`SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'projects' AND column_name = 'start_date'`)
  const [[{ count: hasEnd }]]      = await db.query(`SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'projects' AND column_name = 'end_date'`)

  if (!hasClient) {
    await db.query(`ALTER TABLE projects ADD COLUMN client VARCHAR(200) DEFAULT NULL AFTER rag`)
    console.log('✓ Added client column')
  } else {
    console.log('  client already exists')
  }

  if (!hasStart) {
    await db.query(`ALTER TABLE projects ADD COLUMN start_date DATE DEFAULT NULL AFTER client`)
    console.log('✓ Added start_date column')
  } else {
    console.log('  start_date already exists')
  }

  if (!hasEnd) {
    await db.query(`ALTER TABLE projects ADD COLUMN end_date DATE DEFAULT NULL AFTER start_date`)
    console.log('✓ Added end_date column')
  } else {
    console.log('  end_date already exists')
  }

  console.log('Migration complete.')
  process.exit(0)
}

migrate().catch(e => { console.error(e.message); process.exit(1) })
