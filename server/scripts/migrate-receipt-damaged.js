// ─── MIGRATE: receipt_lines.damaged_qty (Receipting Phase 2) ──
// Run once: node server/scripts/migrate-receipt-damaged.js
// Additive & idempotent. Captures damaged units per received line.
// Phase 2 only PERSISTS this number — good-vs-quarantine stock split is
// Phase 3. Reversible: ALTER TABLE receipt_lines DROP COLUMN damaged_qty.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function columnExists(table, column) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r.n > 0
}

async function run() {
  if (await columnExists('receipt_lines', 'damaged_qty')) {
    console.log('  • receipt_lines.damaged_qty already present')
  } else {
    await db.query(`ALTER TABLE receipt_lines ADD COLUMN damaged_qty DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER received_qty`)
    console.log('  ✓ receipt_lines.damaged_qty added')
  }
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
