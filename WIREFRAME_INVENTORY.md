# QCO MMS — Wireframe Inventory & Master Build Checklist

> Source: `public/QMAT-prototype.html`
> Rule: Read and extract the relevant section from the wireframe BEFORE building any module.

---

## Global Architecture

- Layout: Fixed left sidebar (224px dark navy) + scrollable main content
- Font: IBM Plex Sans (UI) · JetBrains Mono (data values)
- Colors: Light bg (#faf9f5), navy sidebar (#0f172a), orange brand (#E84E0F), blue primary (#2563eb)

---

## 1. Navigation (Sidebar)

**Always visible:**
- Dashboard (🏠)

**In-project section (project name as heading):**

Foundational group (🏗, expandable):
- WBS
- Commodity Library
- Equipment List

Standalone:
- MTO Register (📋)
- Procurement (🧾)
- VDRL (📑)
- Expediting (🚨, red alert badge)
- Logistics (🚚)

Material Control group (📦, expandable):
- Receipting
- Stock Register
- FMR Register
- Transfers

Standalone:
- Traceability (🔗)
- Document Inbox (📥)
- Audit (🔍)

System section:
- Admin (⚙️) — admin role only

---

## 2. Dashboard — Home

**Stat summary:** Critical Alert Banner (ROS overdue, traceability holds, preservation overdue, customs holds)

**Projects Table columns:** RAG bar · Project · POs · Risk · Breach · Status · arrow

---

## 3. Dashboard — Project View

**Stat cards (4-col):** MTO line items · POs awarded · At risk · Breached

**Health Score card:**
- Large score + band label (Excellent/Good/At risk/Critical: 85+/70+/50+/<50)
- Score bar (red→amber→green gradient)
- Delta vs last week
- Module breakdown bars (Procurement, Expediting, Logistics, Mat. Control, Traceability)
- "View all problems (N) →" + "Configure ⚙" buttons

**Health Config Modal (weight sliders):**
- Procurement / Expediting / Logistics / Mat. Control / Traceability (range sliders, must total 100%)
- Reset defaults + Save buttons

**Health Problems Modal:**
- Filter by module + problem list with severity badges

**WBS Tree:**
- Expandable nodes: RAG dot · WBS code (mono) · label · Delete button

---

## 4. Procurement — PO Register

### List Screen

**Stat cards (4-col):** Total POs · Total committed value (AUD) · Approved & locked (AUD) · Pending approval

**View tabs:** All POs · Approved · Pending approval · ✓ Completed

**Filters:** Search (PO ref/name/vendor/WBS/owner) · Group by (None/Vendor/WBS/Critical path) · ⭐ Critical Path Only toggle

**Table columns:** ⭐ · PO Ref · PO Name · Description · CCY · Value · Incoterms · WBS · ROS · Vendor · Owner · Status

**Buttons:** ↓ Export · + New PO

---

### New PO — 3-step wizard

**Entry modal:** Upload or Enter manually

**Step 1 — Header:**
- PO Reference* (text, mono)
- WBS* (select)
- PO Name* (text)
- Description (textarea)
- Vendor* (text)
- Group/Category (select: Mech/Electrical/Instrumentation/Civil/Piping/Structural)
- Currency* (select: USD/AUD/EUR/GBP/SGD/JPY/CNY)
- PO Value (number)
- Incoterms* (select: CIF/FOB/EXW/DAP/DDP/FCA/CPT/CIP)
- Required on Site (ROS)* (date)
- Owner/Expeditor (select: team members)

**Step 2 — Line Items:**
- Table: # · Description · Qty · UoM · Unit price · Total
- + Add line button · Subtotal (live calc)

**Step 3 — Milestones:**
- 5 rows: PO · FAT · ESD · ETA · ROS (each: label + date)

---

### PO Detail View

**Header:** PO Ref (mono) · PO Name · Description · Edit / Approve & lock / Locked badge

**Meta grid (8 fields, 4-col × 2 rows):** Currency · Total value · Incoterms · Handover point · Owner/Officer · Vendor · ROS date · CDD

**Status banners:** Pending (amber) · Editing (blue) · Approved (green)

**Line Items table:** Line · Description · Qty · UOM · Unit value · WBS · ROS · Total value · CDD · (delete in edit mode)

**Milestones:** `MilestoneTimeline` component

**Module Status:** `ModuleStatusRow` component

**Action Notes:** Note feed + text input + Post button

---

### Approve PO Wizard — 2 steps

**Step 1 — Review:**
- PO summary card + line items preview
- Approval chain (Procurement Officer → Project Manager → Client)
- 3 checkboxes: reviewed all line items / confirm total value / accept and lock
- Chain note textarea
- Cancel · Approve & lock PO →

**Step 2 — Success:** Confirmation banner · "PO passed to Expediting"

---

## 5. Expediting — Register

**Stat cards (5-col):** Total POs · Ongoing · Complete · Breached · At risk

**View tabs:** All POs · Ongoing · Complete

**Filters:**
- Search (PO ref/vendor/material/tag)
- RAG chips: All · Breached · At risk · On track
- Group by: None/Vendor/Material
- ROS date range: From → To
- ⭐ Critical Path Only

**Table columns:** PO Ref (⭐ + mono) · Vendor/Group · Material · Owner · Milestones (compact timeline) · ROS Date · Status (RAG pill) · View button

---

### Expediting PO Detail — Slide-in drawer (620px)

**Header:** PO Ref · Vendor · Owner · Group · RAG pill

**Buttons:** + Create SCN · 📎 Documents

**Milestones:** `MilestoneTimeline compact`

**Line Items:** No. · Description · Tag · Qty · UOM · WBS · ROS · allocation progress bar · SCN chips

---

### Create SCN Wizard — 5 steps

**Step 1 — Select lines:**
- Checkboxes on PO lines + partial qty input
- + Add off-PO items section

**Step 2 — SCN details:**
- Pickup location selector · Edit contact (Name/Email/Phone/Hours)
- CDD (date) · ETD (date) · ETA (date)
- Mode (select: sea/air/road/rail)
- Origin (text) · Destination warehouse (select) · Grid location (text) · Delivery address (text)
- Forwarder (text) · Incoterms (select)

**Step 3 — Packages:**
- Table: Type · Qty · L (m) · W (m) · H (m) · Weight (kg) · ⚠ DG
- Types: Crate/Pallet shrinkwrap/Loose/IBC drum/Drum/Other
- + Add package · DG checkbox triggers extra doc requirement

**Step 4 — Documents:**
- Required docs checklist (7 standard + 2 DG-conditional):
  - Commercial invoice · Packing list · Bill of Lading/Air Waybill · Certificate of Origin · Mill test certs (MTC) · Inspection release note · Insurance certificate
  - ⚠ DG Declaration (IMO/IATA) · ⚠ MSDS (if DG)
- Upload button per row · Status: pending/available

**Step 5 — Confirm:** Summary + Back · Create SCN →

---

## 6. VDRL

### QCO Internal tabs:
Register · Expediting · Review cycle · Transmittals · Vendor contacts · MDR closeout · Alerts

### Supplier portal tabs:
My documents · Upload & submit · Review comments · Transmittals · Expediting notices

---

### Register Tab

**Package header:** PKG ref · Package name · Vendor · PO ref

**KPI cards (5-col):** Total docs · Submitted % · Overdue · ABF cleared · Progress %

**Filters:** Search · Status (All/Approved/Under review/Overdue/Not submitted/Resubmit) · Type (All/Drawing/Datasheet/Procedure/Certificate/Manual/Report) · Discipline (All/Mechanical/Piping/Electrical/Instrumentation/Structural) · ⚙ Columns toggle

**Table columns:** Doc no. · Title · Type · Rev · Required · Promised · Submitted · Status · ABF · Action

**Row highlights:** Overdue = pink bg · Action required = amber bg · New import = green bg

**Buttons:** ⇄ Switch package · + New package · × Remove documents · ↓ Export · + Add document

---

### Add Document Modal
- Doc no.* (text, mono) · Title* · Type* · Discipline* · Initial rev · ABF gate · Required date* · Promised date* · Responsible vendor contact · Critical flag (checkbox) · Notes

### New Package Modal
- Package ID* (mono) · Package name* · PO reference* · Vendor* · Description

### Expediting Tab
- Overdue docs table: Doc no. · Title · Type · Promised · Days late · Last action · Escalation · Notified
- Expediting log (vertical timeline) + Log action button
- Log Action Modal: Action type · Contact · Date · Summary*

### Transmittals Tab
- Table: Transmittal no · Documents · Status · Cover note · Date
- New Transmittal Modal

### Vendor Contacts Tab
- Contact card grid: Name · Role · Email · Phone
- Add/Edit Contact Modal: Name · Email · Phone · Role

### MDR Closeout Tab
- Generate MDR Modal: Format · Scope · Include checkboxes · Activity history

### Alerts Tab
- Active alerts list (severity · doc ref · date)
- Alert rules configuration
- Alert Detail Modal + Respond QCO Modal

### Supplier Portal
- Welcome banner (avatar initials · Name · Company · PKG ref · QCO contact)
- KPIs: Total docs · Action required · Overdue · Progress %
- Upload & Submit tab: Drag-drop zone + doc list with upload buttons
- Upload Documents Modal · Add Comment Modal

---

## 7. Logistics — SCN Register

### List Screen

**Pipeline status strip (clickable):** Pending pickup · In transit · Customs clearance · Pending delivery · Delivered

**View tabs:** All SCNs · Pending pickup · In transit · Customs clearance · Pending delivery · Delivered

**Filters:** Search (SCN ref/PO/vendor/forwarder/origin/dest) · Forecast (pickup/arrival within N days) · ⭐ Critical Path Only

**Table columns:** SCN Ref (⭐ + mono) · PO Ref · Vendor · Origin→Dest · Forwarder · ETD · ETA · Pkgs · Wt · Status · Action

**Button:** ↓ Export

---

### SCN Detail Modal — Full screen, tabbed

**Header:** SCN Ref · PO Ref · Vendor · Forwarder · Mode · Status pill

**Tabs:** Overview · Items packed · Packages · Documents

**Overview:** Pickup card (contact/address/phone/hours/ETA) · Delivery card (warehouse/grid/contact) · Transport (mode/ETD/ETA/forwarder/incoterms) · RAG + notes

**Items Packed:** PO line allocations

**Packages:** Table: Package ID · Type · Items · L · W · H · Weight · ⚠ DG · totals

**Documents:** Type · Required flag · Filename · Status · Date · Size · Uploaded by · Upload button · DG section if applicable

---

### Proof of Custody Screen

- Mode: Vendor pickup or Delivery
- SCN summary card
- Actual packages received (stepper −/+/input)
- Condition buttons: Good · Damaged · Incomplete
- Notes textarea · + Add photos
- Dual signature pads: Vendor release (name/company/sig area) + Forwarder acknowledgement (name/company/sig area)
- Confirm button (enabled when both sigs + condition + qty)

---

## 8. Material Control — Receipting

### Pending Receipt Register

**KPI cards (4-col):** Arrived—ready · In transit/picked up · Customs hold · Total awaiting

**View tabs:** All · Arrived · In transit · Customs · Shipments · Transfers

**Filters:** Search (ref/item/vendor/PO/WBS) · Destination select

**Table columns:** Reference (mono) · Type (Shipment/Transfer badge) · Item/description · Qty · WBS · Source/vendor · ETA · Destination · Status

---

### Receipting Wizard — 5 steps

**Step 1 — Review expected:** Table: Package · Description · Exp. qty · UOM · DG · SCN/PO summary strip

**Step 2 — Physical check:** Per-item actual qty input + condition select + discrepancy checkbox

**Step 3 — Assign location:** Warehouse select · Grid location text (Aisle/Bay/Shelf)

**Step 4 — TCCC sign-off:** Proof of Custody embedded (dual signature pads)

**Step 5 — Complete:** Success confirmation + summary

---

## 9. Material Control — Stock Register

### List Screen

**KPI cards (4-col):** Total items · Warehouses · On trace hold · Condition issues

**Filters:** Search (item/WBS/warehouse/vendor/tag) · Warehouse select · WBS select · Show holds toggle · Group by (Warehouse/WBS/Item)

**Table columns (per group):** Location (Aisle/Bay/Shelf) · Item/Tag (mono) · Description · WBS · Qty (mono) · UOM · Condition · Vendor · Hold flag · Move button · Actions

**Buttons:** 📋 Stock take · ↓ Export

---

### Stock Take Modal
- Count view: per-item counted qty + variance
- Summary view: adjustments before commit
- Commit button

### Reallocate Stock Modal
- Item info · Destination rows (warehouse + location + qty) · + Add destination · Move date · Reason · Cancel/Apply

---

## 10. Material Control — FMR Register

### List Screen

**KPI cards (5-col):** Total FMRs · Pending approval · Partial issued · Issued today · Overdue

**Overdue alert banner** (conditional)

**Pick-up window filter:** All · Overdue · Today · ≤3d · ≤7d · ≤14d · ≤30d · Custom N days

**Status tabs:** All · Pending · Approved · Partial · Issued · Rejected

**Filters:** Search (ref/item/WBS/requester)

**Table columns:** FMR Ref (⭐ + mono) · Item code · Description · WBS · Qty · Issued · Requested by · Req. date · Status · Action

**Role toggle:** MC view | Contractor view (scoped to user's WBS)

---

### Raise FMR Modal
- WBS node (select, contractor-scoped)
- Item (select, linked to WBS, shows on-hand count)
- WBS Qty Overview card (when item selected): Total allocation · Already issued · Remaining · On hand · In transit
- Quantity requested* (number) · Required date* (date)
- Advance warning banner (>14 days: "N days ahead — flagged for review")
- Work order reference (text, mono)

### FMR Approval Panel — Slide-in drawer
- FMR header · Available stock check · WBS allocation breakdown
- Partial issue qty spinner
- Approve · Reject · Issue partial buttons

---

## 11. Material Control — Transfers

### List Screen

**Pipeline status strip:** Requested · In transit · Picked up · Delivered · Complete

**Filters:** Search (ref/item/WBS/location/requester)

**Table columns:** Ref (mono) · Item code · Description · Qty · WBS · From→To · Requested by · Est. pickup · Status · Action

**Button:** + New transfer

**Transfer Detail (inline on row click):**
- Left: Ref · Item · Qty · WBS · From · To · Requested by · Est. pickup
- Right: Lifecycle timeline (Requested → In transit → Picked up → Delivered → Complete)

---

### New Transfer Wizard — 2 steps

**Step 1 — Source & material:**
- Transfer FROM warehouse* (select) · Item code search + select · Location within warehouse · Qty to transfer* (≤ available) · Available qty display

**Step 2 — Destination & schedule:**
- Transfer TO warehouse* (different from source) · Target grid location · Est. pickup date · Required by date · Requestor name · Reason/notes
- Back · Create transfer

---

## 12. MTO Register

### List Screen
**Table columns:** MTO/Reference · Latest Rev · Lines · Last updated · Owner · Open button

**Button:** + New MTO · ↑ Upload MTO (Excel)

### New MTO Modal
- MTO Name* · Reference* (mono) · Initial revision (select: A/B/C/0/1) · Owner select

---

## 13. MTO Detail

**Tabs:** Line items · Version history · Rev diff · Variation flags

### Line Items tab
**Columns:** Line (mono) · WBS · Description · Qty · UOM · ROS · Insp. flag · Linked PO pill · Edit/Delete buttons

**Modals:** MTOLineEditModal · MTOLineDeleteConfirm · MTOLineBlockedDialog ("linked to PO" block)

### Version History tab
**Columns:** Line · WBS · Description · Change

### Rev Diff tab
**Columns:** Line · WBS · Description · PO Ref · Change · Status

### Variation Flags tab
- Flagged lines with variation notes

---

## 14. Foundational — WBS

**Tree:** Expandable nodes: toggle ▸/▾ · RAG dot · WBS code (mono) · label · child preview · Delete button

**Add WBS Node Modal:**
- Parent node (select or top-level) · Code suffix* (mono) · Full code preview (computed, read-only) · Node name* · RAG status · Owner/Responsible · Planned start (date) · Planned end (date) · Notes/scope (textarea)

---

## 15. Foundational — Commodity Library

**View tabs:** All · Active · Inactive

**Filters:** Search · Group by (None/WBS/Vendor)

**Table columns (sortable):** Code · Name · UOM · WBS · Trace level · Preserve · Vendor · Status · Edit/Certs buttons

### Add/Edit Commodity Modal
- Code* (uppercase, mono) · WBS* · Name* · UOM* (select: EA/M/M2/M3/KG/T/LT/SET/LOT)
- Est. qty · Trace level* (select: Heat number/Heat+cert/Mill cert/Drum number/Serial/None)
- Preservation (select: None/Dry storage/Climate controlled/Painted-wrapped/N2 purge)
- Preferred vendor · Notes

### Certificates Modal
- Attached certs viewer for a commodity item

---

## 16. Foundational — Equipment List

**View tabs:** All · Active · Inactive

**Filters:** Search · Group by (None/WBS/Vendor)

**Table columns (sortable):** Tag (mono) · Description · Spec · Trace · WBS · Vendor · Status · Edit button

### Add/Edit Equipment Modal
- Tag* (uppercase, mono) · Equipment type* (select: Vessel/Pump/Compressor/Heat exchanger/Tank/Filter/Valve/Motor/Skid/Instrument/Pipe spool/Structural/Cable drum/Panel/Package)
- WBS* · Description* · Area/location · Criticality (select: A—Critical/B—Major/C—Standard)
- PO reference (mono) · Vendor · Weight · Size/dimensions · Notes

---

## 17. Foundational — Approved Vendor List (AVL)

**Table columns:** Code · Supplier · AVL status (Approved/Conditional/Rejected) · Categories · Locations · Contact · Edit/View

---

## 18. Traceability

**KPI cards (4-col):** VDRL received · VDRL pending · VDRL overdue · Active trace holds

**Tabs:** VDRL · Cert approvals · Trace chain · Holds

### VDRL sub-tab
**Filters:** Search + status pills (All/Received/Pending/Overdue)
**Columns:** PO Ref (mono) · Vendor · Tag · Document · Status · Due · Received · View/Upload

### Cert Approvals sub-tab
**Alert banner:** "N certificates awaiting QA verification"
**Table:** File (mono/blue) · Type · Item/scope · Vendor/uploader · Uploaded · Priority (HIGH/Normal) · Review/Verify/Reject buttons
**Cert Review Modal:** PDF preview + verify/reject workflow

### Trace Chain sub-tab
- Tag/serial selector input
- Chain visualization: PO → Mfg → Inspect → SCN → Receipt → Cert (icon + label + date + status per phase)

### Holds sub-tab
**Alert banner:** "N items on traceability hold"
**Table:** Tag (mono/bold) · Item · Hold reason (red) · Location (mono) · Since · Age · Action

---

## 19. Document Inbox

**KPI cards (5-col):** Total documents · Uploaded last 7 days · Under review · Verified · Missing—action required

**Upload drop zone:** Drag-drop, accepts PDF/Excel/Word/DWG/images

**Filters:** Search (filename/source/tag/type/uploader) · Module select · Status select · Date range · Group by · Mine only toggle

**Table columns:** File/Type · Module badge · Source · Uploaded by · Date · Status · View/Jump button

**Row highlights:** Missing = red tint · DG = light red

**Document Classify Modal:** Auto-triggered on upload — classify to module/entity

---

## 20. Audit Trail

**Idle state:** Search input + Enter key support + Recent searches (5 items)

**Results state:** ← New search · Search input · ↓ PDF · ↓ Excel · Result count

**Module filter pills:** All · Foundational · MTO · Procurement · Expediting · Logistics · Mat. Control · Traceability · Admin · System

**Table columns:** Timestamp (date+time UTC+8, mono) · Module (colored badge) · Event (title + detail) · Operator (name/email/role or "QMAT System / Automated")

---

## 21. Admin

**Tabs:** Users & Roles · Suppliers · Warehouses · Units of Measure · Acronyms · Projects

### Users & Roles tab
**Table columns:** Name · Email · Role · Projects · Status · Last login · Edit button

**Add/Edit User Modal:**
- Full name · Email · Role (select 14 roles: System Admin/Project Manager/Procurement Officer/Senior Expeditor/Junior Expeditor/Logistics Officer/Materials Controller/Quality Engineer/Engineer/Subcontractor/Read-only/Client (full)/Client (approval)/Auditor)
- Status · Project access (multi-select listbox)

### Suppliers tab
**Table columns:** Code · Name · AVL badge · Categories · Contact · Phone · Edit button

### Warehouses tab
**Table columns:** Code (mono) · Name · Location · Type · Capacity · Status · Edit button

**Add/Edit Warehouse Modal — sectioned:**

Identity: Code* (uppercase mono) · Name* · Status

Location: Street address · City · State · Postcode · Country · Display location

Capacity & type: Type* (select: Open laydown/Enclosed store/DG rated/Refrigerated/Container yard/Site laydown/Workshop/Hardstand) · Capacity (number) · Unit (m²/m³/pallets/TEU/t) · Lifting capability (select)

Checkboxes: Secured/fenced · Climate controlled · DG rated

Operations: Grid scheme · Default zone · Operating hours · Contact phone · Manager · Notes

### Units of Measure tab
**Table columns:** Code · Name · Dimension · Edit button

### Acronyms tab
**Table columns:** Code · Full name · Edit button
(150+ entries: QMAT/PO/MTO/SCN/FMR/WBS/AVL/VDRL/MDR/MTC/CoC/IRN/ROS/ETD/ETA/RFQ etc.)

### Projects tab
**Table:** Project name · Status · Add Project Modal

---

## 22. Shared Components

| Component | Description |
|-----------|-------------|
| `MilestoneTimeline` | Compact + full modes. Milestones: PO/FAT/ESD/ETA/ROS. Per milestone: label + date + done/active/pending |
| `RAGPill` | Red (Breached) / Amber (At risk) / Green (On track) / Blue (Complete) / Grey (Not started). Size: default/sm |
| `StatCard` | Large value (mono) + label + delta text |
| `ModuleStatusRow` | Horizontal health strip: Foundational/MTO/Procurement/Expediting/Logistics/Mat.Control/Traceability |
| `SortableHeader` | Click toggles asc/desc, shows ↑/↓/↕ |
| `CriticalAlertBanner` | Red/amber pill strip for global alerts |
| `DocBundlePanel` | Slide-in panel of all documents linked to SCN/PO |
| `TruncatedCell` | Overflow ellipsis with full text on title attribute |
| `Breadcrumb` | Clickable path array |
| `ProofOfCustody` | Dual signature pads (vendor + forwarder) + condition + photo |
| `ToastNotification` | Bottom-center, auto-dismiss |
| `AbbreviationTooltip` | Hover on any acronym (150+ term dict) |

---

## 23. Global UI Patterns

| Pattern | Applies to |
|---------|-----------|
| Search bars (debounced real-time) | Every list screen |
| Sortable column headers (↕/↑/↓) | All tables |
| View tabs (All + sub-views) | All list screens |
| Group by (None/Vendor/WBS/etc.) | Procurement, Expediting, Stock, Document Inbox |
| RAG filter chips | Expediting, Logistics, Traceability |
| Status pills/badges | All status indicators |
| KPI stat card strips (4–5 col) | Every screen |
| ↓ Export button | Every list screen |
| Slide-in drawers (620px right) | Expediting PO detail, FMR Approval |
| Full-screen modals | PO detail, SCN detail, VDRL wizards |
| Multi-step wizards | New PO (3), Create SCN (5), New Transfer (2), Receipting (5) |
| Drag-drop upload zones | Document Inbox, VDRL, SCN Documents |
| Inline edit mode (edit/save/cancel) | PO Detail |
| Confirmation dialogs | Delete, Approve PO, Remove critical flag |
| Toast notifications | All write operations |
| Abbreviation tooltips | All acronyms on hover |
| Pipeline status strips | SCN Register (5 stages), Transfer Register (5 stages) |
| ⭐ Critical path toggle | PO/FMR/SCN row star icon |
| Role switcher | VDRL (QCO internal vs. Supplier portal) |
| Forecast filter (within N days) | Logistics SCN Register |
| Pick-up window filter | FMR Register (overdue/today/3/7/14/30d/custom) |
| Date range filter | Expediting (ROS from/to), Document Inbox |
| Dual signature pads | Proof of Custody (Receipting step 4, Logistics) |
| Weighted score sliders | Project health score config |
| Vertical lifecycle timeline | Transfer detail modal |

---

## 24. Module Badge Colors

| Module | Color |
|--------|-------|
| Foundational | Teal #0d9488 |
| MTO | Blue #2563eb |
| Procurement | Blue #2563eb |
| Expediting | Orange #c2410c |
| Logistics | Orange #c2410c |
| Mat. Control | Amber #b45309 |
| Traceability | Slate #475569 |
| Admin / System | Grey |

---

## 25. VDRL Status Values

| Status key | Label | Color |
|------------|-------|-------|
| approved | Approved | Green #0B8A60 |
| overdue | Overdue | Red #C0392B |
| under-review | Under review | Blue #1A6BB5 |
| not-submitted | Not submitted | Grey #5A7184 |
| resubmit | Resubmit | Orange #E8820C |

---

## Build Status

| # | Module | Status |
|---|--------|--------|
| — | Navigation sidebar | ✅ Built |
| — | Login / Auth | ✅ Built |
| — | Admin (Users/Permissions/External/Notifications/Settings) | ✅ Built |
| 1 | Dashboard — Home (project list) | ✅ Built |
| 2 | Dashboard — Project View | ⬜ Not started |
| 3 | Procurement — PO Register | ⬜ Not started |
| 4 | Expediting — Register | ⬜ Not started |
| 5 | VDRL | ⬜ Not started |
| 6 | Logistics — SCN Register | ⬜ Not started |
| 7 | Material Control — Receipting | ⬜ Not started |
| 8 | Material Control — Stock Register | ⬜ Not started |
| 9 | Material Control — FMR Register | ⬜ Not started |
| 10 | Material Control — Transfers | ⬜ Not started |
| 11 | MTO Register | ⬜ Not started |
| 12 | MTO Detail | ⬜ Not started |
| 13 | Foundational — WBS | ⬜ Not started |
| 14 | Foundational — Commodity Library | ⬜ Not started |
| 15 | Foundational — Equipment List | ⬜ Not started |
| 16 | Foundational — AVL | ⬜ Not started |
| 17 | Traceability | ⬜ Not started |
| 18 | Document Inbox | ⬜ Not started |
| 19 | Audit Trail | ⬜ Not started |
