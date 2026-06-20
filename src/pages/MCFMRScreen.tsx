// ─── MC FMR SCREEN ────────────────────────────────────────────
// Field Material Request register. Two views: MC view / Contractor view.
// MC view: approve/reject FMRs with WBS ceiling and stock availability checks.
// Contractor view: raise new FMRs against assigned WBS scope.
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'   // modals portal to document.body — see App.tsx zoom wrapper
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { HelpButton } from '../components/HelpDrawer'
import { FMR_HELP } from '../helpContent'
import { ToastProvider, useToast } from '../hooks/useToast'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ScopeBanner } from '../components/ScopeBanner'
import { useAutoTitle } from '../hooks/useAutoTitle'
import { Pager } from '../components/Pager'
import { usePagedList } from '../hooks/usePagedList'
import { useColumnResize } from '../hooks/useColumnResize'

import { API } from '../lib/api'

// ─── COLUMN RESIZE ────────────────────────────────────────────
// Register grid columns persist their widths (localStorage qco_col_widths_fmr_register);
// the "↺ Reset columns" button restores these defaults. 9 columns, last = actions.
const FMR_COL_DEFAULTS = [140, 260, 110, 180, 100, 150, 110, 120, 200]
const FMR_COL_MINS     = [90,  120, 70,  100, 60,  90,  80,  90,  120]
const ColResizeHandle = ({ onMouseDown, dark }: { onMouseDown: (e: React.MouseEvent) => void; dark: boolean }) => {
  const [hov, setHov] = useState(false)
  return (
    <>
      <div style={{ position: 'absolute', right: 0, top: 0, width: hov ? 3 : 1, height: '100%', background: hov ? '#E84E0F' : (dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'), pointerEvents: 'none', transition: 'width 100ms, background 100ms', borderRadius: 1 }} />
      <div onMouseDown={onMouseDown} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', right: -4, top: 0, width: 8, height: '100%', cursor: 'col-resize', zIndex: 3 }} />
    </>
  )
}
type View = 'mc' | 'contractor'
type PickupWindow = 'all' | 'overdue' | 'today' | '3' | '7' | '14' | '30'

interface FMRRow {
  id: number; fmr_ref: string; item_code?: string | null; description: string
  wbs_code?: string | null; qty_requested: number; qty_issued: number; uom: string
  required_date?: string | null; work_order_ref?: string | null
  requested_by_name?: string | null; requested_by_company?: string | null
  status: string; is_critical_path: number; stock_on_hand?: number
  warehouse_id?: number | null; warehouse_code?: string | null; warehouse_name?: string | null
  line_count?: number; total_qty_requested?: number
}

interface FMRCounts { total: number; pending_approval: number; approved: number; partial_issued: number; issued: number; issued_today: number; overdue: number; active_count: number; records_count: number }
type RegView = 'active' | 'records' | 'all'

const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

const statusPill = (s: string) => {
  const m: Record<string, { label: string; bg: string; color: string }> = {
    pending_approval: { label: 'Pending approval', bg: 'rgba(37,99,235,0.1)',   color: '#2563eb' },
    approved:         { label: 'Approved',          bg: 'rgba(34,197,94,0.1)',   color: '#16a34a' },
    partially_approved: { label: 'Partially approved', bg: 'rgba(245,158,11,0.1)', color: '#d97706' },
    partial_issued:   { label: 'Partial issued',    bg: 'rgba(245,158,11,0.1)', color: '#d97706' },
    issued:           { label: 'Issued',             bg: 'rgba(34,197,94,0.12)', color: '#16a34a' },
    rejected:         { label: 'Rejected',           bg: 'rgba(239,68,68,0.1)', color: '#dc2626' },
    cancelled:        { label: 'Cancelled',          bg: 'rgba(148,163,184,0.1)', color: '#64748b' },
  }
  return m[s] || { label: s, bg: 'rgba(148,163,184,0.1)', color: '#64748b' }
}

const MCFMRInner = ({ dark, projectId, projectName, onBack, userRole = '' }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void; userRole?: string
}) => {
  const { addToast } = useToast()
  const { isSubcontractor } = useCurrentUser()
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bg     = dark ? '#0f172a' : '#f4f7fb'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  // Subcontractors always in contractor view; can't switch to MC view
  const [view, setView]           = useState<View>(isSubcontractor ? 'contractor' : 'mc')
  const [counts, setCounts]       = useState<FMRCounts | null>(null)
  const [search, setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pickup, setPickup]       = useState<PickupWindow>('all')
  const [critOnly, setCritOnly]   = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [regView, setRegView]     = useState<RegView>('active') // active hides picked-up; Records tab shows them
  const [approveFmr, setApproveFmr] = useState<FMRRow | null>(null)
  const [viewFmr, setViewFmr]     = useState<FMRRow | null>(null)
  const [raiseFmr, setRaiseFmr]   = useState(false)
  const tableRef = useRef<HTMLDivElement>(null)

  // Debounce search so we don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // ─── SERVER-SIDE PAGED LOAD ──────────────────────────────────
  // Filter (search/critical/pickup) + sort run server-side; the grid holds one
  // page. KPI counts come from the server (whole-project, independent of page).
  const fetcher = useCallback(async ({ page, limit, sortCol, sortDir }: { page: number; limit: number; sortCol?: string; sortDir: 'asc' | 'desc' }) => {
    const params: Record<string, string> = { page: String(page), limit: String(limit), sort_dir: sortDir }
    if (sortCol)                params.sort_col      = sortCol
    if (debouncedSearch.trim()) params.search        = debouncedSearch.trim()
    if (critOnly)               params.critical_only = 'true'
    if (statusFilter !== 'all') params.status        = statusFilter
    params.view = regView // active (default) hides picked-up; records = picked-up only
    if (pickup !== 'all' && pickup !== 'overdue' && pickup !== 'today') params.pickup_window = String(pickup)
    const { data } = await axios.get(`${API}/mc/${projectId}/fmr`, { params })
    setCounts(data.counts)
    return { data: (data.data ?? []) as FMRRow[], total: (data.total ?? 0) as number }
  }, [projectId, debouncedSearch, critOnly, pickup, statusFilter, regView])

  const {
    data: fmrs, total, page, setPage, setPageSize, pageSize, loading,
    sortCol, sortDir, toggleSort, reload,
  } = usePagedList<FMRRow>({ fetcher, deps: [projectId, debouncedSearch, critOnly, pickup, statusFilter, regView], pageSize: 50, initialSortCol: undefined })
  const sortArrow = (k: string) => sortCol === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  // Resizable register columns (persisted) — see FMR_COL_DEFAULTS.
  const { widths: colW, onMouseDown: onColResize, resetWidths } = useColumnResize('fmr_register', FMR_COL_DEFAULTS, FMR_COL_MINS)

  // ─── INLINE ITEM DRILL-DOWN ──────────────────────────────────
  // Multi-item FMRs expand their line items inline (no modal). Lines are fetched
  // once from /fmr/:id/detail and cached. Works in every tab (shared table).
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [rowLines, setRowLines] = useState<Record<number, any[]>>({})
  const [linesLoading, setLinesLoading] = useState<Set<number>>(new Set())
  const toggleExpand = async (fmrId: number) => {
    setExpandedRows(prev => { const n = new Set(prev); n.has(fmrId) ? n.delete(fmrId) : n.add(fmrId); return n })
    if (rowLines[fmrId]) return // cached
    setLinesLoading(prev => new Set(prev).add(fmrId))
    try {
      const { data } = await axios.get(`${API}/mc/${projectId}/fmr/${fmrId}/detail`)
      setRowLines(prev => ({ ...prev, [fmrId]: data.lines || [] }))
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to load items')
      setExpandedRows(prev => { const n = new Set(prev); n.delete(fmrId); return n }) // revert on failure
    } finally {
      setLinesLoading(prev => { const n = new Set(prev); n.delete(fmrId); return n })
    }
  }

  // Toggle the per-FMR critical-path flag (MC controllers only — backend enforces the role).
  const toggleCritical = async (fmr: FMRRow) => {
    try {
      await axios.put(`${API}/mc/${projectId}/fmr/${fmr.id}/critical-path`, { is_critical_path: fmr.is_critical_path ? 0 : 1 })
      addToast('success', fmr.is_critical_path ? 'Removed critical-path flag' : 'Marked as critical path')
      reload()
    } catch (e) {
      addToast('error', (e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to update critical path')
    }
  }

  // Truncated cells get a hover tooltip; re-runs when the FMR list changes.
  useAutoTitle(tableRef, [fmrs])

  // Heat/Lot P4a-i — issue the approved qty (auto-FIFO). Pickup captures Proof of Collection.
  const [pocFmr, setPocFmr] = useState<FMRRow | null>(null)
  // Heat/Lot P4b-ii-b — optional per-line heat-pick override modal.
  const [pickFmr, setPickFmr] = useState<FMRRow | null>(null)

  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit' }

  const PICKUP_OPTS: { key: PickupWindow; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'overdue', label: 'Overdue' }, { key: 'today', label: 'Today' },
    { key: '3', label: '≤3 days' }, { key: '7', label: '≤7 days' }, { key: '14', label: '≤14 days' }, { key: '30', label: '≤30 days' },
  ]

  const isOverdue = (d?: string | null) => d && new Date(d) < new Date()
  const isDueSoon = (d?: string | null) => d && !isOverdue(d) && Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) <= 3

  return (
    <div style={{ background: bg, minHeight: '100vh', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ background: cardBg, borderBottom: bd, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onFallback={onBack} dark={dark} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* MC / Contractor view toggle — hidden for subcontractors */}
          {!isSubcontractor && <>
            <button onClick={() => setView('mc')}
              style={{ padding: '5px 14px', borderRadius: '6px 0 0 6px', border: bd, background: 'none', color: view === 'mc' ? col : sub, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: view === 'mc' ? 600 : 400 }}>
              MC view
            </button>
            <button onClick={() => setView('contractor')}
              style={{ padding: '5px 14px', borderRadius: '0 6px 6px 0', border: bd, borderLeft: 'none', background: 'none', color: view === 'contractor' ? col : sub, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: view === 'contractor' ? 600 : 400 }}>
              Contractor view
            </button>
          </>}
          <button onClick={() => setRaiseFmr(true)}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            + Raise FMR
          </button>
          {!isSubcontractor && <button style={{ padding: '6px 14px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>↓ Export</button>}
          <HelpButton screenName="FMR Register" sections={FMR_HELP} dark={dark} />
        </div>
      </div>

      <div style={{ padding: 24 }}>
        {/* ScopeBanner for subcontractors */}
        {isSubcontractor && <ScopeBanner role="subcontractor" wbsScopes={['03.01','03.02','04.01']} />}
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: col }}>FMR Register</h1>
        <div style={{ fontSize: 12, color: sub, marginBottom: 16 }}>Field Material Requests — {projectName}</div>

        {/* Contractor scope banner (for internal team in contractor view) */}
        {view === 'contractor' && !isSubcontractor && (
          <div style={{ background: dark ? '#162032' : '#eff6ff', border: `1px solid ${dark ? '#334155' : '#bfdbfe'}`, borderRadius: 8, padding: '8px 14px', marginBottom: 16, fontSize: 12, color: col, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#2563eb' }}>ℹ</span>
            Showing materials for your assigned WBS scope:
            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb' }}>03.01 · 03.02 · 04.01</span>
            · You cannot see FMRs or materials outside your scope
          </div>
        )}

        {/* KPI cards */}
        {counts && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Total FMRs',      value: counts.total,            color: col },
              { label: 'Pending approval', value: counts.pending_approval, color: '#2563eb' },
              { label: 'Partial issued',  value: counts.partial_issued,   color: '#d97706' },
              { label: 'Issued today',    value: counts.issued_today,     color: '#16a34a' },
              { label: 'Overdue',         value: counts.overdue,          color: '#ef4444' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: cardBg, border: bd, borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Alert banner */}
        {counts && counts.overdue > 0 && (
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: col }}>
              ⚠ {counts.overdue} FMR overdue · Plan pickups now to keep field crews moving.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPickup('overdue')}
                style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                Show overdue ({counts.overdue})
              </button>
              <button onClick={() => setPickup('3')}
                style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#f59e0b', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                Show due in 3 days
              </button>
            </div>
          </div>
        )}

        {/* Register view tabs + pick-up window on ONE row to save vertical space.
            Left: Active (live register) · Records (picked-up PoC archive) · All.
            Right: pick-up window filter. */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 2, background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden', width: 'fit-content', flexWrap: 'wrap' }}>
            {([
              ['active',  'Active register', counts?.active_count],
              ['records', 'Records (picked up)', counts?.records_count],
              ['all',     'All', counts?.total],
            ] as [RegView, string, number | string | undefined][]).map(([key, label, n]) => (
              <button key={key} onClick={() => { setRegView(key); setStatusFilter('all') }}
                style={{ padding: '7px 16px', background: regView === key ? '#E84E0F' : 'none', color: regView === key ? '#fff' : sub, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: regView === key ? 600 : 400 }}>
                {label}{n != null ? ` (${n})` : ''}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 2, background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden', width: 'fit-content', flexWrap: 'wrap' }}>
            <span style={{ padding: '7px 12px', fontSize: 11, color: sub, borderRight: bd, whiteSpace: 'nowrap' }}>PICK-UP WINDOW</span>
            {PICKUP_OPTS.map(opt => (
              <button key={opt.key} onClick={() => setPickup(opt.key)}
                style={{ padding: '7px 12px', background: pickup === opt.key ? '#E84E0F' : 'none', color: pickup === opt.key ? '#fff' : sub, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search + filter */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search FMR ref, item, WBS, contractor…"
            style={{ ...inputSt, flex: '1 1 260px' }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inputSt}>
            <option value="all">All statuses ({counts?.total || 0})</option>
            <option value="pending_approval">Pending approval</option>
            <option value="approved">Approved — awaiting pickup</option>
            <option value="partially_approved">Partially approved</option>
            <option value="partial_issued">Partially issued</option>
            <option value="issued">Issued (picked up)</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={() => setCritOnly(v => !v)}
            style={{ ...inputSt, cursor: 'pointer', color: critOnly ? '#E84E0F' : sub, borderColor: critOnly ? '#E84E0F' : undefined }}>
            ★ Critical Path Only {critOnly ? `(${fmrs.filter(f => f.is_critical_path).length})` : ''}
          </button>
          <button onClick={resetWidths} title="Reset column widths to default"
            style={{ ...inputSt, cursor: 'pointer', color: sub }}>↺ Reset columns</button>
        </div>

        {/* Table */}
        <div style={{ background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden' }}>
          <div ref={tableRef} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
            <table className="app-grid" style={{ width: colW.reduce((a, b) => a + b, 0), minWidth: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              {/* colgroup drives the resizable column widths (table-layout: fixed) */}
              <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                <tr style={{ borderBottom: bd }}>
                  {([['FMR REF','fmr_ref'],['ITEMS'],['WBS','wbs_code'],['WAREHOUSE','warehouse'],['QTY'],['REQUESTED BY','requested_by'],['REQ. DATE','required_date'],['STATUS','status'],['']] as [string,string?][]).map(([h,key], i) => (
                    <th key={h || i} onClick={key ? () => toggleSort(key) : undefined}
                      style={{ position: 'relative', padding: '8px 12px', textAlign: 'center', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: key ? 'pointer' : 'default', userSelect: 'none' }}>
                      {h}{key ? sortArrow(key) : ''}
                      {i < colW.length - 1 && <ColResizeHandle onMouseDown={e => onColResize(i, e)} dark={dark} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: sub }}>Loading…</td></tr>
                ) : fmrs.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: 50, textAlign: 'center', color: sub }}>No FMRs found.</td></tr>
                ) : fmrs.map(fmr => {
                  const pill = statusPill(fmr.status)
                  const overdue = isOverdue(fmr.required_date)
                  const soon = isDueSoon(fmr.required_date)
                  // Picked up (issued or partial_issued) → terminal record with Proof of Collection.
                  const hasPoC = ['issued', 'partial_issued'].includes(fmr.status)
                  return (
                    <React.Fragment key={fmr.id}>
                    <tr style={{ borderBottom: expandedRows.has(fmr.id) ? 'none' : `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                      <td style={{ padding: '9px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {view === 'mc' ? (
                            <button onClick={e => { e.stopPropagation(); toggleCritical(fmr) }}
                              title={fmr.is_critical_path ? 'Critical path — click to unmark' : 'Mark as critical path'}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, color: fmr.is_critical_path ? '#E84E0F' : '#cbd5e1' }}>
                              {fmr.is_critical_path ? '★' : '☆'}
                            </button>
                          ) : (fmr.is_critical_path ? <span style={{ color: '#E84E0F' }}>★</span> : null)}
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{fmr.fmr_ref}</span>
                        </div>
                      </td>
                      <td data-align="left" style={{ padding: '9px 12px', overflow: 'hidden' }}>
                        {(() => {
                          const multi = (fmr.line_count ?? 1) > 1
                          const open = expandedRows.has(fmr.id)
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {multi ? (
                                <button onClick={e => { e.stopPropagation(); toggleExpand(fmr.id) }}
                                  title={open ? 'Hide items' : `Show all ${fmr.line_count} items`}
                                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                                  <span style={{ fontSize: 10, color: '#E84E0F', width: 9, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}>▶</span>
                                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{fmr.item_code || '—'}</span>
                                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: open ? '#E84E0F' : (dark ? '#334155' : '#eef2f7'), color: open ? '#fff' : sub, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    +{(fmr.line_count as number) - 1} more
                                  </span>
                                </button>
                              ) : (
                                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{fmr.item_code || '—'}</span>
                              )}
                            </div>
                          )
                        })()}
                        <div style={{ fontSize: 11, color: sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmr.description}</div>
                      </td>
                      <td data-align="left" style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>
                        {(fmr.line_count ?? 1) > 1 ? 'multiple' : (fmr.wbs_code || '—')}
                      </td>
                      <td data-align="left" style={{ padding: '9px 12px', fontSize: 11, color: col, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {fmr.warehouse_code ? <><span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb' }}>{fmr.warehouse_code}</span> <span style={{ color: sub }}>· {fmr.warehouse_name}</span></> : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>
                        {(fmr.line_count ?? 1) > 1 ? `${fmr.line_count} lines` : `${fmr.qty_requested} ${fmr.uom}`}
                      </td>
                      <td data-align="left" style={{ padding: '9px 12px', color: col, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fmr.requested_by_name || '—'}
                        {fmr.requested_by_company && <div style={{ fontSize: 10, color: sub, overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmr.requested_by_company}</div>}
                      </td>
                      <td data-align="center" style={{ padding: '9px 12px', fontSize: 11 }}>
                        <span style={{ color: overdue ? '#ef4444' : soon ? '#d97706' : col, fontWeight: overdue || soon ? 600 : 400 }}>
                          {fmt(fmr.required_date)}
                        </span>
                        {overdue && <div style={{ fontSize: 10, color: '#ef4444' }}>overdue</div>}
                      </td>
                      <td data-align="center" data-col="status" style={{ padding: '9px 12px' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: pill.bg, color: pill.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{pill.label}</span>
                      </td>
                      <td data-align="center" style={{ padding: '9px 12px' }}>
                        {fmr.status === 'pending_approval' && view === 'mc' ? (
                          <button onClick={() => setApproveFmr(fmr)}
                            style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                            Approve
                          </button>
                        ) : view === 'mc' && ['approved', 'partially_approved'].includes(fmr.status) ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => setPocFmr(fmr)}
                              style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                              title="Issue & record pickup (Proof of Collection, decrements stock, auto-FIFO)">
                              Issue / Pickup
                            </button>
                            <button onClick={() => setPickFmr(fmr)}
                              style={{ padding: '4px 10px', borderRadius: 6, border: bd, background: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                              title="Choose which heats to issue (overrides FIFO per line)">⊕ Heats</button>
                            <button onClick={() => setViewFmr(fmr)} title={hasPoC ? 'View detail + Proof of Collection' : 'View detail'}
                              style={{ padding: '4px 12px', borderRadius: 6, border: bd, background: 'none', color: hasPoC ? '#2563eb' : col, cursor: 'pointer', fontSize: 11, fontWeight: hasPoC ? 600 : 400 }}>{hasPoC ? '🤝 View / PoC' : 'View'}</button>
                          </div>
                        ) : (
                          <button onClick={() => setViewFmr(fmr)} title={hasPoC ? 'View detail + Proof of Collection' : 'View detail'}
                            style={{ padding: '4px 12px', borderRadius: 6, border: bd, background: 'none', color: hasPoC ? '#2563eb' : col, cursor: 'pointer', fontSize: 11, fontWeight: hasPoC ? 600 : 400 }}>{hasPoC ? '🤝 View / PoC' : 'View'}</button>
                        )}
                      </td>
                    </tr>
                    {expandedRows.has(fmr.id) && (
                      <tr style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                        <td />
                        <td colSpan={8} style={{ padding: '0 12px 10px', background: dark ? '#131c2e' : '#fafcff' }}>
                          {linesLoading.has(fmr.id) ? (
                            <div style={{ padding: '8px 4px', fontSize: 11, color: sub }}>Loading items…</div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                              <thead>
                                <tr style={{ color: sub }}>
                                  {['ITEM', 'DESCRIPTION', 'WBS', 'QTY REQ', 'APPROVED', 'ISSUED', 'STATUS'].map(h => (
                                    <th key={h} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', padding: '5px 8px', borderBottom: bd }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(rowLines[fmr.id] || []).map(l => (
                                  <tr key={l.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#eef2f7'}` }}>
                                    <td style={{ padding: '5px 8px', fontFamily: 'JetBrains Mono, monospace', color: '#2563eb', fontWeight: 600 }}>{l.item_code || '—'}</td>
                                    <td style={{ padding: '5px 8px', color: col }}>{l.description}</td>
                                    <td style={{ padding: '5px 8px', fontFamily: 'JetBrains Mono, monospace', color: sub }}>{l.wbs_code || '—'}</td>
                                    <td style={{ padding: '5px 8px', fontFamily: 'JetBrains Mono, monospace', color: col }}>{Number(l.qty_requested)} {l.uom}</td>
                                    <td style={{ padding: '5px 8px', fontFamily: 'JetBrains Mono, monospace', color: l.qty_approved != null && Number(l.qty_approved) > 0 ? col : sub }}>{l.qty_approved != null && Number(l.qty_approved) > 0 ? `${Number(l.qty_approved)} ${l.uom}` : '—'}</td>
                                    <td style={{ padding: '5px 8px', fontFamily: 'JetBrains Mono, monospace', color: Number(l.qty_issued) > 0 ? '#2563eb' : sub }}>{Number(l.qty_issued) > 0 ? `${Number(l.qty_issued)} ${l.uom}` : '—'}</td>
                                    <td style={{ padding: '5px 8px' }}>
                                      <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 5, fontWeight: 600, background: l.line_status === 'issued' ? 'rgba(34,197,94,0.12)' : l.line_status === 'partial_issued' ? 'rgba(245,158,11,0.12)' : (dark ? '#334155' : '#eef2f7'), color: l.line_status === 'issued' ? '#16a34a' : l.line_status === 'partial_issued' ? '#d97706' : sub }}>{(l.line_status || '—').replace('_', ' ')}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      </div>

      {/* Approval Modal */}
      {approveFmr && (
        <FMRApprovalModal
          dark={dark} fmr={approveFmr} projectId={projectId}
          onClose={() => setApproveFmr(null)}
          onSaved={() => { setApproveFmr(null); reload(); addToast('success', 'FMR decision recorded') }}
          addToast={addToast}
        />
      )}

      {/* Raise FMR Modal — multi-line builder */}
      {raiseFmr && (
        <RaiseFMRModal
          dark={dark} projectId={projectId}
          onClose={() => setRaiseFmr(false)}
          onSaved={() => { setRaiseFmr(false); reload(); addToast('success', 'FMR submitted for approval') }}
          addToast={addToast}
        />
      )}

      {/* FMR Detail Modal — multi-line, contractor-safe (no grid location) */}
      {viewFmr && (
        <FMRDetailModal
          dark={dark} projectId={projectId} fmr={viewFmr}
          onClose={() => setViewFmr(null)}
          addToast={addToast}
        />
      )}

      {/* Heat/Lot P4b-ii-b — per-line heat-pick override modal */}
      {pickFmr && (
        <IssuePickerModal
          dark={dark} projectId={projectId} fmr={pickFmr}
          onClose={() => setPickFmr(null)}
          onIssued={(msg, short) => { setPickFmr(null); reload(); addToast(short ? 'error' : 'success', msg) }}
          addToast={addToast}
        />
      )}

      {/* Pickup / Proof of Collection — one-click FIFO issue + PoC capture */}
      {pocFmr && (
        <PoCModal
          dark={dark} projectId={projectId} fmr={pocFmr}
          onClose={() => setPocFmr(null)}
          onIssued={(msg, short) => { setPocFmr(null); reload(); addToast(short ? 'error' : 'success', msg) }}
          addToast={addToast}
        />
      )}
    </div>
  )
}

// ─── FMR APPROVAL MODAL — PER-LINE ────────────────────────────
// Loads ALL lines (GET /fmr/:id/approval) with per-line allocation +
// system checks. Each line gets its own Approve full / Approve partial
// / Reject control. WBS ceiling is enforced per line (full-approve is
// blocked when requested > remaining allocation). The header status is
// a roll-up of the line decisions. Confirm posts the full decisions[].
type LineDecision = 'approve_full' | 'approve_partial' | 'reject'
interface ApprovalLine {
  line_id: number; item_code: string; item_type: 'commodity' | 'equipment'
  description: string; wbs_code: string; qty_requested: number; uom: string
  line_status: string
  alloc: { on_hand: number; already_issued: number; wbs_total_allocation: number; remaining_allocation: number; in_transit: number }
  checks: {
    wbs_ceiling: { ok: boolean; requested: number; remaining: number }
    stock: { ok: boolean; on_hand: number }
    advance: { ok: boolean; days: number | null }
  }
}

const FMRApprovalModal = ({ dark, fmr, projectId, onClose, onSaved, addToast }: {
  dark: boolean; fmr: FMRRow; projectId: number; onClose: () => void; onSaved: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '6px 9px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

  const [header, setHeader] = useState<any>(null)
  const [lines, setLines]   = useState<ApprovalLine[]>([])
  const [loading, setLoading] = useState(true)
  const [decisions, setDecisions] = useState<Record<number, { decision: LineDecision; qty: string; reason: string }>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  // ── Issuance packaging: how the approved material ships (package type + dims + weight + DG) ──
  const [packageTypes, setPackageTypes] = useState<{ id: number; name: string }[]>([])
  type PkgDraft = { package_type_id: string; custom_type: string; length_mm: string; width_mm: string; height_mm: string; gross_weight_kg: string; net_weight_kg: string; is_dangerous_goods: boolean; dg_class: string; dg_un_number: string }
  const [packages, setPackages] = useState<PkgDraft[]>([])
  const [lineAssign, setLineAssign] = useState<Record<number, number>>({})   // line_id → package index

  useEffect(() => {
    axios.get(`${API}/mc/${projectId}/fmr/${fmr.id}/approval`)
      .then(({ data }) => { setHeader(data.fmr); setLines(data.lines || []) })
      .catch((e: any) => addToast('error', e.response?.data?.error || 'Failed to load FMR'))
      .finally(() => setLoading(false))
    axios.get(`${API}/mc/package-types`).then(({ data }) => setPackageTypes(data)).catch(() => {})
  }, [fmr.id]) // eslint-disable-line

  const setDec = (lineId: number, patch: Partial<{ decision: LineDecision; qty: string; reason: string }>) =>
    setDecisions(p => ({ ...p, [lineId]: { decision: p[lineId]?.decision ?? 'approve_full', qty: p[lineId]?.qty ?? '', reason: p[lineId]?.reason ?? '', ...patch } }))
  const addPackage = () => setPackages(p => [...p, { package_type_id: '', custom_type: '', length_mm: '', width_mm: '', height_mm: '', gross_weight_kg: '', net_weight_kg: '', is_dangerous_goods: false, dg_class: '', dg_un_number: '' }])
  const setPkg = (i: number, patch: Partial<PkgDraft>) => setPackages(p => p.map((pk, j) => j === i ? { ...pk, ...patch } : pk))
  const removePackage = (i: number) => {
    setPackages(p => p.filter((_, j) => j !== i))
    setLineAssign(a => { const n: Record<number, number> = {}; for (const k of Object.keys(a)) { const lid = Number(k), pi = a[lid]; if (pi === i) continue; n[lid] = pi > i ? pi - 1 : pi } return n })
  }

  // ── Roll-up preview + per-line validity ────────────────────
  const counts = { approve_full: 0, approve_partial: 0, reject: 0 }
  lines.forEach(l => { const d = decisions[l.line_id]; if (d) counts[d.decision]++ })
  const decidedAll = lines.length > 0 && lines.every(l => decisions[l.line_id])
  const lineValid = (l: ApprovalLine) => {
    const d = decisions[l.line_id]; if (!d) return false
    if (d.decision === 'approve_full') return l.checks.wbs_ceiling.ok
    if (d.decision === 'approve_partial') { const q = Number(d.qty); return q > 0 && q < l.qty_requested && q <= l.alloc.remaining_allocation && !!d.reason.trim() }
    if (d.decision === 'reject') return !!d.reason.trim()
    return false
  }
  const allValid = decidedAll && lines.every(lineValid)
  // ── Packaging validity: every approved/partial line sits in exactly one valid package ──
  const approvedLineIds = lines.filter(l => { const d = decisions[l.line_id]; return d && d.decision !== 'reject' }).map(l => l.line_id)
  const pkgTypeChosen = (pk: PkgDraft) => pk.package_type_id === 'other' ? !!pk.custom_type.trim() : !!pk.package_type_id
  const pkgValid = (pk: PkgDraft) => pkgTypeChosen(pk) && [pk.length_mm, pk.width_mm, pk.height_mm, pk.gross_weight_kg].every(v => Number(v) > 0) && (!pk.is_dangerous_goods || !!pk.dg_class.trim())
  const packagingValid = approvedLineIds.length === 0 || (packages.length > 0 && packages.every(pkgValid) && approvedLineIds.every(id => lineAssign[id] != null && lineAssign[id] < packages.length))
  const canConfirm = allValid && packagingValid

  // Roll-up preview label
  const rollupPreview = (() => {
    if (!decidedAll) return null
    const anyApproved = counts.approve_full + counts.approve_partial > 0
    const anyReject = counts.reject > 0
    if (anyApproved && anyReject) return 'Partially approved'
    if (anyReject && !anyApproved) return 'Rejected'
    return 'Approved'
  })()

  const submit = async () => {
    setError('')
    if (!allValid) { setError('Every line needs a valid decision'); return }
    if (!packagingValid) { setError('Add a package (type, dims, weight) and assign every approved line to one'); return }
    setSaving(true)
    try {
      await axios.put(`${API}/mc/${projectId}/fmr/${fmr.id}/approve`, {
        decisions: lines.map(l => {
          const d = decisions[l.line_id]
          return {
            line_id: l.line_id, decision: d.decision,
            qty_approved: d.decision === 'approve_partial' ? Number(d.qty) : undefined,
            reason: (d.decision === 'approve_partial' || d.decision === 'reject') ? d.reason.trim() : undefined,
          }
        }),
        packages: packages.map((pk, i) => ({
          package_type_id: pk.package_type_id === 'other' ? null : Number(pk.package_type_id),
          custom_type: pk.package_type_id === 'other' ? pk.custom_type.trim() : undefined,
          length_mm: Number(pk.length_mm), width_mm: Number(pk.width_mm), height_mm: Number(pk.height_mm),
          gross_weight_kg: Number(pk.gross_weight_kg),
          net_weight_kg: pk.net_weight_kg ? Number(pk.net_weight_kg) : undefined,
          is_dangerous_goods: pk.is_dangerous_goods ? 1 : 0,
          dg_class: pk.dg_class.trim() || undefined, dg_un_number: pk.dg_un_number.trim() || undefined,
          line_ids: approvedLineIds.filter(id => lineAssign[id] === i),
        })),
      })
      onSaved()
    } catch (e: any) { setError(e.response?.data?.error || 'Failed to record decisions') }
    finally { setSaving(false) }
  }

  const decBtnColor: Record<LineDecision, string> = { approve_full: '#22c55e', approve_partial: '#f59e0b', reject: '#ef4444' }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, width: 760, maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: bd, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col }}>MC Approval — <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmr.fmr_ref}</span></div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>
              {fmr.requested_by_name || '—'}{fmr.requested_by_company ? ` · ${fmr.requested_by_company}` : ''} · {fmr.work_order_ref || '—'}
              {(header?.warehouse_code || fmr.warehouse_code) ? ` · ${header?.warehouse_code || fmr.warehouse_code} ${header?.warehouse_name || fmr.warehouse_name || ''}` : ''}
              {fmr.required_date ? ` · required ${fmt(fmr.required_date)}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Roll-up summary */}
        <div style={{ padding: '10px 22px', borderBottom: bd, display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: sub, flexWrap: 'wrap' }}>
          <span><strong style={{ color: '#16a34a' }}>{counts.approve_full}</strong> full</span>
          <span><strong style={{ color: '#d97706' }}>{counts.approve_partial}</strong> partial</span>
          <span><strong style={{ color: '#dc2626' }}>{counts.reject}</strong> reject</span>
          <span>· {lines.length - counts.approve_full - counts.approve_partial - counts.reject} undecided</span>
          {rollupPreview && <span style={{ marginLeft: 'auto' }}>Header will become: <strong style={{ color: col }}>{rollupPreview}</strong></span>}
        </div>

        {/* Lines */}
        <div style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? <div style={{ padding: 30, textAlign: 'center', color: sub }}>Loading…</div> : lines.map(l => {
            const d = decisions[l.line_id]
            const ceil = l.checks.wbs_ceiling
            const partialMax = Math.min(l.qty_requested, l.alloc.remaining_allocation)
            return (
              <div key={l.line_id} style={{ border: bd, borderRadius: 10, overflow: 'hidden' }}>
                {/* Line header */}
                <div style={{ background: dark ? '#162032' : '#f8fafc', padding: '10px 14px', borderBottom: bd }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#2563eb', fontWeight: 700 }}>{l.item_code}</span>
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 5, background: l.item_type === 'equipment' ? 'rgba(124,58,237,0.12)' : (dark ? '#334155' : '#eef2f7'), color: l.item_type === 'equipment' ? '#7c3aed' : sub, fontWeight: 600 }}>{l.item_type}</span>
                    <span style={{ fontSize: 12, color: col }}>{l.description}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: sub, fontFamily: 'JetBrains Mono, monospace' }}>WBS {l.wbs_code} · req <strong style={{ color: col }}>{Number(l.qty_requested)} {l.uom}</strong></span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                  {/* Breakdown */}
                  <div style={{ padding: '10px 14px', borderRight: bd }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: sub, textTransform: 'uppercase', marginBottom: 6 }}>WBS {l.wbs_code} · qty breakdown</div>
                    {[
                      ['WBS total allocation', l.alloc.wbs_total_allocation, col],
                      ['Already issued', l.alloc.already_issued, '#2563eb'],
                      ['Remaining allocation', l.alloc.remaining_allocation, '#22c55e'],
                      ['On hand', l.alloc.on_hand, col],
                      ['In transit', l.alloc.in_transit, '#d97706'],
                    ].map(([label, value, c]) => (
                      <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11.5 }}>
                        <span style={{ color: sub }}>{label}</span>
                        <span style={{ fontWeight: 600, color: c as string, fontFamily: 'JetBrains Mono, monospace' }}>{Number(value)} {l.uom}</span>
                      </div>
                    ))}
                  </div>
                  {/* Checks */}
                  <div style={{ padding: '10px 14px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: sub, textTransform: 'uppercase', marginBottom: 6 }}>System checks</div>
                    {[
                      { ok: ceil.ok, label: 'WBS ceiling check', detail: `Requested ${ceil.requested} ${l.uom} ${ceil.ok ? 'within' : 'EXCEEDS'} remaining allocation of ${ceil.remaining} ${l.uom}` },
                      { ok: l.checks.stock.ok, label: 'Stock availability', detail: `${l.checks.stock.on_hand} ${l.uom} on hand${(header?.warehouse_code || fmr.warehouse_code) ? ` · ${header?.warehouse_code || fmr.warehouse_code}` : ''}` },
                      { ok: l.checks.advance.ok, label: 'Advance request flag', warn: !l.checks.advance.ok, detail: l.checks.advance.days !== null ? `Required date is ${l.checks.advance.days} days ahead${l.checks.advance.ok ? '' : ' — flagged for review'}` : 'No date set' },
                    ].map(({ ok, label, detail, warn }: any) => (
                      <div key={label} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
                        <span style={{ color: ok ? '#22c55e' : (warn ? '#f59e0b' : '#ef4444'), fontSize: 13, flexShrink: 0 }}>{ok ? '✓' : (warn ? '△' : '✗')}</span>
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: ok ? '#16a34a' : (warn ? '#d97706' : '#dc2626') }}>{label}</div>
                          <div style={{ fontSize: 10.5, color: sub }}>{detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Per-line decision */}
                <div style={{ padding: '10px 14px', borderTop: bd }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {([
                      { val: 'approve_full' as const, label: 'Approve full', disabled: !ceil.ok, title: ceil.ok ? '' : 'Exceeds remaining allocation — approve partial instead' },
                      { val: 'approve_partial' as const, label: 'Approve partial', disabled: l.alloc.remaining_allocation <= 0 },
                      { val: 'reject' as const, label: 'Reject', disabled: false },
                    ]).map(opt => {
                      const active = d?.decision === opt.val
                      return (
                        <button key={opt.val} disabled={opt.disabled} title={opt.title}
                          onClick={() => setDec(l.line_id, { decision: opt.val })}
                          style={{ flex: 1, padding: '7px', borderRadius: 6, border: `2px solid ${active ? decBtnColor[opt.val] : bd}`, background: active ? decBtnColor[opt.val] : 'none', color: opt.disabled ? sub : (active ? '#fff' : col), cursor: opt.disabled ? 'not-allowed' : 'pointer', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', opacity: opt.disabled ? 0.5 : 1 }}>
                          {opt.label}{opt.val === 'approve_full' && !ceil.ok ? ' 🚫' : ''}
                        </button>
                      )
                    })}
                  </div>
                  {d?.decision === 'approve_partial' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, marginTop: 8 }}>
                      <div>
                        <label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 3 }}>Approved qty (max {partialMax})</label>
                        <input type="number" min={1} max={partialMax} value={d.qty} onChange={e => setDec(l.line_id, { qty: e.target.value })}
                          style={inputSt} />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 3 }}>Reason *</label>
                        <input value={d.reason} onChange={e => setDec(l.line_id, { reason: e.target.value })} placeholder="Why partial?" style={inputSt} />
                      </div>
                    </div>
                  )}
                  {d?.decision === 'reject' && (
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 10, color: sub, display: 'block', marginBottom: 3 }}>Rejection reason *</label>
                      <input value={d.reason} onChange={e => setDec(l.line_id, { reason: e.target.value })} placeholder="Why rejected?" style={inputSt} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* ── Issuance packaging (required on approved/partial lines) ── */}
          {!loading && approvedLineIds.length > 0 && (
            <div style={{ border: bd, borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: col, textTransform: 'uppercase', letterSpacing: '0.05em' }}>📦 Issuance packaging</div>
                  <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>How the approved material ships — assign every approved line to a package.</div>
                </div>
                <button onClick={addPackage} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>+ Add package</button>
              </div>
              {packages.length === 0 && <div style={{ fontSize: 11.5, color: '#ef4444', marginBottom: 8 }}>Add at least one package.</div>}
              {packages.map((pk, i) => (
                <div key={i} style={{ border: bd, borderRadius: 8, padding: 10, marginBottom: 8, background: dark ? '#162032' : '#f8fafc' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: col }}>PKG-{i + 1}</span>
                    <select value={pk.package_type_id} onChange={e => setPkg(i, { package_type_id: e.target.value })} style={{ ...inputSt, minWidth: 130 }}>
                      <option value="">Package type…</option>
                      {packageTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      <option value="other">Others (specify)…</option>
                    </select>
                    {pk.package_type_id === 'other' && (
                      <input value={pk.custom_type} onChange={e => setPkg(i, { custom_type: e.target.value })}
                        placeholder="Custom package type *" style={{ ...inputSt, minWidth: 150, borderColor: pk.custom_type.trim() ? undefined : '#f59e0b' }} />
                    )}
                    <input type="number" placeholder="L mm" value={pk.length_mm} onChange={e => setPkg(i, { length_mm: e.target.value })} style={{ ...inputSt, width: 72 }} />
                    <input type="number" placeholder="W mm" value={pk.width_mm} onChange={e => setPkg(i, { width_mm: e.target.value })} style={{ ...inputSt, width: 72 }} />
                    <input type="number" placeholder="H mm" value={pk.height_mm} onChange={e => setPkg(i, { height_mm: e.target.value })} style={{ ...inputSt, width: 72 }} />
                    <input type="number" placeholder="Gross kg" value={pk.gross_weight_kg} onChange={e => setPkg(i, { gross_weight_kg: e.target.value })} style={{ ...inputSt, width: 84 }} />
                    <input type="number" placeholder="Net kg" value={pk.net_weight_kg} onChange={e => setPkg(i, { net_weight_kg: e.target.value })} style={{ ...inputSt, width: 72 }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: sub, cursor: 'pointer' }}>
                      <input type="checkbox" checked={pk.is_dangerous_goods} onChange={e => setPkg(i, { is_dangerous_goods: e.target.checked })} /> DG
                    </label>
                    {pk.is_dangerous_goods && <>
                      <input placeholder="DG class" value={pk.dg_class} onChange={e => setPkg(i, { dg_class: e.target.value })} style={{ ...inputSt, width: 80 }} />
                      <input placeholder="UN #" value={pk.dg_un_number} onChange={e => setPkg(i, { dg_un_number: e.target.value })} style={{ ...inputSt, width: 70 }} />
                    </>}
                    <button onClick={() => removePackage(i)} title="Remove package" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  </div>
                </div>
              ))}
              {packages.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: sub, textTransform: 'uppercase', marginBottom: 6 }}>Assign approved lines to a package</div>
                  {lines.filter(l => approvedLineIds.includes(l.line_id)).map(l => (
                    <div key={l.line_id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ flex: 1, fontSize: 12, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb' }}>{l.item_code}</span> · {l.description}
                      </span>
                      <select value={lineAssign[l.line_id] ?? ''} onChange={e => setLineAssign(p => ({ ...p, [l.line_id]: Number(e.target.value) }))}
                        style={{ ...inputSt, width: 110, border: lineAssign[l.line_id] == null ? '1px solid #ef4444' : bd }}>
                        <option value="">Package…</option>
                        {packages.map((_, pi) => <option key={pi} value={pi}>PKG-{pi + 1}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: bd, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {error ? <span style={{ color: '#ef4444', fontSize: 12 }}>{error}</span> : <span style={{ fontSize: 11, color: sub }}>{decidedAll ? 'All lines decided' : `${lines.length - counts.approve_full - counts.approve_partial - counts.reject} line(s) still need a decision`}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button onClick={submit} disabled={saving || !canConfirm}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: canConfirm ? '#2563eb' : '#94a3b8', color: '#fff', cursor: canConfirm && !saving ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600 }}>
              {saving ? 'Saving…' : 'Confirm decision'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── RAISE FMR MODAL — MULTI-LINE BUILDER ─────────────────────
// One warehouse per FMR (auto-locked to the first item added). Items
// are searched from contractor-scoped stock; equipment is qty-locked
// to 1; same commodity against a different WBS = a separate line.
// Grid/bin location is never shown — the picker endpoint omits it.
interface PickItem {
  item_id: number; item_code: string; description: string; wbs_code: string
  qty_available: number; uom: string; warehouse_id: number
  warehouse_code: string; warehouse_name: string; item_type: 'commodity' | 'equipment'
  ros_date?: string | null
}
interface FMRLineDraft {
  item_id: number; item_code: string; item_type: 'commodity' | 'equipment'
  description: string; wbs_code: string; qty_requested: number; uom: string
  warehouse_id: number; warehouse_code: string; warehouse_name: string; available: number
}

const RaiseFMRModal = ({ dark, projectId, onClose, onSaved, addToast }: {
  dark: boolean; projectId: number; onClose: () => void; onSaved: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

  const [lines, setLines]   = useState<FMRLineDraft[]>([])
  const [search, setSearch] = useState('')
  const [whFilter, setWhFilter] = useState('')      // warehouse_id as string
  const [wbsFilter, setWbsFilter] = useState('')
  const [results, setResults] = useState<PickItem[]>([])
  const [warehouses, setWarehouses] = useState<{ id: number; code: string; name: string }[]>([])
  const [workOrder, setWorkOrder] = useState('')
  const [requiredDate, setRequiredDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Warehouse is locked to the first added line's warehouse.
  const locked = lines.length > 0 ? { id: lines[0].warehouse_id, code: lines[0].warehouse_code, name: lines[0].warehouse_name } : null

  // Initial scoped fetch → derive warehouse filter options.
  useEffect(() => {
    axios.get(`${API}/mc/${projectId}/fmr/items`).then(({ data }) => {
      const seen = new Map<number, { id: number; code: string; name: string }>()
      ;(data.data || []).forEach((i: PickItem) => { if (!seen.has(i.warehouse_id)) seen.set(i.warehouse_id, { id: i.warehouse_id, code: i.warehouse_code, name: i.warehouse_name }) })
      setWarehouses([...seen.values()])
    }).catch(() => {})
  }, [projectId])

  // Item search — debounced. When locked, force warehouse to the locked one.
  useEffect(() => {
    const run = async () => {
      try {
        const params: any = {}
        if (search.trim()) params.q = search.trim()
        if (wbsFilter.trim()) params.wbs_id = wbsFilter.trim()
        const wh = locked ? String(locked.id) : whFilter
        if (wh) params.warehouse_id = wh
        const { data } = await axios.get(`${API}/mc/${projectId}/fmr/items`, { params })
        setResults(data.data || [])
      } catch (e: any) { addToast('error', e.response?.data?.error || 'Item search failed') }
    }
    const t = setTimeout(run, 250)
    return () => clearTimeout(t)
  }, [search, whFilter, wbsFilter, locked?.id, projectId]) // eslint-disable-line

  const addLine = (it: PickItem) => {
    // Enforce single-warehouse even if a stale cross-warehouse result is clicked.
    if (locked && it.warehouse_id !== locked.id) {
      addToast('error', 'All items in one FMR must come from the same warehouse'); return
    }
    // A stock row is a unique item+WBS; block exact duplicates.
    if (lines.some(l => l.item_id === it.item_id)) { addToast('error', 'That item line is already added'); return }
    setLines(p => [...p, {
      item_id: it.item_id, item_code: it.item_code, item_type: it.item_type, description: it.description,
      wbs_code: it.wbs_code, qty_requested: it.item_type === 'equipment' ? 1 : 1, uom: it.uom,
      warehouse_id: it.warehouse_id, warehouse_code: it.warehouse_code, warehouse_name: it.warehouse_name,
      available: Number(it.qty_available),
    }])
  }
  const removeLine = (idx: number) => setLines(p => p.filter((_, i) => i !== idx))
  const setQty = (idx: number, v: string) => setLines(p => p.map((l, i) => i === idx ? { ...l, qty_requested: Number(v) } : l))

  const submit = async () => {
    setError('')
    if (lines.length === 0) { setError('Add at least one line item'); return }
    if (!requiredDate) { setError('Required date is required'); return }
    setSaving(true)
    try {
      await axios.post(`${API}/mc/${projectId}/fmr`, {
        warehouse_id: locked!.id,
        required_date: requiredDate,
        work_order_ref: workOrder || undefined,
        lines: lines.map(l => ({
          item_id: l.item_id, item_code: l.item_code, item_type: l.item_type,
          description: l.description, wbs_code: l.wbs_code, qty_requested: l.qty_requested, uom: l.uom,
        })),
      })
      onSaved()
    } catch (e: any) { setError(e.response?.data?.error || 'Failed to submit FMR') }
    finally { setSaving(false) }
  }

  // Hide already-added items from results.
  const visibleResults = results.filter(r => !lines.some(l => l.item_id === r.item_id))

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 0, width: 860, maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: bd, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col }}>Raise FMR</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>Search items within your contract scope · one warehouse per FMR</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          {/* Left — item picker */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', marginBottom: 8 }}>Find items</div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item name or code…" style={{ ...inputSt, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <select value={locked ? String(locked.id) : whFilter} onChange={e => setWhFilter(e.target.value)} disabled={!!locked} style={{ ...inputSt, opacity: locked ? 0.7 : 1 }}>
                <option value="">All warehouses</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
              <input value={wbsFilter} onChange={e => setWbsFilter(e.target.value)} placeholder="WBS filter…" style={inputSt} />
            </div>
            {locked && (
              <div style={{ fontSize: 11, color: '#2563eb', background: dark ? '#162032' : '#eff6ff', border: `1px solid ${dark ? '#334155' : '#bfdbfe'}`, borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
                🔒 Locked to <strong>{locked.code} · {locked.name}</strong> — all items in one FMR must come from the same warehouse.
              </div>
            )}
            <div style={{ border: bd, borderRadius: 8, overflow: 'auto', maxHeight: 340 }}>
              {visibleResults.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: sub, fontSize: 12 }}>No items match.</div>
              ) : visibleResults.map(it => (
                <div key={it.item_id} style={{ padding: '9px 12px', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{it.item_code}</span>
                      {it.item_type === 'equipment' && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 5, background: 'rgba(124,58,237,0.12)', color: '#7c3aed', fontWeight: 700 }}>EQUIP</span>}
                    </div>
                    <div style={{ fontSize: 11, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.description}</div>
                    <div style={{ fontSize: 10, color: sub, fontFamily: 'JetBrains Mono, monospace' }}>
                      WBS {it.wbs_code} · {Number(it.qty_available)} {it.uom} avail · {it.warehouse_code}
                    </div>
                  </div>
                  <button onClick={() => addLine(it)}
                    style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>+ Add</button>
                </div>
              ))}
            </div>
          </div>

          {/* Right — lines + header fields */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', marginBottom: 8 }}>FMR lines ({lines.length})</div>
            <div style={{ border: bd, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: dark ? '#162032' : '#f8fafc' }}>
                    {['ITEM','WBS','QTY','UOM',''].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'center', fontSize: 9, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 22, textAlign: 'center', color: sub }}>No lines yet — add items from the left.</td></tr>
                  ) : lines.map((l, idx) => (
                    <tr key={idx} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', color: col }}>{l.item_code}</span>
                          {l.item_type === 'equipment' && <span style={{ fontSize: 8, padding: '0 4px', borderRadius: 4, background: 'rgba(124,58,237,0.12)', color: '#7c3aed', fontWeight: 700 }}>EQ</span>}
                        </div>
                        <div style={{ fontSize: 10, color: sub, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</div>
                      </td>
                      <td style={{ padding: '6px 8px', fontFamily: 'JetBrains Mono, monospace', color: sub }}>{l.wbs_code}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <input type="number" value={l.qty_requested} min={1}
                          disabled={l.item_type === 'equipment'}
                          onChange={e => setQty(idx, e.target.value)}
                          title={l.item_type === 'equipment' ? 'Equipment qty is fixed at 1' : ''}
                          style={{ width: 56, fontSize: 11, padding: '3px 5px', borderRadius: 4, border: bd, background: l.item_type === 'equipment' ? (dark ? '#1e293b' : '#eef2f7') : (dark ? '#0f172a' : '#fff'), color: col, fontFamily: 'JetBrains Mono, monospace', opacity: l.item_type === 'equipment' ? 0.7 : 1 }} />
                      </td>
                      <td style={{ padding: '6px 8px', color: sub }}>{l.uom}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <button onClick={() => removeLine(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Work order reference</label>
                <input value={workOrder} onChange={e => setWorkOrder(e.target.value)} placeholder="WO-2025-XXXX" style={inputSt} /></div>
              <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Required date *</label>
                <input type="date" value={requiredDate} onChange={e => setRequiredDate(e.target.value)} style={inputSt} /></div>
            </div>
            {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 12 }}>{error}</div>}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: bd, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: sub }}>{lines.length} line{lines.length !== 1 ? 's' : ''}{locked ? ` · ${locked.code}` : ''}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button onClick={submit} disabled={saving || lines.length === 0 || !requiredDate}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: (lines.length && requiredDate) ? '#E84E0F' : '#94a3b8', color: '#fff', cursor: (lines.length && requiredDate && !saving) ? 'pointer' : 'default', fontSize: 12, fontWeight: 600 }}>
              {saving ? 'Submitting…' : `Submit FMR (${lines.length})`}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── FMR DETAIL MODAL — multi-line, contractor-safe ───────────
// Loads header + all lines from /fmr/:id/detail. Shows warehouse code
// (not grid/bin location). Used by the register View action.
const FMRDetailModal = ({ dark, projectId, fmr, onClose, addToast }: {
  dark: boolean; projectId: number; fmr: FMRRow; onClose: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const [lines, setLines] = useState<any[]>([])
  const [header, setHeader] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)   // ⤢ toggle: comfortable default ↔ near-fullscreen
  const [packages, setPackages] = useState<any[]>([])
  const [pickups, setPickups] = useState<any[]>([]) // Proof of Collection records

  useEffect(() => {
    axios.get(`${API}/mc/${projectId}/fmr/${fmr.id}/detail`)
      .then(({ data }) => { setHeader(data.fmr); setLines(data.lines || []); setPackages(data.packages || []); setPickups(data.pickups || []) })
      .catch((e: any) => addToast('error', e.response?.data?.error || 'Failed to load FMR'))
      .finally(() => setLoading(false))
  }, [fmr.id]) // eslint-disable-line

  // Signature endpoint is JWT-gated, so fetch as a blob (auth header) and open via object URL.
  const viewSignature = async (pickupId: number) => {
    try {
      const { data } = await axios.get(`${API}/mc/${projectId}/fmr/pickup/${pickupId}/signature`, { responseType: 'blob' })
      const url = URL.createObjectURL(data)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e: any) { addToast('error', 'Failed to load signature') }
  }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, width: expanded ? '95vw' : 960, height: expanded ? '90vh' : undefined, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '16px 22px', borderBottom: bd, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col, fontFamily: 'JetBrains Mono, monospace' }}>{fmr.fmr_ref}</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>
              {fmr.requested_by_name || '—'}{fmr.requested_by_company ? ` · ${fmr.requested_by_company}` : ''}
              {(header?.warehouse_code || fmr.warehouse_code) ? ` · ${header?.warehouse_code || fmr.warehouse_code} ${header?.warehouse_name || fmr.warehouse_name || ''}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <button onClick={() => setExpanded(e => !e)} title={expanded ? 'Shrink window' : 'Expand window'}
              style={{ background: 'none', border: 'none', fontSize: 16, color: sub, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}>{expanded ? '🗗' : '⤢'}</button>
            <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>✕</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {loading ? <div style={{ padding: 30, textAlign: 'center', color: sub }}>Loading…</div> : (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', marginBottom: 8 }}>Line items ({lines.length})</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: dark ? '#162032' : '#f8fafc', borderBottom: bd }}>
                    {['ITEM','TYPE','DESCRIPTION','WBS','QTY REQ','APPROVED','ISSUED','STATUS'].map(h => <th key={h} style={{ padding: '7px 10px', textAlign: 'center', fontSize: 9, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                      <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{l.item_code || '—'}</td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 5, background: l.item_type === 'equipment' ? 'rgba(124,58,237,0.12)' : (dark ? '#334155' : '#eef2f7'), color: l.item_type === 'equipment' ? '#7c3aed' : sub, fontWeight: 600 }}>{l.item_type}</span>
                      </td>
                      <td style={{ padding: '7px 10px', color: col, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{l.wbs_code}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{Number(l.qty_requested)} {l.uom}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: l.qty_approved != null && Number(l.qty_approved) > 0 ? col : sub }}>{l.qty_approved != null && Number(l.qty_approved) > 0 ? `${Number(l.qty_approved)} ${l.uom}` : '—'}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: Number(l.qty_issued) > 0 ? '#2563eb' : sub }}>
                        {Number(l.qty_issued) > 0 ? `${Number(l.qty_issued)} ${l.uom}` : '—'}
                        {/* Heat/Lot P4b-i — issued-heat breakdown (multiple rows when FIFO crossed heats) */}
                        {Array.isArray(l.issued_heats) && l.issued_heats.length > 0 && (
                          <div style={{ marginTop: 3, fontSize: 10, color: sub }}>
                            {l.issued_heats.map((h: any, i: number) => (
                              <div key={i}>{Number(h.qty)} of <span style={{ color: '#7c3aed', fontWeight: 600 }}>{h.heat_number || '— no heat'}</span></div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 5, fontWeight: 600, background: l.line_status === 'issued' ? 'rgba(34,197,94,0.12)' : l.line_status === 'partial_issued' ? 'rgba(245,158,11,0.12)' : (dark ? '#334155' : '#eef2f7'), color: l.line_status === 'issued' ? '#16a34a' : l.line_status === 'partial_issued' ? '#d97706' : sub }}>{(l.line_status || '—').replace('_', ' ')}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ── Issuance packaging (how the approved material ships) ── */}
              {packages.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', marginBottom: 8 }}>📦 Issuance packaging ({packages.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {packages.map((p: any) => {
                      const inPkg = lines.filter(l => l.package_id === p.id)
                      return (
                        <div key={p.id} style={{ border: bd, borderRadius: 8, padding: '10px 12px', background: dark ? '#162032' : '#f8fafc' }}>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: col }}>{p.package_number}</span>
                            <span style={{ color: col }}>{p.package_type_name || p.description || '—'}</span>
                            <span style={{ color: sub, fontFamily: 'JetBrains Mono, monospace' }}>{Number(p.length_mm)}×{Number(p.width_mm)}×{Number(p.height_mm)} mm</span>
                            <span style={{ color: sub, fontFamily: 'JetBrains Mono, monospace' }}>{Number(p.gross_weight_kg)} kg gross{p.net_weight_kg ? ` · ${Number(p.net_weight_kg)} kg net` : ''}</span>
                            {p.is_dangerous_goods ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'rgba(239,68,68,0.12)', color: '#dc2626', fontWeight: 600 }}>⚠ DG {p.dg_class || ''}{p.dg_un_number ? ` · UN${p.dg_un_number}` : ''}</span> : null}
                          </div>
                          {inPkg.length > 0 && (
                            <div style={{ marginTop: 6, fontSize: 11, color: sub }}>Contains: <span style={{ fontFamily: 'JetBrains Mono, monospace', color: col }}>{inPkg.map(l => l.item_code).join(', ')}</span></div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Proof of Collection (pickup records) ── */}
              {pickups.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', marginBottom: 8 }}>🤝 Proof of Collection ({pickups.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {pickups.map((pk: any) => (
                      <div key={pk.id} style={{ border: bd, borderRadius: 8, padding: '10px 12px', background: dark ? '#162032' : '#f8fafc', display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 12 }}>
                          <div style={{ color: col, fontWeight: 600 }}>{pk.collected_by_name}{pk.collected_by_company ? <span style={{ color: sub, fontWeight: 400 }}> · {pk.collected_by_company}</span> : null}</div>
                          <div style={{ color: sub, fontSize: 11, marginTop: 2 }}>
                            Collected <span style={{ fontFamily: 'JetBrains Mono, monospace', color: col }}>{Number(pk.qty_issued)}</span>
                            {' · '}{new Date(pk.picked_up_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            {pk.issued_by_name ? ` · issued by ${pk.issued_by_name}` : ''}
                          </div>
                          {pk.notes && <div style={{ color: col, fontSize: 11, marginTop: 4, fontStyle: 'italic' }}>"{pk.notes}"</div>}
                        </div>
                        {pk.signature_file ? (
                          <button onClick={() => viewSignature(pk.id)}
                            style={{ flexShrink: 0, fontSize: 11, color: '#2563eb', background: 'none', cursor: 'pointer', border: bd, borderRadius: 6, padding: '5px 10px', fontWeight: 600 }}>
                            ✍ View signature
                          </button>
                        ) : <span style={{ flexShrink: 0, fontSize: 10, color: sub }}>no signature</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ fontSize: 11, color: sub, marginTop: 14 }}>
                Work order: <span style={{ color: col }}>{fmr.work_order_ref || '—'}</span> · Required: <span style={{ color: col }}>{fmt(fmr.required_date)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── ISSUE PICKER MODAL (Heat/Lot P4b-ii-b) ───────────────────
// Optional per-line heat-pick override on FMR issue. Reads GET /fmr/:id/issuable
// for each outstanding line's issuable holdings, lets the user allocate a qty per
// holding, and posts { allocations } to POST /fmr/:id/issue. Lines left untouched
// are omitted → they fall back to FIFO server-side (per-line mix). The backend is
// the source of truth for every guard; this UI only helps the user stay valid and
// surfaces any 422 clearly.
const IssuePickerModal = ({ dark, projectId, fmr, onClose, onIssued, addToast }: {
  dark: boolean; projectId: number; fmr: any; onClose: () => void
  onIssued: (msg: string, short: boolean) => void; addToast: (t: 'success' | 'error', m: string) => void
}) => {
  const col = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub = '#94a3b8'
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'JetBrains Mono, monospace', width: 80, textAlign: 'center', boxSizing: 'border-box' }
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // picks[fmr_line_id][stock_id] = qty string
  const [picks, setPicks] = useState<Record<number, Record<number, string>>>({})
  const [poc, setPoc] = useState<PoCData>({ name: '', company: '', notes: '', file: null }) // Proof of Collection

  useEffect(() => {
    axios.get(`${API}/mc/${projectId}/fmr/${fmr.id}/issuable`)
      .then(({ data }) => setData(data))
      .catch((e: any) => addToast('error', e.response?.data?.error || 'Failed to load issuable holdings'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line

  const lineAlloc = (lineId: number) => Object.values(picks[lineId] || {}).reduce((t, q) => t + (Number(q) || 0), 0)
  const setPick = (lineId: number, stockId: number, qty: string) =>
    setPicks(p => ({ ...p, [lineId]: { ...(p[lineId] || {}), [stockId]: qty } }))

  const lines = data?.lines || []
  // A line is over-allocated if its picked total exceeds outstanding (client guard; backend also blocks).
  const anyOver = lines.some((l: any) => lineAlloc(l.fmr_line_id) > Number(l.outstanding) + 1e-9)
  const anyPicked = lines.some((l: any) => lineAlloc(l.fmr_line_id) > 0)

  const submit = async () => {
    // Build allocations only for lines the user actually allocated; others FIFO.
    const allocations: Record<number, { stock_id: number; qty: number }[]> = {}
    for (const l of lines) {
      const perHold = picks[l.fmr_line_id] || {}
      const arr = Object.entries(perHold)
        .map(([sid, q]) => ({ stock_id: Number(sid), qty: Number(q) || 0 }))
        .filter(a => a.qty > 0)
      if (arr.length) allocations[l.fmr_line_id] = arr
    }
    setSaving(true)
    try {
      const { data: res } = await axios.post(`${API}/mc/${projectId}/fmr/${fmr.id}/issue`, {
        ...(Object.keys(allocations).length ? { allocations } : {}),
        collected_by_name: poc.name.trim(),
        collected_by_company: poc.company.trim() || undefined,
        pickup_notes: poc.notes.trim() || undefined,
      })
      if (poc.file && res.pickup_id) {
        try { await uploadPoC(projectId, res.pickup_id, poc.file) }
        catch { addToast('error', 'Issued, but the signature/photo failed to upload') }
      }
      onIssued(res.short ? `Issued ${res.total_issued} — ${res.header_status} (some lines short)` : `Issued ${res.total_issued} — picked up by ${poc.name.trim()}`, !!res.short)
    } catch (e: any) {
      // Backend is the real guard — surface its 422 clearly.
      addToast('error', e.response?.data?.error || 'Issue failed')
      setSaving(false)
    }
  }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 24, width: 720, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col }}>Choose heats to issue · {fmr.fmr_ref}</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>Allocate per heat. Leave a line blank to issue it auto-FIFO. Partial is allowed.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
        </div>

        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: sub }}>Loading issuable holdings…</div>
        ) : lines.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: sub }}>No outstanding approved lines to issue.</div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {lines.map((l: any) => {
              const alloc = lineAlloc(l.fmr_line_id)
              const over = alloc > Number(l.outstanding) + 1e-9
              return (
                <div key={l.fmr_line_id} style={{ border: bd, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: col }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb', fontWeight: 600 }}>{l.item_code}</span>
                      <span style={{ color: sub }}> · WBS {l.wbs_code} · outstanding {Number(l.outstanding)} {l.uom}</span>
                    </div>
                    <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: over ? '#ef4444' : alloc > 0 ? '#16a34a' : sub }}>
                      {alloc > 0 ? `allocated ${alloc} of ${Number(l.outstanding)}` : 'blank → FIFO'}
                    </div>
                  </div>
                  {l.holdings.length === 0 ? (
                    <div style={{ fontSize: 11, color: '#f59e0b' }}>No issuable holdings (good, not on hold) for this line.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead><tr style={{ color: sub }}>
                        {['HEAT', 'LOCATION', 'AVAILABLE', 'ISSUE QTY'].map(h => <th key={h} style={{ textAlign: 'center', fontWeight: 600, padding: '2px 6px', fontSize: 9, textTransform: 'uppercase' }}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {l.holdings.map((h: any) => (
                          <tr key={h.stock_id}>
                            <td style={{ padding: '3px 6px', fontFamily: 'JetBrains Mono, monospace', color: '#7c3aed', fontWeight: 600 }}>{h.heat_number || '— no heat'}</td>
                            <td style={{ padding: '3px 6px', fontFamily: 'JetBrains Mono, monospace', color: sub }}>{h.location_code || '—'}</td>
                            <td style={{ padding: '3px 6px', fontFamily: 'JetBrains Mono, monospace', color: col }}>{Number(h.qty_available)} {l.uom}</td>
                            <td style={{ padding: '3px 6px' }}>
                              <input type="number" min={0} max={Number(h.qty_available)} value={picks[l.fmr_line_id]?.[h.stock_id] ?? ''}
                                placeholder="0"
                                onChange={e => { let v = Number(e.target.value); if (!(v >= 0)) v = 0; if (v > Number(h.qty_available)) v = Number(h.qty_available); setPick(l.fmr_line_id, h.stock_id, v ? String(v) : '') }}
                                style={inputSt} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {over && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>Allocated {alloc} exceeds outstanding {Number(l.outstanding)} — reduce before issuing.</div>}
                </div>
              )
            })}
          </div>
        )}

        {/* Proof of Collection — required to record the hand-over */}
        {!loading && lines.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: bd }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: col, marginBottom: 10 }}>Proof of Collection</div>
            <PoCCapture dark={dark} value={poc} onChange={setPoc} />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          {(() => { const ok = !saving && !anyOver && anyPicked && poc.name.trim().length > 0; return (
          <button onClick={submit} disabled={!ok}
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: ok ? '#2563eb' : '#94a3b8', color: '#fff', cursor: ok ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Issuing…' : 'Issue selected heats'}
          </button>) })()}
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── PROOF OF COLLECTION — SHARED CAPTURE ─────────────────────
// PoC = who physically collected the material at pickup: name (required),
// company, notes, and a signature (drawn) OR a photo (uploaded). Reused by the
// one-click PoCModal and the heat-pick IssuePickerModal.
interface PoCData { name: string; company: string; notes: string; file: Blob | File | null }

// Draw-to-sign canvas → exports a PNG blob on pointer-up.
const SignaturePad = ({ dark, onChange }: { dark: boolean; onChange: (b: Blob | null) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const hasInk  = useRef(false)
  const lineColor = dark ? '#f1f5f9' : '#0f172a'
  const ctxOf = () => canvasRef.current?.getContext('2d') || null
  const xy = (e: React.PointerEvent) => {
    const c = canvasRef.current!; const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  const down = (e: React.PointerEvent) => { e.preventDefault(); const ctx = ctxOf(); if (!ctx) return; drawing.current = true; const { x, y } = xy(e); ctx.beginPath(); ctx.moveTo(x, y); (e.target as Element).setPointerCapture?.(e.pointerId) }
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ctxOf(); if (!ctx) return; const { x, y } = xy(e); ctx.lineTo(x, y); ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke(); hasInk.current = true }
  const up = () => { if (!drawing.current) return; drawing.current = false; if (hasInk.current) canvasRef.current?.toBlob(b => onChange(b), 'image/png') }
  const clear = () => { const c = canvasRef.current; const ctx = ctxOf(); if (c && ctx) ctx.clearRect(0, 0, c.width, c.height); hasInk.current = false; onChange(null) }
  return (
    <div>
      <canvas ref={canvasRef} width={520} height={140}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: '100%', height: 140, border: `1px dashed ${dark ? '#475569' : '#cbd5e1'}`, borderRadius: 8, background: dark ? '#0b1220' : '#fff', touchAction: 'none', cursor: 'crosshair', boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>Sign above with mouse / finger</span>
        <button type="button" onClick={clear} style={{ fontSize: 10, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer' }}>Clear</button>
      </div>
    </div>
  )
}

const PoCCapture = ({ dark, value, onChange }: { dark: boolean; value: PoCData; onChange: (v: PoCData) => void }) => {
  const col = dark ? '#f1f5f9' : '#0f172a'; const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '6px 9px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
  const lbl: React.CSSProperties = { fontSize: 10, color: sub, textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 3 }
  const [mode, setMode] = useState<'sign' | 'photo'>('sign')
  const set = (patch: Partial<PoCData>) => onChange({ ...value, ...patch })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div><label style={lbl}>Collected by *</label>
          <input value={value.name} onChange={e => set({ name: e.target.value })} placeholder="Full name of collector" style={inputSt} /></div>
        <div><label style={lbl}>Company</label>
          <input value={value.company} onChange={e => set({ company: e.target.value })} placeholder="Contractor / company" style={inputSt} /></div>
      </div>
      <div><label style={lbl}>Notes</label>
        <textarea value={value.notes} onChange={e => set({ notes: e.target.value })} rows={2} placeholder="Condition on hand-over, who witnessed, etc." style={{ ...inputSt, resize: 'vertical' }} /></div>
      <div>
        <label style={lbl}>Proof (signature or photo)</label>
        <div style={{ display: 'flex', gap: 2, marginBottom: 8, border: bd, borderRadius: 6, overflow: 'hidden', width: 'fit-content' }}>
          {(['sign', 'photo'] as const).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); set({ file: null }) }}
              style={{ padding: '5px 12px', fontSize: 11, background: mode === m ? '#2563eb' : 'none', color: mode === m ? '#fff' : sub, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              {m === 'sign' ? '✍ Draw signature' : '📷 Upload photo'}
            </button>
          ))}
        </div>
        {mode === 'sign'
          ? <SignaturePad dark={dark} onChange={b => set({ file: b })} />
          : <input type="file" accept="image/*" onChange={e => set({ file: e.target.files?.[0] || null })} style={{ ...inputSt, padding: 6 }} />}
        {value.file && <div style={{ fontSize: 10, color: '#16a34a', marginTop: 4 }}>✓ Proof attached</div>}
      </div>
    </div>
  )
}

// Two-step: issue (JSON) returns pickup_id, then attach the signature/photo (multipart).
async function uploadPoC(projectId: number, pickupId: number, file: Blob | File) {
  const fd = new FormData()
  const name = file instanceof File ? file.name : 'signature.png'
  fd.append('file', file, name)
  await axios.post(`${API}/mc/${projectId}/fmr/pickup/${pickupId}/signature`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
}

// ─── PICKUP / PoC MODAL — one-click FIFO issue + capture ───────
const PoCModal = ({ dark, projectId, fmr, onClose, onIssued, addToast }: {
  dark: boolean; projectId: number; fmr: any; onClose: () => void
  onIssued: (msg: string, short: boolean) => void; addToast: (t: 'success' | 'error', m: string) => void
}) => {
  const col = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub = '#94a3b8'
  const [poc, setPoc] = useState<PoCData>({ name: '', company: '', notes: '', file: null })
  const [saving, setSaving] = useState(false)
  const canConfirm = poc.name.trim().length > 0 && !saving

  const submit = async () => {
    if (!canConfirm) return
    setSaving(true)
    try {
      const { data } = await axios.post(`${API}/mc/${projectId}/fmr/${fmr.id}/issue`, {
        collected_by_name: poc.name.trim(),
        collected_by_company: poc.company.trim() || undefined,
        pickup_notes: poc.notes.trim() || undefined,
      })
      if (poc.file && data.pickup_id) {
        try { await uploadPoC(projectId, data.pickup_id, poc.file) }
        catch { addToast('error', 'Issued, but the signature/photo failed to upload') }
      }
      onIssued(data.short
        ? `Issued ${data.total_issued} — ${data.header_status} (stock short, line(s) partial)`
        : `Issued ${data.total_issued} — picked up by ${poc.name.trim()}`, !!data.short)
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to issue FMR')
      setSaving(false)
    }
  }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 24, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col }}>Issue & record pickup · {fmr.fmr_ref}</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>Issues the approved qty (auto-FIFO) and logs Proof of Collection. The FMR then moves to <strong>Records</strong>.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ marginTop: 14 }}>
          <PoCCapture dark={dark} value={poc} onChange={setPoc} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={submit} disabled={!canConfirm}
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: canConfirm ? '#2563eb' : '#94a3b8', color: '#fff', cursor: canConfirm ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Issuing…' : 'Confirm pickup & issue'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

export const MCFMRScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void; userRole?: string }) => (
  <ToastProvider><MCFMRInner {...props} /></ToastProvider>
)
