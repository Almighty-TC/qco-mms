// QCO MMS - Shared Help Modal for all Admin tabs.
// Pass `sections` prop with the content for each tab's help panel.
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// ─── TYPES ──────────────────────────────────────────────────────
export type HelpSection = {
  icon: string
  title: string
  items: React.ReactNode[]
}

// ─── HELP MODAL ─────────────────────────────────────────────────
// Portal-rendered modal for per-tab admin help content.
export function HelpModal({
  dark, title, subtitle, sections, onClose,
}: {
  dark: boolean
  title: string
  subtitle?: string
  sections: HelpSection[]
  onClose: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div style={{ width: 600, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', background: dark ? '#1e293b' : '#ffffff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.5)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${dark ? 'rgba(232,78,15,0.2)' : '#e2e8f0'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: dark ? '#0f172a' : '#f8fafc' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 15, color: '#E84E0F' }}>◈</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{subtitle}</div>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '20px' }}>
          {sections.map((sec, i) => (
            <div key={i}>
              {i > 0 && <div style={{ borderTop: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, margin: '18px 0' }} />}
              <div style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>{sec.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#E84E0F', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{sec.title}</span>
                </div>
                <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sec.items.map((item, j) => (
                    <li key={j} style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.55, paddingLeft: 2 }}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
