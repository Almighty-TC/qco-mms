// QCO MMS - Global Admin Table Component with Column Resize
// Used by all Admin module tabs. Edit here to affect all tabs globally.
import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react'
import { useColumnResize } from '../hooks/useColumnResize'

// ─── COLUMN DEFINITION ──────────────────────────────────────────
export type AdminCol = {
  label: string
  width: number       // default px width
  minWidth?: number   // minimum px width during drag
  noResize?: boolean  // suppress drag handle (use on actions column)
}

// ─── CONTEXT: ROW ───────────────────────────────────────────────
// Provides hover state and dark-mode from AdminRow to AdminCell/AdminActions.
type RowCtx = { hov: boolean; dark: boolean }
const RowCtx = createContext<RowCtx>({ hov: false, dark: false })

// ─── DRAG HANDLE ────────────────────────────────────────────────
// Two-layer design: 1px subtle grey divider always present; 4px orange
// handle fades in only on hover so orange is never a resting state.
function DragHandle({
  onMouseDown,
  dark,
}: {
  onMouseDown: (e: React.MouseEvent) => void
  dark: boolean
}) {
  const [hov, setHov] = useState(false)
  const dividerColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  return (
    <>
      {/* ── 1px grey column divider — always visible ──────── */}
      <div style={{
        position: 'absolute', right: 0, top: 0,
        width: 1, height: '100%',
        background: dividerColor,
        pointerEvents: 'none',
      }} />
      {/* ── 4px orange drag handle — appears on hover only ── */}
      <div
        onMouseDown={onMouseDown}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          position: 'absolute', right: -1, top: 0,
          width: 4, height: '100%',
          cursor: 'col-resize',
          background: '#E84E0F',
          opacity: hov ? 1 : 0,
          transition: 'opacity 150ms',
          zIndex: 1,
        }}
      />
    </>
  )
}

// ─── ADMIN TABLE ────────────────────────────────────────────────
// Split-table design: a fixed non-scrolling header table sits above a
// separately scrollable body div. The header never moves; the body fills
// all remaining viewport height. Both tables use colgroup with identical
// pixel widths from useColumnResize (persisted to localStorage).
type AdminTableProps = {
  tableId: string
  columns: AdminCol[]
  dark: boolean
  children: React.ReactNode
  empty?: string
  top?: number   // admin header height — triggers body-height re-measure when it changes
}

export function AdminTable({ tableId, columns, dark, children, empty, top }: AdminTableProps) {
  const defaultWidths = columns.map(c => c.width)
  const minWidths     = columns.map(c => c.minWidth ?? 60)
  const { widths, onMouseDown } = useColumnResize(tableId, defaultWidths, minWidths)

  // ─── BODY MAX HEIGHT ─────────────────────────────────────────
  // Measures the header table's bottom viewport edge so the body div
  // fills exactly the remaining space. Re-fires on resize and whenever
  // the admin header height (top prop) changes (tab switches, etc.).
  const headerRef = useRef<HTMLTableElement>(null)
  const [bodyMaxH, setBodyMaxH] = useState(400)

  const updateBodyHeight = useCallback(() => {
    const el = headerRef.current
    if (!el) return
    const bottom = el.getBoundingClientRect().bottom
    setBodyMaxH(Math.max(200, window.innerHeight - bottom - 20))
  }, [])

  useEffect(() => {
    updateBodyHeight()
    const obs = new ResizeObserver(updateBodyHeight)
    if (headerRef.current) obs.observe(headerRef.current)
    window.addEventListener('resize', updateBodyHeight)
    return () => { obs.disconnect(); window.removeEventListener('resize', updateBodyHeight) }
  }, [updateBodyHeight])

  useEffect(() => { updateBodyHeight() }, [top, updateBodyHeight])

  const headerBg  = dark ? '#0f172a' : '#f4f7fb'
  const borderCol = dark ? '#334155' : '#dde3ed'
  const isEmpty   = React.Children.count(children) === 0
  const totalWidth = widths.reduce((a, b) => a + b, 0)

  const colgroup = (
    <colgroup>
      {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
    </colgroup>
  )

  return (
    <div style={{
      background: dark ? '#1e293b' : '#ffffff',
      border: `1px solid ${borderCol}`,
      borderRadius: 10,
      overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* ─── HORIZONTAL SCROLL WRAPPER ──────────────────────── */}
      <div style={{ overflowX: 'auto' }}>

        {/* ─── HEADER TABLE (never scrolls) ─────────────────── */}
        <table ref={headerRef} style={{
          width: totalWidth,
          borderCollapse: 'separate',
          borderSpacing: 0,
          tableLayout: 'fixed',
          background: headerBg,
          borderBottom: `1px solid ${borderCol}`,
        }}>
          {colgroup}
          <thead>
            <tr>
              {columns.map((col, i) => {
                const isLast  = i === columns.length - 1
                const canDrag = !col.noResize && !isLast
                return (
                  <th key={i} style={{
                    height: 36,
                    padding: '0 12px',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#94a3b8',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    fontFamily: 'IBM Plex Sans, sans-serif',
                    textAlign: 'left',
                    position: isLast ? 'sticky' : 'relative',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    boxSizing: 'border-box',
                    ...(isLast ? { right: 0, background: headerBg, zIndex: 1 } : {}),
                  } as React.CSSProperties}>
                    {col.label}
                    {canDrag && <DragHandle dark={dark} onMouseDown={e => onMouseDown(i, e)} />}
                  </th>
                )
              })}
            </tr>
          </thead>
        </table>

        {/* ─── BODY SCROLL DIV ──────────────────────────────── */}
        <div style={{ overflowY: 'auto', maxHeight: bodyMaxH }}>
          {isEmpty && empty
            ? <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>{empty}</div>
            : (
              <table style={{
                width: totalWidth,
                borderCollapse: 'separate',
                borderSpacing: 0,
                tableLayout: 'fixed',
              }}>
                {colgroup}
                <tbody>
                  {children}
                </tbody>
              </table>
            )
          }
        </div>

      </div>
    </div>
  )
}

// ─── ADMIN ROW ──────────────────────────────────────────────────
// Table row with hover tracking. Shares state via RowCtx so AdminActions
// can match the row background without prop-drilling.
export function AdminRow({ dark, children }: { dark: boolean; children: React.ReactNode }) {
  const [hov, setHov] = useState(false)
  return (
    <RowCtx.Provider value={{ hov, dark }}>
      <tr
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          background: hov ? (dark ? '#1e2d4a' : '#f8fafc') : 'transparent',
          transition: 'background 100ms',
        }}
      >
        {children}
      </tr>
    </RowCtx.Provider>
  )
}

// ─── ADMIN CELL ─────────────────────────────────────────────────
// Standard table data cell. Reads dark mode from RowCtx.
export function AdminCell({ children, mono, muted, center }: {
  children: React.ReactNode
  mono?: boolean
  muted?: boolean
  center?: boolean
}) {
  const { dark } = useContext(RowCtx)
  return (
    <td style={{
      padding: '0 12px',
      height: 44,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontSize: 13,
      fontFamily: mono ? 'JetBrains Mono, monospace' : 'IBM Plex Sans, sans-serif',
      color: muted ? '#94a3b8' : (dark ? '#f1f5f9' : '#0f172a'),
      textAlign: center ? 'center' : 'left',
      verticalAlign: 'middle',
      borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
      boxSizing: 'border-box',
    }}>
      {children}
    </td>
  )
}

// ─── ADMIN ACTIONS ──────────────────────────────────────────────
// Sticky-right action cell for Edit / Deactivate / Delete buttons.
// Background from RowCtx matches the row on hover — prevents the
// transparent "hole" that appears when sticky cells overlap.
export function AdminActions({ children }: { children: React.ReactNode }) {
  const { hov, dark } = useContext(RowCtx)
  const bg = hov ? (dark ? '#1e2d4a' : '#f8fafc') : (dark ? '#1e293b' : '#ffffff')
  return (
    <td style={{
      position: 'sticky',
      right: 0,
      zIndex: 2,
      background: bg,
      transition: 'background 100ms',
      padding: '0 8px',
      height: 44,
      verticalAlign: 'middle',
      borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {children}
      </div>
    </td>
  )
}
