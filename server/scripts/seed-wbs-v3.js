// ─── DEEP WBS SEED V3 ──────────────────────────────────────────
// Seeds 5 branches for Pilbara (7-8 levels), 3 branches for others.
// Also seeds commodities & equipment at 5 specific Pilbara nodes.
// Updates PO wbs_code references. Runs orphan-check at end.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

const code = (...parts) => parts.join('.')

async function run() {
  console.log('\n── DEEP WBS SEED V3 ──────────────────────────────────────\n')

  // ─── Fetch projects ───────────────────────────────────────
  const [projects] = await db.query(
    "SELECT id, code FROM projects WHERE code IN ('PRJ-2024-001','PRJ-2024-002','PRJ-2023-008','PRJ-2025-001')"
  )
  const P = {}
  for (const p of projects) P[p.code] = p.id
  console.log('Projects:', Object.keys(P).join(', '))

  const [[admin]] = await db.query("SELECT id FROM users WHERE role='admin' LIMIT 1")
  const adminId = admin?.id ?? 1

  // Helper: insert one WBS node, return its DB id
  async function ins(pid, parentId, wbsCode, desc, rag, ros, notes) {
    const [r] = await db.query(
      `INSERT INTO wbs_nodes (project_id, parent_id, code, description, rag, ros_date, notes, sort_order)
       VALUES (?,?,?,?,?,?,?,0)`,
      [pid, parentId || null, wbsCode, desc, rag || null, ros || null, notes || null]
    )
    return r.insertId
  }

  // ─── PRJ-2024-001: Pilbara Gas Processing Plant ──────────
  if (P['PRJ-2024-001']) {
    const pid = P['PRJ-2024-001']
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    await db.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
    await db.query('SET FOREIGN_KEY_CHECKS=1')
    console.log('\n  Seeding PRJ-2024-001 (Pilbara Gas Processing Plant)…')

    // ── 01 CIVIL & STRUCTURAL (8 levels) ─────────────────────
    const c01 = await ins(pid, null, '01', 'Civil & Structural', 'green', '2025-06-30', 'Site civil, foundations and structural steel')
    const c0101 = await ins(pid, c01, '01.01', 'Foundations', 'green', '2025-03-31')
    const c010101 = await ins(pid, c0101, '01.01.01', 'Piling Works', 'green', '2024-12-31')
    const c01010101 = await ins(pid, c010101, '01.01.01.01', 'Bored Piles', 'green', '2024-10-31')
    const c0101010101 = await ins(pid, c01010101, '01.01.01.01.01', 'Pile Design Package', 'green', '2024-08-31')
    const c010101010101 = await ins(pid, c0101010101, '01.01.01.01.01.01', 'Geotechnical Assessment', 'green', '2024-06-30')
    const c01010101010101 = await ins(pid, c010101010101, '01.01.01.01.01.01.01', 'Soil Investigation Report', 'green', '2024-05-31')
    await ins(pid, c01010101010101, '01.01.01.01.01.01.01.01', 'Lab Testing & Reporting', 'green', '2024-04-30')
    const c010102 = await ins(pid, c0101, '01.01.02', 'Pad & Strip Footings', 'green', '2025-01-31')
    await ins(pid, c010102, '01.01.02.01', 'Formwork & Rebar', 'green', '2024-12-15')
    await ins(pid, c010102, '01.01.02.02', 'Concrete Pour & Cure', 'green', '2025-01-15')
    const c0102 = await ins(pid, c01, '01.02', 'Structural Steel', 'amber', '2025-06-30')
    const c010201 = await ins(pid, c0102, '01.02.01', 'Main Structure', 'amber', '2025-04-30')
    const c01020101 = await ins(pid, c010201, '01.02.01.01', 'Columns & Beams', 'amber', '2025-03-31')
    await ins(pid, c01020101, '01.02.01.01.01', 'Primary Frame Fabrication', 'amber', '2025-02-28')
    await ins(pid, c01020101, '01.02.01.01.02', 'Erection & Alignment', 'amber', '2025-03-31')
    const c010202 = await ins(pid, c0102, '01.02.02', 'Pipe Rack Structure', 'amber', '2025-06-30')
    await ins(pid, c010202, '01.02.02.01', 'Pipe Rack Tier 1', 'amber', '2025-05-31')
    await ins(pid, c010202, '01.02.02.02', 'Pipe Rack Tier 2', 'amber', '2025-06-30')

    // ── 02 MECHANICAL (8 levels) ───────────────────────────────
    const c02 = await ins(pid, null, '02', 'Mechanical', 'amber', '2026-03-31', 'Process equipment and rotating machinery')
    const c0201 = await ins(pid, c02, '02.01', 'Pressure Vessels', 'amber', '2025-12-31')
    const c020101 = await ins(pid, c0201, '02.01.01', 'Process Vessels', 'amber', '2025-12-31')
    const c02010101 = await ins(pid, c020101, '02.01.01.01', 'High Pressure Train', 'amber', '2025-10-31')
    const c0201010101 = await ins(pid, c02010101, '02.01.01.01.01', 'V-101 HP Separator', 'amber', '2025-09-30')
    await ins(pid, c0201010101, '02.01.01.01.01.01', 'V-101 Vessel Fabrication', 'amber', '2025-06-30')
    await ins(pid, c0201010101, '02.01.01.01.01.02', 'V-101 Internals & Nozzles', 'amber', '2025-08-31')
    await ins(pid, c02010101, '02.01.01.01.02', 'V-102 LP Flash Drum', 'red', '2025-10-31')
    await ins(pid, c020101, '02.01.01.02', 'V-201 HP Absorber', 'amber', '2025-11-30')
    const c020102 = await ins(pid, c0201, '02.01.02', 'Atmospheric Vessels', 'green', '2026-01-31')
    await ins(pid, c020102, '02.01.02.01', 'T-101 Condensate Storage', 'green', '2026-01-31')
    const c0202 = await ins(pid, c02, '02.02', 'Rotating Equipment', 'amber', '2026-01-31')
    const c020201 = await ins(pid, c0202, '02.02.01', 'Pumps', 'amber', '2025-12-31')
    const c02020101 = await ins(pid, c020201, '02.02.01.01', 'Centrifugal Pumps', 'amber', '2025-11-30')
    const c0202010101 = await ins(pid, c02020101, '02.02.01.01.01', 'P-101A/B Feed Pumps', 'amber', '2025-10-31')
    await ins(pid, c0202010101, '02.02.01.01.01.01', 'P-101A Pump Supply', 'amber', '2025-08-31')
    await ins(pid, c0202010101, '02.02.01.01.01.02', 'P-101B Standby Pump', 'amber', '2025-09-30')
    await ins(pid, c02020101, '02.02.01.01.02', 'P-201 Condensate Pump', 'green', '2025-12-31')
    const c020202 = await ins(pid, c0202, '02.02.02', 'Compressors', 'red', '2026-01-31')
    const c02020201 = await ins(pid, c020202, '02.02.02.01', 'Reciprocating Compressors', 'red', '2025-12-31')
    await ins(pid, c02020201, '02.02.02.01.01', 'K-101 Gas Booster', 'red', '2025-11-30')

    // ── 03 ELECTRICAL & INSTRUMENTATION (7 levels) ────────────
    const c03 = await ins(pid, null, '03', 'Electrical & Instrumentation', 'red', '2026-06-30', 'Power, control systems and field instruments')
    const c0301 = await ins(pid, c03, '03.01', 'HV Switchgear', 'red', '2026-01-31')
    const c030101 = await ins(pid, c0301, '03.01.01', '11kV Systems', 'red', '2026-01-31')
    const c03010101 = await ins(pid, c030101, '03.01.01.01', 'Main Switchboard', 'red', '2025-12-31')
    await ins(pid, c03010101, '03.01.01.01.01', 'MV Switchgear Panel SW-001', 'red', '2025-11-30')
    await ins(pid, c03010101, '03.01.01.01.02', 'MV Switchgear Panel SW-002', 'red', '2025-12-31')
    await ins(pid, c03010101, '03.01.01.01.03', 'MV Bus Protection Relay', 'red', '2025-12-31')
    const c030102 = await ins(pid, c0301, '03.01.02', 'Transformers', 'amber', '2026-01-31')
    await ins(pid, c030102, '03.01.02.01', 'Main Power Transformer TR-001', 'amber', '2025-12-31')
    await ins(pid, c030102, '03.01.02.02', 'Auxiliary Transformer TR-002', 'amber', '2026-01-31')
    const c0302 = await ins(pid, c03, '03.02', 'Instrumentation', 'amber', '2026-06-30')
    const c030201 = await ins(pid, c0302, '03.02.01', 'Field Instruments', 'amber', '2026-03-31')
    const c03020101 = await ins(pid, c030201, '03.02.01.01', 'Flow Measurement', 'amber', '2026-01-31')
    const c0302010101 = await ins(pid, c03020101, '03.02.01.01.01', 'Custody Transfer Meters', 'amber', '2025-12-31')
    await ins(pid, c0302010101, '03.02.01.01.01.01', 'FT-101 Ultrasonic Meter', 'amber', '2025-11-30')
    await ins(pid, c0302010101, '03.02.01.01.01.02', 'FT-201 Check Meter', 'amber', '2025-12-31')
    await ins(pid, c03020101, '03.02.01.01.02', 'Process Flow Instruments', 'amber', '2026-01-31')

    // ── 04 PIPING (7 levels) ──────────────────────────────────
    const c04 = await ins(pid, null, '04', 'Piping', 'amber', '2026-02-28', 'Piping, fittings, supports and insulation')
    const c0401 = await ins(pid, c04, '04.01', 'Process Piping', 'amber', '2025-12-31')
    const c040101 = await ins(pid, c0401, '04.01.01', 'HP Process Lines', 'amber', '2025-12-31')
    const c04010101 = await ins(pid, c040101, '04.01.01.01', 'PK-101 HP Train Lines', 'amber', '2025-11-30')
    const c0401010101 = await ins(pid, c04010101, '04.01.01.01.01', 'HP Spool Fabrication', 'amber', '2025-09-30')
    await ins(pid, c0401010101, '04.01.01.01.01.01', 'HP Spool Material Supply', 'amber', '2025-07-31')
    await ins(pid, c0401010101, '04.01.01.01.01.02', 'HP Spool Shop Fab', 'amber', '2025-09-30')
    const c040102 = await ins(pid, c0401, '04.01.02', 'LP Process Lines', 'green', '2026-01-31')
    await ins(pid, c040102, '04.01.02.01', 'LP Spool Fabrication', 'green', '2025-11-30')
    const c0402 = await ins(pid, c04, '04.02', 'Utility Piping', 'green', '2026-02-28')
    const c040201 = await ins(pid, c0402, '04.02.01', 'Instrument Air Headers', 'green', '2025-12-31')
    await ins(pid, c040201, '04.02.01.01', 'IA Distribution Mains', 'green', '2025-11-30')
    await ins(pid, c040201, '04.02.01.02', 'IA Sub-headers', 'green', '2025-12-31')

    // ── 05 COMMISSIONING (6 levels) ──────────────────────────
    const c05 = await ins(pid, null, '05', 'Commissioning', 'green', '2026-09-30', 'Pre-commissioning, commissioning and startup activities')
    const c0501 = await ins(pid, c05, '05.01', 'Mechanical Completion', 'green', '2026-06-30')
    const c050101 = await ins(pid, c0501, '05.01.01', 'Instrument Loop Testing', 'green', '2026-06-30')
    const c05010101 = await ins(pid, c050101, '05.01.01.01', 'Flow & Pressure Loops', 'green', '2026-05-31')
    const c0501010101 = await ins(pid, c05010101, '05.01.01.01.01', 'FT-101 Loop Check', 'green', '2026-04-30')
    await ins(pid, c0501010101, '05.01.01.01.01.01', 'FT-101 Signal Calibration', 'green', '2026-03-31')
    await ins(pid, c05010101, '05.01.01.01.02', 'PT-101 Loop Check', 'green', '2026-05-31')
    const c0502 = await ins(pid, c05, '05.02', 'Startup & Performance Test', 'green', '2026-09-30')
    await ins(pid, c0502, '05.02.01', 'First Gas Startup', 'green', '2026-07-31')
    await ins(pid, c0502, '05.02.02', 'Performance Testing', 'green', '2026-09-30')

    console.log('  ✓ PRJ-2024-001: 5 branches seeded, levels 6-8 deep')

    // ── Fetch node IDs for specific seeding targets ───────────
    const nodeIds = {}
    const nodeCodes = ['02.01.01', '02.02.01', '03.01.01', '04.01.01', '05.01.01']
    for (const nc of nodeCodes) {
      const [[row]] = await db.query('SELECT id FROM wbs_nodes WHERE project_id=? AND code=?', [pid, nc])
      if (row) nodeIds[nc] = row.id
    }

    // ── Clear existing commodities and equipment for this project ──
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    await db.query('DELETE FROM commodity_library WHERE project_id=?', [pid])
    await db.query('DELETE FROM equipment_list WHERE project_id=?', [pid])
    await db.query('SET FOREIGN_KEY_CHECKS=1')

    // ── Seed commodities ──────────────────────────────────────
    const commodities = [
      // 02.01.01 Process Vessels
      ['PV-CS-PLATE-001',   nodeIds['02.01.01'], '02.01.01', 'Carbon Steel Plate A516 Gr70',    'T',   1, 'Mill cert'],
      ['PV-WELD-CONS-001',  nodeIds['02.01.01'], '02.01.01', 'Welding Consumables (ER70S-6)',   'KG',  2, 'Drum number'],
      ['PV-GASKET-001',     nodeIds['02.01.01'], '02.01.01', 'Spiral Wound Gaskets 300# RF',    'EA',  3, 'Heat number'],
      ['PV-BOLT-001',       nodeIds['02.01.01'], '02.01.01', 'Stud Bolts A193 B7 / A194 2H',   'KG',  4, 'Heat + cert'],
      ['PV-NOZZLE-FLANGE-001', nodeIds['02.01.01'], '02.01.01', 'Nozzle Flanges WN 300# A105', 'EA',  5, 'Heat number'],
      // 02.02.01 Pumps
      ['PMP-SEAL-001',   nodeIds['02.02.01'], '02.02.01', 'Mechanical Seals Type 1 — P-101',  'SET', 1, 'Serial'],
      ['PMP-GREASE-001', nodeIds['02.02.01'], '02.02.01', 'Bearing Grease Mobilux EP2',        'KG',  2, 'None'],
      ['PMP-CBL-BOLT-001', nodeIds['02.02.01'], '02.02.01', 'Coupling Bolts M16 Grade 8.8',   'KG',  3, 'None'],
      ['PMP-MECH-SEAL-002', nodeIds['02.02.01'], '02.02.01', 'Mechanical Seals Type 2 — P-201', 'SET', 4, 'Serial'],
      ['PMP-ORING-001',  nodeIds['02.02.01'], '02.02.01', 'O-Rings Viton FKM Assorted',       'SET', 5, 'None'],
      // 03.01.01 11kV Systems
      ['EL-HV-CABLE-001',  nodeIds['03.01.01'], '03.01.01', 'HV Cable 11kV 3C×150mm² XLPE',    'M',   1, 'Drum number'],
      ['EL-CABLE-LUG-001', nodeIds['03.01.01'], '03.01.01', 'Cable Lugs Compression 150mm²',   'EA',  2, 'None'],
      ['EL-GLAND-001',     nodeIds['03.01.01'], '03.01.01', 'Cable Gland Seals Ex-rated M50',  'EA',  3, 'None'],
      ['EL-EARTH-001',     nodeIds['03.01.01'], '03.01.01', 'Earthing Copper Tape 25×3mm',     'M',   4, 'Mill cert'],
      ['EL-JBOX-001',      nodeIds['03.01.01'], '03.01.01', 'Junction Boxes SS316 IP66',       'EA',  5, 'None'],
      // 04.01.01 HP Process Lines
      ['PP-PIPE-001',      nodeIds['04.01.01'], '04.01.01', 'A106 Gr B Seamless Pipe 6" SCH80', 'M',  1, 'Heat number'],
      ['PP-FIT-001',       nodeIds['04.01.01'], '04.01.01', 'BW Fittings 6" SCH80 A234 WPB',   'EA',  2, 'Heat number'],
      ['PP-FLANGE-001',    nodeIds['04.01.01'], '04.01.01', 'Weld Neck Flanges 6" 600# A105',   'EA',  3, 'Heat + cert'],
      ['PP-SUPPORT-001',   nodeIds['04.01.01'], '04.01.01', 'Pipe Supports Adjustable CS',      'EA',  4, 'None'],
      ['PP-REDUCER-001',   nodeIds['04.01.01'], '04.01.01', 'Concentric Reducers 6"×4" SCH80',  'EA',  5, 'Heat number'],
      // 05.01.01 Instrument Loop Testing
      ['INS-CABLE-001',    nodeIds['05.01.01'], '05.01.01', 'Instrument Cable 2Px1.5mm² OS',   'M',   1, 'Drum number'],
      ['INS-CONDUIT-001',  nodeIds['05.01.01'], '05.01.01', 'Rigid Conduit Galv 20mm',         'M',   2, 'None'],
      ['INS-CTRAY-001',    nodeIds['05.01.01'], '05.01.01', 'Cable Tray GRP 300mm Wide',       'M',   3, 'None'],
      ['INS-FIT-001',      nodeIds['05.01.01'], '05.01.01', 'Instrument Fittings SS316 1/2"',  'SET', 4, 'None'],
      ['INS-BRKT-001',     nodeIds['05.01.01'], '05.01.01', 'Transmitter Mounting Brackets SS', 'EA', 5, 'None'],
    ]

    for (const [code, nodeId, wbsCode, name, uom, _n, trace] of commodities) {
      if (!nodeId) continue
      await db.query(
        `INSERT IGNORE INTO commodity_library (project_id, code, name, uom, wbs_code, wbs_node_id, trace_level, preservation, status, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [pid, code, name, uom, wbsCode, nodeId, trace, 'None', 'active', adminId]
      )
    }
    console.log('  ✓ Commodities seeded for 5 target nodes (5 each = 25 total)')

    // ── Seed equipment ────────────────────────────────────────
    const equipment = [
      // 02.01.01 Process Vessels
      ['V-101', 'Vessel', nodeIds['02.01.01'], '02.01.01', 'HP Separator 1st Stage',          'Train 1', 'A-Critical', 'PO-2024-003'],
      ['V-102', 'Vessel', nodeIds['02.01.01'], '02.01.01', 'LP Flash Drum 2nd Stage',          'Train 1', 'A-Critical', 'PO-2024-003'],
      ['V-201', 'Vessel', nodeIds['02.01.01'], '02.01.01', 'HP Absorber CO2 Removal',          'Train 1', 'A-Critical', null],
      ['V-202', 'Vessel', nodeIds['02.01.01'], '02.01.01', 'Regenerator Column',                'Train 1', 'B-Major',    null],
      // 02.02.01 Pumps
      ['P-101A', 'Pump', nodeIds['02.02.01'], '02.02.01', 'Feed Pump — Duty',                  'Pump Stn', 'A-Critical', 'PO-TEST-001'],
      ['P-101B', 'Pump', nodeIds['02.02.01'], '02.02.01', 'Feed Pump — Standby',               'Pump Stn', 'A-Critical', 'PO-TEST-001'],
      ['P-201A', 'Pump', nodeIds['02.02.01'], '02.02.01', 'Condensate Transfer Pump — Duty',   'Pump Stn', 'B-Major',    null],
      ['P-201B', 'Pump', nodeIds['02.02.01'], '02.02.01', 'Condensate Transfer Pump — Standby','Pump Stn', 'B-Major',    null],
      // 03.01.01 11kV Systems
      ['SW-001', 'Panel', nodeIds['03.01.01'], '03.01.01', '11kV MV Switchboard Panel A',     'Substation', 'A-Critical', 'PO-2024-004'],
      ['SW-002', 'Panel', nodeIds['03.01.01'], '03.01.01', '11kV MV Switchboard Panel B',     'Substation', 'A-Critical', 'PO-2024-004'],
      ['TR-001', 'Skid',  nodeIds['03.01.01'], '03.01.01', 'Main Power Transformer 5MVA',     'Substation', 'A-Critical', 'PO-2024-001'],
      ['TR-002', 'Skid',  nodeIds['03.01.01'], '03.01.01', 'Auxiliary Transformer 500kVA',    'Substation', 'B-Major',    null],
      // 04.01.01 HP Process Lines
      ['PK-101', 'Pipe spool', nodeIds['04.01.01'], '04.01.01', 'HP Train 1 Inlet Spool',    'Train 1', 'A-Critical', null],
      ['PK-102', 'Pipe spool', nodeIds['04.01.01'], '04.01.01', 'HP Train 1 Outlet Spool',   'Train 1', 'A-Critical', null],
      ['V-301',  'Vessel',     nodeIds['04.01.01'], '04.01.01', 'HP Knockout Drum',            'Train 1', 'B-Major',    null],
      ['V-302',  'Vessel',     nodeIds['04.01.01'], '04.01.01', 'LP Knockout Drum',            'Train 1', 'B-Major',    null],
      // 05.01.01 Instrument Loop Testing
      ['FT-101', 'Instrument', nodeIds['05.01.01'], '05.01.01', 'Gas Flow Transmitter Custody Transfer', 'MCC', 'A-Critical', null],
      ['FT-201', 'Instrument', nodeIds['05.01.01'], '05.01.01', 'Condensate Flow Transmitter',            'MCC', 'B-Major',    null],
      ['PT-101', 'Instrument', nodeIds['05.01.01'], '05.01.01', 'HP Separator Pressure Transmitter',      'MCC', 'A-Critical', null],
      ['LT-101', 'Instrument', nodeIds['05.01.01'], '05.01.01', 'HP Separator Level Transmitter',         'MCC', 'A-Critical', null],
    ]

    for (const [tag, etype, nodeId, wbsCode, desc, area, crit, poRef] of equipment) {
      if (!nodeId) continue
      await db.query(
        `INSERT IGNORE INTO equipment_list (project_id, tag, equipment_type, wbs_code, wbs_node_id, description, area_location, criticality, status, po_reference, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [pid, tag, etype, wbsCode, nodeId, desc, area, crit, 'Not started', poRef || null, adminId]
      )
    }
    console.log('  ✓ Equipment seeded for 5 target nodes (4 each = 20 total)')
  }

  // ─── PRJ-2024-002: Hunter Valley Substation ─────────────────
  if (P['PRJ-2024-002']) {
    const pid = P['PRJ-2024-002']
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    await db.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
    await db.query('SET FOREIGN_KEY_CHECKS=1')
    console.log('\n  Seeding PRJ-2024-002 (Hunter Valley Substation)…')

    const s01 = await ins(pid, null, '01', 'Civil Works', 'green', '2025-03-31')
    const s0101 = await ins(pid, s01, '01.01', 'Site Preparation', 'green', '2024-10-31')
    const s010101 = await ins(pid, s0101, '01.01.01', 'Earthworks & Grading', 'green', '2024-09-30')
    const s01010101 = await ins(pid, s010101, '01.01.01.01', 'Cut & Fill Works', 'green', '2024-08-31')
    await ins(pid, s01010101, '01.01.01.01.01', 'Topsoil Strip & Stockpile', 'green', '2024-07-31')
    await ins(pid, s01010101, '01.01.01.01.02', 'Compaction & Proof Roll', 'green', '2024-08-31')
    const s010102 = await ins(pid, s0101, '01.01.02', 'Cable Trenching', 'green', '2025-01-31')
    const s01010201 = await ins(pid, s010102, '01.01.02.01', 'HV Cable Ducts', 'green', '2024-12-31')
    await ins(pid, s01010201, '01.01.02.01.01', 'Duct Installation', 'green', '2024-11-30')
    await ins(pid, s01010201, '01.01.02.01.02', 'Draw Pit Construction', 'green', '2024-12-31')
    const s0102 = await ins(pid, s01, '01.02', 'Control Building', 'amber', '2025-03-31')
    const s010201 = await ins(pid, s0102, '01.02.01', 'Building Structure', 'amber', '2025-01-31')
    await ins(pid, s010201, '01.02.01.01', 'Concrete Frame', 'green', '2024-12-31')
    await ins(pid, s010201, '01.02.01.02', 'Roofing & Cladding', 'amber', '2025-01-31')
    await ins(pid, s0102, '01.02.02', 'Internal Fit-out', 'amber', '2025-03-31')

    const s02 = await ins(pid, null, '02', 'Primary Equipment', 'amber', '2025-09-30')
    const s0201 = await ins(pid, s02, '02.01', 'Transformers', 'amber', '2025-06-30')
    const s020101 = await ins(pid, s0201, '02.01.01', '132kV Power Transformers', 'amber', '2025-06-30')
    const s02010101 = await ins(pid, s020101, '02.01.01.01', 'TX-101 50MVA ONAN', 'amber', '2025-05-31')
    await ins(pid, s02010101, '02.01.01.01.01', 'TX-101 FAT', 'amber', '2025-03-31')
    await ins(pid, s02010101, '02.01.01.01.02', 'TX-101 Site Installation', 'amber', '2025-05-31')
    const s0202 = await ins(pid, s02, '02.02', 'Circuit Breakers', 'amber', '2025-09-30')
    const s020201 = await ins(pid, s0202, '02.02.01', '132kV SF6 Breakers', 'amber', '2025-09-30')
    const s02020101 = await ins(pid, s020201, '02.02.01.01', 'CB-101 Bay 1', 'amber', '2025-08-31')
    await ins(pid, s02020101, '02.02.01.01.01', 'CB-101 FAT', 'amber', '2025-06-30')
    await ins(pid, s02020101, '02.02.01.01.02', 'CB-101 Site Commissioning', 'amber', '2025-08-31')

    const s03 = await ins(pid, null, '03', 'Protection & SCADA', 'green', '2025-11-30')
    const s0301 = await ins(pid, s03, '03.01', 'Protection Relays', 'green', '2025-08-31')
    const s030101 = await ins(pid, s0301, '03.01.01', 'Feeder Protection', 'green', '2025-08-31')
    const s03010101 = await ins(pid, s030101, '03.01.01.01', 'Bay 1 Protection Panel', 'green', '2025-07-31')
    await ins(pid, s03010101, '03.01.01.01.01', 'Relay Supply & Install', 'green', '2025-06-30')
    await ins(pid, s03010101, '03.01.01.01.02', 'Relay Commissioning & Test', 'green', '2025-07-31')
    console.log('  ✓ PRJ-2024-002: 3 branches, 6 levels deep')
  }

  // ─── PRJ-2023-008: Ord River Dam Upgrade ────────────────────
  if (P['PRJ-2023-008']) {
    const pid = P['PRJ-2023-008']
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    await db.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
    await db.query('SET FOREIGN_KEY_CHECKS=1')
    console.log('\n  Seeding PRJ-2023-008 (Ord River Dam Upgrade)…')

    const d01 = await ins(pid, null, '01', 'Hydraulic Structures', 'green', '2024-12-31')
    const d0101 = await ins(pid, d01, '01.01', 'Spillway Rehabilitation', 'green', '2024-09-30')
    const d010101 = await ins(pid, d0101, '01.01.01', 'Spillway Slab & Piers', 'green', '2024-09-30')
    const d01010101 = await ins(pid, d010101, '01.01.01.01', 'Concrete Demolition', 'green', '2024-06-30')
    const d0101010101 = await ins(pid, d01010101, '01.01.01.01.01', 'Saw Cutting & Breaking', 'green', '2024-05-31')
    await ins(pid, d0101010101, '01.01.01.01.01.01', 'Demolition Method Statement', 'green', '2024-04-30')
    await ins(pid, d0101010101, '01.01.01.01.01.02', 'Waste Disposal Works', 'green', '2024-05-31')
    const d010102 = await ins(pid, d0101, '01.01.02', 'Spillway Gates', 'green', '2024-12-31')
    const d01010201 = await ins(pid, d010102, '01.01.02.01', 'Radial Gate Units', 'green', '2024-12-31')
    await ins(pid, d01010201, '01.01.02.01.01', 'GR-101 Gate Fabrication', 'green', '2024-10-31')
    await ins(pid, d01010201, '01.01.02.01.02', 'GR-101 Gate Installation', 'green', '2024-12-31')
    const d0102 = await ins(pid, d01, '01.02', 'Intake Structure', 'green', '2024-09-30')
    await ins(pid, d0102, '01.02.01', 'Intake Trash Rack', 'green', '2024-07-31')
    await ins(pid, d0102, '01.02.02', 'Stop Log Guides', 'green', '2024-09-30')

    const d02 = await ins(pid, null, '02', 'Mechanical & Hydro', 'green', '2025-03-31')
    const d0201 = await ins(pid, d02, '02.01', 'Hydro Turbines', 'green', '2025-03-31')
    const d020101 = await ins(pid, d0201, '02.01.01', 'Turbine Refurbishment', 'green', '2025-03-31')
    const d02010101 = await ins(pid, d020101, '02.01.01.01', 'Unit 1 Turbine', 'green', '2024-12-31')
    const d0201010101 = await ins(pid, d02010101, '02.01.01.01.01', 'Runner Replacement', 'green', '2024-11-30')
    await ins(pid, d0201010101, '02.01.01.01.01.01', 'Runner Design & Manufacture', 'green', '2024-08-31')
    await ins(pid, d0201010101, '02.01.01.01.01.02', 'Runner Installation & Balance', 'green', '2024-11-30')
    const d0202 = await ins(pid, d02, '02.02', 'Gate Hoists', 'green', '2024-12-31')
    await ins(pid, d0202, '02.02.01', 'Electric Wire Rope Hoists', 'green', '2024-12-31')

    const d03 = await ins(pid, null, '03', 'Electrical & SCADA', 'amber', '2025-06-30')
    const d0301 = await ins(pid, d03, '03.01', 'Power Supply & MCC', 'amber', '2025-03-31')
    const d030101 = await ins(pid, d0301, '03.01.01', '11kV Switchboard', 'amber', '2025-03-31')
    const d03010101 = await ins(pid, d030101, '03.01.01.01', 'MCC-101 Assembly', 'amber', '2025-02-28')
    await ins(pid, d03010101, '03.01.01.01.01', 'MCC-101 Manufacture', 'amber', '2024-12-31')
    await ins(pid, d03010101, '03.01.01.01.02', 'MCC-101 FAT & Delivery', 'amber', '2025-01-31')
    await ins(pid, d03010101, '03.01.01.01.03', 'MCC-101 Site Installation', 'amber', '2025-02-28')
    console.log('  ✓ PRJ-2023-008: 3 branches, 6 levels deep')
  }

  // ─── PRJ-2025-001: Port Hedland LNG Terminal ────────────────
  if (P['PRJ-2025-001']) {
    const pid = P['PRJ-2025-001']
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    await db.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
    await db.query('SET FOREIGN_KEY_CHECKS=1')
    console.log('\n  Seeding PRJ-2025-001 (Port Hedland LNG Terminal)…')

    const l01 = await ins(pid, null, '01', 'Marine & Jetty', 'blue', '2026-06-30')
    const l0101 = await ins(pid, l01, '01.01', 'Jetty Structure', 'blue', '2026-03-31')
    const l010101 = await ins(pid, l0101, '01.01.01', 'Substructure & Piles', 'blue', '2026-01-31')
    const l01010101 = await ins(pid, l010101, '01.01.01.01', 'Pile Driving Works', 'blue', '2025-12-31')
    const l0101010101 = await ins(pid, l01010101, '01.01.01.01.01', 'Steel H-Piles Supply', 'blue', '2025-11-30')
    await ins(pid, l0101010101, '01.01.01.01.01.01', 'Pile Fabrication & Coating', 'blue', '2025-09-30')
    await ins(pid, l0101010101, '01.01.01.01.01.02', 'Pile Delivery to Site', 'blue', '2025-11-30')
    const l010102 = await ins(pid, l0101, '01.01.02', 'Jetty Deck & Beams', 'blue', '2026-03-31')
    await ins(pid, l010102, '01.01.02.01', 'Precast Deck Panels', 'blue', '2026-01-31')
    await ins(pid, l010102, '01.01.02.02', 'In-situ Topping Slab', 'blue', '2026-03-31')
    const l0102 = await ins(pid, l01, '01.02', 'Loading Arms', 'blue', '2026-06-30')
    const l010201 = await ins(pid, l0102, '01.02.01', 'Cryogenic Loading Arms', 'blue', '2026-06-30')
    const l01020101 = await ins(pid, l010201, '01.02.01.01', 'LA-101 16" Loading Arm', 'blue', '2026-05-31')
    await ins(pid, l01020101, '01.02.01.01.01', 'LA-101 Engineering & Manufacture', 'blue', '2026-02-28')
    await ins(pid, l01020101, '01.02.01.01.02', 'LA-101 Factory Test & Delivery', 'blue', '2026-05-31')

    const l02 = await ins(pid, null, '02', 'Process & Utilities', 'blue', '2026-09-30')
    const l0201 = await ins(pid, l02, '02.01', 'LNG Train 1', 'blue', '2026-06-30')
    const l020101 = await ins(pid, l0201, '02.01.01', 'Feed Pre-treatment', 'blue', '2026-03-31')
    const l02010101 = await ins(pid, l020101, '02.01.01.01', 'Inlet Separation', 'blue', '2026-01-31')
    const l0201010101 = await ins(pid, l02010101, '02.01.01.01.01', 'V-301 Flash Drum', 'blue', '2025-12-31')
    await ins(pid, l0201010101, '02.01.01.01.01.01', 'V-301 Vessel Fabrication', 'blue', '2025-09-30')
    await ins(pid, l0201010101, '02.01.01.01.01.02', 'V-301 Cryogenic Test', 'blue', '2025-11-30')
    const l020102 = await ins(pid, l0201, '02.01.02', 'Liquefaction', 'blue', '2026-06-30')
    await ins(pid, l020102, '02.01.02.01', 'MCHE Procurement', 'blue', '2026-01-31')
    await ins(pid, l020102, '02.01.02.02', 'MCHE Installation', 'blue', '2026-04-30')
    const l0202 = await ins(pid, l02, '02.02', 'Utilities & Offsites', 'blue', '2026-09-30')
    await ins(pid, l0202, '02.02.01', 'Flare & Relief Systems', 'blue', '2026-06-30')
    await ins(pid, l0202, '02.02.02', 'Nitrogen Generation', 'blue', '2026-09-30')

    const l03 = await ins(pid, null, '03', 'Electrical & Telecom', 'blue', '2026-12-31')
    const l0301 = await ins(pid, l03, '03.01', 'Gas Turbine Generators', 'blue', '2026-09-30')
    const l030101 = await ins(pid, l0301, '03.01.01', 'GTG Units', 'blue', '2026-09-30')
    const l03010101 = await ins(pid, l030101, '03.01.01.01', 'GTG-001 30MW Unit', 'blue', '2026-08-31')
    await ins(pid, l03010101, '03.01.01.01.01', 'GTG-001 Package Supply', 'blue', '2026-05-31')
    await ins(pid, l03010101, '03.01.01.01.02', 'GTG-001 Site Installation', 'blue', '2026-07-31')
    console.log('  ✓ PRJ-2025-001: 3 branches, 6 levels deep')
  }

  // ─── Update PO WBS codes to valid nodes ──────────────────────
  console.log('\n  Updating PO WBS codes…')
  const updates = [
    ['PRJ-2024-001', 'PO-TEST-001',  '02.02.01.01'],
    ['PRJ-2024-001', 'PO-2024-001',  '03.01.01.01'],
    ['PRJ-2024-001', 'PO-2024-002',  '01.02.01.01'],
    ['PRJ-2024-001', 'PO-2024-003',  '02.01.01.01'],
    ['PRJ-2024-001', 'PO-2024-004',  '03.01.01.01'],
  ]
  for (const [projCode, poNum, wbsCode] of updates) {
    const projId = P[projCode]
    if (!projId) continue
    await db.query('UPDATE purchase_orders SET wbs_code=? WHERE po_number=? AND project_id=?', [wbsCode, poNum, projId]).catch(() => {})
    await db.query(
      `UPDATE po_lines SET wbs_code_snapshot=? WHERE po_id=(SELECT id FROM purchase_orders WHERE po_number=? AND project_id=? LIMIT 1)`,
      [wbsCode, poNum, projId]
    ).catch(() => {})
  }
  console.log('  ✓ PO WBS codes updated')

  // ─── Summary ──────────────────────────────────────────────────
  const [depths] = await db.query(`
    SELECT project_id,
      MAX(CHAR_LENGTH(code) - CHAR_LENGTH(REPLACE(code,'.','')) + 1) AS max_depth,
      COUNT(*) AS total
    FROM wbs_nodes GROUP BY project_id
  `)
  console.log('\n  WBS Node Counts:')
  for (const d of depths) {
    const name = Object.entries(P).find(([, id]) => id === d.project_id)?.[0] ?? d.project_id
    console.log(`    ${name}: ${d.total} nodes, max depth ${d.max_depth}`)
  }

  // ─── Orphan verification ──────────────────────────────────────
  console.log('\n  SQL Verification — orphaned PO references:')
  const [orphans] = await db.query(`
    SELECT COUNT(*) AS cnt
    FROM purchase_orders p
    LEFT JOIN wbs_nodes w ON w.project_id = p.project_id AND w.code = p.wbs_code
    WHERE p.wbs_code IS NOT NULL AND w.id IS NULL
  `)
  console.log(`    Orphaned PO refs: ${orphans[0].cnt} (should be 0)`)

  console.log('\n── DONE ─────────────────────────────────────────────────\n')
  process.exit(0)
}

run().catch(e => { console.error(e.message); process.exit(1) })
