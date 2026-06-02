-- A (C-d follow): add the multi-level approval statuses the approve handler writes
-- (were missing → over-threshold PO approval 500'd for all roles). Preserves existing values + default.
ALTER TABLE purchase_orders
  MODIFY status ENUM('rfq','loa','po-raised','active','closed','cancelled','pending_approval','pending_director_approval') DEFAULT 'rfq';
