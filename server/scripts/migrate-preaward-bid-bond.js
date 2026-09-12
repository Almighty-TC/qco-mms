// ─── MIGRATE: Pre-Award Phase 2.4 — bid_bond_provided on tender_bids ───────────
// Additive: one boolean submission-fact column so the prelim compliance check can
// include "was a bid bond provided?" — a binary yes/no already implied by the
// wireframe (its prelimReason "Bid bond not provided"). NO reference/amount column:
// neither the wireframe nor the scope doc tracks a bond number/amount, so adding one
// would be inventing unnecessarily.
//
//   bid_bond_provided tinyint(1) NOT NULL DEFAULT 0
//     — matches the house bool convention (mandatory/required are tinyint(1) NOT
//       NULL DEFAULT 0); absence = not provided; existing rows backfill to 0.
//
// No new GRANT: the endpoints' UPDATE runs under qmat_app's existing UPDATE grant on
// tender_bids. Capability-detected (idempotent), safe to re-run.
//
// REVERSE (documented):
//   ALTER TABLE tender_bids DROP COLUMN bid_bond_provided;
//
// DDL — qmat_app has NO ALTER on tender_bids (verified: only SELECT/INSERT/UPDATE/
// DELETE), so run as QCO_admin. Creds from the gitignored server/.env.admin
// (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-preaward-bid-bond.js   (then delete server/.env.admin)
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
require('dotenv').config({ path: path.join(__dirname, '../.env.admin') }) // admin creds (override)
const mysql = require('mysql2/promise')

if (!process.env.DB_ADMIN_PASSWORD) {
  console.error('No DB_ADMIN_PASSWORD — create server/.env.admin (supply-and-remove). Aborting.')
  process.exit(1)
}

const db = mysql.createPool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin', password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2,
})

async function columnExists(table, column) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r.n > 0
}

async function run() {
  console.log('\nPre-Award Phase 2.4 — bid_bond_provided on tender_bids…\n')

  if (await columnExists('tender_bids', 'bid_bond_provided')) console.log('  • bid_bond_provided present — skip')
  else {
    await db.query('ALTER TABLE tender_bids ADD COLUMN bid_bond_provided tinyint(1) NOT NULL DEFAULT 0 AFTER comm_doc_count')
    console.log('  ✓ bid_bond_provided added (tinyint(1) NOT NULL DEFAULT 0)')
  }

  console.log('\n Verify:')
  const [r] = await db.query(
    `SELECT column_type ct, is_nullable nn, column_default cd FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'tender_bids' AND column_name = 'bid_bond_provided'`)
  console.log(`  bid_bond_provided: ${r.length ? r[0].ct + ' | nullable=' + r[0].nn + ' | default=' + r[0].cd : 'MISSING'}`)
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
