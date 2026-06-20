import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { API } from '../lib/api'
import { useAuth } from '../context/AuthContext'

// ─── COMPLEXITY RULES ───────────────────────────────────────
// Mirror of server/utils/password.js RULES for live client-side feedback.
const RULES = [
  { id: 'len',     test: (p: string) => p.length >= 8,           label: 'At least 8 characters' },
  { id: 'upper',   test: (p: string) => /[A-Z]/.test(p),         label: 'At least one uppercase letter' },
  { id: 'lower',   test: (p: string) => /[a-z]/.test(p),         label: 'At least one lowercase letter' },
  { id: 'digit',   test: (p: string) => /[0-9]/.test(p),         label: 'At least one number' },
  { id: 'special', test: (p: string) => /[!@#$%^&*]/.test(p),    label: 'At least one special character (!@#$%^&*)' },
]

interface Props {
  dark: boolean
  onClose: () => void
}

// ─── CHANGE PASSWORD MODAL ──────────────────────────────────
// Voluntary password change — dismissible.  Same rules as
// ForcePasswordChange but wrapped in a closeable modal.
export function ChangePasswordModal({ dark, onClose }: Props) {
  const { updateCredentials } = useAuth()

  const [currentPw,  setCurrentPw]  = useState('')
  const [newPw,      setNewPw]      = useState('')
  const [confirmPw,  setConfirmPw]  = useState('')
  const [error,      setError]      = useState('')
  const [success,    setSuccess]    = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ── Close on Escape ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

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
      const { data } = await axios.post(`${API}/auth/change-password`, {
        currentPassword: currentPw,
        newPassword:     newPw,
      })

      if (data.token && data.user) {
        updateCredentials(data.token, data.user)
      }
      setSuccess(true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        .response?.data?.error ?? 'Failed to change password. Please try again.'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }, [currentPw, newPw, allRulesPassed, passwordsMatch, updateCredentials])

  // ── Styles ───────────────────────────────────────────────
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

  const modal = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: surface, border: `1px solid ${border}`, borderRadius: 10,
        width: 420, maxWidth: '95vw', padding: 28, color: text,
        boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      }}>

        {/* ─── HEADER ──────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Change Password</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 3 }}>Update your QCO Group MMS account password</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: sub, fontSize: 18, lineHeight: 1, padding: 2 }}>
            ✕
          </button>
        </div>

        {/* ─── SUCCESS STATE ────────────────────────────────── */}
        {success ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Password changed successfully</div>
            <div style={{ fontSize: 12, color: sub, marginBottom: 20 }}>Your new password is active immediately.</div>
            <button
              onClick={onClose}
              style={{ padding: '8px 24px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* ─── CURRENT PASSWORD ─────────────────────── */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: sub, display: 'block', marginBottom: 4 }}>
                Current Password
              </label>
              <input
                type="password" value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                style={inputStyle} required autoFocus
                placeholder="Enter your current password"
              />
            </div>

            {/* ─── NEW PASSWORD ─────────────────────────── */}
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

            {/* ─── COMPLEXITY CHECKLIST ─────────────────── */}
            {newPw.length > 0 && (
              <div style={{
                background: dark ? '#0f172a' : '#f8fafc',
                border: `1px solid ${border}`, borderRadius: 6, padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                {RULES.map(r => {
                  const pass = r.test(newPw)
                  return (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
                      <span style={{ color: pass ? '#22c55e' : '#ef4444', fontSize: 13 }}>{pass ? '✓' : '✗'}</span>
                      <span style={{ color: pass ? (dark ? '#86efac' : '#15803d') : sub }}>{r.label}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ─── CONFIRM PASSWORD ─────────────────────── */}
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

            {/* ─── ERROR ────────────────────────────────── */}
            {error && (
              <div style={{
                fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 10px',
              }}>
                {error}
              </div>
            )}

            {/* ─── ACTIONS ──────────────────────────────── */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button" onClick={onClose}
                style={{ padding: '8px 16px', borderRadius: 6, border: `1px solid ${border}`, background: 'none', color: sub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !allRulesPassed || !passwordsMatch || !currentPw}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none',
                  background: (submitting || !allRulesPassed || !passwordsMatch || !currentPw)
                    ? (dark ? '#334155' : '#cbd5e1') : '#E84E0F',
                  color: '#fff', fontWeight: 600, fontSize: 12,
                  cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit',
                }}>
                {submitting ? 'Saving…' : 'Change Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
