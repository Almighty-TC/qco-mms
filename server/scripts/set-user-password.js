// ─── SET USER PASSWORD (3T185) ────────────────────────────────────────────────
// Sets the password of the listed users when nobody knows it (seeded accounts; the
// Admin screen has no password field and Reset Password only emails). Runs as the app's
// own database login (server/.env, qmat_app), which already has UPDATE on users,
// INSERT and DELETE on password_history and INSERT on audit_log, so no new GRANT.
//
// The new password comes ONLY from the environment variable QMAT_NEW_PASSWORD — never
// an argument — and is never printed or logged. It must pass the rules of
// POST /auth/change-password: utils/password.validateComplexity (8 or more characters,
// an upper, a lower, a digit and one of !@#$%^&*) and checkHistory (not one of the
// user's last 5). Hashing is bcryptjs at cost 12, as routes/auth.js does.
//
// For each listed id: the user must exist and be active (else "skipped: reason"); then
// users.password_hash is updated, the hash goes into password_history (pruned to 5, as
// utils/password.addToHistory does) and audit_log gets 'user.password_set' with the user
// id only. Without --force-change: force_password_change = 0, password_expires_at kept.
// With --force-change: force_password_change = 1 and password_expires_at = the app's
// expiry (utils/password.expiresAt: 30 days for external users, 90 for internal).
// All listed users change in ONE transaction; any failure rolls everything back.
//
//   QMAT_NEW_PASSWORD=… node server/scripts/set-user-password.js --users 3,34 --dry-run
//   QMAT_NEW_PASSWORD=… node server/scripts/set-user-password.js --users 3,34 [--force-change]
// --dry-run checks everything, prints the users that would change (id and role) and
// writes nothing. More than 10 ids need --allow-many. Prints id, role and "set" or
// "skipped: reason" per user; never the password, a hash, a name, an email or the env.
const path = require('path')
process.env.DOTENV_CONFIG_QUIET = 'true'   // db.js's own dotenv call would print a tip line
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true })
const bcrypt = require('bcryptjs')
const db = require('../db')
const { validateComplexity, checkHistory, expiresAt } = require('../utils/password')

const COST = 12        // routes/auth.js: bcrypt.hash(newPassword, 12)
const MAX_IDS = 10
const USAGE = 'Usage: QMAT_NEW_PASSWORD=… node server/scripts/set-user-password.js --users 3,34 [--dry-run] [--force-change] [--allow-many]'

// Flags only: anything else is refused without echoing it (a password typed as an
// argument must not reach the terminal or a log).
function parseArgs(argv) {
  const opts = { ids: null, dry: false, force: false, many: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') opts.dry = true
    else if (a === '--force-change') opts.force = true
    else if (a === '--allow-many') opts.many = true
    else if (a === '--users' && i + 1 < argv.length && /^\d+(,\d+)*$/.test(argv[i + 1])) opts.ids = [...new Set(argv[++i].split(',').map(Number))].filter(n => n > 0)
    else return { error: 'unexpected or malformed argument (not shown)' }
  }
  if (!opts.ids || !opts.ids.length) return { error: '--users with a comma-separated list of ids is required' }
  return opts
}

async function main(argv, env, io = { out: console.log, err: console.error }) {
  const opts = parseArgs(argv)
  if (opts.error) { io.err(`${opts.error}\n${USAGE}`); return 1 }
  if (opts.ids.length > MAX_IDS && !opts.many) { io.err(`${opts.ids.length} ids listed; more than ${MAX_IDS} need --allow-many. Nothing changed.`); return 1 }
  const pw = env.QMAT_NEW_PASSWORD
  if (!pw) { io.err('QMAT_NEW_PASSWORD is not set. Aborting; nothing changed.'); return 1 }
  const failures = validateComplexity(pw)
  if (failures) { io.err(`The new password does not meet the complexity rules: ${failures.join('; ')}. Aborting; nothing changed.`); return 1 }

  io.out(`Set password for ${opts.ids.length} user(s)${opts.dry ? ' (dry run: nothing is written)' : ''}${opts.force ? ', forcing a change at next login' : ''}:`)
  const [rows] = await db.query('SELECT id, role, is_active, is_external FROM users WHERE id IN (?)', [opts.ids])
  const plan = []
  for (const id of opts.ids) {
    const u = rows.find(r => r.id === id)
    if (!u) { io.out(`  ${id} — skipped: no such user`); continue }
    if (!u.is_active) { io.out(`  ${id} ${u.role} skipped: inactive`); continue }
    if (await checkHistory(id, pw)) { io.out(`  ${id} ${u.role} skipped: one of the user's last 5 passwords`); continue }
    plan.push(u)
    if (opts.dry) io.out(`  ${id} ${u.role} would be set`)
  }
  if (opts.dry || !plan.length) { io.out(opts.dry ? 'Dry run: nothing written.' : 'Nothing to set.'); return 0 }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    for (const u of plan) {
      const hash = await bcrypt.hash(pw, COST)
      if (opts.force) {
        await conn.query('UPDATE users SET password_hash = ?, force_password_change = 1, password_expires_at = ? WHERE id = ?',
          [hash, expiresAt(Boolean(u.is_external)), u.id])
      } else {
        await conn.query('UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?', [hash, u.id])
      }
      // utils/password.addToHistory, on this transaction's connection
      await conn.query('INSERT INTO password_history (user_id, hash) VALUES (?, ?)', [u.id, hash])
      await conn.query(`DELETE FROM password_history WHERE user_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 5) AS keep)`,
        [u.id, u.id])
      await conn.query('INSERT INTO audit_log (user_id, action, resource, ip) VALUES (?, ?, ?, ?)',
        [u.id, 'user.password_set', `id=${u.id}`, null])
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback().catch(() => {})
    io.err(`Failed (${e.code || 'error'}); rolled back, nothing changed.`)
    return 1
  } finally { conn.release() }
  for (const u of plan) io.out(`  ${u.id} ${u.role} set`)
  return 0
}

module.exports = { main, parseArgs, COST, MAX_IDS }

if (require.main === module) {
  main(process.argv.slice(2), process.env)
    .catch(e => { console.error(`Failed (${e.code || 'error'}); nothing changed.`); return 1 })
    .then(code => db.end().catch(() => {}).then(() => process.exit(code)))
}
