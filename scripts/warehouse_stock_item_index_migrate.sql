-- ─── INDEX on warehouse_stock(project_id, item_code) ────────────────────────
-- The FMR register's stock_on_hand subquery and the Stock register filter by
-- item_code within a project; item_code was unindexed (only project_id existed),
-- so those lookups scanned all of a project's stock rows. Run as QCO_admin.
CREATE INDEX idx_ws_proj_item ON warehouse_stock (project_id, item_code);
