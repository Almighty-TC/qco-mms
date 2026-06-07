#!/usr/bin/env node
// ─── PASS A — schema-drift + grant-vs-usage sweep (read-only) ──────────────────
// Run:  node scripts/passA_sweep.cjs        (loads server/.env for the DB connection)
// Reports, against the LIVE schema + grants:
//   A1  columns referenced in an app INSERT that don't exist in the table
//   A2a app write paths (INSERT/UPDATE/DELETE) NOT covered by a live grant  ← prod failures
//   A2b app write paths not in scripts/provision_app_user.sql               ← re-provision gap
//   A2c granted write privileges the app never uses                         ← over-privilege
//   A3  `const { … } = req.body` without a `|| {}` guard                    ← undefined-body crashes
// Seed/migration scripts (server/scripts, docs/flowtest) are EXCLUDED from usage —
// they run as QCO_admin, not as the app credential.
const fs = require('fs'), path = require('path')
const ROOT = path.resolve(__dirname, '..')
const m = require(path.join(ROOT, 'server/node_modules/mysql2/promise'))
require(path.join(ROOT, 'server/node_modules/dotenv')).config({ path: path.join(ROOT, 'server/.env') })

const appFiles = []
;(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f); const s = fs.statSync(p)
    if (s.isDirectory()) { if (!/node_modules|\/scripts(\/|$)/.test(p)) walk(p) }
    else if (f.endsWith('.js')) appFiles.push(p)
  }
})(path.join(ROOT, 'server'))
const appSrc = appFiles.map(f => ({ f: f.replace(ROOT + '/', ''), src: fs.readFileSync(f, 'utf8') }))

const prov = {}
for (const ln of fs.readFileSync(path.join(ROOT, 'scripts/provision_app_user.sql'), 'utf8').split('\n')) {
  const mt = ln.match(/GRANT\s+(.+?)\s+ON\s+qmat\.(\w+)\s+TO/i)
  if (mt) prov[mt[2]] = new Set(mt[1].toUpperCase().split(',').map(s => s.trim()))
}

;(async () => {
  const c = await m.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: { rejectUnauthorized: false } })
  const schema = {}
  const [cols] = await c.query("SELECT TABLE_NAME t, COLUMN_NAME col FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION")
  for (const r of cols) (schema[r.t] ||= []).push(r.col)
  const live = {}
  for (const row of (await c.query('SHOW GRANTS FOR CURRENT_USER()'))[0]) {
    const mt = String(Object.values(row)[0]).match(/GRANT\s+(.+?)\s+ON\s+`?\w+`?\.`?(\w+)`?\s+TO/i)
    if (mt) live[mt[2]] = new Set(mt[1].toUpperCase().split(',').map(x => x.trim()))
  }

  const usage = {}, add = (t, op) => { (usage[t] ||= new Set()).add(op) }
  const colMiss = []
  for (const { f, src } of appSrc) {
    let mt
    const insRe = /INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?\s*(\(([^)]*)\))?/gis
    while ((mt = insRe.exec(src))) {
      add(mt[1], 'INSERT')
      if (/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(src.slice(mt.index, mt.index + 600))) add(mt[1], 'UPDATE')
      if (mt[3] && schema[mt[1]]) {
        const line = src.slice(0, mt.index).split('\n').length
        for (const col of mt[3].split(',').map(s => s.trim().replace(/`/g, '')).filter(s => /^\w+$/.test(s)))
          if (!schema[mt[1]].includes(col)) colMiss.push(`${f}:${line}  INSERT ${mt[1]} → unknown column "${col}"`)
      }
    }
    let u; const updRe = /UPDATE\s+`?(\w+)`?(?:\s+\w+)?\s+SET\s/gis
    while ((u = updRe.exec(src))) add(u[1], 'UPDATE')
    let d; const delRe = /DELETE\s+(?:\w+\s+)?FROM\s+`?(\w+)`?/gis
    while ((d = delRe.exec(src))) add(d[1], 'DELETE')
  }

  const missLive = [], missProv = [], over = [], guard = []
  for (const t of Object.keys(usage)) { if (!schema[t]) continue
    for (const op of usage[t]) { if (op === 'SELECT') continue
      if (!(live[t] && live[t].has(op))) missLive.push(`${t}.${op}`)
      if (!(prov[t] && prov[t].has(op))) missProv.push(`${t}.${op}`)
    } }
  for (const t of Object.keys(prov)) for (const op of prov[t]) { if (op === 'SELECT') continue
    if (!(usage[t] && usage[t].has(op))) over.push(`${t}.${op}`) }
  for (const { f, src } of appSrc) src.split('\n').forEach((ln, i) => {
    if (/const\s*\{[^}]*\}\s*=\s*req\.body\b/.test(ln) && !/req\.body\s*\|\|\s*\{\}/.test(ln)) guard.push(`${f}:${i + 1}`)
  })

  const sec = (t, a) => { console.log('\n=== ' + t + ' (' + a.length + ') ==='); a.length ? a.forEach(x => console.log('  ' + x)) : console.log('  (none) ✅') }
  sec('A1. column in INSERT not in table', colMiss)
  sec('A2a. app write paths MISSING a live grant (prod failures)', missLive)
  sec('A2b. app write paths not in provision_app_user.sql', missProv)
  sec('A2c. over-privilege — granted write never used', over)
  sec('A3. req.body destructure without `|| {}` guard', guard)
  await c.end()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
