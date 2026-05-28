import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

// ─── COMPLEXITY RULES ───────────────────────────────────────
// Mirror of server/utils/password.js RULES — validated client-side
// so the user sees live feedback before submitting.
const RULES = [
  { id: 'len',     test: (p: string) => p.length >= 8,           label: 'At least 8 characters' },
  { id: 'upper',   test: (p: string) => /[A-Z]/.test(p),         label: 'At least one uppercase letter' },
  { id: 'lower',   test: (p: string) => /[a-z]/.test(p),         label: 'At least one lowercase letter' },
  { id: 'digit',   test: (p: string) => /[0-9]/.test(p),         label: 'At least one number' },
  { id: 'special', test: (p: string) => /[!@#$%^&*]/.test(p),    label: 'At least one special character (!@#$%^&*)' },
]

interface Props {
  dark: boolean
}

// ─── FORCE PASSWORD CHANGE ──────────────────────────────────
// Non-dismissible full-screen overlay shown when user.forcePasswordChange
// is true.  Rendered via createPortal so it sits above the zoom div.
export function ForcePasswordChange({ dark }: Props) {
  const { updateCredentials } = useAuth()

  const [currentPw,  setCurrentPw]  = useState('')
  const [newPw,      setNewPw]      = useState('')
  const [confirmPw,  setConfirmPw]  = useState('')
  const [error,      setError]      = useState('')
  const [submitting, setSubmitting] = useState(false)

  // ── Live rule evaluation ─────────────────────────────────
  const rulePass = useCallback((id: string) => {
    const rule = RULES.find(r => r.id === id)
    return rule ? rule.test(newPw) : false
  }, [newPw])

  const allRulesPassed = RULES.every(r => r.test(newPw))
  const passwordsMatch = newPw.length > 0 && newPw === confirmPw

  // ── Submit ───────────────────────────────────────────────
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!allRulesPassed) { setError('Password does not meet all requirements.'); return }
    if (!passwordsMatch) { setError('Passwords do not match.'); return }

    setSubmitting(true)
    try {
      const { data } = await axios.post('http://localhost:3001/api/auth/change-password', {
        currentPassword: currentPw,
        newPassword:     newPw,
      })

      // Server returns a fresh token with forcePasswordChange cleared
      if (data.token && data.user) {
        updateCredentials(data.token, data.user)
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        .response?.data?.error ?? 'Failed to change password. Please try again.'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }, [currentPw, newPw, allRulesPassed, passwordsMatch, updateCredentials])

  // ── Styles ───────────────────────────────────────────────
  const bg      = dark ? '#0f172a' : '#f8fafc'
  const surface = dark ? '#1e293b' : '#ffffff'
  const border  = dark ? '#334155' : '#e2e8f0'
  const text     = dark ? '#e2e8f0' : '#1e293b'
  const sub      = dark ? '#94a3b8' : '#64748b'

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 13,
    border: `1px solid ${border}`,
    background: dark ? '#0f172a' : '#f8fafc',
    color: text, fontFamily: 'inherit', boxSizing: 'border-box',
  }

  const overlay = (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: surface, border: `1px solid ${border}`, borderRadius: 10,
        width: 420, maxWidth: '95vw', padding: 28, color: text,
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>

        {/* ─── HEADER ──────────────────────────────────────── */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#E84E0F', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
            Action Required
          </div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Change Your Password</div>
          <div style={{ fontSize: 12, color: sub, marginTop: 6, lineHeight: 1.5 }}>
            Your password must be changed before you can access QCO Group MMS.
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ─── CURRENT PASSWORD ─────────────────────────── */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: 'block', marginBottom: 4 }}>
              Current / Temporary Password
            </label>
            <input
              type="password" value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              style={inputStyle} required autoFocus
              placeholder="Enter your current password"
            />
          </div>

          {/* ─── NEW PASSWORD ─────────────────────────────── */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: 'block', marginBottom: 4 }}>
              New Password
            </label>
            <input
              type="password" value={newPw}
              onChange={e => setNewPw(e.target.value)}
              style={inputStyle} required
              placeholder="Enter your new password"
            />
          </div>

          {/* ─── COMPLEXITY CHECKLIST ─────────────────────── */}
          {newPw.length > 0 && (
            <div style={{
              background: dark ? '#0f172a' : '#f8fafc',
              border: `1px solid ${border}`, borderRadius: 6, padding: '10px 12px',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              {RULES.map(r => {
                const pass = rulePass(r.id)
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
                    <span style={{ color: pass ? '#22c55e' : '#ef4444', fontSize: 13 }}>
                      {pass ? '✓' : '✗'}
                    </span>
                    <span style={{ color: pass ? (dark ? '#86efac' : '#15803d') : sub }}>{r.label}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* ─── CONFIRM PASSWORD ─────────────────────────── */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: 'block', marginBottom: 4 }}>
              Confirm New Password
            </label>
            <input
              type="password" value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              style={{
                ...inputStyle,
                borderColor: confirmPw.length > 0
                  ? (passwordsMatch ? '#22c55e' : '#ef4444')
                  : border,
              }}
              required
              placeholder="Re-enter your new password"
            />
            {confirmPw.length > 0 && !passwordsMatch && (
              <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>Passwords do not match</div>
            )}
          </div>

          {/* ─── ERROR ────────────────────────────────────── */}
          {error && (
            <div style={{
              fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 10px',
            }}>
              {error}
            </div>
          )}

          {/* ─── SUBMIT ───────────────────────────────────── */}
          <button
            type="submit"
            disabled={submitting || !allRulesPassed || !passwordsMatch || !currentPw}
            style={{
              padding: '9px 0', borderRadius: 6, border: 'none',
              background: (submitting || !allRulesPassed || !passwordsMatch || !currentPw)
                ? (dark ? '#334155' : '#cbd5e1')
                : '#E84E0F',
              color: '#fff', fontWeight: 600, fontSize: 13, cursor: submitting ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}>
            {submitting ? 'Changing password…' : 'Set New Password'}
          </button>
        </form>
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
