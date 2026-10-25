// ─── WBS GRANT (3T169: contractor scoping) ───────────────────
// A user's user_wbs_access rows for a project. ALL means the whole project; otherwise a
// code c covers c and its descendants: code = c OR code LIKE 'c.%' (the dot boundary, so
// FLO.01 covers FLO.01.02 but not FLO.010), with LIKE wildcards escaped by '!'. Only
// site_contractor and subcontractor are narrowed by it (vendors are scoped by supplier,
// forwarders by SCN, internal roles are unchanged); a contractor with no rows, or with only
// code grants, sees nothing outside them.

const NARROWED = new Set(['site_contractor', 'subcontractor'])

// True for the roles whose project data is narrowed to their WBS grants.
const isNarrowed = role => NARROWED.has(role)

// { all, codes } for userId on projectId.
async function grants(db, userId, projectId) {
  const [rows] = await db.query(
    'SELECT wbs_code FROM user_wbs_access WHERE user_id=? AND project_id=?', [userId, projectId])
  const all = rows.some(r => r.wbs_code === 'ALL')
  const codes = [...new Set(rows.map(r => r.wbs_code).filter(c => c && c !== 'ALL'))]
  return { all, codes }
}

const escapeLike = s => String(s).replace(/[!%_]/g, ch => '!' + ch)

// { sql, params } for a WHERE condition on column col: '1=1' for ALL, '1=0' with no grant,
// else one (col = ? OR col LIKE ? ESCAPE '!') per code joined with OR.
function covers(col, g) {
  if (g.all) return { sql: '1=1', params: [] }
  if (!g.codes.length) return { sql: '1=0', params: [] }
  return {
    sql: '(' + g.codes.map(() => `(${col} = ? OR ${col} LIKE ? ESCAPE '!')`).join(' OR ') + ')',
    params: g.codes.flatMap(c => [c, escapeLike(c) + '.%']),
  }
}

// The same rule for one code in JavaScript (3T170: FMR lines and the create check).
const coversCode = (g, code) => g.all || (!!code && g.codes.some(c => code === c || code.startsWith(c + '.')))

module.exports = { isNarrowed, grants, covers, coversCode, escapeLike }
