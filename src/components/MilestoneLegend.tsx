// ─── MILESTONE LEGEND ─────────────────────────────────────────
// Reusable legend row for all tables that show milestone dots or
// RAG/status pills. Renders inline horizontal layout below a table.
// No required props. Optional dark prop for border colour.
import React from 'react'

interface Props {
  dark?: boolean
  className?: string
}

const ITEMS = [
  { label: 'Complete',    color: '#22c55e', hollow: false },
  { label: 'In Progress', color: '#f59e0b', hollow: false },
  { label: 'Breached',    color: '#ef4444', hollow: false },
  { label: 'Not Started', color: '#94a3b8', hollow: true  },
  { label: 'Future',      color: '#2563eb', hollow: false },
]

export const MilestoneLegend: React.FC<Props> = ({ dark = false, className }) => (
  <div
    className={className}
    style={{
      display: 'flex', gap: 20, alignItems: 'center',
      padding: '8px 12px',
      borderTop: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
      flexWrap: 'wrap',
    }}
  >
    {ITEMS.map(({ label, color, hollow }) => (
      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: hollow ? 'transparent' : color,
          border:     hollow ? `2px solid ${color}` : 'none',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{label}</span>
      </div>
    ))}
  </div>
)
