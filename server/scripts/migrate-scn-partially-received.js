// ─── MIGRATE: SCN status += 'partially_received' (Receipting Phase 4) ─
// Run once: node server/scripts/migrate-scn-partially-received.js
// Additive enum change — lists every existing member plus the new one.
// Reversible (no rows use it yet): MODIFY back to the original enum.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  await db.query(`ALTER TABLE shipment_control_notes MODIFY COLUMN status
    ENUM('draft','pending','in-transit','customs_review','arrived','partially_received',
         'received','closed','pending_pickup','in_transit','pending_delivery','delivered')
    DEFAULT 'draft'`)
  console.log('  ✓ shipment_control_notes.status enum + partially_received')
  process.exit(0)
}
run().catch(e => { console.error('Migration failed:', e); process.exit(1) })
