// ─── MY VDRL — VENDOR SCREEN (ext-2c) ─────────────────────────────────────────
// The vendor documents QCO requires on the vendor's own POs in the selected project.
// Vendors attach files to existing rows only (no create, edit, template or bulk upload).
// Calls only the routes the external gate allows a vendor (server/lib/externalGate.js, P2f):
//   GET expediting/:pid/vdrl/stats · packages · documents (package_id, status, search) · po-list
//   POST expediting/:pid/vdrl/documents/:docId/file (multipart field "file")
//   GET documents/:pid/download/vdrl:ID (through lib/fileAccess)
// Every field is a key of the vendor projections in server/lib/vendorView.js (VDRL_STATS,
// VDRL_PACKAGE, VDRL_DOCUMENT, VDRL_PO_ROW); the server scopes each call to the vendor's
// supplier and accepts a file only while a row is Not submitted, Overdue or Resubmit (else 409).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { BackButton } from '../components/BackButton'
import { HelpButton } from '../components/HelpDrawer'
import { Pager } from '../components/Pager'
import { StatusLegend } from '../components/StatusLegend'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'
import { VENDOR_VDRL_HELP } from '../helpContent'
import { API } from '../lib/api'
import { viewFile, downloadFile } from '../lib/fileAccess'

// ─── TYPES (vendorView.js key lists) ──────────────────────────────────────────

type Num = number | string | null   // SUM/DECIMAL results can arrive as strings
interface VdrlStats { total_docs: Num; submitted_count: Num; submitted_pct: Num; overdue_count: Num; abf_cleared_count: Num; progress_pct: Num }
interface VdrlPackage { id: number; package_ref: string | null; name: string | null; status: string | null; po_id: number | null; po_number: string | null; vendor_name: string | null; doc_count: Num; submitted_count: Num; overdue_count: Num; created_at: string | null }
interface VdrlPoRow { id: number; po_number: string; po_name: string | null; vendor_name: string | null; package_count: Num; total_docs: Num; submitted_count: Num; overdue_count: Num; progress_pct: Num }
interface VdrlDocument {
  id: number; package_id: number; package_name: string | null; po_number: string | null; doc_number: string | null
  title: string | null; doc_type: string | null; revision: string | null; status: string
  required_date: string | null; promised_date: string | null; submitted_date: string | null; days_overdue: number | null
  file_name: string | null; abf_required: number | null; abf_cleared: number | null; tag_number: string | null; po_line_ref: string | null
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const UPLOAD_STATUSES = ['Not submitted', 'Overdue', 'Resubmit']   // the server's VENDOR_UPLOAD_STATUSES
const STATUSES = ['Not submitted', 'Overdue', 'Resubmit', 'Under review', 'Approved']
const ACCEPT = '.pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg,.gif,.tif,.tiff,.txt'   // utils/upload.js 'document'
const MAX_BYTES = 25 * 1024 * 1024                                                        // the route's multer limit
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  'Approved':      { bg: 'rgba(34,197,94,0.12)',  color: '#16a34a' },
  'Under review':  { bg: 'rgba(37,99,235,0.12)',  color: '#1d4ed8' },
  'Overdue':       { bg: 'rgba(239,68,68,0.12)',  color: '#dc2626' },
  'Not submitted': { bg: 'rgba(148,163,184,0.12)', color: '#64748b' },
  'Resubmit':      { bg: 'rgba(245,158,11,0.12)', color: '#d97706' },
}
const NO_UPLOAD_NOTE: Record<string, string> = {
  'Under review': 'With QCO for review — no upload',
  'Approved': 'Approved — no upload needed',
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}
const n0 = (v: Num) => (v == null || v === '' ? 0 : Number(v))
const yesNo = (v: number | null) => (v == null ? '—' : Number(v) ? 'Yes' : 'No')
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? fallback
const tokens = (dark: boolean) => ({
  col: dark ? '#f1f5f9' : '#0f172a', sub: '#94a3b8',
  card: dark ? '#1e293b' : '#fff', bd: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
  head: dark ? '#162032' : '#f8fafc', row: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
  input: dark ? '#0f172a' : '#fff',
})
const Notice = ({ text, error }: { text: string; error?: boolean }) => (
  <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: error ? '#dc2626' : '#94a3b8' }}>{text}</div>
)
const StatusPill = ({ status }: { status: string }) => {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE['Not submitted']
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>{status}</span>
}

const COLS = [
  { label: 'PO', width: 120, min: 90 }, { label: 'Package', width: 160, min: 100 }, { label: 'Doc number', width: 140, min: 100 },
  { label: 'Title', width: 240, min: 140 }, { label: 'Type', width: 110, min: 80 }, { label: 'Rev', width: 60, min: 50 },
  { label: 'Status', width: 120, min: 100 }, { label: 'Required', width: 105, min: 90 }, { label: 'Promised', width: 105, min: 90 },
  { label: 'Submitted', width: 105, min: 90 }, { label: 'Days overdue', width: 95, min: 80 }, { label: 'ABF req / cleared', width: 120, min: 100 },
  { label: 'Tag', width: 110, min: 80 }, { label: 'PO line', width: 80, min: 60 }, { label: 'File', width: 180, min: 110 },
  { label: '', width: 230, min: 200 },
]

// ─── SCREEN ───────────────────────────────────────────────────────────────────

export interface VendorVdrlScreenProps {
  dark: boolean
  projectId: number
  projectName: string
  onBack: () => void
}

const VendorVdrlInner = ({ dark, projectId, projectName, onBack }: VendorVdrlScreenProps) => {
  const t = tokens(dark)
  const { addToast } = useToast()
  const [stats, setStats] = useState<VdrlStats | null>(null)
  const [packages, setPackages] = useState<VdrlPackage[]>([])
  const [poList, setPoList] = useState<VdrlPoRow[]>([])
  const [docs, setDocs] = useState<VdrlDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [poFilter, setPoFilter] = useState('')          // po_number (client-side: the route has no PO filter)
  const [packageId, setPackageId] = useState('')        // package_id (server)
  const [status, setStatus] = useState('')              // status (server)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')              // search (server)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [uploadingId, setUploadingId] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const targetRef = useRef<VdrlDocument | null>(null)
  const rt = useResizableTable('vendor_vdrl', COLS.map(c => c.width), COLS.map(c => c.min))

  const loadStats = useCallback(() => {
    axios.get(`${API}/expediting/${projectId}/vdrl/stats`).then(r => setStats(r.data)).catch(() => setStats(null))
  }, [projectId])
  useEffect(() => {
    loadStats()
    axios.get(`${API}/expediting/${projectId}/vdrl/packages`).then(r => setPackages(Array.isArray(r.data) ? r.data : [])).catch(() => setPackages([]))
    axios.get(`${API}/expediting/${projectId}/vdrl/po-list`).then(r => setPoList(Array.isArray(r.data) ? r.data : [])).catch(() => setPoList([]))
  }, [projectId, loadStats])

  useEffect(() => { const id = setTimeout(() => setSearch(input.trim()), 350); return () => clearTimeout(id) }, [input])
  useEffect(() => { setPage(1) }, [poFilter, packageId, status, search])

  const loadDocs = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params: Record<string, string> = {}
      if (packageId) params.package_id = packageId
      if (status) params.status = status
      if (search) params.search = search
      const { data } = await axios.get(`${API}/expediting/${projectId}/vdrl/documents`, { params })
      setDocs(Array.isArray(data) ? data : [])
    } catch (e) {
      setDocs([]); setError(errText(e, 'Failed to load your VDRL documents'))
    } finally { setLoading(false) }
  }, [projectId, packageId, status, search])
  useEffect(() => { loadDocs() }, [loadDocs])

  const shown = useMemo(() => (poFilter ? docs.filter(d => d.po_number === poFilter) : docs), [docs, poFilter])
  const pageRows = useMemo(() => shown.slice((page - 1) * pageSize, page * pageSize), [shown, page, pageSize])
  const pkgOptions = useMemo(() => (poFilter ? packages.filter(p => p.po_number === poFilter) : packages), [packages, poFilter])

  // ── Upload: one hidden file input; the row is remembered in a ref while the picker is open.
  const pickFile = (d: VdrlDocument) => { targetRef.current = d; fileRef.current?.click() }
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ''
    const d = targetRef.current; targetRef.current = null
    if (!f || !d) return
    if (f.size > MAX_BYTES) { addToast('error', 'The file is larger than 25 MB'); return }
    setUploadingId(d.id)
    try {
      const fd = new FormData(); fd.append('file', f)
      const { data } = await axios.post<VdrlDocument>(`${API}/expediting/${projectId}/vdrl/documents/${d.id}/file`, fd)
      setDocs(ds => ds.map(x => (x.id === data.id ? data : x)))
      addToast('success', `${d.doc_number ?? 'Document'}: file uploaded — now ${data.status}`)
      loadStats()
    } catch (err) {
      addToast('error', errText(err, 'Upload failed'))
      if ((err as { response?: { status?: number } }).response?.status === 409) { loadDocs(); loadStats() }
    } finally { setUploadingId(null) }
  }

  const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: t.sub, textTransform: 'uppercase', whiteSpace: 'nowrap', background: t.head }
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12, color: t.col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
  const sel: React.CSSProperties = { height: 32, padding: '0 8px', borderRadius: 6, border: t.bd, background: t.input, color: t.col, fontSize: 12, fontFamily: 'inherit' }
  const btn: React.CSSProperties = { padding: '4px 10px', borderRadius: 5, border: t.bd, background: 'none', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
  const statCards: [string, string, string][] = stats ? [
    ['Total documents', String(n0(stats.total_docs)), t.col],
    ['Submitted', `${n0(stats.submitted_count)} (${n0(stats.submitted_pct)}%)`, '#1d4ed8'],
    ['Overdue', String(n0(stats.overdue_count)), '#dc2626'],
    ['ABF cleared', String(n0(stats.abf_cleared_count)), '#16a34a'],
    ['Progress', `${n0(stats.progress_pct)}%`, '#E84E0F'],
  ] : []

  return (
    <div style={{ padding: 24, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <BackButton onFallback={onBack} dark={dark} />
        <HelpButton screenName="My VDRL" sections={VENDOR_VDRL_HELP} dark={dark} />
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: t.col }}>My VDRL</h1>
      <div style={{ fontSize: 12, color: t.sub, marginBottom: 18 }}>Vendor documents required on your company's POs · {projectName}</div>

      {statCards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
          {statCards.map(([label, value, color]) => (
            <div key={label} style={{ background: t.card, border: t.bd, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: t.sub, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={poFilter} onChange={e => { setPoFilter(e.target.value); setPackageId('') }} style={sel} title="PO">
          <option value="">All POs</option>
          {poList.map(p => <option key={p.id} value={p.po_number}>{p.po_number}{p.po_name ? ` — ${p.po_name}` : ''}</option>)}
        </select>
        <select value={packageId} onChange={e => setPackageId(e.target.value)} style={sel} title="Package">
          <option value="">All packages</option>
          {pkgOptions.map(p => <option key={p.id} value={String(p.id)}>{p.package_ref ? `${p.package_ref} · ` : ''}{p.name ?? `Package ${p.id}`}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={sel} title="Status">
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Search document number or title…"
          style={{ ...sel, padding: '0 10px', width: 260 }} />
        <div style={{ flex: 1 }} />
        <StatusLegend dark={dark} items={STATUSES.map(s => ({ label: s, color: STATUS_STYLE[s].color }))} />
        <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
      </div>

      <input ref={fileRef} type="file" accept={ACCEPT} onChange={onFile} style={{ display: 'none' }} />
      <div style={{ background: t.card, border: t.bd, borderRadius: 10, overflow: 'auto' }}>
        <table style={{ ...rt.tableStyle, borderCollapse: 'collapse' }}>
          <thead>
            <tr>{COLS.map((c, i) => <th key={c.label || 'actions'} style={{ ...th, ...rt.thStyle(i) }}>{c.label}{rt.handle(i, dark)}</th>)}</tr>
          </thead>
          <tbody>
            {pageRows.map(d => {
              const canUpload = UPLOAD_STATUSES.includes(d.status)
              const url = `${API}/documents/${projectId}/download/vdrl:${d.id}`
              return (
                <tr key={d.id} style={{ borderBottom: t.row }}>
                  <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{d.po_number ?? '—'}</td>
                  <td style={td} title={d.package_name ?? ''}>{d.package_name ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{d.doc_number ?? '—'}</td>
                  <td style={td} title={d.title ?? ''}>{d.title ?? '—'}</td>
                  <td style={td}>{d.doc_type ?? '—'}</td>
                  <td style={td}>{d.revision ?? '—'}</td>
                  <td style={td}><StatusPill status={d.status} /></td>
                  <td style={td}>{fmtDate(d.required_date)}</td>
                  <td style={td}>{fmtDate(d.promised_date)}</td>
                  <td style={td}>{fmtDate(d.submitted_date)}</td>
                  <td style={{ ...td, textAlign: 'right', color: canUpload && n0(d.days_overdue) > 0 ? '#dc2626' : t.col }}>{canUpload && n0(d.days_overdue) > 0 ? n0(d.days_overdue) : '—'}</td>
                  <td style={td}>{yesNo(d.abf_required)} / {yesNo(d.abf_cleared)}</td>
                  <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{d.tag_number ?? '—'}</td>
                  <td style={td}>{d.po_line_ref ?? '—'}</td>
                  <td style={td} title={d.file_name ?? ''}>{d.file_name ?? '—'}</td>
                  <td style={{ ...td, overflow: 'visible' }}>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      {d.file_name && <>
                        <button style={{ ...btn, color: '#2563eb' }} onClick={() => viewFile(url, d.file_name ?? undefined).catch(() => addToast('error', 'Could not open the file'))}>👁 View</button>
                        <button style={{ ...btn, color: '#16a34a' }} onClick={() => downloadFile(url, d.file_name ?? undefined).catch(() => addToast('error', 'Download failed'))}>↓ Download</button>
                      </>}
                      {canUpload
                        ? <button style={{ ...btn, border: 'none', background: uploadingId === d.id ? '#93c5fd' : '#2563eb', color: '#fff', fontWeight: 600 }}
                            disabled={uploadingId != null} onClick={() => pickFile(d)}>{uploadingId === d.id ? 'Uploading…' : '↑ Upload file'}</button>
                        : <span style={{ fontSize: 11, color: t.sub }}>{NO_UPLOAD_NOTE[d.status] ?? 'No upload'}</span>}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {loading && <Notice text="Loading your VDRL documents…" />}
        {!loading && error && <Notice text={error} error />}
        {!loading && !error && shown.length === 0 && <Notice text={search || status || packageId || poFilter ? 'No documents match these filters.' : 'No VDRL documents for your company in this project.'} />}
      </div>
      {shown.length > 0 && (
        <Pager page={page} total={shown.length} pageSize={pageSize} dark={dark}
          onPageChange={setPage} onPageSizeChange={n => { setPageSize(n); setPage(1) }} />
      )}
      <ToastContainer />
    </div>
  )
}

export const VendorVdrlScreen = (props: VendorVdrlScreenProps) => (
  <ToastProvider>
    <VendorVdrlInner {...props} />
  </ToastProvider>
)
