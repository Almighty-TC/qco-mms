// ─── MIGRATE: scn_lines + scn_package_lines (structured packing contents) ─────
// Stage 1 of the SCN per-package contents feature (TC-approved wireframe deviation).
//   scn_lines         — per-SCN line allocation (how much of each line is on THIS SCN)
//   scn_package_lines — contents within a package, referencing a scn_line
// Additive + reversible. Reverse (child first due to FK):
//   DROP TABLE IF EXISTS scn_package_lines; DROP TABLE IF EXISTS scn_lines;
//
// qty DECIMAL(10,3) + uom VARCHAR(20) match po_lines.qty / scn_additional_items.qty.
// All referenced PKs are INT. FKs cascade so deleting an SCN/package/scn_line cleans
// up dependents. Idempotent (skips tables that already exist).
//
// DDL — qmat_app has no DDL, so run as QCO_admin. Creds from the gitignored
// server/.env.admin (DB_ADMIN_USER / DB_ADMIN_PASSWORD), never committed:
//   node server/scripts/migrate-scn-packing-contents.js
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
require('dotenv').config({ path: path.join(__dirname, '../.env.admin') }) // admin creds (override)
const mysql = require('mysql2/promise')

const db = mysql.createPool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
  user: process.env.DB_ADMIN_USER || 'QCO_admin', password: process.env.DB_ADMIN_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2,
})

const DDL_SCN_LINES = `CREATE TABLE scn_lines (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  scn_id              INT NOT NULL,
  po_line_id          INT NULL,
  additional_item_id  INT NULL,
  qty                 DECIMAL(10,3) NOT NULL,
  uom                 VARCHAR(20) NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_scnlines_scn     FOREIGN KEY (scn_id)             REFERENCES shipment_control_notes(id) ON DELETE CASCADE,
  CONSTRAINT fk_scnlines_poline  FOREIGN KEY (po_line_id)         REFERENCES po_lines(id)               ON DELETE CASCADE,
  CONSTRAINT fk_scnlines_additem FOREIGN KEY (additional_item_id) REFERENCES scn_additional_items(id)   ON DELETE CASCADE,
  CONSTRAINT chk_scnlines_one_ref CHECK ((po_line_id IS NOT NULL) <> (additional_item_id IS NOT NULL)),
  INDEX idx_scnlines_scn (scn_id)
) ENGINE=InnoDB`

const DDL_SCN_PACKAGE_LINES = `CREATE TABLE scn_package_lines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  package_id   INT NOT NULL,
  scn_line_id  INT NOT NULL,
  qty          DECIMAL(10,3) NOT NULL,
  uom          VARCHAR(20) NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pkglines_pkg     FOREIGN KEY (package_id)  REFERENCES scn_packages(id) ON DELETE CASCADE,
  CONSTRAINT fk_pkglines_scnline FOREIGN KEY (scn_line_id) REFERENCES scn_lines(id)     ON DELETE CASCADE,
  INDEX idx_pkglines_pkg (package_id),
  INDEX idx_pkglines_scnline (scn_line_id)
) ENGINE=InnoDB`

async function ensure(table, ddl) {
  const [rows] = await db.query('SHOW TABLES LIKE ?', [table])
  if (rows.length) { console.log(`  • ${table} already exists — skipping`); return }
  console.log(`\n  Executing DDL:\n${ddl}\n`)
  await db.query(ddl)
  console.log(`  ✓ ${table} created`)
}

// New tables created by QCO_admin are NOT usable by the runtime app user until granted.
// Grant the app the same CRUD it has on the other SCN tables. Runs every time (idempotent).
async function grantApp() {
  const appUser = process.env.DB_USER || 'qmat_app'
  for (const t of ['scn_lines', 'scn_package_lines']) {
    await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${process.env.DB_NAME}\`.\`${t}\` TO '${appUser}'@'%'`)
    console.log(`  ✓ granted SELECT,INSERT,UPDATE,DELETE on ${t} to ${appUser}@%`)
  }
  await db.query('FLUSH PRIVILEGES')
}

async function run() {
  console.log('\nMigrating: scn_lines + scn_package_lines (packing contents schema)…')
  await ensure('scn_lines', DDL_SCN_LINES)            // parent first (scn_package_lines FKs it)
  await ensure('scn_package_lines', DDL_SCN_PACKAGE_LINES)
  console.log('\n  Granting runtime app access:')
  await grantApp()

  // Verify
  for (const t of ['scn_lines', 'scn_package_lines']) {
    const [[exists]] = await db.query('SHOW TABLES LIKE ?', [t])
    const [cols] = await db.query(`SHOW COLUMNS FROM ${t}`)
    console.log(`\n  ${t}: ${exists ? 'present' : 'MISSING'} — columns: ${cols.map(c => c.Field).join(', ')}`)
  }
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e.message); process.exit(1) })
