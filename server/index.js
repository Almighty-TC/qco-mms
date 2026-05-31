const express = require('express')
const cors    = require('cors')
require('dotenv').config()

const { authenticateToken: authMiddleware } = require('./middleware/auth')
const { startExpiryChecker }               = require('./jobs/expiry-checker')

const app = express()
app.use(cors())
app.use(express.json())

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
