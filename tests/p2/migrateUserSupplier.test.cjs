// Phase 2 migration — server/scripts/migrate-user-supplier.js, run against a fake
// connection. No database, and no env file is read: dotenv and mysql2 are replaced, the
// admin password is a fake value. Exit code 1 on any failure.
// Usage: node tests/p2/migrateUserSupplier.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const SCRIPT = path.join(__dirname, '../../server/scripts/migrate-user-supplier.js')
const SOURCE = fs.readFileSync(SCRIPT, 'utf8')

const ADD_COLUMN = 'ALTER TABLE users ADD COLUMN supplier_id INT NULL AFTER company'
const ADD_INDEX = 'ALTER TABLE users ADD INDEX idx_users_supplier (supplier_id)'
const ADD_FK = 'ALTER TABLE users ADD CONSTRAINT fk_users_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL'
const EXIT = '__fake_exit__'
// The fake process.exit throws EXIT to stop the script, as a real exit would; when the
// script's own .catch calls it, that throw is an unhandled rejection, ignored here only.
process.on('unhandledRejection', e => { if (!(e && e.message === EXIT)) throw e })

// Runs the script source once. state is the fake schema and is updated by the ALTERs it
// runs (so a second run sees the first run's result); noEffect: ALTERs succeed but change
// nothing; failOn: the ALTER containing this text throws.
function runScript(src, { argv = [], adminFile = true, state = {}, noEffect = false, failOn = null } = {}) {
  const S = Object.assign(state, { supType: 'int', usersEngine: 'InnoDB', suppliersEngine: 'InnoDB', col: false, colType: 'int', idx: false, fk: false, ...state })
  const out = [], err = [], executed = [], queries = []
  let exitCode = null, poolOpts = null
  const env = {}
  const fakeDotenv = { config: ({ path: p }) => { if (adminFile && p.endsWith('.env.admin')) env.DB_ADMIN_PASSWORD = 'fake-value'; return {} } }
  const db = {
    query: async (sql, params = []) => {
      const q = sql.replace(/\s+/g, ' ').trim()
      queries.push(q)
      if (/^ALTER TABLE/i.test(q)) {
        if (failOn && q.includes(failOn)) throw new Error('fake failure')
        executed.push(q)
        if (!noEffect) {
          if (q.startsWith('ALTER TABLE users ADD COLUMN supplier_id')) S.col = true
          if (q.startsWith('ALTER TABLE users ADD INDEX idx_users_supplier ')) S.idx = true
          if (q.startsWith('ALTER TABLE users ADD CONSTRAINT fk_users_supplier ')) S.fk = true
        }
        return [{ affectedRows: 0 }, undefined]
      }
      if (/information_schema\.columns/.test(q) && /table_name = 'suppliers' AND column_name = 'id'/.test(q)) return [S.supType == null ? [] : [{ ct: S.supType }], []]
      if (/information_schema\.tables/.test(q)) return [[{ t: 'users', e: S.usersEngine }, { t: 'suppliers', e: S.suppliersEngine }], []]
      if (/information_schema\.columns/.test(q) && /COUNT\(\*\)/.test(q)) return [[{ n: params[0] === 'users' && params[1] === 'supplier_id' && S.col ? 1 : 0 }], []]
      if (/information_schema\.columns/.test(q) && /table_name = 'users' AND column_name = 'supplier_id'/.test(q)) return [S.col ? [{ ct: S.colType, nn: 'YES' }] : [], []]
      if (/information_schema\.statistics/.test(q)) return [[{ n: params[0] === 'users' && params[1] === 'idx_users_supplier' && S.idx ? 1 : 0 }], []]
      if (/information_schema\.referential_constraints/.test(q)) return [[{ n: params[0] === 'users' && params[1] === 'fk_users_supplier' && S.fk ? 1 : 0 }], []]
      throw new Error('unexpected query: ' + q.slice(0, 90))
    },
  }
  const fakeRequire = m => {
    if (m === 'path') return path
    if (m === 'dotenv') return fakeDotenv
    if (m === 'mysql2/promise') return { createPool: o => { poolOpts = o; return db } }
    throw new Error('unexpected require: ' + m)
  }
  return new Promise(resolve => {
    let done = false
    const finish = () => { if (!done) { done = true; setImmediate(() => resolve({ exitCode, out, err: err.filter(l => !l.includes(EXIT)), executed, queries, poolOpts, S })) } }
    const proc = { argv: ['node', SCRIPT, ...argv], env, exit: code => { if (exitCode !== null) return; exitCode = code; finish(); throw new Error(EXIT) } }
    const con = { log: (...a) => out.push(a.join(' ')), error: (...a) => err.push(a.join(' ')) }
    setTimeout(finish, 3000)   // a script that never exits is reported with exitCode null
    try { vm.compileFunction(src, ['require', '__dirname', 'process', 'console'], { filename: SCRIPT })(fakeRequire, path.dirname(SCRIPT), proc, con) }
    catch (e) { if (e.message !== EXIT) { err.push('threw: ' + e.message); finish() } }
  })
}

async function suite(src) {
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const has = (lines, text) => lines.some(l => l.includes(text))

  // 1. Column absent: the three statements, in order, then exit 0.
  let r = await runScript(src)
  check(same(r.executed, [ADD_COLUMN, ADD_INDEX, ADD_FK]), 'absent: three statements in order')
  check(r.exitCode === 0, 'absent: exit 0')
  check(has(r.out, 'supplier_id: int | nullable=YES') && has(r.out, 'idx_users_supplier: present') && has(r.out, 'fk_users_supplier: present'), 'absent: verify reports all present')
  check(r.poolOpts && r.poolOpts.user === 'QCO_admin' && r.poolOpts.password === 'fake-value' && r.poolOpts.connectionLimit === 2, 'pool: QCO_admin by default, password from .env.admin')
  check(!r.out.concat(r.err).some(l => l.includes('fake-value')), 'the password is never printed')
  const firstState = r.S

  // 2. Present: each step skipped, nothing run; re-running on the first run's result is a no-op.
  r = await runScript(src, { state: { col: true, idx: true, fk: true } })
  check(r.executed.length === 0, 'present: nothing executed')
  check(['supplier_id', 'idx_users_supplier', 'fk_users_supplier'].every(k => has(r.out, `${k} present — skip`)), 'present: three skip lines')
  check(r.exitCode === 0, 'present: exit 0')
  r = await runScript(src, { state: firstState })
  check(r.executed.length === 0 && r.exitCode === 0, 're-run after a real run: nothing executed')

  // 3. Partly present: only the missing steps, in order.
  r = await runScript(src, { state: { col: true } })
  check(same(r.executed, [ADD_INDEX, ADD_FK]), 'column present: index then foreign key only')
  r = await runScript(src, { state: { col: true, idx: true } })
  check(same(r.executed, [ADD_FK]), 'column and index present: foreign key only')

  // 4. Wrong type or engine: abort before any statement, exit 1, a clear message.
  for (const [name, st] of [
    ['suppliers.id bigint', { supType: 'bigint' }], ['suppliers.id int unsigned', { supType: 'int unsigned' }],
    ['suppliers.id varchar(36)', { supType: 'varchar(36)' }], ['suppliers.id missing', { supType: null }],
    ['users MyISAM', { usersEngine: 'MyISAM' }], ['suppliers MyISAM', { suppliersEngine: 'MyISAM' }],
    ['users.supplier_id exists as varchar(20)', { col: true, colType: 'varchar(20)' }],
    ['users.supplier_id exists as bigint', { col: true, colType: 'bigint' }],
  ]) {
    r = await runScript(src, { state: st })
    check(r.exitCode === 1 && r.executed.length === 0 && !r.queries.some(q => /^ALTER/.test(q)) && has(r.err, 'Pre-check failed'), `abort: ${name}`)
    r = await runScript(src, { state: st, argv: ['--dry-run'] })
    check(r.exitCode === 1 && r.executed.length === 0, `abort in a dry run: ${name}`)
  }
  r = await runScript(src, { state: { supType: 'int(11)' } })
  check(r.exitCode === 0 && r.executed.length === 3, 'int(11) accepted as a signed INT')

  // 5. --dry-run prints the statements in order and executes nothing.
  r = await runScript(src, { argv: ['--dry-run'] })
  check(r.executed.length === 0 && !r.queries.some(q => /^ALTER/.test(q)), 'dry run: nothing executed')
  check(same(r.out.filter(l => l.includes('would run:')).map(l => l.split('would run: ')[1]), [ADD_COLUMN, ADD_INDEX, ADD_FK]), 'dry run: the three statements printed in order')
  check(has(r.out, 'dry run: nothing is changed') && has(r.out, 'absent (dry run)') && r.exitCode === 0, 'dry run: says so, verify absent, exit 0')
  r = await runScript(src, { argv: ['--dry-run'], state: { col: true } })
  check(r.executed.length === 0 && r.out.filter(l => l.includes('would run:')).length === 2, 'dry run, column present: two statements printed')

  // 6. Missing .env.admin: abort before connecting.
  r = await runScript(src, { adminFile: false })
  check(r.exitCode === 1 && r.poolOpts === null && r.queries.length === 0 && has(r.err, 'No DB_ADMIN_PASSWORD'), 'missing .env.admin: abort, no connection')
  r = await runScript(src, { adminFile: false, argv: ['--dry-run'] })
  check(r.exitCode === 1 && r.poolOpts === null, 'missing .env.admin: abort in a dry run too')

  // 7. Failures: an ALTER error stops the run; an ALTER that leaves nothing behind fails the verify.
  r = await runScript(src, { failOn: 'ADD INDEX' })
  check(r.exitCode === 1 && same(r.executed, [ADD_COLUMN]) && has(r.err, 'Migration failed: fake failure'), 'ALTER error: stop, exit 1')
  r = await runScript(src, { noEffect: true })
  check(r.exitCode === 1 && has(r.out, 'supplier_id: MISSING'), 'verify MISSING after a real run: exit 1')

  // 8. Source: the reverse is documented in order; no DROP is ever executed.
  const rev = ['DROP FOREIGN KEY fk_users_supplier', 'DROP INDEX idx_users_supplier', 'DROP COLUMN supplier_id'].map(s => src.indexOf(s))
  check(rev.every(i => i > 0) && rev[0] < rev[1] && rev[1] < rev[2], 'reverse documented: foreign key, index, column')
  check(!/console\.(log|error)\([^)]*process\.env/.test(src), 'no env value is printed')
  return { pass, fail, failed }
}

const MUTANTS = [
  ['ON DELETE CASCADE', s => s.replace("REFERENCES suppliers(id) ON DELETE SET NULL'", "REFERENCES suppliers(id) ON DELETE CASCADE'")],
  ['NOT NULL column', s => s.replace('INT NULL AFTER company', 'INT NOT NULL AFTER company')],
  ['AFTER email', s => s.replace("INT NULL AFTER company',", "INT NULL AFTER email',")],
  ['no dry-run branch', s => s.replace('if (DRY) {', 'if (false) {')],
  ['no skip branch', s => s.replace('if (present) {', 'if (false) {')],
  ['--dryrun flag', s => s.replace("includes('--dry-run')", "includes('--dryrun')")],
  ['no admin abort', s => s.replace('if (!process.env.DB_ADMIN_PASSWORD) {', 'if (false) {')],
  ['qmat_app user', s => s.replace("|| 'QCO_admin'", "|| 'qmat_app'")],
  ['loose INT check', s => s.replace('/^int(\\(\\d+\\))?$/i', '/^int/i')],
  ['engine || to &&', s => s.replace("engineOf('users') !== 'InnoDB' || engineOf('suppliers')", "engineOf('users') !== 'InnoDB' && engineOf('suppliers')")],
  ['no type abort exit', s => s.replace("is not a signed INT. Aborting; nothing changed.')\n    process.exit(1)", "is not a signed INT. Aborting; nothing changed.')")],
  ['no existing-column check', s => s.replace('if (existing && !SIGNED_INT.test(existing.ct)) {', 'if (false) {')],
  ['index name', s => s.replace('ADD INDEX idx_users_supplier (supplier_id)', 'ADD INDEX idx_users_supplier_x (supplier_id)')],
  ['column check name', s => s.replace("columnExists('users', 'supplier_id')", "columnExists('users', 'supplier')")],
  ['fk check name', s => s.replace("await foreignKeyExists('users', 'fk_users_supplier'), 'fk_users_supplier'", "await foreignKeyExists('users', 'fk_supplier'), 'fk_users_supplier'")],
  ['verify always 0', s => s.replace('process.exit(DRY || (col && idx && fk) ? 0 : 1)', 'process.exit(0)')],
  ['index before column', s => { const a = s.indexOf("  await step(await columnExists"), b = s.indexOf("  await step(await indexExists"), c = s.indexOf("  await step(await foreignKeyExists"); return s.slice(0, a) + s.slice(b, c) + s.slice(a, b) + s.slice(c) }],
  ['catch exits 0', s => s.replace("console.error('Migration failed:', e.message); process.exit(1)", "console.error('Migration failed:', e.message); process.exit(0)")],
]

;(async () => {
  const r = await suite(SOURCE)
  r.failed.forEach(n => console.log('FAIL ' + n))
  console.log(`migrateUserSupplier: ${r.pass} passed, ${r.fail} failed`)
  if (process.argv.includes('--mutation')) {
    let killed = 0
    for (const [name, mutate] of MUTANTS) {
      const m = mutate(SOURCE)
      if (m === SOURCE) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      const res = await suite(m)
      if (res.fail > 0) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${MUTANTS.length} killed`)
    if (killed !== MUTANTS.length) process.exitCode = 1
  }
  if (r.fail) process.exitCode = 1
})()
