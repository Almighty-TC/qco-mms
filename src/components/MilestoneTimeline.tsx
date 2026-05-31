// ─── MILESTONE TIMELINE ───────────────────────────────────────
// Renders 5 coloured dots connected by lines representing PO milestones.
// Used in the Expediting register table (size=sm) and detail panel (size=md).
import React from 'react'

// ─── TYPES ────────────────────────────────────────────────────
export interface Milestone {
  id?: number
  label: string
  status: string
  planned_date?: string | null
  forecast_date?: string | null
  actual_date?: string | null
}

interface Props {
  milestones: Milestone[]
  size?: 'sm' | 'md'
}

// ─── STATUS COLOURS ───────────────────────────────────────────
// Maps milestone status string to a display colour.
const STATUS_COLORS: Record<string, string> = {
  complete:    '#22c55e',
  breached:    '#ef4444',
  at_risk:     '#f59e0b',
  in_progress: '#2563eb',
  not_started: '#94a3b8',
}

// ─── COMPONENT ────────────────────────────────────────────────
// Pads to 5 dots if fewer milestones are provided.
export const MilestoneTimeline = ({ milestones, size = 'sm' }: Props) => {
  const dotSize = size === 'sm' ? 14 : 20
  const lineW   = size === 'sm' ? 12 : 16

  const dots = [
    ...milestones,
    ...Array(Math.max(0, 5 - milestones.length)).fill({ label: '', status: 'not_started' }),
  ].slice(0, 5)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {dots.map((m, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <div style={{
              width: lineW, height: 2, flexShrink: 0,
              background: m.status === 'complete' ? '#22c55e' : '#e2e8f0',
            }} />
          )}
          <div
            title={m.label || `Milestone ${i + 1}`}
            style={{
              width: dotSize, height: dotSize, borderRadius: '50%', flexShrink: 0,
              background: STATUS_COLORS[m.status] || '#94a3b8',
              cursor: 'default',
              boxShadow: size === 'md' ? '0 1px 3px rgba(0,0,0,0.15)' : undefined,
            }}
          />
        </React.Fragment>
      ))}
    </div>
  )
}
