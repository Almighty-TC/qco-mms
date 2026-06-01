// ─── MIGRATE: receipt_lines (Receipting Phase 1) ──────────────
// Run once: node server/scripts/migrate-receipt-lines.js
// Additive & idempotent (IF NOT EXISTS). Stores the per-line received
// quantities + discrepancy detail the receipting wizard already collects
// but previously discarded. Reversible: DROP TABLE receipt_lines.
//
// Phase 1 scope only — NO damaged/quarantine columns, no remainder logic.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  console.log('\nCreating receipt_lines…\n')
  await db.query(`CREATE TABLE IF NOT EXISTS receipt_lines (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    project_id       INT NOT NULL,
    scn_id           INT NOT NULL,
    scn_ref          VARCHAR(50) NULL,
    po_line_id       INT NULL,
    description      VARCHAR(500) NULL,
    expected_qty     DECIMAL(15,4) NULL,
    received_qty     DECIMAL(15,4) NOT NULL,
    uom              VARCHAR(20) NULL,
    discrepancy_type  VARCHAR(50) NULL,
    discrepancy_notes TEXT NULL,
    received_by      INT NULL,
    received_date    DATE NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_rl_scn (scn_id),
    KEY idx_rl_poline (po_line_id),
    KEY idx_rl_project (project_id)
  )`)
  console.log('  ✓ receipt_lines')
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
