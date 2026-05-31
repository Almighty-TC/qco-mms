// ─── MIGRATE WBS FORECAST/ACTUAL DATE COLUMNS ────────────────
// Adds forecast_start, forecast_end, actual_start, actual_end
// to wbs_nodes if they don't already exist.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  console.log('\n── MIGRATE wbs_nodes forecast/actual columns ────────────\n')
  const cols = ['forecast_start','forecast_end','actual_start','actual_end']
  for (const col of cols) {
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns
       WHERE table_schema=DATABASE() AND table_name='wbs_nodes' AND column_name=?`,
      [col]
    )
    if (row.cnt === 0) {
      await db.query(`ALTER TABLE wbs_nodes ADD COLUMN ${col} date DEFAULT NULL`)
      console.log(`  ✓ Added column: ${col}`)
    } else {
      console.log(`  — Already exists: ${col}`)
    }
  }
  const [[verify]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'wbs_nodes'
       AND column_name IN ('forecast_start','forecast_end','actual_start','actual_end')`
  )
  console.log(`\n  Verified: ${verify.cnt}/4 columns present in wbs_nodes\n`)
  process.exit(0)
}

run().catch(e => { console.error(e.message); process.exit(1) })
