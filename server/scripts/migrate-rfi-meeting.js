// ─── MIGRATE: Meeting/RFI module (C1 schema + app grants) ─────
// Net-new module. One record table with record_type ENUM('rfi','meeting') sharing
// the workflow spine, plus two meeting child tables. Additive & idempotent
// (CREATE TABLE IF NOT EXISTS). Reversible:
//   DROP TABLE meeting_actions, meeting_attendees, rfi_meeting_records;
//
// DDL + GRANT run as the OWNER/DDL account (QCO_admin) — the least-privilege
// runtime user qmat_app has no DDL/GRANT (commit 484fc26). Supply admin creds
// out-of-band; they are never committed:
//   DB_ADMIN_USER=QCO_admin DB_ADMIN_PASSWORD=… node server/scripts/migrate-rfi-meeting.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mysql = require('mysql2/promise')

// ─── ADMIN CONNECTION (DDL + GRANT capable) ──────────────────
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin',
  password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 2,
  multipleStatements: true,
})

// ─── TABLE DDL ───────────────────────────────────────────────
const TABLES = {
  rfi_meeting_records: `CREATE TABLE IF NOT EXISTS rfi_meeting_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    record_type ENUM('rfi','meeting') NOT NULL,
    ref VARCHAR(20) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    priority ENUM('low','normal','high','critical') NOT NULL DEFAULT 'normal',
    link_type ENUM('project','wbs','po','scn') NOT NULL DEFAULT 'project',
    link_id INT NULL,
    link_label VARCHAR(120) NULL,
    raised_by INT NOT NULL,
    assigned_to INT NULL,
    raised_date DATE NOT NULL,
    due_date DATE NULL,
    closed_date DATE NULL,
    response TEXT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ref (project_id, ref),
    KEY ix_proj_type_status (project_id, record_type, status),
    KEY ix_assignee (project_id, assigned_to)
  )`,
  meeting_attendees: `CREATE TABLE IF NOT EXISTS meeting_attendees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    record_id INT NOT NULL,
    user_id INT NULL,
    attendee_name VARCHAR(120) NOT NULL,
    attendee_org VARCHAR(120) NULL,
    attended TINYINT(1) NOT NULL DEFAULT 1,
    KEY ix_record (record_id)
  )`,
  meeting_actions: `CREATE TABLE IF NOT EXISTS meeting_actions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    record_id INT NOT NULL,
    project_id INT NOT NULL,
    seq INT NOT NULL,
    description TEXT NOT NULL,
    assigned_to INT NULL,
    due_date DATE NULL,
    status ENUM('open','in_progress','done','cancelled') NOT NULL DEFAULT 'open',
    closed_date DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY ix_record (record_id), KEY ix_proj_status (project_id, status)
  )`,
}

// ─── APP-USER GRANTS (normal CRUD; these are not audit tables) ─
const GRANTS = [
  `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${process.env.DB_NAME}\`.rfi_meeting_records TO 'qmat_app'@'%'`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${process.env.DB_NAME}\`.meeting_attendees   TO 'qmat_app'@'%'`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${process.env.DB_NAME}\`.meeting_actions     TO 'qmat_app'@'%'`,
]

async function run() {
  console.log('\nMigrating Meeting/RFI module…\n')
  for (const [name, ddl] of Object.entries(TABLES)) {
    await db.query(ddl)
    console.log(`  ✓ table ${name} ready`)
  }
  for (const g of GRANTS) {
    await db.query(g)
    console.log(`  ✓ ${g.match(/ON `?\w+`?\.(\w+)/)[1]} granted to qmat_app`)
  }
  await db.query('FLUSH PRIVILEGES')
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
