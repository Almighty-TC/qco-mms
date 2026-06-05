// ─── MC FMR SCREEN ────────────────────────────────────────────
// Field Material Request register. Two views: MC view / Contractor view.
// MC view: approve/reject FMRs with WBS ceiling and stock availability checks.
// Contractor view: raise new FMRs against assigned WBS scope.
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'   // modals portal to document.body — see App.tsx zoom wrapper
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ScopeBanner } from '../components/ScopeBanner'
import { useAutoTitle } from '../hooks/useAutoTitle'
import { Pager } from '../components/Pager'
import { usePagedList } from '../hooks/usePagedList'

const API = 'http://localhost:3001/api'
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

interface FMRCounts { total: number; pending_approval: number; partial_issued: number; issued_today: number; overdue: number }

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
    if (pickup !== 'all' && pickup !== 'overdue' && pickup !== 'today') params.pickup_window = String(pickup)
    const { data } = await axios.get(`${API}/mc/${projectId}/fmr`, { params })
    setCounts(data.counts)
    return { data: (data.data ?? []) as FMRRow[], total: (data.total ?? 0) as number }
  }, [projectId, debouncedSearch, critOnly, pickup, statusFilter])

  const {
    data: fmrs, total, page, setPage, pageSize, loading,
    sortCol, sortDir, toggleSort, reload,
  } = usePagedList<FMRRow>({ fetcher, deps: [projectId, debouncedSearch, critOnly, pickup, statusFilter], pageSize: 50, initialSortCol: undefined })
  const sortArrow = (k: string) => sortCol === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  // Truncated cells get a hover tooltip; re-runs when the FMR list changes.
  useAutoTitle(tableRef, [fmrs])

  // Heat/Lot P4a-i — one-click issue of the approved qty (auto-FIFO consume).
  const [issuingId, setIssuingId] = useState<number | null>(null)
  // Heat/Lot P4b-ii-b — optional per-line heat-pick override modal.
  const [pickFmr, setPickFmr] = useState<FMRRow | null>(null)
  const issueFmr = async (fmr: FMRRow) => {
    if (issuingId) return
    setIssuingId(fmr.id)
    try {
      const { data } = await axios.post(`${API}/mc/${projectId}/fmr/${fmr.id}/issue`, {})
      const msg = data.short
        ? `Issued ${data.total_issued} (stock short — line(s) partially issued)`
        : `Issued ${data.total_issued} — ${data.header_status}`
      addToast(data.short ? 'error' : 'success', msg)
      reload()
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to issue FMR')
    } finally { setIssuingId(null) }
  }

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
          <div style={{ fontSize: 11, color: sub }}>Dashboard › {projectName} › Material Control › <strong style={{ color: col }}>FMR Register</strong></div>
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

        {/* Pick-up window filter */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 12, background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
          <span style={{ padding: '7px 12px', fontSize: 11, color: sub, borderRight: bd }}>PICK-UP WINDOW</span>
          {PICKUP_OPTS.map(opt => (
            <button key={opt.key} onClick={() => setPickup(opt.key)}
              style={{ padding: '7px 12px', background: pickup === opt.key ? '#E84E0F' : 'none', color: pickup === opt.key ? '#fff' : sub, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
              {opt.label}
            </button>
          ))}
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
        </div>

        {/* Table */}
        <div style={{ background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden' }}>
          <div ref={tableRef} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                <tr style={{ borderBottom: bd }}>
                  {([['FMR REF','fmr_ref'],['ITEMS'],['WBS','wbs_code'],['WAREHOUSE','warehouse'],['QTY'],['REQUESTED BY','requested_by'],['REQ. DATE','required_date'],['STATUS','status'],['']] as [string,string?][]).map(([h,key]) => (
                    <th key={h} onClick={key ? () => toggleSort(key) : undefined}
                      style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: key ? 'pointer' : 'default', userSelect: 'none' }}>
                      {h}{key ? sortArrow(key) : ''}
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
                  return (
                    <tr key={fmr.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                      <td style={{ padding: '9px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {fmr.is_critical_path ? <span style={{ color: '#E84E0F' }}>★</span> : null}
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{fmr.fmr_ref}</span>
                        </div>
                      </td>
                      <td style={{ padding: '9px 12px', maxWidth: 240, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{fmr.item_code || '—'}</span>
                          {(fmr.line_count ?? 1) > 1 && (
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: dark ? '#334155' : '#eef2f7', color: sub, fontWeight: 600, whiteSpace: 'nowrap' }}>
                              +{(fmr.line_count as number) - 1} more
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmr.description}</div>
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>
                        {(fmr.line_count ?? 1) > 1 ? 'multiple' : (fmr.wbs_code || '—')}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11, color: col, whiteSpace: 'nowrap' }}>
                        {fmr.warehouse_code ? <><span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb' }}>{fmr.warehouse_code}</span> <span style={{ color: sub }}>· {fmr.warehouse_name}</span></> : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>
                        {(fmr.line_count ?? 1) > 1 ? `${fmr.line_count} lines` : `${fmr.qty_requested} ${fmr.uom}`}
                      </td>
                      <td style={{ padding: '9px 12px', color: col, fontSize: 11 }}>
                        {fmr.requested_by_name || '—'}
                        {fmr.requested_by_company && <div style={{ fontSize: 10, color: sub }}>{fmr.requested_by_company}</div>}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11 }}>
                        <span style={{ color: overdue ? '#ef4444' : soon ? '#d97706' : col, fontWeight: overdue || soon ? 600 : 400 }}>
                          {fmt(fmr.required_date)}
                        </span>
                        {overdue && <div style={{ fontSize: 10, color: '#ef4444' }}>overdue</div>}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: pill.bg, color: pill.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{pill.label}</span>
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        {fmr.status === 'pending_approval' && view === 'mc' ? (
                          <button onClick={() => setApproveFmr(fmr)}
                            style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                            Approve
                          </button>
                        ) : view === 'mc' && ['approved', 'partially_approved', 'partial_issued'].includes(fmr.status) ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => issueFmr(fmr)} disabled={issuingId === fmr.id}
                              style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: issuingId === fmr.id ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600 }}
                              title="Issue the approved quantity (decrements stock, auto-FIFO)">
                              {issuingId === fmr.id ? 'Issuing…' : 'Issue'}
                            </button>
                            <button onClick={() => setPickFmr(fmr)}
                              style={{ padding: '4px 10px', borderRadius: 6, border: bd, background: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                              title="Choose which heats to issue (overrides FIFO per line)">⊕ Heats</button>
                            <button onClick={() => setViewFmr(fmr)} style={{ padding: '4px 12px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 11 }}>View</button>
                          </div>
                        ) : (
                          <button onClick={() => setViewFmr(fmr)} style={{ padding: '4px 12px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 11 }}>View</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} />
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

  useEffect(() => {
    axios.get(`${API}/mc/${projectId}/fmr/${fmr.id}/approval`)
      .then(({ data }) => { setHeader(data.fmr); setLines(data.lines || []) })
      .catch((e: any) => addToast('error', e.response?.data?.error || 'Failed to load FMR'))
      .finally(() => setLoading(false))
  }, [fmr.id]) // eslint-disable-line

  const setDec = (lineId: number, patch: Partial<{ decision: LineDecision; qty: string; reason: string }>) =>
    setDecisions(p => ({ ...p, [lineId]: { decision: p[lineId]?.decision ?? 'approve_full', qty: p[lineId]?.qty ?? '', reason: p[lineId]?.reason ?? '', ...patch } }))

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
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: bd, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {error ? <span style={{ color: '#ef4444', fontSize: 12 }}>{error}</span> : <span style={{ fontSize: 11, color: sub }}>{decidedAll ? 'All lines decided' : `${lines.length - counts.approve_full - counts.approve_partial - counts.reject} line(s) still need a decision`}</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button onClick={submit} disabled={saving || !allValid}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: allValid ? '#2563eb' : '#94a3b8', color: '#fff', cursor: allValid && !saving ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600 }}>
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
                    {['ITEM','WBS','QTY','UOM',''].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>)}
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

  useEffect(() => {
    axios.get(`${API}/mc/${projectId}/fmr/${fmr.id}/detail`)
      .then(({ data }) => { setHeader(data.fmr); setLines(data.lines || []) })
      .catch((e: any) => addToast('error', e.response?.data?.error || 'Failed to load FMR'))
      .finally(() => setLoading(false))
  }, [fmr.id]) // eslint-disable-line

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
                    {['ITEM','TYPE','DESCRIPTION','WBS','QTY REQ','APPROVED','ISSUED','STATUS'].map(h => <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>)}
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
      const { data: res } = await axios.post(`${API}/mc/${projectId}/fmr/${fmr.id}/issue`,
        Object.keys(allocations).length ? { allocations } : {})
      onIssued(res.short ? `Issued ${res.total_issued} — ${res.header_status} (some lines short)` : `Issued ${res.total_issued} — ${res.header_status}`, !!res.short)
    } catch (e: any) {
      // Backend is the real guard — surface its 422 clearly.
      addToast('error', e.response?.data?.error || 'Issue failed')
    } finally { setSaving(false) }
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
                        {['HEAT', 'LOCATION', 'AVAILABLE', 'ISSUE QTY'].map(h => <th key={h} style={{ textAlign: 'left', fontWeight: 600, padding: '2px 6px', fontSize: 9, textTransform: 'uppercase' }}>{h}</th>)}
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={submit} disabled={saving || anyOver || !anyPicked}
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: (!saving && !anyOver && anyPicked) ? '#2563eb' : '#94a3b8', color: '#fff', cursor: (!saving && !anyOver && anyPicked) ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Issuing…' : 'Issue selected heats'}
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
