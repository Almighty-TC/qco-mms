// ─── CERTIFICATES MODAL ─────────────────────────────────────
// Shared by Commodity Library and Equipment List.
// Upload, view, download and delete certificates.
import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'

import { API } from '../lib/api'
import { downloadFile, viewFile } from '../lib/fileAccess'   // authed Download/View (replaces window.open 401)

// ─── TYPES ──────────────────────────────────────────────────
export interface CertEntry {
  id: number
  entity_type: 'commodity' | 'equipment'
  entity_id: number
  project_id: number
  cert_type: string
  ref_number: string | null
  applies_to: string | null
  issue_date: string | null
  filename: string | null
  file_size: number | null
  status: 'Verified' | 'Pending QA' | 'Rejected' | 'Expired'
  uploaded_by: number
  uploaded_at: string
  uploaded_by_name: string | null
}

const CERT_TYPES = ['Heat number', 'Batch-lot', 'Mill test', 'Heat-treatment', 'DG-hazmat', 'CoC', 'CoO', 'Calibration']
const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'Verified':   { bg: 'rgba(34,197,94,0.12)',  text: '#15803d' },
  'Pending QA': { bg: 'rgba(245,158,11,0.12)', text: '#b45309' },
  'Rejected':   { bg: 'rgba(239,68,68,0.12)',  text: '#dc2626' },
  'Expired':    { bg: 'rgba(148,163,184,0.15)', text: '#475569' },
}

const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtSize = (b: number | null) => {
  if (!b) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

// ─── UPLOAD FORM ─────────────────────────────────────────────
const UploadForm = ({ projectId, entityType, entityId, dark, onUploaded }: {
  projectId: number; entityType: 'commodity' | 'equipment'; entityId: number
  dark: boolean; onUploaded: (cert: CertEntry) => void
}) => {
  const [certType, setCertType] = useState('')
  const [refNum,   setRefNum]   = useState('')
  const [appliesTo, setApplies] = useState('')
  const [issueDate, setIssue]   = useState('')
  const [file,     setFile]     = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const col = dark ? '#f1f5f9' : '#0f172a'

  const inp = { height: 32, padding: '0 10px', borderRadius: 6, width: '100%', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }

  const submit = async () => {
    if (!certType) { setErr('Select a certificate type'); return }
    setUploading(true); setErr('')
    try {
      const fd = new FormData()
      fd.append('cert_type', certType)
      if (refNum)   fd.append('ref_number', refNum)
      if (appliesTo) fd.append('applies_to', appliesTo)
      if (issueDate) fd.append('issue_date', issueDate)
      if (file)     fd.append('file', file)
      const { data } = await axios.post(
        `${API}/foundational/${projectId}/certificates/${entityType}/${entityId}`, fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      onUploaded(data)
      setCertType(''); setRefNum(''); setApplies(''); setIssue(''); setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      setErr(er.response?.data?.error ?? 'Upload failed')
    } finally { setUploading(false) }
  }

  return (
    <div style={{ background: dark ? '#0f172a' : '#f8fafc', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8, padding: '14px 16px', marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>Upload certificate</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 3 }}>CERT TYPE *</div>
          <select value={certType} onChange={e => setCertType(e.target.value)} style={{ ...inp, height: 32 }}>
            <option value="">— Select type</option>
            {CERT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 3 }}>REF / HEAT / BATCH NO.</div>
          <input value={refNum} onChange={e => setRefNum(e.target.value)} placeholder="e.g. HN-2024-0042" style={inp} />
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 3 }}>APPLIES TO (scope)</div>
          <input value={appliesTo} onChange={e => setApplies(e.target.value)} placeholder="e.g. Items 001–048, Tag P-101A" style={inp} />
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 3 }}>ISSUE DATE</div>
          <input type="date" value={issueDate} onChange={e => setIssue(e.target.value)} style={inp} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 3 }}>FILE (optional)</div>
          <input ref={fileRef} type="file" onChange={e => setFile(e.target.files?.[0] ?? null)}
            accept=".pdf,.xlsx,.xls,.doc,.docx,.jpg,.jpeg,.png,.tif"
            style={{ ...inp, height: 'auto', padding: '5px 10px', cursor: 'pointer' }} />
        </div>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 11, color: '#ef4444' }}>{err}</div>}
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={submit} disabled={!certType || uploading}
          style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: certType ? '#2563eb' : '#94a3b8', color: '#fff', fontSize: 12, fontWeight: 600, cursor: certType ? 'pointer' : 'not-allowed', fontFamily: 'inherit', opacity: uploading ? 0.7 : 1 }}>
          {uploading ? 'Uploading…' : '↑ Upload'}
        </button>
      </div>
    </div>
  )
}

// ─── CERT ROW ────────────────────────────────────────────────
const CertRow = ({ cert, dark, onDelete }: { cert: CertEntry; dark: boolean; onDelete: (id: number) => void }) => {
  const [deleting, setDeleting] = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const { bg, text } = STATUS_STYLES[cert.status] ?? STATUS_STYLES['Pending QA']

  // Authed Download + View (was window.open(apiURL) → 401; the route is JWT-gated).
  const fileUrl = `${API}/foundational/${cert.project_id}/certificates/${cert.id}/download`
  const niceName = (cert.filename || 'certificate').replace(/^.*\//, '').replace(/^\d+-/, '')
  const download = () => { downloadFile(fileUrl, niceName).catch(() => alert('Failed to download certificate')) }
  const view = () => { viewFile(fileUrl).catch(() => alert('Failed to open certificate')) }

  const doDelete = async () => {
    if (!confirm('Delete this certificate?')) return
    setDeleting(true)
    try {
      await axios.delete(`${API}/foundational/${cert.project_id}/certificates/${cert.id}`)
      onDelete(cert.id)
    } finally { setDeleting(false) }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', background: dark ? '#1e293b' : '#fff', borderRadius: 7, border: `1px solid ${dark ? '#334155' : '#e8ecf2'}`, marginBottom: 6 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: col }}>{cert.ref_number || '—'}</span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>·</span>
          <span style={{ fontSize: 11, color: '#64748b' }}>{cert.applies_to || '—'}</span>
          {cert.filename && <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cert.filename.replace(/^\d+-/, '')}</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ background: bg, color: text, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 9999, letterSpacing: '0.04em' }}>{cert.status}</span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{fmtDate(cert.issue_date)}</span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>by {cert.uploaded_by_name ?? 'unknown'}</span>
          {cert.file_size && <span style={{ fontSize: 11, color: '#94a3b8' }}>{fmtSize(cert.file_size)}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {cert.filename && (<>
          <button onClick={view} title="View" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 12, padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit' }}>👁</button>
          <button onClick={download} title="Download" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', fontSize: 12, padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit' }}>↓</button>
        </>)}
        <button onClick={doDelete} disabled={deleting} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 12, padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit', opacity: deleting ? 0.5 : 1 }}>×</button>
      </div>
    </div>
  )
}

// ─── MAIN MODAL ──────────────────────────────────────────────
export const CertificatesModal = ({ projectId, entityType, entityId, entityCode, entityName, dark, onClose }: {
  projectId: number
  entityType: 'commodity' | 'equipment'
  entityId: number
  entityCode: string
  entityName: string
  dark: boolean
  onClose: () => void
}) => {
  const [certs, setCerts]   = useState<CertEntry[]>([])
  const [loading, setLoading] = useState(true)
  const col = dark ? '#f1f5f9' : '#0f172a'

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/foundational/${projectId}/certificates/${entityType}/${entityId}`)
      setCerts(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [projectId, entityType, entityId])

  // Group by cert_type
  const grouped = certs.reduce<Record<string, CertEntry[]>>((acc, c) => {
    if (!acc[c.cert_type]) acc[c.cert_type] = []
    acc[c.cert_type].push(c)
    return acc
  }, {})

  const verified = certs.filter(c => c.status === 'Verified').length
  const pending  = certs.filter(c => c.status === 'Pending QA').length
  const rejected = certs.filter(c => c.status === 'Rejected').length

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#f4f7fb', borderRadius: 10, width: 620, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.4)', fontFamily: 'IBM Plex Sans, sans-serif', border: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: col }}>📎 Certificates · <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{entityCode}</span></div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{entityName} · {certs.length} certificate{certs.length !== 1 ? 's' : ''}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
          </div>
          {/* Summary bar */}
          <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
            <span style={{ fontSize: 12, color: '#22c55e' }}>✓ {verified} verified</span>
            <span style={{ fontSize: 12, color: '#f59e0b' }}>⏳ {pending} pending</span>
            <span style={{ fontSize: 12, color: '#ef4444' }}>✕ {rejected} rejected</span>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          <UploadForm projectId={projectId} entityType={entityType} entityId={entityId} dark={dark}
            onUploaded={cert => { setCerts(prev => [cert, ...prev]); setLoading(false) }} />

          {loading ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>Loading…</div>
          ) : certs.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>No certificates uploaded yet.</div>
          ) : (
            Object.entries(grouped).map(([type, entries]) => (
              <div key={type} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{type} ({entries.length})</div>
                {entries.map(cert => (
                  <CertRow key={cert.id} cert={cert} dark={dark}
                    onDelete={id => setCerts(prev => prev.filter(c => c.id !== id))} />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
