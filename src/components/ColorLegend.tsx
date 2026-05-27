import { useState, useEffect, useRef } from 'react'

// ─── COLOUR DATA ─────────────────────────────────────────────
// Single source of truth for colour meanings across the whole app.
// Update here and every page that renders ColorLegend reflects it.

const RAG_ITEMS = [
  { color: '#ef4444', label: 'Red / Breached',    desc: 'Critical — immediate action required'   },
  { color: '#f59e0b', label: 'Amber / At risk',   desc: 'Warning — attention needed'             },
  { color: '#22c55e', label: 'Green / On track',  desc: 'Good — no action required'              },
  { color: '#2563eb', label: 'Blue / In progress', desc: 'Active — currently being worked on'    },
  { color: '#8899aa', label: 'Grey / Not started', desc: 'Not started or no data available'      },
] as const

const ALERT_ITEMS = [
  { color: '#ef4444', label: 'Red badge',    desc: 'Critical alert — overdue'           },
  { color: '#E84E0F', label: 'Orange badge', desc: 'Warning — approaching deadline'     },
  { color: '#eab308', label: 'Yellow badge', desc: 'Caution — monitor closely'          },
] as const

// ─── COLOUR ROW ──────────────────────────────────────────────
// One legend entry: coloured dot, bold label, muted description.
// The dot has a faint colour-matched glow to help distinguish
// similar hues (e.g. red vs. orange) at small sizes.
const ColorRow = ({
  color, label, desc,
}: {
  color: string; label: string; desc: string
}) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
    <span style={{
      width: 11, height: 11,
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

// ─── SECTION LABEL ───────────────────────────────────────────
// Small all-caps divider label above each group of colour rows.
const SectionLabel = ({ label }: { label: string }) => (
  <div style={{
    fontSize: 9, fontWeight: 700, color: '#374151',
    letterSpacing: '0.1em', textTransform: 'uppercase',
    marginBottom: 11,
  }}>
    {label}
  </div>
)

// ─── COLOR LEGEND ────────────────────────────────────────────
// Fixed-position floating button in the bottom-right corner of
// every screen.  Because this component is rendered outside the
// zoom-scaled root div (see App.tsx), position:fixed is always
// relative to the physical viewport regardless of font-size zoom.
//
// Trigger: 40px circle with a conic-gradient showing all four RAG
//   colours — immediately communicates "colour key" at a glance.
//   Border and glow turn QCO orange (#E84E0F) when the panel is open.
//
// Panel: opens upward from the button (bottom: calc(100% + 12px)).
//   Dark navy (#0d1117), orange accent, sticky header, scrollable body.
//   Dismissed by click-outside or Escape.
export function ColorLegend() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef   = useRef<HTMLButtonElement>(null)

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
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 9998,
      fontFamily: 'IBM Plex Sans, sans-serif',
    }}>

      {/* ─── PANEL ───────────────────────────────────────────────
          Opens upward. Sticky header stays visible when the body
          scrolls on small screens. Max-height caps it at the
          visible viewport minus button + gap. */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 12px)',
            right: 0,
            width: 278,
            maxHeight: 'calc(100vh - 120px)',
            display: 'flex',
            flexDirection: 'column',
            background: '#0d1117',
            border: '1px solid rgba(232,78,15,0.22)',
            borderRadius: 12,
            boxShadow:
              '0 24px 56px rgba(0,0,0,0.65), ' +
              '0 0 0 1px rgba(232,78,15,0.06)',
            overflow: 'hidden',
          }}>

          {/* ─── PANEL HEADER ──────────────────────────────────
              Sticky so it stays visible while the body scrolls.
              Mini conic swatch mirrors the trigger button. */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid rgba(232,78,15,0.14)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#0d1117',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{
                width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                background:
                  'conic-gradient(' +
                  '#ef4444 0deg 90deg, ' +
                  '#22c55e 90deg 180deg, ' +
                  '#f59e0b 180deg 270deg, ' +
                  '#2563eb 270deg 360deg)',
              }} />
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: '#E84E0F', letterSpacing: '-0.01em',
              }}>
                Colour guide
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none', border: 'none',
                color: '#4b5563', cursor: 'pointer',
                fontSize: 18, lineHeight: 1, padding: '0 2px',
                display: 'flex', alignItems: 'center',
              }}>
              ×
            </button>
          </div>

          {/* ─── PANEL BODY ────────────────────────────────────
              Scrollable. Two sections separated by a subtle rule. */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '14px 16px' }}>

            <SectionLabel label="RAG Status" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {RAG_ITEMS.map(item => (
                <ColorRow key={item.label} {...item} />
              ))}
            </div>

            <div style={{
              height: 1,
              background: 'rgba(255,255,255,0.05)',
              margin: '16px 0',
            }} />

            <SectionLabel label="Priority & Alerts" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {ALERT_ITEMS.map(item => (
                <ColorRow key={item.label} {...item} />
              ))}
            </div>
          </div>

          {/* ─── PANEL FOOTER ──────────────────────────────────
              Branding watermark, consistent with HelpLegend. */}
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

      {/* ─── TRIGGER BUTTON ──────────────────────────────────────
          40px circle. Conic-gradient background shows all four RAG
          colours so the purpose is clear without any label.
          The orange border + glow ring activates when the panel is open. */}
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        title="Colour guide"
        aria-label="Open colour guide"
        style={{
          width: 40, height: 40,
          borderRadius: '50%',
          padding: 0,
          cursor: 'pointer',
          border: `2px solid ${open ? '#E84E0F' : 'rgba(255,255,255,0.18)'}`,
          background:
            'conic-gradient(' +
            '#ef4444 0deg 90deg, ' +
            '#22c55e 90deg 180deg, ' +
            '#f59e0b 180deg 270deg, ' +
            '#2563eb 270deg 360deg)',
          boxShadow: open
            ? '0 0 0 4px rgba(232,78,15,0.28), 0 6px 20px rgba(0,0,0,0.4)'
            : '0 4px 16px rgba(0,0,0,0.3)',
          transition: 'box-shadow 150ms ease, border-color 150ms ease',
          display: 'block',
        }}
      />
    </div>
  )
}
