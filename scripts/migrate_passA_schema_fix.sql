-- PASS A schema-drift fix (run as QCO_admin — qmat_app has no DDL).
-- Brings two tables in line with what the app (frontend + backend) already expects,
-- fixing two real runtime crashes the PASS A sweep found:
--   1. po_variations INSERT (procurement.js) references value_impact / schedule_impact_days
--      that don't exist → raising a PO variation 500s.
--   2. supplier_addresses INSERT/READ (admin.js) + the Admin supplier form use
--      address_line1/address_line2/label/is_pickup/notes; the table only had line1/line2
--      → saving/loading a supplier address fails. (expediting.js read + the flowtest seed
--      are updated in the same change to use the renamed columns.)
-- Additive + rename-with-data-preserved only; no row deletes, canonical row counts unchanged.

-- ── po_variations: add the impact columns the UI collects + displays ──
ALTER TABLE po_variations
  ADD COLUMN value_impact          DECIMAL(15,2) NULL AFTER reason,
  ADD COLUMN schedule_impact_days  INT           NULL AFTER value_impact;

-- ── supplier_addresses: unify on the app's column names + add the missing fields ──
ALTER TABLE supplier_addresses
  CHANGE COLUMN line1 address_line1 VARCHAR(255) NULL,
  CHANGE COLUMN line2 address_line2 VARCHAR(255) NULL,
  ADD COLUMN label     VARCHAR(100) NULL    AFTER supplier_id,
  ADD COLUMN is_pickup TINYINT(1)   NOT NULL DEFAULT 0 AFTER is_primary,
  ADD COLUMN notes     TEXT         NULL;
