// ─── STATUS LEGEND ────────────────────────────────────────────
// Generic colour key for tables/panels whose pills/dots encode status.
// Visually identical to MilestoneLegend (8px dots, 11px muted labels,
// borderTop, inline wrap) so every legend across the app sits the same —
// the only difference is the items are passed in, not hardcoded.
//
// Feed `items` from the SAME status→colour map the screen's pills use
// (don't hand-copy a second palette that can drift). `hollow` renders an
// outlined ring dot (for grey "no cert" / "not submitted" style states).
// Optional `label` prefixes a small caps title — handy when a screen shows
// two legends (e.g. Condition vs Heat-cert on the Stock register).
import React from 'react'

export interface LegendItem {
  label: string
  color: string
  hollow?: boolean
}

interface Props {
  items: LegendItem[]
  dark?: boolean
  label?: string
  className?: string
}

export const StatusLegend: React.FC<Props> = ({ items, dark = false, label, className }) => (
  <div
    className={className}
    style={{
      display: 'flex', gap: 20, alignItems: 'center',
      padding: '8px 12px',
      borderTop: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
      flexWrap: 'wrap',
    }}
  >
    {label && (
      <span style={{
        fontSize: 10, fontWeight: 700, color: '#94a3b8',
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        {label}
      </span>
    )}
    {items.map(({ label: itemLabel, color, hollow }) => (
      <div key={itemLabel} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: hollow ? 'transparent' : color,
          border:     hollow ? `2px solid ${color}` : 'none',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{itemLabel}</span>
      </div>
    ))}
  </div>
)
