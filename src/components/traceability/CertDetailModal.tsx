// ─── CERT DETAIL MODAL ────────────────────────────────────────
// Shows a cert's version history (left), metadata (right), a mock PDF
// preview pane, and Download / Email actions. "+ Add new version"
// reveals an inline form that POSTs /cert/:certId/version (multipart).
import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { API, tokens, fmtDate, fmtBytes, scrimStyle } from './traceUtil'
import { useExpand, ExpandBtn } from '../ExpandToggle'

interface Version {
  id: number; rev: string; heat_ref: string; applies_to: string | null
  file_name: string; file_size: number; status: string
  uploaded_by: string | null; uploaded_date: string | null
  verified_by: string | null; verified_date: string | null
}
interface Cert {
  id: number; po_ref: string | null; vendor_name: string | null; tag: string | null
  document_name: string; heat_ref: string | null; applies_to: string | null
  uploaded_date: string | null; verified_date: string | null; verified_by: number | null
  file_name: string | null
}

interface Props {
  dark: boolean
  projectId: number
  certId: number
  onClose: () => void
  onChanged?: () => void
}

export const CertDetailModal: React.FC<Props> = ({ dark, projectId, certId, onClose, onChanged }) => {
  const t = tokens(dark)
  const [cert, setCert] = useState<Cert | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [activeRev, setActiveRev] = useState<number | null>(null)
  const [expanded, toggleExpand] = useExpand()
  // Heat/Lot P5 — where this cert's heat now lives (stock / issued / transferred).
  const [material, setMaterial] = useState<{ stock: any[]; issues: any[]; transfers: any[] } | null>(null)

  // Add-version inline form
  const [adding, setAdding] = useState(false)
  const [vHeat, setVHeat] = useState('')
  const [vApplies, setVApplies] = useState('')
  const [vFile, setVFile] = useState<File | null>(null)
  const [vSaving, setVSaving] = useState(false)
  const [vErr, setVErr] = useState('')
  const vFileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${API}/traceability/${projectId}/cert/${certId}`)
      setCert(data.cert); setVersions(data.versions || [])
      if (data.versions?.length) setActiveRev(data.versions[data.versions.length - 1].id)
    } catch (_) { /* surfaced by empty state */ }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [certId]) // eslint-disable-line

  // Heat/Lot P5 — fetch material carrying this cert's heat (normalised join).
  useEffect(() => {
    const h = cert?.heat_ref
    if (!h || !h.trim()) { setMaterial(null); return }
    axios.get(`${API}/traceability/${projectId}/heat/${encodeURIComponent(h.trim())}`)
      .then(({ data }) => setMaterial({ stock: data.stock || [], issues: data.issues || [], transfers: data.transfers || [] }))
      .catch(() => setMaterial(null))
  }, [cert?.heat_ref, projectId])

  const addVersion = async () => {
    setVErr('')
    if (!vHeat.trim()) { setVErr('Heat / batch / ref number is required.'); return }
    if (!vFile) { setVErr('A file is required.'); return }
    setVSaving(true)
    try {
      const fd = new FormData()
      fd.append('heat_ref', vHeat.trim())
      if (vApplies.trim()) fd.append('applies_to', vApplies.trim())
      fd.append('file', vFile)
      await axios.post(`${API}/traceability/cert/${certId}/version`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setAdding(false); setVHeat(''); setVApplies(''); setVFile(null)
      await load(); onChanged?.()
    } catch (e: any) { setVErr(e.response?.data?.error || 'Could not add version.') }
    finally { setVSaving(false) }
  }

  const active = versions.find(v => v.id === activeRev) || null
  const inputSt: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 9px', borderRadius: 6, border: t.bd, background: t.inputBg, color: t.col, fontFamily: 'inherit' }

  const metaRow = (k: string, v: React.ReactNode) => (
    <div style={{ padding: '6px 0', borderBottom: t.rowBd }}>
      <div style={{ fontSize: 10, color: t.sub, textTransform: 'uppercase', marginBottom: 2 }}>{k}</div>
      <div style={{ fontSize: 12, color: t.col }}>{v}</div>
    </div>
  )

  return (
    <>
      <div onClick={onClose} style={scrimStyle} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: t.cardBg, border: t.bd, borderRadius: 12, zIndex: 6001, width: expanded ? '95vw' : 920, height: expanded ? '90vh' : undefined, maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', fontFamily: 'IBM Plex Sans, sans-serif', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: t.bd, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.col }}>📎 {cert?.document_name || 'Certificate'}</div>
            <div style={{ fontSize: 12, color: t.sub, marginTop: 3 }}>
              {cert ? `${cert.po_ref || '—'} · ${cert.vendor_name || '—'} · ${cert.tag || 'no tag'} · ${versions.length} version${versions.length !== 1 ? 's' : ''} on file` : '…'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <ExpandBtn expanded={expanded} onToggle={toggleExpand} color={t.sub} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: t.sub, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div style={{ padding: 50, textAlign: 'center', color: t.sub }}>Loading…</div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '300px 1fr', gap: 0 }}>
            {/* Left — versions */}
            <div style={{ borderRight: t.bd, padding: 16, overflow: 'auto' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: t.sub, textTransform: 'uppercase', marginBottom: 10 }}>Cert versions</div>
              {versions.map(v => (
                <div key={v.id} onClick={() => setActiveRev(v.id)}
                  style={{ padding: '9px 11px', border: `1px solid ${v.id === activeRev ? '#2563eb' : (dark ? '#334155' : '#dde3ed')}`, borderRadius: 8, marginBottom: 8, cursor: 'pointer', background: v.id === activeRev ? (dark ? '#162032' : '#eff4fb') : 'transparent' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.col }}>Rev {v.rev}</span>
                    {v.status === 'verified'
                      ? <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 6, background: 'rgba(34,197,94,0.14)', color: '#16a34a', fontWeight: 700 }}>✓ Verified</span>
                      : v.status === 'rejected'
                      ? <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 6, background: 'rgba(239,68,68,0.14)', color: '#ef4444', fontWeight: 700 }}>Rejected</span>
                      : <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 6, background: dark ? '#334155' : '#eef2f7', color: t.sub, fontWeight: 600 }}>Received</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#2563eb', fontFamily: 'JetBrains Mono, monospace', marginTop: 3 }}>{v.heat_ref || '—'}</div>
                  <div style={{ fontSize: 10, color: t.sub, marginTop: 2 }}>{v.applies_to || '—'} · {fmtDate(v.uploaded_date)}</div>
                </div>
              ))}
              {versions.length === 0 && <div style={{ fontSize: 11, color: t.sub, fontStyle: 'italic' }}>No versions on file.</div>}

              {!adding ? (
                <button onClick={() => setAdding(true)}
                  style={{ width: '100%', padding: '8px', borderRadius: 6, border: `1px dashed ${dark ? '#334155' : '#c4cedf'}`, background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                  + Add new version
                </button>
              ) : (
                <div style={{ marginTop: 8, padding: 11, border: t.bd, borderRadius: 8, background: dark ? '#162032' : '#f8fafc' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.col, marginBottom: 8 }}>New version</div>
                  <input value={vHeat} onChange={e => setVHeat(e.target.value)} placeholder="Heat / batch / ref *" style={{ ...inputSt, marginBottom: 7 }} />
                  <input value={vApplies} onChange={e => setVApplies(e.target.value)} placeholder="Applies to" style={{ ...inputSt, marginBottom: 7 }} />
                  <input ref={vFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx" style={{ display: 'none' }} onChange={e => setVFile(e.target.files?.[0] || null)} />
                  <button onClick={() => vFileRef.current?.click()} style={{ ...inputSt, textAlign: 'left', cursor: 'pointer', color: vFile ? t.col : t.sub, marginBottom: 7 }}>
                    {vFile ? `📄 ${vFile.name}` : '↑ Choose file…'}
                  </button>
                  {vErr && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 7 }}>{vErr}</div>}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { setAdding(false); setVErr('') }} style={{ flex: 1, padding: '6px', borderRadius: 5, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 11 }}>Cancel</button>
                    <button onClick={addVersion} disabled={vSaving} style={{ flex: 1, padding: '6px', borderRadius: 5, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>{vSaving ? 'Saving…' : 'Add'}</button>
                  </div>
                </div>
              )}
            </div>

            {/* Right — metadata + preview */}
            <div style={{ padding: 18, overflow: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 18px', marginBottom: 14 }}>
                {metaRow('Heat / batch ref', <span style={{ color: '#2563eb', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{active?.heat_ref || cert?.heat_ref || '—'}</span>)}
                {metaRow('Applies to', active?.applies_to || cert?.applies_to || '—')}
                {metaRow('Uploaded', `${fmtDate(active?.uploaded_date || cert?.uploaded_date)}${cert?.vendor_name ? ` · ${cert.vendor_name}` : ''}`)}
                {metaRow('Verified', active?.verified_date ? `${fmtDate(active.verified_date)} · ${active.verified_by || '—'}` : '—')}
              </div>

              <div style={{ minHeight: 300, background: t.inputBg, border: `1px dashed ${dark ? '#334155' : '#c4cedf'}`, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: t.sub }}>
                <div style={{ fontSize: 40 }}>📄</div>
                <div style={{ fontSize: 12, marginTop: 8, fontFamily: 'JetBrains Mono, monospace' }}>{active?.file_name || cert?.file_name || '—'}</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>{fmtBytes(active?.file_size)} · PDF preview (mock)</div>
              </div>

              {/* Heat/Lot P5 — where this heat's material is now (end-to-end trace) */}
              {material && (cert?.heat_ref) && (
                <div style={{ marginTop: 16, border: t.bd, borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.sub, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Material carrying heat <span style={{ color: '#7c3aed', fontFamily: 'JetBrains Mono, monospace' }}>{cert.heat_ref}</span>
                  </div>
                  {material.stock.length === 0 && material.issues.length === 0 && material.transfers.length === 0 ? (
                    <div style={{ fontSize: 11, color: t.sub, fontStyle: 'italic' }}>No stock, issues, or transfers currently carry this heat.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11, color: t.col }}>
                      {material.stock.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: t.sub, marginBottom: 3 }}>IN STOCK ({material.stock.length})</div>
                          {material.stock.map((s: any) => (
                            <div key={s.stock_id} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                              {s.item_code} · {Number(s.qty_available)}/{Number(s.qty)} {s.condition_status !== 'good' ? `· ${s.condition_status}` : ''} @ {s.location_code || '—'} ({s.warehouse_name || '—'})
                            </div>
                          ))}
                        </div>
                      )}
                      {material.issues.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: t.sub, marginBottom: 3 }}>ISSUED ({material.issues.length})</div>
                          {material.issues.map((i: any) => (
                            <div key={i.id} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{Number(i.qty)} → {i.fmr_ref} ({i.item_code}) · {i.issued_at}</div>
                          ))}
                        </div>
                      )}
                      {material.transfers.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: t.sub, marginBottom: 3 }}>TRANSFERS ({material.transfers.length})</div>
                          {material.transfers.map((tr: any) => (
                            <div key={tr.id} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{tr.transfer_ref} · {Number(tr.qty)} {tr.uom} · {tr.from_location || '—'} → {tr.to_location || '—'} · {tr.status}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: t.bd, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={{ padding: '8px 18px', borderRadius: 6, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 12 }}>↓ Download</button>
          <button style={{ padding: '8px 18px', borderRadius: 6, border: t.bd, background: 'none', color: t.col, cursor: 'pointer', fontSize: 12 }}>📧 Email</button>
        </div>
      </div>
    </>
  )
}
