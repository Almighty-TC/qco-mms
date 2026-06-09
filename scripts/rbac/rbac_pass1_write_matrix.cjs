// PASS 1 — Backend RBAC matrix verification. Tests the GATE (matrix vs enforcement).
// Non-mutating: dummy row ids (999999) + bad/empty payloads → allowed writes 400/404/422
// at validation (after passing the gate); denied → 403; proposers → 409.
const m = require('../../server/node_modules/mysql2/promise')
const jwt = require('../../server/node_modules/jsonwebtoken')
require('../../server/node_modules/dotenv').config({ path: '../../server/.env' })
const SECRET = 'qmat_jwt_secret_2024', API = 'http://localhost:3001/api', PID = 25

const probes = [
  ['procurement','c','POST','/procurement/pos/999999/documents',false,false],
  ['procurement','e','PUT','/procurement/pos/999999/owner',false,false],
  ['procurement','a','PATCH','/procurement/pos/999999/approve',false,false],
  ['procurement','d','DELETE','/procurement/pos/999999/expeditors/999999',false,false],
  ['expediting','e','PUT','/procurement/pos/999999/expeditor',false,false],
  ['expediting','c','POST',`/expediting/${PID}/po/999999/action-notes`,true,false,'INLINE'],
  ['vdrl','c','POST',`/expediting/${PID}/vdrl/packages`,true,false],
  ['vdrl','e','PUT',`/expediting/${PID}/vdrl/documents/999999`,true,false],
  ['mto','c','POST',`/mto/${PID}`,true,true],
  ['mto','e','PUT',`/mto/${PID}/999999/lines/999999`,true,false],
  ['mto','d','DELETE',`/mto/${PID}/999999/lines/999999`,true,true],
  ['wbs','c','POST',`/foundational/${PID}/wbs`,true,true],
  ['wbs','e','PATCH',`/foundational/${PID}/wbs/999999`,true,false],
  ['wbs','d','DELETE',`/foundational/${PID}/wbs/999999`,true,true],
  ['commodity','c','POST',`/foundational/${PID}/commodities`,true,true],
  ['commodity','e','PATCH',`/foundational/${PID}/commodities/999999`,true,false],
  ['equipment','c','POST',`/foundational/${PID}/equipment`,true,true],
  ['logistics','e','PUT','/logistics/scn/999999/status',false,false],
  ['logistics','c','POST','/logistics/scn/999999/packages',false,false],
  ['logistics','d','DELETE','/logistics/scn/999999/packages/999999',false,false],
  ['traceability','c','POST',`/traceability/${PID}/cert`,true,false],
  ['traceability','a','POST','/traceability/cert/999999/verify',false,false],
  ['material_control','c','POST',`/mc/${PID}/receipting/999999/complete`,true,false],
  ['material_control','e','PUT',`/mc/${PID}/stock/999999/move`,true,false],
  ['material_control','a','PUT',`/mc/${PID}/fmr/999999/approve`,true,false],
  ['fmr','c','POST',`/mc/${PID}/fmr`,true,false],
  ['rfi_meeting','c','POST',`/rfi-meeting/${PID}`,true,false],
  ['rfi_meeting','e','PATCH',`/rfi-meeting/${PID}/999999`,true,false],
  ['rfi_meeting','v','GET',`/rfi-meeting/${PID}`,true,false],
  ['dashboard','v','GET',`/dashboard/${PID}`,true,false],
  ['audit','v','GET','/audit/verify',false,false],
  ['audit_review','c','POST','/audit/999999/review',false,false],   // noFloor
  ['admin','v','GET','/admin/users',false,false],
  ['admin','c','POST','/admin/users',false,false],
]
const NOFLOOR = new Set(['audit_review','audit'])   // routes not behind denyReadOnly
const A = { c:'can_create', e:'can_edit', a:'can_approve', d:'can_delete', v:'can_view' }

;(async () => {
  const c = await m.createConnection({ host:process.env.DB_HOST, port:process.env.DB_PORT, user:process.env.DB_USER, password:process.env.DB_PASSWORD, database:process.env.DB_NAME, ssl:{rejectUnauthorized:false} })
  const [rp] = await c.query('SELECT role,module,can_view v,can_create c,can_edit e,can_approve a,can_delete d,wbs_scoped wbs FROM role_permissions')
  const mtx = {}; for (const r of rp) (mtx[r.role] ??= {})[r.module] = r
  const roles = Object.keys(mtx).sort()
  // one user per role (prefer ZZ) + their wbs access to PID
  const usr = {}
  for (const role of roles) {
    const [[u]] = await c.query("SELECT id,email,role,full_name FROM users WHERE role=? ORDER BY (email LIKE '%@zzflowtest.example') DESC LIMIT 1", [role])
    if (!u) { continue }
    const [[wa]] = await c.query('SELECT COUNT(*) n FROM user_wbs_access WHERE user_id=? AND project_id=?', [u.id, PID])
    usr[role] = { ...u, wbsAccess: wa.n > 0 }
  }
  await c.end()

  const tok = u => jwt.sign({ id:u.id, email:u.email, role:u.role, full_name:u.full_name }, SECRET, { expiresIn:'10m' })
  const call = async (u, p) => {
    const [mod, act, method, path, hasProj, queue] = p
    const opt = { method, headers:{ Authorization:'Bearer '+tok(u) } }
    if (method !== 'GET' && method !== 'DELETE') { opt.headers['Content-Type']='application/json'; opt.body = '{}' } // empty body → validation 4xx after gate
    try { const r = await fetch(API+path, opt); return r.status } catch (e) { return 'ERR:'+e.message }
  }
  const expected = (role, p) => {
    const [mod, act, , , hasProj, queue] = p
    if (role === 'admin') return 'ALLOW'
    if (mod === 'admin') return 'DENY'   // /admin/* is requireAdmin → only admin (matrix admin.can_view unused by API)
    const write = act !== 'v'
    if (write && (role==='viewer'||role==='auditor') && !NOFLOOR.has(mod)) return 'DENY'
    const row = mtx[role][mod]
    if (!row || !row[act]) return 'DENY'
    if (hasProj && row.wbs && !usr[role].wbsAccess) return 'DENY'   // wbs-scope check fires inside enforce
    if (queue && ['project_control','engineering_lead'].includes(role) && ['wbs','commodity','equipment','mto'].includes(mod)) return 'QUEUE'
    return 'ALLOW'
  }
  const observed = (st, queue) => st===403 ? 'DENY' : (st===409 && queue) ? 'QUEUE' : (typeof st==='number' ? 'ALLOW' : 'ERR')

  const fails = []; const cov = {}
  const grid = {}
  for (const role of roles) {
    if (!usr[role]) { console.log('NO USER for role', role); continue }
    grid[role] = {}
    for (const p of probes) {
      const st = await call(usr[role], p)
      const exp = expected(role, p), obs = observed(st, p[5])
      const ok = exp === obs
      grid[role][p[0]+'.'+p[1]] = ok ? '·' : (obs==='ERR'?'E':'✗')
      cov[p[0]+'.'+p[1]] = true
      if (!ok) fails.push({ role, probe:p[0]+'.'+p[1], method:p[2], expected:exp, observed:obs, status:st, inline:p[6]==='INLINE' })
    }
  }
  // OUTPUT
  const cols = probes.map(p=>p[0]+'.'+p[1])
  console.log('PASS 1 RESULT — '+roles.length+' roles × '+probes.length+' probes = '+(roles.length*probes.length)+' checks')
  console.log('FAILS:', fails.length)
  for (const f of fails) console.log('  '+(f.inline?'◐':'✗')+' '+f.role+' '+f.probe+' ['+f.method+'] expected='+f.expected+' observed='+f.observed+' (HTTP '+f.status+')'+(f.inline?'  [route has inline role-gate — stricter than matrix]':''))
  // per-role pass counts
  console.log('\nPer-role:')
  for (const role of roles) {
    if (!grid[role]) continue
    const vals = Object.values(grid[role]); const f = vals.filter(v=>v!=='·').length
    console.log('  '+role.padEnd(24)+' '+(vals.length-f)+'/'+vals.length+(f?'  ✗'+f:''))
  }
  console.log('\ncoverage: '+Object.keys(cov).length+' (module.action) probes exercised')
})().catch(e=>{ console.error('HARNESS ERR', e.message); process.exit(1) })
