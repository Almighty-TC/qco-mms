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

module.exports = {
  pick, poListRow, poDetail, itp, variations, documents,
  KEYS: Object.freeze({ PO_LIST_ROW, PO_DETAIL, PO_LINE, SIGNED_DOC, ITP_REQUIREMENT, ITP_ITEM, VARIATION, DOCUMENT }),
}
