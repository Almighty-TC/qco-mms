// ─── SEED DOCUMENT SOURCES (Logistics + Procurement) ──────────
// Run: node server/scripts/seed-documents-sources.js
// The Document register is a READ-ONLY aggregator over existing module
// tables. Two of those tables (scn_documents, po_documents) are empty
// for project 1, so this adds a handful of real, module-OWNED rows so
// Logistics and Procurement contribute documents. Idempotent.
//
// No central documents table is created — these rows live in the source
// modules' own tables, exactly where those modules already store files.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  console.log('\nSeeding Logistics + Procurement document sources…\n')

  // Anchors in project 1.
  const [[scn]] = await db.query("SELECT id, scn_ref FROM shipment_control_notes WHERE project_id=1 ORDER BY id LIMIT 1")
  const [[po]]  = await db.query("SELECT id, po_number FROM purchase_orders WHERE project_id=1 ORDER BY id LIMIT 1")
  const uploader = 4 // Thomas Chang
  if (!scn || !po) { console.error('Missing SCN or PO anchor in project 1'); process.exit(1) }

  // ── Logistics: scn_documents ────────────────────────────────
  // Wipe prior seed for this SCN, then insert. MSDS is intentionally
  // file-less (file_name NULL) so it surfaces as a "Missing" requirement.
  await db.query('DELETE FROM scn_documents WHERE scn_id=?', [scn.id])
  // document_type is an ENUM; MSDS isn't a member so it's stored as 'Other'
  // with a label in notes, and left file-less so it surfaces as Missing.
  const scnDocs = [
    ['Packing List',                 `PackingList-${scn.scn_ref}.pdf`,      null],
    ['Commercial Invoice',           `CommercialInvoice-${scn.scn_ref}.pdf`, null],
    ['Bill of Lading',               `BoL-MAEU-7741920.pdf`,                 null],
    ['Dangerous Goods Declaration',  `DG-Declaration-${scn.scn_ref}.pdf`,    null],
    ['Other',                        null,                                   'MSDS — required, awaiting supplier'],
  ]
  for (const [type, file, note] of scnDocs) {
    await db.query(
      `INSERT INTO scn_documents (scn_id, document_type, file_name, file_path, uploaded_by, notes)
       VALUES (?,?,?,?,?,?)`,
      [scn.id, type, file, file ? `uploads/scn-documents/${file}` : null, file ? uploader : null, note])
  }
  console.log(`  ✓ scn_documents → ${scnDocs.length} rows on ${scn.scn_ref} (1 missing: MSDS)`)

  // ── Procurement: po_documents (signed PO) ───────────────────
  await db.query("DELETE FROM po_documents WHERE po_id=? AND doc_type='signed_po'", [po.id])
  const fileName = `Signed-${po.po_number}.pdf`
  await db.query(
    `INSERT INTO po_documents (po_id, doc_type, file_name, file_path, file_size_bytes, mime_type, version, is_current, description, uploaded_by, uploaded_at)
     VALUES (?, 'signed_po', ?, ?, ?, 'application/pdf', 1, 1, 'Executed purchase order', ?, NOW())`,
    [po.id, fileName, `uploads/po_documents/${po.id}/${fileName}`, 248000, uploader])
  console.log(`  ✓ po_documents → signed PO on ${po.po_number}`)

  // ── Foundational: give the existing cert a real file + verified ──
  const [fcRes] = await db.query(
    `UPDATE foundational_certificates SET filename=COALESCE(filename,'MillTestCert-CS-001.pdf'),
        file_size=COALESCE(file_size,196000), status='Verified'
     WHERE project_id=1 AND filename IS NULL`)
  console.log(`  ✓ foundational_certificates → ${fcRes.affectedRows} row given a file`)

  console.log('\nDone.\n')
  process.exit(0)
}

run().catch(e => { console.error('Seed failed:', e); process.exit(1) })
