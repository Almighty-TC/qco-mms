// ─── MIGRATE: Pre-Award Phase 1.3 — documents / clarifications / bids / sealed ─
//     commercial / evaluations (5 tables, additive & idempotent) ───────────────
//
// Create order = FK dependency order:
//   1. tender_documents        → FK tender_packages, users
//   2. tender_clarifications   → FK tender_packages, suppliers, users
//   3. tender_bids             → FK tender_packages, suppliers, users   (NO money)
//   4. tender_bid_commercial   → FK tender_bids, users                  (sealed value)
//   5. tender_evaluations      → FK tender_packages, tender_bids, users
//
// SEALED-ENVELOPE DESIGN (anti-bias two-envelope tendering): the commercial value
// lives ONLY in tender_bid_commercial, never in tender_bids — so SELECT * on a bid
// can never leak price to technical evaluators. Sealed ⇔ unsealed_at IS NULL (no
// redundant flag); a row-level CHECK forbids a half-set (by/at) state. The unseal
// is a governed, audited, one-way transition in the Phase-2 route (mirrors
// server/lib/sealGovernance.js discipline).
//
// Types verified LIVE against real targets: all FK cols signed int -> int PKs
// (tender_packages.id / suppliers.id / users.id / tender_bids.id); commercial_value
// decimal(15,2) == purchase_orders.value == tender_packages.estimated_value.
// CHECK value sets: prelim/status/round-status/doc-status quoted from the wireframe.
//
// REVERSE (documented — reverse dependency order):
//   DROP TABLE tender_evaluations;
//   DROP TABLE tender_bid_commercial;
//   DROP TABLE tender_bids;
//   DROP TABLE tender_clarifications;
//   DROP TABLE tender_documents;
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-preaward-bids-eval.js   (then delete server/.env.admin)
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

async function tableExists(table) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`, [table])
  return r.n > 0
}

// ─── FINALIZED DDL (all reviewed + grounded against the live schema) ───────────
const DDL = {
  tender_documents: `CREATE TABLE IF NOT EXISTS tender_documents (
  id          int          NOT NULL AUTO_INCREMENT,
  tender_id   int          NOT NULL,
  doc_key     varchar(30)  COLLATE utf8mb4_unicode_ci NOT NULL,
  label       varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  required    tinyint(1)   NOT NULL DEFAULT 0,
  status      varchar(20)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  file_path   varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  uploaded_by int          DEFAULT NULL,
  uploaded_at datetime     DEFAULT NULL,
  created_at  datetime     DEFAULT CURRENT_TIMESTAMP,
  updated_at  datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_doc_key (tender_id, doc_key),
  KEY idx_docs_tender (tender_id),
  KEY fk_docs_uploaded_by (uploaded_by),
  CONSTRAINT fk_docs_tender      FOREIGN KEY (tender_id)   REFERENCES tender_packages (id) ON DELETE CASCADE,
  CONSTRAINT fk_docs_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users (id),
  CONSTRAINT chk_docs_status CHECK (status IN ('pending','uploaded','waived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  tender_clarifications: `CREATE TABLE IF NOT EXISTS tender_clarifications (
  id           int          NOT NULL AUTO_INCREMENT,
  tender_id    int          NOT NULL,
  ref          varchar(30)  COLLATE utf8mb4_unicode_ci NOT NULL,
  supplier_id  int          DEFAULT NULL,
  question     text         COLLATE utf8mb4_unicode_ci NOT NULL,
  response     text         COLLATE utf8mb4_unicode_ci,
  addendum     varchar(30)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  status       varchar(20)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  created_by   int          DEFAULT NULL,
  responded_by int          DEFAULT NULL,
  responded_at datetime     DEFAULT NULL,
  created_at   datetime     DEFAULT CURRENT_TIMESTAMP,
  updated_at   datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clar_ref (tender_id, ref),
  KEY idx_clar_tender (tender_id),
  KEY fk_clar_supplier (supplier_id),
  KEY fk_clar_created_by (created_by),
  KEY fk_clar_responded_by (responded_by),
  CONSTRAINT fk_clar_tender       FOREIGN KEY (tender_id)    REFERENCES tender_packages (id) ON DELETE CASCADE,
  CONSTRAINT fk_clar_supplier     FOREIGN KEY (supplier_id)  REFERENCES suppliers (id),
  CONSTRAINT fk_clar_created_by   FOREIGN KEY (created_by)   REFERENCES users (id),
  CONSTRAINT fk_clar_responded_by FOREIGN KEY (responded_by) REFERENCES users (id),
  CONSTRAINT chk_clar_status CHECK (status IN ('open','answered'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  tender_bids: `CREATE TABLE IF NOT EXISTS tender_bids (
  id             int          NOT NULL AUTO_INCREMENT,
  tender_id      int          NOT NULL,
  supplier_id    int          NOT NULL,
  round          tinyint      NOT NULL DEFAULT 1,
  submitted_at   datetime     DEFAULT NULL,
  currency       varchar(10)  COLLATE utf8mb4_unicode_ci DEFAULT 'AUD',
  tech_doc_count int          NOT NULL DEFAULT 0,
  comm_doc_count int          NOT NULL DEFAULT 0,
  prelim_status  varchar(20)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  prelim_reason  varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  status         varchar(20)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted',
  created_by     int          DEFAULT NULL,
  created_at     datetime     DEFAULT CURRENT_TIMESTAMP,
  updated_at     datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bid_round (tender_id, supplier_id, round),
  KEY idx_bids_tender (tender_id),
  KEY idx_bids_supplier (supplier_id),
  KEY fk_bids_created_by (created_by),
  CONSTRAINT fk_bids_tender     FOREIGN KEY (tender_id)   REFERENCES tender_packages (id) ON DELETE CASCADE,
  CONSTRAINT fk_bids_supplier   FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
  CONSTRAINT fk_bids_created_by FOREIGN KEY (created_by)  REFERENCES users (id),
  CONSTRAINT chk_bids_prelim CHECK (prelim_status IN ('pending','pass','fail')),
  CONSTRAINT chk_bids_status CHECK (status IN ('submitted','withdrawn','shortlisted','rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  tender_bid_commercial: `CREATE TABLE IF NOT EXISTS tender_bid_commercial (
  id               int           NOT NULL AUTO_INCREMENT,
  bid_id           int           NOT NULL,
  commercial_value decimal(15,2) NOT NULL,
  unsealed_at      datetime      DEFAULT NULL,
  unsealed_by      int           DEFAULT NULL,
  created_at       datetime      DEFAULT CURRENT_TIMESTAMP,
  updated_at       datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_commercial_bid (bid_id),
  KEY idx_commercial_sealed (unsealed_at),
  KEY fk_commercial_unsealed_by (unsealed_by),
  CONSTRAINT fk_commercial_bid         FOREIGN KEY (bid_id)      REFERENCES tender_bids (id) ON DELETE CASCADE,
  CONSTRAINT fk_commercial_unsealed_by FOREIGN KEY (unsealed_by) REFERENCES users (id),
  CONSTRAINT chk_commercial_unseal_pair
    CHECK ((unsealed_at IS NULL AND unsealed_by IS NULL)
        OR (unsealed_at IS NOT NULL AND unsealed_by IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  tender_evaluations: `CREATE TABLE IF NOT EXISTS tender_evaluations (
  id             int          NOT NULL AUTO_INCREMENT,
  tender_id      int          NOT NULL,
  bid_id         int          NOT NULL,
  tech_score     int          DEFAULT NULL,
  comm_score     int          DEFAULT NULL,
  combined_score decimal(6,2) DEFAULT NULL,
  rank_position  int          DEFAULT NULL,
  scores_json    json         DEFAULT NULL,
  evaluated_by   int          DEFAULT NULL,
  evaluated_at   datetime     DEFAULT NULL,
  created_at     datetime     DEFAULT CURRENT_TIMESTAMP,
  updated_at     datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_eval_bid (bid_id),
  KEY idx_eval_tender (tender_id),
  KEY fk_eval_evaluated_by (evaluated_by),
  CONSTRAINT fk_eval_tender       FOREIGN KEY (tender_id)    REFERENCES tender_packages (id) ON DELETE CASCADE,
  CONSTRAINT fk_eval_bid          FOREIGN KEY (bid_id)       REFERENCES tender_bids (id) ON DELETE CASCADE,
  CONSTRAINT fk_eval_evaluated_by FOREIGN KEY (evaluated_by) REFERENCES users (id),
  CONSTRAINT chk_eval_tech CHECK (tech_score IS NULL OR tech_score BETWEEN 0 AND 100),
  CONSTRAINT chk_eval_comm CHECK (comm_score IS NULL OR comm_score BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
}

// dependency create order
const ORDER = ['tender_documents', 'tender_clarifications', 'tender_bids', 'tender_bid_commercial', 'tender_evaluations']

const APP_USER = process.env.DB_USER || 'qmat_app'
const DB_NAME = process.env.DB_NAME

async function run() {
  console.log('\nPre-Award Phase 1.3 — documents / clarifications / bids / sealed commercial / evaluations…\n')

  for (const t of ORDER) {
    await db.query(DDL[t])
    console.log(`  ✓ ${t} ready (CREATE TABLE IF NOT EXISTS)`)
  }

  console.log('\n Grants (least-privilege, runtime app user):')
  for (const t of ORDER) {
    try {
      await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.${t} TO '${APP_USER}'@'%';`)
      console.log(`  ✓ ${t} -> ${APP_USER}`)
    } catch (g) { console.warn(`  ⚠ grant ${t} skipped/failed:`, g.message) }
  }
  try { await db.query('FLUSH PRIVILEGES;') } catch (e) { /* non-fatal */ }

  console.log('\n Verify:')
  for (const t of ORDER) console.log(`  ${t}: ${(await tableExists(t)) ? 'present' : 'MISSING'}`)
  const [[cc]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.check_constraints
     WHERE constraint_schema = DATABASE() AND constraint_name IN
       ('chk_docs_status','chk_clar_status','chk_bids_prelim','chk_bids_status',
        'chk_commercial_unseal_pair','chk_eval_tech','chk_eval_comm')`)
  console.log(`  CHECK constraints registered: ${cc.n}/7`)
  // sealing sanity: commercial_value must NOT exist on tender_bids
  const [[leak]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'tender_bids' AND column_name = 'commercial_value'`)
  console.log(`  tender_bids.commercial_value absent (sealing intact): ${leak.n === 0 ? 'YES' : 'NO — LEAK!'}`)
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
