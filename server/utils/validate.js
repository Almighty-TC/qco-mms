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

// Read an uploaded date cell the way the MTO importer always has (parseSheetDate's forms) and
// check it is a real calendar date. Returns { value, kind }:
//   'blank'      null, empty or whitespace                                    value null
//   'ok'         a real calendar date, year 1900 to 2100                      value 'YYYY-MM-DD'
//   'invalid'    date-shaped but not a real date (13/13/2024, 31/02/2024,     value null
//                29/02/2023, day or month 0), or a year outside 1900–2100
//   'unreadable' text that isn't one of the forms below (TBA, TBC, "May 2025") value null
// Date-shaped: a Date (its local day); a number (an Excel serial, via XLSX.SSF); and text only in
// these forms: YYYY-M-D (a time may follow); YYYY/M/D; D/M/YYYY, D-M-YYYY and D.M.YYYY (day first);
// "D Mon YYYY" and D-Mon-YYYY; "Mon D, YYYY" and "Mon D YYYY" (month by its first three letters).
// There is no lenient fallback: other text never reads as a date.
const DATE_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const MIN_YEAR = 1900, MAX_YEAR = 2100
function parseCalendarDate(v, XLSX) {
  const invalid = { value: null, kind: 'invalid' }
  if (v == null || (typeof v === 'string' && v.trim() === '')) return { value: null, kind: 'blank' }
  const calendar = (y, m, d) => {
    y = Number(y); m = Number(m); d = Number(d)
    if (![y, m, d].every(Number.isInteger) || y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12) return invalid
    if (d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return invalid   // the month's last day (leap years included)
    return { value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, kind: 'ok' }
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? invalid : calendar(v.getFullYear(), v.getMonth() + 1, v.getDate())
  if (typeof v === 'number') { const e = XLSX.SSF.parse_date_code(v); return e ? calendar(e.y, e.m, e.d) : invalid }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)                              // YYYY-M-D
  if (m) return calendar(m[1], m[2], m[3])
  m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{4})$/)                   // 31-Aug-2025, 1 May 2024
  if (m && DATE_MONTHS[m[2].slice(0, 3).toLowerCase()]) return calendar(m[3], DATE_MONTHS[m[2].slice(0, 3).toLowerCase()], m[1])
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)                            // D/M/YYYY or D-M-YYYY, day first
  if (m) return calendar(m[3], m[2], m[1])
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)                                // D.M.YYYY, day first
  if (m) return calendar(m[3], m[2], m[1])
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)                                // YYYY/M/D
  if (m) return calendar(m[1], m[2], m[3])
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/)                   // Mon D, YYYY or Mon D YYYY
  if (m && DATE_MONTHS[m[1].slice(0, 3).toLowerCase()]) return calendar(m[3], DATE_MONTHS[m[1].slice(0, 3).toLowerCase()], m[2])
  return { value: null, kind: 'unreadable' }
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

module.exports = { dateOrder, fileNotEmpty, parseImportSheet, readWorkbook, parseCalendarDate }
