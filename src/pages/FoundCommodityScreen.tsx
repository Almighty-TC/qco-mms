// ─── FOUNDATIONAL COMMODITY LIBRARY SCREEN ──────────────────
import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { CertificatesModal } from '../components/CertificatesModal'
import { HelpButton } from '../components/HelpDrawer'
import { COMMODITY_HELP } from '../helpContent'
import { BackButton } from '../components/BackButton'
import { MilestoneLegend } from '../components/MilestoneLegend'

const API = 'http://localhost:3001/api'

// ─── TYPES ──────────────────────────────────────────────────
interface Commodity {
  id: number
  project_id: number
  code: string
  name: string
  uom: string
  wbs_code: string | null
  wbs_node_id: number | null
  estimated_qty: number | null
  trace_level: string
  preservation: string
  preferred_vendor: string | null
  notes: string | null
  status: 'active' | 'inactive'
  cert_count: number
}

interface WBSNode { id: number; code: string; description: string }

const TRACE_LEVELS = ['Heat number', 'Heat + cert', 'Mill cert', 'Drum number', 'Serial', 'None']
const PRESERVATIONS = ['None', 'Dry storage', 'Climate controlled', 'Painted-wrapped', 'N2 purge']
const UOMS = ['EA', 'M', 'M²', 'M³', 'KG', 'T', 'LT', 'SET', 'LOT']

const TRACE_COLORS: Record<string, string> = {
  'Heat number': '#2563eb', 'Heat + cert': '#7c3aed', 'Mill cert': '#0891b2',
  'Drum number': '#b45309', 'Serial': '#15803d', 'None': '#64748b',
}

// ─── ADD/EDIT COMMODITY MODAL ────────────────────────────────
const CommodityModal = ({ projectId, wbsNodes, item, dark, onClose, onSaved }: {
  projectId: number; wbsNodes: WBSNode[]; item: Commodity | null
  dark: boolean; onClose: () => void; onSaved: (c: Commodity) => void
}) => {
  const editing = !!item
  const [code,     setCode]   = useState(item?.code ?? '')
  const [name,     setName]   = useState(item?.name ?? '')
  const [uom,      setUom]    = useState(item?.uom ?? 'EA')
  const [wbs,      setWbs]    = useState(item?.wbs_code ?? '')
  const [qty,      setQty]    = useState(String(item?.estimated_qty ?? ''))
  const [trace,    setTrace]  = useState(item?.trace_level ?? 'None')
  const [pres,     setPres]   = useState(item?.preservation ?? 'None')
  const [vendor,   setVendor] = useState(item?.preferred_vendor ?? '')
  const [notes,    setNotes]  = useState(item?.notes ?? '')
  const [status,   setStatus] = useState(item?.status ?? 'active')
  const [saving,   setSaving] = useState(false)
  const [err,      setErr]    = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'

  const wbsNode = wbsNodes.find(n => n.code === wbs)
  const valid = code.trim() && name.trim() && wbs.trim()

  const inp = { height: 34, padding: '0 10px', borderRadius: 6, width: '100%', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }
  const label = (t: string) => <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase' as const, marginBottom: 4, marginTop: 10 }}>{t}</div>

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const payload = { name, uom, wbs_code: wbs, wbs_node_id: wbsNode?.id ?? null, estimated_qty: qty ? Number(qty) : null, trace_level: trace, preservation: pres, preferred_vendor: vendor || null, notes: notes || null, status }
      let result: Commodity
      if (editing && item) {
        const { data } = await axios.patch(`${API}/foundational/${projectId}/commodities/${item.id}`, payload)
        result = data
      } else {
        const { data } = await axios.post(`${API}/foundational/${projectId}/commodities`, { code: code.trim(), ...payload })
        result = data
      }
      onSaved(result)
      onClose()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      setErr(er.response?.data?.error ?? 'Save failed')
      setSaving(false)
    }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 28, width: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.4)', fontFamily: 'IBM Plex Sans, sans-serif', border: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: col }}>{editing ? 'Edit Commodity' : 'Add Commodity'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div>
            {label('Commodity code *')}
            <input value={code} onChange={e => setCode(e.target.value)} disabled={editing} placeholder="e.g. A516-GR70"
              style={{ ...inp, fontFamily: 'JetBrains Mono, monospace', opacity: editing ? 0.6 : 1 }} />
          </div>
          <div>
            {label('WBS *')}
            <select value={wbs} onChange={e => setWbs(e.target.value)} style={{ ...inp }}>
              <option value="">— Select WBS</option>
              {wbsNodes.map(n => <option key={n.id} value={n.code}>{n.code} — {n.description}</option>)}
            </select>
          </div>
        </div>

        {label('Name / description *')}
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Carbon Steel Plate A516 Gr.70"
          style={inp} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div>
            {label('Unit of measure')}
            <select value={uom} onChange={e => setUom(e.target.value)} style={{ ...inp }}>
              {UOMS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            {label('Estimated qty')}
            <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="0.000"
              style={{ ...inp, fontFamily: 'JetBrains Mono, monospace' }} />
          </div>
          <div>
            {label('Trace level')}
            <select value={trace} onChange={e => setTrace(e.target.value)} style={inp}>
              {TRACE_LEVELS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            {label('Preservation')}
            <select value={pres} onChange={e => setPres(e.target.value)} style={inp}>
              {PRESERVATIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {label('Preferred vendor')}
        <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. BlueScope Steel"
          style={inp} />

        {label('Notes')}
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          style={{ ...inp, height: 68, resize: 'vertical', padding: '8px 10px', lineHeight: '1.5' }} />

        {editing && (
          <>
            {label('Status')}
            <select value={status} onChange={e => setStatus(e.target.value as 'active' | 'inactive')} style={inp}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </>
        )}

        {err && <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '6px 10px' }}>{err}</div>}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: valid ? '#22c55e' : '#94a3b8' }}>
            {valid ? '✓ Ready to save' : 'Required: code, name and WBS'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={save} disabled={!valid || saving}
              style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: (!valid || saving) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!valid || saving) ? 0.5 : 1 }}>
              {saving ? 'Saving…' : `✓ ${editing ? 'Save changes' : 'Add commodity'}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── STATUS PILL ─────────────────────────────────────────────
const StatusPill = ({ status }: { status: 'active' | 'inactive' }) => (
  <span style={{ background: status === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.15)', color: status === 'active' ? '#15803d' : '#64748b', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, letterSpacing: '0.04em' }}>
    {status === 'active' ? 'Active' : 'Inactive'}
  </span>
)

// ─── MAIN SCREEN ─────────────────────────────────────────────
export const FoundCommodityScreen = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const [items, setItems]   = useState<Commodity[]>([])
  const [wbsNodes, setWbs]  = useState<WBSNode[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState<'all' | 'active' | 'inactive'>('all')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'none' | 'wbs' | 'vendor'>('none')
  const [sortCol, setSortCol] = useState<string>('code')
  const [sortAsc, setSortAsc] = useState(true)
  const [addModal, setAddModal] = useState(false)
  const [editItem, setEditItem] = useState<Commodity | null>(null)
  const [certsItem, setCertsItem] = useState<Commodity | null>(null)
  const [toast, setToast]   = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd  = `1px solid ${dark ? '#334155' : '#dde3ed'}`

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, wRes] = await Promise.all([
        axios.get(`${API}/foundational/${projectId}/commodities`),
        axios.get(`${API}/foundational/${projectId}/wbs`),
      ])
      setItems(cRes.data)
      setWbs(wRes.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { load() }, [load])

  // Filter
  const filtered = items.filter(c => {
    if (tab === 'active' && c.status !== 'active') return false
    if (tab === 'inactive' && c.status !== 'inactive') return false
    if (search) {
      const q = search.toLowerCase()
      return c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) ||
             (c.wbs_code?.toLowerCase().includes(q) ?? false) ||
             (c.preferred_vendor?.toLowerCase().includes(q) ?? false)
    }
    return true
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortCol] as string ?? ''
    const bv = (b as unknown as Record<string, unknown>)[sortCol] as string ?? ''
    return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
  })

  const toggleSort = (col: string) => { if (sortCol === col) setSortAsc(p => !p); else { setSortCol(col); setSortAsc(true) } }
  const sortArrow = (c: string) => sortCol === c ? (sortAsc ? ' ↑' : ' ↓') : ''

  // Group
  const grouped: Record<string, Commodity[]> = {}
  if (groupBy !== 'none') {
    for (const c of sorted) {
      const key = groupBy === 'wbs' ? (c.wbs_code ?? '—') : (c.preferred_vendor ?? 'Unassigned')
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(c)
    }
  }

  const counts = { all: items.length, active: items.filter(c => c.status === 'active').length, inactive: items.filter(c => c.status === 'inactive').length }

  const thStyle = (c: string): React.CSSProperties => ({
    padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em',
    textTransform: 'uppercase', textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
    borderBottom: bd,
  })

  const renderRows = (list: Commodity[]) => list.map(c => (
    <tr key={c.id} style={{ background: dark ? '#1e293b' : '#fff', borderBottom: bd }}
      onMouseEnter={e => { e.currentTarget.style.background = dark ? '#1e2d4a' : '#f4f7fb' }}
      onMouseLeave={e => { e.currentTarget.style.background = dark ? '#1e293b' : '#fff' }}>
      <td style={{ padding: '9px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: col, whiteSpace: 'nowrap' }}>{c.code}</td>
      <td style={{ padding: '9px 10px', fontSize: 13, color: c.status === 'inactive' ? '#94a3b8' : col, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</td>
      <td style={{ padding: '9px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>{c.uom}</td>
      <td style={{ padding: '9px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{c.wbs_code ?? '—'}</td>
      <td style={{ padding: '9px 10px' }}>
        <span style={{ background: `${TRACE_COLORS[c.trace_level] ?? '#64748b'}20`, color: TRACE_COLORS[c.trace_level] ?? '#64748b', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 9999, whiteSpace: 'nowrap' }}>{c.trace_level}</span>
      </td>
      <td style={{ padding: '9px 10px', fontSize: 12, color: c.preservation === 'None' ? '#94a3b8' : col, whiteSpace: 'nowrap' }}>{c.preservation}</td>
      <td style={{ padding: '9px 10px', fontSize: 12, color: '#64748b', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preferred_vendor ?? '—'}</td>
      <td style={{ padding: '9px 10px' }}><StatusPill status={c.status} /></td>
      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
        <button onClick={() => setCertsItem(c)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.cert_count > 0 ? '#2563eb' : '#94a3b8', fontSize: 12, padding: '2px 6px', marginRight: 4, fontFamily: 'inherit' }}
          title={`${c.cert_count} certificate${c.cert_count !== 1 ? 's' : ''}`}>
          📎{c.cert_count > 0 && <span style={{ fontSize: 10, marginLeft: 2 }}>{c.cert_count}</span>}
        </button>
        <button onClick={() => setEditItem(c)}
          style={{ background: 'none', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, cursor: 'pointer', color: '#64748b', fontSize: 11, padding: '3px 8px', borderRadius: 5, fontFamily: 'inherit' }}>
          Edit
        </button>
      </td>
    </tr>
  ))

  const tableHead = (
    <thead>
      <tr style={{ background: dark ? '#0f172a' : '#f4f7fb', position: 'sticky', top: 0, zIndex: 2 }}>
        {[['code','Code'],['name','Name'],['uom','UOM'],['wbs_code','WBS'],['trace_level','Trace level'],['preservation','Preserve'],['preferred_vendor','Vendor'],['status','Status']].map(([k,l]) => (
          <th key={k} style={thStyle(k)} onClick={() => toggleSort(k)}>{l}{sortArrow(k)}</th>
        ))}
        <th style={{ padding: '8px 10px', borderBottom: bd, textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Actions</th>
      </tr>
    </thead>
  )

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>← Dashboard</button>
        <span>›</span><span>{projectName}</span><span>›</span><span>Foundational</span><span>›</span>
        <span style={{ color: col, fontWeight: 600 }}>Commodity Library</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>📦 Commodity Library</h2>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3 }}>{items.length} commodit{items.length !== 1 ? 'ies' : 'y'} · {projectName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={async () => {
            try {
              const res = await axios.get(`${API}/foundational/${projectId}/commodities/template`, { responseType: 'blob' })
              const url = URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
              const a = document.createElement('a'); a.href = url; a.download = 'Commodity_Upload_Template.xlsx'
              document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
            } catch { /* ignore */ }
          }}
            style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↓ Template</button>
          <button style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↑ Upload</button>
          <HelpButton screenName="Commodity Library" sections={COMMODITY_HELP} dark={dark} />
          <button onClick={() => setAddModal(true)} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add commodity</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(['all', 'active', 'inactive'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${tab === t ? '#2563eb' : (dark ? '#334155' : '#dde3ed')}`, background: tab === t ? '#2563eb' : 'none', color: tab === t ? '#fff' : '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: tab === t ? 600 : 400 }}>
            {t === 'all' ? 'All items' : t.charAt(0).toUpperCase() + t.slice(1)} <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.8 }}>{counts[t]}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code, name, WBS, vendor…"
          style={{ flex: 1, height: 34, padding: '0 12px', borderRadius: 6, border: bd, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
        <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
          Group by:
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as 'none' | 'wbs' | 'vendor')}
            style={{ height: 32, padding: '0 8px', borderRadius: 6, border: bd, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
            <option value="none">None</option>
            <option value="wbs">WBS</option>
            <option value="vendor">Vendor</option>
          </select>
        </label>
      </div>

      {/* Table */}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: bd, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 330px)' }}>
          {loading ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              {tableHead}
              <tbody>
                {groupBy === 'none' ? (
                  sorted.length === 0
                    ? <tr><td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No commodities found.</td></tr>
                    : renderRows(sorted)
                ) : (
                  Object.entries(grouped).sort(([a],[b]) => a.localeCompare(b)).map(([grp, grpItems]) => (
                    <>
                      <tr key={`grp-${grp}`} style={{ background: dark ? '#0f172a' : '#f8fafc' }}>
                        <td colSpan={9} style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.07em', textTransform: 'uppercase', borderBottom: bd }}>
                          {grp} <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>{grpItems.length}</span>
                        </td>
                      </tr>
                      {renderRows(grpItems)}
                    </>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
        <MilestoneLegend dark={dark} />
      </div>

      {/* Modals */}
      {(addModal || editItem) && (
        <CommodityModal
          projectId={projectId} wbsNodes={wbsNodes} item={editItem} dark={dark}
          onClose={() => { setAddModal(false); setEditItem(null) }}
          onSaved={saved => {
            setItems(prev => editItem ? prev.map(c => c.id === saved.id ? saved : c) : [saved, ...prev])
            showToast(`✓ Commodity ${saved.code} ${editItem ? 'updated' : 'added'}`)
            setAddModal(false); setEditItem(null)
          }}
        />
      )}
      {certsItem && (
        <CertificatesModal
          projectId={projectId} entityType="commodity" entityId={certsItem.id}
          entityCode={certsItem.code} entityName={certsItem.name} dark={dark}
          onClose={() => { setCertsItem(null); load() }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#0d1117', border: '1px solid rgba(34,197,94,0.28)', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 500, color: '#f1f5f9', zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 8px 28px rgba(0,0,0,0.45)', pointerEvents: 'none' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
