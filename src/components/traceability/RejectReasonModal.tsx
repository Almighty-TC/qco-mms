// ─── REJECT REASON MODAL ──────────────────────────────────────
// Mandatory reason textarea. POSTs /cert/:certId/reject. The server
// returns 422 when the reason is empty — surfaced here as an error.
import React, { useState } from 'react'
import axios from 'axios'
import { API, tokens, scrimStyle, centeredModal } from './traceUtil'

interface Props {
  dark: boolean
  certId: number
  fileName: string
  onClose: () => void
  onDone: (msg: string) => void
}

export const RejectReasonModal: React.FC<Props> = ({ dark, certId, fileName, onClose, onDone }) => {
  const t = tokens(dark)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    if (!reason.trim()) { setErr('A rejection reason is required.'); return }
    setSaving(true)
    try {
      await axios.post(`${API}/traceability/cert/${certId}/reject`, { reason: reason.trim() })
      onDone(`Certificate rejected · ${fileName}`)
    } catch (e: any) {
      setErr(e.response?.data?.error || 'Could not reject certificate.')
    } finally { setSaving(false) }
  }

  return (
    <>
      <div onClick={onClose} style={scrimStyle} />
      <div style={{ ...centeredModal(t.cardBg, t.bd, 460), padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.col }}>Reject certificate</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: t.sub, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: t.sub, marginBottom: 16 }}>{fileName}</div>

        <label style={{ fontSize: 11, fontWeight: 600, color: t.sub, display: 'block', marginBottom: 6 }}>Reason for rejection *</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={4}
          placeholder="e.g. Heat number on cert does not match the goods received…"
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '8px 10px', borderRadius: 6,
            border: t.bd, background: t.inputBg, color: t.col, fontFamily: 'inherit', resize: 'vertical' }} />

        {err && <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '8px 10px' }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={submit} disabled={saving}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: saving ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </>
  )
}
