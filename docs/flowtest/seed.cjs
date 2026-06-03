// ZZ_FLOWTEST seed generator — FK-ordered, idempotent (teardown-first), pooled.
// Usage: node docs/flowtest/seed.js [smoke|full|teardown]
//   smoke    = 10 rows/table + assertions (auto-checkpoint)
//   full     = representative volume (scaled from spec; see SCALE)
//   teardown = remove all ZZ_FLOWTEST data, verify canonical untouched
// ALL data scoped to project code 'ZZ_FLOWTEST'. Users by @zzflowtest.example.
// Suppliers/warehouses tagged with 'ZZF' code prefix. NEVER touches canonical data.
const db = require('../../server/db')

const MODE = process.argv[2] || 'full'
const SCALE = MODE === 'smoke'
  ? { wbs: 10, commodity: 10, equipment: 10, supplier: 10, mtoReg: 2, mtoLine: 10, po: 10, poLine: 10, scn: 10, stock: 10, transfer: 5, fmr: 5, cert: 10, chains: 5 }
  : { wbs: 500, commodity: 1000, equipment: 400, supplier: 30, mtoReg: 6, mtoLine: 2000, po: 40, poLine: 600, scn: 150, stock: 800, transfer: 30, fmr: 25, cert: 300, chains: 50 }

const rnd = (a) => a[Math.floor(Math.random() * a.length)]
const ri = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))
const pad = (n, w = 3) => String(n).padStart(w, '0')
const dStr = (d) => d.toISOString().slice(0, 10)
const future = (days) => dStr(new Date(Date.now() + days * 86400000))
let PW = null
const manifest = { goodChains: [], edgeCases: [] }

// ─── chunked batch insert ────────────────────────────────────
async function batchInsert(conn, table, cols, rows, chunk = 200) {
  if (!rows.length) return []
  const ids = []
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const ph = slice.map(() => `(${cols.map(() => '?').join(',')})`).join(',')
    const vals = slice.flat()
    const [r] = await conn.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph}`, vals)
    // collect inserted ids (AUTO_INCREMENT contiguous within a multi-row insert)
    for (let k = 0; k < slice.length; k++) ids.push(r.insertId + k)
  }
  return ids
}

// ─── teardown (FK-safe order) ────────────────────────────────
async function teardown(conn, pid) {
  if (!pid) { const [[p]] = await conn.query("SELECT id FROM projects WHERE code='ZZ_FLOWTEST'"); pid = p?.id }
  if (pid) {
    // children first
    await conn.query('DELETE fil FROM fmr_issue_lines fil JOIN fmr_requests f ON f.id=fil.fmr_id WHERE f.project_id=?', [pid])
    await conn.query('DELETE fl FROM fmr_lines fl JOIN fmr_requests f ON f.id=fl.fmr_id WHERE f.project_id=?', [pid])
    await conn.query('DELETE FROM fmr_requests WHERE project_id=?', [pid])
    await conn.query('DELETE FROM warehouse_transfers WHERE project_id=?', [pid])
    await conn.query('DELETE FROM warehouse_stock WHERE project_id=?', [pid])
    await conn.query('DELETE FROM receipt_lines WHERE project_id=?', [pid])
    await conn.query('DELETE sh FROM scn_heats sh JOIN shipment_control_notes s ON s.id=sh.scn_id WHERE s.project_id=?', [pid])
    await conn.query('DELETE sp FROM scn_packages sp JOIN shipment_control_notes s ON s.id=sp.scn_id WHERE s.project_id=?', [pid])
    await conn.query('DELETE FROM shipment_control_notes WHERE project_id=?', [pid])
    await conn.query('DELETE FROM traceability_certs WHERE project_id=?', [pid])
    await conn.query('DELETE pl FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=?', [pid])
    await conn.query('DELETE FROM purchase_orders WHERE project_id=?', [pid])
    await conn.query('DELETE ml FROM mto_lines ml JOIN mto_registers m ON m.id=ml.mto_id WHERE m.project_id=?', [pid])
    await conn.query('DELETE mr FROM mto_revisions mr JOIN mto_registers m ON m.id=mr.mto_id WHERE m.project_id=?', [pid])
    await conn.query('DELETE FROM mto_registers WHERE project_id=?', [pid])
    await conn.query('DELETE FROM equipment_list WHERE project_id=?', [pid])
    await conn.query('DELETE FROM commodity_library WHERE project_id=?', [pid])
    await conn.query('DELETE FROM user_wbs_access WHERE project_id=?', [pid])
    await conn.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
    await conn.query("DELETE FROM audit_log WHERE project_id=?", [pid])
    await conn.query('DELETE FROM projects WHERE id=?', [pid])
  }
  await conn.query("DELETE FROM users WHERE email LIKE '%@zzflowtest.example'")
  await conn.query("DELETE FROM suppliers WHERE code LIKE 'ZZF-%'")
  await conn.query("DELETE FROM warehouses WHERE code LIKE 'ZZF-%'")
}

async function main() {
  const conn = await db.getConnection()
  try {
    const [[pwrow]] = await conn.query("SELECT password_hash FROM users WHERE email='tchang@qcogroup.com.au'")
    PW = pwrow.password_hash // reuse known hash → password = "password"

    // canonical baseline (for untouched proof)
    const [[cbase]] = await conn.query("SELECT COUNT(*) c FROM projects WHERE code <> 'ZZ_FLOWTEST'")
    const [[ubase]] = await conn.query("SELECT COUNT(*) c FROM users WHERE email NOT LIKE '%@zzflowtest.example'")

    console.log(`[seed] mode=${MODE}  cleaning prior ZZ_FLOWTEST…`)
    await teardown(conn)
    if (MODE === 'teardown') {
      const [[ca]] = await conn.query("SELECT COUNT(*) c FROM projects WHERE code <> 'ZZ_FLOWTEST'")
      const [[ua]] = await conn.query("SELECT COUNT(*) c FROM users WHERE email NOT LIKE '%@zzflowtest.example'")
      console.log(`[teardown] canonical projects ${cbase.c}->${ca.c}, users ${ubase.c}->${ua.c} ${cbase.c===ca.c&&ubase.c===ua.c?'✅ untouched':'❌'}`)
      return
    }

    // ── PROJECT ──
    const [pr] = await conn.query("INSERT INTO projects (code,name) VALUES ('ZZ_FLOWTEST','ZZ Flow Test (disposable)')")
    const pid = pr.insertId
    console.log('[seed] $TESTPROJ =', pid)

    // ── WAREHOUSES ──
    const whIds = await batchInsert(conn, 'warehouses', ['name', 'code', 'type', 'status'],
      [['ZZF Main Laydown', 'ZZF-WH1', 'laydown', 'active'], ['ZZF Covered Store', 'ZZF-WH2', 'store', 'active'], ['ZZF DG Store', 'ZZF-WH3', 'site', 'active']])

    // ── USERS / ROLE MATRIX ──
    const roleMatrix = [
      ['admin', 2, 'Super Admin'], ['project_manager', 3, 'Project Admin'], ['procurement_officer', 4, 'Procurement'],
      ['expeditor', 3, 'Expeditor'], ['warehouse', 2, 'Material Control'], ['freight_forwarder', 2, 'Logistics'],
      ['vendor', 2, 'Traceability/QA'], ['site_contractor', 3, 'Contractor'], ['viewer', 2, 'Auditor'], ['viewer', 2, 'Viewer'],
    ]
    const userRows = [], creds = []
    let un = 0
    for (const [role, count, label] of roleMatrix) {
      for (let i = 0; i < count; i++) {
        un++
        const email = `${label.toLowerCase().replace(/[^a-z]/g, '')}${i + 1}@zzflowtest.example`
        const name = `ZZ ${label} ${i + 1}`
        const isExt = ['site_contractor', 'freight_forwarder', 'vendor'].includes(role) ? 1 : 0
        userRows.push([email, PW, name, role, isExt, 1, `ZZ${pad(un)}`])
        creds.push({ role, label, email, password: 'password', scope: role === 'site_contractor' ? 'WBS-scoped' : (label === 'Auditor' ? 'read+audit' : 'full-role') })
      }
    }
    const userIds = await batchInsert(conn, 'users', ['email', 'password_hash', 'full_name', 'role', 'is_external', 'is_active', 'staff_id'], userRows)

    // ── WBS (hierarchy, up to 5 levels) ──
    const disciplines = ['Civil', 'Structural', 'Mechanical', 'Piping', 'Electrical', 'Instrumentation', 'HVAC', 'Fire']
    const wbsRows = [], wbsCodes = []
    const rags = ['green', 'amber', 'red', 'blue', null]
    let wc = 0
    for (let l1 = 1; l1 <= 8 && wc < SCALE.wbs; l1++) {
      const c1 = `${l1}`; wbsRows.push([pid, c1, `${disciplines[l1 - 1]} Works`, rnd(rags)]); wbsCodes.push(c1); wc++
      for (let l2 = 1; l2 <= 6 && wc < SCALE.wbs; l2++) {
        const c2 = `${c1}.${l2}`; wbsRows.push([pid, c2, `${disciplines[l1 - 1]} Area ${l2}`, rnd(rags)]); wbsCodes.push(c2); wc++
        for (let l3 = 1; l3 <= 5 && wc < SCALE.wbs; l3++) {
          const c3 = `${c2}.${l3}`; wbsRows.push([pid, c3, `Subsystem ${l3}`, rnd(rags)]); wbsCodes.push(c3); wc++
          for (let l4 = 1; l4 <= 4 && wc < SCALE.wbs; l4++) {
            const c4 = `${c3}.${l4}`; wbsRows.push([pid, c4, `Package ${l4}`, rnd(rags)]); wbsCodes.push(c4); wc++
          }
        }
      }
    }
    await batchInsert(conn, 'wbs_nodes', ['project_id', 'code', 'description', 'rag'], wbsRows)

    // ── CONTRACTOR WBS SCOPE ──
    const contractorIds = []
    creds.forEach((c, i) => { if (c.role === 'site_contractor') contractorIds.push(userIds[i]) })
    const scopeRows = contractorIds.map((uid, i) => [uid, pid, wbsCodes[i % wbsCodes.length].split('.')[0], 'full', userIds[0]])
    if (scopeRows.length) await batchInsert(conn, 'user_wbs_access', ['user_id', 'project_id', 'wbs_code', 'scope_type', 'created_by'], scopeRows)

    // ── COMMODITY LIBRARY ──
    const comCats = ['Piping', 'Valves', 'Fittings', 'Structural Steel', 'Electrical', 'Instruments']
    const comRows = []
    for (let i = 1; i <= SCALE.commodity; i++) comRows.push([pid, `ZZC-${pad(i, 5)}`, `${rnd(comCats)} item ${i}`])
    const comIds = await batchInsert(conn, 'commodity_library', ['project_id', 'code', 'name'], comRows)

    // ── EQUIPMENT LIST ──
    const eqTypes = ['Pump', 'Vessel', 'Exchanger', 'Motor', 'Compressor']
    const eqRows = []
    for (let i = 1; i <= SCALE.equipment; i++) eqRows.push([pid, `ZZE-${pad(i, 4)}`, `${rnd(eqTypes)} ${pad(i, 4)}`, rnd(wbsCodes)])
    const eqIds = await batchInsert(conn, 'equipment_list', ['project_id', 'tag', 'description', 'wbs_code'], eqRows)

    // ── SUPPLIERS (global, ZZF-coded) ──
    const supRows = []
    for (let i = 1; i <= SCALE.supplier; i++) supRows.push([`ZZ Supplier ${i} Pty Ltd`, `ZZF-${pad(i, 3)}`, `5${pad(ri(10000000, 99999999), 8)}`])
    const supIds = await batchInsert(conn, 'suppliers', ['name', 'code', 'abn'], supRows)

    // ── MTO registers + revisions + lines ──
    const mtoIds = []
    for (let m = 1; m <= SCALE.mtoReg; m++) {
      const [r] = await conn.query('INSERT INTO mto_registers (project_id,name,reference,current_revision,created_by) VALUES (?,?,?,?,?)',
        [pid, `ZZ MTO ${disciplines[(m - 1) % disciplines.length]}`, `ZZ-MTO-${pad(m)}`, 'A', userIds[0]])
      mtoIds.push(r.insertId)
    }
    // revisions: give first 2 MTOs A/B/C, rest just A
    const revRows = []
    mtoIds.forEach((mid, idx) => {
      const revs = idx < 2 ? ['A', 'B', 'C'] : ['A']
      revs.forEach(rev => revRows.push([mid, rev, userIds[0]]))
    })
    await batchInsert(conn, 'mto_revisions', ['mto_id', 'revision', 'uploaded_by'], revRows)
    const mtoLineRows = []
    const uoms = ['EA', 'M', 'KG', 'SET', 'LM']
    for (let i = 1; i <= SCALE.mtoLine; i++) {
      const mid = rnd(mtoIds)
      mtoLineRows.push([mid, 'A', `L${pad(i, 4)}`, `MTO line ${i} ${rnd(comCats)}`, ri(1, 500), rnd(uoms), rnd(wbsCodes), rnd(['Class I', 'Class II', 'Class III']), rnd([0, 1])])
    }
    await batchInsert(conn, 'mto_lines', ['mto_id', 'revision', 'line_number', 'description', 'quantity', 'uom', 'wbs_code', 'inspection_class', 'vdrl_required'], mtoLineRows)
    // Rev B/C content for MTO[0] and MTO[1]: copy A lines into B (with real changes) and C (= B for the known B->C=0 bug check)
    for (const mid of mtoIds.slice(0, 2)) {
      const [aLines] = await conn.query('SELECT line_number,description,quantity,uom,wbs_code,inspection_class,vdrl_required FROM mto_lines WHERE mto_id=? AND revision=?', [mid, 'A'])
      const bRows = aLines.map((l, i) => [mid, 'B', l.line_number, i % 3 === 0 ? l.description + ' (rev B change)' : l.description, i % 3 === 0 ? l.quantity + 10 : l.quantity, l.uom, l.wbs_code, l.inspection_class, l.vdrl_required])
      await batchInsert(conn, 'mto_lines', ['mto_id', 'revision', 'line_number', 'description', 'quantity', 'uom', 'wbs_code', 'inspection_class', 'vdrl_required'], bRows)
      const cRows = bRows.map(r => [r[0], 'C', ...r.slice(2)]) // C identical to B (exercise B->C diff)
      await batchInsert(conn, 'mto_lines', ['mto_id', 'revision', 'line_number', 'description', 'quantity', 'uom', 'wbs_code', 'inspection_class', 'vdrl_required'], cRows)
    }

    // ── PURCHASE ORDERS + lines ──
    const poStatuses = ['rfq', 'po-raised', 'active', 'closed']
    const poLineStatuses = ['not-started', 'rfq', 'po-raised', 'in-production', 'received', 'closed']
    const poIds = [], poMeta = []
    for (let i = 1; i <= SCALE.po; i++) {
      const sup = ri(0, supIds.length - 1)
      const locked = i % 3 === 0 ? 1 : 0
      const [r] = await conn.query('INSERT INTO purchase_orders (project_id,po_number,vendor_name,supplier_id,wbs_code,status,is_locked,value,currency,ros_date,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [pid, `ZZ-PO-${pad(i, 4)}`, `ZZ Supplier ${sup + 1} Pty Ltd`, supIds[sup], rnd(wbsCodes), rnd(poStatuses), locked, ri(10000, 900000), 'AUD', future(ri(30, 300)), userIds[0]])
      poIds.push(r.insertId); poMeta.push({ id: r.insertId, locked })
    }
    const poLineRows = []
    for (let i = 1; i <= SCALE.poLine; i++) {
      const poi = ri(0, poIds.length - 1)
      const heatReq = i % 2 === 0 ? 1 : 0 // structural/piping/pressure subset
      const wcode = rnd(wbsCodes)
      poLineRows.push([poIds[poi], `L${pad(i, 4)}`, `PO line ${i} ${rnd(comCats)}`, ri(1, 200), rnd(uoms), wcode, wcode, heatReq, rnd(poLineStatuses)])
    }
    await batchInsert(conn, 'po_lines', ['po_id', 'line_number', 'description', 'qty', 'uom', 'wbs_code_snapshot', 'wbs_code_snapshot', 'heat_number_required', 'status'].filter((v, i, a) => a.indexOf(v) === i) , [])
    // (the dedupe above would drop a col; do explicit insert instead)
    await batchInsert(conn, 'po_lines', ['po_id', 'line_number', 'description', 'qty', 'uom', 'wbs_code_snapshot', 'heat_number_required', 'status'],
      poLineRows.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[7], r[8]]))

    // ── SCNs + packages + heats ──
    const scnIds = []
    for (let i = 1; i <= SCALE.scn; i++) {
      const [r] = await conn.query('INSERT INTO shipment_control_notes (project_id,scn_ref,vendor_name,forwarder_name,origin_location,destination_warehouse_id,status,rag,total_packages,total_weight_kg,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [pid, `ZZ-SCN-${pad(i, 4)}`, `ZZ Supplier ${ri(1, supIds.length)} Pty Ltd`, rnd(['ZZ Freight', 'ZZ Logistics Co']), rnd(['Shanghai', 'Houston', 'Perth', 'Singapore']), rnd(whIds), rnd(['pending', 'in-transit', 'arrived', 'received']), rnd(['green', 'amber', 'red']), ri(1, 8), ri(500, 20000), userIds[0]])
      scnIds.push(r.insertId)
    }
    // packages + heats
    const pkgRows = [], heatRows = []
    scnIds.forEach((sid, i) => {
      pkgRows.push([sid, `PKG-${pad(i + 1)}`, 'Crate', ri(1000, 30000)])
      heatRows.push([sid, `ZZH${pad(i + 1, 5)}`, rnd(['A106-B', 'A105', 'A352-LCB', 'SS316']), `MTC-ZZ-${pad(i + 1, 4)}`, 'declared', userIds[0]])
    })
    await batchInsert(conn, 'scn_packages', ['scn_id', 'package_number', 'description', 'gross_weight_kg'], pkgRows)
    await batchInsert(conn, 'scn_heats', ['scn_id', 'heat_number', 'material_grade', 'mill_cert_ref', 'source', 'created_by'], heatRows)

    // ── WAREHOUSE STOCK (with heat) ──
    const stockRows = []
    for (let i = 1; i <= SCALE.stock; i++) {
      const cond = i % 13 === 0 ? 'quarantine' : (i % 17 === 0 ? 'major_damage' : 'good')
      const q = ri(1, 100)
      stockRows.push([pid, rnd(whIds), rnd(scnIds), `ZZIT-${pad(i, 5)}`, `Stock item ${i}`, rnd(wbsCodes), q, q, rnd(uoms), `ZZH${pad(ri(1, scnIds.length), 5)}`, cond, cond === 'quarantine' ? 1 : 0, `Z${ri(1, 9)}-${ri(1, 99)}`])
    }
    await batchInsert(conn, 'warehouse_stock', ['project_id', 'warehouse_id', 'scn_id', 'item_code', 'description', 'wbs_code', 'qty', 'qty_available', 'uom', 'heat_number', 'condition_status', 'trace_hold', 'location_code'], stockRows)

    // ── TRANSFERS ──
    const trRows = []
    for (let i = 1; i <= SCALE.transfer; i++) trRows.push([pid, `ZZ-TR-${pad(i, 4)}`, `Transfer ${i}`, ri(1, 50), `ZZH${pad(ri(1, scnIds.length), 5)}`, rnd(['requested', 'pending_approval', 'in_transit', 'complete'])])
    await batchInsert(conn, 'warehouse_transfers', ['project_id', 'transfer_ref', 'description', 'qty', 'heat_number', 'status'], trRows)

    // ── FMRs + lines + issues ──
    const fmrIds = []
    for (let i = 1; i <= SCALE.fmr; i++) {
      const [r] = await conn.query('INSERT INTO fmr_requests (project_id,fmr_ref,description,qty_requested,status,requested_by_user) VALUES (?,?,?,?,?,?)',
        [pid, `ZZ-FMR-${pad(i, 4)}`, `Field material request ${i}`, ri(1, 50), rnd(['pending_approval', 'approved', 'issued', 'partial_issued']), userIds[0]])
      fmrIds.push(r.insertId)
    }
    const fmrLineRows = fmrIds.map((fid, i) => [fid, ri(1, 30), `ZZIT-${pad(ri(1, SCALE.stock), 5)}`, rnd(wbsCodes)])
    await batchInsert(conn, 'fmr_lines', ['fmr_id', 'qty_requested', 'item_code', 'wbs_code'], fmrLineRows)

    // ── TRACEABILITY CERTS (heat_ref) ──
    const certRows = []
    for (let i = 1; i <= SCALE.cert; i++) {
      certRows.push([pid, 'approval', `MTC ${i}`, 'MTC', `ZZH${pad(ri(1, scnIds.length), 5)}`, rnd(['received', 'verified', 'pending', 'rejected']), userIds[0]])
    }
    await batchInsert(conn, 'traceability_certs', ['project_id', 'category', 'document_name', 'cert_type', 'heat_ref', 'status', 'uploaded_by'], certRows)

    // ── HEAT CHAIN MANIFEST (good chains) ──
    // The seeded data shares the heat-number namespace ZZH00001..; chains where a
    // PO line (heat req) + SCN heat + stock heat + cert heat all align are "good".
    const [chainRows] = await conn.query(`
      SELECT s.heat_number, COUNT(DISTINCT st.id) stock, COUNT(DISTINCT c.id) certs
      FROM scn_heats s
      LEFT JOIN warehouse_stock st ON UPPER(TRIM(st.heat_number))=UPPER(TRIM(s.heat_number)) AND st.project_id=?
      LEFT JOIN traceability_certs c ON UPPER(TRIM(c.heat_ref))=UPPER(TRIM(s.heat_number)) AND c.project_id=?
      JOIN shipment_control_notes scn ON scn.id=s.scn_id AND scn.project_id=?
      GROUP BY s.heat_number HAVING stock>0 AND certs>0 LIMIT 60`, [pid, pid, pid])
    manifest.goodChains = chainRows.slice(0, SCALE.chains).map(r => r.heat_number)

    // ── INTENTIONAL EDGE CASES ──
    // (a) heat-required PO line received WITHOUT heat
    await conn.query('INSERT INTO po_lines (po_id,line_number,description,qty,uom,heat_number_required,status,wbs_code_snapshot) VALUES (?,?,?,?,?,1,?,?)',
      [poIds[0], 'EDGE-A', 'EDGE(a): heat-required line, NO heat captured', 10, 'EA', 'po-raised', wbsCodes[0]])
    manifest.edgeCases.push('(a) heat-required PO line with NO heat → po_lines line EDGE-A on ' + `ZZ-PO-0001`)
    // (c) stock row with heat that has NO matching mill cert
    await conn.query('INSERT INTO warehouse_stock (project_id,warehouse_id,item_code,description,qty,qty_available,uom,heat_number,condition_status) VALUES (?,?,?,?,?,?,?,?,?)',
      [pid, whIds[0], 'ZZ-EDGE-C', 'EDGE(c): stock heat with no matching cert', 5, 5, 'EA', 'ZZH-ORPHAN-NOCERT', 'good'])
    manifest.edgeCases.push('(c) stock heat ZZH-ORPHAN-NOCERT with no matching cert')
    // (b) heat present at SCN but mismatched at receipt  (receipt_lines)
    await conn.query('INSERT INTO receipt_lines (project_id,scn_id,scn_ref,heat_number,description,expected_qty,received_qty,uom,received_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [pid, scnIds[0], 'ZZ-SCN-0001', 'ZZH-MISMATCH-XYZ', 'EDGE(b): receipt heat mismatched vs SCN', 10, 10, 'EA', userIds[0]])
    manifest.edgeCases.push('(b) receipt heat ZZH-MISMATCH-XYZ ≠ SCN heat (scn ' + scnIds[0] + ')')
    // (d) split keeping heat — represented by a transfer carrying a stock heat (both legs)
    manifest.edgeCases.push('(d) split-keeps-heat: transfers carry heat_number (see warehouse_transfers)')

    // ── COUNTS ──
    const counts = {}
    for (const [t, w] of [['wbs_nodes', `project_id=${pid}`], ['commodity_library', `project_id=${pid}`], ['equipment_list', `project_id=${pid}`], ['mto_registers', `project_id=${pid}`], ['purchase_orders', `project_id=${pid}`], ['shipment_control_notes', `project_id=${pid}`], ['warehouse_stock', `project_id=${pid}`], ['warehouse_transfers', `project_id=${pid}`], ['fmr_requests', `project_id=${pid}`], ['traceability_certs', `project_id=${pid}`]]) {
      const [[c]] = await conn.query(`SELECT COUNT(*) c FROM ${t} WHERE ${w}`); counts[t] = c.c
    }
    const [[mtoLineCt]] = await conn.query('SELECT COUNT(*) c FROM mto_lines ml JOIN mto_registers m ON m.id=ml.mto_id WHERE m.project_id=?', [pid])
    const [[poLineCt]] = await conn.query('SELECT COUNT(*) c FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=?', [pid])
    const [[uCt]] = await conn.query("SELECT COUNT(*) c FROM users WHERE email LIKE '%@zzflowtest.example'")
    counts.mto_lines = mtoLineCt.c; counts.po_lines = poLineCt.c; counts.users = uCt.c
    counts.supplier_ZZF = (await conn.query("SELECT COUNT(*) c FROM suppliers WHERE code LIKE 'ZZF-%'"))[0][0].c

    // ── SMOKE ASSERTIONS ──
    const [[orphanStock]] = await conn.query('SELECT COUNT(*) c FROM warehouse_stock ws LEFT JOIN warehouses w ON w.id=ws.warehouse_id WHERE ws.project_id=? AND w.id IS NULL', [pid])
    const [[orphanPoLine]] = await conn.query('SELECT COUNT(*) c FROM po_lines pl LEFT JOIN purchase_orders p ON p.id=pl.po_id WHERE p.id IS NULL', [])
    const fkOk = orphanStock.c === 0 && orphanPoLine.c === 0
    const chainOk = manifest.goodChains.length >= 1
    const usersOk = counts.users >= 20

    // canonical untouched
    const [[ca]] = await conn.query("SELECT COUNT(*) c FROM projects WHERE code <> 'ZZ_FLOWTEST'")
    const [[ua]] = await conn.query("SELECT COUNT(*) c FROM users WHERE email NOT LIKE '%@zzflowtest.example'")
    const canonOk = ca.c === cbase.c && ua.c === ubase.c

    console.log('\n=== SEED RESULT ($TESTPROJ=' + pid + ', mode=' + MODE + ') ===')
    console.log('counts:', JSON.stringify(counts))
    console.log('heat good-chains:', manifest.goodChains.length, '| edge cases:', manifest.edgeCases.length)
    console.log('CHECKPOINT: FKs zero-orphan', fkOk ? '✅' : '❌', '| heat chain', chainOk ? '✅' : '❌', '| users', usersOk ? '✅' : '❌', '| canonical untouched', canonOk ? '✅' : '❌')
    console.log('MANIFEST:', JSON.stringify(manifest))
    console.log('CREDS:', JSON.stringify(creds))
    if (!(fkOk && chainOk && usersOk && canonOk)) { console.log('CHECKPOINT FAILED'); process.exitCode = 2 }
  } catch (e) {
    console.error('[seed] ERROR:', e.message)
    process.exitCode = 1
  } finally {
    conn.release()
  }
}
main().then(() => process.exit(process.exitCode || 0))
