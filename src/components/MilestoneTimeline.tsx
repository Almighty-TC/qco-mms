// ─── MILESTONE TIMELINE ───────────────────────────────────────
// Renders 5 coloured milestone dots with short abbreviated labels below.
// sm: dots + connectors only (no labels/dates) — used in register table rows
// lg: dots + connectors + abbreviated labels + optional dates — used in detail
import React from 'react'

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

// ─── LABEL ABBREVIATIONS ─────────────────────────────────────
// Short labels that fit without overlap at any realistic screen width.
const ABBREV: Record<string, string> = {
  'PO Award':            'Award',
  'FAT / Inspection':    'FAT',
  'Ready for Shipment':  'Ready',
  'ETD / Ship':          'ETD',
  'ROS / ETA':           'ROS',
}
const abbrev = (label: string) => ABBREV[label] ?? label.split(' ')[0]

// ─── STATUS COLOURS ───────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  complete:    '#22c55e',
  breached:    '#ef4444',
  at_risk:     '#f59e0b',
  in_progress: '#2563eb',
  not_started: '#94a3b8',
}

// ─── DATE FORMATTER ──────────────────────────────────────────
const fmtShort = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : null

// ─── COMPONENT ────────────────────────────────────────────────
export const MilestoneTimeline: React.FC<Props> = ({
  milestones, size = 'sm', showDates = false,
}) => {
  // Pad to exactly 5 slots
  const slots = [
    ...milestones.slice(0, 5),
    ...Array(Math.max(0, 5 - milestones.length)).fill({ label: '', status: 'not_started' }),
  ]

  const dotSize  = size === 'sm' ? 14 : 20
  const dotHalf  = dotSize / 2   // used to centre connector line vertically

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', position: 'relative' }}>
      {slots.map((m: Milestone, i: number) => {
        const colour     = STATUS_COLORS[m.status] || '#94a3b8'
        const isFilled   = m.status !== 'not_started'
        const isLast     = i === slots.length - 1
        const leftDone   = i > 0 && slots[i - 1].status === 'complete'
        const connColour = leftDone ? '#22c55e' : '#e2e8f0'

        // Date to display: actual → forecast → planned
        const displayDate = m.actual_date || m.forecast_date || m.planned_date

        // Hover tooltip text
        const tip = [
          m.label,
          m.planned_date  ? `Planned: ${fmtShort(m.planned_date)}`  : null,
          m.forecast_date ? `Forecast: ${fmtShort(m.forecast_date)}` : null,
          m.actual_date   ? `Actual: ${fmtShort(m.actual_date)}`    : null,
        ].filter(Boolean).join('\n')

        return (
          <div
            key={i}
            title={tip}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              position: 'relative',
              gap: 4,
            }}
          >
            {/* Connector line to the right — skipped on last slot */}
            {!isLast && (
              <div style={{
                position: 'absolute',
                top: dotHalf,
                left: '50%',
                right: '-50%',
                height: 2,
                background: connColour,
                zIndex: 0,
                pointerEvents: 'none',
              }} />
            )}

            {/* Dot */}
            <div style={{
              width:        dotSize,
              height:       dotSize,
              borderRadius: '50%',
              background:   isFilled ? colour : 'transparent',
              border:       isFilled ? 'none' : `2px solid ${colour}`,
              flexShrink:   0,
              zIndex:       1,
              position:     'relative',
            }} />

            {/* Label — lg only */}
            {size === 'lg' && m.label && (
              <span style={{
                fontSize:      10,
                color:         '#94a3b8',
                textAlign:     'center',
                whiteSpace:    'nowrap',
                letterSpacing: '0.02em',
                lineHeight:    1.2,
              }}>
                {abbrev(m.label)}
              </span>
            )}

            {/* Date — lg + showDates + date exists */}
            {size === 'lg' && showDates && displayDate && (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize:   10,
                color:      colour,
                textAlign:  'center',
                whiteSpace: 'nowrap',
              }}>
                {fmtShort(displayDate)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
