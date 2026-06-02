-- Commit 3: linked off-PO variation on scn_additional_items.
-- parent_po_line_id is NULL-able (existing rows have no parent; the endpoint enforces
-- the required link for NEW variations — cannot NOT NULL without backfilling existing rows).
ALTER TABLE scn_additional_items ADD COLUMN parent_po_line_id INT NULL AFTER scn_id;
ALTER TABLE scn_additional_items ADD COLUMN is_variation TINYINT(1) NOT NULL DEFAULT 0 AFTER parent_po_line_id;
ALTER TABLE scn_additional_items ADD CONSTRAINT fk_sai_parent FOREIGN KEY (parent_po_line_id) REFERENCES po_lines(id);
