// ─── VDRL UPLOAD: SHEET READING AND ROW CHECKS ─────────────────────────────────
// For POST /:projectId/vdrl/upload (dryRun and the real upload). PURE: no database; the route
// loads the lookups (the project's locked POs and the documents already in their packages).
//
// readVdrlSheet(buffer, filename, XLSX) → { rows: [{ row, cells }] } or { error }. The header row
// is the first of the first 10 rows with a cell that normalises to po_reference, so the
// template's title banner (row 1) is passed over; every header is normalised the same way
// ("Required Date (dd/mm/yyyy)" → required_date). row is the sheet's own row number.
//
// checkVdrlRows({ rows, pos, existingDocs, XLSX }) → { results, total, skipped, toImport }.
//   skipped   the template's example rows, and rows with no PO reference, doc number or title
//   errors    PO Reference missing; the PO not found or not approved (pos holds the locked POs);
//             Document Title missing; a date that isn't a real date or has a two-digit year;
//             a document number twice in the file for the same PO (naming the first row)
//   warnings  a date that can't be read (TBA): stored blank; a document number already in the
//             PO's package: the row is skipped, as before
// results keep the old keys (row, status, message, poRef, docNum, title, docType) and add errors,
// warnings and the values to insert.
const { readWorkbook, parseCalendarDate } = require('../utils/validate')

const EXAMPLE_DOCS = ['CV-MDRA-001', 'CV-DWG-001', 'SS-CERT-001']   // the template's example rows
const HEADER_NOT_FOUND = "Header row with 'PO Reference' not found. Use the downloaded template."
const DATE_COLUMNS = [['required_date', 'Required date'], ['promised_date', 'Promised date']]

// Lower case, trimmed, a trailing "(...)" removed, spaces to underscores.
function normHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s*\([^)]*\)$/, '').trim().replace(/\s+/g, '_')
}
// PO references and document numbers compare as MySQL's unicode_ci collation compares them:
// trimmed, case- and accent-insensitive.
function normKey(v) {
  return String(v ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function readVdrlSheet(buffer, filename, XLSX) {
  const wb = readWorkbook(buffer, filename, { type: 'buffer', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames.includes('VDRL Documents') ? 'VDRL Documents' : wb.SheetNames[0]]
  if (!ws || !ws['!ref']) return { error: HEADER_NOT_FOUND }
  const firstRow = XLSX.utils.decode_range(ws['!ref']).s.r + 1   // the sheet row of aoa[0]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true })
  const h = aoa.slice(0, 10).findIndex(r => (r || []).some(c => normHeader(c) === 'po_reference'))
  if (h < 0) return { error: HEADER_NOT_FOUND }
  const keys = aoa[h].map(normHeader)
  const rows = []
  for (let k = h + 1; k < aoa.length; k++) {
    const cells = {}
    keys.forEach((key, j) => { if (key && !(key in cells)) cells[key] = aoa[k][j] ?? null })
    rows.push({ row: firstRow + k, cells })
  }
  return { rows }
}

const text = v => (v == null ? '' : String(v).trim())
const shown = v => v instanceof Date
  ? (isNaN(v.getTime()) ? 'invalid date' : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`)
  : text(v)

function checkVdrlRows({ rows, pos, existingDocs, XLSX }) {
  const results = [], firstRowOf = new Map()   // PO|doc number → the sheet row it first appears on
  let total = 0, skipped = 0
  for (const { row, cells } of rows) {
    if (Object.values(cells).every(v => text(v) === '')) continue   // a blank line: not counted
    total++
    const poRef = text(cells.po_reference), docNum = text(cells.doc_number)
    const title = text(cells.document_title ?? cells.title), docType = text(cells.document_type)
    if (EXAMPLE_DOCS.includes(docNum)) {
      results.push({ row, status: 'skip', message: 'Example row skipped', poRef, docNum, errors: [], warnings: [] })
      skipped++; continue
    }
    if (!poRef && !docNum && !title) { skipped++; continue }

    const errors = [], warnings = []
    const po = poRef ? pos.get(normKey(poRef)) : null
    if (!poRef) errors.push('PO Reference is required')
    else if (!po) errors.push(`PO ${poRef} not found or not approved`)
    if (!title) errors.push('Document Title is required')

    const dates = {}
    for (const [key, label] of DATE_COLUMNS) {
      const d = parseCalendarDate(cells[key], XLSX)
      dates[key] = d.kind === 'ok' ? d.value : null
      if (d.kind === 'invalid') errors.push(d.reason === 'two-digit-year'
        ? `${label} '${shown(cells[key])}' has a two-digit year (use a four-digit year: DD/MM/YYYY or YYYY-MM-DD)`
        : `${label} '${shown(cells[key])}' is not a valid date (use DD/MM/YYYY or YYYY-MM-DD)`)
      else if (d.kind === 'unreadable') warnings.push(`${label} '${shown(cells[key])}' can't be read; it will be stored blank`)
    }

    let exists = false
    if (docNum) {
      const key = `${normKey(poRef)}|${normKey(docNum)}`
      if (firstRowOf.has(key)) errors.push(`Duplicate document number "${docNum}" for PO ${poRef} (first on row ${firstRowOf.get(key)})`)
      else firstRowOf.set(key, row)
      if (po && existingDocs.has(`${po.id}|${normKey(docNum)}`)) {
        exists = true; warnings.push(`Doc number ${docNum} already exists in this package`)
      }
    }

    const status = errors.length ? 'error' : exists ? 'skip' : 'ok'
    if (status === 'skip') skipped++
    results.push({
      row, status, message: errors.length ? errors.join('; ') : exists ? `Doc number ${docNum} already exists in this package` : 'Ready to import',
      poRef, docNum, title, docType, errors, warnings,
      poId: po ? po.id : null, poName: po ? po.po_name : null,
      pkgName: text(cells.package_name ?? cells.package),
      requiredDate: dates.required_date, promisedDate: dates.promised_date,
      revision: cells.revision || 'R0', discipline: cells.discipline || null, notes: cells.notes || null,
      abf: ['y', 'yes', '1'].includes(text(cells.abf_required).toLowerCase()) ? 1 : 0,
    })
  }
  return { results, total, skipped, toImport: results.filter(r => r.status === 'ok') }
}

// The real upload's refusal: "Row N: …" for the first 10 errors, then "; and K more"; rows lists
// every row with an error (up to 500).
function vdrlRefusal(results) {
  const bad = results.filter(r => r.errors.length)
  const all = bad.flatMap(r => r.errors.map(e => `Row ${r.row}: ${e}`))
  const first = all.slice(0, 10), more = all.length - first.length
  return { error: first.join('; ') + (more > 0 ? `; and ${more} more` : ''), rows: bad.slice(0, 500).map(r => ({ row: r.row, poRef: r.poRef, docNum: r.docNum, errors: r.errors })) }
}

module.exports = { readVdrlSheet, checkVdrlRows, vdrlRefusal, normHeader, normKey, HEADER_NOT_FOUND, EXAMPLE_DOCS }
