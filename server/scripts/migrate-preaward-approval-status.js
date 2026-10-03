// ─── MIGRATE: Pre-Award Phase 2.7 — approval_status on tender_packages ─────────
// Denormalized COARSE summary of the tender approval chain, for fast reads:
//   approval_status varchar(20) NOT NULL DEFAULT 'pending'
//     CHECK (approval_status IN ('pending','approved','rejected'))
//
// 'pending' covers BOTH "not started" and "mid-escalation" — the which-level
// detail is derived from the AUTHORITATIVE tender_approvals rows (approval_level
// filled at the moment of each actual approval, exactly like po_approvals). There
// is deliberately NO 'escalated'/'pending_level2' value: the coarse column would
// otherwise duplicate row-derivable state; the intermediate is read from the rows.
//
// tender_approvals itself needs NO change — it was built in Phase 1.4 verbatim to
// po_approvals (approval_level tinyint unsigned NOT NULL DEFAULT 1; actioned_at
// nullable — the field stamped at decision time). approval_level is NOT nullable in
// po_approvals, so leaving it NOT NULL keeps the mirror exact.
//
// No new GRANT: the approve route's UPDATE runs under qmat_app's existing UPDATE
// grant on tender_packages. Capability-detected (idempotent), safe to re-run.
//
// REVERSE (documented):
//   ALTER TABLE tender_packages DROP CHECK chk_tp_approval_status;
//   ALTER TABLE tender_packages DROP COLUMN approval_status;
//
// DDL — qmat_app has NO ALTER on tender_packages, so run as QCO_admin. Creds from
// the gitignored server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD),
// SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-preaward-approval-status.js  (then delete server/.env.admin)
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
async function checkExists(name) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.check_constraints
     WHERE constraint_schema = DATABASE() AND constraint_name = ?`, [name])
  return r.n > 0
}

async function run() {
  console.log('\nPre-Award Phase 2.7 — approval_status on tender_packages…\n')

  if (await columnExists('tender_packages', 'approval_status')) console.log('  • approval_status present — skip')
  else {
    await db.query("ALTER TABLE tender_packages ADD COLUMN approval_status varchar(20) NOT NULL DEFAULT 'pending' AFTER status")
    console.log("  ✓ approval_status added (varchar(20) NOT NULL DEFAULT 'pending')")
  }

  if (await checkExists('chk_tp_approval_status')) console.log('  • chk_tp_approval_status present — skip')
  else {
    await db.query("ALTER TABLE tender_packages ADD CONSTRAINT chk_tp_approval_status CHECK (approval_status IN ('pending','approved','rejected'))")
    console.log('  ✓ chk_tp_approval_status (pending/approved/rejected)')
  }

  console.log('\n Verify:')
  const [r] = await db.query(
    `SELECT column_type ct, is_nullable nn, column_default cd FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'tender_packages' AND column_name = 'approval_status'`)
  console.log(`  approval_status: ${r.length ? r[0].ct + ' | nullable=' + r[0].nn + ' | default=' + r[0].cd : 'MISSING'}`)
  console.log(`  chk_tp_approval_status: ${(await checkExists('chk_tp_approval_status')) ? 'present' : 'MISSING'}`)
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
