// ─── MIGRATE: Q4 containerised packaging (additive) ───────────────────────────
// Builds on Q2 nested packaging (scn_packages.parent_package_id). Shipment-only —
// containers die at receipt (no warehouse_stock ref), like Q2 hierarchy.
//
//   container_types        — admin-seeded ISO reference table (display-only dims).
//   scn_packages          += container_type_id (FK), container_no, seal_no  (all nullable)
//
// A container = a scn_packages row with container_type_id set (top-level, holds
// sub-packages, never items). The typed-hierarchy guards live in the create txn
// (Q4.2), not here. container_no/seal_no are populated post-packing (Q4.3); the
// seal field is governed (set-once + audited re-seal) IN THE ROUTE, not the schema.
//
// NO container_seal_audit table (TC ruling): seal changes reuse audit_log
// (action='seal_changed', reason in reason_detail) via an IN-TRANSACTION,
// FAILURE-PROPAGATING write — the audit_log BEFORE-INSERT trigger auto-hashes it
// (verified: 214/214 rows hashed), so seal history is tamper-evident in the one chain.
//
// Additive, nullable, NO backfill. Capability-detected by the app (Q2/Q3 pattern) so
// code-before-migration degrades gracefully.
//
// REVERSE (documented):
//   ALTER TABLE scn_packages DROP FOREIGN KEY fk_scnpkg_ctype,
//     DROP COLUMN container_type_id, DROP COLUMN container_no, DROP COLUMN seal_no;
//   DROP TABLE IF EXISTS container_types;
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-containers.js   (then delete server/.env.admin)
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

// ── ISO container reference seed (display-only nominal dims; admin-maintainable). ──
// Dims in mm, weights in kg, capacity in m³. Flat-racks/open-tops: capacity is the
// nominal internal box (approximate — they're open; reference only). Values are the
// standard nominal ISO figures; admin can refine.
const ISO_TYPES = [
  // code, description, outerL,outerW,outerH, innerL,innerW,innerH, tare, cap_m3, max_payload
  ['20DC', "20' Dry (Standard)",      6058, 2438, 2591, 5898, 2352, 2393, 2230, 33.2, 28230],
  ['40DC', "40' Dry (Standard)",     12192, 2438, 2591, 12032, 2352, 2393, 3750, 67.7, 26730],
  ['40HC', "40' High Cube",          12192, 2438, 2896, 12032, 2352, 2698, 3940, 76.4, 26540],
  ['20OT', "20' Open Top",            6058, 2438, 2591, 5898, 2352, 2348, 2350, 32.5, 28130],
  ['40OT', "40' Open Top",           12192, 2438, 2591, 12032, 2352, 2348, 3850, 66.4, 26630],
  ['20FR', "20' Flat Rack",           6058, 2438, 2591, 5698, 2230, 2233, 2900, null, 30100],
  ['40FR', "40' Flat Rack",          12192, 2438, 2591, 12080, 2438, 2103, 5000, null, 40000],
  ['20RF', "20' Reefer",              6058, 2438, 2591, 5455, 2290, 2244, 3000, 28.3, 27480],
  ['40RF', "40' Reefer (High Cube)", 12192, 2438, 2896, 11207, 2290, 2500, 4800, 59.3, 25680],
]

async function run() {
  console.log('\nMigrating: Q4 containerised packaging…\n')

  // 1) container_types reference table
  console.log(' container_types:')
  await db.query(`CREATE TABLE IF NOT EXISTS container_types (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    code             VARCHAR(20) NOT NULL UNIQUE,
    description      VARCHAR(100) NOT NULL,
    outer_length_mm  DECIMAL(10,2) NULL,
    outer_width_mm   DECIMAL(10,2) NULL,
    outer_height_mm  DECIMAL(10,2) NULL,
    inner_length_mm  DECIMAL(10,2) NULL,
    inner_width_mm   DECIMAL(10,2) NULL,
    inner_height_mm  DECIMAL(10,2) NULL,
    tare_weight_kg   DECIMAL(10,2) NULL,
    capacity_m3      DECIMAL(10,3) NULL,
    max_payload_kg   DECIMAL(10,2) NULL,
    is_active        TINYINT(1) NOT NULL DEFAULT 1,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`)
  console.log('  ✓ container_types table ready')

  // Seed (idempotent — ON DUPLICATE KEY refreshes spec on re-run).
  for (const t of ISO_TYPES) {
    await db.query(
      `INSERT INTO container_types
         (code, description, outer_length_mm, outer_width_mm, outer_height_mm,
          inner_length_mm, inner_width_mm, inner_height_mm, tare_weight_kg, capacity_m3, max_payload_kg)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         description=VALUES(description),
         outer_length_mm=VALUES(outer_length_mm), outer_width_mm=VALUES(outer_width_mm), outer_height_mm=VALUES(outer_height_mm),
         inner_length_mm=VALUES(inner_length_mm), inner_width_mm=VALUES(inner_width_mm), inner_height_mm=VALUES(inner_height_mm),
         tare_weight_kg=VALUES(tare_weight_kg), capacity_m3=VALUES(capacity_m3), max_payload_kg=VALUES(max_payload_kg)`,
      t)
  }
  console.log(`  ✓ seeded ${ISO_TYPES.length} ISO container types`)

  // 2) scn_packages additions (all nullable, additive)
  console.log(' scn_packages:')
  await addColumn('scn_packages', 'container_type_id', 'container_type_id INT NULL AFTER parent_package_id')
  await addColumn('scn_packages', 'container_no',      'container_no VARCHAR(50) NULL AFTER container_type_id')
  await addColumn('scn_packages', 'seal_no',           'seal_no VARCHAR(50) NULL AFTER container_no')
  if (await fkExists('fk_scnpkg_ctype')) console.log('  • fk_scnpkg_ctype present — skip')
  else { await db.query('ALTER TABLE scn_packages ADD CONSTRAINT fk_scnpkg_ctype FOREIGN KEY (container_type_id) REFERENCES container_types(id) ON DELETE RESTRICT'); console.log('  ✓ fk_scnpkg_ctype (ON DELETE RESTRICT)') }
  if (await indexExists('scn_packages', 'idx_scnpkg_ctype')) console.log('  • idx_scnpkg_ctype present — skip')
  else { try { await db.query('CREATE INDEX idx_scnpkg_ctype ON scn_packages(container_type_id)'); console.log('  ✓ idx_scnpkg_ctype') } catch (e) { console.log('  • idx skipped (FK auto-index?):', e.message) } }

  // 3) Grants — app reads container_types (FK check on insert needs SELECT); new
  //    scn_packages columns inherit the table grant. (No seal-audit table — audit_log reused.)
  const appUser = process.env.DB_USER || 'qmat_app'
  await db.query(`GRANT SELECT ON \`${process.env.DB_NAME}\`.\`container_types\` TO '${appUser}'@'%'`)
  await db.query('FLUSH PRIVILEGES')
  console.log(`  ✓ granted SELECT on container_types to ${appUser}@%`)

  // Verify
  console.log('\n Verify:')
  const [[ct]] = await db.query('SELECT COUNT(*) AS n FROM container_types')
  console.log('  container_types rows:', ct.n)
  for (const c of ['container_type_id', 'container_no', 'seal_no']) {
    console.log(`  scn_packages.${c}: ${(await columnExists('scn_packages', c)) ? 'present' : 'MISSING'}`)
  }
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
