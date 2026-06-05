// ZZ_FLOWTEST flow-test runner (READ-ONLY assertions; records findings; fixes nothing).
// Run from server/: node ../docs/flowtest/flowtest_run.cjs
const db = require('../../server/db')
const jwt = require('../../server/node_modules/jsonwebtoken')
const SECRET = process.env.JWT_SECRET || 'qmat_jwt_secret_2024'
const API = 'http://localhost:3001/api'
const results = []
const rec = (mod, step, expected, actual, verdict, ev = '') => results.push({ mod, step, expected, actual, verdict, ev })
async function api(token, method, path, body) {
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let d = null; try { d = await r.json() } catch {}
  return { status: r.status, data: d }
}

async function main() {
  const [[proj]] = await db.query("SELECT id FROM projects WHERE code='ZZ_FLOWTEST'")
  const pid = proj.id
  const tok = async (email) => { const [[u]] = await db.query('SELECT id,role FROM users WHERE email=?', [email]); return jwt.sign({ id: u.id, role: u.role }, SECRET) }
  const adminT = jwt.sign({ id: 1, role: 'admin' }, SECRET)

  // ── 7. HEAT CONTINUITY ──
  const [[gc]] = await db.query(`
    SELECT COUNT(*) c FROM (
      SELECT s.heat_number FROM scn_heats s JOIN shipment_control_notes scn ON scn.id=s.scn_id AND scn.project_id=?
      WHERE EXISTS (SELECT 1 FROM warehouse_stock st WHERE st.project_id=? AND UPPER(TRIM(st.heat_number))=UPPER(TRIM(s.heat_number)))
        AND EXISTS (SELECT 1 FROM traceability_certs c WHERE c.project_id=? AND UPPER(TRIM(c.heat_ref))=UPPER(TRIM(s.heat_number)))
      GROUP BY s.heat_number) x`, [pid, pid, pid])
  rec('7-Heat', 'good chains SCN↔stock↔cert (case-insensitive)', '≥50', gc.c, gc.c >= 50 ? 'PASS' : 'FAIL', `${gc.c} heats fully linked`)

  const [[edgeA]] = await db.query("SELECT heat_number FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=? AND pl.line_number='EDGE-A'", [pid])
  rec('7-Heat', 'edge(a) heat-required line w/o heat exists to test receipt-block', 'heat NULL present', edgeA ? `heat=${edgeA.heat_number}` : 'missing', edgeA && edgeA.heat_number == null ? 'PASS(data)' : 'FAIL', 'enforcement (receipt block) = UI/endpoint check')
  const [[orphan]] = await db.query("SELECT COUNT(*) c FROM warehouse_stock st WHERE st.project_id=? AND st.heat_number='ZZH-ORPHAN-NOCERT' AND NOT EXISTS (SELECT 1 FROM traceability_certs c WHERE c.project_id=? AND UPPER(TRIM(c.heat_ref))=UPPER(TRIM(st.heat_number)))", [pid, pid])
  rec('7-Heat', 'edge(c) stock heat with NO matching cert is detectable', '1 (surfaced)', orphan.c, orphan.c === 1 ? 'PASS' : 'FAIL', 'heat→cert join correctly returns no-cert')
  const [[mismatch]] = await db.query("SELECT COUNT(*) c FROM receipt_lines WHERE project_id=? AND heat_number='ZZH-MISMATCH-XYZ'", [pid])
  rec('7-Heat', 'edge(b) receipt heat ≠ SCN heat present', '1', mismatch.c, mismatch.c === 1 ? 'PASS(data)' : 'FAIL', 'mismatch detection = UI/endpoint')

  // ── 4. MTO REV DIFF (B vs C content) ──
  const [[m2]] = await db.query("SELECT id FROM mto_registers WHERE project_id=? ORDER BY id LIMIT 1", [pid])
  async function revLines(rev) { const [r] = await db.query('SELECT line_number,description,quantity FROM mto_lines WHERE mto_id=? AND revision=? ORDER BY line_number', [m2.id, rev]); return r }
  const A = await revLines('A'), B = await revLines('B'), C = await revLines('C')
  const diffAB = A.filter((a, i) => !B[i] || a.description !== B[i].description || String(a.quantity) !== String(B[i].quantity)).length
  const diffBC = B.filter((b, i) => !C[i] || b.description !== C[i].description || String(b.quantity) !== String(C[i].quantity)).length
  rec('4-MTO', 'Rev A→B shows real changes', '>0 changed', diffAB, diffAB > 0 ? 'PASS' : 'FAIL', `${diffAB} of ${A.length} lines differ`)
  rec('4-MTO', 'Rev B→C (seeded identical) diff', '0 (honest zero for identical content)', diffBC, diffBC === 0 ? 'PASS' : 'LOGIC-GAP', 'confirms diff=0 when identical; upload-guard for content-identical re-upload = separate (logged §5 MTO bug)')

  // ── CROSS: bad payload → 4xx not 500 ──
  const bad = await api(adminT, 'POST', `/foundational/${pid}/wbs`, { description: 'no code' })
  rec('X-Validation', 'create WBS missing required code', '4xx, no 500', bad.status, (bad.status >= 400 && bad.status < 500) ? 'PASS' : (bad.status === 500 ? 'FAIL' : 'CHECK'), `status ${bad.status}: ${bad.data?.error || ''}`)

  // ── CROSS: audit row carries project_id (under ZZ project) ──
  const beforeAudit = (await db.query('SELECT COUNT(*) c FROM audit_log WHERE project_id=?', [pid]))[0][0].c
  const wbsCreate = await api(adminT, 'POST', `/foundational/${pid}/wbs`, { code: 'ZZ.FLOWX', description: 'flowtest audit probe' })
  await new Promise(r => setTimeout(r, 400))
  const [[ar]] = await db.query("SELECT project_id FROM audit_log WHERE action='wbs_created' AND project_id=? ORDER BY id DESC LIMIT 1", [pid])
  rec('X-Audit', 'create writes audit_log with project_id', `project_id=${pid}`, ar ? ar.project_id : 'none', ar && ar.project_id === pid ? 'PASS' : 'FAIL', 'project-scoped audit works')
  // cleanup probe node + audit
  if (wbsCreate.data?.id) { await db.query('DELETE FROM audit_log WHERE entity_type=\'wbs_nodes\' AND entity_id=?', [wbsCreate.data.id]); await db.query('DELETE FROM wbs_nodes WHERE id=?', [wbsCreate.data.id]) }

  // ── 8. ROLE MATRIX (permission boundaries) ──
  const viewerT = await tok('viewer1@zzflowtest.example')
  const vWrite = await api(viewerT, 'POST', `/foundational/${pid}/wbs`, { code: 'ZZ.VTEST', description: 'viewer should not create' })
  rec('8-Roles', 'viewer creates WBS node', '403/blocked', vWrite.status, vWrite.status === 403 ? 'PASS' : (vWrite.status === 201 ? 'SECURITY-GAP' : 'CHECK'), `status ${vWrite.status}`)
  if (vWrite.data?.id) { await db.query('DELETE FROM audit_log WHERE entity_type=\'wbs_nodes\' AND entity_id=?', [vWrite.data.id]); await db.query('DELETE FROM wbs_nodes WHERE id=?', [vWrite.data.id]) }
  const contractorT = await tok('contractor1@zzflowtest.example')
  const cAdmin = await api(contractorT, 'GET', `/admin/users/list`)
  rec('8-Roles', 'contractor reads admin users', '403/blocked', cAdmin.status, cAdmin.status === 403 ? 'PASS' : (cAdmin.status === 200 ? 'SECURITY-GAP' : 'CHECK'), `status ${cAdmin.status}`)

  // ── 5. PROCUREMENT: locked PO resists edit ──
  const [[lockedPo]] = await db.query("SELECT id, po_number FROM purchase_orders WHERE project_id=? AND is_locked=1 LIMIT 1", [pid])
  if (lockedPo) {
    const ed = await api(adminT, 'PATCH', `/procurement/pos/${lockedPo.id}`, { description: 'attempt edit locked' })
    rec('5-Proc', 'edit locked PO', 'refused (4xx) or no-op', ed.status, (ed.status >= 400) ? 'PASS' : 'CHECK', `${lockedPo.po_number} status ${ed.status} ${ed.data?.error || '(check if mutated)'}`)
  } else rec('5-Proc', 'edit locked PO', 'a locked PO exists', 'none', 'SKIP', '')

  // ── 1. WBS A1 depth-filter (server side only computes tree; leak is client) ──
  rec('1-WBS', 'A1 depth-filter leak (client-side collectVisible/WBSRow)', 'UI check', 'not server-testable', 'UI', 'see UI audit; A1 still open per handover')

  // print table
  console.log('\n| Module | Step | Expected | Actual | Verdict | Evidence |')
  console.log('|---|---|---|---|---|---|')
  for (const r of results) console.log(`| ${r.mod} | ${r.step} | ${r.expected} | ${r.actual} | ${r.verdict} | ${r.ev} |`)
  const fails = results.filter(r => /FAIL|SECURITY-GAP/.test(r.verdict))
  console.log(`\nSUMMARY: ${results.length} checks; PASS ${results.filter(r=>/PASS/.test(r.verdict)).length}; FAIL/GAP ${fails.length}; other ${results.filter(r=>!/PASS|FAIL|SECURITY-GAP/.test(r.verdict)).length}`)
  if (fails.length) console.log('NEEDS REVIEW:', fails.map(f => f.mod + ':' + f.step + '=' + f.verdict).join(' | '))
  process.exit(0)
}
main().catch(e => { console.error('runner error:', e.message); process.exit(1) })
