// ─── MIGRATE: scn_heats (Heat/Lot Phase 1) ───────────────────
// Run once: node server/scripts/migrate-scn-heats.js
// Additive & idempotent. Creates the per-shipment heat list captured at SCN
// creation — the SOURCE the receipting heat dropdown (P2) will read from.
// Keyed to the SCN (shipment-level); po_line_id is an optional finer tie.
// FK uses ON DELETE RESTRICT (NOT cascade): heat records are material-identity /
// traceability data and must not silently vanish when an SCN is removed.
// Reversible: DROP TABLE scn_heats.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function tableExists(table) {
  const [[r]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`, [table])
  return r.n > 0
}

async function run() {
  console.log('\nMigrating scn_heats…\n')
  if (await tableExists('scn_heats')) {
    console.log('  • scn_heats present — nothing to do')
  } else {
    await db.query(`
      CREATE TABLE scn_heats (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        scn_id         INT NOT NULL,
        heat_number    VARCHAR(100) NOT NULL,
        material_grade VARCHAR(100) NULL,
        mill_cert_ref  VARCHAR(255) NULL,
        source         VARCHAR(50)  NULL,
        po_line_id     INT NULL,
        created_by     INT NULL,
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_scn_heat (scn_id, heat_number),
        KEY idx_scn (scn_id),
        CONSTRAINT fk_scn_heats_scn FOREIGN KEY (scn_id)
          REFERENCES shipment_control_notes(id) ON DELETE RESTRICT
      )`)
    console.log('  ✓ scn_heats created (UNIQUE(scn_id,heat_number), FK ON DELETE RESTRICT)')
  }
  console.log('\nDone.\n')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
