// ─── PRE-AWARD · SCOPE TAB ──────────────────────────────────
// Phase 3.x — the tender's MTO-line scope: which MTO lines (and how much of each)
// this tender reserves. Endpoints:
//   GET  /:projectId/tenders/:id/scope           (can_view)  own reservations (incl. per-line award outcome) + registers + po + award
//   GET  /:projectId/tenders/:id/available-lines (can_view)  picker: a register's lines + availability
//   POST /:projectId/tenders/:id/reserve-lines   (can_edit)  reserve { lines:[{mto_line_id, qty_reserved}] }
//
// HONESTY CONSTRAINTS (no fake affordances):
// • Existing reservations are READ-ONLY here. There is no edit/remove endpoint —
//   "modifying a reservation is a separate action" (reserve-lines 409s a re-reserve) —
//   so this tab shows them but offers no edit/delete control it cannot honour.
// • Availability shown is the SAME getAvailableQty the reserve path enforces under lock;
//   it is advisory only in the sense that the reserve call re-checks it and 422s if it moved.
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { API } from '../lib/api'

const CAN_EDIT = ['admin', 'procurement_manager', 'procurement_officer', 'project_manager']  // mirrors reserve-lines' can_edit

interface Availability { line_id: number; total_qty: number | null; po_assigned: number; reserved: number; available: number | null }
interface Reservation {
  tli_id: number; mto_line_id: number; qty_reserved: string | number; status: string
  line_number: string; description: string; uom: string | null; mto_id: number; mto_reference: string
  availability: Availability | null
  // award outcome (GET /scope): stored at award by generate-po; NULL while active
  qty_awarded: string | number | null; qty_released: string | number | null
  released_at: string | null; released_reason: string | null
}
interface LinkedPo { id: number; po_number: string; vendor_name: string | null }
interface Award { recommended_bid_id: number; supplier_name: string; legacy: boolean }
interface Register { id: number; name: string; reference: string; current_revision: string }
interface PickerLine {
  id: number; line_number: string; description: string; quantity: string | number | null; uom: string | null
  wbs_code: string | null; status: string; inspection_class: string | null; vdrl_required: number
  total_qty: number | null; po_assigned: number; reserved: number; available: number | null
  reserved_by_this_tender: boolean
}

const fmtQty = (v: string | number | null | undefined) => {
  if (v == null || v === '') return '—'
  const n = Number(v); if (!isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

// Outcome tags. Partial awards are AMBER (distinct from a plain release); a released line with
// qty_awarded 0 was considered and not awarded, with NULL it was released without an award.
const AMBER = { bg: 'rgba(245,158,11,0.16)', text: '#b45309', edge: '#f59e0b' }
const tagFor = (r: { status: string; qty_awarded: string | number | null }) =>
  r.status === 'active'           ? { bg: 'rgba(37,99,235,0.14)',  text: '#1d4ed8', label: 'Active' }
  : r.status === 'converted'      ? { bg: 'rgba(34,197,94,0.16)',  text: '#15803d', label: 'Awarded in full' }
  : r.status === 'partial_released' ? { bg: AMBER.bg, text: AMBER.text, label: 'Partially awarded' }
  : r.status === 'released'       ? { bg: 'rgba(148,163,184,0.18)', text: '#64748b', label: r.qty_awarded != null ? 'Not awarded' : 'Released' }
  : { bg: 'rgba(148,163,184,0.18)', text: '#64748b', label: r.status }

export function PreAwardScopeTab({ dark, projectId, tenderId, userRole }: {
  dark: boolean; projectId: number; tenderId: number; userRole: string
}) {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [registers, setRegisters] = useState<Register[]>([])
  const [po, setPo] = useState<LinkedPo | null>(null)
  const [award, setAward] = useState<Award | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const canEdit = CAN_EDIT.includes(userRole)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data } = await axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/scope`)
      setReservations(data.reservations ?? [])
      setRegisters(data.registers ?? [])
      setPo(data.po ?? null)
      setAward(data.award ?? null)
    } catch { setErr('Could not load the tender scope.') } finally { setLoading(false) }
  }, [projectId, tenderId])
  useEffect(() => { load() }, [load])

  const pill = (r: Reservation) => {
    const s = tagFor(r)
    return <span style={{ background: s.bg, color: s.text, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 9999 }}>{s.label}</span>
  }
  const awardedRows = reservations.filter(r => r.status !== 'active')
  const nFull = awardedRows.filter(r => r.status === 'converted').length
  const nPartial = awardedRows.filter(r => r.status === 'partial_released').length
  const nNone = awardedRows.filter(r => r.status === 'released').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ border: bd, borderRadius: 8, background: cardBg, padding: '16px 16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: col }}>Reserved MTO lines</div>
          {canEdit && (
            <button onClick={() => setShowAdd(true)}
              style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Add lines to scope
            </button>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: sub, marginBottom: 14, lineHeight: 1.5 }}>
          The MTO lines and quantities this tender reserves. Reserving holds that quantity so other tenders and POs
          can’t claim it. Reservations are a permanent record — they can’t be edited or removed here. At award, each
          line converts to the quantity the winning bid proposed, and any shortfall is released back to the MTO line’s
          available quantity.
        </div>

        {/* Award outcome header — once the tender has been handed off to a PO */}
        {!loading && po && (
          <div style={{ border: `1px solid ${dark ? '#166534' : '#bbf7d0'}`, background: dark ? 'rgba(34,197,94,0.08)' : '#f0fdf4', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: col }}>
              Awarded to PO <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>{po.po_number}</strong>{po.vendor_name ? <> · {po.vendor_name}</> : null}
            </div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>
              {nFull} line{nFull === 1 ? '' : 's'} awarded in full · {nPartial} partially awarded · {nNone} not awarded
              {award?.legacy ? ' (the winning bid had no per-line quantities, so every line converted in full)' : ''}
            </div>
          </div>
        )}

        {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{err} <button onClick={load} style={{ background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Retry</button></div>}

        {loading ? <div style={{ color: sub, fontSize: 13, padding: '8px 0' }}>Loading…</div> : (
          reservations.length === 0 ? (
            <div style={{ fontSize: 12.5, color: sub, padding: '12px 0' }}>
              No MTO lines reserved yet.{canEdit ? ' Use “Add lines to scope” to reserve line quantities for this tender.' : ''}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reservations.map(r => {
                const partial = r.status === 'partial_released'
                const awarded = r.status !== 'active'
                const fig = (label: string, v: string | number | null, strong?: string) => (
                  <div style={{ textAlign: 'right', minWidth: 58 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: strong ?? col }}>{fmtQty(v)}</div>
                    <div style={{ fontSize: 10, color: sub, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                  </div>
                )
                return (
                  <div key={r.tli_id} data-outcome={r.status} style={{
                    display: 'flex', gap: 12, padding: '12px 14px', border: bd, borderRadius: 8,
                    background: partial ? (dark ? 'rgba(245,158,11,0.08)' : '#fffbeb') : (dark ? 'rgba(148,163,184,0.05)' : '#f8fafc'),
                    borderLeft: partial ? `4px solid ${AMBER.edge}` : undefined,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, fontWeight: 700, color: '#E84E0F' }}>{r.mto_reference} · {r.line_number}</span>
                        {pill(r)}
                      </div>
                      <div style={{ fontSize: 13, color: col, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description}</div>
                      {r.status === 'active' && r.availability && (
                        <div style={{ fontSize: 11.5, color: sub, marginTop: 3 }}>
                          Line total {fmtQty(r.availability.total_qty)} · {fmtQty(r.availability.available)} still available across all tenders/POs
                        </div>
                      )}
                      {partial && (
                        <div data-released-callout="" style={{ fontSize: 12, fontWeight: 600, color: AMBER.text, marginTop: 4 }}>
                          {fmtQty(r.qty_awarded)} of {fmtQty(r.qty_reserved)} awarded · {fmtQty(r.qty_released)}{r.uom ? ` ${r.uom}` : ''} released back to the MTO line’s available quantity
                        </div>
                      )}
                      {awarded && r.released_reason && (
                        <div style={{ fontSize: 11, color: sub, marginTop: 3, fontStyle: 'italic' }}>{r.released_reason}</div>
                      )}
                    </div>
                    {awarded ? (
                      <div style={{ display: 'flex', gap: 14, flexShrink: 0, alignItems: 'flex-start' }}>
                        {fig('Reserved', r.qty_reserved)}
                        {fig('Awarded', r.qty_awarded, r.status === 'converted' ? '#15803d' : partial ? AMBER.text : undefined)}
                        {fig('Released', r.qty_released, Number(r.qty_released) > 0 ? (partial ? AMBER.text : '#64748b') : undefined)}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: col }}>{fmtQty(r.qty_reserved)}</div>
                        <div style={{ fontSize: 10.5, color: sub }}>{r.uom || 'reserved'}</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      {showAdd && (
        <AddLinesModal dark={dark} projectId={projectId} tenderId={tenderId} registers={registers}
          onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load() }} />
      )}
    </div>
  )
}

function AddLinesModal({ dark, projectId, tenderId, registers, onClose, onDone }: {
  dark: boolean; projectId: number; tenderId: number; registers: Register[]
  onClose: () => void; onDone: () => void
}) {
  const [mtoId, setMtoId] = useState<number | ''>(registers[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [lines, setLines] = useState<PickerLine[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(25)
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  const [qty, setQty] = useState<Record<number, string>>({})   // mto_line_id -> input string
  const [busy, setBusy] = useState(false)
  const [submitErr, setSubmitErr] = useState('')

  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const inputBg = dark ? '#0b1220' : '#f8fafc'

  const fetchLines = useCallback(async () => {
    if (mtoId === '') { setLines([]); setTotal(0); return }
    setLoading(true); setLoadErr('')
    try {
      const { data } = await axios.get(`${API}/pre-award/${projectId}/tenders/${tenderId}/available-lines`, {
        params: { mtoId, page, search: search.trim() || undefined },
      })
      setLines(data.data ?? []); setTotal(data.total ?? 0); setLimit(data.limit ?? 25)
    } catch { setLoadErr('Could not load lines for this register.') } finally { setLoading(false) }
  }, [projectId, tenderId, mtoId, page, search])
  useEffect(() => { fetchLines() }, [fetchLines])

  // reset to page 1 when register or search changes
  useEffect(() => { setPage(1) }, [mtoId, search])

  const selected = Object.entries(qty)
    .map(([id, v]) => ({ mto_line_id: Number(id), qty_reserved: Number(v) }))
    .filter(l => l.qty_reserved > 0)

  const submit = async () => {
    if (selected.length === 0) return
    setBusy(true); setSubmitErr('')
    try {
      await axios.post(`${API}/pre-award/${projectId}/tenders/${tenderId}/reserve-lines`, { lines: selected })
      onDone()
    } catch (e) {
      const s = axios.isAxiosError(e) ? e.response?.status : undefined
      setSubmitErr(axios.isAxiosError(e) && e.response?.data?.error ? `${e.response.data.error}${s ? ` (${s})` : ''}` : 'Could not reserve the selected lines.')
      setBusy(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: cardBg, borderRadius: 12, padding: 22, width: 720, maxWidth: '96vw', maxHeight: '90vh', border: bd, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: col, marginBottom: 4 }}>Add lines to scope</div>
        <div style={{ fontSize: 12.5, color: sub, marginBottom: 14 }}>Pick an MTO register, then enter the quantity to reserve on each line. Availability is the quantity not already reserved by another tender or consumed by a PO.</div>

        {/* Register + search */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <select value={mtoId} onChange={e => setMtoId(e.target.value ? Number(e.target.value) : '')}
            style={{ padding: '8px 10px', borderRadius: 6, border: bd, background: inputBg, color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', minWidth: 220 }}>
            {registers.length === 0 && <option value="">No MTO registers in this project</option>}
            {registers.map(r => <option key={r.id} value={r.id}>{r.reference} — {r.name} (rev {r.current_revision})</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search line no. / description / WBS"
            style={{ flex: 1, minWidth: 200, padding: '8px 10px', borderRadius: 6, border: bd, background: inputBg, color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
        </div>

        {/* Lines */}
        <div style={{ flex: 1, overflowY: 'auto', border: bd, borderRadius: 8 }}>
          {loadErr && <div style={{ color: '#b91c1c', fontSize: 13, padding: 14 }}>{loadErr} <button onClick={fetchLines} style={{ background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Retry</button></div>}
          {!loadErr && loading && <div style={{ color: sub, fontSize: 13, padding: 14 }}>Loading lines…</div>}
          {!loadErr && !loading && lines.length === 0 && <div style={{ color: sub, fontSize: 13, padding: 14 }}>No lines match.</div>}
          {!loadErr && !loading && lines.map(l => {
            const already = l.reserved_by_this_tender
            const none = l.available != null && l.available <= 0
            const disabled = already || none
            return (
              <div key={l.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', borderBottom: bd, opacity: disabled ? 0.6 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: col }}>{l.line_number}</span>
                    {already && <span style={{ background: 'rgba(37,99,235,0.14)', color: '#1d4ed8', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9999 }}>Already reserved</span>}
                    {!already && none && <span style={{ background: 'rgba(148,163,184,0.18)', color: '#64748b', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9999 }}>None available</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: sub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.description}>{l.description}</div>
                </div>
                <div style={{ textAlign: 'right', width: 130, flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: col }}>{fmtQty(l.available)} <span style={{ fontSize: 10.5, color: sub, fontWeight: 400 }}>{l.uom || ''}</span></div>
                  <div style={{ fontSize: 10.5, color: sub }}>of {fmtQty(l.total_qty)} available</div>
                </div>
                <input type="number" min="0" step="any" disabled={disabled}
                  value={qty[l.id] ?? ''} onChange={e => setQty(q => ({ ...q, [l.id]: e.target.value }))}
                  placeholder="qty" title={already ? 'This tender already reserves this line' : none ? 'Nothing available to reserve' : 'Quantity to reserve'}
                  style={{ width: 84, flexShrink: 0, padding: '7px 8px', borderRadius: 6, border: bd, background: disabled ? (dark ? '#111827' : '#eef2f7') : inputBg, color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', textAlign: 'right' }} />
              </div>
            )
          })}
        </div>

        {/* Pagination */}
        {total > limit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, fontSize: 12.5, color: sub }}>
            <button disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}
              style={{ padding: '5px 10px', borderRadius: 6, border: bd, background: 'none', color: col, fontSize: 12.5, cursor: page <= 1 ? 'default' : 'pointer', fontFamily: 'inherit', opacity: page <= 1 ? 0.5 : 1 }}>Prev</button>
            <span>Page {page} of {totalPages} · {total} lines</span>
            <button disabled={page >= totalPages || loading} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              style={{ padding: '5px 10px', borderRadius: 6, border: bd, background: 'none', color: col, fontSize: 12.5, cursor: page >= totalPages ? 'default' : 'pointer', fontFamily: 'inherit', opacity: page >= totalPages ? 0.5 : 1 }}>Next</button>
          </div>
        )}

        {submitErr && <div style={{ color: '#b91c1c', fontSize: 12.5, marginTop: 12 }}>{submitErr}</div>}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: sub }}>{selected.length === 0 ? 'No lines selected' : `${selected.length} line${selected.length > 1 ? 's' : ''} to reserve`}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy} onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button disabled={busy || selected.length === 0} onClick={submit}
              style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: selected.length === 0 ? '#64748b' : '#15803d', color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy || selected.length === 0 ? 'default' : 'pointer', fontFamily: 'inherit', opacity: selected.length === 0 ? 0.6 : 1 }}>
              {busy ? 'Reserving…' : 'Reserve selected lines'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
