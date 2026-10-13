// ─── PO BULK UPLOAD: ROW CHECKS ──────────────────────────────────────────────────
// For POST /:projectId/pos/bulk-upload (the preview) and /pos/bulk-confirm. PURE: no database;
// the route passes `existing`: normalised PO number → { id, project_id, status, is_locked,
// tender_id } for every purchase order with one of the file's numbers, in any project
// (po_number is unique across projects).
//
// poRowsFromSheet(parsed) turns parseImportSheet's result into [{ row, cells }] with the column
// names mapped as before (FIELD_MAP); row is the sheet's own row number.
//
// checkPoRows({ rows, existing, pid, XLSX, confirm }) → { results }. Per row, as before: PO Number
// and Supplier/Vendor required, a PO number twice in the file is an error on every copy, an
// existing PO in this project is a duplicate (or locked: bulkLocked). Added: a PO number used by
// another project; ROS date through parseCalendarDate (an impossible date or a two-digit year is
// an error, text such as TBA a warning, stored blank; in confirm, ros_date must be YYYY-MM-DD);
// the value must be a number that fits decimal(15,2); Group/Category must be one of the enum's
// values; each text field within its column's length.
const { parseCalendarDate } = require('../utils/validate')

const FIELD_MAP = {
  'po number': 'po_number', 'po ref': 'po_number', 'po_number': 'po_number',
  'description': 'description',
  'supplier': 'vendor_name', 'vendor': 'vendor_name', 'vendor name': 'vendor_name',
  'group': 'group_category', 'category': 'group_category', 'group/category': 'group_category',
  'currency': 'currency', 'ccy': 'currency',
  'value': 'value', 'po value': 'value', 'amount': 'value',
  'incoterms': 'incoterms', 'inco terms': 'incoterms',
  'wbs': 'wbs_code', 'wbs code': 'wbs_code',
  'ros date': 'ros_date', 'ros': 'ros_date', 'required on site': 'ros_date',
  'owner': 'owner_name',
}
// purchase_orders column lengths (varchar) and the group_category enum
const LIMITS = [['po_number', 'PO Number', 100], ['vendor_name', 'Supplier/Vendor', 255], ['description', 'Description', 500],
  ['currency', 'Currency', 10], ['incoterms', 'Incoterms', 20], ['wbs_code', 'WBS code', 50]]
const GROUPS = ['mechanical', 'electrical', 'instrumentation', 'civil', 'piping', 'structural']
const MAX_VALUE = 9999999999999.99   // value decimal(15,2)

// A PO the bulk import must not overwrite: locked, in an approval-or-later status, or generated from a tender
// award (tender_id set — its supplier and value are the record of that award).
const BULK_LOCKED_STATUSES = ['po-raised', 'approved', 'pending_director_approval']
const bulkLocked = po => !!po.is_locked || BULK_LOCKED_STATUSES.includes(po.status) || po.tender_id != null

const normKey = v => String(v ?? '').trim().toLowerCase()
const text = v => (v == null ? '' : String(v).trim())
const chars = s => [...s].length

function poRowsFromSheet({ headers, dataRows, sheetRows }) {
  const keys = headers.map(h => FIELD_MAP[h] ?? h)
  return dataRows.map((r, i) => {
    const cells = {}
    keys.forEach((k, j) => { if (k && !(k in cells)) cells[k] = r[j] ?? '' })
    return { row: sheetRows ? sheetRows[i] : i + 2, cells }
  })
}

function checkPoRows({ rows, existing, pid, XLSX, confirm = false }) {
  const counts = new Map()
  for (const { cells } of rows) { const k = normKey(cells.po_number); if (k) counts.set(k, (counts.get(k) || 0) + 1) }
  const results = rows.map(({ row, cells }) => {
    const errors = [], warnings = []
    const po_number = text(cells.po_number), vendor_name = text(cells.vendor_name), key = normKey(po_number)
    const inFileDup = key && counts.get(key) > 1
    if (!po_number) errors.push('PO Number is required')
    if (!vendor_name && !cells.supplier_id) errors.push('Supplier/Vendor is required')
    if (inFileDup) errors.push('Duplicate within this upload file')
    const found = key ? existing.get(key) : null
    if (found && Number(found.project_id) !== Number(pid)) errors.push(`PO number ${po_number} is already used by another project`)

    for (const [field, label, max] of LIMITS) {
      const n = chars(text(cells[field]))
      if (n > max) errors.push(`${label} is longer than ${max} characters (${n})`)
    }

    let group = text(cells.group_category)
    if (group) {
      if (GROUPS.includes(group.toLowerCase())) group = group.toLowerCase()
      else errors.push(`Group/Category '${group}' is not one of ${GROUPS.join(', ')}`)
    }

    let value = null
    const rawValue = cells.value
    if (rawValue != null && text(rawValue) !== '') {
      const cleaned = String(rawValue).replace(/[^0-9.-]/g, '')
      const n = Number(cleaned)
      if (cleaned === '' || !Number.isFinite(n)) errors.push(`Value '${text(rawValue)}' is not a number`)
      else if (Math.abs(n) > MAX_VALUE) errors.push(`Value '${text(rawValue)}' is too large`)
      else value = n
    }

    let ros = null
    const rawRos = cells.ros_date
    if (confirm && text(rawRos) && !/^\d{4}-\d{2}-\d{2}$/.test(text(rawRos))) {
      errors.push(`ROS date '${text(rawRos)}' must be a YYYY-MM-DD date`)
    } else {
      const d = parseCalendarDate(rawRos === '' ? null : rawRos, XLSX)
      if (d.kind === 'ok') ros = d.value
      else if (d.kind === 'invalid') errors.push(d.reason === 'two-digit-year'
        ? `ROS date '${text(rawRos)}' has a two-digit year (use a four-digit year: DD/MM/YYYY or YYYY-MM-DD)`
        : `ROS date '${text(rawRos)}' is not a valid date (use DD/MM/YYYY or YYYY-MM-DD)`)
      else if (d.kind === 'unreadable') warnings.push(`ROS date '${text(rawRos)}' can't be read; it will be stored blank`)
    }

    let rowStatus = errors.length > 0 ? 'invalid' : 'new'
    if (rowStatus === 'new' && found) rowStatus = bulkLocked(found) ? 'locked' : 'duplicate'

    return {
      rowIndex: row,
      po_number, description: text(cells.description), vendor_name,
      group_category: group || null,
      currency: text(cells.currency) || 'AUD',
      value, incoterms: text(cells.incoterms), wbs_code: text(cells.wbs_code),
      ros_date: ros, owner_name: text(cells.owner_name),
      rowStatus,   // 'new' | 'duplicate' | 'locked' | 'invalid'
      errors, warnings,
      existingStatus: found && Number(found.project_id) === Number(pid) ? found.status : null,
    }
  })
  return { results }
}

module.exports = { checkPoRows, poRowsFromSheet, bulkLocked, normKey, FIELD_MAP, GROUPS, LIMITS, MAX_VALUE }
