// ─── MTO DETAIL SCREEN ───────────────────────────────────────────────────────
// Shows one MTO register with four tabs:
//   A — Line Items (filterable by status, searchable)
//   B — Version History (revisions list)
//   C — Rev Diff (compare any two revisions)
//   D — Variation Flags (placeholder)
import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'

// Resizable column defaults — MTO line-items grid (12 cols) + revision history (5 cols).
const MTO_LINE_W   = [70, 110, 260, 90, 70, 110, 120, 120, 80, 50]
const MTO_LINE_MIN = [50, 70, 120, 60, 50, 80, 80, 90, 60, 40]
const MTO_REV_W    = [140, 200, 130, 320, 80]
const MTO_REV_MIN  = [90, 120, 90, 120, 60]
import { HelpButton } from '../components/HelpDrawer'
import { MTO_DETAIL_HELP } from '../helpContent'
import { BackButton } from '../components/BackButton'
import { revisionFormatError } from './MTOListScreen'
import { MilestoneLegend } from '../components/MilestoneLegend'
import { Pager } from '../components/Pager'
import { usePagedList } from '../hooks/usePagedList'

// ─── API BASE ────────────────────────────────────────────────────────────────
const API = 'http://localhost:3001/api'

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface MTORegister {
  id: number
  project_id: number
  name: string
  reference: string
  current_revision: string
  owner: string | null
  description: string | null
  status: 'active' | 'superseded'
  line_count: number
  updated_at: string
}

interface MTOLine {
  id: number
  mto_id: number
  revision: string
  line_number: string
  wbs_code: string | null
  description: string
  quantity: number | null
  uom: string | null
  ros_date: string | null
  inspection_class: 'Class I' | 'Class II' | 'Class III'
  vdrl_required: number
  po_ref: string | null
  status: 'not-started' | 'rfq' | 'po-raised'
  is_deleted: number
}

interface Revision {
  id: number
  mto_id: number
  revision: string
  uploaded_by_name: string | null
  notes: string | null
  line_count: number
  created_at: string
}

interface DiffResult {
  added: MTOLine[]
  modified: (MTOLine & { changes: Record<string, { from: unknown; to: unknown }> })[]
  deleted: MTOLine[]
  unchanged: number
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Suggest the next revision label. Works for pure letters (A→B, Z→AA), pure
// numbers (1→2, 09→10) and mixed (2A→2B, R0→R1) — but it's only a suggestion;
// the user can type any revision (letters, numbers or a mix).
function suggestRev(cur: string | null | undefined): string {
  const s = String(cur ?? 'A').trim()
  if (!s) return 'A'
  if (/^\d+$/.test(s)) return String(Number(s) + 1)
  if (/^[A-Za-z]+$/.test(s)) {
    const a = s.toUpperCase().split('')
    for (let i = a.length - 1; i >= 0; i--) {
      if (a[i] === 'Z') a[i] = 'A'
      else { a[i] = String.fromCharCode(a[i].charCodeAt(0) + 1); return a.join('') }
    }
    return 'A' + a.join('')
  }
  const m = s.match(/^(.*?)([0-9]+)$/)   // trailing number → bump it (R0→R1, 2A09→…)
  if (m) return m[1] + String(Number(m[2]) + 1)
  const last = s.slice(-1)
  if (/[A-Ya-y]/.test(last)) return s.slice(0, -1) + String.fromCharCode(last.charCodeAt(0) + 1)
  return s + '1'
}

// ─── BUG-3: diff value display — format date fields instead of raw ISO ────────
const isDateField = (f: string) => f.includes('date') || f.includes('_at')
const displayVal = (field: string, val: unknown): string => {
  if (isDateField(field) && val) {
    try { return new Date(String(val)).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) }
    catch { return String(val) }
  }
  return val == null ? '—' : String(val)
}

// ─── STATUS PILL ─────────────────────────────────────────────────────────────
const LinePill = ({ s }: { s: MTOLine['status'] }) => {
  const map = {
    'po-raised':   { bg: 'rgba(21,128,61,0.12)',  color: '#15803d', label: 'PO Raised',   border: 'rgba(21,128,61,0.25)' },
    'rfq':         { bg: 'rgba(29,78,216,0.1)',   color: '#1d4ed8', label: 'RFQ',         border: 'rgba(29,78,216,0.2)' },
    'not-started': { bg: 'rgba(148,163,184,0.14)',color: '#64748b', label: 'Not started', border: 'rgba(148,163,184,0.3)' },
  }
  const { bg, color, label, border } = map[s]
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 9999,
      fontSize: 11, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif',
      background: bg, color, border: `1px solid ${border}`,
    }}>{label}</span>
  )
}

// ─── LINE EDIT MODAL ──────────────────────────────────────────────────────────
const MTOLineEditModal = ({
  line, dark, onClose, onSaved, projectId, mtoId,
}: {
  line: MTOLine; dark: boolean
  onClose: () => void
  onSaved: (updated: MTOLine) => void
  projectId: number; mtoId: number
}) => {
  const { addToast } = useToast()
  const locked = line.status === 'po-raised'

  const [rosDate,      setRosDate]      = useState(line.ros_date?.slice(0,10) ?? '')
  const [description,  setDescription]  = useState(line.description)
  const [quantity,     setQuantity]     = useState(String(line.quantity ?? ''))
  const [uom,          setUom]          = useState(line.uom ?? '')
  const [wbsCode,      setWbsCode]      = useState(line.wbs_code ?? '')
  const [poRef,        setPoRef]        = useState(line.po_ref ?? '')
  const [status,       setStatus]       = useState(line.status)
  const [saving,       setSaving]       = useState(false)

  const bg  = dark ? '#0f172a' : '#fff'
  const bd  = `1px solid ${dark ? '#334155' : '#e2e8f0'}`
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = dark ? '#94a3b8' : '#64748b'
  const inp: React.CSSProperties = {
    background: dark ? '#1e293b' : '#f8fafc', border: bd, color: col,
    borderRadius: 6, padding: '7px 10px', fontSize: 13,
    fontFamily: 'IBM Plex Sans, sans-serif', width: '100%', boxSizing: 'border-box',
  }

  async function save() {
    setSaving(true)
    try {
      const payload = locked
        ? { ros_date: rosDate || null }
        : { description, quantity: quantity ? parseFloat(quantity) : null, uom, wbs_code: wbsCode || null,
            ros_date: rosDate || null, po_ref: poRef || null, status }
      const { data } = await axios.put<MTOLine>(
        `${API}/mto/${projectId}/${mtoId}/lines/${line.id}`, payload
      )
      addToast('success', `Line ${line.line_number} updated`)
      onSaved(data)
    } catch (e: any) {
      addToast('error', e.response?.data?.error ?? 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9100,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: bg, border: bd, borderRadius: 12, padding: 28,
        width: '90%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: col, fontFamily: 'IBM Plex Sans, sans-serif' }}>
            Edit Line {line.line_number}
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: sub, fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        {locked && (
          <div style={{
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 7, padding: '10px 14px', marginBottom: 16, fontSize: 12,
            color: '#92400e', fontFamily: 'IBM Plex Sans, sans-serif',
          }}>
            🔒 This line is locked — PO has been raised. Only the ROS date can be edited.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Description */}
          <div style={{ gridColumn: '1/-1' }}>
            <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4, fontFamily: 'IBM Plex Sans, sans-serif' }}>Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              disabled={locked} style={{ ...inp, opacity: locked ? 0.6 : 1 }} />
          </div>
          {/* WBS */}
          <div>
            <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4, fontFamily: 'IBM Plex Sans, sans-serif' }}>WBS Code</label>
            <input value={wbsCode} onChange={e => setWbsCode(e.target.value)}
              disabled={locked} style={{ ...inp, opacity: locked ? 0.6 : 1, fontFamily: 'JetBrains Mono, monospace' }} />
          </div>
          {/* Qty */}
          <div>
            <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4, fontFamily: 'IBM Plex Sans, sans-serif' }}>Quantity</label>
            <input value={quantity} onChange={e => setQuantity(e.target.value)} type="number"
              disabled={locked} style={{ ...inp, opacity: locked ? 0.6 : 1, fontFamily: 'JetBrains Mono, monospace' }} />
          </div>
          {/* UOM */}
          <div>
            <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4, fontFamily: 'IBM Plex Sans, sans-serif' }}>UOM</label>
            <select value={uom} onChange={e => setUom(e.target.value)}
              disabled={locked} style={{ ...inp, opacity: locked ? 0.6 : 1 }}>
              {['EA','m','m2','m3','kg','t','LS'].map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          {/* ROS */}
          <div>
            <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4, fontFamily: 'IBM Plex Sans, sans-serif' }}>ROS Date</label>
            <input value={rosDate} onChange={e => setRosDate(e.target.value)} type="date"
              style={{ ...inp, fontFamily: 'JetBrains Mono, monospace' }} />
          </div>
          {/* PO Ref */}
          <div>
            <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4, fontFamily: 'IBM Plex Sans, sans-serif' }}>PO Reference</label>
            <input value={poRef} onChange={e => setPoRef(e.target.value)}
              disabled={locked} style={{ ...inp, opacity: locked ? 0.6 : 1, fontFamily: 'JetBrains Mono, monospace' }} />
          </div>
          {/* Status */}
          <div>
            <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4, fontFamily: 'IBM Plex Sans, sans-serif' }}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as MTOLine['status'])}
              disabled={locked} style={{ ...inp, opacity: locked ? 0.6 : 1 }}>
              <option value="not-started">Not started</option>
              <option value="rfq">RFQ</option>
              <option value="po-raised">PO Raised</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, color: sub, padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── UPLOAD REVISION MODAL ────────────────────────────────────────────────────
const UploadRevModal = ({
  dark, projectId, mto, onClose, onUploaded,
}: {
  dark: boolean; projectId: number; mto: MTORegister; onClose: () => void; onUploaded: () => void
}) => {
  const { addToast } = useToast()
  const [file,     setFile]     = useState<File | null>(null)
  const [notes,    setNotes]    = useState('')
  const [uploading, setUploading] = useState(false)

  const [newRev, setNewRev] = useState(suggestRev(mto.current_revision))
  const bg  = dark ? '#0f172a' : '#fff'
  const bd  = `1px solid ${dark ? '#334155' : '#e2e8f0'}`
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = dark ? '#94a3b8' : '#64748b'
  const inp: React.CSSProperties = {
    background: dark ? '#1e293b' : '#f8fafc', border: bd, color: col,
    borderRadius: 6, padding: '7px 10px', fontSize: 13,
    fontFamily: 'IBM Plex Sans, sans-serif', width: '100%', boxSizing: 'border-box',
  }

  async function doUpload() {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('revision', newRev.trim())
      fd.append('notes', notes || `Rev ${newRev.trim()} upload`)
      const { data } = await axios.post(`${API}/mto/${projectId}/${mto.id}/upload`, fd)
      addToast('success', `Rev ${data.revision} uploaded — ${data.linesImported} lines imported`)
      onUploaded()
    } catch (e: any) {
      addToast('error', e.response?.data?.error ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9100,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: bg, border: bd, borderRadius: 12, padding: 28,
        width: '90%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: col, fontFamily: 'IBM Plex Sans, sans-serif' }}>
            Upload new revision
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: sub, fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4, fontFamily: 'IBM Plex Sans, sans-serif' }}>New revision *</label>
          <input value={newRev} onChange={e => setNewRev(e.target.value.slice(0, 10))}
            placeholder="e.g. B, 2, 2A, R1" maxLength={10}
            style={{ ...inp, width: 160, fontFamily: 'JetBrains Mono, monospace', borderColor: revisionFormatError(newRev) ? '#ef4444' : undefined }} />
          <span style={{ fontSize: 11, color: revisionFormatError(newRev) ? '#ef4444' : sub, marginLeft: 10 }}>
            {revisionFormatError(newRev) || `Current: Rev ${mto.current_revision}. Must be later than the current revision.`}
          </span>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4, fontFamily: 'IBM Plex Sans, sans-serif' }}>File *</label>
          <div style={{
            border: `2px dashed ${file ? '#2563eb' : (dark ? '#334155' : '#e2e8f0')}`,
            borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer',
            background: dark ? '#1e293b' : '#f8fafc',
          }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
            onClick={() => { const i = document.createElement('input'); i.type='file'; i.accept='.xlsx,.csv'; i.onchange=()=>{if(i.files?.[0]) setFile(i.files[0])}; i.click() }}>
            {file
              ? <span style={{ color: '#2563eb', fontWeight: 600, fontSize: 13 }}>📎 {file.name}</span>
              : <span style={{ color: sub, fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>Drop XLSX / CSV here or click to browse</span>}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4, fontFamily: 'IBM Plex Sans, sans-serif' }}>Revision Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder={`Rev ${newRev.trim() || '?'} — describe what changed`}
            style={{ ...inp, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: bd, color: sub, padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>Cancel</button>
          <button onClick={doUpload} disabled={!file || uploading || !!revisionFormatError(newRev)} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif', opacity: (!file || uploading || !!revisionFormatError(newRev)) ? 0.5 : 1 }}>
            {uploading ? 'Uploading…' : `↑ Upload Rev ${newRev.trim() || '?'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── TAB A: LINE ITEMS ────────────────────────────────────────────────────────
const LineItemsTab = ({
  dark, projectId, mtoId, currentRevision,
}: {
  dark: boolean; projectId: number; mtoId: number; currentRevision: string
}) => {
  const [filter,     setFilter]     = useState<'all' | 'po-raised' | 'rfq' | 'not-started'>('all')
  const [search,     setSearch]     = useState('')
  const [editTarget, setEditTarget] = useState<MTOLine | null>(null)
  // Per-status totals for the whole revision (drive the tab badges); set by the fetcher.
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0, 'po-raised': 0, rfq: 0, 'not-started': 0 })
  const rt = useResizableTable('mto_lines_v2', MTO_LINE_W, MTO_LINE_MIN)

  const col  = dark ? '#f1f5f9' : '#0f172a'
  const sub  = dark ? '#94a3b8' : '#64748b'
  const bd   = `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`

  // ─── SERVER-SIDE PAGED LOAD ──────────────────────────────────
  // Filter (status/search) + sort run server-side across all 3,338 lines; the
  // grid only ever holds one page. Tab badges come from the server `counts`.
  const fetcher = useCallback(async ({ page, limit, sortCol, sortDir }: { page: number; limit: number; sortCol?: string; sortDir: 'asc' | 'desc' }) => {
    const params: Record<string, string> = {
      revision: currentRevision, page: String(page), limit: String(limit), sort_dir: sortDir,
    }
    if (sortCol)            params.sort_col = sortCol
    if (filter !== 'all')   params.status   = filter
    if (search.trim())      params.search   = search.trim()
    const { data } = await axios.get(`${API}/mto/${projectId}/${mtoId}/lines`, { params })
    setCounts(data.counts ?? { all: 0 })
    return { data: data.data as MTOLine[], total: data.total as number }
  }, [projectId, mtoId, currentRevision, filter, search])

  const {
    data: lines, total, page, setPage, setPageSize, pageSize, loading, error,
    sortCol, sortDir, toggleSort, reload,
  } = usePagedList<MTOLine>({
    fetcher, deps: [currentRevision, filter, search], pageSize: 50, initialSortCol: 'line_number',
  })

  const thStyle: React.CSSProperties = {
    padding: '9px 12px', textAlign: 'left', fontSize: 11,
    fontWeight: 700, color: sub, fontFamily: 'IBM Plex Sans, sans-serif',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    position: 'sticky', top: 0, background: dark ? '#111827' : '#fff', zIndex: 2,
    borderBottom: bd, whiteSpace: 'nowrap',
  }

  return (
    <div>
      {/* Filters row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        {([
          ['all', 'All'],
          ['po-raised', 'PO Raised'],
          ['rfq', 'RFQ'],
          ['not-started', 'Not started'],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} style={{
            background: filter === key ? (dark ? '#1e293b' : '#e2e8f0') : 'transparent',
            border: `1px solid ${filter === key ? '#2563eb' : (dark ? '#334155' : '#e2e8f0')}`,
            color: filter === key ? '#2563eb' : sub,
            padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
            fontWeight: filter === key ? 600 : 400,
            fontFamily: 'IBM Plex Sans, sans-serif',
          }}>
            {label} <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.7 }}>{counts[key]}</span>
          </button>
        ))}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search lines…"
          style={{
            marginLeft: 'auto', padding: '5px 10px', borderRadius: 6, fontSize: 12,
            border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
            background: dark ? '#1e293b' : '#f8fafc', color: col,
            fontFamily: 'IBM Plex Sans, sans-serif', width: 180,
          }}
        />
        <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: sub, fontSize: 13 }}>Loading…</div>
      ) : error ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#ef4444', fontSize: 13 }}>{error}</div>
      ) : (
        <>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 340px)', border: bd, borderRadius: 8, background: dark ? '#111827' : '#fff' }}>
          <table className="app-grid" style={{ ...rt.tableStyle, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {([
                  { label: 'LINE', key: 'line_number' },
                  { label: 'WBS', key: 'wbs_code' },
                  { label: 'DESCRIPTION', key: 'description' },
                  { label: 'QTY', key: 'quantity', align: 'right' },
                  { label: 'UOM' },
                  { label: 'ROS', key: 'ros_date' },
                  { label: 'PO REF' },
                  { label: 'STATUS', key: 'status' },
                  { label: '' },
                  { label: '' },
                ] as { label: string; key?: string; align?: React.CSSProperties['textAlign'] }[]).map((c, i) => (
                  <th key={i}
                    onClick={c.key ? () => toggleSort(c.key!) : undefined}
                    style={{ ...rt.thStyle(i), ...thStyle, textAlign: 'center', cursor: c.key ? 'pointer' : 'default', userSelect: 'none' }}>
                    {c.label}{c.key && sortCol === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    {rt.handle(i, dark)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: 28, textAlign: 'center', color: sub, fontSize: 13 }}>No lines match the filter.</td></tr>
              ) : lines.map((l, i) => {
                const locked = l.status === 'po-raised'
                const tdS: React.CSSProperties = {
                  padding: '9px 12px', borderBottom: bd, fontSize: 12, color: col,
                  background: i % 2 === 0 ? 'transparent' : (dark ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.012)'),
                }
                return (
                  <tr key={l.id}>
                    <td style={{ ...tdS, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{l.line_number}</td>
                    <td data-align="left" style={{ ...tdS, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{l.wbs_code ?? '—'}</td>
                    <td data-align="left" style={{ ...tdS, maxWidth: 260 }}>{l.description}</td>
                    <td style={{ ...tdS, fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>{l.quantity != null ? l.quantity : '—'}</td>
                    <td style={{ ...tdS, fontFamily: 'JetBrains Mono, monospace', color: sub }}>{l.uom ?? '—'}</td>
                    <td data-align="center" style={{ ...tdS, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(l.ros_date)}</td>
                    <td style={{ ...tdS, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{l.po_ref ?? '—'}</td>
                    <td data-align="center" data-col="status" style={tdS}><LinePill s={l.status} /></td>
                    {/* Edit */}
                    <td data-align="center" style={{ ...tdS, textAlign: 'center' }}>
                      <button onClick={() => setEditTarget(l)} style={{
                        background: 'transparent', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
                        color: sub, padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 11,
                        fontFamily: 'IBM Plex Sans, sans-serif',
                      }}>Edit</button>
                    </td>
                    {/* Lock indicator */}
                    <td data-align="center" style={{ ...tdS, textAlign: 'center' }}>
                      {locked && <span title="PO Raised — locked" style={{ fontSize: 13 }}>🔒</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} onPageSizeChange={setPageSize} />
        <MilestoneLegend dark={dark} />
        </>
      )}

      {editTarget && (
        <MTOLineEditModal
          line={editTarget}
          dark={dark}
          projectId={projectId}
          mtoId={mtoId}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            // Re-fetch the current page: an edit may change status and move the
            // row out of the active filter, so a local splice would be wrong.
            reload()
            setEditTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ─── TAB B: VERSION HISTORY ───────────────────────────────────────────────────
const VersionHistoryTab = ({
  dark, projectId, mtoId,
}: {
  dark: boolean; projectId: number; mtoId: number
}) => {
  const { addToast } = useToast()
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [loading,   setLoading]   = useState(true)

  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = dark ? '#94a3b8' : '#64748b'
  const bd  = `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`

  useEffect(() => {
    setLoading(true)
    axios.get<Revision[]>(`${API}/mto/${projectId}/${mtoId}/revisions`)
      .then(r => setRevisions(r.data))
      .catch(() => addToast('error', 'Failed to load revisions'))
      .finally(() => setLoading(false))
  }, [projectId, mtoId])

  const thS: React.CSSProperties = {
    padding: '9px 14px', textAlign: 'center', fontSize: 11,
    fontWeight: 700, color: sub, fontFamily: 'IBM Plex Sans, sans-serif',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: bd, background: dark ? '#111827' : '#fff',
  }

  return loading ? (
    <div style={{ padding: 32, textAlign: 'center', color: sub, fontSize: 13 }}>Loading…</div>
  ) : (
    <div style={{ border: bd, borderRadius: 8, overflow: 'hidden', background: dark ? '#111827' : '#fff' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Revision','Uploaded By','Date','Notes','Lines'].map((h, i) => <th key={i} style={thS}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {revisions.map((r, i) => {
            const tdS: React.CSSProperties = {
              padding: '11px 14px', borderBottom: bd, fontSize: 13, color: col,
              background: i % 2 === 0 ? 'transparent' : (dark ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.012)'),
            }
            return (
              <tr key={r.id}>
                <td style={{ ...tdS, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 15 }}>
                  Rev {r.revision}
                </td>
                <td style={tdS}>{r.uploaded_by_name ?? '—'}</td>
                <td style={{ ...tdS, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{fmtDate(r.created_at)}</td>
                <td style={{ ...tdS, color: sub }}>{r.notes ?? '—'}</td>
                <td style={{ ...tdS, fontFamily: 'JetBrains Mono, monospace' }}>{r.line_count}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── TAB C: REV DIFF ──────────────────────────────────────────────────────────
const RevDiffTab = ({
  dark, projectId, mtoId, revisions,
}: {
  dark: boolean; projectId: number; mtoId: number; revisions: string[]
}) => {
  const { addToast } = useToast()
  const [fromRev, setFromRev] = useState(revisions[0] ?? '')
  const [toRev,   setToRev]   = useState(revisions[revisions.length > 1 ? 1 : 0] ?? '')
  const [diff,    setDiff]    = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)

  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = dark ? '#94a3b8' : '#64748b'
  const bd  = `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`
  const selS: React.CSSProperties = {
    background: dark ? '#1e293b' : '#f8fafc', border: bd, color: col,
    borderRadius: 6, padding: '6px 10px', fontSize: 13,
    fontFamily: 'JetBrains Mono, monospace',
  }

  async function compute() {
    if (!fromRev || !toRev || fromRev === toRev) return
    setLoading(true)
    try {
      const { data } = await axios.get<DiffResult>(
        `${API}/mto/${projectId}/${mtoId}/diff`, { params: { from: fromRev, to: toRev } }
      )
      setDiff(data)
    } catch {
      addToast('error', 'Failed to compute diff')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (fromRev && toRev && fromRev !== toRev) compute() }, [fromRev, toRev])

  const fieldLabel: Record<string, string> = {
    description: 'Description',
    quantity: 'Qty',
    wbs_code: 'WBS',
    ros_date: 'ROS',
    inspection_class: 'Insp',
    uom: 'UOM',
  }

  const thS: React.CSSProperties = {
    padding: '9px 14px', textAlign: 'center', fontSize: 11,
    fontWeight: 700, color: sub, fontFamily: 'IBM Plex Sans, sans-serif',
    textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: bd,
    background: dark ? '#111827' : '#fff',
  }

  return (
    <div>
      {/* Revision selectors */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif' }}>From</label>
        <select value={fromRev} onChange={e => setFromRev(e.target.value)} style={selS}>
          {revisions.map(r => <option key={r} value={r}>Rev {r}</option>)}
        </select>
        <span style={{ color: sub, fontSize: 14 }}>→</span>
        <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif' }}>To</label>
        <select value={toRev} onChange={e => setToRev(e.target.value)} style={selS}>
          {revisions.map(r => <option key={r} value={r}>Rev {r}</option>)}
        </select>
        {fromRev === toRev && (
          <span style={{ fontSize: 12, color: '#f59e0b', fontFamily: 'IBM Plex Sans, sans-serif' }}>
            Select two different revisions to compare.
          </span>
        )}
      </div>

      {/* Summary badges */}
      {diff && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'Added',     n: diff.added.length,    color: '#15803d', bg: 'rgba(34,197,94,0.1)',    border: 'rgba(34,197,94,0.25)' },
            { label: 'Modified',  n: diff.modified.length, color: '#92400e', bg: 'rgba(245,158,11,0.1)',   border: 'rgba(245,158,11,0.25)' },
            { label: 'Deleted',   n: diff.deleted.length,  color: '#b91c1c', bg: 'rgba(239,68,68,0.1)',    border: 'rgba(239,68,68,0.25)' },
            { label: 'Unchanged', n: diff.unchanged,       color: sub,       bg: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: dark ? '#334155' : '#e2e8f0' },
          ].map(({ label, n, color, bg: bg2, border }) => (
            <div key={label} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 14px', borderRadius: 8, border: `1px solid ${border}`,
              background: bg2, fontSize: 12, fontFamily: 'IBM Plex Sans, sans-serif',
            }}>
              <span style={{ color, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', fontSize: 14 }}>{n}</span>
              <span style={{ color }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ padding: 24, textAlign: 'center', color: sub, fontSize: 13 }}>Computing diff…</div>}

      {diff && !loading && (diff.added.length + diff.modified.length + diff.deleted.length === 0) && (
        <div style={{
          padding: 28, textAlign: 'center', color: sub, fontSize: 13,
          border: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`, borderRadius: 8,
          background: dark ? '#111827' : '#fff', fontFamily: 'IBM Plex Sans, sans-serif',
        }}>
          No changes between Rev {fromRev} and Rev {toRev}. All {diff.unchanged} lines are identical.
        </div>
      )}

      {diff && !loading && (diff.added.length + diff.modified.length + diff.deleted.length > 0) && (
        <div style={{ border: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`, borderRadius: 8, overflow: 'hidden', background: dark ? '#111827' : '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Line','WBS','Description','Change'].map((h,i) => <th key={i} style={thS}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {/* Added */}
              {diff.added.map(l => (
                <tr key={`add-${l.id}`} style={{ background: 'rgba(34,197,94,0.05)' }}>
                  <td style={{ padding: '9px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: col, borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}` }}>{l.line_number}</td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: sub, borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}` }}>{l.wbs_code ?? '—'}</td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: col, borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}` }}>{l.description}</td>
                  <td style={{ padding: '9px 14px', borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}` }}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: 'rgba(34,197,94,0.15)', color: '#15803d', border: '1px solid rgba(34,197,94,0.3)' }}>New line</span>
                  </td>
                </tr>
              ))}
              {/* Deleted */}
              {diff.deleted.map(l => (
                <tr key={`del-${l.id}`} style={{ background: 'rgba(239,68,68,0.04)' }}>
                  <td style={{ padding: '9px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: col, borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`, textDecoration: 'line-through', opacity: 0.7 }}>{l.line_number}</td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: sub, borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}` }}>{l.wbs_code ?? '—'}</td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: col, borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`, textDecoration: 'line-through', opacity: 0.7 }}>{l.description}</td>
                  <td style={{ padding: '9px 14px', borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}` }}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: 'rgba(239,68,68,0.12)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.25)' }}>Removed</span>
                  </td>
                </tr>
              ))}
              {/* Modified */}
              {diff.modified.map(l => (
                <tr key={`mod-${l.id}`} style={{ background: 'rgba(245,158,11,0.04)' }}>
                  <td style={{ padding: '9px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: col, borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}` }}>{l.line_number}</td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: sub, borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}` }}>{l.wbs_code ?? '—'}</td>
                  <td style={{ padding: '9px 14px', fontSize: 12, color: col, borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}` }}>{l.description}</td>
                  <td style={{ padding: '9px 14px', borderBottom: `1px solid ${dark ? '#1e293b' : '#e2e8f0'}` }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {Object.entries(l.changes).map(([field, { from: fv, to: tv }]) => (
                        <span key={field} style={{ fontSize: 11, fontFamily: 'IBM Plex Sans, sans-serif' }}>
                          <span style={{ color: sub }}>{fieldLabel[field] ?? field}: </span>
                          <span style={{ color: '#b91c1c', textDecoration: 'line-through', fontFamily: 'JetBrains Mono, monospace' }}>
                            {displayVal(field, fv)}
                          </span>
                          {' → '}
                          <span style={{ color: '#15803d', fontFamily: 'JetBrains Mono, monospace' }}>
                            {displayVal(field, tv)}
                          </span>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── INNER COMPONENT ─────────────────────────────────────────────────────────
const MTODetailInner = ({
  dark, projectId, projectName, mtoId, onBack, onLeaf,
}: {
  dark: boolean; projectId: number; projectName: string; mtoId: number; onBack: () => void
  onLeaf?: (ref: string | null) => void
}) => {
  const { addToast } = useToast()
  const [mto,        setMto]        = useState<MTORegister | null>(null)
  // Report the MTO ref up to the topbar breadcrumb (leaf segment); clear on unmount.
  useEffect(() => { onLeaf?.(mto?.reference ?? null); return () => onLeaf?.(null) }, [mto?.reference, onLeaf])
  const [revisions,  setRevisions]  = useState<string[]>([])
  const [activeTab,  setActiveTab]  = useState<'lines' | 'history' | 'diff' | 'variations'>('lines')
  const [showUpload, setShowUpload] = useState(false)
  const [loading,    setLoading]    = useState(true)

  const col  = dark ? '#f1f5f9' : '#0f172a'
  const sub  = dark ? '#94a3b8' : '#64748b'
  const bg   = dark ? '#0f172a' : '#f8fafc'
  const card = dark ? '#111827' : '#fff'
  const bd   = `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: detail }, { data: revData }] = await Promise.all([
        axios.get<MTORegister & { lines: MTOLine[] }>(`${API}/mto/${projectId}/${mtoId}`),
        axios.get<{ revision: string }[]>(`${API}/mto/${projectId}/${mtoId}/revisions`),
      ])
      setMto(detail)
      setRevisions(revData.map(r => r.revision))
    } catch {
      addToast('error', 'Failed to load MTO detail')
    } finally {
      setLoading(false)
    }
  }, [projectId, mtoId])

  useEffect(() => { load() }, [load])

  const nextRevChar = mto ? suggestRev(mto.current_revision) : '?'

  const tabs = [
    { key: 'lines',      label: 'Line Items' },
    { key: 'history',    label: 'Version History' },
    { key: 'diff',       label: 'Rev Diff' },
    { key: 'variations', label: 'Variation Flags' },
  ] as const

  if (loading || !mto) {
    return (
      <div style={{ background: bg, minHeight: '100%', padding: '24px 28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: sub, fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>Loading…</span>
      </div>
    )
  }

  return (
    <div style={{ background: bg, minHeight: '100%', padding: '24px 28px', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* ─── BACK ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <BackButton onFallback={onBack} dark={dark} />
      </div>

      {/* ─── HEADER ──────────────────────────────────────── */}
      <div style={{ background: card, border: bd, borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>{mto.name}</h2>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: sub, fontFamily: 'JetBrains Mono, monospace' }}>
              {mto.reference} · Rev {mto.current_revision} · {mto.line_count} lines · Updated {fmtDate(mto.updated_at)}
              {mto.owner ? ` · ${mto.owner}` : ''}
            </p>
            {mto.description && (
              <p style={{ margin: '8px 0 0', fontSize: 13, color: sub, maxWidth: 600 }}>{mto.description}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <HelpButton screenName="MTO Detail" sections={MTO_DETAIL_HELP} dark={dark} />
            <button
              onClick={() => {
                axios.get(`${API}/mto/${projectId}/${mtoId}/lines`, { params: { revision: mto.current_revision }, responseType: 'blob' })
                  .then(r => {
                    const url = window.URL.createObjectURL(new Blob([r.data]))
                    const a = document.createElement('a'); a.href = url
                    a.download = `${mto.reference}_Rev${mto.current_revision}.json`
                    a.click(); window.URL.revokeObjectURL(url)
                  }).catch(() => addToast('error', 'Export failed'))
              }}
              style={{ background: 'transparent', border: bd, color: sub, padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'IBM Plex Sans, sans-serif' }}>
              ↓ Export
            </button>
            <button
              onClick={() => setShowUpload(true)}
              style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif' }}>
              ↑ Upload Rev {nextRevChar}
            </button>
          </div>
        </div>
      </div>

      {/* ─── TABS ────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: bd, paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            background: 'transparent', border: 'none',
            borderBottom: `2px solid ${activeTab === t.key ? '#2563eb' : 'transparent'}`,
            color: activeTab === t.key ? '#2563eb' : sub,
            padding: '10px 16px', cursor: 'pointer', fontSize: 13,
            fontWeight: activeTab === t.key ? 600 : 400,
            fontFamily: 'IBM Plex Sans, sans-serif',
            marginBottom: -1,
            transition: 'color 0.15s, border-color 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ─── TAB CONTENT ─────────────────────────────────── */}
      {activeTab === 'lines' && (
        <LineItemsTab dark={dark} projectId={projectId} mtoId={mto.id} currentRevision={mto.current_revision} />
      )}
      {activeTab === 'history' && (
        <VersionHistoryTab dark={dark} projectId={projectId} mtoId={mto.id} />
      )}
      {activeTab === 'diff' && (
        <RevDiffTab dark={dark} projectId={projectId} mtoId={mto.id} revisions={revisions} />
      )}
      {activeTab === 'variations' && (
        <div style={{
          border: bd, borderRadius: 8, padding: 32, textAlign: 'center',
          background: card, color: sub, fontSize: 13,
        }}>
          <div style={{ fontSize: 20, marginBottom: 10 }}>📋</div>
          <div>No variation flags raised against this MTO.</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>Variation flags will appear here once raised from the Procurement module.</div>
        </div>
      )}

      {/* ─── MODALS ──────────────────────────────────────── */}
      {showUpload && (
        <UploadRevModal
          dark={dark}
          projectId={projectId}
          mto={mto}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); load() }}
        />
      )}

      <ToastContainer />
    </div>
  )
}

// ─── EXPORTED COMPONENT (wraps with ToastProvider) ───────────────────────────
export const MTODetailScreen = (props: {
  dark: boolean
  projectId: number
  projectName: string
  mtoId: number
  onBack: () => void
  onLeaf?: (ref: string | null) => void
}) => (
  <ToastProvider>
    <MTODetailInner {...props} />
  </ToastProvider>
)
