// ─── MIGRATE: receipt_lines heat columns (Heat/Lot Phase 2a) ──
// Run once: node server/scripts/migrate-receipt-heat.js
// Additive & idempotent. Records the heat chosen at receipting onto each
// receipt line, plus the off-list exception (a heat not on the SCN's declared
// list, allowed WITH a mandatory reason + flag). Dedicated columns — NOT reusing
// discrepancy_notes (qty/damage discrepancy is a different concept).
// Reversible: drop the 3 columns.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function columnExists(table, column) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r.n > 0
}

async function run() {
  console.log('\nMigrating receipt_lines heat columns…\n')
  for (const [col, ddl] of [
    ['heat_number',          'ADD COLUMN heat_number VARCHAR(100) NULL AFTER po_line_id'],
    ['heat_off_list',        'ADD COLUMN heat_off_list TINYINT(1) NOT NULL DEFAULT 0 AFTER heat_number'],
    ['heat_off_list_reason', 'ADD COLUMN heat_off_list_reason VARCHAR(500) NULL AFTER heat_off_list'],
  ]) {
    if (await columnExists('receipt_lines', col)) { console.log(`  • ${col} present`); continue }
    await db.query(`ALTER TABLE receipt_lines ${ddl}`)
    console.log(`  ✓ ${col}`)
  }
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
