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
const { fileNotEmpty } = require('../utils/validate')

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
router.use(authenticateToken)
router.use(require('../middleware/permissions').denyReadOnly) // C-a: viewer/auditor barred from writes
router.use(require('../middleware/permissions').enforce('mto')) // C-b2: matrix gate (engineering_lead/admin write; PM confirm)
router.use(require('../middleware/permissions').queueGate(/\/mto\/\d+$|\/mto\/\d+\/\d+\/lines$/, /\/mto\/\d+\/\d+\/lines\/\d+$/)) // C-c D1: proposers (engineering_lead) must use approval queue for register/line create+delete; admin direct

// ─── FILE UPLOAD CONFIG ───────────────────────────────────────────────────────
// New-revision files accepted in memory buffer — parsed then discarded.
const { fileFilter } = require('../utils/upload')
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

// True when an uploaded line set is content-identical to an existing revision's
// lines (so a "new" revision would change nothing). Compares the substantive MTO
// fields, normalised the way they'd be stored; order-independent.
function sameMtoContent(uploaded, existing) {
  const vd = v => (v === 1 || v === '1' || v === true || /^(y|yes|true)$/i.test(String(v ?? ''))) ? 1 : 0
  const ymd = d => {            // local Y-M-D so a stored time/TZ doesn't shift the day
    if (!d) return ''
    const dt = new Date(d)
    return isNaN(dt) ? String(d).slice(0, 10)
      : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  }
  const sig = l => [
    String(l.line_number ?? '').trim(),
    String(l.description ?? '').trim().toLowerCase(),
    String(Number(l.quantity) || 0),
    String(l.uom ?? '').trim().toLowerCase(),
    String(l.wbs_code ?? '').trim().toLowerCase(),
    ymd(l.ros_date),
    String(l.inspection_class || 'Class II').trim().toLowerCase(),
    vd(l.vdrl_required),
  ].join('|')
  const valid = a => a.filter(l => l.line_number != null && l.line_number !== '' && l.description)
  const u = valid(uploaded).map(sig).sort()
  const e = valid(existing).map(sig).sort()
  if (u.length === 0 || u.length !== e.length) return false
  return u.every((s, i) => s === e[i])
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

  const ws = wb.addWorksheet('MTO Lines', { views: [{ state: 'frozen', ySplit: 3 }] })
  ws.columns = [
    { key: 'line_number', width: 12 }, { key: 'wbs_code', width: 14 },
    { key: 'description', width: 52 }, { key: 'quantity', width: 10 },
    { key: 'uom', width: 8 }, { key: 'ros_date', width: 14 },
    { key: 'inspection_class', width: 18 }, { key: 'vdrl_required', width: 16 },
    { key: 'heat_number_required', width: 20 }, { key: 'unit_rate', width: 12 },
    { key: 'total_value', width: 12 }, { key: 'notes', width: 30 },
  ]

  // Row 1: orange title banner
  ws.mergeCells('A1:L1')
  const titleCell = ws.getCell('A1')
  titleCell.value = 'QCO MMS — MTO Import Template'
  titleCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 13, name: 'Calibri' }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE84E0F' } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' }
  ws.getRow(1).height = 30

  // Row 2: spacer
  ws.getRow(2).height = 6

  // Row 3: column headers (dark blue background)
  const headers = ['Line Number','WBS Code','Description','Quantity','UOM','ROS Date','Inspection Class','VDRL Required','Heat Number Required','Unit Rate','Total Value','Notes']
  const headerRow = ws.getRow(3)
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF334155' } } }
  })
  headerRow.height = 22

  // Helper: grey italic for example rows
  function exStyle(cell) {
    cell.font = { italic: true, color: { argb: 'FF94a3b8' }, size: 10, name: 'Calibri' }
  }

  // Rows 4-6: example rows
  const examples = [
    ['L-001','02.01.01','HP Separator Vessel — 3-phase horizontal',1,'EA','31-Aug-2025','Class I','Y','Y','','','Delete before uploading'],
    ['L-002','02.02.01','Centrifugal Feed Pump P-101A',2,'EA','31-Oct-2025','Class II','N','N','','','Delete before uploading'],
    ['L-003','03.01.01','HV Cable 11kV 3C×150mm² XLPE',250,'m','15-Dec-2025','Class III','Y','N','','','Delete before uploading'],
  ]
  examples.forEach((ex, i) => {
    const row = ws.getRow(4 + i)
    ex.forEach((val, j) => { const c = row.getCell(j+1); c.value = val; exStyle(c) })
    row.height = 18
  })

  // Rows 7-53: blank data rows
  for (let r = 7; r <= 53; r++) ws.getRow(r).height = 18

  // ─── DROPDOWN VALIDATIONS (rows 4–500, showErrorMessage: false = guide only) ─
  // col E (5) — UOM
  ws.dataValidations.add('E4:E500', {
    type: 'list', allowBlank: true, showErrorMessage: false,
    formulae: ['"EA,NR,KG,T,M,MM,M2,M3,L,KL,SET,LOT,PR,LM,KN"'],
  })
  // col G (7) — Inspection Class
  ws.dataValidations.add('G4:G500', {
    type: 'list', allowBlank: true, showErrorMessage: false,
    formulae: ['"Class I,Class II,Class III,Class IV"'],
  })
  // col H (8) — VDRL Required
  ws.dataValidations.add('H4:H500', {
    type: 'list', allowBlank: true, showErrorMessage: false,
    formulae: ['"Yes,No"'],
  })
  // col I (9) — Heat Number Required
  ws.dataValidations.add('I4:I500', {
    type: 'list', allowBlank: true, showErrorMessage: false,
    formulae: ['"Yes,No"'],
  })

  // ── Reference sheet (valid values legend) ─────────────────────────────────
  const wsRef = wb.addWorksheet('Reference')
  wsRef.getColumn(1).width = 32
  wsRef.getColumn(2).width = 65
  const refTitleCell = wsRef.getCell('A1')
  refTitleCell.value = 'QCO MMS — MTO Template: Valid Values Reference'
  refTitleCell.font = { bold: true, size: 12, color: { argb: 'FFE84E0F' } }
  wsRef.getRow(1).height = 22
  wsRef.addRow([])
  wsRef.addRow(['Note: These values are suggestions. You may type any value not in this list.'])
    .getCell(1).font = { italic: true, color: { argb: 'FF64748b' }, size: 10 }
  wsRef.addRow([])
  const refRows = [
    ['COLUMN', 'VALID VALUES'],
    ['UOM (col E)',                'EA, NR, KG, T, M, MM, M2, M3, L, KL, SET, LOT, PR, LM, KN'],
    ['Inspection Class (col G)',   'Class I, Class II, Class III, Class IV'],
    ['VDRL Required (col H)',      'Yes, No'],
    ['Heat Number Required (col I)', 'Yes, No'],
  ]
  refRows.forEach((row, i) => {
    const r = wsRef.addRow(row)
    if (i === 0) r.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } } })
  })

  // Instructions sheet
  const ws2 = wb.addWorksheet('Instructions')
  ws2.getColumn(1).width = 80
  const instrLines = [
    ['QCO MMS — MTO Template Instructions', true, 'FFE84E0F', 13],
    ['', false, null, 11],
    ['COLUMN GUIDE', true, 'FF1e3a5f', 11],
    ['Line Number — Required. Format: L-001. Must be unique.', false, null, 10],
    ['WBS Code — Must match a WBS code in your project (e.g. 02.01.01).', false, null, 10],
    ['Description — Required for every line.', false, null, 10],
    ['Quantity — Numeric.', false, null, 10],
    ['UOM — Select from dropdown (guide only): EA, NR, KG, T, M, MM, M2, M3, L, KL, SET, LOT, PR, LM, KN', false, null, 10],
    ['ROS Date — Format: DD-MMM-YYYY (e.g. 31-Aug-2025)', false, null, 10],
    ['Inspection Class — Select from dropdown: Class I | Class II | Class III | Class IV', false, null, 10],
    ['VDRL Required — Select Yes or No. Yes = vendor documents required.', false, null, 10],
    ['Heat Number Required — Select Yes or No. Yes for steel, pipe, valves, pressure parts.', false, null, 10],
    ['', false, null, 10],
    ['UPLOAD RULES', true, 'FF1e3a5f', 11],
    ['1. Delete example rows (4–6) before uploading.', false, null, 10],
    ['2. Do not change the column headers in row 3.', false, null, 10],
    ['3. Rows with blank Description are skipped on import.', false, null, 10],
    ['4. Lines on a raised PO cannot have Qty/WBS/Description changed.', false, null, 10],
    ['5. Save as .xlsx or .csv before uploading.', false, null, 10],
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
    const wb = XLSX_LIB.read(req.file.buffer, { type: 'buffer', cellDates: true })
    const sheetName = wb.SheetNames.includes('MTO Lines') ? 'MTO Lines' : wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const rawRows = XLSX_LIB.utils.sheet_to_json(ws, { defval: null })
    if (!rawRows.length) return res.status(400).json({ error: 'File is empty or unreadable', hasErrors: true })

    function norm(k) { return k.trim().toLowerCase().replace(/\s+/g, '_') }
    const firstRow = rawRows[0]
    const normKeys = Object.keys(firstRow).map(norm)
    if (!normKeys.includes('description'))
      return res.status(400).json({ error: 'Required column "Description" not found. Check headers match the template.', hasErrors: true })
    const hasLineNum = normKeys.includes('line_number') || normKeys.includes('line_#') || normKeys.includes('line_no')
    if (!hasLineNum)
      return res.status(400).json({ error: 'Required column "Line Number" not found. Check headers match the template.', hasErrors: true })

    const rows = rawRows.map((row, idx) => {
      const n = {}
      for (const [k, v] of Object.entries(row)) n[norm(k)] = v
      if (!n.line_number && n['line_#']) n.line_number = n['line_#']
      if (!n.line_number && n.line_no) n.line_number = n.line_no
      n._rowNum = idx + 4
      return n
    })

    const warnings = [], validLines = []
    let linesSkipped = 0
    const lineNumbers = new Map()
    const VALID_UOM = new Set(['EA','m','m2','m3','kg','t','LT','SET','LOT'])
    const VALID_INSP = new Set(['class i','class ii','class iii'])

    function normYN(v) {
      if (v == null || v === '') return 0
      const s = String(v).trim().toLowerCase()
      if (['y','yes','1','true'].includes(s)) return 1
      if (['n','no','0','false'].includes(s)) return 0
      return null
    }

    function parseDate(v) {
      if (v == null || v === '') return null
      if (v instanceof Date) return v.toISOString().slice(0,10)
      if (typeof v === 'number') {
        const d = XLSX_LIB.SSF.parse_date_code(v)
        if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`
      }
      const s = String(v).trim()
      const parsed = new Date(s)
      if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0,10)
      return null
    }

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
      let insp = row.inspection_class ? String(row.inspection_class).trim() : 'Class II'
      if (!VALID_INSP.has(insp.toLowerCase())) { warnings.push({ row: rn, message: `Inspection class '${insp}' not recognised — defaulting to Class II`, severity: 'warning' }); insp = 'Class II' }

      let vdrl = normYN(row.vdrl_required)
      if (vdrl === null) { warnings.push({ row: rn, message: `VDRL value not recognised — defaulting to N`, severity: 'warning' }); vdrl = 0 }
      let heatReq = normYN(row.heat_number_required)
      if (heatReq === null) { warnings.push({ row: rn, message: `Heat Number Required value not recognised — defaulting to N`, severity: 'warning' }); heatReq = 0 }

      const wbsCode = row.wbs_code ? String(row.wbs_code).trim() : null
      if (wbsCode && validWBS.size > 0 && !validWBS.has(wbsCode))
        warnings.push({ row: rn, message: `WBS '${wbsCode}' not found in project — imported as-is`, severity: 'warning' })

      let qty = null
      if (row.quantity != null && row.quantity !== '') {
        const n = parseFloat(String(row.quantity))
        if (isNaN(n)) warnings.push({ row: rn, message: `Quantity '${row.quantity}' is not a number — left blank`, severity: 'warning' })
        else qty = n
      }

      const rosDate = parseDate(row.ros_date)
      if (row.ros_date != null && row.ros_date !== '' && !rosDate)
        warnings.push({ row: rn, message: `ROS date '${row.ros_date}' could not be parsed — left blank`, severity: 'warning' })

      validLines.push({ line_number: lineNum, wbs_code: wbsCode, description: String(row.description).trim(), quantity: qty, uom: uom || null, ros_date: rosDate, inspection_class: insp, vdrl_required: vdrl, heat_number_required: heatReq })
    }

    res.json({
      linesFound: rows.length, linesValid: validLines.length, linesSkipped,
      warnings, hasErrors: warnings.some(w => w.severity === 'error'),
      preview: validLines.slice(0, 15)
    })
  } catch (e) {
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
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)))
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
        const FIELDS = ['description','quantity','wbs_code','ros_date','inspection_class','uom']
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
    // Reject a duplicate line number within the current revision (logical conflict).
    const [[dupLine]] = await db.query(
      'SELECT id FROM mto_lines WHERE mto_id = ? AND revision = ? AND line_number = ? AND is_deleted = 0',
      [mto.id, mto.current_revision, line_number])
    if (dupLine) return res.status(409).json({ error: `Line number "${line_number}" already exists in revision ${mto.current_revision}.` })

    const [result] = await db.query(
      `INSERT INTO mto_lines
       (mto_id, revision, line_number, wbs_code, description, quantity, uom,
        ros_date, inspection_class, vdrl_required, po_ref, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [mto.id, mto.current_revision, line_number, wbs_code || null, description,
       quantity || null, uom || null, ros_date || null,
       inspection_class || 'Class II', vdrl_required ? 1 : 0,
       po_ref || null, status || 'not-started']
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

    let sql, params
    if (locked) {
      // GOVERNANCE (baseline-major): qty/rev changes on a PO-raised line are intentionally
      // blocked here (only ros_date/vdrl_required editable). If this is ever unlocked, the
      // qty/rev edit MUST route through pending_changes confirmation (action='edit',
      // confirmer=project_manager) per the signed baseline-major definition — never write direct.
      sql = `UPDATE mto_lines SET ros_date = ?, vdrl_required = ? WHERE id = ?`
      params = [ros_date ?? line.ros_date, vdrl_required != null ? (vdrl_required ? 1 : 0) : line.vdrl_required, line.id]
    } else {
      sql = `UPDATE mto_lines SET
               line_number = ?, wbs_code = ?, description = ?, quantity = ?, uom = ?,
               ros_date = ?, inspection_class = ?, vdrl_required = ?, po_ref = ?, status = ?
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
        line.id
      ]
    }

    await db.query(sql, params)
    const [[updated]] = await db.query(`SELECT * FROM mto_lines WHERE id = ?`, [line.id])
    audit(req, 'UPDATE', 'mto_line', line.id, line, updated)
    res.json(updated)
  } catch (e) {
    console.error('PUT /mto/:projectId/:mtoId/lines/:lineId', e.message)
    res.status(500).json({ error: 'Failed to update line' })
  }
})

// ─── DELETE /:projectId/:mtoId/lines/:lineId — soft-delete a line ─────────────
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

    await db.query(`UPDATE mto_lines SET is_deleted = 1 WHERE id = ?`, [line.id])

    // Refresh line_count
    await db.query(
      `UPDATE mto_registers SET line_count = (
         SELECT COUNT(*) FROM mto_lines WHERE mto_id = ? AND revision = ? AND is_deleted = 0
       ) WHERE id = ?`,
      [line.mto_id, line.revision, line.mto_id]
    )

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
    if (allRevs.some(r => compareRev(r.revision, newRev) === 0)) {
      return res.status(409).json({
        error: `Revision ${newRev} already exists for this MTO. Upload a new revision number.`
      })
    }
    const latest = allRevs.reduce((a, r) => (a === '' || compareRev(r.revision, a) > 0) ? r.revision : a, '')
    if (latest && compareRev(newRev, latest) <= 0) {
      return res.status(409).json({
        error: `Revision ${newRev} is older than the latest revision ${latest} already in the system. Uploads must be a later revision.`
      })
    }

    { const fe = fileNotEmpty(req.file); if (fe) return res.status(400).json({ error: fe }) }

    // ─── Parse workbook ───────────────────────────────────────────
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null })

    if (!rows.length) return res.status(400).json({ error: 'File is empty or unreadable' })

    // ─── Normalise header keys ─────────────────────────────────────
    function norm(key) { return key.trim().toLowerCase().replace(/\s+/g, '_') }
    const lines = rows.map(row => {
      const n = {}
      for (const [k, v] of Object.entries(row)) n[norm(k)] = v
      return n
    })

    // ─── Reject a no-change re-upload ─────────────────────────────
    // An MTO whose content is identical to the current revision (only the
    // version differs) is meaningless — prompt and reject rather than create a
    // duplicate revision. Compared against the live (current) revision's lines.
    const [curLines] = await db.query(
      'SELECT line_number, description, quantity, uom, wbs_code, ros_date, inspection_class, vdrl_required FROM mto_lines WHERE mto_id=? AND revision=? AND is_deleted=0',
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
    const uploadMap = new Map(lines.map(l => [String(l.line_number), l]))
    const conflicts = []
    for (const locked of lockedLines) {
      const uploaded = uploadMap.get(String(locked.line_number))
      if (!uploaded) continue
      const changed = {}
      if (String(uploaded.quantity ?? '') !== String(locked.quantity ?? '')) changed.quantity = { locked: locked.quantity, uploaded: uploaded.quantity }
      if (String(uploaded.description ?? '') !== String(locked.description ?? '')) changed.description = { locked: locked.description, uploaded: uploaded.description }
      if (String(uploaded.uom ?? '') !== String(locked.uom ?? '')) changed.uom = { locked: locked.uom, uploaded: uploaded.uom }
      if (String(uploaded.wbs_code ?? '') !== String(locked.wbs_code ?? '')) changed.wbs_code = { locked: locked.wbs_code, uploaded: uploaded.wbs_code }
      if (Object.keys(changed).length > 0) conflicts.push({ line_number: locked.line_number, changes: changed })
    }

    // Summary for dry-run or conflict reporting
    const existingLineNums = new Set(lockedLines.map(l => String(l.line_number)))
    const uploadedLineNums = new Set(lines.map(l => String(l.line_number)))
    const summary = {
      totalLines:    lines.length,
      newLines:      lines.filter(l => !existingLineNums.has(String(l.line_number))).length,
      modifiedLines: conflicts.length,
      deletedLines:  0,
      conflicts:     conflicts.length,
    }

    // ─── BUG-2: dry-run returns preview without inserting ─────────
    if (dryRun) {
      return res.json({ dryRun: true, summary, conflicts })
    }

    // ─── BUG-2: conflict guard — block upload if locked lines would change ─────
    if (conflicts.length > 0) {
      return res.status(422).json({
        error: `${conflicts.length} locked (PO-raised) line(s) would be modified. Resolve conflicts first.`,
        conflicts,
      })
    }

    // ─── Persist the uploaded spreadsheet ─────────────────────────
    // The buffer was parsed into lines above; we now also keep the original
    // file on disk so the revision is downloadable as-submitted from the
    // Document Inbox (previously the buffer was discarded after parsing).
    const mtoDir = path.join(__dirname, '..', 'uploads', 'mto-revisions')
    fs.mkdirSync(mtoDir, { recursive: true })
    const safeName   = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storedName = `${Date.now()}_${safeName}`
    fs.writeFileSync(path.join(mtoDir, storedName), req.file.buffer)
    const relPath = path.join('uploads', 'mto-revisions', storedName)   // relative to server root

    // ─── Insert new revision record ───────────────────────────────
    const [revIns] = await db.query(
      `INSERT INTO mto_revisions (mto_id, revision, uploaded_by, notes, line_count)
       VALUES (?, ?, ?, ?, ?)`,
      [mto.id, newRev, req.user.id, notes, lines.length]
    )
    // Record the stored file — gated on the migration so this never regresses
    // the upload flow if the file columns aren't present yet (see schemaColumns).
    if (await fileColumnsReady('mto_revisions')) {
      await db.query(
        `UPDATE mto_revisions SET file_name=?, file_path=?, file_size=?, mime_type=? WHERE id=?`,
        [req.file.originalname, relPath, req.file.size, req.file.mimetype, revIns.insertId])
    }

    // ─── Insert lines ──────────────────────────────────────────────
    for (const l of lines) {
      if (!l.line_number || !l.description) continue
      await db.query(
        `INSERT INTO mto_lines
         (mto_id, revision, line_number, wbs_code, description, quantity, uom,
          ros_date, inspection_class, vdrl_required, po_ref, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mto.id, newRev,
         String(l.line_number),
         l.wbs_code     || null,
         String(l.description),
         l.quantity     || null,
         l.uom          || null,
         l.ros_date     || null,
         l.inspection_class || 'Class II',
         l.vdrl_required ? 1 : 0,
         l.po_ref       || null,
         l.status       || 'not-started']
      )
    }

    // ─── Promote current revision on register ─────────────────────
    await db.query(
      `UPDATE mto_registers
       SET current_revision = ?, line_count = ?, updated_at = NOW()
       WHERE id = ?`,
      [newRev, lines.length, mto.id]
    )

    audit(req, 'UPLOAD_REVISION', 'mto_register', mto.id, { revision: mto.current_revision }, { revision: newRev })
    res.json({ ok: true, revision: newRev, linesImported: lines.length })
  } catch (e) {
    console.error('POST /mto/:projectId/:mtoId/upload', e.message)
    dbError(res, e, 'Upload failed')
  }
})

module.exports = router
