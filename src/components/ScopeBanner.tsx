// ─── SCOPE BANNER ─────────────────────────────────────────────
// Blue info banner shown to scoped users (site contractor / subcontractor / freight_forwarder).
// Contractors (ext-3): the codes come from the list response's wbs_scopes — an empty array
// means the whole project and a missing one an older backend; neither shows a banner.
// Sits below the page header, above KPI cards.
import React from 'react'

interface Props {
  role: 'site_contractor' | 'subcontractor' | 'freight_forwarder'
  wbsScopes?: string[]   // for contractors
  scnCount?: number      // for freight_forwarder
}

export const ScopeBanner: React.FC<Props> = ({ role, wbsScopes = [], scnCount }) => role !== 'freight_forwarder' && wbsScopes.length === 0 ? null : (
  <div style={{
    background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8,
    padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
    fontSize: 13, color: '#1D4ED8', fontFamily: 'IBM Plex Sans, sans-serif',
  }}>
    <span style={{ fontSize: 16 }}>ℹ</span>
    {role !== 'freight_forwarder' ? (
      <span>
        Showing materials under your granted WBS:&nbsp;
        {wbsScopes.map((s, i) => (
          <span key={s}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{s}</span>
            {i < wbsScopes.length - 1 && ' · '}
          </span>
        ))}
      </span>
    ) : (
      <span>
        You are viewing as <strong>Freight Forwarder</strong>
        {scnCount !== undefined && <> · <strong>{scnCount}</strong> shipments assigned to you</>}
        &nbsp;· <strong>Read-only access</strong>
      </span>
    )}
  </div>
)
