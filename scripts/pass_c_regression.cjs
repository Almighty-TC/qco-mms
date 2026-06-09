// ─── PASS C — REGRESSION (read-only) ─────────────────────────────────────────
// Data-integrity half of the PASS C checklist: canonical projects 1–4 untouched
// + audit hash-chain intact. Reuses the canonical baseline snapshot and the
// single-source verifyChain so it can't drift from the migration logic.
// Usage (from server/):  node ../scripts/pass_c_regression.cjs [baselineJson]
//   baselineJson — defaults to ../docs/canonical_baseline.json
const path = require('path')
const fs = require('fs')
const db = require('../server/db')
const { verifyChain } = require('../server/lib/auditChain')

;(async () => {
  const baseFile = process.argv[2] || path.join(__dirname, '..', 'docs', 'canonical_baseline.json')
  const conn = await db.getConnection()
  const results = []
  const A = (name, pass, detail) => results.push([name, pass, detail])
  try {
    // ── CANONICAL 1–4 DRIFT ──────────────────────────────────────────────────
    const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'))
    const pre = base.counts || base
    // Exactly the pass_b-validated project_id-scoped set (all have project_id).
    const direct = [
      'wbs_nodes', 'commodity_library', 'equipment_list', 'mto_registers',
      'purchase_orders', 'shipment_control_notes', 'warehouse_stock',
      'traceability_certs', 'rfi_meeting_records',
    ]
    const drift = []
    for (const t of direct) {
      if (pre[t] === undefined) continue
      const [[r]] = await conn.query('SELECT COUNT(*) n FROM `' + t + '` WHERE project_id IN (1,2,3,4)')
      if (r.n !== pre[t]) drift.push(`${t}:${pre[t]}->${r.n}`)
    }
    if (pre.mto_lines !== undefined) {
      const [[r]] = await conn.query('SELECT COUNT(*) n FROM mto_lines l JOIN mto_registers x ON x.id=l.mto_id WHERE x.project_id IN (1,2,3,4)')
      if (r.n !== pre.mto_lines) drift.push(`mto_lines:${pre.mto_lines}->${r.n}`)
    }
    A('canonical 1–4 unchanged', drift.length === 0, drift.length ? drift.join(',') : `0 drift (${baseFile.split('/').pop()})`)

    // ── AUDIT HASH-CHAIN INTACT ───────────────────────────────────────────────
    for (const tbl of ['audit_log', 'audit_review']) {
      const v = await verifyChain(conn, tbl)
      const detail = v.status === 'verified'
        ? `verified${v.chain.sealed ? ` (checkpoint ${v.chain.checkpoint_id}, ${v.chain.actual_rows} rows)` : ' (unsealed)'}`
        : `BROKEN at id ${v.brokenAtId} (content=${v.contentBrokenId})`
      A(`audit chain intact — ${tbl}`, v.status === 'verified', detail)
    }
  } catch (e) {
    A('pass-c execution', false, e.message)
  } finally {
    conn.release()
  }

  // ── OUTPUT ──
  console.log('PASS C — regression (data integrity, read-only)')
  let allPass = true
  for (const [n, p, d] of results) { console.log(`  ${p ? '✅' : '❌'} ${n.padEnd(34)} ${d}`); if (!p) allPass = false }
  console.log(`\n${allPass ? '✅ ALL PASS' : '❌ FAILURES PRESENT'} (${results.filter(r => r[1]).length}/${results.length})`)
  process.exit(allPass ? 0 : 1)
})()
