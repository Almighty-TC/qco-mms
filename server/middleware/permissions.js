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

module.exports = { requirePermission, requireAdmin }
