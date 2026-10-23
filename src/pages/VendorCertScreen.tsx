// ─── MY CERTIFICATES — VENDOR SCREEN (ext-2c) ─────────────────────────────────
// The certificates QCO requires on the vendor's own POs in the selected project. Calls only
// the routes the external gate allows a vendor (server/lib/externalGate.js, P2f):
//   GET traceability/:pid/summary · vdrl (status, q) · cert/:id (through CertDetailModal)
//   POST traceability/:pid/cert (multipart, through UploadCertModal)
//   POST traceability/cert/:id/version (multipart, through CertDetailModal)
//   GET traceability/cert/:id/file (through lib/fileAccess)
//   GET procurement/:pid/pos (the vendor's own POs, for the ad-hoc upload's PO select)
// Every field is a key of the vendor projections in server/lib/vendorView.js (CERT_ROW,
// CERT_VERSION, CERT_SUMMARY); the server scopes each call to the vendor's supplier and accepts
// an upload or a new version only while a requirement is pending, overdue or rejected.
import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { BackButton } from '../components/BackButton'
import { HelpButton } from '../components/HelpDrawer'
import { Pager } from '../components/Pager'
import { StatusLegend } from '../components/StatusLegend'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'
import { UploadCertModal, type VdrlRow } from '../components/traceability/UploadCertModal'
import { CertDetailModal } from '../components/traceability/CertDetailModal'
import { VENDOR_CERT_HELP } from '../helpContent'
import { API } from '../lib/api'
import { viewFile } from '../lib/fileAccess'

// ─── TYPES (vendorView.js key lists) ──────────────────────────────────────────

type Num = number | string | null
interface CertSummary { vdrl_received: Num; vdrl_pending: Num; vdrl_overdue: Num; active_holds: Num }
interface CertRow {
  cert_id: number; po_ref: string | null; document_name: string; cert_type: string | null; heat_ref: string | null
  applies_to: string | null; tag: string | null; is_required: number | null; file_name: string | null; status: string
  issue_date: string | null; due_date: string | null; received_date: string | null; uploaded_date: string | null
  verified_date: string | null; verified_by: string | null; reject_reason: string | null
}
interface OwnPO { id: number; po_number: string }

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const OPEN_STATUSES = ['pending', 'overdue', 'rejected']   // the server's VENDOR_VERSION_STATUSES
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  verified: { bg: 'rgba(34,197,94,0.12)',  color: '#16a34a' },
  received: { bg: 'rgba(34,197,94,0.12)',  color: '#15803d' },
  pending:  { bg: 'rgba(245,158,11,0.12)', color: '#d97706' },
  overdue:  { bg: 'rgba(239,68,68,0.12)',  color: '#dc2626' },
  rejected: { bg: 'rgba(239,68,68,0.12)',  color: '#b91c1c' },
}
const NO_UPLOAD_NOTE: Record<string, string> = {
  received: 'Received — with QCO for checking',
  verified: 'Verified — no upload needed',
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}
const n0 = (v: Num) => (v == null || v === '' ? 0 : Number(v))
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? fallback
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
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
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.pending
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>{cap(status)}</span>
}

const COLS = [
  { label: 'PO ref', width: 120, min: 90 }, { label: 'Document', width: 220, min: 140 }, { label: 'Cert type', width: 110, min: 80 },
  { label: 'Heat ref', width: 110, min: 80 }, { label: 'Applies to', width: 130, min: 90 }, { label: 'Tag', width: 100, min: 70 },
  { label: 'Required', width: 80, min: 70 }, { label: 'File', width: 160, min: 100 }, { label: 'Status', width: 100, min: 90 },
  { label: 'Issued', width: 105, min: 90 }, { label: 'Due', width: 105, min: 90 }, { label: 'Received', width: 105, min: 90 },
  { label: 'Uploaded', width: 105, min: 90 }, { label: 'Verified', width: 105, min: 90 }, { label: 'Verified by', width: 130, min: 90 },
  { label: 'Reject reason', width: 180, min: 100 }, { label: '', width: 250, min: 200 },
]

// ─── SCREEN ───────────────────────────────────────────────────────────────────

export interface VendorCertScreenProps {
  dark: boolean
  projectId: number
  projectName: string
  onBack: () => void
}

const VendorCertInner = ({ dark, projectId, projectName, onBack }: VendorCertScreenProps) => {
  const t = tokens(dark)
  const { addToast } = useToast()
  const [summary, setSummary] = useState<CertSummary | null>(null)
  const [rows, setRows] = useState<CertRow[]>([])
  // The summary has no rejected count: counted from the list, whenever it is loaded unfiltered.
  const [rejected, setRejected] = useState<number | null>(null)
  const [ownPOs, setOwnPOs] = useState<OwnPO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('all')   // all | pending | overdue | received (the route's values)
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [upload, setUpload] = useState<null | { mode: 'row' | 'global'; row?: CertRow }>(null)
  const rt = useResizableTable('vendor_certs', COLS.map(c => c.width), COLS.map(c => c.min))

  const loadSummary = useCallback(() => {
    axios.get(`${API}/traceability/${projectId}/summary`).then(r => setSummary(r.data)).catch(() => setSummary(null))
  }, [projectId])
  const loadRows = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params: Record<string, string> = { status }
      if (q) params.q = q
      const { data } = await axios.get(`${API}/traceability/${projectId}/vdrl`, { params })
      const list: CertRow[] = Array.isArray(data?.data) ? data.data : []
      setRows(list)
      if (status === 'all' && !q) setRejected(list.filter(r => r.status === 'rejected').length)
    } catch (e) {
      setRows([]); setError(errText(e, 'Failed to load your certificates'))
      if (status === 'all' && !q) setRejected(null)
    } finally { setLoading(false) }
  }, [projectId, status, q])

  useEffect(() => {
    loadSummary()
    axios.get(`${API}/procurement/${projectId}/pos`, { params: { page: '1', limit: '1000' } })
      .then(r => setOwnPOs(Array.isArray(r.data?.data) ? r.data.data.map((p: OwnPO) => ({ id: p.id, po_number: p.po_number })) : []))
      .catch(() => setOwnPOs([]))
  }, [projectId, loadSummary])
  useEffect(() => { const id = setTimeout(() => setQ(input.trim()), 350); return () => clearTimeout(id) }, [input])
  useEffect(() => { setPage(1) }, [status, q])
  useEffect(() => { loadRows() }, [loadRows])

  const pageRows = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize])
  // For UploadCertModal: its row shape (no vendor name for vendors) and the vendor's own POs (number → id).
  const modalRows: VdrlRow[] = useMemo(() => rows.map(r => ({ cert_id: r.cert_id, po_ref: r.po_ref, vendor_name: null, tag: r.tag, document_name: r.document_name, status: r.status })), [rows])
  const poIds = useMemo(() => Object.fromEntries(ownPOs.map(p => [p.po_number, p.id])) as Record<string, number>, [ownPOs])
  const refresh = () => { loadSummary(); loadRows() }

  const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: t.sub, textTransform: 'uppercase', whiteSpace: 'nowrap', background: t.head }
  const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12, color: t.col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
  const sel: React.CSSProperties = { height: 32, padding: '0 8px', borderRadius: 6, border: t.bd, background: t.input, color: t.col, fontSize: 12, fontFamily: 'inherit' }
  const btn: React.CSSProperties = { padding: '4px 10px', borderRadius: 5, border: t.bd, background: 'none', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
  const cards: [string, number | string, string][] = summary ? [
    ['Received', n0(summary.vdrl_received), '#16a34a'],
    ['Pending', n0(summary.vdrl_pending), '#d97706'],
    ['Overdue', n0(summary.vdrl_overdue), '#dc2626'],
    ['Rejected', rejected ?? '—', '#b91c1c'],
  ] : []

  return (
    <div style={{ padding: 24, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <BackButton onFallback={onBack} dark={dark} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setUpload({ mode: 'global' })} disabled={ownPOs.length === 0}
            title={ownPOs.length === 0 ? 'No POs for your company in this project' : undefined}
            style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: ownPOs.length ? '#E84E0F' : '#94a3b8', color: '#fff', cursor: ownPOs.length ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>
            ↑ Upload certificate (not on the list)
          </button>
          <HelpButton screenName="My certificates" sections={VENDOR_CERT_HELP} dark={dark} />
        </div>
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: t.col }}>My certificates</h1>
      <div style={{ fontSize: 12, color: t.sub, marginBottom: 18 }}>Certificates required on your company's POs · {projectName}</div>

      {cards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
          {cards.map(([label, value, color]) => (
            <div key={label} style={{ background: t.card, border: t.bd, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: t.sub, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={status} onChange={e => setStatus(e.target.value)} style={sel} title="Status">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="received">Received or verified</option>
        </select>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Search PO, tag or document…"
          style={{ ...sel, padding: '0 10px', width: 260 }} />
        <div style={{ flex: 1 }} />
        <StatusLegend dark={dark} items={Object.keys(STATUS_STYLE).map(s => ({ label: cap(s), color: STATUS_STYLE[s].color }))} />
        <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
      </div>

      <div style={{ background: t.card, border: t.bd, borderRadius: 10, overflow: 'auto' }}>
        <table style={{ ...rt.tableStyle, borderCollapse: 'collapse' }}>
          <thead>
            <tr>{COLS.map((c, i) => <th key={c.label || 'actions'} style={{ ...th, ...rt.thStyle(i) }}>{c.label}{rt.handle(i, dark)}</th>)}</tr>
          </thead>
          <tbody>
            {pageRows.map(r => {
              const open = OPEN_STATUSES.includes(r.status)
              return (
                <tr key={r.cert_id} style={{ borderBottom: t.row }}>
                  <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{r.po_ref ?? '—'}</td>
                  <td style={td} title={r.document_name}>{r.document_name}</td>
                  <td style={td}>{r.cert_type ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{r.heat_ref ?? '—'}</td>
                  <td style={td} title={r.applies_to ?? ''}>{r.applies_to ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{r.tag ?? '—'}</td>
                  <td style={td}>{r.is_required == null ? '—' : Number(r.is_required) ? 'Yes' : 'No'}</td>
                  <td style={td} title={r.file_name ?? ''}>{r.file_name ?? '—'}</td>
                  <td style={td}><StatusPill status={r.status} /></td>
                  <td style={td}>{fmtDate(r.issue_date)}</td>
                  <td style={td}>{fmtDate(r.due_date)}</td>
                  <td style={td}>{fmtDate(r.received_date)}</td>
                  <td style={td}>{fmtDate(r.uploaded_date)}</td>
                  <td style={td}>{fmtDate(r.verified_date)}</td>
                  <td style={td}>{r.verified_by ?? '—'}</td>
                  <td style={td} title={r.reject_reason ?? ''}>{r.reject_reason ?? '—'}</td>
                  <td style={{ ...td, overflow: 'visible' }}>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <button style={{ ...btn, color: '#2563eb' }} onClick={() => setDetailId(r.cert_id)}>View</button>
                      {r.file_name && (
                        <button style={{ ...btn, color: '#16a34a' }}
                          onClick={() => viewFile(`${API}/traceability/cert/${r.cert_id}/file`, r.file_name ?? undefined).catch(() => addToast('error', 'Could not open the certificate file'))}>📄 File</button>
                      )}
                      {open
                        ? <button style={{ ...btn, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600 }} onClick={() => setUpload({ mode: 'row', row: r })}>↑ Upload</button>
                        : <span style={{ fontSize: 11, color: t.sub }}>{NO_UPLOAD_NOTE[r.status] ?? 'No upload'}</span>}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {loading && <Notice text="Loading your certificates…" />}
        {!loading && error && <Notice text={error} error />}
        {!loading && !error && rows.length === 0 && <Notice text={q || status !== 'all' ? 'No certificates match these filters.' : 'No certificate requirements for your company in this project.'} />}
      </div>
      {rows.length > 0 && (
        <Pager page={page} total={rows.length} pageSize={pageSize} dark={dark}
          onPageChange={setPage} onPageSizeChange={n => { setPageSize(n); setPage(1) }} />
      )}

      {detailId != null && (
        <CertDetailModal dark={dark} projectId={projectId} certId={detailId} skipHeat
          onClose={() => setDetailId(null)} onChanged={refresh} />
      )}
      {upload && (
        <UploadCertModal dark={dark} projectId={projectId} mode={upload.mode} vdrlRows={modalRows} poIds={poIds}
          prefill={upload.row ? { po_ref: upload.row.po_ref, vendor_name: null, tag: upload.row.tag, document_name: upload.row.document_name, document_requirement_id: upload.row.cert_id } : undefined}
          onClose={() => setUpload(null)}
          onUploaded={msg => { setUpload(null); addToast('success', msg); refresh() }} />
      )}
      <ToastContainer />
    </div>
  )
}

export const VendorCertScreen = (props: VendorCertScreenProps) => (
  <ToastProvider>
    <VendorCertInner {...props} />
  </ToastProvider>
)
