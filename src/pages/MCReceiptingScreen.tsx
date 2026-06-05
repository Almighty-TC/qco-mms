// ─── MC RECEIPTING SCREEN ─────────────────────────────────────
// Pending Receipt register — inbound SCNs awaiting goods-in.
// 6 tabs: All · Arrived · In Transit · Customs · Shipments · Transfers
// Click "Receipt →" on Arrived rows → 5-step Receipting Wizard.
import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'   // modals portal to document.body — see App.tsx zoom wrapper
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { useAutoTitle } from '../hooks/useAutoTitle'

const API = 'http://localhost:3001/api'

type Tab = 'all' | 'arrived' | 'in_transit' | 'customs' | 'shipments' | 'transfers'
type WizardStep = 1 | 2 | 3 | 4 | 5

// Heat/Lot P2b — one heat allocation within a split PO line.
interface SubLine {
  received_qty: number; damaged_qty: number
  heat_number: string; heat_off_list: boolean; heat_off_list_reason: string
}

interface SCNRow {
  id: number; scn_ref: string; status: string; mode?: string; type: 'SHIPMENT' | 'TRANSFER'
  eta?: string | null; origin_location?: string | null; vendor_name?: string | null
  po_ref?: string | null; destination_name?: string | null; destination_warehouse_id?: number | null
  total_packages?: number | null; total_weight_kg?: number | null; notes?: string | null
  // Transfer fields
  item_description?: string | null; qty?: number | null; uom?: string | null; from_warehouse_name?: string | null
}

interface Pipeline { arrived: number; in_transit: number; customs_hold: number; transfers: number; total_awaiting: number }

// ─── HELPERS ──────────────────────────────────────────────────
const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

// Phase 4: per-line "expected to receive now" = REMAINING (ordered − received-to-date,
// from the API), so a second receipt only takes the balance. Falls back to ordered qty.
const lineExpected = (l: any) => Number(l?.remaining ?? l?.qty) || 0

const statusPill = (s: string) => {
  const m: Record<string, { label: string; bg: string; color: string }> = {
    arrived:        { label: 'Arrived — ready', bg: 'rgba(34,197,94,0.12)', color: '#16a34a' },
    'in-transit':   { label: 'In transit',      bg: 'rgba(37,99,235,0.1)',  color: '#2563eb' },
    in_transit:     { label: 'In transit',      bg: 'rgba(37,99,235,0.1)',  color: '#2563eb' },
    pending:        { label: 'In transit',      bg: 'rgba(37,99,235,0.1)',  color: '#2563eb' },
    customs_review: { label: 'In customs hold', bg: 'rgba(245,158,11,0.1)', color: '#d97706' },
    in_transit_tr:  { label: 'Picked up',       bg: 'rgba(139,92,246,0.1)', color: '#7c3aed' },
    picked_up:      { label: 'Picked up',       bg: 'rgba(139,92,246,0.1)', color: '#7c3aed' },
    draft:          { label: 'Pending',          bg: 'rgba(148,163,184,0.1)','color': '#64748b' },
    partially_received: { label: 'Partially received', bg: 'rgba(245,158,11,0.12)', color: '#d97706' },
  }
  return m[s] || { label: s, bg: 'rgba(148,163,184,0.1)', color: '#64748b' }
}

// ─── INNER COMPONENT ──────────────────────────────────────────
const MCReceiptingInner = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const { addToast } = useToast()
  const { isSubcontractor, isForwarder } = useCurrentUser()

  // Subcontractors/forwarders redirected away — safety net in addition to sidebar hiding
  if (isSubcontractor || isForwarder) { onBack(); return null }

  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bg     = dark ? '#0f172a' : '#f4f7fb'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  const [tab, setTab]         = useState<Tab>('all')
  const [rows, setRows]       = useState<SCNRow[]>([])
  const [pipeline, setPipe]   = useState<Pipeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [wizardScn, setWizardScn] = useState<SCNRow | null>(null)
  // Truncated cells get a hover tooltip; re-runs when the register rows change.
  const tableRef = useRef<HTMLDivElement>(null)
  useAutoTitle(tableRef, [rows])

  const fetchData = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/mc/${projectId}/receipting`, {
        params: { tab, search: search.trim() || undefined }
      })
      setRows(data.data || [])
      setPipe(data.pipeline)
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to load receipting register')
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [tab, projectId]) // eslint-disable-line
  useEffect(() => {
    const t = setTimeout(fetchData, 350)
    return () => clearTimeout(t)
  }, [search]) // eslint-disable-line

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'all',        label: 'All',        count: pipeline?.total_awaiting },
    { key: 'arrived',    label: 'Arrived',    count: pipeline?.arrived },
    { key: 'in_transit', label: 'In transit', count: pipeline?.in_transit },
    { key: 'customs',    label: 'Customs',    count: pipeline?.customs_hold },
    { key: 'shipments',  label: 'Shipments' },
    { key: 'transfers',  label: 'Transfers',  count: pipeline?.transfers },
  ]

  return (
    <div style={{ background: bg, minHeight: '100vh', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ background: cardBg, borderBottom: bd, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onFallback={onBack} dark={dark} />
          <div style={{ fontSize: 11, color: sub }}>Dashboard › {projectName} › Material Control › <strong style={{ color: col }}>Receipting</strong></div>
        </div>
        <button style={{ padding: '6px 14px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>↓ Export</button>
      </div>

      <div style={{ padding: 24 }}>
        {/* Title */}
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: col }}>Pending Receipt</h1>
        <div style={{ fontSize: 12, color: sub, marginBottom: 20 }}>
          {pipeline?.total_awaiting ?? '…'} incoming shipments & transfers awaiting receipt · {projectName}
        </div>

        {/* KPI cards */}
        {pipeline && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Arrived — ready',        value: pipeline.arrived,        color: '#22c55e' },
              { label: 'In transit / picked up', value: pipeline.in_transit,     color: '#2563eb' },
              { label: 'Customs hold',            value: pipeline.customs_hold,   color: '#f59e0b' },
              { label: 'Total awaiting',          value: pipeline.total_awaiting, color: col },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: cardBg, border: bd, borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, borderBottom: bd, marginBottom: 0, background: cardBg, borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, fontFamily: 'inherit',
                fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? '#E84E0F' : sub,
                borderBottom: tab === t.key ? '2px solid #E84E0F' : '2px solid transparent',
              }}>
              {t.label}{t.count !== undefined ? ` ${t.count}` : ''}
            </button>
          ))}
        </div>

        {/* Search + destination */}
        <div style={{ background: cardBg, borderLeft: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRight: `1px solid ${dark ? '#334155' : '#dde3ed'}`, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search ref, item, vendor, PO, WBS…"
            style={{ flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit' }} />
          <select style={{ fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit' }}>
            <option value="all">Destination: All</option>
          </select>
        </div>

        {/* Table */}
        <div style={{ background: cardBg, border: bd, borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
          <div ref={tableRef} style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                <tr style={{ borderBottom: bd }}>
                  {['REFERENCE','TYPE','ITEM / DESCRIPTION','QTY','WBS','SOURCE / VENDOR','ETA','DESTINATION','STATUS',''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: sub }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 50, textAlign: 'center', color: sub }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>📦</div>
                    <div>No pending receipts.</div>
                  </td></tr>
                ) : rows.map(row => {
                  const pill = statusPill(row.status)
                  // partially_received SCNs stay receivable for the balance.
                  const isArrived = row.status === 'arrived' || row.status === 'partially_received'
                  return (
                    <tr key={`${row.type}-${row.id}`} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                      <td style={{ padding: '9px 12px' }}>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{row.scn_ref}</div>
                        {row.po_ref && <div style={{ fontSize: 10, color: sub, marginTop: 1 }}>{row.po_ref}</div>}
                        {row.status === 'arrived' && <div style={{ fontSize: 9, color: '#ef4444', fontWeight: 700, marginTop: 1 }}>HIGH PRIORITY</div>}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: row.type === 'SHIPMENT' ? 'rgba(37,99,235,0.08)' : 'rgba(139,92,246,0.08)', color: row.type === 'SHIPMENT' ? '#2563eb' : '#7c3aed', fontWeight: 600 }}>
                          {row.type}
                        </span>
                      </td>
                      <td style={{ padding: '9px 12px', color: col, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.type === 'TRANSFER' ? row.item_description : (row.notes || `SCN ${row.scn_ref}`)}
                      </td>
                      <td style={{ padding: '9px 12px', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                        {row.type === 'TRANSFER' ? `${row.qty} ${row.uom || ''}` : (row.total_packages ? `${row.total_packages} pkgs` : '—')}
                      </td>
                      <td style={{ padding: '9px 12px', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>—</td>
                      <td style={{ padding: '9px 12px', color: col }}>
                        {row.vendor_name || '—'}
                        <div style={{ fontSize: 10, color: sub }}>{row.origin_location}</div>
                      </td>
                      <td style={{ padding: '9px 12px', color: sub, fontSize: 11 }}>{fmt(row.eta)}</td>
                      <td style={{ padding: '9px 12px', color: col, fontSize: 11 }}>{row.destination_name || '—'}</td>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: pill.bg, color: pill.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {pill.label}
                        </span>
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        {isArrived && (
                          <button onClick={() => setWizardScn(row)}
                            style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            Receipt →
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Receipting Wizard */}
      {wizardScn && (
        <ReceiptingWizard
          dark={dark} scn={wizardScn} projectId={projectId}
          onClose={() => setWizardScn(null)}
          onComplete={() => { setWizardScn(null); fetchData(); addToast('success', 'Receipt complete — stock created') }}
          addToast={addToast}
        />
      )}
    </div>
  )
}

// ─── RECEIPTING WIZARD ────────────────────────────────────────
// 5-step wizard: Review expected → Physical check → Assign location → TCCC sign-off → Complete
// State is preserved when navigating back — no resets on step change.
const ReceiptingWizard = ({ dark, scn, projectId, onClose, onComplete, addToast }: {
  dark: boolean; scn: SCNRow; projectId: number
  onClose: () => void; onComplete: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const [step, setStep]         = useState<WizardStep>(1)
  const [detail, setDetail]     = useState<any>(null)
  const [actuals, setActuals]   = useState<Record<number, number>>({})
  // Discrepancy state — DERIVED live (Phase 2): no latched "mode" flag.
  // damaged[lineId] is independent of the qty match; a line is a
  // discrepancy when received != expected OR damaged > 0.
  const [damaged, setDamaged] = useState<Record<number, number>>({})
  const [discrepancyTypes, setDiscrepancyTypes] = useState<Record<number, string>>({})
  const [discrepancyNotes, setDiscrepancyNotes] = useState('')
  // Heat/Lot P2a — per-line heat, keyed by po_line.id (like actuals/damaged).
  // `heat` holds the chosen/typed heat number; `heatOffList` flips a line to the
  // free-text "Other / not listed" path (which requires a reason). Optional: a
  // line may carry no heat. `selectedLines`/`bulkHeat` drive the bulk apply.
  const [heat, setHeat]             = useState<Record<number, string>>({})
  const [heatOffList, setHeatOffList] = useState<Record<number, boolean>>({})
  const [heatReason, setHeatReason] = useState<Record<number, string>>({})
  const [selectedLines, setSelectedLines] = useState<Record<number, boolean>>({})
  const [bulkHeat, setBulkHeat]     = useState('')
  // Heat/Lot P2b — split state. A line present in `splitLines` is split into N
  // sub-lines, each its own received_qty + damaged_qty + heat. Absent = the P2a
  // 1:1 path (unchanged). The line's ACTUAL (actuals[id]) is the reconcile target:
  // a split is valid only when Σ sub.received_qty === that total.
  const [splitLines, setSplitLines] = useState<Record<number, SubLine[]>>({})
  const [hasDiscrepancy, setHasDiscrepancy] = useState(false)
  const [location, setLocation] = useState('')
  const [cargoCondition, setCargo] = useState('')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)

  // ─── Step-nav helpers (preserve all state) ────────────────
  const goBack = () => setStep(s => (s > 1 ? (s - 1) as WizardStep : s))

  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bg     = dark ? '#0f172a' : '#f4f7fb'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

  useEffect(() => {
    axios.get(`${API}/mc/${projectId}/receipting/${scn.id}`)
      .then(r => {
        setDetail(r.data)
        // Phase 4: default actual = REMAINING to receive (ordered − received-to-date).
        const init: Record<number, number> = {}
        ;(r.data.lines || []).forEach((l: any) => { init[l.id] = lineExpected(l) })
        setActuals(init)
      })
      .catch(() => setDetail({ packages: [], lines: [] }))
  }, [scn.id, projectId]) // eslint-disable-line

  // ─── Live discrepancy reconciliation (Phase 2 — Bug 1) ────────
  // Whenever quantities/damaged change so that NO line has an issue,
  // drop any leftover per-line discrepancy types + shared notes so the
  // step returns to a genuine clean-match state (nothing latched).
  useEffect(() => {
    const ls = detail?.lines || []
    const anyIssue = ls.some((l: any) => {
      const exp = lineExpected(l)
      const act = actuals[l.id] ?? exp
      const dmg = damaged[l.id] ?? 0
      return act !== exp || dmg > 0
    })
    if (!anyIssue) {
      if (Object.keys(discrepancyTypes).length) setDiscrepancyTypes({})
      if (discrepancyNotes) setDiscrepancyNotes('')
    }
  }, [actuals, damaged, detail]) // eslint-disable-line

  const SUGGESTED_LOCS = ['WH-A · A-04-03', 'WH-B · B-02-05', 'WH-C · C-01-03']

  const completeReceipt = async () => {
    if (!location.trim()) { addToast('error', 'Grid location is required'); return }
    if (!cargoCondition) { addToast('error', 'Cargo condition is required'); return }
    setSaving(true)
    try {
      // Phase 1: persist the per-line received quantities + discrepancy detail
      // the wizard collected. Built from the real PO lines.
      // Heat/Lot P2b — a SPLIT line fans out into N entries (same po_line_id, each
      // its own received/damaged/heat); a non-split line stays the P2a 1:1 entry.
      // The complete handler loops entries → N receipt_lines + holdings, and the
      // received-to-date / remaining / status math is SUM-based, so totals match.
      const lines = (detail?.lines || []).flatMap((l: any) => {
        const expected = lineExpected(l)   // remaining-to-receive for THIS receipt
        const subs = splitLines[l.id]
        const lineTotal = actuals[l.id] ?? expected
        const wbs = l.wbs_code_snapshot || null
        const itemCode = l.tag_number || l.equipment_tag || null
        if (Array.isArray(subs) && subs.length > 0) {
          // SPLIT: one entry per heat allocation. Discrepancy (type/notes) keys off
          // the line total vs expected (same rule), applied to every sub-entry.
          const issue = lineTotal !== expected || subs.some(s => Number(s.damaged_qty || 0) > 0)
          return subs.map((s) => ({
            po_line_id: l.id,
            line_number: l.line_number,
            description: l.description,
            expected_qty: null,                       // informational only; not used in the SUM math
            received_qty: Number(s.received_qty) || 0,
            damaged_qty: Number(s.damaged_qty) || 0,
            uom: l.uom || 'EA',
            wbs_code: wbs,
            item_code: itemCode,
            discrepancy_type: issue ? (discrepancyTypes[l.id] || null) : null,
            discrepancy_notes: issue ? (discrepancyNotes.trim() || null) : null,
            heat_number: (s.heat_number || '').trim() || null,
            heat_off_list: s.heat_off_list ? 1 : 0,
            heat_off_list_reason: s.heat_off_list ? ((s.heat_off_list_reason || '').trim() || null) : null,
          }))
        }
        // 1:1 (P2a) path — unchanged.
        const received = lineTotal
        const dmg = damaged[l.id] ?? 0
        const issue = received !== expected || dmg > 0
        return [{
          po_line_id: l.id,
          line_number: l.line_number,
          description: l.description,
          expected_qty: expected,
          received_qty: received,
          damaged_qty: dmg,
          uom: l.uom || 'EA',
          wbs_code: wbs,
          item_code: itemCode,
          discrepancy_type: issue ? (discrepancyTypes[l.id] || null) : null,
          discrepancy_notes: issue ? (discrepancyNotes.trim() || null) : null,
          heat_number: (heat[l.id] || '').trim() || null,
          heat_off_list: heatOffList[l.id] ? 1 : 0,
          heat_off_list_reason: heatOffList[l.id] ? ((heatReason[l.id] || '').trim() || null) : null,
        }]
      })
      await axios.post(`${API}/mc/${projectId}/receipting/${scn.id}/complete`, {
        location_code: location.trim(), cargo_condition: cargoCondition, notes,
        actual_packages: Object.values(actuals).length, warehouse_id: scn.destination_warehouse_id,
        lines,
      })
      setStep(5)
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to complete receipt')
    } finally { setSaving(false) }
  }

  const STEPS = ['Review expected','Physical check','Assign location','TCCC sign-off','Complete']

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: bg, zIndex: 5000, overflow: 'auto', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Topbar */}
      <div style={{ background: cardBg, borderBottom: bd, padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sub, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}>← Back</button>
          <div style={{ fontSize: 15, fontWeight: 700, color: col }}>Receipting</div>
          <div style={{ fontSize: 12, color: sub }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{scn.scn_ref}</span>
            {scn.po_ref && <> · <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{scn.po_ref}</span></>}
            {scn.vendor_name && <> · {scn.vendor_name}</>}
          </div>
        </div>
        <button style={{ padding: '5px 12px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>📎 Documents</button>
      </div>

      {/* Step progress bar */}
      <div style={{ background: cardBg, borderBottom: bd, padding: '10px 24px', display: 'flex', gap: 0, alignItems: 'center' }}>
        {STEPS.map((s, i) => {
          const sNum = (i + 1) as WizardStep
          const done = sNum < step
          const active = sNum === step
          return (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, flexShrink: 0,
                  background: done ? '#22c55e' : active ? '#2563eb' : dark ? '#334155' : '#e2e8f0',
                  color: done || active ? '#fff' : sub,
                }}>
                  {done ? '✓' : sNum}
                </div>
                <span style={{ fontSize: 12, color: active ? col : sub, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{s}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: done ? '#22c55e' : dark ? '#334155' : '#e2e8f0', margin: '0 8px' }} />
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ maxWidth: 700, margin: '32px auto', padding: '0 24px' }}>

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <div>
            <p style={{ color: sub, fontSize: 13, marginBottom: 16 }}>Review the expected shipment contents. Confirm before beginning physical inspection.</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: cardBg, border: bd, borderRadius: 8 }}>
              <thead>
                <tr style={{ background: dark ? '#162032' : '#f8fafc', borderBottom: bd }}>
                  {['LINE','DESCRIPTION','EXP. QTY','UOM'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!detail ? (
                  <tr><td colSpan={4} style={{ padding: 20, textAlign: 'center', color: sub }}>Loading…</td></tr>
                ) : (detail.lines || []).length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 20, textAlign: 'center', color: sub }}>No PO lines linked to this SCN.</td></tr>
                ) : (detail.lines || []).map((l: any) => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#E84E0F' }}>L-{String(l.line_number || l.id).padStart(3,'0')}</td>
                    <td style={{ padding: '8px 12px', color: col }}>{l.description || 'Line item'}</td>
                    <td style={{ padding: '8px 12px', color: col, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                      {lineExpected(l)}
                      {Number(l.received_to_date) > 0 && <span style={{ color: sub }}> <span title="already received-to-date">(of {Number(l.qty)} ordered)</span></span>}
                    </td>
                    <td style={{ padding: '8px 12px', color: sub }}>{l.uom || 'EA'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ background: dark ? '#162032' : '#f0f9ff', border: bd, borderRadius: 8, padding: '10px 14px', marginTop: 12, display: 'flex', gap: 16, fontSize: 12, color: sub }}>
              <span>{(detail?.lines || []).length} line items</span>
              <span>{scn.total_weight_kg ? `${scn.total_weight_kg} t total` : '—'}</span>
              {scn.eta && <span>ETA {fmt(scn.eta)}</span>}
            </div>
            {/* Step 1 footer — no Back (first step) */}
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setStep(2)}
                style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Begin inspection →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2 ── Physical check + inline discrepancy flow ── */}
        {step === 2 && (() => {
          // Phase 2: ALL discrepancy state derived live from current values —
          // nothing latched. Re-evaluated on every render/change.
          // Phase 4: "expected" = remaining-to-receive (so a 2nd receipt takes the balance).
          const lines = detail?.lines || []
          const expOf = (l: any) => lineExpected(l)
          const recOf = (l: any) => actuals[l.id] ?? expOf(l)   // line total received (also the split reconcile target)
          // ── Heat/Lot P2b split helpers (a split line has a SubLine[]; absent = 1:1) ──
          const subsOf = (l: any): SubLine[] | undefined => splitLines[l.id]
          const isSplit = (l: any) => Array.isArray(subsOf(l)) && (subsOf(l) as SubLine[]).length > 0
          const subSum = (l: any) => (subsOf(l) || []).reduce((t, s) => t + (Number(s.received_qty) || 0), 0)
          // damaged total: split → Σ sub.damaged, else the 1:1 value.
          const dmgOf = (l: any) => isSplit(l) ? (subsOf(l) || []).reduce((t, s) => t + (Number(s.damaged_qty) || 0), 0) : (damaged[l.id] ?? 0)
          const splitReconciled = (l: any) => !isSplit(l) || subSum(l) === recOf(l)
          // A line is a discrepancy when received != expected OR damaged > 0. (received = the line total either way.)
          const issueOf = (l: any) => recOf(l) !== expOf(l) || dmgOf(l) > 0
          const issueLines = lines.filter(issueOf)
          const anyIssue = issueLines.length > 0
          const allClean = lines.length > 0 && !anyIssue
          // To proceed WITH a discrepancy: every issue line needs a type + shared notes.
          const typesComplete = issueLines.every((l: any) => (discrepancyTypes[l.id] || '').length > 0)
          const discrepancyReady = anyIssue && discrepancyNotes.trim().length > 0 && typesComplete
          const DISC_TYPES = ['Short delivery','Over delivery','Damaged','Missing','Other']

          // ── Heat/Lot P2b split gating + mutators ──
          // Valid split: sub-lines reconcile to the line total AND each sub's damaged ≤ its received.
          const splitReady = lines.every((l: any) => splitReconciled(l) &&
            (!isSplit(l) || (subsOf(l) as SubLine[]).every(s => Number(s.damaged_qty || 0) <= Number(s.received_qty || 0))))
          const startSplit = (l: any) => setSplitLines(p => ({ ...p, [l.id]: [
            { received_qty: Number(recOf(l)) || 0, damaged_qty: Number(damaged[l.id] || 0), heat_number: heat[l.id] || '', heat_off_list: !!heatOffList[l.id], heat_off_list_reason: heatReason[l.id] || '' },
            { received_qty: 0, damaged_qty: 0, heat_number: '', heat_off_list: false, heat_off_list_reason: '' },
          ] }))
          const endSplit = (id: number) => setSplitLines(p => { const n = { ...p }; delete n[id]; return n })
          const addSub = (id: number) => setSplitLines(p => ({ ...p, [id]: [...(p[id] || []), { received_qty: 0, damaged_qty: 0, heat_number: '', heat_off_list: false, heat_off_list_reason: '' }] }))
          const removeSub = (id: number, i: number) => setSplitLines(p => { const arr = (p[id] || []).filter((_, idx) => idx !== i); if (arr.length <= 1) { const n = { ...p }; delete n[id]; return n } return { ...p, [id]: arr } })
          const updateSub = (id: number, i: number, field: keyof SubLine, val: any) => setSplitLines(p => ({ ...p, [id]: (p[id] || []).map((s, idx) => idx === i ? { ...s, [field]: val } : s) }))
          const setSubHeat = (id: number, i: number, v: string) => setSplitLines(p => ({ ...p, [id]: (p[id] || []).map((s, idx) => {
            if (idx !== i) return s
            if (v === '__other__') return { ...s, heat_off_list: true, heat_number: '' }
            return { ...s, heat_off_list: false, heat_number: v, heat_off_list_reason: '' }
          }) }))

          // ── Heat/Lot P2a gating + bulk apply ──
          // Heat is optional, but an off-list heat needs a reason before proceeding (1:1 OR each split sub).
          const declaredHeats = detail?.heats || []
          const heatReady = lines.every((l: any) => isSplit(l)
            ? (subsOf(l) as SubLine[]).every(s => !s.heat_off_list || (s.heat_off_list_reason || '').trim().length > 0)
            : (!heatOffList[l.id] || (heatReason[l.id] || '').trim().length > 0))
          const selectedIds = lines.filter((l: any) => selectedLines[l.id]).map((l: any) => l.id)
          const allSelected = lines.length > 0 && lines.every((l: any) => selectedLines[l.id])
          const toggleSel = (id: number) => setSelectedLines(prev => ({ ...prev, [id]: !prev[id] }))
          const toggleSelAll = () => setSelectedLines(() => allSelected ? {} : Object.fromEntries(lines.map((l: any) => [l.id, true])))
          const applyBulkHeat = () => {
            if (!bulkHeat || selectedIds.length === 0) return
            setHeat(prev => { const n = { ...prev }; selectedIds.forEach((id: number) => { n[id] = bulkHeat }); return n })
            setHeatOffList(prev => { const n = { ...prev }; selectedIds.forEach((id: number) => { n[id] = false }); return n })
            setHeatReason(prev => { const n = { ...prev }; selectedIds.forEach((id: number) => { delete n[id] }); return n })
          }
          const setLineHeat = (id: number, v: string) => {
            if (v === '__other__') { setHeatOffList(p => ({ ...p, [id]: true })); setHeat(p => ({ ...p, [id]: '' })) }
            else {
              setHeatOffList(p => ({ ...p, [id]: false }))
              setHeatReason(p => { const n = { ...p }; delete n[id]; return n })
              setHeat(p => ({ ...p, [id]: v }))
            }
          }

          const proceed = (withDiscrepancy: boolean) => {
            setHasDiscrepancy(withDiscrepancy)
            setStep(3)
          }
          // Drop a line's stale discrepancy type the moment it returns to clean.
          const clearIfClean = (l: any, rec: number, dmg: number) => {
            if (rec === expOf(l) && dmg === 0) {
              setDiscrepancyTypes(prev => { const n = { ...prev }; delete n[l.id]; return n })
            }
          }

          return (
            <div>
              <p style={{ color: sub, fontSize: 13, marginBottom: 16 }}>Enter actual quantities received for each package. Flag any discrepancies. Heat numbers are optional.</p>

              {/* ── Heat/Lot P2a — BULK apply: one heat for the selected lines ── */}
              {lines.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: sub }}>Bulk heat:</span>
                  <select value={bulkHeat} onChange={e => setBulkHeat(e.target.value)}
                    style={{ ...inputSt, width: 220, padding: '5px 8px' }}>
                    <option value="">— Pick a declared heat —</option>
                    {declaredHeats.map((h: any) => (
                      <option key={h.id} value={h.heat_number}>{h.heat_number}{h.material_grade ? ` · ${h.material_grade}` : ''}</option>
                    ))}
                  </select>
                  <button onClick={applyBulkHeat} disabled={!bulkHeat || selectedIds.length === 0}
                    style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: (bulkHeat && selectedIds.length) ? '#2563eb' : '#94a3b8', color: '#fff', cursor: (bulkHeat && selectedIds.length) ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600 }}>
                    Apply heat to selected ({selectedIds.length})
                  </button>
                  {declaredHeats.length === 0 && <span style={{ fontSize: 11, color: '#f59e0b' }}>No heats declared on this SCN — use "Other / not listed" per line.</span>}
                </div>
              )}

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: cardBg, border: bd, borderRadius: 8 }}>
                <thead>
                  <tr style={{ background: dark ? '#162032' : '#f8fafc', borderBottom: bd }}>
                    <th style={{ padding: '8px 12px', textAlign: 'center', width: 32 }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleSelAll} style={{ accentColor: '#2563eb', cursor: 'pointer' }} title="Select all (bulk heat)" />
                    </th>
                    {['LINE','DESCRIPTION','EXPECTED','UOM','ACTUAL','DAMAGED','MATCH','HEAT', ...(anyIssue ? ['DISCREPANCY TYPE'] : [])].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr><td colSpan={anyIssue ? 10 : 9} style={{ padding: 20, textAlign: 'center', color: sub }}>No PO lines linked to this SCN — nothing to receive against.</td></tr>
                  ) : lines.map((l: any) => {
                    const expected = expOf(l)
                    const actual = actuals[l.id] ?? expected
                    const dmg = dmgOf(l)
                    const issue = actual !== expected || dmg > 0   // live: qty mismatch OR damaged
                    const clean = !issue
                    const rowHighlight = issue ? (dark ? 'rgba(245,158,11,0.06)' : 'rgba(245,158,11,0.05)') : undefined
                    // Heat/Lot P2b — split view
                    const split = isSplit(l)
                    const subs = subsOf(l) || []
                    const allocated = subSum(l)
                    const reconciled = splitReconciled(l)
                    return (
                      <React.Fragment key={l.id}>
                      <tr style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, background: rowHighlight }}>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <input type="checkbox" checked={!!selectedLines[l.id]} onChange={() => toggleSel(l.id)} style={{ accentColor: '#2563eb', cursor: 'pointer' }} />
                        </td>
                        <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#E84E0F' }}>L-{String(l.line_number || l.id).padStart(3,'0')}</td>
                        <td style={{ padding: '8px 12px', color: col }}>{l.description || 'Line item'}</td>
                        <td style={{ padding: '8px 12px', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                          {expected}
                          {Number(l.received_to_date) > 0 && <span title="already received-to-date"> (of {Number(l.qty)})</span>}
                        </td>
                        <td style={{ padding: '8px 12px', color: sub }}>{l.uom || 'EA'}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <input type="number" value={actual} min={0}
                            onChange={e => {
                              const v = Number(e.target.value)
                              setActuals(prev => ({ ...prev, [l.id]: v }))
                              // damaged can't exceed received — clamp if needed (1:1 only)
                              if (!split && dmg > v) setDamaged(prev => ({ ...prev, [l.id]: v }))
                              clearIfClean(l, v, split ? dmg : Math.min(dmg, v))
                            }}
                            style={{ ...inputSt, width: 80, textAlign: 'center', borderColor: actual !== expected ? '#f59e0b' : undefined }} />
                          {/* Split reconcile indicator */}
                          {split && (
                            <div style={{ fontSize: 10, marginTop: 3, color: reconciled ? '#22c55e' : '#ef4444', fontFamily: 'JetBrains Mono, monospace' }}
                              title="Σ sub-line received must equal the line total">
                              {reconciled ? `✓ allocated ${allocated}` : `allocated ${allocated} of ${actual}`}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {/* Split → damaged is the derived Σ of sub-lines (read-only). 1:1 → editable. */}
                          {split ? (
                            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: dmg > 0 ? '#f59e0b' : sub }} title="sum of sub-line damaged">{dmg}</span>
                          ) : (
                            <input type="number" value={dmg} min={0} max={actual}
                              onChange={e => {
                                let v = Number(e.target.value)
                                if (!(v >= 0)) v = 0
                                if (v > actual) v = actual   // client validation: damaged ≤ received
                                setDamaged(prev => ({ ...prev, [l.id]: v }))
                                clearIfClean(l, actual, v)
                              }}
                              style={{ ...inputSt, width: 80, textAlign: 'center', borderColor: dmg > 0 ? '#f59e0b' : undefined }} />
                          )}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span title={clean ? 'Match' : (dmg > 0 ? 'Damaged units' : 'Qty mismatch')}
                            style={{ color: clean ? '#22c55e' : '#f59e0b', fontSize: 16 }}>{clean ? '✓' : '⚠'}</span>
                        </td>
                        {/* ── Heat: 1:1 dropdown (P2a) OR split summary + controls (P2b) ── */}
                        <td style={{ padding: '8px 12px' }}>
                          {!split ? (
                            <>
                              <select value={heatOffList[l.id] ? '__other__' : (heat[l.id] || '')}
                                onChange={e => setLineHeat(l.id, e.target.value)}
                                style={{ ...inputSt, width: 170, padding: '5px 8px' }}>
                                <option value="">— No heat —</option>
                                {declaredHeats.map((h: any) => (
                                  <option key={h.id} value={h.heat_number}>{h.heat_number}{h.material_grade ? ` · ${h.material_grade}` : ''}</option>
                                ))}
                                <option value="__other__">Other / not listed…</option>
                              </select>
                              {heatOffList[l.id] && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                                  <input value={heat[l.id] || ''} onChange={e => setHeat(p => ({ ...p, [l.id]: e.target.value }))}
                                    placeholder="Heat number"
                                    style={{ ...inputSt, width: 170, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }} />
                                  <input value={heatReason[l.id] || ''} onChange={e => setHeatReason(p => ({ ...p, [l.id]: e.target.value }))}
                                    placeholder="Reason (required) *"
                                    style={{ ...inputSt, width: 170, fontSize: 11, borderColor: (heatReason[l.id] || '').trim() ? undefined : '#ef4444' }} />
                                </div>
                              )}
                              {Number(actual) > 0 && (
                                <button onClick={() => startSplit(l)}
                                  style={{ marginTop: 6, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11, padding: 0, fontFamily: 'inherit' }}>
                                  ⊕ Split across heats
                                </button>
                              )}
                            </>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span style={{ fontSize: 11, color: sub }}>{subs.length} heat{subs.length !== 1 ? 's' : ''} (see below)</span>
                              <button onClick={() => endSplit(l.id)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11, padding: 0, fontFamily: 'inherit', textAlign: 'left' }}>
                                ✕ Unsplit
                              </button>
                            </div>
                          )}
                        </td>
                        {anyIssue && (
                          <td style={{ padding: '8px 12px' }}>
                            <select value={discrepancyTypes[l.id] || ''}
                              onChange={e => setDiscrepancyTypes(prev => ({ ...prev, [l.id]: e.target.value }))}
                              style={{ ...inputSt, width: 160, padding: '5px 8px' }}
                              disabled={clean}>
                              <option value="">{clean ? '— no issue' : 'Select type…'}</option>
                              {DISC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                        )}
                      </tr>
                      {/* ── Heat/Lot P2b — sub-line rows for a split PO line ── */}
                      {split && subs.map((s, i) => {
                        const subClean = Number(s.damaged_qty || 0) <= Number(s.received_qty || 0)
                        return (
                          <tr key={`${l.id}-sub-${i}`} style={{ background: dark ? '#0f1626' : '#fafbff', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                            <td style={{ padding: '6px 12px' }} />
                            <td colSpan={4} style={{ padding: '6px 12px 6px 28px', color: sub, fontSize: 11 }}>↳ heat allocation {i + 1}</td>
                            <td style={{ padding: '6px 12px' }}>
                              <input type="number" min={0} value={s.received_qty}
                                onChange={e => updateSub(l.id, i, 'received_qty', Number(e.target.value) || 0)}
                                style={{ ...inputSt, width: 80, textAlign: 'center' }} />
                            </td>
                            <td style={{ padding: '6px 12px' }}>
                              <input type="number" min={0} max={s.received_qty} value={s.damaged_qty}
                                onChange={e => { let v = Number(e.target.value) || 0; if (v > Number(s.received_qty)) v = Number(s.received_qty); updateSub(l.id, i, 'damaged_qty', v) }}
                                style={{ ...inputSt, width: 80, textAlign: 'center', borderColor: !subClean ? '#ef4444' : (Number(s.damaged_qty) > 0 ? '#f59e0b' : undefined) }} />
                            </td>
                            <td style={{ padding: '6px 12px' }}>
                              <button onClick={() => removeSub(l.id, i)} title="Remove this heat allocation"
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>×</button>
                            </td>
                            <td style={{ padding: '6px 12px' }}>
                              <select value={s.heat_off_list ? '__other__' : (s.heat_number || '')}
                                onChange={e => setSubHeat(l.id, i, e.target.value)}
                                style={{ ...inputSt, width: 170, padding: '5px 8px' }}>
                                <option value="">— No heat —</option>
                                {declaredHeats.map((h: any) => (
                                  <option key={h.id} value={h.heat_number}>{h.heat_number}{h.material_grade ? ` · ${h.material_grade}` : ''}</option>
                                ))}
                                <option value="__other__">Other / not listed…</option>
                              </select>
                              {s.heat_off_list && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                                  <input value={s.heat_number} onChange={e => updateSub(l.id, i, 'heat_number', e.target.value)}
                                    placeholder="Heat number"
                                    style={{ ...inputSt, width: 170, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }} />
                                  <input value={s.heat_off_list_reason} onChange={e => updateSub(l.id, i, 'heat_off_list_reason', e.target.value)}
                                    placeholder="Reason (required) *"
                                    style={{ ...inputSt, width: 170, fontSize: 11, borderColor: (s.heat_off_list_reason || '').trim() ? undefined : '#ef4444' }} />
                                </div>
                              )}
                            </td>
                            {anyIssue && <td />}
                          </tr>
                        )
                      })}
                      {split && (
                        <tr key={`${l.id}-add`} style={{ background: dark ? '#0f1626' : '#fafbff', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                          <td />
                          <td colSpan={anyIssue ? 9 : 8} style={{ padding: '4px 12px 8px 28px' }}>
                            <button onClick={() => addSub(l.id)}
                              style={{ background: 'none', border: `1px dashed ${dark ? '#334155' : '#cbd5e1'}`, borderRadius: 6, color: '#2563eb', cursor: 'pointer', fontSize: 11, padding: '4px 10px', fontFamily: 'inherit' }}>
                              + Add heat allocation
                            </button>
                            {!reconciled && (
                              <span style={{ marginLeft: 10, fontSize: 11, color: '#ef4444' }}>
                                Sub-line quantities ({allocated}) must equal the line total ({actual}).
                              </span>
                            )}
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>

              {/* Discrepancy notes — shown live whenever any line has an issue */}
              {anyIssue && (
                <div style={{ marginTop: 14, background: dark ? '#1e1a0a' : '#fffbeb', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '14px 16px' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#d97706', display: 'block', marginBottom: 6 }}>
                    ⚠ Discrepancy notes * — required (with a type on each flagged line) before proceeding
                  </label>
                  <textarea value={discrepancyNotes} onChange={e => setDiscrepancyNotes(e.target.value)}
                    rows={3} placeholder="Describe the discrepancy — this will appear on the GRN"
                    style={{ ...inputSt, resize: 'vertical', borderColor: 'rgba(245,158,11,0.5)' }} />
                </div>
              )}

              <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
                {/* ← Back (left) */}
                <button onClick={goBack}
                  style={{ padding: '8px 18px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 13 }}>
                  ← Back
                </button>
                <div style={{ flex: 1 }} />
                {/* Right-side action — derived live from current values (no latch).
                    Clean → green proceed; any issue → amber proceed gated on type+notes. */}
                {!heatReady && (
                  <span style={{ fontSize: 11, color: '#ef4444', alignSelf: 'center' }}>An off-list heat needs a reason</span>
                )}
                {heatReady && !splitReady && (
                  <span style={{ fontSize: 11, color: '#ef4444', alignSelf: 'center' }}>A split line's heats must reconcile to its total</span>
                )}
                {!anyIssue ? (
                  <button onClick={() => proceed(false)} disabled={!allClean || !heatReady || !splitReady}
                    style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: (allClean && heatReady && splitReady) ? '#22c55e' : '#94a3b8', color: '#fff', cursor: (allClean && heatReady && splitReady) ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}>
                    ✓ All match — proceed
                  </button>
                ) : (
                  <button onClick={() => proceed(true)} disabled={!discrepancyReady || !heatReady || !splitReady}
                    style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: (discrepancyReady && heatReady && splitReady) ? '#f59e0b' : '#94a3b8', color: '#fff', cursor: (discrepancyReady && heatReady && splitReady) ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}>
                    Proceed with discrepancy noted →
                  </button>
                )}
              </div>
            </div>
          )
        })()}

        {/* ── STEP 3 ── Assign location + Back button ── */}
        {step === 3 && (
          <div>
            <p style={{ color: sub, fontSize: 13, marginBottom: 16 }}>Assign a warehouse grid location for the received items.</p>
            <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 20 }}>
              <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 8, fontWeight: 600 }}>Grid location</label>
              <input value={location} onChange={e => setLocation(e.target.value)}
                placeholder="e.g. WH-B · B-02-01"
                style={{ ...inputSt, fontSize: 14 }} />
              <div style={{ fontSize: 11, color: sub, marginTop: 4 }}>Format: WH-[code] · [row]-[bay]-[level]</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {SUGGESTED_LOCS.map(l => (
                  <button key={l}
                    onClick={() => setLocation(l)}
                    style={{ padding: '5px 12px', borderRadius: 6, border: bd, background: location === l ? 'rgba(37,99,235,0.08)' : 'none', color: location === l ? '#2563eb' : col, cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* ← Back (left, preserves actuals + discrepancy data) */}
              <button onClick={goBack}
                style={{ padding: '8px 18px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 13 }}>
                ← Back
              </button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setStep(4)} disabled={!location.trim()}
                style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: location.trim() ? '#2563eb' : '#94a3b8', color: '#fff', cursor: location.trim() ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}>
                Next → TCCC sign-off →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4 ── */}
        {step === 4 && (
          <div>
            <p style={{ color: sub, fontSize: 13, marginBottom: 16 }}>Both the Materials Controller and the carrier must sign off to close the SCN.</p>

            {/* SCN summary card */}
            <div style={{ background: dark ? '#1e3a5f' : '#1e3a5f', borderRadius: 8, padding: '14px 18px', marginBottom: 20, color: '#fff' }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>QMAT · PROOF OF DELIVERY</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{scn.scn_ref}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', marginTop: 12, fontSize: 12 }}>
                {[
                  ['PO REF', scn.po_ref || '—'],
                  ['VENDOR', scn.vendor_name || '—'],
                  ['ORIGIN', scn.origin_location || '—'],
                  ['DESTINATION', scn.destination_name || '—'],
                  ['PACKAGES', String(scn.total_packages || (detail?.packages || []).length)],
                  ['TOTAL WEIGHT', scn.total_weight_kg ? `${scn.total_weight_kg} t` : '—'],
                ].map(([k, v]) => (
                  <div key={k}><div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{k}</div><div style={{ color: '#fff' }}>{v}</div></div>
                ))}
              </div>
            </div>

            {/* Actual packages received */}
            <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: col, marginBottom: 8 }}>Line items received</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: col }}>{Object.keys(actuals).length}</div>
                <div style={{ fontSize: 12, color: sub }}>Expected: {(detail?.lines || []).length} line items</div>
              </div>
            </div>

            {/* Cargo condition */}
            <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: col, marginBottom: 10 }}>Cargo condition</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['Good','Minor damage','Major damage','Other'].map(c => {
                  const val = c.toLowerCase().replace(' ', '_')
                  return (
                    <button key={c} onClick={() => setCargo(val)}
                      style={{ padding: '8px 16px', borderRadius: 6, border: bd, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
                        background: cargoCondition === val ? (c === 'Good' ? '#22c55e' : c === 'Minor damage' ? '#f59e0b' : c === 'Major damage' ? '#ef4444' : '#94a3b8') : 'none',
                        color: cargoCondition === val ? '#fff' : col,
                        borderColor: cargoCondition === val ? 'transparent' : undefined,
                      }}>
                      {c}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Notes */}
            <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: col, marginBottom: 8 }}>Notes (optional)</div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Any observations, damage notes, or exceptions…"
                style={{ ...inputSt, resize: 'vertical' }} />
            </div>

            {/* MC sign-off */}
            <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>MC Sign-off</div>
              <div style={{ fontSize: 13, color: col, marginBottom: 12 }}>Materials Controller confirms goods received</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Full name</label><input placeholder="Name" style={inputSt} /></div>
                <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Company</label><input placeholder="Company" style={inputSt} /></div>
              </div>
              <div style={{ height: 80, border: `2px dashed ${dark ? '#334155' : '#cbd5e1'}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: sub, fontSize: 12, marginBottom: 8 }}>
                ✍ Tap to draw signature
              </div>
              <button style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12 }}>Confirm signature</button>
              <div style={{ fontSize: 11, color: sub, marginTop: 8 }}>— or —</div>
              <button style={{ fontSize: 12, color: '#2563eb', background: 'none', border: bd, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', marginTop: 6 }}>↑ Upload signed document (PDF / image)</button>
            </div>

            {/* Carrier sign-off */}
            <div style={{ background: cardBg, border: bd, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Carrier / Driver Signature</div>
              <div style={{ fontSize: 13, color: col, marginBottom: 12 }}>Carrier confirms delivery of stated goods</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Full name</label><input placeholder="Name" style={inputSt} /></div>
                <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Company</label><input placeholder="Company" style={inputSt} /></div>
              </div>
              <div style={{ height: 80, border: `2px dashed ${dark ? '#334155' : '#cbd5e1'}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: sub, fontSize: 12, marginBottom: 8 }}>
                ✍ Tap to draw signature
              </div>
              <button style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12 }}>Confirm signature</button>
              <div style={{ fontSize: 11, color: sub, marginTop: 8 }}>— or —</div>
              <button style={{ fontSize: 12, color: '#2563eb', background: 'none', border: bd, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', marginTop: 6 }}>↑ Upload signed document (PDF / image)</button>
            </div>

            <div style={{ fontSize: 11, color: sub, marginBottom: 12 }}>Timestamp set by server — device time is not used</div>
            {/* Step 4: Back (left) + Complete TCCC (right) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={goBack}
                style={{ padding: '10px 20px', borderRadius: 8, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 13 }}>
                ← Back
              </button>
              <button onClick={completeReceipt} disabled={saving || !cargoCondition}
                title="TCCC — Transfer of Custody, Care & Control"
                style={{ flex: 1, padding: '12px', borderRadius: 8, border: 'none', background: cargoCondition ? '#2563eb' : '#94a3b8', color: '#fff', cursor: cargoCondition ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 700 }}>
                {saving ? 'Processing…' : 'Complete TCCC sign-off'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 5 — Complete (no Back — receipt is final) ── */}
        {step === 5 && (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            {/* Discrepancy banner if flagged */}
            {hasDiscrepancy && (
              <div style={{ textAlign: 'left', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '12px 16px', marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#d97706', marginBottom: 6 }}>⚠ Discrepancy flagged — QC review required</div>
                <div style={{ fontSize: 12, color: col }}>{discrepancyNotes}</div>
                {Object.entries(discrepancyTypes).filter(([,v]) => v).map(([lineId, type]) => (
                  <div key={lineId} style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Line {lineId}: {type}</div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
            <h2 style={{ color: col, marginBottom: 8 }}>Receipt complete</h2>
            <p style={{ color: col === '#f1f5f9' ? '#94a3b8' : '#64748b', marginBottom: 8 }}>Stock has been created in the warehouse register.</p>
            <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 32 }}>
              SCN <span style={{ fontFamily: 'JetBrains Mono, monospace', color: col }}>{scn.scn_ref}</span> is now closed. Location: <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#22c55e' }}>{location}</span>
            </p>
            <button onClick={onComplete}
              style={{ padding: '10px 28px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
              ← Back to Receipting register
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export const MCReceiptingScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider><MCReceiptingInner {...props} /></ToastProvider>
)
