// ─── MIGRATE: Pre-Award Phase 2.3 — criteria-lock state on tender_packages ─────
// Additive: two nullable columns capturing the criteria-finalize (lock) event, so
// "criteria locked" is an explicit first-class per-tender state decoupled from the
// stage machine. Locked <=> criteria_locked_at IS NOT NULL (the timestamp's presence
// IS the lock, mirroring sealed <=> unsealed_at IS NULL on tender_bid_commercial).
//
//   criteria_locked_at  datetime NULL  — when the criteria set was finalized (SUM=100 gate)
//   criteria_locked_by  int      NULL  — FK users(id): who finalized it
//
// COHERENT-PAIR CHECK (chk_tp_crit_lock_pair) — identical shape to
// chk_commercial_unseal_pair: both NULL (unlocked) or both NON-NULL (locked), never
// a half-set state.
//
// Type note: datetime (NOT timestamp) to match unsealed_at / the house convention.
// No new GRANT: the lock endpoint's UPDATE runs under qmat_app's existing UPDATE
// grant on tender_packages. Capability-detected (idempotent), safe to re-run.
//
// REVERSE (documented):
//   ALTER TABLE tender_packages DROP CHECK chk_tp_crit_lock_pair;
//   ALTER TABLE tender_packages DROP FOREIGN KEY fk_tp_crit_locked_by;
//   ALTER TABLE tender_packages DROP COLUMN criteria_locked_by, DROP COLUMN criteria_locked_at;
//
// DDL — qmat_app has NO ALTER on tender_packages (verified: only SELECT/INSERT/
// UPDATE/DELETE), so run as QCO_admin. Creds from the gitignored server/.env.admin
// (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-preaward-criteria-lock.js   (then delete server/.env.admin)
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

// ─── CAPABILITY-DETECT (idempotency — mirrors migrate-preaward-tenders.js) ─────
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
async function checkExists(name) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.check_constraints
     WHERE constraint_schema = DATABASE() AND constraint_name = ?`, [name])
  return r.n > 0
}

async function run() {
  console.log('\nPre-Award Phase 2.3 — criteria-lock columns on tender_packages…\n')

  if (await columnExists('tender_packages', 'criteria_locked_at')) console.log('  • criteria_locked_at present — skip')
  else { await db.query('ALTER TABLE tender_packages ADD COLUMN criteria_locked_at datetime DEFAULT NULL'); console.log('  ✓ criteria_locked_at added (datetime NULL)') }

  if (await columnExists('tender_packages', 'criteria_locked_by')) console.log('  • criteria_locked_by present — skip')
  else { await db.query('ALTER TABLE tender_packages ADD COLUMN criteria_locked_by int DEFAULT NULL AFTER criteria_locked_at'); console.log('  ✓ criteria_locked_by added (int NULL)') }

  if (await indexExists('tender_packages', 'fk_tp_crit_locked_by')) console.log('  • fk_tp_crit_locked_by index present — skip')
  else { try { await db.query('CREATE INDEX fk_tp_crit_locked_by ON tender_packages(criteria_locked_by)'); console.log('  ✓ index fk_tp_crit_locked_by') } catch (e) { console.log('  • index skipped (FK auto-index?):', e.message) } }

  if (await fkExists('fk_tp_crit_locked_by')) console.log('  • fk_tp_crit_locked_by FK present — skip')
  else { await db.query('ALTER TABLE tender_packages ADD CONSTRAINT fk_tp_crit_locked_by FOREIGN KEY (criteria_locked_by) REFERENCES users (id)'); console.log('  ✓ fk_tp_crit_locked_by -> users(id)') }

  if (await checkExists('chk_tp_crit_lock_pair')) console.log('  • chk_tp_crit_lock_pair present — skip')
  else {
    await db.query(`ALTER TABLE tender_packages ADD CONSTRAINT chk_tp_crit_lock_pair
      CHECK ((criteria_locked_at IS NULL AND criteria_locked_by IS NULL)
          OR (criteria_locked_at IS NOT NULL AND criteria_locked_by IS NOT NULL))`)
    console.log('  ✓ chk_tp_crit_lock_pair (both-null or both-set)')
  }

  // verify
  console.log('\n Verify:')
  console.log(`  criteria_locked_at present: ${(await columnExists('tender_packages','criteria_locked_at')) ? 'YES' : 'MISSING'}`)
  console.log(`  criteria_locked_by present: ${(await columnExists('tender_packages','criteria_locked_by')) ? 'YES' : 'MISSING'}`)
  console.log(`  fk_tp_crit_locked_by:       ${(await fkExists('fk_tp_crit_locked_by')) ? 'YES' : 'MISSING'}`)
  console.log(`  chk_tp_crit_lock_pair:      ${(await checkExists('chk_tp_crit_lock_pair')) ? 'YES' : 'MISSING'}`)
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
