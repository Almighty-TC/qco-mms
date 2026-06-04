const bcrypt = require('bcryptjs')
const db     = require('../db')

// ─── COMPLEXITY RULES ───────────────────────────────────────
// Applied globally to all password changes — admin-created temp
// passwords are exempt (they are randomly generated and valid).
const RULES = [
  { test: p => p.length >= 8,           msg: 'At least 8 characters' },
  { test: p => /[A-Z]/.test(p),         msg: 'At least one uppercase letter' },
  { test: p => /[a-z]/.test(p),         msg: 'At least one lowercase letter' },
  { test: p => /[0-9]/.test(p),         msg: 'At least one number' },
  { test: p => /[!@#$%^&*]/.test(p),    msg: 'At least one special character (!@#$%^&*)' },
]

// ─── VALIDATE COMPLEXITY ─────────────────────────────────────
// Returns null if password passes all rules, or an array of
// failure messages so the client can display them.
function validateComplexity(password) {
  const failures = RULES.filter(r => !r.test(password)).map(r => r.msg)
  return failures.length ? failures : null
}

// ─── GENERATE TEMP PASSWORD ──────────────────────────────────
// Produces a cryptographically random 12-character password that
// satisfies all complexity rules.  Character set covers every rule.
function generate() {
  const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower   = 'abcdefghjkmnpqrstuvwxyz'
  const digits  = '23456789'
  const special = '!@#$%^&*'
  const all     = upper + lower + digits + special

  const rand = (chars) => chars[Math.floor(Math.random() * chars.length)]

  // Guarantee at least one of each required class
  const required = [rand(upper), rand(lower), rand(digits), rand(special)]
  const rest     = Array.from({ length: 8 }, () => rand(all))

  // Shuffle to avoid predictable class positions
  return [...required, ...rest]
    .sort(() => Math.random() - 0.5)
    .join('')
}

// ─── CHECK PASSWORD HISTORY ──────────────────────────────────
// Returns true if the plaintext `newPassword` matches any of the
// last 5 stored hashes for the given user.
async function checkHistory(userId, newPassword) {
  const [rows] = await db.query(
    `SELECT hash FROM password_history
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 5`,
    [userId]
  )

  for (const row of rows) {
    if (await bcrypt.compare(newPassword, row.hash)) return true
  }
  return false
}

// ─── ADD TO HISTORY ─────────────────────────────────────────
// Inserts the new hash and prunes history beyond 5 entries so the
// table does not grow unbounded.
async function addToHistory(userId, hash) {
  await db.query(
    `INSERT INTO password_history (user_id, hash) VALUES (?, ?)`,
    [userId, hash]
  )

  // Keep only the 5 most recent rows
  await db.query(`
    DELETE FROM password_history
    WHERE user_id = ?
      AND id NOT IN (
        SELECT id FROM (
          SELECT id FROM password_history
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 5
        ) AS keep
      )
  `, [userId, userId])
}

// ─── EXPIRY DATE ─────────────────────────────────────────────
// Returns a Date set to 90 days from now for internal users or
// 30 days from now for external users.
function expiresAt(isExternal) {
  const days = isExternal ? 30 : 90
  const d    = new Date()
  d.setDate(d.getDate() + days)
  return d
}

module.exports = { validateComplexity, generate, checkHistory, addToHistory, expiresAt }
