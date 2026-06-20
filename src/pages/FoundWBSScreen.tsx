// ─── FOUNDATIONAL WBS SCREEN ────────────────────────────────
// Tree table of WBS nodes. Expand/collapse, add, edit, delete.
// Tooltip, focus mode with info panel, bulk ops, search/filter.
import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { HelpButton } from '../components/HelpDrawer'
import { WBS_HELP } from '../helpContent'
import { WBSGanttView } from '../components/WBSGanttView'
import { BackButton } from '../components/BackButton'
import { isApprovalRequired, submitForApproval, approvalToast } from '../lib/pendingChanges'
import { useColumnResize } from '../hooks/useColumnResize'

// ─── RESIZABLE COLUMNS (tree table) ──────────────────────────
// Resizable: Code, WBS Node, ROS, Notes, PO Qty (the 4px stripe / checkbox /
// code-suffix / delete columns stay fixed). Widths persist via useColumnResize
// (localStorage key qco_col_widths_wbs_tree); the "↺ Reset columns" button restores these.
const WBS_COL_DEFAULTS = [150, 280, 120, 200, 90]
const WBS_COL_MINS     = [70, 130, 70, 90, 60]

// Column resize handle — 1px divider that turns into a 3px orange bar on hover,
// over an 8px col-resize hit target (matches the Procurement/Admin tables).
const ColResizeHandle = ({ onMouseDown, dark }: { onMouseDown: (e: React.MouseEvent) => void; dark: boolean }) => {
  const [hov, setHov] = useState(false)
  return (
    <>
      <div style={{ position: 'absolute', right: 0, top: 0, width: hov ? 3 : 1, height: '100%', background: hov ? '#E84E0F' : (dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'), pointerEvents: 'none', transition: 'width 100ms, background 100ms', borderRadius: 1 }} />
      <div onMouseDown={onMouseDown} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={e => e.stopPropagation()}
        style={{ position: 'absolute', right: -4, top: 0, width: 8, height: '100%', cursor: 'col-resize', zIndex: 3 }} />
    </>
  )
}

import { API } from '../lib/api'

// ─── TYPES ──────────────────────────────────────────────────
interface WBSNode {
  id: number
  project_id: number
  parent_id: number | null
  code: string
  description: string
  rag: 'green' | 'amber' | 'red' | 'blue' | null
  ros_date: string | null
  notes: string | null
  owner_id: number | null
  owner_name: string | null
  planned_start: string | null
  planned_end: string | null
  forecast_start: string | null
  forecast_end: string | null
  actual_start: string | null
  actual_end: string | null
  po_qty: number
  children?: WBSNode[]
}

// ─── HELPERS ────────────────────────────────────────────────
const RAG_COLORS: Record<string, string> = {
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', blue: '#2563eb',
}
const RAG_LABELS: Record<string, string> = {
  green: 'On track', amber: 'At risk', red: 'Breached', blue: 'In progress',
}
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function buildTree(flat: WBSNode[]): WBSNode[] {
  const map = new Map<number, WBSNode>()
  flat.forEach(n => map.set(n.id, { ...n, children: [] }))
  const roots: WBSNode[] = []
  map.forEach(n => {
    if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id)!.children!.push(n)
    else roots.push(n)
  })
  roots.sort((a, b) => a.code.localeCompare(b.code))
  map.forEach(n => n.children!.sort((a, b) => a.code.localeCompare(b.code)))
  return roots
}

// Recursively collect all IDs visible by filter
function collectVisible(nodes: WBSNode[], filter: (n: WBSNode) => boolean): Set<number> {
  const visible = new Set<number>()
  function walk(list: WBSNode[], parentVisible: boolean) {
    for (const n of list) {
      const match = filter(n)
      const childrenHaveMatch = hasDescendantMatch(n, filter)
      if (match || childrenHaveMatch || parentVisible) {
        visible.add(n.id)
      }
      walk(n.children ?? [], match || parentVisible)
    }
  }
  walk(nodes, false)
  return visible
}

function hasDescendantMatch(n: WBSNode, filter: (n: WBSNode) => boolean): boolean {
  if (!n.children?.length) return false
  return n.children.some(c => filter(c) || hasDescendantMatch(c, filter))
}

// ─── RAG DOT ────────────────────────────────────────────────
const RAGDot = ({ rag }: { rag: string | null }) => (
  <span title={rag ? RAG_LABELS[rag] : 'Not set'}
    style={{ width: 10, height: 10, borderRadius: '50%', background: rag ? RAG_COLORS[rag] : '#c4cedf', display: 'inline-block', flexShrink: 0 }} />
)

// ─── NOTE EDITOR MODAL ──────────────────────────────────────
const NoteModal = ({ node, dark, onClose, onSaved }: { node: WBSNode; dark: boolean; onClose: () => void; onSaved: (n: WBSNode) => void }) => {
  const [notes, setNotes]   = useState(node.notes ?? '')
  const [ros, setRos]       = useState(node.ros_date?.slice(0, 10) ?? '')
  const [rag, setRag]       = useState(node.rag ?? '')
  const [saving, setSaving] = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'

  const MAX_CHARS  = 500
  const rosPast    = ros && new Date(ros) < new Date(new Date().toDateString())
  const canSave    = notes.trim().length > 0 && notes.length <= MAX_CHARS

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const { data } = await axios.patch(`${API}/foundational/${node.project_id}/wbs/${node.id}`, { notes, ros_date: ros || null, rag: rag || null })
      onSaved(data)
      onClose()
    } catch { setSaving(false) }
  }

  const inp: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 6, width: '100%', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4, marginTop: 12 }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 28, width: 480, boxShadow: '0 16px 48px rgba(0,0,0,0.4)', fontFamily: 'IBM Plex Sans, sans-serif', border: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col }}>Edit Node</div>
            <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8', marginTop: 2 }}>{node.code} — {node.description}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>
        <label style={lbl}>ROS Date</label>
        <input type="date" value={ros} onChange={e => setRos(e.target.value)} style={inp} />
        {rosPast && <div style={{ marginTop: 5, fontSize: 11, color: '#f59e0b' }}>⚠ ROS date is in the past</div>}
        <label style={lbl}>RAG Status</label>
        <select value={rag} onChange={e => setRag(e.target.value)} style={{ ...inp, height: 34 }}>
          <option value="">— Not set</option>
          <option value="green">On track</option>
          <option value="amber">At risk</option>
          <option value="red">Breached</option>
          <option value="blue">In progress</option>
        </select>
        <label style={lbl}>Notes / Scope *</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value.slice(0, MAX_CHARS))} rows={4}
          placeholder="Scope description, constraints, assumptions…"
          style={{ ...inp, height: 96, resize: 'vertical', padding: '8px 10px', lineHeight: 1.5 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 11, color: notes.trim() === '' ? '#ef4444' : '#94a3b8' }}>
            {notes.trim() === '' ? '✕ Note cannot be blank' : ''}
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{notes.length} / {MAX_CHARS}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={save} disabled={!canSave || saving}
            style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: (!canSave || saving) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!canSave || saving) ? 0.5 : 1 }}>
            {saving ? 'Saving…' : '✓ Save changes'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── ADD WBS NODE MODAL — with forecast + actual dates ───────
const AddNodeModal = ({ projectId, nodes, dark, onClose, onCreated, onQueued, prefill }: {
  projectId: number; nodes: WBSNode[]; dark: boolean; onClose: () => void; onCreated: (n: WBSNode) => void
  onQueued: (msg: string) => void
  prefill?: Partial<WBSNode>
}) => {
  const [parentId, setParentId]       = useState(prefill?.parent_id ? String(prefill.parent_id) : '')
  const [suffix, setSuffix]           = useState('')
  const [description, setDesc]        = useState(prefill?.description ?? '')
  const [rag, setRag]                 = useState(prefill?.rag ?? '')
  const [rosDate, setRosDate]         = useState(prefill?.ros_date?.slice(0,10) ?? '')
  // Planned/forecast/actual dates are NOT hand-entered — a WBS node's schedule is a
  // ROLL-UP of the POs/milestones beneath its branch (EPC-correct). They're derived and
  // stored by the seed (and stay fresh on edit because the PATCH preserves any field the
  // body omits), so the create/edit modal no longer carries them.
  const [notes, setNotes]             = useState(prefill?.notes ?? '')
  const [saving, setSaving]           = useState(false)
  const [err, setErr]                 = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'

  const flatNodes = [...nodes].sort((a, b) => a.code.localeCompare(b.code))
  const parentNode = flatNodes.find(n => String(n.id) === parentId)
  const fullCode = parentNode ? `${parentNode.code}.${suffix}` : suffix
  const valid = suffix.trim() && description.trim()

  const inp: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 6, width: '100%', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const { data } = await axios.post(`${API}/foundational/${projectId}/wbs`, {
        code: fullCode, description: description.trim(),
        parent_id: parentId ? Number(parentId) : null,
        rag: rag || null, ros_date: rosDate || null,
        notes: notes || null,
      })
      onCreated(data)
      onClose()
    } catch (e: unknown) {
      // Proposer roles can't write WBS directly — the create is intercepted with a
      // requiresApproval 409. Stage it for confirmation; this is success, not error.
      if (isApprovalRequired(e)) {
        try {
          const r = await submitForApproval(projectId, 'wbs', 'create', {
            code: fullCode, description: description.trim(),
            parent_id: parentId ? Number(parentId) : null,
            rag: rag || null, ros_date: rosDate || null,
            notes: notes || null,
          })
          onQueued(`✓ ${approvalToast(r)}`)
          onClose()
        } catch (se: unknown) {
          const ser = se as { response?: { data?: { error?: string } } }
          setErr(ser.response?.data?.error ?? 'Could not submit to approval queue')
          setSaving(false)
        }
        return
      }
      const er = e as { response?: { data?: { error?: string } } }
      setErr(er.response?.data?.error ?? 'Failed to create node')
      setSaving(false)
    }
  }

  const label = (txt: string) => (
    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase' as const, marginBottom: 4, marginTop: 12 }}>{txt}</div>
  )
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 28, width: 580, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.4)', fontFamily: 'IBM Plex Sans, sans-serif', border: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: col }}>Add WBS Node</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div>
            {label('Parent node')}
            <select value={parentId} onChange={e => setParentId(e.target.value)} style={{ ...inp, height: 34 }}>
              <option value="">— Top level (root)</option>
              {flatNodes.map(n => <option key={n.id} value={n.id}>{n.code} — {n.description}</option>)}
            </select>
          </div>
          <div>
            {label('Code suffix *')}
            <input value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="e.g. 01"
              style={{ ...inp, fontFamily: 'JetBrains Mono, monospace' }} />
          </div>
        </div>

        {suffix && (
          <div style={{ background: dark ? '#0f172a' : '#f4f7fb', border: `1px solid ${dark ? '#334155' : '#e8ecf2'}`, borderRadius: 6, padding: '6px 12px', marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
            Full code: <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: '#2563eb' }}>{fullCode}</span>
          </div>
        )}

        {label('Node name / description *')}
        <input value={description} onChange={e => setDesc(e.target.value)} placeholder="e.g. Process Vessels & Columns" style={inp} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div>
            {label('RAG status')}
            <select value={rag} onChange={e => setRag(e.target.value)} style={{ ...inp, height: 34 }}>
              <option value="">Not set</option>
              <option value="green">On track</option>
              <option value="amber">At risk</option>
              <option value="red">Breached</option>
              <option value="blue">In progress</option>
            </select>
          </div>
          <div>
            {label('ROS Date')}
            <input type="date" value={rosDate} onChange={e => setRosDate(e.target.value)} style={inp} />
          </div>
        </div>

        {/* Planned / Forecast / Actual dates are derived by WBS roll-up, not hand-entered. */}

        {label('Notes / scope description')}
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="Scope, constraints, assumptions…"
          style={{ ...inp, height: 72, resize: 'vertical' as const, padding: '8px 10px', lineHeight: '1.5' }} />

        {err && <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '6px 10px' }}>{err}</div>}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: valid ? '#22c55e' : '#94a3b8' }}>
            {valid ? `✓ Ready to save · ${fullCode}` : 'Required: code suffix and name'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={save} disabled={!valid || saving}
              style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: (!valid || saving) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!valid || saving) ? 0.5 : 1 }}>
              {saving ? 'Adding…' : '✓ Add node'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── DELETE WBS WIZARD ───────────────────────────────────────
const DeleteWBSWizard = ({ node, projectId, dark, onClose, onDeleted }: {
  node: WBSNode; projectId: number; dark: boolean; onClose: () => void; onDeleted: () => void
}) => {
  const [step, setStep] = useState(1)
  const [impact, setImpact] = useState<{
    childCount: number
    affectedPOs: { id: number; po_number: string; wbs_code: string; status: string; is_locked: number }[]
    affectedLines: { id: number; line_number: number; description: string; qty: number; uom: string; wbs_code_snapshot: string; po_number: string; po_id: number }[]
    codesCovered: string
  } | null>(null)
  const [allocations, setAllocations] = useState<Record<number, { nodeId: string; code: string }>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'

  useEffect(() => {
    axios.get(`${API}/foundational/${projectId}/wbs/impact/${node.id}`)
      .then(r => setImpact(r.data))
      .catch(() => setErr('Failed to load impact data'))
  }, [node.id, projectId])

  const allReallocated = !impact?.affectedLines?.length ||
    impact.affectedLines.every(l => allocations[l.id]?.nodeId)

  const doDelete = async () => {
    setDeleting(true); setErr('')
    try {
      if (impact?.affectedLines?.length) {
        const reallocations = Object.entries(allocations).map(([lineId, val]) => ({
          lineId: Number(lineId), newWbsNodeId: Number(val.nodeId), newWbsCode: val.code,
        }))
        await axios.patch(`${API}/foundational/${projectId}/wbs/${node.id}/reallocate`, { reallocations })
      }
      await axios.delete(`${API}/foundational/${projectId}/wbs/${node.id}`)
      onDeleted()
      onClose()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      setErr(er.response?.data?.error ?? 'Delete failed')
      setDeleting(false)
    }
  }

  const safeToDelete = impact && impact.childCount === 0 && impact.affectedLines.length === 0

  // ─── BLOCK REASON ────────────────────────────────────────────
  // Mirrors the proven backend DELETE guard order (children → locked PO → orphan
  // lines). A node with children, or with any affected line on a LOCKED PO, cannot
  // be deleted here at all (reallocation can't fix either) — so we block at step 1
  // rather than let the user do work and hit a 409. Affected lines (not blocked)
  // route to the Reallocate step. The backend remains the source of truth.
  const lockedPOs = impact?.affectedPOs?.filter(p => p.is_locked) ?? []
  const blockReason: 'children' | 'locked' | null = !impact
    ? null
    : impact.childCount > 0 ? 'children'
    : lockedPOs.length > 0 ? 'locked'
    : null

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 28, width: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', fontFamily: 'IBM Plex Sans, sans-serif', border: '2px solid rgba(239,68,68,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444' }}>Delete WBS Node</div>
            <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8', marginTop: 2 }}>{node.code} — {node.description}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>

        {step === 1 && (
          <>
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ef4444', marginBottom: 12 }}>⚠ Impact Assessment</div>
              {!impact ? (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading impact data…</div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 12 }}>
                    {[['Child nodes', impact.childCount], ['Affected POs', impact.affectedPOs.length], ['Line items', impact.affectedLines.length], ['Code prefix', impact.codesCovered]].map(([l, v]) => (
                      <div key={String(l)} style={{ background: dark ? '#0f172a' : '#fff5f5', borderRadius: 6, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444', fontFamily: 'JetBrains Mono, monospace' }}>{v}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>{l}</div>
                      </div>
                    ))}
                  </div>

                  {/* Affected POs with per-PO lock status (is_locked from impact) */}
                  {impact.affectedPOs.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Affected POs</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {impact.affectedPOs.map(po => (
                          <span key={po.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: col, background: dark ? '#0f172a' : '#fff', border: `1px solid ${po.is_locked ? '#ef4444' : (dark ? '#334155' : '#dde3ed')}`, borderRadius: 6, padding: '3px 8px' }}>
                            {po.po_number}
                            {po.is_locked
                              ? <span style={{ fontSize: 9, fontWeight: 700, color: '#ef4444' }}>🔒 LOCKED</span>
                              : <span style={{ fontSize: 9, color: '#94a3b8' }}>{po.status}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {blockReason === 'children' && (
                    <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 10px' }}>
                      ⛔ Cannot delete a parent node — delete or move its {impact.childCount} child node{impact.childCount !== 1 ? 's' : ''} first.
                    </div>
                  )}
                  {blockReason === 'locked' && (
                    <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '8px 10px' }}>
                      🔒 Cannot delete — affected PO{lockedPOs.length !== 1 ? 's' : ''} {lockedPOs.map(p => p.po_number).join(', ')} {lockedPOs.length !== 1 ? 'are' : 'is'} locked. Unlock or reallocate via an authorised process first.
                    </div>
                  )}
                  {!blockReason && safeToDelete && <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✓ Safe to delete — no child nodes or POs reference this node.</div>}
                  {!blockReason && !safeToDelete && impact.affectedLines.length > 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>{impact.affectedLines.length} PO line item{impact.affectedLines.length !== 1 ? 's' : ''} must be re-allocated to another WBS node before this node can be deleted.</div>}
                </>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={() => impact?.affectedLines?.length ? setStep(2) : setStep(3)} disabled={!impact || !!blockReason}
                title={blockReason ? 'Resolve the blocker above before continuing' : undefined}
                style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: (impact && !blockReason) ? '#ef4444' : '#94a3b8', color: '#fff', fontSize: 12, fontWeight: 600, cursor: (impact && !blockReason) ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                Continue →
              </button>
            </div>
          </>
        )}

        {step === 2 && impact && (
          <>
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 12, color: '#ef4444' }}>
              ⚠ Before deleting, re-assign all {impact.affectedLines.length} affected PO line item{impact.affectedLines.length !== 1 ? 's' : ''} to a different WBS node.
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              {impact.affectedLines.filter(l => allocations[l.id]?.nodeId).length} of {impact.affectedLines.length} lines re-allocated
            </div>
            {impact.affectedLines.map(line => (
              <ReallocateLineRow
                key={line.id}
                line={line}
                projectId={projectId}
                dark={dark}
                excludeCode={node.code}
                value={allocations[line.id]}
                onChange={(nodeId, code) => setAllocations(prev => ({ ...prev, [line.id]: { nodeId, code } }))}
              />
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setStep(1)} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
              <button onClick={() => setStep(3)} disabled={!allReallocated}
                style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: allReallocated ? '#ef4444' : '#94a3b8', color: '#fff', fontSize: 12, fontWeight: 600, cursor: allReallocated ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                Continue →
              </button>
            </div>
          </>
        )}

        {step === 3 && impact && (
          <>
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ef4444', marginBottom: 8 }}>🗑 Confirm permanent deletion</div>
              <div style={{ fontSize: 12, color: col }}>Delete WBS node <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{node.code}</strong> — {node.description}?</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>This permanently deletes only this node and cannot be undone. (A node with child nodes can't be deleted — its children must be removed or moved first.)</div>
              {impact.affectedLines.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Re-allocation summary:</div>
                  {impact.affectedLines.map(l => (
                    <div key={l.id} style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8', marginBottom: 2 }}>
                      {l.po_number} Line {l.line_number}: {l.wbs_code_snapshot} → {allocations[l.id]?.code ?? '—'}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
              <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ accentColor: '#ef4444' }} />
              <span style={{ fontSize: 12, color: col }}>I understand this deletion is permanent and cannot be undone.</span>
            </label>
            {err && <div style={{ marginBottom: 12, fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '6px 10px' }}>{err}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              {impact.affectedLines.length > 0 && (
                <button onClick={() => setStep(2)} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
              )}
              <button onClick={doDelete} disabled={!confirmed || deleting}
                style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: (confirmed && !deleting) ? '#ef4444' : '#94a3b8', color: '#fff', fontSize: 12, fontWeight: 600, cursor: (confirmed && !deleting) ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                {deleting ? 'Deleting…' : '🗑 Delete permanently'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── REALLOCATE LINE ROW ──────────────────────────────────────
const ReallocateLineRow = ({ line, projectId, dark, excludeCode, value, onChange }: {
  line: { id: number; line_number: number; description: string; qty: number; uom: string; po_number: string; wbs_code_snapshot: string }
  projectId: number; dark: boolean; excludeCode: string
  value: { nodeId: string; code: string } | undefined
  onChange: (nodeId: string, code: string) => void
}) => {
  const [nodes, setNodes] = useState<{ id: number; code: string; description: string }[]>([])
  const col = dark ? '#f1f5f9' : '#0f172a'
  useEffect(() => {
    axios.get(`${API}/foundational/${projectId}/wbs`).then(r => {
      setNodes(r.data.filter((n: WBSNode) => !n.code.startsWith(excludeCode)))
    }).catch(() => {})
  }, [projectId, excludeCode])
  return (
    <div style={{ background: dark ? '#0f172a' : '#fff5f5', borderRadius: 8, padding: '10px 14px', marginBottom: 8, border: '1px solid rgba(239,68,68,0.12)' }}>
      <div style={{ fontSize: 12, color: col, marginBottom: 6 }}>{line.po_number} · Line {line.line_number} · {line.description}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#ef4444', fontFamily: 'JetBrains Mono, monospace', textDecoration: 'line-through' }}>{line.wbs_code_snapshot}</span>
        <span style={{ color: '#94a3b8' }}>→</span>
        <select value={value?.nodeId ?? ''} onChange={e => { const n = nodes.find(x => String(x.id) === e.target.value); if (n) onChange(e.target.value, n.code); else onChange('', '') }}
          style={{ flex: 1, height: 30, padding: '0 8px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', outline: 'none' }}>
          <option value="">— Select new WBS</option>
          {nodes.map(n => <option key={n.id} value={n.id}>{n.code} — {n.description}</option>)}
        </select>
      </div>
    </div>
  )
}

// ─── WBS ROW (recursive) ─────────────────────────────────────
// Checkbox visibility controlled by CSS hover on parent tr.
const WBSRow = ({ node, depth, dark, expanded, onToggle, onEdit, onDelete, onRowEnter, onRowLeave, focusMode, onFocusClick, selected, onSelect, searchMatch, filterVisible, onOpenReadiness }: {
  node: WBSNode; depth: number; dark: boolean
  expanded: Set<number>; onToggle: (id: number) => void
  onEdit: (n: WBSNode) => void; onDelete: (n: WBSNode) => void
  onRowEnter?: (n: WBSNode, e: React.MouseEvent) => void
  onRowLeave?: () => void
  focusMode: boolean
  onFocusClick?: (n: WBSNode) => void
  selected: boolean
  onSelect: (id: number, checked: boolean) => void
  searchMatch: boolean
  filterVisible: boolean
  onOpenReadiness?: (n: WBSNode) => void
}) => {
  const [hovered, setHovered] = useState(false)
  const hasChildren = node.children && node.children.length > 0
  const isExpanded = expanded.has(node.id)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const ragColour = node.rag ? RAG_COLORS[node.rag] : '#c4cedf'
  const rosColour = node.ros_date ? (node.rag === 'red' ? '#ef4444' : node.rag === 'amber' ? '#f59e0b' : node.rag === 'blue' ? '#2563eb' : '#22c55e') : '#94a3b8'

  if (!filterVisible) return null

  const rowBg = selected
    ? (dark ? '#1e3a5f' : '#dbeafe')
    : hovered
    ? (dark ? '#1e2d4a' : '#f4f7fb')
    : (dark ? '#1e293b' : '#fff')

  const highlightBg = searchMatch && !selected
    ? (dark ? '#1e3a5f40' : '#eff6ff')
    : rowBg

  return (
    <>
      <tr
        onMouseEnter={e => { setHovered(true); if (!focusMode) onRowEnter?.(node, e) }}
        onMouseLeave={() => { setHovered(false); if (!focusMode) onRowLeave?.() }}
        style={{ background: highlightBg, transition: 'background 120ms', cursor: focusMode ? 'pointer' : (hasChildren ? 'pointer' : 'default'), opacity: filterVisible ? 1 : 0.3 }}
        onClick={() => focusMode ? onFocusClick?.(node) : (hasChildren && onToggle(node.id))}>

        {/* RAG stripe */}
        <td style={{ width: 4, padding: 0 }}>
          <div style={{ width: 4, height: '100%', minHeight: 38, background: ragColour, borderRadius: '2px 0 0 2px' }} />
        </td>

        {/* Checkbox — visible on hover */}
        <td style={{ width: 28, padding: '0 4px', textAlign: 'center' }}>
          <input type="checkbox" checked={selected}
            onChange={e => { e.stopPropagation(); onSelect(node.id, e.target.checked) }}
            onClick={e => e.stopPropagation()}
            style={{ opacity: (hovered || selected) ? 1 : 0, transition: 'opacity 120ms', cursor: 'pointer', accentColor: '#2563eb' }} />
        </td>

        {/* TREE CELL: chevron + RAG dot + code */}
        <td style={{ paddingLeft: 8 + depth * 20, paddingRight: 8, paddingTop: 9, paddingBottom: 9, whiteSpace: 'nowrap', userSelect: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 14, textAlign: 'center', fontSize: 11, color: hasChildren ? '#64748b' : '#c4cedf', flexShrink: 0, lineHeight: 1 }}>
              {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
            </span>
            <RAGDot rag={node.rag} />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: depth === 0 ? 600 : 400, color: searchMatch ? '#60a5fa' : col }}>
              {node.code}
            </span>
          </div>
        </td>

        {/* WBS NODE description */}
        <td style={{ padding: '9px 12px 9px 4px', fontSize: 13, fontWeight: depth === 0 ? 600 : 400, color: col, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.description}
        </td>

        {/* ROS — click opens readiness modal */}
        <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: rosColour, whiteSpace: 'nowrap', cursor: onOpenReadiness ? 'pointer' : undefined }}
          onClick={onOpenReadiness ? e => { e.stopPropagation(); onOpenReadiness(node) } : undefined}
          title={onOpenReadiness ? 'View readiness' : undefined}>
          {fmtDate(node.ros_date)}
        </td>

        {/* NOTES */}
        {!focusMode && (
          <td style={{ padding: '9px 12px', maxWidth: 180 }}>
            <button onClick={e => { e.stopPropagation(); onOpenReadiness ? onOpenReadiness(node) : onEdit(node) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: node.notes ? '#2563eb' : '#94a3b8', fontSize: 12, fontFamily: 'inherit', textAlign: 'left', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', padding: 0 }}
              title={node.notes ?? 'Click to view readiness'}>
              {node.notes ? `${node.notes.slice(0, 40)}${node.notes.length > 40 ? '…' : ''}` : '+ Add note'}
            </button>
          </td>
        )}

        {/* PO Qty — materials status */}
        {!focusMode && (
          <td style={{ padding: '9px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: node.po_qty > 0 ? '#22c55e' : '#475569', textAlign: 'right', whiteSpace: 'nowrap' }}>
            {node.po_qty > 0 ? node.po_qty.toLocaleString() : '—'}
          </td>
        )}

        {/* Code suffix */}
        {!focusMode && (
          <td style={{ padding: '9px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
            {node.code}.xx
          </td>
        )}

        {/* Delete */}
        <td style={{ padding: '9px 8px', textAlign: 'center', width: 36 }}>
          <button onClick={e => { e.stopPropagation(); onDelete(node) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: hovered ? '#ef4444' : 'transparent', fontSize: 14, transition: 'color 150ms', padding: '2px 4px', lineHeight: 1 }}
            title="Delete node">🗑</button>
        </td>
      </tr>

      {/* Children when expanded */}
      {isExpanded && node.children?.map(child => (
        <WBSRow key={child.id} node={child} depth={depth + 1} dark={dark}
          expanded={expanded} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete}
          onRowEnter={onRowEnter} onRowLeave={onRowLeave}
          focusMode={focusMode} onFocusClick={onFocusClick}
          selected={selected} onSelect={onSelect}
          searchMatch={false} filterVisible={filterVisible}
          onOpenReadiness={onOpenReadiness} />
      ))}
    </>
  )
}

// ─── UPLOAD VALIDATION MODAL ─────────────────────────────────
interface ValidationRow { row: number; code: string; description: string; parent: string; ros: string; status: 'ok'|'warning'|'error'; errors: string[]; warnings: string[] }
interface ValidationResult { results: ValidationRow[]; summary: { total: number; ready: number; warnings: number; errors: number } }

const UploadModal = ({ projectId, dark, onClose, onImported }: { projectId: number; dark: boolean; onClose: () => void; onImported: () => void }) => {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ValidationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [ackWarn, setAckWarn] = useState(false)
  const [importing, setImporting] = useState(false)
  const [err, setErr] = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'

  const validate = async (f: File) => {
    setLoading(true); setErr(''); setResult(null)
    const fd = new FormData(); fd.append('file', f)
    try {
      const { data } = await axios.post<ValidationResult>(`${API}/foundational/${projectId}/wbs/validate`, fd)
      setResult(data)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      setErr(er.response?.data?.error ?? 'Validation failed')
    } finally { setLoading(false) }
  }

  const doImport = async () => {
    if (!file) return
    setImporting(true)
    const fd = new FormData(); fd.append('file', file)
    try {
      const { data } = await axios.post(`${API}/foundational/${projectId}/wbs/import`, fd)
      onImported()
      onClose()
      alert(`✓ Imported ${data.imported} nodes successfully`)
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      setErr(er.response?.data?.error ?? 'Import failed')
    } finally { setImporting(false) }
  }

  const canImport = result && result.summary.errors === 0 && (result.summary.warnings === 0 || ackWarn)
  const STATUS_ICON: Record<string, string> = { ok: '✅', warning: '⚠️', error: '❌' }
  const STATUS_COLOR: Record<string, string> = { ok: '#22c55e', warning: '#f59e0b', error: '#ef4444' }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 24, width: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.4)', fontFamily: 'IBM Plex Sans, sans-serif', border: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: col }}>↑ Upload WBS File</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>
        <input type="file" accept=".xlsx,.xls,.csv,.xer,.xml" onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); setResult(null); if (f) validate(f) }}
          style={{ border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, color: col, background: dark ? '#0f172a' : '#f8fafc', fontFamily: 'inherit', marginBottom: 16 }} />
        {loading && <div style={{ textAlign: 'center', color: '#94a3b8', padding: '24px 0' }}>Validating file…</div>}
        {err && <div style={{ marginBottom: 12, fontSize: 12, color: '#ef4444' }}>{err}</div>}
        {result && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, padding: '10px 14px', background: dark ? '#0f172a' : '#f4f7fb', borderRadius: 8, fontSize: 12 }}>
              <span style={{ color: '#64748b' }}>{result.summary.total} rows</span>
              <span style={{ color: '#22c55e' }}>✅ {result.summary.ready} ready</span>
              {result.summary.warnings > 0 && <span style={{ color: '#f59e0b' }}>⚠️ {result.summary.warnings} warnings</span>}
              {result.summary.errors > 0 && <span style={{ color: '#ef4444' }}>❌ {result.summary.errors} errors</span>}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', border: `1px solid ${dark ? '#334155' : '#e8ecf2'}`, borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: dark ? '#0f172a' : '#f8fafc', position: 'sticky', top: 0 }}>
                    {['Row','','Code','Description','Parent','ROS','Issues'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600, color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: 10, borderBottom: `1px solid ${dark ? '#334155' : '#e8ecf2'}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.results.map(r => (
                    <tr key={r.row} style={{ background: dark ? '#1e293b' : '#fff', borderBottom: `1px solid ${dark ? '#334155' : '#f0f3f9'}` }}>
                      <td style={{ padding: '5px 10px', color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>{r.row}</td>
                      <td style={{ padding: '5px 6px', textAlign: 'center', fontSize: 14 }}>{STATUS_ICON[r.status]}</td>
                      <td style={{ padding: '5px 10px', fontFamily: 'JetBrains Mono, monospace', color: col }}>{r.code}</td>
                      <td style={{ padding: '5px 10px', color: col, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                      <td style={{ padding: '5px 10px', fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8' }}>{r.parent || '—'}</td>
                      <td style={{ padding: '5px 10px', fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8' }}>{r.ros || '—'}</td>
                      <td style={{ padding: '5px 10px', color: STATUS_COLOR[r.status] }}>{[...r.errors, ...r.warnings].join('; ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.summary.warnings > 0 && result.summary.errors === 0 && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, cursor: 'pointer', fontSize: 12, color: '#f59e0b' }}>
                <input type="checkbox" checked={ackWarn} onChange={e => setAckWarn(e.target.checked)} style={{ accentColor: '#f59e0b' }} />
                I acknowledge the {result.summary.warnings} warning{result.summary.warnings !== 1 ? 's' : ''} and wish to import anyway
              </label>
            )}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={doImport} disabled={!canImport || importing}
            style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: canImport ? '#2563eb' : '#94a3b8', color: '#fff', fontSize: 12, fontWeight: 600, cursor: canImport ? 'pointer' : 'not-allowed', fontFamily: 'inherit', opacity: importing ? 0.7 : 1 }}>
            {importing ? 'Importing…' : `↑ Import ${result?.summary.ready ?? 0} rows`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── WBS TOOLTIP (fixed positioning, rich content) ───────────
interface TooltipData { wbsCode: string; commodities: {code: string; name: string; uom: string}[]; equipment: {tag: string; description: string; status?: string}[] }
// Tooltip uses cursor position (not row rect) — row spans full width so
// anchorRect.right ≈ viewport width and the flip would place tooltip off-screen.
const WBSTooltip = ({ node, projectId, cursorX, cursorY }: { node: WBSNode; projectId: number; cursorX: number; cursorY: number }) => {
  const [data, setData] = useState<TooltipData | null>(null)
  useEffect(() => {
    axios.get<TooltipData>(`${API}/foundational/${projectId}/wbs/${node.id}/materials`)
      .then(r => setData(r.data)).catch(() => {})
  }, [node.id, projectId])

  const TOOLTIP_W = 380, TOOLTIP_H = 400
  const vw = window.innerWidth, vh = window.innerHeight
  const left = cursorX + 16 + TOOLTIP_W > vw ? Math.max(8, cursorX - TOOLTIP_W - 8) : cursorX + 16
  const top  = cursorY + TOOLTIP_H > vh ? Math.max(8, vh - TOOLTIP_H - 8) : cursorY

  const STATUS_PILL: Record<string, {bg:string;col:string}> = {
    'PO raised':   { bg: 'rgba(34,197,94,0.15)',  col: '#15803d' },
    'RFQ':         { bg: 'rgba(37,99,235,0.15)',  col: '#1d4ed8' },
    'Not started': { bg: 'rgba(148,163,184,0.15)', col: '#64748b' },
    'On site':     { bg: 'rgba(34,197,94,0.15)',  col: '#15803d' },
    'In transit':  { bg: 'rgba(245,158,11,0.15)', col: '#b45309' },
  }

  return createPortal(
    <div style={{
      position: 'fixed', left, top, width: TOOLTIP_W, zIndex: 9998, maxHeight: TOOLTIP_H,
      background: '#111827', border: '1px solid #374151', borderRadius: 10,
      padding: '14px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)',
      fontFamily: 'IBM Plex Sans, sans-serif', pointerEvents: 'none', overflow: 'hidden',
    }}>
      {/* Node identity */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: '#60a5fa', flexShrink: 0 }}>{node.code}</span>
        <span style={{ fontSize: 13, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.description}</span>
        {node.rag && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: `${RAG_COLORS[node.rag]}20`, color: RAG_COLORS[node.rag], flexShrink: 0 }}>{RAG_LABELS[node.rag]}</span>}
      </div>
      {node.ros_date && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10, borderBottom: '1px solid #1f2937', paddingBottom: 8 }}>
          ROS {fmtDate(node.ros_date)}
        </div>
      )}

      {!data ? (
        <div style={{ fontSize: 11, color: '#64748b' }}>Loading…</div>
      ) : (data.commodities.length === 0 && data.equipment.length === 0) ? (
        <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', textAlign: 'center', padding: '16px 0' }}>No materials linked to this node</div>
      ) : (
        <>
          {/* Commodities section */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Commodities ({data.commodities.length})
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
              {data.commodities.map(c => (
                <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#93c5fd', flexShrink: 0 }}>{c.code}</span>
                  <span style={{ fontSize: 11, color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span style={{ fontSize: 10, color: '#64748b', background: '#1f2937', borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>{c.uom}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Divider */}
          <div style={{ borderTop: '1px solid #1f2937', margin: '8px 0' }} />
          {/* Equipment section */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Equipment ({data.equipment.length})
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
              {data.equipment.map(e => (
                <div key={e.tag} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#86efac', flexShrink: 0 }}>{e.tag}</span>
                  <span style={{ fontSize: 11, color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description}</span>
                  {e.status && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                      background: STATUS_PILL[e.status]?.bg ?? 'rgba(148,163,184,0.15)',
                      color: STATUS_PILL[e.status]?.col ?? '#64748b' }}>
                      {e.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>,
    document.body
  )
}

// ─── FOCUS MODE PANEL ────────────────────────────────────────
// Right-side panel shown when focusMode is active and a row is clicked.
const FocusPanel = ({ node, projectId, dark, onClose, onEditNode }: {
  node: WBSNode; projectId: number; dark: boolean; onClose: () => void
  onEditNode: (n: WBSNode) => void
}) => {
  const [materials, setMaterials] = useState<TooltipData | null>(null)
  const [pos, setPos] = useState<{id:number; po_number:string; vendor:string; status:string; total_value:number; currency:string}[]>([])
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd = `1px solid ${dark ? '#334155' : '#e8ecf2'}`
  const subLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: 14 }

  const STATUS_PILL: Record<string, {bg:string;col:string}> = {
    'PO raised':   { bg: 'rgba(34,197,94,0.12)',  col: '#15803d' },
    'RFQ':         { bg: 'rgba(37,99,235,0.12)',  col: '#1d4ed8' },
    'Not started': { bg: 'rgba(148,163,184,0.12)', col: '#64748b' },
    'On site':     { bg: 'rgba(34,197,94,0.12)',  col: '#15803d' },
    'In transit':  { bg: 'rgba(245,158,11,0.12)', col: '#b45309' },
  }

  useEffect(() => {
    axios.get<TooltipData>(`${API}/foundational/${projectId}/wbs/${node.id}/materials`).then(r => setMaterials(r.data)).catch(() => {})
    axios.get(`${API}/foundational/${projectId}/wbs/${node.id}/pos`).then(r => setPos(r.data)).catch(() => {})
  }, [node.id, projectId])

  const ragColor = node.rag ? RAG_COLORS[node.rag] : '#94a3b8'

  return (
    <div style={{
      width: 420, flexShrink: 0,
      background: dark ? '#1e293b' : '#fff',
      borderLeft: bd,
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
      fontFamily: 'IBM Plex Sans, sans-serif',
      transition: 'width 200ms ease',
    }}>
      {/* HEADER */}
      <div style={{ padding: '16px 20px', borderBottom: bd, background: dark ? '#0f172a' : '#f8fafc', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 18, fontWeight: 700, color: '#60a5fa', marginBottom: 4 }}>{node.code}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: col, lineHeight: 1.3 }}>{node.description}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
            {node.rag && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 9999, background: `${ragColor}20`, color: ragColor }}>
                {RAG_LABELS[node.rag]}
              </span>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>✕</button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

        {/* KEY DATES */}
        <div style={subLabel as React.CSSProperties}>Key Dates</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            ['Planned Start', node.planned_start],
            ['Planned End', node.planned_end],
            ['Forecast Start', node.forecast_start],
            ['Forecast End', node.forecast_end],
            ['Actual Start', node.actual_start],
            ['Actual End', node.actual_end],
            ['ROS', node.ros_date],
          ].map(([lbl, val]) => (
            <div key={lbl as string} style={{ background: dark ? '#0f172a' : '#f4f7fb', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 2 }}>{lbl as string}</div>
              <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: val ? col : '#475569' }}>{fmtDate(val as string | null)}</div>
            </div>
          ))}
        </div>

        {/* NOTES */}
        {node.notes && (
          <>
            <div style={subLabel as React.CSSProperties}>Notes</div>
            <div style={{ fontSize: 12, color: col, lineHeight: 1.6, background: dark ? '#0f172a' : '#f8fafc', borderRadius: 6, padding: '10px 12px', border: bd }}>
              {node.notes}
            </div>
          </>
        )}

        {/* COMMODITIES */}
        <div style={subLabel as React.CSSProperties}>Commodities ({materials?.commodities.length ?? '…'})</div>
        {!materials ? (
          <div style={{ fontSize: 12, color: '#64748b' }}>Loading…</div>
        ) : materials.commodities.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>No commodities linked</div>
        ) : (
          <div style={{ border: bd, borderRadius: 6, overflow: 'hidden', maxHeight: 160, overflowY: 'auto' }}>
            {materials.commodities.map(c => (
              <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: bd, fontSize: 12 }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb', fontSize: 11, flexShrink: 0 }}>{c.code}</span>
                <span style={{ flex: 1, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <span style={{ fontSize: 10, color: '#64748b', background: dark ? '#334155' : '#f1f5f9', borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>{c.uom}</span>
              </div>
            ))}
          </div>
        )}

        {/* EQUIPMENT */}
        <div style={subLabel as React.CSSProperties}>Equipment ({materials?.equipment.length ?? '…'})</div>
        {!materials ? null : materials.equipment.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>No equipment linked</div>
        ) : (
          <div style={{ border: bd, borderRadius: 6, overflow: 'hidden', maxHeight: 160, overflowY: 'auto' }}>
            {materials.equipment.map(e => (
              <div key={e.tag} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: bd, fontSize: 12 }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#22c55e', fontSize: 11, flexShrink: 0 }}>{e.tag}</span>
                <span style={{ flex: 1, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description}</span>
                {e.status && (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                    background: STATUS_PILL[e.status]?.bg ?? 'rgba(148,163,184,0.12)',
                    color: STATUS_PILL[e.status]?.col ?? '#64748b' }}>
                    {e.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* PURCHASE ORDERS */}
        <div style={subLabel as React.CSSProperties}>Purchase Orders ({pos.length})</div>
        {pos.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>No POs reference this WBS code</div>
        ) : (
          <div style={{ border: bd, borderRadius: 6, overflow: 'hidden' }}>
            {pos.map(po => (
              <div key={po.id} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: bd, fontSize: 12, alignItems: 'center' }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb', fontSize: 11, flexShrink: 0 }}>{po.po_number}</span>
                <span style={{ flex: 1, color: col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{po.vendor}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                  background: STATUS_PILL[po.status]?.bg ?? 'rgba(148,163,184,0.12)',
                  color: STATUS_PILL[po.status]?.col ?? '#64748b' }}>
                  {po.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div style={{ padding: '12px 20px', borderTop: bd, flexShrink: 0, display: 'flex', gap: 8 }}>
        <button onClick={() => onEditNode(node)}
          style={{ flex: 1, padding: '7px 12px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          ✎ Edit node
        </button>
      </div>
    </div>
  )
}

// ─── BULK DELETE CONFIRM MODAL ───────────────────────────────
// Shown when ALL selected nodes are safe to delete (no deps).
interface BulkImpactNode { id: number; code: string; description: string; rag: string | null; childCount: number; poCount: number; commCount: number; equipCount: number }

const BulkDeleteConfirmModal = ({ nodes, projectId, dark, onClose, onDeleted }: {
  nodes: BulkImpactNode[]; projectId: number; dark: boolean; onClose: () => void
  onDeleted: (deleted: number[]) => void
}) => {
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const canDelete = reason.trim().length > 0 && confirmed && !deleting

  const doDelete = async () => {
    setDeleting(true); setErr('')
    try {
      const { data } = await axios.post(`${API}/foundational/${projectId}/wbs/bulk-delete`, {
        nodeIds: nodes.map(n => n.id), reason
      })
      onDeleted(data.deleted)
      onClose()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      setErr(er.response?.data?.error ?? 'Delete failed')
      setDeleting(false)
    }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 24, width: 560, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', fontFamily: 'IBM Plex Sans, sans-serif', border: '1.5px solid rgba(239,68,68,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ef4444' }}>Delete {nodes.length} WBS node{nodes.length !== 1 ? 's' : ''}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ border: bd, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: dark ? '#0f172a' : '#f4f7fb' }}>
                <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Code</th>
                <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Name</th>
                <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>RAG</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map(n => (
                <tr key={n.id} style={{ borderTop: bd }}>
                  <td style={{ padding: '7px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb' }}>{n.code}</td>
                  <td style={{ padding: '7px 12px', color: col }}>{n.description}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}><RAGDot rag={n.rag} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>Reason for deletion *</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder="State the reason for deleting these nodes…"
          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginBottom: 12 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16, fontSize: 12, color: col }}>
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ accentColor: '#ef4444' }} />
          I confirm permanent deletion of these {nodes.length} node{nodes.length !== 1 ? 's' : ''}
        </label>
        {err && <div style={{ marginBottom: 12, fontSize: 12, color: '#ef4444' }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={doDelete} disabled={!canDelete}
            style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: canDelete ? '#ef4444' : '#94a3b8', color: '#fff', fontSize: 12, fontWeight: 600, cursor: canDelete ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            {deleting ? 'Deleting…' : `🗑 Delete ${nodes.length} node${nodes.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── BULK DELETE SAFE-CONFIRM MODAL ──────────────────────────
// Second confirmation modal for "Delete safe nodes only" action.
const BulkDeleteSafeConfirmModal = ({ safeNodes, totalSelected, blockedCount, dark, onClose, onConfirm }: {
  safeNodes: BulkImpactNode[]; totalSelected: number; blockedCount: number
  dark: boolean; onClose: () => void; onConfirm: (reason: string) => void
}) => {
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const canConfirm = reason.trim().length > 0 && confirmed

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 24, width: 500, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', fontFamily: 'IBM Plex Sans, sans-serif', border: '1.5px solid rgba(245,158,11,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f59e0b' }}>Confirm partial deletion</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: dark ? '#fcd34d' : '#92400e' }}>
          ⚠ {totalSelected} selected — {blockedCount} blocked, {safeNodes.length} safe to delete
        </div>
        <div style={{ border: bd, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: dark ? '#0f172a' : '#f4f7fb' }}>
                <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Code</th>
                <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Name</th>
              </tr>
            </thead>
            <tbody>
              {safeNodes.map(n => (
                <tr key={n.id} style={{ borderTop: bd }}>
                  <td style={{ padding: '7px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#22c55e' }}>{n.code}</td>
                  <td style={{ padding: '7px 12px', color: col }}>{n.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>Reason *</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder="State the reason…"
          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginBottom: 12 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16, fontSize: 12, color: col }}>
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ accentColor: '#ef4444' }} />
          I confirm permanent deletion of {safeNodes.length} safe node{safeNodes.length !== 1 ? 's' : ''}
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={() => canConfirm && onConfirm(reason)} disabled={!canConfirm}
            style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: canConfirm ? '#ef4444' : '#94a3b8', color: '#fff', fontSize: 12, fontWeight: 600, cursor: canConfirm ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            🗑 Delete {safeNodes.length} node{safeNodes.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── BULK DELETE BLOCKED MODAL ───────────────────────────────
// Shown when ANY selected node has dependencies.
const BulkDeleteBlockedModal = ({ allNodes, blockedNodes, safeNodes, dark, projectId, onClose, onDeletedSafe }: {
  allNodes: BulkImpactNode[]; blockedNodes: BulkImpactNode[]; safeNodes: BulkImpactNode[]
  dark: boolean; projectId: number; onClose: () => void; onDeletedSafe: (deleted: number[]) => void
}) => {
  const [showSafeConfirm, setShowSafeConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`

  const blockerReason = (n: BulkImpactNode) => {
    const parts = []
    if (n.childCount > 0) parts.push(`${n.childCount} child node${n.childCount !== 1 ? 's' : ''}`)
    if (n.poCount > 0) parts.push(`${n.poCount} PO ref${n.poCount !== 1 ? 's' : ''}`)
    if (n.commCount > 0) parts.push(`${n.commCount} commodity link${n.commCount !== 1 ? 's' : ''}`)
    if (n.equipCount > 0) parts.push(`${n.equipCount} equipment link${n.equipCount !== 1 ? 's' : ''}`)
    return parts.join(', ')
  }

  const doDeleteSafe = async (reason: string) => {
    setDeleting(true); setErr('')
    try {
      const { data } = await axios.post(`${API}/foundational/${projectId}/wbs/bulk-delete`, {
        nodeIds: safeNodes.map(n => n.id), reason
      })
      onDeletedSafe(data.deleted)
      onClose()
    } catch (e: unknown) {
      const er = e as { response?: { data?: { error?: string } } }
      setErr(er.response?.data?.error ?? 'Delete failed')
      setDeleting(false)
    }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 24, width: 620, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', fontFamily: 'IBM Plex Sans, sans-serif', border: bd }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: col }}>Cannot delete — dependencies found</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
        </div>

        {/* Blocked nodes */}
        <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
          Blocked ({blockedNodes.length})
        </div>
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'rgba(239,68,68,0.1)' }}>
                <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#ef4444', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Code</th>
                <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#ef4444', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Name</th>
                <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#ef4444', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Blocker</th>
              </tr>
            </thead>
            <tbody>
              {blockedNodes.map(n => (
                <tr key={n.id} style={{ borderTop: '1px solid rgba(239,68,68,0.1)' }}>
                  <td style={{ padding: '7px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#ef4444' }}>{n.code}</td>
                  <td style={{ padding: '7px 12px', color: col }}>{n.description}</td>
                  <td style={{ padding: '7px 12px', color: '#94a3b8', fontSize: 11 }}>{blockerReason(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Safe nodes */}
        {safeNodes.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
              Safe to delete ({safeNodes.length})
            </div>
            <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'rgba(34,197,94,0.1)' }}>
                    <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#22c55e', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Code</th>
                    <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#22c55e', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Name</th>
                    <th style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#22c55e', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {safeNodes.map(n => (
                    <tr key={n.id} style={{ borderTop: '1px solid rgba(34,197,94,0.1)' }}>
                      <td style={{ padding: '7px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#22c55e' }}>{n.code}</td>
                      <td style={{ padding: '7px 12px', color: col }}>{n.description}</td>
                      <td style={{ padding: '7px 12px', color: '#22c55e', fontSize: 11 }}>Safe to delete</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {err && <div style={{ marginBottom: 12, fontSize: 12, color: '#ef4444' }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          {safeNodes.length > 0 && (
            <button onClick={() => setShowSafeConfirm(true)} disabled={deleting}
              style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
              Delete safe nodes only ({safeNodes.length})
            </button>
          )}
        </div>

        {showSafeConfirm && (
          <BulkDeleteSafeConfirmModal
            safeNodes={safeNodes}
            totalSelected={allNodes.length}
            blockedCount={blockedNodes.length}
            dark={dark}
            onClose={() => setShowSafeConfirm(false)}
            onConfirm={doDeleteSafe}
          />
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── WBS READINESS MODAL ─────────────────────────────────────
// Detailed readiness view for a WBS node: materials, POs, notes, actions.
interface ReadinessData {
  node: WBSNode & { owner_name: string | null }
  materials: { committed: number; received: number; required: number; outstanding: number }
  pos: { po_number: string; supplier_name: string; status: string; cdd: string | null; ros_date: string | null; rag: string }[]
  actions: unknown[]
}

const WBSReadinessModal = ({ node, projectId, dark, onClose, onNoteSaved }: {
  node: WBSNode; projectId: number; dark: boolean; onClose: () => void
  onNoteSaved: (updated: WBSNode) => void
}) => {
  const [data, setData] = useState<ReadinessData | null>(null)
  const [notes, setNotes] = useState(node.notes ?? '')
  const [notesDirty, setNotesDirty] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [editROS, setEditROS] = useState(false)
  const [rosValue, setRosValue] = useState(node.ros_date?.slice(0, 10) ?? '')
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const MAX_NOTES = 500

  useEffect(() => {
    axios.get<ReadinessData>(`${API}/foundational/${projectId}/wbs/${node.id}/readiness`)
      .then(r => setData(r.data)).catch(() => {})
  }, [node.id, projectId])

  const saveNotes = async () => {
    setSavingNotes(true)
    try {
      const { data: updated } = await axios.patch(`${API}/foundational/${projectId}/wbs/${node.id}`, {
        notes, ros_date: rosValue || null
      })
      onNoteSaved(updated)
      setNotesDirty(false)
    } catch { /* ignore */ }
    finally { setSavingNotes(false) }
  }

  const ragColour = node.rag ? RAG_COLORS[node.rag] : '#94a3b8'
  const rosColour = node.ros_date ? (node.rag === 'red' ? '#ef4444' : node.rag === 'amber' ? '#f59e0b' : node.rag === 'blue' ? '#2563eb' : '#22c55e') : '#94a3b8'

  const RAG_PILL: Record<string, string> = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', blue: '#2563eb' }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 12, width: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', fontFamily: 'IBM Plex Sans, sans-serif', border: bd, overflow: 'hidden' }}>

        {/* STICKY HEADER */}
        <div style={{ padding: '16px 24px', borderBottom: bd, background: dark ? '#0f172a' : '#f8fafc', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 700, color: '#60a5fa', flexShrink: 0 }}>{node.code}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: col, lineHeight: 1.3 }}>{node.description}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                {node.rag && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 9999, background: `${ragColour}20`, color: ragColour }}>
                    {RAG_LABELS[node.rag]}
                  </span>
                )}
                <span style={{ fontSize: 12, color: rosColour, fontFamily: 'JetBrains Mono, monospace' }}>
                  ROS {fmtDate(node.ros_date)}
                </span>
                {!editROS ? (
                  <button onClick={() => setEditROS(true)} style={{ fontSize: 11, background: 'none', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 4, color: '#64748b', cursor: 'pointer', padding: '1px 7px', fontFamily: 'inherit' }}>Edit ROS</button>
                ) : (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="date" value={rosValue} onChange={e => setRosValue(e.target.value)}
                      style={{ height: 26, padding: '0 8px', borderRadius: 4, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 11, fontFamily: 'inherit', outline: 'none' }} />
                    <button onClick={() => { setEditROS(false); setNotesDirty(true) }} style={{ fontSize: 11, background: '#2563eb', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', padding: '2px 8px', fontFamily: 'inherit' }}>✓</button>
                    <button onClick={() => { setEditROS(false); setRosValue(node.ros_date?.slice(0,10) ?? '') }} style={{ fontSize: 11, background: 'none', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 4, color: '#64748b', cursor: 'pointer', padding: '2px 6px', fontFamily: 'inherit' }}>✕</button>
                  </div>
                )}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#94a3b8', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
        </div>

        {/* SCROLLABLE BODY */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* SECTION 1 — Materials */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Materials</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
              {[
                { label: 'Required', value: data?.materials.required ?? '—' },
                { label: 'Committed', value: data?.materials.committed ?? '…' },
                { label: 'Received', value: data?.materials.received ?? '—' },
                { label: 'Outstanding', value: data?.materials.outstanding ?? '—' },
              ].map(card => (
                <div key={card.label} style={{ background: dark ? '#0f172a' : '#f4f7fb', borderRadius: 8, padding: '12px 14px', textAlign: 'center', border: bd }}>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: col }}>{card.value}</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{card.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION 2 — Purchase Orders */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Purchase Orders</div>
            {!data ? (
              <div style={{ fontSize: 12, color: '#64748b' }}>Loading…</div>
            ) : data.pos.length === 0 ? (
              <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>No POs linked to this node</div>
            ) : (
              <div style={{ border: bd, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: dark ? '#0f172a' : '#f4f7fb' }}>
                      {['PO Ref', 'Vendor', 'Status', 'CDD', 'Delivery RAG'].map(h => (
                        <th key={h} style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 600, color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.pos.map(po => (
                      <tr key={po.po_number} style={{ borderTop: bd, background: (po.cdd && node.ros_date && po.cdd > node.ros_date) ? 'rgba(239,68,68,0.06)' : undefined }}>
                        <td style={{ padding: '7px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb' }}>{po.po_number}</td>
                        <td style={{ padding: '7px 12px', color: col }}>{po.supplier_name}</td>
                        <td style={{ padding: '7px 12px', color: '#64748b', fontSize: 11 }}>{po.status}</td>
                        <td style={{ padding: '7px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{fmtDate(po.cdd)}</td>
                        <td style={{ padding: '7px 12px' }}>
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 9999, background: `${RAG_PILL[po.rag] ?? '#94a3b8'}20`, color: RAG_PILL[po.rag] ?? '#94a3b8', fontWeight: 600 }}>
                            {po.rag}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* SECTION 3 — Notes */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Notes</div>
            {node.ros_date && new Date(node.ros_date) < new Date() && (
              <div style={{ marginBottom: 8, padding: '7px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 12, color: '#ef4444' }}>
                ⚠ ROS date is in the past
              </div>
            )}
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value.slice(0, MAX_NOTES)); setNotesDirty(true) }}
              rows={4}
              placeholder="Add notes about this node's scope, constraints, assumptions…"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{notes.length} / {MAX_NOTES}</span>
              <button onClick={saveNotes} disabled={!notesDirty || savingNotes}
                style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: (notesDirty && !savingNotes) ? '#2563eb' : '#94a3b8', color: '#fff', fontSize: 11, fontWeight: 600, cursor: (notesDirty && !savingNotes) ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                {savingNotes ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </div>

          {/* SECTION 4 — Open Actions */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Open Actions</div>
            {!data || data.actions.length === 0 ? (
              <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>No open actions</div>
            ) : null}
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ padding: '12px 24px', borderTop: bd, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 20px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── MAIN SCREEN ─────────────────────────────────────────────
export const FoundWBSScreen = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const [nodes, setNodes]             = useState<WBSNode[]>([])
  const [tree, setTree]               = useState<WBSNode[]>([])
  const [expanded, setExpanded]       = useState<Set<number>>(new Set())
  const [loading, setLoading]         = useState(true)
  const [editNode, setEditNode]       = useState<WBSNode | null>(null)
  const [deleteNode, setDeleteNode]   = useState<WBSNode | null>(null)
  const [showAdd, setShowAdd]         = useState(false)
  const [showUpload, setShowUpload]   = useState(false)
  const [focusMode, setFocusMode]     = useState(false)
  const [focusNode, setFocusNode]     = useState<WBSNode | null>(null)
  const [tooltip, setTooltip]         = useState<{ node: WBSNode; x: number; y: number } | null>(null)
  const tooltipTimer                  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [toast, setToast]             = useState('')
  // ── Gantt view state ─────────────────────────────────────────
  const [wbsView, setWbsView]         = useState<'tree' | 'gantt'>('tree')
  const [ganttZoom, setGanttZoom]     = useState<'quarters' | 'months'>('quarters')
  const [ganttDepth, setGanttDepth]   = useState<number>(2)
  // ── Search & filter state ────────────────────────────────────
  const [searchQ, setSearchQ]         = useState('')
  const [ragFilter, setRagFilter]     = useState<string>('all')
  const [depthLevel, setDepthLevel]   = useState<string>('all')   // expansion-depth preset (NOT a filter)
  // ── Bulk selection state ─────────────────────────────────────
  const [selectedNodes, setSelectedNodes] = useState<Set<number>>(new Set())
  const [bulkRag, setBulkRag]         = useState('')
  // ── Bulk delete modal state ──────────────────────────────────
  const [bulkImpact, setBulkImpact]         = useState<BulkImpactNode[] | null>(null)
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  // ── Readiness modal state ────────────────────────────────────
  const [readinessNode, setReadinessNode] = useState<WBSNode | null>(null)

  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/foundational/${projectId}/wbs`)
      setNodes(data)
      const t = buildTree(data)
      setTree(t)
      setExpanded(prev => {
        const next = new Set(prev)
        t.slice(0, 2).forEach(n => next.add(n.id))
        return next
      })
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const toggleExpand = (id: number) => setExpanded(prev => {
    const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next
  })

  const expandAll = () => { const all = new Set(nodes.map(n => n.id)); setExpanded(all) }
  const collapseAll = () => { setExpanded(new Set()) }

  // ── Depth preset: a "Level N" pick sets the EXPANSION depth, it is NOT a filter.
  // Expands every node SHALLOWER than the chosen level (codeDepth = code.split('.').
  // length, the same depth source the old filter used) so depth-N nodes render
  // collapsed-but-expandable — chevrons still drill deeper. Overwrites manual expand
  // state, like expand/collapse-all. Search/RAG (collectVisible) still supersede this
  // when active. Maps: all→expandAll; level1→∅; level1-2→depth<2; level1-3→depth<3.
  const applyDepthPreset = (value: string) => {
    setDepthLevel(value)
    if (value === 'all') { expandAll(); return }
    const showThrough = value === 'level1' ? 1 : value === 'level1-2' ? 2 : 3   // deepest level to reveal
    setExpanded(new Set(nodes.filter(n => n.code.split('.').length < showThrough).map(n => n.id)))
  }

  // ── Resizable column widths (Code, WBS Node, ROS, Notes, PO Qty) ──
  const { widths: colW, onMouseDown: onColResize, resetWidths } = useColumnResize('wbs_tree', WBS_COL_DEFAULTS, WBS_COL_MINS)

  const downloadTemplate = async () => {
    // Blob download — never window.open (would open in tab not download)
    try {
      const res = await axios.get(`${API}/foundational/${projectId}/wbs/template`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = 'WBS_Upload_Template.xlsx'
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    } catch { showToast('❌ Template download failed') }
  }

  // ── Tooltip handlers ─────────────────────────────────────────
  const handleRowEnter = (node: WBSNode, e: React.MouseEvent) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    const x = e.clientX, y = e.clientY
    tooltipTimer.current = setTimeout(() => setTooltip({ node, x, y }), 300)
  }
  const handleRowLeave = () => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    setTooltip(null)
  }

  const handleNodeSaved = (updated: WBSNode) => {
    const next = nodes.map(n => n.id === updated.id ? updated : n)
    setNodes(next); setTree(buildTree(next))
    showToast(`✓ Node ${updated.code} updated`)
  }

  const handleNodeCreated = (created: WBSNode) => {
    const next = [...nodes, created]; setNodes(next); setTree(buildTree(next))
    setExpanded(prev => new Set([...prev, created.parent_id ?? created.id]))
    showToast(`✓ WBS node ${created.code} added`)
  }

  // ── Bulk operations ──────────────────────────────────────────
  const handleSelectNode = (id: number, checked: boolean) => {
    setSelectedNodes(prev => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  const handleSelectAll = () => {
    if (selectedNodes.size === nodes.length) {
      setSelectedNodes(new Set())
    } else {
      setSelectedNodes(new Set(nodes.map(n => n.id)))
    }
  }

  const applyBulkRag = async () => {
    if (!bulkRag || selectedNodes.size === 0) return
    try {
      await axios.post(`${API}/foundational/${projectId}/wbs/bulk-rag`, { ids: [...selectedNodes], rag: bulkRag })
      await load()
      showToast(`✓ RAG updated for ${selectedNodes.size} nodes`)
      setSelectedNodes(new Set())
      setBulkRag('')
    } catch { showToast('Failed to update RAG') }
  }

  const exportSelected = () => {
    const ids = [...selectedNodes].join(',')
    window.open(`${API}/foundational/${projectId}/wbs/export?ids=${ids}`, '_blank')
  }

  const deleteSelected = async () => {
    // Fetch impact for selected nodes, then show modal
    try {
      const ids = [...selectedNodes].join(',')
      const { data } = await axios.get<BulkImpactNode[]>(`${API}/foundational/${projectId}/wbs/bulk-impact?ids=${ids}`)
      setBulkImpact(data)
      setShowBulkDeleteModal(true)
    } catch {
      showToast('Failed to load impact data')
    }
  }

  // ── Filter logic ─────────────────────────────────────────────
  // Depth is no longer a filter — it drives expansion (applyDepthPreset). Only
  // search + RAG hide nodes; collectVisible(visibleIds) is used solely for those.
  const hasActiveFilter = searchQ.trim() || ragFilter !== 'all'

  const nodeFilterFn = (n: WBSNode): boolean => {
    if (ragFilter !== 'all') {
      const r = ragFilter === 'none' ? null : ragFilter
      if (n.rag !== r) return false
    }
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      return n.code.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)
    }
    return true
  }

  const visibleIds = hasActiveFilter ? collectVisible(tree, nodeFilterFn) : null
  const searchMatchIds = searchQ.trim() ? new Set(nodes.filter(n => {
    const q = searchQ.toLowerCase()
    return n.code.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)
  }).map(n => n.id)) : null

  const secBtn: React.CSSProperties = { padding: '6px 12px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }

  const wbsContent = (inFocus: boolean) => (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif',
      ...(inFocus ? { position: 'fixed' as const, inset: 0, background: dark ? '#0f172a' : '#f1f4f8', zIndex: 9100, display: 'flex', flexDirection: 'column' as const, padding: '20px 20px 0' } : {}) }}>

      {inFocus && (
        <button onClick={() => { setFocusMode(false); setFocusNode(null) }} style={{ position: 'fixed', top: 16, right: 16, zIndex: 9101, padding: '6px 14px', borderRadius: 6, border: bd, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
          ✕ Exit focus
        </button>
      )}

      {/* Back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap', flexShrink: 0 }}>
        <BackButton onFallback={onBack} dark={dark} />
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>🌲 WBS</h2>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3 }}>Work Breakdown Structure — {projectName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
          {/* View toggle */}
          <div style={{ display: 'flex', border: bd, borderRadius: 6, overflow: 'hidden' }}>
            <button onClick={() => setWbsView('tree')} style={{ padding: '5px 12px', border: 'none', background: wbsView === 'tree' ? '#E84E0F' : (dark ? '#1e293b' : '#f4f7fb'), color: wbsView === 'tree' ? '#fff' : '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: wbsView === 'tree' ? 600 : 400 }}>⊞ Tree</button>
            <button onClick={() => setWbsView('gantt')} style={{ padding: '5px 12px', border: 'none', borderLeft: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: wbsView === 'gantt' ? '#E84E0F' : (dark ? '#1e293b' : '#f4f7fb'), color: wbsView === 'gantt' ? '#fff' : '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: wbsView === 'gantt' ? 600 : 400 }}>📊 Gantt</button>
          </div>
          {/* Tree-only controls */}
          {wbsView === 'tree' && <>
            <button onClick={expandAll}   style={secBtn}>⊞ Expand all</button>
            <button onClick={collapseAll} style={secBtn}>⊟ Collapse all</button>
            <button onClick={resetWidths} style={secBtn} title="Reset column widths to default">↺ Reset columns</button>
          </>}
          {/* Gantt-only controls */}
          {wbsView === 'gantt' && <>
            <div style={{ display: 'flex', border: bd, borderRadius: 6, overflow: 'hidden' }}>
              {(['quarters','months'] as const).map((z,i) => (
                <button key={z} onClick={() => setGanttZoom(z)} style={{ padding: '5px 10px', border: 'none', borderLeft: i>0 ? `1px solid ${dark?'#334155':'#dde3ed'}` : 'none', background: ganttZoom===z ? '#2563eb' : (dark?'#1e293b':'#f4f7fb'), color: ganttZoom===z ? '#fff' : '#64748b', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: ganttZoom===z ? 600 : 400, textTransform: 'capitalize' }}>
                  {z}
                </button>
              ))}
            </div>
            {/* Depth control — dropdown (presets + All) + numeric picker; two
                editors of ONE ganttDepth. Finite = force-show that many levels;
                Infinity = "All" follows the tree's expand state. */}
            <select value={ganttDepth === Infinity ? 'all' : [0, 1, 2].includes(ganttDepth) ? String(ganttDepth) : 'custom'}
              onChange={e => { const v = e.target.value; setGanttDepth(v === 'all' ? Infinity : Number(v)) }}
              style={{ height: 28, padding: '0 8px', borderRadius: 6, border: bd, background: dark ? '#1e293b' : '#f4f7fb', color: '#64748b', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', outline: 'none' }}>
              <option value="0">L1</option>
              <option value="1">L1–L2</option>
              <option value="2">L1–L3</option>
              <option value="all">All (expanded)</option>
              {ganttDepth !== Infinity && ![0, 1, 2].includes(ganttDepth) && (
                <option value="custom" disabled>Custom (L1–L{ganttDepth + 1})</option>
              )}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Level</span>
              <input type="number" min={1} max={15}
                value={ganttDepth === Infinity ? '' : ganttDepth + 1}
                placeholder="All"
                onChange={e => {
                  const raw = e.target.value
                  if (raw === '') { setGanttDepth(Infinity); return }   // blank = All
                  const c = Math.max(1, Math.min(15, Number(raw) || 1)) // clamp [1,15]
                  setGanttDepth(c - 1)
                }}
                title="Jump to an exact depth (1–15)"
                style={{ width: 50, height: 28, padding: '0 6px', borderRadius: 6, border: bd, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 11, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }} />
            </div>
          </>}
          <button onClick={() => { setFocusMode(f => !f); setFocusNode(null) }} style={{ ...secBtn, color: focusMode ? '#E84E0F' : '#64748b' }}>⛶ Focus</button>
          <button onClick={downloadTemplate} style={secBtn}>↓ Template</button>
          <button onClick={() => setShowUpload(true)} style={secBtn}>↑ Upload XER/Excel</button>
          <HelpButton screenName="WBS" sections={WBS_HELP} dark={dark} />
          {wbsView === 'tree' && <button onClick={() => setShowAdd(true)} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add node</button>}
        </div>
      </div>

      {/* ── Search & Filter bar ──────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
          placeholder="Search code or name…"
          style={{ flex: '1 1 180px', height: 32, padding: '0 10px', borderRadius: 6, border: bd, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
        {/* RAG filter pills */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[['all','All'],['green','🟢'],['amber','🟡'],['red','🔴'],['blue','🔵'],['none','⚪']].map(([v,l]) => (
            <button key={v} onClick={() => setRagFilter(v)}
              style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${ragFilter === v ? '#2563eb' : (dark ? '#334155' : '#dde3ed')}`, background: ragFilter === v ? '#2563eb' : 'none', color: ragFilter === v ? '#fff' : '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: ragFilter === v ? 600 : 400 }}>
              {l}
            </button>
          ))}
        </div>
        {/* Depth filter — Tree only (the Gantt has its own depth control; this
            dropdown never affected the Gantt, so it's hidden in Gantt view). */}
        {wbsView === 'tree' && (
          <select value={depthLevel} onChange={e => applyDepthPreset(e.target.value)}
            title="Expand the tree through this depth (deeper nodes stay collapsed but expandable)"
            style={{ height: 32, padding: '0 8px', borderRadius: 6, border: bd, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
            <option value="all">All levels</option>
            <option value="level1">Level 1 only</option>
            <option value="level1-2">Level 1-2</option>
            <option value="level1-3">Level 1-3</option>
          </select>
        )}
        {hasActiveFilter && (
          <button onClick={() => { setSearchQ(''); setRagFilter('all') }}
            style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid rgba(239,68,68,0.3)`, background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
            ✕ Clear filters
          </button>
        )}
      </div>

      {/* Gantt view — shown when wbsView==='gantt' */}
      {wbsView === 'gantt' && (
        <>
          <WBSGanttView
            nodes={nodes}
            projectId={projectId}
            dark={dark}
            zoom={ganttZoom}
            maxDepth={ganttDepth}
            expanded={expanded}
            onToggle={toggleExpand}
            onNodeClick={node => { setEditNode(node) }}
          />
          {/* ── Gantt legend (bottom) — reflects what the chart ACTUALLY draws:
              schedule bars (planned/forecast/actual), the ROS milestone diamond,
              the Today line, and the left-pane RAG status dots. (The generic
              MilestoneLegend used in Tree view does not match the Gantt, so the
              Gantt gets this corrected legend.) ── */}
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', marginTop: 8, border: bd, borderRadius: 8, background: dark ? '#1e293b' : '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Schedule</span>
            {[
              { label: 'Planned',  fill: '#B5D4F4', border: '#85B7EB' },
              { label: 'Forecast', fill: '#FAC775', border: '#EF9F27' },
              { label: 'Actual',   fill: '#C0DD97', border: '#97C459' },
            ].map(b => (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 22, height: 9, borderRadius: 3, background: b.fill, border: `0.5px solid ${b.border}`, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{b.label}</span>
              </div>
            ))}
            {/* ROS milestone diamond */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, background: '#E84E0F', transform: 'rotate(45deg)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>ROS milestone</span>
            </div>
            {/* Today line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 2, height: 12, background: '#E84E0F', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Today</span>
            </div>
            <span style={{ width: 1, height: 16, background: bd.includes('1px') ? (dark ? '#334155' : '#e8ecf2') : '#e8ecf2' }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase' }}>RAG status</span>
            {[
              { label: 'On track',    color: RAG_COLORS.green },
              { label: 'At risk',     color: RAG_COLORS.amber },
              { label: 'Breached',    color: RAG_COLORS.red },
              { label: 'In progress', color: RAG_COLORS.blue },
              { label: 'Not set',     color: '#c4cedf', hollow: true },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.hollow ? 'transparent' : r.color, border: r.hollow ? `2px solid ${r.color}` : 'none', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{r.label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Table + panel flex container */}
      {wbsView === 'tree' && <div style={{ display: 'flex', flex: inFocus ? 1 : undefined, overflow: 'hidden', ...(inFocus ? {} : {}) }}>
        {/* Tree table */}
        <div style={{ flex: 1, minWidth: 0, background: dark ? '#1e293b' : '#fff', border: bd, borderRadius: focusNode ? '10px 0 0 10px' : 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', ...(inFocus ? { display: 'flex', flexDirection: 'column' } : {}) }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: inFocus ? undefined : 'calc(100vh - 310px)', flex: inFocus ? 1 : undefined }}>
            <table style={{ width: 4 + 28 + 36 + colW[0] + colW[1] + colW[2] + (focusMode ? 0 : 80 + colW[3] + colW[4]), minWidth: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
              {/* colgroup drives the resizable column widths (table-layout: fixed) */}
              <colgroup>
                <col style={{ width: 4 }} />
                <col style={{ width: 28 }} />
                <col style={{ width: colW[0] }} />
                <col style={{ width: colW[1] }} />
                <col style={{ width: colW[2] }} />
                {!focusMode && <col style={{ width: colW[3] }} />}
                {!focusMode && <col style={{ width: colW[4] }} />}
                {!focusMode && <col style={{ width: 80 }} />}
                <col style={{ width: 36 }} />
              </colgroup>
              <thead>
                <tr style={{ background: dark ? '#0f172a' : '#f4f7fb', borderBottom: bd, position: 'sticky', top: 0, zIndex: 2 }}>
                  <th style={{ padding: 0 }} />
                  <th style={{ padding: '8px 4px', textAlign: 'center' }}>
                    <input type="checkbox"
                      checked={selectedNodes.size === nodes.length && nodes.length > 0}
                      onChange={handleSelectAll}
                      style={{ cursor: 'pointer', accentColor: '#2563eb' }} />
                  </th>
                  <th style={{ position: 'relative', padding: '8px 8px 8px 22px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'center', whiteSpace: 'nowrap' }}>Code<ColResizeHandle onMouseDown={e => onColResize(0, e)} dark={dark} /></th>
                  <th style={{ position: 'relative', padding: '8px 4px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'center' }}>WBS Node<ColResizeHandle onMouseDown={e => onColResize(1, e)} dark={dark} /></th>
                  <th style={{ position: 'relative', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'center', whiteSpace: 'nowrap' }}>ROS<ColResizeHandle onMouseDown={e => onColResize(2, e)} dark={dark} /></th>
                  {!focusMode && <th style={{ position: 'relative', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'center' }}>Notes<ColResizeHandle onMouseDown={e => onColResize(3, e)} dark={dark} /></th>}
                  {!focusMode && <th style={{ position: 'relative', padding: '8px 8px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'right', whiteSpace: 'nowrap' }}>PO Qty<ColResizeHandle onMouseDown={e => onColResize(4, e)} dark={dark} /></th>}
                  {!focusMode && <th />}
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ padding: '32px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading WBS…</td></tr>
                ) : tree.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding: '32px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No WBS nodes yet. Click + Add node to get started.</td></tr>
                ) : tree.map(node => (
                  <WBSRow key={node.id} node={node} depth={0} dark={dark}
                    expanded={expanded} onToggle={toggleExpand}
                    onEdit={setEditNode} onDelete={setDeleteNode}
                    onRowEnter={handleRowEnter} onRowLeave={handleRowLeave}
                    focusMode={focusMode} onFocusClick={n => setFocusNode(n)}
                    selected={selectedNodes.has(node.id)}
                    onSelect={handleSelectNode}
                    searchMatch={searchMatchIds ? searchMatchIds.has(node.id) : false}
                    filterVisible={visibleIds ? visibleIds.has(node.id) : true}
                    onOpenReadiness={setReadinessNode}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Focus panel */}
        {focusMode && focusNode && (
          <FocusPanel node={focusNode} projectId={projectId} dark={dark}
            onClose={() => setFocusNode(null)}
            onEditNode={n => setEditNode(n)} />
        )}
      </div>}  {/* end wbsView==='tree' */}

      {/* WBS Tree RAG legend (bottom) — matches the Tree's left-pane status dots
          (RAG_LABELS), not the old generic Complete/Future set. Same bottom
          placement/style as the Gantt legend. */}
      {wbsView === 'tree' && (
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', marginTop: 8, border: bd, borderRadius: 8, background: dark ? '#1e293b' : '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase' }}>RAG status</span>
          {[
            { label: 'On track',    color: RAG_COLORS.green },
            { label: 'At risk',     color: RAG_COLORS.amber },
            { label: 'Breached',    color: RAG_COLORS.red },
            { label: 'In progress', color: RAG_COLORS.blue },
            { label: 'Not set',     color: '#c4cedf', hollow: true },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.hollow ? 'transparent' : r.color, border: r.hollow ? `2px solid ${r.color}` : 'none', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{r.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Modals ── */}
      {editNode && (
        <NoteModal node={editNode} dark={dark} onClose={() => setEditNode(null)} onSaved={n => { handleNodeSaved(n); setEditNode(null) }} />
      )}
      {showAdd && (
        <AddNodeModal projectId={projectId} nodes={nodes} dark={dark} onClose={() => setShowAdd(false)} onCreated={handleNodeCreated} onQueued={showToast} />
      )}
      {deleteNode && (
        <DeleteWBSWizard node={deleteNode} projectId={projectId} dark={dark} onClose={() => setDeleteNode(null)} onDeleted={() => { load(); showToast('Node deleted') }} />
      )}
      {showUpload && (
        <UploadModal projectId={projectId} dark={dark} onClose={() => setShowUpload(false)} onImported={() => { load(); showToast('✓ WBS imported successfully') }} />
      )}

      {/* ── Bulk delete modals ── */}
      {showBulkDeleteModal && bulkImpact && (() => {
        const safe = bulkImpact.filter(n => n.childCount === 0 && n.poCount === 0 && n.commCount === 0 && n.equipCount === 0)
        const blocked = bulkImpact.filter(n => n.childCount > 0 || n.poCount > 0 || n.commCount > 0 || n.equipCount > 0)
        if (blocked.length === 0) {
          return (
            <BulkDeleteConfirmModal
              nodes={safe}
              projectId={projectId}
              dark={dark}
              onClose={() => { setShowBulkDeleteModal(false); setBulkImpact(null) }}
              onDeleted={deleted => { load(); showToast(`✓ Deleted ${deleted.length} node(s)`); setSelectedNodes(new Set()); setShowBulkDeleteModal(false); setBulkImpact(null) }}
            />
          )
        } else {
          return (
            <BulkDeleteBlockedModal
              allNodes={bulkImpact}
              blockedNodes={blocked}
              safeNodes={safe}
              dark={dark}
              projectId={projectId}
              onClose={() => { setShowBulkDeleteModal(false); setBulkImpact(null) }}
              onDeletedSafe={deleted => { load(); showToast(`✓ Deleted ${deleted.length} safe node(s)`); setSelectedNodes(new Set()); setShowBulkDeleteModal(false); setBulkImpact(null) }}
            />
          )
        }
      })()}

      {/* ── Readiness modal ── */}
      {readinessNode && (
        <WBSReadinessModal
          node={readinessNode}
          projectId={projectId}
          dark={dark}
          onClose={() => setReadinessNode(null)}
          onNoteSaved={updated => { handleNodeSaved(updated); setReadinessNode(prev => prev?.id === updated.id ? updated : prev) }}
        />
      )}

      {/* Tooltip (normal mode only) */}
      {!focusMode && tooltip && <WBSTooltip node={tooltip.node} projectId={projectId} cursorX={tooltip.x} cursorY={tooltip.y} />}

      {/* ── Bulk operations floating bar ── */}
      {selectedNodes.size > 0 && (
        <div style={{ position: 'fixed', bottom: 24, left: 244, right: 24, zIndex: 9200, background: dark ? '#1e293b' : '#fff', border: `1px solid #2563eb`, borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 8px 28px rgba(37,99,235,0.25)', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', whiteSpace: 'nowrap' }}>{selectedNodes.size} node{selectedNodes.size !== 1 ? 's' : ''} selected</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            <select value={bulkRag} onChange={e => setBulkRag(e.target.value)}
              style={{ height: 30, padding: '0 8px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none' }}>
              <option value="">Change RAG…</option>
              <option value="green">🟢 On track</option>
              <option value="amber">🟡 At risk</option>
              <option value="red">🔴 Breached</option>
              <option value="blue">🔵 In progress</option>
            </select>
            {bulkRag && (
              <button onClick={applyBulkRag} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Apply RAG</button>
            )}
            <button onClick={exportSelected} style={{ padding: '5px 12px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↓ Export selected</button>
            <button onClick={deleteSelected} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>🗑 Delete safe</button>
          </div>
          <button onClick={() => setSelectedNodes(new Set())} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer', padding: '2px 4px', flexShrink: 0 }}>✕</button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#0d1117', border: '1px solid rgba(34,197,94,0.28)', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 500, color: '#f1f5f9', zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 8px 28px rgba(0,0,0,0.45)', pointerEvents: 'none' }}>
          {toast}
        </div>
      )}
    </div>
  )

  return focusMode
    ? createPortal(wbsContent(true), document.body)
    : wbsContent(false)
}
