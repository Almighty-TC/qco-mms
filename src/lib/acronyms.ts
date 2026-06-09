// ─── ACRONYM REGISTRY (full-text expansions) ────────────────
// Mirrors the `acronyms` admin table. Used for the app-wide rule: every acronym
// shows its full text on hover. Use acronymTitle(text) to get a tooltip string,
// or <Acronym>MTC</Acronym> to render an acronym with the tooltip already wired.
export const ACRONYMS: Record<string, string> = {
  PO: 'Purchase Order', SCN: 'Shipment Control Note', VDRL: 'Vendor Document Requirements List',
  MTO: 'Material Take Off', WBS: 'Work Breakdown Structure', ROS: 'Required on Site',
  FMR: 'Field Material Requisition', AVL: 'Approved Vendor List', ITP: 'Inspection Test Plan',
  MDR: 'Master Document Register', QA: 'Quality Assurance', QC: 'Quality Control',
  FAT: 'Factory Acceptance Test', SAT: 'Site Acceptance Test', NCR: 'Non-Conformance Report',
  RFI: 'Request for Information', BL: 'Bill of Lading', AWB: 'Air Waybill',
  COO: 'Certificate of Origin', MR: 'Material Requisition', CDD: 'Contract Delivery Date',
  ETD: 'Estimated Time of Departure', ETA: 'Estimated Time of Arrival',
  ATD: 'Actual Time of Departure', ATA: 'Actual Time of Arrival', UOM: 'Unit of Measure',
  RAG: 'Red, Amber, Green', MTC: 'Mill Test Certificate', DG: 'Dangerous Goods',
  RFQ: 'Request for Quotation', PKGS: 'Packages', MCC: 'Motor Control Centre',
}

// Returns the full text for a known acronym (case-insensitive, trimmed), else undefined
// — pass straight into a `title=` attribute.
export function acronymTitle(text?: string | null): string | undefined {
  if (!text) return undefined
  return ACRONYMS[text.trim().toUpperCase()]
}
