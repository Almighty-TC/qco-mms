// ─── RESIZABLE TABLE COLUMNS — GLOBAL HELPER ─────────────────
// One mechanism so every data table gets drag-to-resize columns + a reset
// button. Widths persist per tableId (localStorage qco_col_widths_<id>) via
// useColumnResize. Built on the same primitives already used by the WBS / FMR
// tables, so the look matches across the app.
//
// Usage:
//   const rt = useResizableTable('mto_lines', DEFAULTS, MINS)
//   <table style={{ ...rt.tableStyle }}> …
//     <thead><tr>{cols.map((c,i)=>(
//       <th style={{ ...thBase, ...rt.thStyle(i) }}>{c}{rt.handle(i, dark)}</th>
//     ))}</tr></thead>
//   <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
//
// table-layout:fixed makes the <th> widths authoritative, so the body <td>s
// follow automatically — no need to touch every cell.
import React, { useState } from 'react'
import { useColumnResize } from '../hooks/useColumnResize'

// ─── DRAG HANDLE ─────────────────────────────────────────────
// 1px divider at rest; widens to an orange grab target on hover.
export const ColResizeHandle = ({ onMouseDown, dark }: { onMouseDown: (e: React.MouseEvent) => void; dark: boolean }) => {
  const [hov, setHov] = useState(false)
  return (
    <>
      <div style={{ position: 'absolute', right: 0, top: 0, width: hov ? 3 : 1, height: '100%', background: hov ? '#E84E0F' : (dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'), pointerEvents: 'none', transition: 'width 100ms, background 100ms', borderRadius: 1 }} />
      <div onMouseDown={onMouseDown} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', right: -4, top: 0, width: 8, height: '100%', cursor: 'col-resize', zIndex: 3 }} />
    </>
  )
}

// ─── RESET BUTTON ────────────────────────────────────────────
export const ResetColumnsButton = ({ onClick, dark, style }: { onClick: () => void; dark: boolean; style?: React.CSSProperties }) => (
  <button onClick={onClick} title="Reset column widths to default"
    style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', whiteSpace: 'nowrap', ...style }}>
    ↺ Reset columns
  </button>
)

// ─── HOOK ────────────────────────────────────────────────────
export function useResizableTable(tableId: string, defaults: number[], mins?: number[]) {
  const { widths, onMouseDown, resetWidths } = useColumnResize(tableId, defaults, mins)
  const totalWidth = widths.reduce((a, b) => a + b, 0)
  // Spread onto each <th>. table-layout:fixed makes these widths authoritative.
  const thStyle = (i: number): React.CSSProperties => ({ width: widths[i], position: 'relative', overflow: 'hidden' })
  // Drag handle for column i (omit the last column — nothing to its right).
  const handle = (i: number, dark: boolean) => i < widths.length - 1
    ? <ColResizeHandle onMouseDown={e => onMouseDown(i, e)} dark={dark} />
    : null
  const tableStyle: React.CSSProperties = { tableLayout: 'fixed', width: totalWidth, minWidth: '100%' }
  return { widths, resetWidths, totalWidth, thStyle, handle, tableStyle, onMouseDown }
}
