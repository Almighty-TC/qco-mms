// ─── REVIEW CERT MODAL ────────────────────────────────────────
// QA verification screen for an approval-queue cert. Verify is
// disabled until all three checklist items are ticked. POST verify
// flips status to verified and releases any hold tied to this cert.
import React, { useState } from 'react'
import axios from 'axios'
import { API, tokens, fmtDate, scrimStyle } from './traceUtil'

export interface ApprovalCert {
  cert_id: number
  file_name: string
  cert_type: string
  item_scope: string
  applies_to?: string | null
  vendor_name: string
  uploader: string
  uploaded_date: string
  priority: 'normal' | 'high'
}

interface Props {
  dark: boolean
  cert: ApprovalCert
  onClose: () => void
  onVerified: (msg: string) => void
}

const CHECKS = [
  { key: 'heat_match',   label: 'Heat / batch number on the cert matches the goods received' },
  { key: 'signed_dated', label: 'Certificate is signed and dated by the vendor QA' },
  { key: 'spec_meets',   label: 'Material standard / grade meets the PO specification' },
] as const

export const ReviewCertModal: React.FC<Props> = ({ dark, cert, onClose, onVerified }) => {
  const t = tokens(dark)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const allChecked = CHECKS.every(c => checked[c.key])

  const verify = async () => {
    setErr('')
    if (!allChecked) return
    setSaving(true)
    try {
      const { data } = await axios.post(`${API}/traceability/cert/${cert.cert_id}/verify`, {
        checklist: { heat_match: !!checked.heat_match, signed_dated: !!checked.signed_dated, spec_meets: !!checked.spec_meets },
        qa_notes: notes.trim() || undefined,
      })
      const rel = data.holds_released ? ` · ${data.holds_released} hold(s) released` : ''
      onVerified(`Certificate verified${rel}`)
    } catch (e: any) {
      setErr(e.response?.data?.error || 'Could not verify certificate.')
    } finally { setSaving(false) }
  }

  const detailRow = (k: string, v: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: t.rowBd, fontSize: 12 }}>
      <span style={{ color: t.sub }}>{k}</span>
      <span style={{ color: t.col, fontWeight: 500, textAlign: 'right' }}>{v}</span>
    </div>
  )

  return (
    <>
      <div onClick={onClose} style={scrimStyle} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: t.cardBg, border: t.bd, borderRadius: 12, zIndex: 6001, width: 900, maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: t.bd, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.col }}>👁 Review certificate — {cert.cert_type}</div>
            <div style={{ fontSize: 12, color: t.sub, marginTop: 3 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{cert.file_name}</span> · {cert.item_scope} · uploaded by {cert.uploader}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: t.sub, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          {/* Left — preview */}
          <div style={{ borderRight: t.bd, padding: 20, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 320, background: t.inputBg, border: `1px dashed ${dark ? '#334155' : '#c4cedf'}`, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: t.sub }}>
              <div style={{ fontSize: 40 }}>📄</div>
              <div style={{ fontSize: 12, marginTop: 8, fontFamily: 'JetBrains Mono, monospace' }}>{cert.file_name}</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>PDF preview (mock)</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={{ flex: 1, padding: '7px 12px', borderRadius: 6, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 12 }}>↓ Download</button>
              <button style={{ flex: 1, padding: '7px 12px', borderRadius: 6, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 12 }}>↗ Open in new tab</button>
            </div>
          </div>

          {/* Right — details + checklist */}
          <div style={{ padding: 20, overflow: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.sub, textTransform: 'uppercase', marginBottom: 6 }}>Certificate details</div>
            {detailRow('Type', cert.cert_type)}
            {detailRow('Item / scope', `${cert.item_scope}${cert.applies_to ? ` · ${cert.applies_to}` : ''}`)}
            {detailRow('Vendor', cert.vendor_name)}
            {detailRow('Uploaded', `${fmtDate(cert.uploaded_date)} · ${cert.uploader}`)}
            {detailRow('Priority', cert.priority === 'high'
              ? <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontWeight: 700 }}>HIGH</span>
              : <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: dark ? '#334155' : '#eef2f7', color: t.sub, fontWeight: 600 }}>Normal</span>)}

            <div style={{ fontSize: 11, fontWeight: 700, color: t.sub, textTransform: 'uppercase', margin: '18px 0 8px' }}>QA verification checklist</div>
            {CHECKS.map(c => (
              <label key={c.key} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '7px 0', cursor: 'pointer', fontSize: 12, color: t.col }}>
                <input type="checkbox" checked={!!checked[c.key]} onChange={e => setChecked(p => ({ ...p, [c.key]: e.target.checked }))}
                  style={{ marginTop: 1, accentColor: '#22c55e', width: 15, height: 15, flexShrink: 0 }} />
                <span>{c.label}</span>
              </label>
            ))}

            <div style={{ fontSize: 11, fontWeight: 700, color: t.sub, textTransform: 'uppercase', margin: '14px 0 6px' }}>QA notes <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 10px', borderRadius: 6, border: t.bd, background: t.inputBg, color: t.col, fontFamily: 'inherit', resize: 'vertical' }} />

            <div style={{ marginTop: 14, fontSize: 11, color: t.sub, background: dark ? '#162032' : '#eff4fb', border: t.bd, borderRadius: 6, padding: '9px 11px', lineHeight: 1.5 }}>
              ℹ Verifying releases the related material from trace hold and updates the cert chain. Action is recorded in the Audit log.
            </div>

            {err && <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '8px 10px' }}>{err}</div>}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: t.bd, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 6, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={verify} disabled={!allChecked || saving}
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: allChecked ? '#22c55e' : '#94a3b8', color: '#fff', cursor: allChecked && !saving ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}>
            {saving ? 'Verifying…' : '✓ Verify certificate'}
          </button>
        </div>
      </div>
    </>
  )
}
