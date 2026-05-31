// ─── MILESTONE TIMELINE ───────────────────────────────────────
// Renders 5 coloured dots connected by lines representing PO milestones.
// Used in the Expediting register table (size=sm) and detail screen (size=lg).
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
  size?: 'sm' | 'lg'
  showDates?: boolean
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

// ─── DATE FORMATTER ───────────────────────────────────────────
const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : null

// ─── COMPONENT ────────────────────────────────────────────────
// Pads to 5 dots if fewer milestones are provided.
export const MilestoneTimeline = ({ milestones, size = 'sm', showDates = false }: Props) => {
  const dotSize  = size === 'lg' ? 24 : 16
  const lineW    = size === 'lg' ? 36 : 24

  const dots = [
    ...milestones,
    ...Array(Math.max(0, 5 - milestones.length)).fill({ label: '', status: 'not_started' }),
  ].slice(0, 5)

  if (size === 'lg') {
    // ─── LARGE: vertical labels + dates ─────────────────────
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
        {dots.map((m, i) => {
          const color = STATUS_COLORS[m.status] || '#94a3b8'
          const isNotStarted = m.status === 'not_started'
          const connColor = i > 0 && dots[i - 1]?.status === 'complete' ? '#22c55e' : '#e2e8f0'
          const dateStr = fmt(m.actual_date) || fmt(m.forecast_date) || fmt(m.planned_date)
          const tooltip = [
            m.label,
            m.actual_date ? `Actual: ${fmt(m.actual_date)}` : null,
            m.forecast_date ? `Forecast: ${fmt(m.forecast_date)}` : null,
            m.planned_date ? `Planned: ${fmt(m.planned_date)}` : null,
          ].filter(Boolean).join('\n')

          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: dotSize / 2 - 1 }}>
                  <div style={{ width: lineW, height: 2, background: connColor }} />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: dotSize + 8 }}>
                <div
                  title={tooltip}
                  style={{
                    width: dotSize, height: dotSize, borderRadius: '50%', flexShrink: 0,
                    background: isNotStarted ? 'transparent' : color,
                    border: isNotStarted ? `2px solid ${color}` : 'none',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    cursor: 'default',
                  }}
                />
                {showDates && (
                  <div style={{ marginTop: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>
                      {m.label || `M${i + 1}`}
                    </div>
                    {dateStr && (
                      <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 1, whiteSpace: 'nowrap' }}>{dateStr}</div>
                    )}
                  </div>
                )}
              </div>
            </React.Fragment>
          )
        })}
      </div>
    )
  }

  // ─── SMALL: inline dots, no labels ──────────────────────────
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {dots.map((m, i) => {
        const color = STATUS_COLORS[m.status] || '#94a3b8'
        const isNotStarted = m.status === 'not_started'
        const connColor = i > 0 && dots[i - 1]?.status === 'complete' ? '#22c55e' : '#e2e8f0'
        const tooltip = [
          m.label,
          m.actual_date ? `Actual: ${fmt(m.actual_date)}` : null,
          m.forecast_date ? `Forecast: ${fmt(m.forecast_date)}` : null,
          m.planned_date ? `Planned: ${fmt(m.planned_date)}` : null,
        ].filter(Boolean).join('\n')

        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <div style={{ width: lineW, height: 2, flexShrink: 0, background: connColor }} />
            )}
            <div
              title={tooltip}
              style={{
                width: dotSize, height: dotSize, borderRadius: '50%', flexShrink: 0,
                background: isNotStarted ? 'transparent' : color,
                border: isNotStarted ? `2px solid ${color}` : 'none',
                cursor: 'default',
              }}
            />
          </React.Fragment>
        )
      })}
    </div>
  )
}
