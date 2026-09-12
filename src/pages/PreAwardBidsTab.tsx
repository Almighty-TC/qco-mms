// ─── PRE-AWARD · BIDS TAB ───────────────────────────────────
// Phase 3.1d — the sealed-envelope keystone. Endpoints (Phase 2.4):
//   GET  /:projectId/tenders/:id/bids                 (can_view)  masked list
//   GET  /:projectId/tenders/:id/bids/:bidId          (can_view)  masked detail
//   POST /:projectId/tenders/:id/bids                 (can_create) submit (seals commercial)
//   POST /:projectId/tenders/:id/bids/:bidId/prelim-check (can_edit) mechanical checklist
//   POST /:projectId/tenders/:id/bids/:bidId/unseal   (can_edit AND allowlist) irreversible reveal
//
// Sealed rule: the server returns commercial_value ONLY when unsealed_at IS NOT NULL
// (proven role-independent). A sealed bid shows a lock and NO figure/placeholder.
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { API } from '../lib/api'

const CAN_CREATE = ['admin', 'procurement_manager', 'procurement_officer', 'project_manager']  // can_create
const CAN_EDIT   = ['admin', 'procurement_manager', 'procurement_officer', 'project_manager']  // can_edit
// Narrower than can_edit — mirrors the backend UNSEAL_AUTHORIZED_ROLES (server enforces).
const UNSEAL_ROLES = ['procurement_manager', 'admin']

interface Bid {
  id: number; supplier_id: number; supplier_name: string; round: number; submitted_at: string | null
  currency: string | null; tech_doc_count: number; comm_doc_count: number; bid_bond_provided: number
  prelim_status: string | null; prelim_reason: string | null; status: string
  envelope: 'sealed' | 'unsealed'; commercial_value: string | number | null
  unsealed_at: string | null; unsealed_by: number | null
}
interface Sup { id: number; name: string; code: string }

const fmtMoney = (v: string | number | null, cur: string | null) => {
  if (v == null || v === '') return '—'
  const n = Number(v); if (!isFinite(n)) return '—'
  return `${cur || 'AUD'} ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
const PRELIM_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'rgba(148,163,184,0.15)', text: '#64748b', label: 'Prelim: pending' },
  pass:    { bg: 'rgba(34,197,94,0.14)',   text: '#15803d', label: 'Prelim: pass' },
  fail:    { bg: 'rgba(239,68,68,0.14)',   text: '#b91c1c', label: 'Prelim: fail' },
}

export function PreAwardBidsTab({ dark, projectId, tenderId, userRole, userId }: {
  dark: boolean; projectId: number; tenderId: number; userRole: string; userId: number
}) {
  const [bids, setBids] = useState<Bid[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showSubmit, setShowSubmit] = useState(false)
  const [unsealTarget, setUnsealTarget] = useState<Bid | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const canCreate = CAN_CREATE.includes(userRole)
  const canEdit = CAN_EDIT.includes(userRole)
  const canUnseal = canEdit && UNSEAL_ROLES.includes(userRole)

  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const who = (id: number | null) => id == null ? 'unknown' : id === userId ? 'you' : `user #${id}`

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data } = await axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/bids`)
      setBids(data.bids ?? [])
    } catch { setErr('Could not load bids.') } finally { setLoading(false) }
  }, [projectId, tenderId])
  useEffect(() => { load() }, [load])

  const runPrelim = async (b: Bid) => {
    setBusyId(b.id)
    try { await axios.post(`${API}/pre-award/${projectId}/tenders/${tenderId}/bids/${b.id}/prelim-check`, {}); await load() }
    catch (e) { alert(axios.isAxiosError(e) && e.response?.data?.error ? e.response.data.error : 'Prelim check failed.') }
    finally { setBusyId(null) }
  }

  const fact = (label: string, ok: boolean, n?: number) => (
    <span style={{ fontSize: 11.5, color: sub }}>{label}: <strong style={{ color: ok ? '#15803d' : '#b45309' }}>{n != null ? n : (ok ? 'Yes' : 'No')}</strong></span>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: sub }}>{loading ? 'Loading…' : `${bids.length} bid${bids.length !== 1 ? 's' : ''}`}</div>
        {canCreate && <button onClick={() => setShowSubmit(true)} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>+ Submit bid</button>}
      </div>

      {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>{err} <button onClick={load} style={{ background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Retry</button></div>}

      {loading ? (
        <div style={{ padding: 24, color: sub, fontSize: 13 }}>Loading…</div>
      ) : bids.length === 0 ? (
        <div style={{ padding: '28px 18px', border: bd, borderRadius: 8, background: cardBg, color: sub, fontSize: 13, textAlign: 'center' }}>No bids submitted yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {bids.map(b => {
            const sealed = b.envelope !== 'unsealed'
            const pst = PRELIM_STYLE[b.prelim_status ?? 'pending'] ?? PRELIM_STYLE.pending
            return (
              <div key={b.id} style={{ border: bd, borderRadius: 8, background: cardBg, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: bd, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: col, fontSize: 14 }}>{b.supplier_name}</span>
                  <span style={{ fontSize: 12, color: sub }}>· Round {b.round}</span>
                  {b.submitted_at && <span style={{ fontSize: 12, color: sub }}>· submitted {String(b.submitted_at).slice(0, 10)}</span>}
                  <span style={{ marginLeft: 'auto', background: pst.bg, color: pst.text, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999 }}>{pst.label}</span>
                </div>

                <div style={{ display: 'flex', gap: 18, padding: '12px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {fact('Technical docs', b.tech_doc_count > 0, b.tech_doc_count)}
                  {fact('Commercial docs', b.comm_doc_count > 0, b.comm_doc_count)}
                  {fact('Bid bond', !!b.bid_bond_provided)}
                  {/* Commercial envelope — sealed shows a lock and NO figure/placeholder */}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {sealed ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(148,163,184,0.15)', color: '#64748b', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 9999 }}>🔒 Sealed</span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 700, color: col }}>{fmtMoney(b.commercial_value, b.currency)}</span>
                        <span style={{ fontSize: 11, color: sub }}>unsealed by {who(b.unsealed_by)}{b.unsealed_at ? ` · ${String(b.unsealed_at).slice(0, 10)}` : ''}</span>
                      </span>
                    )}
                  </div>
                </div>

                {b.prelim_reason && <div style={{ padding: '0 14px 10px', fontSize: 12, color: '#b45309' }}>Prelim reason: {b.prelim_reason}</div>}

                {(canEdit || canUnseal) && (
                  <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderTop: bd }}>
                    {canEdit && <button disabled={busyId === b.id} onClick={() => runPrelim(b)} style={{ padding: '6px 12px', borderRadius: 6, border: bd, background: 'none', color: col, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{busyId === b.id ? 'Checking…' : 'Run prelim check'}</button>}
                    {sealed && canUnseal && <button onClick={() => setUnsealTarget(b)} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>🔓 Unseal commercial</button>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showSubmit && <SubmitBidModal dark={dark} projectId={projectId} tenderId={tenderId} onClose={() => setShowSubmit(false)} onSaved={() => { setShowSubmit(false); load() }} />}
      {unsealTarget && <UnsealModal dark={dark} projectId={projectId} tenderId={tenderId} bid={unsealTarget} onClose={() => setUnsealTarget(null)} onSaved={() => { setUnsealTarget(null); load() }} />}
    </div>
  )
}

// ─── SUBMIT BID MODAL ───────────────────────────────────────
function SubmitBidModal({ dark, projectId, tenderId, onClose, onSaved }: {
  dark: boolean; projectId: number; tenderId: number; onClose: () => void; onSaved: () => void
}) {
  const [suppliers, setSuppliers] = useState<Sup[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [round, setRound] = useState('1')
  const [submittedAt, setSubmittedAt] = useState('')
  const [currency, setCurrency] = useState('AUD')
  const [tech, setTech] = useState('0')
  const [comm, setComm] = useState('0')
  const [bond, setBond] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const inp: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 6, width: '100%', border: bd, background: dark ? '#0b1220' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const lbl = (t: string) => <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4, marginTop: 12 }}>{t}</div>

  useEffect(() => { axios.get(`${API}/admin/suppliers`).then(r => setSuppliers(Array.isArray(r.data) ? r.data : (r.data.rows ?? []))).catch(() => {}) }, [])

  const valid = supplierId && value !== '' && Number(value) >= 0
  const save = async () => {
    setSaving(true); setErr('')
    try {
      await axios.post(`${API}/pre-award/${projectId}/tenders/${tenderId}/bids`, {
        supplier_id: Number(supplierId), round: Number(round) || 1, submitted_at: submittedAt || null,
        currency: currency || 'AUD', tech_doc_count: Number(tech) || 0, comm_doc_count: Number(comm) || 0,
        bid_bond_provided: bond ? 1 : 0, commercial_value: Number(value),
      })
      onSaved()
    } catch (e) { setErr(axios.isAxiosError(e) ? (e.response?.data?.error ?? 'Could not submit.') : 'Could not submit.'); setSaving(false) }
  }

  return (
    <div onClick={() => !saving && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: cardBg, borderRadius: 12, padding: 24, width: 500, maxWidth: '94vw', border: bd, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: col }}>Submit a bid</div>
        <div style={{ fontSize: 12, color: sub, marginTop: 4 }}>The commercial value is <strong>sealed on submission</strong> — it stays hidden until an authorized unseal.</div>

        {lbl('Supplier')}
        <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={inp}>
          <option value="">Select a supplier…</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
        </select>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>{lbl('Round')}<input type="number" min={1} value={round} onChange={e => setRound(e.target.value)} style={inp} /></div>
          <div style={{ flex: 1 }}>{lbl('Submitted date')}<input type="date" value={submittedAt} onChange={e => setSubmittedAt(e.target.value)} style={inp} /></div>
          <div style={{ width: 90 }}>{lbl('Currency')}<input value={currency} onChange={e => setCurrency(e.target.value)} style={inp} /></div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>{lbl('Technical docs')}<input type="number" min={0} value={tech} onChange={e => setTech(e.target.value)} style={inp} /></div>
          <div style={{ flex: 1 }}>{lbl('Commercial docs')}<input type="number" min={0} value={comm} onChange={e => setComm(e.target.value)} style={inp} /></div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: col, height: 34, cursor: 'pointer' }}>
            <input type="checkbox" checked={bond} onChange={e => setBond(e.target.checked)} style={{ accentColor: '#2563eb' }} /> Bid bond
          </label>
        </div>

        {lbl('Commercial value (sealed)')}
        <input type="number" min={0} value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 4500000" style={inp} />

        {err && <div style={{ color: '#b91c1c', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button disabled={saving} onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button disabled={!valid || saving} onClick={save} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: valid ? '#2563eb' : '#94a3b8', color: '#fff', fontSize: 13, fontWeight: 600, cursor: valid ? 'pointer' : 'default', fontFamily: 'inherit' }}>{saving ? 'Submitting…' : 'Submit (sealed)'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── UNSEAL CONFIRMATION MODAL ──────────────────────────────
function UnsealModal({ dark, projectId, tenderId, bid, onClose, onSaved }: {
  dark: boolean; projectId: number; tenderId: number; bid: Bid; onClose: () => void; onSaved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'

  const confirm = async () => {
    setBusy(true); setErr('')
    try {
      await axios.post(`${API}/pre-award/${projectId}/tenders/${tenderId}/bids/${bid.id}/unseal`, {})
      onSaved()
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined
      setErr(axios.isAxiosError(e) && e.response?.data?.error ? `${e.response.data.error}${status ? ` (${status})` : ''}` : 'Could not unseal.')
      setBusy(false)
    }
  }

  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: cardBg, borderRadius: 12, padding: 24, width: 480, maxWidth: '94vw', border: bd }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: col, marginBottom: 8 }}>🔓 Unseal commercial envelope</div>
        <div style={{ fontSize: 13, color: dark ? '#fca5a5' : '#b91c1c', background: dark ? 'rgba(127,29,29,0.2)' : '#fef2f2', border: `1px solid ${dark ? '#7f1d1d' : '#fecaca'}`, borderRadius: 8, padding: '11px 13px', marginBottom: 16 }}>
          Unsealing reveals <strong>{bid.supplier_name}</strong>'s commercial value to everyone who can view this tender. <strong>This cannot be undone.</strong> Unsealing only <em>reveals</em> the figure — it does not score or evaluate the bid.
        </div>
        {err && <div style={{ color: '#b91c1c', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button disabled={busy} onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button disabled={busy} onClick={confirm} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>{busy ? 'Unsealing…' : 'Unseal (irreversible)'}</button>
        </div>
      </div>
    </div>
  )
}
