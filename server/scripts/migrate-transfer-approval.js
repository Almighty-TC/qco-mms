// ─── MIGRATE: warehouse_transfers approval gate (Transfers stock-link) ─
// Run once: node server/scripts/migrate-transfer-approval.js
// Additive & idempotent. Adds the approval columns + 'pending_approval'/
// 'rejected' statuses so quarantine/trace_hold-sourced transfers can be
// gated (FMR-pattern reuse). Reversible: drop the 3 columns + MODIFY enum back.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function columnExists(table, column) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r.n > 0
}

async function run() {
  console.log('\nMigrating warehouse_transfers approval gate…\n')

  await db.query(`ALTER TABLE warehouse_transfers MODIFY COLUMN status
    ENUM('requested','pending_approval','in_transit','picked_up','delivered','complete','rejected')
    DEFAULT 'requested'`)
  console.log('  ✓ status enum + pending_approval, rejected')

  for (const [col, ddl] of [
    ['approved_by',     'ADD COLUMN approved_by INT NULL AFTER status'],
    ['approved_at',     'ADD COLUMN approved_at DATETIME NULL AFTER approved_by'],
    ['approval_reason', 'ADD COLUMN approval_reason VARCHAR(500) NULL AFTER approved_at'],
  ]) {
    if (await columnExists('warehouse_transfers', col)) { console.log(`  • ${col} present`); continue }
    await db.query(`ALTER TABLE warehouse_transfers ${ddl}`)
    console.log(`  ✓ ${col}`)
  }

  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
