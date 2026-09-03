// ─── PRE-AWARD · INVITATION TAB ─────────────────────────────
// Phase 3.1c. Three inner sub-tabs: Evaluation Criteria (3.1c-1, here),
// Documents (3.1c-2) and Clarifications (3.1c-3) — the latter two are
// placeholders until their sub-steps.
//
// Criteria endpoints (Phase 2.3):
//   GET    /:projectId/tenders/:id/criteria           (can_view)
//   PUT    /:projectId/tenders/:id/criteria/:key       (can_edit)  upsert, weight 5–60, 409 if locked
//   DELETE /:projectId/tenders/:id/criteria/:key       (can_edit)  409 if locked
//   POST   /:projectId/tenders/:id/lock-criteria        (can_approve) SUM(weight)===100 exact
import { useEffect, useState, useCallback, useRef } from 'react'
import axios from 'axios'
import { API } from '../lib/api'

const CAN_EDIT    = ['admin', 'procurement_manager', 'procurement_officer', 'project_manager']  // can_edit
const CAN_APPROVE = ['admin', 'procurement_manager', 'procurement_officer', 'project_director']  // can_approve
const CMIN = 5, CMAX = 60

interface Crit { key: string; label: string; weight: number; mandatory: boolean; min_score: number | null }

// Wireframe rebalance model (Phase 2.3), ported verbatim with fixed 5–60 bounds:
// dragging one criterion redistributes the remainder across the others (clamped),
// rounds, then corrects integer drift so the set always sums to 100 when feasible.
function rebalance(crit: Crit[], changedKey: string, rawVal: number): Crit[] {
  const arr = crit.map(c => ({ ...c }))
  const ci = arr.findIndex(c => c.key === changedKey)
  if (ci < 0) return arr
  arr[ci].weight = Math.max(CMIN, Math.min(CMAX, Math.round(Number(rawVal) || 0)))
  let budget = 100 - arr[ci].weight
  let free = arr.filter((_, i) => i !== ci)
  let guard = 0
  while (free.length && guard++ < 12) {
    const freeSum = free.reduce((s, c) => s + c.weight, 0) || free.length
    let clamped = false
    for (const c of free.slice()) {
      const share = budget * (c.weight / freeSum)
      if (share <= CMIN)      { c.weight = CMIN; budget -= CMIN; free = free.filter(x => x !== c); clamped = true }
      else if (share >= CMAX) { c.weight = CMAX; budget -= CMAX; free = free.filter(x => x !== c); clamped = true }
    }
    if (!clamped) { const fsum = free.reduce((s, c) => s + c.weight, 0) || free.length; for (const c of free) c.weight = budget * (c.weight / fsum); break }
  }
  arr.forEach(c => c.weight = Math.round(c.weight))
  let drift = 100 - arr.reduce((s, c) => s + c.weight, 0)
  if (drift !== 0) {
    const others = arr.filter((_, i) => i !== ci).sort((a, b) => b.weight - a.weight)
    for (const c of others) { const nv = c.weight + drift; if (nv >= CMIN && nv <= CMAX) { c.weight = nv; drift = 0; break } }
    if (drift !== 0) { const nv = arr[ci].weight + drift; if (nv >= CMIN && nv <= CMAX) arr[ci].weight = nv }
  }
  return arr
}

const slugKey = (label: string, taken: Set<string>) => {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'crit'
  let key = base, n = 2
  while (taken.has(key)) { key = `${base}_${n++}`.slice(0, 30) }
  return key
}

export function PreAwardInvitationTab({ dark, projectId, tenderId, userRole, userId }: {
  dark: boolean; projectId: number; tenderId: number; userRole: string; userId: number
}) {
  const [sub, setSub] = useState<'criteria' | 'documents' | 'clarifications'>('criteria')
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub2 = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['criteria', 'documents', 'clarifications'] as const).map(s => {
          const active = sub === s
          const label = s === 'criteria' ? 'Evaluation Criteria' : s === 'documents' ? 'Documents' : 'Clarifications'
          return (
            <button key={s} onClick={() => setSub(s)}
              style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${active ? '#2563eb' : (dark ? '#334155' : '#dde3ed')}`, background: active ? '#2563eb' : 'none', color: active ? '#fff' : sub2, fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
              {label}
            </button>
          )
        })}
      </div>

      {sub === 'criteria'
        ? <CriteriaSection dark={dark} projectId={projectId} tenderId={tenderId} userRole={userRole} userId={userId} />
        : sub === 'documents'
        ? <DocumentsSection dark={dark} projectId={projectId} tenderId={tenderId} userRole={userRole} userId={userId} />
        : (
          <div style={{ padding: '32px 18px', border: bd, borderRadius: 8, background: dark ? '#0f172a' : '#fff', color: sub2, fontSize: 13, textAlign: 'center' }}>
            <div style={{ fontWeight: 600, color: col, marginBottom: 6 }}>Clarifications</div>
            This section is built in an upcoming sub-step (3.1c-3).
          </div>
        )}
    </div>
  )
}

// ─── EVALUATION CRITERIA ────────────────────────────────────
function CriteriaSection({ dark, projectId, tenderId, userRole, userId }: {
  dark: boolean; projectId: number; tenderId: number; userRole: string; userId: number
}) {
  const [crit, setCrit] = useState<Crit[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [locked, setLocked] = useState(false)
  const [lockedAt, setLockedAt] = useState<string | null>(null)
  const [lockedBy, setLockedBy] = useState<number | null>(null)
  const [lockErr, setLockErr] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const critRef = useRef<Crit[]>([])
  critRef.current = crit

  const canEdit = CAN_EDIT.includes(userRole)
  const canApprove = CAN_APPROVE.includes(userRole)
  const editable = canEdit && !locked

  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const rowBd = `1px solid ${dark ? '#1e293b' : '#eef2f7'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const inp: React.CSSProperties = { height: 30, padding: '0 8px', borderRadius: 6, border: bd, background: dark ? '#0b1220' : '#f8fafc', color: col, fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data } = await axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/criteria`)
      setCrit((data.criteria ?? []).map((c: { criterion_key: string; label: string; weight: number; mandatory: number; min_score: number | null }) => ({
        key: c.criterion_key, label: c.label, weight: Number(c.weight), mandatory: !!c.mandatory, min_score: c.min_score == null ? null : Number(c.min_score),
      })))
      setLocked(!!data.locked); setLockedAt(data.criteria_locked_at ?? null); setLockedBy(data.criteria_locked_by ?? null)
    } catch {
      setErr('Could not load criteria.')
    } finally { setLoading(false) }
  }, [projectId, tenderId])
  useEffect(() => { load() }, [load])

  const total = crit.reduce((s, c) => s + c.weight, 0)

  const putOne = (c: Crit, order: number) => axios.put(`${API}/pre-award/${projectId}/tenders/${tenderId}/criteria/${c.key}`,
    { label: c.label, weight: c.weight, mandatory: c.mandatory ? 1 : 0, min_score: c.min_score, display_order: order })
  const persistAll = async (list: Crit[]) => { try { await Promise.all(list.map((c, i) => putOne(c, i))) } catch { /* surfaced on next action */ } }

  const onSlide = (key: string, val: number) => setCrit(prev => rebalance(prev, key, val))
  const commit = () => { if (editable) persistAll(critRef.current) }

  const setField = async (key: string, patch: Partial<Crit>) => {
    const next = crit.map(c => c.key === key ? { ...c, ...patch } : c)
    setCrit(next)
    const changed = next.find(c => c.key === key)!
    try { await putOne(changed, next.findIndex(c => c.key === key)) } catch { load() }
  }

  const addCriterion = async () => {
    const label = newLabel.trim(); if (!label) return
    setBusy(true)
    const taken = new Set(crit.map(c => c.key))
    const key = slugKey(label, taken)
    const seeded = [...crit, { key, label, weight: CMIN, mandatory: false, min_score: null }]
    const balanced = rebalance(seeded, key, Math.max(CMIN, Math.round(100 / seeded.length)))
    setCrit(balanced); setNewLabel('')
    await persistAll(balanced)
    setBusy(false)
  }

  const del = async (key: string) => {
    setBusy(true)
    try { await axios.delete(`${API}/pre-award/${projectId}/tenders/${tenderId}/criteria/${key}`); await load() }
    catch (e) { alert(axios.isAxiosError(e) && e.response?.data?.error ? e.response.data.error : 'Could not delete criterion.') }
    finally { setBusy(false) }
  }

  const lock = async () => {
    setBusy(true); setLockErr('')
    // persist current weights first so the server validates what the user sees
    await persistAll(crit)
    try {
      await axios.post(`${API}/pre-award/${projectId}/tenders/${tenderId}/lock-criteria`, {})
      await load()
    } catch (e) {
      // surface the REAL server message verbatim (e.g. "Criteria weights sum to 97, must equal exactly 100")
      setLockErr(axios.isAxiosError(e) && e.response?.data?.error ? e.response.data.error : 'Could not lock criteria.')
    } finally { setBusy(false) }
  }

  const totalColor = total === 100 ? '#15803d' : (total > 100 ? '#b91c1c' : '#b45309')
  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: bd, textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 10px', fontSize: 13, color: col, borderBottom: rowBd, verticalAlign: 'middle' }

  return (
    <div>
      {/* Lock status / total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: sub }}>Weight total</span>
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: totalColor }}>{total} / 100</span>
          {locked && <span style={{ background: 'rgba(148,163,184,0.15)', color: '#64748b', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999 }}>🔒 Locked</span>}
        </div>
        {!locked && canApprove && (
          <button disabled={busy} onClick={lock}
            style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Working…' : 'Lock criteria'}
          </button>
        )}
      </div>

      {locked && (
        <div style={{ padding: '10px 14px', borderRadius: 8, border: bd, background: dark ? 'rgba(148,163,184,0.08)' : '#f8fafc', color: sub, fontSize: 12.5, marginBottom: 14 }}>
          🔒 Criteria locked{lockedAt ? ` on ${String(lockedAt).slice(0, 10)}` : ''} by {lockedBy === userId ? 'you' : `user #${lockedBy}`}. Weighting can no longer be edited.
        </div>
      )}
      {lockErr && (
        <div style={{ padding: '11px 14px', borderRadius: 8, border: `1px solid ${dark ? '#7f1d1d' : '#fecaca'}`, background: dark ? 'rgba(127,29,29,0.2)' : '#fef2f2', color: dark ? '#fca5a5' : '#b91c1c', fontSize: 13, marginBottom: 14 }}>
          {lockErr}
        </div>
      )}
      {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>{err} <button onClick={load} style={{ background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Retry</button></div>}

      <div style={{ border: bd, borderRadius: 8, overflow: 'hidden', background: cardBg }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Criterion</th>
              <th style={{ ...th, width: 260 }}>Weight</th>
              <th style={th}>Mandatory</th>
              <th style={th}>Min Score</th>
              {editable && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={editable ? 5 : 4} style={{ padding: '24px', textAlign: 'center', color: sub, fontSize: 13 }}>Loading…</td></tr>
            ) : crit.length === 0 ? (
              <tr><td colSpan={editable ? 5 : 4} style={{ padding: '24px', textAlign: 'center', color: sub, fontSize: 13 }}>No criteria yet. Add at least two to reach a 100% weighting.</td></tr>
            ) : crit.map(c => (
              <tr key={c.key}>
                <td style={td}>{c.label}</td>
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="range" min={CMIN} max={CMAX} value={c.weight} disabled={!editable}
                      onChange={e => onSlide(c.key, Number(e.target.value))} onPointerUp={commit} onBlur={commit} onKeyUp={commit}
                      style={{ flex: 1, accentColor: '#E84E0F', cursor: editable ? 'pointer' : 'default' }} />
                    <span style={{ width: 34, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: col }}>{c.weight}</span>
                  </div>
                </td>
                <td style={td}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: editable ? 'pointer' : 'default', fontSize: 12, color: sub }}>
                    <input type="checkbox" checked={c.mandatory} disabled={!editable} onChange={e => setField(c.key, { mandatory: e.target.checked })} style={{ accentColor: '#2563eb' }} />
                    {c.mandatory ? 'Yes' : 'No'}
                  </label>
                </td>
                <td style={td}>
                  <input type="number" min={0} max={100} value={c.min_score ?? ''} disabled={!editable} placeholder="—"
                    onChange={e => setField(c.key, { min_score: e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value))) })}
                    style={{ ...inp, width: 66 }} />
                </td>
                {editable && (
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button disabled={busy} onClick={() => del(c.key)} title="Delete criterion"
                      style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {editable && (
          <div style={{ display: 'flex', gap: 8, padding: '12px 10px', borderTop: bd, alignItems: 'center' }}>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="New criterion label (e.g. Technical capability)"
              onKeyDown={e => { if (e.key === 'Enter') addCriterion() }} style={{ ...inp, height: 34, flex: 1, maxWidth: 360 }} />
            <button disabled={busy || !newLabel.trim()} onClick={addCriterion}
              style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: newLabel.trim() ? '#2563eb' : '#94a3b8', color: '#fff', fontSize: 12, fontWeight: 600, cursor: newLabel.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}>+ Add criterion</button>
            <span style={{ fontSize: 11.5, color: sub }}>Dragging a weight auto-rebalances the others to keep the total at 100.</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── DOCUMENTS (compliance checklist) ───────────────────────
// GET /documents (can_view) + PUT /documents/:doc_key (can_edit). No file
// upload/download exists in the Pre-Award backend — this tracks each document's
// requirement + status only. file_path is used purely as an optional free-text note.
const DOC_STATUS: Record<string, { bg: string; text: string; label: string }> = {
  pending:  { bg: 'rgba(148,163,184,0.15)', text: '#64748b', label: 'Pending' },
  uploaded: { bg: 'rgba(34,197,94,0.14)',   text: '#15803d', label: 'Uploaded' },
  waived:   { bg: 'rgba(245,158,11,0.14)',  text: '#b45309', label: 'Waived' },
}
const DOC_STATUS_VALUES = ['pending', 'uploaded', 'waived'] as const

interface Doc { id: number; doc_key: string; label: string; required: boolean; status: string; note: string | null; uploaded_by: number | null; uploaded_at: string | null }

function DocumentsSection({ dark, projectId, tenderId, userRole, userId }: {
  dark: boolean; projectId: number; tenderId: number; userRole: string; userId: number
}) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState<Doc | 'new' | null>(null)

  const canEdit = CAN_EDIT.includes(userRole)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const rowBd = `1px solid ${dark ? '#1e293b' : '#eef2f7'}`
  const cardBg = dark ? '#0f172a' : '#fff'

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data } = await axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/documents`)
      setDocs((data.documents ?? []).map((d: { id: number; doc_key: string; label: string; required: number; status: string; file_path: string | null; uploaded_by: number | null; uploaded_at: string | null }) => ({
        id: d.id, doc_key: d.doc_key, label: d.label, required: !!d.required, status: d.status, note: d.file_path, uploaded_by: d.uploaded_by, uploaded_at: d.uploaded_at,
      })))
    } catch { setErr('Could not load the document checklist.') } finally { setLoading(false) }
  }, [projectId, tenderId])
  useEffect(() => { load() }, [load])

  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: bd, textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 10px', fontSize: 13, color: col, borderBottom: rowBd, verticalAlign: 'middle' }

  return (
    <div>
      {/* Honest indicator — checklist only, no file storage */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', borderRadius: 8,
        border: bd, background: dark ? 'rgba(148,163,184,0.08)' : '#f8fafc', color: sub, fontSize: 12.5, marginBottom: 14 }}>
        <span style={{ fontSize: 15, lineHeight: 1 }}>📋</span>
        <span>Compliance checklist — Pre-Award tracks each document's <strong>requirement</strong> and <strong>status</strong> only. Files themselves are not stored or uploaded here.</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: sub }}>{loading ? 'Loading…' : `${docs.length} checklist item${docs.length !== 1 ? 's' : ''}`}</div>
        {canEdit && <button onClick={() => setEdit('new')} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add checklist item</button>}
      </div>

      {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>{err} <button onClick={load} style={{ background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Retry</button></div>}

      <div style={{ border: bd, borderRadius: 8, overflow: 'hidden', background: cardBg }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Document</th><th style={th}>Requirement</th><th style={th}>Status</th><th style={th}>Note</th><th style={th}>Marked</th>{canEdit && <th style={th}></th>}
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canEdit ? 6 : 5} style={{ padding: '24px', textAlign: 'center', color: sub, fontSize: 13 }}>Loading…</td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={canEdit ? 6 : 5} style={{ padding: '24px', textAlign: 'center', color: sub, fontSize: 13 }}>No checklist items yet.</td></tr>
              ) : docs.map(d => {
                const st = DOC_STATUS[d.status] ?? DOC_STATUS.pending
                return (
                  <tr key={d.id}>
                    <td style={td}>{d.label}</td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: d.required ? '#b45309' : '#64748b' }}>{d.required ? 'Required' : 'Optional'}</span>
                    </td>
                    <td style={td}><span style={{ background: st.bg, color: st.text, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999 }}>{st.label}</span></td>
                    <td style={{ ...td, color: sub, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.note ?? ''}>{d.note || '—'}</td>
                    <td style={{ ...td, color: sub, fontSize: 12 }}>{d.status === 'uploaded' && d.uploaded_at ? `${d.uploaded_by === userId ? 'you' : `user #${d.uploaded_by}`} · ${String(d.uploaded_at).slice(0, 10)}` : '—'}</td>
                    {canEdit && <td style={{ ...td, textAlign: 'right' }}><button onClick={() => setEdit(d)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>Edit</button></td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {edit && <DocEditModal dark={dark} projectId={projectId} tenderId={tenderId} doc={edit === 'new' ? null : edit} existingKeys={new Set(docs.map(d => d.doc_key))} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </div>
  )
}

function DocEditModal({ dark, projectId, tenderId, doc, existingKeys, onClose, onSaved }: {
  dark: boolean; projectId: number; tenderId: number; doc: Doc | null; existingKeys: Set<string>; onClose: () => void; onSaved: () => void
}) {
  const isNew = !doc
  const [label, setLabel] = useState(doc?.label ?? '')
  const [required, setRequired] = useState(doc?.required ?? false)
  const [status, setStatus] = useState(doc?.status ?? 'pending')
  const [note, setNote] = useState(doc?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const inp: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 6, width: '100%', border: bd, background: dark ? '#0b1220' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const lbl = (t: string) => <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4, marginTop: 12 }}>{t}</div>

  const save = async () => {
    if (!label.trim()) { setErr('Label is required'); return }
    setSaving(true); setErr('')
    const key = doc?.doc_key ?? slugKey(label, existingKeys)
    try {
      await axios.put(`${API}/pre-award/${projectId}/tenders/${tenderId}/documents/${key}`,
        { label: label.trim(), required: required ? 1 : 0, status, file_path: note.trim() || null })
      onSaved()
    } catch (e) {
      setErr(axios.isAxiosError(e) ? (e.response?.data?.error ?? 'Could not save.') : 'Could not save.')
      setSaving(false)
    }
  }

  return (
    <div onClick={() => !saving && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: cardBg, borderRadius: 12, padding: 24, width: 460, maxWidth: '94vw', border: bd }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: col }}>{isNew ? 'Add checklist item' : 'Update document status'}</div>

        {lbl('Document')}
        <input value={label} onChange={e => setLabel(e.target.value)} disabled={!isNew} placeholder="e.g. Signed NDA"
          style={{ ...inp, opacity: isNew ? 1 : 0.7, cursor: isNew ? 'text' : 'not-allowed' }} />

        {lbl('Requirement')}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: col, cursor: 'pointer' }}>
          <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} style={{ accentColor: '#2563eb' }} /> Required
        </label>

        {lbl('Status')}
        <select value={status} onChange={e => setStatus(e.target.value)} style={inp}>
          {DOC_STATUS_VALUES.map(s => <option key={s} value={s}>{DOC_STATUS[s].label}</option>)}
        </select>

        {lbl('Note (optional)')}
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Optional note — e.g. where the file is held, or why waived"
          style={{ ...inp, height: 'auto', padding: '8px 10px' }} />

        {err && <div style={{ color: '#b91c1c', fontSize: 12.5, marginTop: 10 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button disabled={saving} onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button disabled={saving || !label.trim()} onClick={save} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: label.trim() ? '#2563eb' : '#94a3b8', color: '#fff', fontSize: 13, fontWeight: 600, cursor: label.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
