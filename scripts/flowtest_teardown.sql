-- ZZ_FLOWTEST teardown (FK-safe). Run: mysql ... < scripts/flowtest_teardown.sql
-- Removes ALL ZZ_FLOWTEST data; canonical data untouched. (JS equivalent: node ../docs/flowtest/seed.cjs teardown)
--
-- ─── ADMIN / MIGRATION ONLY — must run as QCO_admin (TRIGGER + DELETE privilege) ──
-- The app credential (qmat_app) intentionally CANNOT run this: it has no TRIGGER/DROP
-- privilege and only SELECT,INSERT on the audit tables (see scripts/provision_app_user.sql).
-- audit_log / audit_review are append-only: BEFORE DELETE triggers (audit_log_bd,
-- audit_review_bd) SIGNAL '45000', so a plain DELETE is rejected by design. This script
-- is the ONE sanctioned path to remove rows from those tables — a privileged admin who
-- drops the guard, deletes ONLY disposable ZZ_FLOWTEST rows, then recreates the guard
-- BYTE-IDENTICAL to the C4 migration. The hash chain still detects any other tampering.
-- DO NOT use this pattern to weaken enforcement for normal operation; ZZ scope ONLY.
SET @pid = (SELECT id FROM projects WHERE code='ZZ_FLOWTEST');

-- ─── LIFT APPEND-ONLY ENFORCEMENT (admin-only, for the ZZ deletes below) ──────
-- Drop the BEFORE UPDATE/DELETE guards on both audit tables so the ZZ cleanup can run.
-- The BEFORE INSERT hashing triggers (audit_log_bi / audit_review_bi) are left intact —
-- we never disable hashing. These four are recreated verbatim at the end of this file.
DROP TRIGGER IF EXISTS audit_log_bu;
DROP TRIGGER IF EXISTS audit_log_bd;
DROP TRIGGER IF EXISTS audit_review_bu;
DROP TRIGGER IF EXISTS audit_review_bd;

-- ─── ZZ data deletes (FK-safe order: children before parents) ─────────────────
DELETE fil FROM fmr_issue_lines fil JOIN fmr_requests f ON f.id=fil.fmr_id WHERE f.project_id=@pid;
DELETE fl FROM fmr_lines fl JOIN fmr_requests f ON f.id=fl.fmr_id WHERE f.project_id=@pid;
DELETE FROM fmr_requests WHERE project_id=@pid;
DELETE FROM warehouse_transfers WHERE project_id=@pid;
DELETE FROM warehouse_stock WHERE project_id=@pid;
DELETE FROM receipt_lines WHERE project_id=@pid;
DELETE sh FROM scn_heats sh JOIN shipment_control_notes s ON s.id=sh.scn_id WHERE s.project_id=@pid;
DELETE sp FROM scn_packages sp JOIN shipment_control_notes s ON s.id=sp.scn_id WHERE s.project_id=@pid;
DELETE FROM shipment_control_notes WHERE project_id=@pid;
DELETE FROM traceability_certs WHERE project_id=@pid;
DELETE pl FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=@pid;
DELETE FROM purchase_orders WHERE project_id=@pid;
DELETE ml FROM mto_lines ml JOIN mto_registers m ON m.id=ml.mto_id WHERE m.project_id=@pid;
DELETE mr FROM mto_revisions mr JOIN mto_registers m ON m.id=mr.mto_id WHERE m.project_id=@pid;
DELETE FROM mto_registers WHERE project_id=@pid;
DELETE FROM equipment_list WHERE project_id=@pid;
DELETE FROM commodity_library WHERE project_id=@pid;
DELETE FROM user_wbs_access WHERE project_id=@pid;
DELETE FROM wbs_nodes WHERE project_id=@pid;
-- audit_review has no project_id; scope it via its parent audit_log row. Delete BEFORE
-- audit_log so the join can still resolve project_id (and to satisfy the FK to audit_log).
DELETE ar FROM audit_review ar JOIN audit_log a ON a.id=ar.audit_log_id WHERE a.project_id=@pid;
DELETE FROM audit_log WHERE project_id=@pid;
-- audit_checkpoint is not project-scoped, but checkpoints sealed by a ZZ user are ZZ-only
-- artefacts; remove them so the later users DELETE doesn't trip fk_ckpt_user (sealed_by).
-- Canonical checkpoints (sealed by canonical users / NULL) are left untouched.
DELETE c FROM audit_checkpoint c JOIN users u ON u.id=c.sealed_by WHERE u.email LIKE '%@zzflowtest.example';
DELETE FROM projects WHERE id=@pid;
DELETE FROM users WHERE email LIKE '%@zzflowtest.example';
DELETE FROM suppliers WHERE code LIKE 'ZZF-%';
DELETE FROM warehouses WHERE code LIKE 'ZZF-%';

-- ─── RESTORE APPEND-ONLY ENFORCEMENT (byte-identical to audit_chain_migrate.cjs c4) ──
-- Single-statement SIGNAL triggers (no BEGIN/END, no internal ';') so no DELIMITER needed.
-- Bodies MUST stay identical to the C4 generator or future verification can drift.
CREATE TRIGGER audit_log_bu BEFORE UPDATE ON audit_log FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only (tamper-evidence)';
CREATE TRIGGER audit_log_bd BEFORE DELETE ON audit_log FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only (tamper-evidence)';
CREATE TRIGGER audit_review_bu BEFORE UPDATE ON audit_review FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_review is append-only (tamper-evidence)';
CREATE TRIGGER audit_review_bd BEFORE DELETE ON audit_review FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_review is append-only (tamper-evidence)';
