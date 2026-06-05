-- ─── SCN CARGO READY / COLLECTION DATES ─────────────────────────────────────
-- Adds two operational dates to the Shipment Control Note shown in the Logistics
-- detail info box (before ETD/ETA):
--   cargo_ready_date      (CRD) — when the goods are ready at origin
--   cargo_collection_date (CCD) — when the forwarder collects them
-- Run as QCO_admin (DDL). App user (qmat_app) already has UPDATE on the table.

ALTER TABLE shipment_control_notes
  ADD COLUMN cargo_ready_date      DATE NULL AFTER incoterms,
  ADD COLUMN cargo_collection_date DATE NULL AFTER cargo_ready_date;
