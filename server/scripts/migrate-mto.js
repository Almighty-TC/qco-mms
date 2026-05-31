// ─── MTO MIGRATION + SEED ────────────────────────────────────────────────────
// Creates mto_registers, mto_revisions, mto_lines and seeds realistic data for
// project_id=1 (Pilbara Gas Processing Plant).
// Idempotent: safe to run multiple times — uses CREATE TABLE IF NOT EXISTS and
// skips seed inserts when rows already exist.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {

  // ─── CREATE TABLES ─────────────────────────────────────────────────────────

  await db.query(`
    CREATE TABLE IF NOT EXISTS mto_registers (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      project_id       INT NOT NULL,
      name             VARCHAR(255) NOT NULL,
      reference        VARCHAR(100) NOT NULL,
      current_revision VARCHAR(5) DEFAULT 'A',
      owner            VARCHAR(255),
      description      TEXT,
      status           ENUM('active','superseded') DEFAULT 'active',
      line_count       INT DEFAULT 0,
      created_by       INT,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `)
  console.log('✓ mto_registers')

  await db.query(`
    CREATE TABLE IF NOT EXISTS mto_revisions (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      mto_id      INT NOT NULL,
      revision    VARCHAR(5) NOT NULL,
      uploaded_by INT,
      notes       TEXT,
      line_count  INT DEFAULT 0,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (mto_id) REFERENCES mto_registers(id)
    )
  `)
  console.log('✓ mto_revisions')

  await db.query(`
    CREATE TABLE IF NOT EXISTS mto_lines (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      mto_id           INT NOT NULL,
      revision         VARCHAR(5) NOT NULL,
      line_number      VARCHAR(20) NOT NULL,
      wbs_code         VARCHAR(100),
      description      TEXT NOT NULL,
      quantity         DECIMAL(15,3),
      uom              VARCHAR(20),
      ros_date         DATE,
      inspection_class ENUM('Class I','Class II','Class III') DEFAULT 'Class II',
      vdrl_required    TINYINT(1) DEFAULT 0,
      po_ref           VARCHAR(100),
      status           ENUM('not-started','rfq','po-raised') DEFAULT 'not-started',
      is_deleted       TINYINT(1) DEFAULT 0,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (mto_id) REFERENCES mto_registers(id)
    )
  `)
  console.log('✓ mto_lines')

  // ─── CHECK EXISTING SEED ───────────────────────────────────────────────────
  const [[{ cnt }]] = await db.query(`SELECT COUNT(*) cnt FROM mto_registers WHERE project_id = 1`)
  if (cnt > 0) {
    console.log(`  seed already present (${cnt} registers) — skipping`)
    return
  }

  // ─── SEED REGISTERS ────────────────────────────────────────────────────────
  // admin = id 4 (tchang@qcogroup.com.au), ben = 25, carlos = 33

  const [r1] = await db.query(
    `INSERT INTO mto_registers (project_id,name,reference,current_revision,owner,description,status,line_count,created_by)
     VALUES (1,'Mechanical & Piping MTO','MTO-PIL-001','C','Ben Smith',
       'Covers all mechanical equipment, pressure vessels, pumps and associated piping items for the gas processing plant.',
       'active', 15, 25)`
  )
  const mto1 = r1.insertId

  const [r2] = await db.query(
    `INSERT INTO mto_registers (project_id,name,reference,current_revision,owner,description,status,line_count,created_by)
     VALUES (1,'Structural Steel MTO','MTO-PIL-002','B','Ben Smith',
       'Structural steel and piling works for all foundations and supports.',
       'active', 8, 25)`
  )
  const mto2 = r2.insertId

  const [r3] = await db.query(
    `INSERT INTO mto_registers (project_id,name,reference,current_revision,owner,description,status,line_count,created_by)
     VALUES (1,'Electrical & Instrumentation MTO','MTO-PIL-003','A','Carlos Reyes',
       'All E&I materials including HV switchgear, cable trays and instrument packages.',
       'superseded', 10, 33)`
  )
  const mto3 = r3.insertId

  console.log(`✓ registers: ${mto1}, ${mto2}, ${mto3}`)

  // ─── MTO-PIL-001: 3 REVISIONS ──────────────────────────────────────────────

  const [rv1a] = await db.query(
    `INSERT INTO mto_revisions (mto_id,revision,uploaded_by,notes,line_count) VALUES (?,?,?,?,?)`,
    [mto1,'A',25,'Initial issue — quantities from FEED study',15]
  )
  const [rv1b] = await db.query(
    `INSERT INTO mto_revisions (mto_id,revision,uploaded_by,notes,line_count) VALUES (?,?,?,?,?)`,
    [mto1,'B',25,'Rev B — updated pump quantities and added two new vessel line items',15]
  )
  const [rv1c] = await db.query(
    `INSERT INTO mto_revisions (mto_id,revision,uploaded_by,notes,line_count) VALUES (?,?,?,?,?)`,
    [mto1,'C',4,'Rev C — final IFP quantities; POs raised for critical items',15]
  )

  // ─── MTO-PIL-001 Rev A lines ───────────────────────────────────────────────
  const linesA = [
    ['L-001','02.01.01','HP Separator Vessel — 3-phase horizontal',1,'EA','2024-08-15','Class I',1,'not-started'],
    ['L-002','02.01.01','LP Flash Drum — vertical orientation',1,'EA','2024-08-15','Class I',1,'not-started'],
    ['L-003','02.01.01','Condensate Stabiliser Column',1,'EA','2024-09-01','Class I',1,'not-started'],
    ['L-004','02.02.01','Feed Pump — centrifugal, 75kW',2,'EA','2024-07-01','Class II',1,'not-started'],
    ['L-005','02.02.01','Condensate Transfer Pump — 45kW',2,'EA','2024-07-01','Class II',0,'not-started'],
    ['L-006','02.02.01','Chemical Injection Pump — metering type',3,'EA','2024-07-15','Class II',0,'not-started'],
    ['L-007','02','16" CS Pipe — Schedule 40, ASTM A106 Gr B',120,'m','2024-06-01','Class II',0,'not-started'],
    ['L-008','02','8" CS Pipe — Schedule 80, ASTM A106 Gr B',85,'m','2024-06-01','Class II',0,'not-started'],
    ['L-009','02','4" SS316L Pipe — Schedule 40S',45,'m','2024-06-01','Class III',0,'not-started'],
    ['L-010','02','Pipe Flange 16" ASME B16.5 600# RF WNRF',24,'EA','2024-06-15','Class II',0,'not-started'],
    ['L-011','02','Pipe Flange 8" ASME B16.5 300# RF WNRF',18,'EA','2024-06-15','Class II',0,'not-started'],
    ['L-012','02','Gate Valve 16" CS 600# FBE',6,'EA','2024-07-01','Class II',1,'not-started'],
    ['L-013','02','Gate Valve 8" CS 300# FBE',8,'EA','2024-07-01','Class II',0,'not-started'],
    ['L-014','02','Control Valve assembly 4" Cv=120',2,'EA','2024-08-01','Class I',1,'not-started'],
    ['L-015','02.02','Air Fin Cooler — 2-bay, fin-fan',1,'EA','2024-09-15','Class II',1,'not-started'],
  ]
  for (const [ln,wbs,desc,qty,uom,ros,insp,vdrl,status] of linesA) {
    await db.query(
      `INSERT INTO mto_lines (mto_id,revision,line_number,wbs_code,description,quantity,uom,ros_date,inspection_class,vdrl_required,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [mto1,'A',ln,wbs,desc,qty,uom,ros,insp,vdrl,status]
    )
  }

  // ─── MTO-PIL-001 Rev B lines (some changes from Rev A) ────────────────────
  const linesB = [
    ['L-001','02.01.01','HP Separator Vessel — 3-phase horizontal',1,'EA','2024-08-15','Class I',1,'not-started'],
    ['L-002','02.01.01','LP Flash Drum — vertical orientation',1,'EA','2024-09-01','Class I',1,'not-started'],   // ros changed
    ['L-003','02.01.01','Condensate Stabiliser Column — with packing',1,'EA','2024-09-01','Class I',1,'not-started'], // desc changed
    ['L-004','02.02.01','Feed Pump — centrifugal, 75kW',3,'EA','2024-07-01','Class II',1,'rfq'],    // qty 2→3
    ['L-005','02.02.01','Condensate Transfer Pump — 45kW',2,'EA','2024-07-01','Class II',0,'rfq'],
    ['L-006','02.02.01','Chemical Injection Pump — metering type',4,'EA','2024-07-15','Class II',0,'not-started'], // qty 3→4
    ['L-007','02','16" CS Pipe — Schedule 40, ASTM A106 Gr B',145,'m','2024-06-01','Class II',0,'not-started'],   // qty 120→145
    ['L-008','02','8" CS Pipe — Schedule 80, ASTM A106 Gr B',85,'m','2024-06-01','Class II',0,'not-started'],
    ['L-009','02','4" SS316L Pipe — Schedule 40S',60,'m','2024-06-01','Class III',0,'not-started'],  // qty 45→60
    ['L-010','02','Pipe Flange 16" ASME B16.5 600# RF WNRF',28,'EA','2024-06-15','Class II',0,'not-started'],    // qty 24→28
    ['L-011','02','Pipe Flange 8" ASME B16.5 300# RF WNRF',18,'EA','2024-06-15','Class II',0,'not-started'],
    ['L-012','02','Gate Valve 16" CS 600# FBE',6,'EA','2024-07-01','Class II',1,'not-started'],
    ['L-013','02','Gate Valve 8" CS 300# FBE',8,'EA','2024-07-01','Class II',0,'not-started'],
    ['L-014','02','Control Valve assembly 4" Cv=120',2,'EA','2024-08-01','Class I',1,'rfq'],
    ['L-015','02.02','Air Fin Cooler — 2-bay, fin-fan',1,'EA','2024-09-15','Class II',1,'not-started'],
  ]
  for (const [ln,wbs,desc,qty,uom,ros,insp,vdrl,status] of linesB) {
    await db.query(
      `INSERT INTO mto_lines (mto_id,revision,line_number,wbs_code,description,quantity,uom,ros_date,inspection_class,vdrl_required,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [mto1,'B',ln,wbs,desc,qty,uom,ros,insp,vdrl,status]
    )
  }

  // ─── MTO-PIL-001 Rev C lines (current — POs raised on critical items) ──────
  const linesC = [
    ['L-001','02.01.01','HP Separator Vessel — 3-phase horizontal',1,'EA','2024-08-15','Class I',1,'po-raised','PO-2024-001'],
    ['L-002','02.01.01','LP Flash Drum — vertical orientation',1,'EA','2024-09-01','Class I',1,'po-raised','PO-2024-001'],
    ['L-003','02.01.01','Condensate Stabiliser Column — with packing',1,'EA','2024-09-01','Class I',1,'rfq',null],
    ['L-004','02.02.01','Feed Pump — centrifugal, 75kW',3,'EA','2024-07-01','Class II',1,'po-raised','PO-2024-002'],
    ['L-005','02.02.01','Condensate Transfer Pump — 45kW',2,'EA','2024-07-01','Class II',0,'po-raised','PO-2024-002'],
    ['L-006','02.02.01','Chemical Injection Pump — metering type',4,'EA','2024-07-15','Class II',0,'rfq',null],
    ['L-007','02','16" CS Pipe — Schedule 40, ASTM A106 Gr B',145,'m','2024-06-01','Class II',0,'po-raised','PO-2024-003'],
    ['L-008','02','8" CS Pipe — Schedule 80, ASTM A106 Gr B',85,'m','2024-06-01','Class II',0,'po-raised','PO-2024-003'],
    ['L-009','02','4" SS316L Pipe — Schedule 40S',60,'m','2024-06-01','Class III',0,'rfq',null],
    ['L-010','02','Pipe Flange 16" ASME B16.5 600# RF WNRF',28,'EA','2024-06-15','Class II',0,'not-started',null],
    ['L-011','02','Pipe Flange 8" ASME B16.5 300# RF WNRF',18,'EA','2024-06-15','Class II',0,'not-started',null],
    ['L-012','02','Gate Valve 16" CS 600# FBE',6,'EA','2024-07-01','Class II',1,'rfq',null],
    ['L-013','02','Gate Valve 8" CS 300# FBE',8,'EA','2024-07-01','Class II',0,'rfq',null],
    ['L-014','02','Control Valve assembly 4" Cv=120',2,'EA','2024-08-01','Class I',1,'rfq',null],
    ['L-015','02.02','Air Fin Cooler — 2-bay, fin-fan',1,'EA','2024-09-15','Class II',1,'not-started',null],
  ]
  for (const [ln,wbs,desc,qty,uom,ros,insp,vdrl,status,po] of linesC) {
    await db.query(
      `INSERT INTO mto_lines (mto_id,revision,line_number,wbs_code,description,quantity,uom,ros_date,inspection_class,vdrl_required,status,po_ref)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [mto1,'C',ln,wbs,desc,qty,uom,ros,insp,vdrl,status,po||null]
    )
  }

  // ─── MTO-PIL-002: 2 REVISIONS ──────────────────────────────────────────────

  await db.query(
    `INSERT INTO mto_revisions (mto_id,revision,uploaded_by,notes,line_count) VALUES (?,?,?,?,?)`,
    [mto2,'A',25,'Initial structural steel take-off from Civil drawings Rev 0',8]
  )
  await db.query(
    `INSERT INTO mto_revisions (mto_id,revision,uploaded_by,notes,line_count) VALUES (?,?,?,?,?)`,
    [mto2,'B',25,'Rev B — updated piling quantities per geotech report GR-002',8]
  )

  const linesS_A = [
    ['S-001','01.01.01','Steel H-Pile 310UC97 — 18m length',32,'EA','2024-05-01','Class II',0,'not-started'],
    ['S-002','01.01.01','Steel H-Pile 310UC97 — 12m length',48,'EA','2024-05-01','Class II',0,'not-started'],
    ['S-003','01.01','Reinforced Concrete Pad Footing — Type A 1200×1200×600',12,'EA','2024-05-15','Class III',0,'not-started'],
    ['S-004','01.01','Reinforced Concrete Pad Footing — Type B 900×900×500',18,'EA','2024-05-15','Class III',0,'not-started'],
    ['S-005','01','310UB46 Universal Beam — main frame',850,'m','2024-06-01','Class II',0,'not-started'],
    ['S-006','01','200UC52 Universal Column — intermediate',320,'m','2024-06-01','Class II',0,'not-started'],
    ['S-007','01','Grating Panel 1200×1000 — 25mm I-bar GMS',95,'EA','2024-06-15','Class III',0,'not-started'],
    ['S-008','01','Chequer Plate 6mm — stair treads and landings',42,'m2','2024-06-15','Class III',0,'not-started'],
  ]
  for (const [ln,wbs,desc,qty,uom,ros,insp,vdrl,status] of linesS_A) {
    await db.query(
      `INSERT INTO mto_lines (mto_id,revision,line_number,wbs_code,description,quantity,uom,ros_date,inspection_class,vdrl_required,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [mto2,'A',ln,wbs,desc,qty,uom,ros,insp,vdrl,status]
    )
  }

  const linesS_B = [
    ['S-001','01.01.01','Steel H-Pile 310UC97 — 18m length',36,'EA','2024-05-01','Class II',0,'rfq'],   // qty 32→36
    ['S-002','01.01.01','Steel H-Pile 310UC97 — 12m length',52,'EA','2024-05-01','Class II',0,'rfq'],   // qty 48→52
    ['S-003','01.01','Reinforced Concrete Pad Footing — Type A 1200×1200×600',12,'EA','2024-05-15','Class III',0,'not-started'],
    ['S-004','01.01','Reinforced Concrete Pad Footing — Type B 900×900×500',20,'EA','2024-05-15','Class III',0,'not-started'], // qty 18→20
    ['S-005','01','310UB46 Universal Beam — main frame',850,'m','2024-06-01','Class II',0,'po-raised','PO-2024-010'],
    ['S-006','01','200UC52 Universal Column — intermediate',320,'m','2024-06-01','Class II',0,'po-raised','PO-2024-010'],
    ['S-007','01','Grating Panel 1200×1000 — 25mm I-bar GMS',95,'EA','2024-06-15','Class III',0,'rfq'],
    ['S-008','01','Chequer Plate 6mm — stair treads and landings',42,'m2','2024-06-15','Class III',0,'not-started'],
  ]
  // Fix: columns don't include po_ref by default — insert conditionally
  for (const row of linesS_B) {
    const [ln,wbs,desc,qty,uom,ros,insp,vdrl,status,po] = row
    if (po) {
      await db.query(
        `INSERT INTO mto_lines (mto_id,revision,line_number,wbs_code,description,quantity,uom,ros_date,inspection_class,vdrl_required,status,po_ref)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [mto2,'B',ln,wbs,desc,qty,uom,ros,insp,vdrl,status,po]
      )
    } else {
      await db.query(
        `INSERT INTO mto_lines (mto_id,revision,line_number,wbs_code,description,quantity,uom,ros_date,inspection_class,vdrl_required,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [mto2,'B',ln,wbs,desc,qty,uom,ros,insp,vdrl,status]
      )
    }
  }

  // ─── MTO-PIL-003: 1 REVISION (superseded) ─────────────────────────────────

  await db.query(
    `INSERT INTO mto_revisions (mto_id,revision,uploaded_by,notes,line_count) VALUES (?,?,?,?,?)`,
    [mto3,'A',33,'Initial E&I take-off — superseded by new scope revision',10]
  )

  const linesEI = [
    ['E-001','03.01','11kV Switchboard — main incomer, 1250A',1,'EA','2024-07-01','Class I',1,'not-started'],
    ['E-002','03.01','11kV Feeder Circuit Breaker — 630A VCB',6,'EA','2024-07-01','Class I',1,'not-started'],
    ['E-003','03.01','11/0.415kV Transformer 1000kVA Dyn11',2,'EA','2024-08-01','Class I',1,'not-started'],
    ['E-004','03','415V MCC — 12-way, front-of-board',1,'EA','2024-08-15','Class II',1,'not-started'],
    ['E-005','03','Cable Tray 300W × 75H Perforated GMS HDG',680,'m','2024-06-01','Class III',0,'not-started'],
    ['E-006','03','Cable Tray 150W × 75H Perforated GMS HDG',420,'m','2024-06-01','Class III',0,'not-started'],
    ['E-007','03','HV Cable 11kV 3C×95mm² XLPE/SWA/PVC',450,'m','2024-07-15','Class II',0,'not-started'],
    ['E-008','03','LV Power Cable 4C×95mm² PVC/SWA/PVC',280,'m','2024-07-15','Class II',0,'not-started'],
    ['E-009','03','Instrument Cable Pair 2×1.5mm² OS/OS 16-pair',1200,'m','2024-07-01','Class III',0,'not-started'],
    ['E-010','03','Junction Box SS316 IP65 — large 400×300×200',24,'EA','2024-07-01','Class III',0,'not-started'],
  ]
  for (const [ln,wbs,desc,qty,uom,ros,insp,vdrl,status] of linesEI) {
    await db.query(
      `INSERT INTO mto_lines (mto_id,revision,line_number,wbs_code,description,quantity,uom,ros_date,inspection_class,vdrl_required,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [mto3,'A',ln,wbs,desc,qty,uom,ros,insp,vdrl,status]
    )
  }

  // ─── VERIFY ────────────────────────────────────────────────────────────────
  const [[{ regs }]] = await db.query(`SELECT COUNT(*) regs FROM mto_registers WHERE project_id=1`)
  const [[{ revs }]] = await db.query(`SELECT COUNT(*) revs FROM mto_revisions`)
  const [[{ lc }]] = await db.query(`SELECT COUNT(*) lc FROM mto_lines`)
  console.log(`✓ seed complete — registers:${regs} revisions:${revs} lines:${lc}`)
}

run().then(() => { console.log('Done.'); process.exit(0) })
      .catch(e => { console.error('FAIL:', e.message); process.exit(1) })
