// ─── DASHBOARD — PROJECT VIEW (C2: health + pipeline visuals) ──
// Consumes the C1 aggregate endpoint (GET /api/dashboard/:projectId) — one call,
// all bands. C2 renders the top of the dashboard: 4 stat cards, the wireframe
// Health Score card (score + band + gradient bar + RAG-coloured module bars), and
// the SVG pipeline funnel. Mine + Exceptions bands land in C3 (placeholders here).
// Hand-rolled SVG/CSS — no chart library, consistent with the house style.
import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'   // modals portal to document.body — see App.tsx zoom wrapper
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
  pipeline: { demand: number | null; po_raised: number | null; expedited: number | null; received: number | null }
}

const MODULE_LABEL: Record<string, string> = { procurement: 'Procurement', expediting: 'Expediting', logistics: 'Logistics', materials: 'Materials Control', traceability: 'Traceability' }
const WEIGHT_KEYS = ['procurement', 'expediting', 'logistics', 'materials', 'traceability'] as const
// mirrors dashboard.can_edit from the C1 matrix — the backend remains the enforcer.
const CAN_EDIT_ROLES = new Set(['admin', 'project_manager', 'project_director'])
const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString())

// ─── BAND ROW (Mine / Attention) — clickable, drills to a module ──
function BandRow({ label, n, accent, dark, onClick }: { label: string; n: number; accent: string; dark: boolean; onClick: () => void }) {
  const sub = '#94a3b8'; const col = dark ? '#f1f5f9' : '#0f172a'; const active = n > 0
  return (
    <button onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.background = dark ? '#0f172a' : '#f8fafc')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        padding: '8px 6px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
      <span style={{ fontSize: 13, color: active ? col : sub }}>{label}</span>
      <span style={{ minWidth: 26, textAlign: 'center', padding: '1px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700,
        color: active ? '#fff' : sub, background: active ? accent : (dark ? '#334155' : '#eef2f7') }}>{n}</span>
    </button>
  )
}

// ─── HEALTH WEIGHTS MODAL (the wireframe's "Configure ⚙") ─────
// Five sliders that must total 100 (Save disabled otherwise — mirrors the backend's
// 422). On save → PUT /dashboard/:pid/weights → re-fetch so the score updates live.
function WeightsModal({ projectId, dark, initial, onClose, onSaved, addToast }: {
  projectId: number; dark: boolean; initial: { module: string; weight: number }[]
  onClose: () => void; onSaved: () => void; addToast: (t: 'success' | 'error' | 'warning', m: string) => void
}) {
  const col = dark ? '#f1f5f9' : '#0f172a'; const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`; const cardBg = dark ? '#1e293b' : '#fff'
  const seed = () => { const o: Record<string, number> = {}; for (const k of WEIGHT_KEYS) o[k] = initial.find(x => x.module === k)?.weight ?? 0; return o }
  const [w, setW] = useState<Record<string, number>>(seed)
  const [saving, setSaving] = useState(false)
  const total = WEIGHT_KEYS.reduce((a, k) => a + (w[k] || 0), 0)
  const ok = total === 100

  const save = async () => {
    setSaving(true)
    try {
      await axios.put(`${API}/dashboard/${projectId}/weights`, { weights: w })
      addToast('success', 'Health weights updated'); onSaved()
    } catch (e) {
      addToast('error', (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Could not save weights')
    } finally { setSaving(false) }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: cardBg, borderRadius: 12, padding: 26, width: 480, maxWidth: '92vw', border: bd, boxShadow: '0 16px 48px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: col }}>Health score weights</span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, color: sub, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: sub, marginBottom: 18 }}>Weight each area's contribution to the project score. Must total 100%.</div>
        {WEIGHT_KEYS.map(k => (
          <div key={k} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: col, marginBottom: 4 }}>
              <span>{MODULE_LABEL[k]}</span><span style={{ fontWeight: 700 }}>{w[k]}%</span>
            </div>
            <input type="range" min={0} max={100} value={w[k]} onChange={e => setW({ ...w, [k]: Number(e.target.value) })}
              style={{ width: '100%', accentColor: '#E84E0F' }} />
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTop: bd }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: ok ? '#22c55e' : '#ef4444' }}>Total: {total}%{ok ? ' ✓' : ' (need 100)'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setW(seed())} style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
            <button disabled={!ok || saving} onClick={save}
              style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: ok ? '#E84E0F' : (dark ? '#334155' : '#c4cedf'), color: '#fff', fontSize: 12, fontWeight: 600, cursor: ok && !saving ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>Save</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── EXCEPTIONS "VIEW ALL" MODAL (real records — deterministic, not AI) ──
interface ExGroup { key: string; label: string; page: string; count: number; capped?: boolean; items: { pri: string; sec: string }[] }
function ExceptionsModal({ projectId, dark, onClose, onNavigate, addToast }: {
  projectId: number; dark: boolean; onClose: () => void; onNavigate: (page: string) => void
  addToast: (t: 'success' | 'error' | 'warning', m: string) => void
}) {
  const col = dark ? '#f1f5f9' : '#0f172a'; const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`; const cardBg = dark ? '#1e293b' : '#fff'
  const [groups, setGroups] = useState<ExGroup[] | null>(null)
  useEffect(() => {
    axios.get(`${API}/dashboard/${projectId}/exceptions`).then(({ data }) => setGroups(data.groups))
      .catch(e => addToast('error', e.response?.data?.error ?? 'Could not load exceptions'))
  }, [projectId, addToast])
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 520, maxWidth: '94vw', height: '100%', background: cardBg, borderLeft: bd, padding: 24, overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: col }}>All problems</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: sub, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: sub, marginBottom: 16 }}>Live exceptions across the project — every item is a real record.</div>
        {groups == null && <div style={{ color: sub, fontSize: 13 }}>Loading…</div>}
        {groups && groups.length === 0 && <div style={{ color: '#22c55e', fontSize: 13 }}>No open problems — nothing needs attention.</div>}
        {groups && groups.map(g => (
          <div key={g.key} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{g.label} <span style={{ color: '#ef4444' }}>({g.count}{g.capped ? '+' : ''})</span></span>
              <button onClick={() => { onNavigate(g.page); onClose() }} style={{ background: 'none', border: 'none', color: '#E84E0F', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Open module →</button>
            </div>
            {g.items.map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: bd, fontSize: 12 }}>
                <span style={{ color: col, fontWeight: 600, flexShrink: 0 }}>{it.pri}</span>
                <span style={{ color: sub, textAlign: 'right' }}>{it.sec}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}

function DashboardInner({ dark, projectId, projectName, userRole, onBack, onNavigate }: {
  dark: boolean; projectId: number; projectName: string; userRole: string; onBack: () => void; onNavigate: (page: string) => void
}) {
  const { addToast } = useToast()
  const col = dark ? '#f1f5f9' : '#0f172a'; const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`; const cardBg = dark ? '#1e293b' : '#fff'
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showConfig, setShowConfig] = useState(false)
  const [showExceptions, setShowExceptions] = useState(false)
  const canEdit = CAN_EDIT_ROLES.has(userRole)   // mirrors dashboard.can_edit (backend enforces)

  const load = useCallback(() => {
    setLoading(true)
    axios.get(`${API}/dashboard/${projectId}`)
      .then(({ data }) => setData(data))
      .catch(e => addToast('error', e.response?.data?.error ?? 'Could not load dashboard'))
      .finally(() => setLoading(false))
  }, [projectId, addToast])
  useEffect(() => { load() }, [load])

  const card: React.CSSProperties = { background: cardBg, border: bd, borderRadius: 12, padding: 18 }

  // ── Stat cards ──
  const StatCard = ({ label, value }: { label: string; value: number | null }) => (
    <div style={{ ...card, flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: value == null ? sub : col, letterSpacing: '-0.02em' }}>{fmt(value)}</div>
      <div style={{ fontSize: 11, color: sub, marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
    </div>
  )

  // ── Pipeline: an UPSTREAM demand bar (MTO — not chained, no FK to POs) above the
  //    monotonic single-grain procurement chain (raised ⊇ expedited ⊇ received over
  //    po_lines.status). No "issued" stage: nothing in the schema traces FMR issuance
  //    back to a po_line, so it is omitted rather than shown as a phantom downstream count.
  const PipelineFunnel = ({ p }: { p: DashData['pipeline'] }) => {
    const chain = [['PO raised', p.po_raised], ['Expedited', p.expedited], ['Received', p.received]] as const
    const max = Math.max(1, ...chain.map(([, v]) => v ?? 0))
    const bar = (label: string, v: number | null, grad: string) => {
      const w = v == null ? 0 : Math.max(4, (v / max) * 100)
      return (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 84, fontSize: 12, color: sub, textAlign: 'right', flexShrink: 0 }}>{label}</div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: `${w}%`, height: 26, background: v == null ? (dark ? '#334155' : '#eef2f7') : grad, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 40, transition: 'width .3s' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: v == null ? sub : '#fff' }}>{fmt(v)}</span>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* upstream demand — deliberately separated from the chain */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 84, fontSize: 12, color: sub, textAlign: 'right', flexShrink: 0 }}>MTO demand</div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', height: 26, background: p.demand == null ? (dark ? '#334155' : '#eef2f7') : (dark ? '#334155' : '#cbd5e1'), borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: p.demand == null ? sub : col }}>{fmt(p.demand)}</span>
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: bd, margin: '4px 0 4px 96px' }} />
        {chain.map(([l, v]) => bar(l, v, 'linear-gradient(90deg,#E84E0F,#f59e0b)'))}
      </div>
    )
  }

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif', width: '100%' }}>
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
          {canEdit && data && (
            <button onClick={() => setShowConfig(true)} style={{ padding: '7px 12px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Configure ⚙</button>
          )}
          <HelpButton screenName="Project Dashboard" sections={DASHBOARD_HELP} dark={dark} />
        </div>
      </div>

      {showConfig && data && (
        <WeightsModal projectId={projectId} dark={dark} initial={data.health.weights}
          onClose={() => setShowConfig(false)} onSaved={() => { setShowConfig(false); load() }} addToast={addToast} />
      )}
      {showExceptions && (
        <ExceptionsModal projectId={projectId} dark={dark} onClose={() => setShowExceptions(false)}
          onNavigate={onNavigate} addToast={addToast} />
      )}

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
                    <div style={{ width: 110, fontSize: 12, color: col, flexShrink: 0, whiteSpace: 'nowrap' }}>{MODULE_LABEL[m.key] || m.key}</div>
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

          {/* Mine + Attention bands */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Mine — per-user */}
            <div style={{ ...card, flex: 1, minWidth: 300 }}>
              <div style={{ fontSize: 11, color: sub, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 4 }}>Mine</div>
              {([
                ['Approvals waiting on me', data.mine.approvals_pos, 'procurement'],
                ['In my confirmer queue', data.mine.confirmer_queue, 'pending-changes'],
                ['RFIs assigned to me', data.mine.rfis_assigned, 'rfi-meeting'],
                ['Actions assigned to me', data.mine.actions_assigned, 'rfi-meeting'],
              ] as const).map(([label, n, page]) => (
                <BandRow key={label} label={label} n={n} accent="#E84E0F" dark={dark} onClick={() => onNavigate(page)} />
              ))}
            </div>
            {/* Attention — project-wide exceptions (visible metrics only) */}
            <div style={{ ...card, flex: 1, minWidth: 300 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: sub, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Attention</div>
                <button onClick={() => setShowExceptions(true)} style={{ background: 'none', border: 'none', color: '#E84E0F', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>View all problems →</button>
              </div>
              {([
                ['Overdue POs', data.attention.overdue_pos, 'procurement'],
                ['Breached milestones', data.attention.breached_milestones, 'procurement'],
                ['At-risk deliveries', data.attention.at_risk_deliveries, 'expediting'],
                ['Overdue RFIs', data.attention.overdue_rfis, 'rfi-meeting'],
                ['Overdue actions', data.attention.overdue_actions, 'rfi-meeting'],
                ['Stock-outs', data.attention.stockouts, 'mc-stock'],
                ['Negative stock', data.attention.negative_stock, 'mc-stock'],
                ['Pending receipts', data.attention.pending_receipts, 'mc-receipting'],
                ['Open FMRs', data.attention.open_fmrs, 'mc-fmr'],
              ] as const).filter(([, n]) => n != null).map(([label, n, page]) => (
                <BandRow key={label} label={label} n={n as number} accent="#ef4444" dark={dark} onClick={() => onNavigate(page)} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function DashboardProjectScreen(props: { dark: boolean; projectId: number; projectName: string; userRole: string; onBack: () => void; onNavigate: (page: string) => void }) {
  return (
    <ToastProvider>
      <DashboardInner {...props} />
      <ToastContainer />
    </ToastProvider>
  )
}
