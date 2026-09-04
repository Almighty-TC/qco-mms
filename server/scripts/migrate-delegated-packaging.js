// ─── MIGRATE: Forwarder-Delegated Packaging (additive) ────────────────────────
// Lets an expeditor delegate the PACKING of an SCN to a freight forwarder, who then
// creates/edits packages + sets seals on THAT SCN only (authorization predicate built
// in the route carve-out, D2). Tracking + hand-back state live on shipment_control_notes.
//
//   shipment_control_notes += packed_by_type        ENUM('internal','vendor','forwarder') NOT NULL DEFAULT 'internal'
//                          += packaging_delegated_to INT NULL  FK→users(id) ON DELETE SET NULL  + index
//                          += packaging_status       ENUM('pending','complete') NULL
//                          += packaging_completed_at DATETIME NULL
//
// packaging_delegated_to is THE authorization grant: a forwarder may write packages on an
// SCN iff this column = their user id (enforced in the route, not the schema). 'vendor' is
// a label only — the expeditor enters vendor-packed packages; vendors never log in, so a
// vendor-packed SCN has packaging_delegated_to = NULL (no external write access). ON DELETE
// SET NULL keeps the SCN if the delegated user is removed (delegation simply lapses).
//
// Additive, nullable (except packed_by_type which has a safe default), NO backfill.
// Capability-detected by the app (Q2/Q3/Q4 pattern) so code-before-migration degrades.
//
// REVERSE (documented):
//   ALTER TABLE shipment_control_notes
//     DROP FOREIGN KEY fk_scn_pkg_delegate,
//     DROP COLUMN packaging_completed_at,
//     DROP COLUMN packaging_status,
//     DROP COLUMN packaging_delegated_to,
//     DROP COLUMN packed_by_type;
//   (the index idx_scn_pkg_delegate drops with the column / FK.)
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-delegated-packaging.js   (then delete server/.env.admin)
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
require('dotenv').config({ path: path.join(__dirname, '../.env.admin') }) // admin creds (override)
const mysql = require('mysql2/promise')

if (!process.env.DB_ADMIN_PASSWORD) {
  console.error('No DB_ADMIN_PASSWORD — create server/.env.admin (supply-and-remove). Aborting (not self-applying).')
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
async function fkExists(name) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.table_constraints
     WHERE table_schema = DATABASE() AND constraint_type = 'FOREIGN KEY' AND constraint_name = ?`, [name])
  return r.n > 0
}
async function indexExists(table, name) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`, [table, name])
  return r.n > 0
}
async function addColumn(table, column, ddl) {
  if (await columnExists(table, column)) { console.log(`  • ${table}.${column} present — skip`); return }
  await db.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  console.log(`  ✓ ${table}.${column} added`)
}

async function run() {
  console.log('\nMigrating: Forwarder-Delegated Packaging…\n')
  const T = 'shipment_control_notes'

  console.log(' shipment_control_notes:')
  await addColumn(T, 'packed_by_type',
    "packed_by_type ENUM('internal','vendor','forwarder') NOT NULL DEFAULT 'internal' AFTER forwarder_user_id")
  await addColumn(T, 'packaging_delegated_to', 'packaging_delegated_to INT NULL AFTER packed_by_type')
  await addColumn(T, 'packaging_status',       "packaging_status ENUM('pending','complete') NULL AFTER packaging_delegated_to")
  await addColumn(T, 'packaging_completed_at', 'packaging_completed_at DATETIME NULL AFTER packaging_status')

  // FK → users(id), ON DELETE SET NULL (keep the SCN if the delegated user is removed).
  if (await fkExists('fk_scn_pkg_delegate')) console.log('  • fk_scn_pkg_delegate present — skip')
  else {
    await db.query(`ALTER TABLE ${T} ADD CONSTRAINT fk_scn_pkg_delegate
      FOREIGN KEY (packaging_delegated_to) REFERENCES users(id) ON DELETE SET NULL`)
    console.log('  ✓ fk_scn_pkg_delegate (ON DELETE SET NULL)')
  }
  // Index for the authorization lookup (WHERE id=? then read this col; index aids the
  // forwarder "delegated to me" register filter too).
  if (await indexExists(T, 'idx_scn_pkg_delegate')) console.log('  • idx_scn_pkg_delegate present — skip')
  else {
    try { await db.query(`CREATE INDEX idx_scn_pkg_delegate ON ${T}(packaging_delegated_to)`); console.log('  ✓ idx_scn_pkg_delegate') }
    catch (e) { console.log('  • idx skipped (FK auto-index?):', e.message) }
  }

  // qmat_app inherits the table grants on shipment_control_notes — no new grant needed.

  console.log('\n Verify:')
  for (const c of ['packed_by_type', 'packaging_delegated_to', 'packaging_status', 'packaging_completed_at']) {
    console.log(`  ${T}.${c}: ${(await columnExists(T, c)) ? 'present' : 'MISSING'}`)
  }
  console.log(`  fk_scn_pkg_delegate: ${(await fkExists('fk_scn_pkg_delegate')) ? 'present' : 'MISSING'}`)
  console.log(`  idx_scn_pkg_delegate: ${(await indexExists(T, 'idx_scn_pkg_delegate')) ? 'present' : 'MISSING'}`)
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
