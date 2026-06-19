# QMAT MMS — Master Context & Specification
# Last updated: 30 May 2026 (status banner added 20 Jun 2026)
# This file is the BIBLE for DESIGN (module specs, wireframe) and RULES (GLOBAL
# STANDARDS, RAG vocabulary, architectural decisions, branding, data-flow). Those
# sections remain authoritative. Nothing gets built that contradicts them.
#
# ⚠ STATUS IS STALE BELOW. The "STATUS: NOT STARTED / NOT YET BUILT" lines and the
#   "PENDING ITEMS (as of 30 May)" section are from 30 May and are WRONG now:
#   ✅ ALL modules are BUILT & live (incl. Dashboard, PO Detail, Traceability,
#   Document Inbox, Audit) plus Reports, Meeting/RFI, Pending-Changes governance,
#   and an RBAC/security layer. The 30-May bugs (SQL group-function, ROS hint,
#   commodity/tag column, PO upload template, BUG-08/09) are all FIXED.
#   ➜ For true current status + open items, read HANDOVER_NEXT_SESSION.md
#     ("CURRENT STATUS & OPEN ITEMS, 20 June 2026"). Treat status lines below as
#     historical; the specs/standards/decisions around them still stand.

---

## PROJECT IDENTITY

- **System:** QCO MMS (Material Management System) — supply chain platform for capital infrastructure projects, energy & resources sector
- **Company:** QCO Group (qcogroup.com.au)
- **Owner:** Thomas Chang (tchang@qcogroup.com.au) — Super Admin
- **GitHub:** https://github.com/Almighty-TC/qco-mms.git

---

## TECH STACK

- **Frontend:** React + TypeScript + Vite → localhost:5174
- **Backend:** Node.js + Express → localhost:3001
- **Database:** MySQL 8.0.44 on Azure — host: qcosystem.mysql.database.azure.com, db: qmat, user: QCO_admin
- **Project location:** ~/Desktop/qmat

---

## HOW TO START

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

## BRANDING

- Orange accent: #E84E0F
- Dark background: #0a0a0a
- White text
- Logo: public/qco_logo_primary_RGB_transparent.png

---

## TOOL SETUP

- Claude in Chrome extension connected — claude.ai has full browser control for visual verification
- Claude Code runs in terminal with --dangerously-skip-permissions
- **Rule:** claude.ai verifies EVERY change in Chrome independently. Never trust Claude Code self-reports alone.

---

## DATABASE STATE (as of 30 May 2026)

45 tables total. Schema dump at: ~/Desktop/qmat/qmat_schema.sql

### Key tables
- purchase_orders, po_lines, po_milestones, po_action_notes, po_approvals, po_documents, po_variations, po_hold_reasons
- vendor_contacts, milestone_templates, milestone_template_steps
- ros_change_log, itp_requirements, itp_items
- scn_additional_items, date_change_log
- projects, users, suppliers, warehouses, wbs_nodes, expediting_register, shipment_control_notes, user_wbs_access

### Key columns added
- purchase_orders: expeditor_id, expeditor_assigned_at, expeditor_assigned_by, pre_expediting_enabled, is_critical_path, critical_path_set_by, critical_path_set_at
- po_lines: cdd, ros_date, heat_number_required, supplier_name_snapshot, wbs_code_snapshot
- projects: traceability_required, traceability_set_by, traceability_set_at, at_risk_days_threshold, approval_threshold_1, approval_threshold_2
- suppliers: avl_status, categories, website, abn
- warehouses: type, capacity, capacity_unit, is_dg_rated, is_secured, is_climate_controlled, default_zone, operating_hours, manager, lifting_capability
- expediting_register: status, material_desc, group_category
- shipment_control_notes: supplier_id, forwarder_name, forwarder_user_id, origin_location, destination_warehouse_id, is_critical_path, total_packages, total_weight_kg, rag, pickup_contact fields, forwarder_notified, forwarder_notified_at, forwarder_notified_by
- user_wbs_access: scope_type
- wbs_nodes: owner_id, planned_start, planned_end, rag

### Milestone seed data
- 4 milestone templates seeded (Standard Equipment, Bulk Materials, Instruments & Electrical, Fabricated Items)
- 26 milestone template steps seeded
- Column names: label (not name), is_system_default (not is_default), is_required (not is_mandatory)

---

## MODULE BUILD ORDER & STATUS

> ⚠️ **Module status is tracked in HANDOVER_NEXT_SESSION.md — see that file for current status.**
> (The status table that was here contradicted this document's own body and has been retired.
> The module specifications and architecture below remain the design source of truth.)

---

## NAVIGATION (LEFT SIDEBAR)

The left sidebar must contain these items in this order:
1. Dashboard (🏠)
2. **MODULES section** (only visible when a project is selected):
   - Foundational (🏗, collapsible): WBS · Commodity Library · Equipment List
   - MTO Register (📋)
   - Procurement (🧾)
   - Expediting (🚨 — compound badge: red=overdue milestones, amber=overdue vendor docs)
     ↳ Contains two views: PO Register (expediting list) and VDRL Register
     ↳ VDRL is a sub-feature of Expediting (PO-Detail VDRL tab + register view), by design — not a standalone module. (Old route /project/:id/vdrl redirects to /project/:id/expediting?view=vdrl.)
   - Logistics (🚚)
   - Material Control (📦, collapsible): Receipting · Stock Register · FMR Register · Transfers
   - Traceability (🔗)
   - Document Inbox (📥)
   - Audit (🔍)
3. **SYSTEM section:**
   - Admin (⚙️)
4. User chip at bottom

**IMPORTANT (stale, 30 May):** ~~Foundational is MISSING from the nav~~ — Foundational (WBS/Commodity/Equipment) IS in the nav and built.
**IMPORTANT (stale, 30 May):** ~~Dashboard has NOT been built~~ — Dashboard is built & live.
**IMPORTANT:** AVL/Suppliers is under Admin, NOT under Foundational. *(rule — still holds)*

---

## CROSS-MODULE DATA FLOW (The Pipeline)

1. **Foundational** → establishes WBS tree, Commodity Library (with trace levels), Equipment List (tagged items), AVL (approved vendors). Everything downstream references a WBS code.
2. **MTO Register** → captures engineering take-off lines (qty, UOM, WBS, ROS, inspection class, VDRL flag). Revisions diff against each other. MTO lines feed procurement.
3. **Procurement** → raises POs against MTO lines/WBS. **Approve & Lock** freezes the PO → locks linked MTO lines → passes PO to Expediting.
4. **Expediting** → monitors milestone chains on locked POs. Logs actions, issues notices, flags critical path. **Also contains the VDRL Register** (vendor document tracking per PO — review cycles, transmittals, MDR closeout). VDRL is no longer a standalone module — it lives inside Expediting as a tab view and as a per-PO panel section.
6. **Logistics** → creates SCNs when goods ship. Tracks pipeline (pickup → transit → customs → delivery). Proof of Custody at handover.
7. **Material Control** → receipts incoming SCNs (5-step wizard), creates stock, manages Stock Register, FMRs, inter-warehouse Transfers.
8. **Traceability** → verifies certs (releasing goods from trace hold), maintains full chain per tag.
9. **Document Inbox** → universal intake that classifies and routes files into the above registers.
10. **Audit** → records every state change across all modules.
11. **Dashboard** → reads across all modules to surface health score, problems, AI analysis. *(Built — the "BUILD LAST" note is historical.)*

---

# FULL MODULE SPECIFICATIONS

## GLOBAL SHELL

**Visual system:**
- Page background: #f4f7fb / #f8fafd
- Cards: #ffffff
- Borders: #dde3ed → #c4cedf
- Hover row: #f0f3f9
- Text primary: #0f172a, secondary: #475569, muted: #94a3b8
- Accent blue: #2563eb (links, active nav, primary buttons)
- QCO orange: #E84E0F (drag handles, active card borders, critical path indicators)

**RAG status vocabulary (NON-NEGOTIABLE):**
- Green #22c55e = On track
- Amber #f59e0b = At risk
- Red #ef4444 = Breached
- Grey #64748b = Not started
- Blue #2563eb = In progress

**Typography:** IBM Plex Sans for UI; JetBrains Mono for all data, codes, refs, dates, quantities.

---

## MODULE 1: DASHBOARD
**STATUS: ✅ BUILT (20 Jun 2026 — the "NOT STARTED" note below is stale).** Live as `DashboardProjectScreen` + `server/routes/dashboard.js`: project-list landing → per-project health screen (health score/band, by-module weights with a configure modal, pipeline funnel). Reads across modules.
Dashboard is a 4-level drill-down: Project list → Project (WBS tree + health) → PO list under WBS node → PO detail.
It reads data from ALL other modules.

---

## MODULE 2: FOUNDATIONAL

### 2.1 WBS (FoundWBSScreen)
**Route:** /project/:projectId/foundational/wbs

**Header:**
- Title "WBS", subtitle "Work Breakdown Structure — {project name}"
- Buttons: ↑ Upload XER/Excel (accepts .xer .xml .xlsx .xls .csv) · + Add node (blue → AddWBSNodeModal)

**Tree table columns:** chevron (▸/▾ for parents, · for leaves) · RAG dot · Code (mono) · Node label · ROS (RAG-coloured date) · Notes (clickable) · code-suffix hint ({code}.xx) · 🗑 delete (hover-revealed, red)

**Row behaviour:**
- Recursive rows, indent 20px per depth level
- Click parent row → expand/collapse
- Click Notes cell → WBS Note editor modal (ROS field + Notes textarea + Cancel/Save)
- Click 🗑 → DeleteWBSWizard
- Default expanded: first two top-level nodes

**AddWBSNodeModal (2-column form):**
- Parent node (dropdown, blank = top-level/root)
- Code suffix (mono input) + live Full code preview (read-only, e.g. parent 02 + suffix 01 → 02.01)
- Node name/description (required)
- RAG status dropdown (Not started / On track / At risk / Breached / Complete)
- Owner/Responsible
- Planned start + Planned end (date pickers)
- Notes/scope description (textarea)
- Footer validity hint ("✓ Ready to save · {code}" or "Required: code and name")
- Buttons: Cancel + ✓ Add node (disabled until code + name filled)
- On save: success toast

**DeleteWBSWizard (3-step, red theme):**
- Step 1 — Impact: red warning panel with 4 metrics (Child nodes · Affected POs · Line items · Codes covered) + Related Purchase Orders table. Green "safe to delete" if nothing references it.
- Step 2 — Reallocate (skipped if no affected lines): every affected line must be reassigned to a new WBS node. Table shows Line · PO Ref · Description · Qty · Current WBS (red) · New WBS (dropdown). Running status "X of Y lines re-allocated". Continue disabled until all done. **IMPORTANT: when assigning to new WBS, show how much is already allocated there vs MTO quantity — warn if over-allocated.**
- Step 3 — Confirm: final red warning, re-allocation summary table, mandatory acknowledgement checkbox. Footer: Cancel · ← Back · 🗑 Delete permanently (disabled until acknowledged).

**Upload XER/Excel:** file picker, import WBS nodes from P6 XER or Excel template.

---

### 2.2 Commodity Library (FoundCommodityScreen)
**Route:** /project/:projectId/foundational/commodities

**Header:** "Commodity Library", live count "N commodities · {project name}". Buttons: ↑ Upload (.xlsx .xls .csv .pdf, multiple) · + Add commodity (blue)

**Tabs (live counts):** All items · Active · Inactive

**Filter bar:**
- Free-text search (matches code, name, WBS, vendor)
- Group by: None · WBS · Vendor

**Sortable table columns:** Code · Name · UOM · WBS · Trace level · Preserve · Vendor · Status pill · (actions)
- Code (mono), Name (greyed if inactive), UOM, WBS (mono), Trace level, Preservation (greyed if "None"), Vendor
- Status pill: green "Active" / grey "Inactive"
- Actions: 📎 Certs → CertificatesModal · Edit → AddCommodityModal prefilled
- When grouped: group header strips with key + item count

**AddCommodityModal (2-col form):**
- Commodity code (required)
- WBS (required, dropdown)
- Name/description (required, full width)
- Unit of measure: EA/M/M²/M³/KG/T/LT/SET/LOT
- Estimated qty
- Trace level: Heat number / Heat + cert / Mill cert / Drum number / Serial / None
- Preservation: None / Dry storage / Climate controlled / Painted-wrapped / N2 purge
- Preferred vendor
- Notes
- Validity hint + Cancel / ✓ Add commodity

---

### 2.3 Equipment List (FoundEquipmentScreen)
**Route:** /project/:projectId/foundational/equipment

**Header:** "Equipment List", "N of M items · Tag numbers unique per project". Buttons: ↑ Upload · + Add equipment

**Tabs (live counts):** All · PO raised · RFQ · Not started

**Filter bar:** search (tag, description, WBS, vendor) + Group by: None · WBS · Vendor (unassigned → "Unassigned" bucket)

**Sortable table columns:** Tag · Description · Spec · Trace · WBS · Vendor · Status · (actions)
- Tag (blue mono), Description (truncates), Spec (e.g. ASME VIII Div 1, API 610, IEC 62271), Trace class (Class I/II), WBS (mono), Vendor (greyed if "—")
- Status pills: PO raised (green) · RFQ (blue) · Not started (grey) · On site (green) · In transit (amber)
- Actions: 📎 Certs · Edit

**AddEquipmentModal (3-col form):**
- Equipment tag (required)
- Equipment type: Vessel/Pump/Compressor/Heat exchanger/Tank/Filter/Valve/Motor/Skid/Instrument/Pipe spool/Structural/Cable drum/Panel/Package
- WBS (required)
- Description (required, full width)
- Area/location
- Criticality: A-Critical / B-Major / C-Standard
- PO reference
- Vendor
- Weight (kg)
- Overall size (L×W×H)
- Notes

---

### 2.4 Certificates Modal (CertificatesModal) — shared by Commodity + Equipment
- Header: "📎 Certificates · {code/tag}" + item name + cert count
- Summary bar: ✓ verified / ⏳ pending / ✕ rejected counts + + Upload certificate
- Upload form: Cert type (Heat number / Batch-lot / Mill test / Heat-treatment / DG-hazmat / CoC / CoO / Calibration), Heat/batch/ref number, Applies-to scope, Issue date, file picker
- Cert list grouped by type. Each card row: ref number, applies-to scope + filename, status pill (Verified/Pending QA/Rejected/Expired), date, uploaded-by + size, actions: 👁 Preview · ↓ Download · × Delete

---

## MODULE 3: MTO REGISTER

### 3.1 MTO List (MTOListScreen)
**Route:** /project/:projectId/mto

**Header:** "MTO Register" + + New MTO (→ NewMTOModal)

**Table columns:** MTO/Reference (name + ref mono + revision count) · Latest Rev (mono "Rev X") · Lines · Last updated · Owner · View button
- Superseded MTOs: 50% opacity, non-clickable, labelled "Superseded"
- Click active row or View → MTO detail

### 3.2 New MTO Wizard (NewMTOModal, 4 internal steps)
- choose: Upload MTO file (Excel/CSV) OR Create manually
- upload: metadata form + drag-drop dropzone (.xlsx/.xls/.csv) with confirmation
- manual: metadata form (name, reference, revision A–F, owner, description)
- manual-lines: add line items with TagPicker autocomplete (Description/Tag, WBS, Qty, UOM, ROS, Inspection Class I/II/III, VDRL Yes/No)

### 3.3 MTO Detail (MTODetailScreen)
**Tabs:** Lines · Diff

**Lines tab:** filter + search. Each line: line# · WBS · Description · Qty · UOM · ROS · Inspection class · VDRL · status · linked PO ref. Row actions: Edit → MTOLineEditModal · Delete → MTOLineDeleteConfirm or MTOLineBlockedDialog

**Diff tab:** pick diffFrom/diffTo revisions (A–F) → shows added/modified/deleted lines highlighted

**MTOLineEditModal:**
- **LOCK RULE:** if line status = po-raised, Description/WBS/Qty/UOM/Tag are DISABLED. Only ROS, certification, VDRL, notes editable. Banner directs to raise variation request through Procurement.

**MTOLineBlockedDialog:**
- Shown when line is locked (PO raised / being expedited)
- Offers alternatives: raise Variation Request, cancel/reduce PO qty first, or raise FMR if already shipped

---

## MODULE 4: PROCUREMENT

### IMPORTANT NOTES FROM INTERNAL REVIEW:
1. ~~**PO Detail Screen (Phase 3) is NOT yet built**~~ — BUILT (`PODetailScreen.tsx`); the spec in §4.6 was implemented.
2. **Milestones belong in Expediting only** — NOT shown in PO Register table
3. **Expeditor assignment** belongs on the PO Register itself (column after Status), not inside the PO creation wizard — because assignment may happen months after PO creation
4. **Owner** = commercial PO owner. **Expeditor** = assigned separately when expediting begins
5. **PO must be Approved & Locked** before it appears in Expediting (with one exception: pre_expediting_enabled flag allows expeditor to prepare before approval)
6. **Critical path flag** on a PO propagates to all items below it — visible everywhere (procurement, expediting, logistics)

### 4.1 PO Register (ProcurementScreen)
**Route:** /project/:projectId/procurement

**Header:** "PO Register", project subtitle. Buttons: ↓ Export · ↓ Template · ↑ Upload POs · ℹ Help · ↺ Reset · + New PO

**5 Summary stat cards (CLICKABLE FILTERS):**
- Total POs → clears all filters, shows all
- Ongoing → filters to active/pending POs
- Complete → filters to completed POs
- Breached → filters to POs where CDD < today AND status not complete/cancelled (rag=red)
- At Risk → filters to POs where CDD within project threshold AND status not complete/cancelled (rag=amber)
- Active card: orange border (#E84E0F) + subtle orange glow. Click active card again → deselects.

**Tabs:** All POs · Approved · Pending approval · ✓ Completed

**Toolbar:** Search (PO ref, description, vendor) · CDD date range from/to · ★ Critical path only toggle · 5 of N POs count

**Sortable table columns:** ★ | PO REF | VENDOR/GROUP | MATERIAL DESCRIPTION | WBS | OWNER/EXPEDITOR | CDD | ROS DATE | STATUS | Actions
- NO Milestones column (milestones belong in Expediting only)
- RAG left border stripe (green/amber/red)
- Colour legend bar at bottom of table
- Resizable columns with orange #E84E0F drag handles (3px, visible on hover)

**Row:**
- ★/☆ critical path toggle (SimpleConfirmModal + reason field)
- PO ref (mono blue, clickable → PO Detail Screen)
- Vendor name + Group/Category below
- Material description
- WBS code (mono)
- Owner name + Expeditor below (or "— Assign" link with tooltip "Assign an expeditor to this PO")
- Owner name hover tooltip: "PO Owner"
- CDD date (RAG-coloured)
- ROS date (RAG-coloured)
- Status pill
- Actions: Approve button (if pending) + row click → PO Detail Screen

**Side drawer** (on row click — TEMPORARY until Phase 3 PO Detail Screen is built):
- PO details, milestones, signed PO section, owner/expeditor assignment
- Signed PO upload/download (po_documents table, authenticated streaming)
- PO number in drawer header is CLICKABLE LINK → navigates to PO Detail Screen (Phase 3)

**↑ Upload POs button:**
- Bulk upload modal, drag-drop, CSV/XLSX
- Preview table with 🟢🟡🔴❌ status per row
- Template must include BOTH header fields AND line items section (see PO Upload Template spec below)

**PO Upload Template (XLSX) — two sections:**
Section 1 — PO Header (label/value pairs):
- PO Reference (required)
- Vendor/Supplier name (required)
- PO Name/Title (required)
- Group/Category (Mech/Electrical/Instrumentation/Civil/Piping/Structural)
- Currency (AUD/USD/EUR/GBP/SGD)
- INCO Terms (CIF/FOB/EXW/DAP/DDP/FCA/CPT/CIP)
- INCO Location
- WBS Code
- Contract/Order Number
- Award Date (dd/mm/yyyy)
- CDD - Contract Delivery Date (dd/mm/yyyy)
- ROS - Required on Site Date (dd/mm/yyyy)
- FAT Date (dd/mm/yyyy)
- ESD - Estimated Ship Date (dd/mm/yyyy)
- Notes

Section 2 — Line Items (column headers then data rows, minimum 20 blank rows):
Line # | Item Description | Quantity | UOM | Unit Rate | Total Value | WBS Code | CDD | ROS Date | Heat Number Required (Y/N)

Format: Orange header row (#E84E0F) for section headings, frozen top rows, Instructions tab

---

### 4.2 New PO Entry Choice (NewPOEntryModal)
Two cards:
- 📥 Upload PO document ("Recommended") → NewPOUploadFlow (auto-extracts header + lines + milestones from PDF/Excel/Word)
- ✎ Create manually → NewPOManualForm

### 4.3 New PO Upload Flow (3 stages)
1. drop: dashed dropzone (PDF/Excel/Word ≤25MB)
2. extracting: spinner with field-by-field extraction status
3. review: green "Extracted" banner + auto-filled header grid. Footer "Continue to review →" → hands to manual form for verification

### 4.4 New PO Manual Form (3 steps)
**Step 1 — Header (2-col grid):**
- PO Reference (required)
- WBS (required, dropdown)
- PO Name (required, full-width)
- Description (textarea)
- Vendor (required)
- Group/Category (Mech/Electrical/Instrumentation/Civil/Piping/Structural)
- Currency (required: USD/AUD/EUR/GBP/SGD/JPY/CNY)
- PO Value (number)
- Incoterms (required: CIF/FOB/EXW/DAP/DDP/FCA/CPT/CIP)
- Required on Site / ROS (OPTIONAL — can be left blank at PO creation. Hint text: "Can be added later — required before expediting begins" IS WRONG. Correct hint: "Optional — can be entered later in Expediting". When ROS is entered or updated in Expediting, it must write back to the PO record (purchase_orders.ros_date) so PO level always reflects the latest value. No hard block on ROS at PO creation.)
- Owner/Expeditor (dropdown of staff)
- **Duplicate PO check on PO number blur (onBlur)**

**Step 2 — Line items:**
- Header: "N line item(s) · Subtotal: {currency} {subtotal}" + + Add line
- Columns: # · **Commodity Code / Equipment Tag** · Description · Qty · UoM · Unit price · Total (auto) · ×
- **Commodity Code / Equipment Tag (CRUCIAL):**
  - Autocomplete/search field that searches both Commodity Library AND Equipment List for the current project
  - Selecting a commodity auto-fills: Description, UOM, Trace level
  - Selecting equipment auto-fills: Description, Tag number, UOM
  - Field is OPTIONAL at PO creation — if user doesn't have the detail yet, can be left blank
  - If left blank: line is flagged "commodity/tag not linked" — visible indicator in expediting
  - In Expediting: user can link the commodity code or equipment tag to the line item at any time
  - This linkage is critical for: traceability, heat number tracking, cert requirements, ITP requirements, SCN line assignment
- UoM (select EA/M/M²/M³/KG/T/LT/SET/LOT) — auto-filled from commodity selection if available
- Total auto = Qty × Unit price
- × delete disabled when only one line remains
- At least one line required (description alone is sufficient if no commodity code yet)

**Step 3 — Milestones & review:**
- Milestone date table: PO Award · FAT · ESD · ETA · ROS (each with date picker, blank allowed)
- Review summary card: Reference, Vendor, Name, WBS, Currency, PO total, Incoterms, ROS, Lines count
- **Approval threshold logic:** checks project thresholds (approval_threshold_1, approval_threshold_2), routes to single/dual approval

Footer: Cancel · ← Back · ✓ Create PO (green)

### 4.5 Approve & Lock PO Wizard (ApprovePOWizard, 2 steps)
**Step 1 — Review:**
- PO summary card (Reference, Vendor, PO Name, Total value in green, Incoterms + handover, Line items count, ROS/CDD)
- Approval chain: Procurement Officer (done ✓) → Project Manager (active ← YOU) → Client (informational, pending)
- Three mandatory acknowledgement checkboxes (each turns green when ticked):
  1. "I have reviewed all N line items, quantities, UOM and unit values."
  2. "I confirm the total PO value of {ccy} {amount} is correct."
  3. "I understand that once approved, this PO will be locked — any future changes require a Variation Request."
- Note to expediting textarea (optional)
- Red warning: "⚠ This action cannot be undone."
- 🔒 Approve & lock PO — DISABLED until all 3 checkboxes ticked

**Step 2 — Success:**
- Green ✓ confirmation
- "What happens next": PO locked read-only · Expediting opens milestone monitoring · vendor auto-notified · audit log updated
- Buttons: Close · Go to Expediting →

**State flow:** on confirm, PO's approved flag flips; PO becomes locked/read-only; passes to Expediting.

---

### 4.6 PO Detail Screen — Phase 3 (PODetailScreen) ✅ BUILT (the "NOT YET BUILT" tag is stale — `src/pages/PODetailScreen.tsx`, full tabbed screen: Line Items · Key Dates · ITP · Documents · Action Notes · Variations · Audit Trail; approve & lock)
**Route:** /project/:projectId/procurement/:poId
**This is a FULL DEDICATED SCREEN — not a modal, not a drawer.**
**The PO number in the side drawer header is already set up as a clickable link — it should navigate here.**

**IMPORTANT GAP FROM WIREFRAME:** The wireframe only has a basic scrolling detail view. The full tabbed PO Detail Screen below is an ENHANCEMENT that was discussed and agreed in the internal review. It must be built as specified here.

**Top bar:**
- ← PO Register breadcrumb
- PO ref (mono grey) above the title
- PO name (H2) + description
- Right-side actions (state-dependent):
  - Pending (not approved), view mode: ✎ Edit + Approve & lock PO (green)
  - Editing: Cancel + ✓ Save changes (blue)
  - Approved: static badge "✓ Approved — Locked" (no edit actions)

**PO meta grid (top section, always visible):**
Currency · Total value (computed from lines) · Incoterms · Handover point · Owner · Expeditor · Vendor · ROS date · CDD · Group/Category · WBS · Contract number · Award date

**Status banner (one at a time):**
- Approved: green — "This PO is approved and locked. Passed to Expediting."
- Pending + view: amber — "Pending approval. Click ✎ Edit to amend or Approve & lock when ready."
- Editing: blue — "✎ Editing — totals recalculate from line items on save."

**Tabs:**
1. **Line Items** — all po_lines with columns: Line # · Description · Qty · UOM · Unit value · Total value · WBS · CDD · ROS · Heat Number Required
   - Edit mode: inline editable + × delete per row + + Add line button
   - Total value per line auto-computes (Qty × Unit value)
   - Totals row (footer, bold): grand total in PO currency
   - Approved POs: read-only

2. **Key Dates** — PO placed, FAT, ESD, ETA, ROS
   - Each date shows: current value + full history log from date_change_log
   - History log per date: old value → new value, changed by, changed at, mandatory reason
   - Every date change REQUIRES a mandatory reason (dropdown + free text)
   - "Changed N times" indicator → click to expand history

3. **ITP** — Inspection & Test Plan requirements
   - This is the 3rd pillar alongside Line Items and VDRL
   - Links to itp_requirements table at PO level; itp_items link to PO + optional po_line_id
   - Columns: ITP Item # · Description · Inspection Type · Linked Line Item (optional) · Planned Date · Forecast Date · Status · Witness Required (Yes/No) · Certificate Required (Yes/No) · Notes
   - ITP items can be: pre-delivery (must complete before SCN) or post-delivery (can complete after receipt)
   - Add ITP item button (only if PO not yet approved, or with appropriate permission)
   - Same forecast date change tracking as Key Dates tab

4. **Documents** — signed PO + other uploaded documents
   - Upload Signed PO button (uploads to po_documents table)
   - Document list: filename, type, uploaded by, uploaded at, download/preview/delete actions
   - Authenticated streaming for download

5. **Action Notes** — expeditor work notes
   - Chronological notes thread (author, role, timestamp, text)
   - Add note textarea + post button
   - Notes visible to all authorised users

6. **Variations** — post-approval change requests
   - Lists all variation requests against this PO
   - Each variation: ref, description, raised by, raised at, status, approved/rejected by
   - Raise new variation button

7. **Audit Trail** — full history of all changes to this PO
   - Who/what/when/before/after for every field change
   - Filterable by field, user, date range

**Bottom action bar (if pending approval):** Approve & lock PO button

---

## MODULE 5: VDRL (Vendor Document Requirements List)
**STATUS: ✅ EMBEDDED IN EXPEDITING (by design) — not a standalone module, not outstanding work.**
VDRL is a sub-feature of Expediting; it lives INSIDE Expediting in two places:
1. **VDRL Register tab** in the Expediting Register screen (all docs across all POs)
2. **VDRL section** in the Expediting PO Detail Panel (docs for one PO)
The old route /project/:projectId/vdrl now redirects to /project/:projectId/expediting?view=vdrl.
All specs below remain valid — the build target is just the Expediting module, not a standalone VDRL module.

**Route:** /project/:projectId/expediting?view=vdrl (was /project/:projectId/vdrl)

**Dual-role screen:** QCO internal staff vs Supplier/vendor portal (role assigned at login)
**Active package context** with Switch package and New package flow

### QCO Role Tabs:
- Register · Expediting · Review cycle · Transmittals · Vendor contacts · MDR closeout · Alerts (red count badge)

### Supplier Role Tabs:
- My documents · Upload & submit (orange count badge) · Review comments · Transmittals · Expediting notices

### Register tab (document table):
- KPIs: total docs, submitted, overdue, AFC-cleared, action-required, % progress
- Filters: search (doc no/title/type) · status filter · type filter · discipline filter
- Configurable columns (show/hide): Doc no · Title · Type · Rev · Required · Promised · Submitted · Status · ABF (defaults on); Discipline · Owner · Transmittal · Version · Notes (defaults off)

### IMPORTANT FROM INTERNAL REVIEW:
- Documents in VDRL come from the signed PO/contract — they are contractual obligations
- Cannot remove a VDRL document without a Variation Request (same logic as PO lock)
- Supplier portal: supplier sees their required documents, uploads, gets feedback
- Should allow adding a document type not in the database (with reason)

### Modals (QCO):
- VDRLNewPackageModal, VDRLSwitchPackageModal, VDRLAddDocumentModal
- VDRLLogActionModal (log expediting action against vendor)
- VDRLAddCommentModal (Hold/Minor review comments)
- VDRLNewTransmittalModal (select docs, recipient, cover note, reply-by date)
- VDRLExportModal (format Excel/CSV/PDF, scope options, include revision history checkbox)
- VDRLContactModal (add/edit vendor contact)
- VDRLGenMDRModal (generate Manufacturing Data Record PDF)
- VDRLAlertDetailModal (alert detail with suggested actions)

### Modals (Supplier):
- VDRLUploadDocumentsModal (drag-drop, map to required doc, rev + comment)
- VDRLRespondQCOModal (respond to expediting notices with commitment date)

---

## MODULE 6: EXPEDITING

**Route:** /project/:projectId/expediting

**IMPORTANT:** Expediting only operates on POs that have been Approved & Locked by Procurement.
**EXCEPTION:** pre_expediting_enabled flag on purchase_orders allows expeditor to prepare (set up ITP milestones, break out child line items) before PO approval. These POs show with amber indicator "Pre-expediting" instead of green.

**ROS DATE WRITEBACK:** ROS is optional at PO creation. When ROS is entered or updated anywhere in Expediting (at PO level or line item level), it MUST write back to purchase_orders.ros_date so the PO Register always shows the latest value. Every ROS change requires mandatory reason + records to date_change_log.

**COMMODITY/TAG LINKING IN EXPEDITING:** PO lines created without a commodity code or equipment tag are flagged "not linked" with a visible indicator. In the Expediting PO Detail Panel, each unlinked line shows a "Link commodity/tag" button. Clicking opens a search modal (searches Commodity Library + Equipment List for current project). Once linked: trace level, heat number requirement, ITP requirements, and cert requirements auto-populate for that line.

### IMPORTANT FROM INTERNAL REVIEW:
1. **Child line items ("pink box" / "door"):** PO line items can be broken into child items in expediting. A PO line item (contractual, from the signed PO) can have child items added for tracking sub-components. These children are NOT on the original PO — they are expediting tracking items only. Maximum ONE level of children (no grandchildren).
2. **Forecast date history:** Every forecast date change on every item requires a mandatory reason. Full history must be viewable inline — "Changed 6 times" → click to see all changes with notes. This is the expeditor's bible.
3. **Heat numbers:** For commodity type steel (and others requiring heat traceability), a heat number column appears in expediting. Expeditor collects heat numbers from supplier during the expediting process.
4. **Milestone flexibility:** Each PO/package may have different milestones. System should allow defining which milestones apply per package. Pre-defined templates available but customisable.
5. **Pre-expediting state:** If pre_expediting_enabled = true, expeditor can set up all structure (child items, ITP milestones) but cannot communicate with supplier or mark milestones complete. PO shows amber "Pre-expediting" indicator.
6. **Critical path propagation:** Flagging a PO as critical path propagates the flag visibly through expediting, logistics, and material control.

### 6.1 Expediting Register (ExpeditingScreen)

**Header:** "Expediting Register · {project name} · {user group}" + ↓ Export

**5 Summary stat cards (same clickable filter pattern as Procurement):**
Total POs · Ongoing (blue) · Complete (green) · Breached (red) · At risk (amber)

**View tabs:** All · Ongoing · Complete (live counts)

**Toolbar:**
- Search (ref/vendor/material/WBS/tag)
- Group by: None / WBS / Vendor / Material
- RAG filter: all / red / amber / green
- ROS date range (from/to pickers — matching rows highlight blue)
- Critical-only toggle

**Row (RAG-coloured left border, sorted red→amber→green→blue→grey):**
- ★ critical toggle
- PO ref (mono blue; grey if complete)
- Vendor + group
- Material description
- Owner
- MilestoneTimeline (compact): PO Award → TPI → FAT → Ship-by → ROS (RAG-coloured nodes with dates)
- ROS date (RAG-coloured; blue+bold if inside active ROS filter range)
- RAG pill
- View button
- Completed POs: muted grey text, faint green background

**Click row → ExpPODetailPanel (slide-in drawer)**

### 6.2 Expediting PO Detail Panel (ExpPODetailPanel)

**Right-side slide-in drawer (620px)** over dimmed scrim. Click scrim or ✕ to close. Scrollable.

**Header (sticky):**
- PO ref (mono grey), vendor name, "Owner: {owner} · Group: {group}"
- RAG pill + ✕ close
- Action buttons: + Create SCN (blue → CreateSCNWizard) · 📎 Documents (→ DocBundlePanel)

**Milestones section:**
- MilestoneTimeline (compact) for the PO
- Each milestone: planned date · forecast date · actual date
- Forecast date is editable — EVERY change requires mandatory reason + records to date_change_log
- Inline history: "Changed N times" → expandable showing all previous values + reasons

**Line items section (THE CORE OF EXPEDITING):**
Each PO line renders as a card:
- Line header: Line no (mono) · description · "{tag} · WBS {wbs} · ROS {ros}" · roll-up status pill
- Quantity allocation summary: Total / Assigned / Available (mono; Assigned blue, Available green) + progress bar
- Heat number field (shown for commodities with trace level = heat number/heat+cert)
- + Assign to SCN button (shown when available > 0) → CreateSCNWizard
- Per-allocation rows (one per SCN the line is split across):
  - SCN ref (mono blue) · allocated qty · allocation status pill
  - 📦 Packages toggle (expands package table) · 📎 Docs (→ DocBundlePanel)
  - SCN detail grid: ETD · ETA · Forwarder · Destination · Delivery · Incoterm
- No allocation: italic "No SCN assigned — create SCN"

**Child line items ("pink box" / "door" concept):**
- Below each PO line, expeditor can add child tracking items
- Child items are NOT contractual — they are sub-components for expediting tracking only
- Child item fields: Description · Qty · UOM · CDD · Forecast ready date · Status · Notes
- Maximum ONE level (no grandchildren)
- Child items identified with sub-number (e.g. PO line 001 → children 001.1, 001.2)
- Child items can also be assigned to SCNs

**ITP requirements section (below line items):**
- Lists ITP items linked to this PO (from itp_items table)
- Columns: ITP # · Description · Linked Line · Planned date · Forecast date · Status · Witness Req · Cert Req · Before/After delivery flag
- Forecast date changes: same mandatory reason + history tracking as milestones
- Cert Required items: cannot create SCN for that line until cert is uploaded (unless "post-delivery" flag)

**Action notes / work log:**
- Chronological notes thread
- Add note textarea + post button
- Visible to all authorised team members

**Partial shipments supported:**
- A single PO line can be split across multiple SCNs
- lineAssigned/lineAvailable computed as aggregate
- Available reflects qty not yet on any SCN

---

## MODULE 7: LOGISTICS (SCN Register)

**Route:** /project/:projectId/logistics

SCN = Shipment Control Note. Picks up POs once they ship.

**Header:** "Logistics — SCN Register · {project name} · N shipment control notes" + ↓ Export

**Pipeline status summary bar (clickable, each filters table):**
Pending pickup · In transit · Customs review · Pending delivery · Delivered (with live counts, coloured)

**Tabs:** All SCNs + one per status

**Toolbar:** search (SCN ref/PO/vendor/forwarder/origin/destination) + Forecast controls (mode pickup/arrival, within N days)

**Row:** ★ critical toggle + SCN ref · PO · vendor · forwarder · origin → destination · ETD/ETA · status pill · RAG

**Click row → SCNDetailModal (tabs: overview / packages / docs / timeline)**

### Create SCN Wizard (CreateSCNWizard, 4 steps):
1. Select PO lines to ship (respects available qty, includes child line items)
2. SCN header (forwarder, mode, incoterms, origin/dest, ETD/ETA)
3. Packages (define packages, assign line qty, dims/weight, DG flags)
4. Confirm → creates SCN in Logistics pipeline

### IMPORTANT FROM INTERNAL REVIEW:
- **Forecast ready date** = what expeditor says the goods will be ready for pickup (≠ CDD)
- **ETD** = Estimated Time of Departure (set by freight forwarder, not expeditor)
- **ETA** = Estimated Time of Arrival (set by freight forwarder)
- Expeditor populates "forecast ready for pickup" date; freight forwarder populates ETD/ETA
- SCN creation triggers notification to assigned freight forwarder
- "Do you want to notify forwarder now or later?" prompt on SCN creation
- Freight forwarder may be a system user (logistics access) or external (vendor portal)

### Proof of Custody (ProofOfCustodyScreen):
- Capture condition, quantity, photos, signature, confirm custody transfer at vendor pickup/handover

---

## MODULE 8: MATERIAL CONTROL

Four sub-screens (collapsible nav group): Receipting · Stock Register · FMR Register · Transfers

### IMPORTANT FROM INTERNAL REVIEW:
- **Warehouse/Receipting = Inventory Management** (not "material control" in the traditional sense)
- **Material Control = data analytics + intelligence layer** — sees the whole supply chain, reports on it, identifies shortages before they happen, tells expeditors what's urgent
- Material Control continuously interrogates MTO vs PO vs stock quantities to surface shortages
- Warehouse receives and manages stock; Material Control analyses and directs

### 8.1 Receipting (MCReceiptingScreen)
Register of pending receipts (inbound SCNs awaiting goods-in). Click row → Receipting Wizard (5 steps):
1. Review expected (packages, qty, weight, ETD/ETA)
2. Physical check (actual qty per package, ✓/✕ match, OS&D discrepancy flag)
3. Assign location (grid location format WH-[code]·[row]-[bay]-[level])
4. TCCC sign-off (Trace/Cert/Condition/Compliance checklist)
5. Complete (stock created in register)

**Traceability at receipt:** If project config has traceability_required = true for this commodity type:
- Receipting wizard expands to show each individual item
- Warehouse must record heat numbers against each piece
- System matches heat numbers to certificates already uploaded in Traceability module

### 8.2 Stock Register (MCWarehouseScreen)
- Searchable, sortable stock across warehouses
- Quarantine status for items pending cert verification or with physical issues
- ReallocateStockModal (split/move across locations)
- StockTakeModal (cycle count)
- View by WBS, warehouse, commodity code

### 8.3 FMR Register (MCFMRScreen)
FMR = Field Material Request. Site material requests; raise/fulfil from stock.
**MULTI-LINE model (built):** an FMR is raised by a contractor from site and holds MANY lines
(`fmr_requests` header + `fmr_lines`). ONE WAREHOUSE PER FMR — `fmr_requests.warehouse_id`; the
Raise modal auto-locks to the first item's warehouse and blocks items from any other warehouse.
Each line = one item + one WBS + one qty; same commodity against a different WBS = a separate line
(no per-line WBS splitting). Equipment lines are qty-locked to 1 and single-WBS. Lines must sit within
the contractor's `user_wbs_access` scope. Item picker (`GET /mc/:pid/fmr/items`) and the contractor
view NEVER expose grid/bin `location_code` (MC-internal only). Server validates warehouse/scope/equipment
on `POST /mc/:pid/fmr` (422) and writes an audit row.
**PER-LINE APPROVAL (built):** MC approval is per line via `fmr_lines.line_status`
('pending','approved','partially_approved','partial_issued','issued','rejected') +
`qty_approved`/`approval_reason`/`approved_by`/`approved_date`. `PUT /mc/:pid/fmr/:id/approve`
takes `{decisions:[{line_id,decision:'approve_full'|'approve_partial'|'reject',qty_approved?,reason?}]}`,
validates per line (partial 0<qty<requested & ≤remaining; reject needs reason; **WBS ceiling**:
full-approve blocked when requested > remaining allocation), writes an audit row per line, and
recomputes the header roll-up (`rollUpStatus`: any pending→pending_approval; mix approved+rejected→
partially_approved; all rejected→rejected; else approved). `GET /mc/:pid/fmr/:id/approval` returns
every line with allocation (on_hand/already_issued/wbs_total_allocation/remaining_allocation/in_transit)
and the three system checks. Approval modal renders one decision card per line.

### 8.4 Transfers (MCTransferScreen)
Inter-warehouse transfers. NewTransferModal (multi-step): from warehouse → to warehouse, select stock lines + qty, transport details, confirm.

---

## MODULE 9: TRACEABILITY

**Route:** /project/:projectId/traceability

**Header:** "Traceability · VDRL, cert approvals, trace chain & holds" + ↑ Upload cert

**KPI strip:** VDRL items received (green) · VDRL pending (amber) · VDRL overdue (red) · Active trace holds (red)

**Tabs:** VDRL · Cert approvals (amber count) · Trace chain · Holds (red count)

**IMPORTANT FROM INTERNAL REVIEW (heat number traceability):**
- For bulk materials (steel, pipe, cable), unique identifier = heat number
- Heat numbers collected by expeditor from supplier during expediting
- At receipt, warehouse matches physical items to heat numbers → associates certificates
- Certificate must travel with goods through SCN to warehouse
- Two approaches (project-configurable): (1) Expeditor gets heat number list from supplier, records in system; (2) Warehouse reads and records heat numbers at receipt
- traceability_required flag on projects controls which commodities require this
- If traceability_required = true for a commodity: receipting wizard expands to capture heat numbers per item

**Trace chain tab:** Visual chain for a selected tag across 6 phases: PO § → Mfg ⚙ → Inspect ✓ → SCN ➜ → Receipt ⬇ → Cert 📎 (each phase RAG-coloured)

---

## MODULE 10: DOCUMENT INBOX

**Route:** /project/:projectId/documents

Central intake for any uploaded/received file before it's filed to a module.
- Filters: search + module filter
- DocClassifyModal: classify file (type, target module, link to PO/SCN/WBS/equipment, rev, notes) → routes to right register

**BUILT — aggregate, read-only register (DocumentsScreen, route `documents`).** This module owns
NO documents and has NO table; `server/routes/documents.js` (`/api/documents`) UNIONs every module's
existing doc tables into one normalised, searchable view and links each row back to its source via a
deep-link URL (works now that BUG-09 is fixed). Sources: traceability_certs, vdrl_documents (Expediting/VDRL),
scn_documents (Logistics), po_documents (Procurement), foundational_certificates, mto_revisions. Status
normalised to Verified | Available | Under review | Missing; "Missing" rows come from requirement tables
(VDRL Not-submitted/Overdue, traceability pending/overdue). 5 KPIs, module pills, status/date/search/mine
filters, group-by (module/source/type/uploader), CSV export, row-preview, jump-to-source.
**Gap:** Material Control has no document table (FMR dockets / receipt PODs aren't stored) → contributes
0 rows and upload there is "not yet supported". Upload dropzone routes to the chosen module's own endpoint;
wired for Logistics + Procurement; other modules upload on their own screens.

---

## MODULE 11: AUDIT

**Route:** /project/:projectId/audit

Immutable audit log across all modules. Search interface. Returns: who · what action · which entity · timestamp · before/after values.

---

## MODULE 12: ADMIN

**Route:** /admin

**Tabs:** Users · Suppliers/AVL · Settings

**Roles:** System Admin · Project Manager · Procurement Officer · Senior Expeditor · Junior Expeditor · Logistics Officer · Materials Controller · Quality Engineer · Engineer · Subcontractor

**Suppliers/AVL (FoundAVLScreen):** Approved Vendor List — status (Approved/Conditional/Rejected/Pending), scope, qualification. + Add Supplier → AddSupplierModal (multi-step).

---

## GLOBAL STANDARDS (apply to EVERY file)

- **Back button + breadcrumb on EVERY screen (NON-NEGOTIABLE):** Every screen must have a ← Back button in the top-left that navigates to the previous screen, plus a breadcrumb trail showing the full path (e.g. Dashboard › Pilbara Gas Processing Plant › Procurement › PO-2024-001). Back button uses browser history. Breadcrumb reflects actual navigation path. This matches the wireframe and applies to every existing and future screen without exception.
- Sticky headers on all tables (overflow-x: auto + overflow-y: auto + maxHeight on wrapper; thead position:sticky top:0; NOT on thead tr)
- Resizable columns with orange #E84E0F drag handles (3px, visible on hover; 2px solid extending full height when actively dragging)
- Hover tooltips for truncated text
- Dark/light mode toggle
- Text size control (A- A A+) persisted in localStorage
- ↺ Reset to defaults button in toolbar
- QCO branding throughout
- Pagination on ALL list endpoints (default 50/page)
- Parameterised queries ONLY — no SQL injection ever
- JWT auth on all protected routes
- Full audit_log on ALL changes (who/what/when/before/after)
- DeleteConfirmModal (reason dropdown + checkbox) for all deletes
- SimpleConfirmModal for deactivations
- Specific error messages — NEVER "Save failed"
- Duplicate check before creating records
- Never expose password hashes
- MySQL connection pooling ONLY — never createConnection
- Input validation on all endpoints
- Priority order: Stability → Security → Scalability → Auditability

---

## ALWAYS DO AT START OF EVERY SESSION

1. Print this CLAUDE_CONTEXT.md file
2. Read public/QMAT-prototype.html before building any new screen
3. Verify app is running in Chrome (localhost:5174)
4. Check git log to confirm last commit
5. Check this spec before building ANY screen — if something seems wrong, ask

---

## PENDING ITEMS (as of 30 May 2026)
> ⚠ HISTORICAL — ALL RESOLVED. Every bug and "next build" below is done: the SQL
> group-function bug (now WHERE-style CASE), the ROS hint text (field corrected;
> one stale help line remains, tracked in HANDOVER), the commodity/tag autocomplete
> column (`/procurement/:pid/items/search`), the PO upload template redesign, and
> BUG-08/BUG-09 (`9391bca`). PO Detail (Phase 3) and Foundational are built. Kept
> for history; see HANDOVER_NEXT_SESSION.md for real current open items.

### Bugs to fix:
1. **Fix 2 SQL bug:** Clicking Breached/At Risk summary cards returns "Invalid use of group function". The rag filter query uses aggregate functions where WHERE is needed. Fix: `rag=red` → WHERE cdd < CURDATE() AND status NOT IN ('complete','cancelled'); `rag=amber` → WHERE cdd BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL threshold DAY) AND status NOT IN ('complete','cancelled'). Pure WHERE conditions, no HAVING.
2. **New PO Wizard Step 1 — ROS hint text wrong:** Change hint from "Can be added later — required before expediting begins" to "Optional — ROS can be entered later in Expediting". Remove any hard validation blocking PO creation without ROS.
3. **New PO Wizard Step 2 — Missing commodity/tag column:** Add Commodity Code / Equipment Tag autocomplete column to line items table. Searches Commodity Library + Equipment List. Optional field — blank lines flagged "not linked" in Expediting.
4. **PO Upload Template:** Needs complete redesign — must include both header section AND line items section with Commodity Code / Equipment Tag column.

### Next builds in order:
1. Fix the SQL bug above
2. PO Detail Screen (Phase 3) — full tabbed screen at /project/:projectId/procurement/:poId
3. Redesign PO Upload Template (must include line items section — see spec above)
4. Add Foundational to left nav (currently missing)
5. Build Foundational module (WBS → Commodity Library → Equipment List)

