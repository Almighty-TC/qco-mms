// ─── MC TRANSFER SCREEN ───────────────────────────────────────
// Warehouse Transfer Register — inter-warehouse movements.
// Pipeline: Requested → In transit → Picked up → Delivered → Complete
// + New transfer wizard (2 steps). Transfer detail modal with lifecycle stepper.
import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'

const API = 'http://localhost:3001/api'

interface Transfer {
  id: number; transfer_ref: string; item_code?: string | null; description: string
  wbs_code?: string | null; qty: number; uom: string
  from_warehouse_id?: number | null; from_location?: string | null
  from_warehouse_name?: string | null; from_warehouse_code?: string | null
  to_warehouse_id?: number | null; to_location?: string | null
  to_warehouse_name?: string | null; to_warehouse_code?: string | null
  requested_by_name?: string | null; requested_by_company?: string | null
  status: string; est_pickup_date?: string | null; actual_pickup_date?: string | null; delivered_date?: string | null
  notes?: string | null
}

interface TransferCounts { requested: number; in_transit: number; picked_up: number; delivered: number; complete: number }
interface Warehouse { id: number; name: string; code: string }

const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

const LIFECYCLE: { key: string; label: string; color: string }[] = [
  { key: 'requested',  label: 'Requested',  color: '#64748b' },
  { key: 'in_transit', label: 'In transit', color: '#2563eb' },
  { key: 'picked_up',  label: 'Picked up',  color: '#8b5cf6' },
  { key: 'delivered',  label: 'Delivered',  color: '#d97706' },
  { key: 'complete',   label: 'Complete',   color: '#22c55e' },
]

const statusPill = (s: string) => {
  const lc = LIFECYCLE.find(l => l.key === s)
  if (lc) return { label: lc.label, color: lc.color, bg: `${lc.color}1a` }
  return { label: s, color: '#64748b', bg: 'rgba(100,116,139,0.1)' }
}

const MCTransferInner = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const { addToast } = useToast()
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bg     = dark ? '#0f172a' : '#f4f7fb'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const theadBg = dark ? '#162032' : '#f8fafc'

  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [counts, setCounts]       = useState<TransferCounts | null>(null)
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<string|null>(null)
  const [viewTransfer, setViewTransfer] = useState<Transfer | null>(null)
  const [showNewTransfer, setShowNewTransfer] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])

  const fetchTransfers = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/mc/${projectId}/transfers`, {
        params: { search: search.trim() || undefined, status: statusFilter || undefined }
      })
      setTransfers(data.data || [])
      setCounts(data.counts)
    } catch (e: any) {
      addToast('error', e.response?.data?.error || 'Failed to load transfers')
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchTransfers() }, [projectId, statusFilter]) // eslint-disable-line
  useEffect(() => { const t = setTimeout(fetchTransfers, 350); return () => clearTimeout(t) }, [search]) // eslint-disable-line
  useEffect(() => {
    axios.get(`${API}/mc/${projectId}/warehouses`).then(r => setWarehouses(r.data)).catch(() => {})
  }, [projectId])

  const pipelineTotal = counts ? Object.values(counts).reduce((s, v) => s + v, 0) : 0

  return (
    <div style={{ background: bg, minHeight: '100vh', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ background: cardBg, borderBottom: bd, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onClick={onBack} dark={dark} />
          <div style={{ fontSize: 11, color: sub }}>Dashboard › {projectName} › Material Control › <strong style={{ color: col }}>Transfers</strong></div>
        </div>
        <button onClick={() => setShowNewTransfer(true)}
          style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          + New transfer
        </button>
      </div>

      <div style={{ padding: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: col }}>Warehouse Transfer Register</h1>
        <div style={{ fontSize: 12, color: sub, marginBottom: 20 }}>{projectName} · {pipelineTotal} transfers</div>

        {/* Pipeline cards */}
        {counts && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 20 }}>
            {LIFECYCLE.map(l => (
              <button key={l.key} onClick={() => setStatusFilter(statusFilter === l.key ? null : l.key)}
                style={{
                  background: cardBg, border: bd, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  borderBottom: statusFilter === l.key ? `3px solid ${l.color}` : bd,
                }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: l.color }}>{counts[l.key as keyof TransferCounts]}</div>
                <div style={{ fontSize: 11, color: sub, marginTop: 2 }}>{l.label}</div>
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <div style={{ marginBottom: 12 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search ref, item, WBS, location, requester…"
            style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', boxSizing: 'border-box' }} />
        </div>

        {/* Table */}
        <div style={{ background: cardBg, border: bd, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: theadBg }}>
                <tr style={{ borderBottom: bd }}>
                  {['REF','ITEM','DESCRIPTION','QTY','WBS','FROM → TO','REQUESTED BY','EST. PICKUP','STATUS','ACTION'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: sub, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: sub }}>Loading…</td></tr>
                ) : transfers.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 50, textAlign: 'center', color: sub }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>🔄</div>
                    <div>No transfers found.</div>
                  </td></tr>
                ) : transfers.map(tr => {
                  const pill = statusPill(tr.status)
                  return (
                    <tr key={tr.id} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{tr.transfer_ref}</td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{tr.item_code || '—'}</td>
                      <td style={{ padding: '9px 12px', color: col, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tr.description}</td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: col }}>{tr.qty} {tr.uom}</td>
                      <td style={{ padding: '9px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: sub }}>{tr.wbs_code || '—'}</td>
                      <td style={{ padding: '9px 12px', fontSize: 11 }}>
                        <span style={{ color: col }}>{tr.from_warehouse_name} · {tr.from_location}</span>
                        <span style={{ color: '#E84E0F', margin: '0 6px' }}>→</span>
                        <span style={{ color: col }}>{tr.to_warehouse_name} · {tr.to_location}</span>
                      </td>
                      <td style={{ padding: '9px 12px', color: col, fontSize: 11 }}>
                        {tr.requested_by_name || '—'}
                        {tr.requested_by_company && <div style={{ fontSize: 10, color: sub }}>{tr.requested_by_company}</div>}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11, color: sub }}>{fmt(tr.est_pickup_date)}</td>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: pill.bg, color: pill.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{pill.label}</span>
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <button onClick={() => setViewTransfer(tr)}
                          style={{ padding: '4px 12px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 11 }}>View</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Transfer Detail Modal */}
      {viewTransfer && (
        <TransferDetailModal
          dark={dark} transfer={viewTransfer} projectId={projectId}
          onClose={() => setViewTransfer(null)}
          onStatusUpdate={() => { setViewTransfer(null); fetchTransfers() }}
          addToast={addToast}
        />
      )}

      {/* New Transfer Wizard */}
      {showNewTransfer && (
        <NewTransferWizard
          dark={dark} projectId={projectId} warehouses={warehouses}
          onClose={() => setShowNewTransfer(false)}
          onSaved={() => { setShowNewTransfer(false); fetchTransfers(); addToast('success', 'Transfer request created') }}
          addToast={addToast}
        />
      )}
    </div>
  )
}

// ─── TRANSFER DETAIL MODAL ────────────────────────────────────
const TransferDetailModal = ({ dark, transfer, projectId, onClose, onStatusUpdate, addToast }: {
  dark: boolean; transfer: Transfer; projectId: number; onClose: () => void; onStatusUpdate: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'

  const currentIdx = LIFECYCLE.findIndex(l => l.key === transfer.status)
  const nextStatus = LIFECYCLE[currentIdx + 1]

  const advanceStatus = async () => {
    if (!nextStatus) return
    try {
      await axios.put(`${API}/mc/${projectId}/transfers/${transfer.id}/status`, { status: nextStatus.key })
      addToast('success', `Transfer advanced to ${nextStatus.label}`)
      onStatusUpdate()
    } catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to update status') }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 28, width: 520, maxWidth: '95vw', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: col }}>Transfer — {transfer.transfer_ref}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: sub, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Details */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Transfer Details</div>
            {[
              ['REF', transfer.transfer_ref],
              ['ITEM', transfer.description],
              ['QTY', `${transfer.qty} ${transfer.uom}`],
              ['WBS', transfer.wbs_code || '—'],
              ['FROM', `${transfer.from_warehouse_name} · ${transfer.from_location}`],
              ['TO', `${transfer.to_warehouse_name} · ${transfer.to_location}`],
              ['REQUESTED BY', `${transfer.requested_by_name}${transfer.requested_by_company ? ' · ' + transfer.requested_by_company : ''}`],
              ['EST. PICKUP', transfer.est_pickup_date ? new Date(transfer.est_pickup_date).toLocaleDateString('en-AU') : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: sub }}>{k}</div>
                <div style={{ fontSize: 12, color: col }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Lifecycle stepper */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Lifecycle</div>
            {LIFECYCLE.map((l, i) => {
              const done = i <= currentIdx
              const active = i === currentIdx
              return (
                <div key={l.key} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: done ? l.color : dark ? '#334155' : '#e2e8f0',
                      color: done ? '#fff' : sub, fontSize: 10, fontWeight: 700, flexShrink: 0,
                    }}>
                      {done ? (active ? '' : '✓') : ''}
                    </div>
                    {i < LIFECYCLE.length - 1 && (
                      <div style={{ width: 2, height: 18, background: i < currentIdx ? l.color : dark ? '#334155' : '#e2e8f0', marginTop: 2 }} />
                    )}
                  </div>
                  <div style={{ paddingTop: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: active ? 700 : 400, color: active ? l.color : done ? col : sub }}>{l.label}</div>
                    {active && <div style={{ fontSize: 10, color: sub }}>Current</div>}
                    {done && !active && <div style={{ fontSize: 10, color: sub }}>Completed</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Advance status */}
        {nextStatus && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: bd, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Close</button>
            <button onClick={advanceStatus}
              style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: nextStatus.color, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Advance to {nextStatus.label} →
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── NEW TRANSFER WIZARD ──────────────────────────────────────
const NewTransferWizard = ({ dark, projectId, warehouses, onClose, onSaved, addToast }: {
  dark: boolean; projectId: number; warehouses: Warehouse[]; onClose: () => void; onSaved: () => void
  addToast: (t: 'success'|'error', m: string) => void
}) => {
  const col    = dark ? '#f1f5f9' : '#0f172a'
  const cardBg = dark ? '#1e293b' : '#fff'
  const bd     = `1px solid ${dark ? '#334155' : '#dde3ed'}`
  const sub    = '#94a3b8'
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: bd, background: dark ? '#0f172a' : '#f8fafc', color: col, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

  const [step, setStep] = useState<1|2>(1)
  const [form, setForm] = useState({
    from_warehouse_id: '', item_code: '', description: '', qty: '', uom: 'EA', wbs_code: '', from_location: '',
    to_warehouse_id: '', to_location: '', requested_by_name: '', requested_by_company: '', est_pickup_date: '', notes: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.to_warehouse_id) { setError('Destination warehouse is required'); return }
    if (!form.description.trim()) { setError('Description is required'); return }
    if (!form.qty || Number(form.qty) <= 0) { setError('Quantity must be greater than 0'); return }
    setSaving(true); setError('')
    try {
      await axios.post(`${API}/mc/${projectId}/transfers`, { ...form, qty: Number(form.qty) })
      onSaved()
    } catch (e: any) { setError(e.response?.data?.error || 'Failed to create transfer') }
    finally { setSaving(false) }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 6000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: cardBg, border: bd, borderRadius: 12, padding: 28, width: 480, maxWidth: '95vw', zIndex: 6001, fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: col, marginBottom: 4 }}>New warehouse transfer</div>
        <div style={{ fontSize: 12, color: sub, marginBottom: 20 }}>Step {step} of 2 · {step === 1 ? 'Source & material' : 'Destination & schedule'}</div>

        {/* Step progress */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
          {[{ n: 1, label: 'Source & material' }, { n: 2, label: 'Destination & schedule' }].map(({ n, label }, i) => (
            <React.Fragment key={n}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, background: step >= n ? '#2563eb' : dark ? '#334155' : '#e2e8f0', color: step >= n ? '#fff' : sub }}>{n < step ? '✓' : n}</div>
                <span style={{ fontSize: 11, color: step === n ? col : sub }}>{label}</span>
              </div>
              {i === 0 && <div style={{ flex: 1, height: 2, background: step > 1 ? '#2563eb' : dark ? '#334155' : '#e2e8f0', margin: '0 8px', alignSelf: 'center' }} />}
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Transfer FROM warehouse *</label>
              <select value={form.from_warehouse_id} onChange={e => set('from_warehouse_id', e.target.value)} style={inputSt}>
                <option value="">Select source warehouse…</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
              </select>
            </div>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Item / stock description *</label>
              <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Gate valve DN400 × 10" style={inputSt} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Quantity *</label>
                <input type="number" value={form.qty} onChange={e => set('qty', e.target.value)} min={0} style={inputSt} /></div>
              <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>UOM</label>
                <input value={form.uom} onChange={e => set('uom', e.target.value)} style={inputSt} /></div>
            </div>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>From grid location</label>
              <input value={form.from_location} onChange={e => set('from_location', e.target.value)} placeholder="e.g. A-07-01" style={inputSt} /></div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Transfer TO warehouse *</label>
              <select value={form.to_warehouse_id} onChange={e => set('to_warehouse_id', e.target.value)} style={inputSt}>
                <option value="">Select destination warehouse…</option>
                {warehouses.filter(w => String(w.id) !== form.from_warehouse_id).map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
                <option value="0">Site laydown area</option>
              </select>
            </div>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>To location / area</label>
              <input value={form.to_location} onChange={e => set('to_location', e.target.value)} placeholder="e.g. Site laydown · Area 3" style={inputSt} /></div>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Requested by</label>
              <input value={form.requested_by_name} onChange={e => set('requested_by_name', e.target.value)} placeholder="Name" style={inputSt} /></div>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Company</label>
              <input value={form.requested_by_company} onChange={e => set('requested_by_company', e.target.value)} placeholder="Company" style={inputSt} /></div>
            <div><label style={{ fontSize: 11, color: sub, display: 'block', marginBottom: 4 }}>Estimated pickup date</label>
              <input type="date" value={form.est_pickup_date} onChange={e => set('est_pickup_date', e.target.value)} style={inputSt} /></div>
          </div>
        )}

        {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          {step === 2 && <button onClick={() => setStep(1)} style={{ padding: '8px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>← Back</button>}
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: bd, background: 'none', color: col, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          {step === 1 ? (
            <button onClick={() => form.from_warehouse_id && form.description && form.qty ? setStep(2) : setError('Source warehouse, description and quantity are required')}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              Next →
            </button>
          ) : (
            <button onClick={submit} disabled={saving}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              {saving ? 'Creating…' : 'Create transfer'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

export const MCTransferScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider><MCTransferInner {...props} /></ToastProvider>
)
