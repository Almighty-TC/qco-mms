// ─── EXPAND TOGGLE ───────────────────────────────────────────
// Shared "expand / shrink window" control for detail modals & drawers, so the View
// popups can grow to near-fullscreen. Matches the FMR detail modal (⤢ expand / 🗗 shrink).
// The modal owns the width/height logic (centered → 95vw×90vh, drawer → 95vw); this just
// supplies the boolean + the button so every modal behaves and looks identical.
import { useState } from 'react'

export function useExpand(): [boolean, () => void] {
  const [expanded, setExpanded] = useState(false)
  return [expanded, () => setExpanded(e => !e)]
}

export const ExpandBtn = ({ expanded, onToggle, color = '#94a3b8' }: {
  expanded: boolean; onToggle: () => void; color?: string
}) => (
  <button onClick={onToggle} title={expanded ? 'Shrink window' : 'Expand window'}
    style={{ background: 'none', border: 'none', fontSize: 16, color, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}>
    {expanded ? '🗗' : '⤢'}
  </button>
)
