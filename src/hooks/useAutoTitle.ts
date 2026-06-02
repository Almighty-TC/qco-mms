// ─── useAutoTitle — global truncation tooltip ─────────────────
// Point a table/container ref at this hook and pass the deps that change rows
// (data / filter / sort). Any pure-text cell whose content is clipped
// (scrollWidth > clientWidth) gets a native `title=` so hovering shows the full
// text. Uses the native title attribute (matches the existing pattern across the
// app — zero deps).
//
// Re-runs on: (a) the deps you pass (data/filter/sort changes), AND
//             (b) layout changes, via a ResizeObserver on the container.
// It only touches its OWN titles (tagged via data-autotitle) so it never
// clobbers an author-set title, and it clears the title if a cell stops being
// truncated. Cells containing elements (pills/buttons/inputs) are skipped.
//
// Adopt on any table in one line:
//   const ref = useRef<HTMLDivElement>(null)
//   useAutoTitle(ref, [data, filter, sort])
//   …<div ref={ref}> …tables… </div>
import { useEffect } from 'react'
import type React from 'react'

export function useAutoTitle<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  deps: React.DependencyList = [],
) {
  useEffect(() => {
    const root = ref.current
    if (!root) return

    const apply = () => {
      const cells = root.querySelectorAll<HTMLElement>('td, th')
      cells.forEach(el => {
        // Only plain-text cells — skip cells holding pills/buttons/inputs/icons.
        if (el.children.length > 0) return
        const truncated = el.scrollWidth > el.clientWidth + 1
        if (truncated) {
          const txt = (el.textContent || '').trim()
          // Set/refresh only our own auto-title; never overwrite an author title.
          if (txt && (!el.title || el.dataset.autotitle === '1')) {
            el.title = txt
            el.dataset.autotitle = '1'
          }
        } else if (el.dataset.autotitle === '1') {
          el.removeAttribute('title')
          delete el.dataset.autotitle
        }
      })
    }

    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(root)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
