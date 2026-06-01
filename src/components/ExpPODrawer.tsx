// ─── EXP PO DRAWER ────────────────────────────────────────────
// Slide-in right panel (400px) showing PO summary, milestones,
// and line item allocation status. Launched from ExpeditingScreen
// "View →" button; offers quick "Create SCN" and line-level assign.
import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { MilestoneTimeline } from './MilestoneTimeline'

const API = 'http://localhost:3001/api'

// ─── PROPS ────────────────────────────────────────────────────
interface Props {
  poId: number | null
  projectId: number
  dark: boolean
  onClose: () => void
  onOpenFullScreen: (poId: number) => void
  onCreateSCN: (poId: number, preSelectedLineId?: number) => void
}

// ─── COMPONENT ────────────────────────────────────────────────
export const ExpPODrawer: React.FC<Props> = ({
  poId, projectId, dark, onClose, onOpenFullScreen, onCreateSCN,
}) => {
  const [po, setPO] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  // ─── FETCH PO DETAIL ──────────────────────────────────────
  // Loads full PO detail when drawer opens; clears on close.
  useEffect(() => {
    if (!poId) { setPO(null); return }
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

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 400, zIndex: 8001,
        background: dark ? '#1e293b' : '#fff',
        borderLeft: border,
        boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 200ms ease',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'IBM Plex Sans, sans-serif',
      }}>

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
              {/* PO ref — click to open full screen */}
              <button
                onClick={() => { onClose(); onOpenFullScreen(po.id) }}
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
                <button
                  onClick={onClose}
                  style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}
                >
                  ✕
                </button>
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
              onClick={() => { onClose(); onOpenFullScreen(po.id) }}
              style={{
                background: 'none', border: 'none',
                color: '#2563eb', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              View full detail →
            </button>
          </div>
        )}
      </div>
    </>,
    document.body
  )
}
