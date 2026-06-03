// ─── SCHEMA COLUMN PROBE (migration-tolerant file storage) ────
// The persisted-document-file columns (file_path/file_name/file_size/mime_type)
// land via migrate-document-files.js, which runs as the OWNER/DDL account — the
// least-privilege app user cannot self-migrate. Both the Document Inbox reads
// and the module upload writes consult this probe so the app stays fully
// functional across the apply window: before the migration the new columns read
// as absent (file persistence is skipped, downloads report "no file"); after it
// runs (and the server restarts), everything lights up with no code change.
//
// Result is cached for the process lifetime — a restart accompanies the
// migration, so there is no stale-cache risk.
const db = require('../db')

const TABLES  = ['traceability_certs', 'mto_revisions', 'vdrl_documents']
const COLUMNS = ['file_path', 'file_name', 'file_size', 'mime_type']

let _cache = null

// Returns a Set of present "table.column" keys among the optional file columns.
async function fileColumns() {
  if (_cache) return _cache
  const [rows] = await db.query(
    `SELECT CONCAT(table_name,'.',column_name) AS k
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name  IN (?)
       AND column_name IN (?)`, [TABLES, COLUMNS])
  _cache = new Set(rows.map(r => r.k))
  return _cache
}

// Convenience: are a table's file columns available to write to yet?
async function fileColumnsReady(table) {
  return (await fileColumns()).has(`${table}.file_path`)
}

module.exports = { fileColumns, fileColumnsReady }
