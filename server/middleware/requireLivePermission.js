// ─── LIVE PERMISSION MIDDLEWARE ────────────────────────────────────────────────
// Per-request authorization that reads role_permissions LIVE from the DB on every
// call — never from JWT-baked flags (the JWT carries only id + role; the permission
// bits live in the DB and are queried fresh each request, so grants/revocations take
// effect on the next request with no re-login). Parameterized + reusable:
//   requireLivePermission(module[, action])
// `action` (one of can_view/can_create/can_edit/can_approve/can_delete) is optional;
// when omitted it is mapped from the HTTP verb. Any module can adopt this gate.
//
// Security-first sibling of permissions.js requirePermission, with ONE deliberate
// difference: the ZERO-ROW case (a role with NO row for this module in
// role_permissions) is an EXPLICIT, labeled early-return DENY — not an implicit
// fall-through folded into a compound boolean. Every path FAILS CLOSED.
//
// Resolution order (deny unless explicitly allowed):
//   1. no user/role                         → 401
//   2. misconfig / unmapped HTTP method     → 403 (fail closed)
//   3. role === 'admin'                     → ALLOW (break-glass; matches the RBAC design)
//   4. user_permission_overrides (non-null) → that value decides (per-user grant/deny)
//   5. role_permissions row:
//        • NO ROW at all   → 403   ← explicit zero-row deny (the deliberate fix)
//        • row, flag = 0   → 403
//        • row, flag = 1   → ALLOW
//   6. any thrown error                     → 500 (deny)
//
// The action string is whitelisted (VALID_ACTIONS) before interpolation into the
// column position, so it can never carry SQL injection.
const db = require('../db')

const VALID_ACTIONS = new Set(['can_view', 'can_create', 'can_edit', 'can_approve', 'can_delete'])
const METHOD_ACTION = { GET: 'can_view', POST: 'can_create', PUT: 'can_edit', PATCH: 'can_edit', DELETE: 'can_delete' }

function requireLivePermission(module, action) {
  return async (req, res, next) => {
    // resolve the required flag: explicit arg wins, else map from the HTTP verb
    const act = action || METHOD_ACTION[req.method]
    if (!module || !VALID_ACTIONS.has(act)) {
      // route misconfiguration, or an unmapped method (HEAD/OPTIONS/…) → fail closed
      console.error(`[requireLivePermission] no valid action (module=${module} method=${req.method} action=${action})`)
      return res.status(403).json({ error: 'Access denied' })
    }

    const userId = req.user?.id
    const role   = req.user?.role
    if (!userId || !role) return res.status(401).json({ error: 'Not authenticated' })

    // admins bypass — intended break-glass, consistent with the pre_award RBAC design
    if (role === 'admin') return next()

    try {
      // ── per-user override (explicit grant OR deny) takes precedence over the role default ──
      const [ov] = await db.query(
        `SELECT ${act} AS allowed FROM user_permission_overrides WHERE user_id = ? AND module = ? LIMIT 1`,
        [userId, module])
      if (ov.length && ov[0].allowed !== null) {
        if (!ov[0].allowed) return res.status(403).json({ error: `Access denied to ${module}` })
        return next()
      }

      // ── role default ──
      const [rows] = await db.query(
        `SELECT ${act} AS allowed FROM role_permissions WHERE role = ? AND module = ? LIMIT 1`,
        [role, module])

      // ── EXPLICIT ZERO-ROW DENY: a role with no row for this module is denied deliberately,
      //    as its own labeled branch — never left to fall through to an implicit default. ──
      if (rows.length === 0) {
        return res.status(403).json({ error: `Access denied to ${module} — no permission row for role '${role}'` })
      }

      // ── row exists but the required flag is 0 → deny ──
      if (!rows[0].allowed) {
        return res.status(403).json({ error: `Access denied to ${module}` })
      }

      // row exists and flag = 1 → allow
      return next()
    } catch (err) {
      // any DB hiccup / unexpected error → FAIL CLOSED (never fall open)
      console.error('[requireLivePermission] check failed:', err.message)
      return res.status(500).json({ error: 'Permission check failed' })
    }
  }
}

module.exports = { requireLivePermission }
