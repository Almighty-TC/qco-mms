// ─── SEED TRACEABILITY (Pilbara, project_id = 1) ──────────────
// Run: node server/scripts/seed-traceability.js
// Idempotent — wipes project-1 traceability rows then reinserts the
// exact demo set: 10 VDRL certs, 5 approvals, 3 holds, cert versions,
// and full trace lifecycles for V-101 / V-102 (+ P-201A / CB-001).
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

const PID = 1

async function run() {
  console.log('\nSeeding traceability demo data for project 1…\n')

  // ── Wipe existing project-1 rows (clean re-seed) ─────────────
  const [certIds] = await db.query('SELECT id FROM traceability_certs WHERE project_id=?', [PID])
  if (certIds.length) {
    const ids = certIds.map(r => r.id)
    await db.query(`DELETE FROM traceability_cert_versions WHERE cert_id IN (${ids.map(() => '?').join(',')})`, ids)
  }
  const [holdIds] = await db.query('SELECT id FROM traceability_holds WHERE project_id=?', [PID])
  if (holdIds.length) {
    const ids = holdIds.map(r => r.id)
    await db.query(`DELETE FROM traceability_chases WHERE hold_id IN (${ids.map(() => '?').join(',')})`, ids)
  }
  await db.query('DELETE FROM traceability_certs WHERE project_id=?', [PID])
  await db.query('DELETE FROM traceability_holds WHERE project_id=?', [PID])
  await db.query('DELETE FROM traceability_trace_lifecycle WHERE project_id=?', [PID])
  console.log('  • cleared previous project-1 rows')

  // ── 10 VDRL certs ────────────────────────────────────────────
  // [po_ref, vendor, tag, document_name, cert_type, status, due, received, heat_ref]
  const vdrl = [
    ['PO-2024-0112', 'Emerson Process Mgmt', 'V-101', 'Datasheet (final)',           'Datasheet',        'received', '2025-02-15', '2025-02-12', null],
    ['PO-2024-0112', 'Emerson Process Mgmt', 'V-101', 'Mill test cert (EN10204 3.1)', 'Mill test cert',   'received', '2025-04-01', '2025-04-22', 'A24-887'],
    ['PO-2024-0112', 'Emerson Process Mgmt', 'V-102', 'Mill test cert (EN10204 3.1)', 'Mill test cert',   'overdue',  '2025-04-01', null,         null],
    ['PO-2024-0112', 'Emerson Process Mgmt', 'V-101', 'PWHT chart',                   'Heat-treatment',   'received', '2025-04-25', '2025-04-25', 'A24-887'],
    ['PO-2024-0112', 'Emerson Process Mgmt', 'V-101', 'FAT report',                   'FAT report',       'pending',  '2025-04-22', null,         null],
    ['PO-2024-0098', 'Metso Outotec',        'P-201A','CoC',                          'Certificate of Conformity', 'pending', '2025-04-30', null, null],
    ['PO-2024-0098', 'Metso Outotec',        'P-201A','Vibration test cert',          'Test cert',        'received', '2025-04-25', '2025-04-24', null],
    ['PO-2024-0087', 'BlueScope Steel',       null,   'Heat cert (per lot)',          'Heat cert',        'received', '2025-03-15', '2025-03-12', 'BS-LOT-1'],
    ['PO-2024-0087', 'BlueScope Steel',       null,   'Heat cert (per lot) — 2nd lot','Heat cert',        'received', '2025-04-15', '2025-04-08', 'BS-LOT-2'],
    ['PO-2024-0188', 'Pentair Valves',        null,   'Hydrostatic test cert',        'Test cert',        'received', '2025-02-14', '2025-02-14', null],
  ]

  const vdrlCertIds = []
  for (const [po, vendor, tag, doc, ctype, status, due, rec, heat] of vdrl) {
    const [r] = await db.query(
      `INSERT INTO traceability_certs
         (project_id, category, po_ref, vendor_name, tag, document_name, cert_type, status,
          due_date, received_date, is_required, heat_ref, file_name, file_size, uploader, uploaded_date)
       VALUES (?, 'vdrl', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      [PID, po, vendor, tag, doc, ctype, status, due, rec, heat,
       rec ? `${doc.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf` : null,
       rec ? 480000 + Math.floor(Math.random() * 900000) : null,
       vendor, rec ? `${rec} 09:00:00` : null]
    )
    vdrlCertIds.push(r.insertId)
  }
  console.log('  ✓ 10 VDRL certs')

  // ── Cert versions for received VDRL certs ────────────────────
  // Row index 1 (Mill test cert V-101) gets two revisions to show history.
  for (let i = 0; i < vdrl.length; i++) {
    const [po, vendor, tag, doc, ctype, status, due, rec, heat] = vdrl[i]
    if (status !== 'received') continue
    const certId = vdrlCertIds[i]
    const fileBase = doc.replace(/[^a-zA-Z0-9]+/g, '-')
    if (i === 1) {
      // Mill test cert — Rev A superseded, Rev B verified
      await db.query(
        `INSERT INTO traceability_cert_versions
           (cert_id, rev, heat_ref, applies_to, file_name, file_size, status, created_by_name, created_date, verified_by_name, verified_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [certId, 'A', heat, 'Shell plate', `${fileBase}-RevA.pdf`, 612000, 'rejected', vendor, '2025-04-10 08:30:00', 'P. Nguyen', '2025-04-12 10:00:00'])
      await db.query(
        `INSERT INTO traceability_cert_versions
           (cert_id, rev, heat_ref, applies_to, file_name, file_size, status, created_by_name, created_date, verified_by_name, verified_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [certId, 'B', heat, 'Shell plate', `${fileBase}-RevB.pdf`, 689000, 'verified', vendor, '2025-04-22 09:00:00', 'P. Nguyen', '2025-04-23 14:20:00'])
    } else {
      await db.query(
        `INSERT INTO traceability_cert_versions
           (cert_id, rev, heat_ref, applies_to, file_name, file_size, status, created_by_name, created_date, verified_by_name, verified_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [certId, 'A', heat, tag ? `Tag ${tag}` : 'Lot', `${fileBase}.pdf`, 500000, 'verified', vendor, `${rec} 09:00:00`, 'P. Nguyen', `${rec} 15:00:00`])
    }
  }
  console.log('  ✓ cert versions seeded')

  // ── 5 cert approvals ─────────────────────────────────────────
  // [file, cert_type, item, scope/applies_to, vendor, uploader, uploaded, priority]
  const approvals = [
    ['MTC-3.1-Heat-A24-887.pdf',     'Heat cert',                 'CS-001', '1240m',         'BlueScope Steel', 'D. Lin (Emerson)',    '2025-03-12', 'normal'],
    ['CoC-Pentair-DN400-BCH77.pdf',  'Certificate of Conformity', 'CS-002', '48 EA',         'Pentair Valves',  'I. Brown (Pentair)',  '2025-02-14', 'normal'],
    ['MTC-3.1-Pentair-Body.pdf',     'Mill test cert',            'CS-002', 'Body castings', 'Pentair Valves',  'I. Brown (Pentair)',  '2025-02-14', 'high'],
    ['BatchCert-Prysmian-LOT44B.pdf','Batch cert',                'CB-001', 'Drum 4',        'Prysmian Group',  'A. Costa (Prysmian)', '2025-04-05', 'normal'],
    ['CoC-Metso-P201A.pdf',          'Certificate of Conformity', 'P-201A', 'Pump assembly', 'Metso Outotec',   'J. Korhonen (Metso)', '2025-04-18', 'high'],
  ]
  const apprIds = []
  for (const [file, ctype, item, scope, vendor, uploader, uploaded, priority] of approvals) {
    const [r] = await db.query(
      `INSERT INTO traceability_certs
         (project_id, category, vendor_name, tag, document_name, cert_type, item_scope, applies_to,
          status, priority, file_name, file_size, uploader, uploaded_date, heat_ref)
       VALUES (?, 'approval', ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?, ?, ?)`,
      [PID, vendor, item, file, ctype, item, scope, priority, file, 740000 + Math.floor(Math.random() * 800000),
       uploader, `${uploaded} 11:00:00`, ctype === 'Heat cert' ? 'A24-887' : null]
    )
    apprIds.push(r.insertId)
  }
  console.log('  ✓ 5 cert approvals')

  // ── 3 holds (related_cert_id wired for verify-releases-hold) ──
  // hold 1 → VDRL overdue mill cert V-102; hold 2 → approval CoC-Metso (P-201A);
  // hold 3 → approval BatchCert (CB-001)
  const holds = [
    ['V-102',  'Pressure vessel — Train B', 'No EN10204 3.1 cert on file', 'WH-A · A-04-03', '2025-04-18', 11, vdrlCertIds[2], 'Emerson Process Mgmt', 'qa@emerson.example'],
    ['P-201A', 'Centrifugal pump · booster','CoC pending QA verification', 'WH-B · B-02-04', '2025-04-18', 11, apprIds[4],     'Metso Outotec',        'certs@metso.example'],
    ['CB-001', 'MV cable Drum 4',           'Batch cert pending QA',       'WH-C · C-01-03', '2025-04-05', 24, apprIds[3],     'Prysmian Group',       'docs@prysmian.example'],
  ]
  for (const [tag, item, reason, loc, since, age, relCert, vendor, email] of holds) {
    await db.query(
      `INSERT INTO traceability_holds
         (project_id, tag, item, hold_reason, location, since_date, age_days, related_cert_id, vendor_name, vendor_email, status)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'active')`,
      [PID, tag, item, reason, loc, since, age, relCert, vendor, email]
    )
  }
  console.log('  ✓ 3 holds')

  // ── Trace lifecycles ─────────────────────────────────────────
  // [stage, ref, date, actor, detail, node_state, badge]
  const lifecycles = {
    'V-101': [
      ['PO',      'PO-2024-0112 · Line 001',     '12 Jan 2025', 'S. Patel',       'Inlet separator V-101 awarded to Emerson Process Mgmt', 'complete', null],
      ['MFG',     'Heat A24-887',                '08 Mar 2025', 'Emerson QA',     'Shell plate rolled and welded; EN10204 3.1 MTC issued', 'complete', null],
      ['INSPECT', 'ITP-2025-088',                '22 Apr 2025', 'Bureau Veritas', 'FAT inspection — all hold points cleared (Class I)',    'complete', null],
      ['SCN',     'SCN-2024-0047 · 3 pkgs',      '28 Feb 2025', 'R. Chen',        'Shipment booked · Maersk · Houston → Port Hedland',     'complete', null],
      ['RECEIPT', 'WH-A · A-04-03',              '16 Apr 2025', 'R. Chen',        'Goods receipted · Good condition · MC sign-off',        'complete', null],
      ['CERT',    'MTC-3.1-Heat-A24-887.pdf',    '18 Apr 2025', 'P. Nguyen',      'Mill test cert verified · Class I traceability complete','complete', null],
    ],
    'V-102': [
      ['PO',      'PO-2024-0112 · Line 002',     '12 Jan 2025', 'S. Patel',       'Inlet separator V-102 awarded to Emerson Process Mgmt', 'complete', null],
      ['MFG',     'Heat (pending)',              '15 Mar 2025', 'Emerson QA',     'Shell plate rolled; cert package not yet released by Emerson QA', 'warning', 'WATCH'],
      ['INSPECT', 'ITP-2025-088 (re-test)',      '22 Apr 2025', 'Bureau Veritas', 'FAT inspection FAILED on first attempt — re-test scheduled 06 May', 'blocked', 'BLOCKED'],
      ['SCN',     '(blocked)',                   '—',           '—',              'Cannot dispatch until FAT pass + MTC received',         'pending', 'PENDING'],
      ['RECEIPT', '(pending)',                   '—',           '—',              '—',                                                     'pending', 'PENDING'],
      ['CERT',    '(missing)',                   '—',           '—',              'MTC EN10204 3.1 required before commissioning',         'pending', 'BLOCKED'],
    ],
    // Derived minimal chains so Holds → View works for these tags
    'P-201A': [
      ['PO',      'PO-2024-0098 · Line 001',     '20 Jan 2025', 'S. Patel',       'Centrifugal pump P-201A awarded to Metso Outotec',      'complete', null],
      ['MFG',     'Heat M-5521',                 '10 Mar 2025', 'Metso QA',       'Pump casing cast and machined; material certs issued',  'complete', null],
      ['INSPECT', 'ITP-2025-101',                '15 Apr 2025', 'Bureau Veritas', 'Performance + vibration test witnessed — passed',       'complete', null],
      ['SCN',     'SCN-2024-0052 · 2 pkgs',      '16 Apr 2025', 'R. Chen',        'Shipment booked · DHL · Tampere → Port Hedland',        'complete', null],
      ['RECEIPT', 'WH-B · B-02-04',              '18 Apr 2025', 'R. Chen',        'Goods receipted · Good condition',                      'complete', null],
      ['CERT',    'CoC-Metso-P201A.pdf',         '—',           'pending QA',     'Certificate of Conformity uploaded — pending QA verification', 'warning', 'PENDING'],
    ],
    'CB-001': [
      ['PO',      'PO-2024-0099 · Line 010',     '18 Jan 2025', 'S. Patel',       'MV cable CB-001 awarded to Prysmian Group',             'complete', null],
      ['MFG',     'Lot 44B',                     '02 Apr 2025', 'Prysmian QA',    'Cable drawn and drummed; batch cert prepared',          'complete', null],
      ['INSPECT', 'ITP-2025-115',                '04 Apr 2025', 'Prysmian QA',    'Routine electrical tests passed',                       'complete', null],
      ['SCN',     'SCN-2024-0061 · 1 pkg',       '05 Apr 2025', 'R. Chen',        'Drum 4 shipped · Genoa → Port Hedland',                 'complete', null],
      ['RECEIPT', 'WH-C · C-01-03',              '05 Apr 2025', 'R. Chen',        'Drum 4 receipted · Good condition',                     'complete', null],
      ['CERT',    'BatchCert-Prysmian-LOT44B.pdf','—',          'pending QA',     'Batch cert uploaded — pending QA verification',         'warning', 'PENDING'],
    ],
  }
  for (const [tag, stages] of Object.entries(lifecycles)) {
    let order = 0
    for (const [stage, ref, date, actor, detail, state, badge] of stages) {
      await db.query(
        `INSERT INTO traceability_trace_lifecycle
           (project_id, tag, stage, ref, event_date, actor, detail, node_state, badge, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [PID, tag, stage, ref, date, actor, detail, state, badge, order++]
      )
    }
  }
  console.log('  ✓ trace lifecycles (V-101, V-102, P-201A, CB-001)')

  console.log('\nDone.\n')
  process.exit(0)
}

run().catch(e => { console.error('Seed failed:', e); process.exit(1) })
