# C-d — inline-vs-matrix reconciliation report (2026-06-03)

**Principle:** matrix is the floor (via `enforce()`); inline checks run *after* and may only *further restrict*. Net authority = **matrix ∩ inline**. A conflict exists wherever the matrix is **narrower** than a legitimate inline allow-set → `enforce()` blocks a role the business rule intends to allow (over-restriction), OR an inline set is **narrower/stale** vs the matrix.

Probed live on ZZ_FLOWTEST (invalid payloads → no mutation). Findings:

## Conflicts found

### ✅ FIXED this pass — critical-path mis-classified as approval
`/critical-path` was in `enforce()`'s `APPROVE_RE` → mapped to `can_approve`, so `project_manager` (who has procurement `can_edit` but not `can_approve`) got **403** despite inline `CRITICAL_PATH_ROLES` allowing it. **Fix:** removed `critical-path` from `APPROVE_RE` → it maps to `can_edit`. Re-probed: project_manager now passes; procurement_officer blocked by the inline `CRITICAL_PATH_ROLES` business rule (intended); viewer 403. **Resolved.**

### 🟡 HELD #1 — `procurement_manager` in `EXPEDITOR_ASSIGN_ROLES` vs expediting matrix
The expeditor-assign route was module-moved to `expediting` (approved). Inline `EXPEDITOR_ASSIGN_ROLES = {admin, procurement_manager, expediting_manager}`, but expediting matrix `can_edit = {admin, expediting_manager, expeditor, project_manager}` — so `enforce()` now **403s procurement_manager** on expeditor-assign (confirmed).
- **(a)** add `procurement_manager` to expediting `can_edit` — if procurement managers legitimately assign expeditors.
- **(b)** drop `procurement_manager` from `EXPEDITOR_ASSIGN_ROLES` — accept the module-move (only expediting roles assign).
- **Recommend (b)** (consistent with the approved module-move) **unless** PMs assign expeditors in practice → then (a). **Hold for Thomas.**

### 🟡 HELD #2 — foundational `/certificates/*` (3 routes) floor-only
No matrix module; currently deny-floor only (viewer/auditor blocked, operational roles pass). These attach certs to **commodity or equipment** entities (`/certificates/:entityType/:entityId`).
- **(a)** new `certificates` permission module.
- **(b)** gate by the entity's module (`commodity`/`equipment`) via the `entityType` param.
- **Recommend (b)** — certs belong to the entity; reuses existing modules, no new concept. **Hold for Thomas.**

### 🟡 HELD #3 (new) — PO approval: `procurement_officer` over-restricted
`enforce()` gates PO-approve as procurement `can_approve = {admin, procurement_manager}`, so **procurement_officer is 403** (confirmed) — but inline `APPROVAL_ROLES` includes officer (the PO-approve handler has value-threshold logic where officers approve low-value POs).
- **(a)** add `procurement_officer` to procurement `can_approve` (restores threshold behaviour; the handler's threshold logic still gates by value).
- **(b)** accept officers can't approve (matrix authoritative).
- **Recommend (a)** (the threshold approval is an existing, intended flow). **Hold for Thomas.**

### 🟡 HELD #4 (new) — FMR approval: matrix vs inline disagree → ~admin-only
`enforce()` gates FMR-approve as material_control `can_approve = {admin, warehouse}`; inline `APPROVAL_ALLOWED = {admin, ceo, director, project_director, project_manager, materials_controller}`. Net ∩ ≈ **admin only**: `warehouse` is blocked by inline (not in `APPROVAL_ALLOWED`), `project_manager`/etc. blocked by matrix. Confirmed: warehouse→403 (inline), project_manager→403 (matrix). Also `materials_controller` in the inline set is a **non-existent role** (not in `VALID_ROLES`).
- **Fix:** correct inline `APPROVAL_ALLOWED` to real roles (the FMR approver is `warehouse` = materials controller) and **align** matrix material_control `can_approve` with the agreed approver set (warehouse + admin, + project roles if intended).
- **Recommend:** set both to **{admin, warehouse}** (+ project_manager/project_director if they approve FMRs — confirm). **Hold for Thomas** (who approves FMRs?).

## Non-conflicts (verified consistent)
- PO doc-upload: inline `DOC_UPLOAD_ROLES ⊆` procurement `can_create` — inline narrows, OK.
- `rejectExternal` (subcontractor/freight_forwarder) and contractor `wbs_scoped`, vendor supplier-scope, locked-PO edit, raised-PO-line delete — genuine **business-rule guards**, kept as defense-in-depth; none *allows* a role the matrix bars.
- Deny-floor (viewer/auditor) consistent with matrix (those roles have no writes).

## Net "prove combined effect"
With the critical-path fix, each role does its job **except** the 4 held over-restrictions above, which await your decisions. The held items are all of the form "matrix `can_approve` is narrower than the legitimate approver set" (or an inline set is stale) — they are **product decisions about who approves what**, so I did not change them unilaterally.

## Recommended resolution order (on your picks)
1. HELD #4 (FMR approve) + HELD #3 (PO approve) — restore correct approver sets (align matrix `can_approve` + fix stale inline). These currently **over-restrict real approvers** — highest priority.
2. HELD #1 (expeditor-assign) + HELD #2 (certificates) — lower-stakes routing decisions.
Each, once decided, is a small matrix/inline edit + re-probe.

---

# RESOLUTION UPDATE (held decisions landed)

- **#1 expeditor-assign — RESOLVED** (`d55deee`): dropped `procurement_manager` from `EXPEDITOR_ASSIGN_ROLES`. Proven: expediting_manager passes, procurement_manager 403, viewer 403.
- **#2 certificates — RESOLVED** (`d55deee`): gated by entity module. POST `/certificates/:entityType/:entityId` via the enforce resolver (commodity/equipment); bare `/certificates/:id` PATCH/DELETE via `certGate` (looks up the cert's `entity_type`). Proven: entity-perm roles pass, others 403 (no longer floor-only).
- **#3 PO approve officer — RESOLVED (capability)** (`d55deee`): granted `procurement_officer` procurement `can_approve`. Proven: officer now passes `enforce` (was 403), viewer 403. The value-threshold ceiling stays in the handler (officer finalizes within-threshold single-level; over-threshold routes to manager — see the enum bug below).

## 🔴 NEW pre-existing finding (separate from RBAC) — multi-level PO approval is broken
`purchase_orders.status` enum = `('rfq','loa','po-raised','active','closed','cancelled')` — it is **missing `pending_approval` and `pending_director_approval`**, which the approve handler writes for over-threshold POs. So **any PO that requires multi-level approval 500s ("Data truncated for column 'status'") for ALL approver roles**, not just officers — it's a schema/handler mismatch, unrelated to the C-d grant. (Manifests only when `approval_threshold_1/2` are configured; with null thresholds everything is single-level → `po-raised`, which works.)
**Recommend fix (separate concern):** `ALTER TABLE purchase_orders MODIFY status ENUM('rfq','loa','po-raised','active','closed','cancelled','pending_approval','pending_director_approval')` — then re-prove the multi-level chain. **Hold / log as its own defect.**

## 🟡 HELD #4 — FMR approval role set (report + proposal, awaiting confirmation)
**What FMR approval does:** a contractor raises a Field Material Request against their WBS scope (`MCFMRScreen` "raise new FMRs"); a materials-control approver reviews **per line** (approve_full / approve_partial / reject) before the material is issued from warehouse stock. Route: `PUT /mc/:projectId/fmr/:fmrId/approve`; error text: *"Only Materials Controllers and Managers can approve FMRs."*

**The bug:** inline `APPROVAL_ALLOWED = {admin, ceo, director, project_director, project_manager, materials_controller}` references **`materials_controller` — a non-existent role** — and omits `warehouse` (the actual materials-control role). Matrix material_control `can_approve = {admin, warehouse}`. Net (enforce ∩ inline) ≈ **admin only** (warehouse blocked by inline; PM/etc. blocked by matrix). So FMR approval is effectively admin-only today — a bug, not policy.

**Proposed role set (FMR approver = the Materials Controller + their manager + admin):**
- **`admin`, `warehouse`** (Materials Controller), **`logistics_manager`** (Materials/Warehouse Manager).
- **Open question for Thomas:** should **`project_manager`** also approve FMRs? (The dead inline set listed PM; unclear if intended.)

**Apply once confirmed:** set BOTH (a) inline `APPROVAL_ALLOWED` to the confirmed real roles, and (b) matrix material_control `can_approve` to the same set; then prove approved roles pass, others 403. **HOLD for Thomas's pick on the role set (incl. project_manager?).**
