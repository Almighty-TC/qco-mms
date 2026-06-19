// ─── UNIT TEST — revision comparator (server/lib/revision.js) ─────────────────
// Proves the exact rule with the agreed case table. Run: node scripts/test_revision.cjs
const { compareRevisions, validateRevisionFormat, RevisionError } = require('../server/lib/revision')

let pass = 0, fail = 0
const rows = []

// cmp(a,b,expected): expected -1|0|1
function cmp(a, b, expected, label) {
  let got, err = ''
  try { got = compareRevisions(a, b) } catch (e) { got = `throw:${e.code}`; err = e.message }
  const ok = got === expected
  rows.push([`${label}`, `cmp(${a}, ${b})`, String(expected), String(got), ok ? '✅' : '❌'])
  ok ? pass++ : fail++
}
// expectThrow(a,b,code)
function expectThrow(a, b, code, label) {
  let got = 'no-throw'
  try { compareRevisions(a, b) } catch (e) { got = e.code }
  const ok = got === code
  rows.push([label, `cmp(${a}, ${b})`, `throw:${code}`, `throw:${got}`, ok ? '✅' : '❌'])
  ok ? pass++ : fail++
}
// expectFormat(rev, shouldBeValid)
function fmt(rev, valid, label) {
  const e = validateRevisionFormat(rev)
  const ok = valid ? e === null : e !== null
  rows.push([label, `format(${JSON.stringify(rev)})`, valid ? 'valid' : 'invalid', e === null ? 'valid' : 'invalid', ok ? '✅' : '❌'])
  ok ? pass++ : fail++
}

// ── Ordering (upload accepts when new > latest; cmp(new, latest) > 0) ──
cmp('B', 'A', 1, 'A→B allow')                       // B newer than A
cmp('A-7-B', 'A-7-A', 1, 'A-7-A→A-7-B allow')       // B newer than A in seg3
cmp('A-7-B', 'A-6-D', 1, 'A-6-D→A-7-B allow')       // 7 > 6 in seg2
cmp('A-1', 'A-2', -1, 'A-2→A-1 block')              // A-1 older than A-2 → blocked
cmp('A-1-1', 'A-1', 1, 'A-1→A-1-1 allow')           // more segments = newer
cmp('A-1', 'A-1', 0, 'A-1→A-1 block (equal)')       // equal → blocked
cmp('10', '2', 1, 'numbers 2<10')                    // numeric, not lexical
cmp('2', '10', -1, 'numbers 2<10 (rev)')

// ── "B-2-A later than all" — strictly greater than the others ──
for (const other of ['A', 'A-7', 'A-7-B', 'A-1-1']) cmp('B-2-A', other, 1, `B-2-A > ${other}`)

// ── Scheme mismatch (letter vs number at same position) → invalid ──
expectThrow('A-7', 'A-B', 'SCHEME', 'A-7 vs A-B invalid')
expectThrow('A-B', 'A-7', 'SCHEME', 'A-B vs A-7 invalid')

// ── Format rejects ──
fmt('A', true, 'single letter ok')
fmt('A-7-B', true, 'segmented ok')
fmt('R0', true, 'mixed ok')
fmt('ABCDEFGHIJK', false, 'over-10-char reject')   // 11 chars
fmt('A_7', false, 'bad char (underscore)')
fmt('A.1', false, 'bad char (dot)')
fmt('-A', false, 'leading dash')
fmt('A-', false, 'trailing dash')
fmt('A--7', false, 'double dash')
fmt('', false, 'empty')
// format errors surface through compareRevisions too
expectThrow('A', 'A_7', 'FORMAT', 'bad char via cmp')
expectThrow('ABCDEFGHIJK', 'A', 'FORMAT', 'too long via cmp')

// ── Print ──
const w = [26, 20, 14, 14, 3]
const line = r => r.map((c, i) => String(c).padEnd(w[i])).join(' ')
console.log(line(['CASE', 'CALL', 'EXPECT', 'GOT', '']))
console.log('-'.repeat(w.reduce((a, b) => a + b + 1, 0)))
rows.forEach(r => console.log(line(r)))
console.log('-'.repeat(w.reduce((a, b) => a + b + 1, 0)))
console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ' ✅'}`)
process.exit(fail ? 1 : 0)
