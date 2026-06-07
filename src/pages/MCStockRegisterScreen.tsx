// ─── MC STOCK REGISTER ────────────────────────────────────────
// Searchable warehouse stock across warehouses.
// Group by: Warehouse / WBS / Item. Stock take modal. Move modal.
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'   // modals portal to document.body — see App.tsx zoom wrapper
import { useExpand, ExpandBtn } from '../components/ExpandToggle'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { Pager } from '../components/Pager'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'
import { HelpButton } from '../components/HelpDrawer'
import { STOCK_REGISTER_HELP } from '../helpContent'
import { usePagedList } from '../hooks/usePagedList'
import { ToastProvider, useToast } from '../hooks/useToast'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ScopeBanner } from '../components/ScopeBanner'
import { useAutoTitle } from '../hooks/useAutoTitle'

// ─── Stock Register column geometry ───────────────────────────
// Each WBS/warehouse/item group renders its OWN <table>; without identical
// widths the columns drift group-to-group. table-layout:fixed + a shared
// colgroup of fixed px widths gives every group the same geometry so columns
// line up. A matching minWidth on the table means columns never collapse on a
// narrow window (the wrapper scrolls horizontally instead). Two sets: the
// standard 10-col layout and the subcontractor 7-col variant.
const STOCK_COLS      = ['80px','90px','210px','90px','90px','70px','55px','110px','130px','60px','150px'] // LOCATION,ITEM,DESC,HEAT,WBS,QTY,UOM,COND,VENDOR,HOLD,actions
const STOCK_COLS_SUB  = ['110px','280px','90px','100px','80px','60px','120px','150px']                       // ITEM,DESC,HEAT,WBS,QTY,UOM,COND,VENDOR
const STOCK_MINW      = 1135 // Σ STOCK_COLS
const STOCK_MINW_SUB  = 990  // Σ STOCK_COLS_SUB
// Resizable defaults (numeric, same widths as the static colgroups above).
const STOCK_W      = [80, 90, 210, 90, 90, 70, 55, 110, 130, 60, 150]
const STOCK_W_SUB  = [110, 280, 90, 100, 80, 60, 120, 150]
const STOCK_MIN_     = [50, 60, 120, 60, 60, 50, 45, 80, 90, 50, 90]
const STOCK_MIN_SUB  = [70, 140, 60, 70, 60, 50, 80, 90]
const ellipsisCell: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

const API = 'http://localhost:3001/api'

type GroupBy = 'warehouse' | 'wbs' | 'item'

interface StockItem {
  id: number; item_code: string; description: string; wbs_code?: string | null
  qty: number; qty_available: number; uom: string; location_code?: string | null
  condition_status: string; trace_hold: number; vendor_name?: string | null
  heat_number?: string | null
  warehouse_id: number; warehouse_name: string; warehouse_code: string
}

const condPill = (s: string) => {
  if (s === 'good') return { label: 'Good', color: '#16a34a', bg: 'rgba(34,197,94,0.1)' }
  if (s === 'minor_damage') return { label: 'Minor damage', color: '#d97706', bg: 'rgba(245,158,11,0.1)' }
  if (s === 'major_damage') return { label: 'Major damage', color: '#dc2626', bg: 'rgba(239,68,68,0.1)' }
  return { label: 'Quarantine', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' }
}

// Heat/Lot P5 — heat→cert status badge. `s` is undefined when the heat has no
// declared cert (→ "no cert"). hold > rejected > pending > verified.
const certBadge = (s?: string) => {
  switch (s) {
    case 'verified': return { label: '✓ cert',     color: '#16a34a', bg: 'rgba(34,197,94,0.12)' }
    case 'pending':  return { label: 'cert pending',color: '#d97706', bg: 'rgba(245,158,11,0.12)' }
    case 'rejected': return { label: 'cert reject', color: '#dc2626', bg: 'rgba(239,68,68,0.12)' }
    case 'hold':     return { label: '⚠ hold',      color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' }
    default:         return { label: 'no cert',     color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' }
  }
}

const MCStockRegisterInner = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const { addToast } = useToast()
  const { isSubcontractor } = useCurrentUser()
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bg     = dark ? '#0f172a' : '#f4f7fb'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  const [totals, setTotals]   = useState<any>(null)
  const [wbsScopes, setWbsScopes] = useState<string[]>([])
  const [search, setSearch]   = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('warehouse') // now drives the server-side sort
  const [showHolds, setShowHolds] = useState(false)
  const [showStockTake, setShowStockTake] = useState(false)
  const [moveItem, setMoveItem] = useState<StockItem | null>(null)
  const [docsItem, setDocsItem] = useState<StockItem | null>(null)
  const [resolveItem, setResolveItem] = useState<StockItem | null>(null)
  // Heat/Lot P5 — per-heat cert status (batch, one round-trip) + heat-link modal.
  const [heatStatus, setHeatStatus] = useState<Record<string, { status: string; cert_count: number; has_hold: boolean }>>({})
  const [heatLink, setHeatLink] = useState<string | null>(null)
  const normHeat = (h?: string | null) => (h || '').trim().toUpperCase()

  // Heat/Lot P5 — load the per-heat cert-status map once (read-only join feed).
  useEffect(() => {
    axios.get(`${API}/traceability/${projectId}/heat-status`)
      .then(({ data }) => setHeatStatus(data.data || {}))
      .catch(() => setHeatStatus({}))
  }, [projectId])

  // Debounce search so we don't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // ─── SERVER-SIDE PAGED LOAD ──────────────────────────────────
  // Filter (search/show_holds) + sort run server-side across the whole register;
  // the grid holds one page. The Warehouse/WBS/Item control drives sort_col so
  // related items stay contiguous across pages (no misleading per-page grouping).
  const fetcher = useCallback(async ({ page, limit, sortCol, sortDir }: { page: number; limit: number; sortCol?: string; sortDir: 'asc' | 'desc' }) => {
    const params: Record<string, string> = { page: String(page), limit: String(limit), sort_dir: sortDir }
    if (sortCol)                  params.sort_col   = sortCol
    if (debouncedSearch.trim())   params.search     = debouncedSearch.trim()
    if (showHolds)                params.show_holds = 'true'
    const { data } = await axios.get(`${API}/mc/${projectId}/stock`, { params })
    setTotals(data.totals)
    if (data.wbs_scopes) setWbsScopes(data.wbs_scopes)
    return { data: (data.data ?? []) as StockItem[], total: (data.total ?? 0) as number }
  }, [projectId, debouncedSearch, showHolds])

  const {
    data: stock, total, page, setPage, setPageSize, pageSize, loading,
    sortCol, sortDir, setSortCol, setSortDir, toggleSort, reload,
  } = usePagedList<StockItem>({ fetcher, deps: [projectId, debouncedSearch, showHolds], pageSize: 50, initialSortCol: 'warehouse' })

  // Group control → server sort column (related rows stay contiguous across pages).
  const GROUP_SORT: Record<GroupBy, string> = { warehouse: 'warehouse', wbs: 'wbs_code', item: 'item_code' }
  const selectGroup = (g: GroupBy) => { setGroupBy(g); setSortCol(GROUP_SORT[g]); setSortDir('asc') }
  // A sortable column header (uses ▲/▼ on the active column).
  const sortArrow = (k: string) => sortCol === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const rt = useResizableTable(isSubcontractor ? 'mc_stock_sub' : 'mc_stock', isSubcontractor ? STOCK_W_SUB : STOCK_W, isSubcontractor ? STOCK_MIN_SUB : STOCK_MIN_)

  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit' }

  // Truncated cells get a hover tooltip; re-runs when rows/grouping change.
  const tablesRef = useRef<HTMLDivElement>(null)
  useAutoTitle(tablesRef, [stock, groupBy, showHolds, loading])

  return (
    <div style={{ background: bg, minHeight: '100vh', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ background: cardBg, borderBottom: bd, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onFallback={onBack} dark={dark} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Subcontractors cannot stock take or export */}
          {!isSubcontractor && (
            <button onClick={() => setShowStockTake(true)}
              style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              📋 Stock take
            </button>
          )}
          {!isSubcontractor && (
            <button style={{ padding: '6px 14px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>↓ Export</button>
          )}
          <HelpButton screenName="Stock Register" sections={STOCK_REGISTER_HELP} dark={dark} />
        </div>
      </div>

      <div style={{ padding: 24 }}>
        {/* ScopeBanner for subcontractors */}
        {isSubcontractor && wbsScopes.length > 0 && (
          <ScopeBanner role="subcontractor" wbsScopes={wbsScopes} />
        )}
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: col }}>Stock Register</h1>
        <div style={{ fontSize: 12, color: sub, marginBottom: 20 }}>
          {totals?.total_items ?? '…'} of {totals?.total_items ?? '…'} items · {totals?.warehouse_count ?? '…'} warehouses
        </div>

        {/* KPI cards */}
        {totals && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total items',       value: totals.total_items,       color: col },
              { label: 'Warehouses',        value: totals.warehouse_count,   color: '#2563eb' },
              { label: 'On trace hold',     value: totals.trace_hold_count,  color: '#f59e0b' },
              { label: 'Condition issues',  value: totals.condition_issues,  color: '#ef4444' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: cardBg, border: bd, borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search item, WBS, warehouse, vendor, tag…"
            style={{ ...inputSt, flex: '1 1 260px' }} />
          <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
          <select style={{ ...inputSt }}>
            <option>All warehouses</option>
          </select>
          <select style={{ ...inputSt }}>
            <option>All WBS</option>
          </select>
          {/* Subcontractors cannot see hold details */}
          {!isSubcontractor && (
            <button onClick={() => setShowHolds(v => !v)}
              style={{ ...inputSt, cursor: 'pointer', color: showHolds ? '#ef4444' : sub, borderColor: showHolds ? '#ef4444' : undefined }}>
              {showHolds ? '✕ Hide holds' : '⊕ Show holds'}
            </button>
          )}
          <div style={{ display: 'flex', gap: 0, border: bd, borderRadius: 6, overflow: 'hidden' }}>
            {(['Warehouse','WBS','Item'] as const).map(g => {
              const val = g.toLowerCase() as GroupBy
              const active = sortCol === GROUP_SORT[val]
              return (
                <button key={g} onClick={() => selectGroup(val)} title={`Sort by ${g.toLowerCase()}`}
                  style={{ padding: '6px 12px', border: 'none', background: active ? '#E84E0F' : 'none', color: active ? '#fff' : sub, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                  {g}
                </button>
              )
            })}
          </div>
        </div>

        {/* Table (flat + paginated; the Warehouse/WBS/Item control sets the server sort) */}
        <div ref={tablesRef}>
          {loading ? (
            <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 40, textAlign: 'center', color: sub }}>Loading…</div>
          ) : stock.length === 0 ? (
            <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 50, textAlign: 'center', color: sub }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🏭</div>
              <div>No stock items found.</div>
            </div>
          ) : (
            <div style={{ background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden' }}>
              {/* Inner scroll container with a constrained height — this is what the
                  sticky <thead> sticks to. Without a bounded scroll area the header
                  has nothing to stick within and scrolls away with the page. */}
              <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 340px)' }}>
                <table className="app-grid" style={{ ...rt.tableStyle, borderCollapse: 'collapse', fontSize: 12 }}>
                  <colgroup>
                    {rt.widths.map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                    <tr style={{ borderBottom: bd }}>
                      {(isSubcontractor
                        ? [{ label: 'ITEM/TAG', key: 'item_code' }, { label: 'DESCRIPTION', key: 'description' }, { label: 'HEAT' }, { label: 'WBS', key: 'wbs_code' }, { label: 'QTY', key: 'quantity' }, { label: 'UOM' }, { label: 'CONDITION', key: 'condition_status' }, { label: 'VENDOR', key: 'vendor_name' }]
                        : [{ label: 'LOCATION', key: 'location' }, { label: 'ITEM/TAG', key: 'item_code' }, { label: 'DESCRIPTION', key: 'description' }, { label: 'HEAT' }, { label: 'WBS', key: 'wbs_code' }, { label: 'QTY', key: 'quantity' }, { label: 'UOM' }, { label: 'CONDITION', key: 'condition_status' }, { label: 'VENDOR', key: 'vendor_name' }, { label: 'HOLD' }, { label: '' }]
                      ).map((h, i) => (
                        <th key={h.label || 'actions'} onClick={h.key ? () => toggleSort(h.key!) : undefined}
                          style={{ ...rt.thStyle(i), padding: '7px 12px', textAlign: 'center', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: h.key ? 'pointer' : 'default', userSelect: 'none' }}>
                          {h.label}{h.key ? sortArrow(h.key) : ''}
                          {rt.handle(i, dark)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stock.map(item => {
                      const cond = condPill(item.condition_status)
                      return (
                        <tr key={item.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                          {!isSubcontractor && <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub, ...ellipsisCell }}>{item.location_code || '—'}</td>}
                          <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600, ...ellipsisCell }}>{item.item_code}</td>
                          <td data-align="left" style={{ padding: '8px 12px', color: col, ...ellipsisCell }} title={item.description}>{item.description}</td>
                          <td style={{ padding: '8px 12px', fontSize: 11 }}>
                            {item.heat_number ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 86 }} title={item.heat_number}>{item.heat_number}</span>
                                {(() => { const b = certBadge(heatStatus[normHeat(item.heat_number)]?.status)
                                  return (
                                    <span onClick={e => { e.stopPropagation(); setHeatLink(item.heat_number!) }}
                                      title="View this heat's certificates"
                                      style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 6, background: b.bg, color: b.color, cursor: 'pointer', whiteSpace: 'nowrap' }}>{b.label}</span>
                                  ) })()}
                              </div>
                            ) : <span style={{ color: sub }}>—</span>}
                          </td>
                          <td data-align="left" style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub, ...ellipsisCell }}>{item.wbs_code || '—'}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col, fontWeight: 600, ...ellipsisCell }}>{Number(item.qty).toLocaleString()}</td>
                          <td style={{ padding: '8px 12px', color: sub, ...ellipsisCell }}>{item.uom}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 6, background: cond.bg, color: cond.color, fontWeight: 600 }}>{cond.label}</span>
                          </td>
                          <td data-align="left" style={{ padding: '8px 12px', color: sub, fontSize: 11, ...ellipsisCell }}>{item.vendor_name || '—'}</td>
                          {!isSubcontractor && (
                            <td style={{ padding: '8px 12px' }}>
                              {item.trace_hold ? <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 600 }}>hold</span> : <span style={{ color: sub }}>—</span>}
                            </td>
                          )}
                          {/* Subcontractors: no Docs/Move/Resolve buttons */}
                          {!isSubcontractor && (
                            <td style={{ padding: '8px 12px' }}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {item.condition_status === 'quarantine' ? (
                                  // Quarantined stock: resolve (release / reject) instead of move.
                                  <button onClick={() => setResolveItem(item)}
                                    style={{ padding: '4px 10px', borderRadius: 5, border: 'none', background: '#f59e0b', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>⚠ Resolve</button>
                                ) : (
                                  <>
                                    <button onClick={() => setDocsItem(item)}
                                      style={{ padding: '4px 10px', borderRadius: 5, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>📎 Docs</button>
                                    <button onClick={() => setMoveItem(item)}
                                      style={{ padding: '4px 10px', borderRadius: 5, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>→ Move</button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* Stock Take Modal */}
      {showStockTake && (
        <StockTakeModal dark={dark} stock={stock} onClose={() => setShowStockTake(false)} />
      )}

      {/* Move Modal */}
      {moveItem && (
        <MoveModal dark={dark} item={moveItem} projectId={projectId}
          onClose={() => setMoveItem(null)}
          onSaved={() => { setMoveItem(null); reload(); addToast('success', 'Item moved') }}
          addToast={addToast} />
      )}

      {/* Docs Panel */}
      {docsItem && (
        <DocsPanel dark={dark} item={docsItem} onClose={() => setDocsItem(null)} />
      )}

      {/* Resolve quarantine modal */}
      {resolveItem && (
        <ResolveModal dark={dark} item={resolveItem} projectId={projectId}
          onClose={() => setResolveItem(null)}
          onSaved={(msg) => { setResolveItem(null); reload(); addToast('success', msg) }}
          addToast={addToast} />
      )}

      {/* Heat/Lot P5 — heat → certificate(s) + holds (holding→cert direction) */}
      {heatLink && (
        <HeatLinkModal dark={dark} heat={heatLink} projectId={projectId} onClose={() => setHeatLink(null)} />
      )}
    </div>
  )
}

// ─── HEAT → CERT LINK MODAL (Heat/Lot P5) ─────────────────────
// From a stock holding's heat, show the certificate(s) carrying that heat
// (normalised, case-insensitive match) + any holds. Read-only.
const HeatLinkModal = ({ dark, heat, projectId, onClose }: {
  dark: boolean; heat: string; projectId: number; onClose: () => void
}) => {
  const col = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub = '#94a3b8'
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    axios.get(`${API}/traceability/${projectId}/heat/${encodeURIComponent(heat)}`)
      .then(({ data }) => setData(data)).catch(() => setData({ certs: [], holds: [] })).finally(() => setLoading(false))
  }, [heat]) // eslint-disable-line
  const certStatusColor: Record<string, string> = { verified: '#16a34a', pending: '#d97706', received: '#d97706', overdue: '#d97706', rejected: '#dc2626' }
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 24, width: 520, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: col }}>Heat <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#7c3aed' }}>{heat}</span> · certificates</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: sub, marginBottom: 14 }}>Mill certs / MTRs matched to this heat (case-insensitive).</div>
        {loading ? <div style={{ padding: 20, textAlign: 'center', color: sub }}>Loading…</div> : (
          <>
            {(data?.certs || []).length === 0 ? (
              <div style={{ padding: '14px', textAlign: 'center', color: sub, border: bd, borderRadius: 8 }}>No certificate on file for this heat.</div>
            ) : (data.certs).map((c: any) => (
              <div key={c.cert_id} style={{ border: bd, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 13, color: col, fontWeight: 600 }}>{c.document_name}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: `${certStatusColor[c.status] || '#94a3b8'}20`, color: certStatusColor[c.status] || '#94a3b8' }}>{c.status}</span>
                </div>
                <div style={{ fontSize: 11, color: sub, marginTop: 3 }}>{c.cert_type || c.category} · {c.vendor_name || '—'}{c.po_ref ? ` · ${c.po_ref}` : ''}{c.tag ? ` · tag ${c.tag}` : ''}</div>
                <div style={{ fontSize: 10, color: sub, marginTop: 2, fontFamily: 'JetBrains Mono, monospace' }}>heat_ref {c.heat_ref}{c.applies_to ? ` · ${c.applies_to}` : ''}</div>
              </div>
            ))}
            {(data?.holds || []).filter((h: any) => h.status === 'active').length > 0 && (
              <div style={{ marginTop: 8, border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 12px', background: 'rgba(239,68,68,0.05)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>⚠ Active hold(s) on this heat's cert</div>
                {(data.holds).filter((h: any) => h.status === 'active').map((h: any) => (
                  <div key={h.hold_id} style={{ fontSize: 11, color: col }}>{h.hold_reason} · {h.tag || h.item} · {h.age_days}d</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>,
    document.body,
  )
}

// ─── RESOLVE QUARANTINE MODAL ─────────────────────────────────
// Release a quarantined holding back to available (at a normal location)
// or reject it (remove from stock). Both require a mandatory reason.
const ResolveModal = ({ dark, item, projectId, onClose, onSaved, addToast }: {
  dark: boolean; item: StockItem; projectId: number; onClose: () => void
  onSaved: (msg: string) => void; addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const [action, setAction] = useState<'release'|'reject'>('release')
  const [reason, setReason] = useState('')
  const [toLocation, setToLocation] = useState('')
  const [saving, setSaving] = useState(false)
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

  const submit = async () => {
    if (!reason.trim()) { addToast('error', 'A reason is required'); return }
    if (action === 'release' && !toLocation.trim()) { addToast('error', 'A destination location is required to release'); return }
    setSaving(true)
    try {
      await axios.post(`${API}/mc/${projectId}/stock/${item.id}/resolve`, {
        action, reason: reason.trim(), to_location: action === 'release' ? toLocation.trim() : undefined,
      })
      onSaved(action === 'release' ? 'Released to available stock' : 'Rejected — removed from stock')
    } catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to resolve') }
    finally { setSaving(false) }
  }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 24, width: 440, maxWidth: '95vw', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: col, marginBottom: 4 }}>⚠ Resolve quarantined stock</div>
        <div style={{ fontSize: 12, color: sub, marginBottom: 4 }}>{item.item_code} · {item.description}</div>
        <div style={{ fontSize: 11, color: sub, marginBottom: 16, fontFamily: 'JetBrains Mono, monospace' }}>{Number(item.qty)} {item.uom} held at {item.location_code || 'QUARANTINE'}</div>

        {/* Action toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {([['release','Release → available','#22c55e'],['reject','Reject → remove','#ef4444']] as const).map(([val,label,bg]) => (
            <button key={val} onClick={() => setAction(val)}
              style={{ flex: 1, padding: '8px', borderRadius: 6, border: `2px solid ${action === val ? bg : bd}`, background: action === val ? bg : 'none', color: action === val ? '#fff' : col, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>
              {label}
            </button>
          ))}
        </div>

        {action === 'release' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Destination location *</label>
            <input value={toLocation} onChange={e => setToLocation(e.target.value)} placeholder="e.g. A-04-03" style={inputSt} />
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Reason *</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
            placeholder={action === 'release' ? 'Why is this stock fit for release?' : 'Why is this stock being rejected?'}
            style={{ ...inputSt, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={submit} disabled={saving}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: action === 'release' ? '#22c55e' : '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {saving ? 'Saving…' : (action === 'release' ? 'Release stock' : 'Reject stock')}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── STOCK TAKE MODAL ─────────────────────────────────────────
const StockTakeModal = ({ dark, stock, onClose }: { dark: boolean; stock: StockItem[]; onClose: () => void }) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const [counted, setCounted] = useState<Record<number, string>>({})
  const [maximized, setMaximized] = useState(false)
  const takeRef = useRef<HTMLDivElement>(null)
  useAutoTitle(takeRef, [stock, maximized])

  const matched = stock.filter(i => counted[i.id] !== undefined && Number(counted[i.id]) === Number(i.qty)).length
  const over    = stock.filter(i => counted[i.id] !== undefined && Number(counted[i.id]) > Number(i.qty)).length
  const under   = stock.filter(i => counted[i.id] !== undefined && Number(counted[i.id]) < Number(i.qty)).length
  const countedN = Object.keys(counted).length

  // Maximized uses fixed PX INSETS, not 96vw/92vh. The app's large-font /
  // accessibility setting puts a `zoom:1.15` ancestor above this modal, and
  // viewport units (vw/vh) ignore ancestor zoom — so 96vw rendered ~15% too
  // wide and the modal overflowed the viewport, clipping the footer button.
  // Pinning all four edges in px is zoom-safe (width = viewport − insets).
  const frame: React.CSSProperties = maximized
    ? { top: 16, left: 16, right: 16, bottom: 16 }
    : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, maxWidth: '95vw', maxHeight: '85vh' }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      {/* Flex column: header + KPI + footer are pinned (flexShrink 0); only the
          table area scrolls (both axes). The modal itself never scrolls, so the
          footer button can't be pushed off-screen in either state. */}
      <div style={{ position: 'fixed', ...frame, background: cardBg, border: bd, borderRadius: 12, padding: 28, overflow: 'hidden', display: 'flex', flexDirection: 'column', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col }}>📋 Stock take · Physical count</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>Cycle count or full count — variances generate adjustment proposals</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {/* Expand / shrink — shared control, matches the other detail modals (keeps
                the fixed-px maximize frame below; only the button is unified) */}
            <ExpandBtn expanded={maximized} onToggle={() => setMaximized(m => !m)} color={sub} />
            <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16, flexShrink: 0 }}>
          {[
            ['SCOPE',    `${stock.length} lines`],
            ['COUNTED',  `${countedN} / ${stock.length}`],
            ['MATCHED',  String(matched)],
            ['OVER/UNDER', `${over} / ${under}`],
          ].map(([k,v]) => (
            <div key={k} style={{ background: dark ? '#162032' : '#f8fafc', border: bd, borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: sub, marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: col }}>{v}</div>
            </div>
          ))}
        </div>

        <div ref={takeRef} style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'auto', maxHeight: maximized ? undefined : 340 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: dark ? '#162032' : '#f8fafc', borderBottom: bd }}>
                {['GRID','ITEM','DESCRIPTION','HEAT','UOM','SYSTEM','COUNTED','VARIANCE','NOTE'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: 'center', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stock.map(item => {
                const cnt = counted[item.id]
                const variance = cnt !== undefined ? Number(cnt) - Number(item.qty) : null
                return (
                  <tr key={item.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                    <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{item.location_code}</td>
                    <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb' }}>{item.item_code}</td>
                    <td style={{ padding: '7px 10px', color: col, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</td>
                    <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: item.heat_number ? col : sub }}>{item.heat_number || '—'}</td>
                    <td style={{ padding: '7px 10px', color: sub }}>{item.uom}</td>
                    <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{item.qty}</td>
                    <td style={{ padding: '7px 10px' }}>
                      <input type="number" value={cnt ?? ''} placeholder="—" min={0}
                        onChange={e => setCounted(p => ({ ...p, [item.id]: e.target.value }))}
                        style={{ width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 4, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }} />
                    </td>
                    <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: variance === null ? sub : variance === 0 ? '#22c55e' : variance > 0 ? '#f59e0b' : '#ef4444' }}>
                      {variance === null ? '—' : variance === 0 ? '✓' : variance > 0 ? `+${variance}` : String(variance)}
                    </td>
                    <td style={{ padding: '7px 10px' }}><input placeholder="—" style={{ width: 80, fontSize: 11, padding: '3px 6px', borderRadius: 4, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col }} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, flexShrink: 0 }}>
          <button onClick={onClose}
            style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: countedN > 0 ? '#2563eb' : '#94a3b8', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Review summary →
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── MOVE MODAL ───────────────────────────────────────────────
const MoveModal = ({ dark, item, projectId, onClose, onSaved, addToast }: {
  dark: boolean; item: StockItem; projectId: number; onClose: () => void; onSaved: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const [newLoc, setNewLoc] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!newLoc.trim()) { addToast('error', 'New location is required'); return }
    setSaving(true)
    try {
      await axios.put(`${API}/mc/${projectId}/stock/${item.id}/move`, { new_location: newLoc.trim() })
      onSaved()
    } catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to move item') }
    finally { setSaving(false) }
  }

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 24, width: 400, zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: col, marginBottom: 4 }}>Move stock item</div>
        <div style={{ fontSize: 12, color: sub, marginBottom: 16 }}>{item.item_code} · {item.description}</div>
        <div style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Current location</label>
          <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: sub }}>{item.location_code || '—'} · {item.warehouse_name}</div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>New location *</label>
          <input value={newLoc} onChange={e => setNewLoc(e.target.value)} placeholder="e.g. WH-A · A-08-02"
            style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {saving ? 'Moving…' : 'Confirm move'}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

// ─── DOCS PANEL ───────────────────────────────────────────────
const DocsPanel = ({ dark, item, onClose }: { dark: boolean; item: StockItem; onClose: () => void }) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const [expanded, toggleExpand] = useExpand()

  const docGroups = [
    { label: 'Commercial', docs: [{ name: 'Commercial Invoice', size: '214 kB' }, { name: 'Packing list', size: '128 kB' }, { name: 'Bill of Lading', size: '75 kB' }] },
    { label: 'Technical / Trace', docs: [{ name: 'Mill test certificates', size: '1.2 MB' }, { name: 'Material data sheet', size: '489 kB' }] },
    { label: 'Inspection', docs: [{ name: 'TPI inspection report', size: '2.1 MB' }, { name: 'FAT completion certificate', size: '338 kB' }] },
    { label: 'DG / Handling', docs: [] },
  ]

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: expanded ? '95vw' : 460, maxWidth: '95vw', background: cardBg, borderLeft: bd, zIndex: 6001, display: 'flex', flexDirection: 'column', fontFamily: 'IBM Plex Sans, sans-serif' }}>
        <div style={{ padding: '16px 20px', borderBottom: bd, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: col }}>SCN Documents</div>
            <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>{item.item_code}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <ExpandBtn expanded={expanded} onToggle={toggleExpand} color={sub} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {docGroups.map(g => (
            <div key={g.label} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: sub, textTransform: 'uppercase', marginBottom: 8 }}>
                ▾ {g.label} {g.docs.length > 0 && <span style={{ color: col }}>({g.docs.length} files)</span>}
              </div>
              {g.docs.length === 0 ? (
                <div style={{ fontSize: 11, color: sub, fontStyle: 'italic' }}>No documents uploaded yet</div>
              ) : g.docs.map(d => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 700 }}>PDF</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: col }}>{d.name}</div>
                    <div style={{ fontSize: 10, color: sub }}>{d.size}</div>
                  </div>
                  <button style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>↓</button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 20px', borderTop: bd, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: sub }}>7 documents · 4.9 MB</span>
          <button style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>↓ Download all (ZIP)</button>
        </div>
      </div>
    </>,
    document.body,
  )
}

export const MCStockRegisterScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider><MCStockRegisterInner {...props} /></ToastProvider>
)
