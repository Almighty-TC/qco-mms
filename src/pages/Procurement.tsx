// ─── PROCUREMENT MODULE ───────────────────────────────────────
// PO Register: list, stat cards, filters, New PO wizard (3 steps),
// and PO detail view with line items and milestones.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'

const API = 'http://localhost:3001/api'

// ─── TYPES ─────────────────────────────────────────────────────

type POStatus = 'rfq' | 'loa' | 'po-raised' | 'active' | 'closed' | 'cancelled'
type GroupCat = 'mechanical' | 'electrical' | 'instrumentation' | 'civil' | 'piping' | 'structural'

interface PO {
  id: number
  project_id: number
  po_number: string
  po_name: string | null
  description: string | null
  vendor_name: string
  supplier_id: number | null
  supplier_name: string | null
  currency: string
  value: number | null
  incoterms: string | null
  wbs_code: string | null
  ros_date: string | null
  status: POStatus
  statusLabel: string
  isCriticalPath: boolean
  isLocked: boolean
  owner_id: number | null
  owner_name: string | null
  group_category: GroupCat | null
  milestone_po_date: string | null
  milestone_fat_date: string | null
  milestone_esd_date: string | null
  milestone_eta_date: string | null
  milestone_ros_date: string | null
}

interface POLine {
  id?: number
  line_number: string
  description: string
  qty: number | null
  uom: string
  uom_id?: number | null
  unit_price: number | null
  total_price?: number | null
  ros_date?: string | null
}

interface Stats {
  totalPOs: number
  committedValue: number
  approvedValue: number
  pendingCount: number
}

interface Supplier { id: number; code: string; name: string }
interface UOMItem  { id: number; code: string; name?: string }
interface UserItem { id: number; full_name: string; role: string }
interface WBSNode  { id: number; code: string; description: string }

// ─── CONSTANTS ────────────────────────────────────────────────

const CURRENCIES = ['AUD','USD','EUR','GBP','SGD','JPY','CNY']
const INCO_TERMS = ['CIF','FOB','EXW','DAP','DDP','FCA','CPT','CIP']
const GROUP_CATS: { value: GroupCat; label: string }[] = [
  { value: 'mechanical',      label: 'Mechanical' },
  { value: 'electrical',      label: 'Electrical' },
  { value: 'instrumentation', label: 'Instrumentation' },
  { value: 'civil',           label: 'Civil' },
  { value: 'piping',          label: 'Piping' },
  { value: 'structural',      label: 'Structural' },
]

const STATUS_COLORS: Record<POStatus, { bg: string; text: string }> = {
  rfq:        { bg: 'rgba(245,158,11,0.12)', text: '#b45309' },
  loa:        { bg: 'rgba(37,99,235,0.12)',  text: '#2563eb' },
  'po-raised':{ bg: 'rgba(34,197,94,0.12)',  text: '#15803d' },
  active:     { bg: 'rgba(37,99,235,0.12)',  text: '#2563eb' },
  closed:     { bg: 'rgba(100,116,139,0.12)', text: '#475569' },
  cancelled:  { bg: 'rgba(239,68,68,0.12)',  text: '#dc2626' },
}

// ─── HELPERS ──────────────────────────────────────────────────

function fmtCurrency(val: number | null, ccy = 'AUD') {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy, maximumFractionDigits: 0 }).format(val)
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' })
}

// ─── SHARED STYLES ────────────────────────────────────────────

const inp = (dark: boolean): React.CSSProperties => ({
  height: 34, padding: '0 10px', borderRadius: 6,
  border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
  background: dark ? '#0f172a' : '#fff',
  color: dark ? '#f1f5f9' : '#0f172a',
  fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif', outline: 'none',
  width: '100%', boxSizing: 'border-box' as const,
})

const textarea = (dark: boolean): React.CSSProperties => ({
  ...inp(dark), height: 72, resize: 'vertical' as const, padding: '8px 10px', lineHeight: 1.5,
})

// ─── STAT CARD ────────────────────────────────────────────────

const StatCard = ({ label, value, sub, dark, accent }: {
  label: string; value: string; sub?: string; dark: boolean; accent?: string
}) => (
  <div style={{
    flex: 1, background: dark ? '#1e293b' : '#fff',
    border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8,
    padding: '14px 18px', minWidth: 0,
  }}>
    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: accent ?? (dark ? '#f1f5f9' : '#0f172a'), letterSpacing: '-0.02em' }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{sub}</div>}
  </div>
)

// ─── STATUS PILL ─────────────────────────────────────────────

const StatusPill = ({ status, label }: { status: POStatus; label: string }) => {
  const c = STATUS_COLORS[status] ?? { bg: 'rgba(100,116,139,0.12)', text: '#475569' }
  return (
    <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text }}>
      {label}
    </span>
  )
}

// ─── MODAL WRAPPER ────────────────────────────────────────────

const Modal = ({ children, onClose, dark, wide = false }: {
  children: React.ReactNode; onClose: () => void; dark: boolean; wide?: boolean
}) => createPortal(
  <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div onClick={e => e.stopPropagation()} style={{
      background: dark ? '#1e293b' : '#fff', borderRadius: 10,
      padding: wide ? 32 : 28,
      width: wide ? 760 : 520, maxWidth: '100%', maxHeight: '90vh',
      overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
      fontFamily: 'IBM Plex Sans, sans-serif',
      border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
    }}>
      {children}
    </div>
  </div>,
  document.body
)

// ─── LABEL COMPONENT ─────────────────────────────────────────

const Label = ({ children, dark }: { children: React.ReactNode; dark: boolean }) => (
  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>
    {children}
  </label>
)

// ─── FIELD WRAPPER ────────────────────────────────────────────

const Field = ({ label, children, dark, half }: {
  label: string; children: React.ReactNode; dark: boolean; half?: boolean
}) => (
  <div style={{ marginBottom: 14, ...(half ? { flex: '0 0 calc(50% - 6px)' } : {}) }}>
    <Label dark={dark}>{label}</Label>
    {children}
  </div>
)

// ─── SECTION HEADER ──────────────────────────────────────────

const SectionHdr = ({ children, dark }: { children: React.ReactNode; dark: boolean }) => (
  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: `1px solid ${dark ? '#1e2d4a' : '#e8ecf2'}`, paddingBottom: 6, marginBottom: 14, marginTop: 20 }}>
    {children}
  </div>
)

// ─── NEW PO WIZARD ────────────────────────────────────────────

interface NewPOWizardProps {
  dark: boolean
  projectId: number
  suppliers: Supplier[]
  uoms: UOMItem[]
  users: UserItem[]
  wbsNodes: WBSNode[]
  onClose: () => void
  onCreated: (po: PO) => void
}

const NewPOWizard = ({ dark, projectId, suppliers, uoms, users, wbsNodes, onClose, onCreated }: NewPOWizardProps) => {
  const { addToast } = useToast()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // ── Step 1 fields ──
  const [poNumber,    setPoNumber]    = useState('')
  const [poName,      setPoName]      = useState('')
  const [description, setDescription] = useState('')
  const [supplierId,  setSupplierId]  = useState('')
  const [vendorName,  setVendorName]  = useState('')
  const [currency,    setCurrency]    = useState('AUD')
  const [value,       setValue]       = useState('')
  const [incoterms,   setIncoterms]   = useState('')
  const [wbsCode,     setWbsCode]     = useState('')
  const [rosDate,     setRosDate]     = useState('')
  const [ownerId,     setOwnerId]     = useState('')
  const [groupCat,    setGroupCat]    = useState<GroupCat | ''>('')

  // ── Step 2 line items ──
  const [lines, setLines] = useState<POLine[]>([
    { line_number: '1', description: '', qty: null, uom: 'EA', unit_price: null },
  ])

  const lineSubtotal = lines.reduce((sum, l) => sum + ((l.qty ?? 0) * (l.unit_price ?? 0)), 0)

  // ── Step 3 milestones ──
  const [msPO,  setMsPO]  = useState('')
  const [msFAT, setMsFAT] = useState('')
  const [msESD, setMsESD] = useState('')
  const [msETA, setMsETA] = useState('')
  const [msROS, setMsROS] = useState('')

  const addLine = () => setLines(prev => [
    ...prev,
    { line_number: String(prev.length + 1), description: '', qty: null, uom: 'EA', unit_price: null },
  ])

  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i))

  const updateLine = (i: number, field: keyof POLine, val: string | number | null) => {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l))
  }

  const validateStep1 = () => {
    if (!poNumber.trim()) return 'PO number is required'
    if (!vendorName.trim() && !supplierId) return 'Vendor or supplier is required'
    if (!currency) return 'Currency is required'
    return ''
  }

  const next = () => {
    if (step === 1) {
      const e = validateStep1()
      if (e) { setErr(e); return }
    }
    setErr('')
    setStep(s => s + 1)
  }

  const submit = async () => {
    setSaving(true); setErr('')
    try {
      const body = {
        po_number: poNumber.trim(),
        po_name: poName.trim() || null,
        description: description.trim() || null,
        supplier_id: supplierId ? Number(supplierId) : null,
        vendor_name: vendorName.trim() || suppliers.find(s => s.id === Number(supplierId))?.name || '',
        currency, value: value ? Number(value) : null,
        incoterms: incoterms || null,
        wbs_code: wbsCode || null,
        ros_date: rosDate || null,
        owner_id: ownerId ? Number(ownerId) : null,
        group_category: groupCat || null,
        milestone_po_date:  msPO  || null,
        milestone_fat_date: msFAT || null,
        milestone_esd_date: msESD || null,
        milestone_eta_date: msETA || null,
        milestone_ros_date: msROS || null,
        lines: lines.filter(l => l.description.trim()),
      }
      const { data } = await axios.post(`${API}/procurement/${projectId}/pos`, body)
      addToast('success', `PO ${data.po_number} created`)
      onCreated(data)
      onClose()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } }; message?: string }
      setErr(er.response?.data?.error ?? er.message ?? 'Create failed')
    } finally { setSaving(false) }
  }

  const col = dark ? '#f1f5f9' : '#0f172a'
  const stepLabel = ['Header', 'Line Items', 'Milestones']

  return (
    <Modal dark={dark} onClose={onClose} wide>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: col }}>New Purchase Order</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Step {step} of 3 — {stepLabel[step - 1]}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        {[1,2,3].map(s => (
          <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? '#E84E0F' : (dark ? '#334155' : '#e2e8f0') }} />
        ))}
      </div>

      {/* ── Step 1: Header ─────────────────────────────────── */}
      {step === 1 && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="PO Number *" dark={dark} half>
              <input value={poNumber} onChange={e => setPoNumber(e.target.value)}
                placeholder="e.g. PO-2024-007" style={{ ...inp(dark), fontFamily: 'JetBrains Mono, monospace' }} />
            </Field>
            <Field label="PO Name" dark={dark} half>
              <input value={poName} onChange={e => setPoName(e.target.value)}
                placeholder="Display name" style={inp(dark)} />
            </Field>
          </div>

          <Field label="Description" dark={dark}>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of scope" style={textarea(dark)} />
          </Field>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Supplier" dark={dark} half>
              <select value={supplierId} onChange={e => {
                setSupplierId(e.target.value)
                if (e.target.value) setVendorName('')
              }} style={inp(dark)}>
                <option value="">— Select supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              </select>
            </Field>
            <Field label="Vendor name (if no supplier)" dark={dark} half>
              <input value={vendorName} onChange={e => { setVendorName(e.target.value); setSupplierId('') }}
                placeholder="Free-text vendor" style={inp(dark)} disabled={!!supplierId} />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Group / Category" dark={dark} half>
              <select value={groupCat} onChange={e => setGroupCat(e.target.value as GroupCat | '')} style={inp(dark)}>
                <option value="">— Select —</option>
                {GROUP_CATS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </Field>
            <Field label="Currency *" dark={dark} half>
              <select value={currency} onChange={e => setCurrency(e.target.value)} style={inp(dark)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="PO Value" dark={dark} half>
              <input value={value} onChange={e => setValue(e.target.value)} type="number" min="0" step="0.01"
                placeholder="0.00" style={{ ...inp(dark), fontFamily: 'JetBrains Mono, monospace' }} />
            </Field>
            <Field label="Incoterms *" dark={dark} half>
              <select value={incoterms} onChange={e => setIncoterms(e.target.value)} style={inp(dark)}>
                <option value="">— Select —</option>
                {INCO_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="WBS" dark={dark} half>
              <select value={wbsCode} onChange={e => setWbsCode(e.target.value)} style={inp(dark)}>
                <option value="">— Select WBS —</option>
                {wbsNodes.map(w => <option key={w.id} value={w.code}>{w.code} — {w.description}</option>)}
              </select>
            </Field>
            <Field label="Required on Site (ROS) *" dark={dark} half>
              <input value={rosDate} onChange={e => setRosDate(e.target.value)} type="date" style={inp(dark)} />
            </Field>
          </div>

          <Field label="Owner / Expeditor" dark={dark}>
            <select value={ownerId} onChange={e => setOwnerId(e.target.value)} style={inp(dark)}>
              <option value="">— Assign owner —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.role.replace(/_/g,' ')})</option>)}
            </select>
          </Field>
        </>
      )}

      {/* ── Step 2: Line Items ──────────────────────────────── */}
      {step === 2 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: dark ? '#0f172a' : '#f4f7fb', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
                  {['#','Description','Qty','UoM','Unit Price','Total'].map(h => (
                    <th key={h} style={{ padding: '6px 8px', fontWeight: 600, color: '#64748b', textAlign: h === 'Description' ? 'left' : 'right', whiteSpace: 'nowrap', borderRight: `1px solid ${dark ? '#334155' : '#dde3ed'}`, ...(h === '#' ? { width: 30 } : {}) }}>{h}</th>
                  ))}
                  <th style={{ width: 28 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
                    <td style={{ padding: '4px 8px', textAlign: 'center', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{i + 1}</td>
                    <td style={{ padding: '4px 6px' }}>
                      <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)}
                        placeholder="Item description" style={{ ...inp(dark), height: 28, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: '4px 6px', width: 70 }}>
                      <input value={l.qty ?? ''} onChange={e => updateLine(i, 'qty', e.target.value ? Number(e.target.value) : null)}
                        type="number" min="0" step="0.001" placeholder="0"
                        style={{ ...inp(dark), height: 28, fontSize: 12, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }} />
                    </td>
                    <td style={{ padding: '4px 6px', width: 80 }}>
                      <select value={l.uom} onChange={e => updateLine(i, 'uom', e.target.value)}
                        style={{ ...inp(dark), height: 28, fontSize: 12 }}>
                        {uoms.map(u => <option key={u.id} value={u.code}>{u.code}</option>)}
                        {!uoms.find(u => u.code === l.uom) && <option value={l.uom}>{l.uom}</option>}
                      </select>
                    </td>
                    <td style={{ padding: '4px 6px', width: 110 }}>
                      <input value={l.unit_price ?? ''} onChange={e => updateLine(i, 'unit_price', e.target.value ? Number(e.target.value) : null)}
                        type="number" min="0" step="0.01" placeholder="0.00"
                        style={{ ...inp(dark), height: 28, fontSize: 12, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }} />
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: dark ? '#94a3b8' : '#475569', whiteSpace: 'nowrap' }}>
                      {l.qty != null && l.unit_price != null ? fmtCurrency(l.qty * l.unit_price, currency) : '—'}
                    </td>
                    <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                      {lines.length > 1 && (
                        <button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2 }}>×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>Subtotal</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>
                    {fmtCurrency(lineSubtotal, currency)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <button onClick={addLine} style={{
            marginTop: 10, padding: '6px 14px', borderRadius: 6, border: `1px dashed ${dark ? '#334155' : '#c4cedf'}`,
            background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}>+ Add line</button>
        </>
      )}

      {/* ── Step 3: Milestones ────────────────────────────── */}
      {step === 3 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: 'PO Date',           val: msPO,  set: setMsPO  },
            { label: 'FAT (Factory Acceptance)', val: msFAT, set: setMsFAT },
            { label: 'ESD (Ex Ship Date)', val: msESD, set: setMsESD },
            { label: 'ETA (Est. Arrival)', val: msETA, set: setMsETA },
            { label: 'ROS (Required on Site)', val: msROS, set: setMsROS },
          ].map(m => (
            <Field key={m.label} label={m.label} dark={dark}>
              <input value={m.val} onChange={e => m.set(e.target.value)} type="date" style={inp(dark)} />
            </Field>
          ))}
        </div>
      )}

      {/* Error */}
      {err && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{err}</div>
      )}

      {/* Footer buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
        {step > 1 && (
          <button onClick={() => setStep(s => s - 1)} style={{ padding: '7px 16px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: dark ? '#94a3b8' : '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            ← Back
          </button>
        )}
        <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: dark ? '#94a3b8' : '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
        {step < 3 ? (
          <button onClick={next} style={{ padding: '7px 20px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Next →
          </button>
        ) : (
          <button onClick={submit} disabled={saving} style={{ padding: '7px 20px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Creating…' : 'Create PO'}
          </button>
        )}
      </div>
    </Modal>
  )
}

// ─── PO DETAIL VIEW ───────────────────────────────────────────

interface PODetailProps {
  poId: number
  dark: boolean
  onClose: () => void
  onUpdated: () => void
}

const PODetail = ({ poId, dark, onClose, onUpdated }: PODetailProps) => {
  const { addToast } = useToast()
  const [po, setPO]     = useState<PO & { lines: POLine[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [showApproveConfirm, setShowApproveConfirm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/procurement/pos/${poId}`)
      setPO(data)
    } finally { setLoading(false) }
  }, [poId])

  useEffect(() => { load() }, [load])

  const approve = async () => {
    setApproving(true)
    try {
      await axios.patch(`${API}/procurement/pos/${poId}/approve`)
      addToast('success', `PO ${po?.po_number} approved & locked`)
      setShowApproveConfirm(false)
      load()
      onUpdated()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } }; message?: string }
      addToast('error', er.response?.data?.error ?? 'Approval failed')
    } finally { setApproving(false) }
  }

  const col = dark ? '#f1f5f9' : '#0f172a'

  if (loading || !po) return (
    <Modal dark={dark} onClose={onClose} wide>
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>Loading…</div>
    </Modal>
  )

  const totalValue = po.lines?.reduce((s, l) => s + ((l.qty ?? 0) * (l.unit_price ?? 0)), 0) ?? 0

  return (
    <Modal dark={dark} onClose={onClose} wide>
      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, fontWeight: 700, color: col }}>{po.po_number}</span>
            {po.isCriticalPath && <span title="Critical path" style={{ color: '#f59e0b', fontSize: 14 }}>⭐</span>}
            {po.isLocked && <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: 'rgba(34,197,94,0.1)', color: '#15803d', border: '1px solid rgba(34,197,94,0.3)' }}>LOCKED</span>}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: col }}>{po.po_name ?? po.vendor_name}</div>
          {po.description && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{po.description}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {!po.isLocked && (
            <button onClick={() => setShowApproveConfirm(true)} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#15803d', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Approve & Lock
            </button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      </div>

      {/* ── Status banner ──────────────────────────────────── */}
      {!po.isLocked && po.status === 'rfq' && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '8px 14px', marginBottom: 16, fontSize: 12, color: '#b45309' }}>
          Pending approval — this PO has not yet been approved or locked.
        </div>
      )}
      {po.isLocked && (
        <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, padding: '8px 14px', marginBottom: 16, fontSize: 12, color: '#15803d' }}>
          Approved & locked — this PO cannot be edited.
        </div>
      )}

      {/* ── Meta grid (4-col × 2 rows) ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Currency',       val: po.currency },
          { label: 'Total Value',    val: fmtCurrency(po.value ?? totalValue, po.currency) },
          { label: 'Incoterms',      val: po.incoterms ?? '—' },
          { label: 'WBS',            val: po.wbs_code ?? '—', mono: true },
          { label: 'Vendor',         val: po.supplier_name ?? po.vendor_name },
          { label: 'Owner',          val: po.owner_name ?? '—' },
          { label: 'ROS Date',       val: fmtDate(po.ros_date) },
          { label: 'Status',         val: po.statusLabel },
        ].map(m => (
          <div key={m.label} style={{ padding: '10px 14px', borderRadius: 6, background: dark ? '#0f172a' : '#f4f7fb', border: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: col, fontFamily: m.mono ? 'JetBrains Mono, monospace' : 'inherit' }}>{m.val}</div>
          </div>
        ))}
      </div>

      {/* ── Milestones ─────────────────────────────────────── */}
      {(po.milestone_po_date || po.milestone_fat_date || po.milestone_esd_date || po.milestone_eta_date || po.milestone_ros_date) && (
        <>
          <SectionHdr dark={dark}>Milestones</SectionHdr>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {[
              { label: 'PO',  date: po.milestone_po_date },
              { label: 'FAT', date: po.milestone_fat_date },
              { label: 'ESD', date: po.milestone_esd_date },
              { label: 'ETA', date: po.milestone_eta_date },
              { label: 'ROS', date: po.milestone_ros_date },
            ].map(m => (
              <div key={m.label} style={{ padding: '8px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, minWidth: 100 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: m.date ? col : '#94a3b8' }}>{fmtDate(m.date)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Line Items ─────────────────────────────────────── */}
      <SectionHdr dark={dark}>Line Items</SectionHdr>
      {po.lines?.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: dark ? '#0f172a' : '#f4f7fb', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
                {['Line','Description','Qty','UoM','Unit Value','Total Value'].map(h => (
                  <th key={h} style={{ padding: '7px 10px', fontWeight: 600, color: '#64748b', textAlign: h === 'Description' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
                  <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', color: '#64748b', fontSize: 11, textAlign: 'right' }}>{l.line_number}</td>
                  <td style={{ padding: '8px 10px', color: col }}>{l.description}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right', color: col }}>{l.qty ?? '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>{l.uom}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right', color: col }}>{l.unit_price != null ? fmtCurrency(l.unit_price, po.currency) : '—'}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right', color: col, fontWeight: 600 }}>
                    {l.qty != null && l.unit_price != null ? fmtCurrency(l.qty * l.unit_price, po.currency) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${dark ? '#334155' : '#dde3ed'}` }}>
                <td colSpan={5} style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: col }}>Total</td>
                <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 13, color: col }}>
                  {fmtCurrency(totalValue, po.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No line items</div>
      )}

      {/* ── Approve confirmation ────────────────────────────── */}
      {showApproveConfirm && createPortal(
        <div onClick={() => setShowApproveConfirm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 28, width: 400, boxShadow: '0 16px 48px rgba(0,0,0,0.4)', fontFamily: 'IBM Plex Sans, sans-serif', border: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: col, marginBottom: 10 }}>Approve & Lock PO?</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
              This will lock <strong>{po.po_number}</strong> for editing and pass it to Expediting. This action cannot be undone.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowApproveConfirm(false)} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={approve} disabled={approving} style={{ padding: '7px 20px', borderRadius: 6, border: 'none', background: '#15803d', color: '#fff', fontSize: 12, fontWeight: 600, cursor: approving ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: approving ? 0.7 : 1 }}>
                {approving ? 'Approving…' : 'Approve & Lock'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </Modal>
  )
}

// ─── PO TABLE ROW ─────────────────────────────────────────────

const PORow = ({ po, dark, onStar, onClick }: {
  po: PO; dark: boolean; onStar: (id: number) => void; onClick: (po: PO) => void
}) => {
  const [hovered, setHovered] = useState(false)

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? (dark ? '#1e2d4a' : '#f4f7fb') : (dark ? '#1e293b' : '#fff'), transition: 'background 100ms', cursor: 'pointer' }}>

      {/* ⭐ star */}
      <td onClick={e => { e.stopPropagation(); onStar(po.id) }} style={{ padding: '10px 8px', textAlign: 'center', width: 28 }}>
        <span title={po.isCriticalPath ? 'Critical path' : 'Mark critical'} style={{ color: po.isCriticalPath ? '#f59e0b' : (hovered ? '#c4cedf' : 'transparent'), cursor: 'pointer', fontSize: 13 }}>⭐</span>
      </td>

      {/* PO Ref */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {po.po_number}
        {po.isLocked && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: '#15803d', fontFamily: 'IBM Plex Sans, sans-serif', letterSpacing: '0.05em' }}>LOCKED</span>}
      </td>

      {/* PO Name */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: dark ? '#f1f5f9' : '#0f172a', fontSize: 13 }} title={po.po_name ?? ''}>
        {po.po_name ?? '—'}
      </td>

      {/* Description */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#64748b', fontSize: 12 }} title={po.description ?? ''}>
        {po.description ?? '—'}
      </td>

      {/* CCY */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
        {po.currency}
      </td>

      {/* Value */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: dark ? '#f1f5f9' : '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {fmtCurrency(po.value, po.currency)}
      </td>

      {/* Incoterms */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
        {po.incoterms ?? '—'}
      </td>

      {/* WBS */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
        {po.wbs_code ?? '—'}
      </td>

      {/* ROS */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
        {fmtDate(po.ros_date)}
      </td>

      {/* Vendor */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', fontSize: 13, color: dark ? '#f1f5f9' : '#0f172a', whiteSpace: 'nowrap' }}>
        {po.supplier_name ?? po.vendor_name}
      </td>

      {/* Owner */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
        {po.owner_name ?? '—'}
      </td>

      {/* Status */}
      <td onClick={() => onClick(po)} style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>
        <StatusPill status={po.status} label={po.statusLabel} />
      </td>
    </tr>
  )
}

// ─── HELP MODAL ───────────────────────────────────────────────

const HelpModal = ({ dark, onClose }: { dark: boolean; onClose: () => void }) => {
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sec = { fontSize: 11, fontWeight: 700 as const, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 6, marginTop: 16 }
  const row = { display: 'flex', gap: 8, marginBottom: 6, fontSize: 12 }
  const key = { fontWeight: 600 as const, color: col, minWidth: 120, flexShrink: 0 as const }
  const val = { color: '#64748b' }
  return (
    <Modal dark={dark} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: col }}>Procurement — Help</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>PO Register — purchase order tracking and management.</div>

      <div style={sec}>View Tabs</div>
      <div style={row}><span style={key}>All POs</span><span style={val}>All purchase orders for this project.</span></div>
      <div style={row}><span style={key}>Approved</span><span style={val}>POs that have been approved and locked.</span></div>
      <div style={row}><span style={key}>Pending approval</span><span style={val}>POs in Draft/Letter of Award status awaiting approval.</span></div>
      <div style={row}><span style={key}>Completed</span><span style={val}>Closed POs.</span></div>

      <div style={sec}>Columns</div>
      <div style={row}><span style={key}>⭐ Star</span><span style={val}>Toggle critical-path flag on a PO. Use "Critical Path Only" filter to show only starred POs.</span></div>
      <div style={row}><span style={key}>PO Ref</span><span style={val}>Unique PO reference number. LOCKED badge = approved and locked.</span></div>
      <div style={row}><span style={key}>Value</span><span style={val}>Total PO value in the PO's currency.</span></div>
      <div style={row}><span style={key}>Incoterms</span><span style={val}>Trade term governing handover of goods (CIF, FOB, EXW, etc.).</span></div>
      <div style={row}><span style={key}>ROS</span><span style={val}>Required on Site date at PO header level.</span></div>

      <div style={sec}>Actions</div>
      <div style={row}><span style={key}>+ New PO</span><span style={val}>3-step wizard: Header → Line Items → Milestones.</span></div>
      <div style={row}><span style={key}>Row click</span><span style={val}>Opens PO detail with meta grid, milestones, and line items.</span></div>
      <div style={row}><span style={key}>Approve & Lock</span><span style={val}>Available in PO detail for unlocked POs. Irreversible.</span></div>

      <div style={sec}>Status Colors</div>
      {Object.entries({ rfq: 'Pending approval', loa: 'Letter of Award', 'po-raised': 'Approved & Locked', active: 'Active', closed: 'Completed', cancelled: 'Cancelled' }).map(([s, l]) => (
        <div key={s} style={{ ...row, alignItems: 'center' }}>
          <StatusPill status={s as POStatus} label={l} />
          <span style={val}>{s === 'rfq' ? 'Default status for new POs.' : s === 'po-raised' ? 'Approved and locked — passes to Expediting.' : s === 'closed' ? 'Fully completed and closed.' : ''}</span>
        </div>
      ))}
    </Modal>
  )
}

// ─── PROCUREMENT INNER ────────────────────────────────────────
// Separated so useToast() can be called inside ToastProvider.

interface ProcurementInnerProps {
  dark: boolean
  projectId: number
  projectName: string
}

const ProcurementInner = ({ dark, projectId, projectName }: ProcurementInnerProps) => {
  const { addToast } = useToast()

  const [stats,    setStats]    = useState<Stats | null>(null)
  const [pos,      setPOs]      = useState<PO[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  const [activeTab,    setActiveTab]    = useState<'all'|'approved'|'pending'|'completed'>('all')
  const [search,       setSearch]       = useState('')
  const [criticalOnly, setCriticalOnly] = useState(false)

  const [showNew,   setShowNew]   = useState(false)
  const [showHelp,  setShowHelp]  = useState(false)
  const [detailId,  setDetailId]  = useState<number | null>(null)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [uoms,      setUoms]      = useState<UOMItem[]>([])
  const [users,     setUsers]     = useState<UserItem[]>([])
  const [wbsNodes,  setWbsNodes]  = useState<WBSNode[]>([])

  const col = dark ? '#f1f5f9' : '#0f172a'

  // ── Load reference data once ──
  useEffect(() => {
    axios.get(`${API}/admin/suppliers?limit=200`).then(r => setSuppliers(r.data.rows ?? r.data)).catch(() => {})
    axios.get(`${API}/admin/uom?limit=200`).then(r => setUoms(r.data.rows ?? r.data)).catch(() => {})
    axios.get(`${API}/procurement/users/list`).then(r => setUsers(r.data)).catch(() => {})
    axios.get(`${API}/procurement/${projectId}/wbs`).then(r => setWbsNodes(r.data)).catch(() => {})
  }, [projectId])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params: Record<string, string> = {}
      if (activeTab !== 'all') params.status = activeTab
      if (criticalOnly)        params.critical = '1'
      if (search)              params.search = search

      const [statsRes, posRes] = await Promise.all([
        axios.get(`${API}/procurement/${projectId}/stats`),
        axios.get(`${API}/procurement/${projectId}/pos`, { params }),
      ])
      setStats(statsRes.data)
      setPOs(posRes.data)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } }; message?: string }
      setError(er.response?.data?.error ?? er.message ?? 'Load failed')
    } finally { setLoading(false) }
  }, [projectId, activeTab, criticalOnly, search])

  useEffect(() => { load() }, [load])

  const toggleStar = async (id: number) => {
    try {
      const { data } = await axios.patch(`${API}/procurement/pos/${id}/star`)
      setPOs(prev => prev.map(p => p.id === id ? { ...p, isCriticalPath: data.isCriticalPath } : p))
    } catch { addToast('error', 'Could not update critical path flag') }
  }

  const exportCSV = () => {
    const headers = ['PO Ref','PO Name','Description','CCY','Value','Incoterms','WBS','ROS','Vendor','Owner','Status']
    const rows = pos.map(p => [
      p.po_number, p.po_name ?? '', p.description ?? '',
      p.currency, String(p.value ?? ''), p.incoterms ?? '', p.wbs_code ?? '',
      p.ros_date ?? '', p.supplier_name ?? p.vendor_name, p.owner_name ?? '', p.statusLabel,
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v.replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    a.download = `PO-Register-${projectId}.csv`
    a.click()
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: active ? 600 : 400,
    cursor: 'pointer', border: 'none', fontFamily: 'inherit',
    background: active ? (dark ? '#334155' : '#e2e8f0') : 'transparent',
    color: active ? col : '#94a3b8',
    transition: 'all 120ms',
  })

  const TABLE_COLS = ['⭐','PO Ref','PO Name','Description','CCY','Value','Incoterms','WBS','ROS','Vendor','Owner','Status']

  return (
    <div style={{ fontFamily: 'IBM Plex Sans, sans-serif', padding: '0 0 24px' }}>
      <ToastContainer />

      {/* ── Page header ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, paddingTop: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>PO Register</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{projectName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowHelp(true)} title="Help" style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f4f7fb', color: '#94a3b8', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>ℹ</button>
          <button onClick={exportCSV} style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f4f7fb', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↓ Export</button>
          <button onClick={() => setShowNew(true)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ New PO</button>
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <StatCard dark={dark} label="Total POs"            value={stats ? String(stats.totalPOs) : '—'} />
        <StatCard dark={dark} label="Committed Value (AUD)" value={stats ? fmtCurrency(stats.committedValue, 'AUD') : '—'} sub="across all currencies" />
        <StatCard dark={dark} label="Approved & Locked"    value={stats ? fmtCurrency(stats.approvedValue, 'AUD') : '—'} accent="#15803d" />
        <StatCard dark={dark} label="Pending Approval"     value={stats ? String(stats.pendingCount) : '—'} accent={stats && stats.pendingCount > 0 ? '#b45309' : undefined} />
      </div>

      {/* ── View tabs ───────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, overflowX: 'auto', paddingBottom: 2 }}>
        <button style={tabStyle(activeTab === 'all')}       onClick={() => setActiveTab('all')}>All POs</button>
        <button style={tabStyle(activeTab === 'approved')}  onClick={() => setActiveTab('approved')}>Approved</button>
        <button style={tabStyle(activeTab === 'pending')}   onClick={() => setActiveTab('pending')}>Pending approval</button>
        <button style={tabStyle(activeTab === 'completed')} onClick={() => setActiveTab('completed')}>✓ Completed</button>
      </div>

      {/* ── Filter toolbar ──────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search PO ref, name, vendor, WBS, owner…"
          style={{ ...inp(dark), width: 320, height: 30 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={criticalOnly} onChange={e => setCriticalOnly(e.target.checked)} style={{ cursor: 'pointer' }} />
          ⭐ Critical path only
        </label>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>
          {loading ? 'Loading…' : `${pos.length} PO${pos.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────── */}
      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 6, fontSize: 13, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>
      )}

      {/* ── Table ───────────────────────────────────────────── */}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: dark ? '#0f172a' : '#f4f7fb', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
                {TABLE_COLS.map(h => (
                  <th key={h} style={{
                    padding: '8px 8px', fontSize: 11, fontWeight: 700, color: '#64748b',
                    textAlign: ['⭐','CCY','Value','Incoterms'].includes(h) ? 'center' : 'left',
                    whiteSpace: 'nowrap', letterSpacing: '0.04em', borderRight: `1px solid ${dark ? '#334155' : '#e8ecf2'}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={TABLE_COLS.length} style={{ padding: '32px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</td></tr>
              )}
              {!loading && pos.length === 0 && (
                <tr><td colSpan={TABLE_COLS.length} style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No purchase orders found</td></tr>
              )}
              {pos.map(po => (
                <PORow key={po.id} po={po} dark={dark}
                  onStar={toggleStar}
                  onClick={p => setDetailId(p.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────── */}
      {showNew && (
        <NewPOWizard
          dark={dark} projectId={projectId}
          suppliers={suppliers} uoms={uoms} users={users} wbsNodes={wbsNodes}
          onClose={() => setShowNew(false)}
          onCreated={() => load()}
        />
      )}
      {showHelp && <HelpModal dark={dark} onClose={() => setShowHelp(false)} />}
      {detailId != null && (
        <PODetail poId={detailId} dark={dark}
          onClose={() => setDetailId(null)}
          onUpdated={() => load()}
        />
      )}
    </div>
  )
}

// ─── PROCUREMENT EXPORT ───────────────────────────────────────
// Wraps ProcurementInner in ToastProvider so useToast() works.

export interface ProcurementProps {
  dark: boolean
  projectId: number
  projectName: string
}

export const Procurement = ({ dark, projectId, projectName }: ProcurementProps) => (
  <ToastProvider>
    <ProcurementInner dark={dark} projectId={projectId} projectName={projectName} />
  </ToastProvider>
)
