// ─── HELP DRAWER ────────────────────────────────────────────
// Reusable right-side drawer opened by "? Help" button.
// Each screen passes its own screenName + sections as props.
import { useState } from 'react'
import { createPortal } from 'react-dom'

export interface HelpSection {
  title: string
  content: React.ReactNode
}

interface HelpDrawerProps {
  screenName: string
  sections: HelpSection[]
  dark: boolean
  onClose: () => void
}

export const HelpDrawer = ({ screenName, sections, dark, onClose }: HelpDrawerProps) => {
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([0]))
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bg  = dark ? '#1e293b' : '#fff'
  const bd  = `1px solid ${dark ? '#334155' : '#dde3ed'}`

  const toggle = (i: number) => setOpenSections(prev => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i); else next.add(i)
    return next
  })

  const prose: React.CSSProperties = {
    fontSize: 13, color: dark ? '#e2e8f0' : '#475569', lineHeight: 1.65,
    fontFamily: 'IBM Plex Sans, sans-serif',
  }

  return createPortal(
    <>
      {/* Scrim */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 8000 }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
        background: bg, borderLeft: bd, zIndex: 8001,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
        fontFamily: 'IBM Plex Sans, sans-serif',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: bd, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col }}>? Help</div>
            <div style={{ fontSize: 12, color: dark ? '#e2e8f0' : '#94a3b8', marginTop: 2 }}>{screenName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>✕</button>
        </div>

        {/* Sections (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {sections.map((s, i) => (
            <div key={i} style={{ borderBottom: bd }}>
              {/* Section toggle */}
              <button
                onClick={() => toggle(i)}
                style={{
                  width: '100%', padding: '12px 20px', textAlign: 'left',
                  background: openSections.has(i) ? (dark ? 'rgba(37,99,235,0.08)' : 'rgba(37,99,235,0.04)') : 'none',
                  border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', fontSize: 13, fontWeight: 600, color: openSections.has(i) ? '#2563eb' : col,
                  fontFamily: 'inherit',
                }}>
                <span>{s.title}</span>
                <span style={{ fontSize: 11, color: dark ? '#cbd5e1' : '#94a3b8', transition: 'transform 200ms', display: 'inline-block', transform: openSections.has(i) ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
              </button>

              {openSections.has(i) && (
                <div style={{ padding: '0 20px 16px', ...prose }}>
                  {s.content}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: bd, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <a
            href="http://localhost:3001/docs/USER_MANUAL.md"
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}
            onMouseEnter={e => { (e.target as HTMLElement).style.textDecoration = 'underline' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.textDecoration = 'none' }}>
            📖 View full manual
          </a>
          <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: bd, background: 'none', color: dark ? '#cbd5e1' : '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            ✕ Close
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}

// ─── HELP BUTTON ─────────────────────────────────────────────
// Drop-in button that opens HelpDrawer. Pass screenName + sections.
export const HelpButton = ({ screenName, sections, dark }: {
  screenName: string; sections: HelpSection[]; dark: boolean
}) => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Help — ${screenName}`}
        style={{
          padding: '6px 12px', borderRadius: 6,
          border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
          background: 'none', color: '#64748b', fontSize: 12,
          cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif',
          display: 'flex', alignItems: 'center', gap: 5,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = dark ? '#e2e8f0' : '#0f172a' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#64748b' }}>
        ? Help
      </button>
      {open && (
        <HelpDrawer screenName={screenName} sections={sections} dark={dark} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
