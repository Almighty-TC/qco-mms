# QCO MMS — HANDOVER: NEXT SESSION
# Updated: 28 June 2026
# Last commit: d218232 (feat(storage): Azure Blob dual-read migration) — feat/three-design-features, PUSHED. All Pass-1/2/3 + walk-through fixes + forwarder doc/PoC carrier-auth + blob CODE DONE & pushed (blob Azure setup pending — consolidation item #1b).
# ▶▶ NEXT SESSION = CONSOLIDATION — see the "★ CONSOLIDATION RESUME MARKER" block below (deploy-all + fresh walk-through; QCO_admin rotation FIRST).
# ⭐ THIS FILE IS THE SINGLE CANONICAL MODULE-STATUS DOC. HANDOVER.md and
#    CLAUDE_CONTEXT.md point here for status (their own status tables are retired).
# Read every word before doing anything.
#
# ✅ ALL PHASE-1 MODULES ARE BUILT & LIVE. The authoritative current state is the
#    "## CURRENT STATUS & OPEN ITEMS (20 June 2026)" section just below the table.
#    Sections §3a/3b/3c, §4, §5, §6 are HISTORICAL (point-in-time, ~02 Jun) and are
#    superseded by that section — do NOT trust their "open"/"next"/"not built" claims.

---

## 1. PROJECT IDENTITY

- **System:** QCO MMS (Material Management System) — SaaS supply chain platform for capital infrastructure projects, energy & resources sector
- **Company:** QCO Group (qcogroup.com.au)
- **Owner:** Thomas Chang (tchang@qcogroup.com.au) — Super Admin
- **GitHub:** https://github.com/Almighty-TC/qco-mms.git
- **Project location:** ~/Desktop/qmat

---

## 2. TECH STACK

- **Frontend:** React + TypeScript + Vite → localhost:5173 (or 5174)
- **Backend:** Node.js + Express → localhost:3001
- **Database:** MySQL 8.0.44 on Azure — host: qcosystem.mysql.database.azure.com, db: qmat, user: QCO_admin
- **Schema dump:** ~/Desktop/qmat/qmat_schema.sql

### How to start:
```bash
# Terminal 1 - Backend
cd ~/Desktop/qmat/server && node index.js

# Terminal 2 - Frontend
cd ~/Desktop/qmat && npm run dev

# Terminal 3 - Claude Code
cd ~/Desktop/qmat && claude --dangerously-skip-permissions
```

**Dev login:** tchang@qcogroup.com.au / password / role: admin
**Test subcontractor:** dkowalski@civcon.com.au / password / role: subcontractor
**Test freight forwarder:** schen@tollgroup.com / password / role: freight_forwarder

---

## 3. MODULE STATUS (current as of 02 June 2026)

| Module | Status | Notes |
|--------|--------|-------|
| Login | ✅ Complete | |
| Dashboard | ✅ BUILT | Project-list (Select a project) + per-project health screen (`DashboardProjectScreen`, `dashboard.js`): health score + band, by-module weights (configure modal), pipeline funnel. Reads across modules. |
| Admin | ✅ Complete | Users, suppliers/AVL, settings; Subcontractor + Freight Forwarder roles in dropdown |
| Foundational — WBS | ✅ Complete | Tree, Gantt, tooltip, bulk ops, search, focus mode. Delete-node flow fixed (`5ea7abd`+`81392fe`). **Tree depth control fixed** — now an expansion preset, not a leaky hide-filter (`49c836d`). Expand/collapse-all verified working. |
| Foundational — Commodity Library | ✅ Complete | Table, add/edit, certs, template download |
| Foundational — Equipment List | ✅ Complete | Table, add/edit, certs, template download |
| Procurement — PO Register | ✅ Complete | Register, stat cards, search, RAG |
| Procurement — New PO Wizard | ✅ Complete | 3-step, commodity/tag autocomplete |
| Procurement — PO Detail | ✅ Complete | 7 tabs, approve & lock, variations |
| MTO Register | ✅ Complete | List, new MTO, detail, rev diff, upload |
| Expediting | ✅ Complete | Register, drawer, PO detail (6 tabs), SCN wizard, VDRL |
| ITP | ✅ Complete | Full CRUD on ExpPODetailScreen ITP tab |
| Logistics | ✅ BUILT | SCN register, pipeline bar, 4-tab detail modal, status/date/packages/docs CRUD, ★ critical path. 31 SCNs / 62 packages in project 1. **GAP: Proof of Custody screen not built.** |
| Material Control — Receipting | ✅ Complete | 5-step wizard with Back buttons, inline discrepancy flow, dual TCCC signature |
| Material Control — Stock Register | ✅ Complete | Grouped by warehouse, condition pills, move/docs, stock take modal |
| Material Control — FMR Register | ✅ Complete | Multi-line FMR + per-line approve/partial/reject with roll-up status + WBS ceiling check (rework 02 Jun, commits 57313b5 / 4c04de1). MC + Contractor views. |
| Material Control — Transfers | ✅ BUILT | Pipeline cards, detail modal with lifecycle stepper, 2-step new transfer wizard. 5 transfers (full lifecycle) in project 1. **GAP: new-transfer wizard is free-text, NOT stock-line-linked — does not decrement warehouse_stock.** |
| Role-Based Access | ✅ Complete | Subcontractor + Freight Forwarder scoped nav + API + UI (003a716, 39700e6) |
| Deep-link routing | ✅ Fixed | BUG-08 (project switching) + BUG-09 (deep-link hydrates active project from URL) fixed (commit 9391bca) |
| Traceability | ✅ BUILT & verified 02 Jun | Certs/approvals/trace chain/holds + 6 modals. Hard-mandatory 3-point QA verify checklist (server 422s if any box false; verifying releases the linked hold). Commit e3e68dd. |
| Document Inbox / Document Management | ✅ BUILT & verified 02 Jun | Project-wide aggregate, READ-ONLY register over every module's existing doc tables; jump-to-source via deep link; CSV export. Commit 1d1f775. |
| Meeting / RFI Register | ✅ BUILT | rfi_meeting module (later session) |
| Audit | ✅ BUILT | AuditViewerScreen + audit.js (later session) |
| Reports | ✅ BUILT & verified 19 Jun | Curated library + ad-hoc builder + saved views, across all 4 categories. Backend: `server/reports/{datasets,engine,catalog}.js` + `routes/reports.js` (one injection-safe engine; whitelisted datasets). **Double RBAC gate:** `enforce('reports')` (module) + per-dataset re-check of the SOURCE module's `can_view` (Reports is never a read-leak backdoor). Exports CSV/XLSX (server, exceljs) + PDF (client print view). Composite `project_health` cross-module rollup. Matrix seeded (17 internal roles, 0 external) via `scripts/rbac/rbac_reports_matrix_seed.cjs`. **⚠ PENDING (Thomas, admin creds): `node server/scripts/migrate-report-views.js` to create `report_saved_views`** — until then the saved-views feature returns empty / 503 (route degrades gracefully; everything else works). Verified in browser on project 27: curated flat + grouped + composite + ad-hoc all run; CSV/XLSX 200; dark mode OK; tsc clean. |

**Remaining unbuilt modules:** NONE — all of Meeting/RFI Register, Audit, Reports and Dashboard are built & live (see the CURRENT STATUS section below).

---

## ★ CURRENT STATUS & OPEN ITEMS (20 June 2026) — AUTHORITATIVE
*(This section supersedes §3a/3b/3c/§4/§5/§6 below, which are point-in-time history.)*

**State:** All Phase-1 modules are **built & live**. Branch `feat/three-design-features` HEAD `e66883f` (PUSHED). The app is functionally complete and walked; the three-design-features branch carries Pass-1/2/3 + a full walk-through fix sweep, all committed and pushed. Remaining work is the consolidation pass below + the deferred Phase-2 release gates (TEST_READINESS.md).

---
### ★ CONSOLIDATION RESUME MARKER — NEXT SESSION (do these IN ORDER) ★
The feature work on `feat/three-design-features` is complete and pushed (last `d218232`). Next session is a **consolidation / release-readiness pass**, not new features:
1. **Azure credential pass — DELIBERATE FIRST TASK (both credential ops in ONE focused portal session).** Do these together, clear-headed, before anything else; the rest of the session then runs under the new credentials.
   - **1a. QCO_admin rotation.** Rotate the Azure MySQL `QCO_admin` password (used repeatedly for supply-and-remove migrations this cycle). Update the app's runtime creds (App Service config + local `server/.env`) + any CI/secret store. (Phase-2 gate #7 also lists this.)
   - **1b. Blob Azure setup (pairs with the rotation — same portal session; blob CODE is already committed `d218232`, disk-fallback proven, only the connection string + resource are pending).** TC's ops, never in chat: **(a)** `az storage account create` (suggest `qcommsuploads`, same region as App Service, Standard LRS) + a **private** container `uploads` (NOT public — we stream through the authed API); **(b)** set **`AZURE_STORAGE_CONNECTION_STRING`** in App Service config **and** local `server/.env` (same surface as the rotated DB creds); **(c)** redeploy the backend (handle the new `@azure/storage-blob` dependency — `npm ci` / install on the host); **(d)** run the **blob-path proofs** that were deferred from the build: a new upload lands IN blob + serves FROM blob, AND the dual-read serves a **new blob file alongside an old on-disk file** (prove the fallback both ways). Until 1b is done the app runs disk-only (already proven, graceful). Map: `docs/BLOB_STORAGE_PLAN.local.md` (gitignored).
2. **Deploy everything + full FRESH walk-through.** Deploy the whole `feat/three-design-features` branch (frontend + API — note `d1133f4` is a backend authz change, no migration; all Pass-2/3 migrations are already applied to Azure but must travel WITH the code). Then walk EVERY module end-to-end with fresh eyes — especially the forwarder flows (packing, doc/PoC upload+delete), receipting source-package capture, multi-modal, and the SCN create wizard. Capture any deviation.
3. **Residual test-data cleanup in ZZ project 27 (admin DELETE — `qmat_app` can't, these tables are append-only for it).** Verify each before removing; keep canonical demo data.
   - **~12 throwaway test SCNs** (header rows in the ~2212–2235 range, many with no packages/lines) from this cycle's adversarial/live proofs.
   - **`po_documents` id 6** (po_id 1990, file_name `rt.txt`, already `is_current=0`, disk file removed) — from the blob procurement round-trip.
   - **`traceability_certs` id 3617** (heat_ref `BLOBTEST-H1`, file_name `rt.txt`, disk file removed → download 404) — from the blob traceability round-trip.
   - *(Both blob test rows are harmless — files gone, downloads 404 — but `qmat_app` lacks DELETE on those tables, so they need admin/QCO_admin to remove.)*
4. **/status + /dates forwarder-ownership security fix** (open-item below, currently unfixed): `PUT /scn/:scnId/status` and `PUT /scn/:scnId/dates` don't verify SCN ownership — a forwarder who knows an SCN id can write to non-assigned SCNs. Apply the SAME predicate pattern now proven for docs (`forwarderIsCarrier`, URL-keyed) — the carrier predicate is already built + exported in `logistics.js`, so this is a small, well-templated fix. Adversarial cross-SCN proofs as usual.
5. **Merge `feat/three-design-features` → `main`** (PR), once 1–4 are green and the walk-through is clean.
---


**Scope that grew beyond the original May spec (all built):**
- **Reports** — curated library + ad-hoc builder + saved views; injection-safe whitelisted-dataset engine; double RBAC gate (`enforce('reports')` + per-dataset source-module `can_view`). Saved-views table migration still pending (admin creds) — route degrades gracefully.
- **Meeting / RFI Register** (`rfiMeeting.js` + `MeetingRFIScreen`).
- **Pending-Changes / Confirmer governance queue** (C-c: proposers route create/delete through an approval queue).
- **RBAC / security layer** — PASS-1 matrix verification, strict read-authorization (C-e), tamper-evident audit (hash-chain + checkpoints), least-privilege DB user.
- **Heat / lot tracking** (P0–P5, full stock lifecycle) and the **flowtest/ZZ** demo-data + canonical-baseline apparatus.

**Standards (vs CLAUDE_CONTEXT §GLOBAL STANDARDS) — current compliance:**
- **← Back button** on every screen ✅. **Clickable breadcrumb trail** `Dashboard › Project › Module › ref` in the shared topbar ✅ (built `8ea3eb1` — honors the NON-NEGOTIABLE; back AND trail).
- **Pagination** ✅ broadly rolled out (12 list screens via `usePagedList`/`Pager`). Intentional non-paginated: the **WBS tree** (tree, uses expand/collapse), the **MTO register** (small), **Document Inbox** (aggregate). Confirm these are acceptable.
- **Resizable columns + reset** ✅ rolled out (WBS, Commodity, Equipment, MTO, MC×, Traceability, Logistics + Procurement/Admin). **RAG vocab** ✅. Sticky headers / dark-light / text-size ✅.

**Locked architectural decisions — all still honored** (see §10/§11): VDRL inside Expediting (no standalone route), Suppliers/AVL under Admin, MySQL pooling only (no `createConnection` in routes), Dashboard reads across modules, child line items max one level, dual columns never updated after creation.

**Genuinely OPEN items (the real list — replaces the stale §6 "next priorities"):**
1. **Expeditor-assign authorization** — IN PROGRESS / PAUSED. Widening the allowlist to `{admin, expediting_manager, expeditor, procurement_manager}` alone is **insufficient**: the router `enforce()` independently gates the co-assign routes (POST/DELETE `/expeditors` → procurement.create/delete; PUT `/expeditor` → expediting.edit), so allowlisted roles still 403. Proven live. Recommended Commit 1 = widen the constant **and** make the assign-write routes allowlist-only in `enforce()` (falsy-module residual). Awaiting Thomas's sign-off on the `enforce()` scope before building.
2. **Stale ROS help line** — `Procurement.tsx:1140` still reads "required before expediting begins" (the spec calls this wrong; the field hint at :1000 is correct). Trivial fix.
3. **Legends where colour carries meaning** (MC condition pills, Traceability holds, MC status) — not re-verified this pass; likely still partial.
4. **A1 — Logistics SCN variation read-side** — shows "Additional item" with no parent link / no `is_variation` label; backend GET doesn't join the parent ref. Not re-verified; likely still open.
5. **Modals don't scale with S/M/L zoom** — deferred by design (they portal at scale 1; BACKLOG.md).
6. **Saved-views migration** (Reports) — run `node server/scripts/migrate-report-views.js` (admin creds) when wanted; inert until then.
7. **Phase-2 release gates** (TEST_READINESS.md) — E2E (Playwright), security sweep (OWASP/SAST/secrets/headers), CI, load test, config/env (SMTP, rotate QCO_admin pw). Deliberately deferred until release.
8. **From May, not re-verified:** MTO Rev-Diff logic question (§5); Transfers not stock-linked (§3a); Logistics Proof-of-Custody screen (§3a); Material Control contributes 0 docs to Document Inbox (§3a).
9. **⚠ DEPLOY GATE — Q2 nested packaging (`feat/three-design-features`):** migration `server/scripts/migrate-scn-package-hierarchy.js` (adds `scn_packages.parent_package_id` self-FK, `ON DELETE RESTRICT`) MUST be applied to Azure MySQL (admin/QCO_admin) before the Q2 hierarchy features are used. **Original concern** was that a code-before-migration deploy would break existing package deletes (delete route references `parent_package_id`); this is now **mitigated** — the Logistics delete route capability-detects the column and falls back to flat-delete when it's absent (proven: flat delete returns 200 with column absent), so the strict deploy order is no longer load-bearing for deletes. **Still required before hierarchy can be created/displayed**: the SCN-create hierarchy persistence and the Q2.3 tree views write/read the column (flat creates are unaffected). Net: migration-first is recommended, but a code-first deploy degrades gracefully instead of breaking. **Deploy rule:** the Q2.3 hierarchy UI and this migration MUST travel together in the same deploy (UI without the column would error on hierarchy create/display); **flat package traffic (create + delete) is safe in ANY order** thanks to the create-route flat path and the delete-route capability fallback.

10. **BACKLOG — SCN tab in Expediting Register** (TC suggestion, 25 Jun): show ongoing (not-completed) and completed SCNs separately, matching the existing All/Ongoing/Complete tab pattern. **Open design question:** read-only window into Logistics SCN data vs. a duplicated view — resolve the Expediting/Logistics module separation before building. Not built.

11. **✅ DONE — Q4 Containerised Packaging (`feat/three-design-features`, pushed).** Q4.1–Q4.3 backend complete + committed + pushed to origin (`94ce505` migration, `a0b20f9` hierarchy guards, `a47a6c5` docs, `4c40cde` seal governance). Q4.4 UI not built (deferred). Detail below retained for reference.
    - **Q4.1 DONE & APPLIED (25 Jun, TC signed off):** migration `server/scripts/migrate-containers.js` applied to Azure (supply-and-remove). Added `container_types` table (9 ISO types seeded: 20DC/40DC/40HC/20OT/40OT/20FR/40FR/20RF/40RF — outer+inner dims, tare, capacity m³, max payload; FR capacity NULL = open) + `scn_packages` additions: `container_type_id` (INT NULL, FK `fk_scnpkg_ctype` → container_types ON DELETE RESTRICT, index `idx_scnpkg_ctype`), `container_no` (varchar50 NULL), `seal_no` (varchar50 NULL). All nullable/additive; NO `container_seal_audit` table; documented reverse in script header. Dims are display-only nominal defaults (admin-maintainable; seed is ON DUPLICATE KEY UPDATE).
      **⚠ DEPLOY:** migration now applied on Azure, but it must also travel WITH the Q4 code in any prod deploy (same gate logic as Q2 #9). App capability-detects the columns.
    - **Q4.2 NEXT (typed-hierarchy guards, backend-first, prove with rolled-back bad-payload tests, then HOLD):** container = `scn_packages` row with `container_type_id` set; always top-level (`parent_package_id` NULL); holds sub-packages only, NEVER items directly, NEVER nested. Guards in the create txn: (a) container top-level only; (b) typed↔structural (a container holds sub-packages not items — extends existing leaf-only guard at `expediting.js:1039-1055`); (c) depth-3 cap (container → sub-package → items; no container-in-container). Sub-packages may sit loose top-level (mixed shipments). Multiple containers per SCN allowed. Containers shipment-only (die at receipt; no warehouse_stock; no Q3 collision).
    - **Q4.3 (seal governance) — ★ LOCKED TC RULING, implement EXACTLY:** `seal_no` = audited + set-once + re-seal-requires-reason (records who/when/old→new/reason); NOT freely overwritable; NOT a `_snapshot` column. **Seal-audit mechanism = REUSE `audit_log`** (`action='seal_changed'`, reason in `reason_detail` — inside the hashed envelope), NO separate table. **HARD REQUIREMENT (non-negotiable): the seal-audit insert MUST be IN-TRANSACTION with the seal change and FAILURE-PROPAGATING — if the audit insert fails, the seal change rolls back. The standard non-blocking `writeAudit` (logistics.js:106-124, catch→console.error) is FORBIDDEN on the seal path; use a transactional write that throws on failure, with an explicit code comment so it isn't "simplified" back to the helper later.** `container_no` = free-edit, light-audit, no lock. Both editable in BOTH Expediting and Logistics. Also fix the Logistics PUT silent-overwrite hole (`logistics.js:676-693`, blanket COALESCE, gated only by `enforce('logistics')`).
    - **Q4.4 (later):** UI — wizard container-first, dims display-only (read from container_types on type pick, not copied/editable), SCN-detail tree, receipting reference. Read wireframe first; log deviations in HANDOVER.md.
    - Maps: `docs/MAP_Q4_CONTAINERS.local.md` (gitignored) has full A–F analysis + all TC decisions.

12. **▶ IN PROGRESS — Forwarder-Delegated Packaging (`feat/three-design-features`).** Lets an expeditor delegate an SCN's packing to a freight forwarder, who gets SCOPED write access (packages + governed seals) to THAT SCN only. Builds on Q4 container model + Q4.3 seal governance. Map: `docs/MAP_FORWARDER_DELEGATED_PACKAGING.local.md` (gitignored).
    **▶ RESUME MARKER: D1–D3 done + committed (NOT pushed). Resume at D4 (hand-back lifecycle), then D5 (UI + live cross-SCN isolation verification — needs fresh eyes).**
    - **D1 DONE & APPLIED (25 Jun):** `server/scripts/migrate-delegated-packaging.js` applied to Azure (supply-and-remove). `shipment_control_notes` += `packed_by_type` ENUM('internal','vendor','forwarder') NOT NULL DEFAULT 'internal'; `packaging_delegated_to` INT NULL + FK `fk_scn_pkg_delegate`→users(id) ON DELETE SET NULL + `idx_scn_pkg_delegate`; `packaging_status` ENUM('pending','complete') NULL; `packaging_completed_at` DATETIME NULL. Additive; 331/331 existing SCNs defaulted to 'internal'. Commit `6de206d`. **⚠ DEPLOY:** migration must travel with the code (app capability-detects).
    - **D2 DONE (the security core):** router-level authorization carve-out in `logistics.js` — a `freight_forwarder` may read/create/edit packages + set seals on an SCN IFF `shipment_control_notes.packaging_delegated_to = req.user.id` for that `:scnId`. **Predicate keys off the URL :scnId, NEVER req.body** (`forwarderOwnsScnPackaging`, exported). Lives at router level because `enforce('logistics')` kills forwarder POSTs at the router gate first. `requireInternalLogistics` removed from package POST (deliberate, replaced by the predicate; still on documents POST). DELETE not carved out → forwarders can't delete. Cross-SCN leakage proven closed (14/14 incl. body-spoof). Commit `6ce3548`.
    - **D3 DONE:** delegation write path in SCN create (`expediting.js`, `resolveDelegation` exported). `packed_by_type='forwarder'` requires an ACTIVE freight_forwarder; 'internal'/'vendor' forbid a delegate (must be NULL). On delegate: sets `packaging_delegated_to`, `forwarder_user_id`=delegate (visibility scoping), `packaging_status='pending'`. Backend tolerates zero packages (unfinished packaging). Deploy-tolerant (capability-detect). 13/13 proofs. Commit `6e2535e`.
    - **D4 NEXT (hand-back lifecycle):** forwarder marks `packaging_status='complete'` (+ `packaging_completed_at`) on THEIR delegated SCN only — reuse the D2 ownership predicate. Expeditor can see status + review packages. Proofs: forwarder completes own delegated SCN → status flips, visible; forwarder marks a non-delegated SCN → 403.
    - **D5 (UI + live verify — needs fresh eyes):** wizard packing-scenario picker (internal/vendor/forwarder) + forwarder picker + relax the D2 `allFullyAllocated` gate (CreateSCNWizard.tsx:294-295) on the delegated path; forwarder-facing "delegated to me, pending packing" list + packaging UI (reuse Q4 container wizard) + 'mark complete'; expeditor review surface. **Live Chrome: delegate → log in AS forwarder → pack + seal → mark complete → log in as DIFFERENT forwarder → confirm cross-SCN isolation live.** Read wireframe first; log deviations.
    - **v1 LIMITATION (logged):** Delegation is creation-only — no re-delegation/edit route exists (only the Q4.3 identifiers PUT). Build a re-delegation endpoint only if needed.
    - **⚠ OPEN SECURITY FIX (separate from delegation, pre-existing — NOT introduced by this work):** the forwarder `PUT /scn/:scnId/status` and `PUT /scn/:scnId/dates` routes (logistics.js) don't verify SCN ownership — a forwarder who knows an SCN id can write to non-assigned SCNs (forwarder scoping today lives only on the register LIST query, not these write routes). Apply the D2 ownership-predicate pattern to close it. Surfaced by the delegation map (E12).

13. **✅ DONE — Pass 3: Heat/lot receipt-side provenance + trace-back (`feat/three-design-features`, NOT pushed).** Records at RECEIPT time where stock came FROM (source package + heat) as immutable provenance on the append-only `receipt_lines`, plus a trace-back pointer on `warehouse_stock` — stock stays heat+location keyed (provenance is NOT a live stock property; you trace BACK through the receipt). **Both 3a and 3b complete.** All steps capability-detected (deploy-tolerant) and proven with rolled-back adversarial tests; no FOR UPDATE / txn / mutation lines touched on the read side (diff-proven).
    - **3a DONE (heat/cert → package link):** migration `migrate-scn-heat-package.js` (heat/cert→package columns) APPLIED to Azure; `scn_heats` INSERT moved to after the package loop so `package_id` is set at INSERT (scn_heats is append-only — qmat_app has no UPDATE grant; an UPDATE-after-loop 500'd before the fix). Mill-cert upload accepts `package_id`/`heat_id`. Per-package 🔥/📄 display in Logistics PackagesTab. Commits `255f0dd` + logistics. Legacy fallback left NULL (TC-praised).
    - **3b DONE (receipt provenance + trace-back), steps 3b-1…3b-4:**
      - **3b-1** migration `migrate-receipt-provenance.js` APPLIED to Azure — `receipt_lines += source_scn_package_id` (FK `fk_rl_srcpkg`→scn_packages SET NULL), `receipt_lines += scn_heat_id` (FK `fk_rl_scnheat`→scn_heats SET NULL), `warehouse_stock += receipt_line_id` (FK `fk_ws_receiptline`→receipt_lines SET NULL); all nullable + indexed. Commit `6c741a2`.
      - **3b-2** receipt-capture wiring inside the atomic receipt txn (`materialcontrol.js`) — both `receipt_lines` inserts carry `source_scn_package_id`+`scn_heat_id`; all FOUR `warehouse_stock` inserts (off-PO good/damaged, PO good/damaged) carry `receipt_line_id`; legacy no-PO fallback left NULL. Commit `329da4f`.
      - **3b-3** transfer-copy — destination `warehouse_stock` insert copies `receipt_line_id` from source (mirrors `heat_number`); trace survives partial + whole-holding transfers. Commit `962961f`.
      - **3b-4** trace-back read + receipting capture UI. Commit `30b5b96`. Backend reads only: stock register query gains origin chain (`receipt_line_id`→`receipt_lines`→`scn_packages`/`scn_heats`→mill-cert via `scn_documents`); SCN detail gains per-package received rollup (qty/receipt/heat counts). UI: receipting source-package dropdown (capture), stock-detail "Origin (trace-back)" row, SCN PackagesTab "📥 received N" badge. Graceful "—"/no-badge for legacy/NULL. 16/16 rolled-back proofs + live HTTP smoke (200, fields present, degrade null) + live UI verify of both display surfaces (no console errors).
    - **⚠ ONE UN-VERIFIED-LIVE PATH (proof-covered, verify in walk-through):** the **receipt-with-source-package CAPTURE form** could not be exercised live — project 27 had **no pending-receipt SCN**, so the receipting screen had no lines to render the source-package dropdown into. Covered by tsc/build + the rolled-back persistence proof (receipt w/ source pkg+heat → `receipt_lines` carries both + `warehouse_stock` traces the full origin chain). **Action:** in the next walk-through, get an SCN to receiving status and confirm the dropdown renders + persists end-to-end live.
    - **⚠ DEPLOY:** the three Pass-3 migrations are applied on Azure but must travel WITH the Pass-3 code in any prod deploy (same gate logic as Q2 #9); app capability-detects all new columns and degrades gracefully (reads return NULL, writes default NULL).

14. **✅ DONE — Multi-modal transport storage (Pass 2, Item 2) (`feat/three-design-features`).** Shape (a) was chosen and fully built this session — schema + create wiring + detail display, verified live + rolled-back proof. Commit `fcd43be`. Migration applied to Azure: `shipment_control_notes.mode` enum now includes `'multi'`; added `transport_modes` (constituent legs, e.g. `'sea,road'`) + `transport_mode_notes` (leg detail). The SCN wizard's Multi-modal UI (Sea/Air/Road/Rail/Courier checkboxes + leg-notes) now sends the legs; the create route persists `mode='multi'` + `transport_modes` + `transport_mode_notes`; SCN-detail displays the constituent modes + notes. Capability-detected (deploy-tolerant). **⚠ DEPLOY:** migration is on Azure but must travel WITH the code in any prod deploy (same gate logic as Q2 #9); app degrades gracefully if the column/enum value is absent.

15. **✅ DONE — Walk-through fix sweep + forwarder doc/PoC carrier-auth (`feat/three-design-features`, all PUSHED, last `e66883f`).** The post-Pass-3 consolidation of bug fixes + the new external-role authorization. Supersedes the in-item "RESUME MARKER" notes under #12 (Forwarder-Delegated Packaging D1–D5 is COMPLETE — packing UI, contents persistence, mark-complete hard-block all done & proven).
    - **Forwarder packing fixes** (`9efc027`): Create-button real disable-reason feedback (no false allocation banner for vendor/forwarder); forwarder packing **contents UI + `scn_package_lines` persistence** (mirrors the wizard); **mark-complete allocation hard-block** (every line fully packed; cross-SCN isolation intact). Backend + frontend; adversarial + live proofs.
    - **Polish pass** (`1490993`): off-PO variation ROS **inherits** the parent line's ROS (editable); qty **lock-from-start** (itemized = 1 box, both wizard + forwarder form); **dimension-violation reason** surfaced in the Create banner; forwarder **inherit SCN-details→Packages** (no double-pick). + map `docs/MAP_BUNDLE_QTY_REDESIGN.local.md` (gitignored) for the deferred bundle-qty redesign (a package = N units, different contents per unit) — NOT built, ready to scope.
    - **Forwarder doc + PoC authorization** (`d1133f4`) — NEW external-role auth, **backend + UI**: a `freight_forwarder` may **upload** docs + PoC on an SCN where `forwarder_user_id` = their id (the CARRIER relationship — DISTINCT from `packaging_delegated_to`), and **delete only their OWN uploads** on that carrier SCN (both carrier AND `uploaded_by`). `forwarderIsCarrier` + `forwarderMayDeleteDoc` predicates (URL-keyed, exported), `requireDocUploadAuth` / `requireDocDeleteAuth` middleware. Adversarial cross-SCN + body-spoof + own-vs-others proofs all green; live-verified (carrier forwarder sees upload/PoC + own-doc trash; non-carrier 403 + invisible). **⚠ DEPLOY:** backend authz change, **no migration** — API must redeploy with the frontend.
    - **PO-fully-assigned banner + ROS single-line** (`e66883f`, frontend-only): green "✓ All line items fully assigned to SCNs" banner on the PO drawer when every line's assigned qty meets its total; off-PO variation row laid out on one line (ROS date no longer wraps/clips).
    - **NEXT for this branch = the CONSOLIDATION pass** (see the ★ resume marker near the top of this section): rotate QCO_admin FIRST → deploy-all + fresh walk-through → ~12 ZZ-27 test-SCN cleanup → /status /dates ownership fix → merge to main.

16. **▶ TODO (fresh session, NOT built) — Date-logic validation + "Create disabled" feedback ROOT-FIX (`CreateSCNWizard`).** Logged 28 Jun. **Problem:** the Create-SCN gate blocked silently on illogical dates (e.g. ETA before ETD, ETD/ETA before CCD) — correct to block, but NO reason surfaced. This is the **3rd instance of "correct gate, silent block"** (after untyped-container and dimension-violation, both already fixed by surfacing the reason in the Confirm banner). **Root fix wanted (NOT a one-off patch):** audit EVERY condition that can make `canCreate` false and ensure each surfaces a clear reason in the Confirm disable-reason banner — so no gate, present or future, can disable Create silently. The banner pattern already exists (allocation / untyped-container / dimension / forwarder reasons) — extend it to be exhaustive. **Resolve FIRST (read-only diagnosis):** does a date-logic validation actually EXIST, or did Create block for a DIFFERENT reason that coincidentally cleared when dates changed? Trace the real cause before building. **If no date rule exists, ADD** sensible date-ordering validation (logical CRD/CCD/ETD/ETA ordering) WITH its banner reason. Scope: which date fields, the correct ordering rules, hard-block vs warning.

17. **▶ TODO (fresh session, NOT built — FEATURE, needs scoping) — SCN status-lifecycle expansion (`logistics.js` status route + Update-Status UI).** Logged 28 Jun. **Problem:** the Update SCN Status dropdown is missing intermediate states — "Cargo picked up", "Cargo loaded onto vessel", "Cargo in transit" (observed: a forwarder login only had Customs Review / In Transit / Delivered etc., not the pickup/loading granularity). **Wanted:** add the missing intermediate statuses, settable by **freight_forwarder AND logistics AND expediting** roles (NOT forwarder-only). **This is a FEATURE, not a fix — scope BEFORE building:** (a) the full intended status lifecycle — what is the complete ORDERED set? (b) which roles may set which transitions; (c) any ordering/transition rules (the `NEXT_STATUSES` map in `logistics.js` governs valid transitions today); (d) the status enum migration (`shipment_control_notes.status` is an enum — adding states = an additive migration, supply-and-remove via QCO_admin). **Distinct from the carrier-doc auth (#15)** — this is the status-transition WORKFLOW, not document authorization.

18. **✅ DONE (CODE) — Azure Blob storage migration (`feat/three-design-features`, committed `d218232`, pushed).** Durability fix: file uploads move off ephemeral App Service local disk onto Azure Blob, via a **DUAL-READ FALLBACK** (blob-first, disk-fallback) so nothing breaks before/after cutover. `server/lib/blobStore.js` (`putFile`/`getFile`/`keyFor`/`persist`, degrade-safe — no connection string → returns null, falls back to disk, never throws). All **7 write paths** (logistics, procurement, vdrl, mto, foundational, traceability, fmr-poc) → `memoryStorage` → `blobStore.persist` (key stored on blob; byte-identical legacy disk shape on fallback). All **5 read points** (the `documents.js` unified resolver covering 6 modules + procurement/traceability/foundational/fmr-poc own routes) → blob-first then disk, still streamed through the authed API (no SAS/public URLs). Module prefixes aligned to the `documents.js` RESOLVERS keys (caught + fixed a write/read mismatch). **Proven:** keyFor normalizes all 3 stored shapes (relative/absolute/bare); graceful degradation with the string absent; live disk-fallback round-trips (logistics/procurement/traceability write→disk→serve, content intact); **logistics forwarder-doc auth NOT regressed** (auth is before the storage stage — 6/6 + HTTP 201/403). **⚠ REMAINING = Azure setup only (consolidation item #1b): create the storage account + private `uploads` container, set `AZURE_STORAGE_CONNECTION_STRING`, redeploy with `@azure/storage-blob`, then run the blob-path proofs.** Until then the app runs disk-only (graceful). Map: `docs/BLOB_STORAGE_PLAN.local.md` (gitignored).

**Working discipline (in force — carry forward):**
- **Single channel** — no parallel/spawned tasks.
- **Map/read-first** — read the wireframe (`public/QMAT-prototype.html`) + relevant code before building; report the map before changing for non-trivial work.
- **One concern per commit; PASS C before push** (tsc clean · canonical 1–4 0 drift · audit chain intact).
- **HOLD for review — do NOT self-push.** Thomas reviews each commit; push only on his say-so. Branch off main only if asked.
- **Deviation-from-bible:** the wireframe is authoritative for design, CLAUDE_CONTEXT's standards/decisions for rules; flag drift, fix-vs-keep is Thomas's call.
- Rolled-back / bad-payload probes for RBAC/data tests — never mutate canonical projects 1–4; ZZ project 27 for tests.

---

## 3a. KNOWN GAPS (as of 02 June 2026)
> ⚠ HISTORICAL (≈02 Jun) — superseded by the CURRENT STATUS section above. Some items here are now resolved.

- **Logistics — Proof of Custody screen not built** (spec'd in CLAUDE_CONTEXT; `CreateSCNWizard` exists but is launched from Expediting, not the Logistics register).
- **Transfers — not stock-linked**: the 2-step new-transfer wizard uses free-text item/description + from/to locations, so it does **not** pick from or decrement real `warehouse_stock` rows.
- **Document Management** (read-only aggregator): download is a **mock toast** (the module owns no files — real downloads live on each source module's screen); **Material Control contributes 0 documents** (no FMR-docket / receipt-POD table exists); **upload routing is partial** — wired for Logistics + Procurement, other modules direct the user to their own uploader, Material Control marked "not yet supported".

---

## 3b. BACKLOG / NOT STARTED
> ⚠ HISTORICAL (≈02 Jun) — superseded by the CURRENT STATUS section above. Heat/lot is COMPLETE; the "NEXT UP" manual/help pass and the items below reflect early-June state.

- **Heat / lot tracking — ✅ COMPLETE (P0–P5).** Spec [docs/HEAT_LOT_TRACKING_SPEC.md](docs/HEAT_LOT_TRACKING_SPEC.md); build plan [docs/HEAT_LOT_TRACKING_PHASING.md](docs/HEAT_LOT_TRACKING_PHASING.md). Heat travels the FULL lifecycle:
  - **P0 (7b45ba0)** `warehouse_stock.heat_number` + Stock Register / stock-take read-through.
  - **P1 (b7327ff)** `scn_heats` + heat capture at SCN creation (the dropdown source).
  - **P2a (78e26b4)** receipting heat entry (declared dropdown + off-list-with-reason + bulk), 1:1.
  - **P2b (2bfb0fe)** split a receipt line across N heats (N holdings); split (a+b) ≡ single proven.
  - **P3 (f4ed99c)** transfers carry heat to the destination holding + picker display + durable `warehouse_transfers.heat_number` snapshot.
  - **P4a-i (e365846)** FMR-out **issue + decrement** subsystem (auto-FIFO, atomic, over-issue impossible, `fmr_issue_lines` ledger, status roll-up); also fixed on-hand queries to exclude `trace_hold`.
  - **P4b-i (9241885)** record consumed heat on issue (FIFO) + issued-heat display.
  - **P4b-ii (a: c6e7b2a backend / b: f4fe000 picker UI)** optional user-pick-by-heat override (FIFO default; guards proven 422+zero-mutation).
  - **P5 (UNCOMMITTED — held for review)** traceability heat⇄cert linkage, both directions, via a **case-insensitive normalized join** `UPPER(TRIM(heat_number)) = UPPER(TRIM(heat_ref))` — Stock Register heat→cert badge + CertDetailModal "material carrying this heat". No schema change.
  - **STOCK LIFECYCLE COMPLETE:** stock **enters** (receipting), **moves** (transfers), and **leaves** (FMR-out issue) — all decrement/conserve correctly and all exclude `quarantine` + `trace_hold` from issuable.

- **WBS fixes — ✅ DONE (legends + Gantt depth control).** See §3c for the WBS bugs still OPEN.
  - Gantt legend (09d0f5c) + both legends moved to the bottom, corrected to the REAL colours (schedule bars Planned/Forecast/Actual + ROS diamond + Today line; RAG dots On track/At risk/Breached/In progress/Not set). **Tree legend now committed (9b605c0).**
  - **Gantt depth control — committed (7e828ae).** Reveals levels beyond L3: dropdown **L1 / L1–L2 / L1–L3 / All** + numeric **1–15**, two editors of one `ganttDepth`. Finite = **force-show** that many levels; **All = follow tree expand-state** (Infinity). Dead "All levels" tree-dropdown hidden in Gantt view. Frontend-only.

- 📖 **User manual:** rebuilt as a valid `.docx` (09d9a1c — old one was corrupt text-renamed-docx); in-app "View full manual" link repointed to `/docs/QCO_MMS_User_Manual.docx`; maintained per-phase. Old `docs/USER_MANUAL.md` (markdown) is unlinked — cleanup candidate.

- ⏭ **NEXT UP — the manual / help pass.** ONE shared source of truth: the manual (full) + in-app help panels (condensed, via `src/helpContent.tsx` / `src/components/HelpDrawer.tsx`).
  - **Chapters to WRITE:** Ch8 Logistics · Ch9 Material Control (Receipting / Stock / Stock-take / FMR / Transfers) · Ch10 Traceability · Ch11 Heat/Lot.
  - **Fold in captured facts:** WBS Gantt controls — Quarters/Months = timeline-scale zoom; depth dropdown + numeric (finite force-show / All follow-expand); bars = planned/forecast/actual; ROS = orange diamond; Today = orange line. Heat matching is **CASE-INSENSITIVE** (normalized join). Stock lifecycle (enter/move/leave) + quarantine/trace_hold never issuable.

---

## 3c. WBS AUDIT FINDINGS + GLOBAL TABLE STANDARD (logged 02 Jun — read-only diagnosis, nothing built)
> ⚠ HISTORICAL (≈02 Jun) — superseded. The WBS depth-filter "leak" diagnosed here is now FIXED (`49c836d`, depth = expansion preset). The resizable-tables rollout described as a future track is now largely DONE.

### ✅ WBS DELETE-NODE FLOW — FIXED (data-integrity; was HIGH) — backend `5ea7abd` + UI `81392fe`
- **RESOLVED (A3, 02 Jun):** the 3-step delete flow is restored and the delete is hardened. **Backend `5ea7abd`** — transactional `DELETE` with guards (children → locked-PO → orphan-lines, all clean **409 + zero mutation**, proven 29/29 rolled-back), validated+scoped transactional `reallocate` (incl. locked-PO refusal), `is_locked` added to impact. **UI `81392fe`** — restored step-2 Reallocate + step-3 summary/Back, corrected routing (children/locked block, lines→reallocate), 🔒 locked-PO badges, fixed the false "child nodes will also be removed" copy. All browser proofs passed. (The delete now also writes a **correct** audit row — see the global `audit()` helper bug above, still open for other routes.)
- **History (for context):** the 3-step wizard shipped **working in `d49ac74`**, then step-2 (Reallocate) was **INADVERTENTLY SEVERED in `ad5e6b0`** — the step-2 JSX was dropped, but the state (`allocations`, `allReallocated`), the `ReallocateLineRow` component (~line 411), and the backend `PATCH /wbs/:id/reallocate` were all LEFT IN PLACE (a recoverable regression, now recovered).
- **LIVE SYMPTOM:** a node WITH affected PO lines → Continue sets step 2 → no step-2 JSX exists → modal body renders **blank (dead-end)**. A node with NO affected lines → goes to Confirm → deletes.
- **DATA-INTEGRITY HOLES (proven via rolled-back tests, project 1):**
  - Backend `DELETE /wbs/:id` is a **bare `DELETE FROM wbs_nodes WHERE id=?`** — no child check, no lock check, no `po_lines` check.
  - PO↔WBS link is **string-only** via `po_lines.wbs_code_snapshot` (varchar, **no FK**; `wbs_id` NULL on all 90 project-1 lines, so the FK never fires). Deleting a leaf **SILENTLY ORPHANS** its PO lines (they keep a dead WBS code).
  - `purchase_orders.is_locked` **EXISTS but is NEVER checked** — a locked PO's lines can be silently detached.
  - Deleting a node WITH children: `parent_id` self-FK (NO ACTION) blocks it at the DB → backend try/catch returns a **raw HTTP 500** (not a clean error).
  - **All of the above are now fixed** by `5ea7abd` + `81392fe` (see the RESOLVED note at the top of this item).

### 🟡 WBS TREE DEPTH FILTER — LEAKS (UI bug; MEDIUM priority)
- "Level 1 only" (`depthFilter`) still shows deeper nodes under an expanded parent. **Pre-existing, rooted in `ad5e6b0`** (NOT caused by the recent depth/legend work).
- **CAUSE (two compounding defects in `FoundWBSScreen.tsx`):** (1) `collectVisible` propagates visibility down the whole subtree — `walk(n.children, match || parentVisible)` — correct for SEARCH ("show a hit's subtree") but wrong for a depth cap; once an L1 node matches, all descendants land in `visibleIds`. (2) `WBSRow` renders children with `filterVisible={filterVisible}` (parent's value) gated only by `isExpanded` → child visibility follows manual expand-state, not the depth filter.
- **FIX PLAN (not built):** make depth a true cap, decoupled from search propagation — stop descending past max level (don't pass `parentVisible` through a depth-exceeded boundary); gate `WBSRow` children on their OWN `visibleIds` membership, not the parent's; optionally clamp the shared `expanded` set for depth-filtered-out nodes. **CARE:** `collectVisible` is shared with search + RAG filters — the fix must NOT break "show subtree of a search hit." UI-only, low risk.

### ✅ WBS items that are FINE (no action)
- Tree expand/collapse works (the earlier "broken" report was a **stale Vite HMR bundle**).
- Tree + Gantt legends now correct + at the bottom (Gantt `09d0f5c`; Tree `9b605c0`).
- The shared `expanded` Set between Tree↔Gantt is **intentional** (persists expansion across the toggle).

### 📐 GLOBAL STANDING RULE + ROLLOUT TRACK — RESIZABLE TABLES (its own track, ~1.5–2 wks)
- **STANDING RULE (also added to §7):** EVERY table in the app MUST have (1) resizable columns and (2) a reset-to-default button. Any new table must meet this from the start.
- **CURRENT STATE:** implemented only in **Procurement + Admin**. ~12–14 other tables are bare.
- **INFRA EXISTS (no new component needed):** `useColumnResize(tableId, defaultWidths, minWidths)` hook (localStorage-persisted widths + drag + `resetWidths`) + `AdminTable` component (bakes in resize handles + reset button + scroll fades). A second, name-based system (`useTableResize` + `ResizableTable`/`HeaderCell`) is used only by the **Dashboard project table** (reset folded into the global "Reset preferences" topbar button).
- **ROLLOUT SURFACE (lacking resize+reset):** WBS Tree, FoundCommodity, FoundEquipment, MTOList, MTODetail, MCStockRegister, MCReceipting, FMR tables, Logistics, Traceability register, PODetail, ExpPODetail/Panel.
- **APPROACH (not built):** standardise on `useColumnResize` + `AdminTable`. **Tier 1** — migrate straightforward grids to `AdminTable` (Commodity, Equipment, MTO list, Stock Register, Receipting, Logistics, Traceability) ≈0.5–1 day each. **Tier 2** — hook-only adoption for bespoke tables (WBS Tree chevron/indent rows, detail panels): wire `useColumnResize` + a ↺ reset button onto the existing `<table>` ≈0.5 day each. Sequence one-screen-per-commit with a verify each.

### ⏭ SUGGESTED ORDER WHEN RESUMING
1. ~~**A3 WBS delete flow**~~ — ✅ DONE (`5ea7abd` backend + `81392fe` UI).
2. **A1 WBS depth filter** (UI-only, NEXT): fix the cap/propagation decoupling → prove → commit.
3. **The manual/help pass** (Ch8 Logistics · Ch9 Material Control · Ch10 Traceability · Ch11 Heat/Lot; fold in WBS Gantt controls + case-insensitive-heat note).
4. **The resizable-tables rollout track** (its own multi-commit sequence).
5. ~~**Global `audit()` helper fix**~~ — ✅ DONE (foundational + mto helpers; see §5). Deferred: unify the four per-file helpers.

---

## 4. WHAT WAS DONE THIS SESSION (01 June 2026 — final)
> ⚠ HISTORICAL — a 01-Jun session log. Many more sessions have shipped since (see `git log`): RBAC hardening, Reports, MTO revision rules, commodity-WBS optional, audit duplicate-review warning, Materials-Control label + Actions headers, WBS depth fix, breadcrumb trail. Kept for context only.

- **Material Control module:** Fully built — Receipting (5-step wizard), Stock Register,
  FMR Register, Transfers. 3 new DB tables (warehouse_stock, fmr_requests, warehouse_transfers).
  Backend: 11 endpoints at `/api/mc/`. All 4 screens verified in Chrome.

- **Receipting Wizard fixes** (`003a716`):
  - Back buttons added to steps 2, 3, 4 (state preserved across navigation)
  - Step 2 discrepancy flow corrected: "Flag discrepancy" now stays on Step 2 and expands
    inline UI (amber row highlight, per-row type selector, notes textarea). "Proceed with
    discrepancy noted" button disabled until notes filled.
  - Step 3 chip click now fills input AND enables Next button
  - Step 5 shows amber discrepancy banner when `hasDiscrepancy=true`

- **Role-based access** (`39700e6`):
  - Seeded test users: Dave Kowalski (subcontractor) + Sarah Chen (freight_forwarder)
  - WBS scope 03.01/03.02/04.01 assigned to Dave Kowalski via user_wbs_access
  - 8 SCNs assigned to Sarah Chen via forwarder_user_id
  - Sidebar nav: subcontractor sees only MC (Stock + FMR); forwarder sees only Logistics
  - Backend: stock endpoint scopes to WBS + strips location_code; receipting/transfers → 403;
    FMR approve → 403 for non-MC-team; logistics register → forwarder_user_id filter
  - Frontend: ScopeBanner component, useCurrentUser hook, hidden restricted UI elements
  - **API verified:** subc stock = 6 items (scoped, loc=null) ✅; subc receipting = 403 ✅;
    subc FMR approve = 403 ✅; FF logistics = 8 SCNs ✅; admin logistics = 31 ✅

- **Partial SCN assignments identified:**
  - PO-2024-017 Line 1: qty=2, assigned=1, available=1
  - PO-2024-025 Line 1: qty=24, assigned=12, available=12
  - PO-2024-026 Line 1: qty=4, assigned=2, available=2

- **MilestoneLegend sweep:** Added to FoundWBSScreen, FoundCommodityScreen, FoundEquipmentScreen,
  MTOListScreen, MTODetailScreen. Procurement has own inline legend. MC screens excluded (no
  milestone dots — text status pills only).

- **Full regression test** (`914126a`) — ✅ Complete. All screens pass.
  - VDRL drill-in back button: ✅ Confirmed already fixed — returns to list correctly.
  - Bugs found and fixed during regression:
    * Forwarder pipeline badge showed 31 (should show 8) → scoped pipeline_counts query to forwarder_user_id
    * Subcontractor navigated to Receipting screen → nav defaults to mc-stock + redirect guard in MCReceiptingScreen

- **Word user manual** — QCO_MMS_User_Manual.docx created at ~/Desktop/qmat/docs/
  Covers all completed modules: Admin, Foundational, MTO, Procurement, Expediting, Logistics,
  Material Control. Includes Role-Based Access Matrix appendix.

---

## 5. OPEN BUGS / KNOWN ISSUES
> ⚠ HISTORICAL (≈02 Jun) — superseded. Audit helpers are FIXED; the MTO Rev-Diff question + the deferred pending-changes edit-gating remain (carried into the CURRENT STATUS open list).

- **SCNDetailModal status update** — status update via "Update Status" button doesn't close modal
  when API returns error (stale `selectedScn` state after direct API test). Works correctly in
  normal flow. Root cause: React state not refreshed before modal uses `scn.display_status` for
  transition validation. Fix: call `refreshDetail()` before opening StatusUpdateModal.

- **🟡 MTO REV DIFF — logic problem (logged 02 Jun, NOT yet diagnosed; MEDIUM).** Reported by Thomas
  via screenshots; no investigation done beyond the observation. Revisit AFTER the A3 WBS delete work.
  - **Observed on MTO-PIL-001 (Mechanical & Piping), Rev Diff tab:** A→B = 7 Modified / 8 Unchanged;
    A→C = 7 Modified / 8 Unchanged (**identical to A→B**); B→C = 0 Modified / 15 Unchanged ("all 15 identical").
  - **The contradiction:** if B→C shows zero changes, B and C are identical — which makes A→B == A→C
    consistent, BUT then why was Rev C allowed to upload at all (a no-op revision)? If B and C are
    NOT actually identical, then B→C is wrong (falsely "all identical") and A→B == A→C is suspicious
    (diff may compare the wrong revs / mis-key lines). Either way the revision/diff logic has a problem:
    (a) upload allowed a content-identical no-op revision (upload-guard gap; diff may be correct), or
    (b) the diff computation is broken (wrong revs compared / changes missed).
  - **When revisited — diagnose first (no build):** (1) raw-compare stored line items for Rev A/B/C of
    MTO-PIL-001 — are B and C genuinely byte-identical or do they differ? (2) upload flow — is there any
    guard against uploading a revision whose CONTENT is identical to the previous (manual mentions a
    duplicate-revision-LETTER 409 guard, but content-identical?)? (3) Rev Diff logic — does it compare
    the correct two revisions' line sets, or could it compare the wrong rev / mis-key lines so changes
    are missed/mis-attributed? Verify A→B, A→C, B→C each compute against the right data. (4) Root cause →
    (a) no-op revision wrongly allowed, (b) diff logic broken, or (c) other → propose fix.

- **✅ AUDIT HELPERS — FIXED (was HIGH; the original handover claim was mis-scoped).** Read-first map
  ([claude-code-audit-helper-readfirst.md], chat output) corrected the earlier claim: there is **NO single
  shared helper** — there are **four independent `audit()` definitions** (one per route file) + inline
  inserts; `audit_log` was **NOT empty** (97 rows; MC / procurement / traceability / expediting / admin /
  logistics all wrote fine). The breakage was **localized to TWO files**:
  - `foundational.js` — wrong cols (`before_state`/`after_state`/`ip_address`) + omitted NOT NULL `resource`
    + silent `.catch(()=>{})` → every `wbs_*`/`commodity_*`/`equipment_*` audit failed silently.
  - `mto.js` — correct col names but omitted NOT NULL `resource` → every `mto_*` audit failed (warned).
  - **FIX SHIPPED:** both helpers corrected — proper columns, `resource` derived from `req.originalUrl`
    **path-only with `/api` prefix stripped** (matches the existing 97 rows' convention), and silent/warn
    catch → `console.error` log-and-continue (fire-and-forget; audit failure never 500s a user action).
    Proven with rolled-back live-HTTP tests (foundational create+update, mto register create) — correct rows
    with all NOT NULL cols populated, baseline restored 97→97, zero canonical mutation. Commits: foundational
    + mto (one each). **WBS delete (`5ea7abd`) already wrote correct rows directly (bypasses the helper).**
  - **Not done (deferred cleanup):** unify the four per-file helpers into one shared helper. Past actions
    (pre-fix `wbs_*`/`commodity_*`/`equipment_*`/`mto_*`) were never logged and cannot be recovered.

- **Backlog (no action, product-design question):** should the **Expediting PO Audit Trail tab**
  (`expediting.js:595`) also surface `audit_log` events? Today it composes only from
  `expediting_forecast_history` (milestone forecast changes) + `po_action_notes` — it does **not** read
  `audit_log`. Not a defect; decide whether to fold the general audit stream in.

- **⏸ DEFERRED — edit-gating in `pending_changes` (C-c Decision 2).** The `ALTER TABLE pending_changes
  MODIFY action ENUM('create','delete','edit')` was **not run**, and edit-staging was **not built**,
  because the two signed baseline-major *edit* cases are currently **unreachable via the API**:
  (1) **structural WBS move** (re-parent / code change) — the WBS update route only edits
  notes/ros/rag/dates (code/parent_id immutable); (2) **MTO qty/rev on a PO-raised line** — the line
  update route's locked branch allows only ros_date/vdrl_required when `status='po-raised'`.
  Both protection points now carry a **GOVERNANCE comment** (foundational wbs PATCH; mto line-update
  locked branch). **If either route is ever opened** (a re-parent/code-change route, or unlocking
  po-raised qty edits), you MUST: add the ALTER (+'edit'), add an `applyChange` UPDATE branch in
  `pendingChanges.js`, add edit-detection on that route, and gate per the signed baseline-major
  definition (confirmer = project_manager/admin) — never write direct.

---

## 6. NEXT SESSION PRIORITIES (in order)
> ⚠ HISTORICAL — STALE. All five items below (Traceability, Document Inbox, Audit, Reports, Dashboard) are BUILT & live. For the real current priorities see the "Genuinely OPEN items" list in the CURRENT STATUS section near the top.

1. ~~Traceability module~~ — ✅ BUILT
2. ~~Document Inbox~~ — ✅ BUILT
3. ~~Audit~~ — ✅ BUILT
4. ~~Reports~~ — ✅ BUILT
5. ~~Dashboard~~ — ✅ BUILT

---

## 7. GLOBAL STANDARDS — NON-NEGOTIABLE

1. **← Back button + breadcrumb on EVERY screen** — Dashboard › {project} › {module}. No exceptions.
2. **? Help button on EVERY screen** — opens HelpDrawer. "Help coming soon" placeholder acceptable.
3. **USER_MANUAL.md update EVERY session** — ~/Desktop/qmat/docs/USER_MANUAL.md
4. **Wireframe is the bible** — ~/Desktop/qmat/public/QMAT-prototype.html. Deviations require approval.
5. **Sticky table headers** — overflow wrapper with maxHeight; `thead position:sticky top:0`
6. **RAG stripes** — `boxShadow: 'inset 4px 0 0 COLOR'` — NEVER `borderLeft`
7. **Resizable columns + reset on EVERY table** — orange `#E84E0F` drag handles (3px on hover) AND a reset-to-default (↺) button. NON-NEGOTIABLE for every table, new or existing. Use the shared `useColumnResize` hook + `AdminTable`. Currently only Procurement + Admin comply — see §3c for the rollout track.
8. **Collapsible left sidebar** — 56px collapsed / 240px expanded; state in localStorage
9. **Parameterised queries ONLY** — no SQL injection
10. **JWT auth** on all protected routes
11. **audit_log** entry on ALL changes (who/what/when/before/after)
12. **Specific error messages** — NEVER "Save failed"
13. **MySQL connection pooling ONLY** — never createConnection
14. **Pagination** on ALL list endpoints (default 50/page)
15. **Dark/light mode** — all new screens must support `dark` prop

---

## 8. ALWAYS DO AT START OF EVERY SESSION

1. Read `~/Desktop/qmat/CLAUDE_CONTEXT.md` — full spec
2. Run `git log --oneline -5` — confirm where we are
3. Check the wireframe for any screen being built
4. Verify app is running at localhost:5173 (or 5174)
5. Take a screenshot in Chrome to confirm current state

## ALWAYS DO AT END OF EVERY SESSION

1. Update `~/Desktop/qmat/docs/USER_MANUAL.md`
2. `git add -A && git commit -m "descriptive message" && git push`
3. Update this HANDOVER_NEXT_SESSION.md with current state

---

## 9. DATABASE STATE (current)

Tables: 51+ (added warehouse_stock, fmr_requests, warehouse_transfers this session)
Schema dump: ~/Desktop/qmat/qmat_schema.sql

### Key tables added this session:
- `warehouse_stock` — received goods inventory per warehouse location
- `fmr_requests` — Field Material Requests (raise/approve/issue flow)
- `warehouse_transfers` — inter-warehouse transfer lifecycle

### Key column notes:
- `shipment_control_notes.status` enum extended with: customs_review, pending_pickup, in_transit, pending_delivery, delivered
- `shipment_control_notes.mode` enum extended with: courier
- `itp_requirements` — extended with 12 new columns (timing, witness_required, certificate_required, planned_date, forecast_date, status, completion_date, completion_notes, po_line_id, item_number, is_deleted, notes)
- `user_wbs_access.wbs_code` — stores WBS code string (not node ID); scope_type enum: full/fmr_only/view_only
- `users.role` — varchar(50), already contains subcontractor + freight_forwarder as valid values

### Seed data:
- 31 SCNs for project 1 (Pilbara Gas Processing Plant)
- 62 scn_packages rows
- 3 ITP items for PO id=1
- 10 warehouse_stock rows across 3 warehouses
- 6 fmr_requests rows
- 5 warehouse_transfers rows
- Test users: dkowalski@civcon.com.au (subcontractor), schen@tollgroup.com (freight_forwarder)

### Partial SCN assignments (data state):
- PO-2024-017 Line 1: qty=2, assigned=1, available=1
- PO-2024-025 Line 1: qty=24, assigned=12, available=12
- PO-2024-026 Line 1: qty=4, assigned=2, available=2

---

## 10. ARCHITECTURE DECISIONS (do not change)

- ITP entity uses `itp_requirements` table (has `po_id`). `itp_items` is for individual inspection events.
- `inspection_type` enum in itp_requirements: `hold_point`, `witness`, `review`, `document` — map to UI labels in frontend
- `date_change_log`: uses `created_by`/`created_at` (not `changed_by`/`changed_at`)
- `scn_additional_items` = off-PO items. Qty does NOT count against PO quantities.
- DB status values for SCNs map to display statuses: `pending`/`draft` → pending_pickup, `in-transit` → in_transit, `arrived` → pending_delivery, `received`/`closed` → delivered
- JWT secret: qmat_jwt_secret_2024
- MySQL connection pooling ONLY — never createConnection
- **GOTCHA — font-zoom vs viewport units:** the font-size control (Small/Med/Large) applies an ancestor `zoom` (0.85 / 1.0 / 1.15). Any `vw`/`vh`-based sizing mis-scales under it — use **px insets, not viewport units**, for modals/overlays. (Caused the stock-take maximized-modal clip; fixed in `dad8b99` by pinning the modal with px insets.)
- **Role-based access (added this session):**
  - Same URL for all roles — role-based rendering, NOT separate routes
  - `subcontractor` = scoped stock (own WBS only, location_code stripped) + scoped FMR (own FMRs only). Cannot access Receipting or Transfers (403).
  - `freight_forwarder` = own SCNs in Logistics only (WHERE forwarder_user_id = current user). Cannot access MC (403).
  - Backend enforces 403 on all forbidden endpoints — frontend hides UI elements as secondary guard
  - `useCurrentUser` hook at `src/hooks/useCurrentUser.ts` returns role flags
- **ScopeBanner component** (`src/components/ScopeBanner.tsx`) = blue info banner shown to subcontractor (shows WBS scopes) and freight_forwarder (shows SCN count). Sits below page header, above KPI cards.

---

## 11. NAVIGATION (LEFT SIDEBAR — ROLE-AWARE)

| Role | Visible nav items |
|---|---|
| Admin / QCO team | Full nav (unchanged) |
| Subcontractor | Material Control only → Stock Register + FMR Register (Receipting + Transfers hidden) |
| Freight Forwarder | Logistics only |

Working nav items for QCO team (when project is selected):
- 🏠 Dashboard
- 🏗 Foundational (collapsible): WBS · Commodity Library · Equipment List ✅
- 📋 MTO Register ✅
- 🧾 Procurement ✅
- 📑 VDRL (renders inside Expediting tab)
- 🚨 Expediting ✅
- 🚚 Logistics ✅
- 📦 Material Control ✅ → Receipting · Stock Register · FMR Register · Transfers
- 🔗 Traceability ⏳
- 📥 Document Inbox ⏳
- 🔍 Audit ⏳
- ⚙️ Admin ✅

---

## 12. KEY FILES

- `~/Desktop/qmat/CLAUDE_CONTEXT.md` — master spec, read at start of every session
- `~/Desktop/qmat/docs/USER_MANUAL.md` — user manual, update every session
- `~/Desktop/qmat/qmat_schema.sql` — DB schema dump
- `~/Desktop/qmat/public/QMAT-prototype.html` — the wireframe bible
- `~/Desktop/qmat/server/routes/logistics.js` — logistics backend (role-scoped)
- `~/Desktop/qmat/server/routes/materialcontrol.js` — MC backend (role-scoped)
- `~/Desktop/qmat/src/pages/LogisticsScreen.tsx` — logistics frontend
- `~/Desktop/qmat/src/pages/MCReceiptingScreen.tsx` — receipting wizard
- `~/Desktop/qmat/src/pages/MCStockRegisterScreen.tsx` — stock register
- `~/Desktop/qmat/src/pages/MCFMRScreen.tsx` — FMR register
- `~/Desktop/qmat/src/pages/MCTransferScreen.tsx` — transfers
- `~/Desktop/qmat/src/hooks/useCurrentUser.ts` — role flags hook
- `~/Desktop/qmat/src/components/ScopeBanner.tsx` — scoped user banner
- `~/Desktop/qmat/src/components/MilestoneLegend.tsx` — reusable status legend
- `~/Desktop/qmat/src/pages/ExpPODetailScreen.tsx` — ITP CRUD, milestone tabs
- `~/Desktop/qmat/src/pages/ExpeditingScreen.tsx` — VDRL register, SCN wizard
- `~/Desktop/qmat/src/components/HelpDrawer.tsx` — reusable help drawer
- `~/Desktop/qmat/src/helpContent.tsx` — help content per screen

---

## 13. CROSS-MODULE DATA FLOW

1. **Foundational** → WBS tree, Commodity Library, Equipment List
2. **MTO Register** → engineering take-off lines. Feeds procurement.
3. **Procurement** → POs against MTO lines/WBS. Approve & Lock → Expediting.
4. **VDRL** → Vendor document requirements per PO.
5. **Expediting** → Milestone monitoring, ITP, heat numbers, SCN creation.
6. **Logistics** → SCNs when goods ship. Pickup → transit → customs → delivery.
7. **Material Control** → Receipts SCNs. Stock register. FMRs. Transfers.
8. **Traceability** → Cert verification. Heat number chain. Holds.
9. **Document Inbox** → Universal intake → routes to correct module.
10. **Audit** → Every state change across all modules.
11. **Dashboard** → Health score + drill-down. BUILD LAST.
