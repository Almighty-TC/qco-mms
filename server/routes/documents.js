// ─── DOCUMENTS (AGGREGATE, READ-ONLY) ─────────────────────────
// Project-wide unified VIEW over every module's EXISTING document
// tables. This module owns NO documents and creates NO table — it
// reads the source tables, normalises each row to one shape, and links
// back to the owning record. Modules remain the source of truth.
// Mounted at /api/documents. Pooled connections only.
const express = require('express')
const router  = express.Router()
const db      = require('../db')
const { authenticateToken } = require('../middleware/auth')

router.use(authenticateToken)

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

// ─── BUILD THE REGISTER ───────────────────────────────────────
// Returns the full normalised, project-scoped document set (unfiltered).
async function buildRegister(pid) {
  const rows = []
  const url = seg => `/project/${pid}/${seg}`

  // ── Traceability — traceability_certs ─────────────────────
  const [tc] = await db.query(
    `SELECT c.id, c.document_name, c.cert_type, c.tag, c.po_ref, c.file_name, c.file_size,
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
    })
  }

  // ── Expediting / VDRL — vdrl_documents ────────────────────
  // doc_type Report/Drawing → Expediting (FAT, fabrication, inspection);
  // the rest → VDRL package docs.
  const [vd] = await db.query(
    `SELECT d.id, d.doc_number, d.title, d.doc_type, d.status, d.submitted_date, d.created_at,
            d.created_by, u.full_name AS created_by_name, p.package_ref, p.po_number
     FROM vdrl_documents d
     JOIN vdrl_packages p ON p.id = d.package_id
     LEFT JOIN users u ON u.id = d.created_by
     WHERE p.project_id = ?`, [pid])
  for (const r of vd) {
    const missing = ['Not submitted', 'Overdue'].includes(r.status)
    const isExp = ['Report', 'Drawing'].includes(r.doc_type)
    rows.push({
      doc_id: `vdrl:${r.id}`,
      file_name: missing ? null : `${r.title.replace(/[^a-zA-Z0-9]+/g, '-')}-${r.doc_number}.pdf`,
      file_label: r.title,
      file_size: null,
      type_tags: [r.doc_type, 'VDRL'].filter(Boolean),
      module: isExp ? 'Expediting' : 'VDRL',
      source_label: `${r.package_ref || r.po_number || 'Pkg'} · doc ${r.doc_number}`,
      source_record_id: r.id, source_url: url('expediting'),
      uploaded_by: r.created_by_name || null, uploaded_by_id: r.created_by || null,
      uploaded_at: fmtDate(r.submitted_date || r.created_at),
      status: NORM[r.status] || (missing ? 'Missing' : 'Available'), is_missing: missing,
    })
  }

  // ── Logistics — scn_documents ─────────────────────────────
  const [sd] = await db.query(
    `SELECT d.id, d.document_type, d.file_name, d.uploaded_by, u.full_name AS uploaded_by_name,
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
    })
  }

  // ── Procurement — po_documents (current versions) ─────────
  const [pd] = await db.query(
    `SELECT pd.id, pd.doc_type, pd.file_name, pd.file_size_bytes, pd.description, pd.uploaded_at,
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
    })
  }

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
    })
  }

  // ── MTO — mto_revisions (issued revision = a deliverable) ──
  const [mr] = await db.query(
    `SELECT r.id, r.revision, r.created_at, r.uploaded_by, u.full_name AS uploaded_by_name,
            m.name AS mto_name, m.reference
     FROM mto_revisions r
     JOIN mto_registers m ON m.id = r.mto_id
     LEFT JOIN users u ON u.id = r.uploaded_by
     WHERE m.project_id = ?`, [pid])
  for (const r of mr) {
    rows.push({
      doc_id: `mto:${r.id}`,
      file_name: `${r.reference}-Rev${r.revision}.xlsx`,
      file_label: `${r.mto_name} · Rev ${r.revision}`,
      file_size: null,
      type_tags: ['MTO Revision', 'Spreadsheet'],
      module: 'MTO', source_label: r.reference,
      source_record_id: r.id, source_url: url('mto-list'),
      uploaded_by: r.uploaded_by_name || null, uploaded_by_id: r.uploaded_by || null,
      uploaded_at: fmtDate(r.created_at),
      status: 'Available', is_missing: false,
    })
  }

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

module.exports = router
