-- ZZ_FLOWTEST teardown (FK-safe). Run: mysql ... < scripts/flowtest_teardown.sql
-- Removes ALL ZZ_FLOWTEST data; canonical data untouched. (JS equivalent: node docs/flowtest/seed.cjs teardown)
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
-- Order derived from information_schema FK map. Every statement is scoped to @pid or a
-- ZZ marker (@zzflowtest.example users / ZZF- supplier+warehouse codes). NEVER unscoped.

-- expediting forecast history (polymorphic entity_type/entity_id, no FK) — best-effort by ZZ author
DELETE FROM expediting_forecast_history WHERE changed_by IN (SELECT id FROM users WHERE email LIKE '%@zzflowtest.example');

-- FMR (issue lines -> lines -> requests)
DELETE fil FROM fmr_issue_lines fil JOIN fmr_requests f ON f.id=fil.fmr_id WHERE f.project_id=@pid;
DELETE fl  FROM fmr_lines fl       JOIN fmr_requests f ON f.id=fl.fmr_id  WHERE f.project_id=@pid;
DELETE FROM fmr_requests WHERE project_id=@pid;

-- Warehouse (transfers, stock, receipts) — stock is FK-referenced by fmr_issue_lines (deleted above)
DELETE FROM warehouse_transfers WHERE project_id=@pid;
DELETE FROM warehouse_stock     WHERE project_id=@pid;
DELETE FROM receipt_lines       WHERE project_id=@pid;

-- Expediting child items + ITP (reference po_lines / purchase_orders) — before po_lines
DELETE e  FROM expediting_child_items e JOIN po_lines pl ON pl.id=e.po_line_id JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=@pid;
DELETE ii FROM itp_items ii JOIN itp_requirements ir ON ir.id=ii.requirement_id JOIN purchase_orders p ON p.id=ir.po_id WHERE p.project_id=@pid;
DELETE ir FROM itp_requirements ir JOIN purchase_orders p ON p.id=ir.po_id WHERE p.project_id=@pid;

-- VDRL (documents -> packages)
DELETE d FROM vdrl_documents d JOIN vdrl_packages vp ON vp.id=d.package_id WHERE vp.project_id=@pid;
DELETE FROM vdrl_packages WHERE project_id=@pid;

-- SCN children (additional items / documents / status log / heats / packages) -> SCN
DELETE x FROM scn_additional_items x JOIN shipment_control_notes s ON s.id=x.scn_id WHERE s.project_id=@pid;
DELETE x FROM scn_documents       x JOIN shipment_control_notes s ON s.id=x.scn_id WHERE s.project_id=@pid;
DELETE x FROM scn_status_log      x JOIN shipment_control_notes s ON s.id=x.scn_id WHERE s.project_id=@pid;
DELETE x FROM scn_heats           x JOIN shipment_control_notes s ON s.id=x.scn_id WHERE s.project_id=@pid;
DELETE x FROM scn_packages        x JOIN shipment_control_notes s ON s.id=x.scn_id WHERE s.project_id=@pid;
DELETE FROM shipment_control_notes WHERE project_id=@pid;

-- PO children (notes / variations / documents / approvals / milestones) -> purchase_orders
DELETE x FROM po_action_notes x JOIN purchase_orders p ON p.id=x.po_id WHERE p.project_id=@pid;
DELETE x FROM po_variations   x JOIN purchase_orders p ON p.id=x.po_id WHERE p.project_id=@pid;
DELETE x FROM po_documents    x JOIN purchase_orders p ON p.id=x.po_id WHERE p.project_id=@pid;
DELETE x FROM po_approvals    x JOIN purchase_orders p ON p.id=x.po_id WHERE p.project_id=@pid;
DELETE x FROM po_milestones   x JOIN purchase_orders p ON p.id=x.po_id WHERE p.project_id=@pid;

-- Traceability (cert versions -> certs; chases -> holds) — chases requires QCO_admin SELECT
DELETE v  FROM traceability_cert_versions v JOIN traceability_certs c ON c.id=v.cert_id  WHERE c.project_id=@pid;
DELETE ch FROM traceability_chases ch      JOIN traceability_holds h ON h.id=ch.hold_id WHERE h.project_id=@pid;
DELETE FROM traceability_holds WHERE project_id=@pid;
DELETE FROM traceability_certs WHERE project_id=@pid;

-- PO lines (FK-referenced by expediting_child_items/scn_additional_items/itp, all deleted above) -> purchase_orders
DELETE pl FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=@pid;
DELETE FROM purchase_orders WHERE project_id=@pid;

-- MTO (lines / revisions -> registers)
DELETE ml FROM mto_lines     ml JOIN mto_registers m ON m.id=ml.mto_id WHERE m.project_id=@pid;
DELETE mr FROM mto_revisions mr JOIN mto_registers m ON m.id=mr.mto_id WHERE m.project_id=@pid;
DELETE FROM mto_registers WHERE project_id=@pid;

-- Foundational (equipment / commodity / certificates)
DELETE FROM equipment_list           WHERE project_id=@pid;
DELETE FROM commodity_library        WHERE project_id=@pid;
DELETE FROM foundational_certificates WHERE project_id=@pid;

-- Meetings / RFIs (attendees -> records; actions are project-scoped)
DELETE a FROM meeting_attendees a JOIN rfi_meeting_records r ON r.id=a.record_id WHERE r.project_id=@pid;
DELETE FROM meeting_actions      WHERE project_id=@pid;
DELETE FROM rfi_meeting_records  WHERE project_id=@pid;

-- Governance / misc project-scoped
DELETE FROM project_health_weights WHERE project_id=@pid;
DELETE FROM pending_changes        WHERE project_id=@pid;

-- Notifications + date-change log (polymorphic / user-scoped) — best-effort by ZZ user
DELETE FROM notifications   WHERE user_id    IN (SELECT id FROM users WHERE email LIKE '%@zzflowtest.example');
DELETE FROM date_change_log WHERE created_by IN (SELECT id FROM users WHERE email LIKE '%@zzflowtest.example');

-- WBS access + WBS nodes (po_lines.wbs_id FK already cleared above; wbs_nodes self-ref handled in one statement)
DELETE FROM user_wbs_access WHERE project_id=@pid;
DELETE FROM wbs_nodes       WHERE project_id=@pid;

-- audit_review has no project_id; scope it via its parent audit_log row. Delete BEFORE
-- audit_log so the join can still resolve project_id (and to satisfy the FK to audit_log).
DELETE ar FROM audit_review ar JOIN audit_log a ON a.id=ar.audit_log_id WHERE a.project_id=@pid;
DELETE FROM audit_log WHERE project_id=@pid;
-- audit_checkpoint is not project-scoped, but checkpoints sealed by a ZZ user are ZZ-only
-- artefacts; remove them so the later users DELETE doesn't trip fk_ckpt_user (sealed_by).
-- Canonical checkpoints (sealed by canonical users / NULL) are left untouched.
DELETE c FROM audit_checkpoint c JOIN users u ON u.id=c.sealed_by WHERE u.email LIKE '%@zzflowtest.example';

-- Project row + global ZZ-marked records (users / suppliers / warehouses)
DELETE FROM projects   WHERE id=@pid;
DELETE FROM users      WHERE email LIKE '%@zzflowtest.example';
DELETE FROM suppliers  WHERE code  LIKE 'ZZF-%';
DELETE FROM warehouses WHERE code  LIKE 'ZZF-%';

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
