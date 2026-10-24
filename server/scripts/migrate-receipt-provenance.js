// ─── MIGRATE: Receipt-side provenance + trace-back link (Pass 3b-1, SCHEMA ONLY) ──
// Records at RECEIPT time where stock came from (source package + heat), as immutable
// provenance on the append-only receipt_lines record, and a trace-back pointer on
// warehouse_stock so a stock holding can be traced to the receipt that created it.
// Stock stays heat+location keyed — provenance is NOT a live stock property; you trace
// BACK through the receipt. SCHEMA ONLY here — no code wiring (3b-2/3/4 do that).
//
//   receipt_lines    += source_scn_package_id  INT NULL  FK→scn_packages(id)  ON DELETE SET NULL  + index
//                    += scn_heat_id            INT NULL  FK→scn_heats(id)     ON DELETE SET NULL  + index
//   warehouse_stock  += receipt_line_id        INT NULL  FK→receipt_lines(id) ON DELETE SET NULL  + index
//
// All nullable, ON DELETE SET NULL (deleting a package/heat/receipt must not delete the
// receipt/stock record — the link simply lapses). Additive, NO backfill. App capability-
// detects the new columns (deploy-tolerant). Does NOT touch the FOR UPDATE locking logic.
//
// REVERSE (documented):
//   ALTER TABLE warehouse_stock DROP FOREIGN KEY fk_ws_receiptline, DROP COLUMN receipt_line_id;
//   ALTER TABLE receipt_lines
//     DROP FOREIGN KEY fk_rl_srcpkg, DROP FOREIGN KEY fk_rl_scnheat,
//     DROP COLUMN scn_heat_id, DROP COLUMN source_scn_package_id;
//
// DDL — qmat_app has no DDL, run as QCO_admin. Creds from gitignored server/.env.admin
// (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-receipt-provenance.js   (then delete server/.env.admin)
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
  console.log('\nMigrating: Receipt-side provenance + trace-back link (3b-1)…\n')

  // 1) receipt_lines += source_scn_package_id + scn_heat_id (immutable provenance at receipt)
  console.log(' receipt_lines:')
  await addColumn('receipt_lines', 'source_scn_package_id', 'source_scn_package_id INT NULL AFTER additional_item_id')
  await addColumn('receipt_lines', 'scn_heat_id', 'scn_heat_id INT NULL AFTER source_scn_package_id')
  await addFk('receipt_lines', 'fk_rl_srcpkg', 'FOREIGN KEY (source_scn_package_id) REFERENCES scn_packages(id) ON DELETE SET NULL')
  await addFk('receipt_lines', 'fk_rl_scnheat', 'FOREIGN KEY (scn_heat_id) REFERENCES scn_heats(id) ON DELETE SET NULL')
  await addIndex('receipt_lines', 'idx_rl_srcpkg', 'source_scn_package_id')
  await addIndex('receipt_lines', 'idx_rl_scnheat', 'scn_heat_id')

  // 2) warehouse_stock += receipt_line_id (the trace-back pointer)
  console.log(' warehouse_stock:')
  await addColumn('warehouse_stock', 'receipt_line_id', 'receipt_line_id INT NULL AFTER additional_item_id')
  await addFk('warehouse_stock', 'fk_ws_receiptline', 'FOREIGN KEY (receipt_line_id) REFERENCES receipt_lines(id) ON DELETE SET NULL')
  await addIndex('warehouse_stock', 'idx_ws_receiptline', 'receipt_line_id')

  // qmat_app inherits the table grants — no new grant needed.

  console.log('\n Verify:')
  console.log('  receipt_lines.source_scn_package_id:', (await columnExists('receipt_lines', 'source_scn_package_id')) ? 'present' : 'MISSING')
  console.log('  receipt_lines.scn_heat_id:', (await columnExists('receipt_lines', 'scn_heat_id')) ? 'present' : 'MISSING')
  console.log('  warehouse_stock.receipt_line_id:', (await columnExists('warehouse_stock', 'receipt_line_id')) ? 'present' : 'MISSING')
  for (const fk of ['fk_rl_srcpkg', 'fk_rl_scnheat', 'fk_ws_receiptline']) {
    console.log(`  ${fk}:`, (await fkExists(fk)) ? 'present' : 'MISSING')
  }
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
