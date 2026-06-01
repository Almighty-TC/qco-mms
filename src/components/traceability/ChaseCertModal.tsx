// ─── CHASE CERT MODAL ─────────────────────────────────────────
// Chase an outstanding cert against a hold. Recipient defaults to the
// vendor cert contact. Sending an email requires an explicit confirm
// step; "Log chase only" skips the email. Either way the chase is
// recorded and chase_count is incremented server-side.
import React, { useState } from 'react'
import axios from 'axios'
import { API, tokens, scrimStyle, centeredModal } from './traceUtil'

export interface HoldRow {
  hold_id: number
  tag: string | null
  item: string
  hold_reason: string
  vendor_name: string | null
  vendor_email: string | null
  chase_count: number
}

interface Props {
  dark: boolean
  hold: HoldRow
  onClose: () => void
  onChased: (msg: string) => void
}

export const ChaseCertModal: React.FC<Props> = ({ dark, hold, onClose, onChased }) => {
  const t = tokens(dark)
  const [recipient, setRecipient] = useState(hold.vendor_email || '')
  const [subject, setSubject] = useState(`Outstanding cert — ${hold.tag || hold.item} / ${hold.hold_reason}`)
  const [body, setBody] = useState(
    `Hello,\n\nOur records show the certificate for ${hold.tag || hold.item} (${hold.hold_reason}) is still outstanding. The material is on trace hold and cannot be released until the cert is received and verified.\n\nPlease forward the certificate at your earliest convenience.\n\nRegards,\nQCO Materials Control`)
  const [logOnly, setLogOnly] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const doSend = async (sendEmail: boolean) => {
    setSaving(true); setErr('')
    try {
      const { data } = await axios.post(`${API}/traceability/hold/${hold.hold_id}/chase`, {
        send_email: sendEmail, recipient: recipient.trim() || undefined, subject, body,
      })
      onChased(sendEmail
        ? `Chase email sent · chase #${data.chase_count}`
        : `Chase logged · chase #${data.chase_count}`)
    } catch (e: any) {
      setErr(e.response?.data?.error || 'Could not record chase.')
      setSaving(false)
    }
  }

  const onSendClick = () => {
    if (logOnly) { doSend(false); return }
    // Email mode → require explicit confirm before sending.
    setConfirming(true)
  }

  const inputSt: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '8px 10px', borderRadius: 6, border: t.bd, background: t.inputBg, color: t.col, fontFamily: 'inherit' }
  const labelSt: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: t.sub, display: 'block', marginBottom: 5 }

  return (
    <>
      <div onClick={onClose} style={scrimStyle} />
      <div style={{ ...centeredModal(t.cardBg, t.bd, 560), padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.col }}>📎 Chase cert</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: t.sub, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: t.sub, marginBottom: 18 }}>
          {hold.tag || hold.item} · {hold.vendor_name || '—'} · chased {hold.chase_count} time{hold.chase_count !== 1 ? 's' : ''}
        </div>

        {!confirming ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Recipient (vendor cert contact)</label>
              <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="vendor.qa@example.com" style={inputSt} disabled={logOnly} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} style={inputSt} disabled={logOnly} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Message</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={7} style={{ ...inputSt, resize: 'vertical', fontSize: 12 }} disabled={logOnly} />
            </div>
            <label style={{ display: 'flex', gap: 9, alignItems: 'center', cursor: 'pointer', fontSize: 12, color: t.col }}>
              <input type="checkbox" checked={logOnly} onChange={e => setLogOnly(e.target.checked)} style={{ accentColor: '#2563eb', width: 15, height: 15 }} />
              Log chase only (no email)
            </label>

            {err && <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '8px 10px' }}>{err}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
              <button onClick={onSendClick} disabled={saving}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {logOnly ? 'Log chase' : 'Send chase'}
              </button>
            </div>
          </>
        ) : (
          /* ── Explicit confirm step before sending email ── */
          <div>
            <div style={{ fontSize: 13, color: t.col, background: dark ? '#162032' : '#fff7ed', border: '1px solid rgba(232,78,15,0.3)', borderRadius: 8, padding: 14, lineHeight: 1.6 }}>
              ⚠ This will <strong>send an email</strong> to:
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#E84E0F', margin: '6px 0' }}>{recipient || '(no recipient set)'}</div>
              Subject: <em>{subject}</em>
              <div style={{ marginTop: 8, color: t.sub, fontSize: 12 }}>The chase will be recorded and the chase count incremented.</div>
            </div>
            {err && <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setConfirming(false)} disabled={saving} style={{ padding: '8px 16px', borderRadius: 6, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 12 }}>← Back</button>
              <button onClick={() => doSend(true)} disabled={saving}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {saving ? 'Sending…' : '📧 Confirm & send email'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
