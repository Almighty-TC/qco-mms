// ─── MIGRATE FMR LINE-LEVEL APPROVAL ──────────────────────────
// Run once: node server/scripts/migrate-fmr-line-approval.js
// Additive & idempotent. Adds per-line approval columns + the
// 'partially_approved' status to both fmr_lines.line_status and
// fmr_requests.status, then backfills qty_approved on already-
// decided lines. Preserves all existing data.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function columnExists(table, column) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r.n > 0
}

async function run() {
  console.log('\nMigrating FMR to per-line approval…\n')

  // ── New per-line approval columns ───────────────────────────
  if (!(await columnExists('fmr_lines', 'qty_approved'))) {
    await db.query(`ALTER TABLE fmr_lines ADD COLUMN qty_approved DECIMAL(15,4) NULL AFTER qty_issued`)
    console.log('  ✓ fmr_lines.qty_approved')
  } else console.log('  • fmr_lines.qty_approved present')

  if (!(await columnExists('fmr_lines', 'approval_reason'))) {
    await db.query(`ALTER TABLE fmr_lines ADD COLUMN approval_reason VARCHAR(500) NULL AFTER line_status`)
    console.log('  ✓ fmr_lines.approval_reason')
  } else console.log('  • fmr_lines.approval_reason present')

  if (!(await columnExists('fmr_lines', 'approved_by'))) {
    await db.query(`ALTER TABLE fmr_lines ADD COLUMN approved_by INT NULL AFTER approval_reason`)
    console.log('  ✓ fmr_lines.approved_by')
  } else console.log('  • fmr_lines.approved_by present')

  if (!(await columnExists('fmr_lines', 'approved_date'))) {
    await db.query(`ALTER TABLE fmr_lines ADD COLUMN approved_date DATETIME NULL AFTER approved_by`)
    console.log('  ✓ fmr_lines.approved_date')
  } else console.log('  • fmr_lines.approved_date present')

  // ── Add 'partially_approved' to both status enums ───────────
  // MODIFY must list every existing member plus the new one.
  await db.query(
    `ALTER TABLE fmr_lines MODIFY COLUMN line_status
     ENUM('pending','approved','partially_approved','partial_issued','issued','rejected')
     NOT NULL DEFAULT 'pending'`)
  console.log('  ✓ fmr_lines.line_status enum + partially_approved')

  await db.query(
    `ALTER TABLE fmr_requests MODIFY COLUMN status
     ENUM('pending_approval','approved','partially_approved','partial_issued','issued','rejected','cancelled')
     DEFAULT 'pending_approval'`)
  console.log('  ✓ fmr_requests.status enum + partially_approved')

  // ── Backfill qty_approved on already-decided lines ──────────
  const [r1] = await db.query(
    `UPDATE fmr_lines SET qty_approved = qty_requested
     WHERE line_status IN ('approved','issued') AND qty_approved IS NULL`)
  const [r2] = await db.query(
    `UPDATE fmr_lines SET qty_approved = qty_issued
     WHERE line_status = 'partial_issued' AND qty_approved IS NULL`)
  const [r3] = await db.query(
    `UPDATE fmr_lines SET qty_approved = 0
     WHERE line_status = 'rejected' AND qty_approved IS NULL`)
  console.log(`  ✓ backfilled qty_approved (approved/issued: ${r1.affectedRows}, partial: ${r2.affectedRows}, rejected: ${r3.affectedRows})`)

  console.log('\nDone.\n')
  process.exit(0)
}

run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
