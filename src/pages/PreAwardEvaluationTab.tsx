// ─── PRE-AWARD · EVALUATION TAB ─────────────────────────────
// Per-bid technical scoring grid. Endpoints:
//   GET  /:projectId/tenders/:id/criteria   (can_view)  — criteria incl score_source
//   GET  /:projectId/tenders/:id/bids        (can_view)  — bids incl prelim/status
//   GET  /:projectId/tenders/:id/scores      (can_view)  — existing manual scores (pre-fill)
//   PUT  /:projectId/tenders/:id/bids/:bidId/scores (can_approve) — bulk upsert
// The `score_source='price'` Commercial criterion is NEVER an enterable field — it is
// computed on recommendation. It's shown as a greyed, read-only row for context only.
// Criteria-not-locked and non-scorable-bid states are handled with specific messaging,
// so the backend 409s never fire from this UI.
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { API } from '../lib/api'

const CAN_APPROVE = ['admin', 'procurement_manager', 'procurement_officer', 'project_director']

interface Criterion { id: number; label: string; weight: number; mandatory: number; min_score: number | null; score_source: string }
interface Bid { id: number; supplier_name: string; status: string; prelim_status: string | null }
interface ScoreRow { bid_id: number; criterion_id: number; score: number }

export function PreAwardEvaluationTab({ dark, projectId, tenderId, userRole }: {
  dark: boolean; projectId: number; tenderId: number; userRole: string; userId: number
}) {
  const [criteria, setCriteria] = useState<Criterion[]>([])
  const [locked, setLocked] = useState(false)
  const [bids, setBids] = useState<Bid[]>([])
  const [scores, setScores] = useState<Record<number, Record<number, number>>>({}) // bidId → critId → score
  const [draft, setDraft] = useState<Record<number, Record<number, string>>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saveState, setSaveState] = useState<Record<number, { busy?: boolean; msg?: string; ok?: boolean }>>({})

  const canScore = CAN_APPROVE.includes(userRole)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const inp = { width: 72, padding: '6px 8px', borderRadius: 6, border: bd, background: dark ? '#0b1220' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none' } as const

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [cr, bd2, sc] = await Promise.all([
        axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/criteria`),
        axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/bids`),
        axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/scores`),
      ])
      setCriteria(cr.data.criteria ?? [])
      setLocked(!!cr.data.locked)
      setBids(bd2.data.bids ?? [])
      const m: Record<number, Record<number, number>> = {}
      for (const r of (sc.data.scores ?? []) as ScoreRow[]) (m[r.bid_id] ??= {})[r.criterion_id] = Number(r.score)
      setScores(m)
    } catch { setErr('Could not load the evaluation data.') } finally { setLoading(false) }
  }, [projectId, tenderId])
  useEffect(() => { load() }, [load])

  const manualCriteria = criteria.filter(c => c.score_source !== 'price')
  const priceCriterion = criteria.find(c => c.score_source === 'price') || null
  const scorable = (b: Bid) => b.prelim_status === 'pass' && b.status !== 'withdrawn' && b.status !== 'rejected'
  const notScorableReason = (b: Bid) =>
    b.status === 'withdrawn' ? 'Withdrawn' : b.status === 'rejected' ? 'Rejected'
    : b.prelim_status !== 'pass' ? `Failed preliminary check (prelim_status = '${b.prelim_status ?? 'pending'}')` : ''

  const valOf = (bidId: number, critId: number): string => {
    const d = draft[bidId]?.[critId]
    if (d !== undefined) return d
    const s = scores[bidId]?.[critId]
    return s === undefined ? '' : String(s)
  }
  const setVal = (bidId: number, critId: number, v: string) =>
    setDraft(p => ({ ...p, [bidId]: { ...(p[bidId] ?? {}), [critId]: v } }))

  const isValid = (v: string) => { const n = Number(v); return v !== '' && Number.isInteger(n) && n >= 0 && n <= 100 }
  const allValid = (bidId: number) => manualCriteria.every(c => isValid(valOf(bidId, c.id)))

  const save = async (bidId: number) => {
    setSaveState(p => ({ ...p, [bidId]: { busy: true } }))
    try {
      const payload = { scores: manualCriteria.map(c => ({ criterion_id: c.id, score: Number(valOf(bidId, c.id)) })) }
      const r = await axios.put(`${API}/pre-award/${projectId}/tenders/${tenderId}/bids/${bidId}/scores`, payload)
      const m: Record<number, number> = {}
      for (const row of r.data.scores as ScoreRow[]) m[row.criterion_id] = Number(row.score)
      setScores(p => ({ ...p, [bidId]: m }))
      setDraft(p => { const n = { ...p }; delete n[bidId]; return n })
      setSaveState(p => ({ ...p, [bidId]: { ok: true, msg: 'Scores saved.' } }))
    } catch (e) {
      const s = axios.isAxiosError(e) ? e.response?.status : undefined
      const msg = axios.isAxiosError(e) && e.response?.data?.error ? `${e.response.data.error}${s ? ` (${s})` : ''}` : 'Could not save scores.'
      setSaveState(p => ({ ...p, [bidId]: { ok: false, msg } }))
    }
  }

  if (loading) return <div style={{ color: sub, fontSize: 13, padding: '8px 0' }}>Loading…</div>
  if (err) return <div style={{ color: '#b91c1c', fontSize: 13 }}>{err} <button onClick={load} style={{ background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Retry</button></div>

  // ── criteria-not-locked: specific guidance, no grid (the 409 never fires) ──
  if (!locked) {
    return (
      <div style={{ border: bd, borderRadius: 8, background: dark ? 'rgba(245,158,11,0.08)' : '#fffbeb', padding: '16px 18px' }}>
        <div style={{ fontWeight: 700, color: col, fontSize: 14, marginBottom: 6 }}>Criteria aren’t locked yet</div>
        <div style={{ fontSize: 13, color: sub, lineHeight: 1.5 }}>
          Bids can’t be scored until the evaluation criteria are finalized and locked. Set the criteria and their weights in the <strong style={{ color: col }}>Invitation</strong> tab, then lock them — scoring opens here once they’re locked.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!canScore && <div style={{ fontSize: 12.5, color: sub, fontStyle: 'italic' }}>Your role can view scores but cannot enter or change them.</div>}
      {bids.length === 0 && <div style={{ color: sub, fontSize: 13 }}>No bids submitted yet.</div>}

      {bids.map(b => {
        const ok = scorable(b)
        const st = saveState[b.id] ?? {}
        return (
          <div key={b.id} style={{ border: bd, borderRadius: 8, background: cardBg, padding: '14px 16px', opacity: ok ? 1 : 0.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: ok ? 12 : 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: col }}>{b.supplier_name}</div>
              {!ok && <span style={{ fontSize: 12, color: '#b45309', background: 'rgba(245,158,11,0.14)', padding: '3px 10px', borderRadius: 9999 }}>Not scorable — {notScorableReason(b)}</span>}
            </div>

            {ok && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {manualCriteria.map(c => {
                    const v = valOf(b.id, c.id); const bad = v !== '' && !isValid(v)
                    return (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1, fontSize: 13, color: col }}>
                          {c.label}
                          <span style={{ fontSize: 11.5, color: sub, marginLeft: 8 }}>
                            weight {c.weight}
                            {c.mandatory ? <span style={{ color: '#b91c1c', fontWeight: 600, marginLeft: 6 }}>· mandatory</span> : null}
                            {c.min_score != null ? <span style={{ marginLeft: 6 }}>· min {c.min_score}</span> : null}
                          </span>
                        </div>
                        <input type="number" min={0} max={100} step={1} value={v} disabled={!canScore}
                          onChange={e => setVal(b.id, c.id, e.target.value)}
                          style={{ ...inp, borderColor: bad ? '#b91c1c' : (inp.border as string).split(' ').pop() }} />
                      </div>
                    )
                  })}
                  {/* Commercial criterion — read-only, never an input */}
                  {priceCriterion && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: 0.6 }}>
                      <div style={{ flex: 1, fontSize: 13, color: col }}>
                        {priceCriterion.label}
                        <span style={{ fontSize: 11.5, color: sub, marginLeft: 8 }}>weight {priceCriterion.weight} · computed from price on recommendation</span>
                      </div>
                      <span style={{ fontSize: 12, color: sub, fontStyle: 'italic' }}>auto</span>
                    </div>
                  )}
                </div>

                {canScore && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                    <button disabled={st.busy || !allValid(b.id)} onClick={() => save(b.id)}
                      style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: allValid(b.id) ? '#15803d' : '#94a3b8', color: '#fff', fontSize: 13, fontWeight: 600, cursor: allValid(b.id) && !st.busy ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                      {st.busy ? 'Saving…' : 'Save scores'}
                    </button>
                    {st.msg && <span style={{ fontSize: 12.5, color: st.ok ? '#15803d' : '#b91c1c' }}>{st.msg}</span>}
                    {!allValid(b.id) && !st.msg && <span style={{ fontSize: 12, color: sub }}>Enter a 0–100 score for every criterion to save.</span>}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
