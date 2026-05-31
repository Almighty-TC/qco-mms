# QCO MMS — User Manual

**Version:** 1.0 | **Last updated:** June 2026 | **System:** QCO Material Management System

---

## 1. Getting Started

### 1.1 How to Log In

1. Open your browser and go to the QCO MMS URL provided by your administrator.
2. Enter your **Email address** and **Password**.
3. Click **Sign in**.

> **Note:** If you see a "Change Password" prompt on first login, you must set a new password before accessing the system.

If your password has expired (shown as a banner at the top of the screen), click **Change Password** and follow the prompts.

### 1.2 Navigating the System

**Left sidebar** — The main navigation. Contains all modules grouped by section:
- **MODULES** — Project-specific modules (Foundational, MTO Register, Procurement, etc.). These only appear after you select a project.
- **SYSTEM** — System-wide settings (Admin).

**Top bar** — Always visible. Shows:
- **← Back** button and breadcrumb trail (e.g. `Dashboard › Pilbara Gas Processing Plant › Procurement › PO-2024-001`)
- Current date
- Critical alert count (red badge)
- Dark/light mode toggle (☾/☀)
- Text size controls (**A-** **A** **A+**)
- Reset button (↺) — resets font size, dark mode, and column widths to defaults
- Your name, **Profile**, **Password**, and **Sign out** links

**Breadcrumb trail** — Shows where you are in the system. Click any item to navigate back to that level.

**← Back button** — Returns you to the previous screen.

### 1.3 RAG Status Colours Explained

RAG (Red–Amber–Green) colours are used throughout the system to show status at a glance:

| Colour | Label | Meaning |
|--------|-------|---------|
| 🟢 Green | On track | Ahead of schedule or on schedule |
| 🟡 Amber | At risk | Within the at-risk threshold — needs attention |
| 🔴 Red | Breached | Past the due date or threshold — action required |
| ⚪ Grey | Not started | No activity yet |
| 🔵 Blue | In progress | Actively being worked on |

### 1.4 Dark Mode and Text Size

- Click the **☾** button in the top bar to switch to dark mode. Click **☀** to return to light mode.
- Click **A-**, **A**, or **A+** to change text size. Your preference is saved between sessions.
- Click **↺** to reset all display preferences to defaults.

---

## 2. Dashboard

> **To be completed when the Dashboard module is built.**

The Dashboard will show a project list with health scores, PO counts, and RAG indicators. Clicking a project will drill into its WBS tree, then into individual POs.

---

## 3. Foundational

The Foundational module establishes the core reference data for a project. Everything else in the system (MTOs, POs, Expediting, Logistics) references back to Foundational data.

### 3.1 WBS

**WBS** (Work Breakdown Structure) is the hierarchical breakdown of a project into packages of work. Every PO, MTO line item, and piece of equipment is tagged to a WBS node — this is how the system knows what work a material purchase belongs to.

#### Reading the WBS Tree

The WBS is displayed as an indented tree table with these columns:

| Column | Description |
|--------|-------------|
| **Code** | The WBS code (e.g. `01`, `01.01`, `01.01.01`). More dots = deeper level. |
| **WBS Node** | The name of the work package. |
| **ROS** | Required On Site date — colour-coded by RAG status. |
| **Notes** | Scope notes. Click to open the note editor. |
| *(suffix hint)* | e.g. `01.xx` — shows the code prefix for child nodes. |

**RAG dots** — The coloured dot to the left of each code shows the node's status.

**RAG stripe** — The 4px coloured bar on the far left of each row mirrors the RAG status.

**Indentation** — Each level of depth is indented 20 pixels. A node at `01.01.01` will be indented further right than `01.01`.

#### Expanding and Collapsing Nodes

- **Click any row** with a **▸** chevron to expand it and show its children.
- **Click an expanded row** (showing **▾**) to collapse it.
- Leaf nodes (no children) show a grey **·** dot instead of a chevron.
- **On load**, the first two top-level nodes are expanded by default.

**⊞ Expand all** — Click to expand every node in the tree to show all levels at once.

**⊟ Collapse all** — Click to collapse everything back to top-level nodes only.

#### Focus Mode

Click **⛶ Focus** to enter full-screen focus mode:
- The left sidebar and top bar are hidden.
- The WBS tree fills the entire screen.
- All buttons and interactions continue to work normally.
- Click **✕ Exit focus** (top-right) to return to normal view.

> Focus mode does not persist when you reload the page.

#### Adding a WBS Node

1. Click **+ Add node** (blue button, top-right of WBS screen).
2. **Parent node** — Select a parent from the dropdown, or leave blank to create a top-level node.
3. **Code suffix** — Enter the suffix for this node (e.g. `01`). The full code preview updates automatically (e.g. parent `02` + suffix `01` → full code `02.01`).
4. **Node name** — Enter a descriptive name (required).
5. Optionally set **RAG status**, **ROS date**, **Planned start/end**, and **Notes**.
6. The footer shows **✓ Ready to save · {code}** when all required fields are filled.
7. Click **✓ Add node**. A success toast confirms the node was saved.

> **Note:** WBS codes must be unique within a project. If you try to use a code that already exists, you will see an error.

#### Editing a Node Note

Click the **Notes cell** of any row (shows the note text, or **+ Add note** if empty):

1. The **Edit Node** modal opens, showing the current ROS date, RAG status, and notes.
2. **ROS Date** — Enter or update the Required On Site date.
   - If the date is in the past, an amber warning appears: **⚠ ROS date is in the past**.
   - If left blank, a grey hint appears: *Optional — leave blank if not yet known*.
3. **RAG Status** — Set the current status.
4. **Notes / Scope** — Enter scope description, constraints, or assumptions (required, max 500 characters).
   - The character count is shown below the text area (e.g. `42 / 500`).
   - **Save is disabled** until you enter at least one character in the notes field.
5. Click **✓ Save changes**. A success toast confirms the save.

> **Warning:** Saving changes updates the node immediately. There is no undo — use the **Cancel** button to discard changes.

#### Deleting a WBS Node

Hover over any row and click the **🗑** delete icon (appears on hover, far right).

The **Delete WBS Node wizard** has 3 steps:

**Step 1 — Impact Assessment:**
- Shows 4 metrics: Child nodes, Affected POs, Line items, Code prefix.
- If nothing references this node, a green message confirms it is **safe to delete**.
- If POs or line items reference this node, they are listed below.
- Click **Continue** to proceed.

**Step 2 — Reallocate (only shown if there are affected PO lines):**
- Every PO line item referencing this node must be reassigned to a different WBS node.
- Use the dropdown on each row to select the new WBS node.
- The running count shows how many lines have been re-allocated vs the total.
- **Continue is disabled** until all lines are re-allocated.
- If you assign to a node that already has allocations, a warning shows the existing allocated quantity.

**Step 3 — Confirm:**
- Shows a final red warning and a summary of re-allocations.
- Tick the acknowledgement checkbox: *I understand this deletion is permanent and cannot be undone.*
- Click **🗑 Delete permanently**.

> ⚠️ **This action cannot be undone.** Once deleted, the WBS node and all its children are permanently removed. Make sure you have re-allocated all PO lines before confirming.

#### Uploading WBS from XER/Excel

**Step 1 — Download the template:**
1. Click **↓ Template** to download `WBS_Upload_Template.xlsx`.
2. Open the file in Excel. The **WBS Template** sheet has the correct column headers.
3. Read the **Instructions** sheet for guidance on each column.

**Required columns:**
- `code` — The WBS code (e.g. `01`, `01.01`). Must be unique per project.
- `description` — The node name.
- `parent_string` — The parent node's code. Leave blank for top-level nodes.
- `ros` — Optional Required On Site date in `YYYY-MM-DD` format.

**Step 2 — Fill in the template:**
- List nodes in hierarchical order — parents must appear before their children.
- Maximum 8 levels of nesting.

**Step 3 — Upload:**
1. Click **↑ Upload XER/Excel**.
2. The **Upload WBS File** modal opens.
3. Click **Choose File** and select your completed XLSX or CSV file.
4. The system validates the file automatically and shows a **validation preview table**.

#### Upload Validation

The preview table shows each row with a status indicator:

| Icon | Status | Meaning |
|------|--------|---------|
| ✅ | Valid | Row is ready to import |
| ⚠️ | Warning | Row has a non-blocking issue (e.g. date format) |
| ❌ | Error | Row has a blocking error (e.g. missing code, duplicate) |

**Summary bar** shows: *X rows ready, Y warnings, Z errors.*

- **Errors block import** — fix the errors in your file and re-upload.
- **Warnings allow import** — tick the acknowledgement checkbox and click **↑ Import**.

**Common errors:**
- *Missing WBS code* — The `code` column is blank.
- *Missing description* — The `description` column is blank.
- *Duplicate code* — The same code appears more than once in the file.
- *Parent not yet seen* — A child node appears before its parent in the file. Reorder so parents come first.
- *Circular reference* — A node's parent code is the same as or a child of the node itself.

#### Node Hover Tooltip

Hover over any WBS row and hold for **300ms** to see a rich tooltip showing:
- **WBS code** (mono) and full node name
- **ROS date** (RAG-coloured) and RAG status label
- **Commodities** — all commodity codes linked to this WBS node (code, name, UOM)
- **Equipment** — all equipment tags linked to this WBS node (tag, description)

If no commodities or equipment are linked, the tooltip shows *"No commodities linked"* / *"No equipment linked"*.

Move the cursor off the row to dismiss the tooltip.

> **Note:** The tooltip automatically flips left if it would overflow the right edge of the screen, and flips up if near the bottom of the screen.

---

### 3.2 Commodity Library

> **Full documentation to be completed when the Commodity Library module is fully built.**

The Commodity Library holds all materials used on the project, with trace levels, preservation requirements, and vendor links. It feeds into MTO lines, PO line items, and the Expediting module.

---

### 3.3 Equipment List

> **Full documentation to be completed when the Equipment List module is fully built.**

The Equipment List holds all tagged equipment for the project, with criticality ratings, specifications, and WBS references. It links to POs, ITP requirements, and the Traceability module.

---

## 4. Procurement

### 4.1 PO Register

The **PO Register** shows all Purchase Orders for the selected project. Each row is a PO with its key fields and current status.

#### Reading the Register

**Summary cards** (top of screen):

| Card | What it shows | Click to filter |
|------|--------------|-----------------|
| **Total POs** | All POs in the project | Shows all POs |
| **Ongoing** | Active/pending POs | Filters to active |
| **Complete** | Completed POs | Filters to complete |
| **Breached** | POs past their CDD | Filters to red (breached) |
| **At Risk** | POs within the at-risk threshold | Filters to amber (at risk) |

Click a card to filter the table. An **orange border** shows the active filter. Click the same card again to deselect.

**Tabs:** All POs · Approved · Pending approval · ✓ Completed

**Table columns:**

| Column | Description |
|--------|-------------|
| ★ | Critical path toggle — click to mark/unmark |
| **PO REF** | PO reference number (mono blue — click to open PO Detail) |
| **VENDOR / GROUP** | Supplier name and category |
| **WBS** | WBS code this PO is tagged to |
| **OWNER / EXPEDITOR** | PO owner and assigned expeditor |
| **CDD** | Contract Delivery Date — RAG-coloured |
| **ROS DATE** | Required On Site date — RAG-coloured |
| **STATUS** | Current PO status pill |

**RAG colour legend** at the bottom of the table explains the left-edge stripe colours.

**Left-edge stripe** — The 4px coloured bar on each row shows the overall RAG status of that PO.

#### Searching and Filtering

- **Search bar** — Search by PO reference, description, or vendor name.
- **CDD date range** — Filter by Contract Delivery Date (from/to).
- **★ Critical path only** — Toggle to show only critical path POs.
- **5 of N POs** counter — Shows how many rows match the current filter.

#### Assigning an Expeditor

1. Find the PO row and click **— Assign** in the Owner/Expeditor column.
2. A modal appears — select the expeditor from the dropdown.
3. Click **Assign**. The expeditor name appears in the row.

> **Note:** Expeditor assignment happens here on the register, not inside the PO creation wizard, because expeditors are typically assigned weeks or months after the PO is created.

#### Critical Path

- Click the **★/☆** star icon on any row to toggle critical path status.
- A confirmation modal appears asking for a reason.
- Critical path POs are marked in all downstream modules (Expediting, Logistics, etc.).

#### Side Drawer (Quick View)

Clicking any row (not the PO ref link) opens a **side drawer** with a quick summary:
- PO details, milestones, and documents
- Click the **PO reference link** in the drawer header to open the full **PO Detail Screen**.

---

### 4.2 Creating a New PO

1. Click **+ New PO** (orange button, top-right).
2. Choose **Upload PO document** (auto-extracts fields from PDF/Excel) or **Create manually**.

#### Step 1 — PO Header

Fill in all required fields:

| Field | Notes |
|-------|-------|
| **PO Reference** | Must be unique. Checked on blur — a warning appears if duplicate. |
| **WBS** | Required — links this PO to the project WBS tree. |
| **PO Name** | Short descriptive title. |
| **Vendor** | Select from the Approved Vendor List. |
| **Currency** | USD/AUD/EUR/GBP/SGD/JPY/CNY |
| **Incoterms** | CIF/FOB/EXW/DAP/DDP/FCA/CPT/CIP |
| **ROS Date** | *Optional* — can be entered later in Expediting. |
| **Owner** | The commercial PO owner. |

#### Step 2 — Line Items

- Click **+ Add line** to add a new line item.
- **Commodity Code / Equipment Tag** — Optional autocomplete field. Searching here finds items from both the Commodity Library and Equipment List.
  - Selecting a commodity auto-fills Description, UOM, and trace level.
  - Selecting equipment auto-fills Description and Tag number.
  - If left blank, the line shows as **"not linked"** in Expediting — you can link it later.
- **Total** auto-calculates from Qty × Unit price.
- The line total and grand total update as you type.

#### Step 3 — Milestones & Review

- Enter key dates: PO Award, FAT, ESD, ETA, ROS.
- Review the summary card before submitting.
- The system checks your project's approval thresholds and routes to single or dual approval as required.
- Click **✓ Create PO**.

---

### 4.3 PO Detail Screen

Access by clicking a **PO reference** (blue mono link) in the PO Register table or drawer.

#### Status Banners

- **Green** — "This PO is approved and locked. Passed to Expediting. Any changes require a Variation Request."
- **Amber** — "Pending approval. Click ✎ Edit to amend or Approve & Lock when ready."
- **Blue** — "✎ Editing — totals recalculate from line items on save."

#### Meta Grid (Top Section)

Always visible, regardless of which tab is active:

| Field | Description |
|-------|-------------|
| Currency | PO currency |
| Total Value | Sum of all line item totals |
| Incoterms | Trade term |
| WBS | WBS code for this PO |
| Vendor | Supplier name |
| Owner | Commercial PO owner |
| Expeditor | Assigned expediting contact |
| Group | Category (Mechanical, Electrical, etc.) |
| ROS Date | Required On Site |
| PO Placed | Award date |
| FAT Date | Factory Acceptance Test date |
| Est. Arrival | Estimated arrival date |

#### Tabs

**1. Line Items**
- Lists all PO line items: Line#, Description, Qty, UOM, Unit Value, Total Value, WBS, CDD, ROS, Heat No.
- **Edit mode** (pending POs only): Click **✎ Edit line items** to make changes. Add lines with **+ Add line**. Delete lines with **×**.
- Total row at the bottom shows the grand total.
- Approved POs: read-only. Changes require a Variation Request.

**2. Key Dates**
- Shows each key milestone date with its full change history.
- Every date change requires a **mandatory reason** (dropdown + free text).
- The history log shows: old value → new value, who changed it, when.
- Click **"Changed N times"** to expand the full history.

**3. ITP**
- ITP (Inspection & Test Plan) — lists inspection requirements for this PO.
- Each ITP item shows: item number, description, inspection type, linked line, planned date, forecast date, status, witness required, certificate required.
- Items marked **"Before delivery"** must be completed before a Shipment Control Note can be raised.

**4. Documents**
- Upload and manage documents attached to this PO.
- **Upload Signed PO** — attaches the signed PO document for record-keeping.
- Download or preview any document by clicking the icons on each row.

**5. Action Notes**
- A chronological thread of expeditor work notes.
- Add a note by typing in the text area and clicking **Post**.
- Visible to all authorised users on the project.

**6. Variations**
- Lists all Variation Requests raised against this PO after it was approved and locked.
- Raise a new variation with **Raise variation** button.
- Each variation shows its status (pending/approved/rejected).

**7. Audit Trail**
- Complete change history for this PO.
- Every field change recorded: who, what, when, before value, after value.
- Filter by field, user, or date range.

---

### 4.4 Approving and Locking a PO

Click **🔒 Approve & Lock PO** (green button, top-right on pending POs or in the PO Detail bottom bar).

**Step 1 — Review & Confirm**

Three acknowledgement checkboxes must all be ticked before the button activates:
1. *I have reviewed all N line items, quantities, UOM and unit values.*
2. *I confirm the total PO value of {currency} {amount} is correct.*
3. *I understand that once approved, this PO will be locked — any future changes require a Variation Request.*

Optionally add a **Note to Expediting** (visible to the expediting team).

The warning *"⚠ This action cannot be undone"* is shown to remind you the action is irreversible.

Click **🔒 Approve & lock PO**.

**Step 2 — Success**

A green confirmation screen shows:
- **PO Approved & Locked** ✅
- What happens next: PO is locked read-only, Expediting can begin milestone monitoring, audit log updated.

**After approval:**
- The PO status changes to **Approved & Locked**.
- No further edits are possible without raising a **Variation Request**.
- The PO passes to the Expediting module for milestone monitoring.

**Variation Requests** — If changes are needed after approval, go to the **Variations** tab on the PO Detail Screen and click **Raise variation**. The variation is reviewed and either approved or rejected. Once approved, the change is applied to the PO.

---

## 5. MTO Register

> **To be completed when the MTO Register module is built.**

---

## 6. Expediting

> **Full documentation to be completed when the Expediting module is built.**

### 6.1 Accessing Expediting

Click **Expediting** (🚨) in the left sidebar. Expediting operates only on **Approved & Locked POs** passed from Procurement.

The Expediting sidebar item shows two badges:
- 🔴 **Red number** — count of overdue milestones
- 🟡 **Amber number** — count of overdue vendor documents

### 6.2 View toggle: PO Register and VDRL Register

The Expediting screen has two views, toggled at the top:

**📋 PO Register** — The list of all POs being actively expedited for this project. Shows milestone status, action logs, SCN management, and critical path tracking.

**📑 VDRL Register** — The Vendor Document Requirements List for this project. Shows all vendor document obligations across all active POs, with review cycles, transmittals, and MDR closeout status.

> **Note:** VDRL was previously a standalone sidebar module. It has been integrated into Expediting because vendor document tracking and milestone monitoring are done by the same expeditors, for the same POs. Having them in one place reduces navigation friction.

### 6.3 VDRL Register

The VDRL Register shows all vendor document requirements across the project. It has the following tabs:

- **Register** — All documents, filterable by PO, type, and status
- **Expediting** — Action log for vendor document follow-up
- **Review cycle** — Documents currently under QCO review (Hold, Minor, Major)
- **Transmittals** — Issued transmittals and reply tracking
- **Vendor contacts** — Contact directory for vendors on this project
- **MDR closeout** — Manufacturing Data Record completion tracking
- **Alerts** 🔴 — Overdue documents requiring immediate action

Each document has a status: **Not started** (grey) · **Submitted** (blue) · **Under review** (amber) · **Approved** (green) · **Overdue** (red)

### 6.4 Per-PO VDRL panel

When viewing a specific PO in the Expediting PO Detail Panel, a **📄 VDRL** button in the panel header shows vendor documents for that PO only — without leaving the PO context.

To see documents across all POs, switch to the **VDRL Register** tab view.

---

## 7. VDRL (Legacy reference)

> VDRL has been integrated into **Section 6 — Expediting**. The old /vdrl route automatically redirects to the Expediting module's VDRL Register tab. There is no standalone VDRL module.

---

## 8. Logistics

> **To be completed when the Logistics module is built.**

---

## 9. Material Control

> **To be completed when the Material Control module is built.**

---

## 10. Traceability

> **To be completed when the Traceability module is built.**

---

## 11. Document Inbox

> **To be completed when the Document Inbox module is built.**

---

## 12. Audit

> **To be completed when the Audit module is built.**

---

## 13. Admin

> **To be completed when the Admin module documentation is written.**

The Admin module is accessible to **System Admins** only. It covers user management, supplier/AVL management, warehouse setup, units of measure, INCO terms, acronyms, and system settings.

---

---

## 10. WBS Enhancements (v1.1)

### 10.1 Collapsible Sidebar

The sidebar can be switched between **full** (224 px, labels visible) and **icon-only** (56 px) mode.

- Click the **‹** button in the topbar, or the **‹ Collapse** button at the bottom of the sidebar, to collapse.
- Click **›** to expand.
- The preference is saved to `localStorage` and remembered between sessions.
- When collapsed, each nav item shows a tooltip on hover with its full label.

---

### 10.2 WBS Search and Filter Bar

Above the WBS tree table a filter bar provides three controls:

| Control | Description |
|---------|-------------|
| **Search input** | Live filter by WBS code or node description. Matching rows are highlighted in blue; parent nodes of matched rows stay visible. |
| **RAG filter pills** | `All` · `🟢` · `🟡` · `🔴` · `🔵` · `⚪` — click to show only nodes with that RAG status (plus their parents). |
| **Depth filter** | Dropdown: All levels / Level 1 only / Level 1-2 / Level 1-3 |
| **✕ Clear filters** | Appears only when any filter is active. Resets all three controls at once. |

---

### 10.3 WBS Bulk Operations

When you hover over a WBS row, a **checkbox** becomes visible on the left. Select one or more nodes to activate the **floating bulk-action bar** at the bottom of the screen.

| Action | Description |
|--------|-------------|
| **Change RAG** | Select a new RAG status from the dropdown, then click **Apply RAG** to update all selected nodes at once. |
| **↓ Export selected** | Downloads an XLSX file containing the selected nodes with all date and notes fields. |
| **🗑 Delete safe** | Deletes only nodes that have no children and no PO references. Nodes that have dependants are silently skipped. A toast shows how many were deleted vs. skipped. |
| **✕** | Clears the selection without making any changes. |

The **header checkbox** selects or deselects all nodes currently loaded.

---

### 10.4 WBS Node Dates (Planned / Forecast / Actual)

Each WBS node now supports three pairs of dates in the **Add WBS Node** modal:

| Group | Fields |
|-------|--------|
| **Planned** | Planned Start · Planned End |
| **Forecast** | Forecast Start · Forecast End |
| **Actual** | Actual Start · Actual End |

All date fields are optional. Dates are also visible in the Focus Mode info panel (§ 10.5).

The **ROS Date** (Required On Site) remains a single date as before.

---

### 10.5 Focus Mode Info Panel

When **Focus Mode** is active (click ⛶ Focus in the WBS header), clicking any row opens a **420 px info panel** on the right side of the tree instead of expanding/collapsing the row.

The panel contains:

1. **Header** — WBS code (blue mono), description, RAG pill, ✕ close button.
2. **Key Dates** — Planned Start/End, Forecast Start/End, Actual Start/End, ROS — displayed in a 2-column grid.
3. **Notes** — full notes text.
4. **Commodities** — scrollable list of `code · name · UOM` for all commodities linked to this node.
5. **Equipment** — scrollable list of `tag · description · status pill` for all equipment linked to this node.
6. **Purchase Orders** — list of PO number · vendor · status for POs whose WBS code matches this node.
7. **Footer** — **✎ Edit node** button opens the edit modal for this node.

Click **✕** in the panel header, or click a different row, to close the panel and open a new one.

---

### 10.6 Materials Status Column

A **PO Qty** column is now visible in the WBS tree (normal mode only). It shows the sum of `qty` from all PO line items whose `wbs_code_snapshot` matches this node's code. If no PO lines reference the node, `—` is shown.

This gives a quick at-a-glance view of how much procurement volume has been raised against each work package.

---

### 10.7 Template Downloads

Template XLSX files are available for all three Foundational modules:

| Module | Button | Columns |
|--------|--------|---------|
| WBS | ↓ Template | code, description, parent, ROS, etc. |
| Commodity Library | ↓ Template | Commodity Code, WBS Code, Name, UOM, Qty, Trace Level, Preservation, Vendor, Notes |
| Equipment List | ↓ Template | Equipment Tag, Type, WBS Code, Description, Area, Criticality, PO Reference, Vendor, Weight, Size, Notes |

Each template includes an **Instructions** sheet and 3 example rows.

---

*QCO MMS User Manual — © QCO Group 2026. For support contact your system administrator.*

---

## 13. Admin — Currency and Package Types

### 13.1 Currency

**Admin → Currency tab**

Manage the currencies available for selection when creating Purchase Orders.

**Table columns:** Code · Name · Symbol · Status · Actions

**Adding a currency:**
1. Click **+ Add currency**
2. Enter **Currency Code** (e.g. AUD, USD — auto-uppercased, max 10 chars)
3. Enter **Name** (e.g. Australian Dollar)
4. Enter **Symbol** (e.g. $, €, £)
5. Toggle **Active** to control visibility in PO creation dropdowns
6. Click **✓ Save**

**Editing:** Click **Edit** on any row to update name, symbol or active status. Code cannot be changed after creation.

**Deactivating:** Click **Deactivate** to hide a currency from PO creation dropdowns while keeping historical PO data intact.

**Deleting:** Click **Delete** — blocked with an error if the currency is used on any existing Purchase Order.

### 13.2 Package Types

**Admin → Package Types tab**

Manage the package types available in Shipment Control Notes (SCNs) when defining packages.

Example types: Crate (timber), Pallet, Drum, Bundle, Skid.

**Table columns:** Name · Description · Status · Actions

**Adding a package type:**
1. Click **+ Add package type**
2. Enter **Name** (required, must be unique)
3. Enter **Description** (optional — e.g. "Timber framed crate")
4. Toggle **Active** to control visibility in SCN package selection
5. Click **✓ Save**

**Editing:** Click **Edit** to update name, description or active status.

**Deactivating:** Click **Deactivate** to hide from SCN dropdowns while keeping historical data.

**Deleting:** Click **Delete** — blocked if the type is referenced on any existing SCN item.

---

### 4.5 PO Register — Stat Cards

The 8 summary cards at the top of the PO Register are all clickable filters:

| Card | Meaning | Click action |
|------|---------|--------------|
| **Total POs** | All POs in the project | Shows all POs |
| **Committed Value** | Total value of all non-cancelled POs (AUD) | Shows all |
| **Approved & Locked** | Total value of approved, locked POs (AUD) | Filters to Approved tab |
| **Pending Approval** | Count of unapproved POs | Filters to Pending tab |
| **Ongoing** | Active POs not yet complete | Filters to ongoing |
| **Complete** | Closed POs | Filters to complete |
| **Breached** | POs where CDD is past today | Filters to red (breached) |
| **At Risk** | POs where CDD is within the at-risk threshold | Filters to amber (at risk) |

Values show as **AUD 3,470,000** format — currency code prefix, no decimal places.

An active filter card gets an orange border. Click the active card again to clear the filter.

### 4.6 PO Register — Table Columns

Columns (left to right): ★ Critical path · PO Ref · PO Name · Description · CCY · Value · Incoterms · WBS · ROS · Vendor · Owner · CDD · Status

All columns are resizable by dragging the orange handle on the column border.

### 4.7 PO Detail — Meta Grid

The meta grid (always visible above the tabs) shows:

| Field | Description |
|-------|-------------|
| **Currency** | PO currency code (e.g. AUD, USD) |
| **Total Value** | Total PO value in the PO currency |
| **Incoterms** | Trade term (e.g. EXW, CIF, FOB) |
| **Handover Point** | Location where goods are handed over per the Incoterms (e.g. "BlueScope Steel, Port Kembla") |
| **WBS** | WBS code this PO is linked to |
| **Vendor** | Supplier name |
| **Owner** | Commercial PO owner |
| **Expeditor** | Assigned expeditor |
| **Group** | Category (Mechanical, Electrical, etc.) |
| **ROS Date** | Required On Site date |
| **PO Placed** | PO award date |
| **FAT Date** | Factory Acceptance Test date |
| **Est. Arrival** | Estimated arrival date |
