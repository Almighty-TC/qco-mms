// ─── MIGRATE: Pre-Award Procurement — Phase 1.1 tender_packages spine ─────────
// Net-new spine table for the Pre-Award Procurement module + the approved additive
// purchase_orders.tender_id back-link (award→PO traceability, closing the MTO→PO
// FK-gap pattern). Everything else in the module FKs into tender_packages, so this
// runs first. Additive & idempotent:
//   • CREATE TABLE IF NOT EXISTS tender_packages
//   • capability-detected ALTER purchase_orders ADD tender_id (+ index + FK)
//   • least-privilege GRANT to the runtime app user (qmat_app)
//
// procurement_mode / status use VARCHAR + named CHECK (per the finalized DDL) —
// values quoted verbatim from the wireframe PROC_MODES / TENDER_STATUS_META keys.
// stage / discipline stay enum (discipline mirrors purchase_orders.group_category
// so the award→PO handoff is a straight value copy). Monetary DECIMAL(15,2) matches
// purchase_orders.value exactly; timestamps use the house datetime … ON UPDATE
// CURRENT_TIMESTAMP convention (NOT TIMESTAMP).
//
// REVERSE (documented):
//   ALTER TABLE purchase_orders DROP FOREIGN KEY fk_po_tender, DROP COLUMN tender_id;
//   DROP TABLE tender_packages;
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-preaward-tenders.js   (then delete server/.env.admin)
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

// ─── CAPABILITY-DETECT HELPERS (idempotency — mirrors migrate-child-stock.js) ──
async function tableExists(table) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`, [table])
  return r.n > 0
}
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

// ─── FINALIZED DDL (reviewed + grounded against the live schema) ───────────────
const CREATE_TENDER_PACKAGES = `CREATE TABLE IF NOT EXISTS tender_packages (
  id                int           NOT NULL AUTO_INCREMENT,
  project_id        int           NOT NULL,
  ref               varchar(50)   COLLATE utf8mb4_unicode_ci NOT NULL,
  title             varchar(255)  COLLATE utf8mb4_unicode_ci NOT NULL,
  discipline        enum('mechanical','electrical','instrumentation','civil','piping','structural')
                                  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  procurement_mode  varchar(30)   COLLATE utf8mb4_unicode_ci NOT NULL,
  stage             enum('planning','prequalification','invitation','clarifications',
                         'tendering','evaluation','recommendation','award')
                                  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'planning',
  status            varchar(20)   COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  currency          varchar(10)   COLLATE utf8mb4_unicode_ci DEFAULT 'AUD',
  estimated_value   decimal(15,2) DEFAULT NULL,
  wbs_code          varchar(50)   COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  owner_id          int           DEFAULT NULL,
  created_by        int           DEFAULT NULL,
  created_at        datetime      DEFAULT CURRENT_TIMESTAMP,
  updated_at        datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tender_ref (project_id, ref),
  KEY idx_tenders_project (project_id),
  KEY idx_tenders_stage (stage),
  KEY idx_tenders_status (status),
  KEY fk_tenders_owner (owner_id),
  KEY fk_tenders_created_by (created_by),
  CONSTRAINT fk_tenders_project    FOREIGN KEY (project_id) REFERENCES projects (id),
  CONSTRAINT fk_tenders_owner      FOREIGN KEY (owner_id)   REFERENCES users (id),
  CONSTRAINT fk_tenders_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_tenders_mode      CHECK (procurement_mode IN ('private_negotiated','private_competitive','mdb_funded')),
  CONSTRAINT chk_tenders_status    CHECK (status IN ('active','standstill','awarded','on_hold','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`

const APP_USER = process.env.DB_USER || 'qmat_app'
const GRANT = `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${process.env.DB_NAME}\`.tender_packages TO '${APP_USER}'@'%';`

async function run() {
  console.log('\nPre-Award Phase 1.1 — tender_packages spine + purchase_orders.tender_id…\n')

  // 1) tender_packages (IF NOT EXISTS — inherently idempotent)
  await db.query(CREATE_TENDER_PACKAGES)
  console.log('  ✓ tender_packages ready (CREATE TABLE IF NOT EXISTS)')

  // 2) purchase_orders.tender_id — capability-detected column + index + FK
  console.log(' purchase_orders.tender_id:')
  if (await columnExists('purchase_orders', 'tender_id')) console.log('  • column present — skip')
  else { await db.query('ALTER TABLE purchase_orders ADD COLUMN tender_id int DEFAULT NULL AFTER supplier_id'); console.log('  ✓ column added') }

  if (await indexExists('purchase_orders', 'idx_po_tender')) console.log('  • idx_po_tender present — skip')
  else { try { await db.query('CREATE INDEX idx_po_tender ON purchase_orders(tender_id)'); console.log('  ✓ idx_po_tender') } catch (e) { console.log('  • idx skipped (FK auto-index?):', e.message) } }

  if (await fkExists('fk_po_tender')) console.log('  • fk_po_tender present — skip')
  else { await db.query('ALTER TABLE purchase_orders ADD CONSTRAINT fk_po_tender FOREIGN KEY (tender_id) REFERENCES tender_packages (id)'); console.log('  ✓ fk_po_tender (default RESTRICT)') }

  // 3) least-privilege grant for the runtime app user
  try {
    await db.query(GRANT)
    await db.query('FLUSH PRIVILEGES;')
    console.log(`  ✓ granted SELECT/INSERT/UPDATE/DELETE on tender_packages to ${APP_USER}`)
  } catch (g) { console.warn('  ⚠ grant step skipped/failed (may already be covered):', g.message) }

  // 4) verify
  console.log('\n Verify:')
  console.log(`  tender_packages table: ${(await tableExists('tender_packages')) ? 'present' : 'MISSING'}`)
  console.log(`  purchase_orders.tender_id: ${(await columnExists('purchase_orders', 'tender_id')) ? 'present' : 'MISSING'}`)
  console.log(`  fk_po_tender: ${(await fkExists('fk_po_tender')) ? 'present' : 'MISSING'}`)
  const [[cm]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.check_constraints
     WHERE constraint_schema = DATABASE() AND constraint_name IN ('chk_tenders_mode','chk_tenders_status')`)
  console.log(`  CHECK constraints (mode+status) registered: ${cm.n}/2`)
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
