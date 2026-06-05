// Adds acronyms that appear across the screens but were missing from the table.
// Idempotent: skips any acronym that already exists. App user (qmat_app) has INSERT.
const db = require('../server/db')

const ROWS = [
  // [acronym, definition, module, notes]
  ['CDD',  'Contract Delivery Date',            'Procurement',      'Contractual date material is due — inherited onto SCNs from the PO line.'],
  ['CRD',  'Cargo Ready Date',                  'Logistics',        'Date the goods are ready for collection at origin (shown on the SCN).'],
  ['CCD',  'Cargo Collection Date',             'Logistics',        'Date the forwarder collects the cargo from origin (shown on the SCN).'],
  ['ETD',  'Estimated Time of Departure',       'Logistics',        'Planned date a shipment leaves origin.'],
  ['ETA',  'Estimated Time of Arrival',         'Logistics',        'Planned date a shipment arrives at destination.'],
  ['ATD',  'Actual Time of Departure',          'Logistics',        'Recorded date a shipment actually departed.'],
  ['ATA',  'Actual Time of Arrival',            'Logistics',        'Recorded date a shipment actually arrived (stamped on receipt).'],
  ['UOM',  'Unit of Measure',                   'Foundational',     'e.g. EA, M, KG, LM — the unit a quantity is counted in.'],
  ['RAG',  'Red, Amber, Green',                 'General',          'Status rating: green = on track, amber = at risk, red = breached, grey = not started, blue = in progress.'],
  ['MTC',  'Mill Test Certificate',             'Traceability',     'Material test certificate from the mill, tied to a heat number.'],
  ['DG',   'Dangerous Goods',                   'Logistics',        'Hazardous material requiring DG class / UN number handling.'],
  ['RFQ',  'Request for Quotation',             'Procurement',      'Quotation request issued to vendors before a PO is raised.'],
  ['PoC',  'Proof of Collection',               'Material Control', 'Who collected material at FMR pickup — name, company, signature/photo.'],
  ['ESD',  'Estimated Shipment Date',           'Expediting',       'Expediting milestone — forecast ex-works ship date.'],
  ['INSP', 'Inspection',                        'Expediting',       'Inspection / inspection class on an MTO line or ITP item.'],
  ['MMS',  'Materials Management System',        'General',          'The QCO MMS platform itself.'],
  ['QCO',  'QCO',                               'General',          'The platform owner / product brand (QCO MMS).'],
  ['ABF',  'Approved Before Fabrication',       'VDRL',             'VDRL document gate — must be approved before fabrication can start.'],
  // ── Incoterms 2020 (shipment terms shown on POs/SCNs) ──
  ['EXW',  'Ex Works',                          'Logistics',        'Incoterm 2020 — buyer collects at seller premises.'],
  ['FCA',  'Free Carrier',                      'Logistics',        'Incoterm 2020 — seller delivers to a carrier nominated by the buyer.'],
  ['FOB',  'Free On Board',                     'Logistics',        'Incoterm 2020 — seller delivers on board the vessel.'],
  ['CIF',  'Cost, Insurance and Freight',       'Logistics',        'Incoterm 2020 — seller pays cost, insurance and freight to destination port.'],
  ['CIP',  'Carriage and Insurance Paid To',    'Logistics',        'Incoterm 2020 — seller pays carriage and insurance to named place.'],
  ['CPT',  'Carriage Paid To',                  'Logistics',        'Incoterm 2020 — seller pays carriage to named place.'],
  ['DAP',  'Delivered At Place',                'Logistics',        'Incoterm 2020 — seller delivers, ready for unloading, at named place.'],
  ['DDP',  'Delivered Duty Paid',              'Logistics',        'Incoterm 2020 — seller delivers cleared for import, duties paid.'],
]

;(async () => {
  const [existing] = await db.query('SELECT UPPER(acronym) AS a FROM acronyms')
  const have = new Set(existing.map(r => r.a))
  let added = 0, skipped = 0
  for (const [acr, def, mod, notes] of ROWS) {
    if (have.has(acr.toUpperCase())) { skipped++; continue }
    await db.query('INSERT INTO acronyms (acronym, definition, module, notes, created_by, created_at) VALUES (?,?,?,?,1,NOW())', [acr, def, mod, notes])
    added++
  }
  const [[{ c }]] = await db.query('SELECT COUNT(*) c FROM acronyms')
  console.log(`Added ${added}, skipped ${skipped} (already present). Acronyms table now has ${c} rows.`)
  process.exit(0)
})().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
