// ─── SCOPE BANNER ─────────────────────────────────────────────
// Blue info banner shown to scoped users (subcontractor / freight_forwarder).
// Sits below the page header, above KPI cards.
import React from 'react'

interface Props {
  role: 'subcontractor' | 'freight_forwarder'
  wbsScopes?: string[]   // for subcontractor
  scnCount?: number      // for freight_forwarder
}

export const ScopeBanner: React.FC<Props> = ({ role, wbsScopes = [], scnCount }) => (
  <div style={{
    background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8,
    padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
    fontSize: 13, color: '#1D4ED8', fontFamily: 'IBM Plex Sans, sans-serif',
  }}>
    <span style={{ fontSize: 16 }}>ℹ</span>
    {role === 'subcontractor' ? (
      <span>
        You are viewing as <strong>Subcontractor</strong>
        {wbsScopes.length > 0 && (
          <> · WBS scope:&nbsp;
            {wbsScopes.map((s, i) => (
              <span key={s}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{s}</span>
                {i < wbsScopes.length - 1 && ' · '}
              </span>
            ))}
          </>
        )}
        &nbsp;· <strong>Read-only access</strong>
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
