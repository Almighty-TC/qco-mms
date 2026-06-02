// ─── MC STOCK REGISTER ────────────────────────────────────────
// Searchable warehouse stock across warehouses.
// Group by: Warehouse / WBS / Item. Stock take modal. Move modal.
import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
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

  const [stock, setStock]     = useState<StockItem[]>([])
  const [totals, setTotals]   = useState<any>(null)
  const [wbsScopes, setWbsScopes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('warehouse')
  const [showHolds, setShowHolds] = useState(false)
  const [showStockTake, setShowStockTake] = useState(false)
  const [moveItem, setMoveItem] = useState<StockItem | null>(null)
  const [docsItem, setDocsItem] = useState<StockItem | null>(null)
  const [resolveItem, setResolveItem] = useState<StockItem | null>(null)

  const fetchStock = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/mc/${projectId}/stock`, {
        params: { search: search.trim() || undefined, show_holds: showHolds ? 'true' : undefined }
      })
      setStock(data.data || [])
      setTotals(data.totals)
      if (data.wbs_scopes) setWbsScopes(data.wbs_scopes)
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to load stock register')
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchStock() }, [projectId, showHolds]) // eslint-disable-line
  useEffect(() => {
    const t = setTimeout(fetchStock, 350)
    return () => clearTimeout(t)
  }, [search]) // eslint-disable-line

  // Group stock
  const grouped = stock.reduce((acc, item) => {
    const key = groupBy === 'warehouse' ? `${item.warehouse_name} (${item.warehouse_code})` :
                groupBy === 'wbs'       ? (item.wbs_code || 'No WBS') :
                                          item.item_code
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {} as Record<string, StockItem[]>)

  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit' }

  // Truncated cells get a hover tooltip; re-runs when rows/grouping change.
  const tablesRef = useRef<HTMLDivElement>(null)
  useAutoTitle(tablesRef, [stock, groupBy, showHolds, loading])

  return (
    <div style={{ background: bg, minHeight: '100vh', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ background: cardBg, borderBottom: bd, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onClick={onBack} dark={dark} />
          <div style={{ fontSize: 11, color: sub }}>Dashboard › {projectName} › Material Control › <strong style={{ color: col }}>Stock Register</strong></div>
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
              return (
                <button key={g} onClick={() => setGroupBy(val)}
                  style={{ padding: '6px 12px', border: 'none', background: groupBy === val ? '#E84E0F' : 'none', color: groupBy === val ? '#fff' : sub, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                  {g}
                </button>
              )
            })}
          </div>
        </div>

        {/* Table grouped */}
        <div ref={tablesRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading ? (
            <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 40, textAlign: 'center', color: sub }}>Loading…</div>
          ) : Object.entries(grouped).map(([groupKey, items]) => (
            <div key={groupKey} style={{ background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden' }}>
              {/* Group header */}
              <div style={{ padding: '8px 14px', background: dark ? '#162032' : '#f8fafc', borderBottom: bd, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: col }}>{groupKey}</span>
                <span style={{ fontSize: 11, color: sub }}>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                {items.some(i => i.trace_hold) && (
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 600 }}>HOLD</span>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: isSubcontractor ? STOCK_MINW_SUB : STOCK_MINW, borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                  <colgroup>
                    {(isSubcontractor ? STOCK_COLS_SUB : STOCK_COLS).map((w, i) => <col key={i} style={{ width: w }} />)}
                  </colgroup>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                    <tr style={{ borderBottom: bd }}>
                      {(isSubcontractor ? ['ITEM/TAG','DESCRIPTION','HEAT','WBS','QTY','UOM','CONDITION','VENDOR'] : ['LOCATION','ITEM/TAG','DESCRIPTION','HEAT','WBS','QTY','UOM','CONDITION','VENDOR','HOLD','']).map(h => (
                        <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => {
                      const cond = condPill(item.condition_status)
                      return (
                        <tr key={item.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                          {!isSubcontractor && <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub, ...ellipsisCell }}>{item.location_code || '—'}</td>}
                          <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600, ...ellipsisCell }}>{item.item_code}</td>
                          <td style={{ padding: '8px 12px', color: col, ...ellipsisCell }} title={item.description}>{item.description}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: item.heat_number ? col : sub, ...ellipsisCell }}>{item.heat_number || '—'}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub, ...ellipsisCell }}>{item.wbs_code || '—'}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col, fontWeight: 600, ...ellipsisCell }}>{Number(item.qty).toLocaleString()}</td>
                          <td style={{ padding: '8px 12px', color: sub, ...ellipsisCell }}>{item.uom}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 6, background: cond.bg, color: cond.color, fontWeight: 600 }}>{cond.label}</span>
                          </td>
                          <td style={{ padding: '8px 12px', color: sub, fontSize: 11, ...ellipsisCell }}>{item.vendor_name || '—'}</td>
                          <td style={{ padding: '8px 12px' }}>
                            {item.trace_hold ? <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 600 }}>hold</span> : <span style={{ color: sub }}>—</span>}
                          </td>
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
          ))}
          {!loading && Object.keys(grouped).length === 0 && (
            <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 50, textAlign: 'center', color: sub }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🏭</div>
              <div>No stock items found.</div>
            </div>
          )}
        </div>
      </div>

      {/* Stock Take Modal */}
      {showStockTake && (
        <StockTakeModal dark={dark} stock={stock} onClose={() => setShowStockTake(false)} />
      )}

      {/* Move Modal */}
      {moveItem && (
        <MoveModal dark={dark} item={moveItem} projectId={projectId}
          onClose={() => setMoveItem(null)}
          onSaved={() => { setMoveItem(null); fetchStock(); addToast('success', 'Item moved') }}
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
          onSaved={(msg) => { setResolveItem(null); fetchStock(); addToast('success', msg) }}
          addToast={addToast} />
      )}
    </div>
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

  return (
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
    </>
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

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      {/* Flex column: header + KPI + footer are pinned (flexShrink 0); only the
          table area scrolls (both axes). The modal itself never scrolls, so the
          footer button can't be pushed off-screen in either state. */}
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 28, width: maximized ? '96vw' : 700, maxWidth: maximized ? '96vw' : '95vw', height: maximized ? '92vh' : undefined, maxHeight: maximized ? '92vh' : '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col }}>📋 Stock take · Physical count</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>Cycle count or full count — variances generate adjustment proposals</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {/* Maximize / restore — grows the modal to near-full-screen and back */}
            <button onClick={() => setMaximized(m => !m)} title={maximized ? 'Restore' : 'Maximize'}
              style={{ background: 'none', border: 'none', fontSize: 16, color: sub, cursor: 'pointer' }}>{maximized ? '⤡' : '⤢'}</button>
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
                  <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>
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
    </>
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

  return (
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
    </>
  )
}

// ─── DOCS PANEL ───────────────────────────────────────────────
const DocsPanel = ({ dark, item, onClose }: { dark: boolean; item: StockItem; onClose: () => void }) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'

  const docGroups = [
    { label: 'Commercial', docs: [{ name: 'Commercial Invoice', size: '214 kB' }, { name: 'Packing list', size: '128 kB' }, { name: 'Bill of Lading', size: '75 kB' }] },
    { label: 'Technical / Trace', docs: [{ name: 'Mill test certificates', size: '1.2 MB' }, { name: 'Material data sheet', size: '489 kB' }] },
    { label: 'Inspection', docs: [{ name: 'TPI inspection report', size: '2.1 MB' }, { name: 'FAT completion certificate', size: '338 kB' }] },
    { label: 'DG / Handling', docs: [] },
  ]

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 360, background: cardBg, borderLeft: bd, zIndex: 6001, display: 'flex', flexDirection: 'column', fontFamily: 'IBM Plex Sans, sans-serif' }}>
        <div style={{ padding: '16px 20px', borderBottom: bd, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: col }}>SCN Documents</div>
            <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>{item.item_code}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
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
    </>
  )
}

export const MCStockRegisterScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider><MCStockRegisterInner {...props} /></ToastProvider>
)
