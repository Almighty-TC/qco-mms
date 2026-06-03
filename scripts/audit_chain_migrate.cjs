// ─── TAMPER-EVIDENCE MIGRATION (audit_log + audit_review) ─────────────────────
// Run from server/:  node ../scripts/audit_chain_migrate.cjs <step>
//   step = c1 (schema) | c2 (hashing triggers) | c3 (backfill) | c4 (enforcement)
// Each step is idempotent-ish and prints what it does. Pooled connection only.
// The CANONICAL row_hash expression lives in server/lib/auditChain.js and is the
// SINGLE source reused by the C2 trigger, the C3 backfill, and the C5 verify — any
// drift between them silently breaks verification, so they are all generated here.
const db = require('../server/db')
const { rowHashExpr, TS_FIELD } = require('../server/lib/auditChain')

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

// ── C2: BEFORE INSERT triggers compute row_hash from the canonical expression ──
// Centralised hashing → ZERO changes to any of the 17 audit writers; works for
// fire-and-forget AND transactional inserts; written atomically in the insert
// (no post-insert UPDATE → append-only-safe).
async function c2(conn) {
  for (const table of ['audit_log', 'audit_review']) {
    const ts = TS_FIELD[table]
    const expr = rowHashExpr(table, 'NEW.')
    await conn.query(`DROP TRIGGER IF EXISTS ${table}_bi`)
    await conn.query(
      `CREATE TRIGGER ${table}_bi BEFORE INSERT ON ${table} FOR EACH ROW
       BEGIN
         IF NEW.${ts} IS NULL THEN SET NEW.${ts} = NOW(); END IF;
         SET NEW.row_hash = ${expr};
       END`)
    console.log(`C2 applied: ${table}_bi BEFORE INSERT trigger (sets ${ts} if null, computes row_hash)`)
  }
}

const STEPS = { c1, c2 }

async function main() {
  const step = process.argv[2]
  if (!STEPS[step]) { console.error(`unknown step "${step}" — use one of: ${Object.keys(STEPS).join(', ')}`); process.exit(1) }
  const conn = await db.getConnection()
  try { await STEPS[step](conn) }
  catch (e) { console.error('MIGRATION FAILED:', e.message); process.exitCode = 1 }
  finally { conn.release(); process.exit() }
}
main()
