// ─── UPLOAD CERT MODAL ────────────────────────────────────────
// Two modes:
//  • 'row'    — opened from a VDRL row; PO / tag / document are fixed
//               and the upload marks that requirement received.
//  • 'global' — opened from the top-right button; user picks PO, tag
//               and an open VDRL requirement (or free-text document).
// Multipart POST to /:projectId/cert. Upload disabled until both a
// heat/batch/ref number and a file are present.
import React, { useState, useMemo } from 'react'
import axios from 'axios'
import { API, tokens, scrimStyle, centeredModal } from './traceUtil'

export interface VdrlRow {
  cert_id: number
  po_ref: string | null
  vendor_name: string | null
  tag: string | null
  document_name: string
  status: string
}

interface Prefill {
  po_ref?: string | null
  vendor_name?: string | null
  tag?: string | null
  document_name?: string | null
  document_requirement_id?: number | null
}

interface Props {
  dark: boolean
  projectId: number
  mode: 'row' | 'global'
  prefill?: Prefill
  vdrlRows: VdrlRow[]
  onClose: () => void
  onUploaded: (msg: string) => void
}

const today = () => new Date().toISOString().slice(0, 10)

export const UploadCertModal: React.FC<Props> = ({ dark, projectId, mode, prefill, vdrlRows, onClose, onUploaded }) => {
  const t = tokens(dark)

  // ── Global-mode selectors ──────────────────────────────────
  const poOptions = useMemo(() => Array.from(new Set(vdrlRows.map(r => r.po_ref).filter(Boolean))) as string[], [vdrlRows])
  const [po, setPo] = useState<string>(prefill?.po_ref || '')
  const tagOptions = useMemo(
    () => Array.from(new Set(vdrlRows.filter(r => !po || r.po_ref === po).map(r => r.tag).filter(Boolean))) as string[],
    [vdrlRows, po])
  const [tag, setTag] = useState<string>(prefill?.tag || '')
  // Open requirements (pending/overdue) the user can satisfy.
  const openReqs = useMemo(
    () => vdrlRows.filter(r => ['pending', 'overdue'].includes(r.status) && (!po || r.po_ref === po) && (!tag || r.tag === tag)),
    [vdrlRows, po, tag])
  const [reqId, setReqId] = useState<string>(prefill?.document_requirement_id ? String(prefill.document_requirement_id) : '')
  const [freeDoc, setFreeDoc] = useState<string>(prefill?.document_name || '')

  // ── Shared fields ───────────────────────────────────────────
  const [heatRef, setHeatRef]   = useState('')
  const [issueDate, setIssueDate] = useState(today())
  const [appliesTo, setAppliesTo] = useState('')
  const [notes, setNotes]       = useState('')
  const [file, setFile]         = useState<File | null>(null)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const docLabel = mode === 'row'
    ? (prefill?.document_name || 'certificate')
    : (reqId ? (openReqs.find(r => String(r.cert_id) === reqId)?.document_name || 'certificate') : (freeDoc || 'certificate'))

  const vendor = mode === 'row' ? prefill?.vendor_name : (vdrlRows.find(r => r.po_ref === po)?.vendor_name || null)
  const canUpload = !!heatRef.trim() && !!file

  const submit = async () => {
    setErr('')
    if (!canUpload) return
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('heat_ref', heatRef.trim())
      fd.append('issue_date', issueDate)
      if (appliesTo.trim()) fd.append('applies_to', appliesTo.trim())
      if (notes.trim()) fd.append('notes', notes.trim())
      fd.append('file', file as File)

      // Determine requirement id vs ad-hoc.
      const effectiveReqId = mode === 'row' ? prefill?.document_requirement_id : (reqId ? Number(reqId) : null)
      if (effectiveReqId) {
        fd.append('document_requirement_id', String(effectiveReqId))
      } else {
        if (po) fd.append('po_ref', po)
        if (vendor) fd.append('vendor_name', vendor)
        if (tag) fd.append('tag', tag)
        fd.append('document_name', mode === 'row' ? (prefill?.document_name || 'Ad-hoc certificate') : (freeDoc || 'Ad-hoc certificate'))
      }

      await axios.post(`${API}/traceability/${projectId}/cert`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      onUploaded(`Certificate uploaded · ${docLabel}`)
    } catch (e: any) {
      setErr(e.response?.data?.error || 'Could not upload certificate.')
    } finally { setSaving(false) }
  }

  const inputSt: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '8px 10px', borderRadius: 6, border: t.bd, background: t.inputBg, color: t.col, fontFamily: 'inherit' }
  const labelSt: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: t.sub, display: 'block', marginBottom: 5 }

  // Context subtitle line
  const contextLine = mode === 'row'
    ? `${prefill?.po_ref || '—'} · ${prefill?.vendor_name || '—'} · ${prefill?.tag || 'no tag'}`
    : 'Select PO, tag and document below'

  return (
    <>
      <div onClick={onClose} style={scrimStyle} />
      <div style={{ ...centeredModal(t.cardBg, t.bd, 560), padding: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.col }}>↑ Upload {docLabel}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: t.sub, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: t.sub, marginBottom: 18 }}>{contextLine}</div>

        {/* Global-mode selectors */}
        {mode === 'global' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14, padding: 12, border: t.bd, borderRadius: 8, background: dark ? '#162032' : '#f8fafc' }}>
            <div>
              <label style={labelSt}>PO reference</label>
              <select value={po} onChange={e => { setPo(e.target.value); setTag(''); setReqId('') }} style={inputSt}>
                <option value="">— Select PO —</option>
                {poOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>Tag</label>
              <select value={tag} onChange={e => { setTag(e.target.value); setReqId('') }} style={inputSt}>
                <option value="">— Any / no tag —</option>
                {tagOptions.map(tg => <option key={tg} value={tg}>{tg}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelSt}>Document requirement</label>
              <select value={reqId} onChange={e => setReqId(e.target.value)} style={inputSt}>
                <option value="">— Free text (ad-hoc) —</option>
                {openReqs.map(r => (
                  <option key={r.cert_id} value={r.cert_id}>{r.document_name}{r.tag ? ` · ${r.tag}` : ''} ({r.status})</option>
                ))}
              </select>
              {!reqId && (
                <input value={freeDoc} onChange={e => setFreeDoc(e.target.value)} placeholder="Document name (free text)…"
                  style={{ ...inputSt, marginTop: 8 }} />
              )}
            </div>
          </div>
        )}

        {/* Shared fields */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelSt}>Heat / batch / ref number *</label>
          <input value={heatRef} onChange={e => setHeatRef(e.target.value)} placeholder="e.g. A24-887" style={inputSt} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelSt}>Issue date</label>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} style={inputSt} />
          </div>
          <div>
            <label style={labelSt}>Applies to (qty / scope)</label>
            <input value={appliesTo} onChange={e => setAppliesTo(e.target.value)} placeholder="e.g. 1240 m / Shell plate" style={inputSt} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelSt}>File *</label>
          <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx" style={{ display: 'none' }}
            onChange={e => setFile(e.target.files?.[0] || null)} />
          <button onClick={() => fileInputRef.current?.click()}
            style={{ ...inputSt, textAlign: 'left', cursor: 'pointer', color: file ? t.col : t.sub }}>
            {file ? `📄 ${file.name}` : '↑ Choose file (PDF, image, Excel, Word)…'}
          </button>
        </div>

        <div style={{ marginBottom: 4 }}>
          <label style={labelSt}>Notes <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            style={{ ...inputSt, resize: 'vertical' }} />
        </div>

        {err && <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '8px 10px' }}>{err}</div>}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
          <span style={{ fontSize: 11, color: t.sub }}>1 certificate to upload</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button onClick={submit} disabled={!canUpload || saving}
              style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: canUpload ? '#2563eb' : '#94a3b8', color: '#fff', cursor: canUpload && !saving ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}>
              {saving ? 'Uploading…' : '✓ Upload certificate'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
