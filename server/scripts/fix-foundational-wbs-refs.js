// ─── FIX COMMODITY & EQUIPMENT WBS REFERENCES ──────────────
// After the deep WBS seed replaced all nodes, commodity_library and
// equipment_list still reference old node IDs. This script re-maps
// them to the closest valid node in the new deep tree.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const db = require('../db')

async function run() {
  console.log('\n── FIX FOUNDATIONAL WBS REFERENCES ────────────────────\n')

  // Fetch all projects
  const [projects] = await db.query(
    "SELECT id, code FROM projects WHERE code IN ('PRJ-2024-001','PRJ-2024-002','PRJ-2023-008','PRJ-2025-001')"
  )
  const P = {}
  for (const p of projects) P[p.code] = p.id

  // For each project, build a map of wbs code → id
  for (const [projCode, pid] of Object.entries(P)) {
    const [nodes] = await db.query(
      'SELECT id, code FROM wbs_nodes WHERE project_id=? ORDER BY code', [pid]
    )
    const nodeMap = {}
    for (const n of nodes) nodeMap[n.code] = n.id

    // Find the best matching node for a given old code
    // Strategy: try exact match, then progressively strip last segment
    function bestMatch(oldCode) {
      if (!oldCode) return null
      // Try exact first
      if (nodeMap[oldCode]) return { code: oldCode, id: nodeMap[oldCode] }
      // Try stripping segments from right
      const parts = oldCode.split('.')
      for (let len = parts.length - 1; len >= 1; len--) {
        const candidate = parts.slice(0, len).join('.')
        if (nodeMap[candidate]) return { code: candidate, id: nodeMap[candidate] }
      }
      // Pick a random 4-level node as fallback
      const fourLevel = Object.entries(nodeMap).find(([c]) => c.split('.').length === 4)
      if (fourLevel) return { code: fourLevel[0], id: fourLevel[1] }
      return null
    }

    // ── Update commodity_library ────────────────────────────────
    const [comms] = await db.query(
      'SELECT id, wbs_code FROM commodity_library WHERE project_id=?', [pid]
    )
    let commUpdated = 0
    for (const c of comms) {
      const match = bestMatch(c.wbs_code)
      if (!match) continue
      if (match.id !== c.wbs_node_id || match.code !== c.wbs_code) {
        await db.query(
          'UPDATE commodity_library SET wbs_code=?, wbs_node_id=? WHERE id=?',
          [match.code, match.id, c.id]
        )
        commUpdated++
      }
    }

    // ── Update equipment_list ───────────────────────────────────
    const [equips] = await db.query(
      'SELECT id, wbs_code FROM equipment_list WHERE project_id=?', [pid]
    )
    let equipUpdated = 0
    for (const e of equips) {
      const match = bestMatch(e.wbs_code)
      if (!match) continue
      if (match.id !== e.wbs_node_id || match.code !== e.wbs_code) {
        await db.query(
          'UPDATE equipment_list SET wbs_code=?, wbs_node_id=? WHERE id=?',
          [match.code, match.id, e.id]
        )
        equipUpdated++
      }
    }

    console.log(`  ${projCode}: ${commUpdated} commodities + ${equipUpdated} equipment updated`)
  }

  console.log('\n── DONE ────────────────────────────────────────────────\n')
  process.exit(0)
}

run().catch(e => { console.error(e.message); process.exit(1) })
