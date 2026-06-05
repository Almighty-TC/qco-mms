-- ─── INDEX on po_lines.tag_number ───────────────────────────────────────────
-- The Equipment list computes "PO raised" via EXISTS(... po_lines WHERE
-- pl.tag_number = e.tag). Without this index that EXISTS full-scans po_lines for
-- every equipment row (≈3s for the counts query). Run as QCO_admin (DDL).
CREATE INDEX idx_pol_tag ON po_lines (tag_number);
