-- ─── SCN customs clearance gate ──────────────────────────────
-- Tracks whether a shipment has been cleared through customs. Set when a user
-- moves an SCN out of customs_review (ticking "Customs cleared"); required
-- before the SCN can be marked delivered. Awareness for shipments stuck at customs.
ALTER TABLE shipment_control_notes
  ADD COLUMN customs_cleared TINYINT(1) NOT NULL DEFAULT 0 AFTER ata,
  ADD COLUMN customs_cleared_date DATE NULL AFTER customs_cleared,
  ADD COLUMN customs_cleared_by INT NULL AFTER customs_cleared_date;
-- Back-fill: anything already past customs (delivered/received/closed/arrived) is cleared.
UPDATE shipment_control_notes
  SET customs_cleared = 1, customs_cleared_date = COALESCE(ata, CURDATE())
  WHERE status IN ('arrived','received','closed','partially_received') AND customs_cleared = 0;
