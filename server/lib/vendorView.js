// ─── VENDOR VIEW (phase 2, P2c) ───────────────────────────────────────────────
// What a vendor sees of its own POs: one frozen allowlist per response and pick(), which
// builds a new object from the allowed keys only (null for a missing key; a row is never
// spread). A column added to a table later therefore never reaches a vendor until it is
// added here. Field lists: TC's answers of 2026-10-15 (3T112) and 2026-10-16 (3T118).
// Internal responses do not use this module.

const PO_LIST_ROW = Object.freeze([
  'id', 'po_number', 'po_name', 'description', 'currency', 'value', 'status', 'statusLabel',
  'ros_date', 'cdd', 'vendor_name', 'supplier_name', 'incoterms', 'handover_point',
  'wbs_code', 'wbs_name', 'group_category',
  'milestone_po_date', 'milestone_fat_date', 'milestone_esd_date', 'milestone_eta_date', 'milestone_ros_date',
  'rag', 'line_count', 'created_at',
])
const PO_DETAIL = Object.freeze([
  ...PO_LIST_ROW.filter(k => !['rag', 'line_count', 'created_at'].includes(k)), 'contract_delivery_date',
])
const PO_LINE = Object.freeze([
  'line_number', 'description', 'tag_number', 'equipment_tag', 'equipment_tag_ref',
  'qty', 'uom', 'uom_code', 'uom_name', 'unit_price', 'total_price',
  'cdd', 'ros_date', 'forecast_ready_date',
  'insp_type', 'cert_required', 'vdrl_required', 'heat_number_required', 'heat_number',
  'status', 'qty_received', 'received_to_date', 'remaining_qty',
])
const SIGNED_DOC = Object.freeze(['id', 'file_name', 'file_size_bytes', 'mime_type', 'version', 'uploaded_at', 'uploaded_by_name'])
const ITP_REQUIREMENT = Object.freeze([
  'id', 'item_number', 'description', 'inspection_type', 'is_mandatory', 'timing',
  'witness_required', 'certificate_required', 'planned_date', 'forecast_date',
  'status', 'completion_date', 'completion_notes',
])
const ITP_ITEM = Object.freeze(['id', 'item_number', 'description', 'status'])
const VARIATION = Object.freeze(['id', 'variation_number', 'value_impact', 'schedule_impact_days', 'status', 'reason', 'approved_at'])
const DOCUMENT = Object.freeze(['id', 'doc_type', 'file_name', 'file_size_bytes', 'mime_type', 'version', 'is_current', 'uploaded_at', 'uploaded_by_name'])
// VDRL (P2d; TC's answers of 2026-10-16, 3T126). Never file_path, notes, created_by, review
// days, transmittal or spec references.
const VDRL_PACKAGE = Object.freeze(['id', 'package_ref', 'name', 'status', 'po_id', 'po_number', 'vendor_name', 'doc_count', 'submitted_count', 'overdue_count', 'created_at'])
const VDRL_DOCUMENT = Object.freeze([
  'id', 'package_id', 'package_name', 'po_number', 'doc_number', 'title', 'doc_type', 'revision', 'status',
  'required_date', 'promised_date', 'submitted_date', 'days_overdue', 'file_name',
  'abf_required', 'abf_cleared', 'tag_number', 'po_line_ref',
])
const VDRL_STATS = Object.freeze(['total_docs', 'submitted_count', 'submitted_pct', 'overdue_count', 'abf_cleared_count', 'progress_pct'])
const VDRL_PO_ROW = Object.freeze(['id', 'po_number', 'po_name', 'vendor_name', 'package_count', 'total_docs', 'submitted_count', 'overdue_count', 'progress_pct'])
// Certificates (P2e; 3T126 and 3T129). verified_by is the verifier's name. Never vendor_name,
// item_scope, priority, file_size, uploaded_by, file_path or notes.
const CERT_ROW = Object.freeze([
  'cert_id', 'po_ref', 'document_name', 'cert_type', 'heat_ref', 'applies_to', 'tag', 'is_required', 'file_name', 'status',
  'issue_date', 'due_date', 'received_date', 'uploaded_date', 'verified_date', 'verified_by', 'reject_reason',
])
const CERT_VERSION = Object.freeze(['id', 'rev', 'heat_ref', 'applies_to', 'file_name', 'status', 'uploaded_date', 'verified_date', 'verified_by'])
const CERT_SUMMARY = Object.freeze(['vdrl_received', 'vdrl_pending', 'vdrl_overdue', 'active_holds'])

// A new object with exactly `keys` (null where the row has no such key).
function pick(row, keys) {
  const out = {}
  for (const k of keys) out[k] = row != null && Object.prototype.hasOwnProperty.call(row, k) ? row[k] : null
  return out
}

const poListRow = row => pick(row, PO_LIST_ROW)

// The PO header, its lines and the current signed PO document; no approvals.
function poDetail(po, lines, signedDoc) {
  return {
    ...pick(po, PO_DETAIL),
    lines: (lines || []).map(l => pick(l, PO_LINE)),
    signedDoc: signedDoc ? pick(signedDoc, SIGNED_DOC) : null,
  }
}

// Soft-deleted requirements are dropped; each requirement keeps its items, projected.
function itp(reqs) {
  return (reqs || []).filter(r => !Number(r.is_deleted)).map(r => ({
    ...pick(r, ITP_REQUIREMENT),
    items: (r.items || []).map(it => pick(it, ITP_ITEM)),
  }))
}

const variations = rows => (rows || []).map(r => pick(r, VARIATION))
const documents = rows => (rows || []).map(r => pick(r, DOCUMENT))
const vdrlPackage = row => pick(row, VDRL_PACKAGE)
const vdrlDocument = row => pick(row, VDRL_DOCUMENT)
const vdrlStats = row => pick(row, VDRL_STATS)
const vdrlPoRow = row => pick(row, VDRL_PO_ROW)
const certRow = row => pick(row, CERT_ROW)
const certVersion = row => pick(row, CERT_VERSION)
const certSummary = row => pick(row, CERT_SUMMARY)

module.exports = {
  pick, poListRow, poDetail, itp, variations, documents, vdrlPackage, vdrlDocument, vdrlStats, vdrlPoRow,
  certRow, certVersion, certSummary,
  KEYS: Object.freeze({ PO_LIST_ROW, PO_DETAIL, PO_LINE, SIGNED_DOC, ITP_REQUIREMENT, ITP_ITEM, VARIATION, DOCUMENT, VDRL_PACKAGE, VDRL_DOCUMENT, VDRL_STATS, VDRL_PO_ROW,
    CERT_ROW, CERT_VERSION, CERT_SUMMARY }),
}
