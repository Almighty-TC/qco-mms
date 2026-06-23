# QCO MMS — COMPLETE HANDOVER DOCUMENT
# Date: 31 May 2026
# This document is the complete briefing for the next chat session.
# Read every word before doing anything.

> ⚠ HISTORICAL — this file is a 31 May 2026 snapshot. For current module status, see HANDOVER_NEXT_SESSION.md (canonical). Sections below may show built modules as pending.

---

## 1. PROJECT IDENTITY

- **System:** QCO MMS (Material Management System) — SaaS supply chain platform for capital infrastructure projects, energy & resources sector
- **Company:** QCO Group (qcogroup.com.au)
- **Owner:** Thomas Chang (tchang@qcogroup.com.au) — Super Admin
- **GitHub:** https://github.com/Almighty-TC/qco-mms.git
- **Project location:** ~/Desktop/qmat

---

## 2. TECH STACK

- **Frontend:** React + TypeScript + Vite → localhost:5174
- **Backend:** Node.js + Express → localhost:3001
- **Database:** MySQL 8.0.44 on Azure
  - Host: qcosystem.mysql.database.azure.com
  - DB: qmat
  - User: QCO_admin
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

## 3. TOOLS & WORKFLOW

- **Claude Code desktop app** — runs all code, file edits, server restarts, git operations
- **Claude Code settings:** "Allow bypass permissions mode" is ON — no permission prompts
- **claude.ai (this chat)** — visual verification in Chrome via Claude in Chrome extension
- **Claude in Chrome** — connected to Browser 1 (macOS local), used for independent visual QA
- **Rule:** claude.ai verifies EVERY change in Chrome independently. Never trust Claude Code self-reports alone.
- **GitHub** is the safety net — every session should commit. Roll back with `git reset --hard [hash]` if needed.

---

## 4. THE WIREFRAME — THE BIBLE

**Location:** ~/Desktop/qmat/public/QMAT-prototype.html
**Claude Design URL:** https://claude.ai/design/p/019dd3c2-e535-7728-ada2-d48680d4dd49?file=QMAT-prototype.html

**THE WIREFRAME IS THE BIBLE FOR ALL UI/UX.**
- Before building ANY screen, read the wireframe for that screen
- If the wireframe shows something different from the spec, follow the wireframe AND flag the discrepancy to Thomas before building
- If a feature is needed that is NOT in the wireframe (e.g. the tabbed PO Detail Screen), flag it to Thomas, explain why it's needed, and wait for confirmation before building
- Never deviate from wireframe UI/UX without explicit approval
- Claude Design was used to create the wireframe — it has full detail of every click, every screen, every interaction

### How to access wireframe:
Present mode URL: https://claude.ai/design/p/019dd3c2-e535-7728-ada2-d48680d4dd49?file=QMAT-prototype.html&present=1

---

## 5. BRANDING

- Orange accent: #E84E0F
- Dark background: #0a0a0a
- White text
- Logo: public/qco_logo_primary_RGB_transparent.png
- Page background: #f4f7fb / #f8fafd
- Cards: #ffffff
- Text primary: #0f172a, secondary: #475569, muted: #94a3b8
- Accent blue: #2563eb

### RAG Status Colours (NON-NEGOTIABLE):
- Green #22c55e = On track
- Amber #f59e0b = At risk
- Red #ef4444 = Breached
- Grey #64748b = Not started
- Blue #2563eb = In progress

### Typography:
- IBM Plex Sans for UI
- JetBrains Mono for all data, codes, refs, dates, quantities

---

## 6. MODULE STATUS

> ⚠️ **Status is tracked in HANDOVER_NEXT_SESSION.md — see that file for current module status.**
> (This table was stale as of 31 May 2026 and has been retired. The rest of this document is
> historical context from the 31 May session.)

---

## 7. WHAT WAS BUILT THIS SESSION (31 May 2026)

### Procurement — all complete and verified:
- PO Register with clickable summary cards (Breached/At Risk SQL fixed)
- New PO Wizard with commodity/tag autocomplete on line items
- PO Detail Screen (Phase 3) — full dedicated screen with 7 tabs:
  - Line Items, Key Dates, ITP, Documents, Action Notes, Variations, Audit Trail
- Approve & Lock wizard with 3-checkbox workflow and success screen
- PO template redesigned with header + line items sections
- ROS hint text fixed to "Optional — can be entered later in Expediting"

### Foundational — built and partially complete:
- WBS screen with tree table, expand/collapse, RAG dots, ROS dates, notes
- Expand All / Collapse All buttons
- Focus mode (hides nav, full screen tree)
- Node hover tooltip (shows linked commodities + equipment)
- Upload XER/Excel with pre-validation checks
- Download Template button (partially working — see pending items)
- DeleteWBSWizard (3-step: Impact → Reallocate → Confirm)
- AddWBSNodeModal with live code preview
- Commodity Library — table, tabs, add/edit modal, certs modal
- Equipment List — table, tabs, add/edit modal, certs modal
- Deep WBS seed data (8 levels deep for Pilbara)
- All module dummy data updated to reference valid WBS nodes

### Global improvements:
- ← Back button + breadcrumb trail on ALL screens
- ? Help button on every screen → HelpDrawer component (collapsible sections)
- HelpDrawer content for: WBS, Commodity Library, Equipment List, PO Register, PO Detail, New PO Wizard
- "View full manual" link in every HelpDrawer → opens USER_MANUAL.md
- Left sidebar collapsible (was working, may need re-verification)
- USER_MANUAL.md created at ~/Desktop/qmat/docs/USER_MANUAL.md
- Professional Word document manual: QCO_MMS_User_Manual.docx (in outputs)

---

## 8. GLOBAL STANDARDS — NON-NEGOTIABLE (applies to EVERY file)

1. **← Back button + breadcrumb on EVERY screen** — every screen must have ← Back (browser history) + breadcrumb trail (e.g. Dashboard › Pilbara › Procurement › PO-2024-001). No exceptions.

2. **? Help button on EVERY screen** — opens HelpDrawer for that screen. Standardise to "? Help" label. Placeholder content "Help coming soon" acceptable for unbuilt modules.

3. **User Manual update EVERY session** — ~/Desktop/qmat/docs/USER_MANUAL.md must be updated whenever anything visible to users changes. Never commit without updating the manual.

4. **Wireframe is the bible** — check wireframe before building any screen. Deviations require Thomas's approval.

5. **Sticky table headers** — overflow-x: auto + overflow-y: auto + maxHeight on wrapper; thead position:sticky top:0; NOT on thead tr

6. **Resizable columns** — orange #E84E0F drag handles (3px visible on hover, 2px solid full height when dragging)

7. **Collapsible left sidebar** — toggle button (‹/›), collapsed = 56px icon-only rail, expanded = 240px with labels. State persists in localStorage. Smooth CSS transition ~200ms.

8. **RAG colours** — always use the exact hex values listed in Section 5. Never use other colours for status.

9. **Parameterised queries ONLY** — no SQL injection ever

10. **JWT auth** on all protected routes

11. **Full audit_log** on ALL changes (who/what/when/before/after)

12. **DeleteConfirmModal** (reason dropdown + checkbox) for all deletes

13. **Specific error messages** — NEVER "Save failed"

14. **Duplicate check** before creating records

15. **MySQL connection pooling ONLY** — never createConnection

16. **Pagination** on ALL list endpoints (default 50/page)

17. **Priority order:** Stability → Security → Scalability → Auditability

---

## 9. ALWAYS DO AT START OF EVERY SESSION

1. Run `cat ~/Desktop/qmat/CLAUDE_CONTEXT.md` — read the full spec
2. Run `git log --oneline -5` — confirm where we are
3. Check the wireframe for any screen being built
4. Verify app is running at localhost:5174
5. Take a screenshot in Chrome to confirm current state

## ALWAYS DO AT END OF EVERY SESSION

1. Update ~/Desktop/qmat/docs/USER_MANUAL.md
2. `git add . && git commit -m "descriptive message" && git push`
3. Report back: what was built, what was tested, what is next

---

## 10. PENDING ITEMS — DO THESE NEXT IN ORDER

The following instruction should be pasted to Claude Code at the start of the next session. It is one combined instruction covering everything outstanding:

```
Read ~/Desktop/qmat/CLAUDE_CONTEXT.md first. Run git log --oneline -3.

STEP 0 — BACKUP FIRST
cd ~/Desktop/qmat && git add . && git commit -m "backup: pre-major-enhancements checkpoint $(date +%Y%m%d_%H%M%S)" && git push
mysqldump -h qcosystem.mysql.database.azure.com -u QCO_admin -p qmat > ~/Desktop/qmat_backup_pre_enhancements_$(date +%Y%m%d_%H%M%S).sql
Report backup commit hash and DB backup filename before proceeding.

RESEARCH CONTEXT — Top 5 EPC material management systems studied:
Hexagon Smart Materials (SPMat), Oracle Primavera Unifier, AVEVA Engineering, InEight, SAP S/4HANA.
Key things industry leaders do that QCO MMS must incorporate:
1. WBS is the backbone of everything — every item in every module shows its WBS position and rolls up to parent nodes
2. BOM (Bill of Materials) within WBS — each node shows materials required vs committed vs received
3. MTO delta processing — new MTO revision shows exactly what changed vs previous
4. Materials Status per WBS node — MTO Qty / PO Qty / Received Qty / % Complete progress bar
5. WBS nodes show 3 dates: Planned (baseline, never changes) / Forecast (current estimate) / Actual (achieved)
6. Bulk operations on WBS nodes (checkbox select, bulk RAG change, bulk export)
7. WBS search and filter bar for large trees (100+ nodes)
8. Supplier portal extended to expediting milestone confirmations and logistics packing lists
9. Material Receiving Reports (MRR) — formal auditable receipt document

FIX 1 — WBS seed data: ALL branches must be 7-8 levels deep
Every top-level node needs 7-8 levels. Minimum:
- 01 Civil & Structural: 8 levels
- 02 Mechanical: 8 levels
- 03 Electrical & Instrumentation: 7 levels
- 04 Piping: 7 levels
- 05 Commissioning: 6 levels

Seed multiple commodities AND equipment against SAME WBS nodes (at least 5 nodes with 3+ of each):
- 02.01.01 Pressure Vessels: V-101, V-102, V-201, V-202 + carbon steel plate, welding consumables, gaskets, bolts
- 02.02.01 Pumps: P-101A, P-101B, P-201 + pump seals, bearing grease, coupling bolts
- 03.01.01 HV Switchgear: 2 equipment + 2 commodities

Update ALL module dummy data to reference valid WBS nodes:
- purchase_orders.wbs_code, po_lines.wbs_code_snapshot, commodity_library.wbs_id, equipment_list.wbs_id, expediting_register

Run SQL to verify no orphaned WBS references. Show results before proceeding.

FIX 2 — WBS node hover tooltip: positioning + multi-item display
A) Positioning:
- Default: RIGHT of cursor with 12px offset
- Flip LEFT if would overflow right edge
- Flip UP if would overflow bottom
- Test near all screen edges — must never be cut off

B) Multi-item display:
- Section headers with count: "Commodities (4)" / "Equipment (3)"
- Each commodity: code (mono blue) · name · UOM badge
- Each equipment: tag (mono blue) · description · status pill
- Scrollable sections when >5 items, max height 400px
- Width 380px fixed
- BOTH: show both with divider
- Only commodities: "No equipment linked" in grey
- Only equipment: "No commodities linked" in grey
- Neither: "No materials linked to this node" in grey italic
- Proper shadow + border — professional popover appearance

FIX 3 — Template downloads: WBS, Commodity Library, Equipment List
All 3 must work. This is a production SaaS.

A) WBS ↓ Template — GET /api/foundational/:projectId/wbs/template
- XLSX: id, project_id, level, code, description, wbs_string, parent_string, parent_id, WBS Title, wbs.1-wbs.8, ROS
- Orange header (#E84E0F), frozen top row, 3 example rows, Instructions tab
- Proper blob download on frontend (not window.open)

B) Commodity Library ↓ Template — add button, GET /api/foundational/:projectId/commodities/template
- XLSX: Commodity Code, WBS Code, Name/Description, UOM, Estimated Qty, Trace Level, Preservation, Preferred Vendor, Notes
- Dropdown validation: UOM (EA/M/M²/M³/KG/T/LT/SET/LOT), Trace Level, Preservation
- Orange header, frozen top row, 3 example rows, Instructions tab

C) Equipment List ↓ Template — add button, GET /api/foundational/:projectId/equipment/template
- XLSX: Equipment Tag, Equipment Type, WBS Code, Description, Area/Location, Criticality, PO Reference, Vendor, Weight (kg), Size (LxWxH), Notes
- Dropdown validation: Equipment Type, Criticality
- Orange header, frozen top row, 3 example rows, Instructions tab

Test all 3 downloads — confirm files open correctly in Excel/Numbers.

FIX 4 — Collapsible left sidebar (global, if not already working)
- Toggle button (‹/›) at top of sidebar
- Collapsed: 56px wide, icons only, hover shows module name tooltip
- Expanded: 240px, icons + text labels
- State persists in localStorage
- Smooth CSS transition ~200ms on content area resize
- Works on every screen — global component
- Test on Dashboard, WBS, PO Register, PO Detail

FIX 5 — WBS Focus mode: full node info panel
When Focus mode is active and user CLICKS a WBS node row, a right-side panel (420px) slides in.

Panel sections:
HEADER: WBS code (mono large) + node name (H2) + RAG pill + ✕ Close

SECTION 1 — Key Dates:
- Planned Start date
- Planned End / Construction completion date
- ROS date (RAG coloured)

SECTION 2 — Details:
- Owner/Responsible
- RAG status label
- Notes (full text)
- Code suffix

SECTION 3 — Commodities (count in header):
- code (mono blue) · name · UOM badge
- Scrollable, "No commodities linked" if empty

SECTION 4 — Equipment (count in header):
- tag (mono blue) · description · status pill
- Scrollable, "No equipment linked" if empty

SECTION 5 — Purchase Orders referencing this WBS:
- PO ref (mono blue) · vendor · status pill · total value
- "No POs linked" if empty

FOOTER:
- "Edit node" → AddWBSNodeModal prefilled
- "View commodities →" → Commodity Library filtered to this WBS (exits Focus mode)
- "View equipment →" → Equipment List filtered to this WBS (exits Focus mode)

Behaviour:
- Tree resizes to share space — does NOT obscure tree
- Clicking different node updates panel
- ✕ closes panel, tree returns to full width
- Smooth CSS transition ~200ms
- Only in Focus mode — normal mode clicking still expands/collapses

IMPROVEMENT 1 — WBS Materials Status columns (from industry research)
Add to WBS tree table:
- MTO Qty — total required from MTO register (show "—" if no MTO data)
- PO Qty — total committed on POs referencing this WBS
- Received Qty — total received in warehouse referencing this WBS
- % Complete = Received / MTO Qty — small progress bar
- Roll up to parent nodes
- Only show in normal mode (Focus mode uses side panel)

IMPROVEMENT 2 — WBS 3-date model (Planned / Forecast / Actual)
Industry standard — every node has 3 dates not 1:
- Planned date (baseline, set at project start, NEVER changes)
- Forecast date (current best estimate, changes as project progresses)
- Actual date (when milestone was achieved)
- Small indicator per date: ✓ actual set / → forecast / — not started
- Update AddWBSNodeModal with Planned, Forecast, Actual date fields
- Add columns to wbs_nodes if not present: forecast_start, forecast_end, actual_start, actual_end

IMPROVEMENT 3 — WBS bulk operations
- Checkbox column on WBS table (appears on hover)
- When 1+ selected: bulk action bar appears at bottom:
  - Change RAG status (dropdown)
  - Change owner (dropdown)
  - Export selected (XLSX)
  - Delete selected (DeleteWBSWizard batch)
- Select all checkbox in header

IMPROVEMENT 4 — WBS search and filter bar
- Search bar: search by code or node name, matching nodes highlight, non-matching fade
- Filter buttons: RAG status (All/Green/Amber/Red/Grey), Owner (dropdown), Depth level (Level 1/Level 2/All)
- "Clear filters" button
- Search + filter work together

BEFORE reporting back you must:
1. Confirm backup commit hash and DB backup filename
2. Run SQL — verify all module dummy data references valid WBS nodes, show results
3. Verify 5+ WBS nodes have both 3+ commodities AND 3+ equipment
4. Test tooltip: multi-item display with counts, scroll, positioning near all screen edges
5. Test all 3 template downloads — files open correctly
6. Test sidebar collapse/expand on Dashboard, WBS, PO Register, PO Detail
7. Verify sidebar state persists after page refresh
8. Enter Focus mode → click a node → confirm panel with all 5 sections
9. Test "View commodities" and "View equipment" links
10. Test bulk checkbox selection and bulk action bar
11. Test WBS search + filter
12. Verify Materials Status columns on WBS tree
13. Verify AddWBSNodeModal has Planned/Forecast/Actual date fields
14. Update USER_MANUAL.md with all new features
15. Only report back when everything verified working with no errors

git add . && git commit -m "foundational: deep seed, tooltip fixes, template downloads, sidebar, focus panel, materials status, bulk ops, search/filter, 3-date model" && git push
```

---

## 11. NEXT BUILD ORDER (after pending items above)

1. ✅ Complete all pending Foundational items above
2. **MTO Register** — list screen, new MTO wizard, detail screen with diff tab
3. **Expediting** — register, PO detail panel, child line items, milestones, ITP, heat numbers
4. **VDRL** — register, supplier portal, review cycles, transmittals
5. **Logistics** — SCN register, create SCN wizard, proof of custody
6. **Material Control** — receipting wizard, stock register, FMR, transfers
7. **Traceability** — cert chain, heat number tracking
8. **Document Inbox** — universal file intake and classification
9. **Audit** — immutable log viewer
10. **Dashboard** — BUILD LAST (reads from all modules)

---

## 12. CROSS-MODULE DATA FLOW (THE PIPELINE)

1. **Foundational** → WBS tree, Commodity Library, Equipment List, AVL. Everything references WBS.
2. **MTO Register** → Engineering take-off lines (qty, UOM, WBS, ROS, inspection class, VDRL flag). Revisions diff against each other. Feeds procurement.
3. **Procurement** → POs against MTO lines/WBS. Approve & Lock freezes PO → passes to Expediting.
4. **VDRL** → Vendor document requirements per PO. Review cycles, transmittals, MDR.
5. **Expediting** → Milestone monitoring on locked POs. Child line items. ITP. Heat numbers.
6. **Logistics** → SCNs when goods ship. Pickup → transit → customs → delivery.
7. **Material Control** → Receipts SCNs. Stock register. FMRs. Transfers. Analytics layer.
8. **Traceability** → Cert verification. Heat number chain. Holds.
9. **Document Inbox** → Universal intake → routes to correct module.
10. **Audit** → Every state change across all modules.
11. **Dashboard** → Health score + drill-down. BUILD LAST.

---

## 13. DATABASE STATE (as of 31 May 2026)

45+ tables. Schema dump at: ~/Desktop/qmat/qmat_schema.sql
Last backup: ~/Desktop/qmat_backup_*.sql

### Key tables:
- purchase_orders, po_lines, po_milestones, po_action_notes, po_approvals, po_documents, po_variations, po_hold_reasons
- vendor_contacts, milestone_templates, milestone_template_steps
- ros_change_log, itp_requirements, itp_items
- scn_additional_items, date_change_log
- projects, users, suppliers, warehouses, wbs_nodes, commodity_library, equipment_list
- expediting_register, shipment_control_notes, user_wbs_access

### Key column notes:
- milestone_template_steps: column names are `label` (not name), `is_system_default` (not is_default), `is_required` (not is_mandatory)
- wbs_nodes: owner_id, planned_start, planned_end, rag (forecast/actual dates to be added)
- purchase_orders: expeditor_id, pre_expediting_enabled, is_critical_path
- po_lines: cdd, ros_date, heat_number_required, supplier_name_snapshot, wbs_code_snapshot
- projects: traceability_required, at_risk_days_threshold, approval_threshold_1, approval_threshold_2

### Seed data:
- 4 projects: Pilbara Gas Processing Plant, Hunter Valley Substation 132kV, Ord River Dam Upgrade, Port Hedland LNG Terminal
- WBS: 8 levels deep (Pilbara), 7 levels (Port Hedland), 6 (Ord River), 5 (Hunter Valley)
- 47 commodities + 47 equipment items across 4 projects (all referencing valid WBS nodes)
- 4 milestone templates seeded

---

## 14. NAVIGATION (LEFT SIDEBAR — CURRENT STATE)

Working nav items (when project is selected):
- 🏠 Dashboard
- 🏗 Foundational (collapsible): WBS · Commodity Library · Equipment List ✅
- 📋 MTO Register
- 🧾 Procurement ✅
- 📑 VDRL
- 🚨 Expediting (red count badge — shows 8)
- 🚚 Logistics
- 📦 Material Control
- 🔗 Traceability
- 📥 Document Inbox
- 🔍 Audit
- ⚙️ Admin ✅
- User chip at bottom

Note: Sidebar collapsible toggle was working but needs re-verification.

---

## 15. WIREFRAME SCREENS & WHAT THEY SHOW

The wireframe (QMAT-prototype.html) covers:
- Dashboard: project list → project health → WBS tree → PO drill-down
- Foundational: WBS tree, Commodity Library, Equipment List (all with full interactions)
- MTO Register: list, revision history, diff comparison
- Procurement: PO Register, New PO Wizard, PO Detail (basic scroll view — tabbed version is an agreed enhancement)
- VDRL: QCO view + supplier portal
- Expediting: register, PO detail drawer, child line items, milestones
- Logistics: SCN pipeline, create SCN wizard
- Material Control: receipting wizard, stock register, FMR, transfers
- Traceability: cert chain visual
- Admin: users, suppliers/AVL, settings

**IMPORTANT:** The wireframe's PO Detail Screen is a basic scrolling view. The agreed enhancement is the full tabbed screen (7 tabs) which was confirmed by Thomas and is now built. This is the one agreed deviation — all other deviations require Thomas's approval.

**Wireframe deviation (TC-approved, 23 Jun 2026):** Added structured per-package contents (`scn_lines` + `scn_package_lines`) to the SCN wizard. The wireframe's Step 3 Packages is dims/weight only; per-package contents were never designed — but the wireframe's own downstream views ("Items packed: PO line allocations", and Receipting's "Package · Description · Exp. qty · UOM") assume them, so the wireframe is internally inconsistent and this resolves it. Approved by Thomas. Built in stages (Stage 1 = schema; Stage 2 = wizard allocation UI + atomic create-path persisting scn_lines/scn_package_lines incl. off-PO variations; Stage 4 pending = wire detail/receipting read-views).

**KNOWN GAP — no SCN delete/cancel capability (found 23 Jun 2026):** There is no app route to delete or cancel an SCN, and `qmat_app` has no DELETE grant on `shipment_control_notes` / `scn_additional_items`. So a created SCN cannot be removed via the app or runtime user — only by an admin DB delete (and SCN children don't all cascade from `shipment_control_notes`, e.g. `scn_packages` FK has no ON DELETE CASCADE, so children must be removed in FK order first). Address later: either an admin-only SCN-cancel/delete route (soft-cancel preferred over hard delete), or document that SCN removal is admin-only. Not in scope for the packing-contents stages.

---

## 16. INTERNAL CONVERSATION KEY DECISIONS

These were agreed in an internal review session (voice transcript reviewed):

1. **Milestones belong in Expediting ONLY** — not in PO Register table
2. **Expeditor assignment** is on the PO Register row (column after Status), not in PO creation wizard
3. **ROS is optional at PO creation** — can be entered in Expediting, writes back to PO
4. **Child line items ("pink box" / "door")** — max ONE level of children in expediting (no grandchildren)
5. **ITP is the 3rd pillar** alongside Line Items and VDRL on every PO
6. **Forecast date history** on every date field — mandatory reason on every change
7. **Heat numbers** — collected by expeditor from supplier; recorded at warehouse receipt if traceability_required = true
8. **Pre-expediting state** — expeditor can prepare before PO approval (pre_expediting_enabled flag)
9. **Material Control ≠ Warehouse** — warehouse = inventory management; material control = analytics/intelligence layer
10. **AVL/Suppliers is under Admin** — NOT under Foundational
11. **Dashboard is built last** — it reads from ALL other modules
12. **Traceability** — heat numbers are the unique identifier for bulk materials; must be matched at receipt
13. **SCN creation** — asks "notify forwarder now or later?" on creation
14. **Freight forwarder** — can be a system user (logistics access) or external vendor portal user

---

## 17. USER MANUAL

**Standalone document:** ~/Desktop/qmat/docs/USER_MANUAL.md
**Word document:** ~/Desktop/qmat/docs/QCO_MMS_User_Manual.docx (professional SaaS manual)
**Served at:** localhost:3001/docs/USER_MANUAL.md
**Accessible from:** every screen via ? Help → "View full manual" link

The manual covers: Getting Started, Foundational (WBS full detail), Procurement (all phases), placeholder sections for all other modules.

**RULE:** Update USER_MANUAL.md at the end of EVERY session when anything changes. Never commit without doing this.

---

## 18. IMPORTANT ARCHITECTURAL DECISIONS (do not change)

- ITP links at both PO level and optionally PO line level (itp_requirements → po, itp_items → po + optional po_line_id)
- scn_additional_items = off-PO items on SCN. Qty does NOT count against PO quantities.
- date_change_log = generic across all modules. Every date field change requires a mandatory reason.
- Vendor contacts = separate vendor_contacts table, not system users.
- Dual columns (vendor_name + supplier_id) — FK for integrity + varchar as immutable snapshot. Never update the varchar after creation.
- MySQL connection pooling ONLY — never createConnection
- JWT secret: qmat_jwt_secret_2024

---

## 19. INDUSTRY RESEARCH FINDINGS (top 5 EPC material management systems)

Research conducted on: Hexagon Smart Materials (SPMat), Oracle Primavera Unifier, AVEVA Engineering, InEight, SAP S/4HANA

**What industry leaders do that QCO MMS should incorporate:**

1. **WBS as backbone of everything** — every item in every module shows WBS position and rolls up to parent nodes. WBS health score computable from child items up. ← PARTLY DONE, IMPROVING

2. **BOM within WBS** — each WBS node has a Bill of Materials showing required vs committed vs received vs installed quantities. ← TO BUILD (Materials Status columns)

3. **MTO delta processing** — new MTO revision shows exactly what changed (added/deleted/modified lines with delta quantities). ← SPEC EXISTS, NOT BUILT YET

4. **3-date model on WBS** — Planned (baseline) / Forecast (current estimate) / Actual (achieved). ← TO BUILD

5. **Barcode/QR readiness** — items have unique identifiers for future scanning capability. ← NOTE FOR FUTURE

6. **Work Pack / Construction Pack** — materials issued to construction work packs tied to WBS nodes. ← NOTE FOR FUTURE

7. **Earned Value Management (EVM)** — WBS nodes show planned value vs earned value vs actual cost. ← NOTE FOR DASHBOARD

8. **Supplier portal extended** — to expediting milestone confirmations + logistics packing lists. ← TO BUILD IN EXPEDITING/LOGISTICS

9. **Material Receiving Reports (MRR)** — formal auditable receipt document separate from the receipting wizard. ← TO BUILD IN MATERIAL CONTROL

10. **WBS Progress tracking** — % complete per node based on materials received vs MTO qty. ← TO BUILD (Materials Status)

---

## 20. HOW CLAUDE.AI AND CLAUDE CODE WORK TOGETHER

- **Claude Code** (terminal or desktop app): does all the building — edits files, runs servers, executes SQL, git operations
- **claude.ai** (this chat): does all the visual verification — takes screenshots in Chrome, checks every screen independently, writes specs, creates documents
- **Thomas**: reviews and approves changes, provides direction

**Workflow:**
1. Thomas gives instruction to claude.ai
2. claude.ai writes the precise instruction for Claude Code
3. Thomas pastes instruction into Claude Code
4. Claude Code builds and self-tests
5. Claude Code reports back
6. claude.ai independently verifies in Chrome
7. If issues found, repeat from step 2

**Never trust Claude Code's self-report alone** — always verify independently in Chrome.

---

## 21. FILES TO KNOW

- `~/Desktop/qmat/CLAUDE_CONTEXT.md` — master spec, read at start of every session
- `~/Desktop/qmat/docs/USER_MANUAL.md` — user manual, update every session
- `~/Desktop/qmat/docs/QCO_MMS_User_Manual.docx` — professional Word manual
- `~/Desktop/qmat/qmat_schema.sql` — DB schema dump
- `~/Desktop/qmat/public/QMAT-prototype.html` — the wireframe bible
- `~/Desktop/qmat/src/pages/` — all React screen components
- `~/Desktop/qmat/server/` — Node.js backend
- `~/Desktop/qmat/src/components/HelpDrawer.tsx` — reusable help drawer
- `~/Desktop/qmat/src/components/helpContent.tsx` — help content per screen

---

## 22. SUMMARY OF CURRENT STATE

**What works:**
- Login ✅
- Admin (users, suppliers/AVL, settings) ✅
- PO Register with clickable summary cards, RAG filter, critical path toggle ✅
- New PO Wizard (3 steps, commodity/tag autocomplete) ✅
- PO Detail Screen (7 tabs, approve & lock, variations) ✅
- WBS tree (expand/collapse, RAG dots, notes, add/delete) ✅
- WBS Focus mode ✅
- WBS hover tooltip (needs positioning fix and multi-item display) 🔄
- Commodity Library (table, add/edit, certs) ✅
- Equipment List (table, add/edit, certs) ✅
- ? Help drawer on all built screens ✅
- ← Back button + breadcrumb on all screens ✅
- Left sidebar (Foundational in nav) ✅

**Known issues / pending:**
- WBS tooltip positioning gets cut off on left side → fix to right-default with smart flip
- WBS tooltip doesn't show multiple items well → needs count headers + scroll
- WBS template download may not be working → fix as priority
- Commodity Library template download missing → build
- Equipment List template download missing → build
- Left sidebar collapse may need re-verification
- WBS seed data not deep enough on all branches → need all 5 branches at 7-8 levels
- Some WBS nodes need both commodities AND equipment assigned for tooltip testing
- WBS Focus mode needs full node info panel (key dates, commodities, equipment, POs)
- WBS needs Materials Status columns (industry improvement)
- WBS needs 3-date model (Planned/Forecast/Actual)
- WBS needs bulk operations (checkbox, bulk RAG change)
- WBS needs search + filter bar

**Next builds after Foundational enhancements:**
MTO Register → Expediting → VDRL → Logistics → Material Control → Traceability → Document Inbox → Audit → Dashboard (last)
