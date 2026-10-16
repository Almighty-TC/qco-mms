// Table search — server SQL paths: escapeLike and likeClause with ESCAPE '!', and searchIds
// (the fuzzy path) against a fake query function. Exit code 1 on any failure.
// Usage: node tests/tableSearch/searchIds.test.cjs
const { isDeepStrictEqual } = require('util')
const S = require('../../server/lib/tableSearch.js')
const { fieldMaps } = require('./cases.json')

let pass = 0, fail = 0
function check(name, actual, expected) {
  if (isDeepStrictEqual(actual, expected)) pass++
  else { fail++; console.log(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`) }
}

// ─── ESCAPE '!' ──────────────────────────────────────────────
check('escape !', S.escapeLike('!'), '!!')
check('escape %', S.escapeLike('%'), '!%')
check('escape _', S.escapeLike('_'), '!_')
check('backslash literal', S.escapeLike('\\'), '\\')
check('backslash before %', S.escapeLike('\\%'), '\\!%')
check('mixed', S.escapeLike('a!%_\\b'), 'a!!!%!_\\b')
check('null', S.escapeLike(null), '')
check('accents and quotes untouched', S.escapeLike("Café O'Brien"), "Café O'Brien")

// Every LIKE in likeClause carries ESCAPE '!'; one bound parameter per ?; without the
// ESCAPE text the SQL holds no user text.
const count = (s, sub) => s.split(sub).length - 1
const likeQueries = ['unraise', '100%', 'a_b c!d', 'resource:x_y', 'reason:"50% off"', 'action:approve OR resource:a!',
  'unraise | reason:wrong', '"c:\\temp"', "x'; DROP TABLE t; --", 'entity:po resource:p_1 OR 99%']
for (const q of likeQueries) {
  const out = S.likeClause(S.parse(q), fieldMaps.auditSql)
  check('ESCAPE on every LIKE: ' + q, count(out.sql, 'LIKE ?') === count(out.sql, "LIKE ? ESCAPE '!'") && count(out.sql, 'LIKE ?') > 0, true)
  check('one param per ?: ' + q, count(out.sql, '?'), out.params.length)
  check('no user text in SQL: ' + q, /DROP|;|--|%|!|'|unraise|wrong|temp|off|99|p_1|\\/.test(out.sql.split(" ESCAPE '!'").join('')), false)
}
const codeQueries = ['wbs:02', 'wbs:02.', 'wbs:0_1', 'wbs:02!', 'wbs:02 OR wbs:03.', 'wbs:02 desc:valve']
for (const q of codeQueries) {
  const out = S.likeClause(S.parse(q), fieldMaps.mto)
  check('ESCAPE on code prefix: ' + q, count(out.sql, 'LIKE ?') === count(out.sql, "LIKE ? ESCAPE '!'") && count(out.sql, 'LIKE ?') > 0, true)
  check('one param per ? (code): ' + q, count(out.sql, '?'), out.params.length)
}
check('enum only: no LIKE', S.likeClause(S.parse('action:approve'), fieldMaps.auditSql), { sql: '(a.action = ?)', params: ['approve'] })

// ─── searchIds ───────────────────────────────────────────────
const FIELDS = {
  line: { column: 'l.line_number' },
  wbs: { column: 'l.wbs_code', flag: 'code' },
  desc: { column: 'l.description' },
  type: { column: 'l.item_type', flag: 'enum' },
  tag: { column: 'l.item_ref' },
  status: { column: 'l.status', flag: 'enum' },
  po: { column: 'l.po_ref' },
}
const ROWS = [
  { id: 9001, line: 'L-002', wbs: '02.01.01', desc: 'LP Flash Drum vertical', type: 'equipment', tag: 'V-102', status: 'po-raised', po: 'PO-2024-001' },
  { id: 9002, line: 'L-003', wbs: '02.01.01', desc: 'Condensate Stabiliser Column', type: 'commodity', tag: 'CC-003', status: 'rfq', po: '' },
  { id: 9003, line: 'L-011', wbs: '02', desc: 'Pipe Flange 8" ASME', type: null, tag: null, status: 'not-started', po: null },
  { id: 9004, line: 'L-020', wbs: '12.02', desc: 'Café façade panels', type: 'bulk', tag: 'BLK-020', status: 'rfq', po: null },
  { id: 9005, line: 'L-030', wbs: '02.10', desc: 'Gate valve 100% tested_ok', type: 'commodity', tag: 'V-103', status: 'rfq', po: null },
  { id: 9006, line: 'L-040', wbs: '02.01', desc: 'Pumps and motors', type: 'equipment', tag: 'P-101A', status: 'rfq', po: 'PO-2024-003' },
]
const SCOPE = 'FROM mto_lines l WHERE l.mto_id = ? AND l.revision = ? AND l.is_deleted = 0'
const SCOPE_PARAMS = [7, 2]

// The fake query records each call and returns copies of the rows, honouring the LIMIT.
function fakeQuery(rows) {
  const calls = []
  const query = async (sql, params) => {
    calls.push({ sql, params })
    const m = / LIMIT (\d+)$/.exec(sql)
    return rows.slice(0, m ? Number(m[1]) : rows.length).map(r => ({ ...r }))
  }
  return { query, calls }
}
const run = (q, extra = {}) => {
  const f = fakeQuery(extra.rows || ROWS)
  return S.searchIds({ query: f.query, idExpr: 'l.id', scopeSql: SCOPE, scopeParams: SCOPE_PARAMS, fieldMap: FIELDS, q, ...extra, rows: undefined })
    .then(out => ({ out, calls: f.calls }))
}
const ids = async (q, extra) => (await run(q, extra)).out.ids

async function main() {
  // The SELECT: id and each alias's expression, the route's scope and params, LIMIT cap+1.
  const first = await run('flash')
  check('select sql', first.calls[0].sql, 'SELECT (l.id) AS `id`, (l.line_number) AS `line`, (l.wbs_code) AS `wbs`, (l.description) AS `desc`, ' +
    '(l.item_type) AS `type`, (l.item_ref) AS `tag`, (l.status) AS `status`, (l.po_ref) AS `po` ' + SCOPE + ' LIMIT 5001')
  check('scope params passed as given', first.calls[0].params, [7, 2])
  check('one query', first.calls.length, 1)
  check('result shape', first.out, { ids: [9001], fuzzy: true, queryTruncated: false })
  const inj = await run("x'; DROP TABLE mto_lines; --")
  check('q never reaches the SQL', inj.calls[0].sql, first.calls[0].sql)

  // Empty q: null, no query.
  for (const q of ['', '   ', 'OR', '|', undefined, null]) {
    const r = await run(q)
    check('empty q ' + JSON.stringify(q), [r.out, r.calls.length], [null, 0])
  }

  // AND, OR and |
  check('AND', await ids('flash vertical'), [9001])
  check('AND across columns', await ids('valve v-103'), [9005])
  check('AND, no row has both', await ids('flange drum'), [])
  check('OR', await ids('flash OR flange'), [9001, 9003])
  check('|', await ids('flash | flange'), [9001, 9003])
  check('AND binds tighter', await ids('pumps motors OR café'), [9004, 9006])

  // Field filters
  check('desc:valve', await ids('desc:valve'), [9005])
  check('tag:v-10', await ids('tag:v-10'), [9001, 9005])
  check('po:2024', await ids('po:2024'), [9001, 9006])
  check('field restricts the column', await ids('line:valve'), [])

  // Code prefix
  check('wbs:02', await ids('wbs:02'), [9001, 9002, 9003, 9005, 9006])
  check('wbs:02.01', await ids('wbs:02.01'), [9001, 9002, 9006])
  check('wbs:02.', await ids('wbs:02.'), [9001, 9002, 9005, 9006])
  check('wbs:12 (not 02 inside)', await ids('wbs:12'), [9004])

  // Enum: the whole value
  check('status:rfq', await ids('status:rfq'), [9002, 9004, 9005, 9006])
  check('status:rf', await ids('status:rf'), [])
  check('type:equipment', await ids('type:equipment'), [9001, 9006])

  // Typos (letters-only words of 5+) and digit words (exact)
  check('typo substitution', await ids('stabilizer'), [9002])
  check('typo transposition', await ids('flahs'), [9001])
  check('typo in a field value', await ids('desc:condensste'), [9002])
  check('accent folded', await ids('facade'), [9004])
  check('no typo for a 4-letter word', await ids('drim'), [])
  check('digit word exact: v-104', await ids('v-104'), [])
  check('digit word exact: p-101b', await ids('p-101b'), [])
  check('digit word exact: p-101a', await ids('p-101a'), [9006])
  check('% and _ literal', await ids('100% tested_ok'), [9005])

  // Phrase
  check('phrase', await ids('"flash drum"'), [9001])
  check('phrase order', await ids('"drum flash"'), [])

  // Empty result
  check('empty result', (await run('zzzzqqq')).out, { ids: [], fuzzy: true, queryTruncated: false })

  // Cap fallback: more than cap rows
  const over = await run('flash', { cap: 5 })
  check('cap 5 of 6 rows: fallback', over.out, { fallback: true })
  check('cap 5: LIMIT 6', / LIMIT 6$/.test(over.calls[0].sql), true)
  check('cap 6 of 6 rows: fuzzy', (await run('flash', { cap: 6 })).out, { ids: [9001], fuzzy: true, queryTruncated: false })
  check('cap 0', (await run('flash', { cap: 0 })).out, { fallback: true })

  // Unknown field: likeClause's message, no query
  const unk = await run('colour:red flash')
  check('unknown field', unk.out, { error: 'Unknown field "colour". Allowed: line, wbs, desc, type, tag, status, po' })
  check('unknown field: same message as likeClause', unk.out.error, S.likeClause(S.parse('colour:red flash'), FIELDS).error)
  check('unknown field: no query', unk.calls.length, 0)

  // compute adds rag before matching; rag has no column, so it is not selected
  const RAG_FIELDS = { ...FIELDS, rag: { flag: 'enum' } }
  const compute = rows => { for (const r of rows) { r.rag = r.status === 'rfq' ? 'red' : 'green'; r.secret = 'hiddenword' } }
  const withRag = (q, more) => run(q, { fieldMap: RAG_FIELDS, compute, ...more })
  const rag = await withRag('rag:red')
  check('compute: rag:red', rag.out.ids, [9002, 9004, 9005, 9006])
  check('compute: rag not selected', rag.calls[0].sql.includes('rag'), false)
  check('compute: rag:green valve', (await withRag('rag:green OR valve')).out.ids, [9001, 9003, 9005])
  check('compute: plain word matches rag', (await withRag('green')).out.ids, [9001, 9003])
  check('compute: a key outside the fieldMap is not searched', (await withRag('hiddenword')).out.ids, [])
  const asyncCompute = async rows => { await null; for (const r of rows) r.rag = r.id === 9003 ? 'amber' : 'green' }
  check('async compute', (await withRag('rag:amber', { compute: asyncCompute })).out.ids, [9003])
  check('compute not run on fallback', await (async () => { let ran = false
    await run('flash', { cap: 1, compute: () => { ran = true } }); return ran })(), false)

  // id and other keys are not searched by plain words
  check('id not searched', await ids('9001'), [])

  // queryTruncated: more than 10 terms, or more than 200 characters
  check('11 terms', (await run('a b c d e f g h i j k')).out.queryTruncated, true)
  check('201 characters', (await run('flash ' + 'x'.repeat(195))).out.queryTruncated, true)
  check('10 terms', (await run('l l l l l l l l l l')).out, { ids: [9001, 9002, 9003, 9004, 9005, 9006], fuzzy: true, queryTruncated: false })

  // Duplicate ids from a join come back once, in query order
  const dup = [ROWS[0], { ...ROWS[0], tag: 'X-1' }, ROWS[4]]
  check('dedupe', await ids('wbs:02', { rows: dup }), [9001, 9005])

  // Route-code guards (programming errors, not client input)
  const throws = async extra => { try { await run('flash', extra); return false } catch (e) { return true } }
  check('alias id refused', await throws({ fieldMap: { id: { column: 'l.id' } } }), true)
  check('upper-case alias refused', await throws({ fieldMap: { Desc: { column: 'l.description' } } }), true)
  check('alias with a backquote refused', await throws({ fieldMap: { 'a`b': { column: 'l.description' } } }), true)
  check('scope must start with FROM', await throws({ scopeSql: 'WHERE 1=1' }), true)
  check('cap must be whole', await throws({ cap: 2.5 }), true)
  check('cap must not be negative', await throws({ cap: -1 }), true)

  console.log(`server tableSearch SQL paths: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.log('FAIL (threw) ' + (e && e.stack || e)); process.exit(1) })
