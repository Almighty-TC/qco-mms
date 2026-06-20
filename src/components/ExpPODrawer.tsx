// ─── EXP PO DRAWER ────────────────────────────────────────────
// Slide-in right panel (400px) showing PO summary, milestones,
// and line item allocation status. Launched from ExpeditingScreen
// "View →" button; offers quick "Create SCN" and line-level assign.
import React, { useState, useEffect, Suspense, lazy } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { MilestoneTimeline } from './MilestoneTimeline'
import { ExpandBtn } from './ExpandToggle'
// Lazy-loaded so this component doesn't statically import a full page (keeps the
// HMR boundary clean + code-splits the detail view out of the main bundle).
const ExpPODetailScreen = lazy(() => import('../pages/ExpPODetailScreen').then(m => ({ default: m.ExpPODetailScreen })))

import { API } from '../lib/api'

// Roles that may (co-)assign expeditors — MUST equal the backend's
// EXPEDITOR_ASSIGN_ROLES (procurement.js). Client gate is defence-in-depth; the
// API enforces the same set, so a non-assigner can never assign even if shown.
const EXPEDITOR_ASSIGN_ROLES = new Set(['admin', 'expediting_manager', 'expeditor', 'procurement_manager'])

// ─── PROPS ────────────────────────────────────────────────────
interface Props {
  poId: number | null
  projectId: number
  projectName: string
  dark: boolean
  userRole?: string
  onClose: () => void
  onCreateSCN: (poId: number, preSelectedLineId?: number) => void
  onAssigned?: () => void   // fired after an assign change so the register row refreshes
}

// ─── COMPONENT ────────────────────────────────────────────────
export const ExpPODrawer: React.FC<Props> = ({
  poId, projectId, projectName, dark, userRole = '', onClose, onCreateSCN, onAssigned,
}) => {
  const [po, setPO] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  // Expand the drawer to a full-screen view that embeds the complete PO detail.
  const [expanded, setExpanded] = useState(false)

  // ─── EXPEDITOR (CO-)ASSIGNMENT ────────────────────────────
  // Reuses the procurement endpoints (same data as the PO Register). The control
  // renders only for assigner roles; everyone else sees the assignees read-only.
  const canAssign = EXPEDITOR_ASSIGN_ROLES.has(userRole)
  const [assigned, setAssigned] = useState<{ id: number; name: string }[]>([])
  const [eligible, setEligible] = useState<{ id: number; full_name: string; role: string }[]>([])
  const [addId, setAddId] = useState('')
  const [busyExp, setBusyExp] = useState(false)
  const [assignErr, setAssignErr] = useState('')
  const fromResp = (data: { expeditors?: { user_id: number; full_name: string }[] }) =>
    (data.expeditors ?? []).map(e => ({ id: e.user_id, name: e.full_name }))

  // Current assignees (ids needed for removal) — only fetchable by assigners
  // (they hold procurement.can_view). Reset when the PO changes / drawer closes.
  useEffect(() => {
    setAddId(''); setAssignErr('')
    if (!poId || !canAssign) { setAssigned([]); return }
    axios.get(`${API}/procurement/pos/${poId}/expeditors`)
      .then(r => setAssigned(fromResp(r.data)))
      .catch(() => setAssigned([]))
  }, [poId, canAssign])

  // Eligible-users list — same source the PO Register uses. Fetched once per assigner.
  useEffect(() => {
    if (!canAssign) return
    axios.get(`${API}/procurement/users/list`).then(r => setEligible(r.data)).catch(() => setEligible([]))
  }, [canAssign])

  const addExpeditor = async () => {
    if (!addId) return
    setBusyExp(true); setAssignErr('')
    try {
      const { data } = await axios.post(`${API}/procurement/pos/${poId}/expeditors`, { user_id: Number(addId) })
      setAssigned(fromResp(data)); setAddId(''); onAssigned?.()
    } catch (e: unknown) {
      setAssignErr((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Could not add expeditor')
    } finally { setBusyExp(false) }
  }
  const removeExpeditor = async (uid: number) => {
    setBusyExp(true); setAssignErr('')
    try {
      const { data } = await axios.delete(`${API}/procurement/pos/${poId}/expeditors/${uid}`)
      setAssigned(fromResp(data)); onAssigned?.()
    } catch (e: unknown) {
      setAssignErr((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Could not remove expeditor')
    } finally { setBusyExp(false) }
  }

  // ─── FETCH PO DETAIL ──────────────────────────────────────
  // Loads full PO detail when drawer opens; clears on close. Reset the expand
  // state whenever a different PO is opened.
  useEffect(() => {
    if (!poId) { setPO(null); return }
    setExpanded(false)
    setLoading(true)
    axios.get(`${API}/expediting/${projectId}/po/${poId}`)
      .then(r => setPO(r.data))
      .catch(e => console.error('[ExpPODrawer]', e))
      .finally(() => setLoading(false))
  }, [poId, projectId])

  const isOpen = !!poId

  const border = `1px solid ${dark ? '#334155' : '#dde3ed'}`

  // ─── PORTAL RENDER ────────────────────────────────────────
  // Renders scrim + panel via portal so it floats above all content.
  return createPortal(
    <>
      {/* Scrim */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.3)', zIndex: 8000,
          }}
        />
      )}

      {/* Panel — widens to full screen when expanded */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: expanded ? '100vw' : 400, maxWidth: '100vw', zIndex: 8001,
        background: dark ? '#1e293b' : '#fff',
        borderLeft: border,
        boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 200ms ease, width 160ms ease',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'IBM Plex Sans, sans-serif',
      }}>

      {/* ── EXPANDED: full-screen embedded PO detail ── */}
      {expanded && poId ? (
        <>
          <div style={{ padding: '8px 16px', borderBottom: border, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Full PO view — use ← Back or shrink to return to the summary</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ExpandBtn expanded onToggle={() => setExpanded(false)} />
              <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>✕</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px' }}>
            <Suspense fallback={<div style={{ padding: 40, color: '#94a3b8', fontSize: 13 }}>Loading PO…</div>}>
              <ExpPODetailScreen dark={dark} projectId={projectId} projectName={projectName} poId={poId} userRole={userRole} onBack={() => setExpanded(false)} />
            </Suspense>
          </div>
        </>
      ) : (
      <>

        {/* ── STICKY HEADER ── */}
        <div style={{
          padding: '16px 20px',
          borderBottom: border,
          flexShrink: 0,
        }}>
          {loading || !po ? (
            <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              {/* PO ref — click to expand to the full detail in place */}
              <button
                onClick={() => setExpanded(true)}
                title="Expand to full detail"
                style={{
                  background: 'none', border: 'none',
                  color: '#E84E0F', fontSize: 11, cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace', padding: 0, marginBottom: 4,
                }}
              >
                {po.po_number}
              </button>
              <div style={{ fontSize: 18, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>
                {po.vendor_display || po.vendor_name}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                Owner: {po.owner_name || '—'} · Group: {po.group_category || '—'}
              </div>

              {/* Expeditor (co-)assignment — assigners get the control; others read-only */}
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: border }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Expeditors</div>
                {canAssign ? (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: assigned.length ? 6 : 0 }}>
                      {assigned.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>— None assigned</span>}
                      {assigned.map((a, i) => (
                        <span key={a.id} title={i === 0 ? 'Lead expeditor' : 'Assigned expeditor'}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: dark ? '#f1f5f9' : '#0f172a',
                            background: dark ? '#1e293b' : '#fff', border: `1px solid ${i === 0 ? '#2563eb' : (dark ? '#334155' : '#dde3ed')}`, borderRadius: 12, padding: '2px 6px 2px 8px' }}>
                          {i === 0 && <span style={{ color: '#2563eb', fontSize: 9 }}>★</span>}
                          {a.name}
                          <button onClick={() => removeExpeditor(a.id)} disabled={busyExp} title="Remove"
                            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select value={addId} onChange={e => setAddId(e.target.value)}
                        style={{ height: 28, fontSize: 11, flex: 1, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: dark ? '#0f172a' : '#fff', color: dark ? '#f1f5f9' : '#0f172a', padding: '0 8px' }}>
                        <option value="">+ Add expeditor…</option>
                        {eligible
                          .filter(u => EXPEDITOR_ASSIGN_ROLES.has(u.role))
                          .filter(u => !assigned.some(a => a.id === u.id))
                          .map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                      <button onClick={addExpeditor} disabled={busyExp || !addId}
                        style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: addId ? '#E84E0F' : '#94a3b8', color: '#fff', fontSize: 11, cursor: addId ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                        {busyExp ? '…' : 'Add'}
                      </button>
                    </div>
                    {assignErr && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{assignErr}</div>}
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {(po.expeditor_names && po.expeditor_names.length) ? po.expeditor_names.join(', ') : '— Unassigned'}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {/* RAG pill */}
                <span style={{
                  fontSize: 11, padding: '2px 9px', borderRadius: 9999, fontWeight: 600,
                  background:
                    po.rag === 'red' ? 'rgba(239,68,68,0.12)'
                    : po.rag === 'amber' ? 'rgba(245,158,11,0.12)'
                    : po.rag === 'complete' ? 'rgba(34,197,94,0.12)'
                    : 'rgba(37,99,235,0.12)',
                  color:
                    po.rag === 'red' ? '#dc2626'
                    : po.rag === 'amber' ? '#d97706'
                    : po.rag === 'complete' ? '#16a34a'
                    : '#1d4ed8',
                }}>
                  {po.rag === 'red' ? 'Breached' : po.rag === 'amber' ? 'At Risk' : po.rag === 'complete' ? 'Complete' : 'On Track'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <ExpandBtn expanded={false} onToggle={() => setExpanded(true)} />
                  <button
                    onClick={onClose}
                    style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            </>
          )}
        </div>

        {/* ── ACTION BUTTONS ── */}
        {po && (
          <div style={{
            padding: '10px 20px',
            borderBottom: border,
            display: 'flex', gap: 8, flexShrink: 0,
          }}>
            <button
              onClick={() => onCreateSCN(po.id)}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 6,
                border: 'none', background: '#2563eb', color: '#fff',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              + Create SCN
            </button>
            <button
              style={{
                flex: 1, padding: '7px 0', borderRadius: 6,
                border: border, background: 'none',
                color: dark ? '#f1f5f9' : '#0f172a',
                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              📎 Documents
            </button>
          </div>
        )}

        {/* ── SCROLLABLE CONTENT ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {po && (
            <>
              {/* MILESTONES */}
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 10, color: '#94a3b8',
                  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10,
                }}>
                  Milestones
                </div>
                <MilestoneTimeline milestones={po.milestones || []} size="sm" dark={dark} />
              </div>

              {/* LINE ITEMS */}
              <div>
                <div style={{
                  fontSize: 10, color: '#94a3b8',
                  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10,
                }}>
                  Line Items
                </div>

                {(po.po_lines || []).map((line: any) => {
                  const qtyTotal    = Number(line.qty || 0)
                  const qtyAssigned = Number(line.qty_assigned || 0)
                  const qtyAvail    = Number(
                    line.qty_available ?? Math.max(0, qtyTotal - qtyAssigned)
                  )
                  const pct = qtyTotal > 0 ? Math.round(qtyAssigned / qtyTotal * 100) : 0

                  const lineStatus =
                    qtyAssigned === 0 ? 'Not assigned'
                    : qtyAssigned >= qtyTotal ? 'Assigned'
                    : 'Partial'

                  const statusColor: Record<string, { bg: string; color: string }> = {
                    'Not assigned': { bg: 'rgba(148,163,184,0.12)', color: '#64748b' },
                    'Partial':      { bg: 'rgba(245,158,11,0.12)',  color: '#d97706' },
                    'Assigned':     { bg: 'rgba(34,197,94,0.12)',   color: '#16a34a' },
                  }
                  const sp = statusColor[lineStatus]

                  return (
                    <div key={line.id} style={{
                      border: border, borderRadius: 8,
                      padding: '12px 14px', marginBottom: 10,
                      background: dark ? '#0f172a' : '#fff',
                    }}>
                      {/* Header row */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#94a3b8', marginRight: 6 }}>
                            Line {line.line_number}
                          </span>
                          <div style={{ fontSize: 13, fontWeight: 600, color: dark ? '#f1f5f9' : '#0f172a', marginTop: 2 }}>
                            {line.description}
                          </div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                            {line.wbs_code_snapshot && <span>{line.wbs_code_snapshot} · </span>}
                            {line.ros_date && (
                              <span>
                                ROS {new Date(line.ros_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                              </span>
                            )}
                          </div>
                        </div>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 9999, fontWeight: 600,
                          background: sp.bg, color: sp.color,
                          whiteSpace: 'nowrap', marginLeft: 8,
                        }}>
                          {lineStatus}
                        </span>
                      </div>

                      {/* Qty row */}
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                        Total {qtyTotal} {line.uom} · Assigned {qtyAssigned} · Available {qtyAvail}
                      </div>

                      {/* Progress bar */}
                      <div style={{
                        height: 4, borderRadius: 2,
                        background: dark ? '#334155' : '#e2e8f0',
                        overflow: 'hidden', marginBottom: 8,
                      }}>
                        <div style={{ height: '100%', borderRadius: 2, background: '#2563eb', width: `${pct}%` }} />
                      </div>

                      {/* CTA */}
                      {qtyAvail > 0 ? (
                        <div style={{ textAlign: 'right' }}>
                          <button
                            onClick={() => onCreateSCN(po.id, line.id)}
                            style={{
                              fontSize: 11, padding: '4px 12px', borderRadius: 5,
                              border: 'none', background: '#2563eb', color: '#fff',
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            + Assign to SCN
                          </button>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
                          No quantity available to assign
                        </div>
                      )}
                    </div>
                  )
                })}

                {(po.po_lines || []).length === 0 && (
                  <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                    No line items on this PO.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── STICKY FOOTER ── */}
        {po && (
          <div style={{
            padding: '12px 20px',
            borderTop: border,
            textAlign: 'right', flexShrink: 0,
          }}>
            <button
              onClick={() => setExpanded(true)}
              style={{
                background: 'none', border: 'none',
                color: '#2563eb', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ⤢ Expand to full detail
            </button>
          </div>
        )}
        </>
        )}
      </div>
    </>,
    document.body
  )
}
