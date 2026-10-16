// ─── MIGRATE: Phase 2 vendor scoping — users.supplier_id ──────────────────────
// Links an external user to the supplier it acts for (set in the admin screen; the
// phase 2 gate looks it up per request and scopes vendor routes to that supplier):
//   users.supplier_id int NULL AFTER company
//   INDEX idx_users_supplier (supplier_id)
//   CONSTRAINT fk_users_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
//     ON DELETE SET NULL
//
// Additive and nullable: existing rows get NULL and the app ignores the column until
// phase 2 code reads it, so it may run before the backend deploy. Pre-checks before any
// change: suppliers.id is a signed INT (the foreign key needs the same type), users and
// suppliers are both InnoDB, and an existing users.supplier_id is a signed INT; otherwise
// the script aborts and changes nothing.
//
// No new GRANT: qmat_app already has SELECT, INSERT, UPDATE, DELETE on users, so the
// admin screen can set supplier_id. Capability-detected (idempotent), safe to re-run.
// --dry-run runs the pre-checks, prints each statement it would run and changes nothing.
//
// REVERSE (documented):
//   ALTER TABLE users DROP FOREIGN KEY fk_users_supplier;
//   ALTER TABLE users DROP INDEX idx_users_supplier;
//   ALTER TABLE users DROP COLUMN supplier_id;
//
// DDL — qmat_app has NO ALTER on users, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-user-supplier.js --dry-run
//   node server/scripts/migrate-user-supplier.js  (then delete server/.env.admin)
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
require('dotenv').config({ path: path.join(__dirname, '../.env.admin') }) // admin creds (override)
const mysql = require('mysql2/promise')

const DRY = process.argv.includes('--dry-run')

if (!process.env.DB_ADMIN_PASSWORD) {
  console.error('No DB_ADMIN_PASSWORD — create server/.env.admin (supply-and-remove). Aborting.')
  process.exit(1)
}

const db = mysql.createPool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin', password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2,
})

const SIGNED_INT = /^int(\(\d+\))?$/i   // 'int' (MySQL 8) or 'int(11)'; not unsigned, not bigint

async function columnExists(table, column) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r.n > 0
}
async function indexExists(table, name) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`, [table, name])
  return r.n > 0
}
async function foreignKeyExists(table, name) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?`, [table, name])
  return r.n > 0
}
async function supplierIdColumn() {
  const [r] = await db.query(
    `SELECT column_type ct, is_nullable nn FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'supplier_id'`)
  return r[0] || null
}

// One step: skip when present; with --dry-run print the statement; otherwise run it.
async function step(present, label, sql, done) {
  if (present) { console.log(`  • ${label} present — skip`); return }
  if (DRY) { console.log(`  would run: ${sql}`); return }
  await db.query(sql)
  console.log(`  ✓ ${done}`)
}

async function run() {
  console.log(`\nPhase 2 — users.supplier_id${DRY ? ' (dry run: nothing is changed)' : ''}…\n`)

  // Pre-checks (read-only).
  const [[s]] = await db.query(
    `SELECT column_type ct FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'suppliers' AND column_name = 'id'`)
  const [eng] = await db.query(
    `SELECT table_name t, engine e FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name IN ('users', 'suppliers')`)
  const engineOf = t => (eng.find(r => r.t === t) || {}).e
  const existing = await supplierIdColumn()
  console.log(`  suppliers.id ${s ? s.ct : 'MISSING'}; users ${engineOf('users') || 'MISSING'}, suppliers ${engineOf('suppliers') || 'MISSING'}${existing ? `; users.supplier_id ${existing.ct}` : ''}`)
  if (!s || !SIGNED_INT.test(s.ct)) {
    console.error('  Pre-check failed: suppliers.id is not a signed INT. Aborting; nothing changed.')
    process.exit(1)
  }
  if (engineOf('users') !== 'InnoDB' || engineOf('suppliers') !== 'InnoDB') {
    console.error('  Pre-check failed: users and suppliers must both be InnoDB. Aborting; nothing changed.')
    process.exit(1)
  }
  if (existing && !SIGNED_INT.test(existing.ct)) {
    console.error(`  Pre-check failed: users.supplier_id exists as ${existing.ct}, not a signed INT. Aborting; nothing changed.`)
    process.exit(1)
  }

  await step(await columnExists('users', 'supplier_id'), 'supplier_id',
    'ALTER TABLE users ADD COLUMN supplier_id INT NULL AFTER company',
    'supplier_id added (int NULL, after company)')
  await step(await indexExists('users', 'idx_users_supplier'), 'idx_users_supplier',
    'ALTER TABLE users ADD INDEX idx_users_supplier (supplier_id)',
    'idx_users_supplier (supplier_id)')
  await step(await foreignKeyExists('users', 'fk_users_supplier'), 'fk_users_supplier',
    'ALTER TABLE users ADD CONSTRAINT fk_users_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL',
    'fk_users_supplier → suppliers(id) ON DELETE SET NULL')

  console.log('\n Verify:')
  const col = await supplierIdColumn()
  const idx = await indexExists('users', 'idx_users_supplier')
  const fk = await foreignKeyExists('users', 'fk_users_supplier')
  const absent = DRY ? 'absent (dry run)' : 'MISSING'
  console.log(`  supplier_id: ${col ? col.ct + ' | nullable=' + col.nn : absent}`)
  console.log(`  idx_users_supplier: ${idx ? 'present' : absent}`)
  console.log(`  fk_users_supplier: ${fk ? 'present' : absent}`)
  console.log('\nDone.\n')
  process.exit(DRY || (col && idx && fk) ? 0 : 1)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
