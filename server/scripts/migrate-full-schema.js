// ─── FULL SCHEMA MIGRATION ───────────────────────────────────
// Idempotent: safe to run multiple times.
// Adds missing columns, FKs, indexes, and creates missing tables.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

let added = 0
let skipped = 0

// ── helpers ──────────────────────────────────────────────────

async function columnExists(table, column) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  )
  return rows.length > 0
}

async function indexExists(table, indexName) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  )
  return rows.length > 0
}

async function fkExists(table, constraintName) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [table, constraintName]
  )
  return rows.length > 0
}

async function tableExists(table) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
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

async function addIndex(table, indexName, definition) {
  if (await indexExists(table, indexName)) {
    console.log(`  skip  idx ${table}(${indexName}) (exists)`)
    skipped++
    return
  }
  await db.query(`ALTER TABLE \`${table}\` ADD ${definition}`)
  console.log(`  + idx  ${table} ${indexName}`)
  added++
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

async function createTable(table, ddl) {
  if (await tableExists(table)) {
    console.log(`  skip  table ${table} (exists)`)
    skipped++
    return
  }
  await db.query(ddl)
  console.log(`  + tbl  ${table}`)
  added++
}

// ── main ─────────────────────────────────────────────────────

async function run() {

  // ── 1. warehouses ──────────────────────────────────────────
  console.log('\n[warehouses]')
  await addColumn('warehouses', 'city',     'VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'state')
  await addColumn('warehouses', 'postcode', 'VARCHAR(20)  COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'city')
  await addColumn('warehouses', 'country',  'VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'postcode')
  await addFK('warehouses', 'fk_warehouses_created_by',
    'FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)')

  // ── 2. units_of_measure ────────────────────────────────────
  console.log('\n[units_of_measure]')
  await addColumn('units_of_measure', 'created_by', 'INT DEFAULT NULL', 'created_at')
  await addColumn('units_of_measure', 'updated_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', 'created_by')
  await addFK('units_of_measure', 'fk_uom_created_by',
    'FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)')

  // ── 3. acronyms ────────────────────────────────────────────
  console.log('\n[acronyms]')
  await addColumn('acronyms', 'created_by', 'INT DEFAULT NULL', 'created_at')
  await addColumn('acronyms', 'updated_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', 'created_by')
  await addFK('acronyms', 'fk_acronyms_created_by',
    'FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)')

  // ── 4. inco_terms ──────────────────────────────────────────
  console.log('\n[inco_terms]')
  await addColumn('inco_terms', 'created_by', 'INT DEFAULT NULL', 'created_at')
  await addColumn('inco_terms', 'updated_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', 'created_by')
  await addFK('inco_terms', 'fk_inco_terms_created_by',
    'FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)')

  // ── 5. suppliers ───────────────────────────────────────────
  console.log('\n[suppliers]')
  await addFK('suppliers', 'fk_suppliers_created_by',
    'FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)')

  // ── 6. notifications ───────────────────────────────────────
  console.log('\n[notifications]')
  await addColumn('notifications', 'related_entity_type',
    'VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'is_read')
  await addColumn('notifications', 'related_entity_id',
    'INT DEFAULT NULL', 'related_entity_type')

  // ── 7. audit_log ───────────────────────────────────────────
  console.log('\n[audit_log]')
  await addColumn('audit_log', 'entity_type',
    'VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'action')
  await addColumn('audit_log', 'entity_id', 'INT DEFAULT NULL', 'entity_type')
  await addColumn('audit_log', 'before_value',
    'JSON DEFAULT NULL', 'entity_id')
  await addColumn('audit_log', 'after_value',
    'JSON DEFAULT NULL', 'before_value')
  await addColumn('audit_log', 'reason_category',
    'VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'after_value')
  await addColumn('audit_log', 'reason_detail',
    'TEXT COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'reason_category')
  await addFK('audit_log', 'fk_audit_log_user_id',
    'FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)')

  // ── 8. role_permissions ────────────────────────────────────
  console.log('\n[role_permissions]')
  await addIndex('role_permissions', 'uq_role_module',
    'UNIQUE KEY `uq_role_module` (`role`, `module`)')

  // ── 9. user_wbs_access ─────────────────────────────────────
  console.log('\n[user_wbs_access]')
  await addIndex('user_wbs_access', 'uq_wbs_access',
    'UNIQUE KEY `uq_wbs_access` (`user_id`, `project_id`, `wbs_code`)')
  await addFK('user_wbs_access', 'fk_user_wbs_created_by',
    'FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)')

  // ── 10. password_history ───────────────────────────────────
  console.log('\n[password_history]')
  await addFK('password_history', 'fk_pw_history_user_id',
    'FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)')

  // ── 11. purchase_orders ────────────────────────────────────
  // Keep vendor_name/vendor_code for backwards compat; add supplier_id + inco_term_id + warehouse_id
  console.log('\n[purchase_orders]')
  await addColumn('purchase_orders', 'supplier_id',
    'INT DEFAULT NULL', 'vendor_code')
  await addColumn('purchase_orders', 'inco_term_id',
    'INT DEFAULT NULL', 'incoterms')
  await addColumn('purchase_orders', 'warehouse_id',
    'INT DEFAULT NULL', 'inco_term_id')
  await addFK('purchase_orders', 'fk_po_supplier_id',
    'FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`)')
  await addFK('purchase_orders', 'fk_po_inco_term_id',
    'FOREIGN KEY (`inco_term_id`) REFERENCES `inco_terms`(`id`)')
  await addFK('purchase_orders', 'fk_po_warehouse_id',
    'FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)')

  // ── 12. po_lines ───────────────────────────────────────────
  // Keep uom varchar for backwards compat; add uom_id + unit_price + total_price
  console.log('\n[po_lines]')
  await addColumn('po_lines', 'uom_id',
    'INT DEFAULT NULL', 'uom')
  await addColumn('po_lines', 'unit_price',
    'DECIMAL(15,4) DEFAULT NULL', 'qty_received')
  await addColumn('po_lines', 'total_price',
    'DECIMAL(15,2) GENERATED ALWAYS AS (`qty` * `unit_price`) STORED', 'unit_price')
  await addFK('po_lines', 'fk_po_lines_uom_id',
    'FOREIGN KEY (`uom_id`) REFERENCES `units_of_measure`(`id`)')

  // ── 13. supplier_addresses (new table) ─────────────────────
  console.log('\n[supplier_addresses]')
  await createTable('supplier_addresses', `
    CREATE TABLE \`supplier_addresses\` (
      \`id\`           INT NOT NULL AUTO_INCREMENT,
      \`supplier_id\`  INT NOT NULL,
      \`type\`         ENUM('registered','remittance','shipping') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'registered',
      \`line1\`        VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      \`line2\`        VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      \`city\`         VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      \`state\`        VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      \`postcode\`     VARCHAR(20)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      \`country\`      VARCHAR(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
      \`is_primary\`   TINYINT(1) DEFAULT '0',
      \`created_by\`   INT DEFAULT NULL,
      \`created_at\`   DATETIME DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\`   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`supplier_id\` (\`supplier_id\`),
      CONSTRAINT \`fk_sa_supplier_id\` FOREIGN KEY (\`supplier_id\`) REFERENCES \`suppliers\`(\`id\`),
      CONSTRAINT \`fk_sa_created_by\`  FOREIGN KEY (\`created_by\`)  REFERENCES \`users\`(\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ── 14. user_project_access (new table) ────────────────────
  // Alias/view of user_wbs_access for code that references old name
  console.log('\n[user_project_access]')
  await createTable('user_project_access', `
    CREATE TABLE \`user_project_access\` (
      \`id\`          INT NOT NULL AUTO_INCREMENT,
      \`user_id\`     INT NOT NULL,
      \`project_id\`  INT NOT NULL,
      \`access_level\` ENUM('view','edit','manage') COLLATE utf8mb4_unicode_ci DEFAULT 'view',
      \`granted_by\`  INT DEFAULT NULL,
      \`created_at\`  DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_user_project\` (\`user_id\`, \`project_id\`),
      KEY \`project_id\` (\`project_id\`),
      CONSTRAINT \`fk_upa_user_id\`    FOREIGN KEY (\`user_id\`)    REFERENCES \`users\`(\`id\`),
      CONSTRAINT \`fk_upa_project_id\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`id\`),
      CONSTRAINT \`fk_upa_granted_by\` FOREIGN KEY (\`granted_by\`) REFERENCES \`users\`(\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  console.log(`\n${'─'.repeat(52)}`)
  console.log(`Done. ${added} applied, ${skipped} already correct.`)
  process.exit(0)
}

run().catch(e => { console.error('\nFATAL:', e.message); process.exit(1) })
