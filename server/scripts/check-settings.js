// ─── CHECK SYSTEM SETTINGS ──────────────────────────────────
// Run once: node server/scripts/check-settings.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mysql = require('mysql2/promise')

async function run() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  })
  const [rows] = await db.query('SELECT * FROM system_settings LIMIT 30')
  console.log('columns:', rows.length ? Object.keys(rows[0]) : 'none')
  console.log(JSON.stringify(rows, null, 2))
  await db.end()
}
run().catch(e => { console.error(e); process.exit(1) })
