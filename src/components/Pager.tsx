// ─── PAGER ───────────────────────────────────────────────────
// Shared prev/next pagination control for every server-paginated list.
// Extracted from Procurement's inline pager so all screens read identically:
//   "Page X of Y · a–b of total".  Renders nothing when there is one page.
interface PagerProps {
  page: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  dark: boolean
}

export const Pager = ({ page, total, pageSize, onPageChange, dark }: PagerProps) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null

  const col  = dark ? '#f1f5f9' : '#0f172a'
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to   = Math.min(page * pageSize, total)

  // ─── BUTTON STYLE ────────────────────────────────────────────
  // Disabled edges dim to slate; matches the prior inline styling exactly.
  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6,
    border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
    background: 'transparent',
    color: disabled ? '#64748b' : col,
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 12, fontFamily: 'inherit',
  })

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
      <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} style={btnStyle(page === 1)}>
        ← Prev
      </button>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>
        Page {page} of {totalPages} &nbsp;·&nbsp; {from}–{to} of {total}
      </span>
      <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} style={btnStyle(page === totalPages)}>
        Next →
      </button>
    </div>
  )
}
