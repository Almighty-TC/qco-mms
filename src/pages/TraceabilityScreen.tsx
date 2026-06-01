// ─── TRACEABILITY SCREEN ──────────────────────────────────────
// Full screen, four tabs: VDRL · Cert approvals · Trace chain · Holds.
// Reuses the module token set, pill + table patterns. RAG colours per
// CLAUDE_CONTEXT (green on-track / amber at-risk / red breached /
// grey not-started / blue in-progress).
import React, { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import { BackButton } from '../components/BackButton'
import { ToastProvider, useToast } from '../hooks/useToast'
import { API, tokens, fmtDate } from '../components/traceability/traceUtil'
import { UploadCertModal, type VdrlRow } from '../components/traceability/UploadCertModal'
import { CertDetailModal } from '../components/traceability/CertDetailModal'
import { ReviewCertModal, type ApprovalCert } from '../components/traceability/ReviewCertModal'
import { RejectReasonModal } from '../components/traceability/RejectReasonModal'
import { ChaseCertModal, type HoldRow } from '../components/traceability/ChaseCertModal'

type Tab = 'vdrl' | 'approvals' | 'trace' | 'holds'

interface Summary { vdrl_received: number; vdrl_pending: number; vdrl_overdue: number; active_holds: number }
interface VdrlFull extends VdrlRow { is_required: number; due_date: string | null; received_date: string | null }
interface TraceStage { stage: string; ref: string; date: string; actor: string; detail: string; node_state: string; badge: string | null }

// ─── STATUS PILL (VDRL) ───────────────────────────────────────
const vdrlPill = (status: string) => {
  if (status === 'received' || status === 'verified') return { label: 'Received', color: '#16a34a', bg: 'rgba(34,197,94,0.12)' }
  if (status === 'pending') return { label: 'Pending', color: '#d97706', bg: 'rgba(245,158,11,0.12)' }
  if (status === 'overdue') return { label: 'Overdue', color: '#dc2626', bg: 'rgba(239,68,68,0.12)' }
  if (status === 'rejected') return { label: 'Rejected', color: '#dc2626', bg: 'rgba(239,68,68,0.12)' }
  return { label: status, color: '#64748b', bg: 'rgba(100,116,139,0.12)' }
}

// ─── TRACE NODE COLOURS ───────────────────────────────────────
const NODE_COLOR: Record<string, string> = { complete: '#22c55e', warning: '#f59e0b', blocked: '#ef4444', pending: '#94a3b8' }
const BADGE_STYLE: Record<string, { color: string; bg: string }> = {
  WATCH:   { color: '#d97706', bg: 'rgba(245,158,11,0.14)' },
  BLOCKED: { color: '#dc2626', bg: 'rgba(239,68,68,0.14)' },
  PENDING: { color: '#475569', bg: 'rgba(100,116,139,0.16)' },
}
const STAGE_ICON: Record<string, string> = { PO: '§', MFG: '⚙', INSPECT: '✓', SCN: '➜', RECEIPT: '⬇', CERT: '📎' }
const STAGE_LABEL: Record<string, string> = { PO: 'PO', MFG: 'Manufacture', INSPECT: 'Inspection', SCN: 'Shipment (SCN)', RECEIPT: 'Receipt', CERT: 'Certificate' }

const TraceabilityInner = ({ dark, projectId, projectName, onBack }: {
  dark: boolean; projectId: number; projectName: string; onBack: () => void
}) => {
  const { addToast } = useToast()
  const t = tokens(dark)

  const [tab, setTab] = useState<Tab>('vdrl')
  const [summary, setSummary] = useState<Summary | null>(null)

  // VDRL
  const [vdrl, setVdrl] = useState<VdrlFull[]>([])
  const [vdrlStatus, setVdrlStatus] = useState<'all' | 'received' | 'pending' | 'overdue'>('all')
  const [vdrlSearch, setVdrlSearch] = useState('')
  const [allVdrl, setAllVdrl] = useState<VdrlFull[]>([]) // unfiltered, for modal selectors + tab count

  // Approvals + holds
  const [approvals, setApprovals] = useState<ApprovalCert[]>([])
  const [holds, setHolds] = useState<HoldRow[]>([])

  // Trace
  const [tags, setTags] = useState<string[]>([])
  const [activeTag, setActiveTag] = useState<string>('')
  const [traceSearch, setTraceSearch] = useState('')
  const [lifecycle, setLifecycle] = useState<TraceStage[]>([])

  // Modals
  const [uploadOpen, setUploadOpen] = useState<null | { mode: 'global' | 'row'; prefill?: any }>(null)
  const [detailCertId, setDetailCertId] = useState<number | null>(null)
  const [reviewCert, setReviewCert] = useState<ApprovalCert | null>(null)
  const [rejectCert, setRejectCert] = useState<ApprovalCert | null>(null)
  const [chaseHold, setChaseHold] = useState<HoldRow | null>(null)

  // ── Fetchers ────────────────────────────────────────────────
  const loadSummary = async () => {
    try { const { data } = await axios.get(`${API}/traceability/${projectId}/summary`); setSummary(data) }
    catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to load summary') }
  }
  const loadVdrl = async () => {
    try {
      const { data } = await axios.get(`${API}/traceability/${projectId}/vdrl`, { params: { status: vdrlStatus, q: vdrlSearch.trim() || undefined } })
      setVdrl(data.data || [])
    } catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to load VDRL') }
  }
  const loadAllVdrl = async () => {
    try { const { data } = await axios.get(`${API}/traceability/${projectId}/vdrl`, { params: { status: 'all' } }); setAllVdrl(data.data || []) } catch (_) {}
  }
  const loadApprovals = async () => {
    try { const { data } = await axios.get(`${API}/traceability/${projectId}/approvals`); setApprovals(data.data || []) }
    catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to load approvals') }
  }
  const loadHolds = async () => {
    try { const { data } = await axios.get(`${API}/traceability/${projectId}/holds`); setHolds(data.data || []) }
    catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to load holds') }
  }
  const loadTags = async () => {
    try {
      const { data } = await axios.get(`${API}/traceability/${projectId}/tags`)
      setTags(data.tags || [])
      if (!activeTag && data.tags?.length) setActiveTag(data.tags.find((x: string) => x === 'V-102') || data.tags[0])
    } catch (_) {}
  }
  const loadLifecycle = async (tag: string) => {
    if (!tag) { setLifecycle([]); return }
    try { const { data } = await axios.get(`${API}/traceability/${projectId}/trace/${encodeURIComponent(tag)}`); setLifecycle(data.lifecycle || []) }
    catch (e: any) { addToast('error', e.response?.data?.error || 'Failed to load trace chain') }
  }

  const refreshAll = () => { loadSummary(); loadVdrl(); loadAllVdrl(); loadApprovals(); loadHolds() }

  useEffect(() => { loadSummary(); loadAllVdrl(); loadApprovals(); loadHolds(); loadTags() }, [projectId]) // eslint-disable-line
  useEffect(() => { loadVdrl() }, [vdrlStatus, projectId]) // eslint-disable-line
  useEffect(() => { const id = setTimeout(loadVdrl, 300); return () => clearTimeout(id) }, [vdrlSearch]) // eslint-disable-line
  useEffect(() => { loadLifecycle(activeTag) }, [activeTag, projectId]) // eslint-disable-line

  // ── Trace tag filtering by search (tag / heat / PO) ─────────
  const visibleTags = useMemo(() => {
    if (!traceSearch.trim()) return tags
    const q = traceSearch.trim().toLowerCase()
    return tags.filter(tg => tg.toLowerCase().includes(q))
  }, [tags, traceSearch])

  // ── Styles ──────────────────────────────────────────────────
  const inputSt: React.CSSProperties = { fontSize: 12, padding: '7px 10px', borderRadius: 6, border: t.bd, background: t.inputBg, color: t.col, fontFamily: 'inherit' }
  const thSt: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: t.sub, textTransform: 'uppercase', whiteSpace: 'nowrap' }
  const tdSt: React.CSSProperties = { padding: '9px 12px', fontSize: 12, color: t.col }
  const mono: React.CSSProperties = { fontFamily: 'JetBrains Mono, monospace' }

  const tabBtn = (key: Tab, label: string, count?: number, countColor?: string) => {
    const active = tab === key
    return (
      <button onClick={() => setTab(key)} key={key}
        style={{ padding: '10px 16px', border: 'none', borderBottom: `2px solid ${active ? '#2563eb' : 'transparent'}`, background: 'none', color: active ? t.col : t.sub, cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
        {count != null && (
          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', padding: '1px 7px', borderRadius: 9999, background: countColor || (dark ? '#334155' : '#eef2f7'), color: countColor ? '#fff' : t.sub }}>{count}</span>
        )}
      </button>
    )
  }

  return (
    <div style={{ background: t.bg, minHeight: '100vh', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Sticky breadcrumb header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: t.cardBg, borderBottom: t.bd, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BackButton onClick={onBack} dark={dark} />
          <div style={{ fontSize: 11, color: t.sub }}>Dashboard › {projectName} › <strong style={{ color: t.col }}>Traceability</strong></div>
        </div>
        <button onClick={() => setUploadOpen({ mode: 'global' })}
          style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          ↑ Upload cert
        </button>
      </div>

      <div style={{ padding: 24 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: t.col }}>Traceability</h1>
        <div style={{ fontSize: 12, color: t.sub, marginBottom: 20 }}>VDRL, cert approvals, trace chain &amp; holds · {projectName}</div>

        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'VDRL received', value: summary?.vdrl_received, color: '#22c55e' },
            { label: 'VDRL pending',  value: summary?.vdrl_pending,  color: '#f59e0b' },
            { label: 'VDRL overdue',  value: summary?.vdrl_overdue,  color: '#ef4444' },
            { label: 'Active trace holds', value: summary?.active_holds, color: '#ef4444' },
          ].map(k => (
            <div key={k.label} style={{ background: t.cardBg, border: t.bd, borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: k.color }}>{k.value ?? '…'}</div>
              <div style={{ fontSize: 11, color: t.sub, marginTop: 2 }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, borderBottom: t.bd, marginBottom: 18 }}>
          {tabBtn('vdrl', 'VDRL', allVdrl.length)}
          {tabBtn('approvals', 'Cert approvals', approvals.length, approvals.length ? '#f59e0b' : undefined)}
          {tabBtn('trace', 'Trace chain')}
          {tabBtn('holds', 'Holds', holds.length, holds.length ? '#ef4444' : undefined)}
        </div>

        {/* ═══ VDRL TAB ═══ */}
        {tab === 'vdrl' && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={vdrlSearch} onChange={e => setVdrlSearch(e.target.value)} placeholder="Search PO, vendor, tag, document…" style={{ ...inputSt, flex: '1 1 280px' }} />
              <div style={{ display: 'flex', border: t.bd, borderRadius: 6, overflow: 'hidden' }}>
                {(['all', 'received', 'pending', 'overdue'] as const).map(s => (
                  <button key={s} onClick={() => setVdrlStatus(s)}
                    style={{ padding: '7px 14px', border: 'none', background: vdrlStatus === s ? '#2563eb' : 'none', color: vdrlStatus === s ? '#fff' : t.sub, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', textTransform: 'capitalize' }}>
                    {s === 'all' ? 'All' : s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: t.cardBg, border: t.bd, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: t.theadBg }}>
                    <tr style={{ borderBottom: t.bd }}>
                      {['PO REF', 'VENDOR', 'TAG', 'DOCUMENT', 'STATUS', 'DUE', 'RECEIVED', ''].map(h => <th key={h} style={thSt}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {vdrl.map(r => {
                      const pill = vdrlPill(r.status)
                      const received = r.status === 'received' || r.status === 'verified'
                      const late = received && r.received_date && r.due_date && new Date(r.received_date) > new Date(r.due_date)
                      return (
                        <tr key={r.cert_id} style={{ borderBottom: t.rowBd }}>
                          <td style={{ ...tdSt, ...mono, color: '#2563eb', fontWeight: 600 }}>{r.po_ref || '—'}</td>
                          <td style={tdSt}>{r.vendor_name || '—'}</td>
                          <td style={{ ...tdSt, ...mono, fontSize: 11, color: r.tag ? t.col : t.sub }}>{r.tag || '—'}</td>
                          <td style={tdSt}>
                            {r.document_name}
                            {!!r.is_required && <span style={{ marginLeft: 7, fontSize: 9, padding: '1px 5px', borderRadius: 5, background: dark ? '#334155' : '#eef2f7', color: t.sub, fontWeight: 700, letterSpacing: '0.03em' }}>REQ</span>}
                          </td>
                          <td style={tdSt}><span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: pill.bg, color: pill.color, fontWeight: 600 }}>{pill.label}</span></td>
                          <td style={{ ...tdSt, ...mono, fontSize: 11, color: t.sub }}>{fmtDate(r.due_date)}</td>
                          <td style={{ ...tdSt, ...mono, fontSize: 11, color: received ? (late ? '#d97706' : '#16a34a') : t.sub }}>
                            {received ? <>{fmtDate(r.received_date)}{late && <span> · late</span>}</> : '—'}
                          </td>
                          <td style={tdSt}>
                            {received ? (
                              <button onClick={() => setDetailCertId(r.cert_id)} style={{ padding: '4px 12px', borderRadius: 5, border: t.bd, background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>View</button>
                            ) : (
                              <button onClick={() => setUploadOpen({ mode: 'row', prefill: { po_ref: r.po_ref, vendor_name: r.vendor_name, tag: r.tag, document_name: r.document_name, document_requirement_id: r.cert_id } })}
                                style={{ padding: '4px 12px', borderRadius: 5, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Upload</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {vdrl.length === 0 && <tr><td colSpan={8} style={{ ...tdSt, textAlign: 'center', color: t.sub, padding: 40 }}>No VDRL items match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ fontSize: 11, color: t.sub, marginTop: 10 }}>VDRL — Vendor Document Requirements List</div>
          </div>
        )}

        {/* ═══ APPROVALS TAB ═══ */}
        {tab === 'approvals' && (
          <div>
            <div style={{ background: dark ? '#162032' : '#fffbeb', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: dark ? '#f1f5f9' : '#92400e' }}>
              📋 {approvals.length} certificate{approvals.length !== 1 ? 's' : ''} awaiting QA verification.
            </div>
            <div style={{ background: t.cardBg, border: t.bd, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: t.theadBg }}>
                    <tr style={{ borderBottom: t.bd }}>
                      {['FILE', 'TYPE', 'ITEM/SCOPE', 'VENDOR/UPLOADER', 'UPLOADED', 'PRIORITY', 'ACTION'].map(h => <th key={h} style={thSt}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {approvals.map(a => (
                      <tr key={a.cert_id} style={{ borderBottom: t.rowBd }}>
                        <td style={{ ...tdSt, ...mono, fontSize: 11, color: '#2563eb', fontWeight: 600 }}>{a.file_name}</td>
                        <td style={tdSt}>{a.cert_type}</td>
                        <td style={tdSt}>{a.item_scope}{a.applies_to ? <span style={{ color: t.sub }}> · {a.applies_to}</span> : ''}</td>
                        <td style={tdSt}>{a.vendor_name} <span style={{ color: t.sub }}>/ {a.uploader}</span></td>
                        <td style={{ ...tdSt, ...mono, fontSize: 11, color: t.sub }}>{fmtDate(a.uploaded_date)}</td>
                        <td style={tdSt}>
                          {a.priority === 'high'
                            ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.12)', color: '#dc2626', fontWeight: 700 }}>HIGH</span>
                            : <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: dark ? '#334155' : '#eef2f7', color: t.sub, fontWeight: 600 }}>Normal</span>}
                        </td>
                        <td style={tdSt}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => setReviewCert(a)} style={{ padding: '4px 10px', borderRadius: 5, border: 'none', background: dark ? '#312e5e' : '#ede9fe', color: '#7c3aed', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>👁 Review</button>
                            <button onClick={() => setReviewCert(a)} style={{ padding: '4px 10px', borderRadius: 5, border: 'none', background: 'rgba(34,197,94,0.14)', color: '#16a34a', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓ Verify</button>
                            <button onClick={() => setRejectCert(a)} style={{ padding: '4px 10px', borderRadius: 5, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#dc2626', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Reject</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {approvals.length === 0 && <tr><td colSpan={7} style={{ ...tdSt, textAlign: 'center', color: t.sub, padding: 40 }}>No certificates awaiting verification.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ TRACE CHAIN TAB ═══ */}
        {tab === 'trace' && (
          <div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: t.sub, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trace</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {visibleTags.map(tg => (
                  <button key={tg} onClick={() => setActiveTag(tg)}
                    style={{ padding: '5px 12px', borderRadius: 9999, border: `1px solid ${activeTag === tg ? '#2563eb' : (dark ? '#334155' : '#dde3ed')}`, background: activeTag === tg ? '#2563eb' : 'none', color: activeTag === tg ? '#fff' : t.col, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                    {tg}
                  </button>
                ))}
              </div>
              <input value={traceSearch} onChange={e => setTraceSearch(e.target.value)} placeholder="Search tag / heat / PO…" style={{ ...inputSt, marginLeft: 'auto', flex: '0 1 220px' }} />
            </div>

            <div style={{ background: t.cardBg, border: t.bd, borderRadius: 8, padding: '24px 28px' }}>
              {lifecycle.length === 0 ? (
                <div style={{ textAlign: 'center', color: t.sub, padding: 40 }}>Select a tag to view its trace chain.</div>
              ) : (
                <div>
                  {lifecycle.map((s, i) => {
                    const color = NODE_COLOR[s.node_state] || '#94a3b8'
                    const filled = s.node_state !== 'pending'
                    const isLast = i === lifecycle.length - 1
                    const badge = s.badge ? BADGE_STYLE[s.badge] : null
                    return (
                      <div key={i} style={{ display: 'flex', gap: 16, position: 'relative' }}>
                        {/* Node + connector */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 34, flexShrink: 0 }}>
                          <div style={{ width: 30, height: 30, borderRadius: '50%', background: filled ? color : 'transparent', border: filled ? 'none' : `2px solid ${color}`, color: filled ? '#fff' : color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, zIndex: 1 }}>
                            {STAGE_ICON[s.stage] || '•'}
                          </div>
                          {!isLast && <div style={{ width: 2, flex: 1, minHeight: 34, background: s.node_state === 'complete' ? '#22c55e' : (dark ? '#334155' : '#e2e8f0') }} />}
                        </div>
                        {/* Content */}
                        <div style={{ flex: 1, paddingBottom: isLast ? 0 : 18 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color }}>{STAGE_LABEL[s.stage] || s.stage}</span>
                              <span style={{ ...mono, fontSize: 12, color: t.col }}>{s.ref}</span>
                              {s.date && s.date !== '—' && <span style={{ ...mono, fontSize: 11, color: t.sub }}>· {fmtDate(s.date)}</span>}
                              {s.actor && s.actor !== '—' && <span style={{ fontSize: 11, color: t.sub }}>· {s.actor}</span>}
                            </div>
                            {badge && <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 6, background: badge.bg, color: badge.color, fontWeight: 700, flexShrink: 0 }}>{s.badge}</span>}
                          </div>
                          {s.detail && s.detail !== '—' && <div style={{ fontSize: 12, color: t.sub, marginTop: 3, lineHeight: 1.4 }}>{s.detail}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ HOLDS TAB ═══ */}
        {tab === 'holds' && (
          <div>
            <div style={{ background: dark ? '#2a1414' : '#fef2f2', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: dark ? '#fca5a5' : '#991b1b' }}>
              ⚠ {holds.length} active trace hold{holds.length !== 1 ? 's' : ''} — material cannot be released until certs are verified.
            </div>
            <div style={{ background: t.cardBg, border: t.bd, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: t.theadBg }}>
                    <tr style={{ borderBottom: t.bd }}>
                      {['TAG', 'ITEM', 'HOLD REASON', 'LOCATION', 'SINCE', 'AGE', 'ACTION'].map(h => <th key={h} style={thSt}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {holds.map(h => (
                      <tr key={h.hold_id} style={{ borderBottom: t.rowBd }}>
                        <td style={{ ...tdSt, ...mono, fontSize: 11, color: h.tag ? '#2563eb' : t.sub, fontWeight: 600 }}>{h.tag || '—'}</td>
                        <td style={tdSt}>{h.item}</td>
                        <td style={{ ...tdSt, color: '#dc2626', fontWeight: 500 }}>{h.hold_reason}</td>
                        <td style={{ ...tdSt, ...mono, fontSize: 11, color: t.sub }}>{(h as any).location}</td>
                        <td style={{ ...tdSt, ...mono, fontSize: 11, color: t.sub }}>{fmtDate((h as any).since_date)}</td>
                        <td style={{ ...tdSt, ...mono, color: '#dc2626', fontWeight: 700 }}>{(h as any).age_days} d</td>
                        <td style={tdSt}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => setChaseHold(h)} style={{ padding: '4px 10px', borderRadius: 5, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>📎 Chase cert</button>
                            <button onClick={() => { if (h.tag) { setActiveTag(h.tag); setTab('trace') } else { addToast('error', 'No tag linked to this hold') } }}
                              style={{ padding: '4px 10px', borderRadius: 5, border: t.bd, background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>View</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {holds.length === 0 && <tr><td colSpan={7} style={{ ...tdSt, textAlign: 'center', color: t.sub, padding: 40 }}>No active holds.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {uploadOpen && (
        <UploadCertModal key={`${uploadOpen.mode}-${uploadOpen.prefill?.document_requirement_id ?? 'new'}`}
          dark={dark} projectId={projectId} mode={uploadOpen.mode} prefill={uploadOpen.prefill} vdrlRows={allVdrl}
          onClose={() => setUploadOpen(null)}
          onUploaded={msg => { setUploadOpen(null); addToast('success', msg); refreshAll() }} />
      )}
      {detailCertId != null && (
        <CertDetailModal dark={dark} projectId={projectId} certId={detailCertId}
          onClose={() => setDetailCertId(null)} onChanged={refreshAll} />
      )}
      {reviewCert && (
        <ReviewCertModal dark={dark} cert={reviewCert}
          onClose={() => setReviewCert(null)}
          onVerified={msg => { setReviewCert(null); addToast('success', msg); refreshAll() }} />
      )}
      {rejectCert && (
        <RejectReasonModal dark={dark} certId={rejectCert.cert_id} fileName={rejectCert.file_name}
          onClose={() => setRejectCert(null)}
          onDone={msg => { setRejectCert(null); addToast('success', msg); refreshAll() }} />
      )}
      {chaseHold && (
        <ChaseCertModal dark={dark} hold={chaseHold}
          onClose={() => setChaseHold(null)}
          onChased={msg => { setChaseHold(null); addToast('success', msg); loadHolds() }} />
      )}
    </div>
  )
}

export const TraceabilityScreen = (props: { dark: boolean; projectId: number; projectName: string; onBack: () => void }) => (
  <ToastProvider><TraceabilityInner {...props} /></ToastProvider>
)
