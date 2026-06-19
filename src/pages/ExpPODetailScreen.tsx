// ─── EXP PO DETAIL SCREEN ────────────────────────────────────
// Full dedicated screen for expediting PO detail. Not a modal or drawer.
// Tabs: Line Items & SCNs | Milestones | ITP | VDRL | Action Notes | Audit Trail
import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'   // modals portal to document.body — see App.tsx zoom wrapper
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { HelpButton } from '../components/HelpDrawer'
import { MilestoneTimeline } from '../components/MilestoneTimeline'
import { EXPEDITING_PO_DETAIL_HELP } from '../helpContent'
import { CreateSCNWizard } from '../components/CreateSCNWizard'
import { ToastProvider, useToast } from '../hooks/useToast'

const API = 'http://localhost:3001/api'

// ─── TYPES ────────────────────────────────────────────────────
interface Milestone {
  id: number; label: string; status: string; step_order: number
  planned_date?: string | null; forecast_date?: string | null; actual_date?: string | null
  forecast_changed_count: number
}
interface ForecastHistory {
  id: number; old_value: string | null; new_value: string; reason: string
  changed_by_name?: string; changed_at: string; entity_id: number
}
interface ChildItem {
  id: number; sub_number: string; description: string; qty: number; uom: string
  cdd?: string | null; status: string; notes?: string
}
interface POLine {
  id: number; line_number: string; description: string
  qty: number | null; uom: string; unit_price?: number | null; total_price?: number | null
  ros_date?: string | null; cdd?: string | null; wbs_code?: string | null
  heat_number_required?: number; heat_number?: string | null
  commodity_id?: number | null; commodity_name?: string | null
  equipment_tag?: string | null; equipment_tag_ref?: string | null
  status: string; child_items: ChildItem[]
}
interface ActionNote {
  id: number; note_text: string; created_at: string; created_by_name?: string | null
}
interface VDRLDocument {
  id: number; doc_number: string; title: string; doc_type: string
  revision: string; status: string; required_date?: string | null
}
interface VDRLPackage {
  id: number; name: string; status: string; documents: VDRLDocument[]
}
interface ITPItem {
  id: number; item_number: number; description: string
  inspection_type: string; timing: string
  witness_required: number; certificate_required: number
  planned_date?: string | null; forecast_date?: string | null
  po_line_id?: number | null; line_description?: string | null
  status: string; completion_date?: string | null; completion_notes?: string | null
  notes?: string | null; forecast_changed_count?: number
}
interface ITPDateHistory {
  id: number; old_value: string | null; new_value: string | null
  change_reason: string | null; changed_by_name?: string | null; created_at: string
}
interface PODetail {
  id: number; po_number: string; po_name?: string | null
  material_description?: string | null; vendor_display: string
  vendor_name?: string | null; group_category?: string | null
  owner_name?: string | null; expeditor_name?: string | null
  expeditor_names?: string[]   // all assigned expeditors (co-assignment)
  ros_date?: string | null; contract_delivery_date?: string | null
  is_critical_path?: number; is_locked?: number; status: string
  currency?: string | null; value?: number | null; incoterms?: string | null
  milestone_po_date?: string | null; milestone_fat_date?: string | null
  milestone_esd_date?: string | null; milestone_eta_date?: string | null
  milestone_ros_date?: string | null; supplier_address?: string | null
  pre_expediting_enabled?: number
  rag: string; milestones: Milestone[]; po_lines: POLine[]
  action_notes?: ActionNote[]; itp_items?: ITPItem[]
  forecast_history?: ForecastHistory[]
  vdrl_package?: VDRLPackage | null
}

interface Props {
  dark: boolean; projectId: number; projectName: string
  poId: number; onBack: () => void; userRole?: string
  onLeaf?: (ref: string | null) => void   // report the PO ref for the topbar breadcrumb leaf
}

type ActiveTab = 'lines' | 'milestones' | 'itp' | 'vdrl' | 'notes' | 'audit'

// ─── RAG / STATUS MAPS ────────────────────────────────────────
const RAG_COLORS: Record<string, string> = {
  complete: '#22c55e', red: '#ef4444', amber: '#f59e0b', blue: '#2563eb', grey: '#94a3b8'
}
const RAG_LABELS: Record<string, string> = {
  complete: 'Complete', red: 'Breached', amber: 'At Risk', blue: 'On Track', grey: 'Not Started'
}
const MS_COLORS: Record<string, string> = {
  complete: '#22c55e', breached: '#ef4444', at_risk: '#f59e0b', in_progress: '#2563eb', not_started: '#94a3b8'
}
const VDRL_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'Approved':      { bg: 'rgba(34,197,94,0.1)',   color: '#16a34a' },
  'Under review':  { bg: 'rgba(37,99,235,0.1)',   color: '#1d4ed8' },
  'Overdue':       { bg: 'rgba(239,68,68,0.1)',   color: '#dc2626' },
  'Not submitted': { bg: 'rgba(148,163,184,0.1)', color: '#64748b' },
  'Resubmit':      { bg: 'rgba(245,158,11,0.1)',  color: '#d97706' },
}

// ─── HELPERS ──────────────────────────────────────────────────
const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtShort = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—'
const fmtMoney = (v?: number | null, cur = 'AUD') =>
  v != null ? `${cur} ${v.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'

// ─── INNER COMPONENT ──────────────────────────────────────────
// Must be wrapped in ToastProvider; use the exported ExpPODetailScreen below.
const ExpPODetailScreenInner = ({ dark, projectId, projectName, poId, onBack, userRole = '', onLeaf }: Props) => {
  const { addToast } = useToast()
  const [po, setPO]           = useState<PODetail | null>(null)
  const [loading, setLoading] = useState(true)
  // Report the PO ref up to the topbar breadcrumb (leaf segment); clear on unmount.
  useEffect(() => { onLeaf?.(po?.po_number ?? null); return () => onLeaf?.(null) }, [po?.po_number, onLeaf])
  const [activeTab, setTab]   = useState<ActiveTab>('lines')

  // Milestone editing state
  const [editForecast, setEditForecast]   = useState<{ id: number; val: string; reason: string } | null>(null)
  const [editActual, setEditActual]       = useState<{ id: number; val: string; reason: string } | null>(null)
  const [showHistory, setShowHistory]     = useState<number | null>(null)
  const [savingMs, setSavingMs]           = useState(false)

  // Line items state
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set())
  const [heatInputs, setHeatInputs]       = useState<Record<number, string>>({})
  const [addChildLine, setAddChildLine]   = useState<number | null>(null)
  const [newChild, setNewChild]           = useState({ description: '', qty: '', uom: 'EA', notes: '' })

  // Action notes
  const [noteText, setNoteText] = useState('')
  const [postingNote, setPostingNote] = useState(false)
  const [noteError, setNoteError] = useState('')

  // VDRL documents (from dedicated endpoint)
  const [vdrlDocs, setVdrlDocs] = useState<any[]>([])
  const [vdrlDocsLoading, setVdrlDocsLoading] = useState(false)

  // Audit log
  const [auditLog, setAuditLog] = useState<any[]>([])
  const [auditFilter, setAuditFilter] = useState<'all'|'milestone_forecast'|'note_added'>('all')

  // ─── ITP STATE ────────────────────────────────────────────────
  // Independent load on tab mount. Mutations refetch the list.
  const [itpItems, setItpItems]         = useState<ITPItem[]>([])
  const [itpLoading, setItpLoading]     = useState(false)
  const [itpError, setItpError]         = useState('')
  const [itpModal, setItpModal]         = useState<{ mode: 'add' | 'edit'; item?: ITPItem } | null>(null)
  const [itpDelConfirm, setItpDelConfirm] = useState<ITPItem | null>(null)
  const [itpHistoryRow, setItpHistoryRow] = useState<number | null>(null)
  const [itpHistory, setItpHistory]     = useState<ITPDateHistory[]>([])
  const [itpHistoryLoading, setItpHistoryLoading] = useState(false)

  const ITP_EDIT_ROLES = new Set(['admin','project_manager','senior_expeditor','procurement_officer'])
  const canEditITP = ITP_EDIT_ROLES.has(userRole)

  const fetchITP = () => {
    setItpLoading(true)
    setItpError('')
    axios.get(`${API}/expediting/${projectId}/po/${poId}/itp`)
      .then(r => setItpItems(r.data.items || []))
      .catch(e => setItpError(e.response?.data?.error || 'Failed to load ITP items'))
      .finally(() => setItpLoading(false))
  }

  useEffect(() => {
    if (activeTab === 'itp') fetchITP()
  }, [activeTab, poId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadItpHistory = (itemId: number) => {
    if (itpHistoryRow === itemId) { setItpHistoryRow(null); return }
    setItpHistoryRow(itemId)
    setItpHistoryLoading(true)
    axios.get(`${API}/expediting/${projectId}/po/${poId}/itp/${itemId}/date-history`)
      .then(r => setItpHistory(r.data.history || []))
      .catch(() => setItpHistory([]))
      .finally(() => setItpHistoryLoading(false))
  }

  // ─── SCN WIZARD ───────────────────────────────────────────
  // showSCNWizard: toggles the Create SCN wizard modal.
  const [showSCNWizard, setShowSCNWizard] = useState(false)
  const [scnPreLineId, setScnPreLineId] = useState<number | undefined>(undefined)

  const col    = dark ? '#f1f5f9' : '#0f172a'
  const bg     = dark ? '#0f172a' : '#f4f7fb'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const inputSt = {
    fontSize: 12, padding: '6px 9px', borderRadius: 6, border: bd,
    background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%',
  }

  // ─── FETCH ────────────────────────────────────────────────
  const fetchPO = () => {
    setLoading(true)
    axios.get(`${API}/expediting/${projectId}/po/${poId}`)
      .then(r => setPO(r.data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }
  useEffect(() => { fetchPO() }, [poId])

  // ─── VDRL DOCS LOAD ───────────────────────────────────────
  // Fetches documents for this PO's VDRL package when tab is active.
  useEffect(() => {
    if (activeTab !== 'vdrl' || !po?.vdrl_package) return
    setVdrlDocsLoading(true)
    axios.get(`${API}/expediting/${projectId}/vdrl/documents`, { params: { package_id: po.vdrl_package.id } })
      .then(r => setVdrlDocs(r.data))
      .catch(() => {})
      .finally(() => setVdrlDocsLoading(false))
  }, [activeTab, po?.vdrl_package?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── AUDIT LOG LOAD ───────────────────────────────────────
  // Fetches combined forecast history + notes for this PO.
  useEffect(() => {
    if (activeTab !== 'audit') return
    axios.get(`${API}/expediting/${projectId}/po/${poId}/audit`)
      .then(r => setAuditLog(r.data))
      .catch(() => {})
  }, [activeTab, poId, projectId])

  // ─── MILESTONE SAVE — FORECAST ────────────────────────────
  const saveForecast = async () => {
    if (!editForecast || !editForecast.reason.trim()) return
    setSavingMs(true)
    try {
      await axios.put(`${API}/expediting/${projectId}/po/${poId}/milestone/${editForecast.id}/forecast`, {
        forecast_date: editForecast.val, reason: editForecast.reason,
      })
      setEditForecast(null)
      fetchPO()
    } catch (e) { console.error(e) }
    setSavingMs(false)
  }

  // ─── MILESTONE SAVE — ACTUAL ──────────────────────────────
  const saveActual = async () => {
    if (!editActual || !editActual.reason.trim()) return
    setSavingMs(true)
    try {
      await axios.put(`${API}/expediting/${projectId}/po/${poId}/milestone/${editActual.id}/actual`, {
        actual_date: editActual.val, reason: editActual.reason,
      })
      setEditActual(null)
      fetchPO()
    } catch (e) { console.error(e) }
    setSavingMs(false)
  }

  // ─── HEAT NUMBER SAVE ─────────────────────────────────────
  const saveHeatNumber = async (lineId: number) => {
    try {
      await axios.put(`${API}/expediting/${projectId}/po/${poId}/lines/${lineId}/heat-number`, {
        heat_number: heatInputs[lineId] || null,
      })
      fetchPO()
    } catch (e) { console.error(e) }
  }

  // ─── ADD CHILD ITEM ───────────────────────────────────────
  const addChild = async (lineId: number) => {
    if (!newChild.description.trim()) return
    try {
      await axios.post(`${API}/expediting/${projectId}/po/${poId}/lines/${lineId}/child-items`, {
        description: newChild.description, qty: parseFloat(newChild.qty) || 1,
        uom: newChild.uom, notes: newChild.notes,
      })
      setAddChildLine(null)
      setNewChild({ description: '', qty: '', uom: 'EA', notes: '' })
      fetchPO()
    } catch (e) { console.error(e) }
  }

  // ─── POST NOTE ────────────────────────────────────────────
  // Requires at least 3 characters; shows inline error otherwise.
  const postNote = async () => {
    if (noteText.trim().length < 3) { setNoteError('Note must be at least 3 characters.'); return }
    setNoteError('')
    setPostingNote(true)
    try {
      await axios.post(`${API}/expediting/${projectId}/po/${poId}/action-notes`, { note_text: noteText })
      setNoteText('')
      fetchPO()
    } catch (e) { console.error(e) }
    setPostingNote(false)
  }

  if (loading) return (
    <div style={{ padding: 40, fontFamily: 'IBM Plex Sans, sans-serif', color: sub }}>Loading PO detail…</div>
  )
  if (!po) return (
    <div style={{ padding: 40, fontFamily: 'IBM Plex Sans, sans-serif', color: '#ef4444' }}>PO not found.</div>
  )

  const ragColor = RAG_COLORS[po.rag] || '#94a3b8'
  const ragLabel = RAG_LABELS[po.rag] || po.rag

  // Key dates from milestones or direct fields
  const msMap: Record<number, Milestone> = {}
  po.milestones.forEach(m => { msMap[m.step_order] = m })

  // Forecast history grouped by milestone id
  const histByMs: Record<number, ForecastHistory[]> = {}
  ;(po.forecast_history || []).forEach(h => {
    if (!histByMs[h.entity_id]) histByMs[h.entity_id] = []
    histByMs[h.entity_id].push(h)
  })

  // ─── RENDER ───────────────────────────────────────────────
  return (
    <div style={{ fontFamily: 'IBM Plex Sans, sans-serif', background: bg, minHeight: '100vh' }}>

      {/* ── STICKY TOP BAR ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: dark ? '#0f172a' : '#fff', borderBottom: bd,
        padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <BackButton onFallback={onBack} dark={dark} />
        <div style={{ flex: 1 }} />
        <button
          onClick={() => { setScnPreLineId(undefined); setShowSCNWizard(true) }}
          style={{
            padding: '7px 16px', borderRadius: 6, border: 'none',
            background: '#2563eb', color: '#fff',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          + Create SCN
        </button>
        <HelpButton screenName="Expediting PO Detail" sections={EXPEDITING_PO_DETAIL_HELP} dark={dark} />
      </div>

      <div style={{ padding: '24px 24px 40px' }}>

        {/* ── PO HEADER CARD ── */}
        <div style={{ background: cardBg, border: bd, borderRadius: 10, padding: 24, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>

          {/* PO ref + name + RAG */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 700, color: '#E84E0F' }}>
                  {po.po_number}
                </span>
                {po.is_critical_path ? <span style={{ color: '#f59e0b', fontSize: 16 }} title="Critical Path">★</span> : null}
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 10, background: `${ragColor}20`, color: ragColor, fontWeight: 600, border: `1px solid ${ragColor}40` }}>
                  {ragLabel}
                </span>
              </div>
              {po.po_name && <div style={{ fontSize: 15, fontWeight: 600, color: col, marginBottom: 2 }}>{po.po_name}</div>}
              {po.material_description && <div style={{ fontSize: 12, color: sub }}>{po.material_description}</div>}
            </div>
          </div>

          {/* Meta grid 2×4 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px 16px', marginBottom: 16 }}>
            {[
              ['Vendor', po.vendor_display || po.vendor_name || '—'],
              ['Group', po.group_category || '—'],
              ['Owner', po.owner_name || '—'],
              [(po.expeditor_names && po.expeditor_names.length > 1) ? 'Expeditors' : 'Expeditor',
               (po.expeditor_names && po.expeditor_names.length) ? po.expeditor_names.join(', ') : (po.expeditor_name || '—')],
              ['PO Award', fmt(po.milestone_po_date)],
              ['Contract Del.', fmt(po.contract_delivery_date)],
              ['ROS', fmt(po.ros_date)],
              ['Incoterms', po.incoterms || '—'],
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: 9, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 12, color: col, fontWeight: 500 }}>{val}</div>
              </div>
            ))}
          </div>

          {/* FIX 2 — Supplier & Logistics strip */}
          <div style={{
            background: '#f0f4ff', borderRadius: 8, padding: '10px 16px',
            display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16, fontSize: 12,
          }}>
            {[
              { label: 'SUPPLIER',      value: po.vendor_name || po.vendor_display || '—' },
              { label: 'CONTACT',       value: (po as any).supplier_contact || '—' },
              { label: 'PICK UP FROM',  value: (po as any).handover_point || (po as any).supplier_address || '—' },
              { label: 'DELIVER TO',    value: (po as any).handover_point || '—' },
              { label: 'FORWARDER',     value: (po as any).forwarder_name || '— Not assigned' },
              { label: 'INCOTERMS',     value: po.incoterms || '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#0f172a' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Key dates strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
            {[
              ['PO AWARD', po.milestone_po_date],
              ['FAT',      po.milestone_fat_date],
              ['ESD',      po.milestone_esd_date],
              ['ETA',      po.milestone_eta_date],
              ['ROS',      po.milestone_ros_date || po.ros_date],
            ].map(([label, date]) => (
              <div key={label as string} style={{ background: dark ? '#0f172a' : '#f8fafc', borderRadius: 6, padding: '8px 10px', border: bd, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: col }}>{fmtShort(date as string)}</div>
              </div>
            ))}
          </div>

          {/* Milestone timeline summary — no "Milestone progress:" prefix (wastes space) */}
          <div style={{ width: '100%' }}>
            <MilestoneTimeline milestones={po.milestones} size="lg" showDates={true} dark={dark} />
          </div>
        </div>

        {/* ── TABS ── */}
        <div style={{ display: 'flex', gap: 2, borderBottom: bd, marginBottom: 0 }}>
          {([
            ['lines',      'Line Items & SCNs'],
            ['milestones', 'Milestones'],
            ['itp',        'ITP'],
            ['vdrl',       'VDRL'],
            ['notes',      'Action Notes'],
            ['audit',      'Audit Trail'],
          ] as [ActiveTab, string][]).map(([tab, label]) => (
            <button key={tab} onClick={() => setTab(tab)} style={{
              padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid #E84E0F' : '2px solid transparent',
              fontSize: 12, fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? '#E84E0F' : sub,
              fontFamily: 'inherit', marginBottom: -1,
            }}>{label}</button>
          ))}
        </div>

        <div style={{ background: cardBg, border: bd, borderTop: 'none', borderRadius: '0 0 10px 10px' }}>

          {/* ── TAB: Line Items & SCNs ── */}
          {activeTab === 'lines' && (
            <div style={{ padding: 20 }}>
              {(po.po_lines || []).length === 0 ? (
                <div style={{ color: sub, fontSize: 13, textAlign: 'center', padding: 40 }}>No line items.</div>
              ) : (po.po_lines || []).map(line => {
                const isExpanded = expandedLines.has(line.id)
                return (
                  <div key={line.id} style={{ border: bd, borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
                    {/* Line header */}
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: dark ? '#162032' : '#f8fafc', cursor: 'pointer' }}
                      onClick={() => setExpandedLines(s => {
                        const ns = new Set(s)
                        ns.has(line.id) ? ns.delete(line.id) : ns.add(line.id)
                        return ns
                      })}
                    >
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#E84E0F' }}>
                        Line {line.line_number}
                      </span>
                      <span style={{ flex: 1, fontSize: 12, color: col }}>{line.description}</span>
                      {line.commodity_name ? (
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(37,99,235,0.1)', color: '#1d4ed8' }}>{line.commodity_name}</span>
                      ) : (
                        <span style={{ fontSize: 10, color: '#f59e0b' }}>⚠ Not linked</span>
                      )}
                      {line.ros_date && <span style={{ fontSize: 10, color: sub }}>ROS: {fmtShort(line.ros_date)}</span>}
                      <span style={{ fontSize: 11, color: sub }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                    {/* Line body */}
                    {isExpanded && (
                      <div style={{ padding: 14 }}>
                        {/* Heat number */}
                        {line.heat_number_required ? (
                          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, color: sub, whiteSpace: 'nowrap' }}>Heat No.:</span>
                            <input
                              style={{ ...inputSt, width: 180 }}
                              value={heatInputs[line.id] ?? (line.heat_number || '')}
                              onChange={e => setHeatInputs(s => ({ ...s, [line.id]: e.target.value }))}
                              placeholder="Enter heat number…"
                            />
                            <button onClick={() => saveHeatNumber(line.id)} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 5, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer' }}>
                              Save
                            </button>
                          </div>
                        ) : null}

                        {/* Qty info */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                          {[
                            ['Total Qty', `${line.qty ?? '—'} ${line.uom}`],
                            ['Unit Price', fmtMoney(line.unit_price)],
                            ['Total Price', fmtMoney(line.total_price)],
                          ].map(([l, v]) => (
                            <div key={l} style={{ background: dark ? '#0f172a' : '#f8fafc', borderRadius: 5, padding: '8px 10px', border: bd }}>
                              <div style={{ fontSize: 9, color: sub, textTransform: 'uppercase', marginBottom: 2 }}>{l}</div>
                              <div style={{ fontSize: 12, fontWeight: 600, color: col }}>{v}</div>
                            </div>
                          ))}
                        </div>

                        {/* Child items */}
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: col }}>Child Items ({(line.child_items||[]).length})</span>
                            <button
                              onClick={() => setAddChildLine(addChildLine === line.id ? null : line.id)}
                              style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: bd, background: 'transparent', color: col, cursor: 'pointer' }}>
                              + Add
                            </button>
                          </div>
                          {(line.child_items||[]).length === 0 ? (
                            <div style={{ fontSize: 11, color: sub, fontStyle: 'italic' }}>No child items.</div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                              <thead>
                                <tr style={{ borderBottom: bd }}>
                                  {['#', 'Description', 'Qty', 'UOM', 'Status'].map(h => (
                                    <th key={h} style={{ padding: '4px 8px', textAlign: 'center', color: sub, fontWeight: 600, fontSize: 9, textTransform: 'uppercase' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(line.child_items||[]).map(ci => (
                                  <tr key={ci.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                                    <td style={{ padding: '4px 8px', color: sub }}>{ci.sub_number}</td>
                                    <td style={{ padding: '4px 8px', color: col }}>{ci.description}</td>
                                    <td style={{ padding: '4px 8px', color: col }}>{ci.qty}</td>
                                    <td style={{ padding: '4px 8px', color: sub }}>{ci.uom}</td>
                                    <td style={{ padding: '4px 8px' }}>
                                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 8, background: 'rgba(148,163,184,0.1)', color: sub }}>{ci.status}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {/* Add child form */}
                          {addChildLine === line.id && (
                            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '2fr 80px 60px 1fr auto', gap: 6, alignItems: 'end' }}>
                              <input style={inputSt} placeholder="Description" value={newChild.description} onChange={e => setNewChild(s => ({ ...s, description: e.target.value }))} />
                              <input style={inputSt} placeholder="Qty" type="number" value={newChild.qty} onChange={e => setNewChild(s => ({ ...s, qty: e.target.value }))} />
                              <input style={inputSt} placeholder="UOM" value={newChild.uom} onChange={e => setNewChild(s => ({ ...s, uom: e.target.value }))} />
                              <input style={inputSt} placeholder="Notes" value={newChild.notes} onChange={e => setNewChild(s => ({ ...s, notes: e.target.value }))} />
                              <button onClick={() => addChild(line.id)} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 5, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                Add
                              </button>
                            </div>
                          )}
                        </div>

                        {/* SCN stub */}
                        <div style={{ fontSize: 11, color: sub, fontStyle: 'italic' }}>SCN: No SCN assigned — Create SCN (coming soon)</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── TAB: Milestones ── */}
          {activeTab === 'milestones' && (
            <div style={{ padding: 20 }}>
              <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
                <MilestoneTimeline milestones={po.milestones} size="lg" showDates={true} dark={dark} />
              </div>
              {po.milestones.map((m, idx) => {
                const msColor = MS_COLORS[m.status] || '#94a3b8'
                const history = histByMs[m.id] || []
                const isNotStarted = m.status === 'not_started'
                return (
                  <div key={m.id} style={{ border: bd, borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
                    {/* Milestone header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: dark ? '#162032' : '#f8fafc' }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: isNotStarted ? 'transparent' : msColor, border: isNotStarted ? `2px solid ${msColor}` : 'none', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: col }}>{m.label}</span>
                      <span style={{ fontSize: 10, color: sub }}>{idx + 1} of 5</span>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: `${msColor}20`, color: msColor, textTransform: 'capitalize' }}>{m.status.replace('_', ' ')}</span>
                      <div style={{ flex: 1 }} />
                      {m.forecast_changed_count > 0 && (
                        <button
                          onClick={() => setShowHistory(showHistory === m.id ? null : m.id)}
                          style={{ fontSize: 10, color: sub, cursor: 'pointer', background: 'none', border: 'none', fontFamily: 'inherit' }}>
                          Changed {m.forecast_changed_count}× {showHistory === m.id ? '▲' : '▼'}
                        </button>
                      )}
                    </div>
                    {/* Milestone dates */}
                    <div style={{ padding: 14 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                        {[
                          { label: 'PLANNED',  date: m.planned_date,  edit: null },
                          { label: 'FORECAST', date: m.forecast_date, edit: 'forecast' },
                          { label: 'ACTUAL',   date: m.actual_date,   edit: 'actual' },
                        ].map(({ label, date, edit }) => (
                          <div key={label} style={{ background: dark ? '#0f172a' : '#f8fafc', borderRadius: 5, padding: '8px 10px', border: bd }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 9, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
                              {edit && (
                                <button
                                  onClick={() => edit === 'forecast'
                                    ? setEditForecast({ id: m.id, val: m.forecast_date || '', reason: '' })
                                    : setEditActual({ id: m.id, val: m.actual_date || '', reason: '' })
                                  }
                                  style={{ fontSize: 10, color: '#E84E0F', cursor: 'pointer', background: 'none', border: 'none', fontFamily: 'inherit', padding: 0 }}>
                                  ✎
                                </button>
                              )}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: col, marginTop: 4 }}>{fmt(date)}</div>
                          </div>
                        ))}
                      </div>

                      {/* Forecast edit form */}
                      {editForecast?.id === m.id && (
                        <div style={{ background: dark ? '#162032' : '#f0f4ff', borderRadius: 6, padding: 12, marginBottom: 8, border: `1px solid #2563eb40` }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: col, marginBottom: 8 }}>Update Forecast Date</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto auto', gap: 6, alignItems: 'end' }}>
                            <input type="date" style={inputSt} value={editForecast.val} onChange={e => setEditForecast(s => s ? { ...s, val: e.target.value } : null)} />
                            <input style={inputSt} placeholder="Reason (required)…" value={editForecast.reason} onChange={e => setEditForecast(s => s ? { ...s, reason: e.target.value } : null)} />
                            <button onClick={saveForecast} disabled={savingMs} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 5, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer' }}>Save</button>
                            <button onClick={() => setEditForecast(null)} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 5, border: bd, background: 'transparent', color: col, cursor: 'pointer' }}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* Actual edit form */}
                      {editActual?.id === m.id && (
                        <div style={{ background: dark ? '#162032' : '#f0fff4', borderRadius: 6, padding: 12, marginBottom: 8, border: `1px solid #22c55e40` }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: col, marginBottom: 8 }}>Record Actual Date</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto auto', gap: 6, alignItems: 'end' }}>
                            <input type="date" style={inputSt} value={editActual.val} onChange={e => setEditActual(s => s ? { ...s, val: e.target.value } : null)} />
                            <input style={inputSt} placeholder="Reason (required)…" value={editActual.reason} onChange={e => setEditActual(s => s ? { ...s, reason: e.target.value } : null)} />
                            <button onClick={saveActual} disabled={savingMs} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 5, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer' }}>Save</button>
                            <button onClick={() => setEditActual(null)} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 5, border: bd, background: 'transparent', color: col, cursor: 'pointer' }}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* History */}
                      {showHistory === m.id && history.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontSize: 10, color: sub, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>Forecast History</div>
                          {history.map(h => (
                            <div key={h.id} style={{ display: 'flex', gap: 10, fontSize: 11, padding: '4px 0', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                              <span style={{ color: sub }}>{fmt(h.changed_at)}</span>
                              <span style={{ color: sub }}>{h.changed_by_name || 'System'}</span>
                              <span style={{ color: '#ef4444' }}>{fmt(h.old_value)}</span>
                              <span style={{ color: sub }}>→</span>
                              <span style={{ color: '#22c55e' }}>{fmt(h.new_value)}</span>
                              <span style={{ color: col, flex: 1 }}>{h.reason}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── TAB: ITP ── */}
          {activeTab === 'itp' && (
            <div style={{ padding: 20 }}>
              {/* ── Toolbar ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: col }}>ITP Requirements</span>
                  {!itpLoading && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: 'rgba(37,99,235,0.08)', color: '#2563eb', fontWeight: 600 }}>
                      {itpItems.length} item{itpItems.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {canEditITP && (
                  <button onClick={() => setItpModal({ mode: 'add' })}
                    style={{ background: '#E84E0F', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    + Add ITP item
                  </button>
                )}
              </div>

              {itpLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: sub, fontSize: 13 }}>Loading ITP items…</div>
              ) : itpError ? (
                <div style={{ color: '#ef4444', fontSize: 13, padding: '12px 16px', background: 'rgba(239,68,68,0.07)', borderRadius: 8 }}>{itpError}</div>
              ) : itpItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 50, color: sub }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
                  <div style={{ fontSize: 13, marginBottom: 12 }}>No ITP requirements configured for this PO.</div>
                  {canEditITP && (
                    <button onClick={() => setItpModal({ mode: 'add' })}
                      style={{ background: 'none', border: `1px solid #E84E0F`, color: '#E84E0F', borderRadius: 6, padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}>
                      Add the first ITP item →
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="app-grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: dark ? '#162032' : '#f8fafc', borderBottom: bd }}>
                        {[
                          ['#',             '48px',  'right'],
                          ['Description',   'auto',  'left'],
                          ['Type',          '160px', 'left'],
                          ['Timing',        '100px', 'left'],
                          ['Linked Line',   '140px', 'left'],
                          ['Planned',       '110px', 'left'],
                          ['Forecast',      '150px', 'left'],
                          ['Status',        '120px', 'left'],
                          ['Witness',       '72px',  'center'],
                          ['Certificate',   '72px',  'center'],
                          ['Actions',       '72px',  'center'],
                        ].map(([h, w, align]) => (
                          <th key={h} style={{ padding: '8px 10px', textAlign: align as any, fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', width: w, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {itpItems.map(item => {
                        // ── inspection type pill colours
                        const typeConf: Record<string, { label: string; bg: string; color: string }> = {
                          hold_point:  { label: 'Hold point',       bg: 'rgba(239,68,68,0.1)',   color: '#ef4444' },
                          witness:     { label: 'Witness point',    bg: 'rgba(232,78,15,0.1)',   color: '#E84E0F' },
                          review:      { label: 'Review point',     bg: 'rgba(37,99,235,0.1)',   color: '#2563eb' },
                          document:    { label: 'Information only', bg: 'rgba(148,163,184,0.1)', color: '#64748b' },
                        }
                        const tc = typeConf[item.inspection_type] || { label: item.inspection_type, bg: 'rgba(148,163,184,0.1)', color: '#64748b' }

                        // ── status pill colours
                        const stConf: Record<string, { bg: string; color: string }> = {
                          not_started: { bg: 'rgba(148,163,184,0.12)', color: '#64748b' },
                          in_progress: { bg: 'rgba(37,99,235,0.1)',    color: '#2563eb' },
                          complete:    { bg: 'rgba(34,197,94,0.1)',     color: '#16a34a' },
                          on_hold:     { bg: 'rgba(245,158,11,0.1)',    color: '#d97706' },
                          waived:      { bg: 'rgba(124,58,237,0.1)',    color: '#7c3aed' },
                        }
                        const sc = stConf[item.status] || stConf.not_started

                        const timingPill = item.timing === 'pre_delivery'
                          ? { label: 'Pre-delivery', bg: 'rgba(37,99,235,0.1)', color: '#2563eb' }
                          : { label: 'Post-delivery', bg: 'rgba(148,163,184,0.12)', color: '#64748b' }

                        const fmtD = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

                        const histOpen = itpHistoryRow === item.id

                        return (
                          <React.Fragment key={item.id}>
                            <tr style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{item.item_number}</td>
                              <td data-align="left" style={{ padding: '8px 10px', color: col, maxWidth: 240 }}>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.description}>{item.description}</div>
                              </td>
                              <td style={{ padding: '8px 10px' }}>
                                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: tc.bg, color: tc.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{tc.label}</span>
                              </td>
                              <td style={{ padding: '8px 10px' }}>
                                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: timingPill.bg, color: timingPill.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{timingPill.label}</span>
                              </td>
                              <td data-align="left" style={{ padding: '8px 10px', color: sub, fontSize: 11 }}>
                                {item.line_description ? <span style={{ color: col }}>{item.line_description}</span> : '—'}
                              </td>
                              <td data-align="center" style={{ padding: '8px 10px', color: sub, fontSize: 11 }}>{fmtD(item.planned_date)}</td>
                              <td data-align="center" style={{ padding: '8px 10px', fontSize: 11 }}>
                                <div style={{ color: col }}>{fmtD(item.forecast_date)}</div>
                                {(item.forecast_changed_count ?? 0) > 0 && (
                                  <button onClick={() => loadItpHistory(item.id)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d97706', fontSize: 10, padding: 0, marginTop: 2 }}>
                                    Changed {item.forecast_changed_count}×
                                  </button>
                                )}
                              </td>
                              <td data-align="center" data-col="status" style={{ padding: '8px 10px' }}>
                                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: sc.bg, color: sc.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                  {item.status.replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: item.witness_required ? 'rgba(232,78,15,0.1)' : 'rgba(148,163,184,0.1)', color: item.witness_required ? '#E84E0F' : sub, fontWeight: 600 }}>
                                  {item.witness_required ? 'Yes' : 'No'}
                                </span>
                              </td>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: item.certificate_required ? 'rgba(232,78,15,0.1)' : 'rgba(148,163,184,0.1)', color: item.certificate_required ? '#E84E0F' : sub, fontWeight: 600 }}>
                                  {item.certificate_required ? 'Yes' : 'No'}
                                </span>
                              </td>
                              <td data-align="center" style={{ padding: '8px 10px', textAlign: 'center' }}>
                                {canEditITP && (
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <button title="Edit" onClick={() => setItpModal({ mode: 'edit', item })}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: 14, padding: '2px 4px' }}>✎</button>
                                    <button title="Delete" onClick={() => setItpDelConfirm(item)}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14, padding: '2px 4px' }}>🗑</button>
                                  </div>
                                )}
                              </td>
                            </tr>

                            {/* ── Inline date-history panel ── */}
                            {histOpen && (
                              <tr>
                                <td colSpan={11} style={{ padding: 0 }}>
                                  <div style={{ background: dark ? '#162032' : '#f8fafc', borderBottom: bd, padding: '10px 24px' }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: sub, marginBottom: 8 }}>Forecast date change history</div>
                                    {itpHistoryLoading ? (
                                      <div style={{ color: sub, fontSize: 12 }}>Loading…</div>
                                    ) : itpHistory.length === 0 ? (
                                      <div style={{ color: sub, fontSize: 12 }}>No changes recorded.</div>
                                    ) : (
                                      <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                                        <thead>
                                          <tr>
                                            {['Changed at','Changed by','From','To','Reason'].map(h => (
                                              <th key={h} style={{ padding: '4px 12px', textAlign: 'center', color: sub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {itpHistory.map(h => (
                                            <tr key={h.id}>
                                              <td style={{ padding: '4px 12px', color: sub }}>{new Date(h.created_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                                              <td style={{ padding: '4px 12px', color: col }}>{h.changed_by_name || '—'}</td>
                                              <td style={{ padding: '4px 12px', color: '#ef4444' }}>{h.old_value ? new Date(h.old_value).toLocaleDateString('en-AU') : '—'}</td>
                                              <td style={{ padding: '4px 12px', color: '#16a34a' }}>{h.new_value ? new Date(h.new_value).toLocaleDateString('en-AU') : '—'}</td>
                                              <td style={{ padding: '4px 12px', color: col }}>{h.change_reason || '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Delete confirm dialog ── */}
              {itpDelConfirm && createPortal(
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
                  <div style={{ background: cardBg, borderRadius: 10, padding: 28, maxWidth: 380, width: '90%', border: bd }}>
                    <div style={{ fontWeight: 600, marginBottom: 12, color: col }}>Delete ITP item #{itpDelConfirm.item_number}?</div>
                    <div style={{ fontSize: 13, color: sub, marginBottom: 20 }}>This cannot be undone.</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => setItpDelConfirm(null)}
                        style={{ padding: '6px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                      <button onClick={async () => {
                          try {
                            await axios.delete(`${API}/expediting/${projectId}/po/${poId}/itp/${itpDelConfirm.id}`)
                            setItpDelConfirm(null)
                            fetchITP()
                          } catch (e: any) {
                            addToast('error', e.response?.data?.error || 'Failed to delete ITP item')
                            setItpDelConfirm(null)
                          }
                        }}
                        style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>,
                document.body,
              )}

              {/* ── Add / Edit modal ── */}
              {itpModal && (
                <ITPItemModal
                  dark={dark} mode={itpModal.mode} item={itpModal.item}
                  poLines={po?.po_lines || []}
                  onClose={() => setItpModal(null)}
                  onSaved={() => { setItpModal(null); fetchITP() }}
                  projectId={projectId} poId={poId}
                  addToast={addToast}
                />
              )}
            </div>
          )}

          {/* ── TAB: VDRL ── */}
          {activeTab === 'vdrl' && (
            <div style={{ padding: 20 }}>
              {!po.vdrl_package ? (
                <div style={{ color: sub, fontSize: 13, textAlign: 'center', padding: 40 }}>No VDRL package configured for this PO.</div>
              ) : (
                <>
                  {/* Package header */}
                  <div style={{ background: dark?'#162032':'#f8fafc', border: bd, borderRadius: 8, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: col }}>{po.vdrl_package.name}</span>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', color: '#16a34a' }}>{po.vdrl_package.status}</span>
                    <span style={{ fontSize: 11, color: sub }}>{vdrlDocs.length || (po.vdrl_package.documents||[]).length} doc{(vdrlDocs.length || (po.vdrl_package.documents||[]).length) !== 1 ? 's' : ''}</span>
                    <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 8 }}>
                      {(vdrlDocs.length ? vdrlDocs : (po.vdrl_package.documents||[])).filter((d:any) => d.status === 'Overdue').length > 0
                        ? `${(vdrlDocs.length ? vdrlDocs : (po.vdrl_package.documents||[])).filter((d:any)=>d.status==='Overdue').length} overdue` : ''}
                    </span>
                  </div>
                  {vdrlDocsLoading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: sub }}>Loading documents…</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="app-grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: dark ? '#162032' : '#f8fafc', borderBottom: bd }}>
                            {['DOC NO','TITLE','TYPE','REV','REQUIRED','PROMISED','SUBMITTED','STATUS','ABF'].map(h => (
                              <th key={h} style={{ padding: '7px 10px', textAlign: 'center', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(vdrlDocs.length ? vdrlDocs : (po.vdrl_package.documents||[])).map((d: any) => {
                            const statusMap: Record<string,{bg:string;color:string;label:string}> = {
                              'Approved':      {bg:'rgba(34,197,94,0.12)', color:'#16a34a',label:'Approved'},
                              'Under review':  {bg:'rgba(37,99,235,0.12)', color:'#1d4ed8',label:'Under review'},
                              'Overdue':       {bg:'rgba(239,68,68,0.12)', color:'#dc2626',label:'Overdue'},
                              'Not submitted': {bg:'rgba(148,163,184,0.12)',color:'#64748b',label:'Not submitted'},
                              'Resubmit':      {bg:'rgba(245,158,11,0.12)',color:'#d97706',label:'Resubmit'},
                            }
                            const pill = statusMap[d.status] || statusMap['Not submitted']
                            const fmtS = (dt: string|null|undefined) => dt ? new Date(dt).toLocaleDateString('en-AU',{day:'2-digit',month:'short'}) : '—'
                            return (
                              <tr key={d.id} style={{ borderBottom: `1px solid ${dark?'#1e293b':'#f1f5f9'}`, borderLeft: d.status==='Overdue'?'3px solid #f59e0b':'3px solid transparent' }}>
                                <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', whiteSpace: 'nowrap' }}>{d.doc_number || '—'}</td>
                                <td data-align="left" style={{ padding: '8px 10px', color: col, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.title}>{d.title}</td>
                                <td style={{ padding: '8px 10px', color: sub, fontSize: 11 }}>{d.doc_type || '—'}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{d.revision || '—'}</td>
                                <td data-align="center" style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: d.required_date&&new Date(d.required_date)<new Date()&&!d.submitted_date?'#ef4444':sub, whiteSpace:'nowrap' }}>{fmtS(d.required_date)}</td>
                                <td data-align="center" style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub, whiteSpace:'nowrap' }}>{fmtS(d.promised_date)}</td>
                                <td data-align="center" style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: d.submitted_date?'#22c55e':sub, whiteSpace:'nowrap' }}>{fmtS(d.submitted_date)}</td>
                                <td data-align="center" data-col="status" style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 9999, background: pill.bg, color: pill.color, fontWeight: 500 }}>{pill.label}</span>
                                </td>
                                <td data-align="center" style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                                  {d.abf_required ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 9999, background: d.abf_cleared?'rgba(34,197,94,0.1)':'rgba(245,158,11,0.1)', color: d.abf_cleared?'#16a34a':'#d97706' }}>{d.abf_cleared?'AFC':'C1'}</span> : <span style={{ color: sub, fontSize: 10 }}>—</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── TAB: Action Notes ── */}
          {activeTab === 'notes' && (
            <div style={{ padding: 20 }}>
              {/* Add note — minimum 3 chars */}
              <div style={{ marginBottom: 20 }}>
                <textarea
                  value={noteText}
                  onChange={e => { setNoteText(e.target.value); if (noteError) setNoteError('') }}
                  placeholder="Add an action note…"
                  rows={3}
                  style={{ ...inputSt, resize: 'vertical', marginBottom: 6, border: noteError ? '1px solid #ef4444' : bd }}
                />
                {noteError && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6 }}>{noteError}</div>}
                <button
                  onClick={postNote} disabled={postingNote}
                  style={{ fontSize: 12, padding: '7px 16px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', opacity: postingNote ? 0.5 : 1 }}>
                  {postingNote ? 'Posting…' : 'Post Note'}
                </button>
              </div>

              {(po.action_notes || []).length === 0 ? (
                <div style={{ color: sub, fontSize: 13, textAlign: 'center', padding: 20 }}>No action notes yet.</div>
              ) : (po.action_notes || []).map(n => (
                <div key={n.id} style={{ border: bd, borderRadius: 6, padding: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: col }}>{n.created_by_name || 'Unknown'}</span>
                    <span style={{ fontSize: 10, color: sub }}>{fmt(n.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: col, lineHeight: 1.5 }}>{n.note_text}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── TAB: Audit Trail ── */}
          {activeTab === 'audit' && (
            <div style={{ padding: 20 }}>
              {/* Filter pills */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {(['all','milestone_forecast','note_added'] as const).map(f => (
                  <button key={f} onClick={() => setAuditFilter(f)}
                    style={{ padding: '4px 12px', borderRadius: 20, border: `1px solid ${auditFilter===f?'#2563eb':bd}`, background: auditFilter===f?'#2563eb':'none', color: auditFilter===f?'#fff':sub, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {f==='all'?'All':f==='milestone_forecast'?'Milestone changes':'Notes'}
                  </button>
                ))}
              </div>
              {auditLog.filter(e => auditFilter==='all' || e.type===auditFilter).length === 0 ? (
                <div style={{ color: sub, fontSize: 13, textAlign: 'center', padding: 40, fontStyle: 'italic' }}>No audit entries yet.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: dark?'#0f172a':'#f8fafc', borderBottom: bd }}>
                      {['Timestamp','User','Action','Old Value','New Value'].map(h => (
                        <th key={h} style={{ padding: '7px 10px', textAlign: 'center', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.filter(e => auditFilter==='all' || e.type===auditFilter).map(e => (
                      <tr key={e.id} style={{ borderBottom: bd }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub, whiteSpace: 'nowrap' }}>
                          {new Date(e.timestamp).toLocaleDateString('en-AU',{day:'2-digit',month:'short'})}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 500, color: col }}>{e.user_name || '—'}</td>
                        <td style={{ padding: '8px 10px', color: col }}>{e.action}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#ef4444' }}>{e.old_value || '—'}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#22c55e' }}>
                          {typeof e.new_value==='string'&&e.new_value.length>40 ? e.new_value.slice(0,40)+'…' : e.new_value || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── CREATE SCN WIZARD ── */}
      {showSCNWizard && (
        <CreateSCNWizard
          poId={po.id}
          projectId={projectId}
          preSelectedLineId={scnPreLineId}
          onClose={() => setShowSCNWizard(false)}
          onCreated={() => { setShowSCNWizard(false); fetchPO() }}
          onToast={(msg, type) => addToast(type, msg)}
        />
      )}
    </div>
  )
}

// ─── ITP ITEM MODAL ──────────────────────────────────────────
// Add / Edit modal for ITP requirements.
// Inspection type values must match the DB enum: hold_point, witness, review, document.
const ITPItemModal = ({
  dark, mode, item, poLines, onClose, onSaved, projectId, poId, addToast,
}: {
  dark: boolean; mode: 'add' | 'edit'; item?: ITPItem
  poLines: { id: number; line_number: string; description: string }[]
  onClose: () => void; onSaved: () => void
  projectId: number; poId: number
  addToast: (type: 'success' | 'error', msg: string) => void
}) => {
  const [desc,        setDesc]       = useState(item?.description || '')
  const [iType,       setIType]      = useState(item?.inspection_type || 'witness')
  const [timing,      setTiming]     = useState(item?.timing || 'pre_delivery')
  const [lineId,      setLineId]     = useState<string>(item?.po_line_id ? String(item.po_line_id) : '')
  const [plannedDate, setPlanned]    = useState(item?.planned_date ? item.planned_date.slice(0,10) : '')
  const [fcastDate,   setFcast]      = useState(item?.forecast_date ? item.forecast_date.slice(0,10) : '')
  const [witness,     setWitness]    = useState(!!(item?.witness_required))
  const [cert,        setCert]       = useState(!!(item?.certificate_required))
  const [status,      setStatus]     = useState(item?.status || 'not_started')
  const [compDate,    setCompDate]   = useState(item?.completion_date ? item.completion_date.slice(0,10) : '')
  const [compNotes,   setCompNotes]  = useState(item?.completion_notes || '')
  const [notes,       setNotes]      = useState(item?.notes || '')
  const [fcastReason, setFcastReason]= useState('')
  const [saving, setSaving]          = useState(false)
  const [errors, setErrors]          = useState<Record<string, string>>({})

  const origFcast = item?.forecast_date ? item.forecast_date.slice(0,10) : ''
  const fcastChanged = mode === 'edit' && fcastDate !== origFcast

  const col     = dark ? '#f1f5f9' : '#0f172a'
  const cardBg  = dark ? '#1e293b' : '#fff'
  const bd      = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const inputSt: React.CSSProperties = {
    fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd,
    background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
  }
  const lblSt: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4, display: 'block' }

  const validate = () => {
    const errs: Record<string, string> = {}
    if (!desc.trim()) errs.desc = 'Description is required'
    if (!iType) errs.iType = 'Inspection type is required'
    if (!timing) errs.timing = 'Timing is required'
    if (fcastChanged && !fcastReason.trim()) errs.fcastReason = 'Reason is required when changing forecast date'
    return errs
  }

  const handleSave = async () => {
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setSaving(true)
    try {
      const body: any = {
        description: desc.trim(), inspection_type: iType, timing,
        po_line_id: lineId ? Number(lineId) : null,
        planned_date: plannedDate || null, forecast_date: fcastDate || null,
        witness_required: witness, certificate_required: cert,
        status, notes: notes || null,
        completion_date: status === 'complete' ? (compDate || null) : null,
        completion_notes: compNotes || null,
      }
      if (fcastChanged) body.forecast_reason = fcastReason.trim()

      if (mode === 'add') {
        await axios.post(`http://localhost:3001/api/expediting/${projectId}/po/${poId}/itp`, body)
        addToast('success', 'ITP item added')
      } else {
        await axios.put(`http://localhost:3001/api/expediting/${projectId}/po/${poId}/itp/${item!.id}`, body)
        addToast('success', 'ITP item updated')
      }
      onSaved()
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to save ITP item')
    }
    setSaving(false)
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 3000, overflowY: 'auto', paddingTop: '5vh', paddingBottom: '5vh' }}>
      <div style={{ background: cardBg, borderRadius: 12, padding: 28, width: 580, maxWidth: '94vw', border: bd, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
        {/* Title */}
        <div style={{ fontWeight: 700, fontSize: 15, color: col, marginBottom: 20 }}>
          {mode === 'add' ? 'Add ITP Item' : `Edit ITP Item — #${item?.item_number}`}
        </div>

        {/* Description */}
        <div style={{ marginBottom: 14 }}>
          <label style={lblSt}>Description *</label>
          <input value={desc} onChange={e => { setDesc(e.target.value); setErrors(p => ({ ...p, desc: '' })) }}
            placeholder="e.g. Hydrostatic pressure test" style={inputSt} />
          {errors.desc && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 3 }}>{errors.desc}</div>}
        </div>

        {/* Row: Type + Timing */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={lblSt}>Inspection Type *</label>
            <select value={iType} onChange={e => setIType(e.target.value)} style={inputSt}>
              <option value="hold_point">Hold point</option>
              <option value="witness">Witness point</option>
              <option value="review">Review point</option>
              <option value="document">Information only</option>
            </select>
          </div>
          <div>
            <label style={lblSt}>Timing *</label>
            <select value={timing} onChange={e => setTiming(e.target.value)} style={inputSt}>
              <option value="pre_delivery">Pre-delivery</option>
              <option value="post_delivery">Post-delivery</option>
            </select>
          </div>
        </div>

        {/* Linked Line */}
        <div style={{ marginBottom: 14 }}>
          <label style={lblSt}>Linked Line Item</label>
          <select value={lineId} onChange={e => setLineId(e.target.value)} style={inputSt}>
            <option value="">— None —</option>
            {poLines.map(l => (
              <option key={l.id} value={String(l.id)}>Line {l.line_number} — {l.description}</option>
            ))}
          </select>
        </div>

        {/* Row: Planned + Forecast */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={lblSt}>Planned Date</label>
            <input type="date" value={plannedDate} onChange={e => setPlanned(e.target.value)} style={inputSt} />
          </div>
          <div>
            <label style={lblSt}>Forecast Date</label>
            <input type="date" value={fcastDate} onChange={e => { setFcast(e.target.value); setErrors(p => ({ ...p, fcastReason: '' })) }} style={inputSt} />
          </div>
        </div>

        {/* Forecast reason (edit only when changing) */}
        {fcastChanged && (
          <div style={{ marginBottom: 14, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 14px' }}>
            <label style={{ ...lblSt, color: '#d97706' }}>Reason for forecast date change *</label>
            <textarea value={fcastReason} onChange={e => { setFcastReason(e.target.value); setErrors(p => ({ ...p, fcastReason: '' })) }}
              rows={2} placeholder="Required — explain why the forecast date changed"
              style={{ ...inputSt, resize: 'vertical' }} />
            {errors.fcastReason && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 3 }}>{errors.fcastReason}</div>}
          </div>
        )}

        {/* Row: Witness + Certificate */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={witness} onChange={e => setWitness(e.target.checked)} />
            <span style={{ fontSize: 12, color: col }}>Witness required</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={cert} onChange={e => setCert(e.target.checked)} />
            <span style={{ fontSize: 12, color: col }}>Certificate required</span>
          </label>
        </div>

        {/* Status */}
        <div style={{ marginBottom: 14 }}>
          <label style={lblSt}>Status *</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={inputSt}>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="complete">Complete</option>
            <option value="on_hold">On hold</option>
            <option value="waived">Waived</option>
          </select>
        </div>

        {/* Completion date (only if Complete) */}
        {status === 'complete' && (
          <div style={{ marginBottom: 14 }}>
            <label style={lblSt}>Completion Date</label>
            <input type="date" value={compDate} onChange={e => setCompDate(e.target.value)} style={inputSt} />
          </div>
        )}

        {/* Completion notes */}
        <div style={{ marginBottom: 14 }}>
          <label style={lblSt}>Completion Notes</label>
          <textarea value={compNotes} onChange={e => setCompNotes(e.target.value)}
            rows={2} placeholder="Optional notes on completion or outcome" style={{ ...inputSt, resize: 'vertical' }} />
        </div>

        {/* General notes */}
        <div style={{ marginBottom: 20 }}>
          <label style={lblSt}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            rows={2} placeholder="Optional general notes" style={{ ...inputSt, resize: 'vertical' }} />
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: saving ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── EXPORTED COMPONENT (wraps with ToastProvider) ───────────────────────────
// ToastProvider must be an ancestor of any component calling useToast().
export const ExpPODetailScreen = (props: Props) => (
  <ToastProvider>
    <ExpPODetailScreenInner {...props} />
  </ToastProvider>
)
