// PASS 1 — READ LEAK/OMIT classifier. For each (module, can_view=0 role, read endpoint),
// fetch as that role AND as admin, then classify:
//   403            → GATED (read authz enforced)            ✅
//   200, 0 items   → OMIT  (ungated but row-scoping hides all) ◑ (endpoint ungated, no data exposed)
//   200, N<adminM  → PARTIAL LEAK (scoped subset visible despite can_view=0) ❌
//   200, N==adminM → FULL LEAK (entire dataset visible)      ❌❌
// Read-only. Usage from scripts/rbac/:  node rbac_pass1_read_detail.cjs [PID]
const m = require('../../server/node_modules/mysql2/promise')
const jwt = require('../../server/node_modules/jsonwebtoken')
require('../../server/node_modules/dotenv').config({ path: '../../server/.env' })
const SECRET = process.env.JWT_SECRET || 'qmat_jwt_secret_2024', API = 'http://localhost:3001/api', PID = Number(process.argv[2]) || 27

// (module, a can_view=0 role for it, the module's primary LIST/GET read endpoint)
const reads = [
  ['procurement', 'freight_forwarder', `/procurement/${PID}/pos`],
  ['logistics', 'procurement_officer', `/logistics/register/${PID}`],
  ['material_control', 'freight_forwarder', `/mc/${PID}/stock`],
  ['traceability', 'expediting_manager', `/traceability/${PID}/summary`],
  ['expediting', 'freight_forwarder', `/expediting/${PID}/register`],
  ['vdrl', 'logistics_manager', `/expediting/${PID}/vdrl/packages`],
  ['mto', 'site_contractor', `/mto/${PID}`],
  ['commodity', 'freight_forwarder', `/foundational/${PID}/commodities`],
  ['equipment', 'freight_forwarder', `/foundational/${PID}/equipment`],
  ['wbs', 'freight_forwarder', `/foundational/${PID}/wbs`],
]

// count items in whatever shape the endpoint returns (array, {items}, {rows}, {data}, {pos}, object map)
function itemCount(body) {
  try {
    const j = JSON.parse(body)
    if (Array.isArray(j)) return j.length
    for (const k of ['items', 'rows', 'data', 'pos', 'packages', 'stock', 'register', 'nodes', 'commodities', 'equipment', 'lines', 'certs']) {
      if (Array.isArray(j[k])) return j[k].length
    }
    // summary-style: sum numeric leaf counts as a proxy for "has content"
    if (j && typeof j === 'object') {
      const vals = Object.values(j)
      const arr = vals.find(v => Array.isArray(v))
      if (arr) return arr.length
      return Object.keys(j).length ? -1 : 0  // -1 = non-empty object, shape-unknown
    }
    return 0
  } catch { return -2 } // non-JSON
}

;(async () => {
  const c = await m.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: { rejectUnauthorized: false } })
  const tokFor = async (role) => {
    const [[u]] = await c.query("SELECT id,email,role,full_name FROM users WHERE role=? ORDER BY (email LIKE '%@zzflowtest.example') DESC LIMIT 1", [role])
    return u ? { u, t: jwt.sign({ id: u.id, email: u.email, role: u.role, full_name: u.full_name }, SECRET, { expiresIn: '10m' }) } : null
  }
  const admin = await tokFor('admin')
  const get = async (t, path) => { try { const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + t } }); const b = await r.text(); return { st: r.status, n: itemCount(b), len: b.length, sample: b.slice(0, 80) } } catch (e) { return { st: 'ERR', n: -2, len: 0, sample: e.message } } }

  const out = []
  for (const [mod, role, path] of reads) {
    const [[p]] = await c.query('SELECT can_view v FROM role_permissions WHERE role=? AND module=?', [role, mod])
    const canView = p ? p.v : '(no row)'
    const actor = await tokFor(role)
    if (!actor) { out.push([mod, role, canView, '(no user)', '', '']); continue }
    const a = await get(actor.t, path)
    const base = await get(admin.t, path)
    let verdict
    if (a.st === 403) verdict = 'GATED ✅'
    else if (a.st !== 200) verdict = `other(${a.st})`
    else if (a.n === 0) verdict = 'OMIT ◑ (ungated, 0 rows exposed)'
    else if (a.n === -1) verdict = `OBJECT? ◑ (non-array body ${a.len}b — inspect)`
    else if (base.n > 0 && a.n >= base.n) verdict = `FULL LEAK ❌❌ (sees ${a.n}/${base.n})`
    else if (a.n > 0) verdict = `PARTIAL/LEAK ❌ (sees ${a.n}${base.n > 0 ? '/' + base.n : ''})`
    else verdict = `200 n=${a.n}`
    out.push([mod, role, 'view=' + canView, `role:HTTP${a.st} n=${a.n} ${a.len}b`, `admin:n=${base.n}`, verdict])
  }
  await c.end()
  console.log(`READ LEAK/OMIT DETAIL — project ${PID} (role with can_view=0 vs admin baseline)`)
  for (const r of out) console.log('  ' + String(r[0]).padEnd(16) + String(r[1]).padEnd(20) + String(r[2]).padEnd(11) + String(r[3]).padEnd(26) + String(r[4]).padEnd(14) + r[5])
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
