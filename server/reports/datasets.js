// ─── REPORTS — DATASET REGISTRY ──────────────────────────────────────────────
// The whitelist that makes Reports both useful and injection-safe. Every report —
// curated OR ad-hoc — runs against one of these datasets. A dataset declares:
//   - module:   the RBAC source module the caller MUST have can_view on (the route
//               re-checks this per request, so Reports can never become a read leak).
//   - from:     a project-scoped FROM/JOIN clause ending in `WHERE … project_id = ?`
//               (exactly ONE bound param — the project id — supplied by the engine).
//   - columns:  the ONLY selectable/filterable/groupable columns. Each maps a stable
//               key → { label, sql (a trusted expression, never user input), type }.
//               The engine emits `sql AS key`; user input only ever picks a key.
//   - defaultColumns / filterable: presets for the curated + ad-hoc UIs.
// Nothing here interpolates client input into SQL — see engine.js for enforcement.
const num = 'number', str = 'string', date = 'date', en = 'enum', bool = 'bool'

// ─── SHARED ENUM OPTION LISTS ────────────────────────────────────────────────
const RAG = ['red', 'amber', 'green', 'grey', 'blue']

const DATASETS = {
  // ── PROCUREMENT & EXPEDITING ───────────────────────────────────────────────
  po_register: {
    label: 'Purchase Orders', category: 'procurement', module: 'procurement',
    from: `FROM purchase_orders po
           LEFT JOIN users ow ON ow.id = po.owner_id
           LEFT JOIN users ex ON ex.id = po.expeditor_id
           WHERE po.project_id = ?`,
    columns: {
      po_number:    { label: 'PO Ref',        sql: 'po.po_number',         type: str },
      po_name:      { label: 'PO Name',        sql: 'po.po_name',           type: str },
      vendor_name:  { label: 'Vendor',         sql: 'po.vendor_name',       type: str },
      group_category:{ label: 'Group',         sql: 'po.group_category',    type: en, options: ['mechanical','electrical','instrumentation','civil','piping','structural'] },
      wbs_code:     { label: 'WBS',            sql: 'po.wbs_code',          type: str },
      value:        { label: 'PO Value',       sql: 'po.value',             type: num },
      currency:     { label: 'Currency',       sql: 'po.currency',          type: str },
      status:       { label: 'Status',         sql: 'po.status',            type: en, options: ['rfq','loa','po-raised','active','closed','cancelled','pending_approval','pending_director_approval'] },
      rag:          { label: 'RAG',            sql: 'po.rag',               type: en, options: RAG },
      cdd:          { label: 'CDD',            sql: 'po.contract_delivery_date', type: date },
      ros_date:     { label: 'ROS',            sql: 'po.ros_date',          type: date },
      eta:          { label: 'ETA',            sql: 'po.milestone_eta_date', type: date },
      owner:        { label: 'Owner',          sql: 'ow.full_name',         type: str },
      expeditor:    { label: 'Expeditor',      sql: 'ex.full_name',         type: str },
      is_critical_path: { label: 'Critical path', sql: 'po.is_critical_path', type: bool },
      is_locked:    { label: 'Locked',         sql: 'po.is_locked',         type: bool },
      created_at:   { label: 'Created',         sql: 'po.created_at',        type: date },
    },
    defaultColumns: ['po_number','vendor_name','wbs_code','value','currency','status','rag','cdd','ros_date'],
    filterable:     ['status','rag','group_category','vendor_name','wbs_code','is_critical_path','cdd','ros_date','value','created_at'],
    defaultSort:    { col: 'cdd', dir: 'asc' },
  },

  po_lines: {
    label: 'PO Line Items', category: 'procurement', module: 'procurement',
    from: `FROM po_lines pl
           JOIN purchase_orders po ON po.id = pl.po_id
           WHERE po.project_id = ?`,
    columns: {
      po_number:   { label: 'PO Ref',      sql: 'po.po_number',          type: str },
      line_number: { label: 'Line',        sql: 'pl.line_number',        type: str },
      description: { label: 'Description',  sql: 'pl.description',        type: str },
      tag_number:  { label: 'Tag',         sql: 'pl.tag_number',         type: str },
      wbs_code:    { label: 'WBS',         sql: 'pl.wbs_code_snapshot',  type: str },
      qty:         { label: 'Qty',         sql: 'pl.qty',                type: num },
      qty_received:{ label: 'Received',     sql: 'pl.qty_received',       type: num },
      uom:         { label: 'UOM',         sql: 'pl.uom',                type: str },
      unit_price:  { label: 'Unit price',  sql: 'pl.unit_price',         type: num },
      total_price: { label: 'Total',       sql: 'pl.total_price',        type: num },
      status:      { label: 'Status',      sql: 'pl.status',             type: en, options: ['not-started','rfq','po-raised','in-production','shipped','received','closed'] },
      rag:         { label: 'RAG',         sql: 'pl.rag',                type: en, options: RAG },
      cdd:         { label: 'CDD',         sql: 'pl.cdd',                type: date },
      ros_date:    { label: 'ROS',         sql: 'pl.ros_date',           type: date },
      heat_required:{ label: 'Heat req',   sql: 'pl.heat_number_required', type: bool },
      vdrl_required:{ label: 'VDRL req',   sql: 'pl.vdrl_required',      type: bool },
    },
    defaultColumns: ['po_number','line_number','description','wbs_code','qty','uom','total_price','status','rag'],
    filterable:     ['status','rag','wbs_code','heat_required','vdrl_required','cdd','ros_date'],
    defaultSort:    { col: 'po_number', dir: 'asc' },
  },

  // NOTE: an 'expediting' dataset over `expediting_register` was removed — that table
  // does NOT exist in the live DB (the Expediting module is purchase_orders-based, not
  // register-based), so the dataset queried a phantom table and could never run. A
  // PO+milestone-sourced expediting report can be added later if wanted.

  // ── MATERIALS & LOGISTICS ──────────────────────────────────────────────────
  scn: {
    label: 'Shipments (SCN)', category: 'materials', module: 'logistics',
    from: `FROM shipment_control_notes s WHERE s.project_id = ?`,
    columns: {
      scn_ref:       { label: 'SCN Ref',      sql: 's.scn_ref',         type: str },
      vendor_name:   { label: 'Vendor',       sql: 's.vendor_name',     type: str },
      forwarder_name:{ label: 'Forwarder',    sql: 's.forwarder_name',  type: str },
      origin_location:{ label: 'Origin',      sql: 's.origin_location', type: str },
      mode:          { label: 'Mode',         sql: 's.mode',            type: en, options: ['air','sea','road','rail'] },
      incoterms:     { label: 'Incoterms',    sql: 's.incoterms',       type: str },
      status:        { label: 'Status',       sql: 's.status',          type: en, options: ['draft','pending','in-transit','arrived','received','closed'] },
      rag:           { label: 'RAG',          sql: 's.rag',             type: en, options: ['green','amber','red'] },
      etd:           { label: 'ETD',          sql: 's.etd',             type: date },
      eta:           { label: 'ETA',          sql: 's.eta',             type: date },
      ata:           { label: 'ATA',          sql: 's.ata',             type: date },
      total_packages:{ label: 'Packages',     sql: 's.total_packages',  type: num },
      total_weight_kg:{ label: 'Weight (kg)', sql: 's.total_weight_kg', type: num },
      is_critical_path:{ label: 'Critical',   sql: 's.is_critical_path', type: bool },
    },
    defaultColumns: ['scn_ref','vendor_name','forwarder_name','mode','status','rag','etd','eta'],
    filterable:     ['status','rag','mode','is_critical_path','etd','eta'],
    defaultSort:    { col: 'eta', dir: 'asc' },
  },

  stock: {
    label: 'Stock on Hand', category: 'materials', module: 'material_control',
    from: `FROM warehouse_stock ws
           LEFT JOIN warehouses w ON w.id = ws.warehouse_id
           WHERE ws.project_id = ?`,
    columns: {
      item_code:    { label: 'Item code',  sql: 'ws.item_code',       type: str },
      description:  { label: 'Description', sql: 'ws.description',     type: str },
      wbs_code:     { label: 'WBS',         sql: 'ws.wbs_code',        type: str },
      warehouse:    { label: 'Warehouse',   sql: 'w.name',             type: str },
      qty:          { label: 'Qty',         sql: 'ws.qty',             type: num },
      qty_available:{ label: 'Available',   sql: 'ws.qty_available',   type: num },
      uom:          { label: 'UOM',         sql: 'ws.uom',             type: str },
      condition_status:{ label: 'Condition', sql: 'ws.condition_status', type: str },
      trace_hold:   { label: 'Trace hold',  sql: 'ws.trace_hold',      type: bool },
      heat_number:  { label: 'Heat',        sql: 'ws.heat_number',     type: str },
      vendor_name:  { label: 'Vendor',      sql: 'ws.vendor_name',     type: str },
      received_date:{ label: 'Received',    sql: 'ws.received_date',   type: date },
    },
    defaultColumns: ['item_code','description','wbs_code','warehouse','qty','qty_available','uom','condition_status'],
    filterable:     ['warehouse','wbs_code','condition_status','trace_hold','received_date'],
    defaultSort:    { col: 'item_code', dir: 'asc' },
  },

  fmr: {
    label: 'Field Material Requests', category: 'materials', module: 'fmr',
    from: `FROM fmr_requests f WHERE f.project_id = ?`,
    columns: {
      fmr_ref:      { label: 'FMR Ref',     sql: 'f.fmr_ref',        type: str },
      item_code:    { label: 'Item code',   sql: 'f.item_code',      type: str },
      description:  { label: 'Description',  sql: 'f.description',    type: str },
      wbs_code:     { label: 'WBS',          sql: 'f.wbs_code',       type: str },
      qty_requested:{ label: 'Requested',    sql: 'f.qty_requested',  type: num },
      qty_issued:   { label: 'Issued',       sql: 'f.qty_issued',     type: num },
      uom:          { label: 'UOM',          sql: 'f.uom',            type: str },
      status:       { label: 'Status',       sql: 'f.status',         type: str },
      required_date:{ label: 'Required',     sql: 'f.required_date',  type: date },
      is_critical_path:{ label: 'Critical',  sql: 'f.is_critical_path', type: bool },
      requested_by: { label: 'Requested by', sql: 'f.requested_by_name', type: str },
    },
    defaultColumns: ['fmr_ref','item_code','description','wbs_code','qty_requested','qty_issued','status','required_date'],
    filterable:     ['status','wbs_code','is_critical_path','required_date'],
    defaultSort:    { col: 'required_date', dir: 'asc' },
  },

  transfers: {
    label: 'Warehouse Transfers', category: 'materials', module: 'material_control',
    from: `FROM warehouse_transfers t
           LEFT JOIN warehouses wf ON wf.id = t.from_warehouse_id
           LEFT JOIN warehouses wt ON wt.id = t.to_warehouse_id
           WHERE t.project_id = ?`,
    columns: {
      transfer_ref: { label: 'Transfer Ref', sql: 't.transfer_ref',  type: str },
      item_code:    { label: 'Item code',    sql: 't.item_code',      type: str },
      description:  { label: 'Description',   sql: 't.description',    type: str },
      wbs_code:     { label: 'WBS',           sql: 't.wbs_code',       type: str },
      qty:          { label: 'Qty',           sql: 't.qty',            type: num },
      uom:          { label: 'UOM',           sql: 't.uom',            type: str },
      from_warehouse:{ label: 'From',         sql: 'wf.name',          type: str },
      to_warehouse: { label: 'To',            sql: 'wt.name',          type: str },
      status:       { label: 'Status',        sql: 't.status',         type: str },
      est_pickup_date:{ label: 'Est pickup',  sql: 't.est_pickup_date', type: date },
      delivered_date:{ label: 'Delivered',    sql: 't.delivered_date', type: date },
    },
    defaultColumns: ['transfer_ref','item_code','wbs_code','qty','from_warehouse','to_warehouse','status','est_pickup_date'],
    filterable:     ['status','wbs_code','from_warehouse','to_warehouse','est_pickup_date'],
    defaultSort:    { col: 'est_pickup_date', dir: 'asc' },
  },

  mto_lines: {
    label: 'MTO Lines', category: 'materials', module: 'mto',
    from: `FROM mto_lines l
           JOIN mto_registers r ON r.id = l.mto_id
           WHERE r.project_id = ? AND l.is_deleted = 0 AND l.revision = r.current_revision`,
    columns: {
      reference:    { label: 'MTO Ref',     sql: 'r.reference',     type: str },
      mto_name:     { label: 'MTO Name',     sql: 'r.name',          type: str },
      revision:     { label: 'Rev',          sql: 'l.revision',      type: str },
      line_number:  { label: 'Line',         sql: 'l.line_number',   type: str },
      wbs_code:     { label: 'WBS',           sql: 'l.wbs_code',      type: str },
      description:  { label: 'Description',   sql: 'l.description',   type: str },
      quantity:     { label: 'Qty',           sql: 'l.quantity',      type: num },
      uom:          { label: 'UOM',           sql: 'l.uom',           type: str },
      ros_date:     { label: 'ROS',           sql: 'l.ros_date',      type: date },
      inspection_class:{ label: 'Insp class', sql: 'l.inspection_class', type: str },
      vdrl_required:{ label: 'VDRL req',      sql: 'l.vdrl_required', type: bool },
      po_ref:       { label: 'PO Ref',        sql: 'l.po_ref',        type: str },
      status:       { label: 'Status',        sql: 'l.status',        type: str },
    },
    defaultColumns: ['reference','line_number','wbs_code','description','quantity','uom','ros_date','status'],
    filterable:     ['status','wbs_code','inspection_class','vdrl_required','ros_date'],
    defaultSort:    { col: 'reference', dir: 'asc' },
  },

  // ── QUALITY & TRACEABILITY ─────────────────────────────────────────────────
  certs: {
    label: 'Certificates', category: 'quality', module: 'traceability',
    from: `FROM traceability_certs c WHERE c.project_id = ?`,
    columns: {
      cert_type:    { label: 'Cert type',   sql: 'c.cert_type',      type: str },
      category:     { label: 'Category',    sql: 'c.category',       type: str },
      po_ref:       { label: 'PO Ref',      sql: 'c.po_ref',         type: str },
      vendor_name:  { label: 'Vendor',      sql: 'c.vendor_name',    type: str },
      tag:          { label: 'Tag',         sql: 'c.tag',            type: str },
      heat_ref:     { label: 'Heat',        sql: 'c.heat_ref',       type: str },
      status:       { label: 'Status',      sql: 'c.status',         type: str },
      priority:     { label: 'Priority',    sql: 'c.priority',       type: str },
      is_required:  { label: 'Required',    sql: 'c.is_required',    type: bool },
      issue_date:   { label: 'Issued',      sql: 'c.issue_date',     type: date },
      due_date:     { label: 'Due',         sql: 'c.due_date',       type: date },
      received_date:{ label: 'Received',    sql: 'c.received_date',  type: date },
    },
    defaultColumns: ['cert_type','po_ref','vendor_name','tag','heat_ref','status','due_date','received_date'],
    filterable:     ['status','priority','cert_type','category','is_required','due_date'],
    defaultSort:    { col: 'due_date', dir: 'asc' },
  },

  vdrl: {
    label: 'VDRL Documents', category: 'quality', module: 'vdrl',
    from: `FROM vdrl_documents d
           JOIN vdrl_packages p ON p.id = d.package_id
           WHERE p.project_id = ?`,
    columns: {
      doc_number:   { label: 'Doc No',      sql: 'd.doc_number',   type: str },
      title:        { label: 'Title',       sql: 'd.title',        type: str },
      doc_type:     { label: 'Type',        sql: 'd.doc_type',     type: en, options: ['Drawing','Datasheet','Procedure','Certificate','Manual','Report','Calculation','Specification'] },
      discipline:   { label: 'Discipline',  sql: 'd.discipline',   type: str },
      revision:     { label: 'Rev',         sql: 'd.revision',     type: str },
      purpose:      { label: 'Purpose',     sql: 'd.purpose',      type: str },
      status:       { label: 'Status',      sql: 'd.status',       type: en, options: ['Not submitted','Under review','Approved','Overdue','Resubmit'] },
      required_date:{ label: 'Required',    sql: 'd.required_date', type: date },
      promised_date:{ label: 'Promised',    sql: 'd.promised_date', type: date },
      submitted_date:{ label: 'Submitted',  sql: 'd.submitted_date', type: date },
      abf_cleared:  { label: 'ABF cleared', sql: 'd.abf_cleared',  type: bool },
    },
    defaultColumns: ['doc_number','title','doc_type','discipline','revision','status','required_date','submitted_date'],
    filterable:     ['status','doc_type','discipline','abf_cleared','required_date'],
    defaultSort:    { col: 'required_date', dir: 'asc' },
  },

  // ── PROJECT / CROSS-MODULE HEALTH ──────────────────────────────────────────
  wbs: {
    label: 'WBS Nodes', category: 'health', module: 'wbs',
    from: `FROM wbs_nodes n
           LEFT JOIN users o ON o.id = n.owner_id
           WHERE n.project_id = ?`,
    columns: {
      code:         { label: 'Code',        sql: 'n.code',          type: str },
      description:  { label: 'Description',  sql: 'n.description',   type: str },
      discipline:   { label: 'Discipline',   sql: 'n.discipline',    type: str },
      rag:          { label: 'RAG',          sql: 'n.rag',           type: en, options: ['green','amber','red','blue'] },
      ros_date:     { label: 'ROS',          sql: 'n.ros_date',      type: date },
      planned_start:{ label: 'Planned start', sql: 'n.planned_start', type: date },
      planned_end:  { label: 'Planned end',  sql: 'n.planned_end',   type: date },
      owner:        { label: 'Owner',        sql: 'o.full_name',     type: str },
    },
    defaultColumns: ['code','description','discipline','rag','ros_date','planned_end','owner'],
    filterable:     ['rag','discipline','ros_date'],
    defaultSort:    { col: 'code', dir: 'asc' },
  },

  rfi_meeting: {
    label: 'RFIs & Meetings', category: 'health', module: 'rfi_meeting',
    from: `FROM rfi_meeting_records m
           LEFT JOIN users rb ON rb.id = m.raised_by
           LEFT JOIN users at ON at.id = m.assigned_to
           WHERE m.project_id = ?`,
    columns: {
      ref:          { label: 'Ref',         sql: 'm.ref',           type: str },
      record_type:  { label: 'Type',        sql: 'm.record_type',   type: en, options: ['rfi','meeting'] },
      title:        { label: 'Title',       sql: 'm.title',         type: str },
      status:       { label: 'Status',      sql: 'm.status',        type: str },
      priority:     { label: 'Priority',    sql: 'm.priority',      type: en, options: ['low','normal','high','critical'] },
      link_type:    { label: 'Linked to',   sql: 'm.link_type',     type: str },
      raised_by:    { label: 'Raised by',   sql: 'rb.full_name',    type: str },
      assigned_to:  { label: 'Assigned to', sql: 'at.full_name',    type: str },
      raised_date:  { label: 'Raised',      sql: 'm.raised_date',   type: date },
      due_date:     { label: 'Due',         sql: 'm.due_date',      type: date },
      closed_date:  { label: 'Closed',      sql: 'm.closed_date',   type: date },
    },
    defaultColumns: ['ref','record_type','title','status','priority','raised_date','due_date'],
    filterable:     ['record_type','status','priority','raised_date','due_date'],
    defaultSort:    { col: 'raised_date', dir: 'desc' },
  },
}

// ─── PUBLIC SHAPE (no SQL leaked to clients) ─────────────────────────────────
// The catalogue/metadata sent to the browser: keys, labels, types, options,
// filterable flags — but never the `sql` expressions or `from` clauses.
function publicDataset(id) {
  const d = DATASETS[id]
  if (!d) return null
  const columns = Object.entries(d.columns).map(([key, c]) => ({
    key, label: c.label, type: c.type, options: c.options || null,
    filterable: d.filterable.includes(key),
  }))
  return {
    id, label: d.label, category: d.category, module: d.module,
    columns, defaultColumns: d.defaultColumns, defaultSort: d.defaultSort || null,
  }
}

module.exports = { DATASETS, publicDataset }
