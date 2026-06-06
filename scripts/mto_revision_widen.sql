-- Revisions can be letters, numbers, or combinations (e.g. A, 1, 2A, R0, 01).
-- Widen the columns so they're not constrained to short alpha revisions.
ALTER TABLE mto_registers MODIFY COLUMN current_revision VARCHAR(10) DEFAULT 'A';
ALTER TABLE mto_lines     MODIFY COLUMN revision         VARCHAR(10) NOT NULL;
ALTER TABLE mto_revisions MODIFY COLUMN revision         VARCHAR(10) NOT NULL;

-- The upload flow now reconciles revision line-counts in place (initial-population
-- fill), so the app user needs UPDATE on the revision log. Run as QCO_admin.
GRANT UPDATE ON `qmat`.`mto_revisions` TO 'qmat_app'@'%';
FLUSH PRIVILEGES;
