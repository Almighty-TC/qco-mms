const nodemailer = require('nodemailer')

// ─── TRANSPORTER ────────────────────────────────────────────
// Microsoft 365 SMTP requires STARTTLS on port 587 (secure: false).
// The transporter is created once and reused for all sends.
// If SMTP_PASS is still the placeholder, emails silently no-op so
// the app starts cleanly in dev without real credentials.
const isConfigured = process.env.SMTP_PASS && process.env.SMTP_PASS !== 'your-password-here'

const transporter = isConfigured
  ? nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.office365.com',
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
    })
  : null

// ─── ADDITIONAL RECIPIENTS ──────────────────────────────────
// ADDITIONAL_ALERT_EMAILS is a comma-separated list of addresses
// that receive copies of every alert email (e.g. a team inbox).
function additionalRecipients() {
  return (process.env.ADDITIONAL_ALERT_EMAILS || '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean)
}

// ─── SEND EMAIL ─────────────────────────────────────────────
// Sends a transactional email to one or more recipients, appending
// any additional alert addresses from ADDITIONAL_ALERT_EMAILS.
// Returns silently if SMTP is not configured (dev / CI environments).
async function sendEmail(to, subject, html) {
  if (!isConfigured) {
    console.log(`[email] SMTP not configured — would have sent "${subject}" to ${Array.isArray(to) ? to.join(', ') : to}`)
    return
  }

  const toList     = Array.isArray(to) ? to : [to]
  const allRecips  = [...new Set([...toList, ...additionalRecipients()])].filter(Boolean)
  if (!allRecips.length) return

  try {
    await transporter.sendMail({
      from:    process.env.SMTP_FROM || process.env.SMTP_USER,
      to:      allRecips.join(', '),
      subject,
      html,
    })
  } catch (err) {
    // Log but never crash the caller — email delivery is best-effort.
    console.error('[email] Send failed:', err.message)
  }
}

// ─── SEND ALERT ─────────────────────────────────────────────
// Sends an email only to the additional alert addresses from .env.
// Used for system-level notifications that don't have a user recipient
// (e.g. new external user requests requiring admin review).
async function sendAlert(subject, html) {
  const recipients = additionalRecipients()
  if (!recipients.length) return
  await sendEmail(recipients, subject, html)
}

// ─── EMAIL TEMPLATES ────────────────────────────────────────
// Returns branded HTML for common notification types.
function html(title, body) {
  return `
    <!DOCTYPE html><html><body style="font-family:IBM Plex Sans,Arial,sans-serif;background:#f1f4f8;margin:0;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:#0d1117;padding:16px 24px;display:flex;align-items:center;gap:10px">
        <span style="font-size:18px;color:#E84E0F;font-weight:700">QCO MMS</span>
        <span style="color:#334155;font-size:14px">${title}</span>
      </div>
      <div style="padding:24px;color:#0f172a;font-size:14px;line-height:1.6">${body}</div>
      <div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
        QCO QMAT · Supply Chain Platform · Do not reply to this email.
      </div>
    </div></body></html>`
}

module.exports = { sendEmail, sendAlert, html, isEmailConfigured: isConfigured }
