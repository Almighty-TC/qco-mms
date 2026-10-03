// ─── SHARED MTO-LINE AVAILABLE-QUANTITY ─────────────────────────────────────────
// getAvailableQty(lineId[, conn]) — PURE ARITHMETIC for an ALREADY-RESOLVED
// mto_lines.id. Contains ZERO scoping logic (no WBS / project / PO-assignment /
// discipline filtering, no decision about WHICH lines): the caller resolves its own
// candidate set first, then calls this per line id.
//
// Revision-aware (§12 option A): the line's KEY is (mto_id, line_number) of the given id —
// that line's row in every revision. The quantity comes from the key's CURRENT-revision row
// (mto_registers.current_revision, is_deleted = 0); consumption counts on ALL the key's rows:
//
//   available = current-row quantity
//             − Σ po_lines.qty              WHERE source_mto_line_id IN (the key's rows)  (real PO consumption)
//             − Σ tender_line_items.qty_reserved WHERE mto_line_id IN (the key's rows) AND status='active'
//
// No current row (the line was removed from, or deleted in, the current revision) → total_qty
// and available are null. Only status='active' reservations subtract (converted/released/
// partial_released do not). `conn` is optional — pass a transaction connection to compute inside
// the key-row lock (enforcement path); it defaults to the shared pool for plain reads.
const pool = require('../db')

// The key's current-revision row id, for an mto_lines row aliased `m` (correlated subquery).
const CURRENT_ROW_SQL =
  `(SELECT c.id FROM mto_lines c JOIN mto_registers cr ON cr.id = c.mto_id
     WHERE c.mto_id = m.mto_id AND c.line_number = m.line_number
       AND c.revision = cr.current_revision AND c.is_deleted = 0
     ORDER BY c.id DESC LIMIT 1)`

async function getAvailableQty(lineId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT
       (SELECT q.quantity FROM mto_lines q WHERE q.id = ${CURRENT_ROW_SQL})      AS total_qty,
       COALESCE((SELECT SUM(p.qty) FROM po_lines p JOIN mto_lines k ON k.id = p.source_mto_line_id
                  WHERE k.mto_id = m.mto_id AND k.line_number = m.line_number), 0) AS po_assigned,
       COALESCE((SELECT SUM(t.qty_reserved) FROM tender_line_items t JOIN mto_lines k ON k.id = t.mto_line_id
                  WHERE k.mto_id = m.mto_id AND k.line_number = m.line_number
                    AND t.status = 'active'), 0)                                   AS reserved
     FROM mto_lines m WHERE m.id = ?`,
    [lineId])
  if (!row) return null                                   // no such MTO line
  const total_qty   = row.total_qty == null ? null : Number(row.total_qty)
  const po_assigned = Number(row.po_assigned)
  const reserved    = Number(row.reserved)
  const available   = total_qty == null ? null : total_qty - po_assigned - reserved
  return { line_id: Number(lineId), total_qty, po_assigned, reserved, available }
}

// keyInfo(ids[, conn]) — per mto_lines.id: its key (mto_id, line_number), its revision, the
// register's current revision and the key's current-revision row id (null = removed from the
// current revision). A plain read; call it after lockKeyRows when the answer must hold.
async function keyInfo(ids, conn = pool) {
  if (!ids.length) return new Map()
  const [rows] = await conn.query(
    `SELECT m.id, m.mto_id, m.line_number, m.revision, m.description, m.uom, r.current_revision,
            ${CURRENT_ROW_SQL} AS current_line_id
       FROM mto_lines m JOIN mto_registers r ON r.id = m.mto_id
      WHERE m.id IN (${ids.map(() => '?').join(',')})`, ids)
  return new Map(rows.map(r => [r.id, r]))
}

// lockKeyRows(conn, keys) — THE key-row lock (§12 lock L2, TC 2026-10-03). Rule: the tender row
// first, then the key rows in index order (mto_id, line_number, id), and never a join. All the
// requested keys go in ONE statement. InnoDB takes row locks in the order it scans, so FORCE INDEX
// pins the scan to idx_mtol_mto_line and the ORDER BY matches that index (an ORDER BY alone does
// not set the lock order). Every route that locks key rows must use this helper — reserve-lines
// and generate-po do. keys: [{ mto_id, line_number }]. Returns the locked row ids.
async function lockKeyRows(conn, keys) {
  const uniq = [...new Map(keys.map(k => [`${k.mto_id}|${k.line_number}`, k])).values()]
  if (!uniq.length) return []
  const [rows] = await conn.query(
    `SELECT id FROM mto_lines FORCE INDEX (idx_mtol_mto_line)
      WHERE (mto_id, line_number) IN (${uniq.map(() => '(?,?)').join(',')})
      ORDER BY mto_id, line_number, id FOR UPDATE`,
    uniq.flatMap(k => [k.mto_id, k.line_number]))
  return rows.map(r => r.id)
}

module.exports = { getAvailableQty, keyInfo, lockKeyRows }
