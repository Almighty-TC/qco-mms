// ─── MEETINGS & RFIs REGISTER (C3) ────────────────────────────
// Paginated register over /api/rfi-meeting (server-side filter/sort/paging via
// usePagedList — never page-local sorting). Two record types share one workflow.
// Row click opens a stub drawer; the full raise→assign→respond→close workflow UI
// arrives in C4. Help + status legend ship from day one.
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { HelpButton } from '../components/HelpDrawer'
import { BackButton } from '../components/BackButton'
import { Pager } from '../components/Pager'
import { usePagedList } from '../hooks/usePagedList'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { RFI_MEETING_HELP } from '../helpContent'

const API = 'http://localhost:3001/api'

interface RfiRow {
  id: number; record_type: 'rfi' | 'meeting'; ref: string; title: string; status: string; priority: string
  link_type: string; link_id: number | null; link_label: string | null
  raised_by: number | null; assigned_to: number | null; raised_by_name: string | null; assigned_to_name: string | null
  raised_date: string | null; due_date: string | null; closed_date: string | null
  rag: 'red' | 'amber' | 'green'; is_overdue: boolean
}

// ─── PILL / CHIP PRIMITIVES ───────────────────────────────────
const RAG_COLOR = { red: '#ef4444', amber: '#f59e0b', green: '#22c55e' }
const STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8', scheduled: '#94a3b8', open: '#2563eb', held: '#2563eb',
  assigned: '#0ea5e9', actions_open: '#0ea5e9', answered: '#14b8a6', closed: '#22c55e', cancelled: '#9ca3af',
}
const pill = (text: string, color: string) => (
  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
    color, background: `${color}1f`, whiteSpace: 'nowrap' }}>{text}</span>
)
const TypePill = ({ t }: { t: 'rfi' | 'meeting' }) =>
  pill(t === 'rfi' ? 'RFI' : 'Meeting', t === 'rfi' ? '#2563eb' : '#7c3aed')
const LinkChip = ({ r, dark }: { r: RfiRow; dark: boolean }) => {
  if (r.link_type === 'project' || !r.link_label) return <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
      color: dark ? '#cbd5e1' : '#475569', background: dark ? '#334155' : '#eef2f7', whiteSpace: 'nowrap' }}>
      {r.link_type.toUpperCase()} {r.link_label}
    </span>
  )
}

// ─── INNER (requires ToastProvider ancestor) ──────────────────
function MeetingRFIInner({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) {
  const { addToast } = useToast()
  const col   = dark ? '#f1f5f9' : '#0f172a'
  const sub   = '#94a3b8'
  const bd    = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#1e293b' : '#fff'

  const [type, setType]       = useState<'all' | 'rfi' | 'meeting'>('all')
  const [status, setStatus]   = useState('')
  const [assignee, setAssignee] = useState('')
  const [overdue, setOverdue] = useState(false)
  const [search, setSearch]   = useState('')
  const [selected, setSelected] = useState<RfiRow | null>(null)
  const [assignees, setAssignees] = useState<{ id: number; name: string }[]>([])

  const fetcher = useCallback(async ({ page, limit, sortCol, sortDir }: { page: number; limit: number; sortCol?: string; sortDir: 'asc' | 'desc' }) => {
    const params: Record<string, string> = { page: String(page), limit: String(limit), sort_dir: sortDir }
    if (sortCol)          params.sort_col = sortCol
    if (type !== 'all')   params.type = type
    if (status)           params.status = status
    if (assignee)         params.assignee = assignee
    if (overdue)          params.overdue = 'true'
    if (search.trim())    params.q = search.trim()
    const { data } = await axios.get(`${API}/rfi-meeting/${projectId}`, { params })
    return { data: data.data as RfiRow[], total: data.total as number }
  }, [projectId, type, status, assignee, overdue, search])

  const {
    data: items, total, page, setPage, pageSize, loading, sortCol, sortDir, toggleSort,
  } = usePagedList<RfiRow>({ fetcher, deps: [projectId, type, status, assignee, overdue, search], pageSize: 50, initialSortCol: 'raised_date', initialSortDir: 'desc' })

  // Assignee filter options — distinct assignees in the register (first 200).
  useEffect(() => {
    axios.get(`${API}/rfi-meeting/${projectId}`, { params: { limit: '200' } })
      .then(({ data }) => {
        const m = new Map<number, string>()
        for (const r of data.data as RfiRow[]) if (r.assigned_to) m.set(r.assigned_to, r.assigned_to_name || `User ${r.assigned_to}`)
        setAssignees([...m].map(([id, name]) => ({ id, name })))
      }).catch(() => {})
  }, [projectId])

  const STATUSES = ['draft', 'open', 'assigned', 'answered', 'scheduled', 'held', 'actions_open', 'closed', 'cancelled']
  const sortArrow = (c: string) => sortCol === c ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  const thStyle = { padding: '8px 10px', borderBottom: bd, textAlign: 'left' as const, fontSize: 10,
    fontWeight: 700, color: sub, letterSpacing: '0.08em', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const, cursor: 'pointer' as const }
  const td = { padding: '9px 10px', borderBottom: bd, fontSize: 13, color: col, verticalAlign: 'middle' as const }
  const inp = { height: 32, padding: '0 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none' }

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: sub, flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
        <span>{projectName}</span><span>›</span>
        <span style={{ color: col, fontWeight: 600 }}>Meetings &amp; RFIs</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>📋 Meetings &amp; RFIs</h2>
          <div style={{ fontSize: 13, color: sub, marginTop: 3 }}>{total} record{total !== 1 ? 's' : ''} · {projectName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Status legend */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, color: sub, marginRight: 4 }}>
            {(['red', 'amber', 'green'] as const).map(c => (
              <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: RAG_COLOR[c] }} />
                {c === 'red' ? 'Overdue' : c === 'amber' ? 'Due soon' : 'On track'}
              </span>
            ))}
          </div>
          <HelpButton screenName="Meetings & RFIs" sections={RFI_MEETING_HELP} dark={dark} />
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'rfi', 'meeting'] as const).map(t => (
          <button key={t} onClick={() => setType(t)} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            border: type === t ? 'none' : bd, background: type === t ? '#E84E0F' : 'none', color: type === t ? '#fff' : sub }}>
            {t === 'all' ? 'All' : t === 'rfi' ? 'RFIs' : 'Meetings'}
          </button>
        ))}
        <select value={status} onChange={e => setStatus(e.target.value)} style={inp}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={assignee} onChange={e => setAssignee(e.target.value)} style={inp}>
          <option value="">All assignees</option>
          {assignees.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: sub, cursor: 'pointer' }}>
          <input type="checkbox" checked={overdue} onChange={e => setOverdue(e.target.checked)} /> Overdue only
        </label>
        <input placeholder="Search ref / title / link…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, flex: 1, minWidth: 200 }} />
      </div>

      {/* Table */}
      <div style={{ background: cardBg, border: bd, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: dark ? '#0f172a' : '#f4f7fb', position: 'sticky', top: 0, zIndex: 2 }}>
              <th style={thStyle} onClick={() => toggleSort('ref')}>Ref{sortArrow('ref')}</th>
              <th style={thStyle} onClick={() => toggleSort('record_type')}>Type{sortArrow('record_type')}</th>
              <th style={thStyle} onClick={() => toggleSort('title')}>Title{sortArrow('title')}</th>
              <th style={{ ...thStyle, cursor: 'default' }}>Link</th>
              <th style={thStyle} onClick={() => toggleSort('assigned_to')}>Assignee{sortArrow('assigned_to')}</th>
              <th style={thStyle} onClick={() => toggleSort('due_date')}>Due{sortArrow('due_date')}</th>
              <th style={thStyle} onClick={() => toggleSort('status')}>Status{sortArrow('status')}</th>
              <th style={thStyle} onClick={() => toggleSort('raised_date')}>Raised{sortArrow('raised_date')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: sub }}>Loading…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: sub }}>No records match these filters.</td></tr>}
            {!loading && items.map(r => (
              <tr key={r.id} onClick={() => setSelected(r)} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = dark ? '#0f172a' : '#f8fafc')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <td style={{ ...td, fontWeight: 600 }}>{r.ref}</td>
                <td style={td}><TypePill t={r.record_type} /></td>
                <td style={td}>{r.title}</td>
                <td style={td}><LinkChip r={r} dark={dark} /></td>
                <td style={{ ...td, color: r.assigned_to_name ? col : sub }}>{r.assigned_to_name || 'Unassigned'}</td>
                <td style={td}>{r.due_date ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: RAG_COLOR[r.rag] }} />{r.due_date}</span> : <span style={{ color: sub }}>—</span>}</td>
                <td style={td}>{pill(r.status.replace('_', ' '), STATUS_COLOR[r.status] || '#94a3b8')}</td>
                <td style={{ ...td, color: sub }}>{r.raised_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} />

      {/* Stub drawer (full workflow UI lands in C4) */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 460, maxWidth: '90vw', height: '100%', background: cardBg, borderLeft: bd, padding: 24, overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.35)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: col }}>{selected.ref}</span>
                <TypePill t={selected.record_type} />
                {pill(selected.status.replace('_', ' '), STATUS_COLOR[selected.status] || '#94a3b8')}
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: sub, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: col, marginBottom: 12 }}>{selected.title}</div>
            {[['Link', selected.link_type === 'project' ? 'Project-level' : `${selected.link_type.toUpperCase()} ${selected.link_label}`],
              ['Assignee', selected.assigned_to_name || 'Unassigned'],
              ['Raised by', selected.raised_by_name || '—'],
              ['Raised', selected.raised_date || '—'],
              ['Due', selected.due_date || '—'],
              ['Priority', selected.priority]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: bd, fontSize: 13 }}>
                <span style={{ color: sub }}>{k}</span><span style={{ color: col, fontWeight: 500 }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop: 18, padding: '10px 12px', borderRadius: 8, background: dark ? '#0f172a' : '#f1f5f9', border: bd, fontSize: 12, color: sub }}>
              The full raise → assign → respond → close workflow (and meeting attendees / action items)
              arrives in the next step. <button onClick={() => addToast('success', 'Workflow actions arrive in C4')} style={{ background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', padding: 0 }}>Preview</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── EXPORTED (wraps in ToastProvider; ToastContainer for toasts) ──
export function MeetingRFIScreen(props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) {
  return (
    <ToastProvider>
      <MeetingRFIInner {...props} />
      <ToastContainer />
    </ToastProvider>
  )
}
