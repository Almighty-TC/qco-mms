// ─── MIGRATE: scn_packages.parent_package_id (Q2 nested packaging) ────────────
// Adds a nullable self-FK so a package can nest under a parent (container →
// sub-packages). SHIPMENT-ONLY: structure is not carried into warehouse_stock
// (no warehouse_stock.package_id) — it dies at receipt by design.
//
// Additive + reversible, NO backfill (every existing package stays top-level:
// parent_package_id = NULL).
//   Reverse: ALTER TABLE scn_packages DROP FOREIGN KEY fk_scnpkg_parent,
//            DROP COLUMN parent_package_id;
//
// ON DELETE RESTRICT — a parent package cannot be deleted while it still has
// children (a container can't be pulled out from under its sub-packages).
//   ⚠ CONFLICT TO RESOLVE IN Q2.2/Q2.3 (flagged, not fixed here): the Logistics
//   delete-package route does a bare `DELETE FROM scn_packages WHERE id=?`
//   (server/routes/logistics.js:698). Deleting a CONTAINER with children will now
//   throw ER_ROW_IS_REFERENCED_2 instead of a clean message — that route must
//   guard (block with 409 "remove sub-packages first", or delete children first).
//   Leaf deletes are unaffected (scn_package_lines FK already ON DELETE CASCADE).
//
// GRANT: none needed — qmat_app already holds SELECT/INSERT/UPDATE/DELETE on
// scn_packages (column grants inherit the table grant).
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD):
//   node server/scripts/migrate-scn-package-hierarchy.js
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
require('dotenv').config({ path: path.join(__dirname, '../.env.admin') }) // admin creds (override)
const mysql = require('mysql2/promise')

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
     WHERE table_schema = DATABASE() AND table_name = 'scn_packages'
       AND constraint_type = 'FOREIGN KEY' AND constraint_name = ?`, [name])
  return r.n > 0
}

async function run() {
  console.log('\nMigrating: scn_packages.parent_package_id (nested packaging)…\n')

  if (await columnExists('scn_packages', 'parent_package_id')) {
    console.log('  • parent_package_id present — skipping column add')
  } else {
    await db.query('ALTER TABLE scn_packages ADD COLUMN parent_package_id INT NULL AFTER scn_id')
    console.log('  ✓ parent_package_id INT NULL added')
  }

  if (await fkExists('fk_scnpkg_parent')) {
    console.log('  • fk_scnpkg_parent present — skipping FK add')
  } else {
    await db.query(
      `ALTER TABLE scn_packages
         ADD CONSTRAINT fk_scnpkg_parent FOREIGN KEY (parent_package_id)
         REFERENCES scn_packages(id) ON DELETE RESTRICT`)
    console.log('  ✓ fk_scnpkg_parent (self-FK, ON DELETE RESTRICT) added')
  }

  // index the FK column for child lookups (MySQL auto-creates one for the FK, but
  // be explicit & idempotent-safe via IF NOT EXISTS where supported).
  const [idx] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name='scn_packages' AND index_name='idx_scnpkg_parent'`)
  if (idx[0].n === 0) {
    try { await db.query('CREATE INDEX idx_scnpkg_parent ON scn_packages(parent_package_id)'); console.log('  ✓ idx_scnpkg_parent created') }
    catch (e) { console.log('  • index skipped (FK auto-index likely present):', e.message) }
  } else {
    console.log('  • idx_scnpkg_parent present — skipping')
  }

  // Verify
  const [cols] = await db.query('SHOW COLUMNS FROM scn_packages')
  console.log('\n  scn_packages columns:', cols.map(c => c.Field).join(', '))
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
