// ─── MC TRANSFER SCREEN ───────────────────────────────────────
// Warehouse Transfer Register — inter-warehouse movements.
// Pipeline: Requested → In transit → Picked up → Delivered → Complete
// + New transfer wizard (2 steps). Transfer detail modal with lifecycle stepper.
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'   // modals portal to document.body — see App.tsx zoom wrapper
import { useExpand, ExpandBtn } from '../components/ExpandToggle'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'
import { useAutoTitle } from '../hooks/useAutoTitle'
import { Pager } from '../components/Pager'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'
import { HelpButton } from '../components/HelpDrawer'
import { TRANSFERS_HELP } from '../helpContent'

// Resizable column defaults — transfer register (10 cols).
const TR_W   = [120, 120, 220, 80, 100, 160, 150, 120, 110, 110]
const TR_MIN = [80, 80, 120, 60, 70, 110, 100, 90, 90, 90]
import { usePagedList } from '../hooks/usePagedList'

const API = 'http://localhost:3001/api'

interface Transfer {
  id: number; transfer_ref: string; item_code?: string | null; description: string
  wbs_code?: string | null; heat_number?: string | null; qty: number; uom: string
  from_warehouse_id?: number | null; from_location?: string | null
  from_warehouse_name?: string | null; from_warehouse_code?: string | null
  to_warehouse_id?: number | null; to_location?: string | null
  to_warehouse_name?: string | null; to_warehouse_code?: string | null
  requested_by_name?: string | null; requested_by_company?: string | null
  status: string; est_pickup_date?: string | null; actual_pickup_date?: string | null; delivered_date?: string | null
  notes?: string | null
}

interface TransferCounts { requested: number; in_transit: number; picked_up: number; delivered: number; complete: number }
interface Warehouse { id: number; name: string; code: string }

const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

const LIFECYCLE: { key: string; label: string; color: string }[] = [
  { key: 'requested',  label: 'Requested',  color: '#64748b' },
  { key: 'in_transit', label: 'In transit', color: '#2563eb' },
  { key: 'picked_up',  label: 'Picked up',  color: '#8b5cf6' },
  { key: 'delivered',  label: 'Delivered',  color: '#d97706' },
  { key: 'complete',   label: 'Complete',   color: '#22c55e' },
]

const statusPill = (s: string) => {
  if (s === 'pending_approval') return { label: 'Pending approval', color: '#d97706', bg: 'rgba(245,158,11,0.12)' }
  if (s === 'rejected')         return { label: 'Rejected',          color: '#dc2626', bg: 'rgba(239,68,68,0.12)' }
  const lc = LIFECYCLE.find(l => l.key === s)
  if (lc) return { label: lc.label, color: lc.color, bg: `${lc.color}1a` }
  return { label: s, color: '#64748b', bg: 'rgba(100,116,139,0.1)' }
}

const MCTransferInner = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const { addToast } = useToast()
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bg     = dark ? '#0f172a' : '#f4f7fb'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  const [counts, setCounts]       = useState<TransferCounts | null>(null)
  const [search, setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string|null>(null)
  const [viewTransfer, setViewTransfer] = useState<Transfer | null>(null)
  const [showNewTransfer, setShowNewTransfer] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const tableRef = useRef<HTMLDivElement>(null)

  // Debounce search so we don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // ─── SERVER-SIDE PAGED LOAD ──────────────────────────────────
  // Filter (search/status) + sort run server-side; the grid holds one page.
  // KPI counts come from the server (whole-project, independent of page).
  const fetcher = useCallback(async ({ page, limit, sortCol, sortDir }: { page: number; limit: number; sortCol?: string; sortDir: 'asc' | 'desc' }) => {
    const params: Record<string, string> = { page: String(page), limit: String(limit), sort_dir: sortDir }
    if (sortCol)                params.sort_col = sortCol
    if (debouncedSearch.trim()) params.search   = debouncedSearch.trim()
    if (statusFilter)           params.status   = statusFilter
    const { data } = await axios.get(`${API}/mc/${projectId}/transfers`, { params })
    setCounts(data.counts)
    return { data: (data.data ?? []) as Transfer[], total: (data.total ?? 0) as number }
  }, [projectId, debouncedSearch, statusFilter])

  const {
    data: transfers, total, page, setPage, setPageSize, pageSize, loading,
    sortCol, sortDir, toggleSort, reload,
  } = usePagedList<Transfer>({ fetcher, deps: [projectId, debouncedSearch, statusFilter], pageSize: 50, initialSortCol: undefined })
  const sortArrow = (k: string) => sortCol === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const rt = useResizableTable('mc_transfers', TR_W, TR_MIN)

  // Truncated cells get a hover tooltip; re-runs when the transfer list changes.
  useAutoTitle(tableRef, [transfers])
  useEffect(() => {
    axios.get(`${API}/mc/${projectId}/warehouses`).then(r => setWarehouses(r.data)).catch(() => {})
  }, [projectId])

  const pipelineTotal = counts ? Object.values(counts).reduce((s, v) => s + v, 0) : 0

  return (
    <div style={{ background: bg, minHeight: '100vh', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ background: cardBg, borderBottom: bd, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onFallback={onBack} dark={dark} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setShowNewTransfer(true)}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            + New transfer
          </button>
          <HelpButton screenName="Warehouse Transfers" sections={TRANSFERS_HELP} dark={dark} />
        </div>
      </div>

      <div style={{ padding: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: col }}>Warehouse Transfer Register</h1>
        <div style={{ fontSize: 12, color: sub, marginBottom: 20 }}>{projectName} · {pipelineTotal} transfers</div>

        {/* Pipeline cards */}
        {counts && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 20 }}>
            {LIFECYCLE.map(l => (
              <button key={l.key} onClick={() => setStatusFilter(statusFilter === l.key ? null : l.key)}
                style={{
                  background: cardBg, border: bd, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  borderBottom: statusFilter === l.key ? `3px solid ${l.color}` : bd,
                }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: l.color }}>{counts[l.key as keyof TransferCounts]}</div>
                <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>{l.label}</div>
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search ref, item, WBS, location, requester…"
            style={{ flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
        </div>

        {/* Table */}
        <div style={{ background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden' }}>
          <div ref={tableRef} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
            <table className="app-grid" style={{ ...rt.tableStyle, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                <tr style={{ borderBottom: bd }}>
                  {([['REF','transfer_ref'],['ITEM','item_code'],['DESCRIPTION'],['QTY'],['WBS','wbs_code'],['FROM → TO','from_warehouse'],['REQUESTED BY','requested_by'],['EST. PICKUP','est_pickup_date'],['STATUS','status'],['ACTION']] as [string,string?][]).map(([h,key], i) => (
                    <th key={h} onClick={key ? () => toggleSort(key) : undefined}
                      style={{ ...rt.thStyle(i), padding: '8px 12px', textAlign: 'center', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: key ? 'pointer' : 'default', userSelect: 'none' }}>
                      {h}{key ? sortArrow(key) : ''}
                      {rt.handle(i, dark)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: sub }}>Loading…</td></tr>
                ) : transfers.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 50, textAlign: 'center', color: sub }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>🔄</div>
                    <div>No transfers found.</div>
                  </td></tr>
                ) : transfers.map(tr => {
                  const pill = statusPill(tr.status)
                  return (
                    <tr key={tr.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{tr.transfer_ref}</td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{tr.item_code || '—'}</td>
                      <td data-align="left" style={{ padding: '9px 12px', color: col, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tr.description}</td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{tr.qty} {tr.uom}</td>
                      <td data-align="left" style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{tr.wbs_code || '—'}</td>
                      <td data-align="left" style={{ padding: '9px 12px', fontSize: 11 }}>
                        <span style={{ color: col }}>{tr.from_warehouse_name} · {tr.from_location}</span>
                        <span style={{ color: '#E84E0F', margin: '0 6px' }}>→</span>
                        <span style={{ color: col }}>{tr.to_warehouse_name} · {tr.to_location}</span>
                      </td>
                      <td data-align="left" style={{ padding: '9px 12px', color: col, fontSize: 11 }}>
                        {tr.requested_by_name || '—'}
                        {tr.requested_by_company && <div style={{ fontSize: 10, color: sub }}>{tr.requested_by_company}</div>}
                      </td>
                      <td data-align="center" style={{ padding: '9px 12px', fontSize: 11, color: sub }}>{fmt(tr.est_pickup_date)}</td>
                      <td data-align="center" data-col="status" style={{ padding: '9px 12px' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: pill.bg, color: pill.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{pill.label}</span>
                      </td>
                      <td data-align="center" style={{ padding: '9px 12px' }}>
                        <button onClick={() => setViewTransfer(tr)}
                          style={{ padding: '4px 12px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 11 }}>View</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      </div>

      {/* Transfer Detail Modal */}
      {viewTransfer && (
        <TransferDetailModal
          dark={dark} transfer={viewTransfer} projectId={projectId}
          onClose={() => setViewTransfer(null)}
          onStatusUpdate={() => { setViewTransfer(null); reload() }}
          addToast={addToast}
        />
      )}

      {/* New Transfer Wizard */}
      {showNewTransfer && (
        <NewTransferWizard
          dark={dark} projectId={projectId} warehouses={warehouses}
          onClose={() => setShowNewTransfer(false)}
          onSaved={() => { setShowNewTransfer(false); reload(); addToast('success', 'Transfer request created') }}
          addToast={addToast}
        />
      )}
    </div>
  )
}

// ─── TRANSFER DETAIL MODAL ────────────────────────────────────
const TransferDetailModal = ({ dark, transfer, projectId, onClose, onStatusUpdate, addToast }: {
  dark: boolean; transfer: Transfer; projectId: number; onClose: () => void; onStatusUpdate: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const [expanded, toggleExpand] = useExpand()

  const isPending  = transfer.status === 'pending_approval'
  const isRejected = transfer.status === 'rejected'
  const currentIdx = LIFECYCLE.findIndex(l => l.key === transfer.status)
  const nextStatus = currentIdx >= 0 ? LIFECYCLE[currentIdx + 1] : undefined
  const [rejectReason, setRejectReason] = useState('')

  const advanceStatus = async () => {
    if (!nextStatus) return
    try {
      await axios.put(`${API}/mc/${projectId}/transfers/${transfer.id}/status`, { status: nextStatus.key })
      addToast('success', `Transfer advanced to ${nextStatus.label}`)
      onStatusUpdate()
    } catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to update status') }
  }

  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !rejectReason.trim()) { addToast('error', 'A reason is required to reject'); return }
    try {
      await axios.post(`${API}/mc/${projectId}/transfers/${transfer.id}/approve`,
        { decision, reason: decision === 'reject' ? rejectReason.trim() : undefined })
      addToast('success', decision === 'approve' ? 'Transfer approved' : 'Transfer rejected')
      onStatusUpdate()
    } catch (e: any) { addToast('error', e.response?.data?.error || 'Approval failed') }
  }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 28, width: expanded ? '95vw' : 700, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: col }}>Transfer — {transfer.transfer_ref}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ExpandBtn expanded={expanded} onToggle={toggleExpand} color={sub} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>✕</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Details */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Transfer Details</div>
            {[
              ['REF', transfer.transfer_ref],
              ['ITEM', transfer.description],
              ['QTY', `${transfer.qty} ${transfer.uom}`],
              ['WBS', transfer.wbs_code || '—'],
              ['HEAT', transfer.heat_number || '—'],
              ['FROM', `${transfer.from_warehouse_name} · ${transfer.from_location}`],
              ['TO', `${transfer.to_warehouse_name} · ${transfer.to_location}`],
              ['REQUESTED BY', `${transfer.requested_by_name}${transfer.requested_by_company ? ' · ' + transfer.requested_by_company : ''}`],
              ['EST. PICKUP', transfer.est_pickup_date ? new Date(transfer.est_pickup_date).toLocaleDateString('en-AU') : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: sub }}>{k}</div>
                <div style={{ fontSize: 12, color: col }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Lifecycle stepper */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Lifecycle</div>
            {LIFECYCLE.map((l, i) => {
              const done = i <= currentIdx
              const active = i === currentIdx
              return (
                <div key={l.key} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: done ? l.color : dark ? '#334155' : '#e2e8f0',
                      color: done ? '#fff' : sub, fontSize: 10, fontWeight: 700, flexShrink: 0,
                    }}>
                      {done ? (active ? '' : '✓') : ''}
                    </div>
                    {i < LIFECYCLE.length - 1 && (
                      <div style={{ width: 2, height: 18, background: i < currentIdx ? l.color : dark ? '#334155' : '#e2e8f0', marginTop: 2 }} />
                    )}
                  </div>
                  <div style={{ paddingTop: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: active ? 700 : 400, color: active ? l.color : done ? col : sub }}>{l.label}</div>
                    {active && <div style={{ fontSize: 10, color: sub }}>Current</div>}
                    {done && !active && <div style={{ fontSize: 10, color: sub }}>Completed</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Approval gate — quarantine/trace-hold source needs MC approval first */}
        {isPending && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: bd }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#d97706', marginBottom: 8 }}>⚠ Pending approval — quarantine / trace-hold source requires MC sign-off before it can proceed.</div>
            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason (required to reject)…"
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', marginBottom: 10 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => decide('reject')} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Reject</button>
              <button onClick={() => decide('approve')} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Approve</button>
            </div>
          </div>
        )}

        {/* Advance status — only for active lifecycle stages (not pending/rejected) */}
        {!isPending && !isRejected && nextStatus && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: bd, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Close</button>
            <button onClick={advanceStatus}
              style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: nextStatus.color, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Advance to {nextStatus.label} →
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}

// ─── NEW TRANSFER WIZARD — STOCK-LINE PICKER ──────────────────
// Step 1: pick a real warehouse_stock holding (clean good stock only;
// quarantine/trace_hold are excluded — they route through approval) + qty.
// Step 2: destination + schedule. Submits stock_id; the move fires at completion.
interface StockOption {
  id: number; item_code: string; description: string; location_code: string | null
  qty_available: number; uom: string; wbs_code: string | null; condition_status: string
  heat_number?: string | null
}
const NewTransferWizard = ({ dark, projectId, warehouses, onClose, onSaved, addToast }: {
  dark: boolean; projectId: number; warehouses: Warehouse[]; onClose: () => void; onSaved: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

  const [step, setStep] = useState<1|2>(1)
  const [fromWh, setFromWh] = useState('')
  const [holdings, setHoldings] = useState<StockOption[]>([])
  const [stockId, setStockId] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [toWh, setToWh] = useState('')
  const [toLocation, setToLocation] = useState('')
  const [reqName, setReqName] = useState('')
  const [reqCompany, setReqCompany] = useState('')
  const [pickupDate, setPickupDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = holdings.find(h => h.id === stockId) || null

  // Load clean source holdings whenever the source warehouse changes.
  useEffect(() => {
    setStockId(null); setHoldings([])
    if (!fromWh) return
    axios.get(`${API}/mc/${projectId}/transfers/stock-options`, { params: { warehouse_id: fromWh } })
      .then(r => setHoldings(r.data.data || []))
      .catch((e: any) => addToast('error', e.response?.data?.error || 'Could not load stock'))
  }, [fromWh]) // eslint-disable-line

  const qtyNum = Number(qty)
  const step1Valid = !!fromWh && !!selected && qtyNum > 0 && qtyNum <= Number(selected?.qty_available)

  const submit = async () => {
    if (!toWh) { setError('Destination warehouse is required'); return }
    if (!stockId || !step1Valid) { setError('Select a source holding and a valid quantity'); return }
    setSaving(true); setError('')
    try {
      await axios.post(`${API}/mc/${projectId}/transfers`, {
        stock_id: stockId, qty: qtyNum, to_warehouse_id: Number(toWh), to_location: toLocation || null,
        requested_by_name: reqName || null, requested_by_company: reqCompany || null,
        est_pickup_date: pickupDate || null, notes: notes || null,
      })
      onSaved()
    } catch (e: any) { setError(e.response?.data?.error || 'Failed to create transfer') }
    finally { setSaving(false) }
  }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 28, width: 560, maxWidth: '96vw', maxHeight: '92vh', overflow: 'auto', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: col, marginBottom: 4 }}>New warehouse transfer</div>
        <div style={{ fontSize: 12, color: sub, marginBottom: 20 }}>Step {step} of 2 · {step === 1 ? 'Pick source stock' : 'Destination & schedule'}</div>

        <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
          {[{ n: 1, label: 'Pick source stock' }, { n: 2, label: 'Destination & schedule' }].map(({ n, label }, i) => (
            <React.Fragment key={n}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, background: step >= n ? '#2563eb' : dark ? '#334155' : '#e2e8f0', color: step >= n ? '#fff' : sub }}>{n < step ? '✓' : n}</div>
                <span style={{ fontSize: 11, color: step === n ? col : sub }}>{label}</span>
              </div>
              {i === 0 && <div style={{ flex: 1, height: 2, background: step > 1 ? '#2563eb' : dark ? '#334155' : '#e2e8f0', margin: '0 8px', alignSelf: 'center' }} />}
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Transfer FROM warehouse *</label>
              <select value={fromWh} onChange={e => setFromWh(e.target.value)} style={inputSt}>
                <option value="">Select source warehouse…</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
              </select>
            </div>
            {fromWh && (
              <div>
                <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Select stock holding * <span style={{ color: sub }}>(clean good stock only)</span></label>
                <div style={{ border: bd, borderRadius: 8, maxHeight: 220, overflow: 'auto' }}>
                  {holdings.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: sub, fontSize: 12 }}>No transferable stock in this warehouse.</div>
                  ) : holdings.map(h => (
                    <div key={h.id} onClick={() => { setStockId(h.id); if (!qty) setQty(String(h.qty_available)) }}
                      style={{ padding: '9px 12px', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, cursor: 'pointer', background: stockId === h.id ? (dark ? '#162032' : '#eff6ff') : 'transparent', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: col }}><span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb', fontWeight: 600 }}>{h.item_code}</span> · {h.description}</div>
                        <div style={{ fontSize: 10, color: sub, fontFamily: 'JetBrains Mono, monospace' }}>{h.location_code || '—'} · WBS {h.wbs_code || '—'} · {h.condition_status} · Heat {h.heat_number || '—'}</div>
                      </div>
                      <div style={{ fontSize: 11, color: col, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>{Number(h.qty_available)} {h.uom}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {selected && (
              <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Quantity to transfer * <span style={{ color: sub }}>(max {Number(selected.qty_available)} {selected.uom})</span></label>
                <input type="number" value={qty} min={0} max={Number(selected.qty_available)} onChange={e => setQty(e.target.value)} style={inputSt} /></div>
            )}
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {selected && <div style={{ fontSize: 11, color: sub, background: dark ? '#162032' : '#f8fafc', border: bd, borderRadius: 6, padding: '8px 10px' }}>Moving <strong style={{ color: col }}>{qtyNum} {selected.uom}</strong> of <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb' }}>{selected.item_code}</span> from {selected.location_code || '—'}</div>}
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Transfer TO warehouse *</label>
              <select value={toWh} onChange={e => setToWh(e.target.value)} style={inputSt}>
                <option value="">Select destination warehouse…</option>
                {warehouses.filter(w => String(w.id) !== fromWh).map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
              </select>
            </div>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>To grid location</label>
              <input value={toLocation} onChange={e => setToLocation(e.target.value)} placeholder="e.g. B-02-05" style={inputSt} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Requested by</label>
                <input value={reqName} onChange={e => setReqName(e.target.value)} placeholder="Name" style={inputSt} /></div>
              <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Company</label>
                <input value={reqCompany} onChange={e => setReqCompany(e.target.value)} placeholder="Company" style={inputSt} /></div>
            </div>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Estimated pickup date</label>
              <input type="date" value={pickupDate} onChange={e => setPickupDate(e.target.value)} style={inputSt} /></div>
          </div>
        )}

        {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          {step === 2 && <button onClick={() => setStep(1)} style={{ padding: '8px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>← Back</button>}
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          {step === 1 ? (
            <button onClick={() => step1Valid ? (setError(''), setStep(2)) : setError('Pick a source holding and a quantity within available')}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: step1Valid ? '#2563eb' : '#94a3b8', color: '#fff', cursor: step1Valid ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600 }}>
              Next →
            </button>
          ) : (
            <button onClick={submit} disabled={saving || !toWh}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: toWh ? '#2563eb' : '#94a3b8', color: '#fff', cursor: toWh && !saving ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600 }}>
              {saving ? 'Creating…' : 'Create transfer'}
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

export const MCTransferScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider><MCTransferInner {...props} /></ToastProvider>
)
