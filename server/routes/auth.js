const express = require('express')
const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const db      = require('../db')
const { dbError } = require('../utils/dbError')
const { authenticateToken: authMiddleware } = require('../middleware/auth')
const { validateComplexity, checkHistory, addToHistory, expiresAt: pwExpiry, generate } = require('../utils/password')
const { sendEmail, html } = require('../services/email')

const router     = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || 'qmat_dev_secret'

// ─── FORGOT-PASSWORD COOLDOWN ────────────────────────────────
// In-memory per-email throttle so the endpoint can't be used to spam a user's
// inbox or hammer the mailer. One reset email per address per 90s.
const forgotCooldown = new Map()
const FORGOT_COOLDOWN_MS = 90 * 1000

// ─── LOGIN ──────────────────────────────────────────────────
// Authenticates with email + password, returns JWT and user object.
// Includes force_password_change and password_expires_at so the
// client can gate the UI immediately after login.
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  try {
    const [rows] = await db.query(
      `SELECT id, email, password_hash, full_name, role, company, phone, is_active,
              force_password_change, password_expires_at
       FROM users WHERE email = ? LIMIT 1`,
      [email]
    )

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const user = rows[0]

    if (!user.is_active) {
      return res.status(403).json({ error: 'User account is disabled' })
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash)
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const payload = {
      id:                   user.id,
      email:                user.email,
      full_name:            user.full_name,
      role:                 user.role,
      company:              user.company,
      phone:                user.phone ?? null,
      forcePasswordChange:  Boolean(user.force_password_change),
      passwordExpiresAt:    user.password_expires_at
        ? new Date(user.password_expires_at).toISOString()
        : null,
    }

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' })

    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id])

    res.json({ token, user: payload })
  } catch (err) {
    dbError(res, err)
  }
})

// ─── FORGOT PASSWORD ─────────────────────────────────────────
// Self-service reset. Emails a temporary password and forces a change on next
// login (same mechanism as an admin reset). Always returns a generic success so
// the endpoint can't be used to discover which emails have accounts.
router.post('/forgot-password', async (req, res) => {
  const GENERIC = { ok: true, message: 'If an account with that email exists, a temporary password has been emailed.' }
  try {
    const email = String(req.body?.email || '').trim()
    if (!email) return res.status(400).json({ error: 'Email is required' })

    // Per-email cooldown (also limits inbox spam for a real address).
    const now = Date.now()
    const last = forgotCooldown.get(email.toLowerCase())
    if (last && now - last < FORGOT_COOLDOWN_MS) return res.json(GENERIC)
    forgotCooldown.set(email.toLowerCase(), now)

    const [[user]] = await db.query(
      `SELECT id, full_name AS fullName, email, is_active, is_external AS isExternal
       FROM users WHERE email = ? LIMIT 1`,
      [email]
    )
    // Only act for a real, active account — but never reveal that to the caller.
    if (!user || !user.is_active) return res.json(GENERIC)

    const tempPass  = generate()
    const hash      = await bcrypt.hash(tempPass, 12)
    const expiresAt = pwExpiry(Boolean(user.isExternal))

    await db.query(
      `UPDATE users SET password_hash = ?, force_password_change = 1, password_expires_at = ? WHERE id = ?`,
      [hash, expiresAt, user.id]
    )
    await addToHistory(user.id, hash)

    await sendEmail(
      user.email,
      'Your QCO Group MMS password reset',
      html('Password Reset',
        `<p>Dear ${user.fullName},</p>
         <p>We received a request to reset your QCO Group MMS password. A temporary password has been generated for you:</p>
         <table style="border-collapse:collapse;margin:12px 0">
           <tr><td style="padding:4px 12px 4px 0"><strong>Email:</strong></td><td>${user.email}</td></tr>
           <tr><td style="padding:4px 12px 4px 0"><strong>Temporary Password:</strong></td><td style="font-family:monospace;font-size:15px">${tempPass}</td></tr>
         </table>
         <p><strong>Use this temporary password to log in — you will be asked to set a new password immediately.</strong></p>
         <p>If you did not request this reset, please contact your administrator, as your previous password is no longer valid.</p>`
      )
    )

    return res.json(GENERIC)
  } catch (err) {
    // Still respond generically — don't leak internal errors on a public endpoint.
    console.error('[forgot-password]', err.message)
    return res.json(GENERIC)
  }
})

// ─── ME ─────────────────────────────────────────────────────
// Returns the currently authenticated user from the JWT payload.
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user })
})

// ─── CHANGE PASSWORD ─────────────────────────────────────────
// Authenticated users change their own password.  Requires the
// current password for verification, enforces complexity rules,
// blocks reuse of the last 5 passwords, and resets the
// force_password_change flag and password_expires_at.
router.post('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  const userId = req.user?.id

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' })
  }

  // ── Complexity check ─────────────────────────────────────
  const failures = validateComplexity(newPassword)
  if (failures) {
    return res.status(400).json({ error: 'Password does not meet complexity requirements', failures })
  }

  try {
    const [rows] = await db.query(
      `SELECT id, password_hash, is_external FROM users WHERE id = ? LIMIT 1`,
      [userId]
    )

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' })
    }

    const user = rows[0]

    // ── Verify current password ───────────────────────────
    // 400 (validation), NOT 401: a wrong *current* password is a field error, not an
    // expired session — a 401 trips the axios interceptor's auto-logout and bounces
    // the user to the login page instead of showing the inline error.
    const matches = await bcrypt.compare(currentPassword, user.password_hash)
    if (!matches) {
      return res.status(400).json({ error: 'Current password is incorrect' })
    }

    // ── History check ─────────────────────────────────────
    const reused = await checkHistory(userId, newPassword)
    if (reused) {
      return res.status(400).json({ error: 'You cannot reuse one of your last 5 passwords' })
    }

    const newHash   = await bcrypt.hash(newPassword, 12)
    const expiresAt = pwExpiry(Boolean(user.is_external))

    await db.query(
      `UPDATE users
       SET password_hash = ?, force_password_change = 0, password_expires_at = ?
       WHERE id = ?`,
      [newHash, expiresAt, userId]
    )

    // ── Record in history ─────────────────────────────────
    await addToHistory(userId, newHash)

    // ── Audit trail ───────────────────────────────────────
    db.query(
      `INSERT INTO audit_log (user_id, action, resource, ip) VALUES (?, ?, ?, ?)`,
      [userId, 'user.change_password', `id=${userId}`, req.ip ?? null]
    ).catch(() => { /* audit_log table may not exist yet */ })

    // ── Re-issue JWT with updated flags ───────────────────
    // Fetches fresh DB values so the token reflects the new state.
    const [updated] = await db.query(
      `SELECT id, email, full_name, role, company, phone, is_external
       FROM users WHERE id = ? LIMIT 1`,
      [userId]
    )
    const u = updated[0]
    const newPayload = {
      id:                  u.id,
      email:               u.email,
      full_name:           u.full_name,
      role:                u.role,
      company:             u.company,
      phone:               u.phone ?? null,
      forcePasswordChange: false,
      passwordExpiresAt:   expiresAt.toISOString(),
    }
    const newToken = jwt.sign(newPayload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' })

    res.json({ message: 'Password changed successfully', token: newToken, user: newPayload })
  } catch (err) {
    dbError(res, err)
  }
})

// ─── UPDATE OWN PROFILE ──────────────────────────────────────
// Lets any authenticated user update their own phone number.
// Re-issues a fresh JWT so the updated phone is reflected immediately
// in the UI without requiring a re-login.
router.put('/profile', authMiddleware, async (req, res) => {
  const userId = req.user?.id
  const { phone } = req.body

  const cleanPhone = (phone ?? '').toString().trim().slice(0, 20) || null

  try {
    await db.query('UPDATE users SET phone = ? WHERE id = ?', [cleanPhone, userId])

    // ── Re-fetch to build a fresh, accurate JWT payload ──────
    const [rows] = await db.query(
      `SELECT id, email, full_name, role, company, phone,
              force_password_change, password_expires_at
       FROM users WHERE id = ? LIMIT 1`,
      [userId]
    )
    if (!rows.length) return res.status(404).json({ error: 'User not found' })
    const u = rows[0]

    const newPayload = {
      id:                  u.id,
      email:               u.email,
      full_name:           u.full_name,
      role:                u.role,
      company:             u.company,
      phone:               u.phone ?? null,
      forcePasswordChange: Boolean(u.force_password_change),
      passwordExpiresAt:   u.password_expires_at
        ? new Date(u.password_expires_at).toISOString()
        : null,
    }
    const newToken = jwt.sign(newPayload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' })

    res.json({ message: 'Profile updated', token: newToken, user: newPayload })
  } catch (err) {
    dbError(res, err)
  }
})

module.exports = router
