// ─── ZZ_FLOWTEST seed — CHAIN-FIRST, coherent, idempotent ─────────────────────
// Usage: node docs/flowtest/seed.cjs [smoke|full|teardown]
//   smoke    = ~10 rows/entity through the FULL chain + FK/monotonic assertions
//   full     = realistic large volume (thousands of coherent rows)
//   teardown = remove all ZZ data (audit rows need the SQL teardown under QCO_admin)
//
// COHERENCE IS THE POINT: data is generated unit-by-unit DOWN the lifecycle so every
// cross-module FK is real by construction — MTO line → PO line → milestones/VDRL →
// SCN (+heats) → receipt → warehouse_stock → FMR issue → cert, with monotonic dates
// and a status spread that makes the dashboard funnel actually FLOW. All data is scoped
// to project code 'ZZ_FLOWTEST'; users @zzflowtest.example; suppliers/warehouses ZZF-.
// NEVER touches canonical data (projects 1–4).
//
// PRIVILEGE NOTE: run the seed as QCO_admin. The app user (qmat_app) is least-privilege:
// it lacks INSERT on po_milestones/itp_items and DELETE on ~20 tables (fmr_issue_lines,
// scn_heats, receipt_lines, mto_*, traceability_*, vdrl_*, …), so it can neither fully
// seed nor tear down (verified via isolated smoke 2026-06-04). Sequence: run
// scripts/flowtest_teardown.sql as QCO_admin first (drops the audit append-only guards,
// wipes ZZ FK-safe, re-arms guards byte-identical), THEN run this seed as QCO_admin.
const db = require('../../server/db')

const MODE = process.argv[2] || 'full'
const S = MODE === 'smoke'
  ? { supplier: 5, wbsL1: 3, commodity: 12, equipment: 8, mtoReg: 2, mtoLine: 30, po: 8, scn: 6, fmr: 5, hold: 3, rfi: 6, transfer: 4 }
  : { supplier: 30, wbsL1: 8, commodity: 1000, equipment: 400, mtoReg: 6, mtoLine: 3000, po: 300, scn: 150, fmr: 50, hold: 30, rfi: 80, transfer: 30 }

// ─── helpers ──────────────────────────────────────────────────
const rnd = (a) => a[Math.floor(Math.random() * a.length)]
const ri = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))
const pad = (n, w = 4) => String(n).padStart(w, '0')
const TODAY = new Date()
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const iso = (d) => d.toISOString().slice(0, 10)
const chance = (p) => Math.random() < p
let PW = null

// PO-line lifecycle: nested supersets → the funnel is monotonic by construction.
const PROG = [ // status, cumulative weight (picks a "furthest reached" stage)
  ['not-started', 15], ['rfq', 12], ['po-raised', 13], ['in-production', 15],
  ['shipped', 10], ['received', 20], ['closed', 15],
]
const PROG_RANK = { 'not-started': 0, 'rfq': 1, 'po-raised': 2, 'in-production': 3, 'shipped': 4, 'received': 5, 'closed': 6 }
function pickStatus() {
  const tot = PROG.reduce((a, [, w]) => a + w, 0); let r = ri(1, tot)
  for (const [s, w] of PROG) { if ((r -= w) <= 0) return s } return 'received'
}

// ─── COHERENT LIFECYCLE TIMELINE (forward-chained; monotonic by construction) ──
// Dates are derived DOWN the chain — each stage = prior stage + a realistic lag —
// instead of generating each independently. The whole event chain is therefore
// strictly increasing:
//   raised ≤ PO-Issued ≤ Drawings ≤ Manufacture ≤ FAT ≤ Ship(cargo-ready) ≤
//   collected ≤ ETD ≤ ATD ≤ ETA ≤ ATA ≤ receipt ≤ FMR-issue.
// The whole chain is anchored relative to TODAY by the PO's furthest-reached rank,
// so a 'received' PO sits in the past and an 'rfq' one is barely under way — which
// makes the dashboard's status spread, overdue counts and ROS view all sensible.
//
// tl.ros is a DEADLINE, NOT a chain stage. Real-world meaning (confirmed against
// dashboard.js: a line is overdue when `ros_date < CURDATE() AND not received`):
// the material must be received BY ros, so on-time items have receipt ≤ ros and
// late ones have ros < receipt. tl.ros is used as the MTO line's demanded ROS, which
// the PO then INHERITS (see the caller): most PO lines equal it exactly; a logged
// minority is amended during the PO procedure. So this builder only fixes the
// physical/event chain + a sensible default deadline — the ROS inheritance vs
// tracked-amendment behaviour lives at the call site (with date_change_log rows).
const clampPast = (d) => (d > TODAY ? new Date(TODAY) : d)
function buildTimeline(rank) {
  const lag = { draw: ri(15, 45), mfg: ri(40, 120), fat: ri(10, 30), cargo: ri(5, 20),
                coll: ri(1, 6), etd: ri(0, 4), atd: ri(0, 3), trans: ri(14, 50),
                ata: ri(0, 6), rec: ri(2, 9), iss: ri(3, 25) }
  const off = { poIssued: 0 }
  off.draw  = off.poIssued + lag.draw
  off.mfg   = off.draw + lag.mfg
  off.fat   = off.mfg + lag.fat
  off.cargo = off.fat + lag.cargo            // "Ship" milestone ≈ cargo-ready
  off.coll  = off.cargo + lag.coll
  off.etd   = off.coll + lag.etd
  off.atd   = off.etd + lag.atd
  off.eta   = off.atd + lag.trans
  off.ata   = off.eta + lag.ata
  off.rec   = off.ata + lag.rec
  off.iss   = off.rec + lag.iss
  off.onsite = off.iss + ri(1, 10)
  // Place TODAY at the stage this PO has reached, so status ↔ dates are consistent.
  const todayOff = {
    0: -ri(2, 25),                                // not-started: anchor in the near future
    1: ri(0, 15),                                 // rfq: just raised
    2: ri(Math.floor(off.draw * 0.2), Math.floor(off.draw * 0.7)), // po-raised: into drawings
    3: ri(off.draw, off.mfg),                     // in-production
    4: ri(off.etd, Math.max(off.etd, off.eta)),   // shipped: in transit
    5: off.rec + ri(2, 40),                       // received: recently
    6: off.rec + ri(45, 200),                     // closed: a while ago
  }[rank] ?? 0
  const raised = addDays(TODAY, -todayOff)
  const D = (k) => addDays(raised, off[k])
  const late = chance(0.28)                       // deliberate exceptions for the Attention band
  const ros = late ? addDays(D('rec'), -ri(5, 45)) : addDays(D('rec'), ri(10, 45))
  return {
    raised, late, ros,
    ms: { poIssued: D('poIssued'), draw: D('draw'), mfg: D('mfg'), fat: D('fat'), ship: D('cargo'), onsite: D('onsite') },
    cargoReady: D('cargo'), collected: D('coll'), etd: D('etd'), atd: D('atd'), eta: D('eta'), ata: D('ata'),
    receipt: D('rec'), issue: D('iss'),
  }
}

// ─── chunked batch insert (returns contiguous AUTO_INCREMENT ids) ─────────────
async function batchInsert(conn, table, cols, rows, chunk = 200) {
  if (!rows.length) return []
  const ids = []
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const ph = slice.map(() => `(${cols.map(() => '?').join(',')})`).join(',')
    const [r] = await conn.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph}`, slice.flat())
    for (let k = 0; k < slice.length; k++) ids.push(r.insertId + k)
  }
  return ids
}

// ─── teardown (FK-safe; audit rows need QCO_admin SQL teardown) ───────────────
async function teardown(conn, pid) {
  if (!pid) { const [[p]] = await conn.query("SELECT id FROM projects WHERE code='ZZ_FLOWTEST'"); pid = p?.id }
  if (pid) {
    const j = {
      'fmr_issue_lines': 'fmr_id IN (SELECT id FROM fmr_requests WHERE project_id=?)',
      'fmr_lines': 'fmr_id IN (SELECT id FROM fmr_requests WHERE project_id=?)',
    }
    await conn.query(`DELETE FROM fmr_issue_lines WHERE ${j.fmr_issue_lines}`, [pid])
    await conn.query(`DELETE FROM fmr_lines WHERE ${j.fmr_lines}`, [pid])   // clears fmr_lines.package_id refs before fmr_packages
    await conn.query('DELETE FROM fmr_packages WHERE fmr_id IN (SELECT id FROM fmr_requests WHERE project_id=?)', [pid])
    await conn.query('DELETE FROM fmr_pickups WHERE fmr_id IN (SELECT id FROM fmr_requests WHERE project_id=?)', [pid]) // PoC records FK fmr_requests
    for (const t of ['fmr_requests', 'warehouse_transfers', 'warehouse_stock', 'receipt_lines']) await conn.query(`DELETE FROM ${t} WHERE project_id=?`, [pid])
    await conn.query('DELETE e FROM expediting_child_items e JOIN po_lines pl ON pl.id=e.po_line_id JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=?', [pid])
    await conn.query('DELETE ii FROM itp_items ii JOIN itp_requirements ir ON ir.id=ii.requirement_id JOIN purchase_orders p ON p.id=ir.po_id WHERE p.project_id=?', [pid])
    await conn.query('DELETE ir FROM itp_requirements ir JOIN purchase_orders p ON p.id=ir.po_id WHERE p.project_id=?', [pid])
    await conn.query('DELETE d FROM vdrl_documents d JOIN vdrl_packages vp ON vp.id=d.package_id WHERE vp.project_id=?', [pid])
    await conn.query('DELETE FROM vdrl_packages WHERE project_id=?', [pid])
    for (const t of ['scn_additional_items', 'scn_documents', 'scn_status_log', 'scn_heats', 'scn_packages']) await conn.query(`DELETE x FROM ${t} x JOIN shipment_control_notes s ON s.id=x.scn_id WHERE s.project_id=?`, [pid])
    await conn.query('DELETE FROM shipment_control_notes WHERE project_id=?', [pid])
    for (const t of ['po_action_notes', 'po_variations', 'po_documents', 'po_approvals', 'po_milestones']) await conn.query(`DELETE x FROM ${t} x JOIN purchase_orders p ON p.id=x.po_id WHERE p.project_id=?`, [pid])
    await conn.query('DELETE v FROM traceability_cert_versions v JOIN traceability_certs c ON c.id=v.cert_id WHERE c.project_id=?', [pid])
    await conn.query('DELETE FROM traceability_holds WHERE project_id=?', [pid])
    await conn.query('DELETE FROM traceability_certs WHERE project_id=?', [pid])
    await conn.query('DELETE pl FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=?', [pid])
    await conn.query('DELETE FROM purchase_orders WHERE project_id=?', [pid])
    await conn.query('DELETE ml FROM mto_lines ml JOIN mto_registers m ON m.id=ml.mto_id WHERE m.project_id=?', [pid])
    await conn.query('DELETE mr FROM mto_revisions mr JOIN mto_registers m ON m.id=mr.mto_id WHERE m.project_id=?', [pid])
    await conn.query('DELETE FROM mto_registers WHERE project_id=?', [pid])
    await conn.query('DELETE a FROM meeting_attendees a JOIN rfi_meeting_records r ON r.id=a.record_id WHERE r.project_id=?', [pid])
    for (const t of ['meeting_actions', 'rfi_meeting_records', 'equipment_list', 'commodity_library', 'foundational_certificates', 'project_health_weights', 'pending_changes', 'user_wbs_access']) await conn.query(`DELETE FROM ${t} WHERE project_id=?`, [pid])
    // wbs_nodes has a self-referential parent_id FK — break the links before the bulk delete
    await conn.query('UPDATE wbs_nodes SET parent_id=NULL WHERE project_id=?', [pid])
    await conn.query('DELETE FROM wbs_nodes WHERE project_id=?', [pid])
    try {
      await conn.query('DELETE ar FROM audit_review ar JOIN audit_log a ON a.id=ar.audit_log_id WHERE a.project_id=?', [pid])
      await conn.query('DELETE FROM audit_log WHERE project_id=?', [pid])
      await conn.query('DELETE FROM warehouses WHERE project_id=?', [pid]) // warehouses → projects FK: clear before the project row
      await conn.query('DELETE FROM projects WHERE id=?', [pid])
    } catch (e) {
      throw new Error(`audit/project delete blocked (${e.code}) — run scripts/flowtest_teardown.sql as QCO_admin first, then re-run the seed`)
    }
  }
  // user-owned / cross-cutting rows that reference ZZ users (otherwise the users delete
  // trips an FK). These are app-deletable and not project-scoped, so they survive the
  // pid-block above. (audit_log/audit_review by ZZ user need the SQL teardown's guard-drop.)
  const ZZU = "(SELECT id FROM users WHERE email LIKE '%@zzflowtest.example')"
  for (const sql of [
    `DELETE FROM password_history WHERE user_id IN ${ZZU}`,
    `DELETE FROM notifications WHERE user_id IN ${ZZU}`,
    `DELETE FROM user_permission_overrides WHERE user_id IN ${ZZU} OR overridden_by IN ${ZZU}`,
    `DELETE FROM delegated_permissions WHERE granted_to IN ${ZZU} OR granted_by IN ${ZZU}`,
    `DELETE FROM date_change_log WHERE created_by IN ${ZZU}`,  // ROS amendment / forecast-slip log rows
  ]) await conn.query(sql).catch(() => {})
  await conn.query("DELETE FROM users WHERE email LIKE '%@zzflowtest.example'")
  await conn.query("DELETE sa FROM supplier_addresses sa JOIN suppliers s ON s.id=sa.supplier_id WHERE s.code LIKE 'ZZF-%'") // FK before suppliers
  await conn.query("DELETE FROM suppliers WHERE code LIKE 'ZZF-%'")
  await conn.query("DELETE FROM warehouses WHERE code LIKE 'ZZF-%'")
}

async function main() {
  const conn = await db.getConnection()
  try {
    const [[pwrow]] = await conn.query("SELECT password_hash FROM users WHERE email='tchang@qcogroup.com.au'")
    PW = pwrow.password_hash // reuse known hash → password = "password"
    const [[cbase]] = await conn.query("SELECT COUNT(*) c FROM projects WHERE code<>'ZZ_FLOWTEST'")
    const [[ubase]] = await conn.query("SELECT COUNT(*) c FROM users WHERE email NOT LIKE '%@zzflowtest.example'")

    console.log(`[seed] mode=${MODE} — cleaning prior ZZ…`)
    await teardown(conn)
    if (MODE === 'teardown') {
      const [[ca]] = await conn.query("SELECT COUNT(*) c FROM projects WHERE code<>'ZZ_FLOWTEST'")
      const [[ua]] = await conn.query("SELECT COUNT(*) c FROM users WHERE email NOT LIKE '%@zzflowtest.example'")
      console.log(`[teardown] canonical projects ${cbase.c}->${ca.c}, users ${ubase.c}->${ua.c} ${cbase.c === ca.c && ubase.c === ua.c ? '✅' : '❌'}`)
      return
    }

    // ── PROJECT ──
    const [pr] = await conn.query("INSERT INTO projects (code,name) VALUES ('ZZ_FLOWTEST','ZZ Flow Test (disposable)')")
    const pid = pr.insertId
    console.log('[seed] project id =', pid)

    // ── WAREHOUSES ──
    // project_id = pid → the SCN/transfer/receipting pickers only list this project's warehouses.
    const whIds = await batchInsert(conn, 'warehouses', ['project_id', 'name', 'code', 'type', 'city', 'contact_name', 'phone', 'status'], [
      [pid, 'ZZF Main Laydown', 'ZZF-WH1', 'laydown', 'Karratha', 'Dale Foreman', '0891110001', 'active'],
      [pid, 'ZZF Covered Store', 'ZZF-WH2', 'store', 'Perth', 'Rita Kaur', '0891110002', 'active'],
      [pid, 'ZZF DG Store', 'ZZF-WH3', 'site', 'Port Hedland', 'Sam Two', '0891110003', 'active'],
    ])

    // ── USERS: full 21-role matrix (each role gets ≥1 login; password "password") ──
    const ROLES = [
      ['admin', 2], ['ceo', 1], ['director', 1], ['project_director', 1], ['project_manager', 2],
      ['project_controls_manager', 1], ['project_control', 1], ['procurement_manager', 1], ['procurement_officer', 2],
      ['expediting_manager', 1], ['expeditor', 2], ['logistics_manager', 1], ['freight_forwarder', 2],
      ['materials_engineer', 1], ['warehouse', 2], ['engineering_lead', 1], ['auditor', 1], ['viewer', 1],
      ['site_contractor', 2], ['subcontractor', 1], ['vendor', 2],
    ]
    const EXTERNAL = new Set(['vendor', 'site_contractor', 'subcontractor', 'freight_forwarder'])
    const WBS_SCOPED = new Set(['site_contractor', 'subcontractor'])
    const userRows = [], creds = []
    for (const [role, count] of ROLES) for (let i = 1; i <= count; i++) {
      const email = `${role.replace(/_/g, '')}${i}@zzflowtest.example`
      const name = `ZZ ${role.replace(/_/g, ' ')} ${i}`
      userRows.push([email, PW, name, role, EXTERNAL.has(role) ? 1 : 0, 1, `ZZ${pad(userRows.length + 1, 3)}`, EXTERNAL.has(role) ? 'ZZ Vendor Co' : 'QCO'])
      creds.push({ role, email, password: 'password' })
    }
    const userIds = await batchInsert(conn, 'users', ['email', 'password_hash', 'full_name', 'role', 'is_external', 'is_active', 'staff_id', 'company'], userRows)
    const uidByRole = {}; creds.forEach((c, i) => { (uidByRole[c.role] = uidByRole[c.role] || []).push(userIds[i]) })
    const ADMIN = uidByRole['admin'][0]
    const someExp = uidByRole['expeditor'][0], someWh = uidByRole['warehouse'][0]

    // ── WBS hierarchy (L1 disciplines → L2 areas → L3 subsystems) ──
    // Codes are discipline abbreviations (CIV, MEC, …) with zero-padded sub-levels
    // (CIV.01, CIV.01.01) — alphabetic root, dot-separated so the parent_id derivation
    // (SUBSTRING_INDEX on '.') still resolves CIV.01.01 → CIV.01 → CIV → root.
    const DISC = ['Civil', 'Structural', 'Mechanical', 'Piping', 'Electrical', 'Instrumentation', 'HVAC', 'Fire']
    const ABBR = { Civil: 'CIV', Structural: 'STR', Mechanical: 'MEC', Piping: 'PIP', Electrical: 'ELE', Instrumentation: 'INS', HVAC: 'HVA', Fire: 'FIR' }
    const RAGS = ['green', 'amber', 'red', 'blue']
    const wbsRows = [], wbsMeta = [] // {code, disc}
    for (let a = 1; a <= S.wbsL1; a++) {
      const disc = DISC[(a - 1) % DISC.length]; const ab = ABBR[disc]
      wbsRows.push([pid, null, ab, `${disc} Works`, disc, rnd(RAGS), iso(addDays(TODAY, -300)), `WBS lead ${a}`]); wbsMeta.push({ code: ab, disc })
      for (let b = 1; b <= ri(3, 6); b++) {
        const c2 = `${ab}.${pad(b, 2)}`
        wbsRows.push([pid, null, c2, `${disc} Area ${b}`, disc, rnd(RAGS), iso(addDays(TODAY, -250)), null]); wbsMeta.push({ code: c2, disc })
        for (let c = 1; c <= ri(2, 5); c++) {
          const c3 = `${ab}.${pad(b, 2)}.${pad(c, 2)}`
          wbsRows.push([pid, null, c3, `${disc} Subsystem ${c}`, disc, rnd(RAGS), null, null]); wbsMeta.push({ code: c3, disc })
        }
      }
    }
    const wbsIds = await batchInsert(conn, 'wbs_nodes', ['project_id', 'parent_id', 'code', 'description', 'discipline', 'rag', 'ros_date', 'owner_id'], wbsRows.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], null]))
    const wbsIdByCode = {}; wbsMeta.forEach((m, i) => { wbsIdByCode[m.code] = wbsIds[i] })
    // wire parent_id from the dotted code hierarchy (parent of '1.5.4' is '1.5'; L1 → null)
    // so the WBS tree view nests/indents (it builds depth from parent_id, not the code).
    await conn.query("UPDATE wbs_nodes child JOIN wbs_nodes parent ON parent.project_id=child.project_id AND parent.code=SUBSTRING_INDEX(child.code,'.',LENGTH(child.code)-LENGTH(REPLACE(child.code,'.',''))) SET child.parent_id=parent.id WHERE child.project_id=? AND child.code LIKE '%.%'", [pid])
    const wbsCodes = wbsMeta.map(m => m.code)
    const leafCodes = wbsMeta.filter(m => m.code.split('.').length >= 2).map(m => m.code)

    // ── WBS access for WBS-scoped roles only (site_contractor, subcontractor) ──
    const accessRows = []
    for (const role of WBS_SCOPED) for (const uid of (uidByRole[role] || [])) for (const top of wbsMeta.filter(m => !m.code.includes('.')).map(m => m.code)) accessRows.push([uid, pid, top, role === 'subcontractor' ? 'fmr_only' : 'full', ADMIN])
    if (accessRows.length) await batchInsert(conn, 'user_wbs_access', ['user_id', 'project_id', 'wbs_code', 'scope_type', 'created_by'], accessRows)

    // ── SUPPLIERS (ZZF-coded, with contacts) ──
    const supRows = []
    for (let i = 1; i <= S.supplier; i++) supRows.push([`ZZ Supplier ${i} Pty Ltd`, `ZZF-${pad(i, 3)}`, `5${pad(ri(10000000, 99999999), 8)}`, 'Australia', `Contact ${i}`, `sales${i}@zzsupplier.example`, `08${pad(ri(10000000, 99999999), 8)}`, rnd(['approved', 'approved', 'conditional']), 'active'])
    const supIds = await batchInsert(conn, 'suppliers', ['name', 'code', 'abn', 'country', 'contact_name', 'email', 'phone', 'avl_status', 'status'], supRows)
    // Supplier shipping (pickup) addresses → the SCN wizard sources pickup location from here.
    const SUP_ORIGINS = [['Shanghai', 'Shanghai', '200000', 'China'], ['Houston', 'TX', '77002', 'USA'], ['Hamburg', 'HH', '20457', 'Germany'], ['Singapore', 'Singapore', '049315', 'Singapore'], ['Busan', 'Busan', '48058', 'South Korea'], ['Perth', 'WA', '6000', 'Australia'], ['Mumbai', 'MH', '400001', 'India'], ['Rotterdam', 'ZH', '3011', 'Netherlands']]
    const addrRows = supIds.map((sid, i) => { const o = SUP_ORIGINS[i % SUP_ORIGINS.length]; return [sid, 'shipping', `ZZ Supplier ${i + 1} Pty Ltd Works`, o[0], o[1], o[2], o[3], 1] })
    await batchInsert(conn, 'supplier_addresses', ['supplier_id', 'type', 'address_line1', 'city', 'state', 'postcode', 'country', 'is_primary'], addrRows)

    // ── COMMODITIES (linked to WBS) + EQUIPMENT ──
    const COMCAT = ['Pipe', 'Valve', 'Fitting', 'Flange', 'Gasket', 'Bolt Set', 'Cable', 'Instrument', 'Steel Section']
    const comRows = []
    for (let i = 1; i <= S.commodity; i++) {
      const wc = rnd(leafCodes); const cat = rnd(COMCAT)
      comRows.push([pid, `ZZC-${pad(i, 5)}`, `${cat} ${i}`, rnd(['EA', 'M', 'KG', 'SET', 'LM']), wc, wbsIdByCode[wc], ri(10, 5000), rnd(['lot', 'heat', 'serial']), `ZZ Supplier ${ri(1, S.supplier)} Pty Ltd`, `${cat} per spec ${ri(100, 999)}`, 'active', ADMIN])
    }
    const comIds = await batchInsert(conn, 'commodity_library', ['project_id', 'code', 'name', 'uom', 'wbs_code', 'wbs_node_id', 'estimated_qty', 'trace_level', 'preferred_vendor', 'notes', 'status', 'created_by'], comRows)
    const comMeta = comRows.map((r, i) => ({ id: comIds[i], code: r[1], name: r[2], uom: r[3], wbs: r[4] }))

    const EQT = ['Pump', 'Vessel', 'Exchanger', 'Motor', 'Compressor', 'Transformer']
    const eqRows = []
    for (let i = 1; i <= S.equipment; i++) {
      const wc = rnd(leafCodes)
      eqRows.push([pid, `ZZE-${pad(i, 4)}`, rnd(EQT), wc, wbsIdByCode[wc], `${rnd(EQT)} unit ${i}`, `Area ${ri(1, 40)}`, rnd(['high', 'medium', 'low']), `Datasheet DS-${ri(1000, 9999)}`, rnd(['A', 'B', 'C']), `ZZ Supplier ${ri(1, S.supplier)} Pty Ltd`, ri(50, 40000), 'active', ADMIN])
    }
    await batchInsert(conn, 'equipment_list', ['project_id', 'tag', 'equipment_type', 'wbs_code', 'wbs_node_id', 'description', 'area_location', 'criticality', 'spec', 'trace_class', 'vendor', 'weight_kg', 'status', 'created_by'], eqRows)

    // ── MTO registers + revisions + lines (demand; po_ref filled after POs) ──
    const mtoIds = []
    for (let m = 1; m <= S.mtoReg; m++) {
      const [r] = await conn.query('INSERT INTO mto_registers (project_id,name,reference,current_revision,owner,description,status,created_by) VALUES (?,?,?,?,?,?,?,?)',
        [pid, `ZZ MTO ${DISC[(m - 1) % DISC.length]}`, `ZZ-MTO-${pad(m, 3)}`, 'A', `Eng Lead ${m}`, `Material take-off for ${DISC[(m - 1) % DISC.length]} discipline`, 'active', ADMIN])
      mtoIds.push(r.insertId)
    }
    await batchInsert(conn, 'mto_revisions', ['mto_id', 'revision', 'uploaded_by', 'notes'], mtoIds.flatMap((mid, idx) => (idx < 2 ? ['A', 'B', 'C'] : ['A']).map(rev => [mid, rev, ADMIN, `Revision ${rev}`])))
    const mtoLineRows = [], mtoLineMeta = []
    for (let i = 1; i <= S.mtoLine; i++) {
      const com = rnd(comMeta); const mid = rnd(mtoIds)
      mtoLineRows.push([mid, 'A', `L${pad(i, 4)}`, com.wbs, `${com.name} — take-off line ${i}`, ri(1, 500), com.uom, iso(addDays(TODAY, ri(-120, 240))), rnd(['Class I', 'Class II', 'Class III']), chance(0.4) ? 1 : 0, 'not-started'])
      mtoLineMeta.push({ com, wbs: com.wbs })
    }
    const mtoLineIds = await batchInsert(conn, 'mto_lines', ['mto_id', 'revision', 'line_number', 'wbs_code', 'description', 'quantity', 'uom', 'ros_date', 'inspection_class', 'vdrl_required', 'status'], mtoLineRows)

    // ── PURCHASE ORDERS + LINES (chain-first: each PO line derives from an MTO line) ──
    const GC = ['mechanical', 'electrical', 'instrumentation', 'civil', 'piping', 'structural']
    const INCO = ['FOB', 'CIF', 'DAP', 'EXW', 'CFR']
    const poMeta = [], poLineRows = [], poLineMeta = []
    const mtoPoRef = new Map() // mtoLineId -> po_number (soft MTO→PO link)
    const dclRows = []         // date_change_log: ROS amendments (procurement) + forecast slips (expediting)
    const PROC_USER = (uidByRole['procurement_officer'] || uidByRole['procurement_manager'] || [ADMIN])[0]
    const EXP_USER  = (uidByRole['expeditor'] || uidByRole['expediting_manager'] || [ADMIN])[0]
    for (let i = 1; i <= S.po; i++) {
      const sup = ri(0, supIds.length - 1)
      const poNum = `ZZ-PO-${pad(i, 4)}`
      const poStatus = rnd(['po-raised', 'po-raised', 'active', 'active', 'closed', 'rfq'])
      const nLines = ri(MODE === 'smoke' ? 2 : 4, MODE === 'smoke' ? 4 : 12)
      // Pre-pick each line's furthest-reached status FIRST, so the PO timeline can be
      // anchored by how far the whole PO has actually progressed (status ↔ dates stay
      // consistent: a 'received' PO sits in the past, an 'rfq' one barely under way).
      const specs = []
      for (let l = 1; l <= nLines; l++) {
        const mIdx = ri(0, mtoLineMeta.length - 1)
        const st = pickStatus()
        specs.push({ l, mIdx, com: mtoLineMeta[mIdx].com, st, rank: PROG_RANK[st], heatReq: chance(0.5) ? 1 : 0 })
      }
      const maxRank = Math.max(PROG_RANK[poStatus] ?? 0, ...specs.map(s => s.rank))
      const tl = buildTimeline(maxRank)
      // ── ROS inheritance + tracked amendment (Thomas's EPC rule) ─────────────
      // The MTO line's ROS is the demand (required-on-site). The PO inherits it by
      // default; a realistic MINORITY is amended during the PO procedure — the PO
      // header/lines then carry the amended value while the MTO keeps the original.
      // That PO≠MTO difference is legitimate ONLY because a date_change_log row
      // records it. Separately, some in-flight POs are genuinely overdue (the
      // inherited demand has already passed, still not received) — a real slip, not
      // an amendment, so no log (PO still equals MTO).
      const pending = maxRank < 5
      const forceOverdue = pending && maxRank >= 2 && chance(0.30)
      const mtoDemand = forceOverdue ? addDays(TODAY, -ri(5, 60)) : tl.ros   // the MTO line's ROS
      const amended = chance(0.18)
      const poRos = amended ? addDays(mtoDemand, (chance(0.5) ? 1 : -1) * ri(10, 50)) : mtoDemand
      const cddHdr = addDays(poRos, -ri(0, 14))
      const [r] = await conn.query(
        `INSERT INTO purchase_orders (project_id,po_number,po_name,wbs_code,group_category,ros_date,is_locked,vendor_name,vendor_code,supplier_id,description,value,currency,status,rag,incoterms,warehouse_id,contract_delivery_date,estimated_delivery_date,milestone_po_date,milestone_eta_date,milestone_ros_date,created_by,expeditor_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [pid, poNum, `${rnd(EQT)} package ${i}`, rnd(leafCodes), rnd(GC), iso(poRos), i % 4 === 0 ? 1 : 0, `ZZ Supplier ${sup + 1} Pty Ltd`, `ZZF-${pad(sup + 1, 3)}`, supIds[sup], `Supply & delivery package ${i}`, ri(20000, 1500000), 'AUD', poStatus, rnd(['green', 'amber', 'red']), rnd(INCO), rnd(whIds), iso(cddHdr), iso(tl.receipt), iso(tl.ms.poIssued), iso(tl.eta), iso(poRos), ADMIN, someExp])
      const poId = r.insertId
      if (amended) dclRows.push(['purchase_order', poId, 'ros_date', iso(mtoDemand), iso(poRos), 'Procurement amendment — revised delivery date agreed with vendor at PO placement', PROC_USER])
      poMeta.push({ id: poId, poNum, tl, mtoDemand, poRos, amended, maxRank, sup, vendor: `ZZ Supplier ${sup + 1} Pty Ltd`, status: poStatus })
      for (const sp of specs) {
        const { l, mIdx, com, st, rank, heatReq } = sp
        // every line inherits the PO's ROS (amended or not); cdd ≤ ROS.
        const rosDate = poRos
        const cdd = addDays(rosDate, -ri(0, 14))
        const lineOverdue = rosDate < TODAY && rank < 5
        mtoPoRef.set(mtoLineIds[mIdx], poNum)
        poLineRows.push([poId, wbsIdByCode[com.wbs], `L${pad(l, 3)}`, `${com.name} — ${com.code}`, `TAG-${i}-${l}`, ri(1, 200), com.uom,
          rank >= 5 ? ri(1, 200) : 0, +(ri(50, 9000) + Math.random()).toFixed(2), iso(cdd), iso(rosDate), heatReq, com.wbs,
          `ZZ Supplier ${sup + 1} Pty Ltd`, rnd(['Class I', 'Class II', 'Class III']), heatReq ? 'Mill cert 3.1' : null, chance(0.4) ? 1 : 0, st,
          (rank < 2 ? 'grey' : lineOverdue ? 'red' : rnd(['green', 'amber'])), com.id])
        poLineMeta.push({ poId, poNum, com, status: st, rank, heatReq, rosDate, vendor: `ZZ Supplier ${sup + 1} Pty Ltd`, wh: rnd(whIds), tl })
      }
    }
    const poLineIds = await batchInsert(conn, 'po_lines', ['po_id', 'wbs_id', 'line_number', 'description', 'tag_number', 'qty', 'uom', 'qty_received', 'unit_price', 'cdd', 'ros_date', 'heat_number_required', 'wbs_code_snapshot', 'supplier_name_snapshot', 'insp_type', 'cert_required', 'vdrl_required', 'status', 'rag', 'commodity_id'], poLineRows)
    poLineMeta.forEach((m, i) => { m.id = poLineIds[i] })
    // soft MTO→PO link (no FK exists): set mto_lines.po_ref = fulfilling PO number, grouped
    // by PO. The MTO line keeps its ORIGINAL demanded ROS (the value the PO inherits); a PO
    // whose ros was amended diverges from this — and only those carry a date_change_log.
    const demandByPo = new Map(poMeta.map(p => [p.poNum, p.mtoDemand]))
    const byPo = new Map(); for (const [mlid, poNum] of mtoPoRef) { (byPo.get(poNum) || byPo.set(poNum, []).get(poNum)).push(mlid) }
    for (const [poNum, ids] of byPo) {
      await conn.query('UPDATE mto_lines SET po_ref=?, status=?, ros_date=? WHERE id IN (?)', [poNum, 'po-raised', iso(demandByPo.get(poNum)), ids])
    }

    // ── PO MILESTONES (planned ≤ forecast ≤ actual; some breached) + APPROVALS ──
    const STEPS = ['PO Issued', 'Drawings Approved', 'Manufacture', 'FAT', 'Ship', 'On Site']
    const msRows = [], apprRows = [], msSlip = []
    for (const po of poMeta) {
      // milestone planned dates come straight off the PO timeline (already monotonic):
      // PO Issued ≤ Drawings ≤ Manufacture ≤ FAT ≤ Ship ≤ On Site.
      const msDates = [po.tl.ms.poIssued, po.tl.ms.draw, po.tl.ms.mfg, po.tl.ms.fat, po.tl.ms.ship, po.tl.ms.onsite]
      STEPS.forEach((label, s) => {
        const planned = msDates[s]
        // forecast == planned UNLESS expediting revised it — so a forecast ≠ planned is
        // ALWAYS backed by a date_change_log row (expediting stage). Only POs that reached
        // expediting (rank ≥ 3) on already-passed milestones can slip.
        const slip = po.maxRank >= 3 && planned < TODAY && chance(0.18)
        const forecast = slip ? addDays(planned, ri(5, 30)) : planned
        const done = planned < TODAY && chance(0.85)
        const breached = planned < TODAY && !done                  // passed but not done → overdue (Attention)
        const actual = done ? clampPast(addDays(forecast, ri(0, 8))) : null  // actual ≥ forecast, ≤ today
        if (slip) msSlip.push({ idx: msRows.length, planned, forecast })
        msRows.push([po.id, s + 1, label, `${label} milestone`, iso(planned), iso(planned), iso(forecast), actual ? iso(actual) : null, done ? 'complete' : breached ? 'overdue' : 'not_started', 1, done ? ADMIN : null, ADMIN])
      })
      apprRows.push([po.id, ADMIN, 1, po.status === 'rfq' ? 'pending' : 'approved', po.status === 'rfq' ? null : 'Approved within delegation', po.status === 'rfq' ? null : new Date()])
    }
    const msIds = await batchInsert(conn, 'po_milestones', ['po_id', 'step_order', 'label', 'description', 'planned_date', 'target_date', 'forecast_date', 'actual_date', 'status', 'is_required', 'completed_by', 'created_by'], msRows)
    for (const sl of msSlip) dclRows.push(['po_milestone', msIds[sl.idx], 'forecast_date', iso(sl.planned), iso(sl.forecast), 'Expediting — forecast revised after vendor progress review', EXP_USER])
    if (dclRows.length) await batchInsert(conn, 'date_change_log', ['entity_type', 'entity_id', 'field_name', 'old_value', 'new_value', 'change_reason', 'created_by'], dclRows)
    await batchInsert(conn, 'po_approvals', ['po_id', 'approver_id', 'approval_level', 'status', 'comments', 'actioned_at'], apprRows)

    // ── VDRL packages + documents (for POs carrying vdrl-required lines) ──
    const DT = ['Drawing', 'Datasheet', 'Procedure', 'Certificate', 'Manual', 'Report']
    let vdrlDocs = 0
    for (const po of poMeta) {
      const lines = poLineMeta.filter(m => m.poId === po.id)
      if (!lines.some((_, i) => i % 2 === 0) || chance(0.4)) continue
      const [vp] = await conn.query('INSERT INTO vdrl_packages (project_id,po_id,package_ref,name,vendor_name,po_number,status,created_by) VALUES (?,?,?,?,?,?,?,?)',
        [pid, po.id, `ZZ-VDRL-${po.poNum.slice(-4)}`, `VDRL ${po.poNum}`, po.vendor, po.poNum, 'active', ADMIN])
      const docRows = []
      for (let d = 1; d <= ri(2, 5); d++) {
        const req = addDays(po.tl.ms.draw, ri(0, 90)); const overdue = req < TODAY && chance(0.4)  // docs due in the drawings/early-fab window
        docRows.push([vp.insertId, `DOC-${po.poNum.slice(-4)}-${pad(d, 2)}`, `${rnd(DT)} ${d}`, rnd(DT), rnd(DISC), 'A', rnd(['IFA', 'IFR', 'IFC']), overdue ? 'Overdue' : rnd(['Not submitted', 'Under review', 'Approved']), iso(req), iso(addDays(req, ri(-5, 10))), overdue ? null : iso(addDays(req, -ri(0, 5))), chance(0.5) ? 1 : 0, ADMIN])
        vdrlDocs++
      }
      await batchInsert(conn, 'vdrl_documents', ['package_id', 'doc_number', 'title', 'doc_type', 'discipline', 'revision', 'purpose', 'status', 'required_date', 'promised_date', 'submitted_date', 'cert_required', 'created_by'], docRows)
    }

    // ── SCNs (ship po_lines that reached 'shipped'+) — po_id + monotonic dates + heats ──
    const ORIG = ['Shanghai', 'Houston', 'Perth', 'Singapore', 'Rotterdam']
    // one SCN per shipping PO (no arbitrary cap) so every received line traces to an SCN —
    // receipt_lines.scn_id is NOT NULL, so a received line whose PO had no SCN would fail.
    const shippablePos = poMeta.filter(po => poLineMeta.some(m => m.poId === po.id && m.rank >= 4))
    const heatSeq = { n: 0 }
    const scnMeta = []
    for (let i = 0; i < shippablePos.length; i++) {
      const po = shippablePos[i]
      const lines = poLineMeta.filter(m => m.poId === po.id && m.rank >= 4)
      // SCN dates come straight off the PO timeline (forward-chained, so
      // cargo-ready ≤ collected ≤ ETD ≤ ATD ≤ ETA ≤ ATA, and all sit after the
      // PO's fab/FAT milestones).
      const tl = po.tl
      const crd = tl.cargoReady, ccd = tl.collected, etd = tl.etd, atd = tl.atd, eta = tl.eta, ata = tl.ata
      const arrived = ata < TODAY
      const [scn] = await conn.query(
        `INSERT INTO shipment_control_notes (project_id,scn_ref,po_id,vendor_name,supplier_id,forwarder_name,origin_location,destination_warehouse_id,incoterms,cargo_ready_date,cargo_collection_date,etd,atd,eta,ata,status,mode,bl_number,container_ref,total_packages,total_weight_kg,rag,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [pid, `ZZ-SCN-${pad(i + 1, 4)}`, po.id, po.vendor, supIds[po.sup], rnd(['ZZ Freight', 'ZZ Logistics Co']), rnd(ORIG), rnd(whIds), rnd(INCO),
          iso(crd), iso(ccd), iso(etd), iso(atd), iso(eta), iso(ata), arrived ? rnd(['arrived', 'received']) : rnd(['in-transit', 'pending']), rnd(['sea', 'air', 'road']),
          `BL${ri(100000, 999999)}`, `CONT${ri(1000, 9999)}`, ri(1, 8), ri(500, 25000), arrived ? 'green' : 'amber', ADMIN])
      const scnId = scn.insertId
      await conn.query('INSERT INTO scn_packages (scn_id,package_number,description,gross_weight_kg,net_weight_kg) VALUES (?,?,?,?,?)', [scnId, `PKG-${i + 1}`, 'Crate', ri(1000, 30000), ri(800, 28000)])
      await conn.query('INSERT INTO scn_documents (scn_id,document_type,file_name,uploaded_by) VALUES (?,?,?,?)', [scnId, 'Packing List', `PL-ZZ-${pad(i + 1, 4)}.pdf`, ADMIN])
      const heatRows = []
      for (const m of lines.filter(x => x.heatReq)) { const heat = `ZZH${pad(++heatSeq.n, 5)}`; m.heat = heat; heatRows.push([scnId, heat, rnd(['A106-B', 'A105', 'A352-LCB', 'SS316']), `MTC-${pad(heatSeq.n, 5)}`, 'declared', m.id, ADMIN]) }
      if (heatRows.length) await batchInsert(conn, 'scn_heats', ['scn_id', 'heat_number', 'material_grade', 'mill_cert_ref', 'source', 'po_line_id', 'created_by'], heatRows)
      scnMeta.push({ id: scnId, poId: po.id, ata, arrived })
    }
    const scnByPo = new Map(scnMeta.map(s => [s.poId, s]))

    // ── RECEIPTS + WAREHOUSE STOCK (po_lines that reached 'received'/'closed') ──
    const recRows = [], stockRows = [], stockMeta = []
    for (const m of poLineMeta.filter(x => x.rank >= 5)) {
      const scn = scnByPo.get(m.poId)
      // receipt sits AFTER actual arrival and at/before today — straight off the PO
      // timeline (receipt = ata + handling lag), so receipt ≥ ata always holds.
      const recDate = clampPast(m.tl.receipt)
      const qty = ri(1, 100); const stockout = chance(0.06); const cond = chance(0.08) ? rnd(['minor_damage', 'major_damage', 'quarantine']) : 'good'
      // receipt_lines.scn_id is NOT NULL — only record a receipt when an SCN exists (it always
      // should now, every shipping PO has one); stock can still exist with a null scn_id.
      if (scn) recRows.push([pid, scn.id, `ZZ-SCN-${pad(scnMeta.indexOf(scn) + 1, 4)}`, m.id, m.heat || null, `${m.com.name} received`, qty, qty - (chance(0.1) ? ri(1, 3) : 0), 0, m.com.uom, someWh, iso(recDate)])
      stockRows.push([pid, m.wh, scn ? scn.id : null, m.id, m.com.id, m.com.code, `${m.com.name} — ${m.com.code}`, m.com.wbs, stockout ? 0 : qty, stockout ? 0 : qty, m.com.uom, `Z${ri(1, 9)}-${ri(1, 99)}`, cond, cond === 'quarantine' ? 1 : 0, m.vendor, m.heat || null, iso(recDate), someWh])
      stockMeta.push({ poLineId: m.id, com: m.com, heat: m.heat, wh: m.wh, recDate })
    }
    await batchInsert(conn, 'receipt_lines', ['project_id', 'scn_id', 'scn_ref', 'po_line_id', 'heat_number', 'description', 'expected_qty', 'received_qty', 'damaged_qty', 'uom', 'received_by', 'received_date'], recRows)
    const stockIds = await batchInsert(conn, 'warehouse_stock', ['project_id', 'warehouse_id', 'scn_id', 'po_line_id', 'commodity_id', 'item_code', 'description', 'wbs_code', 'qty', 'qty_available', 'uom', 'location_code', 'condition_status', 'trace_hold', 'vendor_name', 'heat_number', 'received_date', 'received_by'], stockRows)
    stockMeta.forEach((m, i) => { m.id = stockIds[i] })

    // ── FMRs + lines + ISSUE LINES (issue real stock → stock_id link) ──
    // ~40% of FMRs carry MULTIPLE line items, all drawn from the SAME warehouse
    // (an FMR is warehouse-scoped). The header keeps a legacy single-item summary
    // (first line) + rolled-up qty; the fmr_lines carry the real per-item detail.
    const fmrStock = stockMeta.filter(m => m.id)
    const stockByWh = {}
    for (const m of fmrStock) (stockByWh[m.wh] ||= []).push(m)
    const whList = Object.keys(stockByWh)
    for (let i = 0; i < S.fmr && whList.length; i++) {
      const wh = rnd(whList); const pool = stockByWh[wh]
      if (!pool || !pool.length) continue
      const nLines = chance(0.4) ? Math.min(ri(2, 4), pool.length) : 1   // ~40% multi-line
      const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, nLines)
      const st = rnd(['issued', 'partial_issued', 'approved', 'pending_approval'])
      const lineStat = st === 'partial_issued' ? 'partial_issued' : st === 'issued' ? 'issued' : st === 'approved' ? 'approved' : 'pending'
      const lineData = picks.map(m => { const rq = ri(1, 20); const iq = (st === 'issued' || st === 'partial_issued') ? ri(1, rq) : 0; return { m, rq, iq } })
      const totReq = lineData.reduce((a, l) => a + l.rq, 0)
      const totIss = lineData.reduce((a, l) => a + l.iq, 0)
      const head = picks[0]
      const [fr] = await conn.query('INSERT INTO fmr_requests (project_id,warehouse_id,fmr_ref,item_code,description,wbs_code,qty_requested,qty_issued,uom,required_date,requested_by_name,requested_by_user,status,approved_by,approved_qty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [pid, wh, `ZZ-FMR-${pad(i + 1, 4)}`, head.com.code, picks.length > 1 ? `Field request — ${picks.length} items` : `Field request for ${head.com.name}`, head.com.wbs, totReq, totIss, head.com.uom, iso(addDays(TODAY, ri(-20, 30))), 'ZZ Site Contractor 1', uidByRole['site_contractor'][0], st, st === 'pending_approval' ? null : ADMIN, st === 'pending_approval' ? null : totReq])
      for (const ld of lineData) {
        const [fl] = await conn.query('INSERT INTO fmr_lines (fmr_id,item_code,item_type,description,wbs_code,qty_requested,qty_issued,qty_approved,uom,line_status) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [fr.insertId, ld.m.com.code, 'commodity', ld.m.com.name, ld.m.com.wbs, ld.rq, ld.iq, ld.rq, ld.m.com.uom, lineStat])
        if (ld.iq > 0) await conn.query('INSERT INTO fmr_issue_lines (fmr_id,fmr_line_id,stock_id,qty,heat_number,location_code,item_code,wbs_code,issued_by,issued_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          // issued AFTER the stock was received (≥ receipt date) and at/before today
          [fr.insertId, fl.insertId, ld.m.id, ld.iq, ld.m.heat || null, `Z${ri(1, 9)}-${ri(1, 99)}`, ld.m.com.code, ld.m.com.wbs, someWh, clampPast(addDays(ld.m.recDate, ri(1, 20)))])
      }
    }

    // ── TRACEABILITY certs (per heat → po_id from the heat's PO) + holds ──
    const certRows = []; const heatList = poLineMeta.filter(m => m.heat)
    for (const m of heatList) {
      // mill cert issued around manufacture of that heat's PO; received after issue, ≤ today.
      const issue = clampPast(addDays(m.tl.ms.mfg, ri(0, 30))); const stat = rnd(['verified', 'received', 'pending', 'overdue', 'rejected'])
      const received = (stat === 'pending' || stat === 'overdue') ? null : iso(clampPast(addDays(issue, ri(1, 20))))
      certRows.push([pid, 'approval', m.poId, m.poNum, m.vendor, `TAG-${m.poNum.slice(-4)}`, `MTC ${m.heat}`, 'MTC', m.heat, m.heat, iso(issue), iso(addDays(issue, 30)), received, 1, stat, stat === 'overdue' || stat === 'rejected' ? 'high' : 'normal', ADMIN])
    }
    const certIds = certRows.length ? await batchInsert(conn, 'traceability_certs', ['project_id', 'category', 'po_id', 'po_ref', 'vendor_name', 'tag', 'document_name', 'cert_type', 'heat_ref', 'applies_to', 'issue_date', 'due_date', 'received_date', 'is_required', 'status', 'priority', 'uploaded_by'], certRows) : []
    const holdRows = []
    for (let i = 0; i < S.hold; i++) {
      const active = chance(0.6); const since = addDays(TODAY, -ri(5, 90))
      holdRows.push([pid, `TAG-${ri(1, S.po)}-${ri(1, 9)}`, rnd(['Valve', 'Flange', 'Spool']), rnd(['Missing MTC', 'Heat mismatch', 'NDE outstanding', 'Awaiting QA review']), rnd(['ZZF-WH1', 'ZZF-WH2']), iso(since), Math.round((TODAY - since) / 86400000), ri(0, 4), certIds.length ? rnd(certIds) : null, `ZZ Supplier ${ri(1, S.supplier)} Pty Ltd`, active ? 'active' : 'released', active ? null : ADMIN])
    }
    await batchInsert(conn, 'traceability_holds', ['project_id', 'tag', 'item', 'hold_reason', 'location', 'since_date', 'age_days', 'chase_count', 'related_cert_id', 'vendor_name', 'status', 'released_by'], holdRows)

    // ── RFIs / MEETINGS (linked to WBS/PO/SCN) + actions + attendees ──
    for (let i = 1; i <= S.rfi; i++) {
      const isRfi = chance(0.6)
      const link = rnd(['wbs', 'po', 'scn', 'project'])
      const linkId = link === 'wbs' ? rnd(wbsIds) : link === 'po' ? rnd(poMeta).id : link === 'scn' && scnMeta.length ? rnd(scnMeta).id : null
      const linkLabel = link === 'po' ? `ZZ-PO-${pad(ri(1, S.po), 4)}` : link === 'wbs' ? rnd(wbsCodes) : link === 'scn' ? `ZZ-SCN-${pad(ri(1, Math.max(1, scnMeta.length)), 4)}` : 'Project'
      const due = addDays(TODAY, ri(-25, 30)); const overdue = due < TODAY && chance(0.5)
      const assignee = rnd(userIds)
      const [rr] = await conn.query('INSERT INTO rfi_meeting_records (project_id,record_type,ref,title,description,status,priority,link_type,link_id,link_label,raised_by,assigned_to,raised_date,due_date,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [pid, isRfi ? 'rfi' : 'meeting', `${isRfi ? 'ZZ-RFI' : 'ZZ-MTG'}-${pad(i, 4)}`, `${isRfi ? 'Clarification' : 'Coordination meeting'} ${i}`, `${isRfi ? 'Request for information' : 'Minutes'} regarding ${linkLabel}`, overdue ? 'open' : rnd(['open', 'answered', 'closed']), rnd(['low', 'normal', 'high', 'critical']), link, linkId, linkLabel, ADMIN, assignee, iso(addDays(due, -ri(5, 20))), iso(due), ADMIN])
      if (!isRfi) {
        await conn.query('INSERT INTO meeting_attendees (record_id,user_id,attendee_name,attendee_org,attended) VALUES (?,?,?,?,?)', [rr.insertId, ADMIN, 'ZZ Admin 1', 'QCO', 1])
        for (let a = 1; a <= ri(1, 3); a++) await conn.query('INSERT INTO meeting_actions (record_id,project_id,seq,description,assigned_to,due_date,status) VALUES (?,?,?,?,?,?,?)',
          [rr.insertId, pid, a, `Action ${a} from meeting ${i}`, rnd(userIds), iso(addDays(TODAY, ri(-15, 25))), rnd(['open', 'in_progress', 'done'])])
      }
    }

    // ── WAREHOUSE TRANSFERS (move real stock) ──
    const trRows = []
    for (let i = 1; i <= Math.min(S.transfer, stockMeta.length); i++) {
      const m = rnd(stockMeta.filter(x => x.id))
      trRows.push([pid, `ZZ-TR-${pad(i, 4)}`, m.id, m.com.code, m.com.name, m.com.wbs, m.heat || null, ri(1, 20), m.com.uom, m.wh, rnd(whIds.filter(w => w !== m.wh)) || whIds[0], uidByRole['warehouse'][0], rnd(['requested', 'pending_approval', 'in_transit', 'complete'])])
    }
    if (trRows.length) await batchInsert(conn, 'warehouse_transfers', ['project_id', 'transfer_ref', 'stock_id', 'item_code', 'description', 'wbs_code', 'heat_number', 'qty', 'uom', 'from_warehouse_id', 'to_warehouse_id', 'requested_by_user', 'status'], trRows)

    // ── FOUNDATIONAL CERTS (a few per project) + HEALTH WEIGHTS ──
    const fcRows = []
    for (let i = 0; i < Math.min(20, comMeta.length); i++) fcRows.push(['commodity', comMeta[i].id, pid, 'Material Cert', `FC-${pad(i + 1, 4)}`, comMeta[i].name, iso(addDays(TODAY, -ri(10, 200))), rnd(['Verified', 'Pending QA']), ADMIN])
    await batchInsert(conn, 'foundational_certificates', ['entity_type', 'entity_id', 'project_id', 'cert_type', 'ref_number', 'applies_to', 'issue_date', 'status', 'uploaded_by'], fcRows)
    await batchInsert(conn, 'project_health_weights', ['project_id', 'module_key', 'weight', 'updated_by'],
      [['procurement', 25], ['expediting', 25], ['logistics', 20], ['materials', 15], ['traceability', 15]].map(([k, w]) => [pid, k, w, ADMIN]))

    // ── COUNTS + ASSERTIONS ──
    const q = async (sql) => { const [r] = await conn.query(sql, [pid]); return Number(r[0].n) }
    const counts = {
      wbs: await q('SELECT COUNT(*) n FROM wbs_nodes WHERE project_id=?'),
      commodity: await q('SELECT COUNT(*) n FROM commodity_library WHERE project_id=?'),
      equipment: await q('SELECT COUNT(*) n FROM equipment_list WHERE project_id=?'),
      mto_lines: await q('SELECT COUNT(*) n FROM mto_lines l JOIN mto_registers r ON r.id=l.mto_id WHERE r.project_id=?'),
      po: await q('SELECT COUNT(*) n FROM purchase_orders WHERE project_id=?'),
      po_lines: await q('SELECT COUNT(*) n FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=?'),
      milestones: await q('SELECT COUNT(*) n FROM po_milestones m JOIN purchase_orders p ON p.id=m.po_id WHERE p.project_id=?'),
      vdrl_docs: await q('SELECT COUNT(*) n FROM vdrl_documents d JOIN vdrl_packages v ON v.id=d.package_id WHERE v.project_id=?'),
      scn: await q('SELECT COUNT(*) n FROM shipment_control_notes WHERE project_id=?'),
      scn_heats: await q('SELECT COUNT(*) n FROM scn_heats s JOIN shipment_control_notes c ON c.id=s.scn_id WHERE c.project_id=?'),
      stock: await q('SELECT COUNT(*) n FROM warehouse_stock WHERE project_id=?'),
      receipts: await q('SELECT COUNT(*) n FROM receipt_lines WHERE project_id=?'),
      fmr: await q('SELECT COUNT(*) n FROM fmr_requests WHERE project_id=?'),
      fmr_issue: await q('SELECT COUNT(*) n FROM fmr_issue_lines il JOIN fmr_requests f ON f.id=il.fmr_id WHERE f.project_id=?'),
      certs: await q('SELECT COUNT(*) n FROM traceability_certs WHERE project_id=?'),
      holds: await q('SELECT COUNT(*) n FROM traceability_holds WHERE project_id=?'),
      rfi: await q('SELECT COUNT(*) n FROM rfi_meeting_records WHERE project_id=?'),
      users: (await conn.query("SELECT COUNT(*) n FROM users WHERE email LIKE '%@zzflowtest.example'"))[0][0].n,
    }
    // FK coherence (every link real)
    const orphanStockPo = await q('SELECT COUNT(*) n FROM warehouse_stock WHERE project_id=? AND po_line_id IS NULL')
    const stockPoBad = await q('SELECT COUNT(*) n FROM warehouse_stock ws LEFT JOIN po_lines pl ON pl.id=ws.po_line_id WHERE ws.project_id=? AND pl.id IS NULL')
    const scnNoPo = await q('SELECT COUNT(*) n FROM shipment_control_notes WHERE project_id=? AND po_id IS NULL')
    const issueNoStock = await q('SELECT COUNT(*) n FROM fmr_issue_lines il JOIN fmr_requests f ON f.id=il.fmr_id LEFT JOIN warehouse_stock ws ON ws.id=il.stock_id WHERE f.project_id=? AND ws.id IS NULL')
    const certNoPo = await q('SELECT COUNT(*) n FROM traceability_certs WHERE project_id=? AND po_id IS NULL')
    const heatNoLine = await q('SELECT COUNT(*) n FROM scn_heats s JOIN shipment_control_notes c ON c.id=s.scn_id WHERE c.project_id=? AND s.po_line_id IS NULL')
    // funnel monotonic + non-trivial
    const fr = async (sql) => { const [r] = await conn.query(sql, [pid]); return Number(r[0].n) }
    const raised = await fr("SELECT COUNT(*) n FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=? AND pl.status IN ('po-raised','in-production','shipped','received','closed')")
    const exped = await fr("SELECT COUNT(*) n FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=? AND pl.status IN ('in-production','shipped','received','closed')")
    const recv = await fr("SELECT COUNT(*) n FROM po_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.project_id=? AND pl.status IN ('received','closed')")
    const monotonic = counts.mto_lines >= raised && raised >= exped && exped >= recv && raised > 0 && recv > 0 && raised > recv

    const [[ca]] = await conn.query("SELECT COUNT(*) c FROM projects WHERE code<>'ZZ_FLOWTEST'")
    const [[ua]] = await conn.query("SELECT COUNT(*) c FROM users WHERE email NOT LIKE '%@zzflowtest.example'")
    const canonOk = ca.c === cbase.c && ua.c === ubase.c
    const fkOk = orphanStockPo === 0 && stockPoBad === 0 && scnNoPo === 0 && issueNoStock === 0 && certNoPo === 0 && heatNoLine === 0
    const usersOk = counts.users >= 21

    console.log('\n=== SEED RESULT (project ' + pid + ', mode ' + MODE + ') ===')
    console.log('counts:', JSON.stringify(counts))
    console.log('funnel: MTO ' + counts.mto_lines + ' → raised ' + raised + ' → expedited ' + exped + ' → received ' + recv)
    console.log('ASSERT | fk-coherent', fkOk ? '✅' : '❌', '| funnel monotonic+nontrivial', monotonic ? '✅' : '❌', '| 21 roles', usersOk ? '✅' : '❌', '| canonical untouched', canonOk ? '✅' : '❌')
    if (!fkOk) console.log('  FK FAILS:', { orphanStockPo, stockPoBad, scnNoPo, issueNoStock, certNoPo, heatNoLine })
    console.log('CREDS:', JSON.stringify(creds))
    if (!(fkOk && monotonic && usersOk && canonOk)) { console.log('CHECKPOINT FAILED'); process.exitCode = 2 }
  } catch (e) {
    console.error('[seed] ERROR:', e.message, '\n', e.stack)
    process.exitCode = 1
  } finally {
    conn.release()
  }
}
main().then(() => process.exit(process.exitCode || 0))
