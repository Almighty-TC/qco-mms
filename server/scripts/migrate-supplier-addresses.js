// ─── SUPPLIER ADDRESSES MIGRATION ───────────────────────────
// Run once: node server/scripts/migrate-supplier-addresses.js
// Creates the supplier_addresses table that replaces the old single
// address column on suppliers. Safe to re-run (IF NOT EXISTS).
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  // ─── CREATE TABLE ───────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS supplier_addresses (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      supplier_id   INT NOT NULL,
      label         VARCHAR(100) NOT NULL DEFAULT 'Main',
      address_line1 VARCHAR(255) NULL,
      address_line2 VARCHAR(255) NULL,
      city          VARCHAR(100) NULL,
      state         VARCHAR(100) NULL,
      postcode      VARCHAR(20)  NULL,
      country       VARCHAR(100) NULL,
      is_primary    TINYINT(1) NOT NULL DEFAULT 0,
      is_pickup     TINYINT(1) NOT NULL DEFAULT 0,
      notes         TEXT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_sup_addr_supplier FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id) ON DELETE CASCADE,
      INDEX idx_supplier_id (supplier_id),
      INDEX idx_is_pickup (supplier_id, is_pickup)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  console.log('✓ supplier_addresses table ready')

  // ─── MIGRATE EXISTING ADDRESS DATA ──────────────────────────
  // If suppliers.address column exists, copy each non-null value into
  // a primary address row, then optionally drop the old column.
  const [cols] = await db.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suppliers' AND COLUMN_NAME = 'address'
  `)

  if (cols.length === 0) {
    console.log('✓ No legacy address column found — nothing to migrate')
  } else {
    const [suppliers] = await db.query(
      `SELECT id, address FROM suppliers WHERE address IS NOT NULL AND address != ''`
    )
    let migrated = 0
    for (const s of suppliers) {
      // Only insert if no address row exists yet for this supplier
      const [[{ cnt }]] = await db.query(
        'SELECT COUNT(*) AS cnt FROM supplier_addresses WHERE supplier_id = ?', [s.id]
      )
      if (cnt === 0) {
        await db.query(
          `INSERT INTO supplier_addresses (supplier_id, label, address_line1, is_primary)
           VALUES (?, 'Main', ?, 1)`,
          [s.id, s.address]
        )
        migrated++
      }
    }
    console.log(`✓ Migrated ${migrated} legacy address row(s)`)
    console.log('  (Legacy suppliers.address column left in place — remove manually if desired)')
  }

  process.exit(0)
}

run().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
