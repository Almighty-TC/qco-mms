// ─── SEED EXPEDITING MILESTONES ───────────────────────────────
// Seeds po_milestones for all locked Pilbara POs with a mix of RAG
// states. Uses INSERT IGNORE so it's safe to re-run.

const db = require('../db')

const LABELS = [
  'PO Award',
  'FAT / Inspection',
  'Ready for Shipment',
  'ETD / Ship',
  'ROS / ETA',
]

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function daysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// Each config: array of 5 objects { planned_date, forecast_date, actual_date, status }
const CONFIGS = {
  // PO-TEST-001 (id=7): all 5 complete
  'PO-TEST-001': LABELS.map((_, i) => ({
    planned_date: daysAgo(60 - i * 10),
    forecast_date: null,
    actual_date: daysAgo(58 - i * 10),
    status: 'complete',
  })),

  // PO-2024-001 (id=1): 3 complete, 1 amber (forecast 5 days from now), 1 grey
  'PO-2024-001': [
    { planned_date: daysAgo(90), forecast_date: null, actual_date: daysAgo(88), status: 'complete' },
    { planned_date: daysAgo(60), forecast_date: null, actual_date: daysAgo(55), status: 'complete' },
    { planned_date: daysAgo(30), forecast_date: null, actual_date: daysAgo(28), status: 'complete' },
    { planned_date: daysAgo(5),  forecast_date: daysFromNow(5), actual_date: null, status: 'at_risk' },
    { planned_date: daysFromNow(30), forecast_date: null, actual_date: null, status: 'not_started' },
  ],

  // PO-2024-002 (id=2): 3 complete, 1 red (forecast 10 days ago, no actual), 1 red
  'PO-2024-002': [
    { planned_date: daysAgo(100), forecast_date: null, actual_date: daysAgo(98), status: 'complete' },
    { planned_date: daysAgo(70),  forecast_date: null, actual_date: daysAgo(65), status: 'complete' },
    { planned_date: daysAgo(40),  forecast_date: null, actual_date: daysAgo(38), status: 'complete' },
    { planned_date: daysAgo(20),  forecast_date: daysAgo(10), actual_date: null, status: 'breached' },
    { planned_date: daysAgo(5),   forecast_date: daysAgo(2),  actual_date: null, status: 'breached' },
  ],

  // PO-2024-003 (id=3): 2 complete, 3 grey (future planned)
  'PO-2024-003': [
    { planned_date: daysAgo(80), forecast_date: null, actual_date: daysAgo(78), status: 'complete' },
    { planned_date: daysAgo(50), forecast_date: null, actual_date: daysAgo(48), status: 'complete' },
    { planned_date: daysFromNow(14), forecast_date: null, actual_date: null, status: 'not_started' },
    { planned_date: daysFromNow(30), forecast_date: null, actual_date: null, status: 'not_started' },
    { planned_date: daysFromNow(50), forecast_date: null, actual_date: null, status: 'not_started' },
  ],

  // PO-2024-004 (id=4): 1 complete, 4 grey
  'PO-2024-004': [
    { planned_date: daysAgo(30), forecast_date: null, actual_date: daysAgo(28), status: 'complete' },
    { planned_date: daysFromNow(10),  forecast_date: null, actual_date: null, status: 'not_started' },
    { planned_date: daysFromNow(25),  forecast_date: null, actual_date: null, status: 'not_started' },
    { planned_date: daysFromNow(40),  forecast_date: null, actual_date: null, status: 'not_started' },
    { planned_date: daysFromNow(60),  forecast_date: null, actual_date: null, status: 'not_started' },
  ],
}

async function seed() {
  const [pos] = await db.query(
    `SELECT id, po_number FROM purchase_orders WHERE is_locked=1 AND project_id=1 AND po_number NOT LIKE '%PENDING%'`
  )
  console.log('Found POs:', pos.map(p => p.po_number).join(', '))

  for (const po of pos) {
    const config = CONFIGS[po.po_number]
    if (!config) {
      console.log(`No config for ${po.po_number}, skipping`)
      continue
    }
    for (let i = 0; i < LABELS.length; i++) {
      const m = config[i]
      await db.query(
        `INSERT IGNORE INTO po_milestones
          (po_id, step_order, label, planned_date, forecast_date, actual_date, status, forecast_changed_count, is_deleted, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1, NOW())`,
        [po.id, i + 1, LABELS[i], m.planned_date, m.forecast_date, m.actual_date, m.status]
      )
    }
    console.log(`Seeded ${LABELS.length} milestones for ${po.po_number}`)
  }

  console.log('Done.')
  process.exit(0)
}

seed().catch(e => { console.error(e); process.exit(1) })
