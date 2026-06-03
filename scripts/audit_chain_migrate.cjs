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

// ── C3: one-time backfill of row_hash over EXISTING audit_log rows ──
// MUST run before C4 (enforcement blocks UPDATE). project_id-backfill discipline:
// changes ONLY row_hash; proves row count unchanged + every other column identical.
async function c3(conn) {
  const expr = rowHashExpr('audit_log', '')
  // snapshot of ALL columns EXCEPT row_hash (order-stable, id-ordered)
  const SNAP = `SELECT MD5(GROUP_CONCAT(MD5(CONCAT_WS('|',
      id, COALESCE(user_id,'∅'), COALESCE(action,'∅'), COALESCE(entity_type,'∅'),
      COALESCE(entity_id,'∅'), COALESCE(project_id,'∅'), COALESCE(before_value,'∅'),
      COALESCE(after_value,'∅'), COALESCE(reason_category,'∅'), COALESCE(reason_detail,'∅'),
      COALESCE(resource,'∅'), COALESCE(ip,'∅'), created_at)) ORDER BY id)) AS snap
    FROM audit_log`
  await conn.query('SET SESSION group_concat_max_len = 100000000')
  const [[before]] = await conn.query('SELECT COUNT(*) c, SUM(row_hash IS NULL) nullh FROM audit_log')
  const [[snapBefore]] = await conn.query(SNAP)

  const [r] = await conn.query(`UPDATE audit_log SET row_hash = ${expr} WHERE row_hash IS NULL`)

  const [[after]] = await conn.query('SELECT COUNT(*) c, SUM(row_hash IS NULL) nullh FROM audit_log')
  const [[snapAfter]] = await conn.query(SNAP)
  const [[bad]] = await conn.query(`SELECT COUNT(*) c FROM audit_log WHERE row_hash <> ${expr} OR row_hash IS NULL`)

  console.log(`C3 backfill: updated ${r.affectedRows} rows`)
  console.log(`  row count: ${before.c} -> ${after.c}  ${before.c === after.c ? '✓ unchanged' : '✗ CHANGED'}`)
  console.log(`  row_hash NULL: ${before.nullh} -> ${after.nullh}  ${after.nullh == 0 ? '✓ all populated' : '✗'}`)
  console.log(`  other-columns checksum: ${snapBefore.snap === snapAfter.snap ? '✓ IDENTICAL (only row_hash changed)' : '✗ OTHER COLUMNS MOVED'}`)
  console.log(`    before=${snapBefore.snap}`)
  console.log(`    after =${snapAfter.snap}`)
  console.log(`  rows failing re-verify: ${bad.c}  ${bad.c == 0 ? '✓ all re-hash-verify' : '✗'}`)
}

const STEPS = { c1, c2, c3 }

async function main() {
  const step = process.argv[2]
  if (!STEPS[step]) { console.error(`unknown step "${step}" — use one of: ${Object.keys(STEPS).join(', ')}`); process.exit(1) }
  const conn = await db.getConnection()
  try { await STEPS[step](conn) }
  catch (e) { console.error('MIGRATION FAILED:', e.message); process.exitCode = 1 }
  finally { conn.release(); process.exit() }
}
main()
