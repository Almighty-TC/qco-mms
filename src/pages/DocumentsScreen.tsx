// ─── DOCUMENT INBOX (AGGREGATE REGISTER) ──────────────────────
// Project-wide, read-only unified view of every module's documents.
// Rows link back to their source record (real deep-link nav now that
// BUG-09 is fixed). This screen owns no documents — uploads route to the
// chosen module's own endpoint. Reuses the shared token / pill / table
// patterns from Traceability & Material Control.
import React, { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'

const API = 'http://localhost:3001/api'

type GroupBy = 'none' | 'module' | 'source' | 'type' | 'uploader'
type RangeKey = '7' | '30' | '90' | 'all'

interface DocRow {
  doc_id: string; file_name: string | null; file_label: string; file_size: number | null
  type_tags: string[]; module: string; source_label: string; source_record_id: number
  source_url: string; uploaded_by: string | null; uploaded_at: string | null
  status: 'Verified' | 'Available' | 'Under review' | 'Missing'; is_missing: boolean
  group_key?: string
}
interface Summary { total: number; uploaded_last_7d: number; under_review: number; verified: number; missing: number }

const MODULES = ['All', 'Foundational', 'MTO', 'Procurement', 'Expediting', 'VDRL', 'Logistics', 'Material Control', 'Traceability']
// Modules whose upload endpoint is wired straight from this dropzone.
const UPLOAD_SUPPORTED: Record<string, boolean> = { Logistics: true, Procurement: true }

const statusPill = (s: string) => {
  switch (s) {
    case 'Verified':     return { color: '#16a34a', bg: 'rgba(34,197,94,0.12)' }
    case 'Under review': return { color: '#d97706', bg: 'rgba(245,158,11,0.12)' }
    case 'Missing':      return { color: '#dc2626', bg: 'rgba(239,68,68,0.12)' }
    default:             return { color: '#2563eb', bg: 'rgba(37,99,235,0.1)' } // Available
  }
}
const fmtBytes = (b: number | null) => !b ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} kB` : `${(b / 1048576).toFixed(1)} MB`
const fmtDate = (d: string | null) => {
  if (!d) return '—'
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return d
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${m[3]} ${months[+m[2] - 1]} ${m[1]}`
}

const DocumentsInner = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const { addToast } = useToast()
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bg     = dark ? '#0f172a' : '#f4f7fb'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'
  const rowBd  = `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`

  const [summary, setSummary] = useState<Summary | null>(null)
  const [rows, setRows]       = useState<DocRow[]>([])
  const [groups, setGroups]   = useState<{ key: string; count: number }[] | null>(null)
  const [totalUnfiltered, setTotalUnfiltered] = useState(0)
  const [loading, setLoading] = useState(true)

  const [q, setQ]           = useState('')
  const [module, setModule] = useState('All')
  const [status, setStatus] = useState('All')
  const [range, setRange]   = useState<RangeKey>('all')
  const [mine, setMine]     = useState(false)
  const [groupBy, setGroupBy] = useState<GroupBy>('none')

  const [preview, setPreview] = useState<DocRow | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const loadSummary = async () => {
    try { const { data } = await axios.get(`${API}/documents/${projectId}/summary`); setSummary(data) }
    catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to load summary') }
  }
  const loadRows = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/documents/${projectId}`, {
        params: { q: q.trim() || undefined, module, status, range, mine: mine ? 'true' : undefined, group_by: groupBy },
      })
      setRows(data.data || []); setGroups(data.groups || null); setTotalUnfiltered(data.total_unfiltered || 0)
    } catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to load documents') }
    finally { setLoading(false) }
  }

  useEffect(() => { loadSummary() }, [projectId]) // eslint-disable-line
  useEffect(() => { loadRows() }, [projectId, module, status, range, mine, groupBy]) // eslint-disable-line
  useEffect(() => { const t = setTimeout(loadRows, 300); return () => clearTimeout(t) }, [q]) // eslint-disable-line

  const goSource = (r: DocRow) => { window.location.href = r.source_url }
  // NOTE: the inbox is a read-only AGGREGATOR — it does not stream file bytes.
  // A direct in-inbox download isn't wired: storage is heterogeneous/partly-unbuilt
  // (VDRL/MTO/Traceability have no file storage; Procurement/Logistics/Foundational
  // store on disk but there's no unified serving route + PO docs don't carry poId).
  // The honest path to the file is "Open in source" (goSource) — the owning module's
  // screen, where its own download works. The previous fake "Downloading…" toast is gone.
  const exportCsv = async () => {
    try {
      const { data } = await axios.get(`${API}/documents/${projectId}/export`, {
        params: { q: q.trim() || undefined, module, status, range, mine: mine ? 'true' : undefined },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }))
      const a = document.createElement('a'); a.href = url; a.download = `document_register_p${projectId}.csv`; a.click()
      URL.revokeObjectURL(url); addToast('success', 'Register exported')
    } catch (e: any) { addToast('error', e.response?.data?.error || 'Export failed') }
  }

  // Bucket rows by group_key for grouped rendering.
  const grouped = useMemo(() => {
    if (groupBy === 'none' || !groups) return null
    const map: Record<string, DocRow[]> = {}
    rows.forEach(r => { const k = r.group_key || '—'; (map[k] ||= []).push(r) })
    return groups.map(g => ({ ...g, rows: map[g.key] || [] }))
  }, [rows, groups, groupBy])

  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit' }
  const thSt: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap' }
  const tdSt: React.CSSProperties = { padding: '9px 12px', fontSize: 12, color: col, verticalAlign: 'top' }
  const mono: React.CSSProperties = { fontFamily: 'JetBrains Mono, monospace' }

  const renderRow = (r: DocRow) => {
    const pill = statusPill(r.status)
    return (
      <tr key={r.doc_id} onClick={() => !r.is_missing && setPreview(r)}
        style={{ borderBottom: rowBd, cursor: r.is_missing ? 'default' : 'pointer' }}>
        {/* FILE / TYPE */}
        <td style={{ ...tdSt, maxWidth: 320 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {r.is_missing && <span title="Missing — action required" style={{ color: '#dc2626' }}>⚠</span>}
            <span style={{ fontWeight: 600 }}>{r.file_label}</span>
          </div>
          {r.file_name && <div style={{ ...mono, fontSize: 10.5, color: sub, marginTop: 1 }}>{r.file_name}{r.file_size ? ` · ${fmtBytes(r.file_size)}` : ''}</div>}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            {r.type_tags.map(t => <span key={t} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 5, background: dark ? '#334155' : '#eef2f7', color: sub, fontWeight: 600 }}>{t}</span>)}
          </div>
        </td>
        <td style={tdSt}><span style={{ fontSize: 11, fontWeight: 600 }}>{r.module}</span></td>
        <td style={{ ...tdSt, ...mono, fontSize: 11, color: '#2563eb' }}>{r.source_label}</td>
        <td style={{ ...tdSt, fontSize: 11 }}>{r.uploaded_by || '—'}</td>
        <td style={{ ...tdSt, ...mono, fontSize: 11, color: sub }}>{fmtDate(r.uploaded_at)}</td>
        <td style={tdSt}><span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: pill.bg, color: pill.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.status}</span></td>
        <td style={tdSt} onClick={e => e.stopPropagation()}>
          {r.is_missing ? (
            <button onClick={() => setShowUpload(true)} style={{ padding: '4px 10px', borderRadius: 5, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>↑ Upload</button>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <button title="Preview" onClick={() => setPreview(r)} style={{ padding: '4px 8px', borderRadius: 5, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 11 }}>👁</button>
              <button title={`Open in ${r.module} (download the file there)`} onClick={() => goSource(r)} style={{ padding: '4px 8px', borderRadius: 5, border: bd, background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11 }}>↗ Open</button>
            </div>
          )}
        </td>
      </tr>
    )
  }

  const headerCells = ['FILE / TYPE', 'MODULE', 'SOURCE', 'UPLOADED BY', 'DATE', 'STATUS', '']

  return (
    <div style={{ background: bg, minHeight: '100vh', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Sticky breadcrumb header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: cardBg, borderBottom: bd, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onClick={onBack} dark={dark} />
          <div style={{ fontSize: 11, color: sub }}>Dashboard › {projectName} › <strong style={{ color: col }}>Document Inbox</strong></div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>↓ Export register</button>
          <button onClick={() => setShowUpload(true)} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>↑ Upload document</button>
        </div>
      </div>

      <div style={{ padding: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: col }}>📥 Document Inbox</h1>
        <div style={{ fontSize: 12, color: sub, marginBottom: 20 }}>Every document across the project · single point of search · click any row to jump to its source record</div>

        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total documents', value: summary?.total, color: col },
            { label: 'Uploaded last 7 days', value: summary?.uploaded_last_7d, color: '#2563eb' },
            { label: 'Under review', value: summary?.under_review, color: '#d97706' },
            { label: 'Verified', value: summary?.verified, color: '#16a34a' },
            { label: 'Missing — action required', value: summary?.missing, color: '#ef4444' },
          ].map(k => (
            <div key={k.label} style={{ background: cardBg, border: bd, borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: k.color }}>{k.value ?? '…'}</div>
              <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search filename, source, tag, type, uploader…" style={{ ...inputSt, flex: '1 1 260px' }} />
          <select value={status} onChange={e => setStatus(e.target.value)} style={inputSt}>
            {['All', 'Verified', 'Available', 'Under review', 'Missing'].map(s => <option key={s} value={s}>{s === 'All' ? 'All statuses' : s}</option>)}
          </select>
          <div style={{ display: 'flex', border: bd, borderRadius: 6, overflow: 'hidden' }}>
            {(['7', '30', '90', 'all'] as RangeKey[]).map(rk => (
              <button key={rk} onClick={() => setRange(rk)} style={{ padding: '7px 11px', border: 'none', background: range === rk ? '#2563eb' : 'none', color: range === rk ? '#fff' : sub, cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>
                {rk === 'all' ? 'All time' : `${rk}d`}
              </button>
            ))}
          </div>
          <button onClick={() => setMine(v => !v)} style={{ ...inputSt, cursor: 'pointer', color: mine ? '#E84E0F' : sub, borderColor: mine ? '#E84E0F' : undefined }}>👤 My uploads only</button>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)} style={inputSt}>
            {(['none', 'module', 'source', 'type', 'uploader'] as GroupBy[]).map(g => <option key={g} value={g}>Group by: {g === 'none' ? 'None' : g[0].toUpperCase() + g.slice(1)}</option>)}
          </select>
        </div>

        {/* Module pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {MODULES.map(m => (
            <button key={m} onClick={() => setModule(m)}
              style={{ padding: '5px 12px', borderRadius: 9999, border: `1px solid ${module === m ? '#2563eb' : (dark ? '#334155' : '#dde3ed')}`, background: module === m ? '#2563eb' : 'none', color: module === m ? '#fff' : col, cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
              {m}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 11, color: sub, marginBottom: 10 }}>{rows.length} of {totalUnfiltered} documents</div>

        {/* Table */}
        <div style={{ background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                <tr style={{ borderBottom: bd }}>{headerCells.map(h => <th key={h} style={thSt}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: sub }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 50, textAlign: 'center', color: sub }}>
                    No documents match.{module === 'Material Control' && <div style={{ marginTop: 6, fontSize: 11 }}>Material Control has no document source wired yet.</div>}
                  </td></tr>
                ) : grouped ? (
                  grouped.map(g => (
                    <React.Fragment key={g.key}>
                      <tr><td colSpan={7} style={{ padding: '8px 12px', background: dark ? '#162032' : '#f1f5f9', fontSize: 11, fontWeight: 700, color: col }}>{g.key} · {g.count} doc{g.count !== 1 ? 's' : ''}</td></tr>
                      {g.rows.map(renderRow)}
                    </React.Fragment>
                  ))
                ) : rows.map(renderRow)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {preview && <PreviewModal dark={dark} doc={preview} onClose={() => setPreview(null)} onGoSource={() => goSource(preview)} />}
      {showUpload && (
        <UploadDocModal dark={dark} projectId={projectId}
          onClose={() => setShowUpload(false)}
          onDone={() => { setShowUpload(false); loadSummary(); loadRows() }} addToast={addToast} />
      )}
    </div>
  )
}

// ─── PREVIEW MODAL (mock) ─────────────────────────────────────
const PreviewModal = ({ dark, doc, onClose, onGoSource }: { dark: boolean; doc: DocRow; onClose: () => void; onGoSource: () => void }) => {
  const col = dark ? '#f1f5f9' : '#0f172a'; const cardBg = dark ? '#1e293b' : '#fff'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`; const sub = '#94a3b8'
  const meta = (k: string, v: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, fontSize: 12 }}>
      <span style={{ color: sub }}>{k}</span><span style={{ color: col, fontWeight: 500, textAlign: 'right' }}>{v}</span>
    </div>
  )
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, width: 760, maxWidth: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ padding: '16px 22px', borderBottom: bd, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col }}>📄 {doc.file_label}</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>{doc.file_name || '— no file —'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 0 }}>
          <div style={{ borderRight: bd, padding: 20 }}>
            <div style={{ minHeight: 300, background: dark ? '#0f172a' : '#f8fafc', border: `1px dashed ${dark ? '#334155' : '#c4cedf'}`, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: sub }}>
              <div style={{ fontSize: 40 }}>📄</div>
              <div style={{ fontSize: 12, marginTop: 8, fontFamily: 'JetBrains Mono, monospace' }}>{doc.file_name || doc.file_label}</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Preview (mock)</div>
            </div>
          </div>
          <div style={{ padding: 18 }}>
            {meta('Module', doc.module)}
            {meta('Source', doc.source_label)}
            {meta('Type', doc.type_tags.join(' / '))}
            {meta('Uploaded by', doc.uploaded_by || '—')}
            {meta('Date', fmtDate(doc.uploaded_at))}
            {meta('Status', doc.status)}
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: bd, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onGoSource} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>↗ Go to source</button>
        </div>
      </div>
    </>
  )
}

// ─── UPLOAD DOC MODAL (routes to a module endpoint) ───────────
const UploadDocModal = ({ dark, projectId, onClose, onDone, addToast }: {
  dark: boolean; projectId: number; onClose: () => void; onDone: () => void
  addToast: (t: 'success' | 'error', m: string) => void
}) => {
  const col = dark ? '#f1f5f9' : '#0f172a'; const cardBg = dark ? '#1e293b' : '#fff'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`; const sub = '#94a3b8'
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

  const [files, setFiles] = useState<File[]>([])
  const [module, setModule] = useState('')
  const [sources, setSources] = useState<{ id: number; label: string }[]>([])
  const [sourceId, setSourceId] = useState('')
  const [docType, setDocType] = useState('Other')
  const [saving, setSaving] = useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  // Load the chosen module's source records (supported targets only).
  useEffect(() => {
    setSourceId(''); setSources([])
    if (!UPLOAD_SUPPORTED[module]) return
    const run = async () => {
      try {
        if (module === 'Logistics') {
          const { data } = await axios.get(`${API}/logistics/register/${projectId}`)
          const list = (data.data || data.scns || data || [])
          setSources(list.map((s: any) => ({ id: s.id, label: s.scn_ref || `SCN ${s.id}` })))
        } else if (module === 'Procurement') {
          const { data } = await axios.get(`${API}/procurement/${projectId}/pos`)
          const list = (data.data || data || [])
          setSources(list.map((p: any) => ({ id: p.id, label: p.po_number || `PO ${p.id}` })))
        }
      } catch { addToast('error', `Could not load ${module} records`) }
    }
    run()
  }, [module]) // eslint-disable-line

  const addFiles = (fl: FileList | null) => { if (fl) setFiles(p => [...p, ...Array.from(fl)]) }
  const supported = UPLOAD_SUPPORTED[module]
  const canFile = files.length > 0 && supported && !!sourceId

  const fileAll = async () => {
    if (!canFile) return
    setSaving(true)
    let ok = 0
    try {
      for (const f of files) {
        const fd = new FormData()
        fd.append('file', f)
        if (module === 'Logistics') { fd.append('document_type', docType) ; await axios.post(`${API}/logistics/scn/${sourceId}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) }
        else if (module === 'Procurement') { await axios.post(`${API}/procurement/pos/${sourceId}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) }
        ok++
      }
      addToast('success', `Filed ${ok} document${ok !== 1 ? 's' : ''} to ${module}`)
      onDone()
    } catch (e: any) { addToast('error', e.response?.data?.error || `Upload to ${module} failed`) }
    finally { setSaving(false) }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 24, width: 560, maxWidth: '95vw', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: col }}>↑ Upload document</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: sub, marginBottom: 16 }}>Documents are owned by their module — choose where to file each one.</div>

        {/* Dropzone */}
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
        <div onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
          style={{ border: `1px dashed ${dark ? '#475569' : '#c4cedf'}`, borderRadius: 8, padding: 22, textAlign: 'center', color: sub, cursor: 'pointer', marginBottom: 14, background: dark ? '#0f172a' : '#f8fafc' }}>
          <div style={{ fontSize: 22 }}>📁</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>Drop files here or click to browse — PDF, Excel, Word, DWG, images</div>
          <div style={{ fontSize: 11, marginTop: 2 }}>multiple files · you'll choose where to file each one</div>
        </div>

        {files.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 12, color: col }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>📄 {f.name}</span>
                <button onClick={() => setFiles(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Target selection */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 6 }}>
          <div>
            <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>File to module</label>
            <select value={module} onChange={e => setModule(e.target.value)} style={inputSt}>
              <option value="">— Select module —</option>
              {MODULES.filter(m => m !== 'All').map(m => <option key={m} value={m}>{m}{UPLOAD_SUPPORTED[m] ? '' : ' (use module screen)'}</option>)}
            </select>
          </div>
          {supported && (
            <div>
              <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Source record</label>
              <select value={sourceId} onChange={e => setSourceId(e.target.value)} style={inputSt}>
                <option value="">— Select {module === 'Logistics' ? 'SCN' : 'PO'} —</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          )}
        </div>
        {module === 'Logistics' && supported && (
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Document type</label>
            <select value={docType} onChange={e => setDocType(e.target.value)} style={inputSt}>
              {['Commercial Invoice', 'Packing List', 'Bill of Lading', 'Certificate of Origin', 'Dangerous Goods Declaration', 'Other'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        {module && !supported && (
          <div style={{ fontSize: 11, color: '#d97706', background: dark ? '#2a2410' : '#fffbeb', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '8px 10px', marginTop: 4 }}>
            ⚠ Upload for <strong>{module}</strong> isn't wired here yet — its uploader needs record-specific details. Use the {module} screen to upload.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={fileAll} disabled={!canFile || saving}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: canFile ? '#2563eb' : '#94a3b8', color: '#fff', cursor: canFile && !saving ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}>
            {saving ? 'Filing…' : `File ${files.length || ''} document${files.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </>
  )
}

export const DocumentsScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider><DocumentsInner {...props} /></ToastProvider>
)
