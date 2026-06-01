# QCO MMS — HANDOVER: NEXT SESSION
# Updated: 01 June 2026
# Last commit: 914126a
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

## 3. MODULE STATUS (current as of 01 June 2026)

| Module | Status | Notes |
|--------|--------|-------|
| Login | ✅ Complete | |
| Dashboard | ⏳ BUILD LAST | Reads from all modules |
| Admin | ✅ Complete | Users, suppliers/AVL, settings; Subcontractor + Freight Forwarder roles in dropdown |
| Foundational — WBS | ✅ Complete | Tree, Gantt, tooltip, bulk ops, search, focus mode |
| Foundational — Commodity Library | ✅ Complete | Table, add/edit, certs, template download |
| Foundational — Equipment List | ✅ Complete | Table, add/edit, certs, template download |
| Procurement — PO Register | ✅ Complete | Register, stat cards, search, RAG |
| Procurement — New PO Wizard | ✅ Complete | 3-step, commodity/tag autocomplete |
| Procurement — PO Detail | ✅ Complete | 7 tabs, approve & lock, variations |
| MTO Register | ✅ Complete | List, new MTO, detail, rev diff, upload |
| Expediting | ✅ Complete | Register, drawer, PO detail (6 tabs), SCN wizard, VDRL |
| ITP | ✅ Complete | Full CRUD on ExpPODetailScreen ITP tab |
| Logistics | ✅ Complete | SCN register, pipeline bar, detail modal (overview/packages/docs/timeline), status transitions, date edits with mandatory reason, packages CRUD, document upload, ★ critical path toggle |
| Material Control — Receipting | ✅ Complete | 5-step wizard with Back buttons, inline discrepancy flow, dual TCCC signature |
| Material Control — Stock Register | ✅ Complete | Grouped by warehouse, condition pills, move/docs, stock take modal |
| Material Control — FMR Register | ✅ Complete | MC + Contractor views, approval modal with system checks, Raise FMR |
| Material Control — Transfers | ✅ Complete | Pipeline cards, detail modal with lifecycle stepper, 2-step new transfer wizard |
| Role-Based Access | ✅ Complete | Subcontractor + Freight Forwarder scoped nav + API + UI (003a716, 39700e6) |
| Traceability | ⏳ Not started | |
| Document Inbox | ⏳ Not started | |
| Audit | ⏳ Not started | |
| Reports | ⏳ Not started | |

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
7. **Resizable columns** — orange `#E84E0F` drag handles (3px on hover)
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
