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

  const canApprove = CAN_APPROVE.includes(userRole)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const who = (a: Approval) => a.approver_name || (a.approver_id === userId ? 'you' : a.approver_id != null ? `user #${a.approver_id}` : 'unknown')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [ch, proj] = await Promise.all([
        axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/approvals`),
        axios.get(`${API}/projects/${projectId}`),
      ])
      setChain(ch.data)
      const t2 = proj.data?.approval_threshold_2
      setThreshold2(t2 == null ? null : Number(t2))
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

  const notice = (title: string, body: string) => (
    <div style={{ border: bd, borderRadius: 8, background: dark ? 'rgba(148,163,184,0.06)' : '#f8fafc', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: col, fontSize: 13 }}>{title}</span>
        <span style={{ background: 'rgba(148,163,184,0.18)', color: '#64748b', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 9999 }}>Not yet available</span>
      </div>
      <div style={{ fontSize: 12.5, color: sub }}>{body}</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 1 — Recommendation (out of scope) */}
      {notice('Recommendation', 'Selecting the recommended supplier and its combined score is part of the Evaluation module, which is not yet built (blocked on the scope-reconciliation gate). This section will show the recommended bid and score once evaluation is available.')}

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

      {/* 3 — Award → PO (out of scope) */}
      {notice('Award → Purchase Order', 'Once approved, generating the Purchase Order from this tender (the award→PO handoff into the Procurement module) is not yet wired. This section will create the PO once that handoff is built.')}

      {action && chain && (
        <ActionModal dark={dark} projectId={projectId} tenderId={tenderId} mode={action}
          onClose={() => setAction(null)} onDone={() => { setAction(null); load(); onChanged?.() }} />
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
