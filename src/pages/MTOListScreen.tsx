// ─── MTO LIST SCREEN ─────────────────────────────────────────────────────────
// Shows all MTO registers for the selected project. Active MTOs are clickable;
// superseded MTOs are shown at reduced opacity with a "Superseded" pill.
// New MTO wizard supports manual entry (2 steps: metadata → lines).
// Upload MTO wizard supports file-based import with preview and conflict check.
import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { isApprovalRequired, submitForApproval, approvalToast } from '../lib/pendingChanges'
import { useResizableTable, ResetColumnsButton } from '../components/colResize'

// Resizable column defaults — MTO register grid (7 cols).
const MTO_REG_W   = [280, 110, 80, 140, 160, 120, 80]
const MTO_REG_MIN = [140, 80, 60, 100, 100, 90, 60]
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { HelpButton } from '../components/HelpDrawer'
import { MTO_REGISTER_HELP } from '../helpContent'
import { BackButton } from '../components/BackButton'
import { MilestoneLegend } from '../components/MilestoneLegend'

// ─── API BASE ────────────────────────────────────────────────────────────────
const API = 'http://localhost:3001/api'

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface MTORegister {
  id: number
  project_id: number
  name: string
  reference: string
  current_revision: string
  owner: string | null
  description: string | null
  status: 'active' | 'superseded'
  line_count: number
  updated_at: string
}

interface WBSNode { id: number; code: string; description: string }

interface NewLineRow {
  key: string
  line_number: string
  wbs_code: string
  description: string
  quantity: string
  uom: string
  ros_date: string
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmtDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Client-side revision FORMAT check (mirrors server/lib/revision.js). Ordering is
// enforced server-side on upload; this is instant feedback for the format rule.
export function revisionFormatError(rev: string): string | null {
  const s = (rev ?? '').trim()
  if (!/^[A-Za-z0-9-]{1,10}$/.test(s))
    return 'Use 1–10 characters: letters, numbers and dashes only (e.g. A, A-7, A-7-B).'
  if (s.split('-').some(seg => seg === ''))
    return 'No leading, trailing or double dashes.'
  return null
}

let _key = 0
const newRow = (): NewLineRow => ({
  key: String(++_key),
  line_number: '',
  wbs_code: '',
  description: '',
  quantity: '',
  uom: 'EA',
  ros_date: '',
})

// ─── STATUS PILL ─────────────────────────────────────────────────────────────
const StatusPill = ({ s }: { s: 'active' | 'superseded' }) => {
  const active = s === 'active'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 9999,
      fontSize: 11,
      fontWeight: 600,
      fontFamily: 'IBM Plex Sans, sans-serif',
      background: active ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.18)',
      color: active ? '#15803d' : '#64748b',
      border: `1px solid ${active ? 'rgba(34,197,94,0.25)' : 'rgba(148,163,184,0.3)'}`,
    }}>{active ? 'Active' : 'Superseded'}</span>
  )
}

// ─── NEW MTO MODAL ───────────────────────────────────────────────────────────
// 2-step wizard: metadata form → lines (manual entry only)
const NewMTOModal = ({
  dark, projectId, wbsNodes, onClose, onCreated,
}: {
  dark: boolean
  projectId: number
  wbsNodes: WBSNode[]
  onClose: () => void
  onCreated: (mto: MTORegister) => void
}) => {
  const { addToast } = useToast()
  const [step, setStep]     = useState<1 | 2>(1)

  // Form fields
  const [name,     setName]     = useState('')
  const [ref,      setRef]      = useState('')
  const [revision, setRevision] = useState('A')
  const [owner,    setOwner]    = useState('')
  const [desc,     setDesc]     = useState('')

  // Lines (step 2)
  const [lines, setLines] = useState<NewLineRow[]>([newRow()])

  const [saving, setSaving] = useState(false)

  const bg   = dark ? '#0f172a' : '#fff'
  const bd   = `1px solid ${dark ? '#334155' : '#e2e8f0'}`
  const col  = dark ? '#f1f5f9' : '#0f172a'
  const sub  = dark ? '#94a3b8' : '#64748b'
  const inp  = { background: dark ? '#1e293b' : '#f8fafc', border: bd, color: col,
                 borderRadius: 6, padding: '7px 10px', fontSize: 13,
                 fontFamily: 'IBM Plex Sans, sans-serif', width: '100%', boxSizing: 'border-box' as const }

  const canCreate = name.trim() && ref.trim() && lines.some(l => l.description.trim())

  async function handleCreate() {
    setSaving(true)
    try {
      // 1. Create register
      const { data: mto } = await axios.post<MTORegister>(
        `${API}/mto/${projectId}`,
        { name, reference: ref, current_revision: revision, owner: owner || null, description: desc || null }
      )

      // 2. Post each line
      for (const l of lines.filter(r => r.description.trim())) {
        await axios.post(`${API}/mto/${projectId}/${mto.id}/lines`, {
          line_number:      l.line_number  || `L-${String(lines.indexOf(l)+1).padStart(3,'0')}`,
          wbs_code:         l.wbs_code     || null,
          description:      l.description,
          quantity:         l.quantity     ? parseFloat(l.quantity) : null,
          uom:              l.uom          || null,
          ros_date:         l.ros_date     || null,
        })
      }

      addToast('success', `${mto.reference} created`)
      onCreated(mto)
    } catch (e: unknown) {
      // Proposer roles can't write the register directly — the POST above is
      // intercepted with a requiresApproval 409. Stage it for confirmation instead.
      if (isApprovalRequired(e)) {
        try {
          const r = await submitForApproval(projectId, 'mto', 'create',
            { name, reference: ref, current_revision: revision, owner: owner || null, description: desc || null })
          addToast('success', approvalToast(r))
          onClose()
        } catch (se: unknown) {
          const serr = se as { response?: { data?: { error?: string } } }
          addToast('error', serr.response?.data?.error ?? 'Could not submit to approval queue')
        }
        return
      }
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Failed to create MTO')
    } finally {
      setSaving(false)
    }
  }

  function updateLine(key: string, field: keyof NewLineRow, value: string | boolean) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l))
  }


  // ─── Helper: auto-generate line number for a new row ──────────────────────
  function addLine() {
    const nextNum = lines.length + 1
    const lineNum = `L-${String(nextNum).padStart(3, '0')}`
    setLines(prev => [...prev, { ...newRow(), line_number: lineNum }])
  }

  // ─── Missing description count for footer status ─────────────────────────
  const missingDesc = lines.filter(l => !l.description.trim()).length

  // ─── STEP 1: compact metadata modal ──────────────────────────────────────
  if (step === 1) {
    const step1Body = (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} style={{
          background: bg, border: bd, borderRadius: 12, padding: 28,
          width: '92%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)', fontFamily: 'IBM Plex Sans, sans-serif',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: col }}>New MTO Register</div>
              <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>Step 1 of 2 — Details</div>
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: sub, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4 }}>MTO Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mechanical & Piping MTO" style={inp} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4 }}>Reference *</label>
              <input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. MTO-PIL-004" style={{ ...inp, fontFamily: 'JetBrains Mono, monospace' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4 }}>Revision</label>
              <input value={revision} onChange={e => setRevision(e.target.value.slice(0, 10))}
                placeholder="e.g. A, 1, 2A, R0" style={{ ...inp, borderColor: revisionFormatError(revision) ? '#ef4444' : (inp.borderColor as string) }} maxLength={10} />
              <div style={{ fontSize: 10, color: revisionFormatError(revision) ? '#ef4444' : sub, marginTop: 3 }}>
                {revisionFormatError(revision) || 'Letters, numbers or a mix.'}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4 }}>Owner</label>
              <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="e.g. Ben Smith" style={inp} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 12, color: sub, display: 'block', marginBottom: 4 }}>Description</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
                placeholder="Brief description of this MTO's scope"
                style={{ ...inp, resize: 'vertical' }} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <button onClick={onClose} style={{ background: 'transparent', border: bd, color: sub, padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button
              onClick={() => { if (lines.length === 1 && !lines[0].line_number) setLines([{ ...newRow(), line_number: 'L-001' }]); setStep(2) }}
              disabled={!name.trim() || !ref.trim() || !!revisionFormatError(revision)}
              style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: (!name.trim() || !ref.trim() || !!revisionFormatError(revision)) ? 0.5 : 1 }}>
              Next → Add lines
            </button>
          </div>
        </div>
      </div>
    )
    return createPortal(step1Body, document.body)
  }

  // ─── STEP 2: Full-screen line items editor ───────────────────────────────
  const rowBg  = (i: number) => i % 2 === 0 ? (dark ? '#1e293b' : '#fff') : (dark ? '#1a2640' : '#f8fafc')
  const cellPad: React.CSSProperties = { padding: '0 6px', verticalAlign: 'middle', height: 44 }
  const cellInp: React.CSSProperties = {
    height: 34, width: '100%', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box',
    background: dark ? '#0f172a' : '#fff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
    color: dark ? '#f1f5f9' : '#0f172a', padding: '0 8px', fontFamily: 'IBM Plex Sans, sans-serif',
  }
  const thStyle: React.CSSProperties = {
    padding: '0 6px', height: 40, textAlign: 'center', fontWeight: 700, fontSize: 11,
    color: dark ? '#94a3b8' : '#475569', whiteSpace: 'nowrap', userSelect: 'none',
    background: dark ? '#0f172a' : '#f1f5f9', letterSpacing: '0.06em', textTransform: 'uppercase',
    borderBottom: `2px solid ${dark ? '#334155' : '#e2e8f0'}`,
    position: 'sticky', top: 0, zIndex: 1,
  }

  const fullscreenBody = (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9100, overflowY: 'auto',
      background: dark ? '#0f172a' : '#f4f7fb', fontFamily: 'IBM Plex Sans, sans-serif',
      animation: 'fadeIn 150ms ease',
    }}>
      {/* ── Sticky header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, background: dark ? '#1e293b' : '#fff',
        borderBottom: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, padding: '12px 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>New MTO Register</div>
          <div style={{ fontSize: 12, color: sub, fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
            {ref} · Rev {revision} · Step 2 of 2 — Line Items
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setStep(1)}
            style={{ background: 'transparent', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, color: sub, padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            ← Back
          </button>
          <button onClick={onClose}
            style={{ background: 'transparent', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, color: sub, padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={!canCreate || saving}
            style={{ background: canCreate && !saving ? '#15803d' : '#94a3b8', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: canCreate ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600, minWidth: 140 }}>
            {saving ? 'Creating…' : '✓ Create MTO'}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 32px 100px' }}>

        {/* ── Metadata summary bar ── */}
        <div style={{
          background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
          borderRadius: 8, padding: '10px 18px', marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 13, color: sub, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: dark ? '#f1f5f9' : '#0f172a' }}>{ref}</span>
            <span>·</span><span>Rev {revision}</span>
            {owner && <><span>·</span><span>{owner}</span></>}
            {name && <><span>·</span><span style={{ color: dark ? '#f1f5f9' : '#0f172a', fontWeight: 500 }}>{name}</span></>}
          </div>
          <button onClick={() => setStep(1)}
            style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, cursor: 'pointer' }}>
            ← Edit details
          </button>
        </div>

        {/* ── Line items note ── */}
        <div style={{ fontSize: 12, color: sub, marginBottom: 10 }}>
          Line numbers auto-generate as L-001, L-002 etc. — you can edit them freely.
        </div>

        {/* ── Table ── */}
        <div style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 110 }} /> {/* LINE NUMBER */}
              <col style={{ width: 145 }} /> {/* WBS CODE */}
              <col />                         {/* DESCRIPTION (flex) */}
              <col style={{ width: 75 }} />  {/* QTY */}
              <col style={{ width: 80 }} />  {/* UOM */}
              <col style={{ width: 130 }} /> {/* ROS DATE */}
              <col style={{ width: 40 }} />  {/* × */}
            </colgroup>
            <thead>
              <tr>
                <th style={thStyle}>Line Number</th>
                <th style={thStyle}>WBS Code</th>
                <th style={{ ...thStyle }}><span style={{ color: '#ef4444' }}>*</span> Description</th>
                <th style={thStyle}>Qty</th>
                <th style={thStyle}>UOM</th>
                <th style={thStyle}>ROS Date</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={l.key} style={{ background: rowBg(idx), borderBottom: `1px solid ${dark ? '#1e2d4a' : '#f0f3f9'}` }}>
                  {/* LINE NUMBER */}
                  <td style={cellPad}>
                    <input value={l.line_number} onChange={e => updateLine(l.key,'line_number',e.target.value)}
                      placeholder={`L-${String(idx+1).padStart(3,'0')}`}
                      style={{ ...cellInp, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
                  </td>
                  {/* WBS CODE */}
                  <td style={cellPad}>
                    <select value={l.wbs_code} onChange={e => updateLine(l.key,'wbs_code',e.target.value)}
                      style={{ ...cellInp }}>
                      <option value="">— select</option>
                      {wbsNodes.map(w => <option key={w.id} value={w.code}>{w.code}</option>)}
                    </select>
                  </td>
                  {/* DESCRIPTION */}
                  <td style={cellPad}>
                    <input value={l.description} onChange={e => updateLine(l.key,'description',e.target.value)}
                      placeholder="Item description *"
                      style={{ ...cellInp, border: !l.description.trim() && lines.length > 1 ? '1px solid #fca5a5' : cellInp.border }} />
                  </td>
                  {/* QTY */}
                  <td style={cellPad}>
                    <input value={l.quantity} onChange={e => updateLine(l.key,'quantity',e.target.value)}
                      type="number" min="0" placeholder="0"
                      style={{ ...cellInp, fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }} />
                  </td>
                  {/* UOM */}
                  <td style={cellPad}>
                    <select value={l.uom} onChange={e => updateLine(l.key,'uom',e.target.value)} style={cellInp}>
                      {['EA','m','m2','m3','kg','t','LT','SET','LOT'].map(u => <option key={u}>{u}</option>)}
                    </select>
                  </td>
                  {/* ROS DATE */}
                  <td style={cellPad}>
                    <input value={l.ros_date} onChange={e => updateLine(l.key,'ros_date',e.target.value)}
                      type="date" style={{ ...cellInp, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
                  </td>
                  {/* DELETE */}
                  <td style={{ ...cellPad, textAlign: 'center' }}>
                    <button
                      onClick={() => lines.length > 1 && setLines(prev => prev.filter(r => r.key !== l.key))}
                      disabled={lines.length === 1}
                      style={{ background: 'none', border: 'none', cursor: lines.length > 1 ? 'pointer' : 'default', fontSize: 16, color: lines.length > 1 ? '#ef4444' : '#c4cedf', lineHeight: 1, padding: 0 }}
                      title={lines.length > 1 ? 'Remove line' : 'Cannot remove the only line'}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Below table ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <button onClick={addLine}
            style={{ background: 'transparent', border: `1px solid #2563eb`, color: '#2563eb', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
            + Add line
          </button>
          <span style={{ fontSize: 12, color: sub }}>{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* ── Sticky footer status bar ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10,
        background: dark ? '#1e293b' : '#fff', borderTop: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
        padding: '14px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
      }}>
        <div style={{ fontSize: 13, color: missingDesc > 0 ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>
          {missingDesc > 0
            ? `⚠ ${missingDesc} line${missingDesc > 1 ? 's' : ''} missing description`
            : `✓ ${lines.length} line${lines.length !== 1 ? 's' : ''} ready`}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setStep(1)}
            style={{ background: 'transparent', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, color: sub, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            ← Back
          </button>
          <button onClick={onClose}
            style={{ background: 'transparent', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, color: sub, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={handleCreate} disabled={!canCreate || saving}
            style={{ background: canCreate && !saving ? '#15803d' : '#94a3b8', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: canCreate ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 600, minWidth: 150 }}>
            {saving ? 'Creating…' : '✓ Create MTO'}
          </button>
        </div>
      </div>

      {/* ── Fade-in keyframe ── */}
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  )
  return createPortal(fullscreenBody, document.body)
}

// ─── PARSE RESULT TYPE ───────────────────────────────────────────────────────
interface ParseWarning { row: number; message: string; severity: 'warning' | 'error' }
interface ParseResult {
  // MTO header read from the file's "MTO Details" tab (any field may be null).
  mto?: { name: string | null; reference: string | null; revision: string | null; owner: string | null; description: string | null }
  linesFound: number
  linesValid: number
  linesSkipped: number
  warnings: ParseWarning[]
  hasErrors: boolean
  preview: Array<{ line_number: string; wbs_code: string | null; description: string; quantity: number | null; uom: string | null }>
}

// ─── UPLOAD NEW MTO MODAL ────────────────────────────────────────────────────
// 3-step wizard: metadata → upload file → preview & confirm
const UploadNewMTOModal = ({
  dark, projectId, onClose, load, downloadTemplate, addToast,
}: {
  dark: boolean
  projectId: number
  onClose: () => void
  load: () => void
  downloadTemplate: () => void
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void
}) => {
  const [step,         setStep]        = useState<1 | 2 | 3>(1)
  const [name,         setName]        = useState('')
  const [ref,          setRef]         = useState('')
  const [revision,     setRevision]    = useState('A')
  const [owner,        setOwner]       = useState('')
  const [notes,        setNotes]       = useState('')
  const [file,         setFile]        = useState<File | null>(null)
  const [fileKey,      setFileKey]     = useState(0)
  const [parseResult,  setParseResult] = useState<ParseResult | null>(null)
  const [creating,     setCreating]    = useState(false)
  const [parseError,   setParseError]  = useState('')
  const [parsePending, setParsePending] = useState(false)

  const bg  = dark ? '#0f172a' : '#fff'
  const bd  = `1px solid ${dark ? '#334155' : '#e2e8f0'}`
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = dark ? '#94a3b8' : '#64748b'
  const inp = { background: dark ? '#1e293b' : '#f8fafc', border: bd, color: col,
                borderRadius: 6, padding: '7px 10px', fontSize: 13,
                fontFamily: 'IBM Plex Sans, sans-serif', width: '100%', boxSizing: 'border-box' as const }


  const handleParseFile = async () => {
    if (!file) return
    setParsePending(true); setParseError('')
    try {
      const fd = new FormData(); fd.append('file', file)
      const { data } = await axios.post<ParseResult>(`${API}/mto/${projectId}/parse-file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      // Pull MTO header from the file's "MTO Details" tab — fill any field the
      // user left blank so the whole MTO can be defined in the spreadsheet.
      if (data.mto) {
        if (data.mto.name && !name.trim())        setName(data.mto.name)
        if (data.mto.reference && !ref.trim())    setRef(data.mto.reference)
        if (data.mto.revision)                    setRevision(data.mto.revision.slice(0, 10))
        if (data.mto.owner && !owner.trim())      setOwner(data.mto.owner)
        if (data.mto.description && !notes.trim()) setNotes(data.mto.description)
      }
      setParseResult(data); setStep(3)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setParseError(err.response?.data?.error ?? 'Failed to parse file')
    } finally { setParsePending(false) }
  }

  const handleCreate = async () => {
    if (!parseResult || parseResult.hasErrors) return
    setCreating(true)
    try {
      // Step 1: create MTO record
      const { data: newMto } = await axios.post(`${API}/mto/${projectId}`, { name, reference: ref, current_revision: revision, owner, description: notes })
      // Step 2: upload file to create lines
      const fd2 = new FormData(); fd2.append('file', file!); fd2.append('revision', revision); fd2.append('notes', notes)
      await axios.post(`${API}/mto/${projectId}/${newMto.id}/upload`, fd2, { headers: { 'Content-Type': 'multipart/form-data' } })
      addToast('success', `${ref} created — ${parseResult.linesValid} lines imported`)
      onClose(); load()
    } catch (e: unknown) {
      // Proposer: the register create is gated — stage it for confirmation. (The
      // file's lines import only after the register exists, i.e. post-approval.)
      if (isApprovalRequired(e)) {
        try {
          const r = await submitForApproval(projectId, 'mto', 'create',
            { name, reference: ref, current_revision: revision, owner, description: notes })
          addToast('success', approvalToast(r))
          onClose(); load()
        } catch (se: unknown) {
          const serr = se as { response?: { data?: { error?: string } } }
          addToast('error', serr.response?.data?.error ?? 'Could not submit to approval queue')
        }
        setCreating(false)
        return
      }
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Failed to create MTO')
      setCreating(false)
    }
  }

  const errorWarnings   = parseResult?.warnings.filter(w => w.severity === 'error')   ?? []
  const generalWarnings = parseResult?.warnings.filter(w => w.severity === 'warning') ?? []

  const createBtnLabel = parseResult?.hasErrors
    ? 'Resolve errors first'
    : (parseResult?.warnings.length ?? 0) > 0
      ? '⚠ Import with warnings'
      : '✓ Create MTO'

  const body = (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: bg, border: bd, borderRadius: 12, padding: 28,
        width: '90%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: col, fontFamily: 'IBM Plex Sans, sans-serif' }}>Upload MTO</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2, fontFamily: 'IBM Plex Sans, sans-serif' }}>Step {step} of 3</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: sub, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* ─── STEP 1: Metadata ─── */}
        {step === 1 && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>MTO Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mechanical & Piping MTO" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>Reference *</label>
                <input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. MTO-PIL-004" style={{ ...inp, fontFamily: 'JetBrains Mono, monospace' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>Revision</label>
                <input value={revision} onChange={e => setRevision(e.target.value.slice(0, 10))}
                  placeholder="e.g. A, 1, 2A, R0" style={inp} maxLength={10} />
                <div style={{ fontSize: 10, color: sub, marginTop: 3 }}>Letters, numbers or a mix.</div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>Owner</label>
                <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="e.g. Ben Smith" style={inp} />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  placeholder="Brief description of this MTO's scope"
                  style={{ ...inp, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <button onClick={onClose} style={{ background: 'transparent', border: bd, color: sub, padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>Cancel</button>
              <button
                onClick={() => setStep(2)}
                disabled={!name.trim() || !ref.trim()}
                style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif', opacity: (!name.trim() || !ref.trim()) ? 0.5 : 1 }}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 2: Upload File ─── */}
        {step === 2 && (
          <div>
            <div style={{ fontSize: 13, color: sub, marginBottom: 6, fontFamily: 'IBM Plex Sans, sans-serif' }}>
              Upload your MTO as XLSX or CSV. Column headers must match the template.
            </div>
            <div style={{ marginBottom: 16 }}>
              <button onClick={downloadTemplate} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'IBM Plex Sans, sans-serif', textDecoration: 'underline' }}>
                ↓ Download template
              </button>
            </div>

            <div
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#2563eb' }}
              onDragLeave={e => { e.currentTarget.style.borderColor = dark ? '#334155' : '#dde3ed' }}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setFile(f); setParseResult(null); setParseError('') }; e.currentTarget.style.borderColor = dark ? '#334155' : '#dde3ed' }}
              onClick={() => document.getElementById('mto-upload-input')?.click()}
              style={{ border: `2px dashed ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 8, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 150ms', marginBottom: 12 }}>
              {file ? (
                <div style={{ fontSize: 13, color: '#22c55e' }}>✓ {file.name} · {(file.size/1024).toFixed(0)} KB</div>
              ) : (
                <div style={{ fontSize: 13, color: '#94a3b8' }}>Drop XLSX or CSV here, or click to browse</div>
              )}
            </div>
            <input id="mto-upload-input" type="file" accept=".xlsx,.csv" style={{ display: 'none' }} key={fileKey} onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setParseResult(null); setParseError('') } }} />

            {parseError && (
              <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: 12, marginBottom: 12 }}>
                {parseError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <button onClick={() => setStep(1)} style={{ background: 'transparent', border: bd, color: sub, padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>← Back</button>
              <button
                onClick={handleParseFile}
                disabled={!file || parsePending}
                style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: (!file || parsePending) ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif', opacity: (!file || parsePending) ? 0.5 : 1 }}>
                {parsePending ? 'Checking file…' : 'Preview file →'}
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 3: Preview & Confirm ─── */}
        {step === 3 && parseResult && (
          <div>
            {/* Stat chips */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Lines found', val: parseResult.linesFound, color: col },
                { label: 'Valid',       val: parseResult.linesValid, color: '#22c55e' },
                { label: 'Skipped',     val: parseResult.linesSkipped, color: sub },
                { label: 'Warnings',    val: parseResult.warnings.length, color: parseResult.warnings.length > 0 ? '#d97706' : sub },
              ].map(c => (
                <div key={c.label} style={{ padding: '8px 14px', borderRadius: 8, background: dark ? '#1e293b' : '#f4f7fb', border: bd }}>
                  <div style={{ fontSize: 10, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{c.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: c.color }}>{c.val}</div>
                </div>
              ))}
            </div>

            {/* Error banner */}
            {parseResult.hasErrors && (
              <div style={{ padding: '10px 14px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#ef4444', marginBottom: 6 }}>⚠ {errorWarnings.length} error{errorWarnings.length !== 1 ? 's' : ''} found — cannot import until resolved.</div>
                {errorWarnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#ef4444', marginBottom: 2 }}>Row {w.row}: {w.message}</div>
                ))}
              </div>
            )}

            {/* Warning section */}
            {!parseResult.hasErrors && generalWarnings.length > 0 && (
              <div style={{ padding: '10px 14px', borderRadius: 6, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#d97706', marginBottom: 4 }}>{generalWarnings.length} warning{generalWarnings.length !== 1 ? 's' : ''}</div>
                {generalWarnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#d97706', marginBottom: 2 }}>Row {w.row}: {w.message}</div>
                ))}
              </div>
            )}

            {/* Success banner */}
            {!parseResult.hasErrors && generalWarnings.length === 0 && (
              <div style={{ padding: '10px 14px', borderRadius: 6, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#22c55e' }}>✓ {parseResult.linesValid} lines ready to import</div>
              </div>
            )}

            {/* Preview table */}
            <div style={{ overflowX: 'auto', marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: dark ? '#1e293b' : '#f1f5f9', borderBottom: bd }}>
                    {['LINE','WBS','DESCRIPTION','QTY','UOM'].map(h => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: 'center', color: sub, fontFamily: 'IBM Plex Sans, sans-serif', fontWeight: 600, fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parseResult.preview.slice(0, 10).map((r, i) => (
                    <tr key={i} style={{ borderBottom: bd }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{r.line_number}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{r.wbs_code ?? '—'}</td>
                      <td style={{ padding: '6px 8px', fontSize: 12, color: col, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{r.quantity ?? '—'}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11, color: sub }}>{r.uom ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parseResult.linesValid > 10 && (
                <div style={{ fontSize: 12, color: sub, padding: '6px 8px', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                  …and {parseResult.linesValid - 10} more lines
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => setStep(2)} style={{ background: 'transparent', border: bd, color: sub, padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>← Back</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onClose} style={{ background: 'transparent', border: bd, color: sub, padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>Cancel</button>
                <button
                  onClick={handleCreate}
                  disabled={parseResult.hasErrors || creating}
                  style={{ background: parseResult.hasErrors ? '#94a3b8' : '#15803d', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: (parseResult.hasErrors || creating) ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif', opacity: (parseResult.hasErrors || creating) ? 0.6 : 1 }}>
                  {creating ? 'Creating…' : createBtnLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
  return createPortal(body, document.body)
}

// ─── INNER COMPONENT ─────────────────────────────────────────────────────────
// Requires ToastProvider wrapper.
const MTOListInner = ({
  dark, projectId, projectName, onBack, onViewMTO,
}: {
  dark: boolean
  projectId: number
  projectName: string
  onBack: () => void
  onViewMTO: (id: number) => void
}) => {
  const { addToast } = useToast()
  const [mtos,          setMtos]          = useState<MTORegister[]>([])
  const [loading,       setLoading]       = useState(true)
  const [showNew,       setShowNew]       = useState(false)
  const [showUploadMTO, setShowUploadMTO] = useState(false)
  const [wbsNodes,      setWbsNodes]      = useState<WBSNode[]>([])

  const col  = dark ? '#f1f5f9' : '#0f172a'
  const sub  = dark ? '#94a3b8' : '#64748b'
  const bg   = dark ? '#0f172a' : '#f8fafc'
  const card = dark ? '#111827' : '#fff'
  const bd   = `1px solid ${dark ? '#1e293b' : '#e2e8f0'}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get<MTORegister[]>(`${API}/mto/${projectId}`)
      setMtos(data)
    } catch {
      addToast('error', 'Failed to load MTO registers')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  // Load WBS nodes for the new-MTO wizard
  useEffect(() => {
    axios.get<WBSNode[]>(`${API}/foundational/${projectId}/wbs`)
      .then(r => setWbsNodes(r.data))
      .catch(() => {})
  }, [projectId])

  // ─── TEMPLATE DOWNLOAD ────────────────────────────────────────────────────
  const downloadTemplate = async () => {
    try {
      const res = await axios.get(`${API}/mto/${projectId}/template`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url; a.download = 'QCO_MTO_Template.xlsx'; a.click()
      window.URL.revokeObjectURL(url)
    } catch { addToast('error', 'Template download failed') }
  }

  const rt = useResizableTable('mto_register', MTO_REG_W, MTO_REG_MIN)
  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'center', fontSize: 11,
    fontWeight: 700, color: sub, fontFamily: 'IBM Plex Sans, sans-serif',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    position: 'sticky', top: 0, background: dark ? '#111827' : '#fff', zIndex: 2,
    borderBottom: bd,
  }

  return (
    <div style={{ background: bg, minHeight: '100%', padding: '24px 28px', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* ─── BACK ───────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <BackButton onFallback={onBack} dark={dark} />
      </div>

      {/* ─── PAGE HEADER ────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>📋 MTO Register</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: sub }}>Material Take-Off documents for {projectName}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <HelpButton screenName="MTO Register" sections={MTO_REGISTER_HELP} dark={dark} />
          <button onClick={downloadTemplate} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>↓ Template</button>
          <button onClick={() => setShowUploadMTO(true)} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>↑ Upload MTO</button>
          <button
            onClick={() => setShowNew(true)}
            style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            + New MTO
          </button>
          <ResetColumnsButton onClick={rt.resetWidths} dark={dark} />
        </div>
      </div>

      {/* ─── TABLE ──────────────────────────────────────── */}
      <div style={{ background: card, border: bd, borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: sub, fontSize: 13 }}>Loading…</div>
        ) : mtos.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: sub, fontSize: 13 }}>
            No MTOs found. Click <strong>+ New MTO</strong> to create one.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
            <table className="app-grid" style={{ ...rt.tableStyle, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...rt.thStyle(0), ...thStyle }}>MTO / Reference{rt.handle(0, dark)}</th>
                  <th style={{ ...rt.thStyle(1), ...thStyle }}>Latest Rev{rt.handle(1, dark)}</th>
                  <th style={{ ...rt.thStyle(2), ...thStyle }}>Lines{rt.handle(2, dark)}</th>
                  <th style={{ ...rt.thStyle(3), ...thStyle }}>Last Updated{rt.handle(3, dark)}</th>
                  <th style={{ ...rt.thStyle(4), ...thStyle }}>Owner{rt.handle(4, dark)}</th>
                  <th style={{ ...rt.thStyle(5), ...thStyle }}>Status{rt.handle(5, dark)}</th>
                  <th style={{ ...rt.thStyle(6), ...thStyle, textAlign: 'center' }}>View</th>
                </tr>
              </thead>
              <tbody>
                {mtos.map((m, i) => {
                  const superseded = m.status === 'superseded'
                  const tdStyle: React.CSSProperties = {
                    padding: '12px 14px', borderBottom: bd,
                    opacity: superseded ? 0.5 : 1,
                    fontSize: 13, color: col,
                  }
                  return (
                    <tr key={m.id}
                      style={{ background: i % 2 === 0 ? 'transparent' : (dark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.015)') }}>
                      <td data-align="left" style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: sub, fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>{m.reference}</div>
                      </td>
                      <td data-col="ctr" style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14 }}>
                        Rev {m.current_revision}
                      </td>
                      <td data-col="lmid40" style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace' }}>{m.line_count}</td>
                      <td data-col="ctr" style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{fmtDate(m.updated_at)}</td>
                      <td data-col="lmid" style={tdStyle}>{m.owner ?? '—'}</td>
                      <td data-align="center" data-col="status" style={tdStyle}><StatusPill s={m.status} /></td>
                      <td data-col="ctr" style={{ ...tdStyle, textAlign: 'center' }}>
                        {!superseded && (
                          <button
                            onClick={() => onViewMTO(m.id)}
                            style={{ background: 'rgba(37,99,235,0.1)', color: '#2563eb', border: '1px solid rgba(37,99,235,0.25)', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif' }}>
                            View →
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <MilestoneLegend dark={dark} />
      </div>

      {/* ─── MODALS ─────────────────────────────────────── */}
      {showNew && (
        <NewMTOModal
          dark={dark}
          projectId={projectId}
          wbsNodes={wbsNodes}
          onClose={() => setShowNew(false)}
          onCreated={mto => { setShowNew(false); load(); onViewMTO(mto.id) }}
        />
      )}

      {showUploadMTO && (
        <UploadNewMTOModal
          dark={dark}
          projectId={projectId}
          onClose={() => setShowUploadMTO(false)}
          load={load}
          downloadTemplate={downloadTemplate}
          addToast={addToast}
        />
      )}

      <ToastContainer />
    </div>
  )
}

// ─── EXPORTED COMPONENT (wraps with ToastProvider) ───────────────────────────
export const MTOListScreen = (props: {
  dark: boolean
  projectId: number
  projectName: string
  onBack: () => void
  onViewMTO: (id: number) => void
}) => (
  <ToastProvider>
    <MTOListInner {...props} />
  </ToastProvider>
)
