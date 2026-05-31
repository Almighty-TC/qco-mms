// ─── WBS GANTT VIEW ─────────────────────────────────────────
// Renders planned / forecast / actual bars + milestone diamonds.
// Receives the same flat WBSNode array as the tree — no extra API call.
import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

// ─── TYPES ──────────────────────────────────────────────────
interface WBSNode {
  id: number
  project_id: number
  parent_id: number | null
  code: string
  description: string
  rag: 'green' | 'amber' | 'red' | 'blue' | null
  ros_date: string | null
  notes: string | null
  planned_start: string | null
  planned_end: string | null
  forecast_start: string | null
  forecast_end: string | null
  actual_start: string | null
  actual_end: string | null
  po_qty?: number
  children?: WBSNode[]
}

export interface WBSGanttViewProps {
  nodes: WBSNode[]
  projectId: number
  dark: boolean
  zoom: 'quarters' | 'months'
  maxDepth: number
  expanded: Set<number>
  onToggle: (id: number) => void
  onNodeClick: (node: WBSNode) => void
}

// ─── CONSTANTS ───────────────────────────────────────────────
const COL_W: Record<string, number> = { quarters: 36, months: 52 }
const ROW_H = 36
const LEFT_W = 260
const HEADER_H = 52

const RAG_COLORS: Record<string, string> = {
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', blue: '#2563eb',
}

// ─── DATE HELPERS ────────────────────────────────────────────
const parseDate = (s: string | null): Date | null => s ? new Date(s) : null

const monthKey = (d: Date) => d.getFullYear() * 12 + d.getMonth()

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d)
  r.setMonth(r.getMonth() + n)
  return r
}

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ─── BUILD VISIBLE ROWS ──────────────────────────────────────
function buildRows(nodes: WBSNode[], expanded: Set<number>, maxDepth: number): { node: WBSNode; depth: number }[] {
  const rows: { node: WBSNode; depth: number }[] = []
  function walk(list: WBSNode[], depth: number) {
    for (const n of list) {
      if (depth > maxDepth) continue
      rows.push({ node: n, depth })
      if (n.children?.length && expanded.has(n.id)) {
        walk(n.children, depth + 1)
      }
    }
  }
  walk(nodes, 0)
  return rows
}

// ─── TOOLTIP PORTAL ──────────────────────────────────────────
const BarTooltip = ({ text, x, y }: { text: string; x: number; y: number }) => createPortal(
  <div style={{
    position: 'fixed', left: Math.min(x + 10, window.innerWidth - 260), top: y - 36,
    background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
    padding: '5px 10px', fontSize: 11, color: '#f1f5f9', pointerEvents: 'none',
    zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    fontFamily: 'IBM Plex Sans, sans-serif',
  }}>
    {text}
  </div>, document.body
)

// ─── MAIN COMPONENT ──────────────────────────────────────────
export const WBSGanttView = ({
  nodes, dark, zoom, maxDepth, expanded, onToggle, onNodeClick,
}: WBSGanttViewProps) => {
  const colW   = COL_W[zoom]
  const today  = new Date()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  // Flatten tree into sorted list for root-level walk
  const rootNodes = useMemo(() => {
    const map = new Map<number, WBSNode>()
    nodes.forEach(n => map.set(n.id, { ...n, children: [] }))
    const roots: WBSNode[] = []
    map.forEach(n => {
      if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id)!.children!.push(n)
      else roots.push(n)
    })
    roots.sort((a, b) => a.code.localeCompare(b.code))
    map.forEach(n => n.children!.sort((a, b) => a.code.localeCompare(b.code)))
    return roots
  }, [nodes])

  // Build visible rows
  const rows = useMemo(() => buildRows(rootNodes, expanded, maxDepth), [rootNodes, expanded, maxDepth])

  // Compute timeline range
  const { startDate, totalMonths } = useMemo(() => {
    let minD: Date | null = null, maxD: Date | null = null
    for (const n of nodes) {
      const ps = parseDate(n.planned_start)
      const pe = parseDate(n.planned_end) || parseDate(n.forecast_end)
      if (ps && (!minD || ps < minD)) minD = ps
      if (pe && (!maxD || pe > maxD)) maxD = pe
    }
    if (!minD) minD = new Date(today.getFullYear(), 0, 1)
    if (!maxD) maxD = addMonths(today, 12)
    // Snap to start of month / add buffer
    const sd = new Date(minD.getFullYear(), minD.getMonth(), 1)
    const ed = addMonths(new Date(maxD.getFullYear(), maxD.getMonth(), 1), 6)
    return { startDate: sd, totalMonths: monthsBetween(sd, ed) + 1 }
  }, [nodes])

  // Convert date → pixel X
  const px = (d: Date | null): number => {
    if (!d) return -1
    const months = monthsBetween(startDate, d) + d.getDate() / 31
    return Math.round(months * colW)
  }

  // Today px
  const todayPx = px(today)

  // Build header months
  const headerMonths = useMemo(() => {
    const months: { year: number; month: number; label: string; qStart: boolean }[] = []
    for (let i = 0; i < totalMonths; i++) {
      const d = addMonths(startDate, i)
      months.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTH_ABBR[d.getMonth()], qStart: d.getMonth() % 3 === 0 })
    }
    return months
  }, [startDate, totalMonths, colW])

  // Group months into quarters for top row
  const quarters = useMemo(() => {
    const qs: { label: string; spanMonths: number; startIdx: number }[] = []
    let current = '', startIdx = 0, count = 0
    headerMonths.forEach((m, i) => {
      const q = `Q${Math.floor(m.month / 3) + 1} ${m.year}`
      if (q !== current) {
        if (count > 0) qs.push({ label: current, spanMonths: count, startIdx })
        current = q; startIdx = i; count = 0
      }
      count++
    })
    if (count > 0) qs.push({ label: current, spanMonths: count, startIdx })
    return qs
  }, [headerMonths])

  const totalW = totalMonths * colW
  const totalH = rows.length * ROW_H
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd = dark ? '#334155' : '#e8ecf2'
  const rowBg = dark ? '#1e293b' : '#ffffff'
  const rowBgParent = dark ? '#1a2540' : '#f8fafc'
  const rowHover = dark ? '#1e2d4a' : '#f4f7fb'
  const headerBg = dark ? '#0f172a' : '#f4f7fb'

  // Bar renderer
  const renderBars = (node: WBSNode, depth: number) => {
    const barH = depth === 0 ? 8 : 14
    const barTop = (ROW_H - barH) / 2

    const ps = parseDate(node.planned_start), pe = parseDate(node.planned_end)
    const fs = parseDate(node.forecast_start), fe = parseDate(node.forecast_end)
    const as_ = parseDate(node.actual_start), ae = parseDate(node.actual_end)
    const ros = parseDate(node.ros_date)

    const bars: React.ReactNode[] = []
    const key = node.id

    // Planned bar
    if (ps && pe) {
      const left = px(ps), width = Math.max(4, px(pe) - px(ps))
      bars.push(
        <div key={`p-${key}`}
          style={{ position: 'absolute', left, top: barTop, width, height: barH, background: '#B5D4F4', border: '0.5px solid #85B7EB', borderRadius: 3, cursor: 'pointer' }}
          onMouseEnter={e => setTooltip({ text: `Planned: ${fmtDate(ps)} → ${fmtDate(pe)}`, x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setTooltip(null)}
        />
      )
    }

    // Forecast bar (only if different from planned)
    if (fs && fe) {
      const plannedSame = ps && pe && fs.getTime() === ps.getTime() && fe.getTime() === pe.getTime()
      if (!plannedSame) {
        const left = px(fs), width = Math.max(4, px(fe) - px(fs))
        bars.push(
          <div key={`f-${key}`}
            style={{ position: 'absolute', left, top: barTop + 2, width, height: barH, background: '#FAC775', border: '0.5px solid #EF9F27', borderRadius: 3, opacity: 0.85, cursor: 'pointer' }}
            onMouseEnter={e => setTooltip({ text: `Forecast: ${fmtDate(fs)} → ${fmtDate(fe)}`, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setTooltip(null)}
          />
        )
      }
    }

    // Actual bar
    if (as_) {
      const effectiveEnd = ae || today
      const left = px(as_), width = Math.max(4, px(effectiveEnd) - px(as_))
      const label = ae ? `Actual: ${fmtDate(as_)} → ${fmtDate(ae)}` : `Actual (WIP): ${fmtDate(as_)} → today`
      bars.push(
        <div key={`a-${key}`}
          style={{ position: 'absolute', left, top: barTop - 2, width, height: barH, background: '#C0DD97', border: '0.5px solid #97C459', borderRadius: 3, cursor: 'pointer' }}
          onMouseEnter={e => setTooltip({ text: label, x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setTooltip(null)}
        />
      )
    }

    // Milestone diamond
    if (ros) {
      const left = px(ros) - 6
      bars.push(
        <div key={`m-${key}`}
          style={{ position: 'absolute', left, top: (ROW_H - 12) / 2, width: 12, height: 12, background: '#E84E0F', transform: 'rotate(45deg)', cursor: 'pointer', zIndex: 3 }}
          title={`ROS: ${fmtDate(ros)}`}
          onMouseEnter={e => setTooltip({ text: `ROS: ${fmtDate(ros)}`, x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setTooltip(null)}
        />
      )
    }

    return bars
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${bd}`, borderRadius: 10, overflow: 'hidden', background: rowBg, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      {/* ── Combined scroll container ── */}
      <div ref={scrollRef} style={{ display: 'flex', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>

        {/* ── LEFT PANE — WBS labels ── */}
        <div style={{ width: LEFT_W, flexShrink: 0, borderRight: `1px solid ${bd}` }}>
          {/* Header */}
          <div style={{ height: HEADER_H, background: headerBg, borderBottom: `1px solid ${bd}`, display: 'flex', alignItems: 'flex-end', padding: '0 12px 8px', position: 'sticky', top: 0, zIndex: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>WBS Node</span>
          </div>
          {/* Rows */}
          {rows.map(({ node, depth }) => {
            const hasChildren = node.children && node.children.length > 0
            const isExpanded = expanded.has(node.id)
            return (
              <div key={node.id}
                onClick={() => hasChildren ? onToggle(node.id) : onNodeClick(node)}
                style={{
                  height: ROW_H, display: 'flex', alignItems: 'center',
                  paddingLeft: 8 + depth * 16,
                  background: depth === 0 ? rowBgParent : rowBg,
                  borderBottom: `1px solid ${bd}`,
                  cursor: hasChildren ? 'pointer' : 'default',
                  gap: 5,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = rowHover }}
                onMouseLeave={e => { e.currentTarget.style.background = depth === 0 ? rowBgParent : rowBg }}>
                {/* Chevron */}
                <span style={{ width: 12, fontSize: 9, color: '#64748b', flexShrink: 0, textAlign: 'center' }}>
                  {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
                </span>
                {/* RAG dot */}
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: node.rag ? RAG_COLORS[node.rag] : '#c4cedf', flexShrink: 0 }} />
                {/* Code */}
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{node.code}</span>
                {/* Name */}
                <span style={{ fontSize: 11, color: col, fontWeight: depth === 0 ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{node.description}</span>
              </div>
            )
          })}
        </div>

        {/* ── RIGHT PANE — timeline ── */}
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <div style={{ width: totalW, position: 'relative' }}>

            {/* Header */}
            <div style={{ position: 'sticky', top: 0, zIndex: 4, background: headerBg, borderBottom: `1px solid ${bd}` }}>
              {/* Quarter row */}
              <div style={{ display: 'flex', height: 24, borderBottom: `1px solid ${bd}` }}>
                {quarters.map((q, i) => (
                  <div key={i} style={{ width: q.spanMonths * colW, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 6, fontSize: 10, fontWeight: 600, color: '#64748b', borderRight: `1px solid ${bd}`, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {q.label}
                  </div>
                ))}
              </div>
              {/* Month row */}
              <div style={{ display: 'flex', height: 28 }}>
                {headerMonths.map((m, i) => (
                  <div key={i} style={{ width: colW, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#94a3b8', borderRight: `0.5px solid ${bd}`, background: m.qStart ? (dark ? '#1a2d4a' : '#eff6ff') : undefined }}>
                    {m.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Gantt body */}
            <div style={{ position: 'relative', height: totalH }}>
              {/* Quarter grid lines */}
              {headerMonths.map((m, i) => m.qStart ? (
                <div key={i} style={{ position: 'absolute', left: i * colW, top: 0, bottom: 0, width: 1, background: dark ? '#1e2d4a' : '#e8ecf2', zIndex: 0 }} />
              ) : null)}

              {/* Month grid lines */}
              {headerMonths.map((m, i) => !m.qStart ? (
                <div key={i} style={{ position: 'absolute', left: i * colW, top: 0, bottom: 0, width: '0.5px', background: dark ? '#1a2540' : '#f0f3f9', zIndex: 0 }} />
              ) : null)}

              {/* Today line */}
              {todayPx >= 0 && todayPx <= totalW && (
                <>
                  <div style={{ position: 'absolute', left: todayPx, top: 0, bottom: 0, width: '1.5px', background: '#E84E0F', zIndex: 2, pointerEvents: 'none' }} />
                  <div style={{ position: 'absolute', left: todayPx + 3, top: 2, fontSize: 9, fontWeight: 700, color: '#E84E0F', fontFamily: 'IBM Plex Sans, sans-serif', pointerEvents: 'none', zIndex: 2 }}>Today</div>
                </>
              )}

              {/* Rows */}
              {rows.map(({ node, depth }, rowIdx) => (
                <div key={node.id}
                  onClick={() => onNodeClick(node)}
                  style={{
                    position: 'absolute', top: rowIdx * ROW_H, left: 0, right: 0,
                    height: ROW_H, cursor: 'pointer',
                    background: depth === 0 ? (dark ? 'rgba(30,45,74,0.4)' : 'rgba(248,250,252,0.8)') : 'transparent',
                    borderBottom: `1px solid ${bd}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = dark ? 'rgba(30,41,74,0.7)' : 'rgba(244,247,251,0.9)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = depth === 0 ? (dark ? 'rgba(30,45,74,0.4)' : 'rgba(248,250,252,0.8)') : 'transparent' }}>
                  {renderBars(node, depth)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && <BarTooltip text={tooltip.text} x={tooltip.x} y={tooltip.y} />}
    </div>
  )
}
