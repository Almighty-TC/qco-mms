// ─── MIGRATE: child / off-PO items as real tracked stock (Q3, Option a) ───────
// Additive parallel branch — children travel via additional_item_id; the existing
// po_line_id readers (Q1 receipting load, Guard B, create write path, D2/D3) are
// untouched. Three ALTERs, all nullable, NO backfill.
//
//   scn_additional_items  += commodity_id, equipment_tag, tag_number,
//                            wbs_code_snapshot, ros_date
//        (a child's inherited IDENTITY + WBS snapshot; ros_date is user-supplied.
//         po_lines has NO item_code — identity is commodity/tag; WBS is the snapshot.)
//   warehouse_stock       += additional_item_id INT NULL + FK + index
//   receipt_lines         += additional_item_id INT NULL + FK + index
//
// FK ON DELETE SET NULL: stock/receipt rows OUTLIVE the SCN — if an SCN (and its
// scn_additional_items) is admin-deleted, the holding/receipt stays but the link
// nulls (never cascade-delete real stock).
//
// REVERSE (documented):
//   ALTER TABLE warehouse_stock DROP FOREIGN KEY fk_ws_additem, DROP COLUMN additional_item_id;
//   ALTER TABLE receipt_lines  DROP FOREIGN KEY fk_rl_additem, DROP COLUMN additional_item_id;
//   ALTER TABLE scn_additional_items
//     DROP COLUMN commodity_id, DROP COLUMN equipment_tag, DROP COLUMN tag_number,
//     DROP COLUMN wbs_code_snapshot, DROP COLUMN ros_date;
//
// GRANTS: none needed — qmat_app already holds the table grants (new columns inherit);
// the new FKs reference scn_additional_items, on which qmat_app has SELECT (FK check OK).
//
// DEPLOY TOLERANCE: the app capability-detects these columns (like Q2's parent_package_id)
// so code-before-migration degrades gracefully (child branch simply stays off until live).
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-child-stock.js   (then delete server/.env.admin)
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
  console.log('\nMigrating: child/off-PO items → real tracked stock (Q3 option a)…\n')

  // 1) scn_additional_items — inherited identity + WBS snapshot + user ROS
  console.log(' scn_additional_items:')
  await addColumn('scn_additional_items', 'commodity_id',      'commodity_id INT NULL AFTER parent_po_line_id')
  await addColumn('scn_additional_items', 'equipment_tag',     'equipment_tag VARCHAR(100) NULL AFTER commodity_id')
  await addColumn('scn_additional_items', 'tag_number',        'tag_number VARCHAR(100) NULL AFTER equipment_tag')
  await addColumn('scn_additional_items', 'wbs_code_snapshot', 'wbs_code_snapshot VARCHAR(100) NULL AFTER tag_number')
  await addColumn('scn_additional_items', 'ros_date',          'ros_date DATE NULL AFTER wbs_code_snapshot')

  // 2) warehouse_stock — additional_item_id link
  console.log(' warehouse_stock:')
  await addColumn('warehouse_stock', 'additional_item_id', 'additional_item_id INT NULL AFTER po_line_id')
  if (await fkExists('fk_ws_additem')) console.log('  • fk_ws_additem present — skip')
  else { await db.query('ALTER TABLE warehouse_stock ADD CONSTRAINT fk_ws_additem FOREIGN KEY (additional_item_id) REFERENCES scn_additional_items(id) ON DELETE SET NULL'); console.log('  ✓ fk_ws_additem (ON DELETE SET NULL)') }
  if (await indexExists('warehouse_stock', 'idx_ws_additem')) console.log('  • idx_ws_additem present — skip')
  else { try { await db.query('CREATE INDEX idx_ws_additem ON warehouse_stock(additional_item_id)'); console.log('  ✓ idx_ws_additem') } catch (e) { console.log('  • idx skipped (FK auto-index?):', e.message) } }

  // 3) receipt_lines — additional_item_id link
  console.log(' receipt_lines:')
  await addColumn('receipt_lines', 'additional_item_id', 'additional_item_id INT NULL AFTER po_line_id')
  if (await fkExists('fk_rl_additem')) console.log('  • fk_rl_additem present — skip')
  else { await db.query('ALTER TABLE receipt_lines ADD CONSTRAINT fk_rl_additem FOREIGN KEY (additional_item_id) REFERENCES scn_additional_items(id) ON DELETE SET NULL'); console.log('  ✓ fk_rl_additem (ON DELETE SET NULL)') }
  if (await indexExists('receipt_lines', 'idx_rl_additem')) console.log('  • idx_rl_additem present — skip')
  else { try { await db.query('CREATE INDEX idx_rl_additem ON receipt_lines(additional_item_id)'); console.log('  ✓ idx_rl_additem') } catch (e) { console.log('  • idx skipped (FK auto-index?):', e.message) } }

  // Verify
  console.log('\n Verify:')
  for (const [t, c] of [['scn_additional_items', 'wbs_code_snapshot'], ['warehouse_stock', 'additional_item_id'], ['receipt_lines', 'additional_item_id']]) {
    console.log(`  ${t}.${c}: ${(await columnExists(t, c)) ? 'present' : 'MISSING'}`)
  }
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
