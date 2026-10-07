// Table search — server matcher tests: every shared and server-only case in cases.json
// against server/lib/tableSearch.js. Exit code 1 on any failure.
// Usage: node tests/tableSearch/server.test.cjs
const crypto = require('crypto')
const { isDeepStrictEqual } = require('util')
const S = require('../../server/lib/tableSearch.js')
const { fieldMaps, rows, cases } = require('./cases.json')

function evaluate(lib, c) {
  if (c.kind === 'parse') {
    const out = lib.parse(c.q)
    return { out, summary: { groups: out.groups.map(g => g.map(t => t.kind[0] + ' ' + t.text)), truncated: out.truncated } }
  }
  if (c.kind === 'normalise') { const out = lib.normalise(c.text); return { out, summary: out } }
  if (c.kind === 'match') { const out = lib.matchRow(rows[c.row], lib.parse(c.q), fieldMaps[c.fieldMap]); return { out, summary: out } }
  if (c.kind === 'escapeLike') { const out = lib.escapeLike(c.input); return { out, summary: out } }
  if (c.kind === 'likeClause') {
    const out = lib.likeClause(lib.parse(c.q), fieldMaps[c.fieldMap])
    if (!c.expect.sqlExcludes) return { out, summary: out }
    const ok = !out.error && c.expect.sqlExcludes.every(s => !out.sql.includes(s)) &&
      out.params.length === c.expect.paramCount && out.params[0] === c.expect.firstParam
    return { out, summary: ok ? c.expect : out }
  }
  throw new Error('unknown kind ' + c.kind)
}

const canonical = v => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v

let pass = 0, fail = 0
const shared = []
for (const c of cases) {
  if (c.clientOnly) continue
  const { out, summary } = evaluate(S, c)
  if (!c.serverOnly) shared.push([c.id, canonical(out)])
  if (isDeepStrictEqual(summary, c.expect)) pass++
  else { fail++; console.log(`FAIL ${c.id} (${c.desc || c.kind})\n  expected ${JSON.stringify(c.expect)}\n  actual   ${JSON.stringify(summary)}`) }
}
const digest = crypto.createHash('sha256').update(JSON.stringify(shared)).digest('hex')
console.log(`server tableSearch: ${pass} passed, ${fail} failed (${shared.length} shared cases, output sha256 ${digest.slice(0, 16)})`)
process.exit(fail ? 1 : 0)
