// ─── MC RECEIPTING SCREEN ─────────────────────────────────────
// Pending Receipt register — inbound SCNs awaiting goods-in.
// 6 tabs: All · Arrived · In Transit · Customs · Shipments · Transfers
// Click "Receipt →" on Arrived rows → 5-step Receipting Wizard.
import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'

const API = 'http://localhost:3001/api'

type Tab = 'all' | 'arrived' | 'in_transit' | 'customs' | 'shipments' | 'transfers'
type WizardStep = 1 | 2 | 3 | 4 | 5

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
  }
  return m[s] || { label: s, bg: 'rgba(148,163,184,0.1)', color: '#64748b' }
}

// ─── INNER COMPONENT ──────────────────────────────────────────
const MCReceiptingInner = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const { addToast } = useToast()
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
          <BackButton onClick={onBack} dark={dark} />
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
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
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
                  const isArrived = row.status === 'arrived'
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
const ReceiptingWizard = ({ dark, scn, projectId, onClose, onComplete, addToast }: {
  dark: boolean; scn: SCNRow; projectId: number
  onClose: () => void; onComplete: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const [step, setStep]         = useState<WizardStep>(1)
  const [detail, setDetail]     = useState<any>(null)
  const [actuals, setActuals]   = useState<Record<number, number>>({})
  const [location, setLocation] = useState('')
  const [cargoCondition, setCargo] = useState('')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)

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
        const init: Record<number, number> = {}
        ;(r.data.packages || []).forEach((p: any) => { init[p.id] = p.gross_weight_kg || 1 })
        setActuals(init)
      })
      .catch(() => setDetail({ packages: [], lines: [] }))
  }, [scn.id, projectId]) // eslint-disable-line

  const SUGGESTED_LOCS = ['WH-A · A-04-03', 'WH-B · B-02-05', 'WH-C · C-01-03']

  const completeReceipt = async () => {
    if (!location.trim()) { addToast('error', 'Grid location is required'); return }
    if (!cargoCondition) { addToast('error', 'Cargo condition is required'); return }
    setSaving(true)
    try {
      await axios.post(`${API}/mc/${projectId}/receipting/${scn.id}/complete`, {
        location_code: location.trim(), cargo_condition: cargoCondition, notes, actual_packages: Object.values(actuals).length,
        warehouse_id: scn.destination_warehouse_id,
      })
      setStep(5)
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to complete receipt')
    } finally { setSaving(false) }
  }

  const STEPS = ['Review expected','Physical check','Assign location','TCCC sign-off','Complete']

  return (
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
                  {['PACKAGE','DESCRIPTION','EXP. QTY','UOM','DG'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!detail ? (
                  <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: sub }}>Loading…</td></tr>
                ) : (detail.packages || []).length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: sub }}>No packages recorded for this SCN.</td></tr>
                ) : (detail.packages || []).map((p: any) => (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#E84E0F' }}>PKG-{String(p.package_number || p.id).padStart(3,'0')}</td>
                    <td style={{ padding: '8px 12px', color: col }}>{p.description || 'Package'}</td>
                    <td style={{ padding: '8px 12px', color: col, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{p.gross_weight_kg || 1}</td>
                    <td style={{ padding: '8px 12px', color: sub }}>EA</td>
                    <td style={{ padding: '8px 12px', color: p.is_dangerous_goods ? '#ef4444' : sub }}>{p.is_dangerous_goods ? '⚠️ DG' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ background: dark ? '#162032' : '#f0f9ff', border: bd, borderRadius: 8, padding: '10px 14px', marginTop: 12, display: 'flex', gap: 16, fontSize: 12, color: sub }}>
              <span>{(detail?.packages || []).length} packages</span>
              <span>{scn.total_weight_kg ? `${scn.total_weight_kg} t total` : '—'}</span>
              {scn.eta && <span>ETA {fmt(scn.eta)}</span>}
            </div>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setStep(2)}
                style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Begin inspection →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <div>
            <p style={{ color: sub, fontSize: 13, marginBottom: 16 }}>Enter actual quantities received for each package. Flag any discrepancies.</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: cardBg, border: bd, borderRadius: 8 }}>
              <thead>
                <tr style={{ background: dark ? '#162032' : '#f8fafc', borderBottom: bd }}>
                  {['PACKAGE','DESCRIPTION','EXPECTED','ACTUAL','MATCH'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(detail?.packages || []).map((p: any) => {
                  const expected = p.gross_weight_kg || 1
                  const actual = actuals[p.id] ?? expected
                  const match = actual === expected
                  return (
                    <tr key={p.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                      <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#E84E0F' }}>PKG-{String(p.package_number || p.id).padStart(3,'0')}</td>
                      <td style={{ padding: '8px 12px', color: col }}>{p.description || 'Package'}</td>
                      <td style={{ padding: '8px 12px', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{expected}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="number" value={actual} min={0}
                          onChange={e => setActuals(prev => ({ ...prev, [p.id]: Number(e.target.value) }))}
                          style={{ ...inputSt, width: 80, textAlign: 'center' }} />
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ color: match ? '#22c55e' : '#ef4444', fontSize: 16 }}>{match ? '✓' : '✗'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(3)}
                style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, flex: 1 }}>
                ✓ All match — proceed
              </button>
              <button onClick={() => setStep(3)}
                style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid #ef4444', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 600, flex: 1 }}>
                ⚠ Flag discrepancy
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3 ── */}
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
                  <button key={l} onClick={() => setLocation(l)}
                    style={{ padding: '5px 12px', borderRadius: 6, border: bd, background: location === l ? 'rgba(37,99,235,0.08)' : 'none', color: location === l ? '#2563eb' : col, cursor: 'pointer', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => location.trim() && setStep(4)} disabled={!location.trim()}
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
              <div style={{ fontSize: 12, fontWeight: 600, color: col, marginBottom: 8 }}>Actual packages received</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: col }}>{Object.keys(actuals).length}</div>
                <div style={{ fontSize: 12, color: sub }}>Expected: {(detail?.packages || []).length} packages</div>
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
            <button onClick={completeReceipt} disabled={saving || !cargoCondition}
              title="TCCC — Transfer of Custody, Care & Control"
              style={{ width: '100%', padding: '12px', borderRadius: 8, border: 'none', background: cargoCondition ? '#2563eb' : '#94a3b8', color: '#fff', cursor: cargoCondition ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 700 }}>
              {saving ? 'Processing…' : 'Complete TCCC sign-off'}
            </button>
          </div>
        )}

        {/* ── STEP 5 ── */}
        {step === 5 && (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
            <h2 style={{ color: col, marginBottom: 8 }}>Receipt complete</h2>
            <p style={{ color: sub, marginBottom: 8 }}>Stock has been created in the warehouse register.</p>
            <p style={{ color: sub, fontSize: 12, marginBottom: 32 }}>
              SCN <span style={{ fontFamily: 'JetBrains Mono, monospace', color: col }}>{scn.scn_ref}</span> is now closed. Location: <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#22c55e' }}>{location}</span>
            </p>
            <button onClick={onComplete}
              style={{ padding: '10px 28px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
              ← Back to Receipting register
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export const MCReceiptingScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider><MCReceiptingInner {...props} /></ToastProvider>
)
