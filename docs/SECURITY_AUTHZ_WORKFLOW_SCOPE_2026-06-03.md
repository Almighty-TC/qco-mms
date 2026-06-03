# READ-FIRST — RBAC wiring + PM-confirmation workflow scope (2026-06-03, READ-ONLY)

## 1. Role confirmation (the blocker)
**Canonical role list** (identical in `users.role` and `role_permissions.role`; `role` is `varchar(50)` — no enum/roles table, so new role strings are addable without a schema ALTER):
`admin, ceo, director, expediting_manager, expeditor, freight_forwarder, logistics_manager, procurement_manager, procurement_officer, project_director, project_manager, site_contractor, subcontractor, vendor, viewer, warehouse`

- **Project Manager (confirmer): EXISTS** → `project_manager` ✅
- **Engineering-Lead: DOES NOT EXIST** → NEW role, propose **`engineering_lead`**.
- **Project Control: DOES NOT EXIST** → NEW role, propose **`project_control`**.
- **Auditor**: there is no `auditor` role — the seed mapped Auditor onto `viewer`. If auditors need write-to-audit-review, either add a real **`auditor`** role or grant the capability to `viewer`. Recommend a distinct **`auditor`** role to separate it from read-only `viewer`.

⚠️ New roles need: (a) `role_permissions` rows (below), and (b) inclusion in the Admin "create user / role dropdown" UI and any role lists — otherwise they exist in data but can't be assigned through the app. (No DB enum to alter — `users.role` is varchar.)

## 2. PM-confirmation workflow — proposed design

### Existing pattern to mirror (found in procurement)
- `purchase_orders.status` includes a **`pending_director_approval`** state; approvals are logged in a separate **`po_approvals`** table (`po_id, approver_id, approval_level, status enum(pending/approved/rejected/unapproved), comments, actioned_at`); `is_locked` flips on approval. Multi-level by value threshold.
- So the codebase already does "**draft → pending → approved (logged)**". We mirror its *spirit*, not its PO-specific columns.
- **No generic pending/staging table exists.** Foundational/MTO tables have no uniform "pending confirmation" column (`wbs_nodes` none; `commodity_library`/`equipment_list` have a business `status`; `mto_lines` has `status`+`is_deleted`) — so reusing existing status columns is not viable.

### Recommended state model — a generic `pending_changes` table (recommend over per-table status)
Because the requirement is "**the change requires PM confirmation BEFORE it takes effect**" across create/edit/delete on 4–5 entity types **including 1,000-line bulk uploads**, a single staging table is cleanest and keeps the real tables untouched until confirm:
```sql
-- PROPOSED (do not run) — mirrors po_approvals' "separate log" idea, generalised to hold the change
CREATE TABLE pending_changes (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  project_id   INT NOT NULL,                                   -- threads project scope (like C3)
  module       VARCHAR(50) NOT NULL,                           -- 'foundational' | 'mto'
  entity_type  VARCHAR(50) NOT NULL,                           -- wbs_nodes | commodity_library | equipment_list | mto_registers | mto_lines
  entity_id    INT NULL,                                       -- NULL for create
  action       ENUM('create','edit','delete') NOT NULL,
  proposed     JSON NULL,                                      -- new values (create/edit)
  before_value JSON NULL,                                      -- snapshot (edit/delete) for audit + rollback clarity
  batch_id     VARCHAR(40) NULL,                               -- groups a bulk upload → batch-confirm
  status       ENUM('pending','confirmed','rejected','superseded') NOT NULL DEFAULT 'pending',
  requested_by INT NOT NULL, requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_by INT NULL, confirmed_at DATETIME NULL, confirm_comment TEXT NULL,
  CONSTRAINT fk_pc_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_pc_requester FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_pc_confirmer FOREIGN KEY (confirmed_by) REFERENCES users(id),
  KEY idx_pc_status (project_id, module, status)
);
```
**Flow:** Admin/Eng-Lead/Project-Control create/edit/delete → instead of writing the entity, insert a `pending_changes` row (status `pending`). A PM hits a **confirm endpoint** → within one pooled transaction: apply the change to the real table, set `status='confirmed'`, write the audit row. Reject → `status='rejected'`, nothing applied.
- *Alternative (closer literal PO mirror):* add a `confirmation_status` column to each foundational/MTO table + a `*_confirmations` log; record exists but is filtered from "active" use until confirmed. **Not recommended** — pollutes real tables, complicates every read, and handles bulk/delete poorly. The `pending_changes` table is the better fit; flagging the alternative for your call.

### Confirmer rules
- **Confirmer = `project_manager`** (+ `admin` override). 
- **Segregation of duties: the requester cannot confirm their own change** — enforce `confirmed_by <> requested_by` (recommended), even if the requester is also a PM/admin.
- **Does admin's own write need PM confirm?** Decision text says the *write* requires PM confirmation regardless of author. Recommend: admin writes also stage to `pending_changes` for auditability, **but** admin may self-confirm (admin override) — or exempt admin entirely. **Product decision — flag.**

### Scope (incl. bulk)
- Applies to **all create/delete** + **material edits** on foundational + MTO.
- **Bulk upload**: write N `pending_changes` rows under one `batch_id`; a **batch-confirm endpoint** confirms the whole batch in one transaction (never one-by-one). Reject-batch likewise.
- **Minor edits** (e.g. notes-only): propose these can bypass confirmation (or be auto-confirmed) to avoid friction — **product decision: which fields are "material"?** Flag.

### Audit
- The **confirmation action writes an `audit_log` row** (`action: 'foundational_change_confirmed'`/`'mto_change_confirmed'`, before/after, `resource`, **project_id**) via the foundational/mto `audit()` helpers — which already thread `project_id` (C3). ✅ The original request (pending insert) is also audited.

## 3. Proposed `role_permissions` INSERTs (foundational + mto) — for approval, NOT run
Columns: `role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped, is_default`. (`can_approve` = the PM confirm capability.)
```sql
-- foundational (covers wbs/commodity/equipment; split into 3 modules if finer control wanted)
INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped) VALUES
 ('admin','foundational',           1,1,1,1,1,0),
 ('engineering_lead','foundational',1,1,1,0,1,0),
 ('project_control','foundational', 1,1,1,0,1,0),
 ('project_manager','foundational', 1,0,0,1,0,0),   -- confirmer only (can_approve)
 ('project_director','foundational',1,0,0,1,0,0),   -- confirm? (decision — flag)
 ('site_contractor','foundational', 1,0,0,0,0,1),   -- read-only, wbs_scoped
 ('viewer','foundational',          1,0,0,0,0,0),
 ('procurement_officer','foundational',1,0,0,0,0,0),('procurement_manager','foundational',1,0,0,0,0,0),
 ('expeditor','foundational',1,0,0,0,0,0),('warehouse','foundational',1,0,0,0,0,0);
-- mto (same shape)
INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_approve, can_delete, wbs_scoped) VALUES
 ('admin','mto',1,1,1,1,1,0),
 ('engineering_lead','mto',1,1,1,0,1,0),
 ('project_control','mto',1,1,1,0,1,0),
 ('project_manager','mto',1,0,0,1,0,0),
 ('procurement_officer','mto',1,0,0,0,0,0),('procurement_manager','mto',1,0,0,0,0,0),
 ('viewer','mto',1,0,0,0,0,0),('site_contractor','mto',1,0,0,0,0,0);
-- auditor read+audit-review (if a distinct auditor role is added)
INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_approve, can_delete) VALUES
 ('auditor','audit_review',1,1,1,0,0);   -- + can_view=1 on all other modules, no writes
```
Notes: `viewer`/`site_contractor` get **view-only** (closes the gap). `project_manager` gets **`can_approve` = confirm**, not create/edit/delete. New roles `engineering_lead`/`project_control`/`auditor` also need baseline `can_view` rows for the modules they should see (a fuller matrix — product decision). Existing 8-module matrix already bars viewer/contractor from writes, so it's ready to enforce as-is.

## 4. Proposed build/commit plan (each backend-first, proven, held)
- **C-a — Wire `requirePermission` to the 8 already-matrixed modules' write routes** (procurement, materialcontrol, logistics, expediting, traceability, vdrl, document_inbox, admin). The mechanical bulk of the gap close. Apply `requirePermission(module,'can_view')` per router for reads + per-route `can_create/edit/delete/approve` on writes. **Proof:** re-probe every role × every write route on ZZ_FLOWTEST (each role does its job, no more).
- **C-b — Add `engineering_lead`/`project_control` (+ `auditor`) roles + `foundational`/`mto`/`audit_review` matrix rows** (the §3 INSERTs, after sign-off) + surface new roles in Admin UI.
- **C-c — Build PM-confirmation workflow** (`pending_changes` table + stage-on-write for foundational/MTO + PM confirm/reject endpoints + batch-confirm + audit). Backend-first, then UI (a "Pending confirmations" queue for PMs). **Proof:** write sits pending → PM confirms → commits → audited; requester≠confirmer enforced; non-PM cannot confirm; bulk batch-confirm works.
- **C-d — Reconcile inline checks with the matrix** — ensure no inline check CONTRADICTS the matrix (inline must never *allow* a role the matrix bars); keep genuine business-rule guards (locked-PO edit, raised-PO-line delete, contractor wbs-scope, vendor supplier-scope). **Proof:** re-probe confirms inline + matrix agree.
- Sequence: C-a first (closes most of the live gap fast), then C-b → C-c (the foundational/MTO write story ships coherent together, per decision), C-d throughout. One concern per commit; ZZ_FLOWTEST for all probes; canonical untouched.

## Open product decisions before any code
1. New role strings: `engineering_lead`, `project_control`, and a distinct `auditor` (vs reuse `viewer`)? 
2. Confirmer set: PM only, or PM + project_director? Admin self-confirm allowed or admin writes exempt from confirmation?
3. Which foundational/MTO edits are "material" (need confirm) vs minor (notes) that bypass?
4. `foundational` as one module or split wbs/commodity/equipment?
5. Full baseline `can_view` matrix for the new roles across all modules.

## Guardrails honoured
Read-only: no code, no schema, no commits, no INSERTs/ALTERs run. ZZ_FLOWTEST tokens + invalid payloads only in the prior probe pass; canonical untouched; pooled connection.
