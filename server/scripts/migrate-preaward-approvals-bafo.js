// ─── MIGRATE: Pre-Award Phase 1.4 — approvals + BAFO (4 tables) ───────────────
//     tender_approvals / tender_bafo / tender_bafo_commercial / bafo_exchanges ──
//
// Create order = FK dependency order:
//   1. tender_approvals        → FK tender_packages, users   (exact po_approvals mirror)
//   2. tender_bafo             → FK tender_packages, users   (one row per tender; state only)
//   3. tender_bafo_commercial  → FK tender_bafo, tender_bids, users  (formal round-2 SEALED)
//   4. bafo_exchanges          → FK tender_bafo, tender_bids, users  (negotiation log; UNSEALED)
//
// tender_approvals mirrors the LIVE po_approvals shape exactly (approval_level
// tinyint UNSIGNED, status ENUM, created_at only / no updated_at) — swapping po_id
// for tender_id. Thresholds are NOT stored here: the Phase-2 route reads the
// per-project projects.approval_threshold_1/2 (decimal(15,2), nullable) the same way
// getProjectSettings() does for POs.
//
// SEALING: tender_bafo_commercial gets the SAME protection as tender_bid_commercial
// (Phase 1.3) — isolated commercial_value, unsealed_at/by pair, coherent-pair CHECK,
// sealed <=> unsealed_at IS NULL. Keyed (bafo_id, bid_id): one sealed round-2 price
// per shortlisted vendor per BAFO. bafo_exchanges (negotiation) is UNSEALED BY DESIGN
// (no formal close/seal step per the wireframe) — a plain append-only log.
//
// Types verified LIVE against real targets: all FK cols signed int -> int PKs;
// commercial_value / revised_value decimal(15,2) == purchase_orders.value.
//
// REVERSE (documented — reverse dependency order):
//   DROP TABLE bafo_exchanges;
//   DROP TABLE tender_bafo_commercial;
//   DROP TABLE tender_bafo;
//   DROP TABLE tender_approvals;
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-preaward-approvals-bafo.js   (then delete server/.env.admin)
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

// ─── FINALIZED DDL ────────────────────────────────────────────────────────────
const DDL = {
  tender_approvals: `CREATE TABLE IF NOT EXISTS tender_approvals (
  id             int              NOT NULL AUTO_INCREMENT,
  tender_id      int              NOT NULL,
  approver_id    int              NOT NULL,
  approval_level tinyint unsigned NOT NULL DEFAULT 1,
  status         enum('pending','approved','rejected','unapproved') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  comments       text             COLLATE utf8mb4_unicode_ci,
  actioned_at    datetime         DEFAULT NULL,
  created_at     datetime         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ta_tender (tender_id),
  KEY idx_ta_approver (approver_id),
  KEY idx_ta_status (status),
  CONSTRAINT fk_ta_approver FOREIGN KEY (approver_id) REFERENCES users (id),
  CONSTRAINT fk_ta_tender   FOREIGN KEY (tender_id)   REFERENCES tender_packages (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tender approval chain. Mirrors po_approvals — multi-step, threshold-gated (projects.approval_threshold_1/2), records every decision.';`,

  tender_bafo: `CREATE TABLE IF NOT EXISTS tender_bafo (
  id             int          NOT NULL AUTO_INCREMENT,
  tender_id      int          NOT NULL,
  mode           varchar(20)  COLLATE utf8mb4_unicode_ci NOT NULL,
  launched       tinyint(1)   NOT NULL DEFAULT 0,
  closed         tinyint(1)   NOT NULL DEFAULT 0,
  skipped        tinyint(1)   NOT NULL DEFAULT 0,
  close_date     date         DEFAULT NULL,
  shortlist_json json         DEFAULT NULL,
  created_by     int          DEFAULT NULL,
  created_at     datetime     DEFAULT CURRENT_TIMESTAMP,
  updated_at     datetime     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bafo_tender (tender_id),
  KEY fk_bafo_created_by (created_by),
  CONSTRAINT fk_bafo_tender     FOREIGN KEY (tender_id)  REFERENCES tender_packages (id) ON DELETE CASCADE,
  CONSTRAINT fk_bafo_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_bafo_mode CHECK (mode IN ('formal','negotiation'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  tender_bafo_commercial: `CREATE TABLE IF NOT EXISTS tender_bafo_commercial (
  id               int           NOT NULL AUTO_INCREMENT,
  bafo_id          int           NOT NULL,
  bid_id           int           NOT NULL,
  commercial_value decimal(15,2) NOT NULL,
  unsealed_at      datetime      DEFAULT NULL,
  unsealed_by      int           DEFAULT NULL,
  created_at       datetime      DEFAULT CURRENT_TIMESTAMP,
  updated_at       datetime      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bafo_commercial (bafo_id, bid_id),
  KEY idx_bafo_commercial_sealed (unsealed_at),
  KEY fk_bafo_commercial_bid (bid_id),
  KEY fk_bafo_commercial_unsealed_by (unsealed_by),
  CONSTRAINT fk_bafo_commercial_bafo        FOREIGN KEY (bafo_id)     REFERENCES tender_bafo (id) ON DELETE CASCADE,
  CONSTRAINT fk_bafo_commercial_bid         FOREIGN KEY (bid_id)      REFERENCES tender_bids (id) ON DELETE CASCADE,
  CONSTRAINT fk_bafo_commercial_unsealed_by FOREIGN KEY (unsealed_by) REFERENCES users (id),
  CONSTRAINT chk_bafo_commercial_unseal_pair
    CHECK ((unsealed_at IS NULL AND unsealed_by IS NULL)
        OR (unsealed_at IS NOT NULL AND unsealed_by IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

  bafo_exchanges: `CREATE TABLE IF NOT EXISTS bafo_exchanges (
  id            int           NOT NULL AUTO_INCREMENT,
  bafo_id       int           NOT NULL,
  bid_id        int           NOT NULL,
  revised_value decimal(15,2) NOT NULL,
  note          varchar(500)  COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  logged_by     int           DEFAULT NULL,
  created_at    datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bafoex_bafo (bafo_id),
  KEY idx_bafoex_bid (bid_id),
  KEY fk_bafoex_logged_by (logged_by),
  CONSTRAINT fk_bafoex_bafo      FOREIGN KEY (bafo_id)    REFERENCES tender_bafo (id) ON DELETE CASCADE,
  CONSTRAINT fk_bafoex_bid       FOREIGN KEY (bid_id)     REFERENCES tender_bids (id) ON DELETE CASCADE,
  CONSTRAINT fk_bafoex_logged_by FOREIGN KEY (logged_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
}

const ORDER = ['tender_approvals', 'tender_bafo', 'tender_bafo_commercial', 'bafo_exchanges']
const APP_USER = process.env.DB_USER || 'qmat_app'
const DB_NAME = process.env.DB_NAME

async function run() {
  console.log('\nPre-Award Phase 1.4 — approvals + BAFO (approvals / bafo / bafo_commercial / exchanges)…\n')

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
       ('chk_bafo_mode','chk_bafo_commercial_unseal_pair')`)
  console.log(`  CHECK constraints registered: ${cc.n}/2`)
  // sealing parity: formal round-2 value isolated in tender_bafo_commercial, NOT on tender_bafo or bafo_exchanges-as-sealed
  const [[leak]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'tender_bafo' AND column_name IN ('commercial_value','revised_value')`)
  console.log(`  tender_bafo carries no price column (sealing isolated): ${leak.n === 0 ? 'YES' : 'NO — LEAK!'}`)
  const [[seal]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'tender_bafo_commercial' AND column_name = 'commercial_value'`)
  console.log(`  tender_bafo_commercial holds the sealed value: ${seal.n === 1 ? 'YES' : 'NO'}`)
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
