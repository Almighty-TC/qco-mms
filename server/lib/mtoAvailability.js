// ─── SHARED MTO-LINE AVAILABLE-QUANTITY ─────────────────────────────────────────
// getAvailableQty(lineId[, conn]) — PURE ARITHMETIC for an ALREADY-RESOLVED
// mto_lines.id. Contains ZERO scoping logic (no WBS / project / PO-assignment /
// discipline filtering, no decision about WHICH lines): the caller resolves its own
// candidate set first, then calls this per line id.
//
//   available = mto_lines.quantity
//             − Σ po_lines.qty              WHERE source_mto_line_id = lineId   (real PO consumption)
//             − Σ tender_line_items.qty_reserved WHERE mto_line_id = lineId AND status='active'
//
// Only status='active' reservations subtract (converted/released/partial_released do not).
// `conn` is optional — pass a transaction connection to compute inside a FOR UPDATE lock
// (enforcement path); it defaults to the shared pool for plain reads.
const pool = require('../db')

async function getAvailableQty(lineId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT
       m.quantity AS total_qty,
       COALESCE((SELECT SUM(p.qty) FROM po_lines p
                  WHERE p.source_mto_line_id = m.id), 0)                         AS po_assigned,
       COALESCE((SELECT SUM(t.qty_reserved) FROM tender_line_items t
                  WHERE t.mto_line_id = m.id AND t.status = 'active'), 0)        AS reserved
     FROM mto_lines m WHERE m.id = ?`,
    [lineId])
  if (!row) return null                                   // no such MTO line
  const total_qty   = row.total_qty == null ? null : Number(row.total_qty)
  const po_assigned = Number(row.po_assigned)
  const reserved    = Number(row.reserved)
  const available   = total_qty == null ? null : total_qty - po_assigned - reserved
  return { line_id: Number(lineId), total_qty, po_assigned, reserved, available }
}

module.exports = { getAvailableQty }
