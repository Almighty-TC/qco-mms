// ─── MIGRATE: Pre-Award Phase 1.2 — tender_prequalifications + tender_criteria ─
// Two net-new tables, both additive & idempotent (CREATE TABLE IF NOT EXISTS).
//
//   tender_prequalifications — supplier×category qualification registry. NOT
//     tender-linked (no FK to tender_packages) and NOT a flag on suppliers.
//     avl_status stays on `suppliers` (global standing, read via JOIN); this table
//     holds only the per-round outcome round_status. project-scoped.
//   tender_criteria — per-tender weighted scoring config (owned by the tender:
//     ON DELETE CASCADE). Per-row guardrail CHECK (weight BETWEEN 5 AND 60);
//     mandatory + min_score independent. The sum-to-100 invariant is NOT a DB
//     constraint — it is enforced in the Phase-2 criteria lock/finalize endpoint
//     (rows are written one at a time as sliders move, so a per-write sum check
//     would reject valid intermediate states).
//
// CHECK value sets quoted from the wireframe: round_status IN
//   ('pending','qualified','conditional','not_qualified'). discipline enum mirrors
//   purchase_orders.group_category. FK columns signed int, verified against
//   projects.id / suppliers.id / users.id / tender_packages.id (all int).
//
// REVERSE (documented):
//   DROP TABLE tender_criteria;
//   DROP TABLE tender_prequalifications;
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-preaward-prequal-criteria.js  (then delete server/.env.admin)
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

// ─── CAPABILITY-DETECT (idempotency verify) ───────────────────────────────────
async function tableExists(table) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`, [table])
  return r.n > 0
}

// ─── FINALIZED DDL ────────────────────────────────────────────────────────────
const CREATE_PREQUAL = `CREATE TABLE IF NOT EXISTS tender_prequalifications (
  id            int          NOT NULL AUTO_INCREMENT,
  project_id    int          NOT NULL,
  supplier_id   int          NOT NULL,
  category      varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  discipline    enum('mechanical','electrical','instrumentation','civil','piping','structural')
                             COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  round_status  varchar(20)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  valid_from    date         DEFAULT NULL,
  valid_to      date         DEFAULT NULL,
  notes         varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  created_by    int          DEFAULT NULL,
  created_at    datetime     DEFAULT CURRENT_TIMESTAMP,
  updated_at    datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_prequal_scope (project_id, supplier_id, category),
  KEY idx_prequal_project (project_id),
  KEY idx_prequal_supplier (supplier_id),
  KEY idx_prequal_round (round_status),
  KEY fk_prequal_created_by (created_by),
  CONSTRAINT fk_prequal_project    FOREIGN KEY (project_id)  REFERENCES projects (id),
  CONSTRAINT fk_prequal_supplier   FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_prequal_created_by FOREIGN KEY (created_by)  REFERENCES users (id),
  CONSTRAINT chk_prequal_round CHECK (round_status IN ('pending','qualified','conditional','not_qualified'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`

const CREATE_CRITERIA = `CREATE TABLE IF NOT EXISTS tender_criteria (
  id            int          NOT NULL AUTO_INCREMENT,
  tender_id     int          NOT NULL,
  criterion_key varchar(30)  COLLATE utf8mb4_unicode_ci NOT NULL,
  label         varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  weight        int          NOT NULL,
  mandatory     tinyint(1)   NOT NULL DEFAULT 0,
  min_score     int          DEFAULT NULL,
  display_order int          NOT NULL DEFAULT 0,
  created_at    datetime     DEFAULT CURRENT_TIMESTAMP,
  updated_at    datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_criteria_key (tender_id, criterion_key),
  KEY idx_criteria_tender (tender_id),
  CONSTRAINT fk_criteria_tender FOREIGN KEY (tender_id) REFERENCES tender_packages (id) ON DELETE CASCADE,
  CONSTRAINT chk_criteria_weight    CHECK (weight BETWEEN 5 AND 60),
  CONSTRAINT chk_criteria_min_score CHECK (min_score IS NULL OR min_score BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`

const APP_USER = process.env.DB_USER || 'qmat_app'
const DB_NAME = process.env.DB_NAME
const GRANTS = [
  `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.tender_prequalifications TO '${APP_USER}'@'%';`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.tender_criteria TO '${APP_USER}'@'%';`,
]

async function run() {
  console.log('\nPre-Award Phase 1.2 — tender_prequalifications + tender_criteria…\n')

  await db.query(CREATE_PREQUAL)
  console.log('  ✓ tender_prequalifications ready (CREATE TABLE IF NOT EXISTS)')
  await db.query(CREATE_CRITERIA)
  console.log('  ✓ tender_criteria ready (CREATE TABLE IF NOT EXISTS)')

  for (const g of GRANTS) { try { await db.query(g) } catch (e) { console.warn('  ⚠ grant skipped/failed:', e.message) } }
  try { await db.query('FLUSH PRIVILEGES;') } catch (e) { /* non-fatal */ }
  console.log(`  ✓ grants applied to ${APP_USER} (both tables)`)

  // verify
  console.log('\n Verify:')
  console.log(`  tender_prequalifications: ${(await tableExists('tender_prequalifications')) ? 'present' : 'MISSING'}`)
  console.log(`  tender_criteria: ${(await tableExists('tender_criteria')) ? 'present' : 'MISSING'}`)
  const [[cc]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.check_constraints
     WHERE constraint_schema = DATABASE()
       AND constraint_name IN ('chk_prequal_round','chk_criteria_weight','chk_criteria_min_score')`)
  console.log(`  CHECK constraints registered: ${cc.n}/3`)
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
