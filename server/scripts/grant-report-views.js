// ─── ADMIN: Reports saved views — report_saved_views and the app login's grants ──
// The Reports module's saved views (routes/reports.js GET, POST /:projectId/views and
// DELETE /:projectId/views/:id) need the report_saved_views table and SELECT, INSERT and
// DELETE on it for the app login. qmat_app holds no privilege on it (3T144), so each of
// those routes answers 500. This script:
//   (a) creates report_saved_views when it does not exist in the schema, with the DDL
//       copied exactly from migrate-report-views.js;
//   (b) GRANT SELECT, INSERT, DELETE ON `qmat`.`report_saved_views` TO 'qmat_app'@'%'
//       — only these three (the routes use no UPDATE) — skipped when SHOW GRANTS FOR
//       'qmat_app'@'%' already shows all three for the table.
//
// Capability-detected (idempotent), safe to re-run. --dry-run prints each statement it
// would run and changes nothing. The verify step prints the table's columns, its row
// count and the app login's grants line for it; after a real run it exits 1 if the table
// or any of the three privileges is missing.
//
// REVERSE (documented):
//   REVOKE SELECT, INSERT, DELETE ON `qmat`.`report_saved_views` FROM 'qmat_app'@'%';
//   DROP TABLE report_saved_views;   -- only if this script created it and it is still empty
//
// DDL and GRANT — qmat_app has neither, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/grant-report-views.js --dry-run
//   node server/scripts/grant-report-views.js  (then delete server/.env.admin)
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
require('dotenv').config({ path: path.join(__dirname, '../.env.admin') }) // admin creds (override)
const mysql = require('mysql2/promise')

const DRY = process.argv.includes('--dry-run')

if (!process.env.DB_ADMIN_PASSWORD) {
  console.error('No DB_ADMIN_PASSWORD — create server/.env.admin (supply-and-remove). Aborting.')
  process.exit(1)
}

const db = mysql.createPool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin', password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2,
})

// Copied exactly from migrate-report-views.js (the table the Reports routes read and write).
const DDL = `CREATE TABLE IF NOT EXISTS report_saved_views (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  dataset_id VARCHAR(64) NOT NULL,
  config_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rsv_owner (user_id, project_id),
  KEY idx_rsv_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`

const SCHEMA = 'qmat'
const APP_LOGIN = "'qmat_app'@'%'"
const PRIVS = ['SELECT', 'INSERT', 'DELETE']   // what the routes use; never UPDATE
const GRANT = `GRANT ${PRIVS.join(', ')} ON \`${SCHEMA}\`.\`report_saved_views\` TO ${APP_LOGIN}`

async function tableExists() {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = ? AND table_name = 'report_saved_views'`, [SCHEMA])
  return r.n > 0
}
// The app login's grant lines that give it any of PRIVS on the table (table, schema or
// global level; a bare USAGE line is left out), and which of PRIVS it still lacks.
async function appGrants() {
  const [rows] = await db.query(`SHOW GRANTS FOR ${APP_LOGIN}`)
  const covers = l => l.includes(`ON \`${SCHEMA}\`.\`report_saved_views\` TO`) || l.includes(`ON \`${SCHEMA}\`.* TO`) || l.includes('ON *.* TO')
  const privs = new Set(), lines = []
  for (const l of rows.map(r => Object.values(r)[0])) {
    const m = /^GRANT (.+?) ON /.exec(l)
    if (!m || !covers(l)) continue
    const p = m[1].split(',').map(x => x.trim().toUpperCase())
    if (!p.some(x => PRIVS.includes(x) || x === 'ALL PRIVILEGES' || x === 'ALL')) continue
    p.forEach(x => privs.add(x)); lines.push(l)
  }
  const has = p => privs.has(p) || privs.has('ALL PRIVILEGES') || privs.has('ALL')
  return { lines, missing: PRIVS.filter(p => !has(p)) }
}

// One step: skip when present; with --dry-run print the statement; otherwise run it.
async function step(present, label, sql, done) {
  if (present) { console.log(`  • ${label} present — skip`); return }
  if (DRY) { console.log(`  would run: ${sql}`); return }
  await db.query(sql)
  console.log(`  ✓ ${done}`)
}

async function run() {
  console.log(`\nReports saved views — report_saved_views and ${APP_LOGIN}${DRY ? ' (dry run: nothing is changed)' : ''}…\n`)

  // Pre-check (read-only): the connection's schema is the one the GRANT names.
  const [[d]] = await db.query('SELECT DATABASE() AS d')
  console.log(`  schema ${d.d || 'NONE'}`)
  if (d.d !== SCHEMA) {
    console.error(`  Pre-check failed: connected to ${d.d || 'no schema'}, not ${SCHEMA}. Aborting; nothing changed.`)
    process.exit(1)
  }

  const existed = await tableExists()
  await step(existed, 'report_saved_views', DDL, 'report_saved_views created')
  const before = await appGrants()
  await step(before.missing.length === 0, `${PRIVS.join(', ')} for ${APP_LOGIN}`, GRANT,
    `granted ${PRIVS.join(', ')} on report_saved_views to ${APP_LOGIN}`)

  console.log('\n Verify:')
  const table = await tableExists()
  const absent = DRY ? 'absent (dry run)' : 'MISSING'
  if (table) {
    const [cols] = await db.query(
      `SELECT column_name AS c, column_type AS t FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'report_saved_views' ORDER BY ordinal_position`, [SCHEMA])
    const [[cnt]] = await db.query('SELECT COUNT(*) AS n FROM report_saved_views')
    console.log(`  columns: ${cols.map(c => `${c.c} ${c.t}`).join(', ')}`)
    console.log(`  rows: ${cnt.n}`)
  } else {
    console.log(`  report_saved_views: ${absent}`)
  }
  const after = await appGrants()
  console.log(`  grants: ${after.lines.length ? after.lines.join(' | ') : 'none for report_saved_views'}`)
  if (after.missing.length) console.log(`  missing for ${APP_LOGIN}: ${after.missing.join(', ')}${DRY ? ' (dry run)' : ''}`)
  if (!existed && table) console.log('  report_saved_views was created by this run — reverse: DROP TABLE only while it is empty')
  console.log('\nDone.\n')
  process.exit(DRY || (table && after.missing.length === 0) ? 0 : 1)
}
run().catch(e => { console.error('Script failed:', e.message); process.exit(1) })
