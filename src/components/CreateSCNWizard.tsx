// ─── CREATE SCN WIZARD ────────────────────────────────────────
// 5-step modal wizard: select PO lines → SCN details → packages
// → documents → confirm + create. Submits to POST /api/expediting/:pid/scn.
import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useToast } from '../hooks/useToast'

const API = 'http://localhost:3001/api'

// ─── TYPES ────────────────────────────────────────────────────
interface Props {
  poId: number
  projectId: number
  preSelectedLineId?: number
  onClose: () => void
  onCreated: (scn: any) => void
}

type Step = 1 | 2 | 3 | 4 | 5

interface SelectedLineVal { checked: boolean; qty: string }
interface AdditionalItem  { desc: string; qty: string; uom: string }
interface PackageRow {
  type: string; qty: string
  length: string; width: string; height: string; weight: string
  is_dg: boolean
}

// ─── CONSTANTS ────────────────────────────────────────────────
const STEP_LABELS = ['Select lines', 'SCN details', 'Packages', 'Documents', 'Confirm']

const MODES = [
  { id: 'sea',     label: '🚢 Sea freight' },
  { id: 'air',     label: '✈ Air freight' },
  { id: 'road',    label: '🚚 Road / Truck' },
  { id: 'rail',    label: '🚂 Rail' },
  { id: 'courier', label: '📦 Courier' },
  { id: 'multi',   label: '🔀 Multi-modal' },
]
const INCOTERMS = ['CIF', 'FOB', 'EXW', 'DAP', 'DDP', 'FCA', 'CPT', 'CIP']
const UOM_OPTIONS = ['EA', 'M', 'M²', 'M³', 'KG', 'T', 'LT', 'SET', 'LOT']
const PKG_TYPES = ['Crate (timber)', 'Crate (steel)', 'Pallet', 'Drum', 'Carton', 'Bundle', 'Skid', 'IBC', 'Loose', 'Bag']
const REQUIRED_DOCS = ['Commercial invoice', 'Packing list', 'Bill of Lading / Air Waybill', 'Certificate of Origin', 'Mill test certs (MTC)']
const OPTIONAL_DOCS = ['Inspection release note', 'Insurance certificate']

// ─── STYLE HELPERS ────────────────────────────────────────────
const blueBtn: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  background: '#2563eb', color: '#fff',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const greyBtn: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: '1px solid #dde3ed',
  background: '#fff', color: '#374151',
  fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
}
const greenBtn: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  background: '#16a34a', color: '#fff',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const inputStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 6, border: '1px solid #dde3ed',
  fontSize: 13, fontFamily: 'inherit', background: '#fff', color: '#0f172a',
}

// ─── COMPONENT ────────────────────────────────────────────────
export const CreateSCNWizard: React.FC<Props> = ({
  poId, projectId, preSelectedLineId, onClose, onCreated,
}) => {
  const { addToast } = useToast()

  // ─── WIZARD STEP ──────────────────────────────────────────
  const [step, setStep] = useState<Step>(1)
  const [creating, setCreating] = useState(false)

  // ─── PO DATA ──────────────────────────────────────────────
  const [po, setPO]           = useState<any>(null)
  const [warehouses, setWarehouses] = useState<any[]>([])

  // ─── STEP 1: Line selection ────────────────────────────────
  const [selectedLines, setSelectedLines] = useState<Record<number, SelectedLineVal>>({})
  const [additionalItems, setAdditionalItems] = useState<AdditionalItem[]>([])
  const [showAdditional, setShowAdditional] = useState(false)

  // ─── STEP 2: SCN details ──────────────────────────────────
  const [pickupLocation, setPickupLocation]   = useState('')
  const [warehouseId, setWarehouseId]         = useState<number | ''>('')
  const [gridBay, setGridBay]                 = useState('')
  const [cdd, setCdd]                         = useState('')
  const [etd, setEtd]                         = useState('')
  const [eta, setEta]                         = useState('')
  const [transportMode, setTransportMode]     = useState('')
  const [forwarder, setForwarder]             = useState('')
  const [incoterms, setIncoterms]             = useState('')

  // ─── STEP 3: Packages ─────────────────────────────────────
  const [packages, setPackages] = useState<PackageRow[]>([])

  // ─── STEP 4: Documents ────────────────────────────────────
  // Tracks uploaded file per doc name (stub — no actual upload)
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, File | null>>({})

  // ─── STEP 5: Confirm ──────────────────────────────────────
  const [notifyForwarder, setNotifyForwarder] = useState(true)

  // ─── FETCH PO + WAREHOUSES ────────────────────────────────
  // Loads PO lines and warehouses on mount for steps 1 and 2.
  useEffect(() => {
    axios.get(`${API}/expediting/${projectId}/po/${poId}`)
      .then(r => {
        const data = r.data
        setPO(data)
        // Pre-select line if provided from drawer CTA
        if (preSelectedLineId) {
          const line = (data.po_lines || []).find((l: any) => l.id === preSelectedLineId)
          if (line) {
            const avail = Number(line.qty_available ?? Math.max(0, (line.qty || 0) - (line.qty_assigned || 0)))
            if (avail > 0) {
              setSelectedLines({ [line.id]: { checked: true, qty: String(avail) } })
            }
          }
        }
      })
      .catch(e => console.error('[SCNWizard] PO load', e))

    axios.get(`${API}/expediting/${projectId}/warehouses`)
      .then(r => setWarehouses(r.data))
      .catch(() => {})
  }, [poId, projectId, preSelectedLineId])

  // ─── LINE SELECTION HELPERS ───────────────────────────────
  const toggleLine = (lineId: number, maxQty: number) => {
    setSelectedLines(prev => {
      const cur = prev[lineId]
      if (cur?.checked) {
        const next = { ...prev }; delete next[lineId]; return next
      }
      return { ...prev, [lineId]: { checked: true, qty: String(maxQty) } }
    })
  }
  const updateQty = (lineId: number, val: string) => {
    setSelectedLines(prev => ({ ...prev, [lineId]: { ...prev[lineId], qty: val } }))
  }
  const countSelected = () =>
    Object.values(selectedLines).filter(v => v.checked).length +
    additionalItems.filter(i => i.desc.trim()).length

  // ─── ADDITIONAL ITEMS ─────────────────────────────────────
  const addAdditional = () =>
    setAdditionalItems(prev => [...prev, { desc: '', qty: '1', uom: 'EA' }])
  const updateAdditional = (i: number, field: keyof AdditionalItem, val: string) =>
    setAdditionalItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))
  const removeAdditional = (i: number) =>
    setAdditionalItems(prev => prev.filter((_, idx) => idx !== i))

  // ─── PACKAGES ─────────────────────────────────────────────
  const addPackage = () =>
    setPackages(prev => [...prev, { type: 'Pallet', qty: '1', length: '', width: '', height: '', weight: '', is_dg: false }])
  const updatePkg = (i: number, field: keyof PackageRow, val: any) =>
    setPackages(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  const removePkg = (i: number) =>
    setPackages(prev => prev.filter((_, idx) => idx !== i))

  // ─── NAVIGATION GUARDS ────────────────────────────────────
  const canNext =
    step === 1 ? countSelected() > 0
    : step === 2 ? !!transportMode
    : true

  // ─── SUBMIT ───────────────────────────────────────────────
  // Posts SCN to backend; shows toast and calls parent callback.
  const handleCreate = async () => {
    setCreating(true)
    try {
      const body = {
        po_id: poId,
        selected_lines: Object.entries(selectedLines)
          .filter(([, v]) => v.checked)
          .map(([id, v]) => ({ po_line_id: Number(id), qty_allocated: Number(v.qty) || 1 })),
        additional_items: additionalItems
          .filter(i => i.desc.trim())
          .map(i => ({ description: i.desc, qty: Number(i.qty) || 1, uom: i.uom })),
        pickup_location: pickupLocation || null,
        destination_warehouse_id: warehouseId || null,
        grid_bay: gridBay || null,
        cdd: cdd || null,
        etd: etd || null,
        eta: eta || null,
        transport_mode: transportMode || null,
        forwarder_name: forwarder || null,
        incoterms: incoterms || null,
        packages,
        notify_forwarder: notifyForwarder,
      }
      const { data } = await axios.post(`${API}/expediting/${projectId}/scn`, body)
      addToast('success', `${data.scn_ref} created successfully`)
      onCreated(data)
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to create SCN')
    } finally {
      setCreating(false)
    }
  }

  // ─── STEP INDICATOR ───────────────────────────────────────
  // Renders numbered circles with connecting lines for progress.
  const StepBar = () => (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '16px 24px',
      borderBottom: '1px solid #e2e8f0', background: '#fff', flexShrink: 0,
    }}>
      {STEP_LABELS.map((label, idx) => {
        const n = idx + 1 as Step
        const done   = n < step
        const active = n === step
        return (
          <React.Fragment key={n}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: done ? '#16a34a' : active ? '#2563eb' : '#f1f5f9',
                color: done || active ? '#fff' : '#94a3b8',
                border: active ? '2px solid #2563eb' : 'none',
              }}>
                {done ? '✓' : n}
              </div>
              <span style={{
                fontSize: 10, color: active ? '#2563eb' : done ? '#16a34a' : '#94a3b8',
                fontWeight: active ? 600 : 400, whiteSpace: 'nowrap',
              }}>
                {label}
              </span>
            </div>
            {idx < STEP_LABELS.length - 1 && (
              <div style={{
                flex: 1, height: 2, margin: '0 4px', marginBottom: 18,
                background: n < step ? '#16a34a' : '#e2e8f0',
              }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )

  // ─── STEP 1: SELECT LINES ─────────────────────────────────
  // Check PO lines with available qty; optionally add non-PO items.
  const Step1 = () => {
    const lines = (po?.po_lines || []).filter((l: any) => {
      const avail = Number(l.qty_available ?? Math.max(0, (l.qty || 0) - (l.qty_assigned || 0)))
      return avail > 0
    })
    return (
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Select items to ship</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          PO: <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#E84E0F' }}>{po?.po_number}</span> — {po?.vendor_display}
        </div>

        {lines.length === 0 && (
          <div style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic', marginBottom: 16 }}>
            No lines with available quantity. Add additional items below.
          </div>
        )}

        {lines.map((line: any) => {
          const qtyTotal    = Number(line.qty || 0)
          const qtyAssigned = Number(line.qty_assigned || 0)
          const avail = Number(line.qty_available ?? Math.max(0, qtyTotal - qtyAssigned))
          const sel   = selectedLines[line.id]
          return (
            <div key={line.id} style={{
              border: `1px solid ${sel?.checked ? '#2563eb' : '#dde3ed'}`,
              borderRadius: 8, padding: '12px 14px', marginBottom: 8,
              background: sel?.checked ? 'rgba(37,99,235,0.04)' : '#fff',
            }}>
              <label style={{ display: 'flex', gap: 10, cursor: 'pointer', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={!!sel?.checked}
                  onChange={() => toggleLine(line.id, avail)}
                  style={{ accentColor: '#2563eb', marginTop: 2, flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: '#0f172a', fontSize: 13 }}>{line.description}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    Line {line.line_number}
                    {line.wbs_code_snapshot ? ` · ${line.wbs_code_snapshot}` : ''}
                    {' · '}Total {qtyTotal} {line.uom} · {qtyAssigned} assigned · {avail} {line.uom} available
                  </div>
                </div>
              </label>
              {sel?.checked && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginLeft: 26 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Qty:</span>
                  <input
                    type="number"
                    value={sel.qty}
                    min={1}
                    max={avail}
                    onChange={e => updateQty(line.id, e.target.value)}
                    style={{
                      ...inputStyle,
                      width: 80, padding: '4px 8px',
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                    }}
                  />
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{line.uom} / {avail} max</span>
                </div>
              )}
            </div>
          )
        })}

        {/* Additional items (not on PO) */}
        <div style={{
          border: '1px dashed #f59e0b', borderRadius: 8, padding: '12px 14px', marginTop: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Additional items · not on PO
            </span>
            <button
              onClick={() => setShowAdditional(v => !v)}
              style={{ background: 'none', border: 'none', color: '#d97706', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {showAdditional ? 'Hide ▲' : 'Show ▼'}
            </button>
          </div>
          {showAdditional && (
            <>
              {additionalItems.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <input
                    value={item.desc}
                    onChange={e => updateAdditional(i, 'desc', e.target.value)}
                    placeholder="Item description (e.g. spare gasket set)"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <input
                    type="number"
                    value={item.qty}
                    onChange={e => updateAdditional(i, 'qty', e.target.value)}
                    style={{ ...inputStyle, width: 70 }}
                    min={1}
                  />
                  <select
                    value={item.uom}
                    onChange={e => updateAdditional(i, 'uom', e.target.value)}
                    style={{ ...inputStyle, width: 80 }}
                  >
                    {UOM_OPTIONS.map(u => <option key={u}>{u}</option>)}
                  </select>
                  <button
                    onClick={() => removeAdditional(i)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={addAdditional}
                style={{
                  width: '100%', marginTop: 8, padding: '8px',
                  border: '1px dashed #f59e0b', borderRadius: 6,
                  background: 'none', color: '#d97706', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                }}
              >
                + Add additional item
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ─── STEP 2: SCN DETAILS ──────────────────────────────────
  // Pickup, destination, transport mode cards, forwarder, dates.
  const Step2 = () => (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Shipment details</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Pickup location / supplier address</label>
          <input
            value={pickupLocation}
            onChange={e => setPickupLocation(e.target.value)}
            placeholder="e.g. Shanghai, China"
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Destination warehouse</label>
          <select
            value={warehouseId}
            onChange={e => setWarehouseId(Number(e.target.value) || '')}
            style={{ ...inputStyle, width: '100%' }}
          >
            <option value="">— Select warehouse</option>
            {warehouses.map((w: any) => (
              <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Grid / Bay ref</label>
          <input
            value={gridBay}
            onChange={e => setGridBay(e.target.value)}
            placeholder="e.g. A-12"
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Contract delivery date (CDD)</label>
          <input
            type="date"
            value={cdd}
            onChange={e => setCdd(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>ETD (est. departure)</label>
          <input
            type="date"
            value={etd}
            onChange={e => setEtd(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>ETA (est. arrival)</label>
          <input
            type="date"
            value={eta}
            onChange={e => setEta(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
      </div>

      {/* Transport mode cards */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Transport mode <span style={{ color: '#ef4444' }}>*</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setTransportMode(m.id)}
              style={{
                padding: '12px 16px', borderRadius: 8, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12, textAlign: 'left',
                border: transportMode === m.id ? '2px solid #2563eb' : '1px solid #dde3ed',
                background: transportMode === m.id ? 'rgba(37,99,235,0.06)' : '#fff',
                color: transportMode === m.id ? '#1d4ed8' : '#374151',
                fontWeight: transportMode === m.id ? 600 : 400,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Forwarder name</label>
          <input
            value={forwarder}
            onChange={e => setForwarder(e.target.value)}
            placeholder="e.g. Toll Group"
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Incoterms</label>
          <select
            value={incoterms}
            onChange={e => setIncoterms(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
          >
            <option value="">— Select</option>
            {INCOTERMS.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
    </div>
  )

  // ─── STEP 3: PACKAGES ─────────────────────────────────────
  // Add one or more package rows with dimensions and weight.
  const Step3 = () => (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Packages</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
        Optional — add package details for freight booking.
      </div>

      {packages.map((pkg, i) => (
        <div key={i} style={{
          border: '1px solid #dde3ed', borderRadius: 8, padding: '14px 16px', marginBottom: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Package {i + 1}</span>
            <button onClick={() => removePkg(i)}
              style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Type</label>
              <select
                value={pkg.type}
                onChange={e => updatePkg(i, 'type', e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              >
                {PKG_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Qty</label>
              <input
                type="number" min={1}
                value={pkg.qty}
                onChange={e => updatePkg(i, 'qty', e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            {(['length', 'width', 'height'] as const).map(dim => (
              <div key={dim}>
                <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3, textTransform: 'capitalize' }}>
                  {dim} (cm)
                </label>
                <input
                  type="number" min={0}
                  value={pkg[dim]}
                  onChange={e => updatePkg(i, dim, e.target.value)}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
            ))}
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Weight (kg)</label>
              <input
                type="number" min={0}
                value={pkg.weight}
                onChange={e => updatePkg(i, 'weight', e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={pkg.is_dg}
              onChange={e => updatePkg(i, 'is_dg', e.target.checked)}
              style={{ accentColor: '#ef4444' }}
            />
            Dangerous goods (DG)
          </label>
        </div>
      ))}

      <button
        onClick={addPackage}
        style={{
          width: '100%', padding: '10px',
          border: '1px dashed #2563eb', borderRadius: 8,
          background: 'none', color: '#2563eb',
          cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
        }}
      >
        + Add package
      </button>
    </div>
  )

  // ─── STEP 4: DOCUMENTS ────────────────────────────────────
  // Shows required and optional doc rows with upload stubs.
  const Step4 = () => (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Supporting documents</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
        Attach documents before final confirmation. Required docs must be uploaded before goods can be released.
      </div>

      {/* Info banner */}
      <div style={{
        background: '#eff6ff', border: '1px solid #bfdbfe',
        borderRadius: 8, padding: '10px 14px', marginBottom: 16,
        fontSize: 12, color: '#1d4ed8',
      }}>
        ℹ Documents are not uploaded here — you will be able to attach them from the SCN detail view after creation.
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Required
      </div>
      {REQUIRED_DOCS.map(doc => (
        <div key={doc} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', border: '1px solid #dde3ed', borderRadius: 6,
          marginBottom: 6, background: '#fff',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 10, padding: '1px 7px', borderRadius: 9999, fontWeight: 600,
              background: 'rgba(239,68,68,0.1)', color: '#dc2626',
            }}>REQ</span>
            <span style={{ fontSize: 13, color: '#374151' }}>{doc}</span>
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>
        </div>
      ))}

      <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Optional
      </div>
      {OPTIONAL_DOCS.map(doc => (
        <div key={doc} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', border: '1px solid #dde3ed', borderRadius: 6,
          marginBottom: 6, background: '#fff',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 10, padding: '1px 7px', borderRadius: 9999, fontWeight: 600,
              background: 'rgba(148,163,184,0.12)', color: '#64748b',
            }}>OPT</span>
            <span style={{ fontSize: 13, color: '#374151' }}>{doc}</span>
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>
        </div>
      ))}
    </div>
  )

  // ─── STEP 5: CONFIRM ──────────────────────────────────────
  // Summary of all entered data with notify toggle before final submit.
  const Step5 = () => {
    const selectedLinesList = (po?.po_lines || []).filter((l: any) => selectedLines[l.id]?.checked)
    const addItemsList = additionalItems.filter(i => i.desc.trim())
    const warehouseName = warehouses.find((w: any) => w.id === warehouseId)?.name || '—'
    const modeName = MODES.find(m => m.id === transportMode)?.label || '—'

    return (
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Confirm SCN</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Review details before creating the shipment control note.</div>

        <div style={{ border: '1px solid #dde3ed', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
          {/* Items */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Items ({selectedLinesList.length + addItemsList.length})
            </div>
            {selectedLinesList.map((l: any) => (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#374151', marginBottom: 4 }}>
                <span>Line {l.line_number} — {l.description}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#64748b' }}>
                  {selectedLines[l.id]?.qty} {l.uom}
                </span>
              </div>
            ))}
            {addItemsList.map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#d97706', marginBottom: 4 }}>
                <span>+ {it.desc}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8' }}>{it.qty} {it.uom}</span>
              </div>
            ))}
          </div>

          {/* Logistics */}
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Logistics
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 12, color: '#374151' }}>
              <span style={{ color: '#94a3b8' }}>Mode</span><span>{modeName}</span>
              <span style={{ color: '#94a3b8' }}>Origin</span><span>{pickupLocation || '—'}</span>
              <span style={{ color: '#94a3b8' }}>Destination</span><span>{warehouseName}</span>
              <span style={{ color: '#94a3b8' }}>ETD</span><span>{etd || '—'}</span>
              <span style={{ color: '#94a3b8' }}>ETA</span><span>{eta || '—'}</span>
              <span style={{ color: '#94a3b8' }}>Forwarder</span><span>{forwarder || '—'}</span>
              <span style={{ color: '#94a3b8' }}>Incoterms</span><span>{incoterms || '—'}</span>
              {packages.length > 0 && (
                <><span style={{ color: '#94a3b8' }}>Packages</span><span>{packages.length} package{packages.length !== 1 ? 's' : ''}</span></>
              )}
            </div>
          </div>
        </div>

        {/* Notify forwarder toggle */}
        {forwarder && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#374151', cursor: 'pointer', padding: '12px 16px', border: '1px solid #dde3ed', borderRadius: 8 }}>
            <input
              type="checkbox"
              checked={notifyForwarder}
              onChange={e => setNotifyForwarder(e.target.checked)}
              style={{ accentColor: '#2563eb', width: 16, height: 16 }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>Notify forwarder</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Send booking request to {forwarder}</div>
            </div>
          </label>
        )}
      </div>
    )
  }

  // ─── RENDER ───────────────────────────────────────────────
  return createPortal(
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.6)',
      zIndex: 9500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'IBM Plex Sans, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12,
        width: 720, maxWidth: '95vw', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        {/* Step indicator */}
        <StepBar />

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {!po ? (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading PO data…</div>
          ) : (
            <>
              {step === 1 && <Step1 />}
              {step === 2 && <Step2 />}
              {step === 3 && <Step3 />}
              {step === 4 && <Step4 />}
              {step === 5 && <Step5 />}
            </>
          )}
        </div>

        {/* Footer navigation */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e2e8f0',
          display: 'flex', justifyContent: 'space-between',
          background: '#fff', flexShrink: 0,
        }}>
          <button onClick={onClose} style={greyBtn}>Cancel</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 1 && (
              <button onClick={() => setStep(s => (s - 1) as Step)} style={greyBtn}>
                ← Back
              </button>
            )}
            {step < 5 ? (
              <button
                onClick={() => setStep(s => (s + 1) as Step)}
                disabled={!canNext}
                style={{ ...blueBtn, opacity: canNext ? 1 : 0.5, cursor: canNext ? 'pointer' : 'not-allowed' }}
              >
                {step === 1
                  ? `Next — ${countSelected()} item${countSelected() !== 1 ? 's' : ''} →`
                  : 'Next →'}
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={creating}
                style={{ ...greenBtn, opacity: creating ? 0.7 : 1, cursor: creating ? 'not-allowed' : 'pointer' }}
              >
                {creating ? 'Creating…' : '✓ Create SCN'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
