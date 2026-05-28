// QCO MMS - Global Admin Column Resize Hook
// Used by all Admin module tabs. Edit here to affect all tabs globally.
import { useState, useEffect, useRef, useCallback } from 'react'

// ─── USE COLUMN RESIZE ───────────────────────────────────────────
// Manages resizable column widths for admin tables.
//   - Drag-to-resize via mousedown / mousemove / mouseup on document
//   - Minimum column width enforced per column
//   - Widths persisted to localStorage with key: qco_col_widths_[tableId]
//   - Falls back to defaultWidths if saved data is invalid or missing
export function useColumnResize(
  tableId: string,
  defaultWidths: number[],
  minWidths?: number[],
) {
  const storageKey = `qco_col_widths_${tableId}`

  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (
          Array.isArray(parsed) &&
          parsed.length === defaultWidths.length &&
          (parsed as unknown[]).every(v => typeof v === 'number' && v > 0)
        ) return parsed as number[]
      }
    } catch { /* localStorage unavailable */ }
    return [...defaultWidths]
  })

  const widthsRef = useRef(widths)
  widthsRef.current = widths

  // ─── PERSIST ON CHANGE ──────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(widths)) }
    catch { /* localStorage unavailable */ }
  }, [widths, storageKey])

  // ─── DRAG HANDLER ───────────────────────────────────────────────
  // Attaches mousemove/mouseup to document so dragging outside the
  // header element still works. Sets cursor globally during drag.
  const onMouseDown = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthsRef.current[colIndex]
    const minW   = minWidths?.[colIndex] ?? 60

    document.body.style.userSelect = 'none'
    document.body.style.cursor     = 'col-resize'

    const onMove = (ev: MouseEvent) => {
      const next = Math.max(minW, startW + ev.clientX - startX)
      setWidths(prev => {
        const arr = [...prev]
        arr[colIndex] = next
        return arr
      })
    }
    const onUp = () => {
      document.body.style.userSelect = ''
      document.body.style.cursor     = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [minWidths])

  // ─── RESET ──────────────────────────────────────────────────────
  const resetWidths = useCallback(() => {
    setWidths([...defaultWidths])
    try { localStorage.removeItem(storageKey) }
    catch { /* localStorage unavailable */ }
  }, [defaultWidths, storageKey])

  return { widths, onMouseDown, resetWidths }
}
