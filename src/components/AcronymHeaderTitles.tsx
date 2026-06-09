// ─── GLOBAL ACRONYM HEADER TOOLTIPS ─────────────────────────
// App-wide rule: every register/grid column header whose text contains a known
// acronym shows the full text on hover. Mounted once at the app root — it walks all
// table headers (and re-walks when new tables mount) and sets the `title` attribute,
// so no per-screen wiring is needed and future registers are covered automatically.
import { useEffect } from 'react'
import { ACRONYMS } from '../lib/acronyms'

// Build a hover string for a header: a lone acronym → its full text; a header that
// merely contains acronym words (e.g. "PO REF") → "PO = Purchase Order" parts.
function headerTooltip(raw: string): string | null {
  const tokens = raw.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean)
  if (!tokens.length) return null
  const hits = tokens.map(t => [t.toUpperCase(), ACRONYMS[t.toUpperCase()]] as const).filter(([, v]) => v)
  if (!hits.length) return null
  if (tokens.length === 1) return hits[0][1]
  return hits.map(([k, v]) => `${k} = ${v}`).join(' · ')
}

export function AcronymHeaderTitles() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll('table th').forEach(node => {
        const el = node as HTMLElement
        const text = (el.textContent || '').trim()
        if (!text) return
        // Preserve any intentional tooltip a screen already set (one that isn't just
        // the bare header text, e.g. Logistics' hand-written ETD/ETA titles).
        const existing = el.getAttribute('title')
        if (existing && existing !== text) return
        const tip = headerTooltip(text)
        if (tip && el.getAttribute('title') !== tip) el.setAttribute('title', tip)
      })
    }
    apply()
    let timer: ReturnType<typeof setTimeout> | undefined
    // childList only (NOT attributes) — our own setAttribute must not re-trigger us.
    // setTimeout (not requestAnimationFrame) so it still fires when the tab is backgrounded.
    const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 40) })
    obs.observe(document.body, { childList: true, subtree: true })
    return () => { obs.disconnect(); clearTimeout(timer) }
  }, [])
  return null
}
