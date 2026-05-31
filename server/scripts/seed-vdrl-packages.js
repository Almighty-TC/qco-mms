// ─── SEED VDRL PACKAGES ───────────────────────────────────────
// Idempotent seed: adds VDRL packages + docs for POs 1, 3, 4.
// Safe to run multiple times — uses INSERT IGNORE / existence checks.
const db = require('../db')

async function main() {

  // ─── PACKAGE DEFINITIONS ──────────────────────────────────────
  const packages = [
    {
      po_id: 1, po_number: 'PO-2024-001', project_id: 1,
      package_ref: 'CV-VDRL-001', name: 'Control Valve VDRL Package',
      docs: [
        { doc_number: 'CV-MDRA-001', title: 'Mechanical Data Book',      doc_type: 'Datasheet',     status: 'Approved',      abf_required: 1, revision: 'R0', required_date: '2025-06-15' },
        { doc_number: 'CV-DWG-001',  title: 'GA Drawing Package',        doc_type: 'Drawing',       status: 'Approved',      abf_required: 0, revision: 'R2', required_date: '2025-05-30' },
        { doc_number: 'CV-ITP-001',  title: 'Inspection & Test Plan',    doc_type: 'Procedure',     status: 'Under review',  abf_required: 1, revision: 'R1', required_date: '2025-06-01' },
        { doc_number: 'CV-CERT-001', title: 'Material Test Certs',       doc_type: 'Certificate',   status: 'Not submitted', abf_required: 1, revision: 'R0', required_date: '2025-07-01' },
        { doc_number: 'CV-SCH-001',  title: 'Fabrication Schedule',      doc_type: 'Specification', status: 'Overdue',       abf_required: 0, revision: 'R0', required_date: '2025-04-30' },
      ],
    },
    {
      po_id: 3, po_number: 'PO-2024-003', project_id: 1,
      package_ref: 'HVAC-VDRL-001', name: 'HVAC Equipment VDRL Package',
      docs: [
        { doc_number: 'HVAC-DWG-001',  title: 'Equipment Layout Drawing',      doc_type: 'Drawing',     status: 'Approved',      abf_required: 0, revision: 'R1', required_date: '2025-08-01' },
        { doc_number: 'HVAC-CERT-001', title: 'CE Conformity Certificate',     doc_type: 'Certificate', status: 'Not submitted', abf_required: 1, revision: 'R0', required_date: '2025-09-01' },
        { doc_number: 'HVAC-ITP-001',  title: 'Factory Acceptance Test Plan',  doc_type: 'Procedure',   status: 'Not submitted', abf_required: 1, revision: 'R0', required_date: '2025-09-15' },
      ],
    },
    {
      po_id: 4, po_number: 'PO-2024-004', project_id: 1,
      package_ref: 'SW-VDRL-001', name: 'MV Switchgear VDRL Package',
      docs: [
        { doc_number: 'SW-MDRA-001', title: 'Technical Data Book',     doc_type: 'Datasheet',   status: 'Under review',  abf_required: 1, revision: 'R1', required_date: '2025-07-15' },
        { doc_number: 'SW-DWG-001',  title: 'Single Line Diagram',     doc_type: 'Drawing',     status: 'Approved',      abf_required: 0, revision: 'R3', required_date: '2025-06-01' },
        { doc_number: 'SW-CERT-001', title: 'Type Test Certificates',  doc_type: 'Certificate', status: 'Overdue',       abf_required: 1, revision: 'R0', required_date: '2025-05-15' },
        { doc_number: 'SW-FAT-001',  title: 'FAT Test Report',         doc_type: 'Report',      status: 'Not submitted', abf_required: 1, revision: 'R0', required_date: '2025-08-01' },
      ],
    },
  ]

  // ─── INSERT PACKAGES + DOCS ───────────────────────────────────
  for (const pkg of packages) {
    // Check if package already exists for this PO
    const [[existing]] = await db.query(
      `SELECT id FROM vdrl_packages WHERE po_id=? AND project_id=? LIMIT 1`,
      [pkg.po_id, pkg.project_id]
    )

    let packageId
    if (existing) {
      packageId = existing.id
      console.log(`[${pkg.po_number}] Package already exists: id=${packageId}`)
    } else {
      const [r] = await db.query(
        `INSERT INTO vdrl_packages (project_id, po_id, package_ref, name, status, created_by, created_at)
         VALUES (?, ?, ?, ?, 'active', 1, NOW())`,
        [pkg.project_id, pkg.po_id, pkg.package_ref, pkg.name]
      )
      packageId = r.insertId
      console.log(`[${pkg.po_number}] Created package: id=${packageId} — ${pkg.name}`)
    }

    // ─── INSERT DOCUMENTS ─────────────────────────────────────
    let docsInserted = 0, docsSkipped = 0
    for (const doc of pkg.docs) {
      const [[ex]] = await db.query(
        `SELECT id FROM vdrl_documents WHERE package_id=? AND doc_number=? LIMIT 1`,
        [packageId, doc.doc_number]
      )
      if (ex) { docsSkipped++; continue }

      await db.query(
        `INSERT INTO vdrl_documents
          (package_id, doc_number, title, doc_type, status, abf_required, revision,
           required_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
        [packageId, doc.doc_number, doc.title, doc.doc_type, doc.status,
         doc.abf_required, doc.revision, doc.required_date]
      )
      docsInserted++
    }
    console.log(`[${pkg.po_number}] Docs: ${docsInserted} inserted, ${docsSkipped} skipped`)
  }

  // ─── VERIFICATION QUERY ───────────────────────────────────────
  console.log('\n── Verification ──────────────────────────────────────────')
  const [rows] = await db.query(`
    SELECT po.po_number, p.name, COUNT(d.id) AS doc_count
    FROM vdrl_packages p
    JOIN purchase_orders po ON po.id = p.po_id
    LEFT JOIN vdrl_documents d ON d.package_id = p.id
    WHERE p.project_id = 1
    GROUP BY p.id
    ORDER BY po.po_number
  `)
  for (const r of rows) {
    console.log(`  ${r.po_number.padEnd(16)} ${r.name.padEnd(40)} ${r.doc_count} docs`)
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
