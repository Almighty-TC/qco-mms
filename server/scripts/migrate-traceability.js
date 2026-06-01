// ─── MIGRATE TRACEABILITY ─────────────────────────────────────
// Run once: node server/scripts/migrate-traceability.js
// Creates the four traceability tables (certs, cert versions, holds,
// trace lifecycle) plus the chase log. Safe to re-run (IF NOT EXISTS).
//
// Self-contained design: po_ref / vendor_name / vendor_email are stored
// on the rows directly so the module renders without depending on
// matching purchase_orders / suppliers / vendor_contacts records.
// status and age_days are stored explicitly so the demo counts are
// deterministic regardless of the current date.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  console.log('\nCreating traceability tables…\n')

  // ── traceability_certs ───────────────────────────────────────
  // One row per VDRL requirement line OR per cert-approval-queue item.
  // category splits the two so the VDRL and Approvals tabs stay exact.
  await db.query(`CREATE TABLE IF NOT EXISTS traceability_certs (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    project_id    INT NOT NULL,
    category      ENUM('vdrl','approval') NOT NULL DEFAULT 'vdrl',
    po_id         INT NULL,
    po_ref        VARCHAR(60) NULL,
    vendor_name   VARCHAR(150) NULL,
    tag           VARCHAR(60) NULL,
    document_name VARCHAR(200) NULL,
    cert_type     VARCHAR(100) NULL,
    item_scope    VARCHAR(150) NULL,
    heat_ref      VARCHAR(120) NULL,
    applies_to    VARCHAR(200) NULL,
    issue_date    DATE NULL,
    due_date      DATE NULL,
    received_date DATE NULL,
    is_required   TINYINT NOT NULL DEFAULT 1,
    uploader      VARCHAR(180) NULL,
    file_name     VARCHAR(255) NULL,
    file_size     INT NULL,
    status        ENUM('pending','received','verified','rejected','overdue') NOT NULL DEFAULT 'pending',
    priority      ENUM('normal','high') NOT NULL DEFAULT 'normal',
    uploaded_by   INT NULL,
    uploaded_date DATETIME NULL,
    verified_by   INT NULL,
    verified_date DATETIME NULL,
    reject_reason TEXT NULL,
    notes         TEXT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_tc_project (project_id),
    KEY idx_tc_category (category),
    KEY idx_tc_status (status),
    KEY idx_tc_tag (tag)
  )`)
  console.log('  ✓ traceability_certs')

  // ── traceability_cert_versions ───────────────────────────────
  // Each revision of a cert file. created_* maps to "uploaded" in the UI.
  await db.query(`CREATE TABLE IF NOT EXISTS traceability_cert_versions (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    cert_id         INT NOT NULL,
    rev             VARCHAR(20) NULL,
    heat_ref        VARCHAR(120) NULL,
    applies_to      VARCHAR(200) NULL,
    file_name       VARCHAR(255) NULL,
    file_size       INT NULL,
    status          ENUM('pending','received','verified','rejected') NOT NULL DEFAULT 'verified',
    created_by      INT NULL,
    created_by_name VARCHAR(180) NULL,
    created_date    DATETIME NULL,
    verified_by_name VARCHAR(180) NULL,
    verified_date   DATETIME NULL,
    KEY idx_tcv_cert (cert_id)
  )`)
  console.log('  ✓ traceability_cert_versions')

  // ── traceability_holds ───────────────────────────────────────
  // Material held pending cert verification. age_days stored for a
  // deterministic demo; chase_count increments on each chase.
  await db.query(`CREATE TABLE IF NOT EXISTS traceability_holds (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    project_id      INT NOT NULL,
    tag             VARCHAR(60) NULL,
    item            VARCHAR(200) NULL,
    hold_reason     VARCHAR(255) NULL,
    location        VARCHAR(100) NULL,
    since_date      DATE NULL,
    age_days        INT NULL,
    chase_count     INT NOT NULL DEFAULT 0,
    related_cert_id INT NULL,
    vendor_name     VARCHAR(150) NULL,
    vendor_email    VARCHAR(255) NULL,
    status          ENUM('active','released') NOT NULL DEFAULT 'active',
    released_by     INT NULL,
    released_date   DATETIME NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_th_project (project_id),
    KEY idx_th_status (status),
    KEY idx_th_tag (tag)
  )`)
  console.log('  ✓ traceability_holds')

  // ── traceability_trace_lifecycle ─────────────────────────────
  // Ordered lifecycle stages per tag for the Trace chain tab.
  // event_date/ref kept as VARCHAR because problem rows hold '—' text.
  await db.query(`CREATE TABLE IF NOT EXISTS traceability_trace_lifecycle (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    project_id  INT NOT NULL,
    tag         VARCHAR(60) NOT NULL,
    stage       VARCHAR(20) NOT NULL,
    ref         VARCHAR(160) NULL,
    event_date  VARCHAR(40) NULL,
    actor       VARCHAR(120) NULL,
    detail      TEXT NULL,
    node_state  ENUM('complete','warning','blocked','pending') NOT NULL DEFAULT 'pending',
    badge       VARCHAR(20) NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    KEY idx_tl_project (project_id),
    KEY idx_tl_tag (tag)
  )`)
  console.log('  ✓ traceability_trace_lifecycle')

  // ── traceability_chases ──────────────────────────────────────
  // One row per chase action against a hold (email sent or log-only).
  await db.query(`CREATE TABLE IF NOT EXISTS traceability_chases (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    hold_id     INT NOT NULL,
    sent_email  TINYINT NOT NULL DEFAULT 0,
    recipient   VARCHAR(255) NULL,
    subject     VARCHAR(255) NULL,
    body        TEXT NULL,
    created_by  INT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_tch_hold (hold_id)
  )`)
  console.log('  ✓ traceability_chases')

  console.log('\nDone.\n')
  process.exit(0)
}

run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
