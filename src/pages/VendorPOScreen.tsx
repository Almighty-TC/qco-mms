// ─── MY POs — VENDOR SCREEN (ext-2c) ──────────────────────────────────────────
// A vendor's own purchase orders in the selected project, read-only. Calls only the
// routes the external gate allows a vendor (server/lib/externalGate.js, P2f):
//   GET procurement/:pid/pos · pos/:id · pos/:id/itp · pos/:id/variations ·
//   pos/:id/documents · pos/:id/documents/:docId/download (through lib/fileAccess).
// Every field is a key of the vendor projections in server/lib/vendorView.js
// (PO_LIST_ROW, PO_DETAIL, PO_LINE, SIGNED_DOC, ITP_REQUIREMENT, ITP_ITEM, VARIATION,
// DOCUMENT); the server scopes each call to the vendor's supplier.
import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { BackButton } from '../components/BackButton'
import { HelpButton } from '../components/HelpDrawer'
import { Pager } from '../components/Pager'
import { StatusLegend } from '../components/StatusLegend'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'
import { VENDOR_PO_HELP } from '../helpContent'
import { API } from '../lib/api'
import { viewFile, downloadFile } from '../lib/fileAccess'

// ─── TYPES (vendorView.js key lists) ──────────────────────────────────────────

type RAG = 'green' | 'amber' | 'red'
type Num = number | string | null   // DECIMAL columns arrive as strings

interface POHeader {                 // PO_DETAIL (PO_LIST_ROW without rag, line_count, created_at)
  id: number; po_number: string; po_name: string | null; description: string | null
  currency: string | null; value: Num; status: string; statusLabel: string
  ros_date: string | null; cdd: string | null; vendor_name: string | null; supplier_name: string | null
  incoterms: string | null; handover_point: string | null; wbs_code: string | null; wbs_name: string | null
  group_category: string | null
  milestone_po_date: string | null; milestone_fat_date: string | null; milestone_esd_date: string | null
  milestone_eta_date: string | null; milestone_ros_date: string | null
}
interface POListRow extends POHeader { rag: RAG | null; line_count: number; created_at: string }   // PO_LIST_ROW
interface POLine {                   // PO_LINE (no id: keyed by line_number)
  line_number: number | string; description: string | null; tag_number: string | null
  equipment_tag: string | null; equipment_tag_ref: string | null
  qty: Num; uom: string | null; uom_code: string | null; uom_name: string | null
  unit_price: Num; total_price: Num; cdd: string | null; ros_date: string | null; forecast_ready_date: string | null
  insp_type: string | null; cert_required: number | null; vdrl_required: number | null
  heat_number_required: number | null; heat_number: string | null
  status: string | null; qty_received: Num; received_to_date: Num; remaining_qty: Num
}
interface SignedDoc { id: number; file_name: string; file_size_bytes: number | null; mime_type: string | null; version: number | null; uploaded_at: string | null; uploaded_by_name: string | null }
interface PODetail extends POHeader { contract_delivery_date: string | null; lines: POLine[]; signedDoc: SignedDoc | null }
interface ITPItem { id: number; item_number: string | null; description: string | null; status: string | null }
interface ITPRequirement {
  id: number; item_number: string | null; description: string | null; inspection_type: string | null
  is_mandatory: number | null; timing: string | null; witness_required: number | null; certificate_required: number | null
  planned_date: string | null; forecast_date: string | null; status: string | null
  completion_date: string | null; completion_notes: string | null; items: ITPItem[]
}
interface Variation { id: number; variation_number: string | null; value_impact: Num; schedule_impact_days: number | null; status: string | null; reason: string | null; approved_at: string | null }
interface PODocument { id: number; doc_type: string; file_name: string; file_size_bytes: number | null; mime_type: string | null; version: number | null; is_current: number | null; uploaded_at: string | null; uploaded_by_name: string | null }

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtValueCode(val: Num, ccy: string | null) {
  if (val == null || val === '') return '—'
  return `${ccy || 'AUD'} ${Math.round(Number(val)).toLocaleString('en-AU')}`
}
function fmtNum(val: Num) {
  if (val == null || val === '') return '—'
  return Number(val).toLocaleString('en-AU', { maximumFractionDigits: 3 })
}
function formatBytes(bytes: number | null) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}
const yesNo = (v: number | null) => (v == null ? '—' : Number(v) ? 'Yes' : 'No')
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? fallback

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  rfq:                       { bg: 'rgba(245,158,11,0.12)',  text: '#b45309' },
  'po-raised':               { bg: 'rgba(34,197,94,0.12)',   text: '#15803d' },
  active:                    { bg: 'rgba(37,99,235,0.12)',   text: '#2563eb' },
  closed:                    { bg: 'rgba(100,116,139,0.12)', text: '#475569' },
  cancelled:                 { bg: 'rgba(239,68,68,0.12)',   text: '#dc2626' },
  pending_approval:          { bg: 'rgba(245,158,11,0.12)',  text: '#b45309' },
  pending_director_approval: { bg: 'rgba(234,88,12,0.12)',   text: '#c2410c' },
  approved:                  { bg: 'rgba(34,197,94,0.12)',   text: '#15803d' },
  rejected:                  { bg: 'rgba(239,68,68,0.12)',   text: '#dc2626' },
  draft:                     { bg: 'rgba(100,116,139,0.12)', text: '#475569' },
}
const StatusPill = ({ status, label }: { status: string; label: string }) => {
  const c = STATUS_COLORS[status] ?? { bg: 'rgba(100,116,139,0.12)', text: '#475569' }
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text, whiteSpace: 'nowrap' }}>{label}</span>
}
const RAG_COLOR: Record<RAG, string> = { green: '#2E7D32', amber: '#E84E0F', red: '#C62828' }
const RAG_LABEL: Record<RAG, string> = { green: 'On track', amber: 'At risk', red: 'Breached' }
const DOC_TYPE_LABEL: Record<string, string> = { signed_po: 'Signed PO', amendment: 'Amendment', variation_order: 'Variation Order', correspondence: 'Correspondence', vendor_invoice: 'Vendor Invoice', other: 'Other' }

const tokens = (dark: boolean) => ({
  col: dark ? '#f1f5f9' : '#0f172a', sub: '#94a3b8',
  card: dark ? '#1e293b' : '#fff', bd: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
  head: dark ? '#162032' : '#f8fafc', row: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
})
const Notice = ({ text, error }: { text: string; error?: boolean }) => (
  <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: error ? '#dc2626' : '#94a3b8' }}>{text}</div>
)

// ─── LIST ─────────────────────────────────────────────────────────────────────

const LIST_COLS = [
  { label: 'PO number', width: 150, min: 110 }, { label: 'Name', width: 260, min: 140 },
  { label: 'Status', width: 140, min: 100 }, { label: 'Value', width: 150, min: 110 },
  { label: 'ROS', width: 110, min: 90 }, { label: 'CDD', width: 110, min: 90 },
  { label: 'RAG', width: 100, min: 80 }, { label: 'Lines', width: 80, min: 60 },
]

const POList = ({ dark, projectId, onOpen }: { dark: boolean; projectId: number; onOpen: (id: number) => void }) => {
  const t = tokens(dark)
  const [rows, setRows] = useState<POListRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const rt = useResizableTable('vendor_pos', LIST_COLS.map(c => c.width), LIST_COLS.map(c => c.min))

  useEffect(() => { const id = setTimeout(() => { setSearch(input.trim()); setPage(1) }, 350); return () => clearTimeout(id) }, [input])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params: Record<string, string> = { page: String(page), limit: String(pageSize) }
      if (search) params.search = search
      const { data } = await axios.get(`${API}/procurement/${projectId}/pos`, { params })
      setRows(data.data ?? []); setTotal(data.total ?? 0)
    } catch (e) {
      setRows([]); setTotal(0); setError(errText(e, 'Failed to load your POs'))
    } finally { setLoading(false) }
  }, [projectId, page, pageSize, search])
  useEffect(() => { load() }, [load])

  const th: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: t.sub, textTransform: 'uppercase', whiteSpace: 'nowrap', background: t.head }
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 12, color: t.col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Search PO number or description…"
          style={{ height: 32, padding: '0 10px', borderRadius: 6, border: t.bd, background: dark ? '#0f172a' : '#fff', color: t.col, fontSize: 13, fontFamily: 'inherit', width: 280 }} />
        <div style={{ flex: 1 }} />
        <StatusLegend dark={dark} label="RAG" items={(['green', 'amber', 'red'] as RAG[]).map(r => ({ label: RAG_LABEL[r], color: RAG_COLOR[r] }))} />
        <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
      </div>
      <div style={{ background: t.card, border: t.bd, borderRadius: 10, overflow: 'auto' }}>
        <table style={{ ...rt.tableStyle, borderCollapse: 'collapse' }}>
          <thead>
            <tr>{LIST_COLS.map((c, i) => <th key={c.label} style={{ ...th, ...rt.thStyle(i) }}>{c.label}{rt.handle(i, dark)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(po => (
              <tr key={po.id} onClick={() => onOpen(po.id)} title="Open this PO"
                style={{ borderBottom: t.row, cursor: 'pointer', boxShadow: po.rag ? `inset 4px 0 0 ${RAG_COLOR[po.rag]}` : undefined }}>
                <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace', color: '#2563eb', fontWeight: 600 }}>{po.po_number}</td>
                <td style={td} title={po.po_name ?? po.description ?? ''}>{po.po_name ?? po.description ?? '—'}</td>
                <td style={td}><StatusPill status={po.status} label={po.statusLabel} /></td>
                <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{fmtValueCode(po.value, po.currency)}</td>
                <td style={td}>{fmtDate(po.ros_date)}</td>
                <td style={td}>{fmtDate(po.cdd)}</td>
                <td style={td}>{po.rag ? <span style={{ color: RAG_COLOR[po.rag], fontWeight: 600 }}>{RAG_LABEL[po.rag]}</span> : '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{po.line_count ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <Notice text="Loading your POs…" />}
        {!loading && error && <Notice text={error} error />}
        {!loading && !error && rows.length === 0 && <Notice text={search ? 'No POs match your search.' : 'No purchase orders for your company in this project.'} />}
      </div>
      {total > 0 && (
        <Pager page={page} total={total} pageSize={pageSize} dark={dark}
          onPageChange={setPage} onPageSizeChange={n => { setPageSize(n); setPage(1) }} />
      )}
    </>
  )
}

// ─── DETAIL TABS ──────────────────────────────────────────────────────────────

type Tab = 'header' | 'lines' | 'itp' | 'variations' | 'documents'
const TABS: { key: Tab; label: string }[] = [
  { key: 'header', label: 'Header' }, { key: 'lines', label: 'Lines' }, { key: 'itp', label: 'ITP' },
  { key: 'variations', label: 'Variations' }, { key: 'documents', label: 'Documents' },
]

// Loads one read-only sub-list of the PO when its tab opens.
function useSubList<T>(url: string) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setRows(null); setError('')
    axios.get(url).then(r => { if (live) setRows(Array.isArray(r.data) ? r.data : []) })
      .catch(e => { if (live) { setRows([]); setError(errText(e, 'Failed to load')) } })
    return () => { live = false }
  }, [url])
  return { rows, error }
}

const Field = ({ label, value, mono, t }: { label: string; value: React.ReactNode; mono?: boolean; t: ReturnType<typeof tokens> }) => (
  <div>
    <div style={{ fontSize: 10, fontWeight: 600, color: t.sub, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
    <div style={{ fontSize: 13, color: t.col, fontFamily: mono ? 'JetBrains Mono, monospace' : undefined }}>{value ?? '—'}</div>
  </div>
)

const FileButtons = ({ url, name, dark }: { url: string; name: string; dark: boolean }) => {
  const { addToast } = useToast()
  const b: React.CSSProperties = { padding: '4px 10px', borderRadius: 5, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button style={{ ...b, color: '#2563eb' }} onClick={() => viewFile(url, name).catch(() => addToast('error', 'Could not open the file'))}>👁 View</button>
      <button style={{ ...b, color: '#16a34a' }} onClick={() => downloadFile(url, name).catch(() => addToast('error', 'Download failed'))}>↓ Download</button>
    </span>
  )
}

const HeaderTab = ({ po, dark }: { po: PODetail; dark: boolean }) => {
  const t = tokens(dark)
  const d = po.signedDoc
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 16, background: t.card, border: t.bd, borderRadius: 10, padding: 18 }}>
        <Field t={t} label="PO number" value={po.po_number} mono />
        <Field t={t} label="Status" value={<StatusPill status={po.status} label={po.statusLabel} />} />
        <Field t={t} label="Value" value={fmtValueCode(po.value, po.currency)} mono />
        <Field t={t} label="Supplier" value={po.supplier_name ?? po.vendor_name} />
        <Field t={t} label="Incoterms" value={po.incoterms} />
        <Field t={t} label="Handover point" value={po.handover_point} />
        <Field t={t} label="WBS" value={po.wbs_code ? `${po.wbs_code}${po.wbs_name ? ' — ' + po.wbs_name : ''}` : null} />
        <Field t={t} label="Group" value={po.group_category?.replace(/_/g, ' ')} />
        <Field t={t} label="ROS" value={fmtDate(po.ros_date)} />
        <Field t={t} label="CDD (earliest line)" value={fmtDate(po.cdd)} />
        <Field t={t} label="Contract delivery date" value={fmtDate(po.contract_delivery_date)} />
        <Field t={t} label="PO placed" value={fmtDate(po.milestone_po_date)} />
        <Field t={t} label="FAT" value={fmtDate(po.milestone_fat_date)} />
        <Field t={t} label="ESD (ex-ship)" value={fmtDate(po.milestone_esd_date)} />
        <Field t={t} label="ETA" value={fmtDate(po.milestone_eta_date)} />
        <Field t={t} label="ROS milestone" value={fmtDate(po.milestone_ros_date)} />
      </div>
      <div style={{ marginTop: 14, background: t.card, border: t.bd, borderRadius: 10, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: t.col }}>Signed PO</span>
        {d ? <>
          <span style={{ fontSize: 12, color: t.col }}>{d.file_name}</span>
          <span style={{ fontSize: 11, color: t.sub }}>v{d.version ?? 1} · {formatBytes(d.file_size_bytes)} · {fmtDate(d.uploaded_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}</span>
          <FileButtons url={`${API}/procurement/pos/${po.id}/documents/${d.id}/download`} name={d.file_name} dark={dark} />
        </> : <span style={{ fontSize: 12, color: t.sub }}>Not uploaded yet</span>}
      </div>
    </div>
  )
}

const tableTh = (t: ReturnType<typeof tokens>): React.CSSProperties => ({ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: t.sub, textTransform: 'uppercase', whiteSpace: 'nowrap', background: t.head })
const tableTd = (t: ReturnType<typeof tokens>): React.CSSProperties => ({ padding: '8px 10px', fontSize: 12, color: t.col, verticalAlign: 'top' })
const Table = ({ t, heads, children }: { t: ReturnType<typeof tokens>; heads: string[]; children: React.ReactNode }) => (
  <div style={{ background: t.card, border: t.bd, borderRadius: 10, overflow: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{heads.map(h => <th key={h} style={tableTh(t)}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)

const LinesTab = ({ po, dark }: { po: PODetail; dark: boolean }) => {
  const t = tokens(dark), td = tableTd(t)
  if (!po.lines.length) return <Notice text="This PO has no lines." />
  const flags = (l: POLine) => [Number(l.cert_required) ? 'Cert' : '', Number(l.vdrl_required) ? 'VDRL' : '', Number(l.heat_number_required) ? 'Heat no.' : ''].filter(Boolean).join(' · ') || '—'
  return (
    <Table t={t} heads={['Line', 'Description', 'Tag', 'Qty', 'UOM', 'Unit price', 'Total', 'CDD', 'ROS', 'Forecast ready', 'Received', 'Remaining', 'Status', 'Inspection', 'Required', 'Heat no.']}>
      {po.lines.map((l, i) => (
        <tr key={l.line_number ?? `i${i}`} style={{ borderBottom: t.row }}>
          <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{l.line_number}</td>
          <td style={td}>{l.description ?? '—'}</td>
          <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }} title={l.equipment_tag_ref ?? undefined}>{l.tag_number ?? l.equipment_tag ?? '—'}</td>
          <td style={{ ...td, textAlign: 'right' }}>{fmtNum(l.qty)}</td>
          <td style={td} title={l.uom_name ?? undefined}>{l.uom_code ?? l.uom ?? '—'}</td>
          <td style={{ ...td, textAlign: 'right' }}>{fmtNum(l.unit_price)}</td>
          <td style={{ ...td, textAlign: 'right' }}>{fmtNum(l.total_price)}</td>
          <td style={td}>{fmtDate(l.cdd)}</td>
          <td style={td}>{fmtDate(l.ros_date)}</td>
          <td style={td}>{fmtDate(l.forecast_ready_date)}</td>
          <td style={{ ...td, textAlign: 'right' }}>{fmtNum(l.qty_received ?? l.received_to_date)}</td>
          <td style={{ ...td, textAlign: 'right' }}>{fmtNum(l.remaining_qty)}</td>
          <td style={td}>{l.status ?? '—'}</td>
          <td style={td}>{l.insp_type ?? '—'}</td>
          <td style={td}>{flags(l)}</td>
          <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{l.heat_number ?? '—'}</td>
        </tr>
      ))}
    </Table>
  )
}

const ITPTab = ({ po, dark }: { po: PODetail; dark: boolean }) => {
  const t = tokens(dark), td = tableTd(t)
  const { rows, error } = useSubList<ITPRequirement>(`${API}/procurement/pos/${po.id}/itp`)
  if (!rows) return <Notice text="Loading ITP…" />
  if (error) return <Notice text={error} error />
  if (!rows.length) return <Notice text="No ITP requirements on this PO." />
  return (
    <Table t={t} heads={['Item', 'Description', 'Inspection', 'Mandatory', 'Timing', 'Witness', 'Certificate', 'Planned', 'Forecast', 'Status', 'Completed', 'Notes']}>
      {rows.map(r => (
        <tr key={r.id} style={{ borderBottom: t.row }}>
          <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{r.item_number ?? '—'}</td>
          <td style={td}>
            {r.description ?? '—'}
            {(r.items ?? []).length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: t.sub, fontSize: 11 }}>
                {(r.items ?? []).map(it => <li key={it.id}>{it.item_number ? `${it.item_number} · ` : ''}{it.description ?? '—'}{it.status ? ` (${it.status})` : ''}</li>)}
              </ul>
            )}
          </td>
          <td style={td}>{r.inspection_type ?? '—'}</td>
          <td style={td}>{yesNo(r.is_mandatory)}</td>
          <td style={td}>{r.timing ?? '—'}</td>
          <td style={td}>{yesNo(r.witness_required)}</td>
          <td style={td}>{yesNo(r.certificate_required)}</td>
          <td style={td}>{fmtDate(r.planned_date)}</td>
          <td style={td}>{fmtDate(r.forecast_date)}</td>
          <td style={td}>{r.status ?? '—'}</td>
          <td style={td}>{fmtDate(r.completion_date)}</td>
          <td style={td}>{r.completion_notes ?? '—'}</td>
        </tr>
      ))}
    </Table>
  )
}

const VariationsTab = ({ po, dark }: { po: PODetail; dark: boolean }) => {
  const t = tokens(dark), td = tableTd(t)
  const { rows, error } = useSubList<Variation>(`${API}/procurement/pos/${po.id}/variations`)
  if (!rows) return <Notice text="Loading variations…" />
  if (error) return <Notice text={error} error />
  if (!rows.length) return <Notice text="No variations on this PO." />
  return (
    <Table t={t} heads={['Variation', 'Value impact', 'Schedule impact', 'Status', 'Reason', 'Approved']}>
      {rows.map(v => (
        <tr key={v.id} style={{ borderBottom: t.row }}>
          <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{v.variation_number ?? '—'}</td>
          <td style={{ ...td, fontFamily: 'JetBrains Mono, monospace' }}>{fmtValueCode(v.value_impact, po.currency)}</td>
          <td style={td}>{v.schedule_impact_days != null ? `${v.schedule_impact_days} days` : '—'}</td>
          <td style={td}>{v.status ?? '—'}</td>
          <td style={td}>{v.reason ?? '—'}</td>
          <td style={td}>{fmtDate(v.approved_at)}</td>
        </tr>
      ))}
    </Table>
  )
}

const DocumentsTab = ({ po, dark }: { po: PODetail; dark: boolean }) => {
  const t = tokens(dark), td = tableTd(t)
  const { rows, error } = useSubList<PODocument>(`${API}/procurement/pos/${po.id}/documents`)
  if (!rows) return <Notice text="Loading documents…" />
  if (error) return <Notice text={error} error />
  if (!rows.length) return <Notice text="No documents on this PO." />
  return (
    <Table t={t} heads={['Type', 'File', 'Version', 'Size', 'Uploaded', 'By', '']}>
      {rows.map(d => (
        <tr key={d.id} style={{ borderBottom: t.row }}>
          <td style={td}>{DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}</td>
          <td style={td}>{d.file_name}</td>
          <td style={td}>v{d.version ?? 1}{Number(d.is_current) ? '' : ' (superseded)'}</td>
          <td style={td}>{formatBytes(d.file_size_bytes)}</td>
          <td style={td}>{fmtDate(d.uploaded_at)}</td>
          <td style={td}>{d.uploaded_by_name ?? '—'}</td>
          <td style={{ ...td, whiteSpace: 'nowrap' }}><FileButtons url={`${API}/procurement/pos/${po.id}/documents/${d.id}/download`} name={d.file_name} dark={dark} /></td>
        </tr>
      ))}
    </Table>
  )
}

const PODetailView = ({ dark, poId, onList }: { dark: boolean; poId: number; onList: () => void }) => {
  const t = tokens(dark)
  const [po, setPO] = useState<PODetail | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('header')
  useEffect(() => {
    let live = true
    setPO(null); setError(''); setTab('header')
    axios.get(`${API}/procurement/pos/${poId}`)
      .then(r => { if (live) setPO({ ...r.data, lines: r.data.lines ?? [] }) })
      .catch(e => { if (live) setError(errText(e, 'Failed to load this PO')) })
    return () => { live = false }
  }, [poId])

  const back = (
    <button onClick={onList} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0, marginBottom: 12 }}>← All my POs</button>
  )
  if (error) return <div>{back}<Notice text={error} error /></div>
  if (!po) return <div>{back}<Notice text="Loading PO…" /></div>
  const tabSty = (active: boolean): React.CSSProperties => ({
    padding: '8px 14px', background: 'none', border: 'none', borderBottom: active ? '2px solid #E84E0F' : '2px solid transparent',
    color: active ? '#E84E0F' : t.sub, fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
  })
  return (
    <div>
      {back}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: t.sub }}>{po.po_number}</span>
        <StatusPill status={po.status} label={po.statusLabel} />
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: t.col, margin: '0 0 4px' }}>{po.po_name ?? po.po_number}</h2>
      {po.description && <p style={{ fontSize: 13, color: t.sub, margin: '0 0 14px' }}>{po.description}</p>}
      <div style={{ display: 'flex', gap: 2, borderBottom: t.bd, marginBottom: 16 }}>
        {TABS.map(x => <button key={x.key} style={tabSty(tab === x.key)} onClick={() => setTab(x.key)}>{x.label}{x.key === 'lines' ? ` (${po.lines.length})` : ''}</button>)}
      </div>
      {tab === 'header'     && <HeaderTab po={po} dark={dark} />}
      {tab === 'lines'      && <LinesTab po={po} dark={dark} />}
      {tab === 'itp'        && <ITPTab po={po} dark={dark} />}
      {tab === 'variations' && <VariationsTab po={po} dark={dark} />}
      {tab === 'documents'  && <DocumentsTab po={po} dark={dark} />}
    </div>
  )
}

// ─── SCREEN ───────────────────────────────────────────────────────────────────

export interface VendorPOScreenProps {
  dark: boolean
  projectId: number
  projectName: string
  onBack: () => void
}

const VendorPOInner = ({ dark, projectId, projectName, onBack }: VendorPOScreenProps) => {
  const t = tokens(dark)
  const [openId, setOpenId] = useState<number | null>(null)
  useEffect(() => { setOpenId(null) }, [projectId])
  return (
    <div style={{ padding: 24, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <BackButton onFallback={onBack} dark={dark} />
        <HelpButton screenName="My POs" sections={VENDOR_PO_HELP} dark={dark} />
      </div>
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: t.col }}>My POs</h1>
      <div style={{ fontSize: 12, color: t.sub, marginBottom: 18 }}>Purchase orders placed with your company · {projectName}</div>
      {openId == null
        ? <POList dark={dark} projectId={projectId} onOpen={setOpenId} />
        : <PODetailView dark={dark} poId={openId} onList={() => setOpenId(null)} />}
      <ToastContainer />
    </div>
  )
}

export const VendorPOScreen = (props: VendorPOScreenProps) => (
  <ToastProvider>
    <VendorPOInner {...props} />
  </ToastProvider>
)
