// 3T167 — Meetings & RFIs visibility for external roles in server/routes/rfiMeeting.js: an external user sees a
// record only when it is assigned to, raised by or created by them, or they are an attendee by user_id, or own one
// of its action items (attendees entered by name only do not count). The list (WHERE and total) and the detail,
// attendees, actions and both PATCHes (404 "Not found", 3T168) for every external role and every branch; the external
// write routes on visible records and every internal-role answer equal to git show HEAD. The real router over a fake db that evaluates the WHERE
// conditions itself (no database). Exit code 1 on any failure.
// Usage: node tests/p2/rfiVisibility.test.cjs [--mutation]
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')
const REPO = path.join(__dirname, '../..')
const ROOT = path.join(REPO, 'server')
const RM = path.join(ROOT, 'routes/rfiMeeting.js')
const RM_SRC = fs.readFileSync(RM, 'utf8')
const RM_HEAD = execFileSync('git', ['-C', REPO, 'show', 'HEAD:server/routes/rfiMeeting.js'], { encoding: 'utf8' })

// ── fake data: per external user one record for each branch, a name-only attendee meeting and a record in
// project 28 assigned to them; records linked to no external user; users 4 (staff) and 999 (another party) ──
const EXT = [{ id: 711, role: 'vendor' }, { id: 685, role: 'freight_forwarder' }, { id: 713, role: 'site_contractor' }, { id: 714, role: 'subcontractor' }]
const INTERNAL = [{ id: 4, role: 'admin' }, { id: 24, role: 'project_manager' }, { id: 27, role: 'viewer' }]
const STAFF = 4, OTHER = 999
const RECORDS = {}, ATTENDEES = [], ACTIONS = [], BRANCH = {}
let nid = 100, aid = 0, xid = 0
const add = o => { const id = ++nid; RECORDS[id] = { id, project_id: 27, record_type: 'rfi', ref: 'RFI-' + id, title: 'Title ' + id, description: null, status: 'open', priority: 'normal',
  link_type: null, link_id: null, link_label: null, raised_by: STAFF, assigned_to: OTHER, raised_date: '2026-10-01', due_date: null, closed_date: null, response: null, created_by: STAFF, ...o }; return id }
const attend = (record_id, user_id, name) => ATTENDEES.push({ id: ++aid, record_id, user_id, attendee_name: name, attendee_org: 'Org', attended: 1 })
const act = (record_id, assigned_to) => ACTIONS.push({ id: ++xid, record_id, seq: 1, description: 'Action ' + xid, assigned_to, status: 'open', due_date: null, closed_date: null })
for (const u of EXT) {
  const b = BRANCH[u.id] = {}
  b.assigned = add({ assigned_to: u.id })
  b.raised = add({ raised_by: u.id })
  b.created = add({ created_by: u.id })
  b.attendee = add({ record_type: 'meeting', ref: 'MTG-' + (nid + 1), status: 'held' }); attend(b.attendee, u.id, 'Person ' + u.id); act(b.attendee, OTHER)   // visible, its action is someone else's
  b.action = add({ record_type: 'meeting', ref: 'MTG-' + (nid + 1), status: 'held' }); act(b.action, u.id)
  b.nameOnly = add({ record_type: 'meeting', ref: 'MTG-' + (nid + 1), status: 'scheduled' }); attend(b.nameOnly, null, 'Person ' + u.id)
  b.otherProject = add({ project_id: 28, assigned_to: u.id })
}
const UNRELATED = add({}), UNRELATED_MTG = add({ record_type: 'meeting', ref: 'MTG-' + (nid + 1), status: 'held' })
attend(UNRELATED_MTG, OTHER, 'Other person'); act(UNRELATED_MTG, OTHER)
const BRANCHES = ['assigned', 'raised', 'created', 'attendee', 'action']
const visibleIds = uid => BRANCHES.map(k => BRANCH[uid][k]).sort((a, b) => a - b)

// ── a small WHERE evaluator: top-level AND, parenthesised OR groups, `col = ?`, LIKE, the two EXISTS shapes ──
const norm = s => s.replace(/\s+/g, ' ').trim()
const qmarks = s => (s.match(/\?/g) || []).length
function splitTop(s, sep) {
  const out = []; let depth = 0, cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++; else if (ch === ')') depth--
    if (depth === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue }
    cur += ch
  }
  out.push(cur); return out.map(x => x.trim())
}
const wrapped = c => { if (!c.startsWith('(') || !c.endsWith(')')) return false; let d = 0; for (let i = 0; i < c.length - 1; i++) { if (c[i] === '(') d++; else if (c[i] === ')') d--; if (d === 0) return false } return true }
const CHILD = { meeting_attendees: () => ATTENDEES, meeting_actions: () => ACTIONS }
function evalCond(c, rec, ps) {
  if (wrapped(c)) {
    const parts = splitTop(c.slice(1, -1), ' OR ')
    let i = 0; return parts.some(p => { const n = qmarks(p), r = evalCond(p, rec, ps.slice(i, i + n)); i += n; return r })
  }
  let m
  if ((m = c.match(/^(?:r\.)?(\w+) ?= ?\?$/))) return rec[m[1]] === ps[0]
  if ((m = c.match(/^(?:r\.)?(\w+) LIKE \?$/))) return String(rec[m[1]] ?? '').includes(String(ps[0]).replace(/%/g, ''))
  if ((m = c.match(/^EXISTS \(SELECT 1 FROM (meeting_attendees|meeting_actions) (\w+) WHERE \2\.record_id = r\.id AND \2\.(\w+) = \?\)$/))) return CHILD[m[1]]().some(x => x.record_id === rec.id && x[m[3]] === ps[0])
  if (/^\? IS NOT NULL$/.test(c)) return ps[0] != null
  throw new Error('unexpected condition: ' + c)
}
function evalWhere(where, rec, params) {
  const conds = splitTop(where, ' AND '); let i = 0, ok = true
  for (const c of conds) { const n = qmarks(c); if (!evalCond(c, rec, params.slice(i, i + n))) ok = false; i += n }
  return ok
}
const recs = (where, params) => Object.values(RECORDS).filter(r => evalWhere(where, r, params))
const nameOf = id => (id == null ? null : 'User ' + id)

let calls = []
const fakeDb = { query: async (sql, params = []) => {
  const q = norm(sql)
  calls.push({ q, params })
  let m
  if (/^SELECT \w+ AS allowed FROM user_permission_overrides/.test(q) || /^SELECT can_approve AS a FROM user_permission_overrides/.test(q)) return [[], []]
  if (/^SELECT \w+ AS allowed FROM role_permissions/.test(q)) return [[{ allowed: 1 }], []]
  if (/^SELECT can_approve AS a FROM role_permissions/.test(q)) return [[{ a: 1 }], []]
  if (/^SELECT id FROM user_wbs_access WHERE user_id = \? AND project_id = \? LIMIT 1$/.test(q)) return [Number(params[1]) === 27 ? [{ id: 1 }] : [], []]
  if (/^SELECT `value` AS v FROM system_settings WHERE `key`='rfi_amber_days'$/.test(q)) return [[{ v: '3' }], []]
  if ((m = q.match(/^SELECT COUNT\(\*\) AS total FROM rfi_meeting_records(?: r)? WHERE (.*)$/))) return [[{ total: recs(m[1], params).length }], []]
  if ((m = q.match(/^SELECT r\.id, r\.project_id, r\.record_type, .* FROM rfi_meeting_records r LEFT JOIN users ur ON ur\.id = r\.raised_by LEFT JOIN users ua ON ua\.id = r\.assigned_to WHERE (.*) ORDER BY r\.(\w+) (ASC|DESC), r\.id (?:ASC|DESC) LIMIT \? OFFSET \?$/))) {
    const [limit, offset] = params.slice(-2), dir = m[3] === 'ASC' ? 1 : -1, col = m[2]
    const rows = recs(m[1], params.slice(0, -2)).sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : a.id - b.id) * dir)
    return [rows.slice(offset, offset + limit).map(r => ({ id: r.id, project_id: r.project_id, record_type: r.record_type, ref: r.ref, title: r.title, status: r.status, priority: r.priority,
      link_type: r.link_type, link_id: r.link_id, link_label: r.link_label, raised_by: r.raised_by, assigned_to: r.assigned_to, raised_by_name: nameOf(r.raised_by), assigned_to_name: nameOf(r.assigned_to),
      raised_date: r.raised_date, due_date: r.due_date, closed_date: r.closed_date })), []]
  }
  if ((m = q.match(/^SELECT r\.id FROM rfi_meeting_records r WHERE (.*) LIMIT 1$/))) return [recs(m[1], params).slice(0, 1).map(r => ({ id: r.id })), []]
  if (/^SELECT r\.\*, ur\.full_name AS raised_by_name, ua\.full_name AS assigned_to_name FROM rfi_meeting_records r LEFT JOIN users ur ON ur\.id = r\.raised_by LEFT JOIN users ua ON ua\.id = r\.assigned_to WHERE r\.id=\? AND r\.project_id=\?$/.test(q)) {
    const r = RECORDS[params[0]]; return [r && r.project_id === params[1] ? [{ ...r, raised_by_name: nameOf(r.raised_by), assigned_to_name: nameOf(r.assigned_to) }] : [], []]
  }
  if (/^SELECT id, user_id, attendee_name, attendee_org, attended FROM meeting_attendees WHERE record_id=\? ORDER BY id$/.test(q)) return [ATTENDEES.filter(a => a.record_id === params[0]).map(({ record_id, ...a }) => a), []]
  if (/^SELECT a\.id, a\.seq, a\.description, a\.assigned_to, u\.full_name AS assigned_to_name, a\.status, .* FROM meeting_actions a LEFT JOIN users u ON u\.id = a\.assigned_to WHERE a\.record_id=\? ORDER BY a\.seq$/.test(q))
    return [ACTIONS.filter(a => a.record_id === params[0]).map(({ record_id, ...a }) => ({ ...a, assigned_to_name: nameOf(a.assigned_to) })), []]
  if (/^SELECT \* FROM rfi_meeting_records WHERE id=\? AND project_id=\?$/.test(q)) { const r = RECORDS[params[0]]; return [r && r.project_id === params[1] ? [{ ...r }] : [], []] }
  if (/^SELECT id, record_type, assigned_to FROM rfi_meeting_records WHERE id=\? AND project_id=\?$/.test(q)) { const r = RECORDS[params[0]]; return [r && r.project_id === params[1] ? [{ id: r.id, record_type: r.record_type, assigned_to: r.assigned_to }] : [], []] }
  if (/^SELECT \* FROM meeting_actions WHERE id=\? AND record_id=\?$/.test(q)) { const a = ACTIONS.find(x => x.id === params[0] && x.record_id === params[1]); return [a ? [{ ...a }] : [], []] }
  if (/^(INSERT|UPDATE|DELETE) /.test(q)) return [{ insertId: 900, affectedRows: 1 }, undefined]
  throw new Error('unexpected query: ' + q.slice(0, 120))
} }
// ── stubs and the call helper ──
const stub = (file, exports) => { require.cache[file] = { id: file, filename: file, loaded: true, exports } }
stub(require.resolve(path.join(ROOT, 'db.js')), fakeDb)
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'))
const { JWT_SECRET } = require(path.join(ROOT, 'middleware/auth'))
function compile(src) {
  const m = new Module(RM, module); m.filename = RM; m.paths = Module._nodeModulePaths(path.dirname(RM)); m._compile(src, RM); return m.exports
}
function call(router, user, method, url, body) {
  return new Promise(resolve => {
    const [, qs] = url.split('?')
    const req = { method, url, originalUrl: '/api/rfi-meeting' + url, headers: { authorization: 'Bearer ' + jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '10m' }) },
      query: Object.fromEntries(new URLSearchParams(qs || '')), body: body || {}, ip: '127.0.0.1' }
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, getHeader(k) { return this.headers[k] },
      status(c) { this.statusCode = c; return this }, json(o) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(o ?? null)) }) },
      send(b) { resolve({ status: this.statusCode, body: b }) }, end(b) { resolve({ status: this.statusCode, body: String(b) }) } }
    router(req, res, err => resolve({ status: err ? 500 : 404, body: { fellThrough: true, err: err && err.message } }))
  })
}
const ids = r => JSON.stringify((r.body?.data || []).map(x => x.id).sort((a, b) => a - b))
const NOT_FOUND = '{"error":"Not found"}'

async function suite(src) {
  const R = compile(src)
  let pass = 0, fail = 0; const failed = []
  const check = (ok, name) => { if (ok) pass++; else { fail++; failed.push(name) } }
  const go = async (u, method, url, body) => { calls = []; return call(R, u, method, url, body) }
  const ran = re => calls.some(c => re.test(c.q))
  for (const u of EXT) {
    const b = BRANCH[u.id], want = JSON.stringify(visibleIds(u.id)), tag = `${u.role} ${u.id}`
    let r = await go(u, 'GET', '/27?limit=1000')
    check(r.status === 200 && ids(r) === want, `${tag} list: exactly its five linked records`)
    check(r.body.total === 5, `${tag} list: total counts the visible records only`)
    const cq = calls.find(c => /^SELECT COUNT\(\*\)/.test(c.q))
    check(cq && JSON.stringify(cq.params) === JSON.stringify([27, u.id, u.id, u.id, u.id, u.id]), `${tag} list: the predicate's parameters in the total`)
    for (const k of BRANCHES) check((r.body.data || []).some(x => x.id === b[k]), `${tag} list: the ${k} branch`)
    check(!(r.body.data || []).some(x => x.id === b.nameOnly), `${tag} list: an attendee by name only does not count`)
    check(!(r.body.data || []).some(x => x.id === UNRELATED || x.id === UNRELATED_MTG), `${tag} list: records linked to no external user hidden`)
    check(!(r.body.data || []).some(x => EXT.some(o => o.id !== u.id && visibleIds(o.id).includes(x.id))), `${tag} list: no other external user's records`)
    r = await go(u, 'GET', '/27?limit=1000&type=meeting')
    check(ids(r) === JSON.stringify([b.attendee, b.action].sort((x, y) => x - y)) && r.body.total === 2, `${tag} list, type meeting: attendee and action meetings`)
    r = await go(u, 'GET', `/27?limit=1000&q=RFI-${b.assigned}`)
    check(ids(r) === `[${b.assigned}]` && r.body.total === 1, `${tag} list, search: filters kept with the predicate`)
    r = await go(u, 'GET', `/27?limit=1000&q=RFI-${UNRELATED}`)
    check(r.body.data.length === 0 && r.body.total === 0, `${tag} list, search for a hidden record: nothing`)
    r = await go(u, 'GET', '/27?limit=2&page=2&sort_col=ref&sort_dir=asc')
    check(r.body.total === 5 && r.body.data.length === 2, `${tag} list, paging: within the visible set`)
    for (const k of BRANCHES) {
      r = await go(u, 'GET', `/27/${b[k]}`)
      check(r.status === 200 && r.body.id === b[k], `${tag} detail, ${k} branch: 200`)
    }
    const hidden = [[b.nameOnly, 'name-only attendee meeting'], [UNRELATED, 'unrelated record'], [UNRELATED_MTG, 'unrelated meeting'], [b.otherProject, 'its record in another project'],
      [BRANCH[EXT.find(o => o.id !== u.id).id].assigned, "another external user's record"], [99999, 'a missing record']]
    for (const [id, name] of hidden) {
      r = await go(u, 'GET', `/27/${id}`)
      check(r.status === 404 && JSON.stringify(r.body) === NOT_FOUND && !ran(/^SELECT r\.\*/), `${tag} detail, ${name}: 404 Not found, nothing read`)
    }
    for (const [id, name] of [[b.attendee, 'attendee meeting'], [b.action, 'action meeting']]) {
      r = await go(u, 'GET', `/27/${id}/attendees`); const ra = r
      r = await go(u, 'GET', `/27/${id}/actions`)
      check(ra.status === 200 && Array.isArray(ra.body) && r.status === 200 && Array.isArray(r.body) && r.body.length === ACTIONS.filter(a => a.record_id === id).length, `${tag} ${name}: attendees and actions 200`)
    }
    for (const [id, name] of [[b.nameOnly, 'name-only attendee meeting'], [UNRELATED_MTG, 'unrelated meeting']]) {
      r = await go(u, 'GET', `/27/${id}/attendees`)
      check(r.status === 404 && JSON.stringify(r.body) === NOT_FOUND && !ran(/FROM meeting_attendees WHERE record_id/), `${tag} attendees of the ${name}: 404, nothing read`)
      r = await go(u, 'GET', `/27/${id}/actions`)
      check(r.status === 404 && JSON.stringify(r.body) === NOT_FOUND && !ran(/FROM meeting_actions a/), `${tag} actions of the ${name}: 404, nothing read`)
    }
    // 3T168: both PATCHes — a record they cannot see: 404 and nothing written; visible but not theirs: the existing 403
    const writes = () => calls.filter(c => /^(INSERT|UPDATE|DELETE)/.test(c.q)).length
    for (const [id, name] of hidden) {
      r = await go(u, 'PATCH', `/27/${id}/transition`, { to: 'answered' })
      check(r.status === 404 && JSON.stringify(r.body) === NOT_FOUND && writes() === 0 && !ran(/^SELECT \* FROM rfi_meeting_records/), `${tag} transition, ${name}: 404 Not found, nothing written`)
    }
    for (const [id, name] of [[UNRELATED_MTG, 'unrelated meeting'], [b.nameOnly, 'name-only attendee meeting']]) {
      const a = ACTIONS.find(x => x.record_id === id) || { id: 1 }
      r = await go(u, 'PATCH', `/27/${id}/actions/${a.id}`, { to: 'done' })
      check(r.status === 404 && JSON.stringify(r.body) === NOT_FOUND && writes() === 0 && !ran(/^SELECT \* FROM meeting_actions/), `${tag} action update, ${name}: 404 Not found, nothing written`)
    }
    r = await go(u, 'PATCH', `/27/${b.raised}/transition`, { to: 'answered' })
    check(r.status === 403 && r.body.error === 'You can only act on records assigned to you' && writes() === 0, `${tag} transition, visible but not assigned to them: 403, nothing written`)
    r = await go(u, 'PATCH', `/27/${b.attendee}/actions/${ACTIONS.find(x => x.record_id === b.attendee).id}`, { to: 'done' })
    check(r.status === 403 && r.body.error === 'You can only update actions assigned to you' && writes() === 0, `${tag} action update, visible meeting, someone else's action: 403, nothing written`)
    r = await go(u, 'PATCH', `/27/${b.assigned}/transition`, { to: 'answered', response: 'ok' })
    check(r.status === 200 && r.body.status === 'answered' && ran(/^UPDATE rfi_meeting_records SET status=\?/), `${tag} transition, assigned to them: 200`)
    r = await go(u, 'PATCH', `/27/${b.action}/actions/${ACTIONS.find(x => x.record_id === b.action).id}`, { to: 'in_progress' })
    check(r.status === 200 && ran(/^UPDATE meeting_actions SET status=\?/), `${tag} action update, their own action: 200`)
    r = await go(u, 'GET', '/28?limit=1000')
    check(r.status === 403, `${tag} list of a project without a grant: 403 (project scope)`)
  }
  for (const u of INTERNAL) {
    const r = await go(u, 'GET', '/27?limit=1000')
    check(r.status === 200 && r.body.total === Object.values(RECORDS).filter(x => x.project_id === 27).length && !calls.some(c => /meeting_attendees ma/.test(c.q)), `${u.role} list: every project 27 record, no predicate`)
  }
  return { pass, fail, failed }
}

// Internal roles, and the external write routes on records they can see: answers and queries equal to git show
// HEAD apart from the visibility check's own query (the total's table alias "r" normalised away).
async function sameAsHead(src) {
  const NEW = compile(src), OLD = compile(RM_HEAD)
  const reqs = []
  for (const u of INTERNAL) {
    for (const url of ['/27?limit=1000', '/27?limit=1000&type=meeting', '/27?limit=3&page=2&sort_col=ref&sort_dir=asc', `/27?q=RFI-${UNRELATED}`, '/27?status=open', '/28?limit=1000',
      `/27/${UNRELATED}`, `/27/${UNRELATED_MTG}`, `/27/${BRANCH[711].nameOnly}`, `/27/${BRANCH[711].otherProject}`, '/27/99999',
      `/27/${UNRELATED_MTG}/attendees`, `/27/${UNRELATED_MTG}/actions`, `/27/${BRANCH[714].attendee}/attendees`, `/27/${BRANCH[711].action}/actions`]) reqs.push([u, 'GET', url])
    if (u.role !== 'viewer') reqs.push([u, 'PATCH', `/27/${UNRELATED}/transition`, { to: 'answered', response: 'x' }], [u, 'PATCH', `/27/${UNRELATED_MTG}/actions/${ACTIONS.find(a => a.record_id === UNRELATED_MTG).id}`, { to: 'in_progress' }])
  }
  for (const u of EXT) {
    const b = BRANCH[u.id]
    reqs.push([u, 'PATCH', `/27/${b.assigned}/transition`, { to: 'answered', response: 'r' }], [u, 'PATCH', `/27/${b.raised}/transition`, { to: 'answered' }],
      [u, 'PATCH', `/27/${b.action}/actions/${ACTIONS.find(a => a.record_id === b.action).id}`, { to: 'in_progress' }], [u, 'PATCH', `/27/${b.attendee}/actions/${ACTIONS.find(a => a.record_id === b.attendee).id}`, { to: 'done' }])
  }
  const al = s => s.replace('FROM rfi_meeting_records r WHERE', 'FROM rfi_meeting_records WHERE')
  let same = 0; const diffs = []
  for (const [u, m, url, body] of reqs) {
    calls = []; const a = await call(NEW, u, m, url, body); const qa = calls.filter(c => !/^SELECT r\.id FROM rfi_meeting_records r WHERE/.test(c.q)).map(c => al(c.q) + JSON.stringify(c.params))
    calls = []; const b = await call(OLD, u, m, url, body); const qb = calls.map(c => al(c.q) + JSON.stringify(c.params))
    if (JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(qa) === JSON.stringify(qb)) same++; else diffs.push(`${u.role} ${m} ${url} ${a.status}/${b.status}`)
  }
  return { same, total: reqs.length, diffs }
}

const MUTANTS = [
  ['drop the predicate in the list', s => s.replace("    if (isExternal(req)) { where.push(VISIBLE_TO_USER); params.push(...visibleParams(req.user.id)) }   // 3T167\n", '')],
  ['drop the detail, attendees and actions check', s => s.replace('  if (!isExternal(req)) return next()\n  try {', '  if (true) return next()\n  try {')],
  ['drop the check on the detail only', s => s.replace("router.get('/:projectId/:id', requirePermission('rfi_meeting', 'can_view'), externalVisible, async", "router.get('/:projectId/:id', requirePermission('rfi_meeting', 'can_view'), async")],
  ['drop the check on attendees only', s => s.replace("router.get('/:projectId/:id/attendees', requirePermission('rfi_meeting', 'can_view'), externalVisible, async", "router.get('/:projectId/:id/attendees', requirePermission('rfi_meeting', 'can_view'), async")],
  ['drop the check on actions only', s => s.replace("router.get('/:projectId/:id/actions', requirePermission('rfi_meeting', 'can_view'), externalVisible, async", "router.get('/:projectId/:id/actions', requirePermission('rfi_meeting', 'can_view'), async")],
  ['drop the assigned branch', s => s.replace('(r.assigned_to = ? OR r.raised_by', '(r.nobody = ? OR r.raised_by')],
  ['drop the raised branch', s => s.replace('OR r.raised_by = ? OR r.created_by', 'OR r.nobody = ? OR r.created_by')],
  ['drop the created branch', s => s.replace('OR r.created_by = ?\n', 'OR r.nobody = ?\n')],
  ['drop the attendee branch', s => s.replace('AND ma.user_id = ?)', 'AND ma.nobody = ?)')],
  ['drop the action branch', s => s.replace('AND mt.assigned_to = ?)', 'AND mt.nobody = ?)')],
  ['403 instead of 404', s => s.replace("if (!r) return res.status(404).json({ error: 'Not found' })", "if (!r) return res.status(403).json({ error: 'Not found' })")],
  ['another message for a hidden record', s => s.replace("if (!r) return res.status(404).json({ error: 'Not found' })", "if (!r) return res.status(404).json({ error: 'Record not found in this project' })")],
  ['total without the predicate', s => s.replace('`SELECT COUNT(*) AS total FROM rfi_meeting_records r WHERE ${whereSql}`, params)', '`SELECT COUNT(*) AS total FROM rfi_meeting_records r WHERE project_id = ?`, [pid])')],
  ['visibility check ignores the project', s => s.replace('WHERE r.id=? AND r.project_id=? AND ${VISIBLE_TO_USER} LIMIT 1', 'WHERE r.id=? AND ? IS NOT NULL AND ${VISIBLE_TO_USER} LIMIT 1')],
  ['3T168: no check on the transition', s => s.replace("router.patch('/:projectId/:id/transition', externalVisible, async", "router.patch('/:projectId/:id/transition', async")],
  ['3T168: no check on the action update', s => s.replace("router.patch('/:projectId/:id/actions/:actionId', externalVisible, async", "router.patch('/:projectId/:id/actions/:actionId', async")],
  ['predicate for internal roles too', s => s.replace('    if (isExternal(req)) { where.push(VISIBLE_TO_USER)', '    if (true) { where.push(VISIBLE_TO_USER)')],
]

;(async () => {
  const r = await suite(RM_SRC)
  const I = await sameAsHead(RM_SRC)
  r.failed.forEach(n => console.log('FAIL ' + n)); I.diffs.forEach(d => console.log('FAIL differs from HEAD: ' + d))
  const fail = r.fail + (I.same === I.total ? 0 : 1)
  console.log(`rfiVisibility: ${r.pass + (I.same === I.total ? 1 : 0)} passed, ${fail} failed (internal roles and the external write routes identical to HEAD on ${I.same} of ${I.total} requests, answers and queries)`)
  if (process.argv.includes('--mutation')) {
    let killed = 0
    for (const [name, mutate] of MUTANTS) {
      const m = mutate(RM_SRC)
      if (m === RM_SRC) { console.log(`mutant "${name}": NOT APPLIED`); continue }
      let bad
      try { const s = await suite(m); const i = await sameAsHead(m); bad = s.fail > 0 || i.same !== i.total } catch { bad = true }
      if (bad) killed++; else console.log(`mutant "${name}": SURVIVED`)
    }
    console.log(`mutation: ${killed}/${MUTANTS.length} killed`)
    if (killed !== MUTANTS.length) process.exitCode = 1
  }
  if (fail) process.exitCode = 1
})()
