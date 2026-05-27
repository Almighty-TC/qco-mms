// ─── RESIZE HANDLE ───────────────────────────────────────────
// Right-edge drag target for every resizable column header.
// Appearance is controlled entirely by globals.css §9 so the look
// updates globally without touching component code.
//
// Anatomy rendered:
//   .resize-handle (8px container, full header height)
//     └─ .resize-handle-bar (3px visible bar, 60% height)
//          └─ <svg .resize-grip-icon> (2×3 dot grid, always present)
//
// At rest  : bar is var(--color-border), dots at 60% opacity — discoverable.
// On hover : bar → QCO orange (#E84E0F), dots → white, cursor col-resize.
// No React state is needed; CSS :hover handles all visual transitions.
export const ResizeHandle = ({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void
}) => (
  <div className="resize-handle" onMouseDown={onMouseDown}>
    <div className="resize-handle-bar">
      {/* ─── GRIP ICON ───────────────────────────────────────
          2-column × 3-row SVG dot grid. fill and opacity are
          driven by .resize-grip-icon CSS in globals.css.     */}
      <svg
        className="resize-grip-icon"
        width="6"
        height="18"
        viewBox="0 0 6 18"
        aria-hidden="true">
        <circle cx="1.5" cy="3"  r="1" />
        <circle cx="4.5" cy="3"  r="1" />
        <circle cx="1.5" cy="9"  r="1" />
        <circle cx="4.5" cy="9"  r="1" />
        <circle cx="1.5" cy="15" r="1" />
        <circle cx="4.5" cy="15" r="1" />
      </svg>
    </div>
  </div>
)

// ─── HEADER CELL ─────────────────────────────────────────────
// Column header label with a ResizeHandle pinned to its right edge.
// position:relative lets the handle sit at position:absolute within it.
// The dark prop has been removed — label colour comes from
// var(--color-text-muted) in globals.css, which is theme-aware.
export const HeaderCell = ({
  label,
  col,
  align = 'center',
  onResize,
}: {
  label: string
  col: string
  align?: 'left' | 'center'
  onResize: (col: string, startX: number) => void
}) => (
  <div style={{
    position: 'relative',
    textAlign: align,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: align === 'left' ? '0 20px 0 16px' : '0 14px 0 8px',
    overflow: 'hidden',
    userSelect: 'none',
  }}>
    {label}
    <ResizeHandle
      onMouseDown={(e) => { e.preventDefault(); onResize(col, e.clientX) }}
    />
  </div>
)
