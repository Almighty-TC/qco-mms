// ─── INLINE HELP CONTENT ─────────────────────────────────────
// Help sections for each screen. Passed as props to HelpButton.
// Add a new export for each new screen — no component changes needed.
import type { HelpSection } from './components/HelpDrawer'

// ─── Shared prose helpers ─────────────────────────────────────
const P = (children: React.ReactNode) => (
  <p style={{ margin: '0 0 10px' }}>{children}</p>
)
const B = (t: string) => <strong>{t}</strong>
const Code = (t: string) => (
  <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, background: 'rgba(37,99,235,0.08)', padding: '1px 5px', borderRadius: 3 }}>{t}</code>
)
const Steps = (items: React.ReactNode[]) => (
  <ol style={{ margin: '0 0 10px', paddingLeft: 18 }}>
    {items.map((it, i) => <li key={i} style={{ marginBottom: 5 }}>{it}</li>)}
  </ol>
)
const Warning = (text: string) => (
  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#dc2626', marginBottom: 10 }}>
    ⚠️ {text}
  </div>
)
const Tip = (text: string) => (
  <div style={{ background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.18)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#1d4ed8', marginBottom: 10 }}>
    💡 {text}
  </div>
)
const RAGTable = () => (
  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
    <thead>
      <tr style={{ background: 'rgba(148,163,184,0.1)' }}>
        <th style={{ textAlign: 'left', padding: '5px 8px' }}>Colour</th>
        <th style={{ textAlign: 'left', padding: '5px 8px' }}>Label</th>
        <th style={{ textAlign: 'left', padding: '5px 8px' }}>Meaning</th>
      </tr>
    </thead>
    <tbody>
      {[['🟢 Green','On track','Ahead of or on schedule'],['🟡 Amber','At risk','Within warning threshold'],['🔴 Red','Breached','Past due date'],['⚪ Grey','Not started','No activity yet'],['🔵 Blue','In progress','Actively underway']].map(([c,l,m],i) => (
        <tr key={i} style={{ borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
          <td style={{ padding: '5px 8px' }}>{c}</td>
          <td style={{ padding: '5px 8px' }}><strong>{l}</strong></td>
          <td style={{ padding: '5px 8px' }}>{m}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

// ═══════════════════════════════════════════════════════════════
// WBS HELP
// ═══════════════════════════════════════════════════════════════
export const WBS_HELP: HelpSection[] = [
  {
    title: 'What is WBS?',
    content: <>
      {P(<>The <strong>Work Breakdown Structure</strong> is the hierarchical breakdown of your project into packages of work. Every PO, MTO line, and piece of equipment is tagged to a WBS node — this is how the system tracks what each material purchase belongs to.</>)}
      {Tip('Think of WBS like a folder tree — top-level nodes are major work areas, and deeper nodes are specific work packages.')}
    </>,
  },
  {
    title: 'Reading the tree',
    content: <>
      {P(<><strong>Indentation</strong> — Each depth level is indented 20px. The more dots in the code, the deeper the node (e.g. {Code('01.01.01')} is 3 levels deep).</>)}
      {P(<><strong>▸ / ▾</strong> — Parent nodes show a chevron. {Code('▸')} = collapsed, {Code('▾')} = expanded. Leaf nodes show {Code('·')}.</>)}
      {P(<><strong>RAG dot</strong> — Coloured dot beside the code shows node status:</>)}
      <RAGTable />
      {P(<><strong>ROS date</strong> — Required On Site date, colour-coded by RAG status.</>)}
      {P(<><strong>Suffix hint</strong> — e.g. {Code('01.xx')} shows the code prefix for child nodes of that parent.</>)}
    </>,
  },
  {
    title: 'Expanding & collapsing',
    content: <>
      {Steps([
        <><strong>Click any parent row</strong> to expand or collapse its children.</>,
        <><strong>⊞ Expand all</strong> — expands every node in the tree at once.</>,
        <><strong>⊟ Collapse all</strong> — collapses everything back to top-level only.</>,
      ])}
      {Tip('On load, the first two top-level nodes are expanded by default.')}
    </>,
  },
  {
    title: 'Focus mode',
    content: <>
      {P(<>Click <strong>⛶ Focus</strong> to enter full-screen mode — the sidebar and top bar are hidden and the WBS tree fills the entire screen.</>)}
      {P(<>Click <strong>✕ Exit focus</strong> (top-right) to return to normal view.</>)}
      {Tip('Focus mode is useful for large trees. All interactions (expand, add node, notes) work normally in focus mode.')}
    </>,
  },
  {
    title: 'Adding a node',
    content: <>
      {Steps([
        <>Click <strong>+ Add node</strong>.</>,
        <>Select a <strong>Parent node</strong> (or leave blank for top-level).</>,
        <>Enter a <strong>Code suffix</strong> — the full code preview updates automatically.</>,
        <>Enter the <strong>Node name</strong> (required).</>,
        <>Optionally set RAG status, ROS date, planned dates, and notes.</>,
        <>Click <strong>✓ Add node</strong>. A toast confirms the save.</>,
      ])}
      {Warning('WBS codes must be unique within a project. A duplicate code will be rejected.')}
    </>,
  },
  {
    title: 'Editing a node note',
    content: <>
      {P(<>Click any <strong>Notes cell</strong> (shows note text, or <em>+ Add note</em> if empty).</>)}
      {Steps([
        <>Update the <strong>ROS Date</strong> if needed. An amber warning shows if the date is in the past.</>,
        <>Set the <strong>RAG Status</strong>.</>,
        <>Enter your <strong>Notes / Scope</strong> (required, max 500 characters).</>,
        <><strong>Save changes</strong> is disabled until the notes field has content.</>,
        <>Click <strong>✓ Save changes</strong>.</>,
      ])}
      {Tip('Character count is shown below the text area as you type.')}
    </>,
  },
  {
    title: 'Deleting a node (3-step wizard)',
    content: <>
      {Warning('Deletion is permanent and cannot be undone.')}
      {P(<>Hover over a row and click the <strong>🗑</strong> icon (appears on hover).</>)}
      {P(<><strong>Step 1 — Impact:</strong> Shows how many children, POs, and line items reference this node. If nothing references it, it is safe to delete immediately.</>)}
      {P(<><strong>Step 2 — Reallocate:</strong> Only shown if PO lines reference this node. Every affected line must be reassigned to a new WBS node before you can continue. If the target node already has allocations, a warning shows the existing quantity.</>)}
      {P(<><strong>Step 3 — Confirm:</strong> Tick the acknowledgement checkbox and click <strong>🗑 Delete permanently</strong>.</>)}
    </>,
  },
  {
    title: 'Uploading WBS from file',
    content: <>
      {Steps([
        <>Click <strong>↓ Template</strong> to download the XLSX template.</>,
        <>Fill in the <strong>WBS Template</strong> sheet: {Code('code')}, {Code('description')}, {Code('parent_string')}, {Code('ros')}.</>,
        <>Parents must appear <em>before</em> their children in the file.</>,
        <>Click <strong>↑ Upload XER/Excel</strong> and select your file.</>,
        <>The validation preview table shows ✅ / ⚠️ / ❌ per row.</>,
        <>Fix any ❌ errors and re-upload. Click <strong>↑ Import</strong> for ✅ or acknowledged ⚠️ rows.</>,
      ])}
      {Tip('See the Instructions sheet in the downloaded template for a description of every column.')}
    </>,
  },
  {
    title: 'Node hover tooltip',
    content: <>
      {P(<>Hover over any WBS row and hold for 300ms to see:</>)}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li>WBS code and full node name</li>
        <li>ROS date (RAG-coloured) and RAG status label</li>
        <li>All commodities linked to this node</li>
        <li>All equipment tagged to this node</li>
      </ul>
      {Tip("The tooltip flips position automatically to avoid overflowing the screen edge.")}
    </>,
  },
  {
    title: 'Gantt view',
    content: <>
      {P(<>Switch between <strong>Tree</strong> and <strong>📊 Gantt</strong> views using the toggle buttons in the WBS toolbar. All other features (search, RAG filter, add node) are unchanged.</>)}
      {P(<><strong>What the bars mean:</strong></>)}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li><span style={{ color: '#85B7EB', fontWeight: 600 }}>Blue bar</span> — <strong>Planned</strong> baseline schedule. Never changes once set.</li>
        <li><span style={{ color: '#EF9F27', fontWeight: 600 }}>Amber bar</span> — <strong>Forecast</strong> current best estimate. Updates as the project progresses. Only shown when different from planned.</li>
        <li><span style={{ color: '#97C459', fontWeight: 600 }}>Green bar</span> — <strong>Actual</strong> dates achieved. Solid end = complete; extends to today = work in progress.</li>
      </ul>
      {P(<>The <strong style={{ color: '#E84E0F' }}>orange diamond ◆</strong> at any date marks the <strong>ROS milestone</strong> (Required On Site).</>)}
      {P(<>The <strong style={{ color: '#E84E0F' }}>orange vertical line</strong> is <strong>today's date</strong>.</>)}
      {P(<><strong>Zoom:</strong> Click <strong>Quarters</strong> for an overview or <strong>Months</strong> for detail. This changes column width.</>)}
      {P(<><strong>Depth:</strong> <strong>L1</strong> shows only top-level nodes, <strong>L1–L2</strong> adds their children, <strong>L1–L3</strong> adds grandchildren. Clicking a parent row in Gantt expands/collapses its children.</>)}
      {Tip('Clicking a bar row in Gantt view opens the note editor for that node — same as clicking Notes in tree view.')}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// COMMODITY LIBRARY HELP
// ═══════════════════════════════════════════════════════════════
export const COMMODITY_HELP: HelpSection[] = [
  {
    title: 'About the Commodity Library',
    content: <>
      {P(<>The Commodity Library holds all materials used on this project, with trace levels, preservation requirements, and preferred vendors.</>)}
      {P(<>Every commodity is linked to a WBS node. Commodities feed into MTO lines, PO line items, and the Expediting module.</>)}
    </>,
  },
  {
    title: 'Searching and filtering',
    content: <>
      {P(<>Use the <strong>search bar</strong> to find commodities by code, name, WBS, or vendor.</>)}
      {P(<><strong>Group by</strong> lets you organise the table by WBS or Vendor.</>)}
      {P(<><strong>Tabs</strong> — All items / Active / Inactive — filter by status.</>)}
    </>,
  },
  {
    title: 'Adding a commodity',
    content: <>
      {Steps([
        <>Click <strong>+ Add commodity</strong>.</>,
        <>Enter the commodity <strong>Code</strong> and <strong>Name</strong> (both required).</>,
        <>Select the <strong>WBS</strong> node (required).</>,
        <>Set <strong>Trace level</strong> (Heat number, Mill cert, etc.) and <strong>Preservation</strong> requirements.</>,
        <>Click <strong>✓ Add commodity</strong>.</>,
      ])}
    </>,
  },
  {
    title: 'Certificates (📎)',
    content: <>
      {P(<>Click the <strong>📎</strong> icon on any commodity row to open the Certificates modal.</>)}
      {P(<>Upload certificates with type, reference number, applies-to scope, and issue date. Certificates can be verified, pending QA, rejected, or expired.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// EQUIPMENT LIST HELP
// ═══════════════════════════════════════════════════════════════
export const EQUIPMENT_HELP: HelpSection[] = [
  {
    title: 'About the Equipment List',
    content: <>
      {P(<>The Equipment List holds all tagged equipment for this project, with criticality ratings, specifications, and WBS references.</>)}
      {P(<>Equipment tags are unique per project and link to POs, ITP requirements, and the Traceability module.</>)}
    </>,
  },
  {
    title: 'Searching and filtering',
    content: <>
      {P(<>Use the <strong>search bar</strong> to find equipment by tag, description, WBS, or vendor.</>)}
      {P(<><strong>Tabs</strong> — All / PO raised / RFQ / Not started — filter by procurement status.</>)}
      {P(<><strong>Group by</strong> — Organise by WBS or Vendor. Items with no vendor show under "Unassigned".</>)}
    </>,
  },
  {
    title: 'Adding equipment',
    content: <>
      {Steps([
        <>Click <strong>+ Add equipment</strong>.</>,
        <>Enter the <strong>Equipment tag</strong> (e.g. {Code('P-101A')}) and <strong>Description</strong>.</>,
        <>Select the <strong>WBS</strong> node and <strong>Equipment type</strong>.</>,
        <>Set <strong>Criticality</strong> (A-Critical / B-Major / C-Standard), <strong>Spec</strong>, and <strong>Trace class</strong>.</>,
        <>Click <strong>✓ Add equipment</strong>.</>,
      ])}
    </>,
  },
  {
    title: 'Certificates (📎)',
    content: <>
      {P(<>Click the <strong>📎</strong> icon on any equipment row to open the Certificates modal — same workflow as Commodity certificates.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// PO REGISTER HELP
// ═══════════════════════════════════════════════════════════════
export const PO_REGISTER_HELP: HelpSection[] = [
  {
    title: 'Reading the register',
    content: <>
      {P(<>The PO Register shows all Purchase Orders for this project. Each row is one PO.</>)}
      {P(<><strong>Left-edge stripe</strong> — Coloured bar shows the overall RAG status of that PO.</>)}
      <RAGTable />
      {P(<><strong>PO REF</strong> — Blue mono link. Click to open the full PO Detail screen.</>)}
      {P(<><strong>★ star</strong> — Critical path toggle. Click to mark/unmark (requires a reason).</>)}
    </>,
  },
  {
    title: 'Summary cards',
    content: <>
      {P(<>The five cards at the top of the screen filter the table when clicked:</>)}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li><strong>Total POs</strong> — clears all filters, shows all</li>
        <li><strong>Ongoing</strong> — active/pending POs</li>
        <li><strong>Complete</strong> — completed POs</li>
        <li><strong>Breached</strong> — CDD past today (red)</li>
        <li><strong>At Risk</strong> — CDD within the at-risk threshold (amber)</li>
      </ul>
      {Tip('An orange border shows which card is active. Click the active card again to clear the filter.')}
    </>,
  },
  {
    title: 'Searching & filtering',
    content: <>
      {P(<>Use the <strong>search bar</strong> to search by PO ref, description, or vendor.</>)}
      {P(<>Use the <strong>CDD date range</strong> pickers to filter by Contract Delivery Date.</>)}
      {P(<>Toggle <strong>★ Critical path only</strong> to show only critical path POs.</>)}
      {P(<>The <strong>N of N POs</strong> counter shows how many rows match the current filter.</>)}
    </>,
  },
  {
    title: 'Side drawer (quick view)',
    content: <>
      {P(<>Click anywhere on a row (not the PO ref link) to open the <strong>side drawer</strong> with a quick summary: PO details, milestones, documents, and owner/expeditor assignment.</>)}
      {P(<>Click the <strong>PO reference link</strong> in the drawer header to open the full PO Detail screen.</>)}
    </>,
  },
  {
    title: 'Assigning an expeditor',
    content: <>
      {P(<>Click <strong>— Assign</strong> in the Owner/Expeditor column on any row.</>)}
      {Steps([<>Select the expeditor from the dropdown.</>, <>Click <strong>Assign</strong>.</>])}
      {Tip('Expeditor assignment is done here — not inside the PO creation wizard — because expeditors are typically assigned weeks or months after the PO is created.')}
    </>,
  },
  {
    title: 'Creating a new PO',
    content: <>
      {P(<>Click <strong>+ New PO</strong>. Choose <strong>Upload PO document</strong> (auto-extracts fields) or <strong>Create manually</strong>.</>)}
      {P(<><strong>Step 1:</strong> PO Header — fill in PO Ref, WBS, vendor, currency, incoterms. ROS date is optional at creation.</>)}
      {P(<><strong>Step 2:</strong> Line items — add lines, optionally link commodity/tag (improves Expediting visibility).</>)}
      {P(<><strong>Step 3:</strong> Key dates and review — check totals, then click <strong>✓ Create PO</strong>.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// PO DETAIL SCREEN HELP
// ═══════════════════════════════════════════════════════════════
export const PO_DETAIL_HELP: HelpSection[] = [
  {
    title: 'Status banners',
    content: <>
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li><span style={{ color: '#15803d', fontWeight: 600 }}>Green</span> — Approved & Locked. No edits possible without a Variation Request.</li>
        <li><span style={{ color: '#b45309', fontWeight: 600 }}>Amber</span> — Pending approval. Click ✎ Edit to amend, or Approve & Lock when ready.</li>
        <li><span style={{ color: '#1d4ed8', fontWeight: 600 }}>Blue</span> — In edit mode. Totals recalculate on save.</li>
      </ul>
    </>,
  },
  {
    title: 'Meta grid (top section)',
    content: <>
      {P(<>The meta grid is always visible regardless of which tab is active. It shows Currency, Total Value, Incoterms, WBS, Vendor, Owner, Expeditor, Group, ROS, PO Placed, FAT Date, and Est. Arrival.</>)}
    </>,
  },
  {
    title: 'Line Items tab',
    content: <>
      {P(<>Lists all PO line items. Columns: Line #, Description, Qty, UOM, Unit Value, Total Value, WBS, CDD, ROS, Heat No.</>)}
      {P(<>On <strong>pending POs</strong>: click <strong>✎ Edit line items</strong> to enter edit mode. Add lines, delete lines, change quantities. Click <strong>✓ Save</strong>.</>)}
      {P(<>On <strong>approved POs</strong>: read-only. Raise a Variation Request to change line items.</>)}
    </>,
  },
  {
    title: 'Key Dates tab',
    content: <>
      {P(<>Shows each key date with its full change history. Click <strong>"Changed N times"</strong> to see all previous values with reasons.</>)}
      {Warning('Every date change requires a mandatory reason. This creates an auditable history of all date movements.')}
    </>,
  },
  {
    title: 'ITP tab',
    content: <>
      {P(<>ITP (Inspection & Test Plan) — lists all inspection requirements for this PO.</>)}
      {P(<>Items marked <strong>Before delivery</strong> must be completed before a Shipment Control Note can be raised for the linked line item.</>)}
    </>,
  },
  {
    title: 'Documents tab',
    content: <>
      {P(<>Upload and download documents attached to this PO. Click <strong>Upload Signed PO</strong> to attach the signed contract document.</>)}
    </>,
  },
  {
    title: 'Action Notes tab',
    content: <>
      {P(<>A chronological thread of expeditor work notes, visible to all authorised users. Type in the text area and click <strong>Post</strong> to add a note.</>)}
    </>,
  },
  {
    title: 'Variations tab',
    content: <>
      {P(<>Lists all Variation Requests raised after PO approval. Click <strong>Raise variation</strong> to request a change.</>)}
      {P(<>Each variation shows its status: pending, approved, or rejected.</>)}
    </>,
  },
  {
    title: 'Audit Trail tab',
    content: <>
      {P(<>Complete change history for this PO. Every field change recorded: who, what field, old value, new value, when.</>)}
      {P(<>Filter by field name, user, or date range to narrow down the history.</>)}
    </>,
  },
  {
    title: 'Approving & locking',
    content: <>
      {Steps([
        <>Click <strong>🔒 Approve & Lock PO</strong>.</>,
        <>Tick all three acknowledgement checkboxes.</>,
        <>Optionally add a note for the expediting team.</>,
        <>Click <strong>🔒 Approve & lock PO</strong> (enabled only when all boxes are ticked).</>,
      ])}
      {Warning('This cannot be undone. After approval, the PO is locked and passed to Expediting. Changes require a Variation Request.')}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// NEW PO WIZARD HELP
// ═══════════════════════════════════════════════════════════════
export const NEW_PO_HELP: HelpSection[] = [
  {
    title: 'Step 1 — PO Header',
    content: <>
      {P(<>Fill in all required fields: PO Reference, WBS, PO Name, Vendor, Currency, Incoterms.</>)}
      {P(<><strong>PO Reference</strong> is checked for duplicates as you type — a warning appears if the same reference already exists.</>)}
      {P(<><strong>ROS Date</strong> is optional at creation — it can be entered or updated later in Expediting.</>)}
    </>,
  },
  {
    title: 'Step 2 — Line Items',
    content: <>
      {P(<>Click <strong>+ Add line</strong> to add a new line item.</>)}
      {P(<>The <strong>Commodity Code / Equipment Tag</strong> field is optional but strongly recommended. Selecting a commodity auto-fills description, UOM, and trace level. Selecting equipment auto-fills the tag and description.</>)}
      {Tip('Lines without a linked commodity or equipment tag are flagged as "not linked" in Expediting — it is easier to link them now than later.')}
      {P(<><strong>Total</strong> auto-calculates from Qty × Unit price.</>)}
    </>,
  },
  {
    title: 'Step 3 — Dates & Review',
    content: <>
      {P(<>Enter key dates: PO Award, FAT, ESD, ETA, ROS. All are optional at creation.</>)}
      {P(<>Review the summary card carefully before clicking <strong>✓ Create PO</strong>.</>)}
      {P(<>The system checks your project's approval thresholds (set in Admin) and routes the PO to single or dual approval as required.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// COMING SOON — for unbuilt modules
// ═══════════════════════════════════════════════════════════════
export const COMING_SOON_HELP: HelpSection[] = [
  {
    title: 'Help coming soon',
    content: <>
      {P(<>This module's help content is being prepared and will be available when the module is fully built.</>)}
      {P(<>For guidance on using this module, contact your system administrator or refer to the <a href="http://localhost:3001/docs/USER_MANUAL.md" target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>full user manual</a>.</>)}
    </>,
  },
]
