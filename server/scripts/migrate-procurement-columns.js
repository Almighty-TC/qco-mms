// ─── PROCUREMENT COLUMNS MIGRATION ───────────────────────────
// Idempotent: safe to run multiple times.
// Adds columns needed by the Procurement module that were absent
// from the initial purchase_orders schema.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

let added = 0
let skipped = 0

async function columnExists(table, column) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  )
  return rows.length > 0
}

async function addColumn(table, column, definition, afterCol = null) {
  if (await columnExists(table, column)) {
    console.log(`  skip  ${table}.${column} (exists)`)
    skipped++
    return
  }
  const after = afterCol ? ` AFTER \`${afterCol}\`` : ''
  await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}${after}`)
  console.log(`  + col  ${table}.${column}`)
  added++
}

async function fkExists(table, constraintName) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [table, constraintName]
  )
  return rows.length > 0
}

async function addFK(table, constraintName, definition) {
  if (await fkExists(table, constraintName)) {
    console.log(`  skip  fk ${constraintName} (exists)`)
    skipped++
    return
  }
  await db.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraintName}\` ${definition}`)
  console.log(`  + fk   ${constraintName}`)
  added++
}

async function run() {
  console.log('\n[purchase_orders — procurement columns]')

  // ── PO display name (separate from po_number reference) ──
  await addColumn('purchase_orders', 'po_name',
    'VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'po_number')

  // ── WBS code at PO header level ──
  await addColumn('purchase_orders', 'wbs_code',
    'VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'po_name')

  // ── Group/category (Mechanical, Electrical, etc.) ──
  await addColumn('purchase_orders', 'group_category',
    "ENUM('mechanical','electrical','instrumentation','civil','piping','structural') DEFAULT NULL", 'wbs_code')

  // ── Required on Site date at PO header level ──
  await addColumn('purchase_orders', 'ros_date',
    'DATE DEFAULT NULL', 'group_category')

  // ── Owner/expeditor — FK to users ──
  await addColumn('purchase_orders', 'owner_id',
    'INT DEFAULT NULL', 'ros_date')
  await addFK('purchase_orders', 'fk_po_owner_id',
    'FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`)')

  // ── Critical path star ──
  await addColumn('purchase_orders', 'is_critical_path',
    'TINYINT(1) DEFAULT 0', 'owner_id')

  // ── Approval lock flag ──
  await addColumn('purchase_orders', 'is_locked',
    'TINYINT(1) DEFAULT 0', 'is_critical_path')

  // ── Step 3 milestone dates ──
  await addColumn('purchase_orders', 'milestone_po_date',
    'DATE DEFAULT NULL', 'is_locked')
  await addColumn('purchase_orders', 'milestone_fat_date',
    'DATE DEFAULT NULL', 'milestone_po_date')
  await addColumn('purchase_orders', 'milestone_esd_date',
    'DATE DEFAULT NULL', 'milestone_fat_date')
  await addColumn('purchase_orders', 'milestone_eta_date',
    'DATE DEFAULT NULL', 'milestone_esd_date')
  await addColumn('purchase_orders', 'milestone_ros_date',
    'DATE DEFAULT NULL', 'milestone_eta_date')

  console.log(`\n${'─'.repeat(52)}`)
  console.log(`Done. ${added} applied, ${skipped} already correct.`)
  process.exit(0)
}

run().catch(e => { console.error('\nFATAL:', e.message); process.exit(1) })
