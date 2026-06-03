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

module.exports = { FIELDS, TS_FIELD, rowHashExpr }
