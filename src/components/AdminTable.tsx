// QCO MMS - Global Admin Table Component with Column Resize
// Used by all Admin module tabs. Edit here to affect all tabs globally.
import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useColumnResize } from '../hooks/useColumnResize'

// ─── COLUMN DEFINITION ──────────────────────────────────────────
export type AdminCol = {
  label: string
  width: number       // default px width (ignored when flex: true)
  minWidth?: number   // minimum px width during drag
  noResize?: boolean  // suppress drag handle
  flex?: boolean      // fills remaining table width; no explicit width on th until dragged
}

// ─── CONTEXT: ROW ───────────────────────────────────────────────
// Provides hover state and dark-mode from AdminRow to AdminCell/AdminActions.
type RowCtx = { hov: boolean; dark: boolean }
const RowCtx = createContext<RowCtx>({ hov: false, dark: false })

// ─── DRAG HANDLE ────────────────────────────────────────────────
// Two-layer design: 1px subtle grey divider always present; 8px orange
// drag target appears on hover so orange is never a resting state.
// The hit target is 8px wide (widened from 6px for easier grabbing).
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
      {/* ── 8px drag target — transparent at rest, orange on hover ── */}
      <div
        onMouseDown={onMouseDown}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          position: 'absolute', right: 0, top: 0,
          width: 8, height: '100%',
          cursor: 'col-resize',
          background: hov ? '#E84E0F' : 'transparent',
          opacity: hov ? 0.6 : 1,
          transition: 'background 150ms, opacity 150ms',
          zIndex: 3,
        }}
      />
    </>
  )
}

// ─── ADMIN TABLE ────────────────────────────────────────────────
// Single-table design. <thead> is the first child of <table> — no
// <colgroup> precedes it. Column widths are set directly on <th>
// elements; tableLayout:fixed makes th-widths authoritative.
// overflowX:auto on wrapper for horizontal scroll; overflowY:clip
// avoids creating a Y scroll container so position:sticky on thead
// works relative to App.tsx (the real vertical scroll container).
// No column is sticky to the right — all columns scroll freely.
type AdminTableProps = {
  tableId: string
  columns: AdminCol[]
  dark: boolean
  children: React.ReactNode
  empty?: string
  headerAlign?: 'left' | 'center'  // opt-in centred headers (default left)
}

export function AdminTable({ tableId, columns, dark, children, empty, headerAlign = 'left' }: AdminTableProps) {
  const defaultWidths = columns.map(c => c.width)
  const minWidths     = columns.map(c => c.minWidth ?? 40)
  const { widths, onMouseDown, resetWidths } = useColumnResize(tableId, defaultWidths, minWidths)

  const headerBg  = dark ? '#0f172a' : '#f4f7fb'
  const borderCol = dark ? '#334155' : '#dde3ed'
  const isEmpty   = React.Children.count(children) === 0

  // ─── HORIZONTAL SCROLL INDICATOR ─────────────────────────────
  // Tracks whether there is hidden content to the left or right of
  // the current scroll position. Used to show a fade gradient on the
  // corresponding edge so users know they can scroll horizontally.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scrollLeft,  setScrollLeft]  = useState(false)
  const [scrollRight, setScrollRight] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      setScrollLeft(el.scrollLeft > 0)
      setScrollRight(el.scrollLeft < max - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  }, [])

  // ─── MINIMUM TABLE WIDTH ──────────────────────────────────────
  // Sum of all fixed column widths. Ensures the table is at least
  // this wide even when the flex column has no remaining space.
  const minTableWidth = columns.reduce((acc, col, i) => acc + (col.flex ? 0 : widths[i]), 0)

  // ─── GRADIENT COLOURS ────────────────────────────────────────
  // Match the table wrapper background so the fade blends cleanly.
  const fadeL = dark ? 'rgba(30,41,59,0.92)' : 'rgba(255,255,255,0.92)'
  const fadeR = dark ? 'rgba(30,41,59,0.92)' : 'rgba(255,255,255,0.92)'

  return (
    <div ref={wrapRef} style={{
      position: 'relative',
      background: dark ? '#1e293b' : '#ffffff',
      border: `1px solid ${borderCol}`,
      borderRadius: 10,
      // overflowX:clip  — clips horizontal overflow without creating a scroll container.
      // overflowY:visible — allows thead sticky to propagate to the main scroll ancestor.
      overflowX: 'clip',
      overflowY: 'visible',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* ── Left scroll fade — shows when content is hidden to the left ── */}
      {scrollLeft && (
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 36,
          background: `linear-gradient(to right, ${fadeL}, transparent)`,
          pointerEvents: 'none', zIndex: 4, borderRadius: '10px 0 0 10px',
        }} />
      )}
      {/* ── Right scroll fade — shows when content is hidden to the right ── */}
      {scrollRight && (
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 36,
          background: `linear-gradient(to left, ${fadeR}, transparent)`,
          pointerEvents: 'none', zIndex: 4, borderRadius: '0 10px 10px 0',
        }} />
      )}
      <table style={{
        width: '100%',
        minWidth: minTableWidth,
        borderCollapse: 'separate',
        borderSpacing: 0,
        tableLayout: 'fixed',
      }}>
        {/* ─── STICKY HEADER ──────────────────────────────── */}
        {/* position:sticky and top are set by .admin-page thead in admin.css.
            background must stay inline — varies by dark mode. */}
        <thead style={{
          position: 'sticky',
          zIndex: 10,
          background: headerBg,
        }}>
          <tr>
            {columns.map((col, i) => {
              const isLast  = i === columns.length - 1
              const canDrag = !col.noResize
              // Flex columns have no explicit width until the user drags them,
              // so the browser fills remaining space. Once dragged, apply the
              // stored width. Fixed columns always have an explicit width.
              const thWidth = col.flex && widths[i] === defaultWidths[i]
                ? undefined
                : widths[i]
              return (
                <th key={i} title={col.label} style={{
                  width: thWidth,
                  height: 36,
                  padding: '0 12px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#94a3b8',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  textAlign: headerAlign,
                  position: 'relative',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  boxSizing: 'border-box',
                  borderBottom: `1px solid ${borderCol}`,
                }}>
                  {col.label}
                  {canDrag && <DragHandle dark={dark} onMouseDown={e => onMouseDown(i, e)} />}
                  {/* ↺ reset button in the last header cell */}
                  {isLast && (
                    <button
                      onClick={resetWidths}
                      title="Reset column widths"
                      style={{
                        position: 'absolute', right: 8, top: '50%',
                        transform: 'translateY(-50%)',
                        width: 22, height: 22, borderRadius: 4,
                        border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
                        background: 'transparent',
                        color: '#94a3b8',
                        cursor: 'pointer', fontSize: 13, lineHeight: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'IBM Plex Sans, sans-serif',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#E84E0F'; e.currentTarget.style.borderColor = 'rgba(232,78,15,0.4)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = dark ? '#334155' : '#dde3ed' }}
                    >
                      ↺
                    </button>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>

        {/* ─── BODY ───────────────────────────────────────── */}
        <tbody>
          {isEmpty && empty
            ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: '#94a3b8' }}
                >
                  {empty}
                </td>
              </tr>
            )
            : children
          }
        </tbody>
      </table>
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
export function AdminCell({ children, mono, muted, center, title }: {
  children: React.ReactNode
  mono?: boolean
  muted?: boolean
  center?: boolean
  title?: string
}) {
  const { dark } = useContext(RowCtx)
  return (
    <td title={title} style={{
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
// Action cell for Edit / Deactivate / Delete buttons. Flows naturally
// at the end of the row — not sticky. Table scrolls horizontally to reach it.
export function AdminActions({ children }: { children: React.ReactNode }) {
  const { dark } = useContext(RowCtx)
  return (
    <td style={{
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
