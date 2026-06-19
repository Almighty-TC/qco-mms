# QCO MMS — HANDOVER: NEXT SESSION
# Updated: 02 June 2026
# Last commit: 9b605c0
# ⭐ THIS FILE IS THE SINGLE CANONICAL MODULE-STATUS DOC. HANDOVER.md and
#    CLAUDE_CONTEXT.md point here for status (their own status tables are retired).
# Read every word before doing anything.

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
| Dashboard | ⏳ BUILD LAST | Reads from all modules |
| Admin | ✅ Complete | Users, suppliers/AVL, settings; Subcontractor + Freight Forwarder roles in dropdown |
| Foundational — WBS | ⚠️ Mostly complete | Tree, Gantt, tooltip, bulk ops, search, focus mode. **Delete-node flow FIXED (A3: `5ea7abd`+`81392fe`).** Remaining bug (see §3c): Tree depth filter leaks (A1, UI, MEDIUM). |
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

**Remaining unbuilt modules:** Meeting/RFI Register · Audit · Reports · Dashboard (build last — reads from all modules).

---

## 3a. KNOWN GAPS (as of 02 June 2026)

- **Logistics — Proof of Custody screen not built** (spec'd in CLAUDE_CONTEXT; `CreateSCNWizard` exists but is launched from Expediting, not the Logistics register).
- **Transfers — not stock-linked**: the 2-step new-transfer wizard uses free-text item/description + from/to locations, so it does **not** pick from or decrement real `warehouse_stock` rows.
- **Document Management** (read-only aggregator): download is a **mock toast** (the module owns no files — real downloads live on each source module's screen); **Material Control contributes 0 documents** (no FMR-docket / receipt-POD table exists); **upload routing is partial** — wired for Logistics + Procurement, other modules direct the user to their own uploader, Material Control marked "not yet supported".

---

## 3b. BACKLOG / NOT STARTED

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

1. **Traceability module** — READ `CLAUDE_CONTEXT.md` Section "Module 9: Traceability"
   AND the wireframe (`QMAT-prototype.html`) before writing any instruction.

2. **Document Inbox** — after Traceability

3. **Audit** — immutable log viewer across all modules

4. **Reports** — analytics and summary reports

5. **Dashboard** — BUILD LAST (reads from all modules, AI health score)

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
