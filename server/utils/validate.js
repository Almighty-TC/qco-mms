// ─── SHARED INPUT VALIDATION HELPERS ─────────────────────────

// Ensure a sequence of dates is non-decreasing (logical ordering). Pass
// [label, value] pairs in the expected order; nulls/blanks are skipped, so it
// validates whatever subset is present. Returns an error string or null.
//   dateOrder([['CRD', crd], ['CCD', ccd], ['ETD', etd], ['ETA', eta]])
function dateOrder(pairs) {
  const present = pairs
    .filter(([, v]) => v != null && v !== '')
    .map(([label, v]) => [label, v, new Date(v)])
  for (const [label, raw, d] of present) {
    if (isNaN(d)) return `${label} is not a valid date.`
  }
  for (let i = 1; i < present.length; i++) {
    const [pl, , pd] = present[i - 1]
    const [cl, craw, cd] = present[i]
    if (cd < pd) {
      const f = d => d.toISOString().slice(0, 10)
      return `${cl} (${f(cd)}) cannot be earlier than ${pl} (${f(pd)}).`
    }
  }
  return null
}

// A multer file is present and not zero-byte.
function fileNotEmpty(file) {
  if (!file) return 'No file was uploaded.'
  if (!file.size && !(file.buffer && file.buffer.length)) return 'The uploaded file is empty.'
  return null
}

// Read an uploaded spreadsheet. A file named *.csv is decoded as UTF-8 and parsed as text
// (raw), so every cell stays as typed: UTF-8 text isn't read as Latin-1, and codes keep their
// form (WBS 01 and 02.10, PO 000777, tag 1E3) and dates stay text for the existing parsers
// (DD/MM/YYYY). A CSV that isn't valid UTF-8 throws an Error with http = 400. Every other file
// is read exactly as before, with the caller's options.
const CSV_NOT_UTF8 = 'Save it as CSV UTF-8, or use the .xlsx template.'
function readWorkbook(buffer, filename, opts) {
  const XLSX = require('xlsx')
  if (!String(filename || '').toLowerCase().endsWith('.csv')) return XLSX.read(buffer, opts)
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    const err = new Error(CSV_NOT_UTF8)
    err.http = 400
    throw err
  }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)   // a leading BOM
  return XLSX.read(text, { type: 'string', raw: true })
}

// Parse + structurally validate an uploaded import spreadsheet (header:1 rows).
// Catches empty/corrupt files and missing required columns up front so the
// per-row logic can assume a well-formed sheet. Returns either
//   { error: '...' }                                   (reject with 400)
// or { headers, rows, dataRows, col }                  (proceed)
function parseImportSheet(file, requiredHeaders = []) {
  const fe = fileNotEmpty(file)
  if (fe) return { error: fe }
  const XLSX = require('xlsx')
  let rows
  try {
    const wb = readWorkbook(file.buffer, file.originalname, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) return { error: 'The spreadsheet has no readable sheet.' }
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  } catch (e) {
    if (e.http) return { error: e.message }
    return { error: 'Could not read the file — it may be corrupt or not a real spreadsheet.' }
  }
  if (!rows.length) return { error: 'The spreadsheet is empty.' }
  const headers = (rows[0] || []).map(h => String(h).toLowerCase().trim())
  const missing = requiredHeaders.filter(h => !headers.includes(h))
  if (missing.length) {
    return { error: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected columns include: ${requiredHeaders.join(', ')}.` }
  }
  const dataRows = rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''))
  if (!dataRows.length) return { error: 'The spreadsheet has a header row but no data rows.' }
  const col = name => headers.findIndex(h => h === name)
  return { headers, rows, dataRows, col }
}

module.exports = { dateOrder, fileNotEmpty, parseImportSheet, readWorkbook }
