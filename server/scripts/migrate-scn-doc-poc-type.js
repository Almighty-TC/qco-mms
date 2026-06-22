// ─── MIGRATE: scn_documents.document_type += 'Proof of Custody' ───────────────
// Additive enum change so a signed Proof-of-Custody copy can be stored as its own
// document type (reusing the existing scn_documents upload/download/inbox flow).
// Lists every existing member plus the new one; preserves NOT NULL (no default).
// Idempotent (skips if already present). Reversible (no rows use it yet):
//   ALTER TABLE scn_documents MODIFY COLUMN document_type
//     ENUM('Commercial Invoice','Packing List','Bill of Lading','Airway Bill',
//          'Certificate of Origin','Insurance Certificate','Dangerous Goods Declaration',
//          'Customs Entry','Other') NOT NULL;
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds come from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), never committed:
//   node server/scripts/migrate-scn-doc-poc-type.js
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
require('dotenv').config({ path: path.join(__dirname, '../.env.admin') }) // admin creds (override)
const mysql = require('mysql2/promise')

const NEW_VALUE = 'Proof of Custody'

const db = mysql.createPool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin', password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2,
})

async function run() {
  console.log('\nMigrating scn_documents.document_type (+ "Proof of Custody")…\n')

  // ── Read the CURRENT enum definition (authoritative; don't hard-code) ──
  const [[col]] = await db.query("SHOW COLUMNS FROM scn_documents LIKE 'document_type'")
  if (!col) { console.error('  ✗ scn_documents.document_type not found'); process.exit(1) }
  console.log('  current:', col.Type, '| NULL:', col.Null, '| default:', JSON.stringify(col.Default))

  // Parse existing members out of enum('a','b',...) preserving order.
  const members = [...col.Type.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'"))
  if (members.includes(NEW_VALUE)) {
    console.log(`  • "${NEW_VALUE}" already present — nothing to do`)
    console.log('\nDone.\n'); process.exit(0)
  }

  // Preserve nullability exactly (column is NOT NULL, no default).
  const nullClause = col.Null === 'NO' ? 'NOT NULL' : 'NULL'
  const allValues = [...members, NEW_VALUE]
  const enumList = allValues.map(v => `'${v.replace(/'/g, "''")}'`).join(',')
  const ddl = `ALTER TABLE scn_documents MODIFY COLUMN document_type ENUM(${enumList}) ${nullClause}`

  console.log('\n  Executing DDL:\n  ' + ddl + '\n')
  await db.query(ddl)

  // Verify
  const [[after]] = await db.query("SHOW COLUMNS FROM scn_documents LIKE 'document_type'")
  const ok = after.Type.includes(NEW_VALUE)
  console.log('  ✓ updated:', after.Type)
  console.log(`  ✓ "${NEW_VALUE}" accepted:`, ok ? 'YES' : 'NO')
  console.log('\nDone.\n')
  process.exit(ok ? 0 : 1)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
