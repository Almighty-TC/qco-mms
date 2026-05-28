// ─── ACTION MENU ────────────────────────────────────────────────
// Portal-rendered dropdown attached to an "Actions ▾" trigger.
// Only one menu is open at a time across all admin tables.
import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

// ─── ACTION ITEM TYPE ─────────────────────────────────────────────
export type ActionItem = {
  label: string
  icon: string
  onClick: () => void
  variant?: 'default' | 'warning' | 'danger'
  hidden?: boolean
}

// ─── SINGLE-OPEN COORDINATOR ─────────────────────────────────────
// Module-level reference to whichever menu's close fn is currently active.
// Opening a new menu calls this first to close the previous one.
let _closeActive: (() => void) | null = null

// ─── COMPONENT ───────────────────────────────────────────────────
export function ActionMenu({ actions, dark }: { actions: ActionItem[]; dark: boolean }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, right: 0 })
  const btnRef  = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const visible = actions.filter(a => !a.hidden)

  // ─── TOGGLE ──────────────────────────────────────────────────
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      _closeActive = null
      return
    }
    _closeActive?.()
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen(true)
    _closeActive = () => setOpen(false)
  }

  // ─── OUTSIDE CLICK + ESCAPE ──────────────────────────────────
  // Uses mousedown (not click) so we can cancel the close when the
  // target is inside the portal dropdown — mousedown fires before
  // the click event, so without the dropRef check the handler would
  // close the menu before the item's onClick could fire.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (dropRef.current?.contains(e.target as Node)) return
      setOpen(false)
      _closeActive = null
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); _closeActive = null }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown',   onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        style={{
          fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 5,
          border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
          background: open ? (dark ? 'rgba(255,255,255,0.06)' : '#f1f5f9') : 'transparent',
          color: '#64748b',
          cursor: 'pointer',
          fontFamily: 'IBM Plex Sans, sans-serif',
          display: 'inline-flex', alignItems: 'center', gap: 5,
          whiteSpace: 'nowrap',
          transition: 'background 100ms',
        }}
      >
        Actions
        <span style={{
          fontSize: 8, lineHeight: 1, display: 'inline-block',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 150ms',
        }}>▾</span>
      </button>

      {/* ─── PORTAL DROPDOWN ──────────────────────────────── */}
      {/* Portal to body so overflow:clip on AdminTable outer div */}
      {/* does not clip the menu.                               */}
      {open && createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          top: pos.top,
          right: pos.right,
          zIndex: 9100,
          minWidth: 168,
          background: dark ? '#1e293b' : '#ffffff',
          border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
          borderRadius: 8,
          boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          fontFamily: 'IBM Plex Sans, sans-serif',
        }}>
          {visible.map((action, i) => {
            const textColor =
              action.variant === 'danger'  ? '#ef4444'
              : action.variant === 'warning' ? '#d97706'
              : (dark ? '#f1f5f9' : '#0f172a')
            return (
              <button
                key={i}
                onClick={() => { setOpen(false); _closeActive = null; action.onClick() }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 16px',
                  background: 'transparent', border: 'none',
                  borderBottom: i < visible.length - 1
                    ? `1px solid ${dark ? 'rgba(255,255,255,0.05)' : '#f1f5f9'}`
                    : 'none',
                  color: textColor, fontSize: 13,
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = dark ? 'rgba(255,255,255,0.05)' : '#f8fafc' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ width: 16, textAlign: 'center', fontSize: 13, flexShrink: 0 }}>
                  {action.icon}
                </span>
                {action.label}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}
