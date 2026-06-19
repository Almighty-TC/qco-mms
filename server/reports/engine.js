// ─── REPORTS — QUERY ENGINE ──────────────────────────────────────────────────
// Builds and runs a report query from a dataset + a config object. This is the
// ONLY place report SQL is assembled, and it is built EXCLUSIVELY from the
// dataset whitelist (datasets.js): client input selects column KEYS and operator
// tokens from fixed sets — every value is a bound parameter. No client string is
// ever concatenated into SQL. Used identically by curated reports and the ad-hoc
// builder, so they share one audited code path.
const { DATASETS } = require('./datasets')

// ─── OPERATOR WHITELIST ──────────────────────────────────────────────────────
// token → builder(sqlExpr) → { clause, params } given the raw value(s).
const OPS = {
  eq:       (e, v) => ({ clause: `${e} = ?`,            params: [v] }),
  ne:       (e, v) => ({ clause: `${e} <> ?`,           params: [v] }),
  gt:       (e, v) => ({ clause: `${e} > ?`,            params: [v] }),
  gte:      (e, v) => ({ clause: `${e} >= ?`,           params: [v] }),
  lt:       (e, v) => ({ clause: `${e} < ?`,            params: [v] }),
  lte:      (e, v) => ({ clause: `${e} <= ?`,           params: [v] }),
  contains: (e, v) => ({ clause: `${e} LIKE ?`,         params: [`%${v}%`] }),
  isnull:   (e)    => ({ clause: `${e} IS NULL`,        params: [] }),
  notnull:  (e)    => ({ clause: `${e} IS NOT NULL`,    params: [] }),
  in:       (e, v) => {
    const arr = Array.isArray(v) ? v : [v]
    if (!arr.length) return { clause: '1=0', params: [] }   // empty IN → match nothing
    return { clause: `${e} IN (${arr.map(() => '?').join(',')})`, params: arr }
  },
  between:  (e, v) => {
    const arr = Array.isArray(v) ? v : []
    if (arr.length !== 2) throw err(`'between' needs [from, to]`)
    return { clause: `${e} BETWEEN ? AND ?`, params: [arr[0], arr[1]] }
  },
}
const AGG_FNS = new Set(['count', 'sum', 'avg', 'min', 'max'])
const MAX_LIMIT = 5000

function err(msg) { const e = new Error(msg); e.status = 422; return e }
// Whitelist membership MUST be own-property only — a plain `obj[key]` truthy check
// lets inherited keys (constructor, __proto__, toString…) pass and reach SQL-building
// as `undefined`. own() is the single guard for every registry/column/operator lookup.
const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)

// ─── BUILD + RUN ─────────────────────────────────────────────────────────────
// cfg: { datasetId, columns?, filters?, groupBy?, aggregations?, sort?, limit?, offset? }
//   columns      — array of column keys (defaults to dataset.defaultColumns)
//   filters      — [{ col, op, value }]  (col must be in dataset.filterable)
//   groupBy      — array of column keys → grouped/aggregate mode
//   aggregations — [{ fn, col?, as }]    (col required unless fn==='count')
//   sort         — { col, dir }          (col must be a selected output key)
// Returns { columns:[{key,label,type}], rows, total, grouped }.
async function runReport(conn, pid, cfg = {}) {
  if (!own(DATASETS, cfg.datasetId)) throw err(`Unknown dataset "${cfg.datasetId}"`)
  const ds = DATASETS[cfg.datasetId]

  const params = [pid]                          // dataset.from always opens with project_id = ?
  const where = []

  // ── FILTERS (col + op whitelisted; values bound) ──────────────────────────
  for (const f of (cfg.filters || [])) {
    if (!ds.filterable.includes(f.col) || !own(ds.columns, f.col)) throw err(`Column "${f.col}" is not filterable on ${cfg.datasetId}`)
    if (!own(OPS, f.op)) throw err(`Unknown operator "${f.op}"`)
    const op = OPS[f.op]
    const expr = ds.columns[f.col].sql
    const { clause, params: p } = op(expr, f.value)
    where.push(clause); params.push(...p)
  }
  const whereSql = where.length ? ' AND ' + where.join(' AND ') : ''

  const grouped = Array.isArray(cfg.groupBy) && cfg.groupBy.length > 0

  if (grouped) {
    // ── GROUPED / AGGREGATE MODE ────────────────────────────────────────────
    const selParts = [], outCols = [], groupExprs = []
    for (const key of cfg.groupBy) {
      if (!own(ds.columns, key)) throw err(`Unknown group column "${key}"`)
      const c = ds.columns[key]
      selParts.push(`${c.sql} AS \`${key}\``)
      groupExprs.push(c.sql)
      outCols.push({ key, label: c.label, type: c.type })
    }
    const aggs = cfg.aggregations && cfg.aggregations.length
      ? cfg.aggregations
      : [{ fn: 'count', as: 'count' }]            // default: row count per group
    for (const a of aggs) {
      const fn = String(a.fn || '').toLowerCase()
      if (!AGG_FNS.has(fn)) throw err(`Unknown aggregate "${a.fn}"`)
      const as = sanitizeAlias(a.as || (a.col ? `${fn}_${a.col}` : fn))
      let expr
      if (fn === 'count') {
        if (a.col && !own(ds.columns, a.col)) throw err(`Unknown aggregate column "${a.col}"`)
        expr = a.col ? `COUNT(${ds.columns[a.col].sql})` : 'COUNT(*)'
      } else {
        if (!own(ds.columns, a.col)) throw err(`Aggregate ${fn} needs a valid column`)
        expr = `${fn.toUpperCase()}(${ds.columns[a.col].sql})`
      }
      selParts.push(`${expr} AS \`${as}\``)
      outCols.push({ key: as, label: a.label || aliasLabel(fn, a.col, ds), type: 'number' })
    }
    let sql = `SELECT ${selParts.join(', ')} ${ds.from}${whereSql} GROUP BY ${groupExprs.join(', ')}`
    sql += orderBy(cfg.sort, outCols)
    sql += ` LIMIT ${MAX_LIMIT}`
    const [rows] = await conn.query(sql, params)
    return { columns: outCols, rows, total: rows.length, grouped: true }
  }

  // ── FLAT / ROW MODE ─────────────────────────────────────────────────────────
  const keys = (cfg.columns && cfg.columns.length ? cfg.columns : ds.defaultColumns)
    .filter(k => own(ds.columns, k))
  if (!keys.length) throw err('No valid columns selected')
  const outCols = keys.map(k => ({ key: k, label: ds.columns[k].label, type: ds.columns[k].type }))
  const selParts = keys.map(k => `${ds.columns[k].sql} AS \`${k}\``)

  const limit = clamp(cfg.limit, 1, MAX_LIMIT, 1000)
  const offset = Math.max(0, Number(cfg.offset) || 0)

  // total (for pagination) — COUNT(*) over the same filtered base
  const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total ${ds.from}${whereSql}`, params)

  let sql = `SELECT ${selParts.join(', ')} ${ds.from}${whereSql}`
  sql += orderBy(cfg.sort || ds.defaultSort, outCols)
  sql += ` LIMIT ${limit} OFFSET ${offset}`
  const [rows] = await conn.query(sql, params)
  return { columns: outCols, rows, total, grouped: false }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
// ORDER BY only on a column that is in the output set (key validated against outCols).
function orderBy(sort, outCols) {
  if (!sort || !sort.col) return ''
  const hit = outCols.find(c => c.key === sort.col)
  if (!hit) return ''
  const dir = String(sort.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC'
  return ` ORDER BY \`${hit.key}\` ${dir}`           // backticked validated alias — safe
}
function clamp(v, lo, hi, dflt) { const n = Number(v); if (!Number.isFinite(n)) return dflt; return Math.min(hi, Math.max(lo, Math.trunc(n))) }
function sanitizeAlias(s) { return String(s).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40) || 'agg' }
function aliasLabel(fn, col, ds) {
  if (fn === 'count') return col ? `Count ${ds.columns[col]?.label || col}` : 'Count'
  const cap = fn.charAt(0).toUpperCase() + fn.slice(1)
  return `${cap} ${ds.columns[col]?.label || col}`
}

module.exports = { runReport }
