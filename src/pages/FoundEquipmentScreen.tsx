// ─── FOUNDATIONAL EQUIPMENT LIST SCREEN ─────────────────────
import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { CertificatesModal } from '../components/CertificatesModal'
import { HelpButton } from '../components/HelpDrawer'
import { EQUIPMENT_HELP } from '../helpContent'
import { BackButton } from '../components/BackButton'
import { MilestoneLegend } from '../components/MilestoneLegend'
import { Pager } from '../components/Pager'
import { usePagedList } from '../hooks/usePagedList'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'

// Resizable column defaults — equipment list (8 cols).
const FE_W   = [110, 220, 150, 90, 110, 150, 100, 90]
const FE_MIN = [80, 120, 90, 60, 70, 100, 70, 70]
import { isApprovalRequired, submitForApproval, approvalToast } from '../lib/pendingChanges'

const API = 'http://localhost:3001/api'

// ─── TYPES ──────────────────────────────────────────────────
interface Equipment {
  id: number
  project_id: number
  tag: string
  equipment_type: string
  wbs_code: string | null
  wbs_node_id: number | null
  description: string
  area_location: string | null
  criticality: string
  spec: string | null
  trace_class: string
  po_reference: string | null
  vendor: string | null
  weight_kg: number | null
  size_lwh: string | null
  notes: string | null
  status: string
  cert_count: number
}

interface WBSNode { id: number; code: string; description: string }

const EQUIP_TYPES = ['Vessel','Pump','Compressor','Heat exchanger','Tank','Filter','Valve','Motor','Skid','Instrument','Pipe spool','Structural','Cable drum','Panel','Package']
const CRITICALITIES = ['A-Critical', 'B-Major', 'C-Standard']
const TRACE_CLASSES = ['None', 'Class I', 'Class II']
const STATUSES = ['Not started', 'RFQ', 'PO raised', 'On site', 'In transit']

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'PO raised':   { bg: 'rgba(34,197,94,0.12)',  text: '#15803d' },
  'RFQ':         { bg: 'rgba(37,99,235,0.12)',  text: '#1d4ed8' },
  'Not started': { bg: 'rgba(148,163,184,0.15)', text: '#64748b' },
  'On site':     { bg: 'rgba(34,197,94,0.12)',  text: '#15803d' },
  'In transit':  { bg: 'rgba(245,158,11,0.12)', text: '#b45309' },
}

const CRIT_COLORS: Record<string, string> = {
  'A-Critical': '#ef4444', 'B-Major': '#f59e0b', 'C-Standard': '#64748b',
}

// ─── ADD/EDIT EQUIPMENT MODAL ─────────────────────────────────
const EquipmentModal = ({ projectId, wbsNodes, item, dark, onClose, onSaved, onQueued }: {
  projectId: number; wbsNodes: WBSNode[]; item: Equipment | null
  dark: boolean; onClose: () => void; onSaved: (e: Equipment) => void
  onQueued: (msg: string) => void
}) => {
  const editing = !!item
  const [tag,    setTag]    = useState(item?.tag ?? '')
  const [type,   setType]   = useState(item?.equipment_type ?? 'Vessel')
  const [wbs,    setWbs]    = useState(item?.wbs_code ?? '')
  const [desc,   setDesc]   = useState(item?.description ?? '')
  const [area,   setArea]   = useState(item?.area_location ?? '')
  const [crit,   setCrit]   = useState(item?.criticality ?? 'C-Standard')
  const [spec,   setSpec]   = useState(item?.spec ?? '')
  const [trace,  setTrace]  = useState(item?.trace_class ?? 'None')
  const [poRef,  setPoRef]  = useState(item?.po_reference ?? '')
  const [vendor, setVendor] = useState(item?.vendor ?? '')
  const [weight, setWeight] = useState(String(item?.weight_kg ?? ''))
  const [size,   setSize]   = useState(item?.size_lwh ?? '')
  const [notes,  setNotes]  = useState(item?.notes ?? '')
  const [status, setStatus] = useState(item?.status ?? 'Not started')
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'

  const wbsNode = wbsNodes.find(n => n.code === wbs)
  const valid = tag.trim() && desc.trim() && wbs.trim()

  const inp = { height: 34, padding: '0 10px', borderRadius: 6, width: '100%', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }
  const label = (t: string) => <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase' as const, marginBottom: 4, marginTop: 10 }}>{t}</div>

  const save = async () => {
    setSaving(true); setErr('')
    const payload = {
      equipment_type: type, wbs_code: wbs, wbs_node_id: wbsNode?.id ?? null,
      description: desc.trim(), area_location: area || null, criticality: crit,
      spec: spec || null, trace_class: trace, po_reference: poRef || null,
      vendor: vendor || null, weight_kg: weight ? Number(weight) : null,
      size_lwh: size || null, notes: notes || null, status,
    }
    try {
      let result: Equipment
      if (editing && item) {
        const { data } = await axios.patch(`${API}/foundational/${projectId}/equipment/${item.id}`, payload)
        result = data
      } else {
        const { data } = await axios.post(`${API}/foundational/${projectId}/equipment`, { tag: tag.trim(), ...payload })
        result = data
      }
      onSaved(result)
      onClose()
    } catch (e: unknown) {
      // Proposer roles can't create equipment directly (edits are free) — the
      // create is intercepted with a requiresApproval 409. Stage it for confirmation.
      if (isApprovalRequired(e)) {
        try {
          const r = await submitForApproval(projectId, 'equipment', 'create', { tag: tag.trim(), ...payload })
          onQueued(`✓ ${approvalToast(r)}`)
          onClose()
        } catch (se: unknown) {
          const ser = se as { response?: { data?: { error?: string } } }
          setErr(ser.response?.data?.error ?? 'Could not submit to approval queue')
          setSaving(false)
        }
        return
      }
      const er = e as { response?: { data?: { error?: string } } }
      setErr(er.response?.data?.error ?? 'Save failed')
      setSaving(false)
    }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 28, width: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.4)', fontFamily: 'IBM Plex Sans, sans-serif', border: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: col }}>{editing ? 'Edit Equipment' : 'Add Equipment'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' }}>
          <div>
            {label('Equipment tag *')}
            <input value={tag} onChange={e => setTag(e.target.value)} disabled={editing} placeholder="e.g. P-101A"
              style={{ ...inp, fontFamily: 'JetBrains Mono, monospace', opacity: editing ? 0.6 : 1 }} />
          </div>
          <div>
            {label('Equipment type')}
            <select value={type} onChange={e => setType(e.target.value)} style={inp}>
              {EQUIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            {label('WBS *')}
            <select value={wbs} onChange={e => setWbs(e.target.value)} style={inp}>
              <option value="">— Select WBS</option>
              {wbsNodes.map(n => <option key={n.id} value={n.code}>{n.code} — {n.description}</option>)}
            </select>
          </div>
        </div>

        {label('Description *')}
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Condensate Transfer Pump"
          style={inp} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' }}>
          <div>
            {label('Area / location')}
            <input value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. Pump Deck A" style={inp} />
          </div>
          <div>
            {label('Criticality')}
            <select value={crit} onChange={e => setCrit(e.target.value)} style={inp}>
              {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            {label('PO reference')}
            <input value={poRef} onChange={e => setPoRef(e.target.value)} placeholder="e.g. PO-2024-001"
              style={{ ...inp, fontFamily: 'JetBrains Mono, monospace' }} />
          </div>
          <div>
            {label('Spec / standard')}
            <input value={spec} onChange={e => setSpec(e.target.value)} placeholder="e.g. API 610" style={inp} />
          </div>
          <div>
            {label('Trace class')}
            <select value={trace} onChange={e => setTrace(e.target.value)} style={inp}>
              {TRACE_CLASSES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            {label('Vendor')}
            <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. Flowserve" style={inp} />
          </div>
          <div>
            {label('Weight (kg)')}
            <input type="number" value={weight} onChange={e => setWeight(e.target.value)} placeholder="0"
              style={{ ...inp, fontFamily: 'JetBrains Mono, monospace' }} />
          </div>
          <div>
            {label('Size (L×W×H)')}
            <input value={size} onChange={e => setSize(e.target.value)} placeholder="e.g. 2400×1200×1800" style={inp} />
          </div>
          <div>
            {label('Status')}
            <select value={status} onChange={e => setStatus(e.target.value)} style={inp}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {label('Notes')}
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          style={{ ...inp, height: 68, resize: 'vertical', padding: '8px 10px', lineHeight: '1.5' }} />

        {err && <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '6px 10px' }}>{err}</div>}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: valid ? '#22c55e' : '#94a3b8' }}>
            {valid ? '✓ Ready to save' : 'Required: tag, description and WBS'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={save} disabled={!valid || saving}
              style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: (!valid || saving) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!valid || saving) ? 0.5 : 1 }}>
              {saving ? 'Saving…' : `✓ ${editing ? 'Save changes' : 'Add equipment'}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── STATUS PILL ─────────────────────────────────────────────
const StatusPill = ({ status }: { status: string }) => {
  const { bg, text } = STATUS_STYLES[status] ?? STATUS_STYLES['Not started']
  return <span style={{ background: bg, color: text, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{status}</span>
}

// ─── MAIN SCREEN ─────────────────────────────────────────────
export const FoundEquipmentScreen = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const [wbsNodes, setWbs]  = useState<WBSNode[]>([])
  const [tab, setTab]       = useState<'all' | 'PO raised' | 'RFQ' | 'Not started'>('all')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'none' | 'wbs' | 'vendor'>('none')
  // Project-wide status totals (drive the tab badges); set by the fetcher.
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0, 'PO raised': 0, 'RFQ': 0, 'Not started': 0 })
  const [addModal, setAddModal] = useState(false)
  const [editItem, setEditItem] = useState<Equipment | null>(null)
  const [certsItem, setCertsItem] = useState<Equipment | null>(null)
  const [toast, setToast]   = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd  = `1px solid ${dark ? '#334155' : '#dde3ed'}`

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  // WBS nodes for the add/edit modal (small, unpaginated reference list).
  useEffect(() => {
    axios.get(`${API}/foundational/${projectId}/wbs`).then(r => setWbs(r.data)).catch(() => {})
  }, [projectId])

  // ─── SERVER-SIDE PAGED LOAD ──────────────────────────────────
  // Filter (status/search) + sort run server-side across the whole list; the
  // grid only ever holds one page. Tab badges come from server `counts`.
  const fetcher = useCallback(async ({ page, limit, sortCol, sortDir }: { page: number; limit: number; sortCol?: string; sortDir: 'asc' | 'desc' }) => {
    const params: Record<string, string> = { page: String(page), limit: String(limit), sort_dir: sortDir }
    if (sortCol)        params.sort_col = sortCol
    if (tab !== 'all')  params.status   = tab
    if (search.trim())  params.search   = search.trim()
    const { data } = await axios.get(`${API}/foundational/${projectId}/equipment`, { params })
    setCounts(data.counts ?? { all: 0, 'PO raised': 0, 'RFQ': 0, 'Not started': 0 })
    return { data: data.data as Equipment[], total: data.total as number }
  }, [projectId, tab, search])

  const {
    data: items, total, page, setPage, setPageSize, pageSize, loading,
    sortCol, sortDir, toggleSort, reload,
  } = usePagedList<Equipment>({ fetcher, deps: [projectId, tab, search], pageSize: 50, initialSortCol: 'tag' })

  const sortArrow = (c: string) => sortCol === c ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  const rt = useResizableTable('found_equipment', FE_W, FE_MIN)

  // ─── GROUPING ────────────────────────────────────────────────
  // Decision: grouping across paginated results isn't built yet — only correct
  // when the whole list fits one page. On multi-page lists we disable it (NOT
  // group-on-page) and show a notice. Grouped-summary redesign is backlog.
  const groupingDisabled = total > pageSize
  const effectiveGroupBy = groupingDisabled ? 'none' : groupBy
  const grouped: Record<string, Equipment[]> = {}
  if (effectiveGroupBy !== 'none') {
    for (const e of items) {
      const key = effectiveGroupBy === 'wbs' ? (e.wbs_code ?? '—') : (e.vendor ?? 'Unassigned')
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(e)
    }
  }

  const thStyle = (c: string): React.CSSProperties => ({
    padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em',
    textTransform: 'uppercase', textAlign: 'center', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
    borderBottom: bd,
  })

  const renderRows = (list: Equipment[]) => list.map(e => (
    <tr key={e.id} style={{ background: dark ? '#1e293b' : '#fff', borderBottom: bd }}
      onMouseEnter={ev => { ev.currentTarget.style.background = dark ? '#1e2d4a' : '#f4f7fb' }}
      onMouseLeave={ev => { ev.currentTarget.style.background = dark ? '#1e293b' : '#fff' }}>
      <td style={{ padding: '9px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: '#2563eb', whiteSpace: 'nowrap' }}>{e.tag}</td>
      <td style={{ padding: '9px 10px', fontSize: 13, color: col, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.description}>{e.description}</td>
      <td style={{ padding: '9px 10px', fontSize: 11, color: '#64748b', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.spec ?? ''}>{e.spec ?? '—'}</td>
      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 11, color: CRIT_COLORS[e.criticality] ?? '#64748b', fontWeight: 600 }}>{e.trace_class}</span>
      </td>
      <td style={{ padding: '9px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{e.wbs_code ?? '—'}</td>
      <td style={{ padding: '9px 10px', fontSize: 12, color: e.vendor ? '#64748b' : '#94a3b8', whiteSpace: 'nowrap' }}>{e.vendor ?? '—'}</td>
      <td style={{ padding: '9px 10px' }}><StatusPill status={e.status} /></td>
      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
        <button onClick={() => setCertsItem(e)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.cert_count > 0 ? '#2563eb' : '#94a3b8', fontSize: 12, padding: '2px 6px', marginRight: 4, fontFamily: 'inherit' }}
          title={`${e.cert_count} certificate${e.cert_count !== 1 ? 's' : ''}`}>
          📎{e.cert_count > 0 && <span style={{ fontSize: 10, marginLeft: 2 }}>{e.cert_count}</span>}
        </button>
        <button onClick={() => setEditItem(e)}
          style={{ background: 'none', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, cursor: 'pointer', color: '#64748b', fontSize: 11, padding: '3px 8px', borderRadius: 5, fontFamily: 'inherit' }}>
          Edit
        </button>
      </td>
    </tr>
  ))

  const tableHead = (
    <thead>
      <tr style={{ background: dark ? '#0f172a' : '#f4f7fb', position: 'sticky', top: 0, zIndex: 2 }}>
        {[['tag','Tag'],['description','Description'],['spec','Spec'],['trace_class','Trace'],['wbs_code','WBS'],['vendor','Vendor'],['status','Status']].map(([k,l], i) => (
          <th key={k} style={{ ...rt.thStyle(i), ...thStyle(k) }} onClick={() => toggleSort(k)}>{l}{sortArrow(k)}{rt.handle(i, dark)}</th>
        ))}
        <th style={{ ...rt.thStyle(7), padding: '8px 10px', borderBottom: bd, textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Actions</th>
      </tr>
    </thead>
  )

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>🔧 Equipment List</h2>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3 }}>{total} item{total !== 1 ? 's' : ''} · Tag numbers unique per project</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={async () => {
            try {
              const res = await axios.get(`${API}/foundational/${projectId}/equipment/template`, { responseType: 'blob' })
              const url = URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
              const a = document.createElement('a'); a.href = url; a.download = 'Equipment_Upload_Template.xlsx'
              document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
            } catch { /* ignore */ }
          }}
            style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↓ Template</button>
          <button style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↑ Upload</button>
          <HelpButton screenName="Equipment List" sections={EQUIPMENT_HELP} dark={dark} />
          <button onClick={() => setAddModal(true)} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add equipment</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(['all', 'PO raised', 'RFQ', 'Not started'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${tab === t ? '#2563eb' : (dark ? '#334155' : '#dde3ed')}`, background: tab === t ? '#2563eb' : 'none', color: tab === t ? '#fff' : '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: tab === t ? 600 : 400 }}>
            {t === 'all' ? 'All' : t} <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.8 }}>{counts[t as keyof typeof counts]}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tag, description, WBS, vendor…"
          style={{ flex: 1, height: 34, padding: '0 12px', borderRadius: 6, border: bd, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
        <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
        <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
          Group by:
          <select value={effectiveGroupBy} disabled={groupingDisabled}
            onChange={e => setGroupBy(e.target.value as 'none' | 'wbs' | 'vendor')}
            title={groupingDisabled ? "Grouping across paginated results isn't available yet" : undefined}
            style={{ height: 32, padding: '0 8px', borderRadius: 6, border: bd, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none', opacity: groupingDisabled ? 0.5 : 1, cursor: groupingDisabled ? 'not-allowed' : 'pointer' }}>
            <option value="none">None</option>
            <option value="wbs">WBS</option>
            <option value="vendor">Vendor</option>
          </select>
          {groupingDisabled && (
            <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
              grouping unavailable on large lists — coming soon
            </span>
          )}
        </label>
      </div>

      {/* Table */}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: bd, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 330px)' }}>
          {loading ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
          ) : (
            <table style={{ ...rt.tableStyle, borderCollapse: 'collapse' }}>
              {tableHead}
              <tbody>
                {effectiveGroupBy === 'none' ? (
                  items.length === 0
                    ? <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No equipment found.</td></tr>
                    : renderRows(items)
                ) : (
                  Object.entries(grouped).sort(([a],[b]) => a.localeCompare(b)).map(([grp, grpItems]) => (
                    <>
                      <tr key={`grp-${grp}`} style={{ background: dark ? '#0f172a' : '#f8fafc' }}>
                        <td colSpan={8} style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.07em', textTransform: 'uppercase', borderBottom: bd }}>
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

      <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} onPageSizeChange={setPageSize} />

      {/* Modals */}
      {(addModal || editItem) && (
        <EquipmentModal
          projectId={projectId} wbsNodes={wbsNodes} item={editItem} dark={dark}
          onClose={() => { setAddModal(false); setEditItem(null) }}
          onSaved={saved => {
            reload()  // re-fetch current page (a new/edited row may fall on another page or filter)
            showToast(`✓ Equipment ${saved.tag} ${editItem ? 'updated' : 'added'}`)
            setAddModal(false); setEditItem(null)
          }}
          onQueued={msg => { reload(); showToast(msg); setAddModal(false); setEditItem(null) }}
        />
      )}
      {certsItem && (
        <CertificatesModal
          projectId={projectId} entityType="equipment" entityId={certsItem.id}
          entityCode={certsItem.tag} entityName={certsItem.description} dark={dark}
          onClose={() => { setCertsItem(null); reload() }}
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
