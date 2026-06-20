// ─── PO DETAIL SCREEN — PHASE 3 ──────────────────────────────────────────────
// Full dedicated screen (not a modal, not a drawer) at:
//   /project/:projectId/procurement/:poId
// Tabs: Line Items · Key Dates · ITP · Documents · Action Notes · Variations · Audit Trail
// Displays complete PO information with inline editing for pending POs.
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { HelpButton } from '../components/HelpDrawer'
import { PO_DETAIL_HELP } from '../helpContent'
import { BackButton } from '../components/BackButton'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'

// Resizable column defaults — PO line items (12 + optional edit-actions col).
const POL_W   = [60, 240, 70, 60, 90, 90, 100, 110, 100, 100, 100, 110, 60]
const POL_MIN = [50, 120, 50, 50, 70, 70, 80, 80, 70, 80, 80, 80, 50]

import { API } from '../lib/api'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface PO {
  id: number; po_number: string; po_name: string | null; description: string | null
  vendor_name: string; supplier_name: string | null; currency: string; value: number | null
  incoterms: string | null; handover_point: string | null; wbs_code: string | null; wbs_name: string | null
  ros_date: string | null; status: string; statusLabel: string
  isCriticalPath: boolean; isLocked: boolean; group_category: string | null
  owner_id: number | null; owner_name: string | null
  expeditor_id: number | null; expeditor_name: string | null
  expeditor_names?: string[]   // all assigned expeditors (co-assignment)
  project_id: number; created_at: string; created_by: number | null
  milestone_po_date: string | null; milestone_fat_date: string | null
  milestone_esd_date: string | null; milestone_eta_date: string | null
  milestone_ros_date: string | null
  contract_delivery_date: string | null
  lines: POLine[]
  approvals: POApproval[]
  signedDoc: SignedDoc | null
  atRiskDays: number
}

interface POLine {
  id: number; po_id: number; line_number: string; description: string
  qty: number | null; uom: string; unit_price: number | null; total_price: number | null
  received_to_date?: number | null; remaining_qty?: number | null  // Phase 4: derived from receipt_lines
  ros_date: string | null; cdd: string | null; wbs_code: string | null
  heat_number_required: number; status: string; tag_number: string | null
  vdrl_required: number; cert_required: string | null
}

interface POApproval {
  id: number; approval_level: number; status: string; approver_name: string
  decision_at: string | null; decision_note: string | null
}

interface SignedDoc {
  id: number; file_name: string; file_size_bytes: number
  version: number; uploaded_at: string; uploaded_by_name: string
}

interface ActionNote {
  id: number; note_text: string; note_type: string; is_internal: number
  created_at: string; author_name: string; author_role: string
}

interface Variation {
  id: number; variation_number: string; reason: string; status: string
  requested_by_name: string; approved_by_name: string | null
  value_impact: number | null; schedule_impact_days: number | null; created_at: string
}

interface ITPRequirement {
  id: number; description: string; inspection_type: string; is_mandatory: number
  created_by_name: string; items: ITPItem[]
}

interface ITPItem {
  id: number; item_number: string; description: string; status: string
  actioned_by_name: string | null; actioned_at: string | null; notes: string | null
}

interface DateHistory {
  id: number; field_name: string; old_value: string | null; new_value: string | null
  change_reason: string; changed_by_name: string; created_at: string
}

interface DocRecord {
  id: number; doc_type: string; file_name: string; file_size_bytes: number
  version: number; is_current: number; uploaded_at: string
  uploaded_by_name: string; notes: string | null
}

interface AuditEntry {
  id: number; action: string; resource: string; user_name: string; user_role: string
  before_value: unknown; after_value: unknown; created_at: string
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDateTime(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtCurrency(val: number | null, ccy = 'AUD') {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy, maximumFractionDigits: 0 }).format(val)
}

// ─── FIX 1: fmtValueCode — "AUD 1,420,000" format (code prefix not $ symbol)
function fmtValueCode(val: number | null, ccy = 'AUD') {
  if (val == null) return '—'
  return `${ccy} ${Math.round(val).toLocaleString('en-AU')}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// ─── SHARED STYLES ────────────────────────────────────────────────────────────

const inp = (dark: boolean): React.CSSProperties => ({
  height: 32, padding: '0 10px', borderRadius: 6,
  border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
  background: dark ? '#0f172a' : '#fff', color: dark ? '#f1f5f9' : '#0f172a',
  fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif', outline: 'none',
  width: '100%', boxSizing: 'border-box' as const,
})

// ─── STATUS PILL ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  rfq:                       { bg: 'rgba(245,158,11,0.12)',  text: '#b45309' },
  'po-raised':               { bg: 'rgba(34,197,94,0.12)',   text: '#15803d' },
  active:                    { bg: 'rgba(37,99,235,0.12)',   text: '#2563eb' },
  closed:                    { bg: 'rgba(100,116,139,0.12)', text: '#475569' },
  cancelled:                 { bg: 'rgba(239,68,68,0.12)',   text: '#dc2626' },
  pending_approval:          { bg: 'rgba(245,158,11,0.12)',  text: '#b45309' },
  pending_director_approval: { bg: 'rgba(234,88,12,0.12)',   text: '#c2410c' },
  approved:                  { bg: 'rgba(34,197,94,0.12)',   text: '#15803d' },
  rejected:                  { bg: 'rgba(239,68,68,0.12)',   text: '#dc2626' },
  draft:                     { bg: 'rgba(100,116,139,0.12)', text: '#475569' },
}
const StatusPill = ({ status, label }: { status: string; label: string }) => {
  const c = STATUS_COLORS[status] ?? { bg: 'rgba(100,116,139,0.12)', text: '#475569' }
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text, whiteSpace: 'nowrap' }}>{label}</span>
}

// ─── META GRID ITEM ───────────────────────────────────────────────────────────

const MetaItem = ({ label, value, mono, dark }: { label: string; value: string | null; mono?: boolean; dark: boolean }) => (
  <div style={{ padding: '10px 14px', borderRadius: 6, background: dark ? '#0f172a' : '#f4f7fb', border: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
    <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 600, color: dark ? '#f1f5f9' : '#0f172a', fontFamily: mono ? 'JetBrains Mono, monospace' : 'IBM Plex Sans, sans-serif' }}>
      {value ?? '—'}
    </div>
  </div>
)

// ─── TAB BAR ──────────────────────────────────────────────────────────────────

type Tab = 'lines' | 'dates' | 'itp' | 'documents' | 'notes' | 'variations' | 'audit'
const TABS: { key: Tab; label: string }[] = [
  { key: 'lines',      label: 'Line Items'   },
  { key: 'dates',      label: 'Key Dates'    },
  { key: 'itp',        label: 'ITP'          },
  { key: 'documents',  label: 'Documents'    },
  { key: 'notes',      label: 'Action Notes' },
  { key: 'variations', label: 'Variations'   },
  { key: 'audit',      label: 'Audit Trail'  },
]

// ─── APPROVE WIZARD ───────────────────────────────────────────────────────────
// 2-step wizard: Review → Success. Shown when user clicks Approve & Lock.

const ApproveWizard = ({ po, dark, onClose, onApproved }: {
  po: PO; dark: boolean; onClose: () => void; onApproved: () => void
}) => {
  const { addToast } = useToast()
  const [step, setStep]           = useState(1)
  const [check1, setCheck1]       = useState(false)
  const [check2, setCheck2]       = useState(false)
  const [check3, setCheck3]       = useState(false)
  const [chainNote, setChainNote] = useState('')
  const [approving, setApproving] = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const lineTotal = po.lines?.reduce((s, l) => s + ((l.qty ?? 0) * (l.unit_price ?? 0)), 0) ?? 0
  const displayValue = po.value ?? lineTotal

  const approve = async () => {
    setApproving(true)
    try {
      await axios.patch(`${API}/procurement/pos/${po.id}/approve`, { chain_note: chainNote })
      addToast('success', `PO ${po.po_number} approved & locked`)
      // FIX 2: setStep(2) BEFORE calling onApproved so React renders Step 2
      // before any parent state change can unmount this wizard.
      // onApproved() only reloads PO data — it no longer calls setShowApprove(false).
      // The wizard is dismissed by the Close button in Step 2 via onClose().
      setStep(2)
      onApproved()   // refreshes PO data in parent — does NOT close the wizard
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Approval failed')
    } finally { setApproving(false) }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 32, width: 560, maxWidth: '100%', boxShadow: '0 16px 48px rgba(0,0,0,0.4)', fontFamily: 'IBM Plex Sans, sans-serif', border: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
        {step === 1 ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 700, color: col, marginBottom: 4 }}>Approve & Lock PO</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 20 }}>Step 1 of 2 — Review & Confirm</div>

            {/* Summary card */}
            <div style={{ background: dark ? '#0f172a' : '#f4f7fb', borderRadius: 8, padding: '14px 16px', marginBottom: 20, border: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                {[
                  ['PO Reference', po.po_number], ['Vendor', po.supplier_name ?? po.vendor_name],
                  ['PO Name', po.po_name ?? '—'], ['Total Value', fmtCurrency(displayValue, po.currency)],
                  ['Incoterms', po.incoterms ?? '—'], ['Line Items', String(po.lines?.length ?? 0)],
                  ['ROS Date', fmtDate(po.ros_date)], ['WBS', po.wbs_code ?? '—'],
                ].map(([l, v]) => (
                  <div key={l}><span style={{ color: '#94a3b8' }}>{l}: </span><span style={{ fontWeight: 600, color: col }}>{v}</span></div>
                ))}
              </div>
            </div>

            {/* Checkboxes */}
            {[
              { id: 'c1', checked: check1, set: setCheck1, text: `I have reviewed all ${po.lines?.length ?? 0} line items, quantities, UOM and unit values.` },
              { id: 'c2', checked: check2, set: setCheck2, text: `I confirm the total PO value of ${fmtCurrency(displayValue, po.currency)} is correct.` },
              { id: 'c3', checked: check3, set: setCheck3, text: 'I understand that once approved, this PO will be locked — any future changes require a Variation Request.' },
            ].map(({ id, checked, set, text }) => (
              <label key={id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={checked} onChange={e => set(e.target.checked)} style={{ marginTop: 2, accentColor: '#22c55e', cursor: 'pointer' }} />
                <span style={{ fontSize: 13, color: checked ? '#22c55e' : col, transition: 'color 150ms' }}>{text}</span>
              </label>
            ))}

            {/* Note */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>Note to Expediting (optional)</label>
              <textarea
                value={chainNote}
                onChange={e => setChainNote(e.target.value)}
                placeholder="Any notes for the expediting team…"
                style={{ ...inp(dark), height: 72, resize: 'vertical', padding: '8px 10px', lineHeight: 1.5 }}
              />
            </div>

            {/* Warning */}
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 20, fontSize: 12, color: '#dc2626' }}>
              ⚠ This action cannot be undone. The PO will be locked for editing.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button
                onClick={approve}
                disabled={!(check1 && check2 && check3) || approving}
                style={{ padding: '7px 20px', borderRadius: 6, border: 'none', background: '#15803d', color: '#fff', fontSize: 12, fontWeight: 600, cursor: (!(check1 && check2 && check3) || approving) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!(check1 && check2 && check3) || approving) ? 0.5 : 1 }}>
                🔒 {approving ? 'Approving…' : 'Approve & lock PO'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#15803d', marginBottom: 8 }}>PO Approved & Locked</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
                {po.po_number} has been approved and passed to Expediting.
              </div>
              <div style={{ background: dark ? '#0f172a' : '#f4f7fb', borderRadius: 8, padding: '14px 16px', marginBottom: 24, textAlign: 'left', fontSize: 12, color: '#64748b' }}>
                <div style={{ fontWeight: 700, color: col, marginBottom: 8 }}>What happens next:</div>
                <div>✓ PO is now locked — read-only for all users</div>
                <div>✓ Expediting module can begin milestone monitoring</div>
                <div>✓ Audit log has been updated with this approval</div>
                <div>✓ Any future changes require a Variation Request</div>
              </div>
              <button onClick={onClose} style={{ padding: '8px 24px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── LINE ITEMS TAB ───────────────────────────────────────────────────────────

const LineItemsTab = ({ po, dark, onRefresh }: { po: PO; dark: boolean; onRefresh: () => void }) => {
  const { addToast } = useToast()
  const [editMode, setEditMode] = useState(false)
  const [lines, setLines]       = useState<POLine[]>(po.lines ?? [])
  const [saving, setSaving]     = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const borderCol = dark ? '#334155' : '#dde3ed'

  // Sync lines when PO data updates
  useEffect(() => { setLines(po.lines ?? []) }, [po.lines])

  const grandTotal = lines.reduce((s, l) => s + ((l.qty ?? 0) * (l.unit_price ?? 0)), 0)

  const updateLine = (idx: number, field: keyof POLine, val: string | number | null) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: val } : l))
  }

  const addLine = () => {
    const newLine: Partial<POLine> = {
      id: -(Date.now()), po_id: po.id,
      line_number: String(lines.length + 1),
      description: '', qty: null, uom: 'EA', unit_price: null,
      ros_date: null, cdd: null, wbs_code: null,
      heat_number_required: 0, status: 'not-started', vdrl_required: 0,
    }
    setLines(prev => [...prev, newLine as POLine])
  }

  const deleteLine = async (line: POLine) => {
    if (line.id < 0) { setLines(prev => prev.filter(l => l.id !== line.id)); return }
    try {
      await axios.delete(`${API}/procurement/pos/${po.id}/lines/${line.id}`)
      setLines(prev => prev.filter(l => l.id !== line.id))
      addToast('success', `Line ${line.line_number} deleted`)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Delete failed')
    }
  }

  const saveAll = async () => {
    setSaving(true)
    try {
      for (const l of lines) {
        const body = { line_number: l.line_number, description: l.description, qty: l.qty, uom: l.uom, unit_price: l.unit_price, ros_date: l.ros_date, cdd: l.cdd }
        if (l.id < 0) {
          // New line
          await axios.post(`${API}/procurement/pos/${po.id}/lines`, body)
        } else {
          await axios.put(`${API}/procurement/pos/${po.id}/lines/${l.id}`, body)
        }
      }
      addToast('success', 'Line items saved')
      setEditMode(false)
      onRefresh()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Save failed')
    } finally { setSaving(false) }
  }

  const thStyle: React.CSSProperties = { padding: '8px 10px', fontWeight: 700, fontSize: 10, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: `1px solid ${borderCol}` }
  const rt = useResizableTable('po_lines', POL_W, POL_MIN)
  const tdStyle: React.CSSProperties = { padding: '0 10px', height: 44, verticalAlign: 'middle', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, fontSize: 13, color: col }

  return (
    <div>
      {/* ── Edit/Save toolbar ─────────────────────────────────────────────── */}
      {!po.isLocked && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 14 }}>
          {editMode ? (
            <>
              <button onClick={() => { setLines(po.lines ?? []); setEditMode(false) }} style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${borderCol}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={addLine} style={{ padding: '6px 14px', borderRadius: 6, border: `1px dashed ${borderCol}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                + Add line
              </button>
              <button onClick={saveAll} disabled={saving} style={{ padding: '6px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : '✓ Save changes'}
              </button>
            </>
          ) : (
            <button onClick={() => setEditMode(true)} style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${borderCol}`, background: 'none', color: col, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              ✎ Edit line items
            </button>
          )}
        </div>
      )}

      {/* ── Line items table ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="app-grid" style={{ ...rt.tableStyle, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: dark ? '#0f172a' : '#f4f7fb' }}>
            <tr>
              {['Line#', 'Description', 'Qty', 'UOM', 'Received', 'Remaining', 'Unit Value', 'Total Value', 'WBS', 'CDD', 'ROS', 'Heat No.'].map((h, i) => (
                <th key={h} style={{ ...rt.thStyle(i), ...thStyle }}>{h}{rt.handle(i, dark)}</th>
              ))}
              {editMode && <th style={{ ...rt.thStyle(12), ...thStyle }} />}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr><td colSpan={editMode ? 13 : 12} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '32px 0' }}>No line items</td></tr>
            )}
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', color: '#64748b' }}>
                  {editMode
                    ? <input value={l.line_number} onChange={e => updateLine(i, 'line_number', e.target.value)} style={{ ...inp(dark), width: 50, fontFamily: 'JetBrains Mono, monospace' }} />
                    : l.line_number
                  }
                </td>
                <td data-align="left" style={{ ...tdStyle, maxWidth: 280 }}>
                  {editMode
                    ? <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="Description" style={{ ...inp(dark), minWidth: 200 }} />
                    : <span title={l.description}>{l.description}</span>
                  }
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                  {editMode
                    ? <input type="number" value={l.qty ?? ''} onChange={e => updateLine(i, 'qty', e.target.value ? Number(e.target.value) : null)} style={{ ...inp(dark), width: 70, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }} />
                    : (l.qty ?? '—')
                  }
                </td>
                <td style={tdStyle}>
                  {editMode
                    ? <select value={l.uom} onChange={e => updateLine(i, 'uom', e.target.value)} style={{ ...inp(dark), width: 70 }}>
                        {['EA','M','M2','M3','KG','T','LT','SET','LOT'].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    : l.uom
                  }
                </td>
                {/* Phase 4: received-to-date + remaining, derived from receipt_lines (read-only) */}
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: Number(l.received_to_date) > 0 ? '#2563eb' : '#94a3b8' }}>
                  {Number(l.received_to_date ?? 0)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: Number(l.remaining_qty ?? l.qty ?? 0) === 0 ? '#16a34a' : '#d97706' }}>
                  {Number(l.remaining_qty ?? l.qty ?? 0)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                  {editMode
                    ? <input type="number" value={l.unit_price ?? ''} onChange={e => updateLine(i, 'unit_price', e.target.value ? Number(e.target.value) : null)} style={{ ...inp(dark), width: 100, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }} />
                    : (l.unit_price != null ? fmtCurrency(l.unit_price, po.currency) : '—')
                  }
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                  {l.qty != null && l.unit_price != null ? fmtCurrency(l.qty * l.unit_price, po.currency) : '—'}
                </td>
                <td data-align="left" style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b' }}>{l.wbs_code ?? '—'}</td>
                <td data-align="center" style={{ ...tdStyle, fontSize: 12, color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
                  {editMode
                    ? <input type="date" value={l.cdd?.slice(0,10) ?? ''} onChange={e => updateLine(i, 'cdd', e.target.value || null)} style={{ ...inp(dark), width: 130 }} />
                    : fmtDate(l.cdd)
                  }
                </td>
                <td data-align="center" style={{ ...tdStyle, fontSize: 12, color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>
                  {editMode
                    ? <input type="date" value={l.ros_date?.slice(0,10) ?? ''} onChange={e => updateLine(i, 'ros_date', e.target.value || null)} style={{ ...inp(dark), width: 130 }} />
                    : fmtDate(l.ros_date)
                  }
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {l.heat_number_required ? <span style={{ fontSize: 10, fontWeight: 700, color: '#E84E0F' }}>REQ</span> : <span style={{ color: '#94a3b8' }}>—</span>}
                </td>
                {editMode && (
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {lines.length > 1 && (
                      <button onClick={() => deleteLine(l)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2 }}>×</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: `2px solid ${borderCol}` }}>
                <td colSpan={7} style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: col, fontSize: 13 }}>Grand Total</td>
                <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14, color: col }}>
                  {fmtCurrency(grandTotal, po.currency)}
                </td>
                <td colSpan={editMode ? 5 : 4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// ─── KEY DATES TAB ────────────────────────────────────────────────────────────

const KeyDatesTab = ({ po, dark, onRefresh }: { po: PO; dark: boolean; onRefresh: () => void }) => {
  const { addToast } = useToast()
  const [history, setHistory]           = useState<DateHistory[]>([])
  const [expandedField, setExpanded]    = useState<string | null>(null)
  const [editField, setEditField]       = useState<string | null>(null)
  const [editValue, setEditValue]       = useState('')
  const [editReason, setEditReason]     = useState('')
  const [saving, setSaving]             = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'

  useEffect(() => {
    axios.get(`${API}/procurement/pos/${po.id}/date-history`)
      .then(r => setHistory(r.data))
      .catch(() => {})
  }, [po.id])

  const DATE_FIELDS = [
    { key: 'milestone_po_date',  label: 'PO Placed / Award Date'       },
    { key: 'milestone_fat_date', label: 'FAT (Factory Acceptance Test)' },
    { key: 'milestone_esd_date', label: 'ESD (Ex-Ship Date)'           },
    { key: 'milestone_eta_date', label: 'ETA (Est. Time of Arrival)'   },
    { key: 'milestone_ros_date', label: 'ROS (Required on Site)'       },
  ]

  const getFieldHistory = (field: string) => history.filter(h => h.field_name === field)
  const getFieldValue = (field: string): string | null => (po as Record<string, unknown>)[field] as string | null

  const saveDate = async () => {
    if (!editField || !editReason.trim()) {
      addToast('error', 'A reason is required for date changes')
      return
    }
    setSaving(true)
    try {
      await axios.put(`${API}/procurement/pos/${po.id}/dates`, {
        field: editField, value: editValue || null, reason: editReason.trim()
      })
      addToast('success', 'Date updated')
      setEditField(null); setEditValue(''); setEditReason('')
      onRefresh()
      const r = await axios.get(`${API}/procurement/pos/${po.id}/date-history`)
      setHistory(r.data)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Update failed')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {DATE_FIELDS.map(({ key, label }) => {
        const current    = getFieldValue(key)
        const fieldHist  = getFieldHistory(key)
        const isEditing  = editField === key
        const isExpanded = expandedField === key

        return (
          <div key={key} style={{ border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8, overflow: 'hidden' }}>
            {/* ── Date row header ────────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', background: dark ? '#0f172a' : '#f4f7fb' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 600, color: current ? col : '#94a3b8' }}>
                  {current ? fmtDate(current) : '— not set'}
                </div>
              </div>
              {fieldHist.length > 0 && (
                <button onClick={() => setExpanded(isExpanded ? null : key)} style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Changed {fieldHist.length} time{fieldHist.length !== 1 ? 's' : ''} {isExpanded ? '▴' : '▾'}
                </button>
              )}
              {!po.isLocked && !isEditing && (
                <button onClick={() => { setEditField(key); setEditValue(current?.slice(0,10) ?? ''); setEditReason('') }}
                  style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: col, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✎ Edit
                </button>
              )}
            </div>

            {/* ── Inline edit form ───────────────────────────────────────────── */}
            {isEditing && (
              <div style={{ padding: '14px 16px', borderTop: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#1e293b' : '#fff' }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div style={{ flex: '0 0 180px' }}>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>New Date</label>
                    <input type="date" value={editValue} onChange={e => setEditValue(e.target.value)} style={inp(dark)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>Reason for Change *</label>
                    <input value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="e.g. Supplier confirmed delay due to material shortage" style={inp(dark)} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setEditField(null); setEditReason('') }} style={{ padding: '5px 12px', borderRadius: 5, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                  <button onClick={saveDate} disabled={!editReason.trim() || saving} style={{ padding: '5px 14px', borderRadius: 5, border: 'none', background: '#2563eb', color: '#fff', fontSize: 11, fontWeight: 600, cursor: (!editReason.trim() || saving) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!editReason.trim() || saving) ? 0.5 : 1 }}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}

            {/* ── History log ────────────────────────────────────────────────── */}
            {isExpanded && fieldHist.length > 0 && (
              <div style={{ borderTop: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
                {fieldHist.map(h => (
                  <div key={h.id} style={{ display: 'flex', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, fontSize: 12, alignItems: 'flex-start' }}>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {fmtDate(h.old_value)} → {fmtDate(h.new_value)}
                    </div>
                    <div style={{ flex: 1, color: col }}>"{h.change_reason}"</div>
                    <div style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{h.changed_by_name} · {fmtDateTime(h.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── ITP TAB ──────────────────────────────────────────────────────────────────

const ITPTab = ({ po, dark }: { po: PO; dark: boolean }) => {
  const { addToast }  = useToast()
  const [reqs, setReqs]   = useState<ITPRequirement[]>([])
  const [loading, setLoad] = useState(true)
  const [showAdd, setAdd]  = useState(false)
  const [newDesc, setDesc] = useState('')
  const [newType, setType] = useState('review')
  const [saving, setSave]  = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'

  const load = useCallback(async () => {
    setLoad(true)
    try { const r = await axios.get(`${API}/procurement/pos/${po.id}/itp`); setReqs(r.data) }
    finally { setLoad(false) }
  }, [po.id])

  useEffect(() => { load() }, [load])

  const addReq = async () => {
    if (!newDesc.trim()) return
    setSave(true)
    try {
      await axios.post(`${API}/procurement/pos/${po.id}/itp`, { description: newDesc.trim(), inspection_type: newType })
      addToast('success', 'ITP requirement added')
      setDesc(''); setAdd(false); load()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Failed to add ITP requirement')
    } finally { setSave(false) }
  }

  const STATUS_DOT: Record<string, string> = { pending: '#94a3b8', passed: '#22c55e', failed: '#ef4444', waived: '#f59e0b' }
  const TYPE_LABEL: Record<string, string> = { witness: 'Witness Point', review: 'Review', hold_point: 'Hold Point', document: 'Document' }

  if (loading) return <div style={{ padding: '32px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading ITP…</div>

  return (
    <div>
      {!po.isLocked && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button onClick={() => setAdd(!showAdd)} style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: col, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Add ITP requirement
          </button>
        </div>
      )}

      {showAdd && (
        <div style={{ border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8, padding: '14px 16px', marginBottom: 16, background: dark ? '#1e293b' : '#fff' }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 2 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>Description *</label>
              <input value={newDesc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Dimensional inspection after fabrication" style={inp(dark)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>Type</label>
              <select value={newType} onChange={e => setType(e.target.value)} style={inp(dark)}>
                <option value="review">Review</option>
                <option value="witness">Witness Point</option>
                <option value="hold_point">Hold Point</option>
                <option value="document">Document</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setAdd(false)} style={{ padding: '5px 12px', borderRadius: 5, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={addReq} disabled={!newDesc.trim() || saving} style={{ padding: '5px 14px', borderRadius: 5, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 11, fontWeight: 600, cursor: (!newDesc.trim() || saving) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!newDesc.trim() || saving) ? 0.5 : 1 }}>
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {reqs.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No ITP requirements. Add inspection requirements above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reqs.map(req => (
            <div key={req.id} style={{ border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: dark ? '#0f172a' : '#f4f7fb' }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(37,99,235,0.1)', color: '#2563eb' }}>{TYPE_LABEL[req.inspection_type] ?? req.inspection_type}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: col, flex: 1 }}>{req.description}</span>
                {req.is_mandatory ? <span style={{ fontSize: 10, color: '#E84E0F', fontWeight: 700 }}>MANDATORY</span> : null}
              </div>
              {req.items?.length > 0 && (
                <div>
                  {req.items.map(item => (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderTop: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[item.status] ?? '#94a3b8', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#64748b', fontSize: 11 }}>{item.item_number}</span>
                      <span style={{ flex: 1, color: col }}>{item.description}</span>
                      <span style={{ color: '#94a3b8' }}>{item.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── DOCUMENTS TAB ────────────────────────────────────────────────────────────

const DocumentsTab = ({ po, dark }: { po: PO; dark: boolean }) => {
  const { addToast } = useToast()
  const [docs, setDocs]     = useState<DocRecord[]>([])
  const [loading, setLoad]  = useState(true)
  const [uploading, setUpl] = useState(false)
  const fileRef             = useRef<HTMLInputElement>(null)
  const col = dark ? '#f1f5f9' : '#0f172a'

  const loadDocs = useCallback(async () => {
    setLoad(true)
    try { const r = await axios.get(`${API}/procurement/pos/${po.id}/documents`); setDocs(r.data) }
    finally { setLoad(false) }
  }, [po.id])

  useEffect(() => { loadDocs() }, [loadDocs])

  const upload = async (file: File) => {
    setUpl(true)
    try {
      const form = new FormData(); form.append('file', file)
      await axios.post(`${API}/procurement/pos/${po.id}/documents`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      addToast('success', `${file.name} uploaded`)
      loadDocs()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Upload failed')
    } finally { setUpl(false) }
  }

  const download = async (doc: DocRecord) => {
    try {
      const res = await axios.get(`${API}/procurement/pos/${po.id}/documents/${doc.id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url; a.download = doc.file_name; a.click()
      URL.revokeObjectURL(url)
    } catch { addToast('error', 'Download failed') }
  }

  const TYPE_LABEL: Record<string, string> = { signed_po: 'Signed PO', amendment: 'Amendment', variation_order: 'Variation Order', correspondence: 'Correspondence', vendor_invoice: 'Vendor Invoice', other: 'Other' }

  return (
    <div>
      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: uploading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
          {uploading ? 'Uploading…' : '↑ Upload Signed PO'}
        </button>
      </div>
      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
      ) : docs.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No documents uploaded. Upload the signed PO above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {docs.map(doc => (
            <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8, background: dark ? '#0f172a' : '#f4f7fb' }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(232,78,15,0.1)', color: '#E84E0F' }}>{TYPE_LABEL[doc.doc_type] ?? doc.doc_type}</span>
              <span style={{ flex: 1, fontSize: 13, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.file_name}>{doc.file_name}</span>
              <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>v{doc.version} · {formatBytes(doc.file_size_bytes)} · {doc.uploaded_by_name}</span>
              <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(doc.uploaded_at)}</span>
              <button onClick={() => download(doc)} style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: col, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>↓ Download</button>
              {doc.is_current ? <span style={{ fontSize: 10, fontWeight: 700, color: '#15803d' }}>CURRENT</span> : <span style={{ fontSize: 10, color: '#94a3b8' }}>v{doc.version}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── ACTION NOTES TAB ─────────────────────────────────────────────────────────

const ActionNotesTab = ({ po, dark }: { po: PO; dark: boolean }) => {
  const { addToast } = useToast()
  const [notes, setNotes]     = useState<ActionNote[]>([])
  const [loading, setLoad]    = useState(true)
  const [newNote, setNew]     = useState('')
  const [posting, setPosting] = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'

  const load = useCallback(async () => {
    setLoad(true)
    try { const r = await axios.get(`${API}/procurement/pos/${po.id}/notes`); setNotes(r.data) }
    finally { setLoad(false) }
  }, [po.id])

  useEffect(() => { load() }, [load])

  const post = async () => {
    if (!newNote.trim()) return
    setPosting(true)
    try {
      await axios.post(`${API}/procurement/pos/${po.id}/notes`, { note_text: newNote.trim() })
      setNew(''); load()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Post failed')
    } finally { setPosting(false) }
  }

  return (
    <div>
      {/* ── Add note ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <textarea
          value={newNote}
          onChange={e => setNew(e.target.value)}
          placeholder="Add a note… (e.g. called supplier, vendor confirmed delay, document received)"
          style={{ ...inp(dark), height: 90, resize: 'vertical', padding: '10px', lineHeight: 1.55, marginBottom: 8 }}
          onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') post() }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>Ctrl + Enter to post</span>
          <button onClick={post} disabled={!newNote.trim() || posting} style={{ padding: '6px 18px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: (!newNote.trim() || posting) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!newNote.trim() || posting) ? 0.5 : 1 }}>
            {posting ? 'Posting…' : 'Post note'}
          </button>
        </div>
      </div>

      {/* ── Notes thread ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '24px 0' }}>Loading…</div>
      ) : notes.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '32px 0' }}>No notes yet. Add the first note above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...notes].reverse().map(n => (
            <div key={n.id} style={{ border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8, padding: '12px 16px', background: dark ? '#0f172a' : '#f4f7fb' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  {n.author_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: col }}>{n.author_name}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>{n.author_role.replace(/_/g, ' ')}</span>
                </div>
                <div style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>{fmtDateTime(n.created_at)}</div>
                {!n.is_internal && <span style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', padding: '1px 5px', borderRadius: 3, background: 'rgba(37,99,235,0.1)' }}>SHARED</span>}
              </div>
              <div style={{ fontSize: 13, color: col, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{n.note_text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── VARIATIONS TAB ───────────────────────────────────────────────────────────

const VariationsTab = ({ po, dark }: { po: PO; dark: boolean }) => {
  const { addToast } = useToast()
  const [variations, setVariations] = useState<Variation[]>([])
  const [loading, setLoad]          = useState(true)
  const [showAdd, setAdd]           = useState(false)
  const [reason, setReason]         = useState('')
  const [impact, setImpact]         = useState('')
  const [saving, setSave]           = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'

  const load = useCallback(async () => {
    setLoad(true)
    try { const r = await axios.get(`${API}/procurement/pos/${po.id}/variations`); setVariations(r.data) }
    finally { setLoad(false) }
  }, [po.id])

  useEffect(() => { load() }, [load])

  const addVariation = async () => {
    if (!reason.trim()) return
    setSave(true)
    try {
      await axios.post(`${API}/procurement/pos/${po.id}/variations`, {
        reason: reason.trim(),
        value_impact: impact ? Number(impact) : null,
      })
      addToast('success', 'Variation request raised')
      setReason(''); setImpact(''); setAdd(false); load()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Failed')
    } finally { setSave(false) }
  }

  const STATUS_C: Record<string, { bg: string; text: string }> = {
    draft:             { bg: 'rgba(100,116,139,0.12)', text: '#475569' },
    pending_approval:  { bg: 'rgba(245,158,11,0.12)',  text: '#b45309' },
    approved:          { bg: 'rgba(34,197,94,0.12)',   text: '#15803d' },
    rejected:          { bg: 'rgba(239,68,68,0.12)',   text: '#dc2626' },
    withdrawn:         { bg: 'rgba(100,116,139,0.12)', text: '#475569' },
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={() => setAdd(!showAdd)} style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: col, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          + Raise variation request
        </button>
      </div>

      {showAdd && (
        <div style={{ border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8, padding: '14px 16px', marginBottom: 16, background: dark ? '#1e293b' : '#fff' }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>Reason for Variation *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe the scope change or reason for this variation" style={{ ...inp(dark), height: 72, resize: 'vertical', padding: '8px 10px', lineHeight: 1.5 }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5 }}>Value Impact (AUD, optional)</label>
            <input type="number" value={impact} onChange={e => setImpact(e.target.value)} placeholder="e.g. 25000 or -10000" style={{ ...inp(dark), fontFamily: 'JetBrains Mono, monospace' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setAdd(false)} style={{ padding: '5px 12px', borderRadius: 5, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={addVariation} disabled={!reason.trim() || saving} style={{ padding: '5px 14px', borderRadius: 5, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 11, fontWeight: 600, cursor: (!reason.trim() || saving) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!reason.trim() || saving) ? 0.5 : 1 }}>
              {saving ? 'Raising…' : 'Raise variation'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
      ) : variations.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No variations raised against this PO.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {variations.map(v => {
            const c = STATUS_C[v.status] ?? STATUS_C.draft
            return (
              <div key={v.id} style={{ border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8, padding: '14px 16px', background: dark ? '#0f172a' : '#f4f7fb' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: col }}>{v.variation_number}</span>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, ...c }}>{v.status.replace(/_/g, ' ')}</span>
                  {v.value_impact != null && (
                    <span style={{ fontSize: 12, color: v.value_impact >= 0 ? '#ef4444' : '#22c55e', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                      {v.value_impact >= 0 ? '+' : ''}{fmtCurrency(v.value_impact, po.currency)}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>{fmtDateTime(v.created_at)} · {v.requested_by_name}</span>
                </div>
                <div style={{ fontSize: 13, color: col, lineHeight: 1.55 }}>{v.reason}</div>
                {v.approved_by_name && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
                    {v.status === 'approved' ? '✓ Approved' : '✕ Rejected'} by {v.approved_by_name}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── AUDIT TRAIL TAB ──────────────────────────────────────────────────────────

const AuditTrailTab = ({ po, dark }: { po: PO; dark: boolean }) => {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoad]    = useState(true)
  const col = dark ? '#f1f5f9' : '#0f172a'

  useEffect(() => {
    setLoad(true)
    axios.get(`${API}/procurement/pos/${po.id}/audit`)
      .then(r => setEntries(r.data.rows ?? []))
      .catch(() => {})
      .finally(() => setLoad(false))
  }, [po.id])

  const ACTION_COLORS: Record<string, string> = {
    po_created: '#15803d', po_updated: '#2563eb', po_approved: '#15803d',
    po_rejected: '#dc2626', critical_path_set: '#E84E0F', critical_path_cleared: '#94a3b8',
    expeditor_assigned: '#2563eb', note_added: '#94a3b8', variation_raised: '#b45309',
    date_changed: '#b45309', signed_po_uploaded: '#475569', signed_po_downloaded: '#94a3b8',
  }

  if (loading) return <div style={{ padding: '32px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading audit trail…</div>
  if (entries.length === 0) return <div style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No audit entries yet.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map(e => (
        <div key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 14px', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 6, background: dark ? '#0f172a' : '#f4f7fb' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: ACTION_COLORS[e.action] ?? '#94a3b8', flexShrink: 0, marginTop: 4 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: col }}>{e.action.replace(/_/g, ' ')}</span>
            {e.user_name && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>by {e.user_name}</span>}
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── PO DETAIL INNER ─────────────────────────────────────────────────────────

interface PODetailInnerProps {
  dark: boolean
  projectId: number
  projectName: string
  poId: number
  onBack: () => void
  onLeaf?: (ref: string | null) => void
}

const PODetailInner = ({ dark, poId, projectName, onBack, onLeaf }: PODetailInnerProps) => {
  const { addToast } = useToast()
  const [po, setPO]             = useState<PO | null>(null)
  // Report the PO ref up to the topbar breadcrumb (leaf segment); clear on unmount.
  useEffect(() => { onLeaf?.(po?.po_number ?? null); return () => onLeaf?.(null) }, [po?.po_number, onLeaf])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setTab]     = useState<Tab>('lines')
  const [showApprove, setApprove] = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const borderCol = dark ? '#334155' : '#dde3ed'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/procurement/pos/${poId}`)
      setPO(data)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Failed to load PO')
    } finally { setLoading(false) }
  }, [poId, addToast])

  // Silent reload — used after approval so the wizard stays mounted for Step 2
  const silentReload = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/procurement/pos/${poId}`)
      setPO(data)
    } catch { /* silent */ }
  }, [poId])

  useEffect(() => { load() }, [load])

  if (loading || !po) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#94a3b8', fontSize: 13 }}>
        {loading ? 'Loading PO…' : 'PO not found'}
      </div>
    )
  }

  const totalValue = po.lines?.reduce((s, l) => s + ((l.qty ?? 0) * (l.unit_price ?? 0)), 0) ?? 0

  const tabSty = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px', borderRadius: '6px 6px 0 0', fontSize: 13, fontWeight: active ? 600 : 400,
    cursor: 'pointer', border: 'none', fontFamily: 'inherit',
    background: active ? (dark ? '#1e293b' : '#fff') : 'transparent',
    color: active ? (dark ? '#f1f5f9' : '#0f172a') : '#94a3b8',
    borderBottom: active ? `2px solid #E84E0F` : '2px solid transparent',
    transition: 'all 120ms', marginBottom: -1,
  })

  return (
    <div style={{ fontFamily: 'IBM Plex Sans, sans-serif', paddingBottom: 40 }}>
      <ToastContainer />

      {/* ── Back ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 16, marginBottom: 8 }}>
        <BackButton onFallback={onBack} dark={dark} />
      </div>

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#94a3b8' }}>{po.po_number}</span>
            {po.isCriticalPath && <span style={{ color: '#f59e0b' }} title="Critical path">★</span>}
            <StatusPill status={po.status} label={po.statusLabel} />
            {po.isLocked && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', color: '#15803d' }}>LOCKED</span>}
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: col, margin: '0 0 4px', letterSpacing: '-0.02em' }}>{po.po_name ?? po.vendor_name}</h1>
          {po.description && <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{po.description}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <HelpButton screenName="PO Detail" sections={PO_DETAIL_HELP} dark={dark} />
          {!po.isLocked && (
            <button onClick={() => setApprove(true)} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: '#15803d', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              🔒 Approve & Lock PO
            </button>
          )}
        </div>
      </div>

      {/* ── Status banner ────────────────────────────────────────────────────── */}
      {po.isLocked ? (
        <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, padding: '8px 16px', marginBottom: 16, fontSize: 13, color: '#15803d' }}>
          ✓ This PO is approved and locked. Passed to Expediting. Any changes require a Variation Request.
        </div>
      ) : (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, padding: '8px 16px', marginBottom: 16, fontSize: 13, color: '#b45309' }}>
          Pending approval. Review line items, then click Approve & Lock PO when ready.
        </div>
      )}

      {/* ── Meta grid ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
        <MetaItem dark={dark} label="Currency"        value={po.currency} />
        {/* FIX 1: use fmtValueCode so value shows "AUD 1,420,000" not "$1,420,000" */}
        <MetaItem dark={dark} label="Total Value"    value={fmtValueCode(po.value ?? totalValue, po.currency)} />
        <MetaItem dark={dark} label="Incoterms"      value={po.incoterms} />
        <MetaItem dark={dark} label="Handover Point" value={po.handover_point} />
        <MetaItem dark={dark} label="WBS"            value={po.wbs_code} mono />
        <MetaItem dark={dark} label="Vendor"         value={po.supplier_name ?? po.vendor_name} />
        <MetaItem dark={dark} label="Owner"          value={po.owner_name} />
        <MetaItem dark={dark} label={(po.expeditor_names && po.expeditor_names.length > 1) ? 'Expeditors' : 'Expeditor'}
          value={(po.expeditor_names && po.expeditor_names.length) ? po.expeditor_names.join(', ') : po.expeditor_name} />
        <MetaItem dark={dark} label="Group"          value={po.group_category?.replace(/_/g, ' ')} />
        <MetaItem dark={dark} label="ROS Date"       value={fmtDate(po.ros_date)} />
        {/* FIX 2: CDD added to meta grid per wireframe */}
        <MetaItem dark={dark} label="CDD"            value={fmtDate(po.contract_delivery_date)} />
        <MetaItem dark={dark} label="PO Placed"      value={fmtDate(po.milestone_po_date)} />
        <MetaItem dark={dark} label="FAT Date"       value={fmtDate(po.milestone_fat_date)} />
        <MetaItem dark={dark} label="Est. Arrival"   value={fmtDate(po.milestone_eta_date)} />
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${borderCol}`, marginBottom: 0, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.key} style={tabSty(activeTab === t.key)} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────────── */}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${borderCol}`, borderTop: 'none', borderRadius: '0 0 10px 10px', padding: 20 }}>
        {activeTab === 'lines'      && <LineItemsTab po={po} dark={dark} onRefresh={load} />}
        {activeTab === 'dates'      && <KeyDatesTab  po={po} dark={dark} onRefresh={load} />}
        {activeTab === 'itp'        && <ITPTab       po={po} dark={dark} />}
        {activeTab === 'documents'  && <DocumentsTab po={po} dark={dark} />}
        {activeTab === 'notes'      && <ActionNotesTab po={po} dark={dark} />}
        {activeTab === 'variations' && <VariationsTab  po={po} dark={dark} />}
        {activeTab === 'audit'      && <AuditTrailTab  po={po} dark={dark} />}
      </div>

      {/* ── Approve wizard ────────────────────────────────────────────────────── */}
      {showApprove && (
        <ApproveWizard
          po={po} dark={dark}
          onClose={() => setApprove(false)}
          onApproved={silentReload}  /* silent reload keeps wizard mounted so Step 2 can render */
        />
      )}
    </div>
  )
}

// ─── EXPORTED COMPONENT ───────────────────────────────────────────────────────

export interface PODetailScreenProps {
  dark: boolean
  projectId: number
  projectName: string
  poId: number
  onBack: () => void
  onLeaf?: (ref: string | null) => void   // report the PO ref for the topbar breadcrumb leaf
}

export const PODetailScreen = ({ dark, projectId, projectName, poId, onBack, onLeaf }: PODetailScreenProps) => (
  <ToastProvider>
    <PODetailInner dark={dark} projectId={projectId} projectName={projectName} poId={poId} onBack={onBack} onLeaf={onLeaf} />
  </ToastProvider>
)
