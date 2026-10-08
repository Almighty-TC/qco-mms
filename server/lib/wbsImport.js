// ─── WBS IMPORT ROW CHECKS ─────────────────────────────────────────────────────
// checkWbsRows({ dataRows, sheetRows, col, existing, XLSX }) — the one set of row checks for
// POST /:projectId/wbs/validate and /wbs/import. PURE: no database. The caller loads the
// project's nodes and passes `existing` (existingCodes(nodes): normalised code → id).
//
// Codes compare as MySQL's utf8mb4_unicode_ci compares wbs_nodes.code: trimmed, case-insensitive
// and accent-insensitive (normCode), so 01.A, 01.a and 01.Á are the same code.
//
// Per row (sheet columns code, description, parent_string, parent_id, ros):
//   errors    code and description required; code at most 50 characters, description at most 500;
//             a code already earlier in the file (naming its first row) or already in the project;
//             parent_string must be a code in the project or earlier in the file, and not the node
//             itself or one of its children; a parent_id with no parent_string; a ROS date that isn't
//             a real date, or has a two-digit year
//   warnings  a ROS date that can't be read (TBA): stored blank
// Returns { results: [{ row, code, description, parent, ros, rosDate, status, errors, warnings }],
//           summary: { total, ready, warnings, errors } }. row is the sheet's row number;
// description is the full text (the validate route shortens it); ros is the ISO date when the date
// reads, otherwise the cell as typed; rosDate is the ISO date or null.
const { parseCalendarDate } = require('../utils/validate')

const MAX_CODE = 50, MAX_DESCRIPTION = 500   // wbs_nodes.code varchar(50), description varchar(500)

function normCode(v) {
  return String(v ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function existingCodes(nodes) {
  const m = new Map()
  for (const n of nodes) if (!m.has(normCode(n.code))) m.set(normCode(n.code), n.id)
  return m
}

const cell = (r, i) => (i >= 0 && r[i] != null ? r[i] : '')
const text = v => String(v).trim()
const chars = s => [...s].length   // characters, as MySQL counts varchar length

function checkWbsRows({ dataRows, sheetRows, col, existing, XLSX }) {
  const codeIdx = col('code'), descIdx = col('description'), rosIdx = col('ros')
  const parentIdx = col('parent_string'), parentIdIdx = col('parent_id')
  const firstRowOf = new Map()   // normalised code → the sheet row it first appears on
  const results = []

  dataRows.forEach((r, i) => {
    const row = sheetRows && sheetRows[i] != null ? sheetRows[i] : i + 2
    const code = text(cell(r, codeIdx)), description = text(cell(r, descIdx))
    const parent = text(cell(r, parentIdx)), parentId = text(cell(r, parentIdIdx))
    const rosCell = cell(r, rosIdx)
    const errors = [], warnings = []

    if (!code) errors.push('Missing WBS code')
    if (!description) errors.push('Missing description')
    if (chars(code) > MAX_CODE) errors.push(`WBS code is longer than ${MAX_CODE} characters (${chars(code)})`)
    if (chars(description) > MAX_DESCRIPTION) errors.push(`Description is longer than ${MAX_DESCRIPTION} characters (${chars(description)})`)

    const key = normCode(code)
    if (code && firstRowOf.has(key)) errors.push(`Duplicate code "${code}" (first on row ${firstRowOf.get(key)})`)
    else if (code && existing.has(key)) errors.push(`WBS code '${code}' already exists in this project`)

    if (parent) {
      const pkey = normCode(parent)
      if (code && (pkey === key || pkey.startsWith(key + '.'))) errors.push('Circular reference: parent code is same as or child of this code')
      else if (!existing.has(pkey) && !firstRowOf.has(pkey)) errors.push(`Parent "${parent}" not yet seen — must appear before this row`)
    } else if (parentId) {
      errors.push(`Parent given only as parent_id "${parentId}" — put the parent's code in parent_string`)
    }

    const d = parseCalendarDate(rosCell, XLSX)
    const rosText = text(rosCell)
    if (d.kind === 'invalid') errors.push(d.reason === 'two-digit-year'
      ? `ROS date '${rosText}' has a two-digit year (use a four-digit year: DD/MM/YYYY or YYYY-MM-DD)`
      : `ROS date '${rosText}' is not a valid date (use DD/MM/YYYY or YYYY-MM-DD)`)
    else if (d.kind === 'unreadable') warnings.push(`ROS date '${rosText}' can't be read; it will be stored blank`)

    if (code && !firstRowOf.has(key)) firstRowOf.set(key, row)
    results.push({
      row, code, description, parent,
      ros: d.kind === 'ok' ? d.value : rosText, rosDate: d.kind === 'ok' ? d.value : null,
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
      errors, warnings,
    })
  })

  const summary = {
    total: results.length,
    ready: results.filter(r => r.status === 'ok').length,
    warnings: results.filter(r => r.status === 'warning').length,
    errors: results.filter(r => r.status === 'error').length,
  }
  return { results, summary }
}

// The import's refusal body: "Row N: …" for the first 10 errors, then "; and K more"; rows lists
// every row with an error (up to 500).
function refusal(results) {
  const bad = results.filter(r => r.errors.length)
  const all = bad.flatMap(r => r.errors.map(e => `Row ${r.row}: ${e}`))
  const first = all.slice(0, 10), more = all.length - first.length
  return { error: first.join('; ') + (more > 0 ? `; and ${more} more` : ''), rows: bad.slice(0, 500).map(r => ({ row: r.row, code: r.code, errors: r.errors })) }
}

module.exports = { checkWbsRows, existingCodes, normCode, refusal, MAX_CODE, MAX_DESCRIPTION }
