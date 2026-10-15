// ─── EXTERNAL ROLE GATE (phase 1: default deny) ─────────────────────────────
// Mounted in index.js ahead of every /api router. For the four external roles a request
// passes only when (role, method, path) matches an ALLOW entry; everything else gets
// 403 { error: 'Not available to your role' }. Internal roles, requests without a token and
// requests with an invalid or expired token pass through untouched — the routers'
// own authenticateToken and permission checks answer those exactly as before.
//
// The token is verified with the same function and secret as authenticateToken
// (jwt.verify with JWT_SECRET from middleware/auth). Tokens are never logged.
//
// Paths are matched after /api, without the query string, case-insensitively and with an
// optional trailing slash (as Express routes them). A path with "//", a backslash, a "." or
// ".." segment, or an encoded dot, slash, backslash or NUL is refused for externals.
//
// ALLOW is a subset of each role's role_permissions grants, except the freight_forwarder's
// package and SCN-document writes, which logistics.js authorises by delegation or carrier
// (not by the matrix). Vendors get only the common entries until phase 2 (supplier scoping).
const jwt = require('jsonwebtoken')
const { JWT_SECRET } = require('../middleware/auth')

const EXTERNAL_ROLES = new Set(['vendor', 'freight_forwarder', 'site_contractor', 'subcontractor'])

const ALL = ['vendor', 'freight_forwarder', 'site_contractor', 'subcontractor']
const FF = ['freight_forwarder']
const SC = ['site_contractor']
const CONTRACTORS = ['site_contractor', 'subcontractor']
const re = s => new RegExp('^' + s + '/?$', 'i')
const ID = '\\d+'

// { roles, method, re, example } — example is a matching path (documentation and tests).
const ALLOW = [
  // ── every external role: own account, granted projects, RFI and meeting records ──
  { roles: ALL, method: 'POST',  re: re('/auth/change-password'), example: '/auth/change-password' },
  { roles: ALL, method: 'PUT',   re: re('/auth/profile'), example: '/auth/profile' },
  { roles: ALL, method: 'GET',   re: re('/auth/me'), example: '/auth/me' },
  { roles: ALL, method: 'GET',   re: re('/projects'), example: '/projects' },                       // grants only (projects.js)
  { roles: ALL, method: 'GET',   re: re(`/projects/${ID}`), example: '/projects/27' },              // 403 without a grant
  { roles: ALL, method: 'GET',   re: re(`/rfi-meeting/${ID}`), example: '/rfi-meeting/27' },
  { roles: ALL, method: 'GET',   re: re(`/rfi-meeting/${ID}/${ID}`), example: '/rfi-meeting/27/5' },
  { roles: ALL, method: 'GET',   re: re(`/rfi-meeting/${ID}/${ID}/attendees`), example: '/rfi-meeting/27/5/attendees' },
  { roles: ALL, method: 'GET',   re: re(`/rfi-meeting/${ID}/${ID}/actions`), example: '/rfi-meeting/27/5/actions' },
  { roles: ALL, method: 'PATCH', re: re(`/rfi-meeting/${ID}/${ID}/transition`), example: '/rfi-meeting/27/5/transition' },      // assigned only
  { roles: ALL, method: 'PATCH', re: re(`/rfi-meeting/${ID}/${ID}/actions/${ID}`), example: '/rfi-meeting/27/5/actions/9' },  // assigned only
  // ── freight_forwarder: its own SCNs (register by carrier; detail by carrier or packer) ──
  { roles: FF, method: 'GET',    re: re(`/logistics/register/${ID}`), example: '/logistics/register/27' },
  { roles: FF, method: 'GET',    re: re('/logistics/container-types'), example: '/logistics/container-types' },
  { roles: FF, method: 'GET',    re: re(`/logistics/scn/${ID}`), example: '/logistics/scn/12' },                       // carrier or packer
  { roles: FF, method: 'PUT',    re: re(`/logistics/scn/${ID}/status`), example: '/logistics/scn/12/status' },         // carrier
  { roles: FF, method: 'PUT',    re: re(`/logistics/scn/${ID}/dates`), example: '/logistics/scn/12/dates' },           // carrier
  { roles: FF, method: 'GET',    re: re(`/logistics/scn/${ID}/packages`), example: '/logistics/scn/12/packages' },     // packer
  { roles: FF, method: 'POST',   re: re(`/logistics/scn/${ID}/packages`), example: '/logistics/scn/12/packages' },     // packer
  { roles: FF, method: 'PUT',    re: re(`/logistics/scn/${ID}/packages/${ID}`), example: '/logistics/scn/12/packages/3' }, // packer
  { roles: FF, method: 'PUT',    re: re(`/logistics/scn/${ID}/packaging/complete`), example: '/logistics/scn/12/packaging/complete' }, // packer
  { roles: FF, method: 'POST',   re: re(`/logistics/scn/${ID}/documents`), example: '/logistics/scn/12/documents' },   // carrier
  { roles: FF, method: 'DELETE', re: re(`/logistics/scn/${ID}/documents/${ID}`), example: '/logistics/scn/12/documents/4' }, // carrier, own upload
  // ── site_contractor and subcontractor: stock and FMRs (subcontractor stock is WBS-scoped) ──
  { roles: SC, method: 'GET',  re: re(`/foundational/${ID}/wbs`), example: '/foundational/27/wbs' },
  { roles: CONTRACTORS, method: 'GET',  re: re(`/mc/${ID}/stock`), example: '/mc/27/stock' },
  { roles: CONTRACTORS, method: 'GET',  re: re(`/mc/${ID}/fmr`), example: '/mc/27/fmr' },
  { roles: CONTRACTORS, method: 'GET',  re: re(`/mc/${ID}/fmr/items`), example: '/mc/27/fmr/items' },
  { roles: CONTRACTORS, method: 'GET',  re: re(`/mc/${ID}/fmr/${ID}/detail`), example: '/mc/27/fmr/8/detail' },
  { roles: CONTRACTORS, method: 'POST', re: re(`/mc/${ID}/fmr`), example: '/mc/27/fmr' },
  { roles: SC, method: 'GET',  re: re(`/traceability/${ID}/heat-status`), example: '/traceability/27/heat-status' },
  { roles: SC, method: 'GET',  re: re(`/traceability/${ID}/heat/[^/]+`), example: '/traceability/27/heat/H123' },
]

// Unauthenticated auth routes stay outside the gate even when a token is sent.
const OPEN = [
  { method: 'POST', re: re('/auth/login') },
  { method: 'POST', re: re('/auth/forgot-password') },
]

// The path after /api without the query string, or null when it is not under /api.
function apiPath(req) {
  const p = String(req.originalUrl || req.url || '').split('?')[0].split('#')[0]
  const m = /^\/api(\/.*)?$/i.exec(p)
  return m ? (m[1] || '/') : null
}

function unsafePath(p) {
  return p.includes('//') || p.includes('\\') || /%(2e|2f|5c|00)/i.test(p) ||
    p.split('/').some(s => s === '.' || s === '..')
}

function isAllowed(role, method, p) {
  return ALLOW.some(e => e.method === method && e.roles.includes(role) && e.re.test(p))
}

function externalGate(req, res, next) {
  const p = apiPath(req)
  if (p !== null && OPEN.some(o => o.method === req.method && o.re.test(p))) return next()
  const authHeader = req.headers && req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return next()
  let user
  try { user = jwt.verify(token, JWT_SECRET) } catch { return next() }   // the router answers it as before
  if (!user || !EXTERNAL_ROLES.has(user.role)) return next()
  if (p !== null && !unsafePath(p) && isAllowed(user.role, req.method, p)) return next()
  return res.status(403).json({ error: 'Not available to your role' })
}

module.exports = { externalGate, EXTERNAL_ROLES, ALLOW, OPEN, apiPath, unsafePath, isAllowed }
