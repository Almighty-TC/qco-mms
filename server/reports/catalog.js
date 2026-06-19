// ─── REPORTS — CURATED CATALOGUE ─────────────────────────────────────────────
// The fixed library of named reports. Each is just a preset config over a dataset
// (datasets.js) executed by the engine (engine.js) — so curated and ad-hoc reports
// share one code path and one RBAC gate. `config` is exactly the shape runReport()
// takes; the route runs it after re-checking the dataset's source module.
const CATALOG = [
  // ── PROCUREMENT & EXPEDITING ───────────────────────────────────────────────
  {
    id: 'po_status_summary', category: 'procurement',
    name: 'PO status summary', desc: 'Count and total value of POs grouped by status.',
    config: { datasetId: 'po_register', groupBy: ['status'],
      aggregations: [{ fn: 'count', as: 'pos' }, { fn: 'sum', col: 'value', as: 'total_value' }],
      sort: { col: 'pos', dir: 'desc' } },
  },
  {
    id: 'overdue_pos', category: 'procurement',
    name: 'Overdue / breached POs', desc: 'Open POs flagged red (CDD passed) — the expediting priority list.',
    config: { datasetId: 'po_register',
      columns: ['po_number','vendor_name','wbs_code','value','currency','status','cdd','ros_date','expeditor'],
      filters: [{ col: 'rag', op: 'eq', value: 'red' }, { col: 'status', op: 'in', value: ['rfq','loa','po-raised','active'] }],
      sort: { col: 'cdd', dir: 'asc' } },
  },
  {
    id: 'critical_path_pos', category: 'procurement',
    name: 'Critical-path POs', desc: 'Every PO flagged as critical path, with status and dates.',
    config: { datasetId: 'po_register',
      filters: [{ col: 'is_critical_path', op: 'eq', value: 1 }],
      sort: { col: 'cdd', dir: 'asc' } },
  },
  {
    id: 'vendor_spend', category: 'procurement',
    name: 'Vendor spend', desc: 'Number of POs and total committed value per vendor.',
    config: { datasetId: 'po_register', groupBy: ['vendor_name'],
      aggregations: [{ fn: 'count', as: 'pos' }, { fn: 'sum', col: 'value', as: 'total_value' }],
      sort: { col: 'total_value', dir: 'desc' } },
  },
  // ('expediting_actions_due' removed with the phantom-table 'expediting' dataset.)

  // ── MATERIALS & LOGISTICS ──────────────────────────────────────────────────
  {
    id: 'scn_pipeline', category: 'materials',
    name: 'Shipment pipeline', desc: 'SCN count grouped by status — the logistics pipeline at a glance.',
    config: { datasetId: 'scn', groupBy: ['status'],
      aggregations: [{ fn: 'count', as: 'shipments' }, { fn: 'sum', col: 'total_packages', as: 'packages' }],
      sort: { col: 'shipments', dir: 'desc' } },
  },
  {
    id: 'stock_by_warehouse', category: 'materials',
    name: 'Stock by warehouse', desc: 'On-hand and available quantity rolled up per warehouse.',
    config: { datasetId: 'stock', groupBy: ['warehouse'],
      aggregations: [{ fn: 'count', as: 'lines' }, { fn: 'sum', col: 'qty', as: 'qty_on_hand' }, { fn: 'sum', col: 'qty_available', as: 'qty_available' }],
      sort: { col: 'qty_on_hand', dir: 'desc' } },
  },
  {
    id: 'stock_on_hold', category: 'materials',
    name: 'Stock on trace hold', desc: 'Stock lines held pending certification — not yet issuable.',
    config: { datasetId: 'stock',
      filters: [{ col: 'trace_hold', op: 'eq', value: 1 }],
      sort: { col: 'received_date', dir: 'asc' } },
  },
  {
    id: 'open_fmrs', category: 'materials',
    name: 'Open FMRs', desc: 'Field material requests not yet fully issued, by required date.',
    config: { datasetId: 'fmr',
      filters: [{ col: 'status', op: 'ne', value: 'issued' }],
      sort: { col: 'required_date', dir: 'asc' } },
  },
  {
    id: 'transfers_in_progress', category: 'materials',
    name: 'Transfers in progress', desc: 'Inter-warehouse transfers not yet delivered.',
    config: { datasetId: 'transfers',
      filters: [{ col: 'status', op: 'ne', value: 'delivered' }],
      sort: { col: 'est_pickup_date', dir: 'asc' } },
  },

  // ── QUALITY & TRACEABILITY ─────────────────────────────────────────────────
  {
    id: 'cert_status_summary', category: 'quality',
    name: 'Certificate status summary', desc: 'Certificate count grouped by verification status.',
    config: { datasetId: 'certs', groupBy: ['status'],
      aggregations: [{ fn: 'count', as: 'certs' }],
      sort: { col: 'certs', dir: 'desc' } },
  },
  {
    id: 'certs_overdue', category: 'quality',
    name: 'Overdue certificates', desc: 'Required certificates past their due date and not yet received.',
    config: { datasetId: 'certs',
      filters: [{ col: 'is_required', op: 'eq', value: 1 }, { col: 'received_date', op: 'isnull' }],
      sort: { col: 'due_date', dir: 'asc' } },
  },
  {
    id: 'vdrl_progress', category: 'quality',
    name: 'VDRL progress', desc: 'Vendor document count grouped by review status.',
    config: { datasetId: 'vdrl', groupBy: ['status'],
      aggregations: [{ fn: 'count', as: 'documents' }],
      sort: { col: 'documents', dir: 'desc' } },
  },
  {
    id: 'vdrl_overdue', category: 'quality',
    name: 'Overdue vendor documents', desc: 'VDRL documents flagged overdue, by required date.',
    config: { datasetId: 'vdrl',
      filters: [{ col: 'status', op: 'eq', value: 'Overdue' }],
      sort: { col: 'required_date', dir: 'asc' } },
  },

  // ── PROJECT / CROSS-MODULE HEALTH ──────────────────────────────────────────
  {
    id: 'wbs_rag_summary', category: 'health',
    name: 'WBS RAG summary', desc: 'Work-breakdown nodes grouped by RAG status.',
    config: { datasetId: 'wbs', groupBy: ['rag'],
      aggregations: [{ fn: 'count', as: 'nodes' }],
      sort: { col: 'nodes', dir: 'desc' } },
  },
  {
    id: 'po_rag_by_wbs', category: 'health',
    name: 'PO RAG by WBS', desc: 'PO count and value per WBS code, to spot exposure hotspots.',
    config: { datasetId: 'po_register', groupBy: ['wbs_code'],
      aggregations: [{ fn: 'count', as: 'pos' }, { fn: 'sum', col: 'value', as: 'total_value' }],
      sort: { col: 'total_value', dir: 'desc' } },
  },
  {
    id: 'open_rfis', category: 'health',
    name: 'Open RFIs', desc: 'RFIs not yet closed, by priority and due date.',
    config: { datasetId: 'rfi_meeting',
      filters: [{ col: 'record_type', op: 'eq', value: 'rfi' }, { col: 'closed_date', op: 'isnull' }],
      sort: { col: 'due_date', dir: 'asc' } },
  },
  // 'project_health' is a special composite report computed in the route across
  // multiple modules (it checks can_view on each). Listed here for the catalogue.
  {
    id: 'project_health', category: 'health', composite: true,
    name: 'Project health overview', desc: 'Cross-module rollup: PO / shipment / stock / cert / RFI counts and RAG exposure for the whole project.',
  },
]

const byId = Object.fromEntries(CATALOG.map(r => [r.id, r]))

// Public catalogue entries (no internal config detail beyond what the UI needs).
function publicCatalog() {
  return CATALOG.map(r => ({
    id: r.id, category: r.category, name: r.name, desc: r.desc,
    datasetId: r.config?.datasetId || null, composite: !!r.composite,
  }))
}

module.exports = { CATALOG, byId, publicCatalog }
