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
