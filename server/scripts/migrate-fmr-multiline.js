// ─── MIGRATE FMR → MULTI-LINE ─────────────────────────────────
// Run once: node server/scripts/migrate-fmr-multiline.js
// Additive & idempotent. Adds fmr_lines, adds warehouse_id to
// fmr_requests, and migrates every existing single-item FMR into
// one header + one line (preserving refs and quantities).
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

// Header status → per-line status.
const LINE_STATUS = {
  pending_approval: 'pending', approved: 'approved', partial_issued: 'partial_issued',
  issued: 'issued', rejected: 'rejected', cancelled: 'rejected',
}

async function columnExists(table, column) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r.n > 0
}

async function run() {
  console.log('\nMigrating FMR to multi-line…\n')

  // ── fmr_lines ───────────────────────────────────────────────
  // wbs_code (string) is used rather than wbs_id to stay consistent
  // with fmr_requests / warehouse_stock, which key on WBS code.
  await db.query(`CREATE TABLE IF NOT EXISTS fmr_lines (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    fmr_id        INT NOT NULL,
    item_id       INT NULL,
    item_code     VARCHAR(100) NULL,
    item_type     ENUM('commodity','equipment') NOT NULL DEFAULT 'commodity',
    description   VARCHAR(500) NULL,
    wbs_code      VARCHAR(100) NULL,
    qty_requested DECIMAL(15,3) NOT NULL,
    qty_issued    DECIMAL(15,3) NOT NULL DEFAULT 0,
    uom           VARCHAR(20) DEFAULT 'EA',
    line_status   ENUM('pending','approved','partial_issued','issued','rejected') NOT NULL DEFAULT 'pending',
    ros_date      DATE NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_fmr_lines_fmr (fmr_id),
    CONSTRAINT fk_fmr_lines_fmr FOREIGN KEY (fmr_id) REFERENCES fmr_requests(id)
  )`)
  console.log('  ✓ fmr_lines table')

  // ── fmr_requests.warehouse_id (one warehouse per FMR) ────────
  if (!(await columnExists('fmr_requests', 'warehouse_id'))) {
    await db.query(`ALTER TABLE fmr_requests ADD COLUMN warehouse_id INT NULL AFTER project_id`)
    console.log('  ✓ added fmr_requests.warehouse_id')
  } else {
    console.log('  • fmr_requests.warehouse_id already present')
  }

  // ── Migrate existing single-item FMRs into 1 header + 1 line ──
  const [fmrs] = await db.query(
    `SELECT f.* FROM fmr_requests f
     WHERE NOT EXISTS (SELECT 1 FROM fmr_lines l WHERE l.fmr_id = f.id)`)
  console.log(`  • ${fmrs.length} FMR(s) need a line backfilled`)

  for (const f of fmrs) {
    // Classify item_type from equipment_list (tag match).
    const [[eq]] = await db.query(
      `SELECT 1 AS hit FROM equipment_list WHERE project_id=? AND tag=? LIMIT 1`,
      [f.project_id, f.item_code])
    const itemType = eq ? 'equipment' : 'commodity'

    // Find the warehouse this item came from (match code, prefer same WBS).
    const [stockRows] = await db.query(
      `SELECT id, warehouse_id FROM warehouse_stock
       WHERE project_id=? AND item_code=?
       ORDER BY (wbs_code = ?) DESC LIMIT 1`,
      [f.project_id, f.item_code, f.wbs_code])
    const stock = stockRows[0]

    await db.query(
      `INSERT INTO fmr_lines (fmr_id, item_id, item_code, item_type, description, wbs_code,
         qty_requested, qty_issued, uom, line_status, ros_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [f.id, stock?.id || null, f.item_code, itemType, f.description, f.wbs_code,
       f.qty_requested, f.qty_issued || 0, f.uom || 'EA', LINE_STATUS[f.status] || 'pending', f.required_date])

    if (stock?.warehouse_id && !f.warehouse_id) {
      await db.query(`UPDATE fmr_requests SET warehouse_id=? WHERE id=?`, [stock.warehouse_id, f.id])
    }
    console.log(`    ✓ ${f.fmr_ref} → 1 line (${itemType}${stock ? `, WH ${stock.warehouse_id}` : ', no stock match'})`)
  }

  console.log('\nDone.\n')
  process.exit(0)
}

run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
