// ─── REPORTS (ANALYTICS) ──────────────────────────────────────
// Curated report library + ad-hoc builder + saved views over the whole project.
// Read-only: every report runs the backend's whitelisted, injection-safe engine
// (/api/reports). The catalogue the server returns is already filtered to data the
// caller may see, so this screen never offers a report that would 403. Exports:
// CSV/XLSX stream from the server; PDF is a print view (branded, browser → Save PDF).
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'
import { HelpButton } from '../components/HelpDrawer'
import { REPORTS_HELP } from '../helpContent'
import { API_BASE } from '../lib/api'

const API = `${API_BASE}/api/reports`

// ─── TYPES (mirror the backend dataset/engine shapes) ─────────
type ColType = 'string' | 'number' | 'date' | 'enum' | 'bool'
interface ColMeta { key: string; label: string; type: ColType; options: string[] | null; filterable: boolean }
interface Dataset { id: string; label: string; category: string; module: string; columns: ColMeta[]; defaultColumns: string[]; defaultSort: { col: string; dir: string } | null }
interface CatalogReport { id: string; category: string; name: string; desc: string; datasetId: string | null; composite: boolean }
interface Category { id: string; label: string }
interface Catalog { categories: Category[]; datasets: Dataset[]; reports: CatalogReport[] }
interface Filter { col: string; op: string; value: any }
interface RunResult { columns: { key: string; label: string; type: string }[]; rows: any[]; total: number; grouped?: boolean; report?: { id: string; name: string } }
interface SavedView { id: number; name: string; datasetId: string; config: any }

// ─── OPERATORS BY COLUMN TYPE ─────────────────────────────────
const OPS_BY_TYPE: Record<ColType, { op: string; label: string; nullary?: boolean }[]> = {
  string: [{ op: 'contains', label: 'contains' }, { op: 'eq', label: 'equals' }, { op: 'ne', label: 'not equal' }, { op: 'isnull', label: 'is empty', nullary: true }, { op: 'notnull', label: 'is set', nullary: true }],
  number: [{ op: 'eq', label: '=' }, { op: 'ne', label: '≠' }, { op: 'gt', label: '>' }, { op: 'gte', label: '≥' }, { op: 'lt', label: '<' }, { op: 'lte', label: '≤' }],
  date:   [{ op: 'gte', label: 'on/after' }, { op: 'lte', label: 'on/before' }, { op: 'between', label: 'between' }, { op: 'isnull', label: 'is empty', nullary: true }, { op: 'notnull', label: 'is set', nullary: true }],
  enum:   [{ op: 'eq', label: 'is' }, { op: 'ne', label: 'is not' }],
  bool:   [{ op: 'eq', label: 'is' }],
}

const fmtCell = (v: any, type: string) => {
  if (v == null || v === '') return '—'
  if (type === 'date') { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) { const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${m[3]} ${mo[+m[2]-1]} ${m[1]}` } }
  if (type === 'number') { const n = Number(v); if (Number.isFinite(n)) return n.toLocaleString(undefined, { maximumFractionDigits: 2 }) }
  if (type === 'bool') return v === 1 || v === true || v === '1' ? 'Yes' : 'No'
  return String(v)
}

// ─── RESULTS TABLE (remounted per report via key → dynamic cols) ──
// Its own component so useResizableTable re-inits with the right column count when
// the report changes (parent passes a changing `key`). Satisfies the global
// resizable-columns + reset standing rule for this screen's table.
const ResultsTable = ({ result, dark, tableId }: { result: RunResult; dark: boolean; tableId: string }) => {
  const defaults = useMemo(() => result.columns.map((c, i) => i === 0 ? 200 : (c.type === 'number' ? 120 : 150)), [result])
  const mins = useMemo(() => result.columns.map(() => 70), [result])
  const rt = useResizableTable(tableId, defaults, mins)
  const theadBg = dark ? '#162032' : '#f8fafc'
  const rowBd = `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`
  const col = dark ? '#f1f5f9' : '#0f172a'
  const thBase: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: '#94a3b8', position: 'sticky', top: 0, background: theadBg, whiteSpace: 'nowrap' }
  return (
    <>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
      <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
    </div>
    <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 340px)', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8 }}>
      <table style={{ ...rt.tableStyle, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>{result.columns.map((c, i) => (
            <th key={c.key} style={{ ...thBase, ...rt.thStyle(i), textAlign: c.type === 'number' ? 'right' : 'left' }}>
              {c.label}{rt.handle(i, dark)}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {result.rows.map((r, ri) => (
            <tr key={ri} style={{ borderBottom: rowBd }}>
              {result.columns.map(c => (
                <td key={c.key} style={{ padding: '8px 12px', color: col, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: c.type === 'number' ? 'right' : 'left', fontFamily: ['number','date'].includes(c.type) ? 'JetBrains Mono, monospace' : 'inherit', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCell(r[c.key], c.type)}
                </td>
              ))}
            </tr>
          ))}
          {result.rows.length === 0 && (
            <tr><td colSpan={result.columns.length} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No rows match this report.</td></tr>
          )}
        </tbody>
      </table>
    </div>
    </>
  )
}

// ─── PDF PRINT VIEW ───────────────────────────────────────────
// Open a branded, print-optimised window of the current result → browser print
// dialog (Save as PDF). Avoids a heavy server-side PDF renderer.
function printReport(title: string, subtitle: string, result: RunResult) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  const esc = (s: any) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
  const head = result.columns.map(c => `<th style="text-align:${c.type==='number'?'right':'left'}">${esc(c.label)}</th>`).join('')
  const body = result.rows.map(r => '<tr>' + result.columns.map(c => `<td style="text-align:${c.type==='number'?'right':'left'}">${esc(fmtCell(r[c.key], c.type))}</td>`).join('') + '</tr>').join('')
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:28px}
    h1{font-size:18px;margin:0 0 2px;color:#E84E0F} .sub{color:#64748b;font-size:12px;margin:0 0 16px}
    table{border-collapse:collapse;width:100%;font-size:11px} th{background:#E84E0F;color:#fff;padding:6px 8px;text-align:left}
    td{padding:5px 8px;border-bottom:1px solid #e2e8f0} tr:nth-child(even) td{background:#f8fafc}
    .meta{color:#94a3b8;font-size:10px;margin-top:14px}
    @media print{.noprint{display:none}}
  </style></head><body>
    <h1>QCO MMS — ${esc(title)}</h1><p class="sub">${esc(subtitle)}</p>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <p class="meta">${result.rows.length} row(s) · generated ${new Date().toLocaleString()}</p>
    <button class="noprint" onclick="window.print()" style="margin-top:16px;padding:8px 16px;background:#E84E0F;color:#fff;border:none;border-radius:6px;cursor:pointer">Print / Save as PDF</button>
  </body></html>`)
  w.document.close()
  setTimeout(() => w.print(), 400)
}

// ─── INNER ────────────────────────────────────────────────────
const ReportsInner = ({ dark, projectId, projectName, onBack }: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => {
  const { addToast } = useToast()
  const col = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bg = dark ? '#0f172a' : '#f4f7fb'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub = '#94a3b8'
  const inputStyle: React.CSSProperties = { padding: '6px 9px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#fff', color: col, fontSize: 12, fontFamily: 'inherit' }

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [loadingCat, setLoadingCat] = useState(true)

  // active runner state
  const [mode, setMode] = useState<'none' | 'curated' | 'adhoc'>('none')
  const [activeReport, setActiveReport] = useState<CatalogReport | null>(null)
  const [activeDataset, setActiveDataset] = useState<Dataset | null>(null)
  const [adhocColumns, setAdhocColumns] = useState<string[]>([])
  const [filters, setFilters] = useState<Filter[]>([])
  const [groupCol, setGroupCol] = useState<string>('')      // '' = no grouping
  const [sumCol, setSumCol] = useState<string>('')
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [runKey, setRunKey] = useState(0)                    // bumps to remount ResultsTable

  // ── load catalogue + saved views ──
  useEffect(() => {
    let live = true
    setLoadingCat(true)
    Promise.all([
      axios.get<Catalog>(`${API}/${projectId}/catalog`),
      axios.get<SavedView[]>(`${API}/${projectId}/views`).catch(() => ({ data: [] as SavedView[] })),
    ]).then(([c, v]) => { if (!live) return; setCatalog(c.data); setSavedViews(v.data) })
      .catch(() => addToast('Failed to load report catalogue', 'error'))
      .finally(() => { if (live) setLoadingCat(false) })
    return () => { live = false }
  }, [projectId])

  const datasetById = useMemo(() => Object.fromEntries((catalog?.datasets || []).map(d => [d.id, d])), [catalog])
  const reportsByCat = useMemo(() => {
    const m: Record<string, CatalogReport[]> = {}
    for (const r of (catalog?.reports || [])) (m[r.category] = m[r.category] || []).push(r)
    return m
  }, [catalog])

  // ── run a curated report ──
  const runCurated = useCallback(async (rep: CatalogReport) => {
    setMode('curated'); setActiveReport(rep); setActiveDataset(rep.datasetId ? datasetById[rep.datasetId] : null)
    setFilters([]); setGroupCol(''); setSumCol(''); setRunning(true); setResult(null)
    try {
      const { data } = await axios.post<RunResult>(`${API}/${projectId}/report/${rep.id}/run`, {})
      setResult(data); setRunKey(k => k + 1)
    } catch (e: any) { addToast(e?.response?.data?.error || 'Failed to run report', 'error') }
    finally { setRunning(false) }
  }, [projectId, datasetById])

  // ── open the ad-hoc builder on a dataset ──
  const openAdhoc = useCallback((ds: Dataset) => {
    setMode('adhoc'); setActiveReport(null); setActiveDataset(ds)
    setAdhocColumns(ds.defaultColumns); setFilters([]); setGroupCol(''); setSumCol(''); setResult(null)
  }, [])

  // ── build the ad-hoc engine config from current builder state ──
  const adhocConfig = useCallback(() => {
    if (!activeDataset) return null
    const cfg: any = { datasetId: activeDataset.id, filters }
    if (groupCol) {
      cfg.groupBy = [groupCol]
      cfg.aggregations = [{ fn: 'count', as: 'count' }]
      if (sumCol) cfg.aggregations.push({ fn: 'sum', col: sumCol, as: `sum_${sumCol}` })
    } else {
      cfg.columns = adhocColumns
    }
    return cfg
  }, [activeDataset, filters, groupCol, sumCol, adhocColumns])

  const runAdhoc = useCallback(async () => {
    const cfg = adhocConfig(); if (!cfg) return
    setRunning(true); setResult(null)
    try {
      const { data } = await axios.post<RunResult>(`${API}/${projectId}/run`, cfg)
      setResult(data); setRunKey(k => k + 1)
    } catch (e: any) { addToast(e?.response?.data?.error || 'Failed to run report', 'error') }
    finally { setRunning(false) }
  }, [adhocConfig, projectId])

  // ── exports ──
  const exportFile = useCallback(async (format: 'csv' | 'xlsx') => {
    try {
      const body: any = { format }
      if (mode === 'curated' && activeReport) { body.reportId = activeReport.id }
      else { const cfg = adhocConfig(); if (!cfg) return; Object.assign(body, cfg) }
      const res = await axios.post(`${API}/${projectId}/export`, body, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers['content-disposition'] || ''
      a.download = (cd.match(/filename="([^"]+)"/)?.[1]) || `report.${format}`
      a.click(); URL.revokeObjectURL(url)
    } catch (e: any) {
      // blob error bodies need decoding
      let msg = 'Export failed'
      try { msg = JSON.parse(await e?.response?.data?.text()).error || msg } catch {}
      addToast(msg, 'error')
    }
  }, [mode, activeReport, adhocConfig, projectId])

  const exportPdf = useCallback(() => {
    if (!result) return
    const title = activeReport?.name || activeDataset?.label || 'Report'
    printReport(title, `${projectName}`, result)
  }, [result, activeReport, activeDataset, projectName])

  // ── saved views ──
  const saveCurrentView = useCallback(async () => {
    if (mode !== 'adhoc' || !activeDataset) { addToast('Saved views are for ad-hoc reports', 'info'); return }
    const name = window.prompt('Save this report as:')
    if (!name) return
    const cfg = adhocConfig(); if (!cfg) return
    try {
      const { data } = await axios.post<SavedView>(`${API}/${projectId}/views`, { name, datasetId: activeDataset.id, config: cfg })
      setSavedViews(v => [...v, data].sort((a, b) => a.name.localeCompare(b.name)))
      addToast('View saved', 'success')
    } catch (e: any) { addToast(e?.response?.data?.error || 'Could not save view', 'error') }
  }, [mode, activeDataset, adhocConfig, projectId])

  const loadView = useCallback(async (v: SavedView) => {
    const ds = datasetById[v.datasetId]; if (!ds) { addToast('That dataset is no longer available', 'error'); return }
    setMode('adhoc'); setActiveReport(null); setActiveDataset(ds)
    const cfg = v.config || {}
    setAdhocColumns(cfg.columns || ds.defaultColumns)
    setFilters(cfg.filters || [])
    setGroupCol(cfg.groupBy?.[0] || '')
    setSumCol((cfg.aggregations || []).find((a: any) => a.fn === 'sum')?.col || '')
    setRunning(true); setResult(null)
    try { const { data } = await axios.post<RunResult>(`${API}/${projectId}/run`, cfg); setResult(data); setRunKey(k => k + 1) }
    catch (e: any) { addToast(e?.response?.data?.error || 'Failed to run view', 'error') }
    finally { setRunning(false) }
  }, [datasetById, projectId])

  const deleteView = useCallback(async (v: SavedView) => {
    if (!window.confirm(`Delete saved view "${v.name}"?`)) return
    try { await axios.delete(`${API}/${projectId}/views/${v.id}`); setSavedViews(s => s.filter(x => x.id !== v.id)); addToast('View deleted', 'success') }
    catch { addToast('Could not delete view', 'error') }
  }, [projectId])

  // ── filter editor helpers ──
  const colMeta = (key: string): ColMeta | undefined => activeDataset?.columns.find(c => c.key === key)
  const addFilter = () => {
    const firstFilterable = activeDataset?.columns.find(c => c.filterable)
    if (!firstFilterable) return
    const op = OPS_BY_TYPE[firstFilterable.type][0].op
    setFilters(f => [...f, { col: firstFilterable.key, op, value: '' }])
  }
  const updateFilter = (i: number, patch: Partial<Filter>) => setFilters(f => f.map((x, j) => j === i ? { ...x, ...patch } : x))
  const removeFilter = (i: number) => setFilters(f => f.filter((_, j) => j !== i))

  // ─── RENDER ─────────────────────────────────────────────────
  const numericCols = activeDataset?.columns.filter(c => c.type === 'number') || []
  const isAdhocReady = mode === 'adhoc' && activeDataset
  const canSave = mode === 'adhoc' && !!activeDataset

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg, color: col }}>
      {/* ── top bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: bd, flexShrink: 0 }}>
        <BackButton onFallback={onBack} dark={dark} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Reports</div>
          <div style={{ fontSize: 12, color: sub }}>Analytics & summaries · {projectName}</div>
        </div>
        <HelpButton screenName="Reports" sections={REPORTS_HELP} dark={dark} />
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ── LEFT RAIL: library + saved views ── */}
        <div style={{ width: 270, flexShrink: 0, borderRight: bd, overflow: 'auto', padding: 14 }}>
          {loadingCat && <div style={{ color: sub, fontSize: 13 }}>Loading…</div>}
          {catalog?.categories.map(cat => (
            <div key={cat.id} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#E84E0F', marginBottom: 6 }}>{cat.label}</div>
              {(reportsByCat[cat.id] || []).map(r => (
                <button key={r.id} onClick={() => runCurated(r)} title={r.desc}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 9px', marginBottom: 2, borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit',
                    background: activeReport?.id === r.id ? 'rgba(232,78,15,0.12)' : 'transparent', color: activeReport?.id === r.id ? '#E84E0F' : col }}>
                  {r.name}
                </button>
              ))}
            </div>
          ))}

          {/* Ad-hoc builder launcher */}
          {catalog && catalog.datasets.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: sub, marginBottom: 6 }}>Build your own</div>
              <select value="" onChange={e => { const ds = datasetById[e.target.value]; if (ds) openAdhoc(ds) }}
                style={{ ...inputStyle, width: '100%' }}>
                <option value="">＋ New ad-hoc report…</option>
                {catalog.datasets.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
          )}

          {/* Saved views */}
          {savedViews.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: sub, marginBottom: 6 }}>Saved views</div>
              {savedViews.map(v => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <button onClick={() => loadView(v)} style={{ flex: 1, textAlign: 'left', padding: '6px 9px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12.5, background: 'transparent', color: col, fontFamily: 'inherit' }}>★ {v.name}</button>
                  <button onClick={() => deleteView(v)} title="Delete view" style={{ border: 'none', background: 'transparent', color: sub, cursor: 'pointer', fontSize: 14 }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── MAIN: runner ── */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 18 }}>
          {mode === 'none' && (
            <div style={{ color: sub, fontSize: 14, marginTop: 40, textAlign: 'center' }}>
              Pick a report from the library, or build your own ad-hoc report.
            </div>
          )}

          {mode !== 'none' && (activeDataset || activeReport) && (
            <>
              {/* header + actions */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{activeReport?.name || `Ad-hoc · ${activeDataset?.label}`}</div>
                  <div style={{ fontSize: 12, color: sub }}>{activeReport?.desc || `Build a custom report over ${activeDataset?.label}.`}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {isAdhocReady && <button onClick={runAdhoc} disabled={running} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Run</button>}
                  {canSave && <button onClick={saveCurrentView} style={{ padding: '7px 12px', borderRadius: 7, border: bd, background: 'transparent', color: col, cursor: 'pointer', fontSize: 12.5 }}>★ Save view</button>}
                  {result && <>
                    <button onClick={() => exportFile('csv')} style={{ padding: '7px 12px', borderRadius: 7, border: bd, background: 'transparent', color: col, cursor: 'pointer', fontSize: 12.5 }}>↓ CSV</button>
                    <button onClick={() => exportFile('xlsx')} style={{ padding: '7px 12px', borderRadius: 7, border: bd, background: 'transparent', color: col, cursor: 'pointer', fontSize: 12.5 }}>↓ Excel</button>
                    <button onClick={exportPdf} style={{ padding: '7px 12px', borderRadius: 7, border: bd, background: 'transparent', color: col, cursor: 'pointer', fontSize: 12.5 }}>↓ PDF</button>
                  </>}
                </div>
              </div>

              {/* AD-HOC BUILDER */}
              {mode === 'adhoc' && (
                <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 14, marginBottom: 14 }}>
                  {/* columns (only when not grouping) */}
                  {!groupCol && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: sub, marginBottom: 6 }}>Columns</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {activeDataset.columns.map(c => {
                          const on = adhocColumns.includes(c.key)
                          return (
                            <button key={c.key} onClick={() => setAdhocColumns(cols => on ? cols.filter(k => k !== c.key) : [...cols, c.key])}
                              style={{ padding: '4px 10px', borderRadius: 14, fontSize: 12, cursor: 'pointer', border: `1px solid ${on ? '#E84E0F' : (dark ? '#334155' : '#dde3ed')}`, background: on ? 'rgba(232,78,15,0.12)' : 'transparent', color: on ? '#E84E0F' : col }}>
                              {c.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* filters */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: sub }}>Filters</div>
                      <button onClick={addFilter} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: bd, background: 'transparent', color: col, cursor: 'pointer' }}>＋ Add filter</button>
                    </div>
                    {filters.map((f, i) => {
                      const cm = colMeta(f.col)
                      const ops = cm ? OPS_BY_TYPE[cm.type] : []
                      const opDef = ops.find(o => o.op === f.op)
                      return (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select value={f.col} onChange={e => { const nc = colMeta(e.target.value); updateFilter(i, { col: e.target.value, op: nc ? OPS_BY_TYPE[nc.type][0].op : 'eq', value: '' }) }} style={inputStyle}>
                            {activeDataset.columns.filter(c => c.filterable).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </select>
                          <select value={f.op} onChange={e => updateFilter(i, { op: e.target.value, value: '' })} style={inputStyle}>
                            {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                          </select>
                          {!opDef?.nullary && cm && (
                            cm.type === 'enum' && cm.options
                              ? <select value={f.value} onChange={e => updateFilter(i, { value: e.target.value })} style={inputStyle}><option value="">—</option>{cm.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
                              : cm.type === 'bool'
                                ? <select value={f.value} onChange={e => updateFilter(i, { value: e.target.value })} style={inputStyle}><option value="">—</option><option value="1">Yes</option><option value="0">No</option></select>
                                : <input type={cm.type === 'date' ? 'date' : cm.type === 'number' ? 'number' : 'text'} value={f.value ?? ''} onChange={e => updateFilter(i, { value: e.target.value })} placeholder="value" style={{ ...inputStyle, width: 150 }} />
                          )}
                          <button onClick={() => removeFilter(i)} style={{ border: 'none', background: 'transparent', color: sub, cursor: 'pointer', fontSize: 16 }}>×</button>
                        </div>
                      )
                    })}
                    {filters.length === 0 && <div style={{ fontSize: 12, color: sub }}>No filters — all rows.</div>}
                  </div>

                  {/* grouping */}
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: sub }}>Summarise</div>
                    <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                      Group by
                      <select value={groupCol} onChange={e => setGroupCol(e.target.value)} style={inputStyle}>
                        <option value="">— none (list rows) —</option>
                        {activeDataset.columns.filter(c => c.type !== 'number').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    </label>
                    {groupCol && numericCols.length > 0 && (
                      <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                        + sum of
                        <select value={sumCol} onChange={e => setSumCol(e.target.value)} style={inputStyle}>
                          <option value="">— count only —</option>
                          {numericCols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                </div>
              )}

              {/* RESULTS */}
              {running && <div style={{ color: sub, fontSize: 14, padding: 20 }}>Running…</div>}
              {!running && result && (
                <>
                  <div style={{ fontSize: 12, color: sub, marginBottom: 4 }}>{result.rows.length} row{result.rows.length === 1 ? '' : 's'}{result.total > result.rows.length ? ` of ${result.total}` : ''}{result.grouped ? ' · grouped' : ''}</div>
                  <ResultsTable key={`${activeReport?.id || activeDataset?.id}-${runKey}`} result={result} dark={dark} tableId={`reports_${activeReport?.id || activeDataset?.id}`} />
                </>
              )}
              {!running && !result && mode === 'adhoc' && (
                <div style={{ color: sub, fontSize: 13, padding: 16 }}>Configure columns / filters above, then press <b>Run</b>.</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── EXPORT (toast provider wrapper) ──────────────────────────
export const ReportsScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider>
    <ReportsInner {...props} />
  </ToastProvider>
)
