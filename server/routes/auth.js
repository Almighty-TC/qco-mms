const express = require('express')
const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const db      = require('../db')
const { authenticateToken: authMiddleware } = require('../middleware/auth')
const { validateComplexity, checkHistory, addToHistory, expiresAt: pwExpiry } = require('../utils/password')

const router     = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || 'qmat_dev_secret'

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

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' })

    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id])

    res.json({ token, user: payload })
  } catch (err) {
    res.status(500).json({ error: err.message })
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
    const matches = await bcrypt.compare(currentPassword, user.password_hash)
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect' })
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
    const newToken = jwt.sign(newPayload, JWT_SECRET, { expiresIn: '8h' })

    res.json({ message: 'Password changed successfully', token: newToken, user: newPayload })
  } catch (err) {
    res.status(500).json({ error: err.message })
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
    const newToken = jwt.sign(newPayload, JWT_SECRET, { expiresIn: '8h' })

    res.json({ message: 'Profile updated', token: newToken, user: newPayload })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
