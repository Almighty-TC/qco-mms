# SECURITY SCOPE — role-enforcement (authorization) gap (READ-ONLY map, 2026-06-03)

**Verdict: SYSTEMIC, not foundational-only.** Authentication is enforced everywhere; **authorization (role/permission) is enforced almost nowhere.** A proper permission middleware AND a populated permission matrix already exist — they're simply **not wired to the routes**.

## 1. Auth vs role-middleware
- **Authentication** — `authenticateToken` (`middleware/auth.js`) is applied to every module (via `router.use(authenticateToken)` inside each route file, or at mount for admin/procurement/projects). Tokens are validated. ✅
- **Authorization** — `requirePermission(module, action)` + `requireAdmin` exist in `middleware/permissions.js` with a real model (admin bypass → `user_permission_overrides` → `role_permissions` → optional `wbs_scoped` check via `user_wbs_access`). **They are applied to ZERO routes** (`grep` count = 0). 🔴
- **Permission matrix exists and is populated** — `role_permissions` = 160 rows across 10 modules (admin, audit, dashboard, document_inbox, expediting, logistics, material_control, procurement, traceability, vdrl). `user_permission_overrides` = 0 rows. The matrix is sensible and already excludes `viewer`/`site_contractor`/`auditor` from writes — so if `requirePermission` were applied, the gap would largely close.
- **Actual enforcement today is ad-hoc inline**, in pockets only (see table).

## 2. Write-endpoint enforcement (blast radius, by module)
| Module | Write routes | Enforcement today | Verdict |
|---|---|---|---|
| **admin** | 52 | inline admin-only gate (`role!=='admin'`→403) applied to the router | ✅ PROTECTED |
| **projects** | 0 | — | N/A |
| **documents** | 0 | — | N/A |
| **foundational** (WBS/commodity/equipment) | 21 | `authenticateToken` only | 🔴 GAP (all) |
| **mto** | 6 | auth only (+ business rule: can't delete line w/ raised PO) | 🔴 GAP (all writes) |
| **expediting** (milestones, action-notes, child-items, VDRL) | 14 | auth only | 🔴 GAP (all) |
| **traceability** (cert create/version/verify/reject, hold chase) | 5 | auth only | 🔴 GAP (all) |
| **procurement** | 20 | inline role-sets on SOME actions (expeditor-assign, critical-path, approve, doc-upload, vendor scoping) | 🟡 PARTIAL — generic create/edit/delete PO + lines + notes/variations/dates UNGATED → GAP |
| **materialcontrol** | 9 | `rejectExternal` (blocks subcontractor/freight_forwarder only) + `APPROVAL_ALLOWED` on approve/issue | 🟡 PARTIAL — low-priv **internal** roles (viewer/auditor/expeditor) pass `rejectExternal` → receipting/transfer/stock writes UNGATED → GAP |
| **logistics** | 8 | blocks `freight_forwarder` from writes; forwarder scoping | 🟡 PARTIAL — other low-priv internal roles ungated → GAP |

≈ **70 write routes lack proper role enforcement** (foundational 21 + mto 6 + expediting 14 + traceability 5 + procurement subset + MC subset + logistics subset).

## 3. Empirical probes (viewer + auditor tokens, ZZ_FLOWTEST, invalid payloads → NO mutation)
403 = protected; any other status = authz let it through (GAP). All returned **4xx validation, never 403**:
| Module | Probe | Result |
|---|---|---|
| foundational | viewer POST /foundational/9/wbs | 400 (validation) → 🔴 GAP |
| mto | viewer POST /mto/9 | 400 → 🔴 GAP |
| procurement | viewer POST /procurement/9/pos/bulk-upload | 400 → 🔴 GAP |
| materialcontrol | viewer POST /mc/9/transfers | 422 → 🔴 GAP (passed rejectExternal) |
| traceability | viewer POST /traceability/9/cert | 422 → 🔴 GAP |
| expediting | viewer POST /expediting/9/po/55/action-notes | 400 → 🔴 GAP |
| logistics | viewer PUT /logistics/scn/.../status | 400 → 🔴 GAP |
| foundational | **auditor** POST /foundational/9/wbs | 400 → 🔴 GAP (auditors not read-only) |
| control | **admin** POST /foundational/9/wbs | 400 (validation, as expected — admin passes authz) |
**Cleanup:** all payloads invalid → nothing created; ZZ_FLOWTEST wbs_nodes=500, mto_registers=6 unchanged; canonical untouched.

## 4. Fix shape — (C) MIXED, dominated by (A)
- **(A) — middleware exists but isn't applied** (the bulk of the fix): for the 8 modules already in `role_permissions`, apply `requirePermission(module, action)` to write routes. Mechanical, lower-risk.
- **(B) — matrix gap**: `role_permissions` has **NO module for `foundational` (wbs/commodity/equipment) or `mto`**. These need matrix rows added (a product decision on who may write them) before the middleware can gate them.
- **Choke point?** Partial. Per-module `router.use(requirePermission(module,'can_view'))` can gate **reads** in one line per router. **Writes need per-route action granularity** (`can_create`/`can_edit`/`can_delete`/`can_approve`), so ~70 write routes get a per-route (or per-method-group) guard. No single global choke point.
- **Reconciliation needed:** existing inline checks (procurement role-sets, MC `APPROVAL_ALLOWED`/`rejectExternal`, logistics forwarder block, admin gate, vendor supplier-scoping) overlap the matrix. Decide: matrix as single source of truth (remove redundant inline), keeping genuine **business-rule** guards (can't delete line w/ raised PO; locked-PO edit; contractor `wbs_scoped`; vendor sees only own supplier).

## 5. Recommended approach + matrix for review
**Approach (backend-first, after matrix sign-off):**
1. **Confirm the existing `role_permissions` matrix** (below) and **add `foundational` + `mto` modules** (proposed defaults below).
2. Apply `requirePermission(module, action)` per write route (action by verb). Apply `requirePermission(module,'can_view')` per router for reads.
3. Keep business-rule guards; remove/converge redundant inline role-sets to avoid conflicting sources of truth.
4. **Prove by re-probing every role × every gapped endpoint** (each role can do its job and no more) on ZZ_FLOWTEST; held for review.

**Existing matrix (roles with write perms; C=create E=edit D=delete A=approve, *=wbs_scoped):**
- expediting: expediting_manager[CEDA] expeditor[CE] project_manager[CE]
- procurement: procurement_manager[CEDA] procurement_officer[CE] project_manager[CE]
- material_control: logistics_manager[CE] warehouse[CEA]
- logistics: expediting_manager[CE] freight_forwarder[E] logistics_manager[CEDA] project_manager[C] warehouse[E]
- traceability: warehouse[C]
- vdrl / document_inbox: various (see DB)
- (admin always CEDA on all)
- **viewer / site_contractor / auditor(=viewer role): NO write perms** ✅ — exactly what we want enforced.

**Proposed additions (need Thomas's call):**
- `foundational` (or split wbs/commodity/equipment): create/edit/delete → admin, project_manager; **contractor edit only within `wbs_scoped`?** (product decision); viewer/auditor read-only.
- `mto`: create/edit/delete → admin, project_manager, procurement_*; viewer/auditor read-only.

## Open product decisions before any code
1. Can a **contractor** edit their *scoped* WBS, or read-only? (matrix `wbs_scoped` supports either.)
2. `foundational`/`mto` write roles (proposed above — confirm).
3. **Auditor** = strictly read + audit-review (no operational writes) — confirm (currently mapped to `viewer` role; matrix says no writes ✅).
4. Converge inline role-sets onto the matrix, or keep as defense-in-depth?

## Guardrails honoured
READ-ONLY: no code changed, no role checks added, no commits. Probes used ZZ_FLOWTEST + invalid payloads (zero mutation); canonical untouched; pooled connection only.
