// ─── PAGER ───────────────────────────────────────────────────
// Shared pagination control for every list screen. Renders:
//   [Rows: 25/50/100/200/All ▾]      ← Prev   Page X of Y · a–b of total   Next →
// The row-size selector shows whenever onPageSizeChange is supplied (so the user
// can pick how many rows every table shows); the prev/next + page summary only
// appear when there is more than one page.
import React from 'react'

// "All" is a large finite limit — effectively no paging, while keeping the
// envelope math (total/pageSize) well-defined and the backend getting a number.
export const ALL_ROWS = 100000
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, ALL_ROWS] as const

interface PagerProps {
  page: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  dark: boolean
}

export const Pager = ({ page, total, pageSize, onPageChange, onPageSizeChange, dark }: PagerProps) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  // Nothing to show (single page AND no row-size selector) → render nothing.
  if (totalPages <= 1 && !onPageSizeChange) return null

  const col  = dark ? '#f1f5f9' : '#0f172a'
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to   = pageSize >= ALL_ROWS ? total : Math.min(page * pageSize, total)

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 6,
    border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
    background: 'transparent',
    color: disabled ? '#64748b' : col,
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 12, fontFamily: 'inherit',
  })

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
      {/* Row-size selector (left) */}
      {onPageSizeChange ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
          Rows:
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            style={{ height: 28, padding: '0 8px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#fff', color: col, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            {PAGE_SIZE_OPTIONS.map(n => (
              <option key={n} value={n}>{n >= ALL_ROWS ? 'All' : n}</option>
            ))}
          </select>
        </label>
      ) : <span />}

      {/* Prev / page summary / Next (right) — only when multiple pages */}
      {totalPages > 1 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} style={btnStyle(page === 1)}>← Prev</button>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            Page {page} of {totalPages} &nbsp;·&nbsp; {from}–{to} of {total}
          </span>
          <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} style={btnStyle(page === totalPages)}>Next →</button>
        </div>
      ) : (
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{total} row{total !== 1 ? 's' : ''}</span>
      )}
    </div>
  )
}
