// ─── EXPEDITING SCREEN ────────────────────────────────────────
// Expediting register: locked POs with milestone timeline and RAG.
// Row click navigates to ExpPODetailScreen via onNavigateToPODetail prop.
// Tabs: All POs | VDRL Register | Action Log
import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { HelpButton } from '../components/HelpDrawer'
import { MilestoneTimeline } from '../components/MilestoneTimeline'
import { EXPEDITING_HELP } from '../helpContent'

const API = 'http://localhost:3001/api'

// ─── TYPES ────────────────────────────────────────────────────
interface Milestone {
  id: number; label: string; status: string; step_order: number
  planned_date?: string | null; forecast_date?: string | null; actual_date?: string | null
  forecast_changed_count: number
}

interface PORow {
  id: number; po_number: string; po_name?: string | null
  vendor_display: string; material_description?: string | null
  owner_name?: string | null; expeditor_name?: string | null
  ros_date?: string | null; status: string
  rag: string; is_critical_path: number; milestones: Milestone[]
  group_category?: string | null
}

interface Stats {
  total_pos: number; ongoing: number; complete: number; breached: number; at_risk: number
}

interface ExpeditingScreenProps {
  dark: boolean
  projectId: number
  projectName: string
  onBack: () => void
  onNavigateToPODetail: (poId: number) => void
}

// ─── CONSTANTS ────────────────────────────────────────────────
const RAG_COLORS: Record<string, string> = {
  complete: '#22c55e', red: '#ef4444', amber: '#f59e0b', blue: '#2563eb', grey: '#94a3b8'
}
const RAG_LABELS: Record<string, string> = {
  complete: 'Complete', red: 'Breached', amber: 'At Risk', blue: 'On Track', grey: 'Not Started'
}
// ─── RAG-BASED STATUS PILLS for Expediting (not procurement status) ──────────
const RAG_STATUS_PILLS: Record<string, { bg: string; color: string; label: string }> = {
  'red':      { bg: 'rgba(239,68,68,0.12)',   color: '#dc2626', label: 'Breached' },
  'amber':    { bg: 'rgba(245,158,11,0.12)',  color: '#d97706', label: 'At Risk' },
  'blue':     { bg: 'rgba(37,99,235,0.12)',   color: '#1d4ed8', label: 'On Track' },
  'green':    { bg: 'rgba(34,197,94,0.12)',   color: '#16a34a', label: 'On Track' },
  'complete': { bg: 'rgba(34,197,94,0.12)',   color: '#16a34a', label: 'Complete' },
  'grey':     { bg: 'rgba(148,163,184,0.12)', color: '#64748b', label: 'Not Started' },
}

type ActiveTab = 'pos' | 'vdrl' | 'action-log'
type RAGFilter = 'all' | 'red' | 'amber' | 'blue' | 'grey' | 'complete'
type SubTab = 'all' | 'ongoing' | 'complete'

// ─── HELPERS ──────────────────────────────────────────────────
const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// ─── COMPONENT ────────────────────────────────────────────────
export const ExpeditingScreen = ({ dark, projectId, projectName, onBack, onNavigateToPODetail }: ExpeditingScreenProps) => {
  const [pos, setPOs]         = useState<PORow[]>([])
  const [stats, setStats]     = useState<Stats>({ total_pos: 0, ongoing: 0, complete: 0, breached: 0, at_risk: 0 })
  const [loading, setLoading] = useState(true)
  const [activeTab, setTab]   = useState<ActiveTab>('pos')
  const [subTab, setSubTab]   = useState<SubTab>('all')
  const [search, setSearch]   = useState('')
  const [ragFilter, setRagFilter] = useState<RAGFilter>('all')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [rosFrom, setRosFrom] = useState('')
  const [rosTo, setRosTo]     = useState('')

  const col     = dark ? '#f1f5f9' : '#0f172a'
  const bg      = dark ? '#0f172a' : '#f4f7fb'
  const cardBg  = dark ? '#1e293b' : '#fff'
  const bd      = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub     = '#94a3b8'

  // ─── FETCH DATA ───────────────────────────────────────────
  // Loads register + stats in parallel on mount / projectId change.
  useEffect(() => {
    setLoading(true)
    Promise.all([
      axios.get(`${API}/expediting/${projectId}/register`),
      axios.get(`${API}/expediting/${projectId}/stats`),
    ]).then(([r1, r2]) => {
      setPOs(r1.data.data || [])
      setStats(r2.data)
    }).catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [projectId])

  // ─── FILTER ───────────────────────────────────────────────
  // Applies sub-tab, search, RAG filter, critical-only, ROS range.
  const filtered = pos.filter(po => {
    if (subTab === 'ongoing' && po.rag === 'complete') return false
    if (subTab === 'complete' && po.rag !== 'complete') return false
    if (search) {
      const q = search.toLowerCase()
      if (!po.po_number.toLowerCase().includes(q) &&
          !(po.vendor_display || '').toLowerCase().includes(q) &&
          !(po.material_description || '').toLowerCase().includes(q)) return false
    }
    if (ragFilter !== 'all' && po.rag !== ragFilter) return false
    if (criticalOnly && !po.is_critical_path) return false
    if (rosFrom && po.ros_date && po.ros_date < rosFrom) return false
    if (rosTo   && po.ros_date && po.ros_date > rosTo)   return false
    return true
  })

  // ─── STAT CARDS ───────────────────────────────────────────
  const statCards = [
    { label: 'Total POs',  value: stats.total_pos,  color: col },
    { label: 'Ongoing',    value: stats.ongoing,    color: '#2563eb' },
    { label: 'Breached',   value: stats.breached,   color: '#ef4444' },
    { label: 'At Risk',    value: stats.at_risk,    color: '#f59e0b' },
    { label: 'Complete',   value: stats.complete,   color: '#22c55e' },
  ]

  // ─── VDRL DATA ────────────────────────────────────────────
  // Gathers all VDRL packages from POs that have them loaded.
  // (Full VDRL data is only available in PO detail; this is a stub.)

  // ─── RENDER ───────────────────────────────────────────────
  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif', background: bg, minHeight: '100vh' }}>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: sub, flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: sub, fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>← Dashboard</button>
        <span>›</span><span>{projectName}</span><span>›</span>
        <span style={{ color: col, fontWeight: 600 }}>Expediting</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>
            Expediting Register
          </h2>
          <div style={{ fontSize: 13, color: sub, marginTop: 3 }}>
            Active PO monitoring — milestone tracking & forecast management · {projectName}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: bd, background: cardBg, color: col, cursor: 'pointer' }}>
            ↓ Export
          </button>
          <HelpButton screenName="Expediting" sections={EXPEDITING_HELP} dark={dark} />
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 24 }}>
        {statCards.map(({ label, value, color }) => (
          <div key={label} style={{ background: cardBg, border: bd, borderRadius: 8, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color }}>{value}</div>
            <div style={{ fontSize: 10, color: sub, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Main Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: bd, marginBottom: 0 }}>
        {([['pos', 'All POs'], ['vdrl', 'VDRL Register'], ['action-log', 'Action Log']] as [ActiveTab, string][]).map(([tab, label]) => (
          <button key={tab} onClick={() => setTab(tab)} style={{
            padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: activeTab === tab ? '2px solid #E84E0F' : '2px solid transparent',
            fontSize: 13, fontWeight: activeTab === tab ? 600 : 400,
            color: activeTab === tab ? '#E84E0F' : sub,
            fontFamily: 'inherit', marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {/* ── TAB: All POs ── */}
      {activeTab === 'pos' && (
        <div style={{ background: cardBg, border: bd, borderTop: 'none', borderRadius: '0 0 10px 10px', paddingBottom: 4 }}>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 2, padding: '10px 16px 0', borderBottom: bd }}>
            {(['all', 'ongoing', 'complete'] as SubTab[]).map(t => (
              <button key={t} onClick={() => setSubTab(t)} style={{
                padding: '5px 14px', fontSize: 12, cursor: 'pointer', border: 'none',
                borderBottom: subTab === t ? '2px solid #E84E0F' : '2px solid transparent',
                background: 'none', color: subTab === t ? '#E84E0F' : sub,
                fontWeight: subTab === t ? 600 : 400, fontFamily: 'inherit', marginBottom: -1,
                textTransform: 'capitalize',
              }}>{t}</button>
            ))}
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: bd, flexWrap: 'wrap' }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search PO, vendor, material…"
              style={{ flex: 1, minWidth: 180, fontSize: 12, padding: '6px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'blue', 'amber', 'red', 'grey', 'complete'] as RAGFilter[]).map(r => (
                <button key={r} onClick={() => setRagFilter(r)} style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: ragFilter === r ? (r === 'all' ? '#E84E0F' : RAG_COLORS[r] || '#64748b') : (dark ? '#0f172a' : '#f1f5f9'),
                  color: ragFilter === r ? '#fff' : sub,
                  fontWeight: ragFilter === r ? 600 : 400,
                }}>{r === 'all' ? 'All' : RAG_LABELS[r] || r}</button>
              ))}
            </div>
            <label style={{ fontSize: 11, color: sub, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={criticalOnly} onChange={e => setCriticalOnly(e.target.checked)} />
              Critical only
            </label>
            <input type="date" value={rosFrom} onChange={e => setRosFrom(e.target.value)}
              title="ROS from" style={{ fontSize: 11, padding: '4px 7px', borderRadius: 5, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col }} />
            <input type="date" value={rosTo} onChange={e => setRosTo(e.target.value)}
              title="ROS to" style={{ fontSize: 11, padding: '4px 7px', borderRadius: 5, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col }} />
            <span style={{ fontSize: 11, color: sub }}>{filtered.length} PO{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Table */}
          {loading ? (
            <div style={{ textAlign: 'center', color: sub, padding: '48px 0', fontSize: 13 }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: sub, padding: '48px 0', fontSize: 13 }}>No POs match the filter.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: dark ? '#162032' : '#f8fafc', borderBottom: bd }}>
                    {['★', '', 'PO Ref', 'Vendor / Group', 'Material', 'Owner / Expeditor', 'Milestones', 'ROS', 'Status', ''].map((h, i) => (
                      <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(po => {
                    // BUG-2 FIX: use RAG-based status pill, not procurement status
                    const ragPill = RAG_STATUS_PILLS[po.rag] || RAG_STATUS_PILLS['grey']
                    return (
                      <tr key={po.id}
                        style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, cursor: 'pointer', opacity: po.rag === 'complete' ? 0.65 : 1 }}
                        onClick={() => onNavigateToPODetail(po.id)}
                      >
                        {/* BUG-3 FIX: ★ star column */}
                        <td style={{ padding: '10px 6px', width: 28, textAlign: 'center' }}
                            onClick={e => e.stopPropagation()}>
                          <span title={po.is_critical_path ? 'Critical path' : 'Not critical path'}
                            style={{ fontSize: 16, color: po.is_critical_path ? '#E84E0F' : '#c4cedf', cursor: 'pointer', userSelect: 'none' }}>
                            {po.is_critical_path ? '★' : '☆'}
                          </span>
                        </td>
                        {/* RAG stripe */}
                        <td style={{ padding: '10px 0 10px 4px', width: 6 }}>
                          <div style={{ width: 3, height: 32, borderRadius: 2, background: RAG_COLORS[po.rag] || '#94a3b8' }} />
                        </td>
                        {/* PO Ref */}
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#E84E0F', fontWeight: 600 }}>
                            {po.po_number}
                          </div>
                          {po.po_name && <div style={{ fontSize: 11, color: sub }}>{po.po_name}</div>}
                        </td>
                        {/* Vendor / Group */}
                        <td style={{ padding: '10px 12px', maxWidth: 140 }}>
                          <div style={{ color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.vendor_display || '—'}</div>
                          {po.group_category && <div style={{ fontSize: 10, color: sub, textTransform: 'capitalize' }}>{po.group_category}</div>}
                        </td>
                        {/* Material */}
                        <td style={{ padding: '10px 12px', maxWidth: 200 }}>
                          <div style={{ color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.material_description || '—'}</div>
                        </td>
                        {/* Owner / Expeditor — BUG-4 FIX: show "— Unassigned" for missing expeditor */}
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          <div style={{ color: col }}>{po.owner_name || '—'}</div>
                          <div style={{ fontSize: 10, color: po.expeditor_name ? sub : '#c4cedf', fontStyle: po.expeditor_name ? 'normal' : 'italic' }}>
                            {po.expeditor_name || '— Unassigned'}
                          </div>
                        </td>
                        {/* Milestones */}
                        <td style={{ padding: '10px 12px' }}>
                          <MilestoneTimeline milestones={po.milestones} size="sm" />
                        </td>
                        {/* ROS */}
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{fmt(po.ros_date)}</td>
                        {/* Status — BUG-2 FIX: RAG-based not procurement status */}
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 10, background: ragPill.bg, color: ragPill.color, fontWeight: 600 }}>
                            {ragPill.label}
                          </span>
                        </td>
                        {/* Navigate */}
                        <td style={{ padding: '10px 12px' }}>
                          <button
                            onClick={e => { e.stopPropagation(); onNavigateToPODetail(po.id) }}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: bd, background: 'transparent', color: col, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            View →
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: VDRL Register ── */}
      {activeTab === 'vdrl' && (
        <div style={{ background: cardBg, border: bd, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '48px 32px', textAlign: 'center', color: sub }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📑</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: col, marginBottom: 8 }}>VDRL Register</div>
          <div style={{ fontSize: 13, maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
            The VDRL Register shows all vendor document requirements across active POs.
            Open a PO from the register to view and manage its VDRL documents.
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: sub, fontStyle: 'italic' }}>
            Full cross-PO view coming in a future sprint.
          </div>
        </div>
      )}

      {/* ── TAB: Action Log ── */}
      {activeTab === 'action-log' && (
        <div style={{ background: cardBg, border: bd, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '24px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 12 }}>Action Notes — All POs</div>
          <div style={{ fontSize: 12, color: sub }}>
            Open a PO from the register to view and add action notes. Cross-PO action log coming in a future sprint.
          </div>
        </div>
      )}
    </div>
  )
}
