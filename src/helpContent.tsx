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
