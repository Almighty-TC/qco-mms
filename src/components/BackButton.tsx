// ─── BACK BUTTON ─────────────────────────────────────────────
// Shown left of breadcrumb on every project screen.
// Uses window.history.back() — falls back to onFallback() if empty.
export const BackButton = ({ onFallback, dark }: { onFallback: () => void; dark: boolean }) => {
  const handleClick = () => {
    if (window.history.length > 1) window.history.back()
    else onFallback()
  }
  return (
    <button
      onClick={handleClick}
      title="Go back to previous screen"
      style={{
        background: 'transparent',
        border: `0.5px solid ${dark ? '#334155' : '#e2e8f0'}`,
        color: '#64748b',
        fontSize: 13,
        padding: '5px 12px',
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'IBM Plex Sans, sans-serif',
        marginRight: 12,
        flexShrink: 0,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = dark ? '#1e293b' : '#f1f5f9' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
      ← Back
    </button>
  )
}
