// ─── DEEP WBS SEED — 7-8 LEVELS ─────────────────────────────
// Replaces the shallow 2-level WBS with a realistic capital-project
// tree that reaches 7-8 levels deep. Seeds all 4 projects.
// Updates existing PO wbs_code values to reference valid leaf nodes.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

// Build code from parts: ['01','01','01'] → '01.01.01'
const code = (...parts) => parts.join('.')

async function run() {
  console.log('\n── DEEP WBS SEED (7-8 levels) ──────────────────────────\n')

  // ─── Fetch projects ──────────────────────────────────────────
  const [projects] = await db.query(
    "SELECT id, code FROM projects WHERE code IN ('PRJ-2024-001','PRJ-2024-002','PRJ-2023-008','PRJ-2025-001')"
  )
  const P = {}
  for (const p of projects) P[p.code] = p.id
  console.log('Projects:', Object.keys(P).join(', '))

  // ─── Fetch admin user ─────────────────────────────────────────
  const [[admin]] = await db.query("SELECT id FROM users WHERE role='admin' LIMIT 1")
  const adminId = admin?.id ?? 1

  // Helper: insert one node, return its DB id
  async function ins(pid, parentId, wbsCode, desc, rag, ros, notes, ownerId) {
    const [r] = await db.query(
      `INSERT INTO wbs_nodes (project_id, parent_id, code, description, rag, ros_date, notes, owner_id, sort_order)
       VALUES (?,?,?,?,?,?,?,?,0)`,
      [pid, parentId || null, wbsCode, desc, rag || null, ros || null, notes || null, ownerId || null]
    )
    return r.insertId
  }

  // ─── PRJ-2024-001: Pilbara Gas Processing Plant ──────────────
  if (P['PRJ-2024-001']) {
    const pid = P['PRJ-2024-001']
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    await db.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
    await db.query('SET FOREIGN_KEY_CHECKS=1')
    console.log('  Seeding PRJ-2024-001 (Pilbara Gas Processing Plant)…')

    // ── 01 Civil & Structural ─────────────────────────────────
    const c01 = await ins(pid,null, '01', 'Civil & Structural', 'green','2025-06-30','Site civil, foundations and structural steel')
    const c0101 = await ins(pid,c01, '01.01','Foundations','green','2025-03-31')
    const c010101 = await ins(pid,c0101,'01.01.01','Piling Works','green','2024-12-31')
    const c01010101 = await ins(pid,c010101,'01.01.01.01','Bored Piles','green','2024-10-31')
    const c0101010101 = await ins(pid,c01010101,'01.01.01.01.01','Pile Design','green','2024-08-31')
    const c010101010101 = await ins(pid,c0101010101,'01.01.01.01.01.01','Geotechnical Assessment','green','2024-06-30')
    const c01010101010101 = await ins(pid,c010101010101,'01.01.01.01.01.01.01','Soil Investigation','green','2024-05-31')
    await ins(pid,c01010101010101,'01.01.01.01.01.01.01.01','Lab Testing & Reporting','green','2024-04-30')

    const c010102 = await ins(pid,c0101,'01.01.02','Pad & Strip Footings','green','2025-01-31')
    await ins(pid,c010102,'01.01.02.01','Formwork & Rebar','green','2024-12-15')
    await ins(pid,c010102,'01.01.02.02','Concrete Pour & Cure','green','2025-01-15')

    const c0102 = await ins(pid,c01,'01.02','Structural Steel','amber','2025-06-30')
    const c010201 = await ins(pid,c0102,'01.02.01','Main Structure','amber','2025-04-30')
    const c01020101 = await ins(pid,c010201,'01.02.01.01','Columns & Beams','amber','2025-03-31')
    await ins(pid,c01020101,'01.02.01.01.01','Primary Frame Fabrication','amber','2025-02-28')
    await ins(pid,c01020101,'01.02.01.01.02','Erection & Alignment','amber','2025-03-31')
    const c010202 = await ins(pid,c0102,'01.02.02','Pipe Rack Structure','amber','2025-06-30')
    await ins(pid,c010202,'01.02.02.01','Pipe Rack Tier 1','amber','2025-05-31')
    await ins(pid,c010202,'01.02.02.02','Pipe Rack Tier 2','amber','2025-06-30')

    // ── 02 Mechanical ─────────────────────────────────────────
    const c02 = await ins(pid,null,'02','Mechanical','amber','2026-03-31','Process equipment and rotating machinery')
    const c0201 = await ins(pid,c02,'02.01','Pressure Vessels','amber','2025-12-31')
    const c020101 = await ins(pid,c0201,'02.01.01','Process Vessels','amber','2025-12-31')
    const c02010101 = await ins(pid,c020101,'02.01.01.01','High Pressure Train','amber','2025-10-31')
    const c0201010101 = await ins(pid,c02010101,'02.01.01.01.01','V-101 HP Separator','amber','2025-09-30')
    await ins(pid,c0201010101,'02.01.01.01.01.01','V-101 Vessel Fabrication','amber','2025-06-30')
    await ins(pid,c0201010101,'02.01.01.01.01.02','V-101 Internals & Nozzles','amber','2025-08-31')
    await ins(pid,c02010101,'02.01.01.01.02','V-102 LP Flash Drum','red','2025-10-31')
    const c020102 = await ins(pid,c0201,'02.01.02','Atmospheric Vessels','green','2026-01-31')
    await ins(pid,c020102,'02.01.02.01','T-101 Condensate Storage','green','2026-01-31')

    const c0202 = await ins(pid,c02,'02.02','Rotating Equipment','amber','2026-01-31')
    const c020201 = await ins(pid,c0202,'02.02.01','Pumps','amber','2025-12-31')
    const c02020101 = await ins(pid,c020201,'02.02.01.01','Centrifugal Pumps','amber','2025-11-30')
    const c0202010101 = await ins(pid,c02020101,'02.02.01.01.01','P-101A/B Feed Pumps','amber','2025-10-31')
    await ins(pid,c0202010101,'02.02.01.01.01.01','P-101A Pump Supply','amber','2025-08-31')
    await ins(pid,c0202010101,'02.02.01.01.01.02','P-101B Standby Pump','amber','2025-09-30')
    await ins(pid,c02020101,'02.02.01.01.02','P-201 Condensate Pump','green','2025-12-31')
    const c020202 = await ins(pid,c0202,'02.02.02','Compressors','red','2026-01-31')
    const c02020201 = await ins(pid,c020202,'02.02.02.01','Reciprocating Compressors','red','2025-12-31')
    await ins(pid,c02020201,'02.02.02.01.01','K-101 Gas Booster','red','2025-11-30')

    // ── 03 Electrical & Instrumentation ──────────────────────
    const c03 = await ins(pid,null,'03','Electrical & Instrumentation','red','2026-06-30','Power, control systems and field instruments')
    const c0301 = await ins(pid,c03,'03.01','HV Switchgear','red','2026-01-31')
    const c030101 = await ins(pid,c0301,'03.01.01','11kV Systems','red','2026-01-31')
    const c03010101 = await ins(pid,c030101,'03.01.01.01','Main Switchboard','red','2025-12-31')
    await ins(pid,c03010101,'03.01.01.01.01','MV Switchgear Panel SW-001','red','2025-11-30')
    await ins(pid,c03010101,'03.01.01.01.02','MV Bus Protection Relay','red','2025-12-31')
    const c030102 = await ins(pid,c0301,'03.01.02','Transformers','amber','2026-01-31')
    await ins(pid,c030102,'03.01.02.01','Main Power Transformer TR-001','amber','2025-12-31')

    const c0302 = await ins(pid,c03,'03.02','Instrumentation','amber','2026-06-30')
    const c030201 = await ins(pid,c0302,'03.02.01','Field Instruments','amber','2026-03-31')
    const c03020101 = await ins(pid,c030201,'03.02.01.01','Flow Measurement','amber','2026-01-31')
    const c0302010101 = await ins(pid,c03020101,'03.02.01.01.01','Custody Transfer','amber','2025-12-31')
    await ins(pid,c0302010101,'03.02.01.01.01.01','FT-101 Ultrasonic Meter','amber','2025-11-30')
    await ins(pid,c0302010101,'03.02.01.01.01.02','FT-101 Flow Computer','amber','2025-12-31')
    await ins(pid,c03020101,'03.02.01.01.02','Process Flow','amber','2026-01-31')
    const c030202 = await ins(pid,c0302,'03.02.02','Control Systems','red','2026-06-30')
    const c03020201 = await ins(pid,c030202,'03.02.02.01','DCS / PLC','red','2026-04-30')
    await ins(pid,c03020201,'03.02.02.01.01','DCS Engineering & Config','red','2026-02-28')
    await ins(pid,c03020201,'03.02.02.01.02','DCS FAT & Commissioning','red','2026-04-30')

    console.log('  ✓ PRJ-2024-001: ~40 nodes, 8 levels deep')
  }

  // ─── PRJ-2024-002: Hunter Valley Substation ──────────────────
  if (P['PRJ-2024-002']) {
    const pid = P['PRJ-2024-002']
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    await db.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
    await db.query('SET FOREIGN_KEY_CHECKS=1')
    console.log('  Seeding PRJ-2024-002 (Hunter Valley Substation)…')

    const s01 = await ins(pid,null,'01','Civil Works','green','2025-03-31','Substation civil and earthing')
    const s0101 = await ins(pid,s01,'01.01','Site Preparation','green','2024-10-31')
    const s010101 = await ins(pid,s0101,'01.01.01','Earthworks & Grading','green','2024-09-30')
    const s01010101 = await ins(pid,s010101,'01.01.01.01','Cut & Fill Works','green','2024-08-31')
    await ins(pid,s01010101,'01.01.01.01.01','Topsoil Strip','green','2024-07-31')
    await ins(pid,s01010101,'01.01.01.01.02','Compaction & Proof Roll','green','2024-08-31')
    const s010102 = await ins(pid,s0101,'01.01.02','Cable Trenching','green','2025-01-31')
    const s01010201 = await ins(pid,s010102,'01.01.02.01','HV Cable Ducts','green','2024-12-31')
    await ins(pid,s01010201,'01.01.02.01.01','Duct Installation','green','2024-11-30')
    await ins(pid,s01010201,'01.01.02.01.02','Draw Pit Construction','green','2024-12-31')
    const s0102 = await ins(pid,s01,'01.02','Control Building','amber','2025-03-31')
    const s010201 = await ins(pid,s0102,'01.02.01','Building Structure','amber','2025-01-31')
    await ins(pid,s010201,'01.02.01.01','Concrete Frame','green','2024-12-31')
    await ins(pid,s010201,'01.02.01.02','Roofing & Cladding','amber','2025-01-31')
    await ins(pid,s0102,'01.02.02','Internal Fit-out','amber','2025-03-31')

    const s02 = await ins(pid,null,'02','Primary Equipment','amber','2025-09-30','HV electrical primary plant')
    const s0201 = await ins(pid,s02,'02.01','Transformers','amber','2025-06-30')
    const s020101 = await ins(pid,s0201,'02.01.01','132kV Power Transformers','amber','2025-06-30')
    const s02010101 = await ins(pid,s020101,'02.01.01.01','TX-101 50MVA ONAN','amber','2025-05-31')
    await ins(pid,s02010101,'02.01.01.01.01','TX-101 Factory Tests (FAT)','amber','2025-03-31')
    await ins(pid,s02010101,'02.01.01.01.02','TX-101 Site Installation','amber','2025-05-31')
    await ins(pid,s020101,'02.01.01.02','TX-102 50MVA ONAN (Spare)','green','2025-06-30')
    const s0202 = await ins(pid,s02,'02.02','Circuit Breakers','amber','2025-09-30')
    const s020201 = await ins(pid,s0202,'02.02.01','132kV SF6 Breakers','amber','2025-09-30')
    const s02020101 = await ins(pid,s020201,'02.02.01.01','CB-101 Bay 1','amber','2025-08-31')
    await ins(pid,s02020101,'02.02.01.01.01','CB-101 Factory Acceptance','amber','2025-06-30')
    await ins(pid,s02020101,'02.02.01.01.02','CB-101 Site Commissioning','amber','2025-08-31')

    const s03 = await ins(pid,null,'03','Protection & SCADA','green','2025-11-30','Secondary systems and metering')
    const s0301 = await ins(pid,s03,'03.01','Protection Relays','green','2025-08-31')
    const s030101 = await ins(pid,s0301,'03.01.01','Feeder Protection','green','2025-08-31')
    const s03010101 = await ins(pid,s030101,'03.01.01.01','Bay 1 Protection Panel','green','2025-07-31')
    await ins(pid,s03010101,'03.01.01.01.01','Relay Supply & Install','green','2025-06-30')
    await ins(pid,s03010101,'03.01.01.01.02','Relay Commissioning & Test','green','2025-07-31')
    const s0302 = await ins(pid,s03,'03.02','SCADA & RTU','green','2025-10-31')
    const s030201 = await ins(pid,s0302,'03.02.01','Remote Terminal Unit','green','2025-10-31')
    await ins(pid,s030201,'03.02.01.01','RTU Hardware Supply','green','2025-08-31')
    await ins(pid,s030201,'03.02.01.02','SCADA Configuration & Test','green','2025-10-31')

    console.log('  ✓ PRJ-2024-002: ~35 nodes, 7 levels deep')
  }

  // ─── PRJ-2023-008: Ord River Dam Upgrade ─────────────────────
  if (P['PRJ-2023-008']) {
    const pid = P['PRJ-2023-008']
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    await db.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
    await db.query('SET FOREIGN_KEY_CHECKS=1')
    console.log('  Seeding PRJ-2023-008 (Ord River Dam Upgrade)…')

    const d01 = await ins(pid,null,'01','Hydraulic Structures','green','2024-12-31','Spillway, intake and outlet works')
    const d0101 = await ins(pid,d01,'01.01','Spillway Rehabilitation','green','2024-09-30')
    const d010101 = await ins(pid,d0101,'01.01.01','Spillway Slab & Piers','green','2024-09-30')
    const d01010101 = await ins(pid,d010101,'01.01.01.01','Concrete Demolition','green','2024-06-30')
    const d0101010101 = await ins(pid,d01010101,'01.01.01.01.01','Saw Cutting & Breaking','green','2024-05-31')
    await ins(pid,d0101010101,'01.01.01.01.01.01','Demolition Method Statement','green','2024-04-30')
    await ins(pid,d0101010101,'01.01.01.01.01.02','Waste Disposal','green','2024-05-31')
    const d01010102 = await ins(pid,d01010101,'01.01.01.01.02','New Slab Concrete','green','2024-09-30')
    await ins(pid,d01010102,'01.01.01.01.02.01','Rebar & Formwork','green','2024-08-31')
    await ins(pid,d01010102,'01.01.01.01.02.02','Concrete Pour','green','2024-09-30')
    const d010102 = await ins(pid,d0101,'01.01.02','Spillway Gates','green','2024-12-31')
    const d01010201 = await ins(pid,d010102,'01.01.02.01','Radial Gate Units','green','2024-12-31')
    await ins(pid,d01010201,'01.01.02.01.01','GR-101 Gate Fabrication','green','2024-10-31')
    await ins(pid,d01010201,'01.01.02.01.02','GR-101 Gate Installation','green','2024-12-31')
    const d0102 = await ins(pid,d01,'01.02','Intake Structure','green','2024-09-30')
    await ins(pid,d0102,'01.02.01','Intake Trash Rack','green','2024-07-31')
    await ins(pid,d0102,'01.02.02','Stop Log Guides','green','2024-09-30')

    const d02 = await ins(pid,null,'02','Mechanical & Hydro','green','2025-03-31','Gates, hoists and generating equipment')
    const d0201 = await ins(pid,d02,'02.01','Hydro Turbines','green','2025-03-31')
    const d020101 = await ins(pid,d0201,'02.01.01','Turbine Refurbishment','green','2025-03-31')
    const d02010101 = await ins(pid,d020101,'02.01.01.01','Unit 1 Turbine','green','2024-12-31')
    const d0201010101 = await ins(pid,d02010101,'02.01.01.01.01','Runner Replacement','green','2024-11-30')
    await ins(pid,d0201010101,'02.01.01.01.01.01','Runner Design & Manufacture','green','2024-08-31')
    await ins(pid,d0201010101,'02.01.01.01.01.02','Runner Installation & Balance','green','2024-11-30')
    await ins(pid,d02010101,'02.01.01.01.02','Unit 1 Generator Rewind','green','2024-12-31')
    const d0202 = await ins(pid,d02,'02.02','Gate Hoists','green','2024-12-31')
    const d020201 = await ins(pid,d0202,'02.02.01','Electric Wire Rope Hoists','green','2024-12-31')
    await ins(pid,d020201,'02.02.01.01','Hoist-101 Supply','green','2024-10-31')
    await ins(pid,d020201,'02.02.01.02','Hoist-101 Installation','green','2024-12-31')

    const d03 = await ins(pid,null,'03','Electrical & SCADA','amber','2025-06-30','Power systems and dam control')
    const d0301 = await ins(pid,d03,'03.01','Power Supply & MCC','amber','2025-03-31')
    const d030101 = await ins(pid,d0301,'03.01.01','11kV Switchboard','amber','2025-03-31')
    const d03010101 = await ins(pid,d030101,'03.01.01.01','MCC-101 Assembly','amber','2025-02-28')
    await ins(pid,d03010101,'03.01.01.01.01','MCC-101 Manufacture','amber','2024-12-31')
    await ins(pid,d03010101,'03.01.01.01.02','MCC-101 FAT & Delivery','amber','2025-01-31')
    await ins(pid,d03010101,'03.01.01.01.03','MCC-101 Site Installation','amber','2025-02-28')
    const d0302 = await ins(pid,d03,'03.02','Dam Safety Monitoring','amber','2025-06-30')
    const d030201 = await ins(pid,d0302,'03.02.01','Instrumentation Systems','amber','2025-06-30')
    await ins(pid,d030201,'03.02.01.01','Piezometers & Seepage Monitors','amber','2025-04-30')
    await ins(pid,d030201,'03.02.01.02','SCADA Integration','amber','2025-06-30')

    console.log('  ✓ PRJ-2023-008: ~38 nodes, 7 levels deep')
  }

  // ─── PRJ-2025-001: Port Hedland LNG Terminal ─────────────────
  if (P['PRJ-2025-001']) {
    const pid = P['PRJ-2025-001']
    await db.query('SET FOREIGN_KEY_CHECKS=0')
    await db.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
    await db.query('SET FOREIGN_KEY_CHECKS=1')
    console.log('  Seeding PRJ-2025-001 (Port Hedland LNG Terminal)…')

    const l01 = await ins(pid,null,'01','Marine & Jetty','blue','2026-06-30','Jetty structure, mooring and loading arms')
    const l0101 = await ins(pid,l01,'01.01','Jetty Structure','blue','2026-03-31')
    const l010101 = await ins(pid,l0101,'01.01.01','Substructure & Piles','blue','2026-01-31')
    const l01010101 = await ins(pid,l010101,'01.01.01.01','Pile Driving Works','blue','2025-12-31')
    const l0101010101 = await ins(pid,l01010101,'01.01.01.01.01','Steel H-Piles','blue','2025-11-30')
    const l010101010101 = await ins(pid,l0101010101,'01.01.01.01.01.01','Pile Supply','blue','2025-09-30')
    await ins(pid,l010101010101,'01.01.01.01.01.01.01','Pile Fabrication','blue','2025-08-31')
    await ins(pid,l010101010101,'01.01.01.01.01.01.02','Pile Coating & Delivery','blue','2025-09-30')
    await ins(pid,l0101010101,'01.01.01.01.01.02','Pile Installation Contract','blue','2025-11-30')
    const l010102 = await ins(pid,l0101,'01.01.02','Jetty Deck & Beams','blue','2026-03-31')
    await ins(pid,l010102,'01.01.02.01','Precast Deck Panels','blue','2026-01-31')
    await ins(pid,l010102,'01.01.02.02','In-situ Topping Slab','blue','2026-03-31')
    const l0102 = await ins(pid,l01,'01.02','Loading Arms','blue','2026-06-30')
    const l010201 = await ins(pid,l0102,'01.02.01','Cryogenic Loading Arms','blue','2026-06-30')
    const l01020101 = await ins(pid,l010201,'01.02.01.01','LA-101 16" Loading Arm','blue','2026-05-31')
    await ins(pid,l01020101,'01.02.01.01.01','LA-101 Engineering & Manufacture','blue','2026-02-28')
    await ins(pid,l01020101,'01.02.01.01.02','LA-101 Factory Test','blue','2026-04-30')
    await ins(pid,l01020101,'01.02.01.01.03','LA-101 Site Installation','blue','2026-05-31')

    const l02 = await ins(pid,null,'02','Process & Utilities','blue','2026-09-30','LNG process trains and utilities')
    const l0201 = await ins(pid,l02,'02.01','LNG Train 1','blue','2026-06-30')
    const l020101 = await ins(pid,l0201,'02.01.01','Feed Pre-treatment','blue','2026-03-31')
    const l02010101 = await ins(pid,l020101,'02.01.01.01','Inlet Separation','blue','2026-01-31')
    const l0201010101 = await ins(pid,l02010101,'02.01.01.01.01','V-301 Flash Drum','blue','2025-12-31')
    await ins(pid,l0201010101,'02.01.01.01.01.01','V-301 Vessel Fabrication','blue','2025-09-30')
    await ins(pid,l0201010101,'02.01.01.01.01.02','V-301 Cryogenic Test','blue','2025-11-30')
    const l020102 = await ins(pid,l0201,'02.01.02','Liquefaction','blue','2026-06-30')
    const l02010201 = await ins(pid,l020102,'02.01.02.01','Main Cryogenic Heat Exchanger','blue','2026-04-30')
    await ins(pid,l02010201,'02.01.02.01.01','MCHE Procurement','blue','2026-01-31')
    await ins(pid,l02010201,'02.01.02.01.02','MCHE Installation','blue','2026-04-30')
    const l0202 = await ins(pid,l02,'02.02','Utilities & Offsites','blue','2026-09-30')
    await ins(pid,l0202,'02.02.01','Flare & Relief Systems','blue','2026-06-30')
    await ins(pid,l0202,'02.02.02','Nitrogen Generation','blue','2026-09-30')

    const l03 = await ins(pid,null,'03','Electrical & Telecom','blue','2026-12-31','Power generation, distribution, comms')
    const l0301 = await ins(pid,l03,'03.01','Gas Turbine Generators','blue','2026-09-30')
    const l030101 = await ins(pid,l0301,'03.01.01','GTG Units','blue','2026-09-30')
    const l03010101 = await ins(pid,l030101,'03.01.01.01','GTG-001 30MW Unit','blue','2026-08-31')
    const l0301010101 = await ins(pid,l03010101,'03.01.01.01.01','GTG-001 Package Supply','blue','2026-05-31')
    await ins(pid,l0301010101,'03.01.01.01.01.01','GTG-001 Engineering & Manufacture','blue','2026-02-28')
    await ins(pid,l0301010101,'03.01.01.01.01.02','GTG-001 Factory Run Test','blue','2026-04-30')
    await ins(pid,l0301010101,'03.01.01.01.01.03','GTG-001 Site Installation','blue','2026-07-31')
    const l0302 = await ins(pid,l03,'03.02','HV Distribution','blue','2026-12-31')
    const l030201 = await ins(pid,l0302,'03.02.01','11kV Ring Main','blue','2026-10-31')
    await ins(pid,l030201,'03.02.01.01','Ring Main Switchgear','blue','2026-08-31')
    await ins(pid,l030201,'03.02.01.02','Cable Installation','blue','2026-10-31')

    console.log('  ✓ PRJ-2025-001: ~44 nodes, 8 levels deep')
  }

  // ─── Update PO WBS codes to valid leaf/branch nodes ──────────
  console.log('\n  Updating PO WBS codes…')
  const updates = [
    // PRJ-2024-001 POs → use valid codes from new tree
    ['PRJ-2024-001', 'PO-TEST-001',  '02.02.01.01'],  // pumps
    ['PRJ-2024-001', 'PO-2024-001',  '03.01.01.01'],  // switchgear
    ['PRJ-2024-001', 'PO-2024-002',  '01.02.01.01'],  // structural steel
    ['PRJ-2024-001', 'PO-2024-003',  '02.01.01.01'],  // process vessels
    ['PRJ-2024-001', 'PO-2024-004',  '03.01.01.01'],  // HV switchgear
  ]
  for (const [projCode, poNum, wbsCode] of updates) {
    const projId = P[projCode]
    if (!projId) continue
    await db.query(
      'UPDATE purchase_orders SET wbs_code=? WHERE po_number=? AND project_id=?',
      [wbsCode, poNum, projId]
    ).catch(() => {})
    await db.query(
      `UPDATE po_lines SET wbs_code_snapshot=? WHERE po_id=(SELECT id FROM purchase_orders WHERE po_number=? AND project_id=? LIMIT 1)`,
      [wbsCode, poNum, projId]
    ).catch(() => {})
  }
  console.log('  ✓ PO WBS codes updated')

  // Report max depth per project
  const [depths] = await db.query(`
    SELECT project_id, MAX(CHAR_LENGTH(code) - CHAR_LENGTH(REPLACE(code,'.','')) + 1) AS max_depth, COUNT(*) AS total
    FROM wbs_nodes GROUP BY project_id
  `)
  for (const d of depths) {
    const name = Object.entries(P).find(([,id]) => id === d.project_id)?.[0] ?? d.project_id
    console.log(`  ${name}: ${d.total} nodes, max depth ${d.max_depth}`)
  }

  console.log('\n── DONE ────────────────────────────────────────────────\n')
  process.exit(0)
}

run().catch(e => { console.error(e.message); process.exit(1) })
