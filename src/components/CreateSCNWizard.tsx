// ─── CREATE SCN WIZARD ────────────────────────────────────────
// 5-step modal wizard: select PO lines → SCN details → packages
// → documents → confirm + create. Submits to POST /api/expediting/:pid/scn.
import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
// useToast is NOT used here — wizard renders in a portal outside ToastProvider.
// Success/error feedback is handled by the parent via onCreated/onError props.

const API = 'http://localhost:3001/api'

// ─── TYPES ────────────────────────────────────────────────────
interface Props {
  poId: number
  projectId: number
  preSelectedLineId?: number
  onClose: () => void
  onCreated: (scn: any) => void
  onToast?: (message: string, type: 'success' | 'error') => void
}

type Step = 1 | 2 | 3 | 4 | 5 | 6

interface SelectedLineVal { checked: boolean; qty: string }
interface AdditionalItem  { desc: string; qty: string; uom: string; parentLineId: string } // parentLineId REQUIRED — off-PO variation must name its parent PO line
interface PackageRow {
  type: string; customType?: string; qty: string
  length: string; width: string; height: string; weight: string
  is_dg: boolean
}
// Heat/Lot P1: one declared heat for the shipment (heat_number required; grade/cert optional).
interface HeatRow { heat_number: string; grade: string; cert: string }

// ─── CONSTANTS ────────────────────────────────────────────────
const STEP_LABELS = ['Select lines', 'SCN details', 'Packages', 'Heats', 'Documents', 'Confirm']

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
const PKG_TYPES = ['Crate (timber)', 'Crate (steel)', 'Pallet', 'Drum', 'Carton', 'Bundle', 'Skid', 'IBC', 'Loose', 'Bag', 'Others']
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
  poId, projectId, preSelectedLineId, onClose, onCreated, onToast,
}) => {

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
  // Child lines (expediting_child_items) selected to ship — keyed by child id. Each
  // carries its parent PO line so it can be sent as a linked off-PO variation on create.
  const [selectedChildren, setSelectedChildren] = useState<Record<number, { checked: boolean; qty: string; description: string; uom: string; parentLineId: number }>>({})

  // ─── STEP 2: SCN details ──────────────────────────────────
  const [pickupLocation, setPickupLocation]   = useState('')
  const [warehouseId, setWarehouseId]         = useState<number | ''>('')
  const [gridBay, setGridBay]                 = useState('')
  const [cdd, setCdd]                         = useState('')
  const [crd, setCrd]                         = useState('') // Cargo Ready Date
  const [ccd, setCcd]                         = useState('') // Cargo Collection Date
  const [etd, setEtd]                         = useState('')
  const [eta, setEta]                         = useState('')
  const [transportMode, setTransportMode]     = useState('')
  const [transportError, setTransportError]   = useState('')
  const [forwarder, setForwarder]             = useState('')
  const [incoterms, setIncoterms]             = useState('')

  // ─── STEP 3: Packages ─────────────────────────────────────
  const [packages, setPackages] = useState<PackageRow[]>([])

  // ─── STEP 4: Heats (Heat/Lot P1) ──────────────────────────
  const [heats, setHeats] = useState<HeatRow[]>([])

  // ─── STEP 5: Documents ────────────────────────────────────
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
        // ── Inherit CDD from the PO line(s) — earliest line CDD, else the PO's
        // contract delivery date. The user no longer has to type it (still editable). ──
        const lineCdds = (data.po_lines || []).map((l: any) => l.cdd).filter(Boolean).sort()
        const inheritedCdd = lineCdds[0] || data.contract_delivery_date || null
        if (inheritedCdd) setCdd(String(inheritedCdd).slice(0, 10))
        // Pre-fill pickup from the supplier's primary address (supplier_addresses).
        const primaryAddr = (data.supplier_addresses || [])[0]
        if (primaryAddr?.label) setPickupLocation(String(primaryAddr.label))
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
  // ─── CHILD LINE SELECTION (expediting_child_items) ────────
  const toggleChild = (child: any, parentLineId: number) => {
    setSelectedChildren(prev => {
      if (prev[child.id]?.checked) { const next = { ...prev }; delete next[child.id]; return next }
      return { ...prev, [child.id]: { checked: true, qty: String(child.qty || 1), description: child.description || `Sub-item ${child.sub_number}`, uom: child.uom || 'EA', parentLineId } }
    })
  }
  const updateChildQty = (childId: number, val: string) =>
    setSelectedChildren(prev => ({ ...prev, [childId]: { ...prev[childId], qty: val } }))
  const countSelected = () =>
    Object.values(selectedLines).filter(v => v.checked).length +
    additionalItems.filter(i => i.desc.trim()).length +
    Object.values(selectedChildren).filter(v => v.checked).length

  // ─── ADDITIONAL ITEMS ─────────────────────────────────────
  const addAdditional = () =>
    setAdditionalItems(prev => [...prev, { desc: '', qty: '1', uom: 'EA', parentLineId: '' }])
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

  // ─── HEATS (Heat/Lot P1) ──────────────────────────────────
  const addHeat = () =>
    setHeats(prev => [...prev, { heat_number: '', grade: '', cert: '' }])
  const updateHeat = (i: number, field: keyof HeatRow, val: string) =>
    setHeats(prev => prev.map((h, idx) => idx === i ? { ...h, [field]: val } : h))
  const removeHeat = (i: number) =>
    setHeats(prev => prev.filter((_, idx) => idx !== i))

  // ─── NAVIGATION GUARDS ────────────────────────────────────
  const canNext =
    step === 1 ? countSelected() > 0
    : step === 2 ? !!transportMode
    : true

  // ─── SUBMIT ───────────────────────────────────────────────
  // Posts SCN to backend; shows toast and calls parent callback.
  const handleCreate = async () => {
    // Off-PO VARIATIONS (Commit 3 UI): each must name a parent PO line + description.
    // Legacy unlinked additional_items path is retired — we no longer send additional_items
    // in the create body; instead we POST each variation to /scn/:id/variation after the SCN exists.
    // Selected child lines ship as linked off-PO variations (parent = their PO line).
    const childVariations: AdditionalItem[] = Object.values(selectedChildren)
      .filter(c => c.checked)
      .map(c => ({ desc: c.description, qty: c.qty, uom: c.uom, parentLineId: String(c.parentLineId) }))
    const variations = [...additionalItems.filter(i => i.desc.trim() || i.parentLineId), ...childVariations]
    for (const v of variations) {
      if (!v.parentLineId) { onToast?.('Each off-PO variation must select a parent PO line.', 'error'); return }
      if (!v.desc.trim())  { onToast?.('Each off-PO variation needs a description.', 'error'); return }
    }
    setCreating(true)
    try {
      const body = {
        po_id: poId,
        selected_lines: Object.entries(selectedLines)
          .filter(([, v]) => v.checked)
          .map(([id, v]) => ({ po_line_id: Number(id), qty_allocated: Number(v.qty) || 1 })),
        pickup_location: pickupLocation || null,
        destination_warehouse_id: warehouseId || null,
        grid_bay: gridBay || null,
        cdd: cdd || null,
        crd: crd || null,
        ccd: ccd || null,
        etd: etd || null,
        eta: eta || null,
        transport_mode: transportMode || null,
        forwarder_name: forwarder || null,
        incoterms: incoterms || null,
        // "Others" → send the user-defined type as the package type.
        packages: packages.map(p => ({ ...p, type: p.type === 'Others' ? ((p.customType || '').trim() || 'Other') : p.type })),
        // Heat/Lot P1: declared heats for this shipment (optional — empty is fine).
        heats: heats
          .filter(h => h.heat_number.trim())
          .map(h => ({
            heat_number: h.heat_number.trim(),
            material_grade: h.grade.trim() || null,
            mill_cert_ref: h.cert.trim() || null,
          })),
        notify_forwarder: notifyForwarder,
      }
      const { data } = await axios.post(`${API}/expediting/${projectId}/scn`, body)
      // Two-phase: create the SCN, then add each off-PO variation (linked + audited) to it.
      for (const v of variations) {
        await axios.post(`${API}/expediting/${projectId}/scn/${data.id}/variation`, {
          parent_po_line_id: Number(v.parentLineId), description: v.desc.trim(),
          qty: Number(v.qty) || 1, uom: v.uom,
        })
      }
      onToast?.(`${data.scn_ref} created successfully${variations.length ? ` (+${variations.length} off-PO variation${variations.length > 1 ? 's' : ''})` : ''}`, 'success')
      onCreated(data)
    } catch (e: any) {
      onToast?.(e.response?.data?.error || 'Failed to create SCN', 'error')
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

              {/* Child lines (expediting_child_items) created on the PO detail screen —
                  selectable here so they ship on this SCN as linked off-PO variations. */}
              {Array.isArray(line.child_items) && line.child_items.length > 0 && (
                <div style={{ marginLeft: 26, marginTop: 8, borderTop: '1px dashed #e2e8f0', paddingTop: 8 }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>Child lines</div>
                  {line.child_items.map((ch: any) => {
                    const cs = selectedChildren[ch.id]
                    return (
                      <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', flex: 1 }}>
                          <input type="checkbox" checked={!!cs?.checked} onChange={() => toggleChild(ch, line.id)} style={{ accentColor: '#7c3aed', flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: '#475569' }}>
                            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#7c3aed', fontWeight: 600 }}>{line.line_number}.{ch.sub_number}</span>
                            {' '}{ch.description || '—'}
                            <span style={{ color: '#94a3b8' }}> · {Number(ch.qty) || 0} {ch.uom || ''}</span>
                          </span>
                        </label>
                        {cs?.checked && (
                          <input type="number" value={cs.qty} min={1} onChange={e => updateChildQty(ch.id, e.target.value)}
                            style={{ ...inputStyle, width: 70, padding: '4px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
                        )}
                      </div>
                    )
                  })}
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
              ⚠ Off-PO variations · each must link to a parent PO line
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
                  <select
                    value={item.parentLineId}
                    onChange={e => updateAdditional(i, 'parentLineId', e.target.value)}
                    title="Parent PO line (required)"
                    style={{ ...inputStyle, width: 200, borderColor: item.parentLineId ? undefined : '#f59e0b' }}
                  >
                    <option value="">— parent PO line (required) —</option>
                    {(po?.po_lines || []).map((l: any) => (
                      <option key={l.id} value={l.id}>{l.line_number} · {(l.description || '').slice(0, 40)}</option>
                    ))}
                  </select>
                  <input
                    value={item.desc}
                    onChange={e => updateAdditional(i, 'desc', e.target.value)}
                    placeholder="Variation description (e.g. specialised crate for P-101)"
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
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Pickup location <span style={{ color: '#94a3b8', fontWeight: 400 }}>· {po?.vendor_display || 'supplier'} address</span></label>
          {(po?.supplier_addresses?.length ?? 0) > 0 ? (
            <select
              value={pickupLocation}
              onChange={e => setPickupLocation(e.target.value)}
              style={{ ...inputStyle, width: '100%' }}
            >
              <option value="">— Select supplier pickup address</option>
              {po.supplier_addresses.map((a: any) => (
                <option key={a.id} value={a.label}>{a.label}{a.is_primary ? ' (primary)' : ''}</option>
              ))}
            </select>
          ) : (
            <input
              value={pickupLocation}
              onChange={e => setPickupLocation(e.target.value)}
              placeholder="Supplier pickup address (none on file — enter manually)"
              style={{ ...inputStyle, width: '100%' }}
            />
          )}
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
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Contract delivery date (CDD) <span style={{ color: '#94a3b8', fontWeight: 400 }}>· from PO line (editable)</span></label>
          <input
            type="date"
            value={cdd}
            onChange={e => setCdd(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>CRD (cargo ready date)</label>
          <input
            type="date"
            value={crd}
            onChange={e => setCrd(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>CCD (cargo collection date)</label>
          <input
            type="date"
            value={ccd}
            onChange={e => setCcd(e.target.value)}
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
              onClick={() => { setTransportMode(m.id); setTransportError('') }}
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
        {/* ─── TRANSPORT ERROR ──────────────────────────────── */}
        {transportError && (
          <p style={{ color: '#ef4444', fontSize: 12, marginTop: 4, marginBottom: 0 }}>
            {transportError}
          </p>
        )}
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
              {pkg.type === 'Others' && (
                <input
                  value={pkg.customType || ''}
                  onChange={e => updatePkg(i, 'customType', e.target.value)}
                  placeholder="Specify package type *"
                  style={{ ...inputStyle, width: '100%', marginTop: 6, borderColor: (pkg.customType || '').trim() ? undefined : '#f59e0b' }}
                />
              )}
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

  // ─── STEP 4: HEATS (Heat/Lot P1) ──────────────────────────
  // Declare the shipment's heat numbers (mill-cert identities). Optional —
  // a shipment may be created before heats are known. These become the source
  // for the receipting heat dropdown (P2), scoped to this SCN.
  const StepHeats = () => (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Heat numbers</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
        Optional — declare the heats on this shipment's packing list / mill certs. They become
        selectable at receipting. Leave empty if not yet known.
      </div>

      {heats.map((h, i) => (
        <div key={i} style={{
          border: '1px solid #dde3ed', borderRadius: 8, padding: '12px 14px', marginBottom: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Heat {i + 1}</span>
            <button onClick={() => removeHeat(i)}
              style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>
                Heat number <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                value={h.heat_number}
                onChange={e => updateHeat(i, 'heat_number', e.target.value)}
                placeholder="e.g. H-48213"
                style={{ ...inputStyle, width: '100%', fontFamily: 'JetBrains Mono, monospace' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Material grade</label>
              <input
                value={h.grade}
                onChange={e => updateHeat(i, 'grade', e.target.value)}
                placeholder="e.g. A516 Gr70"
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Mill cert ref</label>
              <input
                value={h.cert}
                onChange={e => updateHeat(i, 'cert', e.target.value)}
                placeholder="e.g. MTC-2026-0042"
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={addHeat}
        style={{
          width: '100%', padding: '10px',
          border: '1px dashed #2563eb', borderRadius: 8,
          background: 'none', color: '#2563eb',
          cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
        }}
      >
        + Add heat
      </button>
    </div>
  )

  // ─── STEP 5: DOCUMENTS ────────────────────────────────────
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

  // ─── STEP 6: CONFIRM ──────────────────────────────────────
  // Summary of all entered data with notify toggle before final submit.
  const Step5 = () => {
    const selectedLinesList = (po?.po_lines || []).filter((l: any) => selectedLines[l.id]?.checked)
    const addItemsList = additionalItems.filter(i => i.desc.trim())
    const childList = Object.values(selectedChildren).filter(c => c.checked)
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
              Items ({selectedLinesList.length + addItemsList.length + childList.length})
            </div>
            {selectedLinesList.map((l: any) => (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#374151', marginBottom: 4 }}>
                <span>Line {l.line_number} — {l.description}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#64748b' }}>
                  {selectedLines[l.id]?.qty} {l.uom}
                </span>
              </div>
            ))}
            {childList.map((c, i) => {
              const parent = (po?.po_lines || []).find((l: any) => String(l.id) === String(c.parentLineId))
              return (
              <div key={`ch-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#7c3aed', marginBottom: 4 }}>
                <span>↳ Child line — {c.description}{parent ? ` · for: Line ${parent.line_number}` : ''}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8' }}>{c.qty} {c.uom}</span>
              </div>
              )
            })}
            {addItemsList.map((it, i) => {
              const parent = (po?.po_lines || []).find((l: any) => String(l.id) === String(it.parentLineId))
              return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#d97706', marginBottom: 4 }}>
                <span>⚠ Off-PO variation — {it.desc}{parent ? ` · for: Line ${parent.line_number} ${(parent.description || '').slice(0, 30)}` : ''}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8' }}>{it.qty} {it.uom}</span>
              </div>
              )
            })}
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
              <span style={{ color: '#94a3b8' }}>CRD</span><span>{crd || '—'}</span>
              <span style={{ color: '#94a3b8' }}>CCD</span><span>{ccd || '—'}</span>
              <span style={{ color: '#94a3b8' }}>ETD</span><span>{etd || '—'}</span>
              <span style={{ color: '#94a3b8' }}>ETA</span><span>{eta || '—'}</span>
              <span style={{ color: '#94a3b8' }}>Forwarder</span><span>{forwarder || '—'}</span>
              <span style={{ color: '#94a3b8' }}>Incoterms</span><span>{incoterms || '—'}</span>
              {packages.length > 0 && (
                <><span style={{ color: '#94a3b8' }}>Packages</span><span>{packages.length} package{packages.length !== 1 ? 's' : ''}</span></>
              )}
              {heats.filter(h => h.heat_number.trim()).length > 0 && (
                <><span style={{ color: '#94a3b8' }}>Heats</span><span>{heats.filter(h => h.heat_number.trim()).length} heat{heats.filter(h => h.heat_number.trim()).length !== 1 ? 's' : ''}</span></>
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
        {/* Step indicator — call as functions (not <Comp/>) so they inline into THIS
            render tree. Mounting them as components remounts on every keystroke and
            steals input focus, because the function identities change each render. */}
        {StepBar()}

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {!po ? (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading PO data…</div>
          ) : (
            <>
              {step === 1 && Step1()}
              {step === 2 && Step2()}
              {step === 3 && Step3()}
              {step === 4 && StepHeats()}
              {step === 5 && Step4()}
              {step === 6 && Step5()}
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
            {step < 6 ? (
              <button
                onClick={() => {
                  if (step === 2 && !transportMode) {
                    setTransportError('Please select a transport mode to continue')
                    return
                  }
                  setTransportError('')
                  setStep(s => (s + 1) as Step)
                }}
                disabled={step === 1 && !canNext}
                style={{ ...blueBtn, opacity: (step === 1 && !canNext) ? 0.5 : 1, cursor: (step === 1 && !canNext) ? 'not-allowed' : 'pointer' }}
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
