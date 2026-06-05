-- ─── WAREHOUSE PROJECT OWNERSHIP ────────────────────────────────────────────
-- Multi-project: each warehouse is owned by ONE project, so a project's pickers
-- (SCN destination, transfers, receipting) only list warehouses it owns.
-- Run as QCO_admin (DDL + FK). Back-fill maps existing warehouses by actual usage:
--   canonical PLY/BRS/SLP/MLC/DPS (id 1-5) → project 1
--   ZZF-WH1/2/3 (id 50-52)               → project 16 (ZZ_FLOWTEST)
-- project_id stays NULLable: a NULL warehouse is simply unassigned (shows in no
-- project picker) rather than blocking inserts.

ALTER TABLE warehouses
  ADD COLUMN project_id INT NULL AFTER id,
  ADD KEY idx_wh_project (project_id),
  ADD CONSTRAINT fk_wh_project FOREIGN KEY (project_id) REFERENCES projects(id);

UPDATE warehouses SET project_id = 1  WHERE id IN (1, 2, 3, 4, 5);
UPDATE warehouses SET project_id = 16 WHERE id IN (50, 51, 52);
