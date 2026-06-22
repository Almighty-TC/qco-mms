const express = require('express')
const cors    = require('cors')
const helmet  = require('helmet')
const rateLimit = require('express-rate-limit')
require('dotenv').config()

const { authenticateToken: authMiddleware } = require('./middleware/auth')
const { startExpiryChecker }               = require('./jobs/expiry-checker')

const app = express()

// ─── SECURITY HEADERS (helmet) ───────────────────────────────
// Sets sane security headers on every response. This is a JSON API that also
// streams file downloads to a DIFFERENT-origin SPA (the Static Web App), so we
// relax Cross-Origin-Resource-Policy to 'cross-origin' — the same-origin default
// would block those cross-origin downloads. CORS (below) remains the access gate.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))

// ─── CORS (env-driven allowlist) ─────────────────────────────
// The default INCLUDES the live SWA origin + local dev, so the real site works
// even if CORS_ORIGINS is never set — a wrong/empty env can't silently lock out
// production. Set CORS_ORIGINS (comma-separated) as an Azure app setting to adjust
// origins WITHOUT a redeploy. No-origin requests (curl, health checks, server-to-
// server) are allowed; unlisted browser origins get no CORS headers so the browser
// blocks them. credentials:true so the SPA can send its Authorization header.
const allowedOrigins = (process.env.CORS_ORIGINS ||
  'https://ashy-plant-006662d00.7.azurestaticapps.net,http://localhost:5174')
  .split(',').map(o => o.trim()).filter(Boolean)
app.use(cors({
  origin: (origin, cb) => (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(null, false),
  credentials: true,
}))
app.use(express.json())

// ─── RATE LIMITING ───────────────────────────────────────────
// Two tiers. The general limiter is deliberately GENEROUS so normal app use —
// which fires many parallel API calls per screen, across several concurrent
// testers behind one office IP/NAT — never trips it; it only stops abusive
// floods. The auth limiter is STRICT but counts only FAILED attempts
// (skipSuccessfulRequests), so brute-force/credential-stuffing on /auth/login
// is throttled while legitimate logins (which succeed) never consume the budget.
// Mounted under /api only — /health and /docs stay exempt (health checks, etc.).
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5000,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many requests — please slow down and try again shortly.' },
})
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, skipSuccessfulRequests: true,
  standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many login attempts — please wait a few minutes and try again.' },
})
app.use('/api', generalLimiter)
// Strict limiter on the brute-force surfaces only (NOT /auth/me, which the SPA
// polls on every load to validate the session).
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/forgot-password', authLimiter)

// ─── HEALTH CHECK ───────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'QMAT API running', time: new Date() })
})

// ─── STATIC DOCS ──────────────────────────────────────────
// Serves ~/docs/ so USER_MANUAL.md is accessible in-browser.
const path = require('path')
app.use('/docs', express.static(path.join(__dirname, '../docs')))

// ─── PUBLIC ROUTES ──────────────────────────────────────────
// Auth endpoints do not require a JWT — they issue one on login.
app.use('/api/auth', require('./routes/auth'))

// ─── PROTECTED ROUTES ───────────────────────────────────────
// Every route below this point requires a valid JWT.
// authenticateToken decodes the token and sets req.user before
// the route handler runs.
app.use('/api/projects', authMiddleware, require('./routes/projects'))

// ─── ADMIN ROUTES ───────────────────────────────────────────
// authenticateToken validates the JWT; the admin router then
// additionally enforces role === 'admin' on every endpoint.
app.use('/api/admin', authMiddleware, require('./routes/admin'))

// ─── PROCUREMENT ROUTES ──────────────────────────────────────
// Project-scoped PO management: list, create, approve, line items.
app.use('/api/procurement', authMiddleware, require('./routes/procurement'))
app.use('/api/foundational', require('./routes/foundational'))

// ─── EXPEDITING ROUTES ───────────────────────────────────────
// Expediting register, milestone forecasting, line items, notes.
app.use('/api/expediting', require('./routes/expediting'))

// ─── MTO REGISTER ROUTES ─────────────────────────────────────
// Material Take-Off register, line items, revisions and diff.
app.use('/api/mto', require('./routes/mto'))

// ─── LOGISTICS ROUTES ────────────────────────────────────────
// SCN Register, status transitions, packages, documents, timeline.
app.use('/api/logistics', require('./routes/logistics'))
app.use('/api/mc', require('./routes/materialcontrol'))

// ─── TRACEABILITY ROUTES ─────────────────────────────────────
// VDRL register, cert approvals, trace chain, holds.
app.use('/api/traceability', require('./routes/traceability'))

// ─── DOCUMENTS ROUTES ────────────────────────────────────────
// Read-only, project-wide aggregated document register (no own table).
app.use('/api/documents', require('./routes/documents'))

// ─── PENDING CHANGES (C-c confirmation workflow) ─────────────
// Stages create/delete for wbs/commodity/equipment/mto until a domain confirmer applies.
app.use('/api/pending-changes', require('./routes/pendingChanges'))

// ─── MEETING / RFI REGISTER (raise → assign → respond → close) ──
// One register, two record types; polymorphic project/WBS/PO/SCN link.
app.use('/api/rfi-meeting', require('./routes/rfiMeeting'))

// ─── DASHBOARD (project-view aggregate; gated, scoped, parallel) ──
app.use('/api/dashboard', require('./routes/dashboard'))

// ─── AUDIT VIEWER (read-only over the immutable audit_log) ───
// Read gated to admin + oversight roles; QA sign-off (C2) writes to audit_review only.
app.use('/api/audit', require('./routes/audit'))

// ─── REPORTS (curated + ad-hoc analytics, read-only) ─────────
// Whitelisted, project-scoped queries via one injection-safe engine. Two gates:
// reports.can_view (module) + can_view on each dataset's SOURCE module (no backdoor).
app.use('/api/reports', require('./routes/reports'))

// ─── GLOBAL ERROR HANDLER ────────────────────────────────────
// Turns upload failures into clean 400s: multer size-limit errors and our own
// fileFilter rejections (err.isUploadError) — instead of a default 500/HTML.
// Must be registered AFTER all routes. Anything else falls through to a 500.
const multerLib = require('multer')
app.use((err, req, res, next) => {
  if (!err) return next()
  if (res.headersSent) return next(err)
  if (err instanceof multerLib.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large for this upload.'
      : `Upload error: ${err.message}`
    return res.status(400).json({ error: msg })
  }
  if (err.isUploadError) return res.status(400).json({ error: err.message })
  console.error('[unhandled]', err.stack || err.message)
  return res.status(500).json({ error: 'Internal server error' })
})

// ─── START SERVER ───────────────────────────────────────────
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`QMAT API running on port ${PORT}`)

  // ─── EXPIRY CHECKER ───────────────────────────────────────
  // Starts the daily contract expiry check after the server is
  // listening.  Runs once immediately on startup (catches any
  // missed checks after a restart), then every 24 h.
  startExpiryChecker()
})
