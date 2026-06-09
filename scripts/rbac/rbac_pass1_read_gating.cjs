const m = require('../../server/node_modules/mysql2/promise')
const jwt = require('../../server/node_modules/jsonwebtoken')
require('../../server/node_modules/dotenv').config({ path: '../../server/.env' })
const SECRET = 'qmat_jwt_secret_2024', API = 'http://localhost:3001/api', PID = 25
// (module, a can_view=0 role for it, the module's primary LIST/GET read endpoint)
const reads = [
  ['procurement','freight_forwarder',`/procurement/${PID}/pos`],
  ['logistics','procurement_officer',`/logistics/register/${PID}`],
  ['material_control','freight_forwarder',`/mc/${PID}/stock`],
  ['traceability','expediting_manager',`/traceability/${PID}/summary`],
  ['expediting','freight_forwarder',`/expediting/${PID}/register`],
  ['vdrl','logistics_manager',`/expediting/${PID}/vdrl/packages`],
  ['dashboard','freight_forwarder',`/dashboard/${PID}`],
  ['audit','expeditor','/audit/verify'],
  ['mto','site_contractor',`/mto/${PID}`],          // mto can_view? check
  ['commodity','freight_forwarder',`/foundational/${PID}/commodities`],
  ['equipment','freight_forwarder',`/foundational/${PID}/equipment`],
  ['wbs','freight_forwarder',`/foundational/${PID}/wbs`],
  ['document_inbox','vendor',`/documents/${PID}`],
]
;(async () => {
  const c = await m.createConnection({ host:process.env.DB_HOST, port:process.env.DB_PORT, user:process.env.DB_USER, password:process.env.DB_PASSWORD, database:process.env.DB_NAME, ssl:{rejectUnauthorized:false} })
  const out = []
  for (const [mod, role, path] of reads) {
    const [[u]] = await c.query("SELECT id,email,role,full_name FROM users WHERE role=? ORDER BY (email LIKE '%@zzflowtest.example') DESC LIMIT 1", [role])
    const [[p]] = await c.query('SELECT can_view v FROM role_permissions WHERE role=? AND module=?', [role, mod])
    if (!u) { out.push([mod, role, '(no user)', '?', '?']); continue }
    const t = jwt.sign({ id:u.id, email:u.email, role:u.role, full_name:u.full_name }, SECRET, { expiresIn:'10m' })
    let st, len
    try { const r = await fetch(API+path, { headers:{ Authorization:'Bearer '+t } }); st = r.status; const b = await r.text(); len = b.length } catch (e) { st = 'ERR'; len = 0 }
    const canView = p ? p.v : '(no matrix row)'
    // verdict: if matrix can_view=0, a 200 with data = LEAK; a 403 = correctly gated
    const verdict = canView === 0 ? (st === 403 ? 'GATED ✅' : (st === 200 ? 'LEAK ❌' : 'other('+st+')')) : 'view-allowed'
    out.push([mod, role, 'view='+canView, 'HTTP '+st+' ('+len+'b)', verdict])
  }
  await c.end()
  console.log('READ-GATING PROBE (role with can_view=0 reading the module):')
  for (const r of out) console.log('  '+r[0].padEnd(16)+r[1].padEnd(20)+r[2].padEnd(10)+r[3].padEnd(16)+r[4])
})().catch(e=>{ console.error('ERR', e.message); process.exit(1) })
