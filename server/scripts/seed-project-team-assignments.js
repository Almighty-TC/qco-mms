// ─── SEED PROJECT TEAM ASSIGNMENTS ───────────────────────────
// Inserts user_wbs_access rows for the 4 project team dummy users.
// Safe to re-run: uses INSERT IGNORE on a composite unique constraint.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

// Assignments: [email, projectCode] — resolved to IDs at runtime
const ASSIGNMENTS = [
  ['james.oconnor@pilbaragas.com.au',  'PRJ-2024-001'],
  ['sarah.lim@huntervalley.com.au',    'PRJ-2024-002'],
  ['david.nguyen@ordriver.com.au',     'PRJ-2023-008'],
  ['michelle.park@porthedland.com.au', 'PRJ-2025-001'],
]

async function run() {
  // Resolve email → user ID
  const emails = ASSIGNMENTS.map(([e]) => e)
  const [users] = await db.query(
    `SELECT id, email, full_name FROM users WHERE email IN (${emails.map(() => '?').join(',')})`,
    emails
  )
  const userMap = Object.fromEntries(users.map(u => [u.email, u]))

  // Resolve project code → project ID
  const codes = ASSIGNMENTS.map(([, c]) => c)
  const [projects] = await db.query(
    `SELECT id, code FROM projects WHERE code IN (${codes.map(() => '?').join(',')})`,
    codes
  )
  const projMap = Object.fromEntries(projects.map(p => [p.code, p]))

  console.log('Resolved users:', users.map(u => `${u.full_name} (${u.id})`).join(', '))
  console.log('Resolved projects:', projects.map(p => `${p.code} (${p.id})`).join(', '))

  let inserted = 0
  let skipped  = 0

  for (const [email, code] of ASSIGNMENTS) {
    const user = userMap[email]
    const proj = projMap[code]

    if (!user) { console.log(`  ⚠ User not found: ${email}`); skipped++; continue }
    if (!proj) { console.log(`  ⚠ Project not found: ${code}`); skipped++; continue }

    // Check for existing row first (table may not have a unique constraint)
    const [[{ cnt }]] = await db.query(
      'SELECT COUNT(*) AS cnt FROM user_wbs_access WHERE user_id = ? AND project_id = ?',
      [user.id, proj.id]
    )
    if (cnt > 0) {
      console.log(`  Skipped (exists): ${user.full_name} → ${code}`)
      skipped++
      continue
    }

    await db.query(
      'INSERT INTO user_wbs_access (user_id, project_id, wbs_code, created_by) VALUES (?, ?, ?, 1)',
      [user.id, proj.id, 'ALL']
    )
    console.log(`✓ Assigned: ${user.full_name} → ${code}`)
    inserted++
  }

  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped.`)

  // Verify
  const [rows] = await db.query(
    `SELECT u.full_name, p.code AS project
     FROM user_wbs_access w
     JOIN users u ON u.id = w.user_id
     JOIN projects p ON p.id = w.project_id
     WHERE u.email IN (${emails.map(() => '?').join(',')})
     ORDER BY u.full_name`,
    emails
  )
  console.log('\n=== Project Team assignments ===')
  rows.forEach(r => console.log(`  ${r.full_name} → ${r.project}`))

  process.exit(0)
}

run().catch(e => { console.error(e.message); process.exit(1) })
