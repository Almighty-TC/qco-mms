// ─── PROCUREMENT MODULE — PHASE 1: PO REGISTER ───────────────────────────────
// List view with stat cards, resizable columns, RAG row stripe, milestone dots,
// slide-in drawer, expeditor assignment, critical-path toggle, pagination.
// Phase 2 (New PO Wizard) and Phase 3 (PO Detail) are stubbed below.
import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { useColumnResize } from '../hooks/useColumnResize'
import { HelpButton } from '../components/HelpDrawer'
import { PO_REGISTER_HELP } from '../helpContent'
import { BackButton } from '../components/BackButton'
import { Pager } from '../components/Pager'
import { useExpand, ExpandBtn } from '../components/ExpandToggle'
// Lazy-loaded so this page doesn't statically import another full page (keeps the
// HMR boundary clean + code-splits the detail view out of the main bundle).
const PODetailScreen = lazy(() => import('./PODetailScreen').then(m => ({ default: m.PODetailScreen })))

const API = 'http://localhost:3001/api'

// ─── TYPES ────────────────────────────────────────────────────────────────────

// Item 10E: added pending_director_approval, approved, rejected, draft statuses
type POStatus = 'rfq' | 'loa' | 'po-raised' | 'active' | 'closed' | 'cancelled' | 'on_hold'
              | 'pending_approval' | 'pending_director_approval' | 'approved' | 'rejected' | 'draft'
type RAG      = 'green' | 'amber' | 'red'
type DotState = 'complete' | 'pending' | 'empty'
// Item 4: expanded group categories including free-text "other"
type GroupCat = 'civil_structural' | 'mechanical' | 'electrical' | 'instrumentation_control'
              | 'piping' | 'hvac' | 'rotating_equipment' | 'fabricated_items'
              | 'bulk_materials' | 'telecommunications' | 'other' | string
type ActiveTab = 'all' | 'approved' | 'pending' | 'completed'

// Item 7: signed PO document shape
interface SignedDoc {
  id:              number
  file_name:       string
  file_size_bytes: number
  version:  number
  uploaded_at:     string
  uploaded_by_name: string
}

// ─── PO row shape returned by the list endpoint ───────────────────────────────
interface PO {
  id:             number
  po_number:      string
  po_name:        string | null
  description:    string | null
  vendor_name:    string
  supplier_id:    number | null
  supplier_name:  string | null
  currency:       string
  value:          number | null
  incoterms:      string | null
  handover_point: string | null
  wbs_code:       string | null
  wbs_node_id:    number | null
  wbs_name:       string | null
  ros_date:       string | null
  status:         POStatus
  statusLabel:    string
  isCriticalPath: boolean
  isLocked:       boolean
  group_category: GroupCat | null
  owner_id:       number | null
  owner_name:     string | null
  expeditor_id:   number | null
  expeditor_name: string | null
  // Co-assignment: all assigned expeditors (lead = expeditor_id / first entry).
  expeditor_ids?:   number[]
  expeditor_names?: string[]
  line_count:     number
  cdd:            string | null
  rag:            RAG | null
  // milestone_dots removed from register — milestones shown in drawer only
  milestone_po_date:  string | null
  milestone_fat_date: string | null
  milestone_esd_date: string | null
  milestone_eta_date: string | null
  milestone_ros_date: string | null
  created_at:     string
}

interface POLine {
  id?:          number
  line_number:  string
  tag_number?:  string | null   // commodity code or equipment tag; autocomplete when Foundational built
  description:  string
  qty:          number | null
  uom:          string
  uom_id?:      number | null
  unit_price:   number | null
  total_price?: number | null
  ros_date?:    string | null
  cdd?:         string | null
}

interface Stats {
  total: number; ongoing: number; complete: number; breached: number; atRisk: number
  atRiskDays: number   // Item 1: configurable threshold from project settings
  totalValue?: number; approvedValue?: number; pendingCount?: number
}
interface Supplier { id: number; code: string; name: string }
interface UOMItem  { id: number; code: string; description?: string }
interface UserItem { id: number; full_name: string; role: string }
interface WBSNode  { id: number; code: string; description: string }

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CURRENCIES = ['AUD','USD','EUR','GBP','SGD','JPY','CNY']
const INCO_TERMS = ['CIF','FOB','EXW','DAP','DDP','FCA','CPT','CIP']
// ─── Item 4: expanded group/category options ──────────────────────────────────
const GROUP_CATS: { value: string; label: string }[] = [
  { value: 'civil_structural',       label: 'Civil & Structural' },
  { value: 'mechanical',             label: 'Mechanical' },
  { value: 'electrical',             label: 'Electrical' },
  { value: 'instrumentation_control',label: 'Instrumentation & Control' },
  { value: 'piping',                 label: 'Piping' },
  { value: 'hvac',                   label: 'HVAC' },
  { value: 'rotating_equipment',     label: 'Rotating Equipment' },
  { value: 'fabricated_items',       label: 'Fabricated Items' },
  { value: 'bulk_materials',         label: 'Bulk Materials' },
  { value: 'telecommunications',     label: 'Telecommunications' },
  { value: 'other',                  label: 'Other (specify)' },
]

// ─── STATUS PILL COLOURS ──────────────────────────────────────────────────────
// Item 10E: added pending_director_approval and rejected pills.
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  rfq:                        { bg: 'rgba(245,158,11,0.12)',  text: '#b45309' },  // amber — pending
  loa:                        { bg: 'rgba(37,99,235,0.12)',   text: '#2563eb' },  // blue — letter of award
  'po-raised':                { bg: 'rgba(34,197,94,0.12)',   text: '#15803d' },  // green — approved & locked
  active:                     { bg: 'rgba(37,99,235,0.12)',   text: '#2563eb' },  // blue — active
  closed:                     { bg: 'rgba(100,116,139,0.12)', text: '#475569' },  // grey — complete
  pending_approval:           { bg: 'rgba(245,158,11,0.12)',  text: '#b45309' },  // amber — pending manager
  pending_director_approval:  { bg: 'rgba(234,88,12,0.12)',   text: '#c2410c' },  // orange — pending director
  approved:                   { bg: 'rgba(34,197,94,0.12)',   text: '#15803d' },  // green — approved
  rejected:                   { bg: 'rgba(239,68,68,0.12)',   text: '#dc2626' },  // red — rejected
  draft:                      { bg: 'rgba(100,116,139,0.12)', text: '#475569' },  // grey — draft
  cancelled:   { bg: 'rgba(239,68,68,0.12)',   text: '#dc2626' },  // red — cancelled
  on_hold:     { bg: 'rgba(239,68,68,0.12)',   text: '#dc2626' },  // red — on hold
}

// ─── RAG STRIPE COLOURS ───────────────────────────────────────────────────────
// 4px left border on each row — matches wireframe spec.
const RAG_BORDER: Record<string, string> = {
  green: '#2E7D32',
  amber: '#E84E0F',
  red:   '#C62828',
}

// ─── MILESTONE DOT COLOURS ────────────────────────────────────────────────────
// 5 dots max. Green = complete, orange = in progress (pending), grey = empty/not set.
const DOT_COLOR: Record<DotState, string> = {
  complete: '#22c55e',
  pending:  '#E84E0F',
  empty:    '#334155',
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmtCurrency(val: number | null, ccy = 'AUD') {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: ccy, maximumFractionDigits: 0,
  }).format(val)
}

// ─── FIX 2: fmtValueCode renders "AUD 1,420,000" — currency CODE prefix not symbol
// Used in VALUE column and stat cards to show multi-currency correctly.
function fmtValueCode(val: number | null, ccy = 'AUD') {
  if (val == null) return '—'
  const n = Math.round(val).toLocaleString('en-AU')
  return `${ccy} ${n}`
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── SHARED INPUT STYLE ───────────────────────────────────────────────────────

const inp = (dark: boolean): React.CSSProperties => ({
  height: 32, padding: '0 10px', borderRadius: 6,
  border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
  background: dark ? '#0f172a' : '#fff',
  color: dark ? '#f1f5f9' : '#0f172a',
  fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif', outline: 'none',
  width: '100%', boxSizing: 'border-box' as const,
})

// ─── STATUS PILL ─────────────────────────────────────────────────────────────

const StatusPill = ({ status, label }: { status: string; label: string }) => {
  const c = STATUS_COLORS[status] ?? { bg: 'rgba(100,116,139,0.12)', text: '#475569' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 9999,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.text,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

// ─── MILESTONE DOTS ───────────────────────────────────────────────────────────
// Renders up to 5 dots showing milestone progress. Hover tooltip lists milestones.

interface MilestoneDotsProps {
  dots: DotState[]
  labels: string[]
  dates: (string | null)[]
}
const MilestoneDots = ({ dots, labels, dates }: MilestoneDotsProps) => {
  const tooltip = labels.map((l, i) => `${l}: ${fmtDate(dates[i])}`).join('\n')
  return (
    <div title={tooltip} style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'default' }}>
      {dots.map((state, i) => (
        <span key={i} style={{
          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
          background: DOT_COLOR[state],
          flexShrink: 0,
        }} />
      ))}
    </div>
  )
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────

// ─── FIX 2: StatCard now accepts onClick + active (selected) state ────────────
// Clicking a card filters the table; clicking the active card clears filters.
const StatCard = ({ label, value, dark, accent, onClick, active }: {
  label: string; value: string | number; dark: boolean; accent?: string
  onClick?: () => void; active?: boolean
}) => (
  <div
    onClick={onClick}
    style={{
      flex: 1, minWidth: 0,
      background: dark ? '#1e293b' : '#fff',
      border: active ? '2px solid #E84E0F' : `1px solid ${dark ? '#334155' : '#dde3ed'}`,
      borderRadius: 8, padding: active ? '13px 17px' : '14px 18px',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'border-color 150ms, box-shadow 150ms',
      boxShadow: active ? '0 0 0 3px rgba(232,78,15,0.12)' : undefined,
    }}
    onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = active ? '#E84E0F' : '#94a3b8' }}
    onMouseLeave={e => { if (onClick) e.currentTarget.style.borderColor = active ? '#E84E0F' : (dark ? '#334155' : '#dde3ed') }}
  >
    <div style={{ fontSize: 11, fontWeight: 600, color: active ? '#E84E0F' : '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
      {label}
    </div>
    <div style={{
      fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
      letterSpacing: '-0.02em',
      color: accent ?? (dark ? '#f1f5f9' : '#0f172a'),
    }}>
      {value}
    </div>
  </div>
)

// ─── PORTAL MODAL WRAPPER ─────────────────────────────────────────────────────

const Modal = ({ children, onClose, dark, wide = false }: {
  children: React.ReactNode; onClose: () => void; dark: boolean; wide?: boolean
}) => createPortal(
  <div
    onClick={onClose}
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: dark ? '#1e293b' : '#fff', borderRadius: 10,
        padding: wide ? 32 : 28,
        width: wide ? 780 : 520, maxWidth: '100%', maxHeight: '90vh',
        overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        fontFamily: 'IBM Plex Sans, sans-serif',
        border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
      }}>
      {children}
    </div>
  </div>,
  document.body
)

// ─── FIELD + LABEL ────────────────────────────────────────────────────────────

const Label = ({ children }: { children: React.ReactNode }) => (
  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>
    {children}
  </label>
)
const Field = ({ label, children, half }: { label: string; children: React.ReactNode; half?: boolean }) => (
  <div style={{ marginBottom: 14, ...(half ? { flex: '0 0 calc(50% - 6px)' } : {}) }}>
    <Label>{label}</Label>
    {children}
  </div>
)
const SectionHdr = ({ children, dark }: { children: React.ReactNode; dark: boolean }) => (
  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: `1px solid ${dark ? '#1e2d4a' : '#e8ecf2'}`, paddingBottom: 6, marginBottom: 14, marginTop: 20 }}>
    {children}
  </div>
)

// ─── CONFIRM MODAL (simple) ───────────────────────────────────────────────────

const SimpleConfirm = ({ dark, title, message, confirmLabel, confirmStyle = 'primary', onConfirm, onCancel }: {
  dark: boolean; title: string; message: string; confirmLabel: string;
  confirmStyle?: 'primary' | 'warning' | 'danger'; onConfirm: () => void; onCancel: () => void
}) => {
  const bgMap = { primary: '#E84E0F', warning: '#b45309', danger: '#dc2626' }
  const col = dark ? '#f1f5f9' : '#0f172a'
  return (
    <Modal dark={dark} onClose={onCancel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: col }}>{title}</span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20, lineHeight: 1.6 }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
        <button onClick={onConfirm} style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: bgMap[confirmStyle], color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{confirmLabel}</button>
      </div>
    </Modal>
  )
}

// ─── SIDE DRAWER ──────────────────────────────────────────────────────────────
// Slide-in panel on the right — shown when a row is clicked (not PO ref link).
// PO ref in the drawer header is a clickable link → will navigate to full PO detail (Phase 3).

// ─── DRAWER PROPS ─────────────────────────────────────────────────────────────
interface DrawerProps {
  po:              PO
  dark:            boolean
  users:           UserItem[]
  projectId:       number
  projectName:     string
  onClose:         () => void
  onUpdated:       (updated: Partial<PO>) => void
  onNavigateToPO?: (poId: number) => void  // Phase 3: navigate to full PO Detail Screen
}

const PODrawer = ({ po, dark, users, projectId, projectName, onClose, onUpdated, onNavigateToPO }: DrawerProps) => {
  const { addToast } = useToast()
  // Expand the drawer to a full-screen view that embeds the complete PO detail.
  const [expanded, toggleExpand] = useExpand()
  // ── Expeditor co-assignment ─────────────────────────────────────────────────
  // A PO can have several assigned expeditors; all of them see/work on it in
  // Expediting. The first (earliest-assigned) is the lead, kept as expeditor_id.
  const [assigned, setAssigned] = useState<{ id: number; name: string }[]>(
    (po.expeditor_ids ?? []).map((id, i) => ({ id, name: (po.expeditor_names ?? [])[i] ?? `#${id}` }))
  )
  const [addId, setAddId]   = useState('')
  const [busyExp, setBusyExp] = useState(false)

  const propagate = (list: { id: number; name: string }[]) => {
    onUpdated({
      expeditor_ids: list.map(x => x.id), expeditor_names: list.map(x => x.name),
      expeditor_id: list[0]?.id ?? null, expeditor_name: list[0]?.name ?? null,
    })
  }
  const fromResp = (data: { expeditors?: { user_id: number; full_name: string }[] }) =>
    (data.expeditors ?? []).map(e => ({ id: e.user_id, name: e.full_name }))

  const addExpeditor = async () => {
    if (!addId) return
    setBusyExp(true)
    try {
      const { data } = await axios.post(`${API}/procurement/pos/${po.id}/expeditors`, { user_id: Number(addId) })
      const list = fromResp(data); setAssigned(list); propagate(list); setAddId('')
      addToast('success', 'Expeditor added')
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Could not add expeditor')
    } finally { setBusyExp(false) }
  }
  const removeExpeditor = async (uid: number) => {
    setBusyExp(true)
    try {
      const { data } = await axios.delete(`${API}/procurement/pos/${po.id}/expeditors/${uid}`)
      const list = fromResp(data); setAssigned(list); propagate(list)
      addToast('success', 'Expeditor removed')
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Could not remove expeditor')
    } finally { setBusyExp(false) }
  }

  // ── Owner reassignment (single owner per PO; admin / procurement_manager) ────
  const [editingOwner, setEditingOwner] = useState(false)
  const [ownerSel, setOwnerSel]         = useState(String(po.owner_id ?? ''))
  const [savingOwner, setSavingOwner]   = useState(false)
  const saveOwner = async () => {
    setSavingOwner(true)
    try {
      const newId = ownerSel ? Number(ownerSel) : null
      const { data } = await axios.put(`${API}/procurement/pos/${po.id}/owner`, { owner_id: newId })
      onUpdated({ owner_id: data.owner_id, owner_name: data.owner_name })
      addToast('success', data.owner_name ? `Owner set to ${data.owner_name}` : 'Owner cleared')
      setEditingOwner(false)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Could not change owner')
    } finally { setSavingOwner(false) }
  }

  const col = dark ? '#f1f5f9' : '#0f172a'
  const borderCol = dark ? '#334155' : '#dde3ed'

  const milestoneItems = [
    { label: 'PO Placed',     date: po.milestone_po_date  },
    { label: 'FAT',           date: po.milestone_fat_date },
    { label: 'Ex Ship Date',  date: po.milestone_esd_date },
    { label: 'Est. Arrival',  date: po.milestone_eta_date },
    { label: 'Req. on Site',  date: po.milestone_ros_date },
  ]

  return createPortal(
    <>
      {/* Overlay — clicking outside closes drawer */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 8000 }} />

      {/* ── Drawer panel — widens to full screen when expanded ──────────────── */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: expanded ? '100vw' : 620, maxWidth: '100vw',
        background: dark ? '#1e293b' : '#fff',
        borderLeft: `1px solid ${borderCol}`,
        boxShadow: '-8px 0 32px rgba(0,0,0,0.2)',
        zIndex: 8001,
        display: 'flex', flexDirection: 'column',
        fontFamily: 'IBM Plex Sans, sans-serif',
        overflow: 'hidden',
        transition: 'width 160ms ease',
      }}>

        {/* ── Drawer header ─────────────────────────────────────────────────── */}
        <div style={{ padding: expanded ? '8px 16px' : '16px 20px', borderBottom: `1px solid ${borderCol}`, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          {expanded ? (
            <div style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>Full PO view — use ← Back or shrink to return to the summary</div>
          ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              {/* PO Ref — navigates to full PO Detail Screen (Phase 3) */}
              <span
                onClick={() => { if (onNavigateToPO) { onClose(); onNavigateToPO(po.id) } }}
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 15, fontWeight: 700, color: '#2563eb', cursor: onNavigateToPO ? 'pointer' : 'default', textDecoration: 'underline', textDecorationColor: 'rgba(37,99,235,0.3)' }}
                title={onNavigateToPO ? 'Open full PO detail screen' : undefined}
              >
                {po.po_number}
              </span>
              {po.isCriticalPath && <span title="Critical path" style={{ color: '#f59e0b', fontSize: 14 }}>★</span>}
              {po.isLocked && (
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', color: '#15803d', letterSpacing: '0.05em' }}>LOCKED</span>
              )}
              <StatusPill status={po.status} label={po.statusLabel} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: col }}>{po.supplier_name ?? po.vendor_name}</div>
          </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <ExpandBtn expanded={expanded} onToggle={toggleExpand} />
            <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {expanded ? (
          /* ── Expanded: full-screen, complete PO detail (lines, dates, ITP,
             documents, notes, variations, audit) — reuses the PO Detail screen.
             Its "← Back" collapses back to the drawer. ── */
          <div style={{ overflowY: 'auto', flex: 1, padding: '0 24px' }}>
            <Suspense fallback={<div style={{ padding: 40, color: '#94a3b8', fontSize: 13 }}>Loading PO…</div>}>
              <PODetailScreen dark={dark} projectId={projectId} projectName={projectName} poId={po.id} onBack={toggleExpand} />
            </Suspense>
          </div>
        ) : (
        <>
        {/* SCN creation is an Expediting action, not Procurement — no Create SCN here.
            Documents live in the expanded full PO view (⤢). */}

        {/* ── Scrollable body — Item 9C: drawer scrolls independently ──────── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', maxHeight: 'calc(100vh - 60px)' }}>

          {/* ── Meta grid ───────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            {[
              { label: 'Currency',  val: po.currency },
              { label: 'Total Value', val: fmtCurrency(po.value, po.currency) },
              { label: 'Incoterms', val: po.incoterms ?? '—' },
              { label: 'WBS',       val: po.wbs_code ?? '—', mono: true },
              { label: 'ROS Date',  val: fmtDate(po.ros_date) },
              { label: 'CDD',       val: fmtDate(po.cdd) },
              { label: 'Group',     val: po.group_category?.replace(/_/g, ' ') ?? '—' },
              { label: 'Lines',     val: String(po.line_count), mono: true },
            ].map(m => (
              <div key={m.label} style={{ padding: '10px 12px', borderRadius: 6, background: dark ? '#0f172a' : '#f4f7fb', border: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>{m.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: col, fontFamily: m.mono ? 'JetBrains Mono, monospace' : 'inherit' }}>{m.val}</div>
              </div>
            ))}
          </div>

          {/* ── Owner & Expeditor ─────────────────────────────────────────────── */}
          <SectionHdr dark={dark}>Owner / Expeditor</SectionHdr>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            <div style={{ padding: '10px 12px', borderRadius: 6, background: dark ? '#0f172a' : '#f4f7fb', border: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>Owner</div>
              {editingOwner ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={ownerSel} onChange={e => setOwnerSel(e.target.value)} style={{ ...inp(dark), height: 28, fontSize: 11 }}>
                    <option value="">— None —</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                  <button onClick={saveOwner} disabled={savingOwner}
                    style={{ padding: '3px 8px', borderRadius: 5, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {savingOwner ? '…' : 'Save'}
                  </button>
                  <button onClick={() => { setEditingOwner(false); setOwnerSel(String(po.owner_id ?? '')) }}
                    style={{ padding: '3px 6px', borderRadius: 5, border: `1px solid ${borderCol}`, background: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>✕</button>
                </div>
              ) : (
                <button onClick={() => setEditingOwner(true)} title="Click to change owner"
                  style={{ background: 'none', border: 'none', fontSize: 13, fontWeight: 600, color: po.owner_name ? col : '#2563eb', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}>
                  {po.owner_name ?? '— Assign'}
                </button>
              )}
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 6, background: dark ? '#0f172a' : '#f4f7fb', border: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                Expeditors {assigned.length > 1 && <span style={{ color: '#2563eb' }}>· {assigned.length}</span>}
              </div>
              {/* Assigned expeditor chips (first = lead). Remove with ×. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: assigned.length ? 6 : 0 }}>
                {assigned.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>— None assigned</span>}
                {assigned.map((a, i) => (
                  <span key={a.id} title={i === 0 ? 'Lead expeditor' : 'Assigned expeditor'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: col,
                      background: dark ? '#1e293b' : '#fff', border: `1px solid ${i === 0 ? '#2563eb' : borderCol}`, borderRadius: 12, padding: '2px 6px 2px 8px' }}>
                    {i === 0 && <span style={{ color: '#2563eb', fontSize: 9 }}>★</span>}
                    {a.name}
                    <button onClick={() => removeExpeditor(a.id)} disabled={busyExp} title="Remove"
                      style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                ))}
              </div>
              {/* Add another expeditor (co-assign) */}
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={addId} onChange={e => setAddId(e.target.value)} style={{ ...inp(dark), height: 28, fontSize: 11 }}>
                  <option value="">+ Add expeditor…</option>
                  {users
                    .filter(u => ['expeditor','expediting_manager','admin','procurement_manager'].includes(u.role))
                    .filter(u => !assigned.some(a => a.id === u.id))
                    .map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
                <button onClick={addExpeditor} disabled={busyExp || !addId}
                  style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: addId ? '#E84E0F' : '#94a3b8', color: '#fff', fontSize: 11, cursor: addId ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                  {busyExp ? '…' : 'Add'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Milestone progress ────────────────────────────────────────────── */}
          <SectionHdr dark={dark}>Milestones</SectionHdr>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            {milestoneItems.map(m => (
              <div key={m.label} style={{ padding: '8px 12px', borderRadius: 6, border: `1px solid ${borderCol}`, minWidth: 100, flex: '1 0 auto' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', marginBottom: 3 }}>{m.label}</div>
                <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: m.date ? col : '#94a3b8' }}>{fmtDate(m.date)}</div>
              </div>
            ))}
          </div>

          {/* ── Item 7: Signed PO document section ────────────────────────── */}
          <SectionHdr dark={dark}>Signed PO</SectionHdr>
          <SignedPOSection poId={po.id} dark={dark} />
        </div>
        </>
        )}
      </div>
    </>,
    document.body
  )
}

// ─── Item 7: SIGNED PO SECTION ────────────────────────────────────────────────
// Renders inside the slide-in drawer. Fetches current signed PO document
// and provides upload / replace / download controls.

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const SignedPOSection = ({ poId, dark }: { poId: number; dark: boolean }) => {
  const { addToast } = useToast()
  const [doc,      setDoc]      = useState<SignedDoc | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [uploading,setUploading]= useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const col     = dark ? '#f1f5f9' : '#0f172a'
  const border  = dark ? '#334155' : '#dde3ed'

  const loadDoc = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/procurement/pos/${poId}`)
      setDoc(data.signedDoc ?? null)
    } catch { /* non-critical */ }
    finally { setLoading(false) }
  }, [poId])

  useEffect(() => { loadDoc() }, [loadDoc])

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await axios.post(`${API}/procurement/pos/${poId}/documents`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      addToast('success', `${file.name} uploaded successfully`)
      loadDoc()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Upload failed')
    } finally { setUploading(false) }
  }

  const download = async () => {
    if (!doc) return
    try {
      const res = await axios.get(
        `${API}/procurement/pos/${poId}/documents/${doc.id}/download`,
        { responseType: 'blob' }
      )
      const url = URL.createObjectURL(res.data)
      const a   = document.createElement('a')
      a.href = url; a.download = doc.file_name; a.click()
      URL.revokeObjectURL(url)
    } catch { addToast('error', 'Download failed') }
  }

  if (loading) return <div style={{ fontSize: 12, color: '#94a3b8' }}>Loading…</div>

  return (
    <div style={{ marginBottom: 18 }}>
      <input
        ref={fileRef} type="file" accept=".pdf,.doc,.docx"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }}
      />
      {doc ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 6, border: `1px solid ${border}`, background: dark ? '#0f172a' : '#f4f7fb' }}>
          <span style={{ fontSize: 13, color: '#2563eb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.file_name}>
            📄 {doc.file_name}
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
            {formatBytes(doc.file_size_bytes)} · v{doc.version} · {doc.uploaded_by_name}
          </span>
          <button onClick={download} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${border}`, background: 'none', color: col, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            ↓ View
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ padding: '3px 8px', borderRadius: 5, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 11, cursor: uploading ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {uploading ? '…' : '↑ Replace'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 12 }}>
          <span>No signed PO uploaded</span>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ padding: '4px 10px', borderRadius: 5, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 11, cursor: uploading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            {uploading ? 'Uploading…' : '↑ Upload Signed PO'}
          </button>
        </div>
      )}
      {doc && (
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
          Uploaded {fmtDate(doc.uploaded_at)} by {doc.uploaded_by_name}
        </div>
      )}
    </div>
  )
}

// ─── COMMODITY / TAG TYPEAHEAD ────────────────────────────────────────────────
// Searches commodities table + equipment_items table for the current project.
// Returns empty while Foundational module tables aren't populated yet.
// onSelect auto-fills description and uom on the parent line.
function CommodityTagSearch({ value, projectId, dark, onChange, onSelect }: {
  value:     string | null
  projectId: number
  dark:      boolean
  onChange:  (code: string | null) => void
  onSelect:  (item: { code: string; description: string; uom: string }) => void
}) {
  const [query,    setQuery]    = useState(value ?? '')
  const [results,  setResults]  = useState<Array<{ type: string; code: string; name: string; uom: string }>>([])
  const [open,     setOpen]     = useState(false)
  const wrapRef    = useRef<HTMLDivElement>(null)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setQuery(value ?? '') }, [value])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const search = (q: string) => {
    if (!q.trim()) { setResults([]); setOpen(false); return }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await axios.get(`${API}/procurement/${projectId}/items/search`, { params: { q } })
        setResults(data)
        setOpen(true)
      } catch { setResults([]) }
    }, 280)
  }

  const borderCol = dark ? '#334155' : '#dde3ed'
  const bg        = dark ? '#1e293b' : '#ffffff'

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value || null); search(e.target.value) }}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Code or tag (optional)"
        title="Type to search Commodity Library or Equipment List. Leave blank if unknown."
        style={{
          width: '100%', height: 28, boxSizing: 'border-box',
          padding: '0 6px', border: `1px solid ${borderCol}`,
          borderRadius: 4, background: bg,
          color: dark ? '#f1f5f9' : '#0f172a',
          fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          outline: 'none',
        }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 200,
          background: bg, border: `1px solid ${borderCol}`,
          borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          maxHeight: 200, overflowY: 'auto', minWidth: 260,
        }}>
          {results.length === 0 ? (
            <div style={{ padding: '8px 12px', fontSize: 11, color: '#94a3b8' }}>
              No results — add items in Foundational module
            </div>
          ) : results.map((r, i) => (
            <div key={i}
              onMouseDown={e => {
                e.preventDefault()
                setQuery(r.code); onChange(r.code)
                onSelect({ code: r.code, description: r.name, uom: r.uom })
                setOpen(false)
              }}
              style={{
                padding: '5px 10px', cursor: 'pointer',
                display: 'flex', gap: 8, alignItems: 'baseline',
                borderBottom: `1px solid ${dark ? '#334155' : '#f1f5f9'}`,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = dark ? '#1e2d4a' : '#f0f3f9')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#E84E0F', minWidth: 70 }}>{r.code}</span>
              <span style={{ fontSize: 12, color: dark ? '#f1f5f9' : '#0f172a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ fontSize: 9, color: '#94a3b8', background: dark ? '#334155' : '#f1f5f9', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
                {r.type === 'commodity' ? 'COMMODITY' : 'EQUIP'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── NEW PO WIZARD (Phase 2 — already built) ──────────────────────────────────
// 3-step wizard: Header → Line Items → Milestones.

interface NewPOWizardProps {
  dark: boolean; projectId: number
  suppliers: Supplier[]; uoms: UOMItem[]; users: UserItem[]; wbsNodes: WBSNode[]
  onClose: () => void; onCreated: () => void
}

const NewPOWizard = ({ dark, projectId, suppliers, uoms, users, wbsNodes, onClose, onCreated }: NewPOWizardProps) => {
  const { addToast } = useToast()
  const [step, setStep]   = useState(1)
  const [saving, setSaving] = useState(false)
  const [err, setErr]     = useState('')
  // ─── BUG-5: per-field validation errors for Step 1 ─────────────────────────
  const [wbsErr,   setWbsErr]   = useState('')
  const [incoErr,  setIncoErr]  = useState('')

  // ── Step 1 ──
  const [poNumber,    setPoNumber]    = useState('')
  // Item 11: duplicate check state
  const [dupWarning,  setDupWarning]  = useState<string | null>(null)
  const [dupChecking, setDupChecking] = useState(false)
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
  const [groupCat,    setGroupCat]    = useState<string>('')
  // Item 4: "Other (specify)" free-text category
  const [groupCatOther, setGroupCatOther] = useState('')

  // ── Step 2 ──
  const [lines, setLines] = useState<POLine[]>([
    { line_number: '1', description: '', qty: null, uom: 'EA', unit_price: null },
  ])
  const lineSubtotal = lines.reduce((s, l) => s + ((l.qty ?? 0) * (l.unit_price ?? 0)), 0)

  // ── Step 3 ──
  const [msPO,  setMsPO]  = useState('')
  const [msFAT, setMsFAT] = useState('')
  const [msESD, setMsESD] = useState('')
  const [msETA, setMsETA] = useState('')
  const [msROS, setMsROS] = useState('')

  const addLine    = () => setLines(p => [...p, { line_number: String(p.length + 1), description: '', qty: null, uom: 'EA', unit_price: null }])
  const removeLine = (i: number) => setLines(p => p.filter((_, idx) => idx !== i))
  const updateLine = (i: number, field: keyof POLine, val: string | number | null) =>
    setLines(p => p.map((l, idx) => idx === i ? { ...l, [field]: val } : l))

  const next = () => {
    if (step === 1) {
      // ─── BUG-5: per-field validation errors for Step 1 ────────────────────
      const errors: Record<string,string> = {}
      if (!poNumber.trim()) errors.poNumber = 'PO number is required'
      if (!wbsCode?.trim()) errors.wbs = 'WBS is required'
      if (!incoterms?.trim()) errors.incoterms = 'Incoterms is required'
      if (!supplierId && !vendorName.trim()) errors.vendor = 'Vendor is required'
      if (!wbsCode?.trim()) setWbsErr('WBS is required'); else setWbsErr('')
      if (!incoterms?.trim()) setIncoErr('Incoterms is required'); else setIncoErr('')
      if (Object.keys(errors).length > 0) {
        if (errors.poNumber || errors.vendor) setErr(errors.poNumber || errors.vendor)
        return
      }
    }
    setErr(''); setStep(s => s + 1)
  }

  const submit = async () => {
    setSaving(true); setErr('')
    try {
      await axios.post(`${API}/procurement/${projectId}/pos`, {
        po_number: poNumber.trim(), po_name: poName.trim() || null,
        description: description.trim() || null,
        supplier_id: supplierId ? Number(supplierId) : null,
        vendor_name: vendorName.trim() || suppliers.find(s => s.id === Number(supplierId))?.name || '',
        currency, value: value ? Number(value) : null,
        incoterms: incoterms || null, wbs_code: wbsCode || null,
        ros_date: rosDate || null, owner_id: ownerId ? Number(ownerId) : null,
        // Item 4: if "other" selected, use the free-text value
        group_category: groupCat === 'other' ? (groupCatOther.trim() || 'other') : (groupCat || null),
        milestone_po_date: msPO || null, milestone_fat_date: msFAT || null,
        milestone_esd_date: msESD || null, milestone_eta_date: msETA || null,
        milestone_ros_date: msROS || null,
        lines: lines.filter(l => l.description.trim()),
      })
      addToast('success', `PO ${poNumber} created successfully`)
      onCreated(); onClose()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } }; message?: string }
      setErr(er.response?.data?.error ?? er.message ?? 'Create failed')
    } finally { setSaving(false) }
  }

  const col = dark ? '#f1f5f9' : '#0f172a'
  const stepLabels = ['PO Header', 'Line Items', 'Milestones']

  return (
    <Modal dark={dark} onClose={onClose} wide>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: col }}>New Purchase Order</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Step {step} of 3 — {stepLabels[step - 1]}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>
      {/* Step progress bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        {[1,2,3].map(s => (
          <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? '#E84E0F' : (dark ? '#334155' : '#e2e8f0') }} />
        ))}
      </div>

      {/* ── Step 1: Header ────────────────────────────────────────────────────── */}
      {step === 1 && (
        <>
          <div style={{ display: 'flex', gap: 12 }}>
            {/* Item 11: duplicate check on blur */}
            <Field label="PO Number *" half>
              <input
                value={poNumber}
                onChange={e => { setPoNumber(e.target.value); setDupWarning(null) }}
                onBlur={async () => {
                  if (!poNumber.trim()) return
                  setDupChecking(true)
                  try {
                    const { data } = await axios.get(`${API}/procurement/pos/check-duplicate`, {
                      params: { po_number: poNumber.trim(), project_id: projectId }
                    })
                    setDupWarning(data.exists
                      ? `⚠ ${poNumber} already exists in this project (status: ${data.po?.status ?? 'unknown'})`
                      : null)
                  } catch { setDupWarning(null) }
                  setDupChecking(false)
                }}
                placeholder="PO-2024-007"
                style={{ ...inp(dark), fontFamily: 'JetBrains Mono, monospace' }}
              />
              {dupChecking && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>Checking…</div>}
              {dupWarning && <div style={{ fontSize: 11, color: '#d97706', marginTop: 3, fontWeight: 600 }}>{dupWarning}</div>}
            </Field>
            <Field label="PO Name" half><input value={poName} onChange={e => setPoName(e.target.value)} placeholder="Display name" style={inp(dark)} /></Field>
          </div>
          <Field label="Description"><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Scope description" style={{ ...inp(dark), height: 72, resize: 'vertical', padding: '8px 10px', lineHeight: 1.5 }} /></Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Supplier" half>
              <select value={supplierId} onChange={e => { setSupplierId(e.target.value); if (e.target.value) setVendorName('') }} style={inp(dark)}>
                <option value="">— Select supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              </select>
            </Field>
            <Field label="Vendor (if no supplier)" half>
              <input value={vendorName} onChange={e => { setVendorName(e.target.value); setSupplierId(''); if (e.target.value || supplierId) setErr('') }} placeholder="Free-text vendor" style={inp(dark)} disabled={!!supplierId} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {/* Item 4: expanded group/category with "Other (specify)" option */}
            <Field label="Group / Category" half>
              <select value={groupCat} onChange={e => setGroupCat(e.target.value)} style={inp(dark)}>
                <option value="">— Select —</option>
                {GROUP_CATS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
              {groupCat === 'other' && (
                <input
                  value={groupCatOther}
                  onChange={e => setGroupCatOther(e.target.value)}
                  placeholder="Specify category"
                  style={{ ...inp(dark), marginTop: 6 }}
                />
              )}
            </Field>
            <Field label="Currency *" half>
              <select value={currency} onChange={e => setCurrency(e.target.value)} style={inp(dark)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="PO Value" half><input value={value} onChange={e => setValue(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" style={{ ...inp(dark), fontFamily: 'JetBrains Mono, monospace' }} /></Field>
            <Field label="Incoterms *" half>
              <select value={incoterms} onChange={e => { setIncoterms(e.target.value); if (e.target.value) setIncoErr('') }}
                style={{ ...inp(dark), border: incoErr ? '1px solid #ef4444' : undefined }}>
                <option value="">— Select —</option>
                {INCO_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {incoErr && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{incoErr}</div>}
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="WBS *" half>
              <select value={wbsCode} onChange={e => { setWbsCode(e.target.value); if (e.target.value) setWbsErr('') }}
                style={{ ...inp(dark), border: wbsErr ? '1px solid #ef4444' : undefined }}>
                <option value="">— Select WBS —</option>
                {wbsNodes.map(w => <option key={w.id} value={w.code}>{w.code} — {w.description}</option>)}
              </select>
              {wbsErr && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{wbsErr}</div>}
            </Field>
            {/* Item 5: ROS date is now optional */}
            <Field label="Required on Site (ROS)" half>
              <input value={rosDate} onChange={e => setRosDate(e.target.value)} type="date" style={inp(dark)} />
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                Optional — ROS can be entered later in Expediting.
              </div>
            </Field>
          </div>
          <Field label="Owner / Expeditor">
            <select value={ownerId} onChange={e => setOwnerId(e.target.value)} style={inp(dark)}>
              <option value="">— Assign owner —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.role.replace(/_/g,' ')})</option>)}
            </select>
          </Field>
        </>
      )}

      {/* ── Step 2: Line Items ────────────────────────────────────────────────── */}
      {step === 2 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: dark ? '#0f172a' : '#f4f7fb', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
                  {['#','Commodity / Tag','Description','Qty','UoM','Unit Price','Total',''].map(h => (
                    <th key={h} style={{ padding: '6px 8px', fontWeight: 600, color: '#64748b', textAlign: (h === 'Description' || h === 'Commodity / Tag') ? 'left' : 'right', whiteSpace: 'nowrap', ...(h === '#' ? { width: 30 } : {}), ...(h === 'Commodity / Tag' ? { width: 130 } : {}) }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
                    <td style={{ padding: '4px 8px', textAlign: 'center', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{i+1}</td>
                    <td style={{ padding: '4px 6px', width: 150 }}>
                      <CommodityTagSearch
                        value={l.tag_number ?? null}
                        projectId={projectId}
                        dark={dark}
                        onChange={code => updateLine(i, 'tag_number', code)}
                        onSelect={item => setLines(prev => prev.map((ln, idx) =>
                          idx !== i ? ln : {
                            ...ln,
                            tag_number:  item.code,
                            description: ln.description || item.description,
                            uom:         item.uom || ln.uom,
                          }
                        ))}
                      />
                    </td>
                    <td style={{ padding: '4px 6px' }}><input value={l.description} onChange={e => updateLine(i,'description',e.target.value)} placeholder="Item description" style={{ ...inp(dark), height: 28, fontSize: 12 }} /></td>
                    <td style={{ padding: '4px 6px', width: 70 }}><input value={l.qty ?? ''} onChange={e => updateLine(i,'qty',e.target.value ? Number(e.target.value) : null)} type="number" min="0" step="0.001" placeholder="0" style={{ ...inp(dark), height: 28, fontSize: 12, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }} /></td>
                    <td style={{ padding: '4px 6px', width: 80 }}>
                      <select value={l.uom} onChange={e => updateLine(i,'uom',e.target.value)} style={{ ...inp(dark), height: 28, fontSize: 12 }}>
                        {uoms.map(u => <option key={u.id} value={u.code}>{u.code}</option>)}
                        {!uoms.find(u => u.code === l.uom) && <option value={l.uom}>{l.uom}</option>}
                      </select>
                    </td>
                    <td style={{ padding: '4px 6px', width: 110 }}><input value={l.unit_price ?? ''} onChange={e => updateLine(i,'unit_price',e.target.value ? Number(e.target.value) : null)} type="number" min="0" step="0.01" placeholder="0.00" style={{ ...inp(dark), height: 28, fontSize: 12, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }} /></td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                      {l.qty != null && l.unit_price != null ? fmtCurrency(l.qty * l.unit_price, currency) : '—'}
                    </td>
                    <td style={{ padding: '4px 4px', textAlign: 'center' }}>
                      {lines.length > 1 && <button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2 }}>×</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} style={{ padding: '8px 8px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>Subtotal</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>{fmtCurrency(lineSubtotal, currency)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <button onClick={addLine} style={{ marginTop: 10, padding: '6px 14px', borderRadius: 6, border: `1px dashed ${dark ? '#334155' : '#c4cedf'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Add line
          </button>
        </>
      )}

      {/* ── Step 3: Milestones ────────────────────────────────────────────────── */}
      {step === 3 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: 'PO Date',               val: msPO,  set: setMsPO  },
            { label: 'FAT (Factory Acceptance)', val: msFAT, set: setMsFAT },
            { label: 'ESD (Ex Ship Date)',      val: msESD, set: setMsESD },
            { label: 'ETA (Est. Arrival)',       val: msETA, set: setMsETA },
            { label: 'ROS (Req. on Site)',       val: msROS, set: setMsROS },
          ].map(m => (
            <Field key={m.label} label={m.label}><input value={m.val} onChange={e => m.set(e.target.value)} type="date" style={inp(dark)} /></Field>
          ))}
        </div>
      )}

      {err && <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
        {step > 1 && <button onClick={() => setStep(s => s - 1)} style={{ padding: '7px 16px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>}
        <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
        {step < 3
          ? <button onClick={next} style={{ padding: '7px 20px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Next →</button>
          : <button onClick={submit} disabled={saving} style={{ padding: '7px 20px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}>{saving ? 'Creating…' : 'Create PO'}</button>
        }
      </div>
    </Modal>
  )
}

// ─── HELP MODAL ───────────────────────────────────────────────────────────────

const HelpModal = ({ dark, onClose }: { dark: boolean; onClose: () => void }) => {
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sec = { fontSize: 11, fontWeight: 700 as const, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 6, marginTop: 16 }
  const row = { display: 'flex', gap: 8, marginBottom: 6, fontSize: 12 }
  const key = { fontWeight: 600 as const, color: col, minWidth: 150, flexShrink: 0 as const }
  const val = { color: '#64748b' }
  return (
    <Modal dark={dark} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: col }}>Procurement — Help</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer' }}>×</button>
      </div>
      <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>PO Register — purchase order tracking and management.</p>

      <div style={sec}>Summary Cards</div>
      <div style={row}><span style={key}>Total POs</span><span style={val}>All POs for the selected project.</span></div>
      <div style={row}><span style={key}>Ongoing</span><span style={val}>Not closed or cancelled.</span></div>
      <div style={row}><span style={key}>Complete</span><span style={val}>Closed POs.</span></div>
      <div style={row}><span style={key}>Breached</span><span style={val}>CDD is in the past and PO is not closed.</span></div>
      <div style={row}><span style={key}>At Risk</span><span style={val}>CDD is within 30 days and PO is not closed.</span></div>

      {/* Item 1D: RAG stripe with configurable threshold note */}
      <div style={sec}>Row Stripe (RAG — Configurable per project)</div>
      <div style={row}><span style={{ ...key, color: '#2E7D32' }}>Green stripe</span><span style={val}>CDD &gt; threshold days away, or PO complete. Threshold configured in Admin → Projects.</span></div>
      <div style={row}><span style={{ ...key, color: '#E84E0F' }}>Orange stripe</span><span style={val}>CDD within the project's At Risk threshold (default 30 days). Configure in Admin → Projects.</span></div>
      <div style={row}><span style={{ ...key, color: '#C62828' }}>Red stripe</span><span style={val}>CDD is past — action required.</span></div>

      <div style={sec}>Columns</div>
      <div style={row}><span style={key}>★ Star</span><span style={val}>Toggle critical path flag — requires a reason. Use filter to show only ★ POs.</span></div>
      <div style={row}><span style={key}>Milestones</span><span style={val}>5 dots: green = complete, orange = pending, grey = not set. Hover for dates.</span></div>
      <div style={row}><span style={key}>CDD</span><span style={val}>Earliest Contract Delivery Date across all line items.</span></div>
      <div style={row}><span style={key}>ROS Date</span><span style={val}>Required On Site date. Optional at creation — required before expediting begins.</span></div>
      <div style={row}><span style={key}>Owner/Expeditor</span><span style={val}>Owner is set at creation and can be reassigned from the drawer (one owner). Expeditors are co-assignable from the drawer or the row.</span></div>

      <div style={sec}>Actions</div>
      <div style={row}><span style={key}>Row click</span><span style={val}>Opens slide-in drawer with summary, milestones, signed PO, and expeditor assignment.</span></div>
      <div style={row}><span style={key}>PO Ref (in drawer)</span><span style={val}>Click to open full PO detail (Phase 3).</span></div>
      <div style={row}><span style={key}>+ New PO</span><span style={val}>3-step wizard: PO Header → Line Items → Milestones. ROS date is optional at creation.</span></div>
      <div style={row}><span style={key}>↑ Upload POs</span><span style={val}>Bulk import from CSV or Excel. Duplicate detection flags existing POs before you confirm.</span></div>
      <div style={row}><span style={key}>↓ Template</span><span style={val}>Download a pre-formatted Excel template with column instructions on Sheet 2.</span></div>
      <div style={row}><span style={key}>↺ Reset filters</span><span style={val}>Clears all search and filter inputs back to defaults.</span></div>

      <div style={sec}>Signed PO Documents</div>
      <div style={row}><span style={key}>Upload</span><span style={val}>Click a row to open the drawer, then use the Signed PO section to upload PDF, DOC, or DOCX (max 50MB).</span></div>
      <div style={row}><span style={key}>Replace</span><span style={val}>Uploading a new file creates a new version — all prior versions are retained for audit.</span></div>
      <div style={row}><span style={key}>Download</span><span style={val}>Authenticated download — the file URL is never public.</span></div>

      <div style={sec}>Approval Thresholds</div>
      <div style={row}><span style={key}>Level 1</span><span style={val}>Procurement Manager can approve up to the project's Level 1 threshold. Configure in Admin → Projects.</span></div>
      <div style={row}><span style={key}>Level 2</span><span style={val}>Above Level 2 threshold: Project Director approval also required. Two-step chain.</span></div>
      <div style={row}><span style={key}>Admin</span><span style={val}>Admin bypasses all thresholds.</span></div>

      <div style={sec}>Duplicate PO Handling</div>
      <div style={row}><span style={key}>Manual entry</span><span style={val}>PO Number field checks for duplicates on blur. Shows inline warning with comparison.</span></div>
      <div style={row}><span style={key}>Bulk upload</span><span style={val}>Duplicate rows flagged 🟡 — you can opt to replace. Locked (approved) POs 🔴 are always skipped.</span></div>
    </Modal>
  )
}

// ─── COLUMN DEFINITIONS ───────────────────────────────────────────────────────
// Matches spec exactly: PO Ref | Vendor/Group | Material Desc | WBS | Owner/Expeditor | Milestones | CDD | ROS | Status | Actions

// ─── COLUMN DEFINITIONS — order matches wireframe: ★|PO Ref|PO Name|Desc|CCY|Value|Incoterms|WBS|ROS|Vendor|Owner|CDD|Status|Actions
const PO_COLS = [
  { key: 'star',      label: '',            width: 32,  minWidth: 32,  noResize: true },
  { key: 'po_number', label: 'PO Ref',      width: 120, minWidth: 90  },
  { key: 'po_name',   label: 'PO Name',     width: 160, minWidth: 100 },
  { key: 'desc',      label: 'Description', width: 180, minWidth: 100, flex: true },
  { key: 'ccy',       label: 'Currency',    width: 80,  minWidth: 60  },
  { key: 'value',     label: 'Value',       width: 110, minWidth: 90  },
  { key: 'incoterms', label: 'INCO TERMS',  width: 95,  minWidth: 75  },
  { key: 'wbs',       label: 'WBS',         width: 100, minWidth: 80  },
  { key: 'ros',       label: 'ROS',         width: 100, minWidth: 80  },
  { key: 'vendor',    label: 'Vendor',      width: 150, minWidth: 100 },
  { key: 'owner',     label: 'Owner',       width: 130, minWidth: 100 },
  { key: 'cdd',       label: 'CDD',         width: 100, minWidth: 80  },
  { key: 'status',    label: 'Status',      width: 120, minWidth: 100 },
  { key: 'actions',   label: 'Actions',     width: 90,  minWidth: 80,  noResize: true },
]

// A PO can still be approved only while it's in a pre-approval status — never
// once approved/locked, in-flight, or in a terminal (complete/cancelled) state.
const APPROVABLE_STATUSES = new Set(['draft','rfq','loa','pending_approval','pending_director_approval'])

// ─── PO TABLE ROW ─────────────────────────────────────────────────────────────

interface PORowProps {
  po:               PO
  dark:             boolean
  colWidths:        number[]
  onStar:           (po: PO) => void
  onClick:          (po: PO) => void   // opens the side drawer
  onApprove:        (po: PO) => void
  onNavigateToPO?:  (poId: number) => void  // FIX 1: navigate to full PO Detail Screen
  // inline expeditor co-assignment props
  users:            UserItem[]
  isAssigningExp:   boolean
  onOpenAssignExp:  (po: PO) => void
  onCloseAssignExp: () => void
  onToggleExp:      (poId: number, userId: number, isAssigned: boolean) => void
  expAssignSaving:  boolean
}

const POTableRow = ({
  po, dark, colWidths, onStar, onClick, onApprove, onNavigateToPO,
  users, isAssigningExp, onOpenAssignExp, onCloseAssignExp,
  onToggleExp, expAssignSaving,
}: PORowProps) => {
  const [hov, setHov] = useState(false)
  const col     = dark ? '#f1f5f9' : '#0f172a'
  const stripe  = po.rag ? RAG_BORDER[po.rag] : 'transparent'

  const tdBase: React.CSSProperties = {
    padding: '0 8px', height: 44, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
    verticalAlign: 'middle',
    boxSizing: 'border-box',
  }

  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={() => onClick(po)}
      style={{ background: hov ? (dark ? '#1e2d4a' : '#f4f7fb') : (dark ? '#1e293b' : '#fff'), transition: 'background 100ms', cursor: 'pointer' }}>

      {/* ── ★ star (critical path) ────────────────────────────────────────── */}
      <td
        onClick={e => { e.stopPropagation(); onStar(po) }}
        style={{ ...tdBase, width: colWidths[0], textAlign: 'center',
          boxShadow: `inset 4px 0 0 ${stripe}` }}>
        <span
          title={po.isCriticalPath ? 'Critical path — click to clear' : 'Mark as critical path'}
          style={{ color: po.isCriticalPath ? '#f59e0b' : (hov ? '#c4cedf' : 'transparent'), cursor: 'pointer', fontSize: 13, transition: 'color 100ms' }}>
          ★
        </span>
      </td>

      {/* ── PO Ref (index 1) — clicking navigates to full PO Detail Screen ─── */}
      <td
        onClick={e => { e.stopPropagation(); if (onNavigateToPO) { onNavigateToPO(po.id) } else { onClick(po) } }}
        style={{ ...tdBase, width: colWidths[1], cursor: 'pointer' }}>
        <span
          style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#2563eb', fontWeight: 600,
            textDecoration: onNavigateToPO ? 'underline' : 'none',
            textDecorationColor: 'rgba(37,99,235,0.35)' }}
          title={onNavigateToPO ? `Open full detail for ${po.po_number}` : po.po_number}>
          {po.po_number}
        </span>
        {po.isLocked && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: '#15803d', fontFamily: 'IBM Plex Sans, sans-serif', letterSpacing: '0.05em' }}>LOCKED</span>}
      </td>

      {/* ── PO Name (index 2) ─────────────────────────────────────────────── */}
      <td style={{ ...tdBase, width: colWidths[2] }} title={po.po_name ?? ''}>
        <span style={{ fontSize: 12, color: col, overflow: 'hidden', textOverflow: 'ellipsis' }}>{po.po_name ?? '—'}</span>
      </td>

      {/* ── Description (index 3) ─────────────────────────────────────────── */}
      <td style={{ ...tdBase }} title={po.description ?? ''}>
        <span style={{ fontSize: 13, color: dark ? '#94a3b8' : '#475569' }}>{po.description ?? '—'}</span>
      </td>

      {/* ── CCY (index 4) ─────────────────────────────────────────────────── */}
      <td style={{ ...tdBase, width: colWidths[4], textAlign: 'center' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b' }}>{po.currency}</span>
      </td>

      {/* ── Value (index 5) — FIX 2: "AUD 1,420,000" format ────────── */}
      <td style={{ ...tdBase, width: colWidths[5], textAlign: 'left' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: col }}>
          {fmtValueCode(po.value, po.currency)}
        </span>
      </td>

      {/* ── Incoterms (index 6) ───────────────────────────────────────────── */}
      <td style={{ ...tdBase, width: colWidths[6], textAlign: 'center' }}>
        <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'JetBrains Mono, monospace' }}>{po.incoterms ?? '—'}</span>
      </td>

      {/* ── WBS (index 7) ─────────────────────────────────────────────────── */}
      <td style={{ ...tdBase, width: colWidths[7] }} title={po.wbs_name ?? po.wbs_code ?? ''}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b' }}>{po.wbs_code ?? '—'}</span>
      </td>

      {/* ── ROS Date (index 8) ────────────────────────────────────────────── */}
      <td style={{ ...tdBase, width: colWidths[8] }}>
        {po.ros_date
          ? <span style={{ fontSize: 12, color: dark ? '#94a3b8' : '#475569', fontFamily: 'JetBrains Mono, monospace' }}>{fmtDate(po.ros_date)}</span>
          : <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>— not set</span>
        }
      </td>

      {/* ── Vendor (index 9) ──────────────────────────────────────────────── */}
      <td style={{ ...tdBase, width: colWidths[9] }} title={`${po.supplier_name ?? po.vendor_name}${po.group_category ? ' · ' + po.group_category : ''}`}>
        <div style={{ fontSize: 13, fontWeight: 500, color: col, overflow: 'hidden', textOverflow: 'ellipsis' }}>{po.supplier_name ?? po.vendor_name}</div>
        {po.group_category && <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'capitalize' }}>{po.group_category}</div>}
      </td>

      {/* ── Owner / Expeditor (index 10) — "— Assign" opens inline dropdown ── */}
      <td
        onClick={e => e.stopPropagation()}   // prevent row drawer open when clicking assign
        style={{ ...tdBase, width: colWidths[10], overflow: 'visible', position: 'relative' }}>
        {/* FIX 5: owner name has "PO Owner" tooltip */}
        <div
          title="PO Owner"
          style={{ fontSize: 12, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {po.owner_name ?? '—'}
        </div>
        {(() => {
          const names = po.expeditor_names && po.expeditor_names.length ? po.expeditor_names
            : (po.expeditor_name ? [po.expeditor_name] : [])
          const extra = names.length - 1
          return names.length ? (
            /* Assigned expeditor(s) — lead first, "+N" if co-assigned. Click to manage. */
            <div
              onClick={() => onOpenAssignExp(po)}
              style={{ fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
              title={`Assigned: ${names.join(', ')} — click to manage`}>
              {names[0]}{extra > 0 && <span style={{ color: '#2563eb', fontWeight: 600 }}> +{extra}</span>}
            </div>
          ) : (
            <div
              onClick={() => onOpenAssignExp(po)}
              style={{ fontSize: 10, color: '#2563eb', cursor: 'pointer', userSelect: 'none' }}
              title="Assign expeditor(s) to this PO">
              — Assign
            </div>
          )
        })()}

        {/* Inline menu — toggle expeditors on/off (co-assignment). Stays open so
            several can be assigned in a row; a ✓ marks those already assigned. */}
        {isAssigningExp && (() => {
          const assignedIds = po.expeditor_ids && po.expeditor_ids.length ? po.expeditor_ids
            : (po.expeditor_id ? [po.expeditor_id] : [])
          return (
          <div
            style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 100,
              background: dark ? '#1e293b' : '#fff',
              border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
              borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              minWidth: 220, padding: '6px 0',
            }}>
            <div style={{ padding: '4px 12px 6px', fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Assign expeditors (tick to add)
            </div>
            {users
              .filter(u => ['expeditor','expediting_manager','admin','procurement_manager'].includes(u.role))
              .map(u => {
                const on = assignedIds.includes(u.id)
                return (
                <div
                  key={u.id}
                  onClick={() => onToggleExp(po.id, u.id, on)}
                  style={{ padding: '6px 12px', fontSize: 12, color: dark ? '#f1f5f9' : '#0f172a', cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}
                  onMouseEnter={e => { e.currentTarget.style.background = dark ? '#334155' : '#f4f7fb' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <span style={{ width: 14, color: '#22c55e', fontWeight: 700 }}>{on ? '✓' : ''}</span>
                  <span>{u.full_name}<span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>{u.role.replace(/_/g, ' ')}</span></span>
                </div>
              )})}
            {expAssignSaving && (
              <div style={{ padding: '6px 12px', fontSize: 11, color: '#94a3b8' }}>Saving…</div>
            )}
            <div style={{ borderTop: `1px solid ${dark ? '#334155' : '#e8ecf2'}`, marginTop: 4, padding: '4px 12px' }}>
              <button
                onClick={onCloseAssignExp}
                style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                Done
              </button>
            </div>
          </div>
        )})()}
      </td>

      {/* ── CDD (index 11) ────────────────────────────────────────────────── */}
      <td style={{ ...tdBase, width: colWidths[11] }}>
        <span style={{ fontSize: 12, color: po.rag === 'red' ? '#ef4444' : po.rag === 'amber' ? '#d97706' : (dark ? '#94a3b8' : '#475569'), fontFamily: 'JetBrains Mono, monospace' }}>
          {fmtDate(po.cdd)}
        </span>
      </td>

      {/* ── Status (index 12) ─────────────────────────────────────────────── */}
      <td style={{ ...tdBase, width: colWidths[12] }}>
        <StatusPill status={po.status} label={po.statusLabel} />
      </td>

      {/* ── Actions (index 13) ────────────────────────────────────────────── */}
      <td onClick={e => e.stopPropagation()} style={{ ...tdBase, width: colWidths[13], textAlign: 'center' }}>
        {!po.isLocked && APPROVABLE_STATUSES.has(po.status) ? (
          <button
            onClick={() => onApprove(po)}
            title="Approve & Lock"
            style={{ padding: '3px 8px', borderRadius: 5, border: 'none', background: 'rgba(34,197,94,0.12)', color: '#15803d', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Approve
          </button>
        ) : (
          <span style={{ color: '#cbd5e1', fontSize: 14 }}>—</span>
        )}
      </td>
    </tr>
  )
}

// ─── DRAG HANDLE ──────────────────────────────────────────────────────────────
// Orange on hover, same as AdminTable.

// ─── FIX 4: Column resize handle — orange #E84E0F bar on hover ───────────────
// Two layers: a subtle 1px grey divider (always visible) and an 8px hit target
// that turns into a 3px solid orange bar when hovered. On active drag the body
// cursor changes to col-resize (handled by useColumnResize hook).
const DragHandle = ({ onMouseDown, dark }: { onMouseDown: (e: React.MouseEvent) => void; dark: boolean }) => {
  const [hov, setHov] = useState(false)
  return (
    <>
      {/* 1px subtle column divider — always present, no pointer events */}
      <div style={{
        position: 'absolute', right: 0, top: 0,
        width: hov ? 3 : 1, height: '100%',
        background: hov ? '#E84E0F' : (dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'),
        pointerEvents: 'none',
        transition: 'width 100ms, background 100ms',
        borderRadius: 1,
      }} />
      {/* 8px transparent hit target — widens and shows orange on hover */}
      <div
        onMouseDown={onMouseDown}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          position: 'absolute', right: 0, top: 0,
          width: 8, height: '100%',
          cursor: 'col-resize',
          zIndex: 2,
        }}
      />
    </>
  )
}

// ─── PROCUREMENT INNER ────────────────────────────────────────────────────────
// Inner component — requires useToast() so it must live inside ToastProvider.

interface ProcurementInnerProps {
  dark: boolean; projectId: number; projectName: string
  // Phase 3: callback to navigate to full PO Detail Screen
  onNavigateToPO?: (poId: number) => void
}

const ProcurementInner = ({ dark, projectId, projectName, onNavigateToPO }: ProcurementInnerProps) => {
  const { addToast } = useToast()

  // ── Data state ─────────────────────────────────────────────────────────────
  const [stats,   setStats]   = useState<Stats | null>(null)
  const [pos,     setPOs]     = useState<PO[]>([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  // ── Reference data ──────────────────────────────────────────────────────────
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [uoms,      setUoms]      = useState<UOMItem[]>([])
  const [users,     setUsers]     = useState<UserItem[]>([])
  const [wbsNodes,  setWbsNodes]  = useState<WBSNode[]>([])

  // ── Filter / pagination state ───────────────────────────────────────────────
  const [activeTab,    setActiveTab]    = useState<ActiveTab>('all')
  const [search,       setSearch]       = useState('')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [rosFrom,      setRosFrom]      = useState('')
  const [rosTo,        setRosTo]        = useState('')
  const [page,         setPage]         = useState(1)
  const PAGE_SIZE = 50

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showNew,       setShowNew]       = useState(false)
  const [showHelp,      setShowHelp]      = useState(false)
  const [drawerPO,      setDrawerPO]      = useState<PO | null>(null)
  const [approveTarget, setApproveTarget] = useState<PO | null>(null)
  const [approving,     setApproving]     = useState(false)
  // Item 9A: critical path confirmation modal
  const [cpTarget,      setCpTarget]      = useState<PO | null>(null)
  const [cpReason,      setCpReason]      = useState('')
  const [cpSaving,      setCpSaving]      = useState(false)
  // Item 6: bulk upload modal
  const [showUpload,    setShowUpload]    = useState(false)
  // FIX 2: clickable summary card filter ('total'|'ongoing'|'complete'|'breached'|'atRisk'|null)
  const [cardFilter,    setCardFilter]    = useState<string | null>(null)
  // FIX 3: group by control
  const [groupBy,       setGroupBy]       = useState<'none' | 'vendor' | 'wbs'>('none')
  // FIX 2: inline expeditor assignment from the table row (separate from drawer)
  const [rowAssignPoId,  setRowAssignPoId]  = useState<number | null>(null)
  const [rowAssignSaving,setRowAssignSaving]= useState(false)

  // ── Toolbar ref (for sticky positioning) ────────────────────────────────────
  // Note: thead sticky uses top:0 within the table wrapper (which is the scroll
  // container). No CSS variable needed — the wrapper itself scrolls vertically.
  const toolbarRef = useRef<HTMLDivElement>(null)

  // ── Column resize ───────────────────────────────────────────────────────────
  const defaultWidths = PO_COLS.map(c => c.width)
  const minWidths     = PO_COLS.map(c => c.minWidth)
  const { widths, onMouseDown: onColDown, resetWidths } = useColumnResize('procurement_po', defaultWidths, minWidths)

  const col = dark ? '#f1f5f9' : '#0f172a'

  // ── Load reference data once ────────────────────────────────────────────────
  useEffect(() => {
    axios.get(`${API}/admin/suppliers?limit=500`).then(r => setSuppliers(r.data.rows ?? r.data)).catch(() => {})
    axios.get(`${API}/admin/uom?limit=500`).then(r => setUoms(r.data.rows ?? r.data)).catch(() => {})
    axios.get(`${API}/procurement/users/list`).then(r => setUsers(r.data)).catch(() => {})
    axios.get(`${API}/procurement/${projectId}/wbs`).then(r => setWbsNodes(r.data)).catch(() => {})
  }, [projectId])

  // ── Load PO list + stats ─────────────────────────────────────────────────
  const load = useCallback(async (p = page) => {
    setLoading(true); setError('')
    try {
      const params: Record<string, string> = { page: String(p), limit: String(PAGE_SIZE) }
      if (activeTab !== 'all')  params.status = activeTab
      if (criticalOnly)         params.is_critical_path = '1'
      if (search.trim())        params.search = search.trim()
      if (rosFrom)              params.cdd_from = rosFrom
      if (rosTo)                params.cdd_to   = rosTo
      // FIX 2: card filter maps to backend status/rag params
      if (cardFilter === 'ongoing')  params.status = 'all_active'
      if (cardFilter === 'complete') params.status = 'completed'
      if (cardFilter === 'breached') params.rag    = 'red'
      if (cardFilter === 'atRisk')   params.rag    = 'amber'
      // New value-based card filters use the tab state set at click time
      // 'committed' → all non-cancelled (no extra param, tab already set to 'all')
      // 'approvedValue' → approved tab handled via setActiveTab('approved')
      // 'pendingApproval' → pending tab handled via setActiveTab('pending')

      const [statsRes, posRes] = await Promise.all([
        axios.get(`${API}/procurement/${projectId}/stats`),
        axios.get(`${API}/procurement/${projectId}/pos`, { params }),
      ])
      setStats(statsRes.data)
      setPOs(posRes.data.data)
      setTotal(posRes.data.total)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } }; message?: string }
      setError(er.response?.data?.error ?? er.message ?? 'Failed to load POs')
    } finally { setLoading(false) }
  }, [projectId, activeTab, criticalOnly, search, rosFrom, rosTo, page, cardFilter])

  useEffect(() => { setPage(1); load(1) }, [activeTab, criticalOnly, search, rosFrom, rosTo, cardFilter])
  useEffect(() => { load() }, [load])

  // ── Reset all filters ────────────────────────────────────────────────────────
  const resetFilters = () => {
    setSearch(''); setCriticalOnly(false); setRosFrom(''); setRosTo(''); setPage(1)
    setActiveTab('all'); setCardFilter(null)
  }

  // ── Critical path toggle (star click) ────────────────────────────────────────
  // ── Item 9A: star click opens confirm modal with reason field ─────────────────
  const handleStarClick = (po: PO) => { setCpTarget(po); setCpReason('') }
  const confirmToggleStar = async () => {
    if (!cpTarget || !cpReason.trim()) return
    setCpSaving(true)
    try {
      const { data } = await axios.put(`${API}/procurement/pos/${cpTarget.id}/critical-path`, {
        is_critical_path: !cpTarget.isCriticalPath,
        reason: cpReason.trim(),
      })
      setPOs(prev => prev.map(p => p.id === cpTarget.id ? { ...p, isCriticalPath: data.isCriticalPath } : p))
      if (drawerPO?.id === cpTarget.id) setDrawerPO(d => d ? { ...d, isCriticalPath: data.isCriticalPath } : d)
      addToast('success', `PO ${cpTarget.po_number} critical path ${data.isCriticalPath ? 'set' : 'cleared'}`)
      setCpTarget(null); setCpReason('')
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Could not update critical path flag')
    } finally { setCpSaving(false) }
  }
  // Keep legacy toggleStar as fallback (still used by PATCH star endpoint)
  const toggleStar = (po: PO) => handleStarClick(po)

  // ── Approve & Lock ──────────────────────────────────────────────────────────
  const confirmApprove = async () => {
    if (!approveTarget) return
    setApproving(true)
    try {
      await axios.patch(`${API}/procurement/pos/${approveTarget.id}/approve`)
      addToast('success', `PO ${approveTarget.po_number} approved & locked`)
      setApproveTarget(null)
      load()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } }; message?: string }
      addToast('error', er.response?.data?.error ?? 'Approval failed')
    } finally { setApproving(false) }
  }

  // ── Expeditor update from drawer ─────────────────────────────────────────────
  const handleExpeditorUpdate = (updated: Partial<PO>) => {
    setPOs(prev => prev.map(p => p.id === drawerPO?.id ? { ...p, ...updated } : p))
    if (drawerPO) setDrawerPO(d => d ? { ...d, ...updated } : d)
  }

  // ── Row-level expeditor co-assignment (inline menu in the table) ──────────────
  // Toggles an expeditor on/off the PO directly from the row (add → POST, remove
  // → DELETE). The menu stays open so a manager can assign several in a row. Both
  // the row and any open drawer are updated from the server's authoritative list.
  const toggleRowExpeditor = async (poId: number, userId: number, isAssigned: boolean) => {
    setRowAssignSaving(true)
    try {
      const { data } = isAssigned
        ? await axios.delete(`${API}/procurement/pos/${poId}/expeditors/${userId}`)
        : await axios.post(`${API}/procurement/pos/${poId}/expeditors`, { user_id: userId })
      const ids:   number[] = (data.expeditors ?? []).map((e: { user_id: number }) => e.user_id)
      const names: string[] = (data.expeditors ?? []).map((e: { full_name: string }) => e.full_name)
      const patch: Partial<PO> = {
        expeditor_ids: ids, expeditor_names: names,
        expeditor_id: ids[0] ?? null, expeditor_name: names[0] ?? null,
      }
      setPOs(prev => prev.map(p => p.id === poId ? { ...p, ...patch } : p))
      if (drawerPO?.id === poId) setDrawerPO(d => d ? { ...d, ...patch } : d)
      addToast('success', isAssigned ? 'Expeditor removed' : 'Expeditor added')
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Could not update expeditors')
    } finally { setRowAssignSaving(false) }
  }

  // ── CSV export ───────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['PO Ref','Vendor','Group','Description','WBS','Owner','Expeditor','Milestones Done','CDD','ROS','Status','Value','CCY']
    const rows = pos.map(p => [
      p.po_number, p.supplier_name ?? p.vendor_name, p.group_category ?? '',
      p.description ?? '', p.wbs_code ?? '', p.owner_name ?? '', p.expeditor_name ?? '',
      String(p.milestone_po_date || p.milestone_fat_date || p.milestone_ros_date ? 'set' : 'none'),
      p.cdd ?? '', p.ros_date ?? '', p.statusLabel,
      String(p.value ?? ''), p.currency,
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    a.download = `PO-Register-P${projectId}.csv`
    a.click()
  }

  // ── Tab style ────────────────────────────────────────────────────────────────
  const tabSty = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: active ? 600 : 400,
    cursor: 'pointer', border: 'none', fontFamily: 'inherit',
    background: active ? (dark ? '#334155' : '#e2e8f0') : 'transparent',
    color: active ? col : '#94a3b8', transition: 'all 120ms',
  })

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div style={{ fontFamily: 'IBM Plex Sans, sans-serif', paddingBottom: 32 }}>
      <ToastContainer />

      {/* ── Back row ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', paddingTop: 16, marginBottom: 0 }}>
        <BackButton onFallback={() => {}} dark={dark} />
      </div>

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, paddingTop: 8 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>PO Register</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{projectName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <HelpButton screenName="PO Register" sections={PO_REGISTER_HELP} dark={dark} />
          <button onClick={exportCSV} style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f4f7fb', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↓ Export</button>
          {/* ─── Item 6: Template download ─────────────────────────────────── */}
          <button
            onClick={async () => {
              // FIX 3: use authenticated axios fetch + blob URL so the file downloads
              // rather than opening in a browser tab (window.open navigates to the URL).
              try {
                const res = await axios.get(`${API}/procurement/template/po-upload`, { responseType: 'blob' })
                const url = URL.createObjectURL(new Blob([res.data], {
                  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }))
                const a = document.createElement('a')
                a.href = url; a.download = 'PO_Upload_Template.xlsx'; a.click()
                URL.revokeObjectURL(url)
              } catch { addToast('error', 'Template download failed') }
            }}
            title="Download PO upload template (.xlsx)"
            style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f4f7fb', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            ↓ Template
          </button>
          {/* ─── Item 6: Bulk upload button ─────────────────────────────────── */}
          <button
            onClick={() => setShowUpload(true)}
            style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f4f7fb', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            ↑ Upload POs
          </button>
        </div>
      </div>

      {/* ── Summary cards ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* FIX 2: each card is clickable — sets cardFilter; clicking active card clears it */}
        <StatCard dark={dark} label="Total POs" value={stats?.total ?? '—'}
          active={cardFilter === 'total'}
          onClick={() => { setCardFilter(cardFilter === 'total' ? null : 'total'); setActiveTab('all') }} />
        {/* ─── NEW VALUE STAT CARDS ────────────────────────────────────────── */}
        <StatCard dark={dark} label="Committed Value"
          value={stats ? fmtValueCode(stats.totalValue ?? 0, 'AUD') : '—'}
          active={cardFilter === 'committed'}
          onClick={() => { setCardFilter(cardFilter === 'committed' ? null : 'committed'); setActiveTab('all') }} />
        <StatCard dark={dark} label="Approved & Locked"
          value={stats ? fmtValueCode(stats.approvedValue ?? 0, 'AUD') : '—'}
          active={cardFilter === 'approvedValue'}
          onClick={() => { setCardFilter(cardFilter === 'approvedValue' ? null : 'approvedValue'); setActiveTab('approved') }} />
        <StatCard dark={dark} label="Pending Approval"
          value={stats?.pendingCount ?? '—'}
          active={cardFilter === 'pendingApproval'}
          onClick={() => { setCardFilter(cardFilter === 'pendingApproval' ? null : 'pendingApproval'); setActiveTab('pending') }} />
        <StatCard dark={dark} label="Ongoing" value={stats?.ongoing ?? '—'}
          active={cardFilter === 'ongoing'}
          onClick={() => { setCardFilter(cardFilter === 'ongoing' ? null : 'ongoing'); setActiveTab('all') }} />
        <StatCard dark={dark} label="Complete" value={stats?.complete ?? '—'} accent={cardFilter === 'complete' ? undefined : '#2E7D32'}
          active={cardFilter === 'complete'}
          onClick={() => { setCardFilter(cardFilter === 'complete' ? null : 'complete'); setActiveTab('all') }} />
        <StatCard dark={dark} label="Breached" value={stats?.breached ?? '—'} accent={stats && stats.breached > 0 && cardFilter !== 'breached' ? '#C62828' : undefined}
          active={cardFilter === 'breached'}
          onClick={() => { setCardFilter(cardFilter === 'breached' ? null : 'breached'); setActiveTab('all') }} />
        <StatCard dark={dark} label="At Risk" value={stats?.atRisk ?? '—'} accent={stats && stats.atRisk > 0 && cardFilter !== 'atRisk' ? '#b45309' : undefined}
          active={cardFilter === 'atRisk'}
          onClick={() => { setCardFilter(cardFilter === 'atRisk' ? null : 'atRisk'); setActiveTab('all') }} />
      </div>

      {/* ── View tabs ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, overflowX: 'auto', paddingBottom: 2 }}>
        <button style={tabSty(activeTab === 'all')}       onClick={() => setActiveTab('all')}>All POs</button>
        <button style={tabSty(activeTab === 'approved')}  onClick={() => setActiveTab('approved')}>Approved</button>
        <button style={tabSty(activeTab === 'pending')}   onClick={() => setActiveTab('pending')}>Pending approval</button>
        <button style={tabSty(activeTab === 'completed')} onClick={() => setActiveTab('completed')}>✓ Completed</button>
      </div>

      {/* ── Filter toolbar ─────────────────────────────────────────────────────── */}
      <div ref={toolbarRef} className="procurement-toolbar" style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', top: 108, zIndex: 19, background: dark ? '#0f172a' : '#f1f4f8', paddingBottom: 8 }}>
        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search PO ref, description, vendor…"
          style={{ ...inp(dark), width: 280 }}
        />
        {/* ROS date range label */}
        <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>CDD:</span>
        <input type="date" value={rosFrom} onChange={e => setRosFrom(e.target.value)} style={{ ...inp(dark), width: 130 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>—</span>
        <input type="date" value={rosTo} onChange={e => setRosTo(e.target.value)} style={{ ...inp(dark), width: 130 }} />
        {/* Critical path toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={criticalOnly} onChange={e => setCriticalOnly(e.target.checked)} style={{ cursor: 'pointer', accentColor: '#E84E0F' }} />
          ★ Critical path only
        </label>
        {/* ─── FIX 3: Group by select ──────────────────────────────────────── */}
        <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          Group by:
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as 'none' | 'vendor' | 'wbs')}
            style={{ height: 32, padding: '0 8px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
            <option value="none">None</option>
            <option value="vendor">Vendor</option>
            <option value="wbs">WBS</option>
          </select>
        </label>
        {/* Count display */}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>
          {loading ? 'Loading…' : `${pos.length} of ${total} PO${total !== 1 ? 's' : ''}`}
        </div>
        {/* ↺ Reset button — left of + New PO */}
        <button
          onClick={resetFilters}
          title="Reset filters"
          style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'IBM Plex Sans, sans-serif', flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.color = dark ? '#f1f5f9' : '#0f172a'; e.currentTarget.style.borderColor = dark ? '#475569' : '#94a3b8' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = dark ? '#334155' : '#dde3ed' }}
        >↺</button>
        {/* + New PO */}
        <button onClick={() => setShowNew(true)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          + New PO
        </button>
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 6, fontSize: 13, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>
      )}

      {/* ── PO Table ───────────────────────────────────────────────────────────── */}
      {/* FIX 1 — Sticky header:
          The wrapper has overflowX:auto + overflowY:auto which (per CSS spec) makes
          IT the scroll container for both axes. thead { top:0 } then sticks at the
          top of this container's visible area — reliable across all browsers.
          maxHeight limits the table height so the container actually scrolls.
          No CSS variable needed — top:0 is always correct for this pattern. */}
      <div style={{
        background: dark ? '#1e293b' : '#fff',
        border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
        borderRadius: 10,
        overflowX: 'auto',
        overflowY: 'auto',
        maxHeight: 'calc(100vh - 380px)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: dark ? '#0f172a' : '#f4f7fb' }}>
            <tr>
              {PO_COLS.map((c, i) => {
                const isLast   = i === PO_COLS.length - 1
                const canDrag  = !c.noResize
                const thWidth  = c.flex && widths[i] === defaultWidths[i] ? undefined : widths[i]
                return (
                  <th key={c.key} title={c.label} style={{
                    width: thWidth, height: 36, padding: '0 8px',
                    fontSize: 10, fontWeight: 700, color: '#94a3b8',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    fontFamily: 'IBM Plex Sans, sans-serif', textAlign: 'center',
                    position: 'sticky', top: 0, zIndex: 10, overflow: 'hidden', whiteSpace: 'nowrap',
                    boxSizing: 'border-box',
                    // opaque per-cell bg so rows scroll BEHIND the sticky header
                    // (borderCollapse:separate doesn't paint the <thead> background)
                    background: dark ? '#0f172a' : '#f4f7fb',
                    borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
                  }}>
                    {c.label}
                    {canDrag && <DragHandle dark={dark} onMouseDown={e => onColDown(i, e)} />}
                    {isLast && (
                      <button onClick={resetWidths} title="Reset column widths" style={{
                        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                        width: 22, height: 22, borderRadius: 4, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
                        background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13, lineHeight: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#E84E0F'; e.currentTarget.style.borderColor = 'rgba(232,78,15,0.4)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = dark ? '#334155' : '#dde3ed' }}
                      >↺</button>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={PO_COLS.length} style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</td></tr>
            )}
            {!loading && pos.length === 0 && (
              <tr><td colSpan={PO_COLS.length} style={{ padding: '48px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No purchase orders found</td></tr>
            )}
            {/* ─── FIX 3: grouped or flat render ─────────────────────────── */}
            {!loading && pos.length > 0 && (() => {
              const renderRow = (po: PO) => (
                <POTableRow key={po.id} po={po} dark={dark} colWidths={widths}
                  onStar={toggleStar}
                  onClick={p => { setRowAssignPoId(null); setDrawerPO(p) }}
                  onApprove={p => setApproveTarget(p)}
                  onNavigateToPO={onNavigateToPO}
                  users={users}
                  isAssigningExp={rowAssignPoId === po.id}
                  onOpenAssignExp={p => setRowAssignPoId(p.id)}
                  onCloseAssignExp={() => setRowAssignPoId(null)}
                  onToggleExp={toggleRowExpeditor}
                  expAssignSaving={rowAssignSaving}
                />
              )
              if (groupBy === 'none') return pos.map(renderRow)
              const grouped: Record<string, PO[]> = {}
              for (const p of pos) {
                const key = groupBy === 'vendor'
                  ? (p.supplier_name ?? p.vendor_name ?? 'Unassigned')
                  : (p.wbs_code ?? 'No WBS')
                if (!grouped[key]) grouped[key] = []
                grouped[key].push(p)
              }
              return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([grp, grpPos]) => (
                <React.Fragment key={grp}>
                  <tr style={{ background: dark ? '#0f172a' : '#f8fafc' }}>
                    <td colSpan={PO_COLS.length} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.07em', textTransform: 'uppercase', borderBottom: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>
                      {grp} <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>{grpPos.length}</span>
                    </td>
                  </tr>
                  {grpPos.map(renderRow)}
                </React.Fragment>
              ))
            })()}
          </tbody>
        </table>
      </div>

      {/* ── Item 2: Colour legend — pinned below table, above pagination ────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 8, fontSize: 11, color: '#94a3b8', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: '#2E7D32', flexShrink: 0 }} />
          CDD &gt; {stats?.atRiskDays ?? 30} days away or complete
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: '#E84E0F', flexShrink: 0 }} />
          CDD within {stats?.atRiskDays ?? 30} days — attention needed
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: '#C62828', flexShrink: 0 }} />
          CDD past — action required
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 13, color: '#c4cedf' }}>☆</span> Not on critical path
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 13, color: '#f59e0b' }}>★</span> Critical path PO
        </span>
      </div>

      {/* ── Pagination controls (shared Pager) ──────────────────────────────────── */}
      <Pager page={page} total={total} pageSize={PAGE_SIZE} dark={dark}
        onPageChange={p => setPage(Math.max(1, Math.min(totalPages, p)))} />

      {/* ── Modals & drawers ──────────────────────────────────────────────────── */}

      {/* Slide-in drawer for row click */}
      {drawerPO && (
        <PODrawer po={drawerPO} dark={dark} users={users}
          projectId={projectId} projectName={projectName}
          onClose={() => setDrawerPO(null)}
          onUpdated={handleExpeditorUpdate}
          onNavigateToPO={onNavigateToPO}
        />
      )}

      {/* New PO Wizard */}
      {showNew && (
        <NewPOWizard
          dark={dark} projectId={projectId}
          suppliers={suppliers} uoms={uoms} users={users} wbsNodes={wbsNodes}
          onClose={() => setShowNew(false)}
          onCreated={() => load()}
        />
      )}

      {/* Help modal */}
      {showHelp && <HelpModal dark={dark} onClose={() => setShowHelp(false)} />}

      {/* Approve & Lock confirm */}
      {approveTarget && (
        <SimpleConfirm
          dark={dark}
          title="Approve & Lock PO?"
          message={`This will lock ${approveTarget.po_number} for editing and pass it to Expediting. This cannot be undone.`}
          confirmLabel={approving ? 'Approving…' : 'Approve & Lock'}
          confirmStyle="primary"
          onConfirm={confirmApprove}
          onCancel={() => setApproveTarget(null)}
        />
      )}

      {/* ── Item 9A: Critical path confirm modal with reason ─────────────────── */}
      {cpTarget && (
        <Modal dark={dark} onClose={() => setCpTarget(null)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: col }}>
              {cpTarget.isCriticalPath ? 'Remove from critical path?' : `Mark ${cpTarget.po_number} as critical path?`}
            </span>
            <button onClick={() => setCpTarget(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16, lineHeight: 1.6 }}>
            {cpTarget.isCriticalPath
              ? `This will remove the critical path flag from ${cpTarget.po_number}. Provide a reason.`
              : `This will flag ${cpTarget.po_number} as critical path. All team members will be notified. Provide a reason.`}
          </p>
          <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Reason *</label>
          <input
            value={cpReason}
            onChange={e => setCpReason(e.target.value)}
            placeholder={cpTarget.isCriticalPath ? 'e.g. No longer on critical schedule path' : 'e.g. Required for plant startup by July 2025'}
            style={{ ...inp(dark), marginBottom: 16 }}
            autoFocus
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => setCpTarget(null)} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button
              onClick={confirmToggleStar}
              disabled={!cpReason.trim() || cpSaving}
              style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: cpTarget.isCriticalPath ? '#dc2626' : '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: (!cpReason.trim() || cpSaving) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!cpReason.trim() || cpSaving) ? 0.5 : 1 }}>
              {cpSaving ? 'Saving…' : (cpTarget.isCriticalPath ? 'Remove' : 'Mark Critical')}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Item 6: Bulk upload modal ────────────────────────────────────────── */}
      {showUpload && (
        <BulkUploadModal dark={dark} projectId={projectId} onClose={() => setShowUpload(false)} onImported={() => { setShowUpload(false); load() }} />
      )}
    </div>
  )
}

// ─── Item 6: BULK UPLOAD MODAL ────────────────────────────────────────────────
// Two-tab modal: Upload CSV/XLSX | Instructions.

interface BulkUploadModalProps {
  dark: boolean; projectId: number; onClose: () => void; onImported: () => void
}

const BulkUploadModal = ({ dark, projectId, onClose, onImported }: BulkUploadModalProps) => {
  const { addToast } = useToast()
  const [tab,      setTab]      = useState<'upload' | 'instructions'>('upload')
  const [parsing,  setParsing]  = useState(false)
  const [preview,  setPreview]  = useState<any[] | null>(null)
  const [importing,setImporting]= useState(false)
  const [done,     setDone]     = useState<any | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const col     = dark ? '#f1f5f9' : '#0f172a'

  const parseFile = async (file: File) => {
    setParsing(true); setPreview(null)
    try {
      const form = new FormData(); form.append('file', file)
      const { data } = await axios.post(`${API}/procurement/${projectId}/pos/bulk-upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPreview(data.preview)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Could not parse file')
    } finally { setParsing(false) }
  }

  const confirmImport = async () => {
    if (!preview) return
    setImporting(true)
    try {
      const { data } = await axios.post(`${API}/procurement/${projectId}/pos/bulk-confirm`, {
        rows: preview,
        replace_duplicates: true,
      })
      setDone(data)
      addToast('success', `Import complete: ${data.created} created, ${data.replaced} replaced`)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      addToast('error', er.response?.data?.error ?? 'Import failed')
    } finally { setImporting(false) }
  }

  const statusBadge = (s: string) => {
    const m: Record<string, { label: string; color: string }> = {
      new:       { label: '🟢 New',       color: '#15803d' },
      duplicate: { label: '🟡 Duplicate', color: '#b45309' },
      locked:    { label: '🔴 Locked',    color: '#dc2626' },
      invalid:   { label: '❌ Invalid',   color: '#dc2626' },
    }
    return m[s] ?? { label: s, color: '#64748b' }
  }

  return (
    <Modal dark={dark} onClose={onClose} wide>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: col }}>Bulk Upload POs</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['upload', 'instructions'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: tab === t ? (dark ? '#334155' : '#e2e8f0') : 'transparent', color: tab === t ? col : '#94a3b8', fontSize: 12, fontWeight: tab === t ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
            {t === 'upload' ? '↑ Upload CSV/Excel' : '📋 Instructions'}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = '' }}
          />
          {!preview && !parsing && !done && (
            <div
              onClick={() => fileRef.current?.click()}
              style={{ border: `2px dashed ${dark ? '#334155' : '#c4cedf'}`, borderRadius: 8, padding: '32px', textAlign: 'center', cursor: 'pointer', color: '#94a3b8', marginBottom: 16 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>📂</div>
              <div style={{ fontSize: 14, color: col, fontWeight: 600, marginBottom: 4 }}>Drag and drop or click to upload</div>
              <div style={{ fontSize: 12 }}>Accepts .csv and .xlsx files</div>
            </div>
          )}

          {parsing && <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>Parsing file…</div>}

          {done && (
            <div style={{ padding: '16px', borderRadius: 8, background: dark ? '#0f172a' : '#f4f7fb', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: col, marginBottom: 10 }}>Import complete</div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                <span style={{ color: '#15803d' }}>✅ {done.created} created</span>
                <span style={{ color: '#2563eb' }}>♻️ {done.replaced} replaced</span>
                <span style={{ color: '#94a3b8' }}>⏭ {done.skipped} skipped</span>
                {done.failed > 0 && <span style={{ color: '#dc2626' }}>❌ {done.failed} failed</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={onImported} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
                <button onClick={() => { setDone(null); setPreview(null) }} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Upload another</button>
              </div>
            </div>
          )}

          {preview && !done && (
            <>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
                {preview.length} rows parsed — review before confirming
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto', marginBottom: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: dark ? '#0f172a' : '#f4f7fb', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
                      {['Status','PO Number','Supplier','Description','Currency','Value','WBS','ROS Date','Errors'].map(h => (
                        <th key={h} style={{ padding: '6px 8px', fontWeight: 600, color: '#64748b', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => {
                      const { label, color } = statusBadge(r.rowStatus)
                      return (
                        <tr key={i} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, opacity: r.rowStatus === 'locked' ? 0.5 : 1 }}>
                          <td style={{ padding: '5px 8px', color, whiteSpace: 'nowrap', fontWeight: 600 }}>{label}</td>
                          <td style={{ padding: '5px 8px', fontFamily: 'JetBrains Mono, monospace', color: col }}>{r.po_number}</td>
                          <td style={{ padding: '5px 8px', color: col }}>{r.vendor_name}</td>
                          <td style={{ padding: '5px 8px', color: '#64748b', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                          <td style={{ padding: '5px 8px', color: '#64748b' }}>{r.currency}</td>
                          <td style={{ padding: '5px 8px', fontFamily: 'JetBrains Mono, monospace', color: col }}>{r.value != null ? r.value.toLocaleString() : '—'}</td>
                          <td style={{ padding: '5px 8px', fontFamily: 'JetBrains Mono, monospace', color: '#64748b' }}>{r.wbs_code || '—'}</td>
                          <td style={{ padding: '5px 8px', color: '#64748b' }}>{r.ros_date || '—'}</td>
                          <td style={{ padding: '5px 8px', color: '#ef4444', fontSize: 11 }}>{r.errors?.join(', ')}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setPreview(null)} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
                <button
                  onClick={confirmImport} disabled={importing || preview.every(r => r.rowStatus === 'locked' || r.rowStatus === 'invalid')}
                  style={{ padding: '7px 20px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: importing ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: importing ? 0.7 : 1 }}>
                  {importing ? 'Importing…' : `Import ${preview.filter(r => r.rowStatus !== 'locked').length} POs`}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'instructions' && (
        <div style={{ fontSize: 13, color: dark ? '#94a3b8' : '#475569', lineHeight: 1.7 }}>
          <p style={{ marginBottom: 10 }}>Upload a CSV or Excel (.xlsx) file with the following columns. Column headers are case-insensitive.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: dark ? '#0f172a' : '#f4f7fb' }}>{['Column','Required?','Notes'].map(h => <th key={h} style={{ padding: '6px 8px', fontWeight: 600, color: '#64748b', textAlign: 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {[
                ['PO Number',       '✅ Required', 'Unique reference. Duplicates will be detected automatically.'],
                ['Description',     'Optional',   'Brief scope description.'],
                ['Supplier',        '✅ Required', 'Supplier or vendor name.'],
                ['Group/Category',  'Optional',   'e.g. Mechanical, Electrical, Piping, HVAC.'],
                ['Currency',        'Optional',   'Default: AUD. Also accepts USD, EUR, GBP.'],
                ['PO Value',        'Optional',   'Numbers only — no $ or commas.'],
                ['Incoterms',       'Optional',   'e.g. CIF, FOB, EXW.'],
                ['WBS',             'Optional',   'WBS code as shown in project (e.g. 1.2.3).'],
                ['ROS Date',        'Optional',   'YYYY-MM-DD format. Can be set later.'],
                ['Owner',           'Optional',   'PO owner full name.'],
              ].map(r => (
                <tr key={r[0]} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                  {r.map((v, i) => <td key={i} style={{ padding: '6px 8px', color: i === 1 ? (v.includes('Required') ? '#15803d' : '#94a3b8') : (dark ? '#f1f5f9' : '#0f172a') }}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 12, fontSize: 11, color: '#94a3b8' }}>
            🟢 New rows are created. 🟡 Duplicates are replaced if they are not locked. 🔴 Locked (approved) POs are always skipped.
          </p>
        </div>
      )}
    </Modal>
  )
}

// ─── EXPORTED COMPONENT ───────────────────────────────────────────────────────
// Wraps ProcurementInner in ToastProvider so useToast() works throughout.

export interface ProcurementProps {
  dark: boolean; projectId: number; projectName: string
  onNavigateToPO?: (poId: number) => void
}

export const Procurement = ({ dark, projectId, projectName, onNavigateToPO }: ProcurementProps) => (
  <ToastProvider>
    <ProcurementInner dark={dark} projectId={projectId} projectName={projectName} onNavigateToPO={onNavigateToPO} />
  </ToastProvider>
)
