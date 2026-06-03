// ─── DASHBOARD — PROJECT VIEW (C2: health + pipeline visuals) ──
// Consumes the C1 aggregate endpoint (GET /api/dashboard/:projectId) — one call,
// all bands. C2 renders the top of the dashboard: 4 stat cards, the wireframe
// Health Score card (score + band + gradient bar + RAG-coloured module bars), and
// the SVG pipeline funnel. Mine + Exceptions bands land in C3 (placeholders here).
// Hand-rolled SVG/CSS — no chart library, consistent with the house style.
import { useState, useEffect } from 'react'
import axios from 'axios'
import { HelpButton } from '../components/HelpDrawer'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { DASHBOARD_HELP } from '../helpContent'

const API = 'http://localhost:3001/api'
const RAG = { red: '#ef4444', amber: '#f59e0b', green: '#22c55e' }
const bandColor = (b: string | null) => b === 'Excellent' ? '#22c55e' : b === 'Good' ? '#84cc16' : b === 'At risk' ? '#f59e0b' : b === 'Critical' ? '#ef4444' : '#94a3b8'

interface Mod { key: string; rag: 'red' | 'amber' | 'green'; score: number; counts: { total: number; problems: number } }
interface DashData {
  health: { score: number | null; band: string | null; delta: number | null; weights: { module: string; weight: number }[]; modules: Mod[] }
  stats: { mto_lines: number | null; pos_awarded: number | null; at_risk: number | null; breached: number | null }
  mine: { approvals_pos: number; confirmer_queue: number; rfis_assigned: number; actions_assigned: number }
  attention: Record<string, number | null>
  pipeline: { mto: number | null; po_raised: number | null; expedited: number | null; shipped: number | null; received: number | null; issued: number | null }
}

const MODULE_LABEL: Record<string, string> = { procurement: 'Procurement', expediting: 'Expediting', logistics: 'Logistics', materials: 'Mat. Control', traceability: 'Traceability' }
const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString())

function DashboardInner({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; userRole: string; onBack: () => void
}) {
  const { addToast } = useToast()
  const col = dark ? '#f1f5f9' : '#0f172a'; const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`; const cardBg = dark ? '#1e293b' : '#fff'
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    axios.get(`${API}/dashboard/${projectId}`)
      .then(({ data }) => setData(data))
      .catch(e => addToast('error', e.response?.data?.error ?? 'Could not load dashboard'))
      .finally(() => setLoading(false))
  }, [projectId, addToast])

  const card: React.CSSProperties = { background: cardBg, border: bd, borderRadius: 12, padding: 18 }

  // ── Stat cards ──
  const StatCard = ({ label, value }: { label: string; value: number | null }) => (
    <div style={{ ...card, flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: value == null ? sub : col, letterSpacing: '-0.02em' }}>{fmt(value)}</div>
      <div style={{ fontSize: 11, color: sub, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
    </div>
  )

  // ── Pipeline funnel (centered SVG/CSS bars) ──
  const PipelineFunnel = ({ p }: { p: DashData['pipeline'] }) => {
    const stages = [['MTO', p.mto], ['PO raised', p.po_raised], ['Expedited', p.expedited], ['Shipped', p.shipped], ['Received', p.received], ['Issued', p.issued]] as const
    const max = Math.max(1, ...stages.map(([, v]) => v ?? 0))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {stages.map(([label, v]) => {
          const w = v == null ? 0 : Math.max(4, (v / max) * 100)
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 80, fontSize: 12, color: sub, textAlign: 'right', flexShrink: 0 }}>{label}</div>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: `${w}%`, height: 26, background: v == null ? (dark ? '#334155' : '#eef2f7') : 'linear-gradient(90deg,#E84E0F,#f59e0b)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 40, transition: 'width .3s' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: v == null ? sub : '#fff' }}>{fmt(v)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif', maxWidth: 1100 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: sub, flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: sub, fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>← All projects</button>
        <span>›</span><span style={{ color: col, fontWeight: 600 }}>{projectName}</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>🏠 {projectName}</h2>
          <div style={{ fontSize: 13, color: sub, marginTop: 3 }}>Project health dashboard</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, color: sub, marginRight: 4 }}>
            {(['green', 'amber', 'red'] as const).map(c => (
              <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: RAG[c] }} />
                {c === 'green' ? 'Healthy' : c === 'amber' ? 'At risk' : 'Critical'}
              </span>
            ))}
          </div>
          <HelpButton screenName="Project Dashboard" sections={DASHBOARD_HELP} dark={dark} />
        </div>
      </div>

      {loading && <div style={{ color: sub, fontSize: 14, padding: 40, textAlign: 'center' }}>Loading dashboard…</div>}

      {!loading && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Stat strip */}
          <div style={{ display: 'flex', gap: 12 }}>
            <StatCard label="MTO line items" value={data.stats.mto_lines} />
            <StatCard label="POs awarded" value={data.stats.pos_awarded} />
            <StatCard label="At risk" value={data.stats.at_risk} />
            <StatCard label="Breached" value={data.stats.breached} />
          </div>

          {/* Health Score card */}
          <div style={{ ...card, display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {/* Left — score */}
            <div style={{ flex: '0 0 240px' }}>
              <div style={{ fontSize: 11, color: sub, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 6 }}>Health score</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 52, fontWeight: 800, color: bandColor(data.health.band), lineHeight: 1, letterSpacing: '-0.03em' }}>{data.health.score ?? '—'}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: bandColor(data.health.band) }}>{data.health.band ?? ''}</span>
              </div>
              {/* gradient score bar with marker */}
              <div style={{ position: 'relative', height: 10, borderRadius: 999, marginTop: 14, background: 'linear-gradient(90deg,#ef4444 0%,#f59e0b 50%,#22c55e 100%)' }}>
                {data.health.score != null && (
                  <div style={{ position: 'absolute', top: -3, left: `calc(${data.health.score}% - 2px)`, width: 4, height: 16, background: col, borderRadius: 2, boxShadow: '0 0 0 2px ' + cardBg }} />
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: sub, marginTop: 4 }}><span>Critical</span><span>At risk</span><span>Excellent</span></div>
            </div>
            {/* Right — module breakdown bars (RAG-coloured) */}
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: 11, color: sub, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 10 }}>By area</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {data.health.modules.map(m => (
                  <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 92, fontSize: 12, color: col, flexShrink: 0 }}>{MODULE_LABEL[m.key] || m.key}</div>
                    <div style={{ flex: 1, height: 12, borderRadius: 999, background: dark ? '#0f172a' : '#eef2f7', overflow: 'hidden' }}>
                      <div style={{ width: `${m.score}%`, height: '100%', background: RAG[m.rag], borderRadius: 999, transition: 'width .3s' }} />
                    </div>
                    <div style={{ width: 30, textAlign: 'right', fontSize: 12, fontWeight: 700, color: RAG[m.rag] }}>{m.score}</div>
                  </div>
                ))}
                {data.health.modules.length === 0 && <div style={{ fontSize: 12, color: sub }}>No area visibility for your role.</div>}
              </div>
            </div>
          </div>

          {/* Pipeline funnel */}
          <div style={card}>
            <div style={{ fontSize: 11, color: sub, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 14 }}>Materials pipeline</div>
            <PipelineFunnel p={data.pipeline} />
          </div>

          {/* C3 placeholders */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ ...card, flex: 1, minWidth: 280, opacity: 0.6 }}>
              <div style={{ fontSize: 11, color: sub, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Mine</div>
              <div style={{ fontSize: 12, color: sub, marginTop: 8 }}>Approvals & items assigned to you — arrives next.</div>
            </div>
            <div style={{ ...card, flex: 1, minWidth: 280, opacity: 0.6 }}>
              <div style={{ fontSize: 11, color: sub, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Attention</div>
              <div style={{ fontSize: 12, color: sub, marginTop: 8 }}>Project-wide exceptions — arrives next.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function DashboardProjectScreen(props: { dark: boolean; projectId: number; projectName: string; userRole: string; onBack: () => void }) {
  return (
    <ToastProvider>
      <DashboardInner {...props} />
      <ToastContainer />
    </ToastProvider>
  )
}
