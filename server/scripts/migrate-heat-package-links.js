// ─── MIGRATE: Heat / Mill-Cert → Package links (Pass 3a, additive) ────────────
// SCN-side provenance linking (3a). Lets a declared heat optionally reference the package
// it's in, and a mill-cert document optionally reference a package and/or a heat. Mirrors
// the EXISTING optional-link pattern (scn_heats.po_line_id). Additive, nullable, NO backfill.
// Does NOT touch receipt_lines / warehouse_stock / stock-receipting (that's 3b).
//
//   scn_heats      += package_id  INT NULL  FK→scn_packages(id) ON DELETE SET NULL  + index
//   scn_documents  += package_id  INT NULL  FK→scn_packages(id) ON DELETE SET NULL  + index
//                  += heat_id     INT NULL  FK→scn_heats(id)    ON DELETE SET NULL  + index
//   scn_documents.document_type enum += 'Mill Test Certificate'
//
// ON DELETE SET NULL everywhere: deleting a package/heat must not delete the heat/cert
// record — the link simply lapses. App capability-detects the new columns (deploy-tolerant).
//
// REVERSE (documented):
//   ALTER TABLE scn_heats DROP FOREIGN KEY fk_scnheats_pkg, DROP COLUMN package_id;
//   ALTER TABLE scn_documents
//     DROP FOREIGN KEY fk_scndocs_pkg, DROP FOREIGN KEY fk_scndocs_heat,
//     DROP COLUMN heat_id, DROP COLUMN package_id;
//   -- removing the enum value is only safe once no rows use 'Mill Test Certificate':
//   ALTER TABLE scn_documents MODIFY document_type ENUM(<original list>) NOT NULL;
//
// DDL — qmat_app has no DDL, run as QCO_admin. Creds from gitignored server/.env.admin
// (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-heat-package-links.js   (then delete server/.env.admin)
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
async function columnType(table, column) {
  const [[r]] = await db.query(
    `SELECT column_type AS t FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r ? r.t : ''
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
async function addFk(table, name, ddl) {
  if (await fkExists(name)) { console.log(`  • ${name} present — skip`); return }
  await db.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${ddl}`)
  console.log(`  ✓ ${name}`)
}
async function addIndex(table, name, col) {
  if (await indexExists(table, name)) { console.log(`  • ${name} present — skip`); return }
  try { await db.query(`CREATE INDEX ${name} ON ${table}(${col})`); console.log(`  ✓ ${name}`) }
  catch (e) { console.log(`  • ${name} skipped (FK auto-index?):`, e.message) }
}

async function run() {
  console.log('\nMigrating: Heat / Mill-Cert → Package links (3a)…\n')

  // 1) scn_heats.package_id
  console.log(' scn_heats:')
  await addColumn('scn_heats', 'package_id', 'package_id INT NULL AFTER po_line_id')
  await addFk('scn_heats', 'fk_scnheats_pkg', 'FOREIGN KEY (package_id) REFERENCES scn_packages(id) ON DELETE SET NULL')
  await addIndex('scn_heats', 'idx_scnheats_pkg', 'package_id')

  // 2) scn_documents.package_id + heat_id
  console.log(' scn_documents:')
  await addColumn('scn_documents', 'package_id', 'package_id INT NULL AFTER scn_id')
  await addColumn('scn_documents', 'heat_id', 'heat_id INT NULL AFTER package_id')
  await addFk('scn_documents', 'fk_scndocs_pkg', 'FOREIGN KEY (package_id) REFERENCES scn_packages(id) ON DELETE SET NULL')
  await addFk('scn_documents', 'fk_scndocs_heat', 'FOREIGN KEY (heat_id) REFERENCES scn_heats(id) ON DELETE SET NULL')
  await addIndex('scn_documents', 'idx_scndocs_pkg', 'package_id')
  await addIndex('scn_documents', 'idx_scndocs_heat', 'heat_id')

  // 3) document_type enum += 'Mill Test Certificate' (idempotent — skip if present).
  console.log(' document_type enum:')
  const dt = await columnType('scn_documents', 'document_type')
  if (/'Mill Test Certificate'/.test(dt)) {
    console.log("  • 'Mill Test Certificate' already in enum — skip")
  } else {
    // Re-state the full current enum + the new value (NOT NULL preserved).
    await db.query(`ALTER TABLE scn_documents MODIFY document_type
      ENUM('Commercial Invoice','Packing List','Bill of Lading','Airway Bill','Certificate of Origin',
           'Insurance Certificate','Dangerous Goods Declaration','Customs Entry','Other','Proof of Custody',
           'Mill Test Certificate') NOT NULL`)
    console.log("  ✓ 'Mill Test Certificate' added to document_type enum")
  }

  console.log('\n Verify:')
  console.log('  scn_heats.package_id:', (await columnExists('scn_heats', 'package_id')) ? 'present' : 'MISSING')
  console.log('  scn_documents.package_id:', (await columnExists('scn_documents', 'package_id')) ? 'present' : 'MISSING')
  console.log('  scn_documents.heat_id:', (await columnExists('scn_documents', 'heat_id')) ? 'present' : 'MISSING')
  console.log('  document_type enum:', await columnType('scn_documents', 'document_type'))
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
