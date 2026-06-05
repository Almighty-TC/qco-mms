-- ─── Expeditor: logistics edit (confirm arrival / update SCN) ──
-- Expeditors track shipments alongside logistics, so they must be able to
-- confirm an SCN has arrived at destination (advance in_transit → customs
-- review) and update shipment dates. This grants can_edit on the logistics
-- module; can_create stays with managers. expediting_manager / logistics_*
-- already had edit. Applied via qmat_app (DML on role_permissions).
UPDATE role_permissions SET can_edit = 1 WHERE module = 'logistics' AND role = 'expeditor';
