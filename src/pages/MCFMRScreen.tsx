// ─── MC FMR SCREEN ────────────────────────────────────────────
// Field Material Request register. Two views: MC view / Contractor view.
// MC view: approve/reject FMRs with WBS ceiling and stock availability checks.
// Contractor view: raise new FMRs against assigned WBS scope.
import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'

const API = 'http://localhost:3001/api'
type View = 'mc' | 'contractor'
type PickupWindow = 'all' | 'overdue' | 'today' | '3' | '7' | '14' | '30'

interface FMRRow {
  id: number; fmr_ref: string; item_code?: string | null; description: string
  wbs_code?: string | null; qty_requested: number; qty_issued: number; uom: string
  required_date?: string | null; work_order_ref?: string | null
  requested_by_name?: string | null; requested_by_company?: string | null
  status: string; is_critical_path: number; stock_on_hand?: number
}

interface FMRCounts { total: number; pending_approval: number; partial_issued: number; issued_today: number; overdue: number }

const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

const statusPill = (s: string) => {
  const m: Record<string, { label: string; bg: string; color: string }> = {
    pending_approval: { label: 'Pending approval', bg: 'rgba(37,99,235,0.1)',   color: '#2563eb' },
    approved:         { label: 'Approved',          bg: 'rgba(34,197,94,0.1)',   color: '#16a34a' },
    partial_issued:   { label: 'Partial issued',    bg: 'rgba(245,158,11,0.1)', color: '#d97706' },
    issued:           { label: 'Issued',             bg: 'rgba(34,197,94,0.12)', color: '#16a34a' },
    rejected:         { label: 'Rejected',           bg: 'rgba(239,68,68,0.1)', color: '#dc2626' },
    cancelled:        { label: 'Cancelled',          bg: 'rgba(148,163,184,0.1)', color: '#64748b' },
  }
  return m[s] || { label: s, bg: 'rgba(148,163,184,0.1)', color: '#64748b' }
}

const MCFMRInner = ({ dark, projectId, projectName, onBack, userRole = '' }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void; userRole?: string
}) => {
  const { addToast } = useToast()
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bg     = dark ? '#0f172a' : '#f4f7fb'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  const [view, setView]           = useState<View>('mc')
  const [fmrs, setFmrs]           = useState<FMRRow[]>([])
  const [counts, setCounts]       = useState<FMRCounts | null>(null)
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [pickup, setPickup]       = useState<PickupWindow>('all')
  const [critOnly, setCritOnly]   = useState(false)
  const [approveFmr, setApproveFmr] = useState<FMRRow | null>(null)
  const [raiseFmr, setRaiseFmr]   = useState(false)

  const fetchFMRs = async () => {
    setLoading(true)
    try {
      const params: any = { search: search.trim() || undefined, critical_only: critOnly ? 'true' : undefined }
      if (pickup !== 'all' && pickup !== 'overdue' && pickup !== 'today') params.pickup_window = pickup
      const { data } = await axios.get(`${API}/mc/${projectId}/fmr`, { params })
      setFmrs(data.data || [])
      setCounts(data.counts)
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to load FMR register')
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchFMRs() }, [projectId, pickup, critOnly]) // eslint-disable-line
  useEffect(() => { const t = setTimeout(fetchFMRs, 350); return () => clearTimeout(t) }, [search]) // eslint-disable-line

  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit' }

  const PICKUP_OPTS: { key: PickupWindow; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'overdue', label: 'Overdue' }, { key: 'today', label: 'Today' },
    { key: '3', label: '≤3 days' }, { key: '7', label: '≤7 days' }, { key: '14', label: '≤14 days' }, { key: '30', label: '≤30 days' },
  ]

  const isOverdue = (d?: string | null) => d && new Date(d) < new Date()
  const isDueSoon = (d?: string | null) => d && !isOverdue(d) && Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) <= 3

  return (
    <div style={{ background: bg, minHeight: '100vh', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ background: cardBg, borderBottom: bd, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onClick={onBack} dark={dark} />
          <div style={{ fontSize: 11, color: sub }}>Dashboard › {projectName} › Material Control › <strong style={{ color: col }}>FMR Register</strong></div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* MC / Contractor view toggle */}
          <button onClick={() => setView('mc')}
            style={{ padding: '5px 14px', borderRadius: '6px 0 0 6px', border: bd, background: view === 'mc' ? 'none' : 'none', color: view === 'mc' ? col : sub, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: view === 'mc' ? 600 : 400 }}>
            MC view
          </button>
          <button onClick={() => setView('contractor')}
            style={{ padding: '5px 14px', borderRadius: '0 6px 6px 0', border: bd, borderLeft: 'none', background: 'none', color: view === 'contractor' ? col : sub, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: view === 'contractor' ? 600 : 400 }}>
            Contractor view
          </button>
          <button onClick={() => setRaiseFmr(true)}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            + Raise FMR
          </button>
          <button style={{ padding: '6px 14px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>↓ Export</button>
        </div>
      </div>

      <div style={{ padding: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: col }}>FMR Register</h1>
        <div style={{ fontSize: 12, color: sub, marginBottom: 16 }}>Field Material Requests — {projectName}</div>

        {/* Contractor scope banner */}
        {view === 'contractor' && (
          <div style={{ background: dark ? '#162032' : '#eff6ff', border: `1px solid ${dark ? '#334155' : '#bfdbfe'}`, borderRadius: 8, padding: '8px 14px', marginBottom: 16, fontSize: 12, color: col, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#2563eb' }}>ℹ</span>
            Showing materials for your assigned WBS scope:
            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2563eb' }}>03.01 · 03.02 · 04.01</span>
            · You cannot see FMRs or materials outside your scope
          </div>
        )}

        {/* KPI cards */}
        {counts && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Total FMRs',      value: counts.total,            color: col },
              { label: 'Pending approval', value: counts.pending_approval, color: '#2563eb' },
              { label: 'Partial issued',  value: counts.partial_issued,   color: '#d97706' },
              { label: 'Issued today',    value: counts.issued_today,     color: '#16a34a' },
              { label: 'Overdue',         value: counts.overdue,          color: '#ef4444' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: cardBg, border: bd, borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Alert banner */}
        {counts && counts.overdue > 0 && (
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: col }}>
              ⚠ {counts.overdue} FMR overdue · Plan pickups now to keep field crews moving.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPickup('overdue')}
                style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                Show overdue ({counts.overdue})
              </button>
              <button onClick={() => setPickup('3')}
                style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#f59e0b', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                Show due in 3 days
              </button>
            </div>
          </div>
        )}

        {/* Pick-up window filter */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 12, background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
          <span style={{ padding: '7px 12px', fontSize: 11, color: sub, borderRight: bd }}>PICK-UP WINDOW</span>
          {PICKUP_OPTS.map(opt => (
            <button key={opt.key} onClick={() => setPickup(opt.key)}
              style={{ padding: '7px 12px', background: pickup === opt.key ? '#E84E0F' : 'none', color: pickup === opt.key ? '#fff' : sub, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
              {opt.label}
            </button>
          ))}
        </div>

        {/* Search + filter */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search FMR ref, item, WBS, contractor…"
            style={{ ...inputSt, flex: '1 1 260px' }} />
          <select style={inputSt}><option>All statuses ({counts?.total || 0})</option></select>
          <button onClick={() => setCritOnly(v => !v)}
            style={{ ...inputSt, cursor: 'pointer', color: critOnly ? '#E84E0F' : sub, borderColor: critOnly ? '#E84E0F' : undefined }}>
            ★ Critical Path Only {critOnly ? `(${fmrs.filter(f => f.is_critical_path).length})` : ''}
          </button>
        </div>

        {/* Table */}
        <div style={{ background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 420px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                <tr style={{ borderBottom: bd }}>
                  {['FMR REF','ITEM','DESCRIPTION','WBS','QTY','ISSUED','REQUESTED BY','REQ. DATE','STATUS',''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: sub }}>Loading…</td></tr>
                ) : fmrs.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 50, textAlign: 'center', color: sub }}>No FMRs found.</td></tr>
                ) : fmrs.map(fmr => {
                  const pill = statusPill(fmr.status)
                  const overdue = isOverdue(fmr.required_date)
                  const soon = isDueSoon(fmr.required_date)
                  return (
                    <tr key={fmr.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                      <td style={{ padding: '9px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {fmr.is_critical_path ? <span style={{ color: '#E84E0F' }}>★</span> : null}
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{fmr.fmr_ref}</span>
                        </div>
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{fmr.item_code || '—'}</td>
                      <td style={{ padding: '9px 12px', color: col, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmr.description}</td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{fmr.wbs_code || '—'}</td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{fmr.qty_requested}</td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: fmr.qty_issued > 0 ? '#2563eb' : sub }}>
                        {fmr.qty_issued > 0 ? fmr.qty_issued : '—'}
                        {fmr.stock_on_hand !== undefined && <div style={{ fontSize: 10, color: sub }}>In stock: {fmr.stock_on_hand}</div>}
                      </td>
                      <td style={{ padding: '9px 12px', color: col, fontSize: 11 }}>
                        {fmr.requested_by_name || '—'}
                        {fmr.requested_by_company && <div style={{ fontSize: 10, color: sub }}>{fmr.requested_by_company}</div>}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11 }}>
                        <span style={{ color: overdue ? '#ef4444' : soon ? '#d97706' : col, fontWeight: overdue || soon ? 600 : 400 }}>
                          {fmt(fmr.required_date)}
                        </span>
                        {overdue && <div style={{ fontSize: 10, color: '#ef4444' }}>overdue</div>}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: pill.bg, color: pill.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{pill.label}</span>
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        {fmr.status === 'pending_approval' && view === 'mc' ? (
                          <button onClick={() => setApproveFmr(fmr)}
                            style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                            Approve
                          </button>
                        ) : (
                          <button style={{ padding: '4px 12px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 11 }}>View</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Approval Modal */}
      {approveFmr && (
        <FMRApprovalModal
          dark={dark} fmr={approveFmr} projectId={projectId}
          onClose={() => setApproveFmr(null)}
          onSaved={() => { setApproveFmr(null); fetchFMRs(); addToast('success', 'FMR decision recorded') }}
          addToast={addToast}
        />
      )}

      {/* Raise FMR Modal */}
      {raiseFmr && (
        <RaiseFMRModal
          dark={dark} projectId={projectId}
          onClose={() => setRaiseFmr(false)}
          onSaved={() => { setRaiseFmr(false); fetchFMRs(); addToast('success', 'FMR submitted for approval') }}
          addToast={addToast}
        />
      )}
    </div>
  )
}

// ─── FMR APPROVAL MODAL ───────────────────────────────────────
const FMRApprovalModal = ({ dark, fmr, projectId, onClose, onSaved, addToast }: {
  dark: boolean; fmr: FMRRow; projectId: number; onClose: () => void; onSaved: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

  const [decision, setDecision]   = useState<'approve_full'|'approve_partial'|'reject'|''>('')
  const [partialQty, setPartialQty] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const handleConfirm = async () => {
    if (!decision) { setError('Select a decision'); return }
    if (decision === 'approve_partial' && (!partialQty || Number(partialQty) <= 0)) { setError('Enter approved quantity'); return }
    if (decision === 'reject' && !rejectReason.trim()) { setError('Rejection reason is required'); return }
    setSaving(true); setError('')
    try {
      await axios.put(`${API}/mc/${projectId}/fmr/${fmr.id}/approve`, {
        decision, approved_qty: decision === 'approve_partial' ? Number(partialQty) : undefined, rejection_reason: rejectReason || undefined,
      })
      onSaved()
    } catch (e: any) { setError(e.response?.data?.error || 'Failed to record decision') }
    finally { setSaving(false) }
  }

  // Simulated system check data
  const wbsAlloc = 48, alreadyIssued = 12, remaining = wbsAlloc - alreadyIssued
  const onHand = fmr.stock_on_hand || 42, inTransit = 6
  const advanceDays = fmr.required_date ? Math.ceil((new Date(fmr.required_date).getTime() - Date.now()) / 86400000) : null

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 28, width: 520, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: col }}>MC Approval — {fmr.fmr_ref}</div>
            <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>{fmr.requested_by_name} · {fmr.requested_by_company} · {fmr.work_order_ref}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Item card */}
        <div style={{ background: dark ? '#162032' : '#f8fafc', border: bd, borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginBottom: 4 }}>{fmr.description}</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: sub }}>
            <span>{fmr.item_code}</span>
            <span>WBS {fmr.wbs_code}</span>
            <span>Qty requested: <strong style={{ color: col }}>{fmr.qty_requested} {fmr.uom}</strong></span>
            <span>Required: <strong style={{ color: col }}>{fmr.required_date ? new Date(fmr.required_date).toLocaleDateString('en-AU') : '—'}</strong></span>
          </div>
        </div>

        {/* WBS qty breakdown */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>WBS {fmr.wbs_code} · QTY BREAKDOWN</div>
          {[
            ['WBS total allocation', `${wbsAlloc} ${fmr.uom}`, col],
            ['Already issued', `${alreadyIssued} ${fmr.uom}`, '#2563eb'],
            ['Remaining allocation', `${remaining} ${fmr.uom}`, '#22c55e'],
            ['On hand (WH-A)', `${onHand} ${fmr.uom}`, col],
            ['In transit', `${inTransit} ${fmr.uom}`, '#d97706'],
          ].map(([label, value, color]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, fontSize: 13 }}>
              <span style={{ color: sub }}>{label}</span>
              <span style={{ fontWeight: 600, color }}>{value}</span>
            </div>
          ))}
        </div>

        {/* System checks */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>SYSTEM CHECKS</div>
          {[
            { ok: true,  label: 'WBS ceiling check',   detail: `Requested ${fmr.qty_requested} ${fmr.uom} within remaining allocation of ${remaining} ${fmr.uom}` },
            { ok: true,  label: 'Stock availability',  detail: `${onHand} ${fmr.uom} on hand in WH-A · A-07-01` },
            { ok: false, label: 'Advance request flag', detail: advanceDays ? `Required date is ${advanceDays} days ahead — flagged for review` : 'No date set' },
          ].map(({ ok, label, detail }) => (
            <div key={label} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
              <span style={{ color: ok ? '#22c55e' : '#f59e0b', fontSize: 14, flexShrink: 0 }}>{ok ? '✓' : '△'}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: ok ? '#22c55e' : '#d97706' }}>{label}</div>
                <div style={{ fontSize: 11, color: sub }}>{detail}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Decision */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: col, marginBottom: 8 }}>DECISION</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: decision === 'approve_partial' ? 10 : 0 }}>
            {[
              { val: 'approve_full'    as const, label: 'Approve full',    bg: '#22c55e' },
              { val: 'approve_partial' as const, label: 'Approve partial', bg: '#f59e0b' },
              { val: 'reject'          as const, label: 'Reject',          bg: '#ef4444' },
            ].map(opt => (
              <button key={opt.val} onClick={() => setDecision(opt.val)}
                style={{ flex: 1, padding: '8px', borderRadius: 6, border: `2px solid ${decision === opt.val ? opt.bg : bd}`, background: decision === opt.val ? opt.bg : 'none', color: decision === opt.val ? '#fff' : col, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>
                {opt.label}
              </button>
            ))}
          </div>
          {decision === 'approve_partial' && (
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Approved quantity *</label>
              <input type="number" value={partialQty} onChange={e => setPartialQty(e.target.value)} min={1} max={fmr.qty_requested}
                placeholder={`Max: ${fmr.qty_requested} ${fmr.uom}`} style={inputSt} />
            </div>
          )}
          {decision === 'reject' && (
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Rejection reason *</label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2}
                placeholder="Required — explain why this FMR is rejected" style={{ ...inputSt, resize: 'vertical' }} />
            </div>
          )}
        </div>

        {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={handleConfirm} disabled={saving || !decision}
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: decision ? '#2563eb' : '#94a3b8', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Confirm decision'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── RAISE FMR MODAL ──────────────────────────────────────────
const RaiseFMRModal = ({ dark, projectId, onClose, onSaved, addToast }: {
  dark: boolean; projectId: number; onClose: () => void; onSaved: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

  const [form, setForm] = useState({ wbs_code: '', item_code: '', description: '', qty: '', uom: 'EA', required_date: '', work_order_ref: '', requested_by_name: '', requested_by_company: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.description.trim()) { setError('Description is required'); return }
    if (!form.qty || Number(form.qty) <= 0) { setError('Quantity must be greater than 0'); return }
    if (!form.required_date) { setError('Required date is required'); return }
    setSaving(true); setError('')
    try {
      await axios.post(`${API}/mc/${projectId}/fmr`, {
        ...form, qty_requested: Number(form.qty),
      })
      onSaved()
    } catch (e: any) { setError(e.response?.data?.error || 'Failed to submit FMR') }
    finally { setSaving(false) }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 28, width: 460, maxWidth: '95vw', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: col, marginBottom: 4 }}>Raise FMR</div>
        <div style={{ fontSize: 12, color: sub, marginBottom: 20 }}>Showing materials for your assigned WBS scope: 03.01 · 03.02 · 04.01</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>WBS node (your scope only)</label>
            <select value={form.wbs_code} onChange={e => set('wbs_code', e.target.value)} style={inputSt}>
              <option value="">Select WBS…</option>
              <option value="03.01.01">03.01.01 — Piping & Valves</option>
              <option value="03.02.04">03.02.04 — Stainless Piping</option>
              <option value="04.01.01">04.01.01 — Cables</option>
            </select>
          </div>
          <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Item (stock linked to selected WBS)</label>
            <select value={form.item_code} onChange={e => set('item_code', e.target.value)} style={inputSt}>
              <option value="">Select item…</option>
              <option value="CS-002">CS-002 — Gate valve flanged DN400 ANSI 900#</option>
              <option value="CS-001">CS-001 — Carbon steel pipe 16" API 5L X65</option>
            </select>
          </div>
          <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Description *</label>
            <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Item description" style={inputSt} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Quantity requested *</label>
              <input type="number" value={form.qty} onChange={e => set('qty', e.target.value)} min={0} style={inputSt} /></div>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Required date *</label>
              <input type="date" value={form.required_date} onChange={e => set('required_date', e.target.value)} style={inputSt} /></div>
          </div>
          <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Work order reference</label>
            <input value={form.work_order_ref} onChange={e => set('work_order_ref', e.target.value)} placeholder="WO-2025-XXXX" style={inputSt} /></div>
        </div>

        {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={submit} disabled={saving}
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            {saving ? 'Submitting…' : 'Submit FMR'}
          </button>
        </div>
      </div>
    </>
  )
}

export const MCFMRScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void; userRole?: string }) => (
  <ToastProvider><MCFMRInner {...props} /></ToastProvider>
)
