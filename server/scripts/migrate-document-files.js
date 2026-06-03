// ─── MIGRATE: persisted document files (Inbox direct-download) ───
// Run once: node server/scripts/migrate-document-files.js
// Additive & idempotent. Gives the modules that previously discarded their
// uploads (MTO revisions parsed-then-dropped, VDRL metadata-only) a real place
// to record a stored file, and back-fills the path column Traceability needs to
// locate the cert it already writes to disk. Nothing here drops or rewrites data.
//   • mto_revisions       += file_path, file_name, file_size, mime_type
//   • vdrl_documents      += file_path, file_name, file_size, mime_type
//   • traceability_certs  += file_path, mime_type   (file_name/file_size already exist)
// Reversible: DROP each added COLUMN.
//
// DDL runs as the migration/owner account (QCO_admin), NOT the least-privilege
// runtime user — qmat_app deliberately has no ALTER (commit 484fc26). Supply the
// admin password out-of-band; it is never committed:
//   DB_ADMIN_USER=QCO_admin DB_ADMIN_PASSWORD=… node server/scripts/migrate-document-files.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mysql = require('mysql2/promise')

// ─── ADMIN CONNECTION (DDL-capable) ──────────────────────────
// Reuses the app's host/db but the owner credentials for ALTER rights.
const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin',
  password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 2,
})

// ─── IDEMPOTENT COLUMN ADD ───────────────────────────────────
// Skips a column already present so the script is safe to re-run.
async function addColumn(table, column, definition) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column])
  if (r.n > 0) { console.log(`  • ${table}.${column} present — skip`); return }
  await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`)
  console.log(`  ✓ ${table}.${column} added`)
}

async function run() {
  console.log('\nMigrating persisted document files…\n')

  // ── MTO revisions — keep the uploaded spreadsheet, not just its parsed lines
  await addColumn('mto_revisions', 'file_path', '`file_path` VARCHAR(512) NULL')
  await addColumn('mto_revisions', 'file_name', '`file_name` VARCHAR(255) NULL')
  await addColumn('mto_revisions', 'file_size', '`file_size` INT NULL')
  await addColumn('mto_revisions', 'mime_type', '`mime_type` VARCHAR(150) NULL')

  // ── VDRL documents — allow a real deliverable file per requirement row
  await addColumn('vdrl_documents', 'file_path', '`file_path` VARCHAR(512) NULL')
  await addColumn('vdrl_documents', 'file_name', '`file_name` VARCHAR(255) NULL')
  await addColumn('vdrl_documents', 'file_size', '`file_size` INT NULL')
  await addColumn('vdrl_documents', 'mime_type', '`mime_type` VARCHAR(150) NULL')

  // ── Traceability certs — record WHERE the already-saved file lives on disk
  await addColumn('traceability_certs', 'file_path', '`file_path` VARCHAR(512) NULL')
  await addColumn('traceability_certs', 'mime_type', '`mime_type` VARCHAR(150) NULL')

  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
