// ─── SEED ADMIN DATA ────────────────────────────────────────
// Run once: node server/scripts/seed-admin-data.js
// Creates tables and seeds dummy data for warehouses, units_of_measure,
// acronyms, and inco_terms; also seeds extra users and system_settings.
// Safe to re-run: INSERT IGNORE skips duplicate rows.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  console.log('\nSeeding admin reference data…\n')

  // ── Extra users (no initials column in schema) ───────────
  const hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'
  const [r1] = await db.query(
    `INSERT IGNORE INTO users (email, password_hash, full_name, role, company, phone, is_active)
     VALUES
     ('sarah.johnson@qcogroup.com.au', ?, 'Sarah Johnson', 'procurement_manager', 'QCO Group', '+61 412 345 678', 1),
     ('mike.thompson@qcogroup.com.au', ?, 'Mike Thompson', 'expediting_manager',  'QCO Group', '+61 423 456 789', 1),
     ('lisa.chen@qcogroup.com.au',     ?, 'Lisa Chen',     'warehouse',           'QCO Group', '+61 434 567 890', 1),
     ('james.wilson@steelco.com.au',   ?, 'James Wilson',  'vendor',              'Steel Co',  '+61 445 678 901', 1),
     ('emma.davis@freightfast.com.au', ?, 'Emma Davis',    'freight_forwarder',   'FreightFast','+61 456 789 012',1)`,
    [hash, hash, hash, hash, hash]
  )
  console.log(`  users          ${r1.affectedRows} rows inserted`)

  // ── Suppliers ────────────────────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS suppliers (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    country      VARCHAR(100),
    contact_name VARCHAR(255),
    email        VARCHAR(255),
    phone        VARCHAR(50),
    address      TEXT,
    status       ENUM('active','inactive') DEFAULT 'active',
    created_by   INT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`)
  const [r2] = await db.query(
    `INSERT IGNORE INTO suppliers (name, code, country, contact_name, email, phone, status) VALUES
     ('Emerson Electric', 'EMR', 'USA',       'John Smith',       'john.smith@emerson.com',           '+1 314 553 2000',  'active'),
     ('BlueScope Steel',  'BLS', 'Australia', 'Procurement Team', 'procurement@bluescope.com',         '+61 2 9779 6111', 'active'),
     ('Siemens Energy',   'SIE', 'Germany',   'Hans Mueller',     'h.mueller@siemens-energy.com',      '+49 911 654 0',   'active'),
     ('ABB Australia',    'ABB', 'Australia', 'Sales Team',       'sales@au.abb.com',                  '+61 2 9466 2000', 'active'),
     ('Flowserve',        'FLO', 'USA',       'Sales Team',       'sales@flowserve.com',               '+1 972 443 6500', 'active'),
     ('Tyco Valves',      'TYC', 'Australia', 'Info Team',        'info@tyco.com.au',                  '+61 2 8870 5000', 'active')`
  )
  console.log(`  suppliers      ${r2.affectedRows} rows inserted`)

  // ── Warehouses ───────────────────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS warehouses (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    address      TEXT,
    state        VARCHAR(100),
    contact_name VARCHAR(255),
    phone        VARCHAR(50),
    status       ENUM('active','inactive') DEFAULT 'active',
    created_by   INT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`)
  const [r3] = await db.query(
    `INSERT IGNORE INTO warehouses (name, code, address, state, status) VALUES
     ('Perth Laydown Yard',       'PLY', '123 Industrial Ave Perth WA',        'WA',  'active'),
     ('Brisbane Store',           'BRS', '45 Port Rd Brisbane QLD',            'QLD', 'active'),
     ('Site Laydown - Pilbara',   'SLP', 'Pilbara Gas Processing Plant Site',  'WA',  'active'),
     ('Melbourne Consolidation',  'MLC', '78 Warehouse Dr Melbourne VIC',      'VIC', 'active'),
     ('Darwin Port Store',        'DPS', 'Darwin Port NT',                     'NT',  'active')`
  )
  console.log(`  warehouses     ${r3.affectedRows} rows inserted`)

  // ── Units of Measure ─────────────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS units_of_measure (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    code        VARCHAR(20)  NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL,
    status      ENUM('active','inactive') DEFAULT 'active',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)
  const [r4] = await db.query(
    `INSERT IGNORE INTO units_of_measure (code, description) VALUES
     ('EA','Each'), ('NR','Number'), ('KG','Kilogram'),    ('T','Tonne'),
     ('M','Metre'), ('MM','Millimetre'), ('M2','Square Metre'), ('M3','Cubic Metre'),
     ('L','Litre'), ('KL','Kilolitre'), ('SET','Set'),     ('LOT','Lot'),
     ('PR','Pair'), ('LM','Linear Metre'), ('KN','Kilonewton')`
  )
  console.log(`  units_of_measure ${r4.affectedRows} rows inserted`)

  // ── Acronyms ─────────────────────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS acronyms (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    acronym    VARCHAR(50) NOT NULL UNIQUE,
    definition TEXT        NOT NULL,
    module     VARCHAR(100),
    notes      TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)
  const [r5] = await db.query(
    `INSERT IGNORE INTO acronyms (acronym, definition, module) VALUES
     ('PO',   'Purchase Order',                    'Procurement'),
     ('SCN',  'Shipment Control Note',             'Expediting'),
     ('VDRL', 'Vendor Document Requirements List', 'VDRL'),
     ('MTO',  'Material Take Off',                 'Foundational'),
     ('WBS',  'Work Breakdown Structure',          'Foundational'),
     ('ROS',  'Required on Site',                  'Foundational'),
     ('FMR',  'Field Material Requisition',        'Material Control'),
     ('AVL',  'Approved Vendor List',              'Admin'),
     ('ITP',  'Inspection Test Plan',              'Traceability'),
     ('MDR',  'Master Document Register',          'VDRL'),
     ('QA',   'Quality Assurance',                 'Traceability'),
     ('QC',   'Quality Control',                   'Traceability'),
     ('FAT',  'Factory Acceptance Test',           'Expediting'),
     ('SAT',  'Site Acceptance Test',              'Expediting'),
     ('NCR',  'Non-Conformance Report',            'Traceability'),
     ('RFI',  'Request for Information',           'Procurement'),
     ('BL',   'Bill of Lading',                    'Logistics'),
     ('AWB',  'Air Waybill',                       'Logistics'),
     ('COO',  'Certificate of Origin',             'Logistics'),
     ('MR',   'Material Requisition',              'Procurement')`
  )
  console.log(`  acronyms       ${r5.affectedRows} rows inserted`)

  // ── INCO Terms ───────────────────────────────────────────
  await db.query(`CREATE TABLE IF NOT EXISTS inco_terms (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    code                VARCHAR(10)  NOT NULL UNIQUE,
    full_name           VARCHAR(255) NOT NULL,
    description         TEXT,
    risk_transfer_point TEXT,
    transport_mode      VARCHAR(100),
    status              ENUM('active','inactive') DEFAULT 'active',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)
  const [r6] = await db.query(
    `INSERT IGNORE INTO inco_terms (code, full_name, description, risk_transfer_point, transport_mode) VALUES
     ('EXW','Ex Works',                    'Seller makes goods available at their premises. Buyer bears all costs and risks.',       'At sellers premises',               'Any mode'),
     ('FCA','Free Carrier',                'Seller delivers goods to named carrier. Risk transfers at point of delivery.',          'Named place of delivery',           'Any mode'),
     ('CPT','Carriage Paid To',            'Seller pays freight to named destination. Risk transfers to first carrier.',            'First carrier',                     'Any mode'),
     ('CIP','Carriage and Insurance Paid To','Seller pays freight and insurance to named destination.',                            'First carrier',                     'Any mode'),
     ('DAP','Delivered at Place',          'Seller delivers goods ready for unloading at named destination.',                      'Named destination',                 'Any mode'),
     ('DPU','Delivered at Place Unloaded', 'Seller delivers and unloads goods at named destination.',                              'Named destination after unloading',  'Any mode'),
     ('DDP','Delivered Duty Paid',         'Seller bears all costs including import duties to named destination.',                  'Named destination',                 'Any mode'),
     ('FAS','Free Alongside Ship',         'Seller delivers goods alongside vessel at named port.',                                 'Alongside vessel at named port',    'Sea and inland waterway'),
     ('FOB','Free On Board',               'Seller delivers on board vessel at named port. Risk transfers when goods on board.',    'On board vessel at named port',     'Sea and inland waterway'),
     ('CFR','Cost and Freight',            'Seller pays cost and freight to named destination port.',                               'On board vessel',                   'Sea and inland waterway'),
     ('CIF','Cost Insurance and Freight',  'Seller pays cost, insurance and freight to named destination port.',                   'On board vessel',                   'Sea and inland waterway')`
  )
  console.log(`  inco_terms     ${r6.affectedRows} rows inserted`)

  // ── System settings ──────────────────────────────────────
  // Table uses `key`/`value` columns (created by earlier migration)
  const [r7] = await db.query(
    "INSERT IGNORE INTO system_settings (`key`, `value`) VALUES " +
    "('escalation_email', '')," +
    "('password_expiry_days_internal', '90')," +
    "('password_expiry_days_external', '30')," +
    "('access_expiry_warning_days', '30,14,7,1')," +
    "('system_name', 'QCO Group MMS')"
  )
  console.log(`  system_settings ${r7.affectedRows} rows inserted`)

  console.log('\nDone.\n')
  process.exit(0)
}

run().catch(err => {
  console.error('\nSeed failed:', err.message)
  process.exit(1)
})
