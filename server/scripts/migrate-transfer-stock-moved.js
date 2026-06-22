// ─── MIGRATE: warehouse_transfers.stock_moved_at (once-only stock move) ───────
// Idempotency flag for the transfer stock move. NULL = stock not yet moved; set to
// NOW() inside the move transaction (under a row lock) so a transfer can never move
// stock twice (concurrent PUTs / status replay delivered→in_transit→delivered).
// Additive & idempotent. Reversible:
//   ALTER TABLE warehouse_transfers DROP COLUMN stock_moved_at;
//
// No new GRANT: qmat_app already holds UPDATE on warehouse_transfers (table-level,
// covers the new column). DDL runs as QCO_admin (qmat_app has no DDL). Supply admin
// creds out-of-band; never committed:
//   DB_ADMIN_USER=QCO_admin DB_ADMIN_PASSWORD=… node server/scripts/migrate-transfer-stock-moved.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mysql = require('mysql2/promise')

const db = mysql.createPool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin', password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2,
})

async function run() {
  console.log('\nMigrating warehouse_transfers.stock_moved_at…\n')
  const [exists] = await db.query("SHOW COLUMNS FROM warehouse_transfers LIKE 'stock_moved_at'")
  if (exists.length) { console.log('  • column already present — nothing to do'); console.log('\nDone.\n'); process.exit(0) }
  await db.query('ALTER TABLE warehouse_transfers ADD COLUMN stock_moved_at DATETIME NULL')
  console.log('  ✓ column stock_moved_at added (NULL default — no stock moved yet)')
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
