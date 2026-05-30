// ─── FOUNDATIONAL MODULE MIGRATION + SEED ───────────────────
// Creates commodity_library, equipment_list, foundational_certificates tables.
// Seeds WBS nodes, commodities, equipment for all 4 projects.
// Updates existing PO/po_lines wbs_code to match seeded WBS nodes.
// Safe to re-run: uses INSERT IGNORE and checks existence.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  console.log('\n── FOUNDATIONAL MIGRATION ──────────────────────────────\n')

  // ─── 1. CREATE TABLES ────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS commodity_library (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      project_id      INT NOT NULL,
      code            VARCHAR(50) NOT NULL,
      name            VARCHAR(255) NOT NULL,
      uom             VARCHAR(20) NOT NULL DEFAULT 'EA',
      wbs_code        VARCHAR(50),
      wbs_node_id     INT,
      estimated_qty   DECIMAL(12,3),
      trace_level     VARCHAR(50) NOT NULL DEFAULT 'None',
      preservation    VARCHAR(50) NOT NULL DEFAULT 'None',
      preferred_vendor VARCHAR(255),
      notes           TEXT,
      status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_by      INT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_comm_code_proj (project_id, code),
      KEY idx_comm_project (project_id),
      KEY idx_comm_wbs_node (wbs_node_id),
      CONSTRAINT fk_comm_project FOREIGN KEY (project_id) REFERENCES projects(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  console.log('  ✓ commodity_library table')

  await db.query(`
    CREATE TABLE IF NOT EXISTS equipment_list (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      project_id      INT NOT NULL,
      tag             VARCHAR(50) NOT NULL,
      equipment_type  VARCHAR(50) NOT NULL DEFAULT 'Vessel',
      wbs_code        VARCHAR(50),
      wbs_node_id     INT,
      description     VARCHAR(500) NOT NULL,
      area_location   VARCHAR(255),
      criticality     VARCHAR(20) NOT NULL DEFAULT 'C-Standard',
      spec            VARCHAR(255),
      trace_class     VARCHAR(20) NOT NULL DEFAULT 'None',
      po_reference    VARCHAR(100),
      vendor          VARCHAR(255),
      weight_kg       DECIMAL(10,2),
      size_lwh        VARCHAR(100),
      notes           TEXT,
      status          VARCHAR(30) NOT NULL DEFAULT 'Not started',
      created_by      INT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_equip_tag_proj (project_id, tag),
      KEY idx_equip_project (project_id),
      KEY idx_equip_wbs_node (wbs_node_id),
      CONSTRAINT fk_equip_project FOREIGN KEY (project_id) REFERENCES projects(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  console.log('  ✓ equipment_list table')

  await db.query(`
    CREATE TABLE IF NOT EXISTS foundational_certificates (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      entity_type ENUM('commodity','equipment') NOT NULL,
      entity_id   INT NOT NULL,
      project_id  INT NOT NULL,
      cert_type   VARCHAR(50) NOT NULL,
      ref_number  VARCHAR(100),
      applies_to  VARCHAR(255),
      issue_date  DATE,
      filename    VARCHAR(500),
      file_size   INT,
      status      ENUM('Verified','Pending QA','Rejected','Expired') NOT NULL DEFAULT 'Pending QA',
      uploaded_by INT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_fcert_entity (entity_type, entity_id),
      KEY idx_fcert_project (project_id),
      CONSTRAINT fk_fcert_project FOREIGN KEY (project_id) REFERENCES projects(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  console.log('  ✓ foundational_certificates table')

  // ─── 2. FETCH PROJECT IDS ────────────────────────────────────────────────────
  const [projects] = await db.query(
    "SELECT id, code, name FROM projects WHERE code IN ('PRJ-2024-001','PRJ-2024-002','PRJ-2023-008','PRJ-2025-001')"
  )
  const projMap = {}
  for (const p of projects) projMap[p.code] = { id: p.id, name: p.name }
  console.log('\n  Projects found:', Object.keys(projMap).join(', '))

  // Fetch admin user id for created_by
  const [[admin]] = await db.query("SELECT id FROM users WHERE role='admin' LIMIT 1")
  const adminId = admin?.id ?? 1

  // ─── 3. SEED WBS NODES ──────────────────────────────────────────────────────
  // Clear existing WBS data (re-seed safely)
  for (const code of Object.keys(projMap)) {
    const pid = projMap[code].id
    await db.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
  }

  const wbsInserted = []
  const wbsIdMap = {}  // key = "projCode:wbsCode" → id

  async function insertWBS(projectId, projCode, parentId, code, description, rag, ros, notes, planned_start, planned_end) {
    const [r] = await db.query(
      `INSERT INTO wbs_nodes (project_id, parent_id, code, description, rag, ros_date, notes, planned_start, planned_end, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,0)`,
      [projectId, parentId, code, description, rag, ros || null, notes || null, planned_start || null, planned_end || null]
    )
    const id = r.insertId
    wbsIdMap[`${projCode}:${code}`] = id
    return id
  }

  // ── Pilbara Gas Processing Plant (PRJ-2024-001) ────────────────────────────
  if (projMap['PRJ-2024-001']) {
    const pid = projMap['PRJ-2024-001'].id
    const pc = 'PRJ-2024-001'

    // Top-level
    const w01 = await insertWBS(pid, pc, null, '01', 'Civil & Structural', 'green', '2025-06-30', 'Foundation and structural steelwork', '2024-03-01', '2025-06-30')
    const w02 = await insertWBS(pid, pc, null, '02', 'Mechanical', 'amber', '2026-03-31', 'Process equipment and rotating machinery', '2024-06-01', '2026-03-31')
    const w03 = await insertWBS(pid, pc, null, '03', 'Electrical & Instrumentation', 'red', '2026-06-30', 'Power distribution, DCS and field instruments', '2024-09-01', '2026-06-30')

    // Civil children
    await insertWBS(pid, pc, w01, '01.01', 'Site Preparation & Earthworks', 'green', '2024-12-31', null, '2024-03-01', '2024-12-31')
    await insertWBS(pid, pc, w01, '01.02', 'Concrete Foundations', 'green', '2025-03-31', null, '2024-06-01', '2025-03-31')
    await insertWBS(pid, pc, w01, '01.03', 'Structural Steelwork', 'amber', '2025-06-30', null, '2024-09-01', '2025-06-30')
    await insertWBS(pid, pc, w01, '01.04', 'Pipe Racks & Supports', 'amber', '2025-06-30', null, '2024-10-01', '2025-06-30')

    // Mechanical children
    await insertWBS(pid, pc, w02, '02.01', 'Process Vessels & Columns', 'amber', '2025-12-31', null, '2024-06-01', '2025-12-31')
    await insertWBS(pid, pc, w02, '02.02', 'Rotating Equipment (Pumps)', 'amber', '2026-01-31', null, '2024-09-01', '2026-01-31')
    await insertWBS(pid, pc, w02, '02.03', 'Heat Exchangers', 'red', '2025-09-30', null, '2024-06-01', '2025-09-30')
    await insertWBS(pid, pc, w02, '02.04', 'Piping & Valves', 'amber', '2026-03-31', null, '2025-01-01', '2026-03-31')

    // E&I children
    await insertWBS(pid, pc, w03, '03.01', 'HV Switchgear & Transformers', 'red', '2026-01-31', null, '2024-09-01', '2026-01-31')
    await insertWBS(pid, pc, w03, '03.02', 'MV Distribution & Cabling', 'amber', '2026-03-31', null, '2025-01-01', '2026-03-31')
    await insertWBS(pid, pc, w03, '03.03', 'DCS / Control Systems', 'amber', '2026-05-31', null, '2025-03-01', '2026-05-31')
    await insertWBS(pid, pc, w03, '03.04', 'Field Instruments & Analysers', 'red', '2026-06-30', null, '2025-06-01', '2026-06-30')

    wbsInserted.push(`PRJ-2024-001: 15 nodes`)
  }

  // ── Hunter Valley Substation 132kV (PRJ-2024-002) ─────────────────────────
  if (projMap['PRJ-2024-002']) {
    const pid = projMap['PRJ-2024-002'].id
    const pc = 'PRJ-2024-002'

    const w01 = await insertWBS(pid, pc, null, '01', 'Civil Works', 'green', '2025-03-31', 'Substation civil and site works', '2024-06-01', '2025-03-31')
    const w02 = await insertWBS(pid, pc, null, '02', 'Primary Equipment', 'amber', '2025-09-30', 'HV and MV primary electrical equipment', '2024-06-01', '2025-09-30')
    const w03 = await insertWBS(pid, pc, null, '03', 'Secondary & Protection', 'green', '2025-11-30', 'Protection relays, SCADA, metering', '2024-09-01', '2025-11-30')

    await insertWBS(pid, pc, w01, '01.01', 'Site Clearing & Grading', 'green', '2024-10-31', null, '2024-06-01', '2024-10-31')
    await insertWBS(pid, pc, w01, '01.02', 'Cable Trenching & Ducting', 'green', '2025-01-31', null, '2024-08-01', '2025-01-31')
    await insertWBS(pid, pc, w01, '01.03', 'Control Building', 'amber', '2025-03-31', null, '2024-09-01', '2025-03-31')

    await insertWBS(pid, pc, w02, '02.01', '132kV Transformers', 'amber', '2025-06-30', null, '2024-06-01', '2025-06-30')
    await insertWBS(pid, pc, w02, '02.02', 'Circuit Breakers & Disconnectors', 'amber', '2025-09-30', null, '2024-09-01', '2025-09-30')
    await insertWBS(pid, pc, w02, '02.03', 'Busbars & Insulators', 'green', '2025-06-30', null, '2024-12-01', '2025-06-30')

    await insertWBS(pid, pc, w03, '03.01', 'Protection Relays', 'green', '2025-08-31', null, '2025-01-01', '2025-08-31')
    await insertWBS(pid, pc, w03, '03.02', 'SCADA & RTU', 'green', '2025-10-31', null, '2025-03-01', '2025-10-31')
    await insertWBS(pid, pc, w03, '03.03', 'Metering & Revenue', 'green', '2025-11-30', null, '2025-06-01', '2025-11-30')

    wbsInserted.push(`PRJ-2024-002: 12 nodes`)
  }

  // ── Ord River Dam Upgrade (PRJ-2023-008) ──────────────────────────────────
  if (projMap['PRJ-2023-008']) {
    const pid = projMap['PRJ-2023-008'].id
    const pc = 'PRJ-2023-008'

    const w01 = await insertWBS(pid, pc, null, '01', 'Hydraulic Structures', 'green', '2024-12-31', 'Spillway, intake and outlet works', '2023-01-10', '2024-12-31')
    const w02 = await insertWBS(pid, pc, null, '02', 'Mechanical & Hydro', 'green', '2025-03-31', 'Gates, hoists and generating equipment', '2023-06-01', '2025-03-31')
    const w03 = await insertWBS(pid, pc, null, '03', 'Electrical & SCADA', 'amber', '2025-06-30', 'Power systems and dam control', '2023-09-01', '2025-06-30')

    await insertWBS(pid, pc, w01, '01.01', 'Spillway Rehabilitation', 'green', '2024-06-30', null, '2023-01-10', '2024-06-30')
    await insertWBS(pid, pc, w01, '01.02', 'Intake Structure', 'green', '2024-09-30', null, '2023-06-01', '2024-09-30')
    await insertWBS(pid, pc, w01, '01.03', 'Outlet Works & Valves', 'green', '2024-12-31', null, '2023-09-01', '2024-12-31')

    await insertWBS(pid, pc, w02, '02.01', 'Radial Gates & Hoists', 'green', '2024-12-31', null, '2023-06-01', '2024-12-31')
    await insertWBS(pid, pc, w02, '02.02', 'Turbine & Generator Refurb', 'green', '2025-03-31', null, '2023-09-01', '2025-03-31')

    await insertWBS(pid, pc, w03, '03.01', 'Power Supply & MCC', 'amber', '2025-03-31', null, '2024-01-01', '2025-03-31')
    await insertWBS(pid, pc, w03, '03.02', 'Dam Safety Monitoring', 'amber', '2025-06-30', null, '2024-06-01', '2025-06-30')

    wbsInserted.push(`PRJ-2023-008: 10 nodes`)
  }

  // ── Port Hedland LNG Terminal (PRJ-2025-001) ───────────────────────────────
  if (projMap['PRJ-2025-001']) {
    const pid = projMap['PRJ-2025-001'].id
    const pc = 'PRJ-2025-001'

    const w01 = await insertWBS(pid, pc, null, '01', 'Marine & Jetty', 'blue', '2026-06-30', 'Jetty structure, mooring and loading arms', '2025-02-01', '2026-06-30')
    const w02 = await insertWBS(pid, pc, null, '02', 'Process & Utilities', 'blue', '2026-09-30', 'LNG process trains and utilities', '2025-03-01', '2026-09-30')
    const w03 = await insertWBS(pid, pc, null, '03', 'Electrical & Telecom', 'blue', '2026-12-31', 'Power generation, distribution, comms', '2025-06-01', '2026-12-31')

    await insertWBS(pid, pc, w01, '01.01', 'Jetty Structure & Piles', 'blue', '2026-03-31', null, '2025-02-01', '2026-03-31')
    await insertWBS(pid, pc, w01, '01.02', 'Loading Arms & Manifold', 'blue', '2026-06-30', null, '2025-06-01', '2026-06-30')

    await insertWBS(pid, pc, w02, '02.01', 'LNG Train 1', 'blue', '2026-06-30', null, '2025-03-01', '2026-06-30')
    await insertWBS(pid, pc, w02, '02.02', 'Utility Systems', 'blue', '2026-09-30', null, '2025-06-01', '2026-09-30')
    await insertWBS(pid, pc, w02, '02.03', 'Flare & Relief Systems', 'blue', '2026-09-30', null, '2025-09-01', '2026-09-30')

    await insertWBS(pid, pc, w03, '03.01', 'Gas Turbine Generators', 'blue', '2026-09-30', null, '2025-06-01', '2026-09-30')
    await insertWBS(pid, pc, w03, '03.02', 'HV Distribution', 'blue', '2026-12-31', null, '2025-09-01', '2026-12-31')
    await insertWBS(pid, pc, w03, '03.03', 'Telecom & CCTV', 'blue', '2026-12-31', null, '2025-09-01', '2026-12-31')

    wbsInserted.push(`PRJ-2025-001: 11 nodes`)
  }

  console.log('  WBS nodes seeded:', wbsInserted.join(' | '))

  // ─── 4. SEED COMMODITY LIBRARY ──────────────────────────────────────────────
  for (const code of Object.keys(projMap)) {
    await db.query('DELETE FROM commodity_library WHERE project_id=?', [projMap[code].id])
  }

  async function insertComm(projCode, commCode, name, uom, wbsCode, qty, trace, preservation, vendor, notes, status = 'active') {
    const pid = projMap[projCode]?.id
    if (!pid) return
    const wbsId = wbsIdMap[`${projCode}:${wbsCode}`] || null
    await db.query(
      `INSERT IGNORE INTO commodity_library (project_id, code, name, uom, wbs_code, wbs_node_id, estimated_qty, trace_level, preservation, preferred_vendor, notes, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, commCode, name, uom, wbsCode, wbsId, qty, trace, preservation, vendor, notes, status, adminId]
    )
  }

  // Pilbara commodities
  await insertComm('PRJ-2024-001', 'A516-GR70', 'Carbon Steel Plate A516 Gr.70', 'T', '02.01', 85.5, 'Heat number', 'None', 'BlueScope Steel', '6mm-50mm thickness range')
  await insertComm('PRJ-2024-001', 'A106-GRB', 'Seamless Steel Pipe A106 Gr.B', 'M', '02.04', 420.0, 'Heat + cert', 'None', 'Nippon Steel', '2" to 12" range, schedule 40/80')
  await insertComm('PRJ-2024-001', 'API-6A-VLV', 'Flanged Gate Valve API 6A', 'EA', '02.04', 48.0, 'Serial', 'None', 'Cameron', 'Class 2000 & 3000 pressure ratings')
  await insertComm('PRJ-2024-001', 'SS316-TUBE', 'Stainless Steel Tube 316L', 'M', '03.04', 200.0, 'Heat + cert', 'None', 'Outokumpu', 'Instrument tubing 12mm OD')
  await insertComm('PRJ-2024-001', 'CABLE-6MM', 'Multicore Instrumentation Cable', 'M', '03.02', 1500.0, 'Drum number', 'None', 'Prysmian', '6-core 0.5mm² screened')
  await insertComm('PRJ-2024-001', 'CONCRETE-40', 'Ready Mix Concrete 40MPa', 'M³', '01.02', 2800.0, 'None', 'None', 'Boral', 'High-strength mix, sulphate resistant')
  await insertComm('PRJ-2024-001', 'REBAR-Y20', 'Deformed Reinforcing Bar Y20', 'T', '01.02', 65.0, 'Mill cert', 'None', 'InfraBuild', 'Grade 500N, 12m lengths')
  await insertComm('PRJ-2024-001', 'GASKET-RTJ', 'Ring Type Joint Gasket', 'EA', '02.04', 320.0, 'None', 'None', 'Flexitallic', 'Soft iron & SS316, various sizes')
  await insertComm('PRJ-2024-001', 'LUBE-MOBIL', 'Mobil DTE 25 Turbine Oil', 'LT', '02.02', 200.0, 'None', 'Climate controlled', 'ExxonMobil', '205L drum')
  await insertComm('PRJ-2024-001', 'INST-XMTR', 'Pressure Transmitter 4-20mA', 'EA', '03.04', 85.0, 'None', 'None', 'Emerson', 'Rosemount 3051 or equal')

  // Hunter Valley commodities
  await insertComm('PRJ-2024-002', 'TRANSF-132', 'Power Transformer 132/11kV 50MVA', 'EA', '02.01', 2.0, 'Serial', 'None', 'ABB', 'ONAN/ONAF cooled, with OLTC')
  await insertComm('PRJ-2024-002', 'CB-132KV', 'SF6 Circuit Breaker 132kV', 'EA', '02.02', 6.0, 'Serial', 'None', 'Siemens', '3150A 50kA breaking capacity')
  await insertComm('PRJ-2024-002', 'DISC-132KV', 'Disconnector 132kV Vertical', 'EA', '02.02', 18.0, 'Serial', 'None', 'GE Grid', 'Motor operated with earth switch')
  await insertComm('PRJ-2024-002', 'RELAY-PROT', 'Numerical Protection Relay', 'EA', '03.01', 24.0, 'Serial', 'None', 'SEL', 'SEL-487E or Siemens 7SR57')
  await insertComm('PRJ-2024-002', 'CABLE-132', 'XLPE Cable 132kV 630mm²', 'M', '01.02', 800.0, 'Drum number', 'None', 'NKT', 'With accessories')
  await insertComm('PRJ-2024-002', 'CABLE-CTRL', 'Control & Protection Cable', 'M', '03.01', 4500.0, 'Drum number', 'None', 'Prysmian', 'Multi-core, LSZH sheath')
  await insertComm('PRJ-2024-002', 'BATT-110V', '110V DC Battery Bank', 'EA', '03.01', 2.0, 'None', 'Climate controlled', 'EnerSys', '200Ah VRLA, 8hr discharge')
  await insertComm('PRJ-2024-002', 'INSULATOR', 'Cap & Pin String Insulator', 'EA', '02.03', 240.0, 'None', 'None', 'NGK', '160kN strength class')

  // Ord River commodities
  await insertComm('PRJ-2023-008', 'GATE-RADIAL', 'Radial Gate 8m × 6m', 'EA', '02.01', 4.0, 'Mill cert', 'Painted-wrapped', 'Voith Hydro', 'Stainless steel seals and trunnions')
  await insertComm('PRJ-2023-008', 'HOIST-ELEC', 'Electric Wire Rope Hoist', 'EA', '02.01', 4.0, 'Serial', 'None', 'Demag', '10T SWL, 15m lift, explosion-proof')
  await insertComm('PRJ-2023-008', 'PENSTOCK-DN', 'Penstock Pipe DN1800 Carbon Steel', 'M', '01.03', 180.0, 'Heat + cert', 'Painted-wrapped', 'Steel Mains', 'AS4087, 20mm wall, epoxy lined')
  await insertComm('PRJ-2023-008', 'PUMP-DEWATER', 'Submersible Dewatering Pump', 'EA', '02.01', 3.0, 'Serial', 'None', 'Flygt', '75kW, 400V, cast iron')
  await insertComm('PRJ-2023-008', 'CABLE-MV', 'MV Cable 11kV 185mm²', 'M', '03.01', 600.0, 'Drum number', 'None', 'Prysmian', 'XLPE, armoured')
  await insertComm('PRJ-2023-008', 'CONCRSTR', 'High Strength Concrete 65MPa', 'M³', '01.01', 3500.0, 'None', 'None', 'Hanson', 'Dam-grade mix')

  // Port Hedland commodities
  await insertComm('PRJ-2025-001', 'LNG-ARM', 'LNG Loading Arm 16" 600 LB', 'EA', '01.02', 3.0, 'Serial', 'N2 purge', 'Woodfield Systems', 'Cryogenic rated -196°C')
  await insertComm('PRJ-2025-001', 'MOORING', 'Quick Release Mooring Hook 150T', 'EA', '01.01', 8.0, 'Serial', 'None', 'Mampaey', 'OCIMF compliant, hydraulic release')
  await insertComm('PRJ-2025-001', 'SS304L-PIPE', 'Cryogenic Stainless Pipe 304L', 'M', '02.01', 850.0, 'Heat + cert', 'N2 purge', 'Sandvik', 'DN100-DN400 schedule 10S')
  await insertComm('PRJ-2025-001', 'GTG-FUEL', 'Gas Turbine Generator Fuel Nozzle', 'EA', '03.01', 24.0, 'Serial', 'Dry storage', 'GE Energy', 'MS7001F spare parts kit')
  await insertComm('PRJ-2025-001', 'FIBRE-OPTIC', 'Armoured Fibre Optic Cable 24-core', 'M', '03.03', 6000.0, 'Drum number', 'None', 'Corning', 'Loose tube, OSP rated')
  await insertComm('PRJ-2025-001', 'NITROGEN', 'Liquid Nitrogen Supply', 'LT', '02.01', 5000.0, 'None', 'N2 purge', 'Air Liquide', 'Cryogenic grade')

  console.log('  ✓ Commodity Library seeded')

  // ─── 5. SEED EQUIPMENT LIST ──────────────────────────────────────────────────
  for (const code of Object.keys(projMap)) {
    await db.query('DELETE FROM equipment_list WHERE project_id=?', [projMap[code].id])
  }

  async function insertEquip(projCode, tag, type, wbsCode, desc, area, criticality, spec, traceClass, vendor, status, notes) {
    const pid = projMap[projCode]?.id
    if (!pid) return
    const wbsId = wbsIdMap[`${projCode}:${wbsCode}`] || null
    await db.query(
      `INSERT IGNORE INTO equipment_list (project_id, tag, equipment_type, wbs_code, wbs_node_id, description, area_location, criticality, spec, trace_class, vendor, status, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, tag, type, wbsCode, wbsId, desc, area, criticality, spec, traceClass, vendor, status, notes, adminId]
    )
  }

  // Pilbara equipment
  await insertEquip('PRJ-2024-001', 'V-101', 'Vessel', '02.01', 'Gas Inlet Separator', 'Train 1', 'A-Critical', 'ASME VIII Div 1', 'Class I', 'Wartsila', 'PO raised', '3-phase separator, 600 NB inlet')
  await insertEquip('PRJ-2024-001', 'V-102', 'Vessel', '02.01', 'HP Flash Drum', 'Train 1', 'A-Critical', 'ASME VIII Div 2', 'Class I', null, 'RFQ', 'High-pressure flash, SS316L cladding')
  await insertEquip('PRJ-2024-001', 'P-101A', 'Pump', '02.02', 'Condensate Transfer Pump', 'Pump Deck A', 'A-Critical', 'API 610', 'Class II', 'Flowserve', 'PO raised', 'OH2 type, 315kW, dual mechanical seal')
  await insertEquip('PRJ-2024-001', 'P-101B', 'Pump', '02.02', 'Condensate Transfer Pump (Standby)', 'Pump Deck A', 'A-Critical', 'API 610', 'Class II', 'Flowserve', 'PO raised', 'OH2 type, 315kW, spare')
  await insertEquip('PRJ-2024-001', 'K-101', 'Compressor', '02.02', 'Gas Booster Compressor', 'Compressor Shed', 'A-Critical', 'API 618', 'Class I', 'Dresser-Rand', 'RFQ', '4-stage reciprocating, 1500kW')
  await insertEquip('PRJ-2024-001', 'E-101', 'Heat exchanger', '02.03', 'Feed/Effluent Heat Exchanger', 'Train 1', 'B-Major', 'TEMA R / ASME VIII', 'Class I', null, 'Not started', 'Shell & tube, CS/SS316L')
  await insertEquip('PRJ-2024-001', 'T-101', 'Tank', '02.01', 'Condensate Storage Tank', 'Tank Farm', 'B-Major', 'API 650', 'Class II', 'Kennedy Tank', 'RFQ', '5000m³, floating roof')
  await insertEquip('PRJ-2024-001', 'SW-001', 'Panel', '03.01', 'HV Switchgear Panel 132kV', 'Substation', 'A-Critical', 'IEC 62271', 'Class I', 'Siemens', 'PO raised', 'Gas insulated, 4 feeders')
  await insertEquip('PRJ-2024-001', 'TR-001', 'Skid', '03.01', 'Main Power Transformer 132/11kV', 'Substation', 'A-Critical', 'IEC 60076', 'Class I', 'ABB', 'RFQ', '50MVA ONAF, with OLTC')
  await insertEquip('PRJ-2024-001', 'FT-101', 'Instrument', '03.04', 'Custody Transfer Flowmeter', 'Metering Skid', 'A-Critical', 'API 6D / AGA 9', 'Class II', 'Sick', 'Not started', 'Ultrasonic, 8" class 600')

  // Hunter Valley equipment
  await insertEquip('PRJ-2024-002', 'TX-101', 'Skid', '02.01', 'Main Power Transformer 1 132/11kV', 'Transformer Bay 1', 'A-Critical', 'IEC 60076', 'Class I', 'ABB', 'PO raised', '50MVA ONAN/ONAF OLTC')
  await insertEquip('PRJ-2024-002', 'TX-102', 'Skid', '02.01', 'Main Power Transformer 2 132/11kV', 'Transformer Bay 2', 'A-Critical', 'IEC 60076', 'Class I', 'ABB', 'PO raised', '50MVA ONAN/ONAF OLTC')
  await insertEquip('PRJ-2024-002', 'CB-101', 'Panel', '02.02', 'HV Circuit Breaker 132kV Bay 1', 'Switchyard', 'A-Critical', 'IEC 62271-100', 'Class I', 'Siemens Energy', 'RFQ', 'SF6, 40kA, 2500A')
  await insertEquip('PRJ-2024-002', 'CB-102', 'Panel', '02.02', 'HV Circuit Breaker 132kV Bay 2', 'Switchyard', 'A-Critical', 'IEC 62271-100', 'Class I', 'Siemens Energy', 'RFQ', 'SF6, 40kA, 2500A')
  await insertEquip('PRJ-2024-002', 'CB-103', 'Panel', '02.02', 'Bus-Coupler Circuit Breaker 132kV', 'Switchyard', 'A-Critical', 'IEC 62271-100', 'Class I', null, 'Not started', 'SF6, 50kA, 4000A')
  await insertEquip('PRJ-2024-002', 'MDB-001', 'Panel', '03.01', 'Protection & Control Panel', 'Control Building', 'A-Critical', 'IEC 61850', 'Class II', 'SEL', 'RFQ', 'Bay protection and control unit')
  await insertEquip('PRJ-2024-002', 'BLDG-001', 'Structural', '01.03', 'Control Room Building', 'Site', 'B-Major', 'BCA Section J', 'None', null, 'Not started', 'Precast concrete, fire rated')
  await insertEquip('PRJ-2024-002', 'UPS-001', 'Panel', '03.01', '110V DC UPS System', 'Control Building', 'B-Major', 'IEC 62040', 'Class II', 'EnerSys', 'Not started', '200Ah VRLA, 8hr autonomy')

  // Ord River equipment
  await insertEquip('PRJ-2023-008', 'G-101', 'Motor', '02.02', 'Hydro Turbine Unit 1', 'Powerhouse', 'A-Critical', 'IEC 60034', 'Class I', 'Voith Hydro', 'PO raised', '12MW Kaplan turbine')
  await insertEquip('PRJ-2023-008', 'G-102', 'Motor', '02.02', 'Hydro Turbine Unit 2', 'Powerhouse', 'A-Critical', 'IEC 60034', 'Class I', 'Voith Hydro', 'PO raised', '12MW Kaplan turbine')
  await insertEquip('PRJ-2023-008', 'GR-101', 'Valve', '02.01', 'Radial Gate Unit RG-1', 'Spillway', 'A-Critical', 'AS 1418', 'Class I', 'Voith Hydro', 'PO raised', '8m × 6m spillway gate')
  await insertEquip('PRJ-2023-008', 'GR-102', 'Valve', '02.01', 'Radial Gate Unit RG-2', 'Spillway', 'A-Critical', 'AS 1418', 'Class I', 'Voith Hydro', 'RFQ', '8m × 6m spillway gate')
  await insertEquip('PRJ-2023-008', 'PK-101', 'Valve', '01.03', 'Penstock Isolation Valve DN1800', 'Intake', 'A-Critical', 'API 6D', 'Class I', null, 'Not started', 'Butterfly valve, actuated')
  await insertEquip('PRJ-2023-008', 'MCC-101', 'Panel', '03.01', 'Main Motor Control Centre', 'Control Room', 'B-Major', 'IEC 61439', 'Class II', 'Schneider Electric', 'RFQ', '11kV / 0.4kV')

  // Port Hedland equipment
  await insertEquip('PRJ-2025-001', 'LA-101', 'Skid', '01.02', 'LNG Loading Arm #1', 'Jetty', 'A-Critical', 'EN 1474 / OCIMF', 'Class I', 'Woodfield Systems', 'Not started', '16" 600# cryogenic loading arm')
  await insertEquip('PRJ-2025-001', 'LA-102', 'Skid', '01.02', 'LNG Loading Arm #2', 'Jetty', 'A-Critical', 'EN 1474 / OCIMF', 'Class I', 'Woodfield Systems', 'Not started', '16" 600# cryogenic loading arm')
  await insertEquip('PRJ-2025-001', 'LA-103', 'Skid', '01.02', 'Vapour Return Arm', 'Jetty', 'A-Critical', 'EN 1474 / OCIMF', 'Class I', null, 'Not started', '12" vapour return arm')
  await insertEquip('PRJ-2025-001', 'K-201', 'Compressor', '02.01', 'BOG Compressor Train 1', 'Process Area', 'A-Critical', 'API 617', 'Class I', 'Atlas Copco', 'RFQ', 'Centrifugal, 2MW, cryogenic')
  await insertEquip('PRJ-2025-001', 'GTG-001', 'Motor', '03.01', 'Gas Turbine Generator Unit 1', 'Power Block', 'A-Critical', 'IEC 60034 / ISO 3046', 'Class I', 'GE Energy', 'Not started', '30MW LM2500+ gas turbine')
  await insertEquip('PRJ-2025-001', 'V-301', 'Vessel', '02.01', 'LNG Feed Flash Drum', 'Process Area', 'A-Critical', 'ASME VIII Div 2', 'Class I', null, 'Not started', 'Cryogenic, SS304L, -196°C design')

  console.log('  ✓ Equipment List seeded')

  // ─── 6. UPDATE EXISTING PO WBS CODES ────────────────────────────────────────
  // Map existing POs to valid WBS nodes from the seeded data
  // Pilbara POs - assign to appropriate WBS nodes
  const updates = [
    // Update purchase_orders by po_number pattern where project matches
    ['02.02', 'PRJ-2024-001', 'PO-TEST-001'],   // pumps → rotating equipment
    ['03.01', 'PRJ-2024-001', 'PO-2024-001'],   // switchgear → HV switchgear
    ['01.03', 'PRJ-2024-001', 'PO-2024-002'],   // structural steel → structural steelwork
    ['02.01', 'PRJ-2024-001', 'PO-2024-003'],   // Siemens Energy → process vessels
    ['03.01', 'PRJ-2024-001', 'PO-2024-004'],   // ABB switchgear → HV switchgear
  ]

  for (const [wbsCode, projCode, poNumber] of updates) {
    const pid = projMap[projCode]?.id
    if (!pid) continue
    await db.query(
      `UPDATE purchase_orders SET wbs_code=? WHERE po_number=? AND project_id=?`,
      [wbsCode, poNumber, pid]
    ).catch(() => {})
    await db.query(
      `UPDATE po_lines SET wbs_code_snapshot=? WHERE po_id=(SELECT id FROM purchase_orders WHERE po_number=? AND project_id=? LIMIT 1)`,
      [wbsCode, poNumber, pid]
    ).catch(() => {})
  }

  // Also update any POs that have numeric wbs_code patterns to use new codes
  if (projMap['PRJ-2024-001']) {
    const pid = projMap['PRJ-2024-001'].id
    await db.query(`UPDATE purchase_orders SET wbs_code='02.02' WHERE project_id=? AND (wbs_code IS NULL OR wbs_code='') AND po_number LIKE 'PO-TEST%'`, [pid]).catch(() => {})
    await db.query(`UPDATE purchase_orders SET wbs_code='02.04' WHERE project_id=? AND wbs_code IN ('1.2.3','1.4.2','1.3.1') AND wbs_code IS NOT NULL`, [pid]).catch(() => {})
    // Update specific wbs_code values we know about
    await db.query(`UPDATE purchase_orders SET wbs_code='03.01' WHERE project_id=? AND wbs_code='1.4.2'`, [pid]).catch(() => {})
    await db.query(`UPDATE purchase_orders SET wbs_code='02.02' WHERE project_id=? AND wbs_code='1.2.3'`, [pid]).catch(() => {})
    await db.query(`UPDATE purchase_orders SET wbs_code='01.03' WHERE project_id=? AND wbs_code='1.1.1'`, [pid]).catch(() => {})
    await db.query(`UPDATE purchase_orders SET wbs_code='02.04' WHERE project_id=? AND wbs_code='1.3.1'`, [pid]).catch(() => {})
  }

  console.log('  ✓ PO WBS codes updated')

  console.log('\n── MIGRATION COMPLETE ──────────────────────────────────\n')
  process.exit(0)
}

run().catch(e => { console.error(e); process.exit(1) })
