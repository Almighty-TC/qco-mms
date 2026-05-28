// ─── SIMPLE CONFIRM MODAL ────────────────────────────────────
// Lightweight confirmation dialog for non-destructive or reversible
// actions: deactivate, archive, status changes, bulk operations.
//
// Unlike DeleteConfirmModal, this requires no reason dropdown and no
// checkbox — it is just a plain "are you sure?" prompt. Use it when
// the action is reversible (deactivate can be undone by reactivating)
// or low-risk enough that a single click confirmation suffices.
//
// Usage:
//   {deactivateTarget && (
//     <SimpleConfirmModal
//       dark={dark}
//       title="Deactivate Supplier"
//       message={`Are you sure you want to deactivate ${deactivateTarget.name}?`}
//       confirmLabel="Deactivate"
//       confirmStyle="warning"
//       onConfirm={confirmDeactivate}
//       onCancel={() => setDeactivateTarget(null)}
//       saving={deactivateSaving}
//       error={deactivateErr}
//     />
//   )}

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// ─── CONFIRM BUTTON COLOUR MAP ───────────────────────────────
// 'warning'  → amber  (deactivate, archive — reversible)
// 'danger'   → red    (irreversible but modal-less actions)
// 'primary'  → QCO orange (general positive confirmations)
const COLOURS = {
  warning: '#d97706',
  danger:  '#ef4444',
  primary: '#E84E0F',
}

type Props = {
  dark: boolean
  title?: string
  message: string
  confirmLabel?: string
  confirmStyle?: keyof typeof COLOURS
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  saving?: boolean
  error?: string
}

export function SimpleConfirmModal({
  dark,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  confirmStyle = 'primary',
  onConfirm,
  onCancel,
  saving = false,
  error,
}: Props) {
  const font = 'IBM Plex Sans, sans-serif'
  const bg   = COLOURS[confirmStyle]

  // ─── KEYBOARD ESC ───────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onCancel])

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, fontFamily: font,
      }}
    >
      <div style={{
        width: 400,
        background: dark ? '#1e293b' : '#ffffff',
        border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
        borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.5)', overflow: 'hidden',
      }}>

        {/* ─── HEADER ───────────────────────────────────────── */}
        <div style={{
          padding: '14px 20px',
          borderBottom: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>
            {title}
          </span>
          <button
            onClick={onCancel}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1, fontFamily: font }}
          >
            ×
          </button>
        </div>

        {/* ─── BODY ─────────────────────────────────────────── */}
        <div style={{ padding: '20px' }}>
          <p style={{ margin: 0, fontSize: 13, color: dark ? '#cbd5e1' : '#334155', lineHeight: 1.6 }}>
            {message}
          </p>
          {error && (
            <div style={{
              marginTop: 12, padding: '8px 12px', borderRadius: 6,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              fontSize: 12, color: '#ef4444',
            }}>
              {error}
            </div>
          )}
        </div>

        {/* ─── FOOTER ───────────────────────────────────────── */}
        <div style={{
          padding: '14px 20px',
          borderTop: `1px solid ${dark ? '#334155' : '#f1f5f9'}`,
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: '7px 16px', borderRadius: 6, fontSize: 13,
              border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
              background: 'transparent', color: '#64748b', cursor: 'pointer', fontFamily: font,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => { if (!saving) onConfirm() }}
            disabled={saving}
            style={{
              padding: '7px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              border: 'none', background: bg, color: '#fff',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1, fontFamily: font,
            }}
          >
            {saving ? 'Processing…' : confirmLabel}
          </button>
        </div>

      </div>
    </div>,
    document.body
  )
}
