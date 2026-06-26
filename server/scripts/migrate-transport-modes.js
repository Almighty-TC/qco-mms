// ─── MIGRATE: Multi-modal transport (additive) ────────────────────────────────
// Pass 2 Item 2. The SCN wizard has a Multi-modal option (constituent legs + leg notes)
// but shipment_control_notes.mode is enum('air','sea','road','rail','courier') — no 'multi'
// value — and there's nowhere to store the legs. This adds:
//   mode                += 'multi'  (so mode='multi' is the primary indicator — backward
//                                    compatible: every existing mode-reader/filter still works)
//   transport_modes       VARCHAR(100) NULL  — constituent legs, comma-joined e.g. 'sea,road'
//   transport_mode_notes  TEXT NULL          — free-text leg detail ("Sea to Singapore, road to site")
//
// `mode` is purely descriptive (display + the logistics register filter) — no status/business
// logic keys off it (map-confirmed), so adding an enum value is safe. Additive, nullable, no
// backfill. App capability-detects the new columns (Q2/Q3/Q4/delegation pattern).
//
// REVERSE (documented):
//   ALTER TABLE shipment_control_notes
//     DROP COLUMN transport_mode_notes,
//     DROP COLUMN transport_modes,
//     MODIFY COLUMN mode ENUM('air','sea','road','rail','courier') DEFAULT 'sea';
//   (only safe to drop 'multi' from the enum once no rows use it.)
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), SUPPLY-AND-REMOVE per run:
//   node server/scripts/migrate-transport-modes.js   (then delete server/.env.admin)
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
require('dotenv').config({ path: path.join(__dirname, '../.env.admin') }) // admin creds (override)
const mysql = require('mysql2/promise')

if (!process.env.DB_ADMIN_PASSWORD) {
  console.error('No DB_ADMIN_PASSWORD — create server/.env.admin (supply-and-remove). Aborting (not self-applying).')
  process.exit(1)
}

const db = mysql.createPool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin', password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2,
})

async function columnExists(table, column) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r.n > 0
}
async function columnType(table, column) {
  const [[r]] = await db.query(
    `SELECT column_type AS t FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column])
  return r ? r.t : ''
}
async function addColumn(table, column, ddl) {
  if (await columnExists(table, column)) { console.log(`  • ${table}.${column} present — skip`); return }
  await db.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  console.log(`  ✓ ${table}.${column} added`)
}

async function run() {
  console.log('\nMigrating: Multi-modal transport…\n')
  const T = 'shipment_control_notes'

  // 1) mode enum += 'multi' (idempotent — skip if already present).
  console.log(' mode enum:')
  const mt = await columnType(T, 'mode')
  if (/'multi'/.test(mt)) {
    console.log("  • 'multi' already in mode enum — skip")
  } else {
    await db.query(`ALTER TABLE ${T} MODIFY COLUMN mode ENUM('air','sea','road','rail','courier','multi') DEFAULT 'sea'`)
    console.log("  ✓ 'multi' added to mode enum")
  }

  // 2) constituent legs + leg notes (additive, nullable).
  console.log(' columns:')
  await addColumn(T, 'transport_modes', "transport_modes VARCHAR(100) NULL AFTER mode")
  await addColumn(T, 'transport_mode_notes', "transport_mode_notes TEXT NULL AFTER transport_modes")

  // qmat_app inherits the table grants — no new grant needed.

  console.log('\n Verify:')
  console.log('  mode enum:', await columnType(T, 'mode'))
  for (const c of ['transport_modes', 'transport_mode_notes']) {
    console.log(`  ${T}.${c}: ${(await columnExists(T, c)) ? 'present' : 'MISSING'}`)
  }
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
