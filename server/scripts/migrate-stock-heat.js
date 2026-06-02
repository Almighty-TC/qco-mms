// ─── MIGRATE: warehouse_stock heat_number (Heat/Lot Phase 0) ──
// Run once: node server/scripts/migrate-stock-heat.js
// Additive & idempotent. Adds a nullable per-holding heat_number so heat can be
// surfaced on the Stock Register + stock-take (read-through). No source populates
// it yet — that arrives in P1 (scn_heats) / P2 (receipting entry); existing rows
// stay NULL. Reversible: ALTER TABLE warehouse_stock DROP COLUMN heat_number.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function columnExists(table, column) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r.n > 0
}

async function run() {
  console.log('\nMigrating warehouse_stock heat_number…\n')
  if (await columnExists('warehouse_stock', 'heat_number')) {
    console.log('  • heat_number present — nothing to do')
  } else {
    await db.query(`ALTER TABLE warehouse_stock ADD COLUMN heat_number VARCHAR(100) NULL AFTER vendor_name`)
    console.log('  ✓ heat_number VARCHAR(100) NULL')
  }
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
