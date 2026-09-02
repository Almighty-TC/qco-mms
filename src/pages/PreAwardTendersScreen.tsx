// ─── PRE-AWARD TENDER REGISTER ──────────────────────────────
// Phase 3.1 first screen: the Pre-Award dashboard/register, reached via the
// Procurement → Pre-Award child nav item. Read-only list of tender packages
// for the active project, backed by the real, proven-live endpoint
// GET /api/pre-award/:projectId/tenders (auth is attached globally by
// AuthContext's axios interceptor). Mirrors the wireframe's 6a register layout
// visually, but is real React against the real API — no mock data.
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { API } from '../lib/api'

// ─── TYPES ──────────────────────────────────────────────────
// One row of the tender register, as returned by the list endpoint's SELECT
// (see server/routes/preAward.js GET /:projectId/tenders). Commercial values
// are deliberately never part of this payload (sealed-envelope boundary).
interface TenderRow {
  id: number
  project_id: number
  ref: string
  title: string
  discipline: string | null
  procurement_mode: string
  stage: string
  status: string
  currency: string | null
  estimated_value: string | number | null
  wbs_code: string | null
  owner_id: number | null
  owner_name: string | null
  created_at: string
  updated_at: string
}

// ─── LABEL MAPS ─────────────────────────────────────────────
// procurement_mode is a CHECK-constrained code (chk_tenders_mode) — humanise it
// for display without assuming any value not in the constraint.
const MODE_LABEL: Record<string, string> = {
  private_negotiated:  'Private — Negotiated',
  private_competitive: 'Private — Competitive',
  mdb_funded:          'MDB Funded',
}
// tender_packages.status (chk on active/standstill/awarded/on_hold/cancelled).
const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  active:    { bg: 'rgba(37,99,235,0.12)',  text: '#1d4ed8' },
  standstill:{ bg: 'rgba(245,158,11,0.12)', text: '#b45309' },
  awarded:   { bg: 'rgba(34,197,94,0.12)',  text: '#15803d' },
  on_hold:   { bg: 'rgba(148,163,184,0.15)', text: '#64748b' },
  cancelled: { bg: 'rgba(239,68,68,0.12)',  text: '#b91c1c' },
}
// Generic humaniser for stage / discipline / any unmapped code.
const humanise = (v: string | null) =>
  !v ? '—' : v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const fmtValue = (v: string | number | null, currency: string | null) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n)) return '—'
  return `${currency || 'AUD'} ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function PreAwardTendersScreen({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) {
  const [rows,    setRows]    = useState<TenderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState('')
  const [q,       setQ]       = useState('')

  const col  = dark ? '#f1f5f9' : '#0f172a'
  const sub  = '#94a3b8'
  const bd   = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const rowBd = `1px solid ${dark ? '#1e293b' : '#eef2f7'}`

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data } = await axios.get(`${API}/pre-award/${projectId}/tenders`, { params: { limit: 1000 } })
      setRows(Array.isArray(data) ? data : (data.rows ?? []))
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined
      setErr(status === 403
        ? 'You do not have permission to view Pre-Award tenders.'
        : 'Could not load the tender register. Please try again.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const needle = q.trim().toLowerCase()
  const shown = needle
    ? rows.filter(r => r.ref.toLowerCase().includes(needle) || r.title.toLowerCase().includes(needle))
    : rows

  const COLS: { key: string; label: string; align?: 'right' }[] = [
    { key: 'ref',              label: 'Ref' },
    { key: 'title',            label: 'Title' },
    { key: 'discipline',       label: 'Discipline' },
    { key: 'procurement_mode', label: 'Mode' },
    { key: 'stage',            label: 'Stage' },
    { key: 'status',           label: 'Status' },
    { key: 'estimated_value',  label: 'Est. Value', align: 'right' },
    { key: 'owner_name',       label: 'Owner' },
  ]
  const thStyle = (align?: 'right'): React.CSSProperties => ({
    padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b',
    letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: bd,
    textAlign: align ?? 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0,
    background: dark ? '#0f172a' : '#fff', zIndex: 1,
  })
  const tdStyle = (align?: 'right'): React.CSSProperties => ({
    padding: '9px 10px', fontSize: 13, color: col, borderBottom: rowBd,
    textAlign: align ?? 'left', whiteSpace: 'nowrap',
  })

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: sub, flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>📑 Pre-Award · Tender Register</h2>
          <div style={{ fontSize: 13, color: sub, marginTop: 3 }}>
            {projectName || 'Project'} · {loading ? 'Loading…' : `${rows.length} tender${rows.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search ref or title…"
          style={{ height: 34, padding: '0 12px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', minWidth: 220 }}
        />
      </div>

      {/* States */}
      {err && (
        <div style={{ padding: '14px 16px', borderRadius: 8, border: `1px solid ${dark ? '#7f1d1d' : '#fecaca'}`, background: dark ? 'rgba(127,29,29,0.2)' : '#fef2f2', color: dark ? '#fca5a5' : '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {err} <button onClick={load} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>Retry</button>
        </div>
      )}

      {!err && (
        <div style={{ border: bd, borderRadius: 8, overflow: 'hidden', background: dark ? '#0f172a' : '#fff' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
            <table className="app-grid" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{COLS.map(c => <th key={c.key} style={thStyle(c.align)}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={COLS.length} style={{ padding: '28px 14px', textAlign: 'center', color: sub, fontSize: 13 }}>Loading tenders…</td></tr>
                ) : shown.length === 0 ? (
                  <tr><td colSpan={COLS.length} style={{ padding: '28px 14px', textAlign: 'center', color: sub, fontSize: 13 }}>
                    {rows.length === 0 ? 'No tenders yet for this project.' : 'No tenders match your search.'}
                  </td></tr>
                ) : shown.map(r => {
                  const st = STATUS_STYLE[r.status] ?? { bg: 'rgba(148,163,184,0.15)', text: '#64748b' }
                  return (
                    <tr key={r.id}>
                      <td style={{ ...tdStyle(), fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{r.ref}</td>
                      <td style={{ ...tdStyle(), whiteSpace: 'normal', maxWidth: 280 }}>{r.title}</td>
                      <td style={{ ...tdStyle(), color: sub }}>{humanise(r.discipline)}</td>
                      <td style={{ ...tdStyle(), color: sub }}>{MODE_LABEL[r.procurement_mode] ?? humanise(r.procurement_mode)}</td>
                      <td style={tdStyle()}>{humanise(r.stage)}</td>
                      <td style={tdStyle()}>
                        <span style={{ background: st.bg, color: st.text, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, whiteSpace: 'nowrap' }}>{humanise(r.status)}</span>
                      </td>
                      <td style={{ ...tdStyle('right'), fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{fmtValue(r.estimated_value, r.currency)}</td>
                      <td style={{ ...tdStyle(), color: sub }}>{r.owner_name ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
