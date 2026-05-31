// ─── EXPEDITING SCREEN ───────────────────────────────────────
// Expediting module — contains both the PO Register (expediting view)
// and the VDRL Register. VDRL was previously a standalone module and
// is now integrated here per the CLAUDE_CONTEXT.md architecture update.
//
// IMPORTANT: Expediting is not yet fully built. This screen provides
// the correct structural shell — view toggle + tab structure — ready
// for the full build when Expediting is next in the module queue.
import { useState } from 'react'
import { BackButton } from '../components/BackButton'

interface ExpeditingScreenProps {
  dark: boolean
  projectId: number
  projectName: string
  onBack: () => void
  defaultView?: 'po-register' | 'vdrl-register'
}

export const ExpeditingScreen = ({
  dark, projectId, projectName, onBack, defaultView = 'po-register',
}: ExpeditingScreenProps) => {
  const [view, setView] = useState<'po-register' | 'vdrl-register'>(defaultView)
  const col = dark ? '#f1f5f9' : '#0f172a'
  const bd  = `1px solid ${dark ? '#334155' : '#dde3ed'}`

  const tabBtn = (label: string, val: 'po-register' | 'vdrl-register') => (
    <button
      key={val}
      onClick={() => setView(val)}
      style={{
        padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer',
        fontFamily: 'IBM Plex Sans, sans-serif', fontSize: 13, fontWeight: view === val ? 600 : 400,
        background: view === val ? '#E84E0F' : (dark ? '#1e293b' : '#f4f7fb'),
        color: view === val ? '#fff' : '#64748b',
        transition: 'all 150ms',
      }}>
      {label}
    </button>
  )

  return (
    <div style={{ paddingTop: 20, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* ── Breadcrumb ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
        <BackButton onFallback={onBack} dark={dark} />
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>← Dashboard</button>
        <span>›</span><span>{projectName}</span><span>›</span>
        <span style={{ color: col, fontWeight: 600 }}>Expediting</span>
        {view === 'vdrl-register' && <><span>›</span><span style={{ color: col, fontWeight: 600 }}>VDRL Register</span></>}
      </div>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: col, letterSpacing: '-0.02em' }}>
            🚨 Expediting
          </h2>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3 }}>
            {view === 'po-register'
              ? `PO Register — ${projectName}`
              : `VDRL Register — Vendor Document Requirements — ${projectName}`}
          </div>
        </div>
      </div>

      {/* ── View Toggle: PO Register / VDRL Register ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {tabBtn('📋 PO Register', 'po-register')}
        {tabBtn('📑 VDRL Register', 'vdrl-register')}
      </div>

      {/* ── PO Register View ── */}
      {view === 'po-register' && (
        <div style={{ background: dark ? '#1e293b' : '#fff', border: bd, borderRadius: 10, padding: '48px 32px', textAlign: 'center', color: '#94a3b8', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🚨</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: dark ? '#e2e8f0' : '#475569', marginBottom: 8 }}>Expediting PO Register</div>
          <div style={{ fontSize: 13, maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>
            The Expediting module is next in the build queue. When complete, this view will show all
            Approved &amp; Locked POs being actively expedited — with milestone chains, action logs,
            SCN management, ITP tracking, and critical path monitoring.
          </div>
          <div style={{ marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: dark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.06)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', fontSize: 12, color: '#ef4444' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            8 overdue milestones · 3 overdue vendor documents
          </div>
        </div>
      )}

      {/* ── VDRL Register View ── */}
      {view === 'vdrl-register' && (
        <div>
          {/* ── VDRL KPI strip ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Total Docs', val: '—', color: col },
              { label: 'Submitted', val: '—', color: '#2563eb' },
              { label: 'Overdue', val: '3', color: '#ef4444' },
              { label: 'AFC Cleared', val: '—', color: '#22c55e' },
              { label: 'Action Req.', val: '—', color: '#f59e0b' },
              { label: '% Progress', val: '—', color: '#64748b' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ background: dark ? '#1e293b' : '#fff', border: bd, borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color }}>{val}</div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* ── VDRL inner tabs ── */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: bd, paddingBottom: 0 }}>
            {['Register', 'Expediting', 'Review cycle', 'Transmittals', 'Vendor contacts', 'MDR closeout', 'Alerts 🔴'].map(t => (
              <button key={t} style={{ padding: '7px 14px', background: 'none', border: 'none', borderBottom: t === 'Register' ? '2px solid #E84E0F' : '2px solid transparent', fontSize: 12, fontWeight: t === 'Register' ? 600 : 400, color: t === 'Register' ? '#E84E0F' : '#64748b', cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1 }}>
                {t}
              </button>
            ))}
          </div>

          {/* ── VDRL content placeholder ── */}
          <div style={{ background: dark ? '#1e293b' : '#fff', border: bd, borderRadius: 10, padding: '48px 32px', textAlign: 'center', color: '#94a3b8', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📑</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: dark ? '#e2e8f0' : '#475569', marginBottom: 8 }}>VDRL Register</div>
            <div style={{ fontSize: 13, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
              The VDRL Register has moved here from the standalone VDRL sidebar module. It tracks
              all vendor document requirements across active POs — review cycles, transmittals,
              MDR closeout, and vendor contacts. This will be fully built as part of the
              Expediting module development.
            </div>
            <div style={{ marginTop: 20, fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
              📌 Note: VDRL is now integrated into Expediting. The old /vdrl route redirects here.
            </div>
            <div style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: dark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.06)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)', fontSize: 12, color: '#f59e0b' }}>
              ⚠ 3 vendor documents overdue
            </div>
          </div>

          {/* ── Per-PO VDRL Panel note ── */}
          <div style={{ marginTop: 16, background: dark ? 'rgba(37,99,235,0.08)' : 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.18)', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: '#2563eb' }}>
            💡 <strong>Tip:</strong> When viewing a specific PO in the Expediting PO Detail Panel, a
            <strong> 📄 VDRL</strong> button shows vendor docs for that PO only — giving expeditors
            instant access without leaving the PO context.
          </div>
        </div>
      )}
    </div>
  )
}
