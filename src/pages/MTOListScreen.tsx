// ─── MTO LIST SCREEN ─────────────────────────────────────────────────────────
// Shows all MTO registers for the selected project. Active MTOs are clickable;
// superseded MTOs are shown at reduced opacity with a "Superseded" pill.
// New MTO wizard supports manual entry (3 steps) and file upload.
import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import { HelpButton } from '../components/HelpDrawer'
import { MTO_REGISTER_HELP } from '../helpContent'
import { BackButton } from '../components/BackButton'

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
  inspection_class: string
  vdrl_required: boolean
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmtDate(s: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
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
  inspection_class: 'Class II',
  vdrl_required: false,
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
// 3-step wizard: method choice → metadata form → lines (manual) or upload
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
  const [step, setStep]     = useState<1 | 2 | 3>(1)
  const [method, setMethod] = useState<'manual' | 'upload' | null>(null)

  // Form fields
  const [name,     setName]     = useState('')
  const [ref,      setRef]      = useState('')
  const [revision, setRevision] = useState('A')
  const [owner,    setOwner]    = useState('')
  const [desc,     setDesc]     = useState('')
  const [file,     setFile]     = useState<File | null>(null)

  // Lines (manual step 3)
  const [lines, setLines] = useState<NewLineRow[]>([newRow()])

  const [saving, setSaving] = useState(false)

  const bg   = dark ? '#0f172a' : '#fff'
  const bd   = `1px solid ${dark ? '#334155' : '#e2e8f0'}`
  const col  = dark ? '#f1f5f9' : '#0f172a'
  const sub  = dark ? '#94a3b8' : '#64748b'
  const inp  = { background: dark ? '#1e293b' : '#f8fafc', border: bd, color: col,
                 borderRadius: 6, padding: '7px 10px', fontSize: 13,
                 fontFamily: 'IBM Plex Sans, sans-serif', width: '100%', boxSizing: 'border-box' as const }

  const canCreate = name.trim() && ref.trim() &&
    (method === 'upload' ? !!file : lines.some(l => l.description.trim()))

  async function handleCreate() {
    setSaving(true)
    try {
      // 1. Create register
      const { data: mto } = await axios.post<MTORegister>(
        `${API}/mto/${projectId}`,
        { name, reference: ref, current_revision: revision, owner: owner || null, description: desc || null }
      )

      if (method === 'manual') {
        // 2. Post each line
        for (const l of lines.filter(r => r.description.trim())) {
          await axios.post(`${API}/mto/${projectId}/${mto.id}/lines`, {
            line_number:      l.line_number  || `L-${String(lines.indexOf(l)+1).padStart(3,'0')}`,
            wbs_code:         l.wbs_code     || null,
            description:      l.description,
            quantity:         l.quantity     ? parseFloat(l.quantity) : null,
            uom:              l.uom          || null,
            ros_date:         l.ros_date     || null,
            inspection_class: l.inspection_class,
            vdrl_required:    l.vdrl_required ? 1 : 0,
          })
        }
      } else if (method === 'upload' && file) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('revision', revision)
        fd.append('notes', `Initial upload Rev ${revision}`)
        await axios.post(`${API}/mto/${projectId}/${mto.id}/upload`, fd)
      }

      addToast('success', `${mto.reference} created`)
      onCreated(mto)
    } catch (e: any) {
      addToast('error', e.response?.data?.error ?? 'Failed to create MTO')
    } finally {
      setSaving(false)
    }
  }

  function updateLine(key: string, field: keyof NewLineRow, value: string | boolean) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l))
  }

  const revOptions = ['A','B','C','D','E','F']

  const body = (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: bg, border: bd, borderRadius: 12, padding: 28,
        width: '90%', maxWidth: 780, maxHeight: '88vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: col, fontFamily: 'IBM Plex Sans, sans-serif' }}>
              New MTO Register
            </div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2, fontFamily: 'IBM Plex Sans, sans-serif' }}>
              Step {step} of {method === 'manual' ? 3 : 2}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: sub, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* ─── STEP 1: Choose method ─── */}
        {step === 1 && (
          <div>
            <div style={{ fontSize: 13, color: sub, marginBottom: 16, fontFamily: 'IBM Plex Sans, sans-serif' }}>
              How would you like to create this MTO?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {([
                ['manual', '✏️', 'Create manually', 'Enter line items directly in the form.'],
                ['upload', '📤', 'Upload file', 'Import lines from an XLSX or CSV file.'],
              ] as const).map(([m, icon, title, sub2]) => (
                <div key={m} onClick={() => { setMethod(m); setStep(2) }} style={{
                  border: `2px solid ${method === m ? '#2563eb' : (dark ? '#334155' : '#e2e8f0')}`,
                  borderRadius: 10, padding: 20, cursor: 'pointer', textAlign: 'center',
                  background: method === m ? 'rgba(37,99,235,0.07)' : (dark ? '#1e293b' : '#f8fafc'),
                  transition: 'border-color 0.15s',
                }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: col, fontFamily: 'IBM Plex Sans, sans-serif', marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif' }}>{sub2}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── STEP 2: Metadata form ─── */}
        {step === 2 && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              {/* Name */}
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>MTO Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mechanical & Piping MTO" style={inp} />
              </div>
              {/* Reference */}
              <div>
                <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>Reference *</label>
                <input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. MTO-PIL-004" style={{ ...inp, fontFamily: 'JetBrains Mono, monospace' }} />
              </div>
              {/* Revision */}
              <div>
                <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>Revision</label>
                <select value={revision} onChange={e => setRevision(e.target.value)} style={inp}>
                  {revOptions.map(r => <option key={r} value={r}>Rev {r}</option>)}
                </select>
              </div>
              {/* Owner */}
              <div>
                <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>Owner</label>
                <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="e.g. Ben Smith" style={inp} />
              </div>
              {/* Description */}
              <div style={{ gridColumn: '1/-1' }}>
                <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
                  placeholder="Brief description of this MTO's scope"
                  style={{ ...inp, resize: 'vertical' }} />
              </div>

              {/* Upload zone (upload method only) */}
              {method === 'upload' && (
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: 12, color: sub, fontFamily: 'IBM Plex Sans, sans-serif', display: 'block', marginBottom: 4 }}>Upload File *</label>
                  <div style={{
                    border: `2px dashed ${file ? '#2563eb' : (dark ? '#334155' : '#e2e8f0')}`,
                    borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer',
                    background: dark ? '#1e293b' : '#f8fafc',
                  }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
                    onClick={() => { const i = document.createElement('input'); i.type='file'; i.accept='.xlsx,.csv'; i.onchange=()=>{if(i.files?.[0]) setFile(i.files[0])}; i.click() }}>
                    {file
                      ? <span style={{ color: '#2563eb', fontWeight: 600, fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>📎 {file.name}</span>
                      : <span style={{ color: sub, fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>Drop an XLSX or CSV file here, or click to browse</span>}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <button onClick={() => setStep(1)} style={{ background: 'transparent', border: bd, color: sub, padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>← Back</button>
              <button
                onClick={() => method === 'manual' ? setStep(3) : (canCreate && handleCreate())}
                disabled={!name.trim() || !ref.trim() || saving}
                style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif', opacity: (!name.trim() || !ref.trim() || saving) ? 0.5 : 1 }}>
                {method === 'manual' ? 'Next: Add Lines →' : (saving ? 'Creating…' : '✓ Create MTO')}
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 3: Lines (manual) ─── */}
        {step === 3 && method === 'manual' && (
          <div>
            <div style={{ fontSize: 13, color: sub, marginBottom: 12, fontFamily: 'IBM Plex Sans, sans-serif' }}>
              Add line items for <strong style={{ color: col }}>{ref} Rev {revision}</strong>
            </div>

            {/* Lines table */}
            <div style={{ overflowX: 'auto', marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: dark ? '#1e293b' : '#f1f5f9', borderBottom: bd }}>
                    {['#','WBS','Description *','Qty','UOM','ROS','Insp','VDRL',''].map((h,i) => (
                      <th key={i} style={{ padding: '6px 8px', textAlign: 'left', color: sub, fontFamily: 'IBM Plex Sans, sans-serif', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={l.key} style={{ borderBottom: bd }}>
                      {/* # */}
                      <td style={{ padding: '4px 8px', color: sub, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, whiteSpace: 'nowrap' }}>
                        <input value={l.line_number} onChange={e => updateLine(l.key,'line_number',e.target.value)}
                          placeholder={`L-${String(idx+1).padStart(3,'0')}`}
                          style={{ width: 64, ...inp, padding: '4px 6px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} />
                      </td>
                      {/* WBS */}
                      <td style={{ padding: '4px 8px' }}>
                        <select value={l.wbs_code} onChange={e => updateLine(l.key,'wbs_code',e.target.value)}
                          style={{ ...inp, padding: '4px 6px', fontSize: 11, width: 120 }}>
                          <option value="">—</option>
                          {wbsNodes.map(w => <option key={w.id} value={w.code}>{w.code}</option>)}
                        </select>
                      </td>
                      {/* Description */}
                      <td style={{ padding: '4px 8px', minWidth: 200 }}>
                        <input value={l.description} onChange={e => updateLine(l.key,'description',e.target.value)}
                          placeholder="Description *"
                          style={{ ...inp, padding: '4px 6px', fontSize: 11, width: '100%' }} />
                      </td>
                      {/* Qty */}
                      <td style={{ padding: '4px 8px' }}>
                        <input value={l.quantity} onChange={e => updateLine(l.key,'quantity',e.target.value)}
                          type="number" min="0" style={{ ...inp, padding: '4px 6px', fontSize: 11, width: 70, fontFamily: 'JetBrains Mono, monospace' }} />
                      </td>
                      {/* UOM */}
                      <td style={{ padding: '4px 8px' }}>
                        <select value={l.uom} onChange={e => updateLine(l.key,'uom',e.target.value)}
                          style={{ ...inp, padding: '4px 6px', fontSize: 11, width: 64 }}>
                          {['EA','m','m2','m3','kg','t','LS'].map(u => <option key={u}>{u}</option>)}
                        </select>
                      </td>
                      {/* ROS */}
                      <td style={{ padding: '4px 8px' }}>
                        <input value={l.ros_date} onChange={e => updateLine(l.key,'ros_date',e.target.value)}
                          type="date" style={{ ...inp, padding: '4px 6px', fontSize: 11, width: 130, fontFamily: 'JetBrains Mono, monospace' }} />
                      </td>
                      {/* Insp */}
                      <td style={{ padding: '4px 8px' }}>
                        <select value={l.inspection_class} onChange={e => updateLine(l.key,'inspection_class',e.target.value)}
                          style={{ ...inp, padding: '4px 6px', fontSize: 11, width: 90 }}>
                          {['Class I','Class II','Class III'].map(c => <option key={c}>{c}</option>)}
                        </select>
                      </td>
                      {/* VDRL */}
                      <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                        <input type="checkbox" checked={l.vdrl_required}
                          onChange={e => updateLine(l.key,'vdrl_required',e.target.checked)} />
                      </td>
                      {/* Delete */}
                      <td style={{ padding: '4px 8px' }}>
                        <button onClick={() => setLines(prev => prev.filter(r => r.key !== l.key))}
                          style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
                          title="Remove line">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={() => setLines(prev => [...prev, newRow()])}
              style={{ background: 'transparent', border: bd, color: '#2563eb', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'IBM Plex Sans, sans-serif', marginBottom: 16 }}>
              + Add line
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => setStep(2)} style={{ background: 'transparent', border: bd, color: sub, padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif' }}>← Back</button>
              <button
                onClick={handleCreate}
                disabled={!canCreate || saving}
                style={{ background: '#15803d', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif', opacity: (!canCreate || saving) ? 0.5 : 1 }}>
                {saving ? 'Creating…' : '✓ Create MTO'}
              </button>
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
  const [mtos,       setMtos]       = useState<MTORegister[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showNew,    setShowNew]    = useState(false)
  const [wbsNodes,   setWbsNodes]   = useState<WBSNode[]>([])

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

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11,
    fontWeight: 700, color: sub, fontFamily: 'IBM Plex Sans, sans-serif',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    position: 'sticky', top: 0, background: dark ? '#111827' : '#fff', zIndex: 2,
    borderBottom: bd,
  }

  return (
    <div style={{ background: bg, minHeight: '100%', padding: '24px 28px', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* ─── BREADCRUMB ─────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <BackButton onFallback={onBack} dark={dark} />
        <span style={{ fontSize: 13, color: sub }}>
          Dashboard › <span style={{ color: col }}>{projectName}</span> › MTO Register
        </span>
      </div>

      {/* ─── PAGE HEADER ────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>📋 MTO Register</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: sub }}>Material Take-Off documents for {projectName}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <HelpButton screenName="MTO Register" sections={MTO_REGISTER_HELP} dark={dark} />
          <button
            onClick={() => setShowNew(true)}
            style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            + New MTO
          </button>
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
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>MTO / Reference</th>
                  <th style={thStyle}>Latest Rev</th>
                  <th style={thStyle}>Lines</th>
                  <th style={thStyle}>Last Updated</th>
                  <th style={thStyle}>Owner</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>View</th>
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
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: sub, fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>{m.reference}</div>
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 14 }}>
                        Rev {m.current_revision}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace' }}>{m.line_count}</td>
                      <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{fmtDate(m.updated_at)}</td>
                      <td style={tdStyle}>{m.owner ?? '—'}</td>
                      <td style={tdStyle}><StatusPill s={m.status} /></td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
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
