-- ─── LEAST-PRIVILEGE APP DB USER (qmat_app) ───────────────────────────────────
-- Reproducible record of the privileges the running app needs. Run as QCO_admin.
--
-- The app now connects as 'qmat_app' (server/.env DB_USER/DB_PASSWORD); QCO_admin
-- is retained for migrations/DDL only (qmat_app intentionally has NO DDL/DROP/
-- TRIGGER/GRANT/global privileges). The real password lives ONLY in the gitignored
-- server/.env — this file carries a placeholder, never a secret.
--
-- Grant surface derived from a dual-source map (static code scan + performance_schema
-- digest cross-check) + an ON-DUPLICATE-KEY-UPDATE review (those upserts need UPDATE):
-- role_permissions / user_permission_overrides / system_settings carry UPDATE for that
-- reason. Validated by a full cold-path + hot-path exercise (zero access-denied; zero
-- grants needed beyond these 59).
--
-- Rollback: set server/.env DB_USER/DB_PASSWORD back to QCO_admin and restart.

CREATE USER 'qmat_app'@'%' IDENTIFIED BY '<password>';   -- placeholder only; real password in server/.env

-- ─── AUDIT TABLES — SELECT, INSERT ONLY (tamper-prevention; DO NOT add UPDATE/DELETE) ──
-- audit_log/audit_review/audit_checkpoint are SELECT,INSERT only: the app credential
-- must not be able to UPDATE/DELETE the trail or it could erase history. Combined with
-- no TRIGGER/DROP privilege, the app cannot drop the append-only enforcement triggers.
-- This is defense-in-depth on top of those triggers + the hash chain. DO NOT widen.
GRANT SELECT, INSERT ON qmat.audit_log TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.audit_review TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.audit_checkpoint TO 'qmat_app'@'%';

-- ─── ON-DUPLICATE-KEY-UPDATE upserts (need UPDATE; caught in the grant-map review) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.role_permissions TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.user_permission_overrides TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.system_settings TO 'qmat_app'@'%';

-- ─── REMAINING TABLES (exact runtime operations) ─────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.acronyms TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.commodity_library TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.currencies TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.date_change_log TO 'qmat_app'@'%';
GRANT SELECT, INSERT, DELETE ON qmat.delegated_permissions TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.equipment_list TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.expediting_child_items TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.expediting_forecast_history TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.fmr_issue_lines TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.fmr_lines TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.fmr_requests TO 'qmat_app'@'%';
GRANT SELECT, INSERT, DELETE ON qmat.fmr_packages TO 'qmat_app'@'%';  -- PASS A: app INSERT/DELETE, was missing from script
GRANT SELECT, INSERT, UPDATE ON qmat.fmr_pickups TO 'qmat_app'@'%';   -- PASS A: app INSERT/UPDATE, was missing from script
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.foundational_certificates TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.inco_terms TO 'qmat_app'@'%';
GRANT SELECT ON qmat.itp_items TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.itp_requirements TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.mto_lines TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.mto_registers TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.mto_revisions TO 'qmat_app'@'%';  -- PASS A: added UPDATE (app updates revisions)
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.notifications TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.package_types TO 'qmat_app'@'%';
GRANT SELECT, INSERT, DELETE ON qmat.password_history TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.pending_changes TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.po_action_notes TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.po_approvals TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.po_documents TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.po_lines TO 'qmat_app'@'%';
GRANT SELECT, UPDATE ON qmat.po_milestones TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.po_variations TO 'qmat_app'@'%';
GRANT SELECT, INSERT, DELETE ON qmat.po_expeditors TO 'qmat_app'@'%';  -- PASS A: app INSERT/DELETE, was missing from script
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.projects TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.purchase_orders TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.receipt_lines TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.scn_additional_items TO 'qmat_app'@'%';
GRANT SELECT, INSERT, DELETE ON qmat.scn_documents TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.scn_heats TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.scn_packages TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.scn_status_log TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.shipment_control_notes TO 'qmat_app'@'%';
GRANT SELECT, INSERT, DELETE ON qmat.supplier_addresses TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.suppliers TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.traceability_cert_versions TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.traceability_certs TO 'qmat_app'@'%';
GRANT INSERT ON qmat.traceability_chases TO 'qmat_app'@'%';
GRANT SELECT, UPDATE ON qmat.traceability_holds TO 'qmat_app'@'%';
GRANT SELECT ON qmat.traceability_trace_lifecycle TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.units_of_measure TO 'qmat_app'@'%';
GRANT SELECT, INSERT, DELETE ON qmat.user_wbs_access TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.users TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.vdrl_documents TO 'qmat_app'@'%';
GRANT SELECT, INSERT ON qmat.vdrl_packages TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.warehouse_stock TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE ON qmat.warehouse_transfers TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.warehouses TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.wbs_nodes TO 'qmat_app'@'%';

-- ─── C1: Meeting/RFI module (added by migrate-rfi-meeting.js) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.rfi_meeting_records TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.meeting_attendees   TO 'qmat_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON qmat.meeting_actions     TO 'qmat_app'@'%';

-- ─── Dashboard C1 (added by migrate-dashboard-weights.js) ──────
GRANT SELECT, INSERT, UPDATE ON qmat.project_health_weights TO 'qmat_app'@'%';

FLUSH PRIVILEGES;

-- ─── DELIBERATELY NOT GRANTED (no runtime app code touches these as of this migration) ──
-- An access-denied on any of these is the boundary working as designed — NOT necessarily
-- a bug. If a future feature writes to one, add that grant deliberately (and update this file):
--   expediting_register, milestone_templates, milestone_template_steps, po_hold_reasons,
--   ros_change_log, user_project_access, vdrl_alert_rules, vdrl_mdr, vdrl_review_comments,
--   vdrl_revisions, vdrl_transmittals, vdrl_transmittal_docs, vdrl_expediting_log, vendor_contacts
--
-- Total: 63 tables granted (exact ops); 14 intentionally ungranted.
--   (+3 rfi_meeting: rfi_meeting_records, meeting_attendees, meeting_actions)
--   (+1 dashboard: project_health_weights)
