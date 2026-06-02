// ─── MIGRATE: fmr_issue_lines ledger (Heat/Lot Phase 4a-i) ────
// Run once: node server/scripts/migrate-fmr-issue.js
// Additive & idempotent. The consumption ledger: one row per holding decremented
// when an FMR is issued. This is the missing "stock leaves the system" record —
// FMR-out previously approved but never decremented stock.
// heat_number is NULL in P4a-i (populated in P4b: heat selection on issue).
// fmr_requests.status / fmr_lines.line_status already include partial_issued/
// issued (dormant), and qty_issued columns already exist — so no ALTER there.
// Reversible: DROP TABLE fmr_issue_lines.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function tableExists(table) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`, [table])
  return r.n > 0
}

async function run() {
  console.log('\nMigrating fmr_issue_lines…\n')
  if (await tableExists('fmr_issue_lines')) {
    console.log('  • fmr_issue_lines present — nothing to do')
  } else {
    await db.query(`
      CREATE TABLE fmr_issue_lines (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        fmr_id        INT NOT NULL,
        fmr_line_id   INT NOT NULL,
        stock_id      INT,
        qty           DECIMAL(15,4) NOT NULL,
        heat_number   VARCHAR(100) NULL,
        location_code VARCHAR(100) NULL,
        item_code     VARCHAR(100),
        wbs_code      VARCHAR(100),
        issued_by     INT NULL,
        issued_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_fil_fmr (fmr_id),
        KEY idx_fil_line (fmr_line_id),
        KEY idx_fil_stock (stock_id)
      )`)
    console.log('  ✓ fmr_issue_lines created')
  }
  // Belt-and-braces: confirm the dormant enum/qty_issued columns are present.
  const [[st]] = await db.query(
    `SELECT COLUMN_TYPE ct FROM information_schema.columns
     WHERE table_schema=DATABASE() AND table_name='fmr_requests' AND column_name='status'`)
  console.log('  • fmr_requests.status includes issued/partial_issued: ' +
    (/partial_issued/.test(st.ct) && /'issued'/.test(st.ct)))
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
