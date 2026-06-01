# QCO MMS — HANDOVER: NEXT SESSION
# Updated: 01 June 2026
# Last commit: fad82e3
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

---

## 3. MODULE STATUS (current as of 01 June 2026)

| Module | Status | Notes |
|--------|--------|-------|
| Login | ✅ Complete | |
| Dashboard | ⏳ BUILD LAST | Reads from all modules |
| Admin | ✅ Complete | Users, suppliers/AVL, settings |
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
| Material Control | ⏳ Not started | Next priority |
| Traceability | ⏳ Not started | |
| Document Inbox | ⏳ Not started | |
| Audit | ⏳ Not started | |
| Reports | ⏳ Not started | |

---

## 4. WHAT WAS DONE THIS SESSION (01 June 2026)

- **Excel dropdown templates:** Verified all 5 templates already had correct dataValidation XML
  (commodity ×3, equipment ×2, mto ×4, vdrl ×2, procurement ×4). WBS confirmed needs no
  dropdowns. No changes required. Confirmed via JSZip XML inspection.

- **HelpDrawer contrast:** 4 targeted colour fixes applied (body text `#e2e8f0`, subtitle
  `#e2e8f0`, chevron `#cbd5e1`, footer close button `#cbd5e1`). Dark-mode conditional only.
  Light mode colours unchanged. Verified readable in Chrome dark mode.

- **Logistics module:** Fully built and verified in Chrome.
  - **Backend:** 7 endpoints (register, detail, status transitions, date updates with mandatory
    reason, document upload/delete, packages CRUD ×4, critical-path toggle). 3 new DB tables:
    `scn_packages`, `scn_documents`, `scn_status_log`. Extended `shipment_control_notes.status`
    enum with `customs_review`, `pending_pickup`, `in_transit`, `pending_delivery`, `delivered`.
    62 package rows seeded across 31 SCNs.
  - **Frontend:** `LogisticsScreen` (pipeline bar with 5 clickable cards, 13-column table, RAG
    stripes via `boxShadow inset 4px`, search, mode filter, ★ critical toggle, ETD arrival
    filter, CSV export). `SCNDetailModal` (4 tabs: overview/packages/docs/timeline).
    `StatusUpdateModal` (valid-next-status-only dropdown per transition rules).
  - **Verified in Chrome:** Pipeline filter, table rows, row click → modal, packages table,
    ETD/ETA edit → "Reason is required" validation, status API confirmed ✅.

---

## 5. OPEN BUGS / KNOWN ISSUES

- SCNDetailModal: status update via "Update Status" button doesn't close modal when API returns
  error (stale `selectedScn` state after direct API test). Works correctly in normal flow.
  Root cause: React state not refreshed before modal uses `scn.display_status` for transition
  validation. Fix: call `refreshDetail()` before opening StatusUpdateModal.

---

## 6. NEXT SESSION PRIORITIES (in order)

1. **Material Control module** — READ `CLAUDE_CONTEXT.md` Section "Module 8: Material Control"
   AND the wireframe (`QMAT-prototype.html`) before writing any instruction. Build in this order:
     a. **Receipting** (`MCReceiptingScreen`) — inbound SCNs awaiting goods-in, 5-step wizard
     b. **Stock Register** — warehouse inventory view
     c. **FMR Register** — Field Material Requests
     d. **Transfers** — inter-warehouse movements

2. **After Material Control:** Meeting Register

3. **After Meeting Register:** Traceability

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

Tables: 48+ (added scn_packages, scn_documents, scn_status_log this session)
Schema dump: ~/Desktop/qmat/qmat_schema.sql

### Key new tables (this session):
- `scn_packages` — package dims/weights/DG per SCN
- `scn_documents` — uploaded docs per SCN
- `scn_status_log` — status transition audit trail per SCN

### Key column notes:
- `shipment_control_notes.status` enum extended with: customs_review, pending_pickup, in_transit, pending_delivery, delivered
- `shipment_control_notes.mode` enum extended with: courier
- `itp_requirements` — extended with 12 new columns (timing, witness_required, certificate_required, planned_date, forecast_date, status, completion_date, completion_notes, po_line_id, item_number, is_deleted, notes)

### Seed data:
- 31 SCNs for project 1 (Pilbara Gas Processing Plant)
- 62 scn_packages rows seeded
- 3 ITP items seeded for PO id=1

---

## 10. ARCHITECTURE DECISIONS (do not change)

- ITP entity uses `itp_requirements` table (has `po_id`). `itp_items` is for individual inspection events.
- `inspection_type` enum in itp_requirements: `hold_point`, `witness`, `review`, `document` — map to UI labels in frontend
- `date_change_log`: uses `created_by`/`created_at` (not `changed_by`/`changed_at`)
- `scn_additional_items` = off-PO items. Qty does NOT count against PO quantities.
- DB status values for SCNs map to display statuses: `pending`/`draft` → pending_pickup, `in-transit` → in_transit, `arrived` → pending_delivery, `received`/`closed` → delivered
- JWT secret: qmat_jwt_secret_2024
- MySQL connection pooling ONLY — never createConnection

---

## 11. NAVIGATION (LEFT SIDEBAR — CURRENT STATE)

Working nav items (when project is selected):
- 🏠 Dashboard
- 🏗 Foundational (collapsible): WBS · Commodity Library · Equipment List ✅
- 📋 MTO Register ✅
- 🧾 Procurement ✅
- 📑 VDRL (renders inside Expediting tab)
- 🚨 Expediting ✅
- 🚚 Logistics ✅
- 📦 Material Control ⏳
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
- `~/Desktop/qmat/server/routes/logistics.js` — new logistics backend
- `~/Desktop/qmat/src/pages/LogisticsScreen.tsx` — new logistics frontend
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
