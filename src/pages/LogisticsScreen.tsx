// ─── LOGISTICS SCREEN ─────────────────────────────────────────
// SCN Register with pipeline status bar, filterable table, and
// SCNDetailModal for full shipment detail (overview/packages/docs/timeline).
import React, { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'
import { MilestoneLegend } from '../components/MilestoneLegend'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ScopeBanner } from '../components/ScopeBanner'
import { Pager } from '../components/Pager'
import { usePagedList } from '../hooks/usePagedList'

const API = 'http://localhost:3001/api'

// ─── TYPES ────────────────────────────────────────────────────
interface SCNRow {
  id: number; scn_ref: string; po_ref?: string | null; vendor_name?: string | null
  forwarder_name?: string | null; origin_location?: string | null
  destination_name?: string | null; destination_code?: string | null
  mode?: string | null; incoterms?: string | null
  etd?: string | null; eta?: string | null
  status: string; display_status: string; rag?: string | null
  is_critical_path: number
  total_packages?: number | null; total_weight_kg?: number | null
}
interface PipelineCounts {
  pending_pickup: number; in_transit: number; customs_review: number
  pending_delivery: number; delivered: number; total: number
}
interface SCNDetail extends SCNRow {
  atd?: string | null; ata?: string | null
  bl_number?: string | null; container_ref?: string | null; notes?: string | null
  forwarder_notified: number; forwarder_user_id?: number | null
  po_id?: number | null; vendor_display?: string | null
  lines: POLine[]; additional_items: any[]; packages: Package[]
  documents: Doc[]; status_log: StatusLogEntry[]; date_changes: DateChange[]
  etd_change_count?: number; eta_change_count?: number
}
interface POLine { id: number; line_number: string; description: string; qty: number | null; qty_assigned: number | null; uom: string }
interface Package {
  id: number; scn_id: number; package_number: string; description?: string | null
  length_mm?: number | null; width_mm?: number | null; height_mm?: number | null
  gross_weight_kg?: number | null; net_weight_kg?: number | null
  is_dangerous_goods: number; dg_class?: string | null; dg_un_number?: string | null
  marks_numbers?: string | null
}
interface Doc {
  id: number; document_type: string; file_name?: string | null; notes?: string | null
  uploaded_by_name?: string | null; uploaded_at: string
}
interface StatusLogEntry {
  id: number; from_status?: string | null; to_status: string
  changed_by_name?: string | null; changed_at: string; notes?: string | null
}
interface DateChange {
  id: number; field_name: string; old_value?: string | null; new_value?: string | null
  change_reason?: string | null; changed_by_name?: string | null; created_at: string
}

// ─── STATUS CONFIG ────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  pending_pickup:   { label: 'Pending Pickup',   bg: 'rgba(100,116,139,0.12)', color: '#64748b' },
  in_transit:       { label: 'In Transit',        bg: 'rgba(37,99,235,0.1)',    color: '#2563eb' },
  customs_review:   { label: 'Customs Review',    bg: 'rgba(245,158,11,0.1)',   color: '#d97706' },
  pending_delivery: { label: 'Pending Delivery',  bg: 'rgba(139,92,246,0.1)',   color: '#8b5cf6' },
  delivered:        { label: 'Delivered',          bg: 'rgba(34,197,94,0.1)',    color: '#16a34a' },
}
const STATUS_BAR_COLOR: Record<string, string> = {
  pending_pickup: '#64748b', in_transit: '#2563eb',
  customs_review: '#f59e0b', pending_delivery: '#8b5cf6', delivered: '#22c55e',
}
const RAG_COLOR: Record<string, string> = { red: '#ef4444', amber: '#f59e0b', green: '#22c55e' }
const MODE_ICON: Record<string, string> = { sea: '🚢', air: '✈', road: '🚛', rail: '🚂', courier: '📦' }

const NEXT_VALID: Record<string, string[]> = {
  pending_pickup: ['in_transit'],
  in_transit: ['customs_review', 'pending_delivery'],
  customs_review: ['pending_delivery'],
  pending_delivery: ['delivered'],
  delivered: [],
}

// ─── HELPERS ─────────────────────────────────────────────────
const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const fmtFull = (d?: string | null) => d ? new Date(d).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtW = (w?: number | null) => w ? `${Number(w).toLocaleString('en-AU', { maximumFractionDigits: 1 })} kg` : '—'
const etaColour = (eta?: string | null) => {
  if (!eta) return undefined
  const d = Math.ceil((new Date(eta).getTime() - Date.now()) / 86400000)
  if (d < 0) return '#ef4444'
  if (d < 3) return '#d97706'
  return undefined
}

// ─── MAIN INNER COMPONENT ────────────────────────────────────
const LogisticsScreenInner = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const { addToast } = useToast()
  const { isForwarder } = useCurrentUser()

  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bg     = dark ? '#0f172a' : '#f4f7fb'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  const [pipeline, setPipeline]   = useState<PipelineCounts | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [search, setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [modeFilter, setModeFilter] = useState('all')
  const [criticalOnly, setCritical] = useState(false)
  const [arrivalDays, setArrivalDays] = useState('')

  const [selectedScn, setSelectedScn] = useState<SCNDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Debounce search so we don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // ─── SERVER-SIDE PAGED LOAD ──────────────────────────────────
  // All filters (status/search/critical/mode/arrival) + sort run server-side
  // across the whole register; the grid holds one page. Previously the screen
  // fetched limit:200 with no pager and filtered mode/arrival client-side — so
  // SCNs beyond 200 were silently dropped and those filters were page-local.
  const fetcher = useCallback(async ({ page, limit, sortCol, sortDir }: { page: number; limit: number; sortCol?: string; sortDir: 'asc' | 'desc' }) => {
    const params: Record<string, string> = { page: String(page), limit: String(limit), sort_dir: sortDir }
    if (sortCol)                params.sort_col      = sortCol
    if (statusFilter)           params.status        = statusFilter
    if (debouncedSearch.trim()) params.search        = debouncedSearch.trim()
    if (criticalOnly)           params.critical_only = 'true'
    if (modeFilter !== 'all')   params.mode          = modeFilter
    if (arrivalDays)            params.arrival_days  = arrivalDays
    const { data } = await axios.get(`${API}/logistics/register/${projectId}`, { params })
    setPipeline(data.pipeline_counts)
    return { data: (data.data ?? []) as SCNRow[], total: (data.total ?? 0) as number }
  }, [projectId, statusFilter, debouncedSearch, criticalOnly, modeFilter, arrivalDays])

  const {
    data: scns, total, page, setPage, pageSize, loading,
    sortCol, sortDir, toggleSort, reload,
  } = usePagedList<SCNRow>({
    fetcher, deps: [projectId, statusFilter, debouncedSearch, criticalOnly, modeFilter, arrivalDays],
    pageSize: 50, initialSortCol: 'created_at', initialSortDir: 'desc',
  })
  const sortArrow = (k: string) => sortCol === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  // ─── OPEN DETAIL ─────────────────────────────────────────
  const openDetail = async (scnId: number) => {
    setDetailLoading(true)
    try {
      const { data } = await axios.get(`${API}/logistics/scn/${scnId}`)
      setSelectedScn(data)
    } catch (e: any) {
      addToast('error', 'Failed to load SCN detail')
    } finally { setDetailLoading(false) }
  }

  const refreshDetail = async () => {
    if (!selectedScn) return
    try {
      const { data } = await axios.get(`${API}/logistics/scn/${selectedScn.id}`)
      setSelectedScn(data)
      reload()
    } catch (_) {}
  }

  // ─── CRITICAL TOGGLE ─────────────────────────────────────
  const toggleCritical = async (scn: SCNRow, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await axios.put(`${API}/logistics/scn/${scn.id}/critical-path`, { is_critical_path: !scn.is_critical_path })
      reload()
    } catch (_) { addToast('error', 'Failed to update critical path') }
  }

  // ─── CSV EXPORT ──────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['SCN Ref','PO','Vendor','Forwarder','Origin','Destination','Mode','ETD','ETA','Status','Packages','Weight','Critical']
    const rows = scns.map(r => [
      r.scn_ref, r.po_ref||'', r.vendor_name||'', r.forwarder_name||'',
      r.origin_location||'', r.destination_name||'', r.mode||'',
      r.etd ? new Date(r.etd).toLocaleDateString('en-AU') : '',
      r.eta ? new Date(r.eta).toLocaleDateString('en-AU') : '',
      STATUS_CONFIG[r.display_status]?.label || r.display_status,
      r.total_packages||'', r.total_weight_kg||'', r.is_critical_path ? 'Yes' : 'No',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `logistics_register_${projectId}.csv`; a.click()
  }

  const inputSt: React.CSSProperties = {
    fontSize: 12, padding: '6px 10px', borderRadius: 6, border: bd,
    background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit',
  }

  return (
    <div style={{ background: bg, minHeight: '100vh', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div style={{ background: cardBg, borderBottom: bd, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onClick={onBack} dark={dark} />
          <div style={{ fontSize: 11, color: sub }}>Dashboard › {projectName} › <strong style={{ color: col }}>Logistics</strong></div>
        </div>
        {!isForwarder && <button onClick={exportCSV} style={{ ...inputSt, cursor: 'pointer', width: 'auto' }}>↓ Export</button>}
      </div>

      <div style={{ padding: 24 }}>
        {/* Title + count */}
        {/* ScopeBanner for freight forwarders */}
        {isForwarder && (
          <ScopeBanner role="freight_forwarder" scnCount={total} />
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: col }}>
            Logistics — SCN Register · <span style={{ fontWeight: 400 }}>{projectName}</span>
          </h1>
          {pipeline && (
            <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 10, background: 'rgba(37,99,235,0.08)', color: '#2563eb', fontWeight: 600 }}>
              {pipeline.total} SCNs
            </span>
          )}
        </div>

        {/* ── PIPELINE BAR ──────────────────────────────────── */}
        {pipeline && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 20 }}>
            {(['pending_pickup','in_transit','customs_review','pending_delivery','delivered'] as const).map(s => {
              const active = statusFilter === s
              return (
                <button key={s} onClick={() => setStatusFilter(active ? null : s)}
                  style={{
                    background: active ? (dark ? '#1e3a5f' : '#eff6ff') : cardBg,
                    border: bd, borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                    textAlign: 'left', fontFamily: 'inherit',
                    borderBottom: active ? `3px solid ${STATUS_BAR_COLOR[s]}` : bd,
                    boxShadow: active ? `0 2px 8px rgba(0,0,0,0.12)` : 'none',
                  }}>
                  <div style={{ fontSize: 11, color: sub, marginBottom: 2 }}>{STATUS_CONFIG[s].label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: STATUS_BAR_COLOR[s] }}>{pipeline[s]}</div>
                </button>
              )
            })}
          </div>
        )}

        {/* ── TOOLBAR ───────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="SCN ref, PO, vendor, forwarder, origin, destination..."
            style={{ ...inputSt, flex: '1 1 280px', minWidth: 200 }} />
          <select value={modeFilter} onChange={e => setModeFilter(e.target.value)} style={{ ...inputSt, width: 140 }}>
            <option value="all">All modes</option>
            <option value="sea">🚢 Sea</option>
            <option value="air">✈ Air</option>
            <option value="road">🚛 Road</option>
            <option value="rail">🚂 Rail</option>
            <option value="courier">📦 Courier</option>
          </select>
          <button onClick={() => setCritical(v => !v)}
            style={{ ...inputSt, cursor: 'pointer', color: criticalOnly ? '#E84E0F' : sub, borderColor: criticalOnly ? '#E84E0F' : undefined, width: 'auto' }}>
            ★ {criticalOnly ? 'Critical' : 'All'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: sub }}>
            Arriving within
            <input type="number" value={arrivalDays} onChange={e => setArrivalDays(e.target.value)}
              placeholder="—" min="1" max="365"
              style={{ ...inputSt, width: 55, textAlign: 'center' }} />
            days
          </div>
          <div style={{ fontSize: 11, color: sub }}>{total} result{total !== 1 ? 's' : ''}</div>
        </div>

        {/* ── TABLE ─────────────────────────────────────────── */}
        <div style={{ background: cardBg, border: bd, borderRadius: 8 }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                <tr style={{ borderBottom: bd }}>
                  {([['★','40px'],['SCN','110px','scn_ref'],['PO','100px'],['VENDOR','130px','vendor'],['FORWARDER','120px','forwarder'],
                    ['ROUTE','160px','origin'],['MODE','90px','mode'],['ETD','100px','etd'],['ETA','100px','eta'],
                    ['PKGS','60px'],['WEIGHT','90px'],['STATUS','130px','status'],['RAG','50px']] as [string,string,string?][]).map(([h,w,key]) => (
                    <th key={h} onClick={key ? () => toggleSort(key) : undefined}
                      style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', width: w, whiteSpace: 'nowrap', cursor: key ? 'pointer' : 'default', userSelect: 'none' }}>
                      {h}{key ? sortArrow(key) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={13} style={{ padding: 40, textAlign: 'center', color: sub }}>Loading…</td></tr>
                ) : scns.length === 0 ? (
                  <tr><td colSpan={13} style={{ padding: 50, textAlign: 'center', color: sub }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>🚚</div>
                    <div>No shipment control notes found.</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>Adjust your filters or create SCNs from the Expediting module.</div>
                  </td></tr>
                ) : scns.map(scn => {
                  const rag = scn.rag || 'green'
                  const sc = STATUS_CONFIG[scn.display_status] || STATUS_CONFIG.pending_pickup
                  return (
                    <tr key={scn.id}
                      onClick={() => openDetail(scn.id)}
                      style={{
                        borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
                        cursor: 'pointer',
                        boxShadow: `inset 4px 0 0 ${RAG_COLOR[rag] || '#64748b'}`,
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = dark ? '#1e293b' : '#f8fafc'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                      {/* ★ */}
                      <td style={{ padding: '8px 10px' }} onClick={e => toggleCritical(scn, e)}>
                        <span style={{ cursor: 'pointer', color: scn.is_critical_path ? '#E84E0F' : '#cbd5e1', fontSize: 14 }}>★</span>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{scn.scn_ref}</span>
                      </td>
                      <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{scn.po_ref || '—'}</td>
                      <td style={{ padding: '8px 10px', color: col, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={scn.vendor_name || ''}>{scn.vendor_name || '—'}</td>
                      <td style={{ padding: '8px 10px', color: sub, fontSize: 11 }}>{scn.forwarder_name || '—'}</td>
                      <td style={{ padding: '8px 10px', fontSize: 11, color: sub }}>
                        <span style={{ color: col }}>{scn.origin_location || '—'}</span>
                        {scn.destination_name && <><span style={{ margin: '0 4px', color: '#E84E0F' }}>→</span><span>{scn.destination_name}</span></>}
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: 12 }}>
                        {scn.mode ? <span title={scn.mode}>{MODE_ICON[scn.mode] || '?'} <span style={{ color: sub, fontSize: 10, textTransform: 'capitalize' }}>{scn.mode}</span></span> : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', color: sub, fontSize: 11 }}>{fmt(scn.etd)}</td>
                      <td style={{ padding: '8px 10px', fontSize: 11, color: etaColour(scn.eta) || col, fontWeight: etaColour(scn.eta) ? 600 : undefined }}>{fmt(scn.eta)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{scn.total_packages ?? '—'}</td>
                      <td style={{ padding: '8px 10px', color: sub, fontSize: 11 }}>{fmtW(scn.total_weight_kg)}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: sc.bg, color: sc.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{sc.label}</span>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: RAG_COLOR[rag] || '#64748b' }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* ── MILESTONE LEGEND ──────────────────────────────── */}
          <MilestoneLegend dark={dark} />
        </div>

        <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} />
      </div>

      {/* ── LOADING OVERLAY ────────────────────────────────── */}
      {detailLoading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000 }}>
          <div style={{ background: cardBg, borderRadius: 12, padding: '20px 32px', color: col }}>Loading SCN…</div>
        </div>
      )}

      {/* ── SCN DETAIL MODAL ────────────────────────────────── */}
      {selectedScn && (
        <SCNDetailModal
          dark={dark} scn={selectedScn}
          onClose={() => setSelectedScn(null)}
          onRefresh={refreshDetail}
          addToast={addToast}
          projectId={projectId}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SCN DETAIL MODAL
// ═══════════════════════════════════════════════════════════════
const SCNDetailModal = ({ dark, scn, onClose, onRefresh, addToast, projectId }: {
  dark: boolean; scn: SCNDetail; onClose: () => void
  onRefresh: () => void; addToast: (t: 'success'|'error', m: string) => void
  projectId: number
}) => {
  const [tab, setTab] = useState<'overview'|'packages'|'documents'|'timeline'>('overview')
  const [showStatusModal, setShowStatusModal] = useState(false)

  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  const sc = STATUS_CONFIG[scn.display_status] || STATUS_CONFIG.pending_pickup
  const rag = scn.rag || 'green'

  return (
    <>
      {/* Scrim */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 4000 }} />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 720, maxWidth: '95vw',
        background: cardBg, borderLeft: bd, zIndex: 4001,
        display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 32px rgba(0,0,0,0.2)',
        fontFamily: 'IBM Plex Sans, sans-serif',
      }}>
        {/* Sticky header */}
        <div style={{ padding: '16px 24px', borderBottom: bd, flexShrink: 0, background: cardBg, boxShadow: `inset 4px 0 0 ${RAG_COLOR[rag] || '#64748b'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 700, color: col }}>{scn.scn_ref}</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: sc.bg, color: sc.color, fontWeight: 600 }}>{sc.label}</span>
                {scn.is_critical_path ? <span style={{ color: '#E84E0F', fontSize: 14 }}>★ Critical</span> : null}
              </div>
              <div style={{ fontSize: 12, color: sub }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: col }}>{scn.po_ref || '—'}</span>
                {scn.vendor_display && <> · {scn.vendor_display}</>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {NEXT_VALID[scn.display_status]?.length > 0 && (
                <button onClick={() => setShowStatusModal(true)}
                  style={{ padding: '6px 14px', borderRadius: 6, background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  Update Status
                </button>
              )}
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer', padding: '2px 6px' }}>✕</button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: bd, background: cardBg, flexShrink: 0 }}>
          {(['overview','packages','documents','timeline'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: tab === t ? 600 : 400,
                color: tab === t ? '#E84E0F' : sub,
                borderBottom: tab === t ? '2px solid #E84E0F' : '2px solid transparent',
                fontFamily: 'inherit', textTransform: 'capitalize',
              }}>{t}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {tab === 'overview' && <OverviewTab dark={dark} scn={scn} onRefresh={onRefresh} addToast={addToast} />}
          {tab === 'packages' && <PackagesTab dark={dark} scn={scn} onRefresh={onRefresh} addToast={addToast} />}
          {tab === 'documents' && <DocumentsTab dark={dark} scn={scn} onRefresh={onRefresh} addToast={addToast} />}
          {tab === 'timeline' && <TimelineTab dark={dark} scn={scn} />}
        </div>
      </div>

      {showStatusModal && (
        <StatusUpdateModal
          dark={dark} scn={scn}
          onClose={() => setShowStatusModal(false)}
          onSaved={() => { setShowStatusModal(false); onRefresh() }}
          addToast={addToast}
        />
      )}
    </>
  )
}

// ─── OVERVIEW TAB ────────────────────────────────────────────
const OverviewTab = ({ dark, scn, onRefresh, addToast }: {
  dark: boolean; scn: SCNDetail; onRefresh: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const inputSt: React.CSSProperties = {
    fontSize: 12, padding: '6px 10px', borderRadius: 6, border: bd,
    background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%',
  }

  const [editingDate, setEditingDate] = useState<'etd'|'eta'|null>(null)
  const [editEtd, setEditEtd] = useState(scn.etd ? scn.etd.slice(0,10) : '')
  const [editEta, setEditEta] = useState(scn.eta ? scn.eta.slice(0,10) : '')
  const [dateReason, setDateReason] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [dateError, setDateError] = useState('')
  const [etdHistOpen, setEtdHistOpen] = useState(false)
  const [etaHistOpen, setEtaHistOpen] = useState(false)

  const etdChanges = scn.date_changes?.filter(d => d.field_name === 'etd') || []
  const etaChanges = scn.date_changes?.filter(d => d.field_name === 'eta') || []

  const saveDate = async () => {
    if (!dateReason.trim()) { setDateError('Reason is required'); return }
    setSavingDate(true); setDateError('')
    try {
      await axios.put(`${API}/logistics/scn/${scn.id}/dates`, {
        etd: editEtd || null, eta: editEta || null, reason: dateReason.trim(),
      })
      setEditingDate(null); setDateReason('')
      addToast('success', 'Dates updated')
      onRefresh()
    } catch (e: any) {
      setDateError(e.response?.data?.error || 'Failed to update dates')
    } finally { setSavingDate(false) }
  }

  const metaLeft = [
    ['Forwarder',    scn.forwarder_name || '—'],
    ['Mode',         scn.mode ? `${MODE_ICON[scn.mode] || ''} ${scn.mode}` : '—'],
    ['Incoterms',    scn.incoterms || '—'],
    ['Origin',       scn.origin_location || '—'],
    ['Destination',  scn.destination_name ? `${scn.destination_name} (${scn.destination_code})` : '—'],
  ]
  const metaRight = [
    ['Total Packages',   scn.total_packages ?? '—'],
    ['Total Weight',     fmtW(scn.total_weight_kg)],
    ['DG Goods',         scn.packages?.some((p: Package) => p.is_dangerous_goods) ? '⚠️ Yes' : 'No'],
    ['Forwarder Notified', scn.forwarder_notified ? '✓ Yes' : 'No'],
    ['BL / AWB Number',  scn.bl_number || '—'],
    ['Container Ref',    scn.container_ref || '—'],
  ]

  return (
    <div>
      {/* 2-col meta grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div style={{ background: dark ? '#162032' : '#f8fafc', border: bd, borderRadius: 8, padding: '14px 18px' }}>
          {metaLeft.map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
              <span style={{ color: sub, flexShrink: 0 }}>{label}</span>
              <span style={{ color: col, textAlign: 'right', marginLeft: 12 }}>{val}</span>
            </div>
          ))}

          {/* ETD row with edit */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, alignItems: 'center' }}>
            <span style={{ color: sub }}>ETD</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: col }}>{fmt(scn.etd)}</span>
              <button onClick={() => { setEditingDate('etd'); setEditEtd(scn.etd ? scn.etd.slice(0,10) : ''); setEditEta(scn.eta ? scn.eta.slice(0,10) : ''); setDateReason('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 12, padding: 0 }}>✎</button>
              {etdChanges.length > 0 && (
                <button onClick={() => setEtdHistOpen(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d97706', fontSize: 11, padding: 0 }}>
                  Changed {etdChanges.length}×
                </button>
              )}
            </span>
          </div>
          {etdHistOpen && <DateHistoryInline changes={etdChanges} dark={dark} />}

          {/* ETA row with edit */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, alignItems: 'center' }}>
            <span style={{ color: sub }}>ETA</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: etaColour(scn.eta) || col, fontWeight: etaColour(scn.eta) ? 600 : undefined }}>{fmt(scn.eta)}</span>
              <button onClick={() => { setEditingDate('eta'); setEditEtd(scn.etd ? scn.etd.slice(0,10) : ''); setEditEta(scn.eta ? scn.eta.slice(0,10) : ''); setDateReason('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 12, padding: 0 }}>✎</button>
              {etaChanges.length > 0 && (
                <button onClick={() => setEtaHistOpen(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d97706', fontSize: 11, padding: 0 }}>
                  Changed {etaChanges.length}×
                </button>
              )}
            </span>
          </div>
          {etaHistOpen && <DateHistoryInline changes={etaChanges} dark={dark} />}
        </div>

        <div style={{ background: dark ? '#162032' : '#f8fafc', border: bd, borderRadius: 8, padding: '14px 18px' }}>
          {metaRight.map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
              <span style={{ color: sub, flexShrink: 0 }}>{label}</span>
              <span style={{ color: col, textAlign: 'right', marginLeft: 12 }}>{String(val)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Date edit form */}
      {editingDate && (
        <div style={{ background: dark ? '#162032' : '#fffbeb', border: `1px solid rgba(245,158,11,0.3)`, borderRadius: 8, padding: '14px 18px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 12 }}>Edit ETD / ETA</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>ETD</label>
              <input type="date" value={editEtd} onChange={e => setEditEtd(e.target.value)} style={inputSt} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>ETA</label>
              <input type="date" value={editEta} onChange={e => setEditEta(e.target.value)} style={inputSt} />
            </div>
          </div>
          <label style={{ fontSize: 11, color: '#d97706', display: 'block', marginBottom: 4, fontWeight: 600 }}>Reason for date change *</label>
          <textarea value={dateReason} onChange={e => { setDateReason(e.target.value); setDateError('') }}
            rows={2} placeholder="Required — explain why the dates are changing"
            style={{ ...inputSt, resize: 'vertical' }} />
          {dateError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{dateError}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => { setEditingDate(null); setDateError('') }}
              style={{ padding: '6px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button onClick={saveDate} disabled={savingDate}
              style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              {savingDate ? 'Saving…' : 'Save dates'}
            </button>
          </div>
        </div>
      )}

      {/* PO Lines */}
      {scn.lines?.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 10 }}>PO Lines</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: dark ? '#162032' : '#f8fafc', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
                {['Line #','Description','Qty','Assigned','UOM'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scn.lines.map(l => (
                <tr key={l.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#E84E0F' }}>{l.line_number}</td>
                  <td style={{ padding: '6px 10px', color: col }}>{l.description}</td>
                  <td style={{ padding: '6px 10px', color: sub, textAlign: 'right' }}>{l.qty ?? '—'}</td>
                  <td style={{ padding: '6px 10px', color: '#2563eb', textAlign: 'right' }}>{l.qty_assigned ?? 0}</td>
                  <td style={{ padding: '6px 10px', color: sub }}>{l.uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Off-PO additional items */}
      {scn.additional_items?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 8 }}>Additional Items (off-PO)</div>
          {scn.additional_items.map((it: any) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: dark ? '#162032' : '#f8fafc', borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }}>Additional item</span>
              <span style={{ color: col }}>{it.description}</span>
              {it.qty && <span style={{ color: sub }}>{it.qty} {it.uom}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── DATE HISTORY INLINE ─────────────────────────────────────
const DateHistoryInline = ({ changes, dark }: { changes: DateChange[]; dark: boolean }) => {
  const sub = '#94a3b8'
  const col = dark ? '#f1f5f9' : '#0f172a'
  return (
    <div style={{ background: dark ? '#0f172a' : '#f8fafc', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
      {changes.map(c => (
        <div key={c.id} style={{ fontSize: 11, marginBottom: 4, display: 'flex', gap: 8 }}>
          <span style={{ color: sub }}>{fmtFull(c.created_at)}</span>
          <span style={{ color: '#ef4444' }}>{c.old_value ? new Date(c.old_value).toLocaleDateString('en-AU') : '—'}</span>
          <span style={{ color: sub }}>→</span>
          <span style={{ color: '#16a34a' }}>{c.new_value ? new Date(c.new_value).toLocaleDateString('en-AU') : '—'}</span>
          <span style={{ color: col }}>{c.changed_by_name || '—'}</span>
          <span style={{ color: sub, fontStyle: 'italic' }}>{c.change_reason || ''}</span>
        </div>
      ))}
    </div>
  )
}

// ─── PACKAGES TAB ────────────────────────────────────────────
const PackagesTab = ({ dark, scn, onRefresh, addToast }: {
  dark: boolean; scn: SCNDetail; onRefresh: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  const emptyForm = { description: '', length_mm: '', width_mm: '', height_mm: '', gross_weight_kg: '', net_weight_kg: '', is_dangerous_goods: false, dg_class: '', dg_un_number: '', marks_numbers: '' }
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [editingId, setEditingId] = useState<number|null>(null)
  const inputSt: React.CSSProperties = {
    fontSize: 11, padding: '4px 7px', borderRadius: 5, border: bd,
    background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%',
  }

  const totalGross = scn.packages?.reduce((s, p) => s + (Number(p.gross_weight_kg) || 0), 0) || 0

  const savePackage = async () => {
    if (!form.length_mm || !form.width_mm || !form.height_mm || !form.gross_weight_kg)
      return setFormError('Dimensions and gross weight are required')
    setSaving(true); setFormError('')
    try {
      if (editingId) {
        await axios.put(`${API}/logistics/scn/${scn.id}/packages/${editingId}`, form)
        addToast('success', 'Package updated')
      } else {
        await axios.post(`${API}/logistics/scn/${scn.id}/packages`, form)
        addToast('success', 'Package added')
      }
      setAdding(false); setEditingId(null); setForm(emptyForm); onRefresh()
    } catch (e: any) {
      setFormError(e.response?.data?.error || 'Failed to save package')
    } finally { setSaving(false) }
  }

  const deletePackage = async (pkgId: number) => {
    try {
      await axios.delete(`${API}/logistics/scn/${scn.id}/packages/${pkgId}`)
      addToast('success', 'Package deleted'); onRefresh()
    } catch (_) { addToast('error', 'Failed to delete package') }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: col }}>{scn.packages?.length || 0} packages · {totalGross.toLocaleString('en-AU', { maximumFractionDigits: 1 })} kg total</span>
        {!adding && !editingId && (
          <button onClick={() => { setAdding(true); setEditingId(null); setForm(emptyForm) }}
            style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            + Add Package
          </button>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: theadBg, borderBottom: bd }}>
              {['#','Description','L × W × H (mm)','Gross kg','Net kg','DG','Class','Marks','Actions'].map(h => (
                <th key={h} style={{ padding: '7px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(scn.packages || []).map(p => (
              editingId === p.id ? (
                <tr key={p.id}>
                  <td colSpan={9} style={{ padding: 10 }}>
                    <PackageFormRow form={form} setForm={setForm} inputSt={inputSt} col={col} sub={sub} bd={bd} dark={dark} error={formError}
                      onSave={savePackage} onCancel={() => { setEditingId(null); setForm(emptyForm); setFormError('') }} saving={saving} mode="edit" />
                  </td>
                </tr>
              ) : (
                <tr key={p.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                  <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', color: '#E84E0F', fontSize: 11 }}>{p.package_number}</td>
                  <td style={{ padding: '7px 8px', color: col }}>{p.description || '—'}</td>
                  <td style={{ padding: '7px 8px', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{p.length_mm} × {p.width_mm} × {p.height_mm}</td>
                  <td style={{ padding: '7px 8px', color: col, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{p.gross_weight_kg}</td>
                  <td style={{ padding: '7px 8px', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{p.net_weight_kg || '—'}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'center' }}>{p.is_dangerous_goods ? <span style={{ color: '#ef4444' }}>⚠️</span> : '—'}</td>
                  <td style={{ padding: '7px 8px', color: sub }}>{p.dg_class || '—'}</td>
                  <td style={{ padding: '7px 8px', color: sub, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.marks_numbers || '—'}</td>
                  <td style={{ padding: '7px 8px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => { setEditingId(p.id); setAdding(false); setForm({ description: p.description||'', length_mm: String(p.length_mm||''), width_mm: String(p.width_mm||''), height_mm: String(p.height_mm||''), gross_weight_kg: String(p.gross_weight_kg||''), net_weight_kg: String(p.net_weight_kg||''), is_dangerous_goods: !!p.is_dangerous_goods, dg_class: p.dg_class||'', dg_un_number: p.dg_un_number||'', marks_numbers: p.marks_numbers||'' }) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 13 }}>✎</button>
                      <button onClick={() => deletePackage(p.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 13 }}>🗑</button>
                    </div>
                  </td>
                </tr>
              )
            ))}
            {adding && (
              <tr>
                <td colSpan={9} style={{ padding: 10 }}>
                  <PackageFormRow form={form} setForm={setForm} inputSt={inputSt} col={col} sub={sub} bd={bd} dark={dark} error={formError}
                    onSave={savePackage} onCancel={() => { setAdding(false); setForm(emptyForm); setFormError('') }} saving={saving} mode="add" />
                </td>
              </tr>
            )}
          </tbody>
          {(scn.packages?.length || 0) > 0 && (
            <tfoot>
              <tr style={{ background: dark ? '#162032' : '#f8fafc', borderTop: bd }}>
                <td colSpan={2} style={{ padding: '7px 8px', fontSize: 11, fontWeight: 600, color: col }}>TOTALS</td>
                <td style={{ padding: '7px 8px', fontSize: 11, color: sub }}>{scn.packages?.length} packages</td>
                <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 600, color: col }}>{totalGross.toLocaleString('en-AU', { maximumFractionDigits: 1 })}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

const PackageFormRow = ({ form, setForm, inputSt, col, sub, bd, dark, error, onSave, onCancel, saving, mode }: any) => (
  <div style={{ background: dark ? '#0f172a' : '#f0fdf4', border: `1px solid rgba(34,197,94,0.3)`, borderRadius: 8, padding: '12px 14px' }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8, marginBottom: 8 }}>
      <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>Description</label>
        <input value={form.description} onChange={e => setForm((p: any) => ({ ...p, description: e.target.value }))} style={inputSt} /></div>
      <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>Length (mm)*</label>
        <input type="number" value={form.length_mm} onChange={e => setForm((p: any) => ({ ...p, length_mm: e.target.value }))} style={inputSt} /></div>
      <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>Width (mm)*</label>
        <input type="number" value={form.width_mm} onChange={e => setForm((p: any) => ({ ...p, width_mm: e.target.value }))} style={inputSt} /></div>
      <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>Height (mm)*</label>
        <input type="number" value={form.height_mm} onChange={e => setForm((p: any) => ({ ...p, height_mm: e.target.value }))} style={inputSt} /></div>
      <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>Gross kg*</label>
        <input type="number" value={form.gross_weight_kg} onChange={e => setForm((p: any) => ({ ...p, gross_weight_kg: e.target.value }))} style={inputSt} /></div>
      <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>Net kg</label>
        <input type="number" value={form.net_weight_kg} onChange={e => setForm((p: any) => ({ ...p, net_weight_kg: e.target.value }))} style={inputSt} /></div>
    </div>
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginBottom: 4 }}>
      <input type="checkbox" checked={form.is_dangerous_goods} onChange={e => setForm((p: any) => ({ ...p, is_dangerous_goods: e.target.checked }))} />
      <span style={{ color: col }}>Dangerous goods</span>
    </label>
    {form.is_dangerous_goods && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>DG Class</label>
          <input value={form.dg_class} onChange={e => setForm((p: any) => ({ ...p, dg_class: e.target.value }))} style={inputSt} /></div>
        <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>UN Number</label>
          <input value={form.dg_un_number} onChange={e => setForm((p: any) => ({ ...p, dg_un_number: e.target.value }))} style={inputSt} /></div>
      </div>
    )}
    {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{error}</div>}
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={onCancel} style={{ padding: '5px 14px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
      <button onClick={onSave} disabled={saving} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
        {saving ? 'Saving…' : mode === 'add' ? 'Add Package' : 'Save'}
      </button>
    </div>
  </div>
)

// ─── DOCUMENTS TAB ───────────────────────────────────────────
const DOC_TYPES = ['Commercial Invoice','Packing List','Bill of Lading','Airway Bill','Certificate of Origin','Insurance Certificate','Dangerous Goods Declaration','Customs Entry','Other']

const DocumentsTab = ({ dark, scn, onRefresh, addToast }: {
  dark: boolean; scn: SCNDetail; onRefresh: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd  = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'
  const inputSt: React.CSSProperties = {
    fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd,
    background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%',
  }

  const [showUpload, setShowUpload] = useState(false)
  const [docType, setDocType] = useState(DOC_TYPES[0])
  const [docNotes, setDocNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const uploadDoc = async () => {
    if (!file) return setUploadError('Please select a file')
    setUploading(true); setUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('document_type', docType)
      if (docNotes) fd.append('notes', docNotes)
      await axios.post(`${API}/logistics/scn/${scn.id}/documents`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setShowUpload(false); setFile(null); setDocNotes('')
      addToast('success', 'Document uploaded'); onRefresh()
    } catch (e: any) {
      setUploadError(e.response?.data?.error || 'Upload failed')
    } finally { setUploading(false) }
  }

  const deleteDoc = async (docId: number) => {
    try {
      await axios.delete(`${API}/logistics/scn/${scn.id}/documents/${docId}`)
      addToast('success', 'Document deleted'); onRefresh()
    } catch (_) { addToast('error', 'Failed to delete document') }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: col }}>{scn.documents?.length || 0} documents</span>
        <button onClick={() => setShowUpload(true)}
          style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          + Upload Document
        </button>
      </div>

      {showUpload && (
        <div style={{ background: dark ? '#162032' : '#f0f9ff', border: `1px solid rgba(37,99,235,0.3)`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Document Type *</label>
            <select value={docType} onChange={e => setDocType(e.target.value)} style={inputSt}>
              {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>File *</label>
            <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} style={{ fontSize: 12, color: col }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Notes</label>
            <input value={docNotes} onChange={e => setDocNotes(e.target.value)} placeholder="Optional notes" style={inputSt} />
          </div>
          {uploadError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{uploadError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setShowUpload(false); setUploadError('') }}
              style={{ padding: '6px 14px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button onClick={uploadDoc} disabled={uploading}
              style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      )}

      {(scn.documents?.length || 0) === 0 && !showUpload ? (
        <div style={{ textAlign: 'center', padding: 40, color: sub }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
          <div>No documents uploaded yet.</div>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: theadBg, borderBottom: bd }}>
              {['Type','File Name','Uploaded By','Date','Notes','Actions'].map(h => (
                <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(scn.documents || []).map(d => (
              <tr key={d.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                <td style={{ padding: '7px 10px' }}>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'rgba(37,99,235,0.1)', color: '#2563eb' }}>{d.document_type}</span>
                </td>
                <td style={{ padding: '7px 10px', color: col }}>{d.file_name || '—'}</td>
                <td style={{ padding: '7px 10px', color: sub }}>{d.uploaded_by_name || '—'}</td>
                <td style={{ padding: '7px 10px', color: sub, whiteSpace: 'nowrap' }}>{fmtFull(d.uploaded_at)}</td>
                <td style={{ padding: '7px 10px', color: sub }}>{d.notes || '—'}</td>
                <td style={{ padding: '7px 10px' }}>
                  <button onClick={() => deleteDoc(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14 }}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── TIMELINE TAB ────────────────────────────────────────────
const TimelineTab = ({ dark, scn }: { dark: boolean; scn: SCNDetail }) => {
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'

  // Merge status_log + date_changes into a single feed sorted by date desc
  type TEntry = { id: string; type: 'status'|'date'; date: string; label: string; sub: string; color: string }
  const entries: TEntry[] = []

  ;(scn.status_log || []).forEach(e => {
    const ds = STATUS_CONFIG[e.to_status] || { label: e.to_status, color: '#64748b' }
    entries.push({
      id: `s-${e.id}`,
      type: 'status',
      date: e.changed_at,
      label: `Status → ${ds.label}`,
      sub: [e.changed_by_name, e.notes].filter(Boolean).join(' · '),
      color: STATUS_BAR_COLOR[e.to_status] || '#64748b',
    })
  })

  ;(scn.date_changes || []).forEach(e => {
    const fmtDate = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-AU') : '—'
    entries.push({
      id: `d-${e.id}`,
      type: 'date',
      date: e.created_at,
      label: `${e.field_name.toUpperCase()} changed: ${fmtDate(e.old_value)} → ${fmtDate(e.new_value)}`,
      sub: [e.changed_by_name, e.change_reason].filter(Boolean).join(' · '),
      color: '#d97706',
    })
  })

  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  if (entries.length === 0) {
    return <div style={{ textAlign: 'center', padding: 40, color: sub }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
      <div>No timeline events recorded yet.</div>
    </div>
  }

  return (
    <div style={{ paddingLeft: 8 }}>
      {entries.map((e, i) => (
        <div key={e.id} style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          {/* Line + dot */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: e.color, flexShrink: 0, marginTop: 3 }} />
            {i < entries.length - 1 && <div style={{ width: 2, flex: 1, background: `${e.color}40`, marginTop: 4 }} />}
          </div>
          {/* Content */}
          <div style={{ flex: 1, paddingBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 2 }}>{e.label}</div>
            <div style={{ fontSize: 11, color: sub, marginBottom: 2 }}>{fmtFull(e.date)}</div>
            {e.sub && <div style={{ fontSize: 11, color: sub, fontStyle: 'italic' }}>{e.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── STATUS UPDATE MODAL ─────────────────────────────────────
const StatusUpdateModal = ({ dark, scn, onClose, onSaved, addToast }: {
  dark: boolean; scn: SCNDetail; onClose: () => void
  onSaved: () => void; addToast: (t: 'success'|'error', m: string) => void
}) => {
  const validNext = NEXT_VALID[scn.display_status] || []
  const [newStatus, setNewStatus] = useState(validNext[0] || '')
  const [notes, setNotes] = useState('')
  const [proofOfCustody, setProofOfCustody] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const inputSt: React.CSSProperties = {
    fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd,
    background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%',
  }

  const sc = STATUS_CONFIG[scn.display_status] || STATUS_CONFIG.pending_pickup

  const handleSave = async () => {
    if (!newStatus) return setError('Select a new status')
    setSaving(true); setError('')
    try {
      await axios.put(`${API}/logistics/scn/${scn.id}/status`, {
        status: newStatus, notes: notes || null, proof_of_custody: proofOfCustody,
      })
      addToast('success', `SCN status updated to ${STATUS_CONFIG[newStatus]?.label || newStatus}`)
      onSaved()
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to update status')
    } finally { setSaving(false) }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 5000 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        background: cardBg, border: bd, borderRadius: 12, padding: 28, width: 420, maxWidth: '90vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)', zIndex: 5001, fontFamily: 'IBM Plex Sans, sans-serif',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: col, marginBottom: 16 }}>Update SCN Status</div>

        {/* Current */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Current status</label>
          <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: sc.bg, color: sc.color, fontWeight: 600 }}>{sc.label}</span>
        </div>

        {/* New status */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>New status *</label>
          <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={inputSt}>
            {validNext.map(s => (
              <option key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</option>
            ))}
          </select>
        </div>

        {/* Delivered: proof of custody */}
        {newStatus === 'delivered' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 14 }}>
            <input type="checkbox" checked={proofOfCustody} onChange={e => setProofOfCustody(e.target.checked)} />
            <span style={{ color: col }}>Proof of custody captured</span>
          </label>
        )}

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Any notes about this status change..."
            style={{ ...inputSt, resize: 'vertical' }} />
        </div>

        {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !newStatus}
            style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Updating…' : 'Update Status'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── EXPORTED (wraps with ToastProvider) ─────────────────────
export const LogisticsScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider>
    <LogisticsScreenInner {...props} />
  </ToastProvider>
)
