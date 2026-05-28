// ─── SEED USERS + PROJECT DATA ──────────────────────────────────
// Adds 8 more dummy users with varied roles and WBS project assignments.
// Also updates projects with client, start_date, end_date details.
// Safe to re-run: INSERT IGNORE skips duplicates.
const db = require('../db')

const hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi' // "password"

async function run() {
  // ─── UPDATE PROJECT CLIENT / DATES ──────────────────────────
  const updates = [
    ['Woodside Energy Ltd',  '2024-03-01', '2026-09-30', 'red',   'PRJ-2024-001'],
    ['AGL Energy',           '2024-06-15', '2025-12-31', 'amber', 'PRJ-2024-002'],
    ['Snowy Hydro Ltd',      '2023-01-10', '2025-06-30', 'green', 'PRJ-2023-008'],
    ['Santos Limited',       '2025-02-01', '2027-03-31', 'blue',  'PRJ-2025-001'],
  ]
  for (const [client, start, end, rag, code] of updates) {
    await db.query(
      `UPDATE projects SET client=?, start_date=?, end_date=?, rag=? WHERE code=?`,
      [client, start, end, rag, code]
    )
  }
  console.log('✓ Project client/date/RAG updated')

  // ─── INSERT 8 MORE USERS ─────────────────────────────────────
  const users = [
    ['anna.petrova@qcogroup.com.au',  hash, 'Anna Petrova',  'project_manager',   'QCO Group',        '+61 400 100 001', 1],
    ['james.okafor@qcogroup.com.au',  hash, 'James Okafor',  'project_manager',   'QCO Group',        '+61 400 100 002', 1],
    ['nina.walsh@qcogroup.com.au',    hash, 'Nina Walsh',    'expeditor',         'QCO Group',        '+61 400 100 003', 1],
    ['carlos.reyes@qcogroup.com.au',  hash, 'Carlos Reyes',  'expeditor',         'QCO Group',        '+61 400 100 004', 1],
    ['sophie.kim@qcogroup.com.au',    hash, 'Sophie Kim',    'site_contractor',   'QCO Group',        '+61 400 100 005', 1],
    ['raj.patel@steelparts.com.au',   hash, 'Raj Patel',     'vendor',            'Steel Parts Pty',  '+61 400 100 006', 1],
    ['mei.lin@fastfreight.com.au',    hash, 'Mei Lin',       'freight_forwarder', 'Fast Freight Pty', '+61 400 100 007', 1],
    ['alex.burns@qcogroup.com.au',    hash, 'Alex Burns',    'warehouse',         'QCO Group',        '+61 400 100 008', 1],
  ]

  const [uResult] = await db.query(
    `INSERT IGNORE INTO users (email, password_hash, full_name, role, company, phone, is_active) VALUES ?`,
    [users]
  )
  console.log(`✓ ${uResult.affectedRows} user(s) inserted, ${uResult.warningCount ?? 0} skipped`)

  // ─── FETCH INSERTED USER IDS ─────────────────────────────────
  const emails = users.map(u => u[0])
  const [inserted] = await db.query(
    `SELECT id, email, role FROM users WHERE email IN (?)`, [emails]
  )
  const [projects] = await db.query(`SELECT id, code FROM projects`)
  const proj = Object.fromEntries(projects.map(p => [p.code, p.id]))

  const [[admin]] = await db.query(`SELECT id FROM users WHERE email = 'admin@qco.com.au' LIMIT 1`)
  const adminId = admin?.id ?? 1

  // ─── WBS ACCESS ASSIGNMENTS ──────────────────────────────────
  const wbsRows = []
  for (const u of inserted) {
    if (u.email === 'anna.petrova@qcogroup.com.au') {
      if (proj['PRJ-2024-001']) wbsRows.push([u.id, proj['PRJ-2024-001'], 'ALL', adminId])
    } else if (u.email === 'james.okafor@qcogroup.com.au') {
      if (proj['PRJ-2024-002']) wbsRows.push([u.id, proj['PRJ-2024-002'], 'ALL', adminId])
      if (proj['PRJ-2025-001']) wbsRows.push([u.id, proj['PRJ-2025-001'], 'ALL', adminId])
    } else if (u.email === 'nina.walsh@qcogroup.com.au') {
      if (proj['PRJ-2024-001']) wbsRows.push([u.id, proj['PRJ-2024-001'], 'ALL', adminId])
      if (proj['PRJ-2023-008']) wbsRows.push([u.id, proj['PRJ-2023-008'], 'ALL', adminId])
    } else if (u.email === 'carlos.reyes@qcogroup.com.au') {
      if (proj['PRJ-2024-002']) wbsRows.push([u.id, proj['PRJ-2024-002'], 'ALL', adminId])
      if (proj['PRJ-2025-001']) wbsRows.push([u.id, proj['PRJ-2025-001'], 'ALL', adminId])
    } else if (u.email === 'sophie.kim@qcogroup.com.au') {
      if (proj['PRJ-2025-001']) wbsRows.push([u.id, proj['PRJ-2025-001'], 'ALL', adminId])
    }
  }

  if (wbsRows.length > 0) {
    const [wResult] = await db.query(
      `INSERT IGNORE INTO user_wbs_access (user_id, project_id, wbs_code, created_by) VALUES ?`,
      [wbsRows]
    )
    console.log(`✓ ${wResult.affectedRows} WBS access row(s) inserted`)
  }

  console.log('Done.')
  process.exit(0)
}

run().catch(e => { console.error(e.message); process.exit(1) })
