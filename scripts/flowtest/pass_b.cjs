// PASS B — ZZ flowtest data-integrity assertions (re-runnable).
// Usage: node scripts/flowtest/pass_b.cjs [projectId] [canonicalBaselineJson]
//   projectId           — defaults to the project whose code = 'ZZ_FLOWTEST'
//   canonicalBaselineJson — path to a {table:count} snapshot of projects 1–4
//                           (defaults to /tmp/zz_canonical_pre.json if present)
// Covers: milestone-date monotonicity (planned/forecast/actual — the blind spot
// that previously slipped through), traced rich unit, WBS Gantt roll-up, field
// completeness, inherited-ROS-with-log, shipment-event monotonicity, orphans,
// canonical drift. Read-only.
const m = require('../../server/node_modules/mysql2/promise')
const fs = require('fs')
require('../../server/node_modules/dotenv').config({ path: '../../server/.env' })
const D = v => v ? new Date(v) : null
const le = (a, b) => +D(a) <= +D(b)
const d10 = v => v ? String(v).slice(0, 10) : '—'

;(async () => {
  const c = await m.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: { rejectUnauthorized: false } })
  const one = async (s, p = []) => { const [r] = await c.query(s, p); return r[0] }
  const all = async (s, p = []) => { const [r] = await c.query(s, p); return r }

  let pid = Number(process.argv[2])
  if (!pid) pid = (await one("SELECT id FROM projects WHERE code='ZZ_FLOWTEST'"))?.id
  if (!pid) { console.error('No ZZ project found'); process.exit(1) }
  const results = []  // [name, pass, detail]
  const A = (name, pass, detail) => results.push([name, pass, detail])

  // ── 1. MILESTONE-DATE MONOTONICITY (planned / forecast / actual, per PO) ──
  const pos = await all('SELECT id,po_number FROM purchase_orders WHERE project_id=? ORDER BY id', [pid])
  const trackOk = (rows, k) => { let prev = null; for (const r of rows) { const v = r[k]; if (v && prev && new Date(v) < new Date(prev)) return false; if (v) prev = v } return true }
  let badP = 0, badF = 0, badA = 0, slips = 0, fwdOk = 0, fwdTot = 0
  for (const po of pos) {
    const ms = await all('SELECT step_order,DATE(planned_date) p,DATE(forecast_date) f,DATE(actual_date) a FROM po_milestones WHERE po_id=? ORDER BY step_order', [po.id])
    if (!trackOk(ms, 'p')) badP++; if (!trackOk(ms, 'f')) badF++; if (!trackOk(ms, 'a')) badA++
    if (ms.some(x => x.f && x.p && +new Date(x.f) !== +new Date(x.p))) slips++
    for (const x of ms) { if (x.f && x.p) { fwdTot++; if (+new Date(x.f) >= +new Date(x.p)) fwdOk++ } } // forecast ≥ planned
  }
  A('milestone planned monotonic', badP === 0, `${pos.length - badP}/${pos.length}`)
  A('milestone forecast monotonic', badF === 0, `${pos.length - badF}/${pos.length} (${slips} POs slipped)`)
  A('milestone actual monotonic', badA === 0, `${pos.length - badA}/${pos.length}`)
  A('forecast ≥ planned (each milestone)', fwdOk === fwdTot, `${fwdOk}/${fwdTot}`)

  // ── 2. WBS GANTT ROLL-UP ──
  const wd = await one('SELECT COUNT(*) total, COUNT(planned_start) ps, COUNT(forecast_end) fe, COUNT(actual_start) as_ FROM wbs_nodes WHERE project_id=?', [pid])
  A('WBS Gantt bars present', wd.ps > 0, `planned=${wd.ps} forecast=${wd.fe} actual=${wd.as_} of ${wd.total}`)
  const roots = await all("SELECT code,planned_start ps,planned_end pe FROM wbs_nodes WHERE project_id=? AND code NOT LIKE '%.%' AND planned_start IS NOT NULL", [pid])
  let span = 0
  for (const r of roots) { const k = await one('SELECT MIN(planned_start) mn,MAX(planned_end) mx FROM wbs_nodes WHERE project_id=? AND code LIKE ? AND planned_start IS NOT NULL', [pid, r.code + '.%']); if (!k.mn || (le(r.ps, k.mn) && le(k.mx, r.pe))) span++ }
  A('parents span children', span === roots.length, `${span}/${roots.length}`)

  // ── 3. FIELD COMPLETENESS ──
  const cm = await one('SELECT SUM(preservation IS NULL OR preservation="") a,SUM(preferred_vendor IS NULL) b,SUM(notes IS NULL OR notes="") d FROM commodity_library WHERE project_id=?', [pid])
  const eq = await one('SELECT SUM(size_lwh IS NULL OR size_lwh="") a,SUM(notes IS NULL OR notes="") b,SUM(vendor IS NULL) d FROM equipment_list WHERE project_id=?', [pid])
  A('field completeness (no blanks)', cm.a == 0 && cm.b == 0 && cm.d == 0 && eq.a == 0 && eq.b == 0 && eq.d == 0, `commodity(pres=${cm.a},vend=${cm.b},notes=${cm.d}) equip(size=${eq.a},notes=${eq.b},vend=${eq.d})`)

  // ── 4. INHERITED-ROS WITH LOG ──
  const r1 = await one(`SELECT SUM(inh) pure, SUM(CASE WHEN inh=0 AND lg=1 THEN 1 ELSE 0 END) amLog, SUM(CASE WHEN inh=0 AND lg=0 THEN 1 ELSE 0 END) silent FROM (SELECT (DATE(p.ros_date)=(SELECT DATE(MIN(ros_date)) FROM mto_lines WHERE po_ref=p.po_number)) inh, EXISTS(SELECT 1 FROM date_change_log d WHERE d.entity_type='purchase_order' AND d.entity_id=p.id AND d.field_name='ros_date') lg FROM purchase_orders p WHERE p.project_id=?) t`, [pid])
  A('inherited-ROS (0 silent divergence)', Number(r1.silent) === 0, `pure=${r1.pure} amended+log=${r1.amLog} silent=${r1.silent}`)

  // ── 5. SHIPMENT-EVENT MONOTONICITY ──
  const units = await all('SELECT ws.received_date rd,s.cargo_ready_date cr,s.etd,s.atd,s.eta,s.ata FROM warehouse_stock ws JOIN shipment_control_notes s ON s.id=ws.scn_id WHERE ws.project_id=? AND ws.received_date IS NOT NULL', [pid])
  let mb = 0, ab = 0
  for (const x of units) { const sq = [x.cr, x.etd, x.atd, x.eta, x.ata, x.rd].filter(Boolean); for (let i = 1; i < sq.length; i++) if (+D(sq[i]) < +D(sq[i - 1])) { mb++; break } if (x.ata && +D(x.rd) < +D(x.ata)) ab++ }
  A('shipment events monotonic', mb === 0, `${units.length - mb}/${units.length}`)
  A('receipt ≥ ATA', ab === 0, `${units.length - ab}/${units.length}`)

  // ── 6. ORPHANS + EXCEPTIONS ──
  const orph = (await one('SELECT (SELECT COUNT(*) FROM warehouse_stock WHERE project_id=? AND po_line_id IS NULL)+(SELECT COUNT(*) FROM shipment_control_notes WHERE project_id=? AND po_id IS NULL)+(SELECT COUNT(*) FROM traceability_certs WHERE project_id=? AND po_id IS NULL) n', [pid, pid, pid])).n
  A('orphans = 0', orph === 0, `${orph}`)
  const over = (await one("SELECT COUNT(*) n FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=? AND pl.ros_date<CURDATE() AND pl.status NOT IN ('received','closed')", [pid])).n
  A('overdue lines populate (Attention)', over > 0, `${over}`)

  // ── 7. CANONICAL 1–4 DRIFT ──
  const baseFile = process.argv[3] || (fs.existsSync('/tmp/zz_canonical_pre.json') ? '/tmp/zz_canonical_pre.json' : null)
  if (baseFile) {
    const pre = JSON.parse(fs.readFileSync(baseFile, 'utf8'))
    const direct = ['wbs_nodes', 'commodity_library', 'equipment_list', 'mto_registers', 'purchase_orders', 'shipment_control_notes', 'warehouse_stock', 'traceability_certs', 'rfi_meeting_records']
    const drift = []
    for (const t of direct) if (pre[t] !== undefined) { const [[r]] = await c.query('SELECT COUNT(*) n FROM `' + t + '` WHERE project_id IN (1,2,3,4)'); if (r.n !== pre[t]) drift.push(`${t}:${pre[t]}->${r.n}`) }
    if (pre.mto_lines !== undefined) { const [[r]] = await c.query('SELECT COUNT(*) n FROM mto_lines l JOIN mto_registers x ON x.id=l.mto_id WHERE x.project_id IN (1,2,3,4)'); if (r.n !== pre.mto_lines) drift.push(`mto_lines:${pre.mto_lines}->${r.n}`) }
    A('canonical 1–4 unchanged', drift.length === 0, drift.length ? drift.join(',') : '0 drift')
  } else A('canonical 1–4 unchanged', true, '(no baseline file — skipped)')

  // ── OUTPUT ──
  console.log(`PASS B — project ${pid}`)
  let allPass = true
  for (const [n, p, d] of results) { console.log(`  ${p ? '✅' : '❌'} ${n.padEnd(36)} ${d}`); if (!p) allPass = false }
  console.log(`\n${allPass ? '✅ ALL PASS' : '❌ FAILURES PRESENT'} (${results.filter(r => r[1]).length}/${results.length})`)
  await c.end()
  process.exit(allPass ? 0 : 1)
})().catch(e => { console.error('ERR', e.message); process.exit(2) })
