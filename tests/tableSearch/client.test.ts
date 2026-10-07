// Table search — browser matcher tests: every shared and client-only case in cases.json
// against src/lib/tableSearch.ts, then the identical-output check: every shared case is
// run through both libraries and the full outputs must be equal. Exit code 1 on any
// failure. Node 22.18+ runs the TypeScript directly (type stripping).
// Usage: node tests/tableSearch/client.test.ts
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import * as C from '../../src/lib/tableSearch.ts'

const require = createRequire(import.meta.url)
const S = require('../../server/lib/tableSearch.js')
const { fieldMaps, rows, cases } = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evaluate(lib: any, c: any) {
  if (c.kind === 'parse') {
    const out = lib.parse(c.q)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { out, summary: { groups: out.groups.map((g: any[]) => g.map(t => t.kind[0] + ' ' + t.text)), truncated: out.truncated } }
  }
  if (c.kind === 'normalise') { const out = lib.normalise(c.text); return { out, summary: out } }
  if (c.kind === 'match') { const out = lib.matchRow(rows[c.row], lib.parse(c.q), fieldMaps[c.fieldMap]); return { out, summary: out } }
  if (c.kind === 'highlight') {
    const out = lib.highlightSegments(c.text, lib.parse(c.q), c.fieldKey, c.fieldMap ? fieldMaps[c.fieldMap] : undefined)
    return { out, summary: out }
  }
  throw new Error('unknown kind ' + c.kind)
}

const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v

let pass = 0, fail = 0, same = 0, differ = 0
const shared: [string, unknown][] = []
for (const c of cases) {
  if (c.serverOnly) continue
  const { out, summary } = evaluate(C, c)
  if (!c.clientOnly) {
    shared.push([c.id, canonical(out)])
    const other = canonical(evaluate(S, c).out)
    if (JSON.stringify(canonical(out)) === JSON.stringify(other)) same++
    else { differ++; console.log(`DIFFERS ${c.id}: client ${JSON.stringify(out)} server ${JSON.stringify(other)}`) }
  }
  if (isDeepStrictEqual(summary, c.expect)) pass++
  else { fail++; console.log(`FAIL ${c.id} (${c.desc || c.kind})\n  expected ${JSON.stringify(c.expect)}\n  actual   ${JSON.stringify(summary)}`) }
}
const digest = createHash('sha256').update(JSON.stringify(shared)).digest('hex')
console.log(`client tableSearch: ${pass} passed, ${fail} failed (${shared.length} shared cases, output sha256 ${digest.slice(0, 16)})`)
console.log(`identical outputs, client vs server: ${same} of ${same + differ} shared cases${differ ? `, ${differ} differ` : ''}`)
process.exit(fail || differ ? 1 : 0)
