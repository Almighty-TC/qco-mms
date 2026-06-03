// ─── AUDIT VIEWER ─────────────────────────────────────────────
// Compliance face over the immutable audit_log. Read-only trail with field-level
// before/after diff, filter/search, CSV export, and (C4) QA sign-off.
// The UI adds NO authorization logic — it only drives the proven /api/audit
// endpoints; the backend (requirePermission) is the source of truth. We hide the
// sign-off actions for non-reviewers, but the server enforces it regardless.
import React, { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { AdminTable, AdminRow, AdminCell } from '../components/AdminTable'
import type { AdminCol } from '../components/AdminTable'
import { Pager } from '../components/Pager'
import { usePagedList } from '../hooks/usePagedList'
import { HelpButton } from '../components/HelpDrawer'
import type { HelpSection } from '../components/HelpDrawer'

const API = 'http://localhost:3001/api'

// Roles that may post sign-off reviews (UI affordance only; backend enforces).
const REVIEWER_ROLES = new Set(['admin', 'auditor'])

// ─── TYPES ───────────────────────────────────────────────────
export interface AuditRow {
  id: number; user_id: number | null; action: string
  entity_type: string | null; entity_id: number | null; project_id: number | null
  before_value: unknown; after_value: unknown
  reason_category: string | null; reason_detail: string | null
  resource: string | null; ip: string | null; created_at: string
  user_name: string | null; user_role: string | null
  project_name: string | null; project_code: string | null
  review_status: 'reviewed' | 'flagged' | null; reviewed_at: string | null
  review_note: string | null; reviewed_by_name: string | null; review_count: number
}
interface FilterData {
  actions: { value: string; count: number }[]
  entity_types: { value: string; count: number }[]
  users: { id: number; full_name: string }[]
  projects: { id: number; name: string; code: string }[]
}

// ─── HELP ────────────────────────────────────────────────────
const AUDIT_HELP: HelpSection[] = [
  { title: '🔒 Immutable record', content: (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      <li>The audit log is append-only — entries can never be edited or deleted from this screen.</li>
      <li>QA sign-off does NOT change a log entry; it appends a separate review record (full history kept).</li>
    </ul>
  )},
  { title: '🔍 Filtering', content: (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      <li>Filter by action, entity type, user, project, date range, or free-text (resource / reason).</li>
      <li>Entity type “(none)” matches entries with no entity. Project “Unscoped” matches pre-scoping rows.</li>
      <li>Changing any filter resets to page 1.</li>
    </ul>
  )},
  { title: '↔ Field-level diff', content: (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      <li>Click a row (▸) to expand the before → after change. Only changed/added/removed fields are shown.</li>
      <li>Green = added, red = removed, amber = changed.</li>
    </ul>
  )},
  { title: '⬇ CSV export', content: 'Exports the WHOLE filtered set (all pages), not just the visible page.' },
]

// ─── HELPERS ─────────────────────────────────────────────────
const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

function parseJson(v: unknown): Record<string, unknown> | null {
  if (v == null) return null
  if (typeof v === 'object') return v as Record<string, unknown>
  if (typeof v === 'string') { try { const p = JSON.parse(v); return p && typeof p === 'object' ? p as Record<string, unknown> : null } catch { return null } }
  return null
}
const fmtVal = (v: unknown) => v === undefined ? '∅' : v === null ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v)

type DiffField = { key: string; old: unknown; new: unknown; kind: 'added' | 'removed' | 'changed' }
function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): DiffField[] {
  const b = before ?? {}, a = after ?? {}
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()
  const out: DiffField[] = []
  for (const k of keys) {
    const inB = k in b, inA = k in a
    if (!inB && inA) out.push({ key: k, old: undefined, new: a[k], kind: 'added' })
    else if (inB && !inA) out.push({ key: k, old: b[k], new: undefined, kind: 'removed' })
    else if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.push({ key: k, old: b[k], new: a[k], kind: 'changed' })
  }
  return out
}

const reviewBadge = (status: AuditRow['review_status']) => {
  if (status === 'reviewed') return { label: 'Reviewed', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' }
  if (status === 'flagged')  return { label: 'Flagged',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
  return { label: 'Unreviewed', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' }
}

// ─── MAIN ────────────────────────────────────────────────────
export const AuditViewerScreen = ({ dark, userRole, onBack }: {
  dark: boolean; userRole: string; onBack: () => void
}) => {
  const col  = dark ? '#f1f5f9' : '#0f172a'
  const sub  = '#94a3b8'
  const bd   = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const canReview = REVIEWER_ROLES.has(userRole)

  // ── filter state ──
  const [filterData, setFilterData] = useState<FilterData | null>(null)
  const [action, setAction]       = useState('')
  const [entityType, setEntityType] = useState('')
  const [userId, setUserId]       = useState('')
  const [projectId, setProjectId] = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [search, setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  // Integrity (hash-chain verification) — { status, tables:{audit_log,audit_review} }
  const [integrity, setIntegrity] = useState<{ status: string; tables: Record<string, { status: string; brokenAtId: number | null }> } | null>(null)

  // load filter dropdown values + integrity status once
  useEffect(() => { axios.get(`${API}/audit/filters`).then(r => setFilterData(r.data)).catch(() => {}) }, [])
  useEffect(() => { axios.get(`${API}/audit/verify`).then(r => setIntegrity(r.data)).catch(() => setIntegrity(null)) }, [])
  // debounce search
  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 350); return () => clearTimeout(t) }, [search])

  // ── server-side paged load ──
  const buildParams = useCallback((): Record<string, string> => {
    const p: Record<string, string> = {}
    if (action)         p.action      = action
    if (entityType)     p.entity_type = entityType
    if (userId)         p.user_id     = userId
    if (projectId)      p.project_id  = projectId
    if (dateFrom)       p.date_from   = dateFrom
    if (dateTo)         p.date_to     = dateTo
    if (debouncedSearch.trim()) p.search = debouncedSearch.trim()
    return p
  }, [action, entityType, userId, projectId, dateFrom, dateTo, debouncedSearch])

  const fetcher = useCallback(async ({ page, limit, sortCol, sortDir }: { page: number; limit: number; sortCol?: string; sortDir: 'asc' | 'desc' }) => {
    const params: Record<string, string> = { ...buildParams(), page: String(page), limit: String(limit), sort_dir: sortDir }
    if (sortCol) params.sort_col = sortCol
    const { data } = await axios.get(`${API}/audit`, { params })
    return { data: (data.data ?? []) as AuditRow[], total: (data.total ?? 0) as number }
  }, [buildParams])

  const {
    data: rows, total, page, setPage, pageSize, loading,
    sortCol, sortDir, setSortCol, setSortDir, reload,
  } = usePagedList<AuditRow>({
    fetcher, deps: [action, entityType, userId, projectId, dateFrom, dateTo, debouncedSearch],
    pageSize: 50, initialSortCol: 'created_at', initialSortDir: 'desc',
  })

  const resetFilters = () => {
    setAction(''); setEntityType(''); setUserId(''); setProjectId(''); setDateFrom(''); setDateTo(''); setSearch('')
  }

  // ── C4: QA sign-off (append-only; backend enforces the gate) ──
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const toggleSel = (id: number) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const clearSel = () => setSelected(new Set())

  const batchReview = async (review_status: 'reviewed' | 'flagged') => {
    if (selected.size === 0) return
    const note = window.prompt(`Optional note for marking ${selected.size} entr${selected.size === 1 ? 'y' : 'ies'} ${review_status}:`) ?? undefined
    setBatchBusy(true)
    try {
      await axios.post(`${API}/audit/review/batch`, { audit_log_ids: [...selected], review_status, review_note: note || null })
      clearSel(); reload()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      window.alert(er.response?.data?.error ?? 'Batch review failed')
    } finally { setBatchBusy(false) }
  }

  // ── CSV export of the WHOLE filtered set (all pages, not just the visible page) ──
  const exportCSV = async () => {
    setExporting(true)
    try {
      const base = buildParams()
      const headers = ['When', 'User', 'Role', 'Action', 'Entity type', 'Entity id', 'Project', 'Resource', 'Reason category', 'Reason detail', 'Review status', 'IP']
      const all: AuditRow[] = []
      let pg = 1
      // page through the entire filtered set at the server cap
      for (;;) {
        const { data } = await axios.get(`${API}/audit`, { params: { ...base, page: String(pg), limit: '200', sort_col: sortCol ?? 'created_at', sort_dir: sortDir } })
        all.push(...(data.data ?? []))
        if (all.length >= (data.total ?? 0) || (data.data ?? []).length === 0) break
        pg++
      }
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const csv = [headers, ...all.map(r => [
        fmtDateTime(r.created_at), r.user_name ?? r.user_id, r.user_role ?? '', r.action,
        r.entity_type ?? '', r.entity_id ?? '', r.project_name ?? (r.project_id ?? 'unscoped'),
        r.resource ?? '', r.reason_category ?? '', r.reason_detail ?? '', r.review_status ?? 'unreviewed', r.ip ?? '',
      ])].map(row => row.map(esc).join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href)
    } finally { setExporting(false) }
  }

  const COLS: AdminCol[] = [
    ...(canReview ? [{ label: '', width: 32, noResize: true }] : []),
    { label: '', width: 34, noResize: true },
    { label: 'When', width: 150 },
    { label: 'Who', width: 150 },
    { label: 'Action', width: 165 },
    { label: 'Entity', width: 150 },
    { label: 'Project', width: 130 },
    { label: 'Resource', width: 240, flex: true },
    { label: 'Review', width: 130, noResize: true },
  ]

  const selSt: React.CSSProperties = { height: 32, padding: '0 8px', borderRadius: 6, border: bd, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none' }

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: sub, flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
        <span style={{ color: col, fontWeight: 600 }}>Audit Trail</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>🔍 Audit Trail</h2>
          <div style={{ fontSize: 13, color: sub, marginTop: 3 }}>
            {total} record{total !== 1 ? 's' : ''} · immutable system activity log
            {canReview && <span style={{ marginLeft: 8, color: '#22c55e', fontWeight: 600 }}>· ✎ you can sign off entries</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Integrity (hash-chain) indicator */}
          {integrity && (() => {
            const ok = integrity.status === 'verified'
            const broken = Object.entries(integrity.tables).find(([, v]) => v.status !== 'verified')
            const where = broken ? ` (${broken[0]}${broken[1].brokenAtId != null ? ` row ${broken[1].brokenAtId}` : ''})` : ''
            return (
              <span title={ok ? 'Hash chain verified — no tampering detected' : 'Hash-chain verification FAILED — possible tampering'}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 6, whiteSpace: 'nowrap',
                  background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: ok ? '#22c55e' : '#ef4444',
                  border: `1px solid ${ok ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}` }}>
                {ok ? '🔗 Integrity: verified ✓' : `⚠ Chain broken${where}`}
              </span>
            )
          })()}
          {/* Immutability indicator */}
          <span title="The audit trail is append-only and cannot be edited or deleted."
            style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, background: 'rgba(148,163,184,0.12)', color: sub, border: bd, whiteSpace: 'nowrap' }}>
            🔒 Read-only immutable record
          </span>
          <button onClick={exportCSV} disabled={exporting}
            style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 12, cursor: exporting ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {exporting ? 'Exporting…' : '↓ Export CSV'}
          </button>
          <HelpButton screenName="Audit Trail" sections={AUDIT_HELP} dark={dark} />
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search resource / reason…"
          style={{ ...selSt, flex: '1 1 220px', minWidth: 180 }} />
        <select value={action} onChange={e => setAction(e.target.value)} style={selSt}>
          <option value="">All actions</option>
          {filterData?.actions.map(a => <option key={a.value} value={a.value}>{a.value} ({a.count})</option>)}
        </select>
        <select value={entityType} onChange={e => setEntityType(e.target.value)} style={selSt}>
          <option value="">All entities</option>
          {filterData?.entity_types.map(e => <option key={e.value} value={e.value}>{e.value} ({e.count})</option>)}
        </select>
        <select value={userId} onChange={e => setUserId(e.target.value)} style={selSt}>
          <option value="">All users</option>
          {filterData?.users.map(u => <option key={u.id} value={String(u.id)}>{u.full_name}</option>)}
        </select>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={selSt}>
          <option value="">All projects</option>
          <option value="unscoped">Unscoped (no project)</option>
          {filterData?.projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 11, color: sub }}>From <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...selSt, height: 28 }} /></label>
        <label style={{ fontSize: 11, color: sub }}>To <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...selSt, height: 28 }} /></label>
        <span style={{ width: 1, height: 22, background: dark ? '#334155' : '#dde3ed' }} />
        <label style={{ fontSize: 11, color: sub }}>Sort
          <select value={sortCol ?? 'created_at'} onChange={e => setSortCol(e.target.value)} style={{ ...selSt, height: 28, marginLeft: 4 }}>
            <option value="created_at">When</option>
            <option value="action">Action</option>
            <option value="user">User</option>
            <option value="entity_type">Entity type</option>
            <option value="project">Project</option>
          </select>
        </label>
        <button onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')} title="Toggle sort direction"
          style={{ ...selSt, height: 28, cursor: 'pointer', width: 36 }}>{sortDir === 'asc' ? '↑' : '↓'}</button>
        <button onClick={resetFilters} style={{ ...selSt, height: 28, cursor: 'pointer', color: sub }}>Reset filters</button>
        {/* Review-status legend */}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 11, color: sub, alignItems: 'center' }}>
          {(['reviewed', 'flagged', null] as const).map(s => { const b = reviewBadge(s); return (
            <span key={String(s)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: b.color }} />{b.label}
            </span>
          )})}
        </span>
      </div>

      {/* Batch sign-off toolbar (reviewers only) */}
      {canReview && selected.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: dark ? '#1e293b' : '#fff', border: bd }}>
          <span style={{ fontSize: 12, color: col, fontWeight: 600 }}>{selected.size} selected</span>
          <button onClick={() => batchReview('reviewed')} disabled={batchBusy}
            style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Mark reviewed</button>
          <button onClick={() => batchReview('flagged')} disabled={batchBusy}
            style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>⚑ Flag</button>
          <button onClick={clearSel} style={{ padding: '5px 12px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
        </div>
      )}

      {/* Table */}
      <AdminTable tableId="audit_viewer" columns={COLS} dark={dark}
        empty={loading ? 'Loading…' : 'No audit records match the filters.'}>
        {rows.map(r => {
          const expanded = expandedId === r.id
          const rb = reviewBadge(r.review_status)
          return (
            <React.Fragment key={r.id}>
              <AdminRow dark={dark}>
                {canReview && (
                  <td style={{ padding: '0 6px', height: 44, verticalAlign: 'middle', textAlign: 'center', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} title="Select for batch review" />
                  </td>
                )}
                <td onClick={() => setExpandedId(expanded ? null : r.id)}
                  style={{ padding: '0 8px', height: 44, verticalAlign: 'middle', cursor: 'pointer', color: sub, borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, userSelect: 'none' }}>
                  {expanded ? '▾' : '▸'}
                </td>
                <AdminCell mono muted title={fmtDateTime(r.created_at)}>{fmtDateTime(r.created_at)}</AdminCell>
                <AdminCell title={r.user_name ?? ''}>{r.user_name ?? (r.user_id ? `#${r.user_id}` : 'system')}</AdminCell>
                <AdminCell mono title={r.action}>{r.action}</AdminCell>
                <AdminCell muted title={`${r.entity_type ?? '(none)'}${r.entity_id != null ? ' #' + r.entity_id : ''}`}>
                  {r.entity_type ?? '(none)'}{r.entity_id != null ? <span style={{ color: sub }}> #{r.entity_id}</span> : null}
                </AdminCell>
                <AdminCell muted title={r.project_name ?? 'unscoped'}>{r.project_name ?? <span style={{ fontStyle: 'italic' }}>unscoped</span>}</AdminCell>
                <AdminCell mono muted title={r.resource ?? ''}>{r.resource ?? '—'}</AdminCell>
                <td style={{ padding: '0 12px', height: 44, verticalAlign: 'middle', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: rb.bg, color: rb.color, whiteSpace: 'nowrap' }}>
                    {rb.label}{r.review_count > 1 ? ` (${r.review_count})` : ''}
                  </span>
                </td>
              </AdminRow>
              {expanded && (
                <tr>
                  <td colSpan={COLS.length} style={{ padding: '14px 18px', background: dark ? '#0f172a' : '#f8fafc', borderBottom: bd }}>
                    <ExpandedDetail row={r} dark={dark} canReview={canReview} onReviewed={reload} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          )
        })}
      </AdminTable>

      <Pager page={page} total={total} pageSize={pageSize} dark={dark} onPageChange={setPage} />
    </div>
  )
}

// ─── EXPANDED DETAIL ─────────────────────────────────────────
// Field-level diff + reason + the FULL review history (newest first) + a sign-off
// form (reviewers only). Reviews are appended via the proven endpoint; on success
// we refetch this entry's history and reload the list (latest badge).
interface ReviewRow { id: number; review_status: 'reviewed' | 'flagged'; reviewed_at: string; reviewed_by_name: string | null; reviewed_by_role: string | null; review_note: string | null }

const ExpandedDetail = ({ row, dark, canReview, onReviewed }: { row: AuditRow; dark: boolean; canReview: boolean; onReviewed: () => void }) => {
  const sub = '#94a3b8'
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd  = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const [history, setHistory] = useState<ReviewRow[]>([])
  const [histLoading, setHistLoading] = useState(true)
  const [status, setStatus] = useState<'reviewed' | 'flagged'>('reviewed')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const loadHistory = useCallback(async () => {
    setHistLoading(true)
    try { const { data } = await axios.get(`${API}/audit/${row.id}/review-history`); setHistory(data.data ?? []) }
    catch { setHistory([]) }
    finally { setHistLoading(false) }
  }, [row.id])
  useEffect(() => { loadHistory() }, [loadHistory])

  const submit = async () => {
    setBusy(true)
    try {
      await axios.post(`${API}/audit/${row.id}/review`, { review_status: status, review_note: note.trim() || null })
      setNote(''); await loadHistory(); onReviewed()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      window.alert(er.response?.data?.error ?? 'Review failed')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
      {/* Diff + reason */}
      <div style={{ flex: '2 1 420px', minWidth: 320 }}><DiffPanel row={row} dark={dark} /></div>

      {/* Review history + sign-off */}
      <div style={{ flex: '1 1 280px', minWidth: 260 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          QA review history{history.length ? ` (${history.length})` : ''}
        </div>
        {histLoading ? <div style={{ fontSize: 12, color: sub }}>Loading…</div>
          : history.length === 0 ? <div style={{ fontSize: 12, color: sub, fontStyle: 'italic' }}>No reviews yet.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {history.map(h => { const rb = reviewBadge(h.review_status); return (
                <div key={h.id} style={{ padding: '6px 10px', borderRadius: 6, background: dark ? '#1e293b' : '#fff', border: bd, fontSize: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 9999, background: rb.bg, color: rb.color }}>{rb.label}</span>
                  <span style={{ marginLeft: 8, color: col }}>{h.reviewed_by_name ?? 'user'}</span>
                  <span style={{ marginLeft: 6, color: sub }}>{fmtDateTime(h.reviewed_at)}</span>
                  {h.review_note && <div style={{ marginTop: 3, color: sub }}>{h.review_note}</div>}
                </div>
              )})}
            </div>
          )}

        {canReview && (
          <div style={{ padding: '10px 12px', borderRadius: 6, background: dark ? '#1e293b' : '#fff', border: bd }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#E84E0F', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Sign off (appends)</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <select value={status} onChange={e => setStatus(e.target.value as 'reviewed' | 'flagged')}
                style={{ height: 30, padding: '0 8px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 12, fontFamily: 'inherit' }}>
                <option value="reviewed">Reviewed</option>
                <option value="flagged">Flagged</option>
              </select>
              <button onClick={submit} disabled={busy}
                style={{ padding: '0 14px', height: 30, borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {busy ? '…' : 'Record'}
              </button>
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note…"
              style={{ width: '100%', height: 30, padding: '0 8px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── DIFF PANEL ──────────────────────────────────────────────
// Field-level before→after. create = all added, delete = all removed, update = changed.
const DiffPanel = ({ row, dark }: { row: AuditRow; dark: boolean }) => {
  const sub = '#94a3b8'
  const col = dark ? '#f1f5f9' : '#0f172a'
  const before = parseJson(row.before_value)
  const after  = parseJson(row.after_value)
  const fields = diffFields(before, after)
  const kindColor = (k: DiffField['kind']) => k === 'added' ? '#22c55e' : k === 'removed' ? '#ef4444' : '#f59e0b'

  return (
    <div style={{ fontSize: 12 }}>
      {/* Reason surfaced */}
      {(row.reason_category || row.reason_detail) && (
        <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 6, background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
          <span style={{ fontWeight: 700, color: '#E84E0F', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reason</span>
          {row.reason_category && <span style={{ marginLeft: 8, fontWeight: 600, color: col }}>{row.reason_category}</span>}
          {row.reason_detail && <div style={{ marginTop: 3, color: sub }}>{row.reason_detail}</div>}
        </div>
      )}
      {/* Field diff */}
      {fields.length === 0 ? (
        <div style={{ color: sub, fontStyle: 'italic' }}>No field-level detail recorded for this action.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>
          <thead>
            <tr style={{ color: sub, textAlign: 'left' }}>
              <th style={{ padding: '4px 10px', fontWeight: 600, width: 160 }}>FIELD</th>
              <th style={{ padding: '4px 10px', fontWeight: 600 }}>BEFORE</th>
              <th style={{ padding: '4px 10px', fontWeight: 600, width: 24 }} />
              <th style={{ padding: '4px 10px', fontWeight: 600 }}>AFTER</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(f => (
              <tr key={f.key}>
                <td style={{ padding: '4px 10px', color: col, fontWeight: 600, verticalAlign: 'top' }}>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: kindColor(f.kind), marginRight: 6 }} />{f.key}
                </td>
                <td style={{ padding: '4px 10px', color: f.kind === 'removed' || f.kind === 'changed' ? '#ef4444' : sub, verticalAlign: 'top', wordBreak: 'break-word' }}>{fmtVal(f.old)}</td>
                <td style={{ padding: '4px 10px', color: sub, verticalAlign: 'top' }}>→</td>
                <td style={{ padding: '4px 10px', color: f.kind === 'added' || f.kind === 'changed' ? '#22c55e' : sub, verticalAlign: 'top', wordBreak: 'break-word' }}>{fmtVal(f.new)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
