const db                      = require('../db')
const { sendEmail, sendAlert, html } = require('../services/email')

// ─── NOTIFICATION THRESHOLDS ────────────────────────────────
// Days before contract_end at which the system sends a warning
// notification and email.  Also checked: expiry day itself (0).
const WARNING_DAYS = [30, 14, 7, 1]

// ─── PASSWORD EXPIRY WARNING THRESHOLD ──────────────────────
// Only 7 days — a single warning before the password is considered
// expired and force_password_change is set automatically.
const PASSWORD_WARNING_DAYS = 7

// ─── CHECK PASSWORD EXPIRY ──────────────────────────────────
// Warns users whose password expires in PASSWORD_WARNING_DAYS days,
// then auto-sets force_password_change on passwords that have expired.
async function checkPasswordExpiry() {
  try {
    // ── 7-day warning ─────────────────────────────────────
    const [expiring] = await db.query(`
      SELECT id, full_name, email, password_expires_at
      FROM users
      WHERE password_expires_at IS NOT NULL
        AND is_active = 1
        AND force_password_change = 0
        AND DATEDIFF(password_expires_at, CURDATE()) = ?
    `, [PASSWORD_WARNING_DAYS])

    for (const u of expiring) {
      const date = new Date(u.password_expires_at).toISOString().slice(0, 10)

      await db.query(
        `INSERT INTO notifications (user_id, type, message) VALUES (?, 'password_expiry', ?)`,
        [u.id, `Your password expires in ${PASSWORD_WARNING_DAYS} days (${date}). Please change it before it expires.`]
      )

      await sendEmail(
        u.email,
        `Password expiring in ${PASSWORD_WARNING_DAYS} days — QCO Group MMS`,
        html('Password Expiry Notice',
          `<p>Dear <strong>${u.full_name}</strong>,</p>
           <p>Your QCO Group MMS password will expire in <strong>${PASSWORD_WARNING_DAYS} days</strong> on <strong>${date}</strong>.</p>
           <p>Please log in and change your password before it expires to avoid being locked out.</p>`
        )
      )
    }

    // ── Auto-set force_password_change on expired passwords ─
    const [expired] = await db.query(`
      SELECT id, full_name, email FROM users
      WHERE password_expires_at IS NOT NULL
        AND password_expires_at < NOW()
        AND force_password_change = 0
        AND is_active = 1
    `)

    if (expired.length > 0) {
      await db.query(`
        UPDATE users SET force_password_change = 1
        WHERE password_expires_at IS NOT NULL
          AND password_expires_at < NOW()
          AND force_password_change = 0
          AND is_active = 1
      `)

      for (const u of expired) {
        await db.query(
          `INSERT INTO notifications (user_id, type, message) VALUES (?, 'password_expired', ?)`,
          [u.id, 'Your password has expired. You will be required to set a new password on next login.']
        )

        await sendEmail(
          u.email,
          'Password expired — QCO Group MMS',
          html('Password Expired',
            `<p>Dear <strong>${u.full_name}</strong>,</p>
             <p>Your QCO Group MMS password has expired. You will be prompted to set a new password the next time you log in.</p>`
          )
        )
      }
    }

    if (expiring.length || expired.length) {
      console.log(`[expiry-checker] passwords: ${expiring.length} warned, ${expired.length} force-expired`)
    }
  } catch (err) {
    console.error('[expiry-checker] Error during password check:', err.message)
  }
}

// ─── CHECK CONTRACT EXPIRY ──────────────────────────────────
// Queries for users whose contract_end falls exactly on a warning
// threshold from today, sends them an in-app notification and email.
// Then auto-deactivates any users whose contract_end has passed.
async function checkContractExpiry() {
  try {
    // ── Warning notifications ──────────────────────────────
    const [expiring] = await db.query(`
      SELECT id, full_name, email, contract_end,
             DATEDIFF(contract_end, CURDATE()) AS days_left
      FROM users
      WHERE contract_end IS NOT NULL
        AND is_active = 1
        AND DATEDIFF(contract_end, CURDATE()) IN (?)
    `, [WARNING_DAYS])

    for (const u of expiring) {
      const d    = u.days_left
      const date = u.contract_end instanceof Date
        ? u.contract_end.toISOString().slice(0, 10)
        : String(u.contract_end).slice(0, 10)

      // In-app notification
      await db.query(
        `INSERT INTO notifications (user_id, type, message) VALUES (?, 'contract_expiry', ?)`,
        [u.id, `Your access contract expires in ${d} day${d !== 1 ? 's' : ''} (${date}). Contact your administrator to renew.`]
      )

      // Email to the user
      await sendEmail(
        u.email,
        `Contract access expiring in ${d} day${d !== 1 ? 's' : ''} — QCO Group MMS`,
        html(
          'Contract Expiry Notice',
          `<p>Dear <strong>${u.full_name}</strong>,</p>
           <p>Your QCO Group MMS access contract expires in <strong>${d} day${d !== 1 ? 's' : ''}</strong> on <strong>${date}</strong>.</p>
           <p>Please contact your project administrator to renew your access before it is automatically deactivated.</p>`
        )
      )

      // Alert system admins
      await sendAlert(
        `User contract expiring: ${u.full_name}`,
        html(
          'Contract Expiry Alert',
          `<p>User <strong>${u.full_name}</strong> (${u.email}) has <strong>${d} day${d !== 1 ? 's' : ''}</strong> remaining on their access contract (expires ${date}).</p>
           <p>Action may be required to renew or deactivate their access.</p>`
        )
      )
    }

    // ── Auto-deactivate expired users ─────────────────────
    const [expired] = await db.query(`
      SELECT id, full_name, email FROM users
      WHERE contract_end IS NOT NULL
        AND contract_end < CURDATE()
        AND is_active = 1
    `)

    if (expired.length > 0) {
      await db.query(`
        UPDATE users SET is_active = 0
        WHERE contract_end IS NOT NULL
          AND contract_end < CURDATE()
          AND is_active = 1
      `)

      for (const u of expired) {
        await db.query(
          `INSERT INTO notifications (user_id, type, message) VALUES (?, 'contract_expired', ?)`,
          [u.id, 'Your access contract has expired and your account has been automatically deactivated.']
        )

        await sendEmail(
          u.email,
          'Access deactivated — QCO Group MMS',
          html(
            'Account Deactivated',
            `<p>Dear <strong>${u.full_name}</strong>,</p>
             <p>Your QCO Group MMS access contract has expired and your account has been <strong>automatically deactivated</strong>.</p>
             <p>Contact your project administrator if you believe this is in error or to arrange renewed access.</p>`
          )
        )

        await sendAlert(
          `User deactivated (contract expired): ${u.full_name}`,
          html(
            'User Auto-Deactivated',
            `<p>User <strong>${u.full_name}</strong> (${u.email}) has been automatically deactivated because their contract expired.</p>`
          )
        )
      }
    }

    const warned      = expiring.length
    const deactivated = expired.length
    if (warned || deactivated) {
      console.log(`[expiry-checker] ${warned} warned, ${deactivated} deactivated`)
    }
  } catch (err) {
    console.error('[expiry-checker] Error during check:', err.message)
  }
}

// ─── START JOB ──────────────────────────────────────────────
// Runs both checks once on server startup (to catch any missed checks
// after a restart), then repeats every 24 hours.
function startExpiryChecker() {
  console.log('[expiry-checker] Starting daily expiry checks (contract + password)')

  async function runAll() {
    await checkPasswordExpiry()
    await checkContractExpiry()
  }

  runAll()
  const timer = setInterval(runAll, 24 * 60 * 60 * 1000)
  return timer
}

module.exports = { startExpiryChecker, checkContractExpiry, checkPasswordExpiry }
