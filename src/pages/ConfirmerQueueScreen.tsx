// ─── CONFIRMER QUEUE (C-c) ───────────────────────────────────
// Pending-changes approval queue. Lists items THIS user may confirm (backend
// already filters by required_confirmer_role / admin). The UI adds NO authorization
// logic — it only drives the proven /pending-changes endpoints; the backend enforces
// requester≠confirmer, domain routing, and baseline-major→PM. We hide/disable actions
// the user can't perform (can_action from the API) but the server remains source of truth.
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { HelpButton } from '../components/HelpDrawer'
import { PENDING_CHANGES_HELP } from '../helpContent'
import { AdminTable, AdminRow, AdminCell } from '../components/AdminTable'
import type { AdminCol } from '../components/AdminTable'

const API = 'http://localhost:3001/api'

type PendingRow = {
  id: number; module: string; entity_type: string; entity_id: number | null
  action: 'create' | 'delete' | 'edit'; proposed: Record<string, unknown> | null
  before_value: Record<string, unknown> | null; is_baseline_major: number
  required_confirmer_role: string; batch_id: string | null
  requested_by: number; requested_by_name: string | null; requested_at: string
  can_action: boolean
}

const COLS: AdminCol[] = [
  { label: 'Module', width: 110 },
  { label: 'Action', width: 90 },
  { label: 'Governance', width: 130 },
  { label: 'Confirmer required', width: 180 },
  { label: 'Requested by', width: 150 },
  { label: 'Change (before → proposed)', width: 320, flex: true },
  { label: 'Actions', width: 230, noResize: true },
]

const fmtJson = (o: Record<string, unknown> | null) =>
  o ? Object.entries(o).map(([k, v]) => `${k}: ${v === null ? '∅' : String(v)}`).join(' · ') : '—'

export const ConfirmerQueueScreen = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const [rows, setRows] = useState<PendingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const col = dark ? '#f1f5f9' : '#0f172a'

  const load = useCallback(async () => {
    setLoading(true)
    try { const { data } = await axios.get(`${API}/pending-changes/${projectId}/queue`); setRows(data) }
    catch { setRows([]) }
    finally { setLoading(false) }
  }, [projectId])
  useEffect(() => { load() }, [load])

  const act = async (id: number, kind: 'confirm' | 'reject') => {
    let comment: string | null = null
    if (kind === 'reject') { comment = window.prompt('Reason for rejection?') ; if (comment === null) return }
    setBusy(id)
    try { await axios.post(`${API}/pending-changes/${projectId}/${kind}/${id}`, { comment }); await load() }
    catch (e: unknown) { const er = e as { response?: { data?: { error?: string } } }; window.alert(er.response?.data?.error ?? `${kind} failed`) }
    finally { setBusy(null) }
  }
  const batchConfirm = async (batchId: string) => {
    setBusy(-1)
    try { await axios.post(`${API}/pending-changes/${projectId}/batch/${batchId}/confirm`, {}); await load() }
    catch (e: unknown) { const er = e as { response?: { data?: { error?: string } } }; window.alert(er.response?.data?.error ?? 'batch-confirm failed') }
    finally { setBusy(null) }
  }

  // group batch ids present (for the batch-confirm affordance)
  const batches = useMemo(() => [...new Set(rows.filter(r => r.batch_id && r.can_action).map(r => r.batch_id!))], [rows])

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>✔ Pending Changes</h2>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3 }}>Approve / reject staged foundational &amp; MTO changes — {projectName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {batches.map(b => (
            <button key={b} onClick={() => batchConfirm(b)} disabled={busy !== null}
              style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              ✓ Confirm batch {b}
            </button>
          ))}
          <button onClick={load} style={{ padding: '7px 12px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>↺ Refresh</button>
          <HelpButton screenName="Pending Changes" sections={PENDING_CHANGES_HELP} dark={dark} />
        </div>
      </div>

      <AdminTable tableId="pending_changes_queue" columns={COLS} dark={dark}
        empty={loading ? 'Loading…' : 'No pending changes awaiting your confirmation.'}>
        {rows.map(r => (
          <AdminRow key={r.id} dark={dark}>
            <AdminCell>{r.module}</AdminCell>
            <AdminCell>{r.action}</AdminCell>
            <td style={{ padding: '0 12px', height: 44, verticalAlign: 'middle', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
              {r.is_baseline_major
                ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(232,78,15,0.12)', color: '#E84E0F' }}>BASELINE-MAJOR</span>
                : <span style={{ fontSize: 11, color: '#94a3b8' }}>standard</span>}
            </td>
            <AdminCell muted>{r.required_confirmer_role.replace(/_/g, ' ')}</AdminCell>
            <AdminCell muted>{r.requested_by_name ?? `#${r.requested_by}`}</AdminCell>
            <AdminCell muted title={fmtJson(r.action === 'delete' ? r.before_value : r.proposed)}>
              {fmtJson(r.action === 'delete' ? r.before_value : r.proposed)}
            </AdminCell>
            <td style={{ padding: '0 12px', height: 44, verticalAlign: 'middle', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
              {r.can_action ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => act(r.id, 'confirm')} disabled={busy !== null}
                    style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {busy === r.id ? '…' : '✓ Confirm'}</button>
                  <button onClick={() => act(r.id, 'reject')} disabled={busy !== null}
                    style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#ef4444', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✕ Reject</button>
                </div>
              ) : <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>you proposed this</span>}
            </td>
          </AdminRow>
        ))}
      </AdminTable>
    </div>
  )
}
