// ─── TAMPER-EVIDENCE MIGRATION (audit_log + audit_review) ─────────────────────
// Run from server/:  node ../scripts/audit_chain_migrate.cjs <step>
//   step = c1 (schema) | c2 (hashing triggers) | c3 (backfill) | c4 (enforcement)
// Each step is idempotent-ish and prints what it does. Pooled connection only.
// The CANONICAL row_hash expression lives in server/lib/auditChain.js and is the
// SINGLE source reused by the C2 trigger, the C3 backfill, and the C5 verify — any
// drift between them silently breaks verification, so they are all generated here.
const db = require('../server/db')

async function c1(conn) {
  // ── add row_hash columns (nullable; populated by trigger going forward, backfilled in C3) ──
  const colExists = async (tbl, col) => {
    const [[r]] = await conn.query(
      `SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`, [tbl, col])
    return r.n > 0
  }
  if (!await colExists('audit_log', 'row_hash'))
    await conn.query(`ALTER TABLE audit_log ADD COLUMN row_hash CHAR(64) NULL AFTER created_at`)
  if (!await colExists('audit_review', 'row_hash'))
    await conn.query(`ALTER TABLE audit_review ADD COLUMN row_hash CHAR(64) NULL AFTER review_note`)

  const [[t]] = await conn.query(`SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='audit_checkpoint'`)
  if (t.n === 0) {
    await conn.query(`CREATE TABLE audit_checkpoint (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      target     ENUM('audit_log','audit_review') NOT NULL,
      through_id INT NOT NULL,
      chain_head CHAR(64) NOT NULL,
      row_count  INT NOT NULL,
      sealed_by  INT NULL,
      sealed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_ckpt_user FOREIGN KEY (sealed_by) REFERENCES users(id),
      INDEX idx_ckpt_target (target, id)
    ) ENGINE=InnoDB`)
  }
  console.log('C1 applied: row_hash columns + audit_checkpoint table')
}

const STEPS = { c1 }

async function main() {
  const step = process.argv[2]
  if (!STEPS[step]) { console.error(`unknown step "${step}" — use one of: ${Object.keys(STEPS).join(', ')}`); process.exit(1) }
  const conn = await db.getConnection()
  try { await STEPS[step](conn) }
  catch (e) { console.error('MIGRATION FAILED:', e.message); process.exitCode = 1 }
  finally { conn.release(); process.exit() }
}
main()
