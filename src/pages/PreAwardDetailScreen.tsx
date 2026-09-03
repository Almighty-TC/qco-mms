// ─── PRE-AWARD TENDER DETAIL ────────────────────────────────
// Phase 3.1a: the tender detail shell — header/overview + the tab bar for the
// five real tabs. Reached from PreAwardTendersScreen (row click) via the
// 'pre-award-detail' Page. Header data is the real tender from
// GET /api/pre-award/:projectId/tenders/:id. Tab CONTENT is built in later
// sub-steps (3.1b–3.1e); here the tabs are a placeholder bar only.
//
// The BAFO / Second-Round tab is deliberately ABSENT (not stubbed): its backend
// (Phase 2.9) was never built. Evaluation appears as a tab but its functional
// build is blocked on Phase 2.6 + the scope-reconciliation gate.
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { API } from '../lib/api'

interface Tender {
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
  created_by: number | null
  created_at: string
  updated_at: string
}

const MODE_LABEL: Record<string, string> = {
  private_negotiated:  'Private — Negotiated',
  private_competitive: 'Private — Competitive',
  mdb_funded:          'MDB Funded',
}
const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  active:    { bg: 'rgba(37,99,235,0.12)',  text: '#1d4ed8' },
  standstill:{ bg: 'rgba(245,158,11,0.12)', text: '#b45309' },
  awarded:   { bg: 'rgba(34,197,94,0.12)',  text: '#15803d' },
  on_hold:   { bg: 'rgba(148,163,184,0.15)', text: '#64748b' },
  cancelled: { bg: 'rgba(239,68,68,0.12)',  text: '#b91c1c' },
}
const humanise = (v: string | null) =>
  !v ? '—' : v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const fmtValue = (v: string | number | null, currency: string | null) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n)) return '—'
  return `${currency || 'AUD'} ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// The five real tabs, in pipeline order. BAFO is intentionally not here.
const TABS = ['Prequalification', 'Invitation', 'Bids', 'Evaluation', 'Recommendation / Award'] as const
type Tab = typeof TABS[number]

export function PreAwardDetailScreen({ dark, projectId, projectName, tenderId, onBack, onLeaf }: {
  dark: boolean; projectId: number; projectName: string; tenderId: number
  onBack: () => void; onLeaf?: (ref: string | null) => void
}) {
  const [tender,  setTender]  = useState<Tender | null>(null)
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState('')
  const [tab,     setTab]     = useState<Tab>('Prequalification')

  const col  = dark ? '#f1f5f9' : '#0f172a'
  const sub  = '#94a3b8'
  const bd   = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data } = await axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}`)
      setTender(data)
      onLeaf?.(data?.ref ?? null)
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined
      setErr(status === 404 ? 'Tender not found.'
        : status === 403 ? 'You do not have permission to view this tender.'
        : 'Could not load the tender. Please try again.')
      setTender(null)
    } finally {
      setLoading(false)
    }
  }, [projectId, tenderId, onLeaf])

  useEffect(() => { load(); return () => onLeaf?.(null) }, [load, onLeaf])

  const st = tender ? (STATUS_STYLE[tender.status] ?? { bg: 'rgba(148,163,184,0.15)', text: '#64748b' }) : null

  const field = (label: string, value: React.ReactNode) => (
    <div style={{ minWidth: 140 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: col }}>{value}</div>
    </div>
  )

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: sub, flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
      </div>

      {err && (
        <div style={{ padding: '14px 16px', borderRadius: 8, border: `1px solid ${dark ? '#7f1d1d' : '#fecaca'}`, background: dark ? 'rgba(127,29,29,0.2)' : '#fef2f2', color: dark ? '#fca5a5' : '#b91c1c', fontSize: 13 }}>
          {err} <button onClick={load} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>Retry</button>
        </div>
      )}

      {loading && !err && (
        <div style={{ padding: '28px 4px', color: sub, fontSize: 13 }}>Loading tender…</div>
      )}

      {tender && !err && (
        <>
          {/* Header */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', color: '#E84E0F', fontWeight: 600 }}>{tender.ref}</span>
              {st && <span style={{ background: st.bg, color: st.text, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999 }}>{humanise(tender.status)}</span>}
            </div>
            <h2 style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>{tender.title}</h2>
            <div style={{ fontSize: 13, color: sub, marginTop: 3 }}>{projectName || 'Project'}</div>
          </div>

          {/* Core fields */}
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', padding: '16px 18px', border: bd, borderRadius: 8, background: cardBg, marginBottom: 20 }}>
            {field('Procurement Mode', MODE_LABEL[tender.procurement_mode] ?? humanise(tender.procurement_mode))}
            {field('Discipline', humanise(tender.discipline))}
            {field('Stage', humanise(tender.stage))}
            {field('Estimated Value', <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmtValue(tender.estimated_value, tender.currency)}</span>)}
            {field('Owner', tender.owner_name ?? '—')}
          </div>

          {/* Tab bar (placeholder — content built in 3.1b–3.1e) */}
          <div style={{ display: 'flex', gap: 4, borderBottom: bd, marginBottom: 18, flexWrap: 'wrap' }}>
            {TABS.map(t => {
              const active = tab === t
              return (
                <button key={t} onClick={() => setTab(t)}
                  style={{
                    padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 600 : 400,
                    color: active ? '#E84E0F' : sub,
                    borderBottom: `2px solid ${active ? '#E84E0F' : 'transparent'}`,
                    marginBottom: -1,
                  }}>
                  {t}
                </button>
              )
            })}
          </div>

          {/* Placeholder panel */}
          <div style={{ padding: '32px 18px', border: bd, borderRadius: 8, background: cardBg, color: sub, fontSize: 13, textAlign: 'center' }}>
            <div style={{ fontWeight: 600, color: col, marginBottom: 6 }}>{tab}</div>
            {tab === 'Evaluation'
              ? 'This tab is part of the planned sequence; its backend (scoring) is not yet built.'
              : 'This tab will be built in an upcoming sub-step.'}
          </div>
        </>
      )}
    </div>
  )
}
