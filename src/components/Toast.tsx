// ─── TOAST CONTAINER ─────────────────────────────────────────
// Portal-rendered fixed top-right stack. Auto-dismissed by the
// useToast hook; user can dismiss early by clicking ×.
import { createPortal } from 'react-dom'
import { useToast } from '../hooks/useToast'
import type { ToastItem } from '../hooks/useToast'

const BG: Record<string, string> = {
  success: '#16a34a',
  error:   '#dc2626',
  warning: '#d97706',
}
const ICON: Record<string, string> = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
}

function ToastBubble({ t, onDismiss }: { t: ToastItem; onDismiss: (id: number) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      minWidth: 280, maxWidth: 420,
      padding: '10px 14px',
      borderRadius: 8,
      background: BG[t.type],
      color: '#fff',
      boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
      fontFamily: 'IBM Plex Sans, sans-serif',
      pointerEvents: 'auto',
    }}>
      <span style={{ fontSize: 14, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{ICON[t.type]}</span>
      <span style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}>{t.message}</span>
      <button
        onClick={() => onDismiss(t.id)}
        aria-label="Dismiss"
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0, marginTop: -1, flexShrink: 0, fontFamily: 'IBM Plex Sans, sans-serif' }}>
        ×
      </button>
    </div>
  )
}

export function ToastContainer() {
  const { toasts, dismiss } = useToast()
  if (!toasts.length) return null
  return createPortal(
    <div style={{
      position: 'fixed', top: 16, right: 16,
      zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'none',
    }}>
      {toasts.map(t => <ToastBubble key={t.id} t={t} onDismiss={dismiss} />)}
    </div>,
    document.body
  )
}
