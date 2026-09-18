// ─── PRE-AWARD · RECOMMENDATION / AWARD TAB ─────────────────
// Phase 3.1e — the APPROVAL-CHAIN half only. Endpoints (Phase 2.7):
//   GET  /:projectId/tenders/:id/approvals  (can_view)  chain state (row-existence model)
//   POST /:projectId/tenders/:id/approve    (can_approve)
//   POST /:projectId/tenders/:id/reject     (can_approve)
// Thresholds read from GET /projects/:id (approval_threshold_1/2). needsDirector is
// computed exactly as the backend does: approval_threshold_2 != null && value > it.
// Recommendation-selection (winning bid / combined score) and award→PO generation
// are OUT OF SCOPE (blocked on 2.6 / 2.8) and shown as explicit "not yet available".
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { API } from '../lib/api'

const CAN_APPROVE = ['admin', 'procurement_manager', 'procurement_officer', 'project_director']

interface Approval { id: number; approver_id: number | null; approver_name: string | null; approval_level: number; status: string; comments: string | null; actioned_at: string | null }
interface ChainState { approval_status: string; estimated_value: string | number | null; approvals: Approval[] }
interface ScoreCell { criterion_id: number; label: string; weight: number; score: number | null; reason: string | null; weighted: number | null }
interface RankedBid { bid_id: number; supplier_name: string; rank_position: number; combined_score: number | string | null; tech_score: number | null; comm_score: number | null; commercial_value: string | number | null; scores: ScoreCell[] }
interface DisqInfo { type: string; criterion_label: string; score: number; threshold: number }
interface DisqBid { bid_id: number; supplier_name: string; disqualification: DisqInfo; scores: ScoreCell[] }
interface Rec { computed: boolean; computed_at?: string | null; computed_by_name?: string | null; recommended_bid_id?: number | null; ranked?: RankedBid[]; disqualified?: DisqBid[] }

const RECOMPUTE_WARNING = 'Recomputing will invalidate the current approval. The existing scores and rank will be archived (not deleted), and this tender will return to pending status, requiring a fresh approval decision.'
const disqReason = (d: DisqInfo) => d.type === 'mandatory'
  ? `Failed mandatory criterion ${d.criterion_label} (scored ${d.score}, min ${d.threshold})`
  : `Below min-score on ${d.criterion_label} (scored ${d.score}, min ${d.threshold})`

const fmtMoney = (v: string | number | null) => {
  if (v == null || v === '') return '—'
  const n = Number(v); if (!isFinite(n)) return '—'
  return `AUD ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function PreAwardRecommendationTab({ dark, projectId, tenderId, userRole, userId, onChanged }: {
  dark: boolean; projectId: number; tenderId: number; userRole: string; userId: number; onChanged?: () => void
}) {
  const [chain, setChain] = useState<ChainState | null>(null)
  const [threshold2, setThreshold2] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [action, setAction] = useState<null | 'approve' | 'reject'>(null)
  const [rec, setRec] = useState<Rec | null>(null)
  const [computing, setComputing] = useState(false)
  const [computeErr, setComputeErr] = useState('')
  const [showRecomputeWarn, setShowRecomputeWarn] = useState(false)

  const canApprove = CAN_APPROVE.includes(userRole)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const who = (a: Approval) => a.approver_name || (a.approver_id === userId ? 'you' : a.approver_id != null ? `user #${a.approver_id}` : 'unknown')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [ch, proj, rc] = await Promise.all([
        axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/approvals`),
        axios.get(`${API}/projects/${projectId}`),
        axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/recommendation`),
      ])
      setChain(ch.data)
      const t2 = proj.data?.approval_threshold_2
      setThreshold2(t2 == null ? null : Number(t2))
      setRec(rc.data)
    } catch { setErr('Could not load the approval chain.') } finally { setLoading(false) }
  }, [projectId, tenderId])
  useEffect(() => { load() }, [load])

  const value = Number(chain?.estimated_value ?? 0) || 0
  const needsDirector = threshold2 != null && value > threshold2
  const status = chain?.approval_status ?? 'pending'
  const terminal = status === 'approved' || status === 'rejected'

  const rows = chain?.approvals ?? []
  const levelRow = (lvl: number, st: string) => rows.find(a => a.approval_level === lvl && a.status === st) || null
  const l1Approved = levelRow(1, 'approved'); const l1Rejected = levelRow(1, 'rejected')
  const l2Approved = levelRow(2, 'approved'); const l2Rejected = levelRow(2, 'rejected')

  const statusPill = () => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      pending:  { bg: 'rgba(245,158,11,0.14)', text: '#b45309', label: 'Pending approval' },
      approved: { bg: 'rgba(34,197,94,0.16)',  text: '#15803d', label: 'Approved' },
      rejected: { bg: 'rgba(239,68,68,0.16)',  text: '#b91c1c', label: 'Rejected' },
    }
    const s = map[status] ?? map.pending
    return <span style={{ background: s.bg, color: s.text, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 9999 }}>{s.label}</span>
  }

  const levelNode = (title: string, approved: Approval | null, rejected: Approval | null) => {
    const state = approved ? 'approved' : rejected ? 'rejected' : 'pending'
    const dot = state === 'approved' ? '#15803d' : state === 'rejected' ? '#b91c1c' : (dark ? '#475569' : '#cbd5e1')
    const row = approved || rejected
    return (
      <div style={{ display: 'flex', gap: 12, padding: '12px 14px', border: bd, borderRadius: 8, background: cardBg }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: dot, marginTop: 3, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: col }}>{title}</div>
          <div style={{ fontSize: 12.5, color: sub, marginTop: 2 }}>
            {state === 'approved' && <>Approved by <strong style={{ color: col }}>{who(approved!)}</strong>{approved!.actioned_at ? ` · ${String(approved!.actioned_at).slice(0, 10)}` : ''}</>}
            {state === 'rejected' && <>Rejected by <strong style={{ color: col }}>{who(rejected!)}</strong>{rejected!.actioned_at ? ` · ${String(rejected!.actioned_at).slice(0, 10)}` : ''}</>}
            {state === 'pending' && 'Awaiting approval'}
          </div>
          {row?.comments && <div style={{ fontSize: 12, color: sub, marginTop: 4, fontStyle: 'italic' }}>“{row.comments}”</div>}
        </div>
      </div>
    )
  }

  const runCompute = async () => {
    setComputing(true); setComputeErr(''); setShowRecomputeWarn(false)
    try {
      await axios.post(`${API}/pre-award/${projectId}/tenders/${tenderId}/compute-recommendation`, {})
      await load()          // reloads recommendation AND the approval chain (which resets to pending on recompute-after-approval)
      onChanged?.()
    } catch (e) {
      const s = axios.isAxiosError(e) ? e.response?.status : undefined
      setComputeErr(axios.isAxiosError(e) && e.response?.data?.error ? `${e.response.data.error}${s ? ` (${s})` : ''}` : 'Could not compute the recommendation.')
    } finally { setComputing(false) }
  }
  // Recompute on an APPROVED tender shows the three-part warning first; otherwise compute directly.
  const onComputeClick = () => { if (status === 'approved') setShowRecomputeWarn(true); else runCompute() }

  const scoreLine = (cells: ScoreCell[]) => cells.map(c => `${c.label} ${c.score ?? '—'}×${c.weight}%`).join('  ·  ')

  const recommendationSection = () => {
    const computed = rec?.computed === true
    const ranked = rec?.ranked ?? []
    const disq = rec?.disqualified ?? []
    return (
      <div style={{ border: bd, borderRadius: 8, background: cardBg, padding: '16px 16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: col }}>Recommendation</div>
          {computed && <div style={{ fontSize: 11.5, color: sub }}>Computed{rec?.computed_by_name ? ` by ${rec.computed_by_name}` : ''}{rec?.computed_at ? ` · ${String(rec.computed_at).slice(0, 10)}` : ''}</div>}
        </div>

        {!computed ? (
          <div>
            <div style={{ fontSize: 12.5, color: sub, marginBottom: canApprove ? 12 : 0 }}>No recommendation has been computed yet. Scoring must be complete and the criteria locked before a recommendation can be generated.</div>
            {canApprove && (
              <button disabled={computing} onClick={onComputeClick}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600, cursor: computing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {computing ? 'Computing…' : 'Compute Recommendation'}
              </button>
            )}
            {computeErr && <div style={{ color: '#b91c1c', fontSize: 12.5, marginTop: 10 }}>{computeErr}</div>}
          </div>
        ) : (
          <>
            {/* Ranked survivors */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ranked.map(b => {
                const isRec = b.rank_position === 1
                return (
                  <div key={b.bid_id} style={{ display: 'flex', gap: 12, padding: '12px 14px', border: `1px solid ${isRec ? '#15803d' : (dark ? '#334155' : '#dde3ed')}`, borderRadius: 8, background: isRec ? (dark ? 'rgba(34,197,94,0.08)' : '#f0fdf4') : cardBg }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: isRec ? '#15803d' : sub, width: 26, textAlign: 'center' }}>{b.rank_position}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: col }}>{b.supplier_name}</span>
                        {isRec && <span style={{ background: 'rgba(34,197,94,0.16)', color: '#15803d', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 9999 }}>System recommendation</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: sub, marginTop: 3 }}>{scoreLine(b.scores)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: col }}>{b.combined_score}</div>
                      <div style={{ fontSize: 10.5, color: sub }}>combined</div>
                    </div>
                  </div>
                )
              })}
              {ranked.length === 0 && <div style={{ fontSize: 12.5, color: sub }}>No bid passed every gate — see disqualifications below.</div>}
            </div>

            {/* Disqualified */}
            {disq.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Disqualified</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {disq.map(b => (
                    <div key={b.bid_id} style={{ padding: '10px 14px', border: bd, borderRadius: 8, background: dark ? 'rgba(148,163,184,0.06)' : '#f8fafc' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: col }}>{b.supplier_name}</span>
                      <span style={{ fontSize: 12.5, color: '#b91c1c', marginLeft: 8 }}>{b.disqualification ? disqReason(b.disqualification) : 'Disqualified'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recompute */}
            {canApprove && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                <button disabled={computing} onClick={onComputeClick}
                  style={{ padding: '7px 14px', borderRadius: 6, border: bd, background: 'none', color: col, fontSize: 12.5, fontWeight: 600, cursor: computing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  {computing ? 'Recomputing…' : 'Recompute'}
                </button>
                {computeErr && <span style={{ color: '#b91c1c', fontSize: 12.5 }}>{computeErr}</span>}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 1 — Recommendation */}
      {recommendationSection()}

      {/* 2 — Approval chain (functional) */}
      <div style={{ border: bd, borderRadius: 8, background: cardBg, padding: '16px 16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: col }}>Approval chain</div>
          {!loading && chain && statusPill()}
        </div>

        {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{err} <button onClick={load} style={{ background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Retry</button></div>}

        {loading ? <div style={{ color: sub, fontSize: 13, padding: '8px 0' }}>Loading…</div> : chain && (
          <>
            {/* Threshold-driven summary (honest about null threshold_2) */}
            <div style={{ fontSize: 12.5, color: sub, marginBottom: 14, lineHeight: 1.5 }}>
              Estimated value <strong style={{ color: col }}>{fmtMoney(chain.estimated_value)}</strong>. {threshold2 == null
                ? <>No Level-2 (director) threshold is configured for this project — <strong style={{ color: col }}>single-level approval</strong> (Level 1 only).</>
                : needsDirector
                  ? <>Exceeds the Level-2 threshold of <strong style={{ color: col }}>{fmtMoney(threshold2)}</strong> — <strong style={{ color: col }}>two-level approval</strong> (Level 1 + Level 2 director) required.</>
                  : <>At or below the Level-2 threshold of <strong style={{ color: col }}>{fmtMoney(threshold2)}</strong> — <strong style={{ color: col }}>single-level approval</strong> (Level 1 only).</>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {levelNode('Level 1 — Procurement Manager', l1Approved, l1Rejected)}
              {needsDirector && levelNode('Level 2 — Project Director', l2Approved, l2Rejected)}
            </div>

            {/* Actions */}
            {canApprove && !terminal && (
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={() => setAction('approve')} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#15803d', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Approve</button>
                <button onClick={() => setAction('reject')} style={{ padding: '8px 16px', borderRadius: 6, border: `1px solid ${dark ? '#7f1d1d' : '#fecaca'}`, background: 'none', color: '#b91c1c', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Reject</button>
              </div>
            )}
            {terminal && <div style={{ marginTop: 14, fontSize: 12.5, color: sub }}>This tender is <strong style={{ color: col }}>{status}</strong>; the approval chain is closed.</div>}
            {!canApprove && !terminal && <div style={{ marginTop: 14, fontSize: 12.5, color: sub }}>Your role can view the approval chain but cannot approve or reject.</div>}
          </>
        )}
      </div>

      {/* 3 — Award → PO */}
      <AwardToPoSection dark={dark} projectId={projectId} tenderId={tenderId} approvalStatus={status} canApprove={canApprove} onChanged={onChanged} />

      {action && chain && (
        <ActionModal dark={dark} projectId={projectId} tenderId={tenderId} mode={action}
          onClose={() => setAction(null)} onDone={() => { setAction(null); load(); onChanged?.() }} />
      )}

      {showRecomputeWarn && (
        <div onClick={() => !computing && setShowRecomputeWarn(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: cardBg, borderRadius: 12, padding: 24, width: 480, maxWidth: '94vw', border: bd }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: col, marginBottom: 10 }}>Recompute recommendation?</div>
            <div style={{ fontSize: 13, color: dark ? '#fca5a5' : '#b91c1c', background: dark ? 'rgba(127,29,29,0.2)' : '#fef2f2', border: `1px solid ${dark ? '#7f1d1d' : '#fecaca'}`, borderRadius: 8, padding: '12px 14px', lineHeight: 1.5 }}>
              {RECOMPUTE_WARNING}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button disabled={computing} onClick={() => setShowRecomputeWarn(false)} style={{ padding: '8px 14px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button disabled={computing} onClick={runCompute} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: '#b91c1c', color: '#fff', fontSize: 13, fontWeight: 600, cursor: computing ? 'default' : 'pointer', fontFamily: 'inherit' }}>{computing ? 'Recomputing…' : 'Recompute & invalidate approval'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ActionModal({ dark, projectId, tenderId, mode, onClose, onDone }: {
  dark: boolean; projectId: number; tenderId: number; mode: 'approve' | 'reject'; onClose: () => void; onDone: () => void
}) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const isReject = mode === 'reject'

  const go = async () => {
    setBusy(true); setErr('')
    try {
      await axios.post(`${API}/pre-award/${projectId}/tenders/${tenderId}/${mode}`, { comment: comment.trim() || null })
      onDone()
    } catch (e) {
      const s = axios.isAxiosError(e) ? e.response?.status : undefined
      setErr(axios.isAxiosError(e) && e.response?.data?.error ? `${e.response.data.error}${s ? ` (${s})` : ''}` : `Could not ${mode}.`)
      setBusy(false)
    }
  }

  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: cardBg, borderRadius: 12, padding: 24, width: 460, maxWidth: '94vw', border: bd }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: col, marginBottom: 8 }}>{isReject ? 'Reject tender' : 'Approve tender'}</div>
        {isReject && (
          <div style={{ fontSize: 13, color: dark ? '#fca5a5' : '#b91c1c', background: dark ? 'rgba(127,29,29,0.2)' : '#fef2f2', border: `1px solid ${dark ? '#7f1d1d' : '#fecaca'}`, borderRadius: 8, padding: '11px 13px', marginBottom: 12 }}>
            Rejecting closes the approval chain for this tender. This cannot be undone.
          </div>
        )}
        {!isReject && <div style={{ fontSize: 12.5, color: sub, marginBottom: 12 }}>Recording your approval advances the chain to the next required level, or completes it (awarding the tender) if this is the final level.</div>}
        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>Comment (optional)</div>
        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: bd, background: dark ? '#0b1220' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
        {err && <div style={{ color: '#b91c1c', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button disabled={busy} onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button disabled={busy} onClick={go} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: isReject ? '#b91c1c' : '#15803d', color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>{busy ? 'Working…' : (isReject ? 'Confirm reject' : 'Confirm approve')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── AWARD → PURCHASE ORDER ──────────────────────────────────
// Generates the PO from the awarded tender (POST generate-po). Converts 100% of the
// tender's ACTIVE reservations into ONE PO for the recommended supplier — there is no
// per-reservation selection (bids are lump-sum; no per-line bid scope exists), so this
// UI offers NO checkboxes / partial-convert control: it shows the lines that WILL convert
// and says so plainly. Rendered as a real action only when the tender is genuinely approved.
interface ResvLite { tli_id: number; mto_line_id: number; qty_reserved: string | number; status: string; line_number: string; description: string; uom: string | null; mto_reference: string }
interface LinkedPo { id: number; po_number: string; supplier_id: number; vendor_name: string | null; value: string | number | null; currency: string | null; status: string }

function AwardToPoSection({ dark, projectId, tenderId, approvalStatus, canApprove, onChanged }: {
  dark: boolean; projectId: number; tenderId: number; approvalStatus: string; canApprove: boolean; onChanged?: () => void
}) {
  const [resv, setResv] = useState<ResvLite[]>([])
  const [po, setPo] = useState<LinkedPo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [justCreated, setJustCreated] = useState(false)
  const [submitErr, setSubmitErr] = useState('')

  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const inputBg = dark ? '#0b1220' : '#f8fafc'
  const fmtQty = (v: string | number | null | undefined) => {
    if (v == null || v === '') return '—'
    const n = Number(v); return isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—'
  }

  const load = useCallback(async () => {
    setLoading(true); setLoadErr('')
    try {
      const { data } = await axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/scope`)
      setResv((data.reservations ?? []).filter((r: ResvLite) => r.status === 'active'))
      setPo(data.po ?? null)
    } catch { setLoadErr('Could not load the award status.') } finally { setLoading(false) }
  }, [projectId, tenderId])
  useEffect(() => { load() }, [load])

  const generate = async () => {
    const n = poNumber.trim()
    if (!n) { setSubmitErr('Enter a PO number.'); return }
    setBusy(true); setSubmitErr('')
    try {
      const { data } = await axios.post(`${API}/pre-award/${projectId}/tenders/${tenderId}/generate-po`, { po_number: n })
      setPo(data.po ?? null)          // flips the card to the handed-off summary
      setResv([]); setJustCreated(true); setBusy(false)
      onChanged?.()
    } catch (e) {
      const s = axios.isAxiosError(e) ? e.response?.status : undefined
      setSubmitErr(axios.isAxiosError(e) && e.response?.data?.error ? `${e.response.data.error}${s ? ` (${s})` : ''}` : 'Could not generate the PO.')
      setBusy(false)
    }
  }

  const header = (
    <div style={{ fontSize: 14, fontWeight: 700, color: col, marginBottom: 12 }}>Award → Purchase Order</div>
  )

  const poSummary = (p: LinkedPo, justCreated: boolean) => (
    <div style={{ border: `1px solid ${dark ? '#166534' : '#bbf7d0'}`, borderRadius: 8, background: dark ? 'rgba(34,197,94,0.08)' : '#f0fdf4', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>{justCreated ? 'Purchase Order created' : 'Handed off to Purchase Order'}</span>
        <span style={{ background: 'rgba(34,197,94,0.16)', color: '#15803d', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 9999 }}>{p.status}</span>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase' }}>PO number</div><div style={{ fontSize: 14, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: col }}>{p.po_number}</div></div>
        <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Supplier</div><div style={{ fontSize: 14, color: col }}>{p.vendor_name || `#${p.supplier_id}`}</div></div>
        <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Value</div><div style={{ fontSize: 14, color: col }}>{fmtMoney(p.value)}</div></div>
      </div>
      <div style={{ fontSize: 12, color: sub, marginTop: 10 }}>This Purchase Order now lives in the Procurement module.</div>
    </div>
  )

  return (
    <div style={{ border: bd, borderRadius: 8, background: cardBg, padding: '16px 16px 18px' }}>
      {header}
      {loading ? <div style={{ color: sub, fontSize: 13 }}>Loading…</div>
        : loadErr ? <div style={{ color: '#b91c1c', fontSize: 13 }}>{loadErr} <button onClick={load} style={{ background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Retry</button></div>
        : po ? poSummary(po, justCreated)
        : approvalStatus !== 'approved' ? (
          <div style={{ fontSize: 12.5, color: sub }}>Generating the Purchase Order becomes available once this tender is <strong style={{ color: col }}>approved</strong>. It converts the tender’s reserved MTO lines into a PO for the recommended supplier.</div>
        ) : resv.length === 0 ? (
          <div style={{ fontSize: 12.5, color: sub }}>This tender is approved, but <strong style={{ color: col }}>no MTO lines are reserved</strong>. Reserve scope on the <strong style={{ color: col }}>Scope</strong> tab before generating a Purchase Order.</div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: sub, marginBottom: 12, lineHeight: 1.5 }}>
              Generating the PO converts <strong style={{ color: col }}>all {resv.length} reserved line{resv.length > 1 ? 's' : ''}</strong> into a single Purchase Order for the recommended supplier. Every reserved line is included — there is no partial conversion. This cannot be undone.
            </div>

            {/* Read-only list of lines that WILL convert — no selection control */}
            <div style={{ border: bd, borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
              {resv.map((r, i) => (
                <div key={r.tli_id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '9px 12px', borderTop: i === 0 ? 'none' : bd, background: dark ? 'rgba(148,163,184,0.04)' : '#f8fafc' }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: col, flexShrink: 0 }}>{r.mto_reference} · {r.line_number}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: col, flexShrink: 0 }}>{fmtQty(r.qty_reserved)} {r.uom || ''}</span>
                </div>
              ))}
            </div>

            {canApprove ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="PO number (e.g. PO-2026-0042)" disabled={busy}
                  style={{ flex: 1, minWidth: 220, padding: '9px 11px', borderRadius: 6, border: bd, background: inputBg, color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                <button disabled={busy || !poNumber.trim()} onClick={generate}
                  style={{ padding: '9px 18px', borderRadius: 6, border: 'none', background: !poNumber.trim() ? '#64748b' : '#15803d', color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy || !poNumber.trim() ? 'default' : 'pointer', fontFamily: 'inherit', opacity: !poNumber.trim() ? 0.6 : 1 }}>
                  {busy ? 'Generating…' : 'Generate PO'}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: sub }}>Your role can view this but cannot generate the Purchase Order.</div>
            )}
            {submitErr && <div style={{ color: '#b91c1c', fontSize: 12.5, marginTop: 10 }}>{submitErr}</div>}
          </>
        )}
    </div>
  )
}
