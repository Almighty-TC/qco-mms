import { useRef, useCallback, useEffect } from 'react'

// ─── useTableResize HOOK ─────────────────────────────────────
// CSS-variable-based column resize for every table in the app.
//
// WHY CSS VARIABLES INSTEAD OF REACT STATE
// ─────────────────────────────────────────
// The previous implementation stored column widths in useState and
// passed them as a gridTemplate prop to every row.  On each mousemove
// event this triggered a full React re-render: DashboardHome re-ran,
// every ProjectRow re-rendered with the new prop.  Because React
// batches and processes updates asynchronously, the rows lagged
// visually behind the header — appearing as if only the header resized.
//
// The correct approach: write directly to a CSS custom property
// on the shared container element.  The browser's layout engine
// propagates the change to every row that references var(--col-<key>)
// in its gridTemplateColumns in the same CSS reflow — zero React
// involvement, zero lag.
//
// HOW TO USE
// ──────────
//   1.  Call the hook with your column defaults and minimums.
//   2.  Attach containerRef to the wrapper div that contains BOTH the
//       header row and all data rows (they must share an ancestor).
//   3.  Write a static gridTemplateColumns string using var(--col-<key>)
//       references and apply it to every row div (header and body).
//   4.  Pass startResize to each HeaderCell's onResize prop.
//
// Example:
//   const { containerRef, startResize } = useTableResize(DEFAULTS, MINS)
//   const GRID = '4px var(--col-name) var(--col-status) 32px'
//
//   <div ref={containerRef}>
//     <div style={{ gridTemplateColumns: GRID }}>…header…</div>
//     {rows.map(r => <Row style={{ gridTemplateColumns: GRID }} />)}
//   </div>
//
// The variable names written to the container are --col-<key> where
// <key> is every key in the defaults Record you pass in.
export function useTableResize<K extends string>(
  defaults: Record<K, number>,
  mins: Record<K, number>,
): {
  containerRef: React.RefObject<HTMLDivElement>
  startResize: (col: string, startX: number) => void
} {
  const containerRef = useRef<HTMLDivElement>(null)

  // ─── STABLE REFS ──────────────────────────────────────────
  // Kept as refs so startResize (empty deps) always reads the
  // current values without needing to be recreated.
  const minsRef     = useRef(mins)
  const defaultsRef = useRef(defaults)
  minsRef.current     = mins
  defaultsRef.current = defaults

  // ─── SEED INITIAL VARIABLES ───────────────────────────────
  // Set --col-<key> on the container element once on mount.
  // React does not track CSS custom properties set via
  // style.setProperty, so subsequent React renders will NOT
  // overwrite the values the drag handler has written — the
  // user's dragged widths persist across dark-mode toggles,
  // data reloads, and any other re-renders.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    for (const [key, val] of Object.entries(defaults) as [K, number][]) {
      el.style.setProperty(`--col-${key}`, `${val}px`)
    }
    // defaults is module-level const — intentionally no deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── DRAG HANDLER ─────────────────────────────────────────
  // Reads the live CSS variable at drag-start (never a stale
  // snapshot), then writes on every mousemove.  No setState call
  // means no React re-render — the browser reflows all rows
  // referencing var(--col-<key>) in the same pass.
  const startResize = useCallback((col: string, startX: number) => {
    const el = containerRef.current
    if (!el) return

    const varName = `--col-${col}`
    const raw     = el.style.getPropertyValue(varName)
    const startW  = raw ? parseFloat(raw) : (defaultsRef.current[col as K] ?? 100)
    const minW    = minsRef.current[col as K] ?? 40

    const onMove = (e: MouseEvent) => {
      el.style.setProperty(varName, `${Math.max(minW, startW + (e.clientX - startX))}px`)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  // ─── RESET HANDLER ────────────────────────────────────────
  // Re-applies every default value to the container element.
  // Called by the global "Reset to defaults" action in the topbar.
  const resetWidths = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    for (const [key, val] of Object.entries(defaultsRef.current) as [K, number][]) {
      el.style.setProperty(`--col-${key}`, `${val}px`)
    }
  }, [])

  return { containerRef, startResize, resetWidths }
}
