// ─── MTO REGISTER ROUTES ──────────────────────────────────────────────────────
// Handles MTO list, detail, line items (CRUD), revision history, revision diff,
// and file upload for new revisions.
// All routes require a valid JWT (enforced via authenticateToken middleware).
// Security: parameterised queries only.
// Auditability: every mutating action writes to audit_log.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { dbError } = require('../utils/dbError')
const { authenticateToken } = require('../middleware/auth')
const multer  = require('multer')
const XLSX    = require('xlsx')
const fs      = require('fs')
const path    = require('path')
const { fileColumnsReady } = require('../lib/schemaColumns')
const { fileNotEmpty, readWorkbook, parseCalendarDate } = require('../utils/validate')
const { validateRevisionFormat, compareRevisions, RevisionError } = require('../lib/revision')
const { lockKeyRows } = require('../lib/mtoAvailability')
const { hasPermission } = require('../middleware/permissions')

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
router.use(authenticateToken)
router.use(require('../middleware/permissions').denyReadOnly) // C-a: viewer/auditor barred from writes
router.use(require('../middleware/permissions').enforce('mto')) // C-b2: matrix gate (engineering_lead/admin write; PM confirm)
router.use(require('../middleware/permissions').queueGate(/\/mto\/\d+$|\/mto\/\d+\/\d+\/lines$/, /\/mto\/\d+\/\d+\/lines\/\d+$/)) // C-c D1: proposers (engineering_lead) must use approval queue for register/line create+delete; admin direct
router.param('projectId', require('../middleware/permissions').requireProjectScope) // Stage 1: external roles WBS-scoped to granted projects

// ─── FILE UPLOAD CONFIG ───────────────────────────────────────────────────────
// New-revision files accepted in memory buffer — parsed then discarded.
const { fileFilter } = require('../utils/upload')
const blobStore = require('../lib/blobStore')   // blob migration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: fileFilter('spreadsheet'),
})

// ─── AUDIT HELPER ────────────────────────────────────────────────────────────
// Non-blocking — errors are logged to console only.
// `resource` (NOT NULL) is the request path (query string stripped), matching the
// path-only convention of existing rows; entity_type/entity_id stay as structured
// filter fields.
function audit(req, action, entityType, entityId, before = null, after = null) {
  // path-only, no /api mount prefix — matches the existing audit_log convention
  const resource = (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/)/, '')
  // project_id from the route param (all mto routes are /:projectId/...); NULL if absent.
  const projectId = Number(req.params.projectId) || null
  db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, before_value, after_value, resource, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user?.id ?? null, action, entityType, entityId, projectId,
     before ? JSON.stringify(before) : null,
     after  ? JSON.stringify(after)  : null,
     resource,
     req.ip ?? null]
  ).catch(e => console.error('[audit] insert failed:', e.message))
}

// ─── NEXT REVISION HELPER ────────────────────────────────────────────────────
// Returns the letter after the supplied revision (A→B, B→C, …, Z→AA).
function nextRevision(current) {
  if (!current) return 'B'
  const upper = current.toUpperCase()
  if (upper === 'Z') return 'AA'
  return String.fromCharCode(upper.charCodeAt(upper.length - 1) + 1)
}

// Natural alphanumeric comparison of two revision labels so ordering works for
// letters (A<B<…<Z<AA), numbers (1<2<10, 1.0<1.1) and mixes (A1<A2<A10,
// "Rev 2"<"Rev 10"). Splits each label into number/letter chunks and compares
// chunk-by-chunk. Returns -1 | 0 | 1.
function compareRev(a, b) {
  const chunk = s => (String(s == null ? '' : s).trim().toLowerCase().match(/\d+|\D+/g) || [])
  const ax = chunk(a), bx = chunk(b)
  const n = Math.max(ax.length, bx.length)
  for (let i = 0; i < n; i++) {
    const av = ax[i], bv = bx[i]
    if (av === undefined) return -1            // a is a prefix of b → a is older
    if (bv === undefined) return 1
    if (av === bv) continue
    const an = /^\d+$/.test(av), bn = /^\d+$/.test(bv)
    if (an && bn) { const d = Number(av) - Number(bv); if (d) return d < 0 ? -1 : 1 }
    else if (an !== bn) return an ? -1 : 1      // a number chunk sorts before a letter chunk
    else {
      // both non-numeric: pure-letter chunks order base-26 (Z < AA < AB), so a
      // longer letter run is the later revision; otherwise plain lexical.
      if (/^[a-z]+$/.test(av) && /^[a-z]+$/.test(bv) && av.length !== bv.length)
        return av.length < bv.length ? -1 : 1
      return av < bv ? -1 : 1
    }
  }
  return 0
}

// Parse a spreadsheet cell into a YYYY-MM-DD string without timezone drift.
// Handles Date objects, Excel serials, ISO, "31-Aug-2025" and DD/MM/YYYY.
// A spreadsheet date cell as YYYY-MM-DD, or null when it is blank, unreadable or not a real
// calendar date (parseCalendarDate in utils/validate.js does the reading and the calendar check).
function parseSheetDate(v, XLSX) {
  const d = parseCalendarDate(v, XLSX)
  return d.kind === 'ok' ? d.value : null
}

// One line's content signature, normalised the way it would be stored — shared by the no-change
// check and the upload's dryRun counts (which compare lines by key, so they leave out line_number).
function lineSignature(l, withLineNumber = true) {
  const ymd = d => {            // local Y-M-D so a stored time/TZ doesn't shift the day
    if (!d) return ''
    if (typeof d === 'string') {   // date text (CSV cells, .xlsx text cells): read it as the import does, so DD/MM/YYYY is day-first
      const parsed = parseSheetDate(d, XLSX)
      if (parsed) return parsed
    }
    const dt = new Date(d)
    return isNaN(dt) ? String(d).slice(0, 10)
      : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  }
  return [
    ...(withLineNumber ? [String(l.line_number ?? '').trim()] : []),
    String(l.description ?? '').trim().toLowerCase(),
    String(Number(l.quantity) || 0),
    String(l.uom ?? '').trim().toLowerCase(),
    String(l.wbs_code ?? '').trim().toLowerCase(),
    ymd(l.ros_date),
    String(l.item_type ?? '').trim().toLowerCase(),
    String(l.item_ref ?? '').trim().toLowerCase(),
  ].join('|')
}

// True when an uploaded line set is content-identical to an existing revision's
// lines (so a "new" revision would change nothing). Compares the substantive MTO
// fields, normalised the way they'd be stored; order-independent.
function sameMtoContent(uploaded, existing) {
  const vd = v => (v === 1 || v === '1' || v === true || /^(y|yes|true)$/i.test(String(v ?? ''))) ? 1 : 0
  const valid = a => a.filter(l => l.line_number != null && l.line_number !== '' && l.description)
  const u = valid(uploaded).map(l => lineSignature(l)).sort()
  const e = valid(existing).map(l => lineSignature(l)).sort()
  if (u.length === 0 || u.length !== e.length) return false
  return u.every((s, i) => s === e[i])
}

// ─── LINE CLASSIFICATION (Phase 2 sub-step 1b) ──────────────────────────────
// item_type (bulk | commodity | equipment, nullable) and item_ref (the commodity code or equipment
// tag, VARCHAR(100)) on mto_lines. A file names the two columns with tolerant headers (lowercase,
// spaces, underscores, hyphens and slashes removed); a file without them imports as before.
const ITEM_TYPES = ['bulk', 'commodity', 'equipment']
const TYPE_HEADERS = new Set(['itemtype'])
const REF_HEADERS = new Set(['commoditycodeequipmenttag', 'itemref'])
const tolerantKey = k => String(k).toLowerCase().replace(/[\s_\-/]+/g, '')
const blankToNull = v => { const s = v == null ? '' : String(v).trim(); return s === '' ? null : s }
const lineKey = ln => String(ln ?? '').trim().toLowerCase()
// The two classification cells of a parsed row, read by tolerant header.
function rawClassification(row) {
  let type, ref
  for (const [k, v] of Object.entries(row)) {
    const t = tolerantKey(k)
    if (TYPE_HEADERS.has(t)) type = v
    else if (REF_HEADERS.has(t)) ref = v
  }
  return { type, ref }
}
// Resolves one line's classification. Both cells blank → carry the pair from `prev` (Map lineKey →
// { item_type, item_ref }, the current revision's non-deleted rows; null when there is nothing to
// carry). Otherwise the given pair is used: a valid type, a reference of at most 100 characters,
// the two together. Then the equipment rule on the resolved row. Never truncates.
function resolveClassification({ type, ref, wbs, ln, prev }) {
  const errors = []
  const label = `Line ${String(ln ?? '').trim()}`
  let t = blankToNull(type), r = blankToNull(ref)
  if (t == null && r == null) {
    const p = prev ? prev.get(lineKey(ln)) : null
    if (p) { t = p.item_type ?? null; r = p.item_ref ?? null }
  } else {
    let typeOk = true
    if (t != null) {
      if (ITEM_TYPES.includes(t.toLowerCase())) t = t.toLowerCase()
      else { typeOk = false; errors.push(`${label}: item type "${t}" must be bulk, commodity or equipment`) }
    }
    if (r != null && r.length > 100) errors.push(`${label}: the commodity code / equipment tag is ${r.length} characters — the limit is 100`)
    if (t != null && typeOk && r == null) errors.push(`${label}: item type "${t}" needs a Commodity Code / Equipment Tag`)
    if (r != null && t == null) errors.push(`${label}: "${r}" needs an Item Type (bulk, commodity or equipment)`)
  }
  if (!errors.length && t === 'equipment' && (blankToNull(wbs) == null || r == null))
    errors.push(`${label}: equipment lines need a WBS code and an equipment tag`)
  return { item_type: errors.length ? null : t, item_ref: errors.length ? null : r, errors }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIST / CREATE
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /:projectId — list all MTO registers for a project ──────────────────
router.get('/:projectId', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, project_id, name, reference, current_revision, owner, description,
              status, line_count, created_by, created_at, updated_at
       FROM mto_registers
       WHERE project_id = ?
       ORDER BY status DESC, reference ASC`,
      [req.params.projectId]
    )
    res.json(rows)
  } catch (e) {
    console.error('GET /mto/:projectId', e.message)
    res.status(500).json({ error: 'Failed to load MTO registers' })
  }
})

// ─── POST /:projectId — create a new MTO register ────────────────────────────
router.post('/:projectId', async (req, res) => {
  const name      = String(req.body.name ?? '').trim()
  const reference = String(req.body.reference ?? '').trim()
  const { current_revision, owner, description } = req.body
  // ─── Basic input checks before accepting ──────────────────────
  if (!name || !reference) return res.status(400).json({ error: 'Name and reference are required.' })
  // Initial revision is free-text — enforce the format (no prior rev to order against).
  const revFmtErr = validateRevisionFormat(current_revision || 'A')
  if (revFmtErr) return res.status(422).json({ error: revFmtErr })
  try {
    // Reject a duplicate MTO reference within the project (logical conflict).
    const [[dup]] = await db.query(
      'SELECT id FROM mto_registers WHERE project_id = ? AND reference = ?',
      [req.params.projectId, reference])
    if (dup) return res.status(409).json({ error: `An MTO with reference "${reference}" already exists in this project.` })

    const [result] = await db.query(
      `INSERT INTO mto_registers (project_id, name, reference, current_revision, owner, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.params.projectId, name, reference, current_revision || 'A', owner || null, description || null, req.user.id]
    )
    const newId = result.insertId

    // Seed the first revision record
    await db.query(
      `INSERT INTO mto_revisions (mto_id, revision, uploaded_by, notes, line_count)
       VALUES (?, ?, ?, ?, 0)`,
      [newId, current_revision || 'A', req.user.id, 'Initial revision']
    )

    const [[mto]] = await db.query(`SELECT * FROM mto_registers WHERE id = ?`, [newId])
    audit(req, 'CREATE', 'mto_register', newId, null, mto)
    res.status(201).json(mto)
  } catch (e) {
    console.error('POST /mto/:projectId', e.message)
    res.status(500).json({ error: 'Failed to create MTO register' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE DOWNLOAD + FILE PRE-PARSE
// Must be registered before /:projectId/:mtoId to avoid route shadowing.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /:projectId/template — download a formatted XLSX import template ─────
// Returns an ExcelJS workbook with header row, 3 example rows, blank data rows,
// dropdown validations, and an Instructions sheet.
router.get('/:projectId/template', async (req, res) => {
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'QCO MMS'
  wb.created = new Date()

  // ── ONE sheet: MTO Details (top) + line-items table (below) ───────────────
  // Line columns match the upload parser EXACTLY (line_number, wbs_code, item type, commodity
  // code / equipment tag, description, quantity, uom, ros_date) + a Notes column the parser uses
  // to skip example rows.
  // The old Unit Rate / Total Value columns were removed — MTO carries no pricing
  // (that lives on po_lines), so the parser never read them and they only misled.
  const ws = wb.addWorksheet('MTO Lines', { views: [{ state: 'frozen', ySplit: 8 }] })
  ws.columns = [
    { width: 18 }, { width: 16 }, { width: 14 }, { width: 28 }, { width: 50 }, { width: 10 },
    { width: 8 }, { width: 14 }, { width: 30 },
  ]

  // Row 1: orange title banner
  ws.mergeCells('A1:I1')
  const titleCell = ws.getCell('A1')
  titleCell.value = 'QCO MMS — MTO Import Template'
  titleCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 13, name: 'Calibri' }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE84E0F' } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' }
  ws.getRow(1).height = 28

  // Rows 2-6: MTO Details (label in col A, value merged B:E). Labels MUST match
  // the labels parse-file scans for (case-insensitive).
  const detailRows = [['MTO Name *', ''], ['MTO Reference *', ''], ['Revision', 'A'], ['Owner', ''], ['Description', '']]
  detailRows.forEach(([label, val], i) => {
    const rn = 2 + i
    ws.mergeCells(`B${rn}:E${rn}`)
    const lc = ws.getCell(`A${rn}`)
    lc.value = label
    lc.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' }
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } }
    lc.alignment = { vertical: 'middle' }
    const vc = ws.getCell(`B${rn}`)
    vc.value = val
    vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } }
    vc.border = { bottom: { style: 'thin', color: { argb: 'FFcbd5e1' } } }
    ws.getRow(rn).height = 20
  })

  // Row 7: guidance note across the sheet
  ws.mergeCells('A7:I7')
  const note = ws.getCell('A7')
  note.value = '↓  Line items — enter one row per item below. Delete the grey example rows before uploading.'
  note.font = { italic: true, color: { argb: 'FF64748b' }, size: 10 }
  ws.getRow(7).height = 18

  // Row 8: line column headers (dark blue) — exactly the fields the parser reads,
  // plus Notes (used to detect/skip the grey example rows on import).
  const headers = ['Line Number','WBS Code','Item Type','Commodity Code / Equipment Tag','Description','Quantity','UOM','ROS Date','Notes']
  const headerRow = ws.getRow(8)
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF334155' } } }
  })
  headerRow.height = 22

  // Rows 9-11: example rows (grey italic)
  const examples = [
    ['L-001','02.01.01','equipment','V-101','HP Separator Vessel — 3-phase horizontal',1,'EA','31-Aug-2025','Delete before uploading'],
    ['L-002','02.02.01','equipment','P-101A','Centrifugal Feed Pump P-101A',2,'EA','31-Oct-2025','Delete before uploading'],
    ['L-003','03.01.01','bulk','CBL-11KV-3C150','HV Cable 11kV 3C×150mm² XLPE',250,'m','15-Dec-2025','Delete before uploading'],
  ]
  examples.forEach((ex, i) => {
    const row = ws.getRow(9 + i)
    ex.forEach((val, j) => { const c = row.getCell(j + 1); c.value = val; c.font = { italic: true, color: { argb: 'FF94a3b8' }, size: 10, name: 'Calibri' } })
    row.height = 18
  })

  // Rows 12-60: blank data rows
  for (let r = 12; r <= 60; r++) ws.getRow(r).height = 18

  // col G (7) — UOM (guide only), from the first data row
  ws.dataValidations.add('G9:G500', {
    type: 'list', allowBlank: true, showErrorMessage: false,
    formulae: ['"EA,NR,KG,T,M,MM,M2,M3,L,KL,SET,LOT,PR,LM,KN"'],
  })

  // Instructions sheet
  const ws2 = wb.addWorksheet('Instructions')
  ws2.getColumn(1).width = 80
  const instrLines = [
    ['QCO MMS — MTO Template Instructions', true, 'FFE84E0F', 13],
    ['', false, null, 11],
    ['MTO DETAILS (top of the sheet)', true, 'FF1e3a5f', 11],
    ['MTO Name — Required.', false, null, 10],
    ['MTO Reference — Required. Must be unique within the project.', false, null, 10],
    ['Revision — Optional (defaults A). Letters, numbers or a mix: A, B, 1, 2, 2A, R0…', false, null, 10],
    ['Owner / Description — Optional.', false, null, 10],
    ['', false, null, 10],
    ['LINE ITEMS (table below the details)', true, 'FF1e3a5f', 11],
    ['Line Number — Required. Format: L-001. Must be unique.', false, null, 10],
    ['WBS Code — Must match a WBS code in your project (e.g. 02.01.01).', false, null, 10],
    ['Item Type — Optional: bulk, commodity or equipment (blank = unclassified). Equipment lines need a WBS Code and an equipment tag.', false, null, 10],
    ['Commodity Code / Equipment Tag — Required when an Item Type is set (max 100 characters). Leave both blank to keep the previous revision\'s classification.', false, null, 10],
    ['Description — Required for every line.', false, null, 10],
    ['Quantity — Numeric.', false, null, 10],
    ['UOM — Select from dropdown (guide only): EA, NR, KG, T, M, MM, M2, M3, L, KL, SET, LOT, PR, LM, KN', false, null, 10],
    ['ROS Date — Format: DD-MMM-YYYY (e.g. 31-Aug-2025)', false, null, 10],
    ['', false, null, 10],
    ['UPLOAD RULES', true, 'FF1e3a5f', 11],
    ['1. Fill the MTO Details at the top, then the line items in the table below.', false, null, 10],
    ['2. Delete the grey example rows before uploading.', false, null, 10],
    ['3. Do not change the line-item column headers.', false, null, 10],
    ['4. Rows with blank Description are skipped on import.', false, null, 10],
    ['5. Save as .xlsx, or CSV UTF-8, before uploading.', false, null, 10],
  ]
  instrLines.forEach(([text, bold, color, size], i) => {
    const c = ws2.getCell(i+1, 1)
    c.value = text
    c.font = { bold, size, name: 'Calibri', color: color ? { argb: color } : { argb: 'FF0f172a' } }
    c.alignment = { wrapText: true }
  })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="QCO_MTO_Template.xlsx"')
  await wb.xlsx.write(res)
  res.end()
})

// ─── POST /:projectId/parse-file — parse & validate an XLSX/CSV before commit ─
// Returns preview, warnings, and error flags. Does NOT insert any data.
router.post('/:projectId/parse-file', upload.single('file'), async (req, res) => {
  { const fe = fileNotEmpty(req.file); if (fe) return res.status(400).json({ error: fe, hasErrors: true }) }
  try {
    const [wbsRows] = await db.query('SELECT code FROM wbs_nodes WHERE project_id = ?', [req.params.projectId])
    const validWBS = new Set(wbsRows.map(r => r.code))
    const XLSX_LIB = require('xlsx')
    const wb = readWorkbook(req.file.buffer, req.file.originalname, { type: 'buffer', cellDates: true })

    const mtoHeader = { name: null, reference: null, revision: null, owner: null, description: null }
    const sheetName = wb.SheetNames.includes('MTO Lines') ? 'MTO Lines' : wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    function norm(k) { return String(k).trim().toLowerCase().replace(/\s+/g, '_') }
    // The line sheet has a title banner on row 1, so the real column headers are
    // a few rows down. Find the header row dynamically (the row carrying both
    // "Description" and a "Line Number"-style column), then parse from there.
    const aoa = XLSX_LIB.utils.sheet_to_json(ws, { header: 1, defval: null })
    let hdrIdx = aoa.findIndex(r => Array.isArray(r)
      && r.some(c => norm(c ?? '') === 'description')
      && r.some(c => /^line_(number|#|no)$/.test(norm(c ?? ''))))
    if (hdrIdx < 0) hdrIdx = 7   // fallback: combined template's line-header row
    // MTO header details sit in the rows ABOVE the line header (label col A,
    // value col B). Also honour a separate "MTO Details" sheet for older files.
    const detailAoa = wb.SheetNames.includes('MTO Details')
      ? XLSX_LIB.utils.sheet_to_json(wb.Sheets['MTO Details'], { header: 1, defval: null })
      : aoa.slice(0, hdrIdx)
    const grab = (re) => { for (const r of detailAoa) { if (r && r[0] != null && re.test(String(r[0])) && r[1] != null && String(r[1]).trim() !== '') return String(r[1]).trim() } return null }
    mtoHeader.name        = grab(/mto\s*name/i)
    mtoHeader.reference   = grab(/reference/i)
    mtoHeader.revision    = grab(/revision/i)
    mtoHeader.owner       = grab(/owner/i)
    mtoHeader.description = grab(/description/i)
    const rawRows = XLSX_LIB.utils.sheet_to_json(ws, { range: hdrIdx, defval: null })
    if (!rawRows.length) return res.status(400).json({ error: 'File is empty or unreadable', hasErrors: true })

    const firstRow = rawRows[0]
    const normKeys = Object.keys(firstRow).map(norm)
    if (!normKeys.includes('description'))
      return res.status(400).json({ error: 'Required column "Description" not found. Check headers match the template (MTO Lines tab).', hasErrors: true })
    const hasLineNum = normKeys.includes('line_number') || normKeys.includes('line_#') || normKeys.includes('line_no')
    if (!hasLineNum)
      return res.status(400).json({ error: 'Required column "Line Number" not found. Check headers match the template (MTO Lines tab).', hasErrors: true })

    const rows = rawRows.map((row, idx) => {
      const n = {}
      for (const [k, v] of Object.entries(row)) n[norm(k)] = v
      if (!n.line_number && n['line_#']) n.line_number = n['line_#']
      if (!n.line_number && n.line_no) n.line_number = n.line_no
      n._rowNum = idx + hdrIdx + 2   // 1-based sheet row of this data row
      n._cls = rawClassification(row)   // Item Type / Commodity Code / Equipment Tag cells (tolerant headers)
      return n
    })

    const warnings = [], validLines = [], classified = []
    let linesSkipped = 0
    const lineNumbers = new Map()
    const VALID_UOM = new Set(['EA','m','m2','m3','kg','t','LT','SET','LOT'])

    const parseDate = (v) => parseSheetDate(v, XLSX_LIB)

    for (const row of rows) {
      const rn = row._rowNum
      const notesVal = String(row.notes || '').toLowerCase()
      if (notesVal.includes('delete before uploading') || notesVal.includes('example')) {
        linesSkipped++; warnings.push({ row: rn, message: 'Example row skipped', severity: 'warning' }); continue
      }
      if (!row.description || String(row.description).trim() === '') {
        linesSkipped++; warnings.push({ row: rn, message: 'Description missing — row skipped', severity: 'warning' }); continue
      }
      const lineNum = row.line_number ? String(row.line_number).trim() : ''
      if (!lineNum) {
        linesSkipped++; warnings.push({ row: rn, message: 'Line number missing — row skipped', severity: 'warning' }); continue
      }
      if (lineNumbers.has(lineNum)) {
        warnings.push({ row: rn, message: `Duplicate line number ${lineNum} (first seen row ${lineNumbers.get(lineNum)})`, severity: 'error' })
      } else lineNumbers.set(lineNum, rn)

      let uom = row.uom ? String(row.uom).trim() : ''
      if (uom && !VALID_UOM.has(uom)) { warnings.push({ row: rn, message: `UOM '${uom}' not recognised — defaulting to EA`, severity: 'warning' }); uom = 'EA' }
      const wbsCode = row.wbs_code ? String(row.wbs_code).trim() : null
      if (wbsCode && validWBS.size > 0 && !validWBS.has(wbsCode))
        warnings.push({ row: rn, message: `WBS '${wbsCode}' not found in project — imported as-is`, severity: 'warning' })

      let qty = null
      if (row.quantity != null && row.quantity !== '') {
        const n = parseFloat(String(row.quantity))
        if (isNaN(n)) warnings.push({ row: rn, message: `Quantity '${row.quantity}' is not a number — left blank`, severity: 'warning' })
        else qty = n
      }

      const rosCheck = parseCalendarDate(row.ros_date, XLSX_LIB)
      const rosDate = rosCheck.kind === 'ok' ? rosCheck.value : null
      if (rosCheck.kind === 'invalid')
        warnings.push({ row: rn, message: `ROS date '${row.ros_date}' is not a valid date`, severity: 'error' })
      else if (rosCheck.kind === 'unreadable')
        warnings.push({ row: rn, message: `ROS date '${row.ros_date}' could not be parsed — left blank`, severity: 'warning' })

      // Classification: parse-file previews a new register's first upload, so there is no previous
      // revision to carry from — blank cells stay unclassified.
      const cls = resolveClassification({ type: row._cls.type, ref: row._cls.ref, wbs: wbsCode, ln: lineNum, prev: null })
      for (const m of cls.errors) warnings.push({ row: rn, message: m, severity: 'error' })
      if (cls.item_ref) classified.push({ rn, item_type: cls.item_type, item_ref: cls.item_ref })

      validLines.push({ line_number: lineNum, wbs_code: wbsCode, description: String(row.description).trim(), quantity: qty, uom: uom || null, ros_date: rosDate, item_type: cls.item_type, item_ref: cls.item_ref })
    }

    // Library check (warnings only, never blocking): each reference against the project's commodity
    // library (bulk, commodity) or equipment list (equipment) — at most two queries for the whole file.
    const known = async (sql, vals) => vals.length
      ? new Set((await db.query(sql, [req.params.projectId, vals]))[0].map(r => String(Object.values(r)[0]).toLowerCase()))
      : new Set()
    const knownCodes = await known('SELECT code FROM commodity_library WHERE project_id = ? AND code IN (?)', [...new Set(classified.filter(c => c.item_type !== 'equipment').map(c => c.item_ref))])
    const knownTags  = await known('SELECT tag FROM equipment_list WHERE project_id = ? AND tag IN (?)', [...new Set(classified.filter(c => c.item_type === 'equipment').map(c => c.item_ref))])
    for (const c of classified) {
      const isTag = c.item_type === 'equipment'
      if (!(isTag ? knownTags : knownCodes).has(c.item_ref.toLowerCase()))
        warnings.push({ row: c.rn, message: isTag ? `Equipment tag "${c.item_ref}" not found in the project's equipment list` : `Commodity code "${c.item_ref}" not found in the project's commodity library`, severity: 'warning' })
    }

    res.json({
      mto: mtoHeader,
      linesFound: rows.length, linesValid: validLines.length, linesSkipped,
      warnings, hasErrors: warnings.some(w => w.severity === 'error'),
      preview: validLines.slice(0, 15)
    })
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message, hasErrors: true })
    console.error('parse-file', e.message)
    res.status(500).json({ error: 'Failed to parse file: ' + e.message, hasErrors: true })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE MTO — DETAIL + LINES + REVISIONS + DIFF
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /:projectId/:mtoId — MTO detail with current revision lines ──────────
router.get('/:projectId/:mtoId', async (req, res) => {
  try {
    const [[mto]] = await db.query(
      `SELECT * FROM mto_registers WHERE id = ? AND project_id = ?`,
      [req.params.mtoId, req.params.projectId]
    )
    if (!mto) return res.status(404).json({ error: 'MTO not found' })

    const [lines] = await db.query(
      `SELECT * FROM mto_lines
       WHERE mto_id = ? AND revision = ? AND is_deleted = 0
       ORDER BY line_number ASC`,
      [mto.id, mto.current_revision]
    )
    res.json({ ...mto, lines })
  } catch (e) {
    console.error('GET /mto/:projectId/:mtoId', e.message)
    res.status(500).json({ error: 'Failed to load MTO detail' })
  }
})

// ─── GET /:projectId/:mtoId/lines?revision=X — lines for a specific revision ──
// ─── SERVER-SIDE PAGINATION: line items ───────────────────────────────────────
// Returns { data, total, page, limit, counts }. Filter (status/search) + whitelisted
// sort run across the WHOLE revision (not page-local). `counts` are per-status totals
// for the revision (drive the filter-tab badges, independent of the active search).
router.get('/:projectId/:mtoId/lines', async (req, res) => {
  try {
    const [[mto]] = await db.query(
      `SELECT * FROM mto_registers WHERE id = ? AND project_id = ?`,
      [req.params.mtoId, req.params.projectId]
    )
    if (!mto) return res.status(404).json({ error: 'MTO not found' })

    const revision = req.query.revision || mto.current_revision

    // ─── PAGINATE ─── default 50, hard cap 200
    const page   = Math.max(1, parseInt(req.query.page  || '1', 10))
    const limit  = Math.min(100000, Math.max(1, parseInt(req.query.limit || '50', 10)))
    const offset = (page - 1) * limit

    // ─── FILTERS (server-side, whole-set) ───
    const where  = ['mto_id = ?', 'revision = ?', 'is_deleted = 0']
    const params = [mto.id, revision]
    const { status, search } = req.query
    if (status && status !== 'all') { where.push('status = ?'); params.push(status) }
    if (search) {
      const q = `%${search}%`
      where.push('(line_number LIKE ? OR description LIKE ? OR wbs_code LIKE ? OR po_ref LIKE ?)')
      params.push(q, q, q, q)
    }
    const whereSql = where.join(' AND ')

    // ─── WHITELISTED SORT (+ unique id tiebreaker — stable OFFSET windows) ───
    const SAFE_SORT = {
      line_number: 'line_number', description: 'description', wbs_code: 'wbs_code',
      quantity: 'quantity', ros_date: 'ros_date', status: 'status',
    }
    const orderBy  = SAFE_SORT[req.query.sort_col] || 'line_number'
    const orderDir = String(req.query.sort_dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC'

    // total for the filtered set
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM mto_lines WHERE ${whereSql}`, params
    )

    // per-status counts for the whole revision (tab badges — ignore status/search)
    const [countRows] = await db.query(
      `SELECT status, COUNT(*) AS n FROM mto_lines
       WHERE mto_id = ? AND revision = ? AND is_deleted = 0 GROUP BY status`,
      [mto.id, revision]
    )
    const counts = { all: 0, 'po-raised': 0, rfq: 0, 'not-started': 0 }
    countRows.forEach(r => { counts[r.status] = r.n; counts.all += r.n })

    const [lines] = await db.query(
      `SELECT * FROM mto_lines
       WHERE ${whereSql}
       ORDER BY ${orderBy} ${orderDir}, id ${orderDir}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    res.json({ data: lines, total, page, limit, counts })
  } catch (e) {
    console.error('GET /mto/:projectId/:mtoId/lines', e.message)
    res.status(500).json({ error: 'Failed to load lines' })
  }
})

// ─── GET /:projectId/:mtoId/revisions — revision history ─────────────────────
router.get('/:projectId/:mtoId/revisions', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.id, r.mto_id, r.revision, r.notes, r.line_count, r.created_at,
              u.full_name AS uploaded_by_name
       FROM mto_revisions r
       LEFT JOIN users u ON u.id = r.uploaded_by
       WHERE r.mto_id = ?
       ORDER BY r.created_at ASC`,
      [req.params.mtoId]
    )
    res.json(rows)
  } catch (e) {
    console.error('GET /mto/:projectId/:mtoId/revisions', e.message)
    res.status(500).json({ error: 'Failed to load revisions' })
  }
})

// ─── GET /:projectId/:mtoId/diff?from=A&to=B — compare two revisions ──────────
// Returns: { added, modified, deleted, unchanged }
// A line is "added"    if line_number exists in 'to' but not 'from'.
// A line is "deleted"  if line_number exists in 'from' but not 'to'.
// A line is "modified" if it exists in both but qty/wbs/description/ros_date/
//                      inspection_class changed.
router.get('/:projectId/:mtoId/diff', async (req, res) => {
  const { from, to } = req.query
  if (!from || !to) return res.status(400).json({ error: 'from and to revision params required' })
  try {
    const [fromLines] = await db.query(
      `SELECT * FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0`,
      [req.params.mtoId, from]
    )
    const [toLines] = await db.query(
      `SELECT * FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0`,
      [req.params.mtoId, to]
    )

    const fromMap = new Map(fromLines.map(l => [l.line_number, l]))
    const toMap   = new Map(toLines.map(l => [l.line_number, l]))

    const added    = []
    const deleted  = []
    const modified = []
    let   unchanged = 0

    // Lines in 'to' — check if new or modified
    for (const [ln, line] of toMap) {
      if (!fromMap.has(ln)) {
        added.push(line)
      } else {
        const prev = fromMap.get(ln)
        const changes = {}
        const FIELDS = ['description','quantity','wbs_code','ros_date','inspection_class','uom','item_type','item_ref']
        for (const f of FIELDS) {
          const pv = prev[f] == null ? null : String(prev[f])
          const nv = line[f] == null ? null : String(line[f])
          if (pv !== nv) changes[f] = { from: prev[f], to: line[f] }
        }
        if (Object.keys(changes).length > 0) {
          modified.push({ ...line, changes })
        } else {
          unchanged++
        }
      }
    }

    // Lines in 'from' not in 'to' — deleted
    for (const [ln, line] of fromMap) {
      if (!toMap.has(ln)) deleted.push(line)
    }

    res.json({ added, modified, deleted, unchanged })
  } catch (e) {
    console.error('GET /mto/:projectId/:mtoId/diff', e.message)
    res.status(500).json({ error: 'Failed to compute diff' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// LINE ITEM CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /:projectId/:mtoId/lines — add a line to current revision ───────────
router.post('/:projectId/:mtoId/lines', async (req, res) => {
  try {
    const [[mto]] = await db.query(
      `SELECT * FROM mto_registers WHERE id = ? AND project_id = ?`,
      [req.params.mtoId, req.params.projectId]
    )
    if (!mto) return res.status(404).json({ error: 'MTO not found' })

    const { wbs_code, quantity, uom, ros_date,
            inspection_class, vdrl_required, po_ref, status } = req.body
    const line_number = String(req.body.line_number ?? '').trim()
    const description = String(req.body.description ?? '').trim()
    // ─── Basic input checks before accepting ──────────────────────
    if (!line_number || !description) {
      return res.status(400).json({ error: 'Line number and description are required.' })
    }
    if (quantity != null && quantity !== '' && (isNaN(Number(quantity)) || Number(quantity) < 0)) {
      return res.status(400).json({ error: 'Quantity must be a non-negative number.' })
    }
    // Optional classification (Phase 2 1b) — validated as a pair, with the equipment rule; no carry-forward.
    const cls = resolveClassification({ type: req.body.item_type, ref: req.body.item_ref, wbs: wbs_code, ln: line_number, prev: null })
    if (cls.errors.length) return res.status(400).json({ error: cls.errors.join('; ') })
    // Reject a duplicate line number within the current revision (logical conflict).
    const [[dupLine]] = await db.query(
      'SELECT id FROM mto_lines WHERE mto_id = ? AND revision = ? AND line_number = ? AND is_deleted = 0',
      [mto.id, mto.current_revision, line_number])
    if (dupLine) return res.status(409).json({ error: `Line number "${line_number}" already exists in revision ${mto.current_revision}.` })

    const [result] = await db.query(
      `INSERT INTO mto_lines
       (mto_id, revision, line_number, wbs_code, description, quantity, uom,
        ros_date, inspection_class, vdrl_required, po_ref, status, item_type, item_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [mto.id, mto.current_revision, line_number, wbs_code || null, description,
       quantity || null, uom || null, ros_date || null,
       inspection_class || 'Class II', vdrl_required ? 1 : 0,
       po_ref || null, status || 'not-started', cls.item_type, cls.item_ref]
    )

    // Update line_count on register
    await db.query(
      `UPDATE mto_registers SET line_count = (
         SELECT COUNT(*) FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0
       ) WHERE id = ?`,
      [mto.id, mto.current_revision, mto.id]
    )

    const [[line]] = await db.query(`SELECT * FROM mto_lines WHERE id = ?`, [result.insertId])
    audit(req, 'CREATE', 'mto_line', result.insertId, null, line)
    res.status(201).json(line)
  } catch (e) {
    console.error('POST /mto/:projectId/:mtoId/lines', e.message)
    res.status(500).json({ error: 'Failed to add line' })
  }
})

// ─── PUT /:projectId/:mtoId/lines/:lineId — update a line ────────────────────
// line_number guard (§12): a line's key is (mto_id, line_number) across revisions, and tender
// reservations and PO consumption count on every row of the key, so a line_number change re-keys
// the row. A change (compared in SQL — collation-equal values are no change) on an unlocked line runs
// in one READ COMMITTED transaction: read the row, lock the old and new keys' rows (lockKeyRows — the
// lock reserve-lines and generate-po take), re-read the row under the lock (409 if its key changed),
// then 409 if the row isn't in its register's current revision, if any row of either key has a
// tender_line_items row (any status) or a po_lines row (source_mto_line_id), or if the new number
// already exists in that revision. Other edits, and the po-raised branch, take the existing path.
const LINE_CHANGED = 'line changed during the request — retry'
async function readLineForRenumber(conn, lineId, projectId, oldNumber) {
  const [[row]] = await conn.query(
    `SELECT l.id, l.mto_id, l.revision, l.line_number, r.current_revision,
            (l.revision = r.current_revision) AS is_current, (l.line_number = ?) AS same_key
       FROM mto_lines l JOIN mto_registers r ON r.id = l.mto_id
      WHERE l.id = ? AND r.project_id = ?`,
    [oldNumber, lineId, projectId])
  return row
}

router.put('/:projectId/:mtoId/lines/:lineId', async (req, res) => {
  try {
    const [[line]] = await db.query(
      `SELECT l.* FROM mto_lines l
       JOIN mto_registers r ON r.id = l.mto_id
       WHERE l.id = ? AND r.project_id = ?`,
      [req.params.lineId, req.params.projectId]
    )
    if (!line) return res.status(404).json({ error: 'Line not found' })

    // Locked lines (po-raised) can only update ros_date, vdrl_required, notes
    const locked = line.status === 'po-raised'
    const { line_number, wbs_code, description, quantity, uom, ros_date,
            inspection_class, vdrl_required, po_ref, status } = req.body

    // Classification (Phase 2 1b): item_type and item_ref change only when the key is in the body —
    // the current editor doesn't send them, so an absent key leaves the stored value. If either key
    // is present, the merged row is validated: a valid type, the pair together, at most 100
    // characters, and the equipment rule against the merged WBS. Editable on po-raised lines too
    // (TC 2026-10-03); quantity, description, UOM, WBS and line_number stay locked there.
    const body = req.body || {}
    const hasType = Object.prototype.hasOwnProperty.call(body, 'item_type')
    const hasRef  = Object.prototype.hasOwnProperty.call(body, 'item_ref')
    let clsSql = '', clsParams = []
    if (hasType || hasRef) {
      const cls = resolveClassification({
        type: hasType ? body.item_type : line.item_type,
        ref:  hasRef  ? body.item_ref  : line.item_ref,
        wbs:  locked ? line.wbs_code : (wbs_code ?? line.wbs_code),
        ln:   locked ? line.line_number : (line_number ?? line.line_number),
        prev: null,
      })
      if (cls.errors.length) return res.status(400).json({ error: cls.errors.join('; ') })
      clsSql = ', item_type = ?, item_ref = ?'; clsParams = [cls.item_type, cls.item_ref]
    } else if (!locked && line.item_type === 'equipment') {
      // No item keys sent: an unlocked equipment line still needs a WBS code and a tag on the merged
      // row (a locked line's WBS isn't editable).
      if (blankToNull(wbs_code ?? line.wbs_code) == null || blankToNull(line.item_ref) == null)
        return res.status(400).json({ error: `Line ${String(line_number ?? line.line_number ?? '').trim()}: equipment lines need a WBS code and an equipment tag` })
    }

    let sql, params
    if (locked) {
      // GOVERNANCE (baseline-major): qty/rev changes on a PO-raised line are intentionally
      // blocked here (only ros_date/vdrl_required editable). If this is ever unlocked, the
      // qty/rev edit MUST route through pending_changes confirmation (action='edit',
      // confirmer=project_manager) per the signed baseline-major definition — never write direct.
      sql = `UPDATE mto_lines SET ros_date = ?, vdrl_required = ?${clsSql} WHERE id = ?`
      params = [ros_date ?? line.ros_date, vdrl_required != null ? (vdrl_required ? 1 : 0) : line.vdrl_required, ...clsParams, line.id]
    } else {
      sql = `UPDATE mto_lines SET
               line_number = ?, wbs_code = ?, description = ?, quantity = ?, uom = ?,
               ros_date = ?, inspection_class = ?, vdrl_required = ?, po_ref = ?, status = ?${clsSql}
             WHERE id = ?`
      params = [
        line_number ?? line.line_number,
        wbs_code    ?? line.wbs_code,
        description ?? line.description,
        quantity    ?? line.quantity,
        uom         ?? line.uom,
        ros_date    ?? line.ros_date,
        inspection_class ?? line.inspection_class,
        vdrl_required != null ? (vdrl_required ? 1 : 0) : line.vdrl_required,
        po_ref      ?? line.po_ref,
        status      ?? line.status,
        ...clsParams,
        line.id
      ]
    }

    // line_number guard — only an unlocked line whose number actually changes
    let renumber = false
    const newNumber = line_number == null ? null : String(line_number)
    if (!locked && newNumber != null) {
      const [[cmp]] = await db.query('SELECT (line_number = ?) AS same FROM mto_lines WHERE id = ?', [newNumber, line.id])
      renumber = !cmp.same
    }
    if (renumber) {
      const conn = await db.getConnection()
      try {
        await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
        await conn.beginTransaction()
        const r0 = await readLineForRenumber(conn, line.id, req.params.projectId, line.line_number)
        if (!r0 || !r0.same_key) { await conn.rollback(); return res.status(409).json({ error: LINE_CHANGED }) }
        await lockKeyRows(conn, [{ mto_id: r0.mto_id, line_number: r0.line_number }, { mto_id: r0.mto_id, line_number: newNumber }])
        const r1 = await readLineForRenumber(conn, line.id, req.params.projectId, r0.line_number)   // under the lock
        if (!r1 || r1.mto_id !== r0.mto_id || !r1.same_key) { await conn.rollback(); return res.status(409).json({ error: LINE_CHANGED }) }
        if (!r1.is_current) {
          await conn.rollback()
          return res.status(409).json({ error: `Line ${r1.line_number} (mto_line_id ${r1.id}) is in revision ${r1.revision}, not the current revision ${r1.current_revision} — only current-revision lines can be renumbered` })
        }
        const [hist] = await conn.query(
          `SELECT k.line_number,
                  (SELECT COUNT(*) FROM tender_line_items t WHERE t.mto_line_id IN (SELECT x.id FROM mto_lines x WHERE x.mto_id = k.mto_id AND x.line_number = k.line_number)) AS reservations,
                  (SELECT COUNT(*) FROM po_lines p WHERE p.source_mto_line_id IN (SELECT x.id FROM mto_lines x WHERE x.mto_id = k.mto_id AND x.line_number = k.line_number)) AS po_lines
             FROM mto_lines k WHERE k.mto_id = ? AND k.line_number IN (?, ?)
            GROUP BY k.mto_id, k.line_number`,
          [r1.mto_id, r1.line_number, newNumber])
        const held = hist.filter(h => Number(h.reservations) > 0 || Number(h.po_lines) > 0)
        if (held.length) {
          await conn.rollback()
          return res.status(409).json({ error: `Line ${r1.line_number} can't be renumbered to ${newNumber}: ${held.map(h => `${h.line_number} has ${h.reservations} tender reservation(s) and ${h.po_lines} PO line(s)`).join('; ')} — renumber it through a new MTO revision instead` })
        }
        const [[dup]] = await conn.query(
          'SELECT id FROM mto_lines WHERE mto_id = ? AND revision = ? AND line_number = ? AND is_deleted = 0 AND id <> ?',
          [r1.mto_id, r1.revision, newNumber, r1.id])
        if (dup) { await conn.rollback(); return res.status(409).json({ error: `Line number "${newNumber}" already exists in revision ${r1.revision}.` }) }
        await conn.query(sql, params)
        await conn.commit()
      } catch (te) { await conn.rollback(); throw te } finally { conn.release() }
    } else {
      await db.query(sql, params)
    }
    const [[updated]] = await db.query(`SELECT * FROM mto_lines WHERE id = ?`, [line.id])
    audit(req, 'UPDATE', 'mto_line', line.id, line, updated)
    res.json(updated)
  } catch (e) {
    console.error('PUT /mto/:projectId/:mtoId/lines/:lineId', e.message)
    res.status(500).json({ error: 'Failed to update line' })
  }
})

// ─── POST /:projectId/:mtoId/lines/:lineId/unraise/approve — un-raise a po-raised line (1f) ─────────────
// Sets a po-raised line back to not-started or rfq, only when nothing backs the flag: no purchase order
// whose po_number matches (trimmed, case-insensitive) any non-empty po_ref on the key's po-raised rows,
// no po_lines row and no converted or partial_released reservation on any row of the key (active
// reservations don't block). Every non-deleted po-raised row of the key is updated and its po_ref cleared.
// The /approve segment makes enforce require can_approve; the handler checks it again with the same
// lookup. One READ COMMITTED transaction: the key rows are locked (lockKeyRows) and re-read, and the
// audit row is inserted on the same connection, so a failed audit rolls the change back.
const UNRAISE_TARGETS = new Set(['not-started', 'rfq'])
const UNRAISE_REASON_MIN = 10, UNRAISE_REASON_MAX = 1000   // characters, after trimming
router.post('/:projectId/:mtoId/lines/:lineId/unraise/approve', async (req, res) => {
  const target = req.body?.status
  const reason = String(req.body?.reason ?? '').trim()
  if (!UNRAISE_TARGETS.has(target)) return res.status(400).json({ error: "status must be 'not-started' or 'rfq'" })
  const reasonLength = Array.from(reason).length
  if (reasonLength < UNRAISE_REASON_MIN || reasonLength > UNRAISE_REASON_MAX)
    return res.status(400).json({ error: `The reason must be ${UNRAISE_REASON_MIN} to ${UNRAISE_REASON_MAX.toLocaleString('en-US')} characters (it is ${reasonLength})` })
  let conn
  try {
    if (!(await hasPermission(req.user, 'mto', 'can_approve'))) return res.status(403).json({ error: 'Your role cannot un-raise a PO Raised line' })
    const readLine = c => c.query(
      `SELECT l.id, l.mto_id, l.revision, l.line_number, l.status, l.po_ref, l.is_deleted, r.current_revision
         FROM mto_lines l JOIN mto_registers r ON r.id = l.mto_id
        WHERE l.id = ? AND l.mto_id = ? AND r.project_id = ?`,
      [req.params.lineId, req.params.mtoId, req.params.projectId])
    const [[l0]] = await readLine(db)
    if (!l0 || l0.is_deleted) return res.status(404).json({ error: 'Line not found' })

    conn = await db.getConnection()
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
    await conn.beginTransaction()
    const refuse = async (body) => { await conn.rollback(); return res.status(409).json(body) }
    await lockKeyRows(conn, [{ mto_id: l0.mto_id, line_number: l0.line_number }])
    const [[l1]] = await readLine(conn)   // under the lock
    if (!l1 || l1.is_deleted || l1.mto_id !== l0.mto_id || l1.line_number !== l0.line_number) return refuse({ code: 'line_changed', error: LINE_CHANGED })
    if (l1.revision !== l1.current_revision) return refuse({ code: 'not_current', error: `Line ${l1.line_number} (mto_line_id ${l1.id}) is in revision ${l1.revision}, not the current revision ${l1.current_revision}` })
    if (l1.status !== 'po-raised') return refuse({ code: 'not_po_raised', error: `Line ${l1.line_number} is ${l1.status}, not PO Raised` })

    const [keyRows] = await conn.query(
      'SELECT id, revision, status, po_ref, is_deleted FROM mto_lines WHERE mto_id = ? AND line_number = ? ORDER BY id', [l1.mto_id, l1.line_number])
    const refs = [...new Set(keyRows.filter(k => k.status === 'po-raised').map(k => String(k.po_ref ?? '').trim()).filter(Boolean))]
    if (refs.length) {
      const [pos] = await conn.query('SELECT po_number FROM purchase_orders WHERE po_number IN (?) ORDER BY po_number', [refs])
      if (pos.length) return refuse({ code: 'po_exists', po_numbers: pos.map(p => p.po_number),
        error: `Line ${l1.line_number} is backed by ${pos.length > 1 ? 'purchase orders' : 'purchase order'} ${pos.map(p => p.po_number).join(', ')} — it can't be un-raised` })
    }
    const [[links]] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM po_lines p JOIN mto_lines k ON k.id = p.source_mto_line_id WHERE k.mto_id = ? AND k.line_number = ?) AS po_lines,
              (SELECT COUNT(*) FROM tender_line_items t JOIN mto_lines k ON k.id = t.mto_line_id
                WHERE k.mto_id = ? AND k.line_number = ? AND t.status IN ('converted','partial_released')) AS converted`,
      [l1.mto_id, l1.line_number, l1.mto_id, l1.line_number])
    if (Number(links.po_lines)) return refuse({ code: 'po_line_link', error: `Line ${l1.line_number} has ${links.po_lines} PO line(s) — it can't be un-raised` })
    if (Number(links.converted)) return refuse({ code: 'converted_reservation', error: `Line ${l1.line_number} has ${links.converted} converted or partially released tender reservation(s) — it can't be un-raised` })

    const raised = keyRows.filter(k => !k.is_deleted && k.status === 'po-raised')
    await conn.query('UPDATE mto_lines SET status = ?, po_ref = NULL WHERE id IN (?)', [target, raised.map(k => k.id)])
    const resource = (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/)/, '')
    await conn.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id,
          before_value, after_value, reason_category, reason_detail, resource, ip)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.id, 'UNRAISE', 'mto_line', l1.id, Number(req.params.projectId) || null,
       JSON.stringify({ rows: raised.map(k => ({ id: k.id, revision: k.revision, status: k.status, po_ref: k.po_ref })) }),
       JSON.stringify({ status: target, po_ref: null, rows: raised.length }),
       'unraise', reason, resource, req.ip ?? null])
    await conn.commit()
    const [[line]] = await db.query('SELECT * FROM mto_lines WHERE id = ?', [l1.id])
    res.json({ line, updated_rows: raised.length, po_ref_cleared: true })
  } catch (e) {
    if (conn) { try { await conn.rollback() } catch (_) { /* already rolled back */ } }
    console.error('POST /mto/:projectId/:mtoId/lines/:lineId/unraise/approve', e.message)
    dbError(res, e, 'Un-raise failed')
  } finally {
    if (conn) conn.release()
  }
})

// ─── DELETE /:projectId/:mtoId/lines/:lineId — soft-delete a line ─────────────
// DELETE guard (§15 a): deleting a key's current row makes the line "removed" — its availability is
// null, and reserve-lines and generate-po refuse every tender that holds it. After the po-raised 403,
// one READ COMMITTED transaction: read the row, lock its key's rows (lockKeyRows), re-read under the
// lock (404 if already deleted, 409 if its key changed), then 409 if any row of the key has a
// tender_line_items row that is active, converted or partial_released, or any po_lines row
// (source_mto_line_id). Released-only history is allowed — it strands nothing. Then the soft delete
// and the register's line_count refresh, in the same transaction.
router.delete('/:projectId/:mtoId/lines/:lineId', async (req, res) => {
  try {
    const [[line]] = await db.query(
      `SELECT l.* FROM mto_lines l
       JOIN mto_registers r ON r.id = l.mto_id
       WHERE l.id = ? AND r.project_id = ?`,
      [req.params.lineId, req.params.projectId]
    )
    if (!line) return res.status(404).json({ error: 'Line not found' })
    if (line.status === 'po-raised') {
      return res.status(403).json({ error: 'Cannot delete a line with a raised PO' })
    }

    const conn = await db.getConnection()
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
      await conn.beginTransaction()
      const readRow = oldNumber => conn.query(
        `SELECT l.id, l.mto_id, l.revision, l.line_number, l.is_deleted, (l.line_number = ?) AS same_key
           FROM mto_lines l JOIN mto_registers r ON r.id = l.mto_id
          WHERE l.id = ? AND r.project_id = ?`,
        [oldNumber, line.id, req.params.projectId])
      const [[r0]] = await readRow(line.line_number)
      if (!r0) { await conn.rollback(); return res.status(404).json({ error: 'Line not found' }) }
      await lockKeyRows(conn, [{ mto_id: r0.mto_id, line_number: r0.line_number }])
      const [[r1]] = await readRow(r0.line_number)   // under the lock
      if (!r1 || r1.is_deleted) { await conn.rollback(); return res.status(404).json({ error: 'Line not found' }) }
      if (r1.mto_id !== r0.mto_id || !r1.same_key) { await conn.rollback(); return res.status(409).json({ error: LINE_CHANGED }) }
      const [held] = await conn.query(
        `SELECT t.status, tp.approval_status, COUNT(*) AS n
           FROM tender_line_items t
           JOIN mto_lines k ON k.id = t.mto_line_id
           JOIN tender_packages tp ON tp.id = t.tender_id
          WHERE k.mto_id = ? AND k.line_number = ? AND t.status IN ('active','converted','partial_released')
          GROUP BY t.status, tp.approval_status`,
        [r1.mto_id, r0.line_number])
      const [[pol]] = await conn.query(
        `SELECT COUNT(*) AS n FROM po_lines p JOIN mto_lines k ON k.id = p.source_mto_line_id
          WHERE k.mto_id = ? AND k.line_number = ?`,
        [r1.mto_id, r0.line_number])
      const count = (st, appr) => held.filter(h => h.status === st && (appr == null || (h.approval_status === 'approved') === appr)).reduce((s, h) => s + Number(h.n), 0)
      const active = count('active'), activeApproved = count('active', true), converted = count('converted'), partial = count('partial_released'), poLines = Number(pol.n)
      if (active + converted + partial + poLines > 0) {
        await conn.rollback()
        const advice = []
        if (active > activeApproved) advice.push('Cancelling or rejecting a tender releases its active reservations.')
        if (activeApproved) advice.push(`${activeApproved} active reservation(s) belong to an approved tender, which can't be cancelled or rejected until its recommendation is recomputed.`)
        if (converted + partial + poLines) advice.push("A line on a PO can't be removed while the PO exists.")
        return res.status(409).json({ error: `Line ${r0.line_number} can't be deleted: it has ${active} active, ${converted} converted and ${partial} partially released tender reservation(s) and ${poLines} PO line(s). ${advice.join(' ')}` })
      }
      await conn.query(`UPDATE mto_lines SET is_deleted = 1 WHERE id = ?`, [line.id])
      // Refresh line_count
      await conn.query(
        `UPDATE mto_registers SET line_count = (
           SELECT COUNT(*) FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0
         ) WHERE id = ?`,
        [r1.mto_id, r1.revision, r1.mto_id]
      )
      await conn.commit()
    } catch (te) { await conn.rollback(); throw te } finally { conn.release() }

    audit(req, 'DELETE', 'mto_line', line.id, line, null)
    res.json({ ok: true })
  } catch (e) {
    console.error('DELETE /mto/:projectId/:mtoId/lines/:lineId', e.message)
    res.status(500).json({ error: 'Failed to delete line' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD NEW REVISION
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /:projectId/:mtoId/upload — upload XLSX/CSV as new revision ─────────
// Expected columns (case-insensitive):
//   line_number, wbs_code, description, quantity, uom, ros_date,
//   inspection_class, vdrl_required, po_ref, status
router.post('/:projectId/:mtoId/upload', upload.single('file'), async (req, res) => {
  // ─── BUG-1 & BUG-2: extract revision early for duplicate check + dry-run ─────
  const revision = req.body.revision
  const mtoId    = Number(req.params.mtoId)
  try {
    const [[mto]] = await db.query(
      `SELECT * FROM mto_registers WHERE id = ? AND project_id = ?`,
      [mtoId, req.params.projectId]
    )
    if (!mto) return res.status(404).json({ error: 'MTO not found' })

    const newRev = revision || nextRevision(mto.current_revision)
    const notes  = req.body.notes || `Rev ${newRev} upload`
    const dryRun = req.query.dryRun === 'true'

    // ─── Reject duplicate or out-of-order revisions before any file parsing ───
    // Revisions only move FORWARD: an upload must be a LATER letter than every
    // revision already on record. This blocks (a) re-uploading an existing letter
    // and (b) loading an older revision after a newer one — which would otherwise
    // regress current_revision and the live line set. We compare against the
    // highest existing revision (current_revision can be stale).
    const [allRevs] = await db.query('SELECT revision FROM mto_revisions WHERE mto_id = ?', [mtoId])
    // A freshly-created MTO seeds its initial revision with no lines; the very
    // first upload populates THAT revision rather than adding a new one. "Initial
    // population" therefore means the MTO has NO lines anywhere yet — once it holds
    // any lines, every upload is a genuine new revision and must pass the duplicate,
    // ordering AND scheme checks below (a per-LABEL 0-line test let a brand-new label
    // — including a backwards or scheme-mismatched one — skip all of them).
    const [[{ c: totalLines }]] = await db.query(
      'SELECT COUNT(*) c FROM mto_lines WHERE mto_id=? AND is_deleted=0', [mtoId])
    const isInitialPopulation = totalLines === 0
    // Format-gate the incoming revision first (clear 422 before any ordering work).
    const upRevFmtErr = validateRevisionFormat(newRev)
    if (upRevFmtErr) return res.status(422).json({ error: upRevFmtErr })
    // Duplicate: case-insensitive label match (avoids relying on the comparator for ==).
    const newU = String(newRev).trim().toUpperCase()
    if (!isInitialPopulation && allRevs.some(r => String(r.revision).trim().toUpperCase() === newU)) {
      return res.status(409).json({
        error: `Revision ${newRev} already exists for this MTO. Upload a new revision number.`
      })
    }
    // Find the latest existing rev with the tolerant legacy compare (legacy data may
    // hold mixed schemes; this discovery must never throw). The NEW rev is then judged
    // against it by the strict rule (compareRevisions surfaces scheme/format as 422).
    const latest = allRevs.reduce((a, r) => (a === '' || compareRev(r.revision, a) > 0) ? r.revision : a, '')
    if (!isInitialPopulation && latest) {
      let cmp
      try { cmp = compareRevisions(newRev, latest) }
      catch (e) {
        if (e instanceof RevisionError && e.code === 'SCHEME')
          return res.status(422).json({ error: `New revision "${newRev}" doesn't match this MTO's revision scheme (latest is ${latest}).` })
        if (e instanceof RevisionError) return res.status(422).json({ error: e.message })
        throw e
      }
      if (cmp <= 0) return res.status(409).json({
        error: `Revision must be later than the current revision ${latest}.`
      })
    }

    { const fe = fileNotEmpty(req.file); if (fe) return res.status(400).json({ error: fe }) }

    // ─── Parse workbook ───────────────────────────────────────────
    const wb   = readWorkbook(req.file.buffer, req.file.originalname, { type: 'buffer', cellDates: true })
    const ws   = wb.Sheets[wb.SheetNames.includes('MTO Lines') ? 'MTO Lines' : wb.SheetNames[0]]
    function norm(key) { return String(key).trim().toLowerCase().replace(/\s+/g, '_') }
    // Locate the real header row (past the title banner), then parse from there.
    const aoaU = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
    let hdrIdxU = aoaU.findIndex(r => Array.isArray(r)
      && r.some(c => norm(c ?? '') === 'description')
      && r.some(c => /^line_(number|#|no)$/.test(norm(c ?? ''))))
    if (hdrIdxU < 0) hdrIdxU = 7
    const rows = XLSX.utils.sheet_to_json(ws, { range: hdrIdxU, defval: null })

    if (!rows.length) return res.status(400).json({ error: 'File is empty or unreadable' })

    // ─── Normalise header keys ─────────────────────────────────────
    const lines = rows.map(row => {
      const n = {}
      for (const [k, v] of Object.entries(row)) n[norm(k)] = v
      return n
    })

    // ─── Reject duplicate line numbers within the file ────────────
    // Over the rows the insert loop keeps (line number + description, not an example row),
    // compared trimmed and the way the column's collation would (case- and accent-insensitive).
    // Runs before anything is written, for dryRun and real uploads alike. Row numbers are the
    // sheet's own (SheetJS __rowNum__ is 0-based).
    {
      const sameLine = new Intl.Collator('en', { sensitivity: 'base' })
      const kept = []
      lines.forEach((l, i) => {
        if (!l.line_number || !l.description) return
        const note = String(l.notes || '').toLowerCase()
        if (note.includes('delete before uploading') || note.includes('example')) return
        kept.push({ ln: String(l.line_number).trim(), row: rows[i].__rowNum__ + 1 })
      })
      const groups = []
      for (const k of kept) {
        const g = groups.find(x => sameLine.compare(x.ln, k.ln) === 0)
        if (g) g.rows.push(k.row); else groups.push({ ln: k.ln, rows: [k.row] })
      }
      const dups = groups.filter(g => g.rows.length > 1)
        .flatMap(g => g.rows.slice(1).map(r => `Duplicate line number "${g.ln}" on rows ${g.rows[0]} and ${r}`))
      if (dups.length) return res.status(400).json({ error: dups.join('; ') })
    }

    // ─── Classification (Phase 2 sub-step 1b) ─────────────────────
    // Per kept row: the file's Item Type / Commodity Code / Equipment Tag cells or — both blank — the
    // pair carried from the current revision's non-deleted row with the same line number. Every error
    // is returned (400) before anything is written, for dryRun and real uploads alike. The resolved
    // values feed the no-change check and the insert.
    {
      const [prevRows] = await db.query(
        'SELECT line_number, item_type, item_ref FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0',
        [mtoId, mto.current_revision])
      const prev = new Map(prevRows.map(p => [lineKey(p.line_number), p]))
      const clsErrors = []
      lines.forEach((l, i) => {
        const note = String(l.notes || '').toLowerCase()
        if (!l.line_number || !l.description || note.includes('delete before uploading') || note.includes('example')) {
          l.item_type = null; l.item_ref = null; return
        }
        const raw = rawClassification(rows[i])
        const c = resolveClassification({ type: raw.type, ref: raw.ref, wbs: l.wbs_code, ln: l.line_number, prev })
        clsErrors.push(...c.errors); l.item_type = c.item_type; l.item_ref = c.item_ref
      })
      if (clsErrors.length) return res.status(400).json({ error: clsErrors.join('; ') })
    }

    // ─── ROS dates ────────────────────────────────────────────────
    // Over the rows the insert loop keeps: a date-shaped value that isn't a real calendar date (or a
    // year outside 1900–2100) is refused (400) with the sheet's row numbers, before anything is
    // written, for dryRun and real uploads alike. Text that isn't a date (TBA, TBC) stays blank and
    // is reported in dateWarnings, without blocking.
    const dateWarnings = []
    {
      const shown = v => v instanceof Date
        ? (isNaN(v.getTime()) ? 'invalid date' : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`)
        : String(v)
      const invalidDates = []
      lines.forEach((l, i) => {
        if (!l.line_number || !l.description) return
        const note = String(l.notes || '').toLowerCase()
        if (note.includes('delete before uploading') || note.includes('example')) return
        const kind = parseCalendarDate(l.ros_date, XLSX).kind
        if (kind !== 'invalid' && kind !== 'unreadable') return
        const entry = { row: rows[i].__rowNum__ + 1, line_number: String(l.line_number).trim(), value: shown(l.ros_date) }
        if (kind === 'invalid') invalidDates.push(entry); else dateWarnings.push(entry)
      })
      if (invalidDates.length) {
        const first = invalidDates.slice(0, 10).map(x => `Row ${x.row}: ROS date '${x.value}' is not a valid date (use DD/MM/YYYY or YYYY-MM-DD)`)
        const more = invalidDates.length - first.length
        return res.status(400).json({ error: first.join('; ') + (more > 0 ? `; and ${more} more` : ''), invalid_dates: invalidDates.slice(0, 500) })
      }
    }

    // ─── Reject a no-change re-upload ─────────────────────────────
    // An MTO whose content is identical to the current revision (only the
    // version differs) is meaningless — prompt and reject rather than create a
    // duplicate revision. Compared against the live (current) revision's lines.
    const [curLines] = await db.query(
      'SELECT line_number, description, quantity, uom, wbs_code, ros_date, inspection_class, vdrl_required, item_type, item_ref, status, po_ref FROM mto_lines WHERE mto_id=? AND revision=? AND is_deleted=0',
      [mtoId, mto.current_revision])
    if (sameMtoContent(lines, curLines)) {
      return res.status(409).json({
        error: `This upload is identical to the current revision (${mto.current_revision}) — nothing has changed. Edit the take-off before uploading a new revision.`
      })
    }

    // ─── BUG-2: locked-line conflict detection ────────────────────
    const [lockedLines] = await db.query(
      'SELECT line_number, description, quantity, uom, wbs_code FROM mto_lines WHERE mto_id = ? AND revision = ? AND status = ? AND is_deleted = 0',
      [mtoId, mto.current_revision, 'po-raised']
    )
    // Compared as stored: the line by trimmed, lowercased number (the key is collation-equal in SQL);
    // quantity parsed as the insert does (blank or non-numeric = null) and compared at the column's
    // scale, DECIMAL(15,3); description, UOM and WBS trimmed and exact (blank = null).
    const qty3 = v => { const s = String(v ?? '').trim(); const n = s === '' ? NaN : parseFloat(s); return isNaN(n) ? null : Math.round(n * 1000) }
    const txt  = v => String(v ?? '').trim()
    const uploadMap = new Map(lines.map(l => [lineKey(l.line_number), l]))
    const conflicts = []
    for (const locked of lockedLines) {
      const uploaded = uploadMap.get(lineKey(locked.line_number))
      if (!uploaded) continue
      const changed = {}
      if (qty3(uploaded.quantity) !== qty3(locked.quantity)) changed.quantity = { locked: locked.quantity, uploaded: uploaded.quantity }
      if (txt(uploaded.description) !== txt(locked.description)) changed.description = { locked: locked.description, uploaded: uploaded.description }
      if (txt(uploaded.uom) !== txt(locked.uom)) changed.uom = { locked: locked.uom, uploaded: uploaded.uom }
      if (txt(uploaded.wbs_code) !== txt(locked.wbs_code)) changed.wbs_code = { locked: locked.wbs_code, uploaded: uploaded.wbs_code }
      if (Object.keys(changed).length > 0) conflicts.push({ line_number: locked.line_number, changes: changed })
    }

    // The kept file rows (the insert loop's filter), keyed by lineKey.
    const keptRows = new Map()
    let keptLines = 0
    for (const l of lines) {
      if (!l.line_number || !l.description) continue
      const note = String(l.notes || '').toLowerCase()
      if (note.includes('delete before uploading') || note.includes('example')) continue
      keptRows.set(lineKey(l.line_number), l); keptLines++
    }

    // Summary for dry-run or conflict reporting (Phase 2 sub-step 1d): the kept rows against the
    // current revision's non-deleted rows, by key; modified = a different signature (without
    // line_number, with the resolved classification) or a line number that differs exactly once
    // trimmed (a case-only renumber). totalLines counts every parsed row.
    const curByKey = new Map(curLines.map(c => [lineKey(c.line_number), c]))
    let newLines = 0, modifiedLines = 0
    for (const [key, l] of keptRows) {
      const c = curByKey.get(key)
      if (!c) newLines++
      else if (lineSignature(l, false) !== lineSignature(c, false) || String(l.line_number).trim() !== String(c.line_number).trim()) modifiedLines++
    }
    const summary = {
      totalLines:    lines.length,
      keptLines,
      skippedRows:   lines.length - keptLines,
      newLines,
      modifiedLines,
      deletedLines:  [...curByKey.keys()].filter(k => !keptRows.has(k)).length,
      conflicts:     conflicts.length,
    }

    // ─── Held lines (Phase 2 sub-step 1c) ─────────────────────────
    // A line is held when any row of its key has an active, converted or partial_released reservation
    // or a PO line (source_mto_line_id); committed = active reserved + PO quantity across the key. Two
    // grouped queries for the register, keyed by lineKey. Dropped: a held current-revision line not
    // among the kept file rows (the insert loop's filter) — a real upload needs ack_held_lines. Lowered:
    // a kept row below the committed total (parsed as the insert does, 3 decimals) — a warning only.
    const [heldResv] = await db.query(
      `SELECT k.line_number, SUM(CASE WHEN t.status = 'active' THEN t.qty_reserved ELSE 0 END) AS active_qty,
              GROUP_CONCAT(DISTINCT tp.ref ORDER BY tp.ref) AS tender_refs,
              GROUP_CONCAT(DISTINCT CASE WHEN tp.approval_status = 'approved' THEN tp.ref END ORDER BY tp.ref) AS approved_refs
         FROM mto_lines k
         JOIN tender_line_items t ON t.mto_line_id = k.id AND t.status IN ('active','converted','partial_released')
         JOIN tender_packages tp ON tp.id = t.tender_id
        WHERE k.mto_id = ? GROUP BY k.line_number`, [mtoId])
    const [heldPo] = await db.query(
      `SELECT k.line_number, SUM(p.qty) AS po_qty, GROUP_CONCAT(DISTINCT po.po_number ORDER BY po.po_number) AS po_numbers
         FROM mto_lines k
         JOIN po_lines p ON p.source_mto_line_id = k.id
         JOIN purchase_orders po ON po.id = p.po_id
        WHERE k.mto_id = ? GROUP BY k.line_number`, [mtoId])
    const held = new Map()
    const heldOf = ln => { const key = lineKey(ln); if (!held.has(key)) held.set(key, { active: 0, po: 0, refs: [], approved: [], pos: [] }); return held.get(key) }
    for (const r of heldResv) Object.assign(heldOf(r.line_number), { active: Number(r.active_qty) || 0, refs: r.tender_refs ? r.tender_refs.split(',') : [], approved: r.approved_refs ? r.approved_refs.split(',') : [] })
    for (const r of heldPo) Object.assign(heldOf(r.line_number), { po: Number(r.po_qty) || 0, pos: r.po_numbers ? r.po_numbers.split(',') : [] })
    const held_warnings = []
    if (held.size) {
      const q3 = v => Math.round(v * 1000)
      const fq = v => String(q3(v) / 1000)
      const [curKeys] = await db.query(
        'SELECT line_number FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0', [mtoId, mto.current_revision])
      const holders = h => [
        h.refs.length && `${h.refs.length > 1 ? 'tenders' : 'tender'} ${h.refs.join(', ')} (${fq(h.active)} reserved)`,
        h.pos.length && `${h.pos.length > 1 ? 'POs' : 'PO'} ${h.pos.join(', ')} (${fq(h.po)} on PO lines)`,
      ].filter(Boolean).join(' and ')
      for (const c of curKeys) {
        const h = held.get(lineKey(c.line_number))
        if (!h || keptRows.has(lineKey(c.line_number))) continue
        let message = `Line ${c.line_number} is held by ${holders(h)} but is not in this file — it will be removed from revision ${newRev}.`
        for (const ref of h.approved) message += ` Tender ${ref} is approved — Generate PO will be refused until this line is back in a revision.`
        held_warnings.push({ line_number: c.line_number, type: 'dropped', committed: q3(h.active + h.po) / 1000, message })
      }
      for (const [key, l] of keptRows) {
        const h = held.get(key)
        if (!h) continue
        const committed = h.active + h.po
        const qty = (l.quantity != null && l.quantity !== '' && !isNaN(parseFloat(l.quantity))) ? parseFloat(l.quantity) : null
        if (q3(qty ?? 0) >= q3(committed)) continue
        const parts = [
          h.refs.length && `${fq(h.active)} reserved on ${h.refs.length > 1 ? 'tenders' : 'tender'} ${h.refs.join(', ')}`,
          h.pos.length && `${fq(h.po)} on PO lines ${h.pos.join(', ')}`,
        ].filter(Boolean).join('; ')
        held_warnings.push({ line_number: String(l.line_number), type: 'lowered', committed: q3(committed) / 1000,
          message: `Line ${l.line_number}: quantity ${qty == null ? '(blank)' : fq(qty)} is below the ${fq(committed)} committed (${parts}).` })
      }
    }
    // Dropped po-raised lines (1d): a current po-raised line missing from the kept rows, unless it is
    // already warned as a dropped held line. They need the acknowledgement too.
    const warnedDropped = new Set(held_warnings.filter(w => w.type === 'dropped').map(w => lineKey(w.line_number)))
    for (const [key, c] of curByKey) {
      if (c.status !== 'po-raised' || keptRows.has(key) || warnedDropped.has(key)) continue
      held_warnings.push({ line_number: c.line_number, type: 'dropped_locked', po_ref: c.po_ref ?? null,
        message: `Line ${c.line_number} is po-raised on PO ${c.po_ref || '(no PO reference)'} but is not in this file — it will be removed from revision ${newRev}.` })
    }
    const requires_ack = held_warnings.some(w => w.type === 'dropped' || w.type === 'dropped_locked')

    // ─── BUG-2: dry-run returns preview without inserting ─────────
    if (dryRun) {
      return res.json({ dryRun: true, summary, conflicts, held_warnings, requires_ack, dateWarnings })
    }

    // ─── BUG-2: conflict guard — block upload if locked lines would change ─────
    if (conflicts.length > 0) {
      return res.status(422).json({
        error: `${conflicts.length} locked (PO-raised) line(s) would be modified. Resolve conflicts first.`,
        conflicts,
      })
    }

    // ─── 1c: dropping a held line needs the acknowledgement ───────
    if (requires_ack && !['1', 'true'].includes(String(req.body?.ack_held_lines ?? '').trim().toLowerCase())) {
      return res.status(409).json({
        error: `${held_warnings.filter(w => w.type === 'dropped' || w.type === 'dropped_locked').length} line(s) held by a tender or PO would be removed by this revision — review the warnings, then upload again with the acknowledgement to proceed.`,
        held_warnings, requires_ack: true,
      })
    }

    // ─── Persist the uploaded spreadsheet ─────────────────────────
    // The buffer was parsed into lines above; we now also keep the original
    // file on disk so the revision is downloadable as-submitted from the
    // Document Inbox (previously the buffer was discarded after parsing).
    const mtoDir = path.join(__dirname, '..', 'uploads', 'mto-revisions')
    const safeName   = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storedName = `${Date.now()}_${safeName}`
    // Blob migration: persist to blob (key) or disk (legacy relative shape — unchanged).
    const { value: relPath } = await blobStore.persist({
      key: blobStore.keyFor('mto', storedName),   // module key matches documents.js RESOLVERS
      diskAbsPath: path.join(mtoDir, storedName), buffer: req.file.buffer, contentType: req.file.mimetype,
      diskValue: path.join('uploads', 'mto-revisions', storedName),
    })

    // ─── Revision record ──────────────────────────────────────────
    // Initial population fills the seeded row in place; a new revision inserts.
    let revRowId
    if (isInitialPopulation) {
      const [[seed]] = await db.query('SELECT id FROM mto_revisions WHERE mto_id=? AND revision=? ORDER BY id LIMIT 1', [mto.id, newRev])
      if (seed) {
        await db.query('UPDATE mto_revisions SET uploaded_by=?, notes=?, line_count=? WHERE id=?', [req.user.id, notes, lines.length, seed.id])
        revRowId = seed.id
      }
    }
    if (revRowId == null) {
      const [revIns] = await db.query(
        `INSERT INTO mto_revisions (mto_id, revision, uploaded_by, notes, line_count)
         VALUES (?, ?, ?, ?, ?)`,
        [mto.id, newRev, req.user.id, notes, lines.length]
      )
      revRowId = revIns.insertId
    }
    // Record the stored file — gated on the migration so this never regresses
    // the upload flow if the file columns aren't present yet (see schemaColumns).
    if (await fileColumnsReady('mto_revisions')) {
      await db.query(
        `UPDATE mto_revisions SET file_name=?, file_path=?, file_size=?, mime_type=? WHERE id=?`,
        [req.file.originalname, relPath, req.file.size, req.file.mimetype, revRowId])
    }

    // ─── Insert lines ──────────────────────────────────────────────
    const upDate = (v) => parseSheetDate(v, XLSX)
    let imported = 0
    for (const l of lines) {
      if (!l.line_number || !l.description) continue
      const note = String(l.notes || '').toLowerCase()
      if (note.includes('delete before uploading') || note.includes('example')) continue   // skip template examples
      const qty = (l.quantity != null && l.quantity !== '' && !isNaN(parseFloat(l.quantity))) ? parseFloat(l.quantity) : null
      // 1e: status and po_ref carry from the current revision's row with the same key (the curLines read);
      // a new line starts not-started with no PO. The file's status and po_ref columns are ignored.
      const carried = curByKey.get(lineKey(l.line_number))
      // inspection_class / vdrl_required omitted — DB defaults apply (removed from MTO input).
      await db.query(
        `INSERT INTO mto_lines
         (mto_id, revision, line_number, wbs_code, description, quantity, uom, ros_date, po_ref, status, item_type, item_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mto.id, newRev,
         String(l.line_number),
         l.wbs_code     || null,
         String(l.description),
         qty,
         l.uom          || null,
         upDate(l.ros_date),
         carried ? carried.po_ref : null,
         carried ? carried.status : 'not-started',
         l.item_type    ?? null,
         l.item_ref     ?? null]
      )
      imported++
    }

    // ─── Reconcile line counts + promote current revision ─────────
    await db.query('UPDATE mto_revisions SET line_count = ? WHERE id = ?', [imported, revRowId])
    await db.query(
      `UPDATE mto_registers
       SET current_revision = ?, line_count = ?, updated_at = NOW()
       WHERE id = ?`,
      [newRev, imported, mto.id]
    )

    audit(req, 'UPLOAD_REVISION', 'mto_register', mto.id, { revision: mto.current_revision }, { revision: newRev })
    res.json({ ok: true, revision: newRev, linesImported: imported, held_warnings, dateWarnings })
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message })
    console.error('POST /mto/:projectId/:mtoId/upload', e.message)
    dbError(res, e, 'Upload failed')
  }
})

module.exports = router
