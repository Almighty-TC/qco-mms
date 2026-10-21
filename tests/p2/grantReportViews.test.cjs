// Admin script — server/scripts/grant-report-views.js, run against a fake connection.
// No database, and no env file is read: dotenv and mysql2 are replaced, the admin password
// is a fake value. Exit code 1 on any failure.
// Usage: node tests/p2/grantReportViews.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const SCRIPT = path.join(__dirname, '../../server/scripts/grant-report-views.js')
const SOURCE = fs.readFileSync(SCRIPT, 'utf8')
const MIGRATION = fs.readFileSync(path.join(__dirname, '../../server/scripts/migrate-report-views.js'), 'utf8')

const GRANT = "GRANT SELECT, INSERT, DELETE ON `qmat`.`report_saved_views` TO 'qmat_app'@'%'"
const TABLE_LINE = privs => `GRANT ${privs} ON \`qmat\`.\`report_saved_views\` TO \`qmat_app\`@\`%\``
const USAGE = 'GRANT USAGE ON *.* TO `qmat_app`@`%`'
const ORDER = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
const COLUMNS = [['id', 'int'], ['user_id', 'int'], ['project_id', 'int'], ['name', 'varchar(120)'], ['dataset_id', 'varchar(64)'], ['config_json', 'json'], ['created_at', 'datetime']]
const ddlOf = src => { const m = /const DDL = `([\s\S]*?)`/.exec(src); return m ? m[1] : null }
const EXIT = '__fake_exit__'
// The fake process.exit throws EXIT to stop the script, as a real exit would; when the
// script's own .catch calls it, that throw is an unhandled rejection, ignored here only.
process.on('unhandledRejection', e => { if (!(e && e.message === EXIT)) throw e })

// Runs the script source once. state is the fake schema and grants and is updated by the
// statements it runs (so a second run sees the first run's result); noEffect: statements
// succeed but change nothing; failOn: the statement starting with this text throws.
function runScript(src, { argv = [], adminFile = true, state = {}, noEffect = false, failOn = null } = {}) {
  const S = Object.assign(state, { schema: 'qmat', table: false, rows: 0, grants: [], ...state })
  const out = [], err = [], executed = [], queries = []
  let exitCode = null, poolOpts = null
  const env = {}
  const fakeDotenv = { config: ({ path: p }) => { if (adminFile && p.endsWith('.env.admin')) env.DB_ADMIN_PASSWORD = 'fake-value'; return {} } }
  const db = {
    query: async (sql, params = []) => {
      const q = sql.replace(/\s+/g, ' ').trim()
      queries.push(q)
      if (/^(CREATE|GRANT|REVOKE|DROP)\b/i.test(q)) {
        if (failOn && q.startsWith(failOn)) throw new Error('fake failure')
        executed.push(sql)
        if (!noEffect) {
          if (q.startsWith('CREATE TABLE IF NOT EXISTS report_saved_views')) S.table = true
          if (q.startsWith('GRANT ')) {
            const add = /^GRANT (.+?) ON /.exec(q)[1].split(',').map(p => p.trim())
            const i = S.grants.findIndex(l => l.includes('`report_saved_views` TO'))
            const had = i < 0 ? [] : /^GRANT (.+?) ON /.exec(S.grants[i])[1].split(',').map(p => p.trim())
            const line = TABLE_LINE(ORDER.filter(p => had.includes(p) || add.includes(p)).join(', '))
            if (i < 0) S.grants.push(line); else S.grants[i] = line
          }
        }
        return [{ affectedRows: 0 }, undefined]
      }
      if (q === 'SELECT DATABASE() AS d') return [[{ d: S.schema }], []]
      if (/information_schema\.tables/.test(q) && /table_name = 'report_saved_views'/.test(q)) return [[{ n: params[0] === 'qmat' && S.table ? 1 : 0 }], []]
      if (q === "SHOW GRANTS FOR 'qmat_app'@'%'") return [[USAGE, ...S.grants].map(l => ({ 'Grants for qmat_app@%': l })), []]
      if (/information_schema\.columns/.test(q) && /table_name = 'report_saved_views'/.test(q)) return [S.table ? COLUMNS.map(([c, t]) => ({ c, t })) : [], []]
      if (q === 'SELECT COUNT(*) AS n FROM report_saved_views') { if (!S.table) throw new Error("Table 'qmat.report_saved_views' doesn't exist"); return [[{ n: S.rows }], []] }
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
  const DDL = ddlOf(src)
  const ran = r => r.executed.map(s => s.startsWith('CREATE') ? 'CREATE' : s)
  const printed = []

  // 1. Table absent, no grant: create, then grant, then a verify that shows both; exit 0.
  let r = await runScript(src); printed.push(r)
  check(same(ran(r), ['CREATE', GRANT]), 'absent: create then grant, in order')
  check(r.executed[0] === DDL, 'absent: the create is the copied DDL')
  check(r.exitCode === 0, 'absent: exit 0')
  check(has(r.out, 'columns: id int, user_id int, project_id int, name varchar(120), dataset_id varchar(64), config_json json, created_at datetime') && has(r.out, 'rows: 0'), 'absent: verify prints the columns and the row count')
  check(has(r.out, 'grants: ' + TABLE_LINE('SELECT, INSERT, DELETE')) && !r.out.some(l => l.startsWith('  grants:') && l.includes('USAGE')), 'absent: verify prints the table grants line, not USAGE')
  check(has(r.out, 'created by this run'), 'absent: says the table was created by this run')
  check(r.poolOpts && r.poolOpts.user === 'QCO_admin' && r.poolOpts.password === 'fake-value' && r.poolOpts.connectionLimit === 2, 'pool: QCO_admin by default, password from .env.admin')
  const firstState = r.S

  // 2. Table present: the create is skipped, the grant runs.
  r = await runScript(src, { state: { table: true, rows: 3 } }); printed.push(r)
  check(same(ran(r), [GRANT]) && has(r.out, 'report_saved_views present — skip'), 'table present: create skipped, grant runs')
  check(has(r.out, 'rows: 3') && !has(r.out, 'created by this run') && r.exitCode === 0, 'table present: rows shown, not "created by this run", exit 0')

  // 3. Grants present (table, schema or global level, or ALL): nothing runs; re-running is a no-op.
  for (const [name, grants] of [
    ['table-level SELECT, INSERT, DELETE', [TABLE_LINE('SELECT, INSERT, DELETE')]],
    ['table-level with UPDATE too', [TABLE_LINE('SELECT, INSERT, UPDATE, DELETE')]],
    ['schema-level', ['GRANT SELECT, INSERT, UPDATE, DELETE ON `qmat`.* TO `qmat_app`@`%`']],
    ['ALL PRIVILEGES on the table', [TABLE_LINE('ALL PRIVILEGES')]],
  ]) {
    r = await runScript(src, { state: { table: true, grants } }); printed.push(r)
    check(r.executed.length === 0 && has(r.out, "SELECT, INSERT, DELETE for 'qmat_app'@'%' present — skip") && r.exitCode === 0, `grants present (${name}): nothing executed, exit 0`)
  }
  r = await runScript(src, { state: firstState })
  check(r.executed.length === 0 && r.exitCode === 0, 're-run after a real run: nothing executed')

  // 4. Partial: some privileges, or grants without the table.
  r = await runScript(src, { state: { table: true, grants: [TABLE_LINE('SELECT')] } }); printed.push(r)
  check(same(ran(r), [GRANT]) && has(r.out, 'grants: ' + TABLE_LINE('SELECT, INSERT, DELETE')) && r.exitCode === 0, 'partial (SELECT only): grant runs, all three after')
  r = await runScript(src, { state: { table: true, grants: ['GRANT SELECT, INSERT ON `qmat`.* TO `qmat_app`@`%`'] } })
  check(same(ran(r), [GRANT]) && r.exitCode === 0, 'partial (schema-level SELECT, INSERT): grant runs')
  r = await runScript(src, { state: { table: false, grants: [TABLE_LINE('SELECT, INSERT, DELETE')] } })
  check(same(ran(r), ['CREATE']) && r.exitCode === 0, 'grants present, table absent: create only')
  r = await runScript(src, { state: { table: true, grants: ['GRANT SELECT, INSERT, DELETE ON `qmat`.`other_table` TO `qmat_app`@`%`'] } })
  check(same(ran(r), [GRANT]), 'a grant on another table does not count')

  // 5. --dry-run prints the statements in order and executes nothing.
  r = await runScript(src, { argv: ['--dry-run'] }); printed.push(r)
  check(r.executed.length === 0 && !r.queries.some(q => /^(CREATE|GRANT)/.test(q)), 'dry run: nothing executed')
  const would = r.out.filter(l => l.includes('would run:')).map(l => l.split('would run: ')[1])
  check(would.length === 2 && would[0] === DDL && would[1] === GRANT, 'dry run: the create and the grant printed in order')
  check(has(r.out, 'dry run: nothing is changed') && has(r.out, 'report_saved_views: absent (dry run)') && has(r.out, 'missing for') && r.exitCode === 0, 'dry run: says so, verify absent, exit 0')
  r = await runScript(src, { argv: ['--dry-run'], state: { table: true } })
  check(r.executed.length === 0 && same(r.out.filter(l => l.includes('would run:')).map(l => l.split('would run: ')[1]), [GRANT]) && r.exitCode === 0, 'dry run, table present: only the grant printed')

  // 6. Missing .env.admin: abort before connecting.
  r = await runScript(src, { adminFile: false }); printed.push(r)
  check(r.exitCode === 1 && r.poolOpts === null && r.queries.length === 0 && has(r.err, 'No DB_ADMIN_PASSWORD'), 'missing .env.admin: abort, no connection')
  r = await runScript(src, { adminFile: false, argv: ['--dry-run'] })
  check(r.exitCode === 1 && r.poolOpts === null, 'missing .env.admin: abort in a dry run too')

  // 7. Wrong schema: abort before any statement.
  for (const argv of [[], ['--dry-run']]) {
    r = await runScript(src, { argv, state: { schema: 'qmat_test' } })
    check(r.exitCode === 1 && r.executed.length === 0 && has(r.err, 'Pre-check failed'), `wrong schema: abort${argv.length ? ' (dry run)' : ''}`)
  }

  // 8. Failures: a failing grant exits 1; a step that leaves nothing behind fails the verify.
  r = await runScript(src, { failOn: 'GRANT' }); printed.push(r)
  check(r.exitCode === 1 && same(ran(r), ['CREATE']) && has(r.err, 'Script failed: fake failure'), 'failing grant: exit 1 after the create')
  r = await runScript(src, { failOn: 'CREATE' })
  check(r.exitCode === 1 && r.executed.length === 0 && has(r.err, 'Script failed: fake failure'), 'failing create: exit 1, no grant')
  r = await runScript(src, { state: { table: true }, noEffect: true })
  check(r.exitCode === 1 && has(r.out, "missing for 'qmat_app'@'%': SELECT, INSERT, DELETE"), 'grant without effect: verify missing, exit 1')
  r = await runScript(src, { noEffect: true })
  check(r.exitCode === 1 && has(r.out, 'report_saved_views: MISSING'), 'create without effect: verify MISSING, exit 1')

  // 9. Source: the DDL is migrate-report-views.js's, the grant has no UPDATE, the reverse is
  //    documented, no env value is printed, and no run printed the password.
  check(DDL !== null && DDL === ddlOf(MIGRATION), 'DDL identical to migrate-report-views.js')
  check(!/GRANT[^\n]*UPDATE/.test(src.replace(/^\/\/.*$/gm, '')), 'no UPDATE in any grant the script runs')
  check(src.includes("REVOKE SELECT, INSERT, DELETE ON `qmat`.`report_saved_views` FROM 'qmat_app'@'%'") && /DROP TABLE report_saved_views;\s+-- only if this script created it and it is still empty/.test(src), 'reverse documented: REVOKE, and DROP TABLE only if created and empty')
  check(!/console\.(log|error)\([^)]*process\.env/.test(src), 'no env value is printed')
  check(!printed.some(p => p.out.concat(p.err).some(l => l.includes('fake-value'))), 'the password is never printed')
  return { pass, fail, failed }
}

const MUTANTS = [
  ['UPDATE granted', s => s.replace("const PRIVS = ['SELECT', 'INSERT', 'DELETE']", "const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']")],
  ['host localhost', s => s.replace(`const APP_LOGIN = "'qmat_app'@'%'"`, `const APP_LOGIN = "'qmat_app'@'localhost'"`)],
  ['no dry-run branch', s => s.replace('if (DRY) {', 'if (false) {')],
  ['no skip branch', s => s.replace('if (present) {', 'if (false) {')],
  ['--dryrun flag', s => s.replace("includes('--dry-run')", "includes('--dryrun')")],
  ['no admin abort', s => s.replace('if (!process.env.DB_ADMIN_PASSWORD) {', 'if (false) {')],
  ['qmat_app user', s => s.replace("|| 'QCO_admin'", "|| 'qmat_app'")],
  ['no schema check', s => s.replace('if (d.d !== SCHEMA) {', 'if (false) {')],
  ['schema-level grants ignored', s => s.replace(" || l.includes(`ON \\`${SCHEMA}\\`.* TO`)", '')],
  ['nothing ever missing', s => s.replace('missing: PRIVS.filter(p => !has(p))', 'missing: []')],
  ['USAGE line kept', s => s.replace("    if (!p.some(x => PRIVS.includes(x) || x === 'ALL PRIVILEGES' || x === 'ALL')) continue\n", '')],
  ['table name in the check', s => s.replace("WHERE table_schema = ? AND table_name = 'report_saved_views'`, [SCHEMA])\n  return r.n > 0", "WHERE table_schema = ? AND table_name = 'report_saved_view'`, [SCHEMA])\n  return r.n > 0")],
  ['DDL changed', s => s.replace('name VARCHAR(120) NOT NULL', 'name VARCHAR(100) NOT NULL')],
  ['grant before create', s => { const a = s.indexOf('  const existed = await tableExists()'), b = s.indexOf('  const before = await appGrants()'), c = s.indexOf("\n  console.log('\\n Verify:')"); return s.slice(0, a) + s.slice(b, c) + '\n' + s.slice(a, b).replace(/\n$/, '') + s.slice(c) }],
  ['verify always 0', s => s.replace('process.exit(DRY || (table && after.missing.length === 0) ? 0 : 1)', 'process.exit(0)')],
  ['catch exits 0', s => s.replace("console.error('Script failed:', e.message); process.exit(1)", "console.error('Script failed:', e.message); process.exit(0)")],
]

;(async () => {
  const r = await suite(SOURCE)
  r.failed.forEach(n => console.log('FAIL ' + n))
  console.log(`grantReportViews: ${r.pass} passed, ${r.fail} failed`)
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
