// ─── MEETINGS & RFIs REGISTER (C3) ────────────────────────────
// Paginated register over /api/rfi-meeting (server-side filter/sort/paging via
// usePagedList — never page-local sorting). Two record types share one workflow.
// Row click opens a stub drawer; the full raise→assign→respond→close workflow UI
// arrives in C4. Help + status legend ship from day one.
import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'   // modals portal to document.body — see App.tsx zoom wrapper
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
  response?: string | null
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
function MeetingRFIInner({ dark, projectId, projectName, userRole, userId, onBack }: {
  dark: boolean; projectId: number; projectName: string; userRole: string; userId: number; onBack: () => void
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
    data: items, total, page, setPage, pageSize, loading, sortCol, sortDir, toggleSort, reload,
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

      {/* Detail drawer — workflow actions + link picker */}
      {selected && (
        <RecordDrawer recordId={selected.id} projectId={projectId} dark={dark} userRole={userRole} userId={userId}
          onClose={() => setSelected(null)} onChanged={reload} addToast={addToast} />
      )}
    </div>
  )
}

// ─── WORKFLOW STATE MACHINE (mirrors the C2 backend; backend is final authority) ──
const TRANSITIONS: Record<string, Record<string, string[]>> = {
  rfi: { draft: ['open', 'cancelled'], open: ['assigned', 'answered', 'cancelled'], assigned: ['answered', 'cancelled'], answered: ['closed', 'cancelled'], closed: [], cancelled: [] },
  meeting: { scheduled: ['held', 'cancelled'], held: ['actions_open', 'closed', 'cancelled'], actions_open: ['closed', 'cancelled'], closed: [], cancelled: [] },
}
const CLOSING = new Set(['closed'])
// approve-capable roles (mirror the C1 matrix); external = respond-only, row-restricted.
const CLOSE_ROLES = new Set(['admin', 'project_manager', 'project_director', 'engineering_lead', 'project_controls_manager', 'procurement_manager', 'expediting_manager', 'logistics_manager'])
const EXTERNAL_ROLES = new Set(['vendor', 'subcontractor', 'site_contractor', 'freight_forwarder'])
const ACTION_LABEL: Record<string, string> = { open: 'Raise', assigned: 'Assign…', answered: 'Respond…', closed: 'Close', cancelled: 'Cancel', held: 'Mark held', actions_open: 'Open actions' }

// ─── RECORD DRAWER ────────────────────────────────────────────
function RecordDrawer({ recordId, projectId, dark, userRole, userId, onClose, onChanged, addToast }: {
  recordId: number; projectId: number; dark: boolean; userRole: string; userId: number
  onClose: () => void; onChanged: () => void; addToast: (t: 'success' | 'error' | 'warning', m: string) => void
}) {
  const col = dark ? '#f1f5f9' : '#0f172a'; const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`; const cardBg = dark ? '#1e293b' : '#fff'
  const inp = { height: 32, padding: '0 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' as const }

  const [rec, setRec] = useState<RfiRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<null | 'assigned' | 'answered'>(null)
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  const [assignTo, setAssignTo] = useState(''); const [responseText, setResponseText] = useState('')
  // link picker
  const [linkType, setLinkType] = useState('project'); const [linkId, setLinkId] = useState('')
  const [linkOpts, setLinkOpts] = useState<{ id: number; label: string }[]>([])

  const load = useCallback(() => {
    axios.get(`${API}/rfi-meeting/${projectId}/${recordId}`).then(({ data }) => {
      setRec(data); setLinkType(data.link_type); setLinkId(data.link_id ? String(data.link_id) : '')
    }).catch(() => addToast('error', 'Could not load record'))
  }, [projectId, recordId, addToast])
  useEffect(() => { load() }, [load])
  useEffect(() => { axios.get(`${API}/rfi-meeting/${projectId}/users`).then(({ data }) => setUsers(data)).catch(() => {}) }, [projectId])
  useEffect(() => {
    if (linkType === 'project') { setLinkOpts([]); return }
    axios.get(`${API}/rfi-meeting/${projectId}/link-options/${linkType}`).then(({ data }) => setLinkOpts(data)).catch(() => {})
  }, [linkType, projectId])

  if (!rec) return null
  const isExternal = EXTERNAL_ROLES.has(userRole)
  const canApprove = userRole === 'admin' || CLOSE_ROLES.has(userRole)
  const canAct = !isExternal || rec.assigned_to === userId   // external: only their assigned records
  const legal = TRANSITIONS[rec.record_type]?.[rec.status] || []
  // surface only legal + permitted actions
  const actions = legal.filter(to => canAct && (!CLOSING.has(to) || canApprove))

  const doTransition = async (to: string, extra: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      await axios.patch(`${API}/rfi-meeting/${projectId}/${recordId}/transition`, { to, ...extra })
      addToast('success', `Moved to ${to.replace('_', ' ')}`)
      setPanel(null); setResponseText(''); setAssignTo(''); load(); onChanged()
    } catch (e) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Transition failed')
    } finally { setBusy(false) }
  }
  const onAction = (to: string) => {
    if (to === 'assigned') { setPanel('assigned'); return }
    if (to === 'answered') { setPanel('answered'); return }
    doTransition(to)
  }
  const saveLink = async () => {
    setBusy(true)
    try {
      await axios.patch(`${API}/rfi-meeting/${projectId}/${recordId}/link`, { link_type: linkType, link_id: linkType === 'project' ? null : Number(linkId) })
      addToast('success', 'Link updated'); load(); onChanged()
    } catch (e) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Could not update link')
    } finally { setBusy(false) }
  }

  const sectionLabel = (t: string) => <div style={{ fontSize: 10, fontWeight: 700, color: sub, letterSpacing: '0.08em', textTransform: 'uppercase' as const, margin: '18px 0 8px' }}>{t}</div>

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '92vw', height: '100%', background: cardBg, borderLeft: bd, padding: 24, overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: col }}>{rec.ref}</span>
            <TypePill t={rec.record_type} />
            {pill(rec.status.replace('_', ' '), STATUS_COLOR[rec.status] || '#94a3b8')}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: sub, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: col, marginBottom: 4 }}>{rec.title}</div>

        {[['Assignee', rec.assigned_to_name || 'Unassigned'], ['Raised by', rec.raised_by_name || '—'],
          ['Raised', rec.raised_date || '—'], ['Due', rec.due_date || '—'], ['Priority', rec.priority],
          ...(rec.response ? [['Response', rec.response]] : [])].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: bd, fontSize: 13 }}>
            <span style={{ color: sub }}>{k}</span><span style={{ color: col, fontWeight: 500, textAlign: 'right' }}>{v}</span>
          </div>
        ))}

        {/* ── Workflow actions (legal + permitted only) ── */}
        {sectionLabel('Workflow')}
        {actions.length === 0
          ? <div style={{ fontSize: 12, color: sub }}>{['closed', 'cancelled'].includes(rec.status) ? 'This record is closed — no further actions.' : (canAct ? 'No actions available from this state.' : 'You can only act on records assigned to you.')}</div>
          : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {actions.map(to => (
                <button key={to} disabled={busy} onClick={() => onAction(to)}
                  style={{ padding: '7px 14px', borderRadius: 6, border: CLOSING.has(to) ? 'none' : bd, background: CLOSING.has(to) ? '#22c55e' : to === 'cancelled' ? 'none' : '#E84E0F', color: CLOSING.has(to) || to !== 'cancelled' ? '#fff' : sub, fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
                  {ACTION_LABEL[to] || to}
                </button>
              ))}
            </div>}

        {/* assign panel */}
        {panel === 'assigned' && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <select value={assignTo} onChange={e => setAssignTo(e.target.value)} style={inp}>
              <option value="">Select assignee…</option>
              {users.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </select>
            <button disabled={!assignTo || busy} onClick={() => doTransition('assigned', { assigned_to: Number(assignTo) })}
              style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: !assignTo ? 0.5 : 1 }}>Confirm</button>
          </div>
        )}
        {/* respond panel */}
        {panel === 'answered' && (
          <div style={{ marginTop: 10 }}>
            <textarea value={responseText} onChange={e => setResponseText(e.target.value)} rows={3} placeholder="Response / resolution…"
              style={{ ...inp, height: 'auto', padding: '8px 10px' }} />
            <button disabled={!responseText.trim() || busy} onClick={() => doTransition('answered', { response: responseText.trim() })}
              style={{ marginTop: 6, padding: '7px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: !responseText.trim() ? 0.5 : 1 }}>Submit response</button>
          </div>
        )}

        {/* ── Link picker ── */}
        {sectionLabel('Linked to')}
        {canAct ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={linkType} onChange={e => { setLinkType(e.target.value); setLinkId('') }} style={{ ...inp, width: 120 }}>
              {['project', 'wbs', 'po', 'scn'].map(t => <option key={t} value={t}>{t === 'project' ? 'Project' : t.toUpperCase()}</option>)}
            </select>
            {linkType !== 'project' && (
              <select value={linkId} onChange={e => setLinkId(e.target.value)} style={{ ...inp, flex: 1, minWidth: 160 }}>
                <option value="">Select {linkType.toUpperCase()}…</option>
                {linkOpts.map(o => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
              </select>
            )}
            <button disabled={busy || (linkType !== 'project' && !linkId)} onClick={saveLink}
              style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: col, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (linkType !== 'project' && !linkId) ? 0.5 : 1 }}>Save link</button>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: col }}>{rec.link_type === 'project' ? 'Project-level' : `${rec.link_type.toUpperCase()} ${rec.link_label}`}</div>
        )}

        {/* ── Meeting children (attendees + action items) ── */}
        {rec.record_type === 'meeting' && (
          <MeetingChildren recordId={recordId} projectId={projectId} dark={dark} userRole={userRole} userId={userId}
            users={users} canManage={!isExternal} isAdmin={userRole === 'admin'} addToast={addToast} />
        )}
      </div>
    </div>,
    document.body,
  )
}

// ─── MEETING CHILDREN: attendees + action items (C5) ──────────
const ACTION_TRANSITIONS: Record<string, string[]> = { open: ['in_progress', 'done', 'cancelled'], in_progress: ['done', 'cancelled'], done: [], cancelled: [] }
const ACTION_LABELS: Record<string, string> = { in_progress: 'Start', done: 'Done', cancelled: 'Cancel' }
const ACTION_STATUS_COLOR: Record<string, string> = { open: '#94a3b8', in_progress: '#2563eb', done: '#22c55e', cancelled: '#9ca3af' }
interface Attendee { id: number; attendee_name: string; attendee_org: string | null; attended: number }
interface ActionItem { id: number; seq: number; description: string; assigned_to: number | null; assigned_to_name: string | null; status: string; due_date: string | null }

function MeetingChildren({ recordId, projectId, dark, userId, users, canManage, isAdmin, addToast }: {
  recordId: number; projectId: number; dark: boolean; userRole: string; userId: number
  users: { id: number; name: string }[]; canManage: boolean; isAdmin: boolean
  addToast: (t: 'success' | 'error' | 'warning', m: string) => void
}) {
  const col = dark ? '#f1f5f9' : '#0f172a'; const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const inp = { height: 30, padding: '0 8px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none' }
  const secLabel = (t: string) => <div style={{ fontSize: 10, fontWeight: 700, color: sub, letterSpacing: '0.08em', textTransform: 'uppercase' as const, margin: '18px 0 8px' }}>{t}</div>

  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [actions, setActions] = useState<ActionItem[]>([])
  const [newAttName, setNewAttName] = useState(''); const [newAttOrg, setNewAttOrg] = useState('')
  const [newActDesc, setNewActDesc] = useState(''); const [newActAssignee, setNewActAssignee] = useState(''); const [newActDue, setNewActDue] = useState('')
  const base = `${API}/rfi-meeting/${projectId}/${recordId}`

  const load = useCallback(() => {
    axios.get(`${base}/attendees`).then(({ data }) => setAttendees(data)).catch(() => {})
    axios.get(`${base}/actions`).then(({ data }) => setActions(data)).catch(() => {})
  }, [base])
  useEffect(() => { load() }, [load])

  const addAttendee = async () => {
    if (!newAttName.trim()) return
    try { await axios.post(`${base}/attendees`, { attendee_name: newAttName.trim(), attendee_org: newAttOrg.trim() || null }); setNewAttName(''); setNewAttOrg(''); load() }
    catch (e) { addToast('error', (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Could not add attendee') }
  }
  const removeAttendee = async (id: number) => {
    try { await axios.delete(`${base}/attendees/${id}`); load() }
    catch (e) { addToast('error', (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Could not remove') }
  }
  const addAction = async () => {
    if (!newActDesc.trim()) return
    try { await axios.post(`${base}/actions`, { description: newActDesc.trim(), assigned_to: newActAssignee ? Number(newActAssignee) : null, due_date: newActDue || null }); setNewActDesc(''); setNewActAssignee(''); setNewActDue(''); load() }
    catch (e) { addToast('error', (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Could not add action') }
  }
  const moveAction = async (a: ActionItem, to: string) => {
    try { await axios.patch(`${base}/actions/${a.id}`, { to }); load() }
    catch (e) { addToast('error', (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Could not update action') }
  }

  return (
    <div>
      {/* Attendees */}
      {secLabel(`Attendees (${attendees.length})`)}
      {attendees.length === 0 && <div style={{ fontSize: 12, color: sub }}>No attendees recorded.</div>}
      {attendees.map(a => (
        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: bd, fontSize: 13 }}>
          <span style={{ color: col }}>{a.attendee_name}{a.attendee_org ? <span style={{ color: sub }}> · {a.attendee_org}</span> : null}</span>
          {isAdmin && <button onClick={() => removeAttendee(a.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>×</button>}
        </div>
      ))}
      {canManage && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input placeholder="Name" value={newAttName} onChange={e => setNewAttName(e.target.value)} style={{ ...inp, flex: 1 }} />
          <input placeholder="Org" value={newAttOrg} onChange={e => setNewAttOrg(e.target.value)} style={{ ...inp, width: 110 }} />
          <button disabled={!newAttName.trim()} onClick={addAttendee} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: newAttName.trim() ? 1 : 0.5 }}>Add</button>
        </div>
      )}

      {/* Action items — each its own mini-workflow */}
      {secLabel(`Action items (${actions.length})`)}
      {actions.length === 0 && <div style={{ fontSize: 12, color: sub }}>No action items.</div>}
      {actions.map(a => {
        const canDo = canManage || a.assigned_to === userId
        const next = ACTION_TRANSITIONS[a.status] || []
        return (
          <div key={a.id} style={{ padding: '7px 0', borderBottom: bd }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
              <span style={{ color: col }}><span style={{ color: sub }}>#{a.seq}</span> {a.description}</span>
              {pill(a.status.replace('_', ' '), ACTION_STATUS_COLOR[a.status] || '#94a3b8')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <span style={{ fontSize: 11, color: sub }}>{a.assigned_to_name || 'Unassigned'}{a.due_date ? ` · due ${a.due_date}` : ''}</span>
              {canDo && next.length > 0 && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {next.map(to => (
                    <button key={to} onClick={() => moveAction(a, to)} style={{ padding: '3px 9px', borderRadius: 5, border: bd, background: 'none', color: to === 'done' ? '#22c55e' : to === 'cancelled' ? sub : '#2563eb', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{ACTION_LABELS[to]}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
      {canManage && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <input placeholder="New action…" value={newActDesc} onChange={e => setNewActDesc(e.target.value)} style={{ ...inp, flex: '1 1 100%' }} />
          <select value={newActAssignee} onChange={e => setNewActAssignee(e.target.value)} style={{ ...inp, flex: 1 }}>
            <option value="">Assignee…</option>
            {users.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
          </select>
          <input type="date" value={newActDue} onChange={e => setNewActDue(e.target.value)} style={{ ...inp, width: 130 }} />
          <button disabled={!newActDesc.trim()} onClick={addAction} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: newActDesc.trim() ? 1 : 0.5 }}>Add</button>
        </div>
      )}
    </div>
  )
}

// ─── EXPORTED (wraps in ToastProvider; ToastContainer for toasts) ──
export function MeetingRFIScreen(props: { dark: boolean; projectId: number; projectName: string; userRole: string; userId: number; onBack: () => void }) {
  return (
    <ToastProvider>
      <MeetingRFIInner {...props} />
      <ToastContainer />
    </ToastProvider>
  )
}
