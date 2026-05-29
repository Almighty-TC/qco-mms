// QCO MMS - Global Admin Table Component with Column Resize
// Used by all Admin module tabs. Edit here to affect all tabs globally.
import React, { createContext, useContext, useState } from 'react'
import { useColumnResize } from '../hooks/useColumnResize'

// ─── COLUMN DEFINITION ──────────────────────────────────────────
export type AdminCol = {
  label: string
  width: number       // default px width (ignored when flex: true)
  minWidth?: number   // minimum px width during drag
  noResize?: boolean  // suppress drag handle
  flex?: boolean      // fills remaining table width; no explicit width in colgroup
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
// Single-table design with a sticky <thead>. The main content scroll
// container (App.tsx, position:fixed, overflow:auto) handles all
// scrolling. overflow:clip on the outer div preserves border-radius
// without creating a new scroll container that would break sticky.
type AdminTableProps = {
  tableId: string
  columns: AdminCol[]
  dark: boolean
  children: React.ReactNode
  empty?: string
  top?: number   // sticky top offset for thead (admin header height)
}

export function AdminTable({ tableId, columns, dark, children, empty, top }: AdminTableProps) {
  const defaultWidths = columns.map(c => c.width)
  const minWidths     = columns.map(c => c.minWidth ?? 40)
  const { widths, onMouseDown, resetWidths } = useColumnResize(tableId, defaultWidths, minWidths)

  const headerBg  = dark ? '#0f172a' : '#f4f7fb'
  const borderCol = dark ? '#334155' : '#dde3ed'
  const isEmpty   = React.Children.count(children) === 0

  // ─── COLGROUP ─────────────────────────────────────────────────
  // Flex columns start with no explicit width so the browser fills
  // remaining space. Once dragged (widths diverge from defaultWidths)
  // an explicit width is applied so the user-set size persists.
  const colgroup = (
    <colgroup>
      {columns.map((col, i) => (
        col.flex && widths[i] === defaultWidths[i]
          ? <col key={i} />
          : <col key={i} style={{ width: widths[i] }} />
      ))}
    </colgroup>
  )

  // ─── MINIMUM TABLE WIDTH ──────────────────────────────────────
  // Sum of all fixed column widths. Ensures the table is at least
  // this wide even when the flex column has no remaining space.
  const minTableWidth = columns.reduce((acc, col, i) => acc + (col.flex ? 0 : widths[i]), 0)

  return (
    <div style={{
      background: dark ? '#1e293b' : '#ffffff',
      border: `1px solid ${borderCol}`,
      borderRadius: 10,
      // overflow:clip preserves border-radius clipping WITHOUT creating
      // a scroll container, so position:sticky in thead still works
      // relative to the main content scroll container (App.tsx).
      overflow: 'clip',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <table style={{
        width: '100%',
        minWidth: minTableWidth,
        borderCollapse: 'separate',
        borderSpacing: 0,
        tableLayout: 'fixed',
      }}>
        {colgroup}

        {/* ─── STICKY HEADER ──────────────────────────────── */}
        {/* top prop = admin-header-wrap height, passed from each tab */}
        <thead style={{
          position: 'sticky',
          top: top ?? 0,
          zIndex: 10,
          background: headerBg,
        }}>
          <tr>
            {columns.map((col, i) => {
              const isLast         = i === columns.length - 1
              const isLastResizable = i === columns.length - 2  // last column before Actions
              const canDrag        = !col.noResize
              return (
                <th key={i} title={col.label} style={{
                  height: 36,
                  padding: '0 12px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#94a3b8',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  textAlign: 'left',
                  position: 'relative',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  boxSizing: 'border-box',
                  borderBottom: `1px solid ${borderCol}`,
                  // Last data column before Actions: z-index:2 ensures its
                  // DragHandle stays visible above the sticky Actions header
                  // when the table is scrolled horizontally.
                  ...(isLastResizable && canDrag ? { zIndex: 2 } : {}),
                  ...(isLast ? { position: 'sticky' as const, right: 0, background: headerBg, zIndex: 1 } : {}),
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
