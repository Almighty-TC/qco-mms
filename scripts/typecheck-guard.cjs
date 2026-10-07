// ─── TYPE-CHECK GUARD ────────────────────────────────────────
// Runs the real frontend type check and fails if any type error is new, or more
// frequent than in scripts/typecheck-baseline.json. No dependencies.
//
// Why: the root tsconfig.json lists no files (only project references), so
// `tsc --noEmit -p .` checks nothing and always exits 0, and `vite build` does not
// type-check. The real check is `tsc --noEmit -p tsconfig.app.json`, which reports the
// existing errors (the baseline). New errors must not enter.
//
// Errors are counted per key "path|TSnnnn|message" — line and column are ignored, so
// moving code does not matter, but a second occurrence of the same error does.
//
// Usage:
//   npm run typecheck                 (node scripts/typecheck-guard.cjs)
//   npm run typecheck -- --update     rewrite the baseline (after fixing errors)
// Exit codes: 0 no new or increased errors; 1 new or increased errors; 2 the check
// could not run (tsc missing, or a failing tsc run with no parsable errors).
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const TSC = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')
const BASELINE = path.join(__dirname, 'typecheck-baseline.json')
const UPDATE = process.argv.includes('--update')

function cannotRun(message) {
  console.error('typecheck guard: ' + message)
  process.exit(2)
}

// ─── RUN tsc ─────────────────────────────────────────────────
const run = spawnSync(TSC, ['--noEmit', '-p', 'tsconfig.app.json', '--pretty', 'false'], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
})
if (run.error) cannotRun(`could not run ${path.relative(ROOT, TSC)}: ${run.error.message}`)
if (run.status === null) cannotRun(`tsc was stopped by signal ${run.signal}`)

// ─── PARSE ───────────────────────────────────────────────────
// "path(line,col): error TSnnnn: message"; a project-level error has no location
// ("error TSnnnn: message") and is keyed under "(project)". Indented lines continue the
// previous message and are ignored.
const LOCATED = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const PROJECT = /^error (TS\d+): (.*)$/
const counts = {}
let total = 0
const unparsed = []
for (const line of `${run.stdout || ''}\n${run.stderr || ''}`.split(/\r?\n/)) {
  if (!line.trim() || /^\s/.test(line)) continue
  let key = null
  const m = LOCATED.exec(line)
  if (m) key = `${m[1].split('\\').join('/')}|${m[4]}|${m[5]}`
  else {
    const p = PROJECT.exec(line)
    if (p) key = `(project)|${p[1]}|${p[2]}`
  }
  if (!key) { unparsed.push(line); continue }
  counts[key] = (counts[key] || 0) + 1
  total++
}
if (run.status !== 0 && total === 0) {
  cannotRun(`tsc exited ${run.status} with no parsable errors:\n${unparsed.slice(0, 20).join('\n') || '(no output)'}`)
}
if (unparsed.length) console.warn(`typecheck guard: ${unparsed.length} unrecognised output line(s) ignored, e.g. ${unparsed[0]}`)

// ─── BASELINE ────────────────────────────────────────────────
function serialise(errors) {
  const sorted = {}
  for (const k of Object.keys(errors).sort()) sorted[k] = errors[k]
  const sum = Object.values(sorted).reduce((a, b) => a + b, 0)
  return JSON.stringify({ total: sum, errors: sorted }, null, 2) + '\n'
}

let baseline = null
if (fs.existsSync(BASELINE)) {
  try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) } catch (e) { cannotRun(`cannot read ${path.relative(ROOT, BASELINE)}: ${e.message}`) }
  if (!baseline || typeof baseline.errors !== 'object') cannotRun(`${path.relative(ROOT, BASELINE)} has no "errors" object`)
}

if (UPDATE) {
  if (baseline) {
    const rose = Object.keys(counts).filter(k => counts[k] > (baseline.errors[k] || 0))
    if (rose.length) console.warn(`typecheck guard: warning — the new baseline accepts ${rose.length} new or increased error key(s)`)
  }
  fs.writeFileSync(BASELINE, serialise(counts))
  console.log(`typecheck guard: baseline written — ${total} errors (${path.relative(ROOT, BASELINE)})`)
  process.exit(0)
}
if (!baseline) cannotRun(`no baseline at ${path.relative(ROOT, BASELINE)} — run with --update to create it`)

// ─── COMPARE ─────────────────────────────────────────────────
const baseTotal = Object.values(baseline.errors).reduce((a, b) => a + b, 0)
const rose = Object.keys(counts).sort().filter(k => counts[k] > (baseline.errors[k] || 0))
const fell = Object.keys(baseline.errors).sort().filter(k => (counts[k] || 0) < baseline.errors[k])

if (rose.length) {
  console.error(`typecheck guard: FAILED — ${total} errors (baseline ${baseTotal}); ${rose.length} new or increased:`)
  for (const k of rose) {
    const was = baseline.errors[k] || 0
    console.error(`  ${was ? 'increased' : 'new'}: ${k} (baseline ${was}, now ${counts[k]})`)
  }
  process.exit(1)
}
console.log(`typecheck guard: ${total} errors (baseline ${baseTotal})`)
if (fell.length) {
  console.log(`  ${fell.length} error key(s) fewer than the baseline:`)
  for (const k of fell) console.log(`  gone or fewer: ${k} (baseline ${baseline.errors[k]}, now ${counts[k] || 0})`)
  console.log('  run `npm run typecheck -- --update` to lower the baseline')
}
process.exit(0)
