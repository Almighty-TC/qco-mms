// ─── FOUNDATIONAL WBS SCREEN ────────────────────────────────
// Tree table of WBS nodes. Expand/collapse, add, edit notes, delete.
import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'

const API = 'http://localhost:3001/api'

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

// ─── RAG DOT ────────────────────────────────────────────────
const RAGDot = ({ rag }: { rag: string | null }) => (
  <span title={rag ? RAG_LABELS[rag] : 'Not set'}
    style={{ width: 10, height: 10, borderRadius: '50%', background: rag ? RAG_COLORS[rag] : '#c4cedf', display: 'inline-block', flexShrink: 0 }} />
)

// ─── NOTE EDITOR MODAL ───────────────────────────────────────
const NoteModal = ({ node, dark, onClose, onSaved }: { node: WBSNode; dark: boolean; onClose: () => void; onSaved: (n: WBSNode) => void }) => {
  const [notes, setNotes]   = useState(node.notes ?? '')
  const [ros, setRos]       = useState(node.ros_date?.slice(0, 10) ?? '')
  const [rag, setRag]       = useState(node.rag ?? '')
  const [saving, setSaving] = useState(false)
  const col = dark ? '#f1f5f9' : '#0f172a'

  const save = async () => {
    setSaving(true)
    try {
      const { data } = await axios.patch(`${API}/foundational/${node.project_id}/wbs/${node.id}`, { notes, ros_date: ros || null, rag: rag || null })
      onSaved(data)
      onClose()
    } catch { setSaving(false) }
  }

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

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>ROS Date</label>
        <input type="date" value={ros} onChange={e => setRos(e.target.value)}
          style={{ height: 34, padding: '0 10px', borderRadius: 6, width: '100%', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 14 }} />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>RAG Status</label>
        <select value={rag} onChange={e => setRag(e.target.value)}
          style={{ height: 34, padding: '0 10px', borderRadius: 6, width: '100%', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', marginBottom: 14 }}>
          <option value="">— Not set</option>
          <option value="green">On track</option>
          <option value="amber">At risk</option>
          <option value="red">Breached</option>
          <option value="blue">In progress</option>
        </select>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>Notes / Scope</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
          placeholder="Scope description, constraints, assumptions…"
          style={{ padding: '8px 10px', borderRadius: 6, width: '100%', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginBottom: 18 }} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : '✓ Save changes'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── ADD WBS NODE MODAL ──────────────────────────────────────
const AddNodeModal = ({ projectId, nodes, dark, onClose, onCreated }: {
  projectId: number; nodes: WBSNode[]; dark: boolean; onClose: () => void; onCreated: (n: WBSNode) => void
}) => {
  const [parentId, setParentId]     = useState('')
  const [suffix, setSuffix]         = useState('')
  const [description, setDesc]      = useState('')
  const [rag, setRag]               = useState('')
  const [rosDate, setRosDate]       = useState('')
  const [plannedStart, setStart]    = useState('')
  const [plannedEnd, setEnd]        = useState('')
  const [notes, setNotes]           = useState('')
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'

  // Flat list for dropdown (sorted by code)
  const flatNodes = [...nodes].sort((a, b) => a.code.localeCompare(b.code))

  const parentNode = flatNodes.find(n => String(n.id) === parentId)
  const fullCode = parentNode ? `${parentNode.code}.${suffix}` : suffix

  const valid = suffix.trim() && description.trim()

  const inp = { height: 34, padding: '0 10px', borderRadius: 6, width: '100%', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, marginBottom: 0 }

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const { data } = await axios.post(`${API}/foundational/${projectId}/wbs`, {
        code: fullCode, description: description.trim(),
        parent_id: parentId ? Number(parentId) : null,
        rag: rag || null, ros_date: rosDate || null,
        planned_start: plannedStart || null, planned_end: plannedEnd || null,
        notes: notes || null,
      })
      onCreated(data)
      onClose()
    } catch (e: unknown) {
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
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 28, width: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.4)', fontFamily: 'IBM Plex Sans, sans-serif', border: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
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
        <input value={description} onChange={e => setDesc(e.target.value)} placeholder="e.g. Process Vessels & Columns"
          style={{ ...inp, gridColumn: '1 / -1' }} />

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
          <div>
            {label('Planned start')}
            <input type="date" value={plannedStart} onChange={e => setStart(e.target.value)} style={inp} />
          </div>
          <div>
            {label('Planned end')}
            <input type="date" value={plannedEnd} onChange={e => setEnd(e.target.value)} style={inp} />
          </div>
        </div>

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
    affectedPOs: { id: number; po_number: string; wbs_code: string; status: string }[]
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
      // Apply reallocations first
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

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: dark ? '#1e293b' : '#fff', borderRadius: 10, padding: 28, width: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', fontFamily: 'IBM Plex Sans, sans-serif', border: '2px solid rgba(239,68,68,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444' }}>Delete WBS Node</div>
            <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8', marginTop: 2 }}>{node.code} — {node.description}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Step {step} of {impact?.affectedLines?.length ? 3 : (step === 1 ? '2 (skip reallocate)' : 3)}</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>×</button>
          </div>
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
                    {[
                      ['Child nodes', impact.childCount],
                      ['Affected POs', impact.affectedPOs.length],
                      ['Line items', impact.affectedLines.length],
                      ['Code prefix', impact.codesCovered],
                    ].map(([l, v]) => (
                      <div key={String(l)} style={{ background: dark ? '#0f172a' : '#fff5f5', borderRadius: 6, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444', fontFamily: 'JetBrains Mono, monospace' }}>{v}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  {safeToDelete && (
                    <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✓ Safe to delete — no child nodes or POs reference this node.</div>
                  )}
                  {impact.affectedPOs.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Related purchase orders</div>
                      {impact.affectedPOs.map(po => (
                        <div key={po.id} style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid rgba(239,68,68,0.1)', fontSize: 12 }}>
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb' }}>{po.po_number}</span>
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#64748b' }}>{po.wbs_code}</span>
                          <span style={{ color: '#94a3b8' }}>{po.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={() => impact?.affectedLines?.length ? setStep(2) : setStep(3)}
                disabled={!impact}
                style={{ padding: '7px 18px', borderRadius: 6, border: 'none', background: impact ? '#ef4444' : '#94a3b8', color: '#fff', fontSize: 12, fontWeight: 600, cursor: impact ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
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
              {Object.keys(allocations).length} of {impact.affectedLines.length} lines re-allocated
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
              <div style={{ fontSize: 12, color: dark ? '#f1f5f9' : '#0f172a', marginBottom: 4 }}>
                You are about to permanently delete WBS node <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{node.code}</strong> — {node.description}.
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>This action cannot be undone. Any child nodes will also be removed.</div>
              {impact.affectedLines.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Re-allocation summary:</div>
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
  const [allocInfo, setAllocInfo] = useState<{ allocatedQty: number } | null>(null)

  useEffect(() => {
    axios.get(`${API}/foundational/${projectId}/wbs`).then(r => {
      setNodes(r.data.filter((n: WBSNode) => !n.code.startsWith(excludeCode)))
    }).catch(() => {})
  }, [projectId, excludeCode])

  useEffect(() => {
    if (!value?.nodeId) { setAllocInfo(null); return }
    axios.get(`${API}/foundational/${projectId}/wbs/allocation-check/${value.nodeId}`)
      .then(r => setAllocInfo(r.data)).catch(() => {})
  }, [value?.nodeId, projectId])

  const col = dark ? '#f1f5f9' : '#0f172a'

  return (
    <div style={{ background: dark ? '#0f172a' : '#fff5f5', borderRadius: 8, padding: '10px 14px', marginBottom: 8, border: '1px solid rgba(239,68,68,0.12)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb' }}>{line.po_number}</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>Line {line.line_number}</span>
        <span style={{ fontSize: 12, color: col, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.description}</span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#94a3b8' }}>{line.qty} {line.uom}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#ef4444', fontFamily: 'JetBrains Mono, monospace', textDecoration: 'line-through' }}>{line.wbs_code_snapshot}</span>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>→</span>
        <select
          value={value?.nodeId ?? ''}
          onChange={e => {
            const n = nodes.find(x => String(x.id) === e.target.value)
            if (n) onChange(e.target.value, n.code)
            else onChange('', '')
          }}
          style={{ flex: 1, height: 30, padding: '0 8px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#1e293b' : '#fff', color: col, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', outline: 'none' }}>
          <option value="">— Select new WBS</option>
          {nodes.map(n => <option key={n.id} value={n.id}>{n.code} — {n.description}</option>)}
        </select>
      </div>
      {allocInfo !== null && value?.nodeId && (
        <div style={{ marginTop: 4, fontSize: 11, color: allocInfo.allocatedQty > 0 ? '#f59e0b' : '#22c55e' }}>
          {allocInfo.allocatedQty > 0
            ? `⚠ ${allocInfo.allocatedQty} units already allocated to ${value.code}`
            : `✓ No existing allocations at ${value.code}`}
        </div>
      )}
    </div>
  )
}

// ─── WBS ROW (recursive) ─────────────────────────────────────
const WBSRow = ({ node, depth, dark, expanded, onToggle, onEdit, onDelete, hideChildren }: {
  node: WBSNode; depth: number; dark: boolean
  expanded: Set<number>; onToggle: (id: number) => void
  onEdit: (n: WBSNode) => void; onDelete: (n: WBSNode) => void
  hideChildren?: boolean
}) => {
  const [hovered, setHovered] = useState(false)
  const hasChildren = node.children && node.children.length > 0
  const isExpanded = expanded.has(node.id)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const indent = depth * 20

  const ragColour = node.rag ? RAG_COLORS[node.rag] : '#c4cedf'

  return (
    <>
      <tr
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ background: hovered ? (dark ? '#1e2d4a' : '#f4f7fb') : (dark ? '#1e293b' : '#fff'), transition: 'background 120ms', cursor: hasChildren ? 'pointer' : 'default' }}
        onClick={() => hasChildren && onToggle(node.id)}
      >
        {/* RAG stripe */}
        <td style={{ width: 4, padding: 0 }}>
          <div style={{ width: 4, height: '100%', minHeight: 36, background: ragColour, borderRadius: '2px 0 0 2px' }} />
        </td>
        {/* Chevron */}
        <td style={{ width: 28, textAlign: 'center', paddingLeft: indent, color: '#94a3b8', fontSize: 11, userSelect: 'none' }}>
          {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
        </td>
        {/* RAG dot */}
        <td style={{ width: 24, textAlign: 'center' }}><RAGDot rag={node.rag} /></td>
        {/* Code */}
        <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: col, whiteSpace: 'nowrap' }}>{node.code}</td>
        {/* Description */}
        <td style={{ padding: '8px 10px', fontSize: 13, color: col, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.description}</td>
        {/* ROS */}
        <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, whiteSpace: 'nowrap', color: node.ros_date ? (node.rag === 'red' ? '#ef4444' : node.rag === 'amber' ? '#f59e0b' : '#22c55e') : '#94a3b8' }}>
          {fmtDate(node.ros_date)}
        </td>
        {/* Notes (clickable) */}
        <td style={{ padding: '8px 10px', fontSize: 12, maxWidth: 200 }}>
          <button
            onClick={e => { e.stopPropagation(); onEdit(node) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: node.notes ? '#2563eb' : '#94a3b8', fontSize: 12, fontFamily: 'inherit', textAlign: 'left', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', padding: 0 }}
            title={node.notes ?? 'Click to add notes'}>
            {node.notes ? `${node.notes.slice(0, 40)}${node.notes.length > 40 ? '…' : ''}` : '+ Add note'}
          </button>
        </td>
        {/* Code hint */}
        <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
          {node.code}.xx
        </td>
        {/* Delete */}
        <td style={{ padding: '8px 8px', textAlign: 'center' }}>
          <button
            onClick={e => { e.stopPropagation(); onDelete(node) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: hovered ? '#ef4444' : 'transparent', fontSize: 14, transition: 'color 150ms', padding: '2px 6px' }}
            title="Delete node">
            🗑
          </button>
        </td>
      </tr>
      {!hideChildren && isExpanded && node.children?.map(child => (
        <WBSRow key={child.id} node={child} depth={depth + 1} dark={dark}
          expanded={expanded} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </>
  )
}

// ─── MAIN SCREEN ─────────────────────────────────────────────
export const FoundWBSScreen = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const [nodes, setNodes]         = useState<WBSNode[]>([])
  const [tree, setTree]           = useState<WBSNode[]>([])
  const [expanded, setExpanded]   = useState<Set<number>>(new Set())
  const [loading, setLoading]     = useState(true)
  const [editNode, setEditNode]   = useState<WBSNode | null>(null)
  const [deleteNode, setDeleteNode] = useState<WBSNode | null>(null)
  const [showAdd, setShowAdd]     = useState(false)
  const [toast, setToast]         = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/foundational/${projectId}/wbs`)
      setNodes(data)
      const t = buildTree(data)
      setTree(t)
      // Default expand first two top-level nodes
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
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const handleNodeSaved = (updated: WBSNode) => {
    setNodes(prev => prev.map(n => n.id === updated.id ? updated : n))
    setTree(buildTree(nodes.map(n => n.id === updated.id ? updated : n)))
    showToast(`✓ Node ${updated.code} updated`)
  }

  const handleNodeCreated = (created: WBSNode) => {
    const next = [...nodes, created]
    setNodes(next)
    setTree(buildTree(next))
    setExpanded(prev => new Set([...prev, created.parent_id ?? created.id]))
    showToast(`✓ WBS node ${created.code} added`)
  }

  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* ── Breadcrumb ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>← Dashboard</button>
        <span>›</span><span>{projectName}</span><span>›</span><span>Foundational</span><span>›</span>
        <span style={{ color: col, fontWeight: 600 }}>WBS</span>
      </div>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>🌲 WBS</h2>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3 }}>Work Breakdown Structure — {projectName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↑ Upload XER/Excel</button>
          <button onClick={() => setShowAdd(true)} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add node</button>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: bd, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: dark ? '#0f172a' : '#f4f7fb', borderBottom: bd, position: 'sticky', top: 0, zIndex: 2 }}>
                <th style={{ width: 4, padding: 0 }} />
                <th style={{ width: 28 }} />
                <th style={{ width: 24 }} />
                <th style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' }}>Code</th>
                <th style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left' }}>Node label</th>
                <th style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' }}>ROS</th>
                <th style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left' }}>Notes</th>
                <th style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' }}>Children</th>
                <th style={{ width: 40 }} />
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
                  onEdit={setEditNode} onDelete={setDeleteNode} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modals ── */}
      {editNode && (
        <NoteModal node={editNode} dark={dark} onClose={() => setEditNode(null)} onSaved={n => { handleNodeSaved(n); setEditNode(null) }} />
      )}
      {showAdd && (
        <AddNodeModal projectId={projectId} nodes={nodes} dark={dark} onClose={() => setShowAdd(false)} onCreated={handleNodeCreated} />
      )}
      {deleteNode && (
        <DeleteWBSWizard node={deleteNode} projectId={projectId} dark={dark} onClose={() => setDeleteNode(null)} onDeleted={() => { load(); showToast('Node deleted') }} />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#0d1117', border: '1px solid rgba(34,197,94,0.28)', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 500, color: '#f1f5f9', zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 8px 28px rgba(0,0,0,0.45)', pointerEvents: 'none' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
