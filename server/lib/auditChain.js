// ─── AUDIT CHAIN — CANONICAL ROW_HASH EXPRESSION (single source) ──────────────
// THE hash expression for the tamper-evidence tier. Reused VERBATIM by:
//   • C2 the BEFORE INSERT triggers (prefix 'NEW.')
//   • C3 the one-time backfill              (no prefix)
//   • C5 the verify routine                 (no prefix)
// Any drift in field list / order / COALESCE / separator silently breaks
// verification — so all three are generated from rowHashExpr() below.
//
// Hashing rules (must stay stable forever once rows are chained):
//   - SHA2(…, 256) over CONCAT_WS('||', …) of the row's content fields, in the
//     exact order in FIELDS.
//   - Every field COALESCE'd to '∅' so NULLs hash unambiguously (and CONCAT_WS
//     never skips a NULL arg, which would shift the layout).
//   - EXCEPT the timestamp field (created_at / reviewed_at): it is set-if-null in
//     the trigger so it's always non-null, and is hashed raw (no COALESCE) — the
//     same stored value reproduces the same hash at backfill/verify.
//   - id is intentionally NOT hashed: row position is bound by the verify-time
//     chain (id order), so reordering/deletion is caught by the chain, not row_hash.

const FIELDS = {
  audit_log: [
    'user_id', 'action', 'entity_type', 'entity_id', 'project_id',
    'before_value', 'after_value', 'reason_category', 'reason_detail',
    'resource', 'ip', 'created_at',
  ],
  audit_review: [
    'audit_log_id', 'reviewed_by', 'review_status', 'review_note', 'reviewed_at',
  ],
}
// The trigger-managed timestamp per table (hashed raw, never COALESCE'd).
const TS_FIELD = { audit_log: 'created_at', audit_review: 'reviewed_at' }

// Build the SHA2 expression for a table. `prefix` is 'NEW.' inside a trigger, '' elsewhere.
function rowHashExpr(table, prefix = '') {
  const fields = FIELDS[table]
  if (!fields) throw new Error(`rowHashExpr: unknown table ${table}`)
  const ts = TS_FIELD[table]
  const parts = fields.map(f => (f === ts ? `${prefix}${f}` : `COALESCE(${prefix}${f},'∅')`))
  return `SHA2(CONCAT_WS('||', ${parts.join(', ')}), 256)`
}

// ─── CHAIN FOLD ──────────────────────────────────────────────
// Verify-time chain (decision (a)): walk rows in id order, fold each row_hash into
// the running head: head = SHA256(row_hash ‖ prev_head). Self-consistent (used by
// both seal and verify), independent of the SQL row_hash formula.
const crypto = require('crypto')
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const TABLES = new Set(['audit_log', 'audit_review'])

function foldChain(rowHashes) {
  let head = ''
  for (const rh of rowHashes) head = sha256(String(rh) + head)
  return head
}

// ─── SEAL CHECKPOINT ─────────────────────────────────────────
// Append an audit_checkpoint anchoring the chain head over [1..maxId] in id order.
async function sealCheckpoint(conn, table, sealedBy = null) {
  if (!TABLES.has(table)) throw new Error(`sealCheckpoint: bad table ${table}`)
  const [rows] = await conn.query(`SELECT id, row_hash FROM ${table} ORDER BY id`)
  const head = foldChain(rows.map(r => r.row_hash))
  const throughId = rows.length ? rows[rows.length - 1].id : 0
  await conn.query(
    `INSERT INTO audit_checkpoint (target, through_id, chain_head, row_count, sealed_by) VALUES (?,?,?,?,?)`,
    [table, throughId, head, rows.length, sealedBy])
  return { target: table, through_id: throughId, chain_head: head, row_count: rows.length }
}

// ─── VERIFY CHAIN ────────────────────────────────────────────
// (1) content integrity: re-hash each row IN SQL with the canonical expression →
//     pinpoint the first row whose stored row_hash ≠ recompute (tampering).
// (2) chain integrity: re-fold rows up to the latest checkpoint's through_id and
//     compare head + row_count → catches deletion/truncation since the seal.
async function verifyChain(conn, table) {
  if (!TABLES.has(table)) throw new Error(`verifyChain: bad table ${table}`)
  const expr = rowHashExpr(table, '')
  const [[ct]] = await conn.query(
    `SELECT MIN(id) AS broken, COUNT(*) AS total FROM ${table} WHERE row_hash IS NULL OR row_hash <> ${expr}`)
  const contentBrokenId = ct.broken ?? null
  const [[cp]] = await conn.query(
    `SELECT * FROM audit_checkpoint WHERE target=? ORDER BY id DESC LIMIT 1`, [table])
  let chain = { sealed: false }
  if (cp) {
    const [rows] = await conn.query(`SELECT row_hash FROM ${table} WHERE id <= ? ORDER BY id`, [cp.through_id])
    const head = foldChain(rows.map(r => r.row_hash))
    chain = {
      sealed: true, checkpoint_id: cp.id, sealed_at: cp.sealed_at, through_id: cp.through_id,
      head_match: head === cp.chain_head, row_count_match: rows.length === cp.row_count,
      expected_head: cp.chain_head, actual_head: head,
      expected_rows: cp.row_count, actual_rows: rows.length,
      ok: head === cp.chain_head && rows.length === cp.row_count,
    }
  }
  const ok = contentBrokenId == null && (!cp || chain.ok)
  // best pinpoint: exact row for content tamper; else the checkpoint window for a chain break
  const brokenAtId = contentBrokenId != null ? contentBrokenId : (cp && !chain.ok ? cp.through_id : null)
  return { table, status: ok ? 'verified' : 'broken', brokenAtId, contentBrokenId, chain }
}

module.exports = { FIELDS, TS_FIELD, rowHashExpr, sha256, foldChain, sealCheckpoint, verifyChain }
