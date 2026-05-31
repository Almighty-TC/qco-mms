// ─── EXPEDITING PO DETAIL PANEL ───────────────────────────────
// Slide-in right drawer showing full PO detail for expediting.
// Sections: milestones (with forecast editing), line items, action notes.
import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { MilestoneTimeline } from './MilestoneTimeline'

const API = 'http://localhost:3001/api'

// ─── TYPES ────────────────────────────────────────────────────
interface Milestone {
  id: number; label: string; status: string; step_order: number
  planned_date?: string | null; forecast_date?: string | null; actual_date?: string | null
  forecast_changed_count: number
}
interface ForecastHistory {
  id: number; old_value: string | null; new_value: string; reason: string
  changed_by_name?: string; changed_at: string
}
interface ChildItem {
  id: number; sub_number: number; description: string; qty: number; uom: string
  cdd?: string | null; status: string; notes?: string
}
interface POLine {
  id: number; line_number: string; description: string; qty: number; uom: string
  cdd?: string | null; heat_number_required?: number; heat_number?: string | null
  commodity_id?: number | null; commodity_name?: string | null
  equipment_tag?: string | null; child_items: ChildItem[]
}
interface ActionNote {
  id: number; text: string; created_at: string; created_by_name?: string
}
interface PODetail {
  id: number; po_number: string; po_name?: string; vendor_display: string
  material_description?: string; owner_name?: string; expeditor_name?: string
  ros_date?: string | null; status: string; rag: string
  milestones: Milestone[]; lines: POLine[]; action_notes: ActionNote[]
}

interface Props {
  projectId: number; poId: number | null
  dark: boolean; token: string
  onClose: () => void
}

// ─── DATE HELPERS ─────────────────────────────────────────────
const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' }) : '—'

const RAG_COLORS: Record<string, string> = {
  complete: '#22c55e', red: '#ef4444', amber: '#f59e0b', green: '#2563eb', grey: '#94a3b8'
}
const STATUS_LABELS: Record<string, string> = {
  complete: 'Complete', breached: 'Breached', at_risk: 'At Risk',
  in_progress: 'In Progress', not_started: 'Not Started'
}
const STATUS_PILL_COLORS: Record<string, { bg: string; color: string }> = {
  complete:    { bg: 'rgba(34,197,94,0.1)',  color: '#16a34a' },
  breached:    { bg: 'rgba(239,68,68,0.1)',  color: '#dc2626' },
  at_risk:     { bg: 'rgba(245,158,11,0.1)', color: '#d97706' },
  in_progress: { bg: 'rgba(37,99,235,0.1)',  color: '#1d4ed8' },
  not_started: { bg: 'rgba(148,163,184,0.1)', color: '#64748b' },
}

// ─── PANEL ────────────────────────────────────────────────────
export const ExpPODetailPanel = ({ projectId, poId, dark, token, onClose }: Props) => {
  const [po, setPO] = useState<PODetail | null>(null)
  const [loading, setLoading] = useState(false)

  // Milestone forecast editing
  const [editingMilestone, setEditingMilestone] = useState<number | null>(null)
  const [forecastDate, setForecastDate] = useState('')
  const [forecastReason, setForecastReason] = useState('')
  const [savingForecast, setSavingForecast] = useState(false)

  // Forecast history per milestone
  const [historyMilestone, setHistoryMilestone] = useState<number | null>(null)
  const [history, setHistory] = useState<ForecastHistory[]>([])

  // Child item add
  const [addingChildLine, setAddingChildLine] = useState<number | null>(null)
  const [newChild, setNewChild] = useState({ description: '', qty: '', uom: '', cdd: '', notes: '' })

  // Action note
  const [noteText, setNoteText] = useState('')
  const [postingNote, setPostingNote] = useState(false)

  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    if (!poId) { setPO(null); return }
    setLoading(true)
    setEditingMilestone(null)
    setHistoryMilestone(null)
    axios.get(`${API}/expediting/${projectId}/po/${poId}`, { headers })
      .then(r => setPO(r.data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [poId, projectId])

  const reloadPO = () => {
    if (!poId) return
    axios.get(`${API}/expediting/${projectId}/po/${poId}`, { headers })
      .then(r => setPO(r.data))
  }

  const saveForecast = async () => {
    if (!editingMilestone || !forecastReason.trim()) return
    setSavingForecast(true)
    try {
      await axios.put(
        `${API}/expediting/${projectId}/po/${poId}/milestone/${editingMilestone}/forecast`,
        { forecast_date: forecastDate || null, reason: forecastReason },
        { headers }
      )
      setEditingMilestone(null); setForecastDate(''); setForecastReason('')
      reloadPO()
    } catch (e) { console.error(e) }
    finally { setSavingForecast(false) }
  }

  const loadHistory = async (milestoneId: number) => {
    if (historyMilestone === milestoneId) { setHistoryMilestone(null); return }
    const { data } = await axios.get(
      `${API}/expediting/${projectId}/po/${poId}/milestone/${milestoneId}/forecast-history`,
      { headers }
    )
    setHistory(data)
    setHistoryMilestone(milestoneId)
  }

  const postNote = async () => {
    if (!noteText.trim()) return
    setPostingNote(true)
    try {
      await axios.post(
        `${API}/expediting/${projectId}/po/${poId}/action-notes`,
        { text: noteText },
        { headers }
      )
      setNoteText(''); reloadPO()
    } catch (e) { console.error(e) }
    finally { setPostingNote(false) }
  }

  const postChild = async (lineId: number) => {
    try {
      await axios.post(
        `${API}/expediting/${projectId}/po/${poId}/lines/${lineId}/child-items`,
        { ...newChild, qty: parseFloat(newChild.qty) || 0 },
        { headers }
      )
      setAddingChildLine(null); setNewChild({ description:'', qty:'', uom:'', cdd:'', notes:'' })
      reloadPO()
    } catch (e) { console.error(e) }
  }

  const bg  = dark ? '#1a2236' : '#fff'
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd  = dark ? '#334155' : '#e2e8f0'
  const sub = '#94a3b8'

  const panel = (
    <>
      {/* Scrim */}
      {poId && (
        <div
          onClick={onClose}
          style={{ position:'fixed', inset:0, zIndex:8400, background:'rgba(0,0,0,0.3)' }}
        />
      )}

      {/* Panel */}
      <div style={{
        position:'fixed', right:0, top:0, bottom:0, width:420,
        zIndex:8500, background:bg, borderLeft:`1px solid ${bd}`,
        boxShadow:'-4px 0 24px rgba(0,0,0,0.18)',
        display:'flex', flexDirection:'column',
        transform: poId ? 'translateX(0)' : 'translateX(100%)',
        transition:'transform 300ms ease',
        fontFamily:'IBM Plex Sans, sans-serif',
        overflow:'hidden',
      }}>

        {/* ── STICKY HEADER ── */}
        <div style={{
          padding:'16px 20px 12px', borderBottom:`1px solid ${bd}`,
          background:bg, flexShrink:0,
        }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:11, color:sub, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:3 }}>
                PO Detail
              </div>
              <div style={{ fontSize:16, fontWeight:700, color:col, fontFamily:'JetBrains Mono, monospace' }}>
                {po?.po_number || '—'}
              </div>
              <div style={{ fontSize:12, color:sub, marginTop:2 }}>
                {po?.vendor_display || ''}
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              {po && (
                <div style={{
                  width:10, height:10, borderRadius:'50%',
                  background: RAG_COLORS[po.rag] || '#94a3b8',
                  marginTop:4,
                }} title={`RAG: ${po.rag}`} />
              )}
              <button onClick={onClose} style={{
                background:'none', border:'none', cursor:'pointer', color:sub,
                fontSize:20, lineHeight:1, padding:'0 2px',
              }}>×</button>
            </div>
          </div>
          {po && (
            <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
              <span style={{ fontSize:11, color:sub }}>Owner: <span style={{ color:col }}>{po.owner_name || '—'}</span></span>
              <span style={{ fontSize:11, color:sub }}>ROS: <span style={{ color:col }}>{fmt(po.ros_date)}</span></span>
            </div>
          )}
          {/* Action buttons */}
          <div style={{ display:'flex', gap:6, marginTop:10 }}>
            <button disabled style={{ fontSize:11, padding:'5px 10px', borderRadius:5, border:'1px solid #cbd5e1', background:'transparent', color:'#cbd5e1', cursor:'not-allowed' }}>
              Create SCN
            </button>
            <button disabled style={{ fontSize:11, padding:'5px 10px', borderRadius:5, border:'1px solid #cbd5e1', background:'transparent', color:'#cbd5e1', cursor:'not-allowed' }}>
              Documents
            </button>
          </div>
        </div>

        {/* ── SCROLLABLE BODY ── */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
          {loading && (
            <div style={{ textAlign:'center', color:sub, padding:'40px 0', fontSize:13 }}>Loading…</div>
          )}

          {po && !loading && (
            <>
              {/* ── MILESTONES ── */}
              <Section label="Milestones" dark={dark}>
                <MilestoneTimeline milestones={po.milestones} size="md" />
                <div style={{ marginTop:12 }}>
                  {po.milestones.map(m => {
                    const pill = STATUS_PILL_COLORS[m.status] || STATUS_PILL_COLORS.not_started
                    const isEditing = editingMilestone === m.id
                    const showHistory = historyMilestone === m.id
                    return (
                      <div key={m.id} style={{
                        borderBottom:`1px solid ${bd}`, paddingBottom:10, marginBottom:10,
                      }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <div style={{ fontSize:13, fontWeight:600, color:col }}>{m.label}</div>
                          <span style={{
                            fontSize:11, padding:'2px 8px', borderRadius:10,
                            background:pill.bg, color:pill.color, fontWeight:500,
                          }}>{STATUS_LABELS[m.status] || m.status}</span>
                        </div>
                        <div style={{ display:'flex', gap:16, marginTop:4 }}>
                          <DateField label="Planned" value={m.planned_date} sub={sub} />
                          <DateField label="Actual" value={m.actual_date} sub={sub} />
                        </div>

                        {/* Forecast date */}
                        {!isEditing ? (
                          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
                            <span style={{ fontSize:11, color:sub }}>Forecast:</span>
                            <button
                              onClick={() => {
                                setEditingMilestone(m.id)
                                setForecastDate(m.forecast_date?.slice(0,10) || '')
                                setForecastReason('')
                              }}
                              style={{ fontSize:11, color:'#2563eb', background:'none', border:'none', cursor:'pointer', padding:0, textDecoration:'underline' }}
                            >
                              {m.forecast_date ? fmt(m.forecast_date) : 'Set forecast'}
                            </button>
                            {m.forecast_changed_count > 0 && (
                              <button
                                onClick={() => loadHistory(m.id)}
                                style={{ fontSize:10, color:sub, background:'none', border:'none', cursor:'pointer', padding:0, textDecoration:'underline' }}
                              >
                                Changed {m.forecast_changed_count}×
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ marginTop:6, background: dark ? '#243145' : '#f8fafc', borderRadius:6, padding:'10px 12px', border:`1px solid ${bd}` }}>
                            <input type="date" value={forecastDate}
                              onChange={e => setForecastDate(e.target.value)}
                              style={{ width:'100%', fontSize:12, padding:'5px 8px', borderRadius:4, border:`1px solid ${bd}`, background:bg, color:col, marginBottom:6 }}
                            />
                            <textarea
                              value={forecastReason}
                              onChange={e => setForecastReason(e.target.value)}
                              placeholder="Reason for change (required)"
                              rows={2}
                              style={{ width:'100%', fontSize:12, padding:'5px 8px', borderRadius:4, border:`1px solid ${bd}`, background:bg, color:col, resize:'vertical', boxSizing:'border-box', fontFamily:'inherit', marginBottom:6 }}
                            />
                            <div style={{ display:'flex', gap:6 }}>
                              <button
                                onClick={saveForecast}
                                disabled={savingForecast || !forecastReason.trim()}
                                style={{ fontSize:11, padding:'4px 12px', borderRadius:4, background:'#2563eb', color:'#fff', border:'none', cursor:'pointer', opacity: (!forecastReason.trim() || savingForecast) ? 0.5 : 1 }}
                              >Save</button>
                              <button
                                onClick={() => { setEditingMilestone(null); setForecastDate(''); setForecastReason('') }}
                                style={{ fontSize:11, padding:'4px 10px', borderRadius:4, background:'none', border:`1px solid ${bd}`, color:sub, cursor:'pointer' }}
                              >Cancel</button>
                            </div>
                          </div>
                        )}

                        {/* Forecast history */}
                        {showHistory && history.length > 0 && (
                          <div style={{ marginTop:6, background: dark ? '#1e293b' : '#f8fafc', borderRadius:6, padding:'8px 10px' }}>
                            {history.map(h => (
                              <div key={h.id} style={{ fontSize:11, color:sub, marginBottom:4, borderBottom:`1px solid ${bd}`, paddingBottom:4 }}>
                                <div><span style={{ color:col }}>{h.new_value ? fmt(h.new_value) : '(cleared)'}</span> ← {h.old_value ? fmt(h.old_value) : 'none'}</div>
                                <div>{h.reason} · {h.changed_by_name || 'unknown'} · {fmt(h.changed_at)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Section>

              {/* ── LINE ITEMS ── */}
              <Section label={`Line Items (${po.lines?.length || 0})`} dark={dark}>
                {(po.lines || []).map(line => (
                  <div key={line.id} style={{
                    background: dark ? '#1e293b' : '#f8fafc',
                    border:`1px solid ${bd}`, borderRadius:8, padding:'12px 14px', marginBottom:10,
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                      <div>
                        <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'#E84E0F' }}>L-{line.line_number}</span>
                        <span style={{ fontSize:13, fontWeight:600, color:col, marginLeft:8 }}>{line.description}</span>
                      </div>
                      <span style={{ fontSize:11, color:sub, whiteSpace:'nowrap' }}>{line.qty} {line.uom}</span>
                    </div>
                    {line.cdd && <div style={{ fontSize:11, color:sub, marginTop:3 }}>CDD: {fmt(line.cdd)}</div>}

                    {/* Heat number */}
                    {!!line.heat_number_required && (
                      <div style={{ marginTop:6, fontSize:11 }}>
                        <span style={{ color:sub }}>Heat #: </span>
                        <span style={{ color: line.heat_number ? '#22c55e' : '#f59e0b' }}>
                          {line.heat_number || 'Not recorded'}
                        </span>
                      </div>
                    )}

                    {/* Commodity warning */}
                    {!line.commodity_id && !line.equipment_tag && (
                      <div style={{ fontSize:11, color:'#d97706', marginTop:5 }}>
                        ⚠ No commodity or equipment tag linked
                      </div>
                    )}
                    {(line.commodity_name || line.equipment_tag) && (
                      <div style={{ fontSize:11, color:sub, marginTop:3 }}>
                        {line.commodity_name || ''}{line.equipment_tag ? ` · ${line.equipment_tag}` : ''}
                      </div>
                    )}

                    {/* Child items */}
                    {line.child_items?.length > 0 && (
                      <div style={{ marginTop:8, paddingLeft:8, borderLeft:`2px solid ${bd}` }}>
                        {line.child_items.map(c => (
                          <div key={c.id} style={{ fontSize:11, color:sub, marginBottom:3 }}>
                            <span style={{ fontFamily:'JetBrains Mono, monospace', color:'#64748b' }}>{line.line_number}.{c.sub_number}</span>
                            {' '}{c.description} · {c.qty} {c.uom}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add child item */}
                    {addingChildLine === line.id ? (
                      <div style={{ marginTop:8, background: dark ? '#243145' : '#fff', borderRadius:6, padding:'10px', border:`1px solid ${bd}` }}>
                        <div style={{ fontSize:11, fontWeight:600, color:col, marginBottom:6 }}>New Child Item</div>
                        <input placeholder="Description" value={newChild.description}
                          onChange={e => setNewChild(p => ({ ...p, description:e.target.value }))}
                          style={{ width:'100%', fontSize:11, padding:'4px 7px', borderRadius:4, border:`1px solid ${bd}`, background:bg, color:col, marginBottom:4, boxSizing:'border-box' }}
                        />
                        <div style={{ display:'flex', gap:4, marginBottom:4 }}>
                          <input placeholder="Qty" type="number" value={newChild.qty}
                            onChange={e => setNewChild(p => ({ ...p, qty:e.target.value }))}
                            style={{ width:70, fontSize:11, padding:'4px 7px', borderRadius:4, border:`1px solid ${bd}`, background:bg, color:col }}
                          />
                          <input placeholder="UOM" value={newChild.uom}
                            onChange={e => setNewChild(p => ({ ...p, uom:e.target.value }))}
                            style={{ width:70, fontSize:11, padding:'4px 7px', borderRadius:4, border:`1px solid ${bd}`, background:bg, color:col }}
                          />
                          <input placeholder="CDD" type="date" value={newChild.cdd}
                            onChange={e => setNewChild(p => ({ ...p, cdd:e.target.value }))}
                            style={{ flex:1, fontSize:11, padding:'4px 7px', borderRadius:4, border:`1px solid ${bd}`, background:bg, color:col }}
                          />
                        </div>
                        <div style={{ display:'flex', gap:5 }}>
                          <button onClick={() => postChild(line.id)}
                            style={{ fontSize:11, padding:'4px 12px', borderRadius:4, background:'#2563eb', color:'#fff', border:'none', cursor:'pointer' }}>
                            Add
                          </button>
                          <button onClick={() => setAddingChildLine(null)}
                            style={{ fontSize:11, padding:'4px 10px', borderRadius:4, background:'none', border:`1px solid ${bd}`, color:sub, cursor:'pointer' }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAddingChildLine(line.id); setNewChild({ description:'', qty:'', uom:'', cdd:'', notes:'' }) }}
                        style={{ marginTop:8, fontSize:11, color:'#2563eb', background:'none', border:'none', cursor:'pointer', padding:0 }}>
                        + Add child item
                      </button>
                    )}
                  </div>
                ))}
                {(!po.lines || po.lines.length === 0) && (
                  <div style={{ fontSize:12, color:sub, textAlign:'center', padding:'16px 0' }}>No line items</div>
                )}
              </Section>

              {/* ── ACTION NOTES ── */}
              <Section label="Action Notes" dark={dark}>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Add an action note…"
                  rows={3}
                  style={{ width:'100%', fontSize:12, padding:'7px 10px', borderRadius:6, border:`1px solid ${bd}`, background:bg, color:col, resize:'vertical', boxSizing:'border-box', fontFamily:'inherit', marginBottom:8 }}
                />
                <button
                  onClick={postNote}
                  disabled={postingNote || !noteText.trim()}
                  style={{ fontSize:12, padding:'6px 16px', borderRadius:5, background:'#E84E0F', color:'#fff', border:'none', cursor:'pointer', opacity: (!noteText.trim() || postingNote) ? 0.5 : 1 }}>
                  Post Note
                </button>

                <div style={{ marginTop:12 }}>
                  {(po.action_notes || []).map(n => (
                    <div key={n.id} style={{ borderBottom:`1px solid ${bd}`, paddingBottom:8, marginBottom:8 }}>
                      <div style={{ fontSize:12, color:col }}>{n.text}</div>
                      <div style={{ fontSize:10, color:sub, marginTop:3 }}>
                        {n.created_by_name || 'Unknown'} · {fmt(n.created_at)}
                      </div>
                    </div>
                  ))}
                  {(!po.action_notes || po.action_notes.length === 0) && (
                    <div style={{ fontSize:12, color:sub }}>No notes yet.</div>
                  )}
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </>
  )

  return createPortal(panel, document.body)
}

// ─── SUB COMPONENTS ───────────────────────────────────────────
const Section = ({ label, dark, children }: { label: string; dark: boolean; children: React.ReactNode }) => {
  const [open, setOpen] = useState(true)
  const bd = dark ? '#334155' : '#e2e8f0'
  const col = dark ? '#f1f5f9' : '#0f172a'
  return (
    <div style={{ marginBottom:16, border:`1px solid ${bd}`, borderRadius:8, overflow:'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width:'100%', textAlign:'left', padding:'10px 14px', background: dark ? '#1e293b' : '#f8fafc',
        border:'none', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center',
        fontSize:13, fontWeight:600, color:col, fontFamily:'IBM Plex Sans, sans-serif',
      }}>
        {label}
        <span style={{ fontSize:11, color:'#94a3b8' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding:'12px 14px' }}>{children}</div>}
    </div>
  )
}

const DateField = ({ label, value, sub }: { label: string; value?: string | null; sub: string }) => (
  <div style={{ fontSize:11 }}>
    <span style={{ color:sub }}>{label}: </span>
    <span style={{ color: value ? '#0f172a' : sub }}>
      {value ? new Date(value).toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' }) : '—'}
    </span>
  </div>
)
