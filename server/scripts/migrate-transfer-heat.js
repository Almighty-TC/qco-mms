// ─── MIGRATE: warehouse_transfers heat_number (Heat/Lot Phase 3) ──
// Run once: node server/scripts/migrate-transfer-heat.js
// Additive & idempotent. Snapshots the source holding's heat onto the transfer
// record at create time, so "which heat moved" survives a whole-holding move
// (which deletes the source row — a later stock_id join couldn't recover it).
// The destination holding also carries heat (warehouse_stock.heat_number, P0).
// Reversible: ALTER TABLE warehouse_transfers DROP COLUMN heat_number.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function columnExists(table, column) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r.n > 0
}

async function run() {
  console.log('\nMigrating warehouse_transfers heat_number…\n')
  if (await columnExists('warehouse_transfers', 'heat_number')) {
    console.log('  • heat_number present — nothing to do')
  } else {
    await db.query(`ALTER TABLE warehouse_transfers ADD COLUMN heat_number VARCHAR(100) NULL AFTER wbs_code`)
    console.log('  ✓ heat_number VARCHAR(100) NULL')
  }
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
