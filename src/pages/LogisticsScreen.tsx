// ─── LOGISTICS SCREEN ─────────────────────────────────────────
// SCN Register with pipeline status bar, filterable table, and
// SCNDetailModal for full shipment detail (overview/packages/docs/timeline).
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'   // modals portal to document.body — see App.tsx zoom wrapper
import { useExpand, ExpandBtn } from '../components/ExpandToggle'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'
import { MilestoneLegend } from '../components/MilestoneLegend'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ScopeBanner } from '../components/ScopeBanner'
import { Pager } from '../components/Pager'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'
import { HelpButton } from '../components/HelpDrawer'
import { LOGISTICS_HELP } from '../helpContent'

// Resizable column defaults — SCN register (13 cols), seeded from the prior fixed widths.
const LOG_W   = [40, 110, 100, 130, 120, 160, 90, 100, 100, 60, 90, 130, 50]
const LOG_MIN = [36, 80, 70, 90, 80, 100, 60, 70, 70, 50, 60, 90, 40]
import { usePagedList } from '../hooks/usePagedList'

import { API } from '../lib/api'

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
  packed_by_type?: 'internal'|'vendor'|'forwarder' | null
  packaging_status?: 'pending'|'complete' | null; packaging_delegated_to?: number | null
}
interface PipelineCounts {
  pending_pickup: number; in_transit: number; customs_review: number
  pending_delivery: number; delivered: number; total: number
}
interface SCNDetail extends SCNRow {
  atd?: string | null; ata?: string | null
  customs_cleared?: number; customs_cleared_date?: string | null
  bl_number?: string | null; container_ref?: string | null; notes?: string | null
  forwarder_notified: number; forwarder_user_id?: number | null
  // D5: forwarder-delegated packaging
  packed_by_type?: 'internal'|'vendor'|'forwarder' | null
  packaging_delegated_to?: number | null; packaging_status?: 'pending'|'complete' | null
  packaging_completed_at?: string | null; forwarder_user_name?: string | null
  po_id?: number | null; vendor_display?: string | null
  lines: POLine[]; additional_items: any[]; packages: Package[]
  scn_lines?: ScnLineAlloc[]   // Stage 4: per-SCN line allocation (qty on SCN + packed)
  documents: Doc[]; status_log: StatusLogEntry[]; date_changes: DateChange[]
  etd_change_count?: number; eta_change_count?: number
}
interface POLine { id: number; line_number: string; description: string; qty: number | null; qty_assigned: number | null; uom: string }
interface Package {
  id: number; scn_id: number; package_number: string; description?: string | null
  parent_package_id?: number | null   // Q2: nesting — set when this is a sub-package of a container
  container_type_id?: number | null   // Q4: ISO container type when this package is a typed container
  container_no?: string | null; seal_no?: string | null   // Q4: container identifier + governed seal
  length_mm?: number | null; width_mm?: number | null; height_mm?: number | null
  gross_weight_kg?: number | null; net_weight_kg?: number | null
  is_dangerous_goods: number; dg_class?: string | null; dg_un_number?: string | null
  marks_numbers?: string | null
  contents?: PkgContentView[]   // Stage 4: declared packing-list contents for this box
}

// ─── Q2 PACKAGE TREE ──────────────────────────────────────────
// Orders a flat package list depth-first (container → sub-packages) for display,
// tagging each row with its nesting depth + whether it's a container (has children).
// Orphans (parent not in the set) fall back to top-level — never dropped.
function orderPackagesTree<T extends { id: number; parent_package_id?: number | null }>(packages: T[]) {
  const byParent = new Map<string, T[]>()
  packages.forEach(p => {
    const k = p.parent_package_id == null ? 'root' : String(p.parent_package_id)
    ;(byParent.get(k) || byParent.set(k, []).get(k)!).push(p)
  })
  const out: { pkg: T; depth: number; isContainer: boolean }[] = []
  const seen = new Set<number>()
  const walk = (key: string, depth: number) => {
    (byParent.get(key) || []).forEach(p => {
      if (seen.has(p.id)) return
      seen.add(p.id)
      out.push({ pkg: p, depth, isContainer: byParent.has(String(p.id)) })
      walk(String(p.id), depth + 1)
    })
  }
  walk('root', 0)
  packages.forEach(p => { if (!seen.has(p.id)) out.push({ pkg: p, depth: 0, isContainer: byParent.has(String(p.id)) }) })
  return out
}
interface PkgContentView { scn_line_id: number; qty: number | string; uom?: string | null; label: string; kind?: string }
interface ScnLineAlloc { id: number; po_line_id?: number | null; additional_item_id?: number | null; qty: number | string; uom?: string | null; line_number?: string | null; po_description?: string | null; ai_description?: string | null; packed_qty: number | string }
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
// Full-text expansions shown on hover over the abbreviated column headers.
const HEAD_TITLE: Record<string, string> = {
  SCN: 'Shipment Control Note', PO: 'Purchase Order', ETD: 'Estimated Time of Departure',
  ETA: 'Estimated Time of Arrival', PKGS: 'Packages', RAG: 'Red / Amber / Green status',
}

const NEXT_VALID: Record<string, string[]> = {
  pending_pickup: ['in_transit'],
  in_transit: ['customs_review'],   // arrival always enters customs review first
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
  const [packagingFilter, setPackagingFilter] = useState<string | null>(null)   // D5: pending/complete packing

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
    if (packagingFilter)        params.packaging     = packagingFilter
    const { data } = await axios.get(`${API}/logistics/register/${projectId}`, { params })
    setPipeline(data.pipeline_counts)
    return { data: (data.data ?? []) as SCNRow[], total: (data.total ?? 0) as number }
  }, [projectId, statusFilter, debouncedSearch, criticalOnly, modeFilter, arrivalDays, packagingFilter])

  const {
    data: scns, total, page, setPage, setPageSize, pageSize, loading,
    sortCol, sortDir, toggleSort, reload,
  } = usePagedList<SCNRow>({
    fetcher, deps: [projectId, statusFilter, debouncedSearch, criticalOnly, modeFilter, arrivalDays, packagingFilter],
    pageSize: 50, initialSortCol: 'created_at', initialSortDir: 'desc',
  })
  const sortArrow = (k: string) => sortCol === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const rt = useResizableTable('logistics_scn', LOG_W, LOG_MIN)

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
          <BackButton onFallback={onBack} dark={dark} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!isForwarder && <button onClick={exportCSV} style={{ ...inputSt, cursor: 'pointer', width: 'auto' }}>↓ Export</button>}
          <HelpButton screenName="Logistics" sections={LOGISTICS_HELP} dark={dark} />
        </div>
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
          {/* D5: delegated-packaging filter — for a forwarder this is "delegated to me,
              pending packing" (server already scopes to their SCNs); for internal roles a review queue. */}
          <button onClick={() => setPackagingFilter(v => v === 'pending' ? null : 'pending')}
            title="Show SCNs awaiting packing (delegated)"
            style={{ ...inputSt, cursor: 'pointer', color: packagingFilter === 'pending' ? '#7c3aed' : sub, borderColor: packagingFilter === 'pending' ? '#7c3aed' : undefined, width: 'auto' }}>
            📦 {packagingFilter === 'pending' ? 'Pending packing' : 'Packing'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: sub }}>
            Arriving within
            <input type="number" value={arrivalDays} onChange={e => setArrivalDays(e.target.value)}
              placeholder="—" min="1" max="365"
              style={{ ...inputSt, width: 55, textAlign: 'center' }} />
            days
          </div>
          <div style={{ fontSize: 11, color: sub }}>{total} result{total !== 1 ? 's' : ''}</div>
          <ResetColumnsButton onClick={rt.resetWidths} dark={dark} style={{ marginLeft: 'auto' }} />
        </div>

        {/* ── TABLE ─────────────────────────────────────────── */}
        <div style={{ background: cardBg, border: bd, borderRadius: 8 }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
            <table className="app-grid" style={{ ...rt.tableStyle, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                <tr style={{ borderBottom: bd }}>
                  {([['★','40px'],['SCN','110px','scn_ref'],['PO','100px'],['VENDOR','130px','vendor'],['FORWARDER','120px','forwarder'],
                    ['ROUTE','160px','origin'],['MODE','90px','mode'],['ETD','100px','etd'],['ETA','100px','eta'],
                    ['PKGS','60px'],['WEIGHT','90px'],['STATUS','130px','status'],['RAG','50px']] as [string,string,string?][]).map(([h,w,key], i) => (
                    <th key={h} onClick={key ? () => toggleSort(key) : undefined} title={HEAD_TITLE[h] || undefined}
                      style={{ ...rt.thStyle(i), padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: key ? 'pointer' : 'default', userSelect: 'none' }}>
                      {h}{key ? sortArrow(key) : ''}
                      {rt.handle(i, dark)}
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
                      <td data-col="ctr" style={{ padding: '8px 10px' }} onClick={e => toggleCritical(scn, e)}>
                        <span style={{ cursor: 'pointer', color: scn.is_critical_path ? '#E84E0F' : '#cbd5e1', fontSize: 14 }}>★</span>
                      </td>
                      <td data-col="ctr" style={{ padding: '8px 10px' }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{scn.scn_ref}</span>
                      </td>
                      <td data-col="ctr" style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{scn.po_ref || '—'}</td>
                      <td data-align="left" style={{ padding: '8px 10px', color: col, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={scn.vendor_name || ''}>{scn.vendor_name || '—'}</td>
                      <td data-col="lmid27" style={{ padding: '8px 10px', color: sub, fontSize: 11 }}>{scn.forwarder_name || '—'}</td>
                      <td data-align="left" style={{ padding: '8px 10px', fontSize: 11, color: sub }}>
                        <span style={{ color: col }}>{scn.origin_location || '—'}</span>
                        {scn.destination_name && <><span style={{ margin: '0 4px', color: '#E84E0F' }}>→</span><span>{scn.destination_name}</span></>}
                      </td>
                      <td data-col="lmid22" style={{ padding: '8px 10px', fontSize: 12 }}>
                        {scn.mode ? <span title={scn.mode}>{MODE_ICON[scn.mode] || '?'} <span style={{ color: sub, fontSize: 10, textTransform: 'capitalize' }}>{scn.mode}</span></span> : '—'}
                      </td>
                      <td data-col="ctr" style={{ padding: '8px 10px', color: sub, fontSize: 11 }}>{fmt(scn.etd)}</td>
                      <td data-col="ctr" style={{ padding: '8px 10px', fontSize: 11, color: etaColour(scn.eta) || col, fontWeight: etaColour(scn.eta) ? 600 : undefined }}>{fmt(scn.eta)}</td>
                      <td data-col="ctr" style={{ padding: '8px 10px', textAlign: 'center', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{scn.total_packages ?? '—'}</td>
                      <td data-col="lmid22" style={{ padding: '8px 10px', color: sub, fontSize: 11 }}>{fmtW(scn.total_weight_kg)}</td>
                      <td data-align="center" data-col="status" style={{ padding: '8px 10px' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: sc.bg, color: sc.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{sc.label}</span>
                      </td>
                      <td data-col="ctr" style={{ padding: '8px 10px' }}>
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

        <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* ── LOADING OVERLAY ────────────────────────────────── */}
      {detailLoading && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000 }}>
          <div style={{ background: cardBg, borderRadius: 12, padding: '20px 32px', color: col }}>Loading SCN…</div>
        </div>,
        document.body,
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
// ─── PROOF-OF-CUSTODY FORM (client-side print-to-PDF) ─────────
// Mirrors ReportsScreen's printReport(): opens a window, writes a self-contained
// HTML doc with @media print, and prints. No PDF dependency. The form is PRE-FILLED
// from the already-loaded SCN detail, with BLANK areas for offline signing (vendor
// release + forwarder acknowledgement + condition + notes). The signed copy is then
// scanned and uploaded back via the PoC tab.
function printPoC(scn: SCNDetail) {
  const w = window.open('', '_blank', 'width=900,height=760')
  if (!w) return
  const esc = (s: any) => String(s == null || s === '' ? '—' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
  const date = (s: any) => (s ? String(s).slice(0, 10) : '—')
  const any = scn as any
  const field = (label: string, val: any) => `<div class="f"><span class="k">${label}</span><span class="v">${esc(val)}</span></div>`

  const pkgRows = (scn.packages || []).map(p =>
    `<tr><td>${esc(p.package_number)}</td><td>${esc(p.description)}</td>` +
    `<td>${[p.length_mm, p.width_mm, p.height_mm].every(d => d != null) ? `${p.length_mm}×${p.width_mm}×${p.height_mm}` : '—'}</td>` +
    `<td style="text-align:right">${p.gross_weight_kg ?? '—'}</td><td>${p.is_dangerous_goods ? `DG ${esc(p.dg_class || '')}` : '—'}</td></tr>`).join('')
  const lineRows = (scn.lines || []).map(l =>
    `<tr><td>${esc(l.line_number)}</td><td>${esc(l.description)}</td><td style="text-align:right">${l.qty ?? '—'}</td><td>${esc(l.uom)}</td></tr>`).join('')

  // Blank signing block: a labelled box with a ruled signature line + name/company/date.
  const sigBlock = (title: string) => `
    <div class="sig">
      <div class="sigt">${title}</div>
      <div class="sigrow"><span class="sk">Name</span><span class="line"></span></div>
      <div class="sigrow"><span class="sk">Company</span><span class="line"></span></div>
      <div class="sigrow"><span class="sk">Signature</span><span class="line tall"></span></div>
      <div class="sigrow"><span class="sk">Date</span><span class="line"></span></div>
    </div>`

  w.document.write(`<!doctype html><html><head><title>Proof of Custody — ${esc(scn.scn_ref)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:28px;font-size:12px}
    h1{font-size:18px;margin:0 0 2px;color:#E84E0F} .sub{color:#64748b;font-size:12px;margin:0 0 14px}
    h2{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#334155;margin:18px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px}
    .f{display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px dotted #e2e8f0}
    .k{color:#64748b} .v{color:#0f172a;font-weight:600;text-align:right}
    table{border-collapse:collapse;width:100%;font-size:11px;margin-top:4px} th{background:#E84E0F;color:#fff;padding:5px 8px;text-align:left}
    td{padding:4px 8px;border-bottom:1px solid #e2e8f0}
    .cond{display:flex;gap:24px;margin:8px 0} .cond label{display:flex;align-items:center;gap:6px} .box{width:14px;height:14px;border:1.5px solid #334155;display:inline-block}
    .sigwrap{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:8px}
    .sig{border:1px solid #cbd5e1;border-radius:6px;padding:12px} .sigt{font-weight:700;margin-bottom:10px;color:#0f172a}
    .sigrow{display:flex;align-items:flex-end;gap:8px;margin-bottom:12px} .sk{color:#64748b;width:64px;flex-shrink:0}
    .line{flex:1;border-bottom:1px solid #94a3b8;height:14px} .line.tall{height:34px}
    .notes{border:1px solid #cbd5e1;border-radius:6px;height:60px;margin-top:6px}
    .meta{color:#94a3b8;font-size:10px;margin-top:18px}
    @media print{.noprint{display:none}}
  </style></head><body>
    <h1>QCO MMS — Proof of Custody</h1>
    <p class="sub">Transfer of Custody, Care &amp; Control · SCN ${esc(scn.scn_ref)}</p>

    <h2>Shipment</h2>
    <div class="grid">
      ${field('SCN Ref', scn.scn_ref)}${field('PO Ref', scn.po_ref)}
      ${field('Vendor', scn.vendor_display || any.vendor_name)}${field('Forwarder', scn.forwarder_name)}
      ${field('Mode', scn.mode)}${field('Incoterms', scn.incoterms)}
      ${field('Origin', scn.origin_location)}${field('Destination', scn.destination_name || scn.destination_code)}
      ${field('Pickup contact', any.pickup_contact_name)}${field('Pickup phone', any.pickup_contact_phone)}
      ${field('Total packages', scn.total_packages)}${field('Total weight (kg)', scn.total_weight_kg)}
    </div>

    <h2>Dates</h2>
    <div class="grid">
      ${field('Cargo ready', date(any.cargo_ready_date))}${field('Cargo collection', date(any.cargo_collection_date))}
      ${field('ETD', date(scn.etd))}${field('ATD', date(scn.atd))}
      ${field('ETA', date(scn.eta))}${field('ATA', date(scn.ata))}
      ${field('Customs cleared', date(scn.customs_cleared_date))}${field('Mode of transfer', scn.mode)}
    </div>

    <h2>Packages</h2>
    <table><thead><tr><th>Pkg</th><th>Description</th><th>Dims (mm)</th><th style="text-align:right">Gross kg</th><th>DG</th></tr></thead>
      <tbody>${pkgRows || '<tr><td colspan="5">No packages recorded</td></tr>'}</tbody></table>

    <h2>PO Lines</h2>
    <table><thead><tr><th>Line</th><th>Description</th><th style="text-align:right">Qty</th><th>UOM</th></tr></thead>
      <tbody>${lineRows || '<tr><td colspan="4">No lines assigned</td></tr>'}</tbody></table>

    <h2>Condition at handover</h2>
    <div class="cond">
      <label><span class="box"></span> Good</label>
      <label><span class="box"></span> Damaged</label>
      <label><span class="box"></span> Incomplete</label>
    </div>

    <h2>Signatures</h2>
    <div class="sigwrap">${sigBlock('Vendor release')}${sigBlock('Forwarder acknowledgement')}</div>

    <h2>Notes</h2>
    <div class="notes"></div>

    <p class="meta">Generated ${new Date().toLocaleString()} · Print or Save as PDF, sign offline, then upload the signed copy in the Proof of Custody tab.</p>
    <button class="noprint" onclick="window.print()" style="margin-top:16px;padding:8px 16px;background:#E84E0F;color:#fff;border:none;border-radius:6px;cursor:pointer">Print / Save as PDF</button>
  </body></html>`)
  w.document.close()
  setTimeout(() => w.print(), 400)
}

// ─── TAB LABELS ──────────────────────────────────────────────
const TAB_LABELS: Record<string, string> = {
  overview: 'Overview', packages: 'Packages', documents: 'Documents',
  timeline: 'Timeline', poc: 'Proof of Custody',
}

// Exported so the Expediting PO "Line Items & SCNs" tab can reuse the exact SCN
// detail (Documents/PoC upload included) without rebuilding it. readOnlyManagement
// hides the logistics-team write actions (status change, package add/edit/delete)
// when opened from the PO context — Documents/PoC upload stays fully functional
// (the scoped carve-out lets a logistics-viewer upload).
export const SCNDetailModal = ({ dark, scn, onClose, onRefresh, addToast, projectId, readOnlyManagement = false, zIndex = 4000 }: {
  dark: boolean; scn: SCNDetail; onClose: () => void
  onRefresh: () => void; addToast: (t: 'success'|'error', m: string) => void
  projectId: number; readOnlyManagement?: boolean
  // Base stacking level (scrim = zIndex, panel = zIndex+1). Default 4000 for Logistics;
  // raise it when opened above a higher-stacked host (e.g. the Expediting PO drawer at 8001).
  zIndex?: number
}) => {
  const [tab, setTab] = useState<'overview'|'packages'|'documents'|'timeline'|'poc'>('overview')
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [expanded, toggleExpand] = useExpand()

  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  const sc = STATUS_CONFIG[scn.display_status] || STATUS_CONFIG.pending_pickup
  const rag = scn.rag || 'green'

  return createPortal(
    <>
      {/* Scrim */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex }} />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: expanded ? '95vw' : 720, maxWidth: '95vw',
        background: cardBg, borderLeft: bd, zIndex: zIndex + 1,
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
              {!readOnlyManagement && NEXT_VALID[scn.display_status]?.length > 0 && (
                <button onClick={() => setShowStatusModal(true)}
                  style={{ padding: '6px 14px', borderRadius: 6, background: scn.display_status === 'in_transit' ? '#0ea5e9' : '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {scn.display_status === 'in_transit' ? '📍 Confirm arrival' : 'Update Status'}
                </button>
              )}
              <ExpandBtn expanded={expanded} onToggle={toggleExpand} color={sub} />
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer', padding: '2px 6px' }}>✕</button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: bd, background: cardBg, flexShrink: 0 }}>
          {(['overview','packages','documents','timeline','poc'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: tab === t ? 600 : 400,
                color: tab === t ? '#E84E0F' : sub,
                borderBottom: tab === t ? '2px solid #E84E0F' : '2px solid transparent',
                fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}>{TAB_LABELS[t]}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {tab === 'overview' && <OverviewTab dark={dark} scn={scn} onRefresh={onRefresh} addToast={addToast} />}
          {tab === 'packages' && <PackagesTab dark={dark} scn={scn} onRefresh={onRefresh} addToast={addToast} readOnly={readOnlyManagement} />}
          {tab === 'documents' && <DocumentsTab dark={dark} scn={scn} onRefresh={onRefresh} addToast={addToast} />}
          {tab === 'timeline' && <TimelineTab dark={dark} scn={scn} />}
          {tab === 'poc' && <PocTab dark={dark} scn={scn} projectId={projectId} onRefresh={onRefresh} addToast={addToast} />}
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
    </>,
    document.body,
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

  const [editingDate, setEditingDate] = useState<'crd'|'ccd'|'etd'|'eta'|null>(null)
  const [editCrd, setEditCrd] = useState((scn as any).cargo_ready_date ? (scn as any).cargo_ready_date.slice(0,10) : '')
  const [editCcd, setEditCcd] = useState((scn as any).cargo_collection_date ? (scn as any).cargo_collection_date.slice(0,10) : '')
  const [editEtd, setEditEtd] = useState(scn.etd ? scn.etd.slice(0,10) : '')
  const [editEta, setEditEta] = useState(scn.eta ? scn.eta.slice(0,10) : '')
  const [dateReason, setDateReason] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [dateError, setDateError] = useState('')
  const [etdHistOpen, setEtdHistOpen] = useState(false)
  const [etaHistOpen, setEtaHistOpen] = useState(false)

  const etdChanges = scn.date_changes?.filter(d => d.field_name === 'etd') || []
  const etaChanges = scn.date_changes?.filter(d => d.field_name === 'eta') || []
  // Open the shared date editor pre-filled with the current values.
  const openDateEdit = (which: 'crd'|'ccd'|'etd'|'eta') => {
    setEditCrd((scn as any).cargo_ready_date ? (scn as any).cargo_ready_date.slice(0,10) : '')
    setEditCcd((scn as any).cargo_collection_date ? (scn as any).cargo_collection_date.slice(0,10) : '')
    setEditEtd(scn.etd ? scn.etd.slice(0,10) : '')
    setEditEta(scn.eta ? scn.eta.slice(0,10) : '')
    setDateReason(''); setDateError(''); setEditingDate(which)
  }

  const saveDate = async () => {
    if (!dateReason.trim()) { setDateError('Reason is required'); return }
    setSavingDate(true); setDateError('')
    try {
      await axios.put(`${API}/logistics/scn/${scn.id}/dates`, {
        crd: editCrd || null, ccd: editCcd || null, etd: editEtd || null, eta: editEta || null, reason: dateReason.trim(),
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
  const packedByLabel = scn.packed_by_type === 'forwarder' ? `Freight forwarder${scn.forwarder_user_name ? ` (${scn.forwarder_user_name})` : ''}`
    : scn.packed_by_type === 'vendor' ? 'Vendor' : 'Internal'
  const metaRight: [string, any][] = [
    ['Total Packages',   scn.total_packages ?? '—'],
    ['Total Weight',     fmtW(scn.total_weight_kg)],
    ['DG Goods',         scn.packages?.some((p: Package) => p.is_dangerous_goods) ? '⚠️ Yes' : 'No'],
    ['Packed by',        packedByLabel],
    // D5: hand-back status, only meaningful for delegated packaging.
    ...(scn.packaging_status ? [['Packaging', scn.packaging_status === 'complete'
        ? `✓ Complete${scn.packaging_completed_at ? ` · ${String(scn.packaging_completed_at).slice(0, 10)}` : ''}`
        : '⏳ Pending'] as [string, any]] : []),
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

          {/* Cargo Ready Date (CRD) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, alignItems: 'center' }}>
            <span style={{ color: sub }} title="Cargo Ready Date">CRD</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: col }}>{fmt((scn as any).cargo_ready_date)}</span>
              <button onClick={() => openDateEdit('crd')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 12, padding: 0 }}>✎</button>
            </span>
          </div>

          {/* Cargo Collection Date (CCD) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, alignItems: 'center' }}>
            <span style={{ color: sub }} title="Cargo Collection Date">CCD</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: col }}>{fmt((scn as any).cargo_collection_date)}</span>
              <button onClick={() => openDateEdit('ccd')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 12, padding: 0 }}>✎</button>
            </span>
          </div>

          {/* ETD row with edit */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, alignItems: 'center' }}>
            <span style={{ color: sub }} title="Estimated Time of Departure">ETD</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: col }}>{fmt(scn.etd)}</span>
              <button onClick={() => openDateEdit('etd')}
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
            <span style={{ color: sub }} title="Estimated Time of Arrival">ETA</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: etaColour(scn.eta) || col, fontWeight: etaColour(scn.eta) ? 600 : undefined }}>{fmt(scn.eta)}</span>
              <button onClick={() => openDateEdit('eta')}
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

          {/* ATA — actual arrival at destination (stamped on entering customs review) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, alignItems: 'center' }}>
            <span style={{ color: sub }} title="Actual Time of Arrival at destination">ATA</span>
            <span style={{ color: scn.ata ? col : sub }}>{scn.ata ? fmt(scn.ata) : 'Not arrived'}</span>
          </div>

          {/* Customs clearance status — awareness if a shipment is stuck at customs */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, alignItems: 'center' }}>
            <span style={{ color: sub }}>Customs</span>
            {scn.customs_cleared ? (
              <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ Cleared{scn.customs_cleared_date ? ` · ${fmt(scn.customs_cleared_date)}` : ''}</span>
            ) : scn.display_status === 'customs_review' ? (
              <span style={{ color: '#d97706', fontWeight: 600 }}>⏳ In customs review</span>
            ) : (
              <span style={{ color: sub }}>—</span>
            )}
          </div>
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
          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 12 }}>Edit shipment dates</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>CRD — Cargo Ready Date</label>
              <input type="date" value={editCrd} onChange={e => setEditCrd(e.target.value)} style={inputSt} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>CCD — Cargo Collection Date</label>
              <input type="date" value={editCcd} onChange={e => setEditCcd(e.target.value)} style={inputSt} />
            </div>
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
                {([['Line #','left'],['Description','left'],['Qty','right'],['Assigned','right'],['UOM','left']] as [string, 'left'|'right'][]).map(([h, align]) => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: align, textIndent: h === 'UOM' ? '5%' : undefined, fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>
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
                  <td style={{ padding: '6px 10px', color: sub, textIndent: '5%' }}>{l.uom}</td>
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
          {scn.additional_items.map((it: any) => {
            // Parent-linked off-PO variation (wizard-created) vs legacy unlinked item.
            const isVariation = !!(it.is_variation || it.parent_po_line_id)
            return (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: dark ? '#162032' : '#f8fafc', borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                {isVariation ? (
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 6, background: 'rgba(245,158,11,0.12)', color: '#d97706' }}>⚠ Off-PO variation</span>
                ) : (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }}>Additional item</span>
                )}
                <span style={{ color: col }}>{it.description}</span>
                {it.qty && <span style={{ color: sub }}>{it.qty} {it.uom}</span>}
                {/* Parent-line label — only when the join resolved a parent (graceful for legacy/deleted) */}
                {isVariation && it.parent_line_number != null && (
                  <span style={{ color: sub, fontStyle: 'italic' }}>
                    for: Line {it.parent_line_number}{it.parent_description ? ` — ${it.parent_description}` : ''}
                  </span>
                )}
              </div>
            )
          })}
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
const PackagesTab = ({ dark, scn, onRefresh, addToast, readOnly = false }: {
  dark: boolean; scn: SCNDetail; onRefresh: () => void
  addToast: (t: 'success'|'error', m: string) => void
  readOnly?: boolean   // hide package write controls (Add/edit/delete) — e.g. PO context
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  const emptyForm = { description: '', length_mm: '', width_mm: '', height_mm: '', gross_weight_kg: '', net_weight_kg: '', is_dangerous_goods: false, dg_class: '', dg_un_number: '', marks_numbers: '',
    container_type_id: '' as number | '', parent_package_id: '' as number | '', container_no: '', seal_no: '', seal_reason: '' }
  const [adding, setAdding] = useState(false)
  // D5.1 container-first: how the add form was opened — 'container' (top-level typed),
  // 'loose' (top-level leaf), or 'sub' (leaf nested into a specific container).
  const [addKind, setAddKind] = useState<'container'|'loose'|'sub'>('loose')
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [editingId, setEditingId] = useState<number|null>(null)
  const [originalSeal, setOriginalSeal] = useState('')   // Q4.3: detect a seal CHANGE → require reason
  const [containerTypes, setContainerTypes] = useState<{ id: number; code: string; description: string; inner_length_mm?: number; inner_width_mm?: number; inner_height_mm?: number; capacity_m3?: number | null }[]>([])
  useEffect(() => { axios.get(`${API}/logistics/container-types`).then(r => setContainerTypes(r.data || [])).catch(() => {}) }, [])
  const ctById = (id?: number | null) => containerTypes.find(c => c.id === id)
  // D5.1 container-first: open the add form in a given mode.
  const closeForm = () => { setAdding(false); setEditingId(null); setForm(emptyForm); setFormError(''); setOriginalSeal('') }
  const openAdd = (kind: 'container'|'loose'|'sub', parentId?: number) => {
    setEditingId(null); setAddKind(kind); setOriginalSeal('')
    setForm({ ...emptyForm, parent_package_id: parentId ?? '' }); setAdding(true)
  }
  // Q2: explicit delete-with-contents confirm for containers.
  const [confirmDel, setConfirmDel] = useState<{ id: number; childCount: number } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const inputSt: React.CSSProperties = {
    fontSize: 11, padding: '4px 7px', borderRadius: 5, border: bd,
    background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%',
  }

  const totalGross = scn.packages?.reduce((s, p) => s + (Number(p.gross_weight_kg) || 0), 0) || 0
  // Q2: tree-ordered packages (container → sub-packages) for display.
  const tree = orderPackagesTree(scn.packages || [])

  const savePackage = async () => {
    const isContainer = !!form.container_type_id
    // Dimensions required for ordinary packages only — a container's dims are display-only.
    if (!isContainer && (!form.length_mm || !form.width_mm || !form.height_mm || !form.gross_weight_kg))
      return setFormError('Dimensions and gross weight are required')
    // Q4.3 seal governance (client guard mirrors the backend): CHANGING an existing seal
    // requires a reason. First-set needs none. Backend enforces it regardless.
    const sealChanged = (form.seal_no || '').trim() !== (originalSeal || '').trim()
    if (sealChanged && (originalSeal || '').trim() && !(form.seal_reason || '').trim())
      return setFormError('Changing an existing seal number requires a reason.')
    setSaving(true); setFormError('')
    const payload: any = {
      description: form.description, length_mm: form.length_mm, width_mm: form.width_mm, height_mm: form.height_mm,
      gross_weight_kg: form.gross_weight_kg, net_weight_kg: form.net_weight_kg, is_dangerous_goods: form.is_dangerous_goods,
      dg_class: form.dg_class, dg_un_number: form.dg_un_number, marks_numbers: form.marks_numbers,
      container_no: form.container_no || undefined,
      seal_no: sealChanged ? (form.seal_no || '') : undefined,   // only send when changed (set-once governed)
      seal_reason: form.seal_reason || undefined,
    }
    if (!editingId) {   // container type + nesting are set at creation
      if (form.container_type_id) payload.container_type_id = form.container_type_id
      if (form.parent_package_id) payload.parent_package_id = form.parent_package_id
    }
    try {
      if (editingId) {
        await axios.put(`${API}/logistics/scn/${scn.id}/packages/${editingId}`, payload)
        addToast('success', 'Package updated')
      } else {
        await axios.post(`${API}/logistics/scn/${scn.id}/packages`, payload)
        addToast('success', isContainer ? 'Container added' : 'Package added')
      }
      setAdding(false); setEditingId(null); setForm(emptyForm); setOriginalSeal(''); onRefresh()
    } catch (e: any) {
      setFormError(e.response?.data?.error || 'Failed to save package')
    } finally { setSaving(false) }
  }

  // D5: forwarder/expeditor marks delegated packaging complete (hand-back).
  const [completing, setCompleting] = useState(false)
  const markComplete = async () => {
    setCompleting(true)
    try {
      await axios.put(`${API}/logistics/scn/${scn.id}/packaging/complete`)
      addToast('success', 'Packaging marked complete')
      onRefresh()
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to mark complete')
    } finally { setCompleting(false) }
  }

  // Q2: cascade only when explicitly confirmed (container + contents). The backend
  // default-denies a container delete with a 409, which we surface verbatim.
  const deletePackage = async (pkgId: number, cascade = false) => {
    setDeleting(true)
    try {
      await axios.delete(`${API}/logistics/scn/${scn.id}/packages/${pkgId}${cascade ? '?cascade=1' : ''}`)
      addToast('success', cascade ? 'Container + sub-packages deleted' : 'Package deleted')
      setConfirmDel(null); onRefresh()
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to delete package')
    } finally { setDeleting(false) }
  }
  // 🗑 click: a container (has children) → explicit confirm step; a leaf → delete directly.
  const onDeleteClick = (pkgId: number, isContainer: boolean) => {
    if (isContainer) {
      const childCount = (scn.packages || []).filter(p => p.parent_package_id === pkgId).length
      setConfirmDel({ id: pkgId, childCount })
    } else {
      deletePackage(pkgId, false)
    }
  }

  return (
    <div>
      {/* D5: delegated-packaging banner — shows who packs + hand-back status/action. */}
      {scn.packed_by_type === 'forwarder' && (
        <div style={{ border: `1px solid ${scn.packaging_status === 'complete' ? '#86efac' : '#c4b5fd'}`, background: scn.packaging_status === 'complete' ? 'rgba(34,197,94,0.06)' : 'rgba(124,58,237,0.05)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: col }}>
            📦 Packing delegated to <strong>{scn.forwarder_user_name || 'freight forwarder'}</strong> ·{' '}
            <strong style={{ color: scn.packaging_status === 'complete' ? '#16a34a' : '#7c3aed' }}>
              {scn.packaging_status === 'complete' ? `✓ Complete${scn.packaging_completed_at ? ` (${String(scn.packaging_completed_at).slice(0, 10)})` : ''}` : 'Pending packing'}
            </strong>
          </span>
          {!readOnly && scn.packaging_status === 'pending' && (
            <button onClick={markComplete} disabled={completing}
              style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', cursor: completing ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {completing ? 'Marking…' : '✓ Mark packaging complete'}
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: col }}>{scn.packages?.length || 0} packages · {totalGross.toLocaleString('en-AU', { maximumFractionDigits: 1 })} kg total</span>
        {!readOnly && !adding && !editingId && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => openAdd('container')}
              style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid #c4b5fd', background: 'rgba(124,58,237,0.06)', color: '#6d28d9', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              📦 Add container
            </button>
            <button onClick={() => openAdd('loose')}
              style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              + Add loose package
            </button>
          </div>
        )}
      </div>
      {/* D5.1: when adding, the form renders at the top in the chosen mode. */}
      {adding && (
        <div style={{ marginBottom: 12 }}>
          <PackageFormRow form={form} setForm={setForm} inputSt={inputSt} col={col} sub={sub} bd={bd} dark={dark} error={formError}
            containerTypes={containerTypes} packages={scn.packages || []} originalSeal={originalSeal} addKind={addKind}
            onSave={savePackage} onCancel={closeForm} saving={saving} mode="add" />
        </div>
      )}

      {/* Stage 4: per-line packing allocation (how much of each line is packed across boxes).
          Only shown for SCNs that have structured contents — legacy SCNs render nothing here. */}
      {(scn.scn_lines && scn.scn_lines.length > 0) && (
        <div style={{ border: bd, borderRadius: 8, padding: '10px 12px', marginBottom: 12, background: dark ? '#162032' : '#f8fafc' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', marginBottom: 6 }}>Packing allocation (per line)</div>
          {scn.scn_lines.map(sl => {
            const label = sl.po_line_id ? `Line ${sl.line_number} — ${sl.po_description || ''}` : (sl.ai_description || 'Off-PO item')
            const packed = Number(sl.packed_qty), total = Number(sl.qty)
            const ok = Math.abs(packed - total) < 1e-9
            return (
              <div key={sl.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '2px 0', color: col }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', color: ok ? '#16a34a' : '#d97706' }}>{packed}/{total} {sl.uom || ''} {ok ? '✓' : 'packed'}</span>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: theadBg, borderBottom: bd }}>
              {['#','Description','Contents','L × W × H (mm)','Gross kg','Net kg','DG','Class','Marks','Actions'].map(h => (
                <th key={h} style={{ padding: '7px 8px', textAlign: h === 'DG' ? 'center' : 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tree.map(({ pkg: p, depth, isContainer }) => (
              editingId === p.id ? (
                <tr key={p.id}>
                  <td colSpan={10} style={{ padding: 10 }}>
                    <PackageFormRow form={form} setForm={setForm} inputSt={inputSt} col={col} sub={sub} bd={bd} dark={dark} error={formError}
                      containerTypes={containerTypes} packages={scn.packages || []} originalSeal={originalSeal}
                      onSave={savePackage} onCancel={() => { setEditingId(null); setForm(emptyForm); setFormError(''); setOriginalSeal('') }} saving={saving} mode="edit" />
                  </td>
                </tr>
              ) : (
                <tr key={p.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                  <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', color: '#E84E0F', fontSize: 11, paddingLeft: 8 + depth * 18 }}>
                    {depth > 0 && <span style={{ color: sub }}>└ </span>}{p.package_number}
                  </td>
                  <td style={{ padding: '7px 8px', color: col }}>
                    {p.description || '—'}
                    {isContainer && <span title="Container — holds sub-packages, not items directly" style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#7c3aed', background: 'rgba(124,58,237,0.1)', borderRadius: 6, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>📦 container</span>}
                    {p.container_type_id != null && (
                      <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#0369a1', background: 'rgba(2,132,199,0.1)', borderRadius: 6, padding: '1px 6px' }}>{ctById(p.container_type_id)?.code || 'ISO'}</span>
                    )}
                    {(p.container_no || p.seal_no) && (
                      <div style={{ fontSize: 10, color: sub, marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                        {p.container_no && <span>📦 {p.container_no}</span>}
                        {p.container_no && p.seal_no && <span> · </span>}
                        {p.seal_no && <span title="Sealed — set-once, audited">🔒 {p.seal_no}</span>}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '7px 8px', color: col, minWidth: 160 }}>
                    {isContainer ? (
                      <span style={{ color: sub, fontStyle: 'italic', fontSize: 11 }}>items in sub-packages</span>
                    ) : (p.contents && p.contents.length) ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {p.contents.map((c, ci) => (
                          <span key={ci} style={{ fontSize: 11 }}>
                            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb' }}>{Number(c.qty)}{c.uom ? ` ${c.uom}` : ''}</span>
                            <span style={{ color: sub }}> · {c.label}</span>
                          </span>
                        ))}
                      </div>
                    ) : <span style={{ color: sub }}>—</span>}
                  </td>
                  <td style={{ padding: '7px 8px', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{p.length_mm} × {p.width_mm} × {p.height_mm}</td>
                  <td style={{ padding: '7px 8px', color: col, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{p.gross_weight_kg}</td>
                  <td style={{ padding: '7px 8px', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{p.net_weight_kg || '—'}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'center' }}>{p.is_dangerous_goods ? <span style={{ color: '#ef4444' }}>⚠️</span> : '—'}</td>
                  <td style={{ padding: '7px 8px', color: sub }}>{p.dg_class || '—'}</td>
                  <td style={{ padding: '7px 8px', color: sub, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.marks_numbers || '—'}</td>
                  <td style={{ padding: '7px 8px' }}>
                    {readOnly ? <span style={{ color: sub }}>—</span> : (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {/* D5.1: a typed container gets a "+ pkg" action to pack a sub-package into it. */}
                      {p.container_type_id != null && (
                        <button onClick={() => openAdd('sub', p.id)} title="Add a package into this container"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', fontSize: 12, fontWeight: 700 }}>+ pkg</button>
                      )}
                      <button onClick={() => { setAdding(false); setEditingId(p.id); setOriginalSeal(p.seal_no||''); setForm({ description: p.description||'', length_mm: String(p.length_mm||''), width_mm: String(p.width_mm||''), height_mm: String(p.height_mm||''), gross_weight_kg: String(p.gross_weight_kg||''), net_weight_kg: String(p.net_weight_kg||''), is_dangerous_goods: !!p.is_dangerous_goods, dg_class: p.dg_class||'', dg_un_number: p.dg_un_number||'', marks_numbers: p.marks_numbers||'', container_type_id: p.container_type_id||'', parent_package_id: p.parent_package_id||'', container_no: p.container_no||'', seal_no: p.seal_no||'', seal_reason: '' }) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 13 }}>✎</button>
                      <button onClick={() => onDeleteClick(p.id, isContainer)}
                        title={isContainer ? 'Delete container (asks about sub-packages)' : 'Delete package'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 13 }}>🗑</button>
                    </div>
                    )}
                  </td>
                </tr>
              )
            ))}
          </tbody>
          {(scn.packages?.length || 0) > 0 && (
            <tfoot>
              <tr style={{ background: dark ? '#162032' : '#f8fafc', borderTop: bd }}>
                <td colSpan={3} style={{ padding: '7px 8px', fontSize: 11, fontWeight: 600, color: col }}>TOTALS</td>
                <td style={{ padding: '7px 8px', fontSize: 11, color: sub }}>{scn.packages?.length} packages</td>
                <td style={{ padding: '7px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 600, color: col }}>{totalGross.toLocaleString('en-AU', { maximumFractionDigits: 1 })}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Q2: explicit delete-with-contents confirm for a container. */}
      {confirmDel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9600 }}
          onClick={() => !deleting && setConfirmDel(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', border: bd, borderRadius: 10, padding: 22, maxWidth: 420, width: '90%' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: col, marginBottom: 8 }}>Delete container with contents?</div>
            <div style={{ fontSize: 13, color: sub, marginBottom: 18 }}>
              This package is a <strong style={{ color: '#7c3aed' }}>container</strong> holding{' '}
              <strong style={{ color: col }}>{confirmDel.childCount}</strong> sub-package{confirmDel.childCount !== 1 ? 's' : ''}.
              Deleting it removes the container, all its sub-packages, and their packing-list contents. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDel(null)} disabled={deleting}
                style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={() => deletePackage(confirmDel.id, true)} disabled={deleting}
                style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: deleting ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600, opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting…' : 'Delete container + contents'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const PackageFormRow = ({ form, setForm, inputSt, col, sub, bd, dark, error, onSave, onCancel, saving, mode, containerTypes = [], packages = [], originalSeal = '', addKind = 'loose' }: any) => {
  const isContainerAdd = mode === 'add' && addKind === 'container'
  const isContainerRow = isContainerAdd || (mode === 'edit' && form.container_type_id != null && form.container_type_id !== '')
  const ct = (containerTypes as any[]).find((c: any) => c.id === Number(form.container_type_id))
  const parent = form.parent_package_id ? (packages as any[]).find((p: any) => p.id === Number(form.parent_package_id)) : null
  const sealChanged = (form.seal_no || '').trim() !== (originalSeal || '').trim()
  const reasonNeeded = sealChanged && (originalSeal || '').trim()
  const showSeal = isContainerRow                 // container_no/seal only on containers
  const showDims = !isContainerAdd                // a typed container's dims are display-only
  const headerLabel = isContainerAdd ? '📦 New container'
    : addKind === 'sub' ? `↳ Package into container${parent ? ` #${parent.package_number}` : ''}`
    : '📦 New loose package'
  return (
  <div style={{ background: dark ? '#0f172a' : '#f0fdf4', border: `1px solid rgba(34,197,94,0.3)`, borderRadius: 8, padding: '12px 14px' }}>
    {mode === 'add' && (
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 10, color: isContainerAdd ? '#6d28d9' : '#374151' }}>{headerLabel}</div>
    )}
    {/* Container type picker + reference dims (container add only) */}
    {isContainerAdd && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div><label style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700, display: 'block', marginBottom: 2 }}>Container type *</label>
          <select value={form.container_type_id} onChange={e => setForm((p: any) => ({ ...p, container_type_id: e.target.value ? Number(e.target.value) : '' }))} style={{ ...inputSt, borderColor: form.container_type_id ? undefined : '#f59e0b' }}>
            <option value="">— Select ISO container type —</option>
            {(containerTypes as any[]).map(c => <option key={c.id} value={c.id}>{c.code} · {c.description}</option>)}
          </select></div>
        <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>Inner dimensions (reference)</label>
          <div style={{ ...inputSt, background: dark ? '#162032' : '#f1f5f9', color: sub, display: 'flex', alignItems: 'center', minHeight: 30 }}>{ct ? `${ct.inner_length_mm} × ${ct.inner_width_mm} × ${ct.inner_height_mm} mm${ct.capacity_m3 ? ` · ${ct.capacity_m3} m³` : ''}` : '—'}</div></div>
      </div>
    )}
    {/* container_no (free) + seal_no (governed) — only for containers */}
    {showSeal && (
      <div style={{ display: 'grid', gridTemplateColumns: reasonNeeded ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>Container No.</label>
          <input value={form.container_no} onChange={e => setForm((p: any) => ({ ...p, container_no: e.target.value }))} placeholder="e.g. MSKU1234567" style={inputSt} /></div>
        <div><label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 2 }}>Seal No. {originalSeal && <span style={{ color: '#7c3aed' }} title="Set-once + audited; changing requires a reason">🔒</span>}</label>
          <input value={form.seal_no} onChange={e => setForm((p: any) => ({ ...p, seal_no: e.target.value }))} placeholder="Seal number" style={inputSt} /></div>
        {reasonNeeded && (
          <div><label style={{ fontSize: 10, color: '#d97706', fontWeight: 700, display: 'block', marginBottom: 2 }}>Reason for re-seal *</label>
            <input value={form.seal_reason} onChange={e => setForm((p: any) => ({ ...p, seal_reason: e.target.value }))} placeholder="Why is the seal changing?" style={{ ...inputSt, borderColor: (form.seal_reason || '').trim() ? undefined : '#f59e0b' }} /></div>
        )}
      </div>
    )}
    {showDims && (<>
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
    </>)}
    {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{error}</div>}
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={onCancel} style={{ padding: '5px 14px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
      <button onClick={onSave} disabled={saving} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
        {saving ? 'Saving…' : mode === 'add' ? 'Add Package' : 'Save'}
      </button>
    </div>
  </div>
  )
}

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

// ─── PROOF-OF-CUSTODY TAB ────────────────────────────────────
// Generate a pre-filled PoC form (print-to-PDF), then upload the offline-signed
// copy. Storage reuses the existing scn_documents upload/download with a fixed
// document_type='Proof of Custody' (so it also flows into the Document Inbox).
// Upload/delete are internal-only — the route already blocks freight_forwarders;
// here we also HIDE the controls from external users (read/download stays open).
const POC_TYPE = 'Proof of Custody'
const PocTab = ({ dark, scn, projectId, onRefresh, addToast }: {
  dark: boolean; scn: SCNDetail; projectId: number; onRefresh: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd  = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'
  const { isExternalUser } = useCurrentUser()

  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const pocDocs = (scn.documents || []).filter(d => d.document_type === POC_TYPE)

  const uploadSigned = async () => {
    if (!file) return setUploadError('Please select the signed PoC file')
    setUploading(true); setUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('document_type', POC_TYPE)   // fixed — this tab only handles PoCs
      await axios.post(`${API}/logistics/scn/${scn.id}/documents`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setFile(null)
      addToast('success', 'Signed Proof of Custody uploaded'); onRefresh()
    } catch (e: any) {
      setUploadError(e.response?.data?.error || 'Upload failed')
    } finally { setUploading(false) }
  }

  // Auth-carrying download (blob), same approach as the Document Inbox.
  const downloadDoc = async (docId: number, name?: string | null) => {
    try {
      const { data, headers } = await axios.get(
        `${API}/documents/${projectId}/download/logistics:${docId}`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data], { type: (headers['content-type'] as string) || 'application/octet-stream' }))
      const a = document.createElement('a'); a.href = url; a.download = name || `poc-${docId}`; a.click()
      URL.revokeObjectURL(url)
    } catch (_) { addToast('error', 'Download failed') }
  }

  const deleteDoc = async (docId: number) => {
    try {
      await axios.delete(`${API}/logistics/scn/${scn.id}/documents/${docId}`)
      addToast('success', 'Proof of Custody deleted'); onRefresh()
    } catch (_) { addToast('error', 'Failed to delete') }
  }

  return (
    <div>
      {/* Generate the pre-filled form (available to everyone who can see the SCN) */}
      <div style={{ background: dark ? '#162032' : '#f8fafc', border: bd, borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 4 }}>1 · Generate the form</div>
        <div style={{ fontSize: 12, color: sub, marginBottom: 12, lineHeight: 1.5 }}>
          Download a Proof-of-Custody form pre-filled with this shipment's details, plus blank
          areas for vendor &amp; forwarder signatures, condition and notes. Sign it offline, then
          upload the signed copy below.
        </div>
        <button onClick={() => printPoC(scn)}
          style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          ⬇ Download / Print Proof-of-Custody form
        </button>
      </div>

      {/* Upload the signed copy — internal only */}
      {!isExternalUser && (
        <div style={{ background: dark ? '#162032' : '#f0f9ff', border: `1px solid rgba(37,99,235,0.3)`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 10 }}>2 · Upload the signed copy</div>
          <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} style={{ fontSize: 12, color: col, display: 'block', marginBottom: 10 }} />
          {uploadError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{uploadError}</div>}
          <button onClick={uploadSigned} disabled={uploading || !file}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: (uploading || !file) ? '#64748b' : '#2563eb', color: '#fff', cursor: (uploading || !file) ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600 }}>
            {uploading ? 'Uploading…' : 'Upload signed PoC'}
          </button>
        </div>
      )}

      {/* Signed PoCs on file */}
      <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 8 }}>
        Signed Proof-of-Custody documents ({pocDocs.length})
      </div>
      {pocDocs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, color: sub }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
          <div>No signed Proof of Custody uploaded yet.</div>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: theadBg, borderBottom: bd }}>
              {['File Name','Uploaded By','Date','Actions'].map(h => (
                <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pocDocs.map(d => (
              <tr key={d.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                <td style={{ padding: '7px 10px', color: col }}>{d.file_name || '—'}</td>
                <td style={{ padding: '7px 10px', color: sub }}>{d.uploaded_by_name || '—'}</td>
                <td style={{ padding: '7px 10px', color: sub, whiteSpace: 'nowrap' }}>{fmtFull(d.uploaded_at)}</td>
                <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                  <button onClick={() => downloadDoc(d.id, d.file_name)} title="Download"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 14, marginRight: 6 }}>⬇</button>
                  {!isExternalUser && (
                    <button onClick={() => deleteDoc(d.id)} title="Delete"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14 }}>🗑</button>
                  )}
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
  // Advancing an in-transit SCN IS the arrival confirmation (→ customs review).
  const isArrival = scn.display_status === 'in_transit'
  const [newStatus, setNewStatus] = useState(validNext[0] || '')
  const [notes, setNotes] = useState('')
  const [proofOfCustody, setProofOfCustody] = useState(false)
  const [customsCleared, setCustomsCleared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // "Customs cleared" must be ticked to leave customs review, and before a
  // shipment that never cleared can be marked delivered.
  const alreadyCleared = !!(scn.customs_cleared)
  const needsCustomsTick =
    newStatus === 'pending_delivery' ||
    (newStatus === 'delivered' && !alreadyCleared)

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
    if (needsCustomsTick && !customsCleared) return setError('Tick "Customs cleared" to proceed')
    setSaving(true); setError('')
    try {
      await axios.put(`${API}/logistics/scn/${scn.id}/status`, {
        status: newStatus, notes: notes || null, proof_of_custody: proofOfCustody,
        customs_cleared: customsCleared,
      })
      addToast('success', `SCN status updated to ${STATUS_CONFIG[newStatus]?.label || newStatus}`)
      onSaved()
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to update status')
    } finally { setSaving(false) }
  }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 5000 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        background: cardBg, border: bd, borderRadius: 12, padding: 28, width: 420, maxWidth: '90vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)', zIndex: 5001, fontFamily: 'IBM Plex Sans, sans-serif',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: col, marginBottom: 16 }}>{isArrival ? '📍 Confirm Arrival at Destination' : 'Update SCN Status'}</div>
        {isArrival && (
          <div style={{ fontSize: 12, color: sub, marginBottom: 14, lineHeight: 1.5 }}>
            Confirm this shipment has <strong style={{ color: col }}>arrived at its destination</strong>. It will move to
            {' '}<strong style={{ color: '#d97706' }}>Customs review</strong> and today's date is stamped as the actual
            arrival (ATA). An expeditor or logistics user can confirm this.
          </div>
        )}

        {/* Current */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Current status</label>
          <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: sc.bg, color: sc.color, fontWeight: 600 }}>{sc.label}</span>
        </div>

        {/* New status — hidden for arrival (single destination: customs review) */}
        {!isArrival && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>New status *</label>
            <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={inputSt}>
              {validNext.map(s => (
                <option key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</option>
              ))}
            </select>
          </div>
        )}

        {/* Customs clearance gate — required to leave customs review / before delivery */}
        {needsCustomsTick && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 14, padding: '10px 12px', borderRadius: 8, border: `1px solid ${customsCleared ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.4)'}`, background: customsCleared ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.06)' }}>
            <input type="checkbox" checked={customsCleared} onChange={e => setCustomsCleared(e.target.checked)} style={{ marginTop: 2 }} />
            <span style={{ color: col }}>
              <strong>Customs cleared *</strong>
              <div style={{ color: sub, fontSize: 11, marginTop: 2 }}>Confirm the shipment has cleared customs. Required before it can move on{newStatus === 'delivered' ? ' to delivered' : ''}.</div>
            </span>
          </label>
        )}

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
          <button onClick={handleSave} disabled={saving || !newStatus || (needsCustomsTick && !customsCleared)}
            style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: (saving || (needsCustomsTick && !customsCleared)) ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, opacity: (saving || (needsCustomsTick && !customsCleared)) ? 0.7 : 1 }}>
            {saving ? 'Updating…' : isArrival ? 'Confirm Arrival' : 'Update Status'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── EXPORTED (wraps with ToastProvider) ─────────────────────
export const LogisticsScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider>
    <LogisticsScreenInner {...props} />
  </ToastProvider>
)
