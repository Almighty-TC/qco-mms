// 3T185 — server/scripts/set-user-password.js over a fake db and a fake bcrypt (no database, no real hashing):
// the variable is required, weak passwords and stray arguments are refused without echo, more than 10 ids need
// --allow-many, the dry run writes nothing, each user branch (set, missing, inactive, a reused password), the force
// flag off and on (the app's 30/90-day expiry), one transaction with a rollback on any failure, and the password,
// the hash, names, emails and the environment never reach the output or the audit row. Exit code 1 on any failure.
// Usage: node tests/p2/setUserPassword.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Module = require('module')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const SCRIPT = path.join(ROOT, 'scripts/set-user-password.js')
const SRC = fs.readFileSync(SCRIPT, 'utf8')
const UTILS_SRC = fs.readFileSync(path.join(ROOT, 'utils/password.js'), 'utf8')
const ADMIN_SRC = fs.readFileSync(path.join(ROOT, 'routes/admin.js'), 'utf8')

const PW = 'Qm4t-Live!check', WEAK = 'weakpass1', REUSED = 'Reus3d!pass', SENTINEL = 'SENTINEL-ENV-VALUE'
const fakeHash = p => 'FAKEHASH:' + crypto.createHash('sha256').update(p).digest('hex').slice(0, 20)
let state, calls, costs
const reset = () => {
  state = {
    users: {   // the fake rows carry names and emails, which must never be printed
      3: { id: 3, role: 'vendor', is_active: 1, is_external: 1, full_name: 'Name Three', email: 'three@example.test' },
      34: { id: 34, role: 'site_contractor', is_active: 1, is_external: 1, full_name: 'Name ThirtyFour', email: 'tf@example.test' },
      4: { id: 4, role: 'admin', is_active: 1, is_external: 0, full_name: 'Name Four', email: 'four@example.test' },
      9: { id: 9, role: 'admin', is_active: 0, is_external: 0, full_name: 'Name Nine', email: 'nine@example.test' },
    },
    history: { 34: [fakeHash(REUSED)] }, failOn: null, tx: { begin: 0, commit: 0, rollback: 0, release: 0, conns: 0 },
  }
  calls = []; costs = []
}
const norm = s => s.replace(/\s+/g, ' ').trim()
const sqlEq = s => norm(s).replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')   // the same statement, whitespace aside
const fakeDb = {
  query: async (sql, params = []) => {
    const q = norm(sql); calls.push({ via: 'pool', q, params })
    if (/^SELECT id, role, is_active, is_external FROM users WHERE id IN \(\?\)$/.test(q)) return [params[0].map(id => state.users[id]).filter(Boolean).map(u => ({ ...u })), []]
    if (/^SELECT hash FROM password_history WHERE user_id = \? ORDER BY created_at DESC LIMIT 5$/.test(q)) return [(state.history[params[0]] || []).map(hash => ({ hash })), []]
    throw new Error('unexpected pool query: ' + q.slice(0, 60))
  },
  getConnection: async () => {
    state.tx.conns++
    return {
      beginTransaction: async () => { state.tx.begin++ },
      query: async (sql, params = []) => {
        const q = norm(sql); calls.push({ via: 'conn', q, params })
        if (state.failOn && state.failOn.test(q)) { const e = new Error('Duplicate entry ' + params.join(',')); e.code = 'ER_FAKE_FAILURE'; throw e }
        return [{ affectedRows: 1, insertId: 1 }, undefined]
      },
      commit: async () => { state.tx.commit++ }, rollback: async () => { state.tx.rollback++ }, release: () => { state.tx.release++ },
    }
  },
  end: async () => {},
}
const fakeBcrypt = { hash: async (p, cost) => { costs.push(cost); return fakeHash(p) }, compare: async (p, h) => h === fakeHash(p) }
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve(path.join(ROOT, 'db.js')), fakeDb)
stub(require.resolve('bcryptjs', { paths: [ROOT] }), fakeBcrypt)
stub(require.resolve('dotenv', { paths: [ROOT] }), { config: () => ({ parsed: {} }) })
delete require.cache[require.resolve(path.join(ROOT, 'utils/password.js'))]   // the real rules, over the fakes
function compile(src) { const m = new Module(SCRIPT, module); m.filename = SCRIPT; m.paths = Module._nodeModulePaths(path.dirname(SCRIPT)); m._compile(src, SCRIPT); return m.exports }
async function run(S, argv, env) {
  reset(); const out = [], err = []
  const code = await S.main(argv, { DB_PASSWORD: SENTINEL, HOME: '/x', ...env }, { out: l => out.push(l), err: l => err.push(l) })
  return { code, out, err, text: out.concat(err).join('\n') }
}
const writes = () => calls.filter(c => c.via === 'conn')
const days = d => (new Date(d).getTime() - Date.now()) / 86400000

async function suite(src) {
  const S = compile(src)
  let pass = 0, fail = 0; const failed = [], texts = [], auditParams = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const go = async (argv, env) => { const r = await run(S, argv, env); texts.push(r.text); auditParams.push(...writes().filter(c => /^INSERT INTO audit_log/.test(c.q)).map(c => c.params)); return r }

  let r = await go(['--users', '3,34'], {})
  check(r.code === 1 && /QMAT_NEW_PASSWORD is not set/.test(r.text) && calls.length === 0, 'missing variable aborts before any query')
  r = await go(['--users', '3'], { QMAT_NEW_PASSWORD: WEAK })
  check(r.code === 1 && /complexity rules: .*uppercase.*special character/.test(r.text) && !r.text.includes(WEAK) && calls.length === 0, 'weak password aborts, names the failed rules, never the password')
  r = await go(['--users', '3', PW], { QMAT_NEW_PASSWORD: PW })
  check(r.code === 1 && /unexpected or malformed argument \(not shown\)/.test(r.text) && !r.text.includes(PW) && calls.length === 0, 'a stray argument (a password typed as an argument) is refused without echo')
  r = await go(['--users', '3,x'], { QMAT_NEW_PASSWORD: PW })
  check(r.code === 1 && calls.length === 0, 'a malformed id list is refused')
  r = await go(['--users', '1,2,3,4,5,6,7,8,9,10,11'], { QMAT_NEW_PASSWORD: PW })
  check(r.code === 1 && /more than 10 need --allow-many/.test(r.text) && calls.length === 0, 'more than 10 ids refused without --allow-many')
  r = await go(['--users', '1,2,3,4,5,6,7,8,9,10,11', '--allow-many', '--dry-run'], { QMAT_NEW_PASSWORD: PW })
  check(r.code === 0 && /3 vendor would be set/.test(r.text) && writes().length === 0, '--allow-many lifts the limit')

  r = await go(['--users', '3,34,4,9,999', '--dry-run'], { QMAT_NEW_PASSWORD: PW })
  check(r.code === 0 && state.tx.conns === 0 && writes().length === 0 && /Dry run: nothing written/.test(r.text), 'dry run: no connection, no write')
  check(['  3 vendor would be set', '  34 site_contractor would be set', '  4 admin would be set', '  9 admin skipped: inactive', '  999 — skipped: no such user'].every(l => r.out.includes(l)), 'dry run lists id and role per user, with the skip reasons')

  r = await go(['--users', '3,4,9,999'], { QMAT_NEW_PASSWORD: PW })
  const w = writes()
  check(r.code === 0 && state.tx.conns === 1 && state.tx.begin === 1 && state.tx.commit === 1 && state.tx.rollback === 0 && state.tx.release === 1, 'one transaction for all users, committed and released')
  check(['  3 vendor set', '  4 admin set', '  9 admin skipped: inactive', '  999 — skipped: no such user'].every(l => r.out.includes(l)), 'per user: set, inactive, missing')
  const upd = w.filter(c => /^UPDATE users/.test(c.q))
  check(upd.length === 2 && upd.every(c => c.q === 'UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?' && c.params[0] === fakeHash(PW)) && upd.map(c => c.params[1]).join() === '3,4', 'without --force-change: force_password_change = 0 and password_expires_at unchanged')
  check(costs.length === 2 && costs.every(c => c === 12), 'bcryptjs at cost 12, as routes/auth.js')
  const hist = w.filter(c => /^INSERT INTO password_history/.test(c.q)), prune = w.filter(c => /^DELETE FROM password_history/.test(c.q))
  const appInsert = norm((UTILS_SRC.match(/`(INSERT INTO password_history[^`]*)`/) || [])[1] || ''), appPrune = norm((UTILS_SRC.match(/`\s*(DELETE FROM password_history[\s\S]*?)`/) || [])[1] || '')
  check(appInsert && appPrune && hist.length === 2 && hist.every(c => sqlEq(c.q) === sqlEq(appInsert) && c.params[1] === fakeHash(PW)) && prune.length === 2 && prune.every(c => sqlEq(c.q) === sqlEq(appPrune)), 'history insert and prune are the SQL of utils/password.addToHistory')
  const aud = w.filter(c => /^INSERT INTO audit_log/.test(c.q))
  check(aud.length === 2 && aud.every(c => c.q === 'INSERT INTO audit_log (user_id, action, resource, ip) VALUES (?, ?, ?, ?)' && c.params[1] === 'user.password_set' && c.params[2] === `id=${c.params[0]}` && c.params[3] === null), "audit 'user.password_set' with the user id only")
  check(w.every(c => !(c.via === 'conn' && /users/.test(c.q) && c.params.includes(9))), 'the inactive user is never written')
  const adminAudit = norm(((ADMIN_SRC.split('function audit(req, action, resource)')[1] || '').match(/`(INSERT INTO audit_log[^`]*)`/) || [])[1] || '')
  check(adminAudit && aud.every(c => c.q === adminAudit), "the audit statement is exactly routes/admin.js audit()'s insert (the row_hash trigger fills the chain)")
  check(src.indexOf('DOTENV_CONFIG_QUIET') > -1 && src.indexOf('DOTENV_CONFIG_QUIET') < src.indexOf("require('../db')"), "dotenv is quieted before db.js's own config() runs")

  r = await go(['--users', '3,4', '--force-change'], { QMAT_NEW_PASSWORD: PW })
  const fu = writes().filter(c => /^UPDATE users/.test(c.q))
  const d3 = days(fu.find(c => c.params[2] === 3).params[1]), d4 = days(fu.find(c => c.params[2] === 4).params[1])
  check(r.code === 0 && fu.every(c => c.q === 'UPDATE users SET password_hash = ?, force_password_change = 1, password_expires_at = ? WHERE id = ?'), '--force-change sets force_password_change = 1 and an expiry')
  check(d3 > 29.9 && d3 < 30.1 && d4 > 89.9 && d4 < 90.1, '--force-change expiry follows utils/password.expiresAt: external 30 days, internal 90')

  r = await go(['--users', '34,3'], { QMAT_NEW_PASSWORD: REUSED })
  check(r.code === 0 && r.out.includes("  34 site_contractor skipped: one of the user's last 5 passwords") && r.out.includes('  3 vendor set') && !writes().some(c => c.params.includes(34)), 'a reused password skips that user only (checkHistory)')

  reset(); state.failOn = /^INSERT INTO password_history/
  { const out = [], err = []; const code = await S.main(['--users', '3,4'], { QMAT_NEW_PASSWORD: PW }, { out: l => out.push(l), err: l => err.push(l) })
    const text = out.concat(err).join('\n'); texts.push(text)
    check(code === 1 && state.tx.rollback === 1 && state.tx.commit === 0 && state.tx.release === 1 && /rolled back, nothing changed/.test(text) && !out.some(l => / set$/.test(l)) && !text.includes(fakeHash(PW)), 'a failing insert rolls everything back; no "set" line; the error text (which carries the values) is not printed') }

  const all = texts.join('\n')
  check(!all.includes(PW) && !all.includes(REUSED) && !all.includes(WEAK) && !all.includes(fakeHash(PW)) && !all.includes(fakeHash(REUSED)), 'no password and no hash in any output')
  check(!/Name (Three|ThirtyFour|Four|Nine)|@example\.test/.test(all) && !all.includes(SENTINEL), 'no name, email or environment value in any output')
  check(auditParams.length > 0 && auditParams.every(p => p.every(v => v === null || typeof v === 'number' || /^(user\.password_set|id=\d+)$/.test(String(v)))), 'audit parameters hold only the user id, the action and id=<id>')
  return { pass, fail, failed }
}
const MUTANTS = [
  ['password echoed on refusal', s => s.replace("does not meet the complexity rules: ${failures.join('; ')}", "does not meet the complexity rules (${pw}): ${failures.join('; ')}")],
  ['argument echoed', s => s.replace("return { error: 'unexpected or malformed argument (not shown)' }", "return { error: 'unexpected argument ' + a }")],
  ['missing variable not checked', s => s.replace('if (!pw) {', 'if (false) {')],
  ['limit not enforced', s => s.replace('opts.ids.length > MAX_IDS && !opts.many', 'false')],
  ['dry run writes', s => s.replace('if (opts.dry || !plan.length)', 'if (!plan.length)')],
  ['inactive not skipped', s => s.replace('if (!u.is_active) {', 'if (false) {')],
  ['history not checked', s => s.replace('if (await checkHistory(id, pw)) {', 'if (false) {')],
  ['force flag ignored', s => s.replace('if (opts.force) {', 'if (false) {')],
  ['internal expiry for everyone', s => s.replace('expiresAt(Boolean(u.is_external))', 'expiresAt(false)')],
  ['expiry cleared without force', s => s.replace("'UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?', [hash, u.id]", "'UPDATE users SET password_hash = ?, force_password_change = 0, password_expires_at = ? WHERE id = ?', [hash, null, u.id]")],
  ['commit instead of rollback', s => s.replace('await conn.rollback().catch(() => {})', 'await conn.commit().catch(() => {})')],
  ['error message printed', s => s.replace("io.err(`Failed (${e.code || 'error'}); rolled back, nothing changed.`)", "io.err(`Failed (${e.message}); rolled back, nothing changed.`)")],
  ['hash in the audit row', s => s.replace("[u.id, 'user.password_set', `id=${u.id}`, null]", "[u.id, 'user.password_set', `id=${u.id}`, hash]")],
  ['cost 10', s => s.replace('const COST = 12', 'const COST = 10')],
  ['dotenv not quieted', s => s.replace("process.env.DOTENV_CONFIG_QUIET = 'true'   // db.js's own dotenv call would print a tip line\n", '')],
  ['audit statement drifts', s => s.replace("'INSERT INTO audit_log (user_id, action, resource, ip) VALUES (?, ?, ?, ?)'", "'INSERT INTO audit_log (user_id, action, resource) VALUES (?, ?, ?)'").replace("[u.id, 'user.password_set', `id=${u.id}`, null]", "[u.id, 'user.password_set', `id=${u.id}`]")],
  ['no history prune', s => s.replace("await conn.query(`DELETE FROM password_history", "if (0) await conn.query(`DELETE FROM password_history")],
  ['a transaction per user', s => s.replace('    await conn.commit()\n', '').replace("      await conn.query('INSERT INTO audit_log (user_id, action, resource, ip) VALUES (?, ?, ?, ?)',\n        [u.id, 'user.password_set', `id=${u.id}`, null])\n", "      await conn.query('INSERT INTO audit_log (user_id, action, resource, ip) VALUES (?, ?, ?, ?)',\n        [u.id, 'user.password_set', `id=${u.id}`, null])\n      await conn.commit()\n")],
]
;(async () => {
  const r = await suite(SRC)
  r.failed.forEach(n => console.log('FAIL ' + n))
  console.log(`setUserPassword: ${r.pass} passed, ${r.fail} failed`)
  if (process.argv.includes('--mutation')) {
    let killed = 0
    for (const [name, mutate] of MUTANTS) {
      const m = mutate(SRC)
      if (m === SRC) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      let bad
      try { bad = (await suite(m)).fail > 0 } catch { bad = true }
      if (bad) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${MUTANTS.length} killed`)
    if (killed !== MUTANTS.length) process.exitCode = 1
  }
  if (r.fail) process.exitCode = 1
})()
