// ─── CREATE SCN WIZARD ────────────────────────────────────────
// 5-step modal wizard: select PO lines → SCN details → packages
// → documents → confirm + create. Submits to POST /api/expediting/:pid/scn.
import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
// useToast is NOT used here — wizard renders in a portal outside ToastProvider.
// Success/error feedback is handled by the parent via onCreated/onError props.

import { API } from '../lib/api'
import { containerDimViolations, containerDimMessage } from '../lib/packaging'

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
interface AdditionalItem  { desc: string; qty: string; uom: string; parentLineId: string; ros: string } // parentLineId REQUIRED — off-PO variation must name its parent PO line; ros user-supplied (Q3)
interface PkgContent { lineRef: string; qty: string }   // which allocatable line + how much is in this box
interface PackageRow {
  id: string                 // Q2: stable client ref for nesting (sent to backend as `ref`)
  parentId: string           // Q2: id of the container this nests under ('' = top-level)
  kind: 'container' | 'package'   // D5.1 container-first: 'container' = top-level typed container (holds sub-packages, no items); 'package' = leaf (sub-package or loose) that holds items
  type: string; customType?: string; qty: string
  length: string; width: string; height: string; weight: string
  is_dg: boolean
  contents: PkgContent[]   // Stage 2: itemized packing list. Non-empty → this is ONE physical box.
  containerTypeId?: number | ''   // Q4: ISO container type — set on 'container' rows
  containerNo?: string; sealNo?: string   // Q4: optional on a container row at creation (seal routes through governance)
}
// Heat/Lot P1: one declared heat for the shipment (heat_number required; grade/cert optional).
interface HeatRow { heat_number: string; grade: string; cert: string; packageRef?: string }   // 3a: optional package link (client ref)

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
  // Item 2 (multi-modal): constituent legs + free-text leg detail. ⚠ Persistence is
  // FLAGGED — shipment_control_notes.mode has no 'multi' value and there's no column for
  // the legs; storage approach is pending TC's schema decision (not wired to create yet).
  const [multiModes, setMultiModes]           = useState<string[]>([])
  const [multiNotes, setMultiNotes]           = useState('')
  const [forwarder, setForwarder]             = useState('')
  const [incoterms, setIncoterms]             = useState('')

  // ─── STEP 3: Packages ─────────────────────────────────────
  const [packages, setPackages] = useState<PackageRow[]>([])
  // Q4/D5: who physically packs this SCN. 'forwarder' delegates packing to a freight
  // forwarder (picked below) and lets the SCN be created with packaging UNFINISHED.
  const [packedByType, setPackedByType] = useState<'internal'|'vendor'|'forwarder'>('internal')
  const [forwarderUserId, setForwarderUserId] = useState<number | ''>('')
  const [forwarders, setForwarders] = useState<{ id: number; full_name: string; company?: string }[]>([])
  const [containerTypes, setContainerTypes] = useState<{ id: number; code: string; description: string; inner_length_mm?: number; inner_width_mm?: number; inner_height_mm?: number; capacity_m3?: number | null; max_payload_kg?: number | null }[]>([])

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

    // D5: active freight forwarders (delegation picker) + ISO container types (Q4 picker).
    axios.get(`${API}/expediting/forwarders`).then(r => setForwarders(r.data || [])).catch(() => {})
    axios.get(`${API}/logistics/container-types`).then(r => setContainerTypes(r.data || [])).catch(() => {})
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
    setAdditionalItems(prev => [...prev, { desc: '', qty: '1', uom: 'EA', parentLineId: '', ros: '' }])
  const updateAdditional = (i: number, field: keyof AdditionalItem, val: string) =>
    setAdditionalItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))
  const removeAdditional = (i: number) =>
    setAdditionalItems(prev => prev.filter((_, idx) => idx !== i))

  // ─── PACKAGES (D5.1 container-first) ──────────────────────
  // A CONTAINER is a top-level typed object you create first (pick ISO type), then add
  // packages INTO it. A LOOSE PACKAGE is a top-level leaf that holds items directly. A
  // SUB-PACKAGE is a leaf nested under a container. Items live in leaves only.
  const newPkgId = () => `p${Date.now()}${Math.floor(Math.random() * 1000)}`
  const blankLeaf = (parentId: string): PackageRow => ({ id: newPkgId(), parentId, kind: 'package', type: 'Pallet', qty: '1', length: '', width: '', height: '', weight: '', is_dg: false, contents: [], containerTypeId: '' })
  const addContainer = () =>
    setPackages(prev => [...prev, { id: newPkgId(), parentId: '', kind: 'container', type: 'Container', qty: '1', length: '', width: '', height: '', weight: '', is_dg: false, contents: [], containerTypeId: '', containerNo: '', sealNo: '' }])
  const addLoosePackage = () => setPackages(prev => [...prev, blankLeaf('')])
  const addPackageInto = (containerId: string) => setPackages(prev => [...prev, blankLeaf(containerId)])
  const updatePkg = (i: number, field: keyof PackageRow, val: any) =>
    setPackages(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p))
  // Removing a container also removes its sub-packages (a container can't outlive… nor
  // strand… its contents); removing a leaf just drops it.
  const removePkg = (i: number) =>
    setPackages(prev => {
      const removed = prev[i]
      if (!removed) return prev
      return prev.filter((_, idx) => idx !== i).filter(p => p.parentId !== removed.id)
    })

  // ─── HIERARCHY HELPERS ────────────────────────────────────
  const containerRows = () => packages.filter(p => p.kind === 'container')
  const looseRows = () => packages.filter(p => p.kind === 'package' && !p.parentId)
  const subRows = (containerId: string) => packages.filter(p => p.parentId === containerId)
  const pkgIndex = (id: string) => packages.findIndex(p => p.id === id)
  const ctById = (id?: number | '') => containerTypes.find(c => c.id === id)

  // ─── PACKAGE CONTENTS (Stage 2 — D1 per-package picker) ────
  const addContent = (pi: number) =>
    setPackages(prev => prev.map((p, idx) => idx === pi ? { ...p, contents: [...p.contents, { lineRef: '', qty: '' }] } : p))
  const updateContent = (pi: number, ci: number, field: keyof PkgContent, val: string) =>
    setPackages(prev => prev.map((p, idx) => idx === pi
      ? { ...p, contents: p.contents.map((c, j) => j === ci ? { ...c, [field]: val } : c) } : p))
  const removeContent = (pi: number, ci: number) =>
    setPackages(prev => prev.map((p, idx) => idx === pi
      ? { ...p, contents: p.contents.filter((_, j) => j !== ci) } : p))

  // ─── ALLOCATABLE LINES (the SCN's selected lines + off-PO variations) ──
  // The single source for the contents picker AND the D2/D3 reconciliation. Each entry:
  // { ref, label, scnQty, uom }. PO lines use ref 'po:<id>'; off-PO use 'add:<i>' / 'child:<id>'
  // — these refs are sent verbatim so the backend can map contents → the scn_lines it creates.
  const allocatableLines = (): { ref: string; label: string; scnQty: number; uom: string }[] => {
    const out: { ref: string; label: string; scnQty: number; uom: string }[] = []
    const poLines = po?.po_lines || []
    Object.entries(selectedLines).filter(([, v]) => v.checked).forEach(([id, v]) => {
      const l = poLines.find((x: any) => String(x.id) === String(id))
      out.push({ ref: `po:${id}`, label: `Line ${l?.line_number ?? id} — ${(l?.description || '').slice(0, 40)}`, scnQty: Number(v.qty) || 0, uom: l?.uom || 'EA' })
    })
    additionalItems.forEach((it, i) => {
      if (!it.desc.trim()) return
      out.push({ ref: `add:${i}`, label: `Off-PO — ${it.desc.slice(0, 40)}`, scnQty: Number(it.qty) || 0, uom: it.uom || 'EA' })
    })
    Object.entries(selectedChildren).filter(([, v]) => v.checked).forEach(([id, c]) => {
      out.push({ ref: `child:${id}`, label: `Child — ${(c.description || '').slice(0, 40)}`, scnQty: Number(c.qty) || 0, uom: c.uom || 'EA' })
    })
    return out
  }
  // qty packed for a ref across ALL packages
  const allocatedFor = (ref: string) =>
    packages.reduce((s, p) => s + p.contents.filter(c => c.lineRef === ref).reduce((t, c) => t + (Number(c.qty) || 0), 0), 0)
  // D2: every allocatable line fully (and not over-) allocated → Confirm allowed
  const allFullyAllocated = () => {
    const lines = allocatableLines()
    if (!lines.length) return true   // no lines selected → nothing to reconcile (edge; step 1 already requires ≥1)
    return lines.every(l => Math.abs(allocatedFor(l.ref) - l.scnQty) < 1e-9)
  }

  // ─── HEATS (Heat/Lot P1) ──────────────────────────────────
  const addHeat = () =>
    setHeats(prev => [...prev, { heat_number: '', grade: '', cert: '', packageRef: '' }])
  // 3a: short label for a package in the heat→package picker.
  const pkgLabel = (p: PackageRow) => {
    if (p.kind === 'container') { const ct = ctById(p.containerTypeId); return `📦 Container${ct ? ` ${ct.code}` : ''}` }
    const parent = p.parentId ? packages.find(x => x.id === p.parentId) : null
    return parent ? `↳ ${p.type} in ${ctById(parent.containerTypeId)?.code || 'container'}` : `${p.type} (loose)`
  }
  const updateHeat = (i: number, field: keyof HeatRow, val: string) =>
    setHeats(prev => prev.map((h, idx) => idx === i ? { ...h, [field]: val } : h))
  const removeHeat = (i: number) =>
    setHeats(prev => prev.filter((_, idx) => idx !== i))

  // ─── NAVIGATION GUARDS ────────────────────────────────────
  // Step 2 now requires BOTH a transport mode AND a destination warehouse.
  const canNext =
    step === 1 ? countSelected() > 0
    : step === 2 ? (!!transportMode && !!warehouseId)
    : true

  // Packaging-completeness gate (Pass 1): only 'We pack (internal)' must fully allocate
  // every selected line into packages before creating. 'Vendor' and 'Freight forwarder'
  // packing may be left UNFINISHED — the expeditor/forwarder enters packages later.
  const requiresFullAllocation = packedByType === 'internal'
  const untypedContainerExists = packages.some(p => p.kind === 'container' && !p.containerTypeId)
  const canCreate = !creating
    && (!requiresFullAllocation || allFullyAllocated())
    && !(packedByType === 'forwarder' && !forwarderUserId)
    && !untypedContainerExists

  // ─── SUBMIT ───────────────────────────────────────────────
  // Posts SCN to backend; shows toast and calls parent callback.
  const handleCreate = async () => {
    // Off-PO variations carry a client line_ref (matching allocatableLines) so the backend
    // can map package contents → the scn_lines it creates. Built in ONE create call now —
    // the old 2-phase /variation POST is retired (variations are created in the same txn).
    const itemVariations = additionalItems
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.desc.trim() || it.parentLineId)
      .map(({ it, i }) => ({ line_ref: `add:${i}`, parent_po_line_id: Number(it.parentLineId) || null, description: it.desc.trim(), qty: Number(it.qty) || 1, uom: it.uom, ros_date: it.ros || null }))
    const childVariations = Object.entries(selectedChildren)
      .filter(([, c]) => c.checked)
      .map(([id, c]) => ({ line_ref: `child:${id}`, parent_po_line_id: c.parentLineId, description: c.description, qty: Number(c.qty) || 1, uom: c.uom }))
    const variations = [...itemVariations, ...childVariations]
    for (const v of variations) {
      if (!v.parent_po_line_id) { onToast?.('Each off-PO variation must select a parent PO line.', 'error'); return }
      if (!v.description)       { onToast?.('Each off-PO variation needs a description.', 'error'); return }
    }
    // Pass 1: ONLY 'We pack (internal)' must fully allocate before creating. Vendor and
    // forwarder packing may be created with packaging unfinished (entered later).
    if (requiresFullAllocation && !allFullyAllocated()) { onToast?.('Allocate every selected line fully into packages before creating the SCN.', 'error'); return }
    // If delegating, a forwarder must be chosen.
    if (packedByType === 'forwarder' && !forwarderUserId) { onToast?.('Pick the freight forwarder to delegate packing to.', 'error'); return }
    // Q4: every container must declare its ISO container type.
    const untypedContainer = packages.find(p => p.kind === 'container' && !p.containerTypeId)
    if (untypedContainer) { onToast?.('Select an ISO container type for each container.', 'error'); return }
    // Item 1: a sub-package must FIT its container's inner dims (per-type relaxation —
    // open-top relaxes height, flat-rack carries out-of-gauge). Wizard dims are cm → mm.
    for (const p of packages) {
      if (p.kind !== 'package' || !p.parentId) continue
      const parent = packages.find(c => c.id === p.parentId)
      const ct = ctById(parent?.containerTypeId)
      if (!ct) continue
      const v = containerDimViolations({ length_mm: (Number(p.length) || 0) * 10, width_mm: (Number(p.width) || 0) * 10, height_mm: (Number(p.height) || 0) * 10 }, ct as any)
      if (v) { onToast?.(containerDimMessage(v, ct as any), 'error'); return }
    }

    const poLines = po?.po_lines || []
    setCreating(true)
    try {
      const body = {
        po_id: poId,
        selected_lines: Object.entries(selectedLines)
          .filter(([, v]) => v.checked)
          .map(([id, v]) => ({ line_ref: `po:${id}`, po_line_id: Number(id), qty_allocated: Number(v.qty) || 1, uom: poLines.find((l: any) => String(l.id) === String(id))?.uom || 'EA' })),
        variations,
        pickup_location: pickupLocation || null,
        destination_warehouse_id: warehouseId || null,
        grid_bay: gridBay || null,
        cdd: cdd || null,
        crd: crd || null,
        ccd: ccd || null,
        etd: etd || null,
        eta: eta || null,
        transport_mode: transportMode || null,
        // Item 2 (multi-modal): send constituent legs + leg notes when Multi-modal.
        transport_modes: transportMode === 'multi' ? multiModes : undefined,
        transport_mode_notes: transportMode === 'multi' ? (multiNotes || null) : undefined,
        forwarder_name: forwarder || null,
        incoterms: incoterms || null,
        // D5: who packs. 'forwarder' → delegate packing to the picked freight forwarder
        // (backend validates: forwarder requires an active FF; internal/vendor forbid it).
        packed_by_type: packedByType,
        packaging_delegated_to: packedByType === 'forwarder' ? (forwarderUserId || null) : null,
        // Q2: send ref + parent_ref so the backend persists the hierarchy. Order
        // parents BEFORE children at any depth (backend resolves ids single-pass).
        // Itemized package → qty forced to 1 (one physical box); contents carry the packing list.
        packages: (() => {
          const byParent: Record<string, PackageRow[]> = {}
          packages.forEach(p => { (byParent[p.parentId || ''] = byParent[p.parentId || ''] || []).push(p) })
          const ordered: PackageRow[] = []
          const seen = new Set<string>()
          const walk = (pid: string) => (byParent[pid] || []).forEach(p => { if (seen.has(p.id)) return; seen.add(p.id); ordered.push(p); walk(p.id) })
          walk('')
          packages.forEach(p => { if (!seen.has(p.id)) ordered.push(p) })   // orphans → append
          return ordered
        })()
          .map(p => ({
            ref: p.id,
            parent_ref: p.parentId || undefined,
            type: p.kind === 'container' ? 'Container' : (p.type === 'Others' ? ((p.customType || '').trim() || 'Other') : p.type),
            qty: p.contents.length ? 1 : (Number(p.qty) || 1),
            // Q4: a typed container carries its ISO container_type_id + optional
            // container_no/seal_no. seal_no routes through governance in the create txn.
            container_type_id: p.kind === 'container' ? (p.containerTypeId || undefined) : undefined,
            container_no: p.kind === 'container' ? ((p.containerNo || '').trim() || undefined) : undefined,
            seal_no: p.kind === 'container' ? ((p.sealNo || '').trim() || undefined) : undefined,
            length: p.length, width: p.width, height: p.height, weight: p.weight, is_dg: p.is_dg,
            contents: p.contents
              .filter(c => c.lineRef && Number(c.qty) > 0)
              .map(c => ({ line_ref: c.lineRef, qty: Number(c.qty), uom: allocatableLines().find(l => l.ref === c.lineRef)?.uom || null })),
          })),
        // Heat/Lot P1: declared heats for this shipment (optional — empty is fine).
        heats: heats
          .filter(h => h.heat_number.trim())
          .map(h => ({
            heat_number: h.heat_number.trim(),
            material_grade: h.grade.trim() || null,
            mill_cert_ref: h.cert.trim() || null,
            package_ref: h.packageRef || undefined,   // 3a: optional heat→package link (resolved server-side)
          })),
        notify_forwarder: notifyForwarder,
      }
      const { data } = await axios.post(`${API}/expediting/${projectId}/scn`, body)
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
              {additionalItems.map((item, i) => {
                // Q3: the child inherits the parent line's identity + WBS (read-only context).
                // Blocked at create if the parent is unlinked or has no WBS (backend 422 surfaced).
                const parent = (po?.po_lines || []).find((l: any) => String(l.id) === String(item.parentLineId))
                const parentIdentity = parent ? (parent.tag_number || parent.equipment_tag || (parent.commodity_name ? `commodity ${parent.commodity_name}` : (parent.commodity_id ? `commodity #${parent.commodity_id}` : null))) : null
                const parentWbs = parent ? (parent.wbs_code_snapshot || null) : null
                const unlinked = parent && !parentIdentity
                const noWbs = parent && !parentWbs
                return (
                <div key={i} style={{ marginTop: 8, borderTop: i ? '1px dashed #fde68a' : undefined, paddingTop: i ? 8 : 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                    placeholder="Off-PO item (e.g. fridge door handle)"
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
                  <label style={{ fontSize: 10, color: '#64748b', whiteSpace: 'nowrap' }}>ROS</label>
                  <input
                    type="date"
                    value={item.ros}
                    onChange={e => updateAdditional(i, 'ros', e.target.value)}
                    title="Required-on-site date (user-supplied — not inherited)"
                    style={{ ...inputStyle, width: 140 }}
                  />
                  <button
                    onClick={() => removeAdditional(i)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
                  >
                    ×
                  </button>
                </div>
                {/* Inherited identity + WBS (read-only) / block warning */}
                {parent && (
                  unlinked || noWbs ? (
                    <div style={{ marginTop: 4, marginLeft: 2, fontSize: 11, color: '#dc2626' }}>
                      ⚠ Line {parent.line_number} {unlinked ? 'has no commodity/tag link' : 'has no WBS'} — {unlinked ? 'link a commodity/tag' : 'set its WBS'} before adding an off-PO item under it.
                    </div>
                  ) : (
                    <div style={{ marginTop: 4, marginLeft: 2, fontSize: 11, color: '#64748b' }}>
                      Inherits from line {parent.line_number}: <span style={{ color: '#475569' }}>{parentIdentity}</span> · WBS <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#475569' }}>{parentWbs}</span> <span style={{ color: '#94a3b8' }}>(read-only)</span>
                    </div>
                  )
                )}
                </div>
                )
              })}
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
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Destination warehouse *</label>
          <select
            value={warehouseId}
            onChange={e => setWarehouseId(Number(e.target.value) || '')}
            style={{ ...inputStyle, width: '100%', borderColor: warehouseId ? undefined : '#f59e0b' }}
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
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Contract delivery date (CDD) <span style={{ color: '#94a3b8', fontWeight: 400 }}>· from PO line (read-only)</span></label>
          {/* Pass 1: CDD is inherited from the PO line and NOT editable here. */}
          <input
            type="date"
            value={cdd}
            readOnly
            disabled
            title="Inherited from the PO line — not editable on the SCN"
            style={{ ...inputStyle, width: '100%', background: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' }}
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
        {/* Item 2: multi-modal → constituent legs + leg notes. (Persistence pending TC schema.) */}
        {transportMode === 'multi' && (
          <div style={{ marginTop: 10, border: '1px solid #c7d2fe', background: 'rgba(37,99,235,0.04)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', marginBottom: 6 }}>CONSTITUENT MODES</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              {['sea', 'air', 'road', 'rail', 'courier'].map(m => (
                <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#374151', cursor: 'pointer', textTransform: 'capitalize' }}>
                  <input type="checkbox" checked={multiModes.includes(m)}
                    onChange={e => setMultiModes(prev => e.target.checked ? [...prev, m] : prev.filter(x => x !== m))} />
                  {m}
                </label>
              ))}
            </div>
            <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Leg detail (optional)</label>
            <textarea value={multiNotes} onChange={e => setMultiNotes(e.target.value)} rows={2}
              placeholder="e.g. Sea to Singapore, road to site"
              style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        )}
        {/* ─── TRANSPORT ERROR ──────────────────────────────── */}
        {transportError && (
          <p style={{ color: '#ef4444', fontSize: 12, marginTop: 4, marginBottom: 0 }}>
            {transportError}
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Forwarder</label>
          {/* Item 4: dropdown of project freight forwarders (same source as the delegation
              picker). Writes forwarder_name — the field the register/detail display use. */}
          <select
            value={forwarder}
            onChange={e => setForwarder(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
          >
            <option value="">— Select forwarder</option>
            {forwarders.map(f => <option key={f.id} value={f.company ? `${f.full_name} · ${f.company}` : f.full_name}>{f.full_name}{f.company ? ` · ${f.company}` : ''}</option>)}
          </select>
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
  // Leaf-package body (dims + DG + contents) — shared by sub-packages and loose packages.
  const renderLeafBody = (pkg: PackageRow, i: number) => (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Type</label>
          <select value={pkg.type} onChange={e => updatePkg(i, 'type', e.target.value)} style={{ ...inputStyle, width: '100%' }}>
            {PKG_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
          {pkg.type === 'Others' && (
            <input value={pkg.customType || ''} onChange={e => updatePkg(i, 'customType', e.target.value)} placeholder="Specify package type *"
              style={{ ...inputStyle, width: '100%', marginTop: 6, borderColor: (pkg.customType || '').trim() ? undefined : '#f59e0b' }} />
          )}
        </div>
        <div>
          <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>{pkg.contents.length > 0 ? 'Qty (itemized)' : 'Qty'}</label>
          <input type="number" min={1} value={pkg.contents.length > 0 ? '1' : pkg.qty} disabled={pkg.contents.length > 0}
            title={pkg.contents.length > 0 ? 'Itemized package = one physical box' : undefined}
            onChange={e => updatePkg(i, 'qty', e.target.value)}
            style={{ ...inputStyle, width: '100%', background: pkg.contents.length > 0 ? '#f1f5f9' : '#fff', color: pkg.contents.length > 0 ? '#94a3b8' : '#0f172a' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        {(['length', 'width', 'height'] as const).map(dim => (
          <div key={dim}>
            <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3, textTransform: 'capitalize' }}>{dim} (cm)</label>
            <input type="number" min={0} value={pkg[dim]} onChange={e => updatePkg(i, dim, e.target.value)} style={{ ...inputStyle, width: '100%' }} />
          </div>
        ))}
        <div>
          <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Weight (kg)</label>
          <input type="number" min={0} value={pkg.weight} onChange={e => updatePkg(i, 'weight', e.target.value)} style={{ ...inputStyle, width: '100%' }} />
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
        <input type="checkbox" checked={pkg.is_dg} onChange={e => updatePkg(i, 'is_dg', e.target.checked)} style={{ accentColor: '#ef4444' }} />
        Dangerous goods (DG)
      </label>
      {/* Contents (packing list) — items go in leaf packages. */}
      <div style={{ marginTop: 12, borderTop: '1px dashed #e2e8f0', paddingTop: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Contents (packing list)</div>
        {pkg.contents.map((c, ci) => {
          const line = allocatableLines().find(l => l.ref === c.lineRef)
          const allocatedAll = line ? allocatedFor(c.lineRef) : 0
          const over = !!line && allocatedAll > line.scnQty + 1e-9
          const thisRowQty = Number(c.qty) || 0
          const lineRemaining = line ? Math.max(0, line.scnQty - allocatedAll) : 0
          const rowCap = line ? Math.max(0, line.scnQty - (allocatedAll - thisRowQty)) : 0
          return (
            <div key={ci} style={{ marginBottom: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 24px', gap: 6, alignItems: 'center' }}>
                <select value={c.lineRef} onChange={e => updateContent(i, ci, 'lineRef', e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                  <option value="">Select line…</option>
                  {/* Item 5: only show lines not yet fully packed (+ this row's own line),
                      labelled with the BALANCE available to pack (reuses allocatedFor). */}
                  {allocatableLines().filter(l => {
                    const avail = l.scnQty - allocatedFor(l.ref) + (l.ref === c.lineRef ? (Number(c.qty) || 0) : 0)
                    return avail > 1e-9 || l.ref === c.lineRef
                  }).map(l => {
                    const avail = Math.max(0, l.scnQty - allocatedFor(l.ref) + (l.ref === c.lineRef ? (Number(c.qty) || 0) : 0))
                    return <option key={l.ref} value={l.ref}>{l.label} — {avail} {l.uom} to pack</option>
                  })}
                </select>
                <input type="number" min={0} value={c.qty} placeholder="qty"
                  onChange={e => updateContent(i, ci, 'qty', e.target.value)}
                  title={line ? `${lineRemaining} ${line.uom} still unallocated on this line` : ''}
                  style={{ ...inputStyle, width: '100%', borderColor: over ? '#ef4444' : '#dde3ed' }} />
                <button onClick={() => removeContent(i, ci)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 15, cursor: 'pointer' }}>×</button>
              </div>
              {line && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, marginLeft: 2 }}>
                  <button onClick={() => updateContent(i, ci, 'qty', String(rowCap))} disabled={lineRemaining <= 0 && !over}
                    title={lineRemaining > 0 ? `Fill the remaining ${lineRemaining} ${line.uom} into this row` : over ? 'Over-allocated — reduce qty' : 'Line already fully allocated'}
                    style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, fontFamily: 'inherit', border: '1px solid #93c5fd',
                      background: (lineRemaining > 0 || over) ? '#eff6ff' : '#f1f5f9', color: (lineRemaining > 0 || over) ? '#2563eb' : '#94a3b8',
                      cursor: (lineRemaining > 0 || over) ? 'pointer' : 'not-allowed' }}>+ Balance</button>
                  <span style={{ fontSize: 11, color: over ? '#ef4444' : lineRemaining > 0 ? '#d97706' : '#16a34a' }}>
                    {over ? `Over by ${(allocatedAll - line.scnQty)} ${line.uom}` : `Remaining: ${lineRemaining} ${line.uom}`}
                  </span>
                </div>
              )}
            </div>
          )
        })}
        <button onClick={() => addContent(i)} style={{ fontSize: 11, color: '#2563eb', background: 'none', border: '1px dashed #93c5fd', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>+ add content</button>
      </div>
    </div>
  )

  const Step3 = () => (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Packages</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
        Build the shipment container-first — add a container and pack into it, or add loose packages.
      </div>

      {/* D5: who physically packs this SCN. 'Freight forwarder' delegates packing to a
          chosen forwarder and lets you create the SCN with packaging unfinished. */}
      <div style={{ border: '1px solid #dde3ed', borderRadius: 8, padding: '12px 14px', marginBottom: 16, background: '#f8fafc' }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 8 }}>WHO PACKS THIS SHIPMENT?</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([['internal','We pack (internal)'],['vendor','Vendor packs'],['forwarder','Freight forwarder packs']] as const).map(([val, lbl]) => (
            <button key={val} type="button" onClick={() => setPackedByType(val)}
              style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: packedByType === val ? '1.5px solid #2563eb' : '1px solid #cbd5e1',
                background: packedByType === val ? '#eff6ff' : '#fff', color: packedByType === val ? '#1d4ed8' : '#475569' }}>
              {lbl}
            </button>
          ))}
        </div>
        {packedByType === 'forwarder' && (
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Delegate packing to *</label>
            <select value={forwarderUserId} onChange={e => setForwarderUserId(e.target.value ? Number(e.target.value) : '')}
              style={{ ...inputStyle, width: '100%', borderColor: forwarderUserId ? undefined : '#f59e0b' }}>
              <option value="">— Select a freight forwarder —</option>
              {forwarders.map(f => <option key={f.id} value={f.id}>{f.full_name}{f.company ? ` · ${f.company}` : ''}</option>)}
            </select>
            <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 8, lineHeight: 1.4 }}>
              📦 The forwarder will pack and seal this shipment. You can create the SCN now with packaging <strong>unfinished</strong> — they’ll complete it.
            </div>
          </div>
        )}
        {packedByType === 'vendor' && (
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Vendor-packed — enter the packages yourself below (the vendor doesn’t log in).</div>
        )}
      </div>

      {/* Containers (top-level, typed) — pack sub-packages INTO each. */}
      {containerRows().map(cont => {
        const ci = pkgIndex(cont.id)
        const ct = ctById(cont.containerTypeId)
        const subs = subRows(cont.id)
        return (
        <div key={cont.id} style={{ border: '1.5px solid #c4b5fd', borderRadius: 10, padding: '14px 16px', marginBottom: 14, background: 'rgba(124,58,237,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9', display: 'flex', alignItems: 'center', gap: 6 }}>📦 Container{ct ? ` · ${ct.code}` : ''}</span>
            <button onClick={() => removePkg(ci)} title="Remove container + its packages" style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700, display: 'block', marginBottom: 3 }}>Container type *</label>
              <select value={cont.containerTypeId ?? ''} onChange={e => updatePkg(ci, 'containerTypeId', e.target.value ? Number(e.target.value) : '')}
                style={{ ...inputStyle, width: '100%', borderColor: cont.containerTypeId ? '#c4b5fd' : '#f59e0b' }}>
                <option value="">— Select ISO container type —</option>
                {containerTypes.map(t => <option key={t.id} value={t.id}>{t.code} · {t.description}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Inner dimensions (reference)</label>
              <div style={{ ...inputStyle, width: '100%', background: '#f1f5f9', color: '#475569', display: 'flex', alignItems: 'center', minHeight: 30 }}>
                {ct ? `${ct.inner_length_mm} × ${ct.inner_width_mm} × ${ct.inner_height_mm} mm${ct.capacity_m3 ? ` · ${ct.capacity_m3} m3` : ''}` : '—'}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Container No. (optional)</label>
              <input value={cont.containerNo || ''} onChange={e => updatePkg(ci, 'containerNo', e.target.value)} placeholder="e.g. MSKU1234567" style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 3 }}>Seal No. (optional)</label>
              <input value={cont.sealNo || ''} onChange={e => updatePkg(ci, 'sealNo', e.target.value)} placeholder={packedByType === 'forwarder' ? 'Forwarder seals on packing' : 'Seal number'} style={{ ...inputStyle, width: '100%' }} />
            </div>
          </div>
          {subs.map(sub => {
            const si = pkgIndex(sub.id)
            return (
              <div key={sub.id} style={{ border: '1px solid #dde3ed', borderRadius: 8, padding: '12px 14px', marginBottom: 8, background: '#fff', marginLeft: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>↳ Package in container</span>
                  <button onClick={() => removePkg(si)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 15, cursor: 'pointer' }}>×</button>
                </div>
                {renderLeafBody(sub, si)}
              </div>
            )
          })}
          <button onClick={() => addPackageInto(cont.id)} style={{ fontSize: 11, color: '#7c3aed', background: 'none', border: '1px dashed #c4b5fd', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', marginLeft: 12 }}>+ Add package into this container</button>
        </div>
        )
      })}

      {/* Loose packages (top-level leaves that hold items directly). */}
      {looseRows().map(lp => {
        const li = pkgIndex(lp.id)
        return (
          <div key={lp.id} style={{ border: '1px solid #dde3ed', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>📦 Loose package</span>
              <button onClick={() => removePkg(li)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer' }}>×</button>
            </div>
            {renderLeafBody(lp, li)}
          </div>
        )
      })}

      {/* Reconciliation (D2) — every selected line must be fully packed before Confirm. */}
      {allocatableLines().length > 0 && (
        <div style={{ border: '1px solid #dde3ed', borderRadius: 8, padding: '12px 14px', margin: '4px 0 12px', background: '#f8fafc' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Allocation reconciliation</div>
          {allocatableLines().map(l => {
            const done = allocatedFor(l.ref)
            const ok = Math.abs(done - l.scnQty) < 1e-9
            const over = done > l.scnQty + 1e-9
            return (
              <div key={l.ref} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0', color: '#475569' }}>
                <span>{l.label}</span>
                <span style={{ color: over ? '#ef4444' : ok ? '#16a34a' : '#d97706', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                  {done}/{l.scnQty} {l.uom} {over ? '⚠ over' : ok ? '✓' : ''}
                </span>
              </div>
            )
          })}
          {!allFullyAllocated() && (
            <div style={{ fontSize: 11, color: '#d97706', marginTop: 6 }}>All selected lines must be fully allocated before you can create the SCN.</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={addContainer}
          style={{ flex: 1, padding: '10px', border: '1px dashed #7c3aed', borderRadius: 8, background: 'rgba(124,58,237,0.04)', color: '#6d28d9', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>
          📦 + Add container
        </button>
        <button onClick={addLoosePackage}
          style={{ flex: 1, padding: '10px', border: '1px dashed #2563eb', borderRadius: 8, background: 'none', color: '#2563eb', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>
          + Add loose package
        </button>
      </div>
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
          <div style={{ display: 'grid', gridTemplateColumns: packages.length ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 8 }}>
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
            {/* 3a: optionally link this heat to a package built in step 3. */}
            {packages.length > 0 && (
              <div>
                <label style={{ fontSize: 10, color: '#7c3aed', display: 'block', marginBottom: 3 }}>In package</label>
                <select value={h.packageRef || ''} onChange={e => updateHeat(i, 'packageRef', e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                  <option value="">— Not linked</option>
                  {packages.map(p => <option key={p.id} value={p.id}>{pkgLabel(p)}</option>)}
                </select>
              </div>
            )}
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
        ℹ Documents are not uploaded here — after creating the SCN, attach them from its detail view: find the SCN under the PO's "Line Items & SCNs" tab, or in Logistics.
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

    // ─── DISABLE-REASON EXPLANATION (Fix A) ───────────────────
    // The Confirm screen must ALWAYS explain why Create is disabled — and never give a
    // FALSE reason. Allocation is required ONLY for 'We pack (internal)', so allocIssues
    // are scoped to that scenario (vendor/forwarder may create with packaging unfinished).
    // The other real gates — an untyped container, or a forwarder not yet picked — are
    // surfaced too (previously only allocation was ever shown, so these blocks looked like
    // a dead button with no reason).
    const allocIssues = requiresFullAllocation
      ? allocatableLines()
          .map(l => ({ l, done: allocatedFor(l.ref) }))
          .filter(({ l, done }) => Math.abs(done - l.scnQty) >= 1e-9)
      : []
    const containers = packages.filter(p => p.kind === 'container')
    const untypedContainers = containers
      .map((p, i) => ({ num: i + 1 }))
      .filter((_, i) => !containers[i].containerTypeId)
    const forwarderMissing = packedByType === 'forwarder' && !forwarderUserId
    const hasBlock = allocIssues.length > 0 || untypedContainers.length > 0 || forwarderMissing

    return (
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Confirm SCN</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Review details before creating the shipment control note.</div>

        {/* Disabled-reason banner — explains every real gate on the Create button below. */}
        {hasBlock && (
          <div style={{
            background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8,
            padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#92400e',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠ Cannot create — fix the following:</div>
            {forwarderMissing && (
              <div style={{ padding: '2px 0' }}>• Select a freight forwarder to delegate packing to.</div>
            )}
            {untypedContainers.map(({ num }) => (
              <div key={num} style={{ padding: '2px 0' }}>• Container {num} needs an ISO container type selected.</div>
            ))}
            {allocIssues.length > 0 && (
              <>
                <div style={{ fontWeight: 600, marginTop: (forwarderMissing || untypedContainers.length) ? 6 : 0 }}>
                  {allocIssues.length} line{allocIssues.length !== 1 ? 's' : ''} not fully allocated into packages:
                </div>
                {allocIssues.map(({ l, done }) => {
                  const over = done > l.scnQty + 1e-9
                  return (
                    <div key={l.ref} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span>{l.label}</span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: over ? '#dc2626' : '#b45309' }}>
                        {done}/{l.scnQty} {l.uom} {over ? '⚠ over' : '— under'}
                      </span>
                    </div>
                  )
                })}
                <div style={{ marginTop: 6, color: '#b45309' }}>Go back to <strong>Packages</strong> and use <strong>+ Balance</strong> to finish allocating.</div>
              </>
            )}
          </div>
        )}

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
                  if (step === 2 && !warehouseId) {
                    setTransportError('Please select a destination warehouse to continue')
                    return
                  }
                  setTransportError('')
                  setStep(s => (s + 1) as Step)
                }}
                disabled={!canNext}
                style={{ ...blueBtn, opacity: !canNext ? 0.5 : 1, cursor: !canNext ? 'not-allowed' : 'pointer' }}
              >
                {step === 1
                  ? `Next — ${countSelected()} item${countSelected() !== 1 ? 's' : ''} →`
                  : 'Next →'}
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={!canCreate}
                title={
                  requiresFullAllocation && !allFullyAllocated() ? 'Allocate every selected line fully into packages first'
                  : packedByType === 'forwarder' && !forwarderUserId ? 'Select the freight forwarder to delegate packing to'
                  : untypedContainerExists ? 'Select an ISO container type for each container'
                  : undefined
                }
                style={{ ...greenBtn, opacity: canCreate ? 1 : 0.5, cursor: canCreate ? 'pointer' : 'not-allowed' }}
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
