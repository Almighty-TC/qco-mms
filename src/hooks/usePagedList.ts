// QCO MMS — Shared server-side pagination hook
// Drives every paginated list screen (Procurement, MTO, Commodity, Stock, …).
// Mirrors the proven Procurement pattern but adds server-side sort wiring,
// so the UI never sorts/filters page-locally (which would be wrong across pages).
import { useState, useEffect, useRef, useCallback } from 'react'

// ─── TYPES ───────────────────────────────────────────────────
// Standard envelope every paginated endpoint returns: { data, total, page, limit }.
export type SortDir = 'asc' | 'desc'
export interface PagedResponse<T> { data: T[]; total: number; page?: number; limit?: number }
export interface PagedFetchParams { page: number; limit: number; sortCol?: string; sortDir: SortDir }

interface Options<T> {
  // fetcher: caller maps the params onto its endpoint + filters and returns the envelope.
  fetcher: (p: PagedFetchParams) => Promise<PagedResponse<T>>
  // deps: filter/search values — when ANY changes, the list resets to page 1.
  deps?: unknown[]
  pageSize?: number
  initialSortCol?: string
  initialSortDir?: SortDir
}

export function usePagedList<T>({
  fetcher, deps = [], pageSize = 50, initialSortCol, initialSortDir = 'asc',
}: Options<T>) {
  const [data,    setData]    = useState<T[]>([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [sortCol, setSortCol] = useState<string | undefined>(initialSortCol)
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  // ─── FETCHER REF ─────────────────────────────────────────────
  // Hold the (possibly inline) fetcher in a ref so it never becomes an effect
  // dependency — prevents re-fetch loops when callers pass an unmemoized fn.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // ─── LOAD ────────────────────────────────────────────────────
  // All query inputs are passed explicitly so this callback stays stable.
  const load = useCallback(async (p: number, sc: string | undefined, sd: SortDir) => {
    setLoading(true); setError('')
    try {
      const res = await fetcherRef.current({ page: p, limit: pageSize, sortCol: sc, sortDir: sd })
      setData(res.data ?? [])
      setTotal(res.total ?? 0)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } }; message?: string }
      setError(er.response?.data?.error ?? er.message ?? 'Failed to load')
      setData([]); setTotal(0)
    } finally { setLoading(false) }
  }, [pageSize])

  // ─── SINGLE-FETCH DRIVER ─────────────────────────────────────
  // One effect handles every change. A signature guard guarantees exactly one
  // fetch: when filters/sort change we reset to page 1 (so a filtered result
  // never shows a stale deep page); otherwise we fetch the requested page.
  const sig = JSON.stringify([deps, sortCol, sortDir])
  const prevSig = useRef(sig)
  useEffect(() => {
    if (prevSig.current !== sig) {
      prevSig.current = sig
      if (page !== 1) { setPage(1); return } // re-runs with page=1, then falls through to load
    }
    load(page, sortCol, sortDir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sig, load])

  // ─── SORT TOGGLE ─────────────────────────────────────────────
  // Click a header: same column flips direction, a new column starts ascending.
  const toggleSort = useCallback((col: string) => {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('asc') }
  }, [sortCol])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return {
    data, total, page, setPage, pageSize, totalPages,
    loading, error,
    sortCol, sortDir, toggleSort, setSortCol, setSortDir,
    reload: () => load(page, sortCol, sortDir),
  }
}
