// ─── DOCUMENTS (AGGREGATE, READ-ONLY) ─────────────────────────
// Project-wide unified VIEW over every module's EXISTING document
// tables. This module owns NO documents and creates NO table — it
// reads the source tables, normalises each row to one shape, and links
// back to the owning record. Modules remain the source of truth.
// Mounted at /api/documents. Pooled connections only.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const path    = require('path')
const fs      = require('fs')
const blobStore = require('../lib/blobStore')   // blob migration: dual-read fallback
const { authenticateToken } = require('../middleware/auth')
const { requireProjectScope } = require('../middleware/permissions')

router.use(authenticateToken)
router.param('projectId', requireProjectScope) // Stage 1: external roles WBS-scoped to granted projects (closes the docs cross-project leak)

// ─── NORMALISED STATUS ────────────────────────────────────────
// Every source status maps to one of: Verified | Available | Under review | Missing.
const NORM = {
  // traceability_certs.status
  verified: 'Verified', received: 'Available', rejected: 'Under review',
  pending: 'Missing', overdue: 'Missing',
  // vdrl_documents.status
  Approved: 'Verified', 'Under review': 'Under review',
  'Not submitted': 'Missing', Overdue: 'Missing',
  // foundational_certificates.status
  Verified: 'Verified', 'Pending QA': 'Under review',
}
const fmtDate = d => d ? new Date(d).toISOString().slice(0, 10) : null

// ─── OPTIONAL FILE COLUMNS (migration-tolerant) ───────────────
// Persisted-file columns arrive via migrate-document-files.js (owner/DDL acct).
// Until then we fall back to NULL so the inbox never 500s on an absent column;
// see server/lib/schemaColumns.js for the full rationale.
const { fileColumns } = require('../lib/schemaColumns')
// SQL fragment: real column when present, else a typed NULL placeholder.
const pick = (set, key, expr, as) => `${set.has(key) ? expr : 'NULL'} AS ${as}`

// ─── BUILD THE REGISTER ───────────────────────────────────────
// Returns the full normalised, project-scoped document set (unfiltered).
async function buildRegister(pid) {
  const rows = []
  const url = seg => `/project/${pid}/${seg}`
  const oc = await fileColumns()
  // Each source below is independent — run them concurrently so the remote-DB
  // round-trips overlap instead of stacking (was ~8 sequential queries).
  const tasks = []

  tasks.push((async () => {
  // ── Traceability — traceability_certs ─────────────────────
  const [tc] = await db.query(
    `SELECT c.id, c.document_name, c.cert_type, c.tag, c.po_ref, c.file_name, c.file_size,
            ${pick(oc, 'traceability_certs.file_path', 'c.file_path', 'file_path')},
            c.status, c.uploaded_by, u.full_name AS uploaded_by_name, c.uploaded_date, c.received_date, c.due_date
     FROM traceability_certs c LEFT JOIN users u ON u.id = c.uploaded_by
     WHERE c.project_id = ?`, [pid])
  for (const r of tc) {
    const missing = !r.file_name
    rows.push({
      doc_id: `traceability:${r.id}`,
      file_name: r.file_name || null,
      file_label: r.document_name || r.cert_type || 'Certificate',
      file_size: r.file_size || null,
      type_tags: [r.cert_type, 'Cert'].filter(Boolean),
      module: 'Traceability', source_label: r.tag ? `${r.po_ref || ''} · ${r.tag}`.trim() : (r.po_ref || 'Cert'),
      source_record_id: r.id, source_url: url('traceability'),
      uploaded_by: r.uploaded_by_name || null, uploaded_by_id: r.uploaded_by || null,
      uploaded_at: fmtDate(r.uploaded_date || r.received_date),
      status: missing ? 'Missing' : (NORM[r.status] || 'Available'), is_missing: missing,
      // Streamable only once the on-disk path was recorded. Older rows captured
      // file_name but not the path — they read as present yet cannot be served.
      downloadable: !!r.file_path,
    })
  }

  })())

  tasks.push((async () => {
  // ── Expediting / VDRL — vdrl_documents ────────────────────
  // doc_type Report/Drawing → Expediting (FAT, fabrication, inspection);
  // the rest → VDRL package docs.
  const [vd] = await db.query(
    `SELECT d.id, d.doc_number, d.title, d.doc_type, d.status, d.submitted_date, d.created_at,
            d.created_by, u.full_name AS created_by_name, p.package_ref, p.po_number,
            ${pick(oc, 'vdrl_documents.file_name', 'd.file_name', 'file_name')},
            ${pick(oc, 'vdrl_documents.file_path', 'd.file_path', 'file_path')},
            ${pick(oc, 'vdrl_documents.file_size', 'd.file_size', 'file_size')}
     FROM vdrl_documents d
     JOIN vdrl_packages p ON p.id = d.package_id
     LEFT JOIN users u ON u.id = d.created_by
     WHERE p.project_id = ?`, [pid])
  for (const r of vd) {
    const missing = ['Not submitted', 'Overdue'].includes(r.status)
    const isExp = ['Report', 'Drawing'].includes(r.doc_type)
    rows.push({
      doc_id: `vdrl:${r.id}`,
      // The actual deliverable file, when one has been attached. A VDRL row is a
      // document REQUIREMENT — it exists before any file does, so file_name stays
      // null (no fabricated name) until a real upload lands against it.
      file_name: r.file_name || null,
      file_label: r.title,
      file_size: r.file_size || null,
      type_tags: [r.doc_type, 'VDRL'].filter(Boolean),
      module: isExp ? 'Expediting' : 'VDRL',
      source_label: `${r.package_ref || r.po_number || 'Pkg'} · doc ${r.doc_number}`,
      source_record_id: r.id, source_url: url('expediting'),
      uploaded_by: r.created_by_name || null, uploaded_by_id: r.created_by || null,
      uploaded_at: fmtDate(r.submitted_date || r.created_at),
      status: NORM[r.status] || (missing ? 'Missing' : 'Available'), is_missing: missing,
      downloadable: !!r.file_path,
    })
  }

  })())

  tasks.push((async () => {
  // ── Logistics — scn_documents ─────────────────────────────
  const [sd] = await db.query(
    `SELECT d.id, d.document_type, d.file_name, d.file_path, d.uploaded_by, u.full_name AS uploaded_by_name,
            d.uploaded_at, d.notes, s.scn_ref
     FROM scn_documents d
     JOIN shipment_control_notes s ON s.id = d.scn_id
     LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE s.project_id = ?`, [pid])
  for (const r of sd) {
    const missing = !r.file_name
    const label = r.document_type === 'Other' && r.notes ? r.notes.split('—')[0].trim() : r.document_type
    rows.push({
      doc_id: `logistics:${r.id}`,
      file_name: r.file_name || null,
      file_label: label || 'Shipping document',
      file_size: null,
      type_tags: [r.document_type === 'Other' ? (label || 'Other') : r.document_type, 'Shipping'].filter(Boolean),
      module: 'Logistics', source_label: r.scn_ref,
      source_record_id: r.id, source_url: url('logistics'),
      uploaded_by: r.uploaded_by_name || null, uploaded_by_id: r.uploaded_by || null,
      uploaded_at: fmtDate(r.uploaded_at),
      status: missing ? 'Missing' : 'Available', is_missing: missing,
      downloadable: !!r.file_path,
    })
  }

  })())

  tasks.push((async () => {
  // ── Procurement — po_documents (current versions) ─────────
  const [pd] = await db.query(
    `SELECT pd.id, pd.doc_type, pd.file_name, pd.file_path, pd.file_size_bytes, pd.description, pd.uploaded_at,
            pd.uploaded_by, u.full_name AS uploaded_by_name, po.po_number
     FROM po_documents pd
     JOIN purchase_orders po ON po.id = pd.po_id
     LEFT JOIN users u ON u.id = pd.uploaded_by
     WHERE po.project_id = ? AND pd.is_current = 1`, [pid])
  for (const r of pd) {
    rows.push({
      doc_id: `procurement:${r.id}`,
      file_name: r.file_name || null,
      file_label: r.description || (r.doc_type === 'signed_po' ? `Signed PO ${r.po_number}` : r.doc_type),
      file_size: r.file_size_bytes || null,
      type_tags: [r.doc_type === 'signed_po' ? 'Signed PO' : r.doc_type, 'Procurement'].filter(Boolean),
      module: 'Procurement', source_label: r.po_number,
      source_record_id: r.id, source_url: url('procurement'),
      uploaded_by: r.uploaded_by_name || null, uploaded_by_id: r.uploaded_by || null,
      uploaded_at: fmtDate(r.uploaded_at),
      status: r.doc_type === 'signed_po' ? 'Verified' : 'Available', is_missing: false,
      downloadable: !!r.file_path,
    })
  }

  })())

  tasks.push((async () => {
  // ── Foundational — foundational_certificates ──────────────
  const [fc] = await db.query(
    `SELECT fc.id, fc.entity_type, fc.cert_type, fc.ref_number, fc.filename, fc.file_size,
            fc.status, fc.uploaded_at, fc.uploaded_by, u.full_name AS uploaded_by_name
     FROM foundational_certificates fc LEFT JOIN users u ON u.id = fc.uploaded_by
     WHERE fc.project_id = ?`, [pid])
  for (const r of fc) {
    const missing = !r.filename
    const seg = r.entity_type === 'equipment' ? 'foundational-equipment' : 'foundational-commodities'
    rows.push({
      doc_id: `foundational:${r.id}`,
      file_name: r.filename || null,
      file_label: `${r.cert_type || 'Certificate'}${r.ref_number ? ` · ${r.ref_number}` : ''}`,
      file_size: r.file_size || null,
      type_tags: [r.cert_type, 'Foundational'].filter(Boolean),
      module: 'Foundational', source_label: `${r.entity_type || ''} ${r.ref_number || ''}`.trim() || 'Foundational',
      source_record_id: r.id, source_url: url(seg),
      uploaded_by: r.uploaded_by_name || null, uploaded_by_id: r.uploaded_by || null,
      uploaded_at: fmtDate(r.uploaded_at),
      status: missing ? 'Missing' : (NORM[r.status] || 'Available'), is_missing: missing,
      downloadable: !!r.filename,
    })
  }

  })())

  tasks.push((async () => {
  // ── MTO — mto_revisions (issued revision = a deliverable) ──
  const [mr] = await db.query(
    `SELECT r.id, r.revision, r.created_at, r.uploaded_by, u.full_name AS uploaded_by_name,
            m.name AS mto_name, m.reference,
            ${pick(oc, 'mto_revisions.file_name', 'r.file_name', 'file_name')},
            ${pick(oc, 'mto_revisions.file_path', 'r.file_path', 'file_path')},
            ${pick(oc, 'mto_revisions.file_size', 'r.file_size', 'file_size')}
     FROM mto_revisions r
     JOIN mto_registers m ON m.id = r.mto_id
     LEFT JOIN users u ON u.id = r.uploaded_by
     WHERE m.project_id = ?`, [pid])
  for (const r of mr) {
    rows.push({
      doc_id: `mto:${r.id}`,
      // The original uploaded spreadsheet, preserved as-submitted. Revisions
      // created before file retention (or via the API without a file) have none —
      // show the descriptive name as the label, no fabricated filename.
      file_name: r.file_name || null,
      file_label: `${r.mto_name} · Rev ${r.revision}`,
      file_size: r.file_size || null,
      type_tags: ['MTO Revision', 'Spreadsheet'],
      module: 'MTO', source_label: r.reference,
      source_record_id: r.id, source_url: url('mto-list'),
      uploaded_by: r.uploaded_by_name || null, uploaded_by_id: r.uploaded_by || null,
      uploaded_at: fmtDate(r.created_at),
      status: 'Available', is_missing: false,
      downloadable: !!r.file_path,
    })
  }

  })())

  tasks.push((async () => {
  // ── Material Control — receipt POD/TCCC + FMR issue notes ──
  // MC persists no document FILE rows (storage is unbuilt), but a
  // receipt event and an FMR issue ARE document-like artifacts. We
  // derive one virtual row per artifact — same approach as MTO/VDRL
  // above — linking back to the MC screen ("open in source"); no file
  // is fetched. Receipt event = one TCCC (Transfer of Custody, Care &
  // Control) / Proof of Delivery, grouped per (SCN, receipt date).
  const [rc] = await db.query(
    `SELECT rl.scn_id, rl.scn_ref, rl.received_date, rl.received_by,
            MAX(u.full_name) AS received_by_name, MAX(rl.created_at) AS created_at,
            COUNT(*) AS line_count, SUM(CASE WHEN rl.damaged_qty > 0 THEN 1 ELSE 0 END) AS damaged_lines
     FROM receipt_lines rl LEFT JOIN users u ON u.id = rl.received_by
     WHERE rl.project_id = ?
     GROUP BY rl.scn_id, rl.scn_ref, rl.received_date, rl.received_by`, [pid])
  for (const r of rc) {
    const day = fmtDate(r.received_date || r.created_at)
    rows.push({
      doc_id: `mc-receipt:${r.scn_id}:${day || 'na'}`,
      file_name: `TCCC-${r.scn_ref}-${day}.pdf`,
      file_label: 'Proof of Delivery / TCCC',
      file_size: null,
      type_tags: ['TCCC', 'Receipt'],
      module: 'Material Control', source_label: r.scn_ref,
      source_record_id: r.scn_id, source_url: url('mc-receipting'),
      uploaded_by: r.received_by_name || null, uploaded_by_id: r.received_by || null,
      uploaded_at: day,
      // A signed custody transfer = Verified; pending QA on damage → Under review.
      status: Number(r.damaged_lines) > 0 ? 'Under review' : 'Verified', is_missing: false,
    })
  }

  })())

  tasks.push((async () => {
  // FMR issue note = one goods-issue voucher per FMR that has been issued.
  const [fi] = await db.query(
    `SELECT f.id, f.fmr_ref, MAX(il.issued_at) AS issued_at, MAX(il.issued_by) AS issued_by,
            MAX(u.full_name) AS issued_by_name, COUNT(*) AS line_count
     FROM fmr_issue_lines il
     JOIN fmr_requests f ON f.id = il.fmr_id
     LEFT JOIN users u ON u.id = il.issued_by
     WHERE f.project_id = ?
     GROUP BY f.id, f.fmr_ref`, [pid])
  for (const r of fi) {
    rows.push({
      doc_id: `mc-fmr:${r.id}`,
      file_name: `FMR-Issue-${r.fmr_ref}.pdf`,
      file_label: 'Material Issue Note',
      file_size: null,
      type_tags: ['Issue Note', 'Material Control'],
      module: 'Material Control', source_label: r.fmr_ref,
      source_record_id: r.id, source_url: url('mc-fmr'),
      uploaded_by: r.issued_by_name || null, uploaded_by_id: r.issued_by || null,
      uploaded_at: fmtDate(r.issued_at),
      status: 'Available', is_missing: false,
    })
  }

  })())

  await Promise.all(tasks)

  // Material Control rows above are virtual (derived from receipt/issue events,
  // no stored file) — anything that did not opt into downloadable is not streamable.
  for (const r of rows) if (r.downloadable === undefined) r.downloadable = false

  return rows
}

// ─── FILTERING ────────────────────────────────────────────────
function applyFilters(rows, { module, status, range, q, mine, userId }) {
  let out = rows
  if (module && module !== 'all' && module !== 'All')
    out = out.filter(r => r.module.toLowerCase() === String(module).toLowerCase())
  if (status && status !== 'all' && status !== 'All')
    out = out.filter(r => r.status === status)
  if (range && range !== 'all') {
    const days = Number(range)
    if (!isNaN(days)) {
      const cutoff = Date.now() - days * 86400000
      // Upload-window filter: rows without an upload date (requirements) drop out.
      out = out.filter(r => r.uploaded_at && new Date(r.uploaded_at).getTime() >= cutoff)
    }
  }
  if (mine === 'true' && userId)
    out = out.filter(r => r.uploaded_by_id === userId)
  if (q && q.trim()) {
    const needle = q.trim().toLowerCase()
    out = out.filter(r =>
      [r.file_name, r.file_label, r.source_label, r.module, r.uploaded_by, ...(r.type_tags || [])]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(needle)))
  }
  return out
}

// ─── GROUPING KEY ─────────────────────────────────────────────
function groupKeyOf(row, groupBy) {
  switch (groupBy) {
    case 'module':   return row.module
    case 'source':   return row.source_label
    case 'type':     return (row.type_tags && row.type_tags[0]) || 'Untagged'
    case 'uploader': return row.uploaded_by || 'Unassigned'
    default:         return null
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/documents/:projectId/summary
// ═══════════════════════════════════════════════════════════════
router.get('/:projectId/summary', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const rows = await buildRegister(pid)
    const wk = Date.now() - 7 * 86400000
    res.json({
      total: rows.length,
      uploaded_last_7d: rows.filter(r => r.uploaded_at && new Date(r.uploaded_at).getTime() >= wk).length,
      under_review: rows.filter(r => r.status === 'Under review').length,
      verified: rows.filter(r => r.status === 'Verified').length,
      missing: rows.filter(r => r.is_missing).length,
    })
  } catch (e) {
    res.status(500).json({ error: 'Could not load document summary: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// GET /api/documents/:projectId  (filtered register)
// ═══════════════════════════════════════════════════════════════
router.get('/:projectId', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { module, status, range = 'all', q, mine, group_by = 'none' } = req.query
    const all = await buildRegister(pid)
    let rows = applyFilters(all, { module, status, range, q, mine, userId: req.user?.id })

    // Newest first; requirement rows (no date) sink to the bottom.
    rows.sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''))

    let groups = null
    if (group_by && group_by !== 'none') {
      rows.forEach(r => { r.group_key = groupKeyOf(r, group_by) })
      const counts = new Map()
      rows.forEach(r => counts.set(r.group_key, (counts.get(r.group_key) || 0) + 1))
      groups = [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key))
    }

    res.json({ data: rows, total: rows.length, total_unfiltered: all.length, group_by, groups })
  } catch (e) {
    res.status(500).json({ error: 'Could not load documents: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// GET /api/documents/:projectId/export  (CSV of current view)
// ═══════════════════════════════════════════════════════════════
router.get('/:projectId/export', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const { module, status, range = 'all', q, mine } = req.query
    const all = await buildRegister(pid)
    const rows = applyFilters(all, { module, status, range, q, mine, userId: req.user?.id })

    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['File label', 'File name', 'Type tags', 'Module', 'Source', 'Uploaded by', 'Date', 'Status']
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push([r.file_label, r.file_name || '', (r.type_tags || []).join(' / '), r.module,
        r.source_label, r.uploaded_by || '', r.uploaded_at || '', r.status].map(esc).join(','))
    }
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="document_register_p${pid}.csv"`)
    res.send(lines.join('\n'))
  } catch (e) {
    res.status(500).json({ error: 'Could not export register: ' + e.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// GET /api/documents/:projectId/download/:docId   (unified stream)
// ═══════════════════════════════════════════════════════════════
// One authenticated streaming endpoint for every module. docId is the
// aggregator's `module:id` key. We re-resolve the source record server-side
// (never trust an id from the client), assert it belongs to :projectId — so a
// guessed id from another project 404s — confirm the stored path stays inside
// the module's own uploads dir (path-traversal guard), then stream with a
// Content-Disposition filename. Raw file paths are NEVER returned to the client.

// ─── PER-MODULE UPLOAD ROOTS ──────────────────────────────────
const SERVER_ROOT = path.join(__dirname, '..')
const UPLOADS = {
  procurement:  path.join(SERVER_ROOT, 'uploads', 'po_documents'),
  foundational: path.join(SERVER_ROOT, 'uploads', 'certificates'),
  logistics:    path.join(SERVER_ROOT, 'uploads', 'scn-documents'),
  traceability: path.join(SERVER_ROOT, 'uploads', 'traceability'),
  mto:          path.join(SERVER_ROOT, 'uploads', 'mto-revisions'),
  vdrl:         path.join(SERVER_ROOT, 'uploads', 'vdrl-documents'),
}

// ─── PATH-TRAVERSAL GUARD ─────────────────────────────────────
// Final candidate path must live inside its module's uploads dir; blocks any
// '..' smuggled through a stored value before a stream is ever opened.
function within(baseDir, abs) {
  const b = path.resolve(baseDir) + path.sep
  return path.resolve(abs).startsWith(b)
}

// ─── RESOLVERS ────────────────────────────────────────────────
// Each maps (id, projectId) → { absPath, baseDir, name, mime } when a real file
// exists for a record IN THIS PROJECT, or a sentinel: 'not_found' (no such row /
// wrong project) | 'no_file' (row exists but nothing stored). path.resolve with
// SERVER_ROOT handles both relative (most modules) and absolute (logistics
// multer) stored paths uniformly.
const RESOLVERS = {
  async procurement(id, pid) {
    const [[d]] = await db.query(
      `SELECT pd.file_name, pd.file_path, pd.mime_type
       FROM po_documents pd JOIN purchase_orders po ON po.id = pd.po_id
       WHERE pd.id=? AND po.project_id=?`, [id, pid])
    if (!d) return { code: 'not_found' }
    if (!d.file_path) return { code: 'no_file' }
    return { absPath: path.resolve(SERVER_ROOT, d.file_path), baseDir: UPLOADS.procurement, name: d.file_name, mime: d.mime_type }
  },
  async foundational(id, pid) {
    const [[c]] = await db.query(
      `SELECT filename FROM foundational_certificates WHERE id=? AND project_id=?`, [id, pid])
    if (!c) return { code: 'not_found' }
    if (!c.filename) return { code: 'no_file' }
    const base = path.basename(c.filename)   // stored as a bare filename
    return { absPath: path.join(UPLOADS.foundational, base), baseDir: UPLOADS.foundational, name: base.replace(/^\d+-/, ''), mime: null }
  },
  async logistics(id, pid) {
    const [[d]] = await db.query(
      `SELECT d.file_name, d.file_path FROM scn_documents d
       JOIN shipment_control_notes s ON s.id = d.scn_id
       WHERE d.id=? AND s.project_id=?`, [id, pid])
    if (!d) return { code: 'not_found' }
    if (!d.file_path) return { code: 'no_file' }
    return { absPath: path.resolve(SERVER_ROOT, d.file_path), baseDir: UPLOADS.logistics, name: d.file_name, mime: null }
  },
  async traceability(id, pid) {
    if (!(await fileColumns()).has('traceability_certs.file_path')) return { code: 'no_file' }
    const [[c]] = await db.query(
      `SELECT file_name, file_path, mime_type FROM traceability_certs WHERE id=? AND project_id=?`, [id, pid])
    if (!c) return { code: 'not_found' }
    if (!c.file_path) return { code: 'no_file' }
    return { absPath: path.resolve(SERVER_ROOT, c.file_path), baseDir: UPLOADS.traceability, name: c.file_name, mime: c.mime_type }
  },
  async mto(id, pid) {
    if (!(await fileColumns()).has('mto_revisions.file_path')) return { code: 'no_file' }
    const [[r]] = await db.query(
      `SELECT mr.file_name, mr.file_path, mr.mime_type FROM mto_revisions mr
       JOIN mto_registers m ON m.id = mr.mto_id
       WHERE mr.id=? AND m.project_id=?`, [id, pid])
    if (!r) return { code: 'not_found' }
    if (!r.file_path) return { code: 'no_file' }
    return { absPath: path.resolve(SERVER_ROOT, r.file_path), baseDir: UPLOADS.mto, name: r.file_name, mime: r.mime_type }
  },
  async vdrl(id, pid) {
    if (!(await fileColumns()).has('vdrl_documents.file_path')) return { code: 'no_file' }
    const [[d]] = await db.query(
      `SELECT d.file_name, d.file_path, d.mime_type FROM vdrl_documents d
       JOIN vdrl_packages p ON p.id = d.package_id
       WHERE d.id=? AND p.project_id=?`, [id, pid])
    if (!d) return { code: 'not_found' }
    if (!d.file_path) return { code: 'no_file' }
    return { absPath: path.resolve(SERVER_ROOT, d.file_path), baseDir: UPLOADS.vdrl, name: d.file_name, mime: d.mime_type }
  },
}

// ─── DOWNLOAD AUDIT ───────────────────────────────────────────
// Fire-and-forget: an audit failure must never break a legitimate download.
function auditDownload(req, pid, moduleKey, id, name) {
  const resource = (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?=\/)/, '')
  db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, project_id, before_value, after_value, resource, ip)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [req.user?.id || null, 'document_downloaded', `${moduleKey}_document`, id, pid || null,
     null, JSON.stringify({ file: name }), resource, req.ip]
  ).catch(e => console.error('[documents:audit] insert failed:', e.message))
}

router.get('/:projectId/download/:docId', async (req, res) => {
  try {
    const pid = Number(req.params.projectId)
    const raw = req.params.docId            // 'module:id'
    const sep = raw.indexOf(':')
    const moduleKey = sep === -1 ? raw : raw.slice(0, sep)
    const id = Number(raw.slice(sep + 1))
    const resolver = RESOLVERS[moduleKey]
    // Virtual/aggregated rows (Material Control receipt+issue notes) own no file.
    if (!resolver || !Number.isInteger(id)) return res.status(404).json({ error: 'No downloadable file for this document' })

    const r = await resolver(id, pid)
    if (r.code === 'not_found') return res.status(404).json({ error: 'Document not found in this project' })
    if (r.code === 'no_file')   return res.status(404).json({ error: 'No file is stored for this document yet' })

    const safeName = (r.name || 'document').replace(/[\r\n"]/g, '')
    // DUAL-READ FALLBACK (blob migration): try blob first — the key is <module>/<basename>,
    // derived from the resolved path (basename is invariant across blob-key / legacy disk
    // shapes, and strips any traversal so the key is safe by construction). On null (blob
    // disabled / absent), fall through to the existing on-disk read below — unchanged.
    const blobStream = await blobStore.getFile(blobStore.keyFor(moduleKey, r.absPath))
    if (blobStream) {
      auditDownload(req, pid, moduleKey, id, r.name)
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`)
      res.setHeader('Content-Type', r.mime || 'application/octet-stream')
      return blobStream.pipe(res)
    }

    if (!within(r.baseDir, r.absPath)) return res.status(400).json({ error: 'Invalid file reference' })
    if (!fs.existsSync(r.absPath)) return res.status(404).json({ error: 'File is recorded but missing on the server' })

    auditDownload(req, pid, moduleKey, id, r.name)
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`)
    res.setHeader('Content-Type', r.mime || 'application/octet-stream')
    fs.createReadStream(r.absPath).pipe(res)
  } catch (e) {
    res.status(500).json({ error: 'Download failed: ' + e.message })
  }
})

module.exports = router
