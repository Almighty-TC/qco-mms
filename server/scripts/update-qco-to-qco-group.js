// ─── UPDATE QCO → QCO GROUP ──────────────────────────────────
// Run once: node server/scripts/update-qco-to-qco-group.js
// Updates company name in users table and system_name in settings.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mysql = require('mysql2/promise')

async function run() {
  const db = await mysql.createConnection({
    host:     process.env.DB_HOST,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl:      { rejectUnauthorized: false },
  })

  const [r1] = await db.query("UPDATE users SET company = 'QCO Group' WHERE company = 'QCO'")
  console.log('users.company updated:', r1.affectedRows, 'row(s)')

  const [r2] = await db.query("UPDATE system_settings SET value = 'QCO Group MMS' WHERE `key` = 'system_name'")
  console.log('system_settings.system_name updated:', r2.affectedRows, 'row(s)')

  await db.end()
  console.log('Done.')
}

run().catch(e => { console.error(e); process.exit(1) })
