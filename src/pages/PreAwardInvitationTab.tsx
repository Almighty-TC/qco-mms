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
        : (
          <div style={{ padding: '32px 18px', border: bd, borderRadius: 8, background: dark ? '#0f172a' : '#fff', color: sub2, fontSize: 13, textAlign: 'center' }}>
            <div style={{ fontWeight: 600, color: col, marginBottom: 6 }}>{sub === 'documents' ? 'Documents' : 'Clarifications'}</div>
            This section is built in an upcoming sub-step ({sub === 'documents' ? '3.1c-2' : '3.1c-3'}).
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
