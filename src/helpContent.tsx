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
// ─── Work Breakdown Structure (WBS) ─────────────────────────
// Updated per User Manual v1.0 to match documented behaviour.
export const WBS_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The <strong>WBS</strong> is the backbone of the entire project. Every PO, MTO line, and equipment item is linked to a WBS code. The tree can go up to 12 levels deep.</>)}
      {Tip('Think of WBS like a folder tree — top-level nodes are major work areas, and deeper nodes are specific work packages.')}
    </>,
  },
  {
    title: 'RAG colours',
    content: <>
      {P(<>Each node shows a coloured dot:</>)}
      <RAGTable />
      {P(<>The RAG status reflects the worst RAG status of all POs linked to that node.</>)}
    </>,
  },
  {
    title: 'Focus mode',
    content: <>
      {P(<>Click any node to enter <strong>Focus Mode</strong> — the tree zooms to show only that node and its children. Click <strong>← Back</strong> to exit.</>)}
      {Tip('Focus mode is useful for large trees. All interactions (expand, add node, notes) work normally in focus mode.')}
    </>,
  },
  {
    title: 'Materials Status',
    content: <>
      {P(<>Switch to <strong>Materials Status</strong> view to see procurement progress per node: how many lines have POs raised, in expediting, and delivered.</>)}
    </>,
  },
  {
    title: 'Bulk operations',
    content: <>
      {P(<>Select multiple nodes with the checkboxes to reassign owner, update status, or export.</>)}
    </>,
  },
  {
    title: 'Reading the tree',
    content: <>
      {P(<><strong>Indentation</strong> — Each depth level is indented. The more dots in the code, the deeper the node (e.g. {Code('01.01.01')} is 3 levels deep).</>)}
      {P(<><strong>▸ / ▾</strong> — Parent nodes show a chevron. Click to expand or collapse.</>)}
      {P(<><strong>ROS date</strong> — Required On Site date, colour-coded by RAG status.</>)}
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
    title: 'Uploading WBS from file',
    content: <>
      {Steps([
        <>Click <strong>↓ Template</strong> to download the XLSX template.</>,
        <>Fill in the columns: {Code('code')}, {Code('description')}, {Code('parent_string')}, {Code('ros')}. Parents must appear before their children.</>,
        <>Click <strong>↑ Upload XER/Excel</strong> and select your file.</>,
        <>The validation preview shows ✅ / ⚠️ / ❌ per row. Fix any ❌ errors and re-upload.</>,
        <>Click <strong>↑ Import</strong> to confirm.</>
      ])}
    </>,
  },
  {
    title: 'Gantt view',
    content: <>
      {P(<>Switch between <strong>Tree</strong> and <strong>📊 Gantt</strong> views using the toggle buttons in the WBS toolbar.</>)}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li><span style={{ color: '#85B7EB', fontWeight: 600 }}>Blue bar</span> — Planned baseline (never changes)</li>
        <li><span style={{ color: '#EF9F27', fontWeight: 600 }}>Amber bar</span> — Forecast current estimate</li>
        <li><span style={{ color: '#97C459', fontWeight: 600 }}>Green bar</span> — Actual dates achieved</li>
      </ul>
      {P(<>The <strong style={{ color: '#E84E0F' }}>orange vertical line</strong> is today's date. The <strong style={{ color: '#E84E0F' }}>orange diamond ◆</strong> marks the ROS milestone.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// COMMODITY LIBRARY HELP
// ═══════════════════════════════════════════════════════════════
export const COMMODITY_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The <strong>Commodity Library</strong> is the catalogue of all standard material types used on this project. Every MTO line and PO line is linked to a commodity code.</>)}
      {P(<>Commodities feed into MTO lines, PO line items, and the Expediting module.</>)}
    </>,
  },
  {
    title: 'Trace levels',
    content: <>
      {P(<>The <strong>Trace Level</strong> column shows what traceability is required:</>)}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li><strong>none</strong> — no tracking needed</li>
        <li><strong>lot</strong> — lot number required</li>
        <li><strong>heat_number</strong> — individual heat numbers required (structural steel, pipe)</li>
        <li><strong>drum_number</strong> — drum/reel number required (cable)</li>
        <li><strong>serial_number</strong> — unique serial per item</li>
      </ul>
    </>,
  },
  {
    title: 'Adding commodities',
    content: <>
      {P(<>Click <strong>+ Add commodity</strong> to manually add a new commodity. Fill in the code, name, UOM, WBS, trace level, and preserve type.</>)}
      {Steps([
        <>Enter the commodity <strong>Code</strong> and <strong>Name</strong> (both required).</>,
        <>Select the <strong>WBS</strong> node (required).</>,
        <>Set <strong>Trace level</strong> and <strong>Preservation</strong> requirements.</>,
        <>Click <strong>✓ Add commodity</strong>.</>,
      ])}
    </>,
  },
  {
    title: 'Template & Upload',
    content: <>
      {P(<>Use <strong>↓ Template</strong> to download the Excel upload template. Fill it in and use <strong>↑ Upload</strong> to bulk-import multiple items.</>)}
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
    title: 'What is this?',
    content: <>
      {P(<>The <strong>Equipment List</strong> tracks all individually tagged equipment items for this project. Each item has a unique tag number (e.g. {Code('P-101')}, {Code('V-301')}) and is linked to a WBS code.</>)}
      {P(<>Equipment tags are unique per project and link to POs, ITP requirements, and the Traceability module.</>)}
    </>,
  },
  {
    title: 'Tabs',
    content: <>
      {P(<>Filter by status using the tabs at the top:</>)}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li><strong>All</strong> — shows everything</li>
        <li><strong>PO raised</strong> — a PO has been created for this item</li>
        <li><strong>RFQ</strong> — request for quote issued</li>
        <li><strong>Not started</strong> — no procurement action yet</li>
      </ul>
    </>,
  },
  {
    title: 'Adding equipment',
    content: <>
      {P(<>Click <strong>+ Add equipment</strong> to manually add a new item. Fill in the tag, description, WBS code, and traceability level.</>)}
      {Steps([
        <>Enter the <strong>Equipment tag</strong> (e.g. {Code('P-101A')}) and <strong>Description</strong>.</>,
        <>Select the <strong>WBS</strong> node and <strong>Equipment type</strong>.</>,
        <>Set <strong>Criticality</strong> (A-Critical / B-Major / C-Standard), <strong>Spec</strong>, and <strong>Trace class</strong>.</>,
        <>Click <strong>✓ Add equipment</strong>.</>,
      ])}
    </>,
  },
  {
    title: 'Template & Upload',
    content: <>
      {P(<>Use <strong>↓ Template</strong> to download the Excel upload template. Fill it in and use <strong>↑ Upload</strong> to bulk-import multiple items.</>)}
    </>,
  },
  {
    title: 'Search & Group',
    content: <>
      {P(<>Use the <strong>search bar</strong> to find items by tag, description, WBS, or vendor. Use <strong>Group by</strong> to group by WBS, vendor, or status.</>)}
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
    title: 'Stat cards',
    content: <>
      {P(<>The eight cards at the top summarise the project:</>)}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li><strong>Total POs</strong> — clears all filters, shows all</li>
        <li><strong>Committed Value</strong> — total value of all POs</li>
        <li><strong>Approved & Locked</strong> — value of locked POs</li>
        <li><strong>Pending Approval</strong> — count of POs awaiting approval</li>
        <li><strong>Ongoing</strong> — active/in-progress POs</li>
        <li><strong>Complete</strong> — completed POs</li>
        <li><strong>Breached</strong> — CDD has passed (red)</li>
        <li><strong>At Risk</strong> — CDD within the at-risk threshold (amber)</li>
      </ul>
      {Tip('An orange border shows which card is active. Click the active card again to clear the filter.')}
    </>,
  },
  {
    title: 'RAG stripe',
    content: <>
      {P(<>The coloured stripe on the left of each row shows RAG status:</>)}
      <RAGTable />
    </>,
  },
  {
    title: 'Opening a PO',
    content: <>
      {P(<>Click a <strong>PO reference link</strong> to open the full PO detail screen.</>)}
    </>,
  },
  {
    title: 'Filtering',
    content: <>
      {P(<>Use the <strong>search bar</strong> for PO ref, name, or vendor. Filter by CDD date range. Use the <strong>Group by</strong> dropdown to group by vendor, WBS, or status.</>)}
      {P(<>Toggle <strong>★ Critical path only</strong> to show only critical path POs.</>)}
    </>,
  },
  {
    title: 'New PO',
    content: <>
      {P(<>Click <strong>+ New PO</strong> to open the 3-step wizard: Header details → Line items → Review & create.</>)}
      {P(<><strong>Step 1:</strong> PO Header — fill in PO Ref, WBS, vendor, currency, incoterms.</>)}
      {P(<><strong>Step 2:</strong> Line items — add lines, optionally link commodity/tag.</>)}
      {P(<><strong>Step 3:</strong> Key dates and review — check totals then click <strong>✓ Create PO</strong>.</>)}
    </>,
  },
  {
    title: 'Approve & Lock',
    content: <>
      {P(<>POs in <strong>Pending Approval</strong> status show an <strong>Approve</strong> button on the right. Click it to open the approval wizard.</>)}
      {Warning('Once locked, a PO cannot be unlocked. Changes after approval require a Variation Request.')}
    </>,
  },
  {
    title: 'Assigning an expeditor',
    content: <>
      {P(<>Click <strong>— Assign</strong> in the Owner/Expeditor column on any row.</>)}
      {Steps([<>Select the expeditor from the dropdown.</>, <>Click <strong>Assign</strong>.</>])}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// PO DETAIL SCREEN HELP
// ═══════════════════════════════════════════════════════════════
export const PO_DETAIL_HELP: HelpSection[] = [
  {
    title: 'Header',
    content: <>
      {P(<>Shows the PO number, status badge (<strong>Active</strong> or <strong>Approved & Locked</strong>), vendor, and total value. The <strong>Approve & Lock PO</strong> button appears here for pending POs.</>)}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li><span style={{ color: '#15803d', fontWeight: 600 }}>Green</span> — Approved & Locked. Changes require a Variation Request.</li>
        <li><span style={{ color: '#b45309', fontWeight: 600 }}>Amber</span> — Pending approval. Click ✎ Edit to amend, or Approve & Lock when ready.</li>
      </ul>
    </>,
  },
  {
    title: 'Line Items tab',
    content: <>
      {P(<>All line items with qty, unit value, total value, WBS, CDD, and ROS. Grand Total appears at the bottom.</>)}
      {P(<>On <strong>pending POs</strong>: click <strong>✎ Edit line items</strong> to add, delete, or change lines. Click <strong>✓ Save</strong>.</>)}
      {P(<>On <strong>approved POs</strong>: read-only. Raise a Variation Request to change line items.</>)}
    </>,
  },
  {
    title: 'Key Dates tab',
    content: <>
      {P(<>All important dates for this PO. Click <strong>"Changed N times"</strong> to see all previous values with reasons.</>)}
      {Warning('Every date change requires a mandatory reason. This creates an auditable history of all date movements.')}
    </>,
  },
  {
    title: 'ITP tab',
    content: <>
      {P(<>Inspection and Test Plan requirements attached to this PO. Items marked <strong>Before delivery</strong> must be completed before a Shipment Control Note can be raised.</>)}
    </>,
  },
  {
    title: 'Documents tab',
    content: <>
      {P(<>Uploaded PO documents. All uploads and downloads are logged. Click <strong>Upload Signed PO</strong> to attach the signed contract document.</>)}
    </>,
  },
  {
    title: 'Action Notes tab',
    content: <>
      {P(<>Log expediting calls, vendor communications, and escalations here. Each note is timestamped and attributed to you.</>)}
    </>,
  },
  {
    title: 'Variations tab',
    content: <>
      {P(<>Change orders and scope variations against the original PO. Click <strong>Raise variation</strong> to request a change. Each variation shows its status: pending, approved, or rejected.</>)}
    </>,
  },
  {
    title: 'Audit Trail tab',
    content: <>
      {P(<>Every change ever made to this PO — who, what, when, and before/after values. Filter by field name, user, or date range to narrow down the history.</>)}
    </>,
  },
  {
    title: 'Approve & Lock',
    content: <>
      {Steps([
        <>Click <strong>🔒 Approve & Lock PO</strong>.</>,
        <>Tick all three acknowledgement checkboxes.</>,
        <>Optionally add a note for the expediting team.</>,
        <>Click <strong>🔒 Approve & lock PO</strong> (enabled only when all boxes are ticked).</>,
      ])}
      {Warning('This cannot be undone. After approval the PO is passed to Expediting. Changes require a Variation Request.')}
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
      {P(<>For guidance on using this module, contact your system administrator or refer to the <a href="http://localhost:3001/docs/QCO_MMS_User_Manual.docx" target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>full user manual</a>.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// MTO REGISTER HELP
// ═══════════════════════════════════════════════════════════════
export const MTO_REGISTER_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The <strong>MTO (Material Take-Off) Register</strong> contains all engineering take-off documents for this project. Each MTO is a versioned list of materials required.</>)}
      {P(<>MTOs progress through revisions as the design matures. Procurement uses the current revision to raise RFQs and Purchase Orders.</>)}
    </>,
  },
  {
    title: 'Superseded MTOs',
    content: <>
      {P(<>Superseded MTOs appear at reduced opacity. They are read-only and kept for audit history.</>)}
    </>,
  },
  {
    title: 'Opening an MTO',
    content: <>
      {P(<>Click <strong>View →</strong> to open the full detail screen with line items, version history, and revision diff.</>)}
    </>,
  },
  {
    title: 'New MTO',
    content: <>
      {P(<>Click <strong>+ New MTO</strong> to create a new register. You will be prompted for the name, reference, owner, and revision letter before adding line items.</>)}
      {Steps([
        <>Step 1: choose <strong>Create manually</strong> or <strong>Upload file</strong>.</>,
        <>Step 2: enter the MTO name, reference (e.g. {Code('MTO-PIL-004')}), revision letter, owner and description.</>,
        <>Step 3 (manual): add at least one line item. Each line needs a description.</>,
        <>Click <strong>Create MTO</strong> to save.</>,
      ])}
    </>,
  },
  {
    title: 'Template & Upload',
    content: <>
      {P(<>Use <strong>↓ Template</strong> to download the upload template. Use <strong>↑ Upload MTO</strong> to submit a new revision from Excel.</>)}
      {Warning('Uploading a new revision does not delete previous revisions — they remain accessible via the Version History tab.')}
    </>,
  },
  {
    title: 'Line status and locking',
    content: <>
      {P(<>Each line has one of three statuses:</>)}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li><strong>Not started</strong> (grey) — no procurement action yet</li>
        <li><strong>RFQ</strong> (blue) — a Request for Quotation has been issued</li>
        <li><strong>PO Raised</strong> (green) — a Purchase Order exists. The line is locked.</li>
      </ul>
      {Warning('Lines with PO Raised status are locked. Only ROS date and VDRL flag can be edited.')}
    </>,
  },
]

// ─── MTO DETAIL HELP ─────────────────────────────────────────
// ─── Updated per User Manual v1.0 with per-tab descriptions. ─
export const MTO_DETAIL_HELP: HelpSection[] = [
  {
    title: 'Line Items tab',
    content: <>
      {P(<>Shows all lines in the current revision. Lines with a lock icon are linked to a locked PO and cannot be edited. Filter by status using the tabs: <strong>All</strong>, <strong>PO Raised</strong>, <strong>RFQ</strong>, <strong>Not started</strong>.</>)}
    </>,
  },
  {
    title: 'Version History tab',
    content: <>
      {P(<>All uploaded revisions in reverse date order. Click any revision to view its lines as they were at that point.</>)}
    </>,
  },
  {
    title: 'Rev Diff tab',
    content: <>
      {P(<>Select two revisions to compare them side by side. <span style={{ color: '#15803d' }}>Green</span> = added, <span style={{ color: '#dc2626' }}>Red</span> = removed, <span style={{ color: '#b45309' }}>Amber</span> = changed.</>)}
      {Steps([
        <>Select the <strong>From</strong> revision (older).</>,
        <>Select the <strong>To</strong> revision (newer).</>,
        <>The table shows Added, Modified, and Deleted lines with before/after values highlighted.</>,
      ])}
    </>,
  },
  {
    title: 'Upload revision',
    content: <>
      {P(<>Click <strong>↑ Upload Rev [letter]</strong> to submit a new revision. Duplicate revision letters are blocked. Conflicts with locked lines are flagged before upload.</>)}
      {Warning('Uploading a new revision does not delete previous revisions. All past revision lines remain accessible via Version History.')}
    </>,
  },
]

// ─── EXPEDITING PO DETAIL HELP ───────────────────────────────
// ─── Updated per User Manual v1.0. ───────────────────────────
export const EXPEDITING_PO_DETAIL_HELP: HelpSection[] = [
  {
    title: 'Line Items & SCNs tab',
    content: <>
      {P(<>Shows all PO lines with total qty, qty assigned to SCNs, and available qty. Existing SCNs for this PO are listed under each line.</>)}
      {Tip('Click the line header to expand / collapse. Add child items using the + Add button.')}
    </>,
  },
  {
    title: 'Milestones tab',
    content: <>
      {P(<>Record completion dates for each milestone step. Every date change requires a mandatory reason.</>)}
      {P(<>Click <strong>Changed N×</strong> to see the full change history for that milestone.</>)}
      {Warning('A forecast date in the past will immediately show as Breached (red).')}
    </>,
  },
  {
    title: 'ITP tab',
    content: <>
      {P(<>Inspection and Test Plan requirements for this PO. Items marked <strong>Before delivery</strong> must be completed before a Shipment Control Note can be raised.</>)}
    </>,
  },
  {
    title: 'VDRL tab',
    content: <>
      {P(<>Required vendor documents for this PO. <span style={{ color: '#dc2626' }}>Red required dates</span> = overdue. Click a document row to update status or upload the document.</>)}
      {P(<>Statuses: <strong>Approved</strong>, <strong>Under review</strong>, <strong>Overdue</strong>, <strong>Not submitted</strong>, <strong>Resubmit</strong>.</>)}
    </>,
  },
  {
    title: 'Action Notes tab',
    content: <>
      {P(<>Log notes specific to this PO. All notes appear in the cross-PO <strong>Action Log</strong> on the main Expediting screen. Each note is timestamped and attributed to you.</>)}
    </>,
  },
  {
    title: 'Audit Trail tab',
    content: <>
      {P(<>Full immutable log of every change to this PO. Filter by <strong>Milestone changes</strong> or <strong>Notes</strong>.</>)}
    </>,
  },
  {
    title: 'Create SCN',
    content: <>
      {P(<>Click <strong>+ Create SCN</strong> in the top right to start the 5-step Shipment Control Note wizard:</>)}
      {Steps([
        <><strong>Select lines</strong> — choose which PO lines are in this shipment.</>,
        <><strong>Shipment details</strong> — transport mode, forwarder, ETD/ETA, incoterms.</>,
        <><strong>Packages</strong> — add package dimensions and weights.</>,
        <><strong>Documents</strong> — attach packing lists, certificates.</>,
        <><strong>Confirm</strong> — review and submit.</>,
      ])}
    </>,
  },
]

// ─── EXPEDITING HELP ─────────────────────────────────────────
// ─── Updated per User Manual v1.0. ───────────────────────────
export const EXPEDITING_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The <strong>Expediting Register</strong> shows all Approved &amp; Locked POs under active expedition. POs appear here automatically once they are locked in Procurement.</>)}
      {Tip('Only locked POs appear here. To lock a PO, approve it in the Procurement module.')}
    </>,
  },
  {
    title: 'Milestone dots',
    content: <>
      {P(<>Each row shows a row of coloured dots — one per milestone:</>)}
      {RAGTable()}
      {P(<>Milestones: <strong>PO Award → FAT / Inspection → Ready for Shipment → ETD / Ship → ROS / ETA</strong>.</>)}
    </>,
  },
  {
    title: 'View → drawer',
    content: <>
      {P(<>Click <strong>View →</strong> to slide open the quick-access drawer on the right. The register stays visible behind it. Use the drawer for quick checks and SCN creation.</>)}
    </>,
  },
  {
    title: 'PO ref link',
    content: <>
      {P(<>Click the <strong>PO reference text</strong> to navigate to the full dedicated PO detail screen with all 6 tabs.</>)}
    </>,
  },
  {
    title: 'Filters',
    content: <>
      {P(<>Use the status filter pills (<strong>On Track</strong> / <strong>At Risk</strong> / <strong>Breached</strong> / <strong>Not Started</strong> / <strong>Complete</strong>), date range, and <strong>Critical only</strong> toggle to narrow the list.</>)}
    </>,
  },
  {
    title: 'Critical path',
    content: <>
      {P(<>Click the <strong>★ star</strong> on any row to flag it as critical path. Filled orange = critical.</>)}
    </>,
  },
  {
    title: 'Forecast dates',
    content: <>
      {P(<>Open a PO detail panel and click a forecast date to update it. A <strong>reason is required</strong> every time a forecast is changed — this creates an audit trail.</>)}
      {Warning('Changing a forecast to a past date will immediately mark the milestone as Breached (red).')}
    </>,
  },
]

// ─── VDRL REGISTER HELP ──────────────────────────────────────
// ─── Help for the VDRL Register tab in ExpeditingScreen. ─────
export const VDRL_REGISTER_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The <strong>VDRL Register</strong> shows all Vendor Document Requirements Lists across the project. One row per PO. Click <strong>View →</strong> to drill into the documents for that PO's package.</>)}
    </>,
  },
  {
    title: 'KPI cards',
    content: <>
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li><strong>Total Packages</strong> — VDRL packages across all POs</li>
        <li><strong>Total Docs</strong> — total document requirements</li>
        <li><strong>Submitted</strong> — docs submitted by vendors</li>
        <li><strong>Overdue</strong> — docs past their required date</li>
        <li><strong>ABF Cleared</strong> — approved by forwarder</li>
      </ul>
    </>,
  },
  {
    title: 'Drill-in view',
    content: <>
      {P(<>After clicking <strong>View →</strong> you see the document list for that PO's package. The context bar shows: PO number (prominent, left) · PO name · Vendor · Package name (right).</>)}
    </>,
  },
  {
    title: 'Back navigation',
    content: <>
      {P(<>Click <strong>← Back to VDRL Register</strong> to return to the PO list.</>)}
    </>,
  },
  {
    title: 'Template & Upload',
    content: <>
      {P(<>Use <strong>↓ Template</strong> to download the VDRL Excel template. Use <strong>↑ Upload VDRL</strong> to bulk-upload document requirements via the 3-step upload modal.</>)}
    </>,
  },
]

// ─── MEETING / RFI REGISTER ──────────────────────────────────
export const RFI_MEETING_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The {B('Meetings & RFIs')} register tracks two record types that share one
        workflow: {B('RFIs')} (Requests For Information) and {B('Meetings')}. Each record can
        be project-level or linked to a specific {B('WBS node')}, {B('PO')} or {B('SCN')}.</>)}
    </>,
  },
  {
    title: 'Workflow',
    content: <>
      {P(<>{B('RFI:')} {Code('draft → open → assigned → answered → closed')}.</>)}
      {P(<>{B('Meeting:')} {Code('scheduled → held → actions_open → closed')}.</>)}
      {P(<>Transitions are enforced — you can only move to a legal next state. {B('Closing')} a
        record requires confirmer (approve) permission.</>)}
    </>,
  },
  {
    title: 'RAG / due colours',
    content: <>
      {P(<>The {B('Due')} pill is computed from the due date:</>)}
      {P(<><span style={{ color: '#ef4444' }}>● Red</span> — overdue (past due and not yet answered/closed).
        {' '}<span style={{ color: '#f59e0b' }}>● Amber</span> — due soon (within the project amber window).
        {' '}<span style={{ color: '#22c55e' }}>● Green</span> — on track or resolved.</>)}
      {Tip('The amber window is the rfi_amber_days system setting (default 3 days), set by an Admin.')}
    </>,
  },
  {
    title: 'Filters',
    content: <>
      {P(<>Filter by {B('type')} (RFI / Meeting), {B('status')}, {B('assignee')}, an {B('overdue')}
        toggle, and free-text {B('search')} (ref / title / link). Sorting and paging are server-side
        across the whole register — not just the current page.</>)}
    </>,
  },
]

// ─── PROJECT DASHBOARD ───────────────────────────────────────
export const DASHBOARD_HELP: HelpSection[] = [
  {
    title: 'Health score',
    content: <>
      {P(<>A single {B('0–100')} score for the project, blended from each area's health using
        configurable per-project {B('weights')}. Bands: {B('Excellent')} 85+, {B('Good')} 70+,
        {B('At risk')} 50+, {B('Critical')} below 50.</>)}
      {P(<>Each area's bar is computed from real records (overdue POs, overdue VDRL, customs holds,
        stock issues, overdue certs) and {B('RAG-coloured')} — green healthy, amber at risk, red critical.</>)}
    </>,
  },
  {
    title: 'Materials pipeline',
    content: <>
      {P(<>The flow of work from demand to issue: {Code('MTO → PO raised → expedited → shipped → received → issued')}.
        Each bar is the count of items at that stage — a narrowing funnel shows healthy throughput.</>)}
    </>,
  },
  {
    title: 'What you can see',
    content: <>
      {P(<>Figures respect your permissions — an area you can't open in its own module is omitted here
        (shown as {Code('—')}), never a misleading zero. The score is blended over the areas you can see.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// FMR REGISTER HELP (Material Control)
// ═══════════════════════════════════════════════════════════════
export const FMR_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The {B('FMR (Field Material Request) Register')} is where site crews request material from the
        warehouse, and where Materials Control approves and issues it. Each FMR can hold {B('multiple line items')}.</>)}
      {P(<>The flow is: {Code('Raised → Approved → Issued / Picked up')}.</>)}
    </>,
  },
  {
    title: 'Active register vs Records',
    content: <>
      {P(<>Tabs split the register by lifecycle:</>)}
      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
        <li>{B('Active register')} — live FMRs still to be approved or picked up.</li>
        <li>{B('Records')} — picked-up FMRs (the Proof-of-Collection archive).</li>
        <li>{B('All')} — everything.</li>
      </ul>
      {P(<>Once issued, an FMR is {B('terminal')} and moves to Records; any shortfall is raised as a new FMR.</>)}
    </>,
  },
  {
    title: 'Approving & packaging',
    content: <>
      {P(<>Click {B('Approve')} on a pending FMR to set approved quantities and capture
        {B(' issuance packaging')} (type, dimensions, weight, dangerous-goods) per package.</>)}
      {Tip('Use the ★ to flag an FMR as critical path so it sorts to the top and is easy to chase.')}
    </>,
  },
  {
    title: 'Issuing & Proof of Collection',
    content: <>
      {P(<>{B('Issue / Pickup')} decrements stock (auto-FIFO, or pick specific heats with {B('⊕ Heats')}) and
        records {B('Proof of Collection')} — who collected, their company, notes, and a signature or photo.</>)}
      {P(<>Open {B('🤝 View / PoC')} on a Records row to see the collection details and signature.</>)}
    </>,
  },
  {
    title: 'Multi-item FMRs & columns',
    content: <>
      {P(<>A {Code('+N more')} badge in the Items column means the FMR has several lines — click it to expand
        them inline. Drag any column edge to resize; {B('↺ Reset columns')} restores the defaults.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// STOCK REGISTER HELP (Material Control)
// ═══════════════════════════════════════════════════════════════
export const STOCK_REGISTER_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The {B('Stock Register')} is the live inventory of everything received into the project's warehouses —
        every line ties back to the receipt and SCN it came from.</>)}
    </>,
  },
  {
    title: 'Condition & holds',
    content: <>
      {P(<>The {B('Condition')} column shows whether stock is good, damaged, or in quarantine. The {B('Hold')}
        column flags items on a traceability hold (e.g. missing cert) — these can't be issued until released.</>)}
      {Warning('Stock on a trace hold is excluded from FMR issuing until the hold is cleared in Traceability.')}
    </>,
  },
  {
    title: 'Searching & columns',
    content: <>
      {P(<>Search by item, WBS, warehouse, vendor or tag. Click a column header to sort; drag the column edge
        to resize and {B('↺ Reset columns')} to restore defaults.</>)}
      {Tip('Contractors see a reduced view — grid/bin location is hidden from external users.')}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// TRANSFERS HELP (Material Control)
// ═══════════════════════════════════════════════════════════════
export const TRANSFERS_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The {B('Warehouse Transfer Register')} tracks material moving between warehouses within the project.</>)}
      {P(<>Lifecycle: {Code('Requested → In transit → Picked up → Delivered → Complete')}.</>)}
    </>,
  },
  {
    title: 'Raising & approving',
    content: <>
      {P(<>Use {B('+ New transfer')} to request a move (from/to warehouse, item, qty). Materials Control
        approves, then the status advances as the goods move and arrive.</>)}
    </>,
  },
  {
    title: 'Detail & columns',
    content: <>
      {P(<>Click {B('View')} for the lifecycle stepper and full detail. Drag column edges to resize and use
        {B(' ↺ Reset columns')} to restore defaults.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// RECEIPTING HELP (Material Control)
// ═══════════════════════════════════════════════════════════════
export const RECEIPTING_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>{B('Receipting')} is where arriving shipments (SCNs) and inbound transfers are received into stock.
        Completing a receipt creates {B('warehouse stock')} and stamps the arrival.</>)}
    </>,
  },
  {
    title: 'The queue',
    content: <>
      {P(<>Tabs filter what's receivable: {B('Arrived')}, {B('In transit')}, {B('Customs')}, plus {B('Shipments')}
        and {B('Transfers')}. Search by ref, item, vendor, PO or WBS.</>)}
    </>,
  },
  {
    title: 'Receiving a shipment',
    content: <>
      {Steps([
        <>Click {B('Receive')} (or {B('Begin inspection')}) on a queued SCN.</>,
        <>Confirm the expected contents, then enter received and damaged quantities per line.</>,
        <>On {B('Assign bins')}, place each line into a warehouse bin (see below), set the cargo condition, then complete.</>,
      ])}
      {P(<>Completing the receipt sets the SCN to {B('Delivered')} in Logistics — a shipment is delivered once
        receipted, never "partially delivered". Any outstanding PO balance arrives on a new SCN.</>)}
    </>,
  },
  {
    title: 'Assigning bins (one or many locations)',
    content: <>
      {P(<>On the {B('Assign bins')} step, every received line gets a warehouse bin. Set a {B('Default bin')} for
        the whole receipt, then override individual lines as needed.</>)}
      {P(<>Tick several lines and use {B('Assign to bin')} to send them all to the same location at once, or use
        {B(' ⊕ Split across bins')} on a line to send {B('portions')} of it to different bins (the portion
        quantities must add up to the line's quantity). Anything left blank lands in the default bin.</>)}
      {P(<>Each line/portion becomes its own warehouse-stock row, with its heat number and bin preserved for traceability.</>)}
    </>,
  },
  {
    title: 'Heat numbers & split across heats',
    content: <>
      {P(<>One line can arrive against several heat/lot certificates. On the {B('Physical check')} step use
        {B(' ⊕ Split across heats')} to break the line into allocations — e.g. 100 pipes as 5 × 20, each tied to
        its own heat number. The allocation quantities must add up to the line total.</>)}
      {P(<>Those same allocations carry through to the {B('Assign bins')} step, where you give each its bin — so a
        line can be split by heat and by location together.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// LOGISTICS HELP
// ═══════════════════════════════════════════════════════════════
export const LOGISTICS_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The {B('Logistics / SCN Register')} tracks every shipment (Shipment Control Note) from pickup to
        delivery, with packages, documents, and a status timeline.</>)}
      {P(<>Display statuses: {Code('Pending pickup → In transit → Customs review → Pending delivery → Delivered')}.</>)}
    </>,
  },
  {
    title: 'RAG & critical path',
    content: <>
      {RAGTable()}
      {Tip('The ★ marks a critical-path shipment so it sorts to the top and is easy to watch.')}
    </>,
  },
  {
    title: 'Status & delivery',
    content: <>
      {P(<>You can advance an SCN's status manually, but it flips to {B('Delivered')} automatically when the
        shipment is {B('receipted')} in Materials Control.</>)}
    </>,
  },
  {
    title: 'Customs review & clearance',
    content: <>
      {P(<>When an in-transit shipment reaches the destination, advancing it moves to {B('Customs review')} and
        stamps the {B('actual arrival date (ATA)')} — every arriving shipment passes through customs review.</>)}
      {P(<>To leave customs review you must tick {B('Customs cleared')}; a shipment {B('cannot be marked delivered')}
        until customs is cleared. This keeps a shipment visibly held in {B('Customs review')} if it's stuck,
        and records who cleared it and when (shown in the Overview).</>)}
    </>,
  },
  {
    title: 'Detail — packages & docs',
    content: <>
      {P(<>Click a row to open the SCN detail, which has four tabs: {B('Overview')}, {B('Packages')}
        (dimensions, weight, DG), {B('Documents')} (packing list, BoL, certs), and {B('Timeline')}
        (status + date-change history).</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// TRACEABILITY HELP
// ═══════════════════════════════════════════════════════════════
export const TRACEABILITY_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The {B('Traceability')} module links every material back to its certificates and heat numbers, and
        manages {B('quality holds')} on items with missing or failed documentation.</>)}
    </>,
  },
  {
    title: 'VDRL & certificates',
    content: <>
      {P(<>The {B('VDRL')} tab tracks required vendor documents (MTCs, test reports) per PO/tag with due dates
        and status. The {B('Certificates')} tab is the QA verification queue for incoming certs.</>)}
    </>,
  },
  {
    title: 'Holds',
    content: <>
      {P(<>An item on a {B('hold')} (e.g. missing MTC, heat mismatch) is quarantined from issuing until QA
        releases it. Holds carry an age and chase count so overdue ones stand out.</>)}
      {Warning('Stock under an active trace hold cannot be issued on an FMR until the hold is released.')}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// DOCUMENT INBOX HELP
// ═══════════════════════════════════════════════════════════════
export const DOCUMENT_INBOX_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>The {B('Document Inbox')} is a single, searchable feed of every document across the project —
        certificates, packing lists, PoDs, MTO uploads and more — pulled from each module.</>)}
    </>,
  },
  {
    title: 'Filtering',
    content: <>
      {P(<>Filter by {B('module')}, {B('status')} (Verified / Available / Under review / Missing) and a
        {B(' date range')}. Search matches filename, source, tag, type and uploader.</>)}
    </>,
  },
  {
    title: 'Columns',
    content: <>
      {P(<>Drag a column edge to resize and use {B('↺ Reset columns')} to restore the defaults.</>)}
    </>,
  },
]

// ═══════════════════════════════════════════════════════════════
// PENDING CHANGES HELP (Confirmer queue)
// ═══════════════════════════════════════════════════════════════
export const PENDING_CHANGES_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>{B('Pending Changes')} is the approval queue for staged edits to Foundational and MTO data. Certain
        changes don't apply immediately — they wait here for an authorised approver to confirm or reject.</>)}
    </>,
  },
  {
    title: 'Approving & rejecting',
    content: <>
      {P(<>Each row shows the {B('before → after')} of the proposed change. {B('Approve')} applies it and writes
        an audit record; {B('Reject')} discards it. Changes submitted in a batch can be actioned together.</>)}
      {Tip('Only changes you are authorised to confirm show an action button — others are visible but read-only.')}
    </>,
  },
]

// ─── REPORTS ─────────────────────────────────────────────────
export const REPORTS_HELP: HelpSection[] = [
  {
    title: 'What is this?',
    content: <>
      {P(<>{B('Reports')} turns the project's live data into shareable summaries. Pick a {B('curated report')}
        from the library on the left, or {B('build your own')} ad-hoc report over any dataset.</>)}
      {P(<>Reports are grouped into four areas: {B('Procurement & Expediting')}, {B('Materials & Logistics')},
        {B('Quality & Traceability')} and {B('Project Health')}.</>)}
    </>,
  },
  {
    title: 'Ad-hoc reports',
    content: <>
      {Steps([
        <>Choose a dataset under {B('Build your own')}.</>,
        <>Toggle the {B('columns')} you want, add {B('filters')} (field · operator · value), and optionally
          {B(' summarise')} by grouping on a field with a row count and an optional sum.</>,
        <>Press {B('Run')}.</>,
      ])}
    </>,
  },
  {
    title: 'Saved views & export',
    content: <>
      {P(<>Save an ad-hoc report as a {B('★ saved view')} to re-run it later (saved per user). Export any
        result as {B('CSV')}, {B('Excel')} or {B('PDF')} (PDF opens a print-ready view → Save as PDF).</>)}
      {P(<>Drag a column edge to resize and use {B('↺ Reset columns')} to restore defaults.</>)}
      {Tip('You only ever see reports for data your role can access — the catalogue is filtered to your permissions.')}
    </>,
  },
]
