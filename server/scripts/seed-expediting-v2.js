// ─── SEED EXPEDITING V2 ───────────────────────────────────────
// Reseeds clean milestone data for 5 Pilbara locked POs with a
// deliberate RAG spread, plus VDRL package for PO-TEST-001.
const db = require('../db')

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r.toISOString().slice(0, 10)
}

const today = new Date().toISOString().slice(0, 10)

// Milestones per PO — [planned_offset, forecast_offset or null, actual_offset or null]
// offsets are days from today (negative = past)
const PO_CONFIGS = {
  'PO-TEST-001': {
    label: 'Complete',
    milestones: [
      { planned: -180, forecast: null, actual: -150 },
      { planned: -120, forecast: null, actual: -90 },
      { planned:  -60, forecast: null, actual: -30 },
      { planned:  -20, forecast: null, actual: -10 },
      { planned:   -5, forecast: null, actual:  -2 },
    ],
  },
  'PO-2024-001': {
    label: 'On Track',
    milestones: [
      { planned: -160, forecast: null,   actual: -130 },
      { planned:  -90, forecast: null,   actual:  -60 },
      { planned:  -30, forecast: null,   actual:  -10 },
      { planned:   10, forecast: 21,     actual: null },
      { planned:   25, forecast: 35,     actual: null },
    ],
  },
  'PO-2024-002': {
    label: 'Breached',
    milestones: [
      { planned: -120, forecast: null, actual: -100 },
      { planned:  -60, forecast: null, actual:  -40 },
      { planned:  -10, forecast: -1,   actual: null },
      { planned:   15, forecast: null,  actual: null },
      { planned:   30, forecast: null,  actual: null },
    ],
  },
  'PO-2024-003': {
    label: 'At Risk',
    milestones: [
      { planned: -100, forecast: null, actual:  -80 },
      { planned:  -50, forecast: null, actual:  -30 },
      { planned:    5, forecast: 10,   actual: null },
      { planned:   20, forecast: null,  actual: null },
      { planned:   40, forecast: null,  actual: null },
    ],
  },
  'PO-2024-004': {
    label: 'Ongoing',
    milestones: [
      { planned: -90, forecast: null, actual: -70 },
      { planned: -40, forecast: null, actual: null },
      { planned:  10, forecast: null, actual: null },
      { planned:  30, forecast: null, actual: null },
      { planned:  60, forecast: null, actual: null },
    ],
  },
}

const MILESTONE_LABELS = ['PO Award', 'FAT / Inspection', 'Ready for Shipment', 'ETD / Ship', 'ROS / ETA']

function computeStatus(m) {
  if (m.actual) return 'complete'
  const t = new Date(today)
  if (m.forecast) {
    const fd = new Date(addDays(today, m.forecast))
    const days = (fd - t) / 86400000
    if (fd < t) return 'overdue'      // maps to 'breached' in RAG logic
    if (days <= 14) return 'in_progress' // at_risk — within 14 days
    return 'in_progress'
  }
  return 'not_started'
}

async function run() {
  try {
    // ─── GET PO IDS ───────────────────────────────────────────
    const [poRows] = await db.query(
      `SELECT id, po_number FROM purchase_orders WHERE project_id=1 AND is_locked=1`
    )
    const poMap = {}
    poRows.forEach(r => { poMap[r.po_number] = r.id })
    console.log('Found POs:', JSON.stringify(poMap))

    // ─── DELETE EXISTING MILESTONES ───────────────────────────
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    const poIds = Object.values(poMap)
    await db.query(`DELETE FROM po_milestones WHERE po_id IN (${poIds.join(',')})`)
    console.log('Deleted existing milestones for', poIds.length, 'POs')

    // ─── SEED MILESTONES ──────────────────────────────────────
    let msTotal = 0
    for (const [poNum, cfg] of Object.entries(PO_CONFIGS)) {
      const poId = poMap[poNum]
      if (!poId) { console.warn('PO not found:', poNum); continue }

      for (let i = 0; i < cfg.milestones.length; i++) {
        const m = cfg.milestones[i]
        const planned  = addDays(today, m.planned)
        const forecast = m.forecast != null ? addDays(today, m.forecast) : null
        const actual   = m.actual   != null ? addDays(today, m.actual)   : null
        const status   = computeStatus(m)

        await db.query(
          `INSERT INTO po_milestones
            (po_id, step_order, label, planned_date, forecast_date, actual_date, status,
             notes, created_by, is_deleted, forecast_changed_count, is_required)
           VALUES (?, ?, ?, ?, ?, ?, ?, '', 1, 0, 0, 1)`,
          [poId, i + 1, MILESTONE_LABELS[i], planned, forecast, actual, status]
        )
        msTotal++
      }
      console.log(`  Seeded 5 milestones for ${poNum} (${cfg.label})`)
    }
    console.log(`Total milestones inserted: ${msTotal}`)

    // ─── HEAT NUMBER FLAGS ────────────────────────────────────
    // Set heat_number_required=1 on first line of PO-2024-002 and PO-2024-003
    for (const poNum of ['PO-2024-002', 'PO-2024-003']) {
      const poId = poMap[poNum]
      if (!poId) continue
      const [[firstLine]] = await db.query(
        `SELECT id FROM po_lines WHERE po_id=? ORDER BY id LIMIT 1`, [poId]
      )
      if (firstLine) {
        await db.query(
          `UPDATE po_lines SET heat_number_required=1 WHERE id=?`, [firstLine.id]
        )
        console.log(`  Set heat_number_required=1 on first line of ${poNum}`)
      }
    }

    // ─── SEED VDRL FOR PO-TEST-001 ────────────────────────────
    const testPoId = poMap['PO-TEST-001']
    if (testPoId) {
      // Delete existing VDRL
      const [existPkgs] = await db.query(`SELECT id FROM vdrl_packages WHERE po_id=?`, [testPoId])
      for (const pkg of existPkgs) {
        await db.query(`DELETE FROM vdrl_documents WHERE package_id=?`, [pkg.id])
      }
      await db.query(`DELETE FROM vdrl_packages WHERE po_id=?`, [testPoId])
      console.log('Cleared existing VDRL data for PO-TEST-001')

      // Insert package
      const [pkgResult] = await db.query(
        `INSERT INTO vdrl_packages (project_id, po_id, package_ref, name, status, created_by, created_at)
         VALUES (1, ?, 'VDRL-001', 'Equipment Packages VDRL', 'active', 1, NOW())`,
        [testPoId]
      )
      const pkgId = pkgResult.insertId
      console.log(`  Created VDRL package id=${pkgId}`)

      const twoWeeksAgo = addDays(today, -14)
      const docs = [
        { title: 'General Arrangement Drawing',   doc_type: 'Drawing',    status: 'Approved',      abf: 'AFC', revision: 'R2', required_date: null },
        { title: 'Pressure Vessel Datasheet',     doc_type: 'Datasheet',  status: 'Approved',      abf: 'AFC', revision: 'R3', required_date: null },
        { title: 'Fabrication Drawing Pack',      doc_type: 'Drawing',    status: 'Under review',  abf: 'C1',  revision: 'R1', required_date: null },
        { title: 'Welding Procedure Specification',doc_type: 'Procedure', status: 'Overdue',       abf: 'C1',  revision: 'R0', required_date: twoWeeksAgo },
        { title: 'FAT Procedure',                 doc_type: 'Procedure',  status: 'Not submitted', abf: 'AFC', revision: 'R0', required_date: null },
      ]

      for (let i = 0; i < docs.length; i++) {
        const d = docs[i]
        const docNum = String(i + 1).padStart(3, '0')
        await db.query(
          `INSERT INTO vdrl_documents
            (package_id, doc_number, title, doc_type, revision, status, required_date, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
          [pkgId, docNum, d.title, d.doc_type, d.revision, d.status, d.required_date]
        )
      }
      console.log(`  Inserted 5 VDRL documents for PO-TEST-001`)
    }

    await db.query('SET FOREIGN_KEY_CHECKS=1')
    console.log('\n✓ Seed complete')
    process.exit(0)
  } catch (e) {
    console.error('Seed error:', e)
    process.exit(1)
  }
}

run()
