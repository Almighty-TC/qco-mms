// ─── DELETE CONFIRM MODAL ────────────────────────────────────
// Global standard for ALL permanent deletions in QCO MMS.
//
// The admin must: (1) select a documented reason from the dropdown,
// (2) tick a confirmation checkbox. The Confirm Delete button stays
// disabled until both conditions are met — this ensures every deletion
// is deliberate and always has an audit trail entry with a reason.
//
// The reason string is passed back via onConfirm(reason) so the caller
// can forward it to the server's delete endpoint, which logs it to audit.
//
// Usage:
//   {deleteTarget && (
//     <DeleteConfirmModal
//       dark={dark}
//       itemName={deleteTarget.name}
//       onConfirm={reason => del(deleteTarget.id, reason)}
//       onCancel={() => setDeleteTarget(null)}
//       saving={deleteSaving}
//       error={deleteErr}
//     />
//   )}
//
// Optional props:
//   reasons   — override the default reason list (e.g. remove "Left the
//               organisation" for non-user records)
//   itemType  — displayed as "delete this [itemType]" in the checkbox label

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

// ─── DEFAULT REASON LIST ─────────────────────────────────────
// Covers all resource types. Callers can override via the `reasons` prop.
// "Left the organisation" and "Contract ended" are user-specific but
// harmless to show for other record types.
export const DEFAULT_DELETE_REASONS = [
  'Left the organisation',
  'Contract ended',
  'Duplicate record',
  'Created in error',
  'No longer required',
  'Other',
] as const

type Props = {
  dark: boolean
  itemName: string
  itemType?: string
  reasons?: string[]
  onConfirm: (reason: string) => void | Promise<void>
  onCancel: () => void
  saving?: boolean
  error?: string
}

export function DeleteConfirmModal({
  dark,
  itemName,
  itemType = 'record',
  reasons,
  onConfirm,
  onCancel,
  saving = false,
  error,
}: Props) {
  const [reason,    setReason]    = useState('')
  const [otherText, setOtherText] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const font       = 'IBM Plex Sans, sans-serif'
  const reasonList = reasons ?? DEFAULT_DELETE_REASONS

  // ─── DERIVED STATE ───────────────────────────────────────────
  // effectiveReason is the string actually passed to onConfirm.
  // canSubmit gates the Confirm button.
  const effectiveReason = reason === 'Other' ? otherText.trim() : reason
  const canSubmit = !!effectiveReason && confirmed && !saving

  // ─── KEYBOARD ESC ───────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onCancel])

  const handleConfirm = () => { if (canSubmit) onConfirm(effectiveReason) }

  // ─── SHARED INLINE STYLES ───────────────────────────────────
  const fieldInput: React.CSSProperties = {
    height: 36, padding: '0 10px', borderRadius: 6, width: '100%',
    border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
    background: dark ? '#0f172a' : '#f8fafc',
    color: dark ? '#f1f5f9' : '#0f172a',
    fontSize: 13, fontFamily: font, outline: 'none', boxSizing: 'border-box',
  }
  const fieldLabel: React.CSSProperties = {
    display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b',
    letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5,
  }

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
        width: 480,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>Confirm Deletion</span>
          </div>
          <button
            onClick={onCancel}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1, fontFamily: font }}
          >
            ×
          </button>
        </div>

        {/* ─── BODY ─────────────────────────────────────────── */}
        <div style={{ padding: '20px' }}>

          {/* Warning banner */}
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 18,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          }}>
            <p style={{ margin: 0, fontSize: 13, color: dark ? '#fca5a5' : '#b91c1c', lineHeight: 1.6 }}>
              You are about to delete <strong>{itemName}</strong>. This action cannot be undone.
            </p>
          </div>

          {/* Reason dropdown */}
          <div style={{ marginBottom: 12 }}>
            <label style={fieldLabel}>Reason for deletion *</label>
            <select
              value={reason}
              onChange={e => { setReason(e.target.value); setOtherText('') }}
              style={fieldInput}
            >
              <option value="">— Select a reason —</option>
              {reasonList.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* "Other" free-text — only shown when "Other" is selected */}
          {reason === 'Other' && (
            <div style={{ marginBottom: 12 }}>
              <label style={fieldLabel}>Please specify reason (required) *</label>
              <input
                value={otherText}
                onChange={e => setOtherText(e.target.value)}
                placeholder="Describe the reason for deletion…"
                autoFocus
                style={fieldInput}
              />
            </div>
          )}

          {/* ─── CONFIRMATION CHECKBOX ────────────────────────
              Styled as a bordered card that highlights red when
              checked, making it visually obvious when satisfied. */}
          <label style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
            padding: '10px 12px', borderRadius: 6, userSelect: 'none', marginBottom: 4,
            border: `1px solid ${confirmed ? 'rgba(239,68,68,0.35)' : (dark ? '#334155' : '#e2e8f0')}`,
            background: confirmed ? 'rgba(239,68,68,0.07)' : 'transparent',
            transition: 'border-color 150ms, background 150ms',
          }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              style={{ marginTop: 2, accentColor: '#ef4444', flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, color: dark ? '#cbd5e1' : '#334155', lineHeight: 1.5 }}>
              I confirm I want to permanently delete this {itemType}
            </span>
          </label>

          {/* Server error */}
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
          {/* ─── CONFIRM BUTTON ───────────────────────────────
              Disabled (greyed) until reason is chosen AND checkbox
              is ticked. Title attribute explains why it's disabled. */}
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            title={
              !effectiveReason ? 'Select a reason first'
              : !confirmed     ? 'Tick the checkbox to confirm'
              : undefined
            }
            style={{
              padding: '7px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              border: 'none', fontFamily: font,
              background: canSubmit ? '#ef4444' : (dark ? '#334155' : '#e2e8f0'),
              color: canSubmit ? '#fff' : '#94a3b8',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'background 150ms, color 150ms',
            }}
          >
            {saving ? 'Deleting…' : 'Confirm Delete'}
          </button>
        </div>

      </div>
    </div>,
    document.body
  )
}
