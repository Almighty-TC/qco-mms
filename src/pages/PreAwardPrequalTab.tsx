// ─── PRE-AWARD · PREQUALIFICATION TAB ───────────────────────
// Phase 3.1b. Project-scoped prequalifications (tender_prequalifications),
// FILTERED to the current tender's discipline (mismatched suppliers hidden).
// Backed by the real Phase 2.2 endpoints:
//   GET   /:projectId/prequalifications?discipline=…   (can_view)
//   POST  /:projectId/prequalifications                (can_create) → forces round_status 'pending'
//   PATCH /:projectId/prequalifications/:id            (can_approve) → terminal outcome only
//
// KEY DESIGN (Phase 2.2): a supplier's GLOBAL avl_status is SEPARATE from this
// project's per-round round_status. Both are shown, in distinct columns, and a
// banner makes the project-wide scope of a decision explicit.
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { API } from '../lib/api'

// Client-side action visibility mirrors the pre_award role_permissions seed
// (server is the real gate — requireLivePermission enforces regardless).
const SUBMIT_ROLES = ['admin', 'procurement_manager', 'procurement_officer', 'project_manager']  // can_create
const DECIDE_ROLES = ['admin', 'procurement_manager', 'procurement_officer', 'project_director']  // can_approve

// GLOBAL supplier standing (suppliers.avl_status) — muted/outline palette.
const AVL_STYLE: Record<string, { bg: string; text: string }> = {
  approved:   { bg: 'rgba(34,197,94,0.10)',  text: '#15803d' },
  conditional:{ bg: 'rgba(245,158,11,0.10)', text: '#b45309' },
  pending:    { bg: 'rgba(148,163,184,0.12)', text: '#64748b' },
  suspended:  { bg: 'rgba(234,88,12,0.10)',  text: '#c2410c' },
  rejected:   { bg: 'rgba(239,68,68,0.10)',  text: '#b91c1c' },
}
// THIS project's round outcome (tender_prequalifications.round_status) — filled palette.
const ROUND_STYLE: Record<string, { bg: string; text: string }> = {
  pending:       { bg: 'rgba(37,99,235,0.14)',  text: '#1d4ed8' },
  qualified:     { bg: 'rgba(34,197,94,0.16)',  text: '#15803d' },
  conditional:   { bg: 'rgba(245,158,11,0.16)', text: '#b45309' },
  not_qualified: { bg: 'rgba(239,68,68,0.16)',  text: '#b91c1c' },
}
const humanise = (v: string | null) => !v ? '—' : v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const fmtDate = (v: string | null) => v ? String(v).slice(0, 10) : '—'

interface Prequal {
  id: number
  supplier_id: number
  supplier_name: string
  supplier_code: string
  avl_status: string
  category: string
  discipline: string | null
  round_status: string
  valid_from: string | null
  valid_to: string | null
  notes: string | null
}
interface Supplier { id: number; name: string; code: string }
type Outcome = 'qualified' | 'conditional' | 'not_qualified'

export function PreAwardPrequalTab({ dark, projectId, discipline, userRole }: {
  dark: boolean; projectId: number; discipline: string | null; userRole: string
}) {
  const [rows,    setRows]    = useState<Prequal[]>([])
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState('')
  const [showForm, setShowForm] = useState(false)
  const [decide,  setDecide]  = useState<{ row: Prequal; outcome: Outcome } | null>(null)
  const [busy,    setBusy]    = useState(false)

  const canSubmit = SUBMIT_ROLES.includes(userRole)
  const canDecide = DECIDE_ROLES.includes(userRole)

  const col  = dark ? '#f1f5f9' : '#0f172a'
  const sub  = '#94a3b8'
  const bd   = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const rowBd = `1px solid ${dark ? '#1e293b' : '#eef2f7'}`
  const cardBg = dark ? '#0f172a' : '#fff'

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const params: Record<string, string | number> = { limit: 1000 }
      if (discipline) params.discipline = discipline
      const { data } = await axios.get(`${API}/pre-award/${projectId}/prequalifications`, { params })
      setRows(Array.isArray(data) ? data : (data.rows ?? []))
    } catch (e) {
      const s = axios.isAxiosError(e) ? e.response?.status : undefined
      setErr(s === 403 ? 'You do not have permission to view prequalifications.' : 'Could not load prequalifications.')
      setRows([])
    } finally { setLoading(false) }
  }, [projectId, discipline])
  useEffect(() => { load() }, [load])

  const applyDecision = async () => {
    if (!decide) return
    setBusy(true)
    try {
      await axios.patch(`${API}/pre-award/${projectId}/prequalifications/${decide.row.id}`, { round_status: decide.outcome })
      setDecide(null); await load()
    } catch (e) {
      const s = axios.isAxiosError(e) ? e.response?.status : undefined
      alert(s === 403 ? 'Your role cannot decide prequalifications.' : 'Could not apply the decision.')
    } finally { setBusy(false) }
  }

  const badge = (label: string, sty: { bg: string; text: string }, outline = false) => (
    <span style={{
      background: outline ? 'transparent' : sty.bg, color: sty.text,
      border: outline ? `1px solid ${sty.text}55` : 'none',
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, whiteSpace: 'nowrap',
    }}>{label}</span>
  )
  const th: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: bd, textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 10px', fontSize: 13, color: col, borderBottom: rowBd, verticalAlign: 'top' }

  return (
    <div>
      {/* Project-wide scope banner — the explicit shared-data indicator */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', borderRadius: 8,
        border: `1px solid ${dark ? '#3f3f14' : '#fde68a'}`, background: dark ? 'rgba(120,113,20,0.15)' : '#fffbeb',
        color: dark ? '#fde68a' : '#92610a', fontSize: 12.5, marginBottom: 16 }}>
        <span style={{ fontSize: 15, lineHeight: 1 }}>🏷️</span>
        <span>Prequalification is managed at the <strong>project level</strong>. Registering or deciding a supplier here
          affects their standing across <strong>every tender in this project</strong> — not just this one. It does
          not change the supplier's organisation-wide AVL status (shown separately below).</span>
      </div>

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: sub }}>
          {loading ? 'Loading…' : `${rows.length} prequalification${rows.length !== 1 ? 's' : ''}`}
          {discipline && <> · discipline <strong style={{ color: col }}>{humanise(discipline)}</strong> only</>}
        </div>
        {canSubmit && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Register supplier
          </button>
        )}
      </div>

      {err && (
        <div style={{ padding: '12px 14px', borderRadius: 8, border: `1px solid ${dark ? '#7f1d1d' : '#fecaca'}`, background: dark ? 'rgba(127,29,29,0.2)' : '#fef2f2', color: dark ? '#fca5a5' : '#b91c1c', fontSize: 13, marginBottom: 12 }}>
          {err} <button onClick={load} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#E84E0F', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>Retry</button>
        </div>
      )}

      {!err && (
        <div style={{ border: bd, borderRadius: 8, overflow: 'hidden', background: cardBg }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Supplier</th>
                  <th style={th}>Category</th>
                  <th style={th}>AVL Status<div style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: sub, fontSize: 9.5 }}>organisation-wide</div></th>
                  <th style={th}>Round Outcome<div style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: sub, fontSize: 9.5 }}>this project</div></th>
                  <th style={th}>Valid</th>
                  <th style={th}>Notes</th>
                  {canDecide && <th style={th}>Decide</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={canDecide ? 7 : 6} style={{ padding: '26px 14px', textAlign: 'center', color: sub, fontSize: 13 }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={canDecide ? 7 : 6} style={{ padding: '26px 14px', textAlign: 'center', color: sub, fontSize: 13 }}>No prequalifications for this discipline yet.</td></tr>
                ) : rows.map(r => {
                  const avl = AVL_STYLE[r.avl_status] ?? AVL_STYLE.pending
                  const rnd = ROUND_STYLE[r.round_status] ?? ROUND_STYLE.pending
                  return (
                    <tr key={r.id}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{r.supplier_name}</div>
                        <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: sub }}>{r.supplier_code}</div>
                      </td>
                      <td style={{ ...td, color: sub }}>{r.category}</td>
                      <td style={td}>{badge(humanise(r.avl_status), avl, true)}</td>
                      <td style={td}>{badge(humanise(r.round_status), rnd)}</td>
                      <td style={{ ...td, color: sub, whiteSpace: 'nowrap' }}>{fmtDate(r.valid_from)} – {fmtDate(r.valid_to)}</td>
                      <td style={{ ...td, color: sub, maxWidth: 220 }}>{r.notes || '—'}</td>
                      {canDecide && (
                        <td style={td}>
                          {r.round_status === 'pending' ? (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => setDecide({ row: r, outcome: 'qualified' })} title="Qualify"
                                style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #15803d55', background: 'transparent', color: '#15803d', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Qualify</button>
                              <button onClick={() => setDecide({ row: r, outcome: 'conditional' })} title="Conditional"
                                style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #b4530955', background: 'transparent', color: '#b45309', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Conditional</button>
                              <button onClick={() => setDecide({ row: r, outcome: 'not_qualified' })} title="Not qualified"
                                style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #b91c1c55', background: 'transparent', color: '#b91c1c', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Reject</button>
                            </div>
                          ) : (
                            <span style={{ fontSize: 11, color: sub }}>decided</span>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && <SubmitModal dark={dark} projectId={projectId} discipline={discipline} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load() }} />}

      {/* Decide confirmation — restates the project-wide scope explicitly */}
      {decide && (
        <div onClick={() => !busy && setDecide(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: cardBg, borderRadius: 12, padding: 24, width: 460, maxWidth: '92vw', border: bd }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: col, marginBottom: 8 }}>Decide prequalification</div>
            <div style={{ fontSize: 13, color: col, marginBottom: 6 }}>
              Set <strong>{decide.row.supplier_name}</strong> as <strong>{humanise(decide.outcome)}</strong> for category <strong>{decide.row.category}</strong>?
            </div>
            <div style={{ fontSize: 12.5, color: dark ? '#fde68a' : '#92610a', background: dark ? 'rgba(120,113,20,0.15)' : '#fffbeb', border: `1px solid ${dark ? '#3f3f14' : '#fde68a'}`, borderRadius: 8, padding: '10px 12px', margin: '10px 0 16px' }}>
              This applies to the supplier across <strong>the whole project</strong> (every tender), not just this one. It does not change their organisation-wide AVL status.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button disabled={busy} onClick={() => setDecide(null)} style={{ padding: '8px 14px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button disabled={busy} onClick={applyDecision} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{busy ? 'Applying…' : 'Confirm decision'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── SUBMIT MODAL ───────────────────────────────────────────
function SubmitModal({ dark, projectId, discipline, onClose, onSaved }: {
  dark: boolean; projectId: number; discipline: string | null; onClose: () => void; onSaved: () => void
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [category, setCategory] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const col = dark ? '#f1f5f9' : '#0f172a'
  const sub = '#94a3b8'
  const bd  = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const cardBg = dark ? '#0f172a' : '#fff'
  const inp: React.CSSProperties = { height: 34, padding: '0 10px', borderRadius: 6, width: '100%', border: bd, background: dark ? '#0b1220' : '#f8fafc', color: col, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const label = (t: string) => <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4, marginTop: 12 }}>{t}</div>

  useEffect(() => { axios.get(`${API}/admin/suppliers`).then(r => setSuppliers(Array.isArray(r.data) ? r.data : (r.data.rows ?? []))).catch(() => {}) }, [])

  const valid = supplierId && category.trim()
  const save = async () => {
    setSaving(true); setErr('')
    try {
      await axios.post(`${API}/pre-award/${projectId}/prequalifications`, {
        supplier_id: Number(supplierId), category: category.trim(),
        discipline: discipline || null,
        valid_from: validFrom || null, valid_to: validTo || null, notes: notes.trim() || null,
      })
      onSaved()
    } catch (e) {
      setErr(axios.isAxiosError(e) ? (e.response?.data?.error ?? 'Could not register.') : 'Could not register.')
      setSaving(false)
    }
  }

  return (
    <div onClick={() => !saving && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: cardBg, borderRadius: 12, padding: 24, width: 480, maxWidth: '94vw', border: bd, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: col }}>Register a supplier for prequalification</div>
        <div style={{ fontSize: 12, color: sub, marginTop: 4 }}>Discipline is fixed to this tender's discipline. The entry starts as <strong>Pending</strong> until decided.</div>

        {label('Supplier')}
        <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={inp}>
          <option value="">Select a supplier…</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
        </select>

        {label('Category')}
        <input value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. MV Switchgear" style={inp} />

        {label('Discipline')}
        <input value={humanise(discipline)} disabled style={{ ...inp, opacity: 0.7, cursor: 'not-allowed' }} />

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>{label('Valid from')}<input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} style={inp} /></div>
          <div style={{ flex: 1 }}>{label('Valid to')}<input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} style={inp} /></div>
        </div>

        {label('Notes')}
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, height: 'auto', padding: '8px 10px' }} />

        {err && <div style={{ color: '#b91c1c', fontSize: 12.5, marginTop: 10 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button disabled={saving} onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, border: bd, background: 'none', color: sub, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button disabled={!valid || saving} onClick={save} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: valid ? '#2563eb' : '#94a3b8', color: '#fff', fontSize: 13, fontWeight: 600, cursor: valid ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>{saving ? 'Registering…' : 'Register'}</button>
        </div>
      </div>
    </div>
  )
}
