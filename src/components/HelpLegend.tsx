import { useState, useEffect, useRef } from 'react'

// ─── CONSTANTS ───────────────────────────────────────────────
// localStorage key that tracks whether the user has already seen the guide.
// First-time visitors see the panel automatically; subsequent visits require
// clicking "?".
const HELP_SEEN_KEY = 'qmat_help_seen'

// ─── RAG COLOUR DATA ─────────────────────────────────────────
// Single source of truth for the colour guide section. Changing an entry
// here updates every place the help panel is rendered.
const RAG_ITEMS = [
  { color: '#ef4444', label: 'Red / Breached',     desc: 'Critical — immediate action required'  },
  { color: '#f59e0b', label: 'Amber / At risk',    desc: 'Warning — attention needed'            },
  { color: '#22c55e', label: 'Green / On track',   desc: 'Good — no action required'             },
  { color: '#2563eb', label: 'Blue / In progress', desc: 'Active — currently being worked on'    },
  { color: '#8899aa', label: 'Grey / Not started', desc: 'Not started or no data available'      },
] as const

// ─── SECTION LABEL ───────────────────────────────────────────
// Small all-caps divider label above each group of rows.
const SectionLabel = ({ label }: { label: string }) => (
  <div style={{
    fontSize: 9, fontWeight: 700, color: '#374151',
    letterSpacing: '0.1em', textTransform: 'uppercase',
    marginBottom: 11,
  }}>
    {label}
  </div>
)

// ─── TIP ITEM ────────────────────────────────────────────────
// One UI-tip row: QCO orange icon glyph, bold title, muted description.
const TipItem = ({
  icon, title, desc,
}: {
  icon: string; title: string; desc: string
}) => (
  <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
    <span style={{
      fontSize: 13, flexShrink: 0, lineHeight: 1.5,
      width: 22, textAlign: 'center',
      color: '#E84E0F', fontWeight: 700,
      fontFamily: 'IBM Plex Sans, sans-serif',
    }}>
      {icon}
    </span>
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', marginBottom: 2 }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.55 }}>
        {desc}
      </div>
    </div>
  </div>
)

// ─── COLOUR ROW ──────────────────────────────────────────────
// One RAG legend entry: coloured dot with glow, bold label, muted description.
const ColorRow = ({
  color, label, desc,
}: {
  color: string; label: string; desc: string
}) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
    <span style={{
      width: 10, height: 10,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
      marginTop: 3,
      boxShadow: `0 0 0 3px ${color}28`,
    }} />
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', lineHeight: 1.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5, marginTop: 1 }}>
        {desc}
      </div>
    </div>
  </div>
)

// ─── DIVIDER ─────────────────────────────────────────────────
// Subtle horizontal rule separating panel sections.
const Divider = () => (
  <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '14px 0' }} />
)

// ─── HELP LEGEND ─────────────────────────────────────────────
// "?" button in the topbar that opens a scrollable popover combining:
//   • UI tips (column resize, hover tooltips, text size, dark mode, reset)
//   • RAG colour guide (replaces the separate floating ColorLegend button)
//
// Panel is always dark navy (#0d1117) with QCO orange (#E84E0F) accents,
// regardless of app theme. Auto-opens on first login (localStorage flag);
// dismissed by click-outside or Escape.
export function HelpLegend({ dark }: { dark: boolean }) {
  const [open, setOpen] = useState(
    () => !localStorage.getItem(HELP_SEEN_KEY),
  )
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef   = useRef<HTMLButtonElement>(null)

  // ─── MARK AS SEEN ────────────────────────────────────────────
  // Write to localStorage the moment the panel first opens so it
  // doesn't auto-show on subsequent visits.
  useEffect(() => {
    if (open) localStorage.setItem(HELP_SEEN_KEY, '1')
  }, [open])

  // ─── OUTSIDE CLICK DISMISS ───────────────────────────────────
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current   && !btnRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ─── ESCAPE KEY DISMISS ──────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>

      {/* ─── TRIGGER BUTTON ────────────────────────────────────
          28×28 matches the other topbar icon buttons.
          Orange border + background activates when the panel is open. */}
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        title="Help & colour guide"
        style={{
          width: 28, height: 28,
          border: `1px solid ${open
            ? 'rgba(232,78,15,0.55)'
            : (dark ? '#334155' : '#dde3ed')}`,
          borderRadius: 6,
          background: open
            ? 'rgba(232,78,15,0.12)'
            : (dark ? '#0f172a' : '#f4f7fb'),
          color: open ? '#E84E0F' : '#94a3b8',
          fontSize: 13, fontWeight: 700,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 150ms',
          fontFamily: 'IBM Plex Sans, sans-serif',
          flexShrink: 0,
        }}>
        ?
      </button>

      {/* ─── POPOVER PANEL ─────────────────────────────────────
          320px wide, scrollable body, sticky header.
          Positioned below the trigger; right-aligned so it doesn't
          overflow the viewport edge when the topbar is near the right. */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            top: 36, right: 0,
            width: 320,
            maxHeight: 'calc(100vh - 100px)',
            display: 'flex',
            flexDirection: 'column',
            background: '#0d1117',
            border: '1px solid rgba(232,78,15,0.22)',
            borderRadius: 10,
            boxShadow:
              '0 24px 48px rgba(0,0,0,0.6), ' +
              '0 0 0 1px rgba(232,78,15,0.06)',
            zIndex: 9999,
            overflow: 'hidden',
            fontFamily: 'IBM Plex Sans, sans-serif',
          }}>

          {/* ─── PANEL HEADER ──────────────────────────────────
              Sticky so it stays visible when the body scrolls.
              ◈ glyph + "Platform guide" label in QCO orange. */}
          <div style={{
            padding: '11px 16px',
            borderBottom: '1px solid rgba(232,78,15,0.14)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#0d1117',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, color: '#E84E0F' }}>◈</span>
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: '#E84E0F', letterSpacing: '-0.01em',
              }}>
                Platform guide
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none', border: 'none', color: '#4b5563',
                cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px',
                display: 'flex', alignItems: 'center',
              }}>
              ×
            </button>
          </div>

          {/* ─── PANEL BODY ────────────────────────────────────
              Two sections separated by a subtle divider:
              1. UI tips  2. RAG colour guide */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '14px 16px' }}>

            <SectionLabel label="UI Controls" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <TipItem
                icon="↔"
                title="Column resize"
                desc="Drag the handle at the right edge of any column header. All rows resize together simultaneously."
              />
              <TipItem
                icon="…"
                title="Hover for full text"
                desc="Hover over any truncated cell to see the full content in a tooltip."
              />
              <TipItem
                icon="A"
                title="Text size"
                desc="Use the A– A A+ buttons in the topbar to switch between Small, Medium, and Large text."
              />
              <TipItem
                icon="☾"
                title="Dark / Light mode"
                desc="Click the moon or sun icon in the topbar to toggle between dark and light themes."
              />
              <TipItem
                icon="↺"
                title="Reset defaults"
                desc="Click ↺ in the topbar to reset text size, dark mode, and column widths back to defaults."
              />
            </div>

            <Divider />

            <SectionLabel label="Colour Guide — RAG Status" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {RAG_ITEMS.map(item => (
                <ColorRow key={item.label} {...item} />
              ))}
            </div>
          </div>

          {/* ─── PANEL FOOTER ──────────────────────────────────
              Branding watermark, consistent with the rest of the QCO UI. */}
          <div style={{
            padding: '8px 16px 12px',
            borderTop: '1px solid rgba(255,255,255,0.04)',
            flexShrink: 0,
          }}>
            <span style={{
              fontSize: 10, color: '#1f2937',
              letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600,
            }}>
              QCO QMAT · Supply Chain Platform
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
