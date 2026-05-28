// ─── SEED EXTERNAL USERS + CONTRACT DATES ────────────────────
// Adds 4 external dummy users (vendor, freight_forwarder, site_contractor)
// with contract_start and contract_end dates for testing the Users tab.
// Also sets contract_start on existing internal QCO Group users.
// Safe to re-run: INSERT IGNORE skips duplicates.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

const hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi' // "password"

async function run() {
  // ─── EXTERNAL USERS ──────────────────────────────────────────
  // vendor1: active contract
  // vendor2: expired contract (end date in past)
  // ff1: freight forwarder
  // sc1: site contractor expiring soon (within 30 days of 2026-05-29 = 2026-06-30)
  const externals = [
    ['john.doe@supplier-abc.com',    hash, 'John Doe',    'vendor',            'Supplier ABC',            '+61 400 111 001', 0, 1, '2025-01-01', '2026-12-31'],
    ['mary.jones@techparts.com',     hash, 'Mary Jones',  'vendor',            'Tech Parts Co',           '+61 400 111 002', 0, 1, '2024-06-01', '2025-12-31'],
    ['peter.chan@globalfreight.com',  hash, 'Peter Chan',  'freight_forwarder', 'Global Freight',          '+61 400 111 003', 0, 1, '2025-03-01', '2026-06-30'],
    ['lisa.park@sitecontract.com',   hash, 'Lisa Park',   'site_contractor',   'Site Contractors Pty Ltd','+61 400 111 004', 0, 1, '2025-07-01', '2026-06-15'],
  ]
  const [r1] = await db.query(
    `INSERT IGNORE INTO users (email,password_hash,full_name,role,company,phone,is_active,is_external,contract_start,contract_end) VALUES ?`,
    [externals]
  )
  console.log(`✓ ${r1.affectedRows} external user(s) inserted, ${r1.warningCount ?? 0} skipped`)

  // ─── CONTRACT START FOR INTERNAL USERS ───────────────────────
  // Set a contract_start for all QCO Group internal users that don't have one
  const [r2] = await db.query(
    `UPDATE users SET contract_start = '2024-01-01'
     WHERE is_external = 0 AND contract_start IS NULL AND company = 'QCO Group'`
  )
  console.log(`✓ ${r2.affectedRows} internal user(s) given contract_start = 2024-01-01`)

  console.log('Done.')
  process.exit(0)
}

run().catch(e => { console.error(e.message); process.exit(1) })
