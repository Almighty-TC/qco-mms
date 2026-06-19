const db = require('../db')

// ─── VALID ACTIONS ──────────────────────────────────────────
// These map to the boolean columns in role_permissions and
// user_permission_overrides.  Prevents SQL injection via column name.
const VALID_ACTIONS = new Set([
  'can_view', 'can_create', 'can_edit', 'can_approve', 'can_delete',
])

// ─── REQUIRE PERMISSION ─────────────────────────────────────
// Returns an Express middleware that checks whether the authenticated
// user may perform `action` on `module`.
//
// Check order:
//   1. Admins always pass — no DB query needed.
//   2. user_permission_overrides for this user+module — takes precedence
//      over the role default if a row exists (even if it grants access
//      the role normally wouldn't have, or denies something it would).
//   3. role_permissions for the user's role+module.
//   4. If wbs_scoped is true AND req.params.projectId is present,
//      validate user_wbs_access for that project.
//
// Usage:
//   router.get('/items', requirePermission('procurement', 'can_view'), handler)
function requirePermission(module, action = 'can_view') {
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(`requirePermission: invalid action "${action}"`)
  }

  return async (req, res, next) => {
    const userId = req.user?.id
    const role   = req.user?.role

    if (!userId || !role) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    // ── Admins bypass all permission checks ───────────────
    if (role === 'admin') return next()

    try {
      // ── Check user-specific override first ────────────
      const [overrides] = await db.query(
        `SELECT ${action} AS allowed FROM user_permission_overrides
         WHERE user_id = ? AND module = ? LIMIT 1`,
        [userId, module]
      )

      if (overrides.length > 0 && overrides[0].allowed !== null) {
        if (!overrides[0].allowed) {
          return res.status(403).json({ error: `Access denied to ${module}` })
        }
        return next()
      }

      // ── Fall back to role default ─────────────────────
      const [perms] = await db.query(
        `SELECT ${action} AS allowed, wbs_scoped
         FROM role_permissions
         WHERE role = ? AND module = ? LIMIT 1`,
        [role, module]
      )

      if (!perms.length || !perms[0].allowed) {
        return res.status(403).json({ error: `Access denied to ${module}` })
      }

      // ── WBS scope check ───────────────────────────────
      // Only triggered when the role is WBS-scoped AND the route
      // has a :projectId parameter to check against.
      if (perms[0].wbs_scoped && req.params.projectId) {
        const [wbs] = await db.query(
          `SELECT id FROM user_wbs_access
           WHERE user_id = ? AND project_id = ? LIMIT 1`,
          [userId, req.params.projectId]
        )
        if (!wbs.length) {
          return res.status(403).json({ error: 'No WBS access for this project' })
        }
      }

      next()
    } catch (err) {
      console.error('[permissions] Error checking permissions:', err.message)
      res.status(500).json({ error: 'Permission check failed' })
    }
  }
}

// ─── HAS PERMISSION (boolean form, for non-middleware checks) ─
// Same resolution as requirePermission (admin bypass → user override → role
// default), returned as a boolean instead of an Express gate. Used where a single
// handler must check several modules at once — e.g. the Reports route re-checking
// the SOURCE module's can_view per dataset, so Reports can't become a read-leak
// backdoor for data a role can't otherwise see. NB: does NOT apply the WBS-scope
// check (callers that need it gate the route with requirePermission as well).
async function hasPermission(user, module, action = 'can_view') {
  if (!VALID_ACTIONS.has(action)) throw new Error(`hasPermission: invalid action "${action}"`)
  const userId = user?.id, role = user?.role
  if (!userId || !role) return false
  if (role === 'admin') return true
  const [overrides] = await db.query(
    `SELECT ${action} AS allowed FROM user_permission_overrides
     WHERE user_id = ? AND module = ? LIMIT 1`, [userId, module])
  if (overrides.length > 0 && overrides[0].allowed !== null) return !!overrides[0].allowed
  const [perms] = await db.query(
    `SELECT ${action} AS allowed FROM role_permissions
     WHERE role = ? AND module = ? LIMIT 1`, [role, module])
  return !!(perms.length && perms[0].allowed)
}

// ─── DENY READ-ONLY ROLES (C-a interim floor) ────────────────
// Blanket floor: roles that may NEVER perform operational writes are blocked
// on every write method (POST/PUT/PATCH/DELETE). Closes the demonstrated gap
// (a viewer/auditor token creating records) immediately, independent of the
// per-module matrix, with zero over-block risk for operational roles.
//
// SCOPE: `viewer` and `auditor` only. `subcontractor` / `site_contractor` are
// deliberately NOT here — they have a legitimate write (raising field FMRs,
// POST /mc/:projectId/fmr). Barring them needs a per-route FMR exemption;
// pending Thomas's call (flagged in the C-a report). When `audit_review` write
// routes exist, exempt `auditor` there (gate with requirePermission, not this floor).
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const WRITE_DENY_ROLES = new Set(['viewer', 'auditor'])
function denyReadOnly(req, res, next) {
  if (WRITE_METHODS.has(req.method) && WRITE_DENY_ROLES.has(req.user?.role)) {
    return res.status(403).json({ error: 'Your role is read-only and cannot perform this action' })
  }
  next()
}

// ─── ENFORCE (C-b2 writes + C-e reads: per-route authorization) ──────────────
// One middleware per router (applied after denyReadOnly). Maps the HTTP verb to
// a matrix action and delegates to requirePermission(module, action).
//   verb→action: GET→can_view, POST→can_create, PUT/PATCH→can_edit, DELETE→can_delete
//   path /approve|reject|verify|issue|critical-path/ → can_approve
// `moduleFor` is a module string OR a function(req)→module. If it returns a
// falsy module, the route is left to the deny-floor alone (reported as residual).
// NB: critical-path is a toggle (edit), NOT an approval — maps to can_edit (C-d fix).
//
// C-e (read gating): GET now requires can_view on the mapped module — previously
// GET passed unconditionally ("reads unchanged"), which let any authenticated role
// read every module regardless of the matrix (the PASS 1 read-leak finding). This
// enforces the matrix STRICTLY: a role with no can_view=1 row for the module gets
// 403. Roles that legitimately need read access but lack a matrix row must be
// granted can_view=1 (matrix backfill is the deliberate follow-up, not this change).
const APPROVE_RE = /\/(approve|reject|verify|issue)(\/|$)/
function enforce(moduleFor) {
  return (req, res, next) => {
    const p = (req.originalUrl || req.url || '').split('?')[0] // full path; router-relative req.path is unreliable
    const module = typeof moduleFor === 'function' ? moduleFor(p, req) : moduleFor
    if (!module) return next() // deny-floor-only residual route
    const action = req.method === 'GET'
      ? 'can_view'
      : APPROVE_RE.test(p) ? 'can_approve'
      : req.method === 'POST' ? 'can_create'
      : req.method === 'DELETE' ? 'can_delete'
      : 'can_edit'
    return requirePermission(module, action)(req, res, next)
  }
}

// ─── QUEUE GATE (C-c Decision 1: force proposers through confirmation) ────────
// Proposer roles (project_control for wbs; engineering_lead for commodity/
// equipment/mto) may NOT create/delete records directly — they must submit to
// the pending_changes approval queue. Admin keeps direct access (override, still
// audited). All other roles pass (enforce() already restricts who reaches here).
// Apply per router AFTER enforce(), with regexes matching the record create/delete
// paths only (so validate/import/bulk/edit routes are unaffected).
const PROPOSER_ROLES = new Set(['project_control', 'engineering_lead'])
function queueGate(createRe, deleteRe) {
  return (req, res, next) => {
    if (req.user?.role === 'admin') return next()          // admin override → direct
    if (!PROPOSER_ROLES.has(req.user?.role)) return next() // non-proposers unaffected
    const p = (req.originalUrl || req.url || '').split('?')[0]
    const isRecordWrite = (req.method === 'POST' && createRe.test(p)) || (req.method === 'DELETE' && deleteRe.test(p))
    if (isRecordWrite) {
      // requiresApproval: machine-readable marker so the proposer's client can tell
      // this governance-routing 409 apart from a genuine conflict 409 (e.g. dup code)
      // and submit the change to /pending-changes instead of surfacing a failure.
      return res.status(409).json({
        error: 'This change requires Project confirmation — submit it to the approval queue (Pending Changes).',
        requiresApproval: true,
      })
    }
    return next()
  }
}

// ─── REQUIRE ADMIN ──────────────────────────────────────────
// Lightweight shortcut for routes that require the admin role.
// Equivalent to requirePermission('admin', 'can_view') but cheaper —
// no DB query needed because admins always pass.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

module.exports = { requirePermission, requireAdmin, denyReadOnly, enforce, queueGate, hasPermission }
