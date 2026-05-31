// ─── SEED EXPEDITING VDRL ─────────────────────────────────────
// Idempotent seed: adds a VDRL package for PO-2024-002 with 3 docs,
// and 3 action notes across POs 1–3. Safe to run multiple times.
const db = require('../db')

async function main() {
  const today = new Date()
  const d = (offsetDays) => {
    const dt = new Date(today)
    dt.setDate(dt.getDate() + offsetDays)
    return dt.toISOString().slice(0, 10)
  }

  // ─── VDRL PACKAGE for PO-2024-002 (po_id=2, project_id=1) ────
  const [[existing]] = await db.query(
    `SELECT id FROM vdrl_packages WHERE po_id=2 AND project_id=1 AND name='Structural Steel VDRL Package' LIMIT 1`
  )

  let packageId
  if (existing) {
    packageId = existing.id
    console.log(`Package already exists: id=${packageId}`)
  } else {
    const [r] = await db.query(
      `INSERT INTO vdrl_packages (project_id, po_id, package_ref, name, status, created_by, created_at)
       VALUES (1, 2, 'SS-VDRL-001', 'Structural Steel VDRL Package', 'active', 1, NOW())`
    )
    packageId = r.insertId
    console.log(`Created package: id=${packageId}`)
  }

  // ─── VDRL DOCUMENTS ──────────────────────────────────────────
  const docs = [
    {
      doc_number: 'SS-DWG-001',
      title: 'Structural Steel Drawing Package',
      doc_type: 'Drawing',
      status: 'Under review',
      abf_required: 0,
      revision: 'R1',
      required_date: d(-7),
      promised_date: d(-3),
    },
    {
      doc_number: 'SS-CERT-001',
      title: 'Material Test Reports',
      doc_type: 'Certificate',
      status: 'Not submitted',
      abf_required: 0,
      revision: 'R0',
      required_date: d(14),
      promised_date: null,
    },
    {
      doc_number: 'SS-PROC-001',
      title: 'Welding Procedure Qualification',
      doc_type: 'Procedure',
      status: 'Overdue',
      abf_required: 0,
      revision: 'R0',
      required_date: d(-14),
      promised_date: null,
    },
  ]

  let docsInserted = 0
  let docsSkipped = 0
  for (const doc of docs) {
    const [[ex]] = await db.query(
      `SELECT id FROM vdrl_documents WHERE package_id=? AND title=? LIMIT 1`,
      [packageId, doc.title]
    )
    if (ex) {
      docsSkipped++
      continue
    }
    await db.query(
      `INSERT INTO vdrl_documents
        (package_id, doc_number, title, doc_type, status, abf_required, revision,
         required_date, promised_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [packageId, doc.doc_number, doc.title, doc.doc_type, doc.status,
       doc.abf_required, doc.revision, doc.required_date || null, doc.promised_date || null]
    )
    docsInserted++
  }
  console.log(`Docs: ${docsInserted} inserted, ${docsSkipped} skipped`)

  // ─── ACTION NOTES ─────────────────────────────────────────────
  const notes = [
    {
      po_id: 1,
      note_text: 'Expediting call held with vendor. FAT confirmed for 21 Apr. Packing list to follow by end of week.',
    },
    {
      po_id: 2,
      note_text: 'Vendor confirmed delay due to raw material shortage. New forecast ready date: 15 June. Updated forecast history accordingly.',
    },
    {
      po_id: 3,
      note_text: 'At risk — chasing vendor for updated ITP. No response in 5 days. Escalation notice issued.',
    },
  ]

  let notesInserted = 0
  let notesSkipped = 0
  for (const note of notes) {
    const [[ex]] = await db.query(
      `SELECT id FROM po_action_notes WHERE po_id=? AND note_text=? LIMIT 1`,
      [note.po_id, note.note_text]
    )
    if (ex) {
      notesSkipped++
      continue
    }
    await db.query(
      `INSERT INTO po_action_notes (po_id, note_text, created_by, created_at)
       VALUES (?, ?, 1, NOW())`,
      [note.po_id, note.note_text]
    )
    notesInserted++
  }
  console.log(`Notes: ${notesInserted} inserted, ${notesSkipped} skipped`)

  // ─── FINAL COUNTS ─────────────────────────────────────────────
  const [[{ pkg_count }]] = await db.query(`SELECT COUNT(*) AS pkg_count FROM vdrl_packages WHERE project_id=1`)
  const [[{ doc_count }]] = await db.query(`SELECT COUNT(*) AS doc_count FROM vdrl_documents d JOIN vdrl_packages p ON p.id=d.package_id WHERE p.project_id=1`)
  const [[{ note_count }]] = await db.query(`SELECT COUNT(*) AS note_count FROM po_action_notes n JOIN purchase_orders po ON po.id=n.po_id WHERE po.project_id=1`)
  console.log(`\nFinal counts — packages: ${pkg_count}, docs: ${doc_count}, notes: ${note_count}`)

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
