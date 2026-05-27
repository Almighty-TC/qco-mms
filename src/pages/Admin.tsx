import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import { useTableResize } from '../hooks/useTableResize'
import { HeaderCell } from '../components/ResizableTable'

const API = 'http://localhost:3001/api/admin'

// ─── ROLES AND MODULES ──────────────────────────────────────
// Single source of truth for all valid role and module names,
// used in selects, filters, and the permissions matrix.
const ALL_ROLES = [
  'admin', 'ceo', 'director', 'project_director', 'project_manager',
  'procurement_manager', 'procurement_officer',
  'expediting_manager', 'expeditor', 'logistics_manager',
  'warehouse', 'vendor', 'freight_forwarder', 'site_contractor', 'viewer',
] as const
type Role = typeof ALL_ROLES[number]

const ALL_MODULES = [
  'dashboard', 'procurement', 'expediting', 'vdrl', 'logistics',
  'material_control', 'traceability', 'document_inbox', 'audit', 'admin',
] as const
type Module = typeof ALL_MODULES[number]

// ─── TYPES ──────────────────────────────────────────────────
type AdminUser = {
  id: number; fullName: string; email: string; role: string; company: string
  isActive: number; isExternal: number
  contractStart: string; contractEnd: string
  approvedBy: number | null; approvedAt: string | null
  secondApprovedBy: number | null; secondApprovedAt: string | null
  approvedByName: string | null; secondApprovedByName: string | null
  lastLogin: string | null
}
type RolePerm = {
  id: number; role: string; module: string
  can_view: number; can_create: number; can_edit: number
  can_approve: number; can_delete: number; wbs_scoped: number
}
type Notification = {
  id: number; type: string; message: string; isRead: number
  createdAt: string; userName: string; userEmail: string
}

// ─── SHARED INPUT STYLE ─────────────────────────────────────
const inp = (dark: boolean): React.CSSProperties => ({
  height: 36, padding: '0 10px', borderRadius: 6, width: '100%',
  border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
  background: dark ? '#0f172a' : '#f8fafc',
  color: dark ? '#f1f5f9' : '#0f172a',
  fontSize: 13, fontFamily: 'IBM Plex Sans, sans-serif',
  outline: 'none', boxSizing: 'border-box',
})

// ─── FIELD ──────────────────────────────────────────────────
// Label-above-input form field wrapper used in every modal.
const Field = ({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, gridColumn: wide ? 'span 2' : 'span 1' }}>
    <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
      {label}
    </span>
    {children}
  </div>
)

// ─── STATUS PILL ────────────────────────────────────────────
const StatusPill = ({ active, label }: { active: boolean; label?: string }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 5,
    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999,
    background: active ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.12)',
    color: active ? '#22c55e' : '#94a3b8',
  }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#22c55e' : '#94a3b8' }} />
    {label ?? (active ? 'Active' : 'Inactive')}
  </span>
)

// ─── ROLE BADGE ─────────────────────────────────────────────
const RoleBadge = ({ role }: { role: string }) => (
  <span style={{
    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999,
    background: 'rgba(37,99,235,0.1)', color: '#2563eb',
    fontFamily: 'IBM Plex Sans, sans-serif',
  }}>
    {role.replace(/_/g, ' ')}
  </span>
)

// ─── EXTERNAL BADGE ─────────────────────────────────────────
const ExtBadge = () => (
  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(232,78,15,0.12)', color: '#E84E0F', letterSpacing: '0.04em' }}>
    EXT
  </span>
)

// ─── MODAL ──────────────────────────────────────────────────
// Portal-rendered so position:fixed is relative to the physical
// viewport, not the zoom-scaled app root.
function Modal({
  title, dark, onClose, onSubmit, submitLabel = 'Save', error, saving, children, wide,
}: {
  title: string; dark: boolean; onClose: () => void; onSubmit: () => void
  submitLabel?: string; error: string; saving: boolean; children: React.ReactNode; wide?: boolean
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div style={{
        width: wide ? 680 : 520, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column',
        background: dark ? '#1e293b' : '#ffffff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
        borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.5)', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${dark ? 'rgba(232,78,15,0.2)' : '#e2e8f0'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#E84E0F' }}>◈</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: dark ? '#f1f5f9' : '#0f172a' }}>{title}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 20px 4px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {children}
          </div>
          {error && (
            <div style={{ marginTop: 14, padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 12, color: '#ef4444' }}>
              {error}
            </div>
          )}
        </div>
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 13, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
            Cancel
          </button>
          <button onClick={onSubmit} disabled={saving} style={{ padding: '7px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'IBM Plex Sans, sans-serif' }}>
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── TABLE PRIMITIVES ───────────────────────────────────────
const TableCard = ({ dark, children }: { dark: boolean; children: React.ReactNode }) => (
  <div style={{ background: dark ? '#1e293b' : '#ffffff', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
    {children}
  </div>
)
const TH = ({ dark, grid, children }: { dark: boolean; grid: string; children: React.ReactNode }) => (
  <div style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center', background: dark ? '#0f172a' : '#f4f7fb', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}`, height: 36, userSelect: 'none' }}>
    {children}
  </div>
)
const TR = ({ dark, grid, children }: { dark: boolean; grid: string; children: React.ReactNode }) => {
  const [hov, setHov] = useState(false)
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, background: hov ? (dark ? '#1e2d4a' : '#f8fafc') : 'transparent', transition: 'background 100ms', minHeight: 44 }}>
      {children}
    </div>
  )
}
const TD = ({ dark, children, mono, muted, center }: { dark: boolean; children: React.ReactNode; mono?: boolean; muted?: boolean; center?: boolean }) => (
  <div style={{ padding: '0 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontFamily: mono ? 'JetBrains Mono, monospace' : 'IBM Plex Sans, sans-serif', color: muted ? '#94a3b8' : (dark ? '#f1f5f9' : '#0f172a'), textAlign: center ? 'center' : 'left' }}>
    {children}
  </div>
)
const Empty = ({ msg }: { msg: string }) => (
  <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>{msg}</div>
)
const Err = ({ msg }: { msg: string }) => (
  <div style={{ marginBottom: 14, padding: '9px 14px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 12, color: '#ef4444' }}>{msg}</div>
)

// ─── ADD BUTTON ─────────────────────────────────────────────
const AddBtn = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button onClick={onClick} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
    {label}
  </button>
)

// ─── DELETE CONFIRM BUTTON ──────────────────────────────────
const DelBtn = ({ id, confirmId, onInit, onConfirm, onCancel }: {
  id: number; confirmId: number | null; onInit: () => void; onConfirm: () => void; onCancel: () => void
}) => confirmId === id ? (
  <span style={{ display: 'flex', gap: 4 }}>
    <button onClick={onConfirm} style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.12)', color: '#ef4444', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Confirm</button>
    <button onClick={onCancel}  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Cancel</button>
  </span>
) : (
  <button onClick={onInit} style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.25)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Delete</button>
)

// ─── TOOLBAR ────────────────────────────────────────────────
const Toolbar = ({ count, label, children }: { count: number | null; label: string; children?: React.ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
    <span style={{ fontSize: 12, color: '#94a3b8' }}>
      {count == null ? 'Loading…' : `${count} ${label}${count !== 1 ? 's' : ''}`}
    </span>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>
  </div>
)

// ─── PERMISSION CHECKBOX CELL ───────────────────────────────
// Used in the permissions matrix. Shows a coloured dot if enabled.
const PermDot = ({ value, title }: { value: number; title: string }) => (
  <span title={`${title}: ${value ? 'allowed' : 'denied'}`} style={{
    display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
    background: value ? '#22c55e' : (value === 0 ? '#334155' : '#1e293b'),
    border: value ? 'none' : '1px solid #475569',
  }} />
)

// ═══════════════════════════════════════════════════════════
// ─── USERS TAB ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
type UserKey = 'uname' | 'uemail' | 'urole' | 'ucompany' | 'ucontract' | 'ustatus'
const U_DEF: Record<UserKey, number> = { uname: 190, uemail: 230, urole: 140, ucompany: 160, ucontract: 120, ustatus: 90 }
const U_MIN: Record<UserKey, number> = { uname: 100, uemail: 120, urole: 90, ucompany: 80, ucontract: 80, ustatus: 70 }

type UserForm = {
  fullName: string; email: string; role: string; company: string
  isActive: boolean; isExternal: boolean; contractStart: string; contractEnd: string
}
const EMPTY_USER: UserForm = {
  fullName: '', email: '', role: 'viewer', company: '',
  isActive: true, isExternal: false, contractStart: '', contractEnd: '',
}

function UsersTab({ dark }: { dark: boolean }) {
  const { user: me } = useAuth()
  const [rows,      setRows]      = useState<AdminUser[]>([])
  const [total,     setTotal]     = useState<number | null>(null)
  const [page,      setPage]      = useState(1)
  const [search,    setSearch]    = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [filterExt, setFilterExt] = useState('')
  const [error,     setError]     = useState('')
  const [showForm,  setShowForm]  = useState(false)
  const [editId,    setEditId]    = useState<number | null>(null)
  const [form,      setForm]      = useState<UserForm>(EMPTY_USER)
  const [formErr,   setFormErr]   = useState('')
  const [saving,    setSaving]    = useState(false)
  const [delId,       setDelId]       = useState<number | null>(null)
  const [approving,   setApproving]   = useState<number | null>(null)
  const [resetPwId,   setResetPwId]   = useState<number | null>(null)
  const [resetPwDone, setResetPwDone] = useState<number | null>(null)

  const { containerRef, startResize } = useTableResize(U_DEF, U_MIN)
  const GRID = `var(--col-uname,${U_DEF.uname}px) var(--col-uemail,${U_DEF.uemail}px) var(--col-urole,${U_DEF.urole}px) var(--col-ucompany,${U_DEF.ucompany}px) var(--col-ucontract,${U_DEF.ucontract}px) var(--col-ustatus,${U_DEF.ustatus}px) 120px`

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (p = page) => {
    setError('')
    try {
      const params: Record<string, string> = { page: String(p), limit: '50' }
      if (filterRole)          params.role        = filterRole
      if (filterExt === 'ext') params.is_external = 'true'
      if (filterExt === 'int') params.is_external = 'false'
      if (search.trim())       params.search      = search.trim()
      const { data } = await axios.get(`${API}/users`, { params })
      setRows(data.rows); setTotal(data.total)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load users')
    }
  }, [page, filterRole, filterExt, search])

  useEffect(() => { load() }, [load])

  const onSearch = (v: string) => {
    setSearch(v)
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => { setPage(1); load(1) }, 350)
  }

  const openAdd = () => { setForm(EMPTY_USER); setEditId(null); setFormErr(''); setShowForm(true) }
  const openEdit = (u: AdminUser) => {
    setForm({
      fullName: u.fullName, email: u.email, role: u.role,
      company: u.company ?? '', isActive: !!u.isActive, isExternal: !!u.isExternal,
      contractStart: u.contractStart?.slice(0, 10) ?? '',
      contractEnd: u.contractEnd?.slice(0, 10) ?? '',
    })
    setEditId(u.id); setFormErr(''); setShowForm(true)
  }

  const save = async () => {
    if (!form.fullName.trim()) { setFormErr('Full name is required'); return }
    if (!form.email.trim())    { setFormErr('Email is required'); return }
    setSaving(true); setFormErr('')
    try {
      editId != null
        ? await axios.put(`${API}/users/${editId}`, form)
        : await axios.post(`${API}/users`, form)
      setShowForm(false); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setFormErr(err.response?.data?.error ?? 'Save failed')
    } finally { setSaving(false) }
  }

  const resetPassword = async (id: number) => {
    setResetPwId(id)
    try {
      await axios.post(`${API}/users/${id}/reset-password`)
      setResetPwDone(id)
      setTimeout(() => setResetPwDone(null), 3000)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Reset failed')
    } finally { setResetPwId(null) }
  }

  const del = async (id: number) => {
    try {
      await axios.delete(`${API}/users/${id}`)
      setDelId(null); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Delete failed')
    }
  }

  const approve = async (id: number) => {
    setApproving(id)
    try {
      await axios.post(`${API}/users/${id}/approve`)
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Approval failed')
    } finally { setApproving(null) }
  }

  const f = (k: keyof UserForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))

  const approvalStatus = (u: AdminUser) => {
    if (!u.isExternal) return null
    if (u.secondApprovedBy) return <StatusPill active label="Approved (2/2)" />
    if (u.approvedBy)       return <StatusPill active={false} label="Pending (1/2)" />
    return <StatusPill active={false} label="Awaiting (0/2)" />
  }

  const canApprove = (u: AdminUser) =>
    u.isExternal && !u.isActive &&
    !(u.approvedBy === me?.id) &&
    !u.secondApprovedBy

  return (
    <>
      {/* ─── FILTERS + TOOLBAR ──────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={search} onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name, email, company…"
          style={{ ...inp(dark), width: 220, height: 32 }}
        />
        <select value={filterRole} onChange={(e) => { setFilterRole(e.target.value); setPage(1) }} style={{ ...inp(dark), width: 180, height: 32 }}>
          <option value="">All roles</option>
          {ALL_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filterExt} onChange={(e) => { setFilterExt(e.target.value); setPage(1) }} style={{ ...inp(dark), width: 140, height: 32 }}>
          <option value="">All users</option>
          <option value="int">Internal only</option>
          <option value="ext">External only</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{total == null ? 'Loading…' : `${total} user${total !== 1 ? 's' : ''}`}</span>
        <AddBtn onClick={openAdd} label="+ Add User" />
      </div>

      {error && <Err msg={error} />}

      {/* ─── TABLE ──────────────────────────────────────── */}
      <TableCard dark={dark}>
        <div ref={containerRef}>
          <TH dark={dark} grid={GRID}>
            <HeaderCell label="Name"     col="uname"    align="left" onResize={startResize} />
            <HeaderCell label="Email"    col="uemail"   align="left" onResize={startResize} />
            <HeaderCell label="Role"     col="urole"                 onResize={startResize} />
            <HeaderCell label="Company"  col="ucompany" align="left" onResize={startResize} />
            <HeaderCell label="Contract" col="ucontract"             onResize={startResize} />
            <HeaderCell label="Status"   col="ustatus"               onResize={startResize} />
            <div />
          </TH>

          {rows.length === 0 && total !== null && <Empty msg="No users found." />}
          {rows.map(u => (
            <TR key={u.id} dark={dark} grid={GRID}>
              <div style={{ padding: '0 12px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span title={u.fullName} style={{ fontSize: 13, fontWeight: 500, color: dark ? '#f1f5f9' : '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.fullName}</span>
                  {!!u.isExternal && <ExtBadge />}
                </div>
                {u.isExternal && <div style={{ marginTop: 2 }}>{approvalStatus(u)}</div>}
              </div>
              <TD dark={dark} muted>
                <span title={u.email} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
              </TD>
              <div style={{ padding: '0 12px' }}>
                <RoleBadge role={u.role} />
              </div>
              <TD dark={dark} muted>{u.company ?? '—'}</TD>
              <TD dark={dark} muted mono>
                {u.contractEnd ? u.contractEnd.slice(0, 10) : '—'}
              </TD>
              <div style={{ padding: '0 12px' }}>
                <StatusPill active={!!u.isActive} />
              </div>
              <div style={{ padding: '0 8px', display: 'flex', gap: 4, alignItems: 'center' }}>
                {canApprove(u) && (
                  <button
                    onClick={() => approve(u.id)}
                    disabled={approving === u.id}
                    style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(232,78,15,0.4)', background: 'rgba(232,78,15,0.1)', color: '#E84E0F', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', opacity: approving === u.id ? 0.6 : 1 }}>
                    {approving === u.id ? '…' : 'Approve'}
                  </button>
                )}
                <button onClick={() => openEdit(u)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.08)', color: '#2563eb', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Edit</button>
                {/* ─── RESET PW BUTTON ─────────────────────────────────
                    Sends a temp password to the user's email.  Shows ✓
                    for 3 s after success so the admin knows it was sent. */}
                {u.id !== me?.id && (
                  <button
                    onClick={() => resetPassword(u.id)}
                    disabled={resetPwId === u.id}
                    title="Send a temporary password reset email"
                    style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: `1px solid ${resetPwDone === u.id ? 'rgba(34,197,94,0.4)' : 'rgba(100,116,139,0.3)'}`, background: resetPwDone === u.id ? 'rgba(34,197,94,0.1)' : 'transparent', color: resetPwDone === u.id ? '#22c55e' : '#64748b', cursor: resetPwId === u.id ? 'wait' : 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', opacity: resetPwId === u.id ? 0.6 : 1 }}>
                    {resetPwDone === u.id ? '✓ Sent' : resetPwId === u.id ? '…' : 'Reset PW'}
                  </button>
                )}
                {u.id !== me?.id && (
                  <DelBtn id={u.id} confirmId={delId} onInit={() => setDelId(u.id)} onConfirm={() => del(u.id)} onCancel={() => setDelId(null)} />
                )}
              </div>
            </TR>
          ))}
        </div>
      </TableCard>

      {/* ─── PAGINATION ─────────────────────────────────── */}
      {total != null && total > 50 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          {Array.from({ length: Math.ceil(total / 50) }, (_, i) => (
            <button key={i} onClick={() => { setPage(i + 1); load(i + 1) }}
              style={{ width: 28, height: 28, borderRadius: 4, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: page === i + 1 ? '#E84E0F' : 'transparent', color: page === i + 1 ? '#fff' : '#64748b', cursor: 'pointer', fontSize: 12, fontFamily: 'IBM Plex Sans, sans-serif' }}>
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* ─── ADD / EDIT MODAL ───────────────────────────── */}
      {showForm && (
        <Modal title={editId != null ? 'Edit User' : 'Add User'} dark={dark} onClose={() => setShowForm(false)} onSubmit={save} error={formErr} saving={saving}>
          <Field label="Full Name *"><input value={form.fullName} onChange={f('fullName')} placeholder="Jane Smith" style={inp(dark)} /></Field>
          <Field label="Email *"><input type="email" value={form.email} onChange={f('email')} placeholder="jane@example.com" style={inp(dark)} /></Field>
          {/* New users get a system-generated temp password emailed to them; no manual password entry needed */}
          {editId == null && (
            <Field label="Password" wide>
              <div style={{ padding: '8px 10px', borderRadius: 6, fontSize: 12, color: '#64748b', background: dark ? '#0f172a' : '#f1f5f9', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}` }}>
                A secure temporary password will be automatically generated and emailed to the user. They will be required to change it on first login.
              </div>
            </Field>
          )}
          <Field label="Role">
            <select value={form.role} onChange={f('role')} style={inp(dark)}>
              {ALL_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Company"><input value={form.company} onChange={f('company')} placeholder="Company name" style={inp(dark)} /></Field>
          <Field label="Contract Start"><input type="date" value={form.contractStart} onChange={f('contractStart')} style={inp(dark)} /></Field>
          <Field label="Contract End"><input type="date" value={form.contractEnd} onChange={f('contractEnd')} style={inp(dark)} /></Field>
          <Field label="Options">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13, color: dark ? '#f1f5f9' : '#0f172a' }}>
                <input type="checkbox" checked={form.isActive} onChange={f('isActive')} style={{ accentColor: '#E84E0F' }} />
                Active (can log in)
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13, color: dark ? '#f1f5f9' : '#0f172a' }}>
                <input type="checkbox" checked={form.isExternal} onChange={f('isExternal')} style={{ accentColor: '#E84E0F' }} />
                External user (requires two-admin approval)
              </label>
            </div>
          </Field>
        </Modal>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── PERMISSIONS MATRIX TAB ─────────────────────────────────
// Displays a role × module grid. Selecting a role shows all
// modules as rows with 5 permission checkboxes each.
// ═══════════════════════════════════════════════════════════
type PermKey = 'can_view' | 'can_create' | 'can_edit' | 'can_approve' | 'can_delete' | 'wbs_scoped'
const PERM_KEYS: PermKey[] = ['can_view', 'can_create', 'can_edit', 'can_approve', 'can_delete', 'wbs_scoped']
const PERM_LABELS: Record<PermKey, string> = { can_view: 'View', can_create: 'Create', can_edit: 'Edit', can_approve: 'Approve', can_delete: 'Delete', wbs_scoped: 'WBS scoped' }

function PermissionsTab({ dark }: { dark: boolean }) {
  const [perms,    setPerms]    = useState<RolePerm[]>([])
  const [selRole,  setSelRole]  = useState<string>('procurement_officer')
  const [editing,  setEditing]  = useState<Record<string, Record<PermKey, boolean>>>({})
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const { data } = await axios.get<RolePerm[]>(`${API}/permissions`)
      setPerms(data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load permissions')
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Build lookup: perms[role][module] = { can_view, … }
  const lookup = perms.reduce<Record<string, Record<string, RolePerm>>>((acc, p) => {
    acc[p.role] = acc[p.role] ?? {}
    acc[p.role][p.module] = p
    return acc
  }, {})

  const getVal = (module: string, key: PermKey): boolean => {
    if (editing[module]?.[key] !== undefined) return editing[module][key]
    return !!(lookup[selRole]?.[module]?.[key] ?? 0)
  }

  const toggle = (module: string, key: PermKey) => {
    setEditing(prev => ({
      ...prev,
      [module]: { ...prev[module], [key]: !getVal(module, key) },
    }))
  }

  const saveRole = async () => {
    setSaving(true); setError(''); setSuccess('')
    const modules = Object.keys(editing)
    try {
      for (const module of modules) {
        const payload: Record<string, boolean> = {}
        PERM_KEYS.forEach(k => { payload[k] = getVal(module, k) })
        await axios.put(`${API}/permissions/${selRole}/${module}`, payload)
      }
      setEditing({})
      setSuccess(`Permissions saved for ${selRole.replace(/_/g, ' ')}`)
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Save failed')
    } finally { setSaving(false) }
  }

  const isDirty = Object.keys(editing).length > 0
  const isAdmin = selRole === 'admin'

  return (
    <div>
      {/* ─── ROLE SELECTOR + SAVE ───────────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>Role:</label>
        <select value={selRole} onChange={(e) => { setSelRole(e.target.value); setEditing({}) }} style={{ ...inp(dark), width: 220, height: 34 }}>
          {ALL_ROLES.filter(r => r !== 'admin').map(r => (
            <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
          ))}
        </select>
        {isDirty && !isAdmin && (
          <button onClick={saveRole} disabled={saving} style={{ padding: '7px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'IBM Plex Sans, sans-serif' }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
        {isDirty && (
          <button onClick={() => setEditing({})} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
            Discard
          </button>
        )}
      </div>

      {error   && <Err msg={error} />}
      {success && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', fontSize: 12, color: '#22c55e' }}>{success}</div>}

      {isAdmin && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: 'rgba(232,78,15,0.06)', border: '1px solid rgba(232,78,15,0.2)', fontSize: 12, color: '#E84E0F' }}>
          Admin role has full access to everything and cannot be modified.
        </div>
      )}

      {/* ─── PERMISSION GRID ────────────────────────────── */}
      <TableCard dark={dark}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '180px repeat(6, 1fr)', background: dark ? '#0f172a' : '#f4f7fb', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}`, padding: '0 12px' }}>
          <div style={{ padding: '10px 0', fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Module</div>
          {PERM_KEYS.map(k => (
            <div key={k} style={{ padding: '10px 4px', fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center' }}>
              {PERM_LABELS[k]}
            </div>
          ))}
        </div>

        {ALL_MODULES.map(mod => (
          <div key={mod} style={{ display: 'grid', gridTemplateColumns: '180px repeat(6, 1fr)', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, padding: '0 12px', alignItems: 'center', minHeight: 44 }}>
            <div style={{ fontSize: 13, color: dark ? '#f1f5f9' : '#0f172a', textTransform: 'capitalize' }}>
              {mod.replace(/_/g, ' ')}
            </div>
            {PERM_KEYS.map(key => (
              <div key={key} style={{ display: 'flex', justifyContent: 'center' }}>
                <input
                  type="checkbox"
                  checked={isAdmin ? true : getVal(mod, key)}
                  disabled={isAdmin}
                  onChange={() => !isAdmin && toggle(mod, key)}
                  style={{ width: 16, height: 16, accentColor: '#E84E0F', cursor: isAdmin ? 'not-allowed' : 'pointer' }}
                />
              </div>
            ))}
          </div>
        ))}
      </TableCard>

      {/* ─── ROLE SUMMARY (all roles overview) ──────────── */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: dark ? '#94a3b8' : '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          All Roles Overview
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <TableCard dark={dark}>
            <div style={{ display: 'grid', gridTemplateColumns: `160px repeat(${ALL_MODULES.length}, 80px)`, minWidth: 'max-content' }}>
              {/* Header */}
              <div style={{ background: dark ? '#0f172a' : '#f4f7fb', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}`, padding: '10px 12px', fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Role</div>
              {ALL_MODULES.map(m => (
                <div key={m} style={{ background: dark ? '#0f172a' : '#f4f7fb', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}`, padding: '10px 4px', fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center' }}>
                  {m.replace(/_/g, ' ').slice(0, 7)}
                </div>
              ))}
              {/* Rows */}
              {ALL_ROLES.map(role => (
                <>
                  <div key={`${role}-name`} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, padding: '10px 12px', fontSize: 12, color: dark ? '#f1f5f9' : '#0f172a' }}>
                    {role.replace(/_/g, ' ')}
                  </div>
                  {ALL_MODULES.map(mod => {
                    const p = lookup[role]?.[mod]
                    return (
                      <div key={`${role}-${mod}`} style={{ borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '10px 4px' }}>
                        {p ? (
                          <>
                            {!!p.can_view    && <PermDot value={1} title={`${role}/${mod}: view`} />}
                            {!!p.can_create  && <PermDot value={1} title={`${role}/${mod}: create`} />}
                            {!!p.can_edit    && <PermDot value={1} title={`${role}/${mod}: edit`} />}
                            {!!p.can_approve && <PermDot value={1} title={`${role}/${mod}: approve`} />}
                            {!!p.can_delete  && <PermDot value={1} title={`${role}/${mod}: delete`} />}
                            {!p.can_view && !p.can_create && !p.can_edit && !p.can_approve && !p.can_delete &&
                              <span style={{ fontSize: 11, color: '#475569' }}>—</span>}
                          </>
                        ) : <span style={{ fontSize: 11, color: '#475569' }}>—</span>}
                      </div>
                    )
                  })}
                </>
              ))}
            </div>
          </TableCard>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── EXTERNAL USERS TAB ─────────────────────────────────────
// Shows all external users with their approval status.
// Admins can approve from here; the two-admin rule is enforced
// server-side — the UI just sends the approve request.
// ═══════════════════════════════════════════════════════════
function ExternalUsersTab({ dark }: { dark: boolean }) {
  const { user: me } = useAuth()
  const [rows,      setRows]      = useState<AdminUser[]>([])
  const [error,     setError]     = useState('')
  const [approving, setApproving] = useState<number | null>(null)
  const [filter,    setFilter]    = useState<'all' | 'pending' | 'approved'>('pending')

  const load = useCallback(async () => {
    setError('')
    try {
      const { data } = await axios.get(`${API}/users`, { params: { is_external: 'true', limit: '200' } })
      setRows(data.rows)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load external users')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const approve = async (id: number) => {
    setApproving(id)
    try {
      const { data } = await axios.post(`${API}/users/${id}/approve`)
      setError('')
      alert(data.message)
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Approval failed')
    } finally { setApproving(null) }
  }

  const filtered = rows.filter(u => {
    if (filter === 'pending')  return !u.isActive
    if (filter === 'approved') return !!u.isActive
    return true
  })

  const approvals = (u: AdminUser) => {
    const count = u.secondApprovedBy ? 2 : u.approvedBy ? 1 : 0
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {[0, 1].map(i => (
          <span key={i} style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: i < count ? '#22c55e' : (dark ? '#1e293b' : '#f1f5f9'), color: i < count ? '#fff' : '#64748b', border: `1px solid ${i < count ? '#22c55e' : (dark ? '#334155' : '#dde3ed')}` }}>
            {i + 1}
          </span>
        ))}
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{count}/2 approved</span>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {(['all', 'pending', 'approved'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: filter === f ? 600 : 400, border: `1px solid ${filter === f ? '#E84E0F' : (dark ? '#334155' : '#dde3ed')}`, background: filter === f ? 'rgba(232,78,15,0.1)' : 'transparent', color: filter === f ? '#E84E0F' : '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>{filtered.length} external user{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {error && <Err msg={error} />}

      {filtered.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>
          {filter === 'pending' ? 'No external users awaiting approval.' : 'No external users found.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map(u => {
          const hasAlreadyApproved = u.approvedBy === me?.id
          const fullyApproved      = !!u.secondApprovedBy
          const canApprove         = !fullyApproved && !hasAlreadyApproved

          return (
            <div key={u.id} style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Avatar */}
              <div style={{ width: 42, height: 42, borderRadius: '50%', background: u.isActive ? '#2563eb' : '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                {u.fullName.charAt(0).toUpperCase()}
              </div>
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: dark ? '#f1f5f9' : '#0f172a' }}>{u.fullName}</span>
                  <ExtBadge />
                  <StatusPill active={!!u.isActive} />
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  {u.email} · <RoleBadge role={u.role} /> {u.company ? ` · ${u.company}` : ''}
                </div>
                {u.contractEnd && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                    Contract ends: {u.contractEnd.slice(0, 10)}
                  </div>
                )}
              </div>
              {/* Approvals */}
              <div style={{ flexShrink: 0 }}>{approvals(u)}</div>
              {/* Actions */}
              <div style={{ flexShrink: 0 }}>
                {fullyApproved ? (
                  <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✓ Activated</span>
                ) : hasAlreadyApproved ? (
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>You approved — awaiting 2nd</span>
                ) : canApprove ? (
                  <button
                    onClick={() => approve(u.id)}
                    disabled={approving === u.id}
                    style={{ padding: '7px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', opacity: approving === u.id ? 0.6 : 1 }}>
                    {approving === u.id ? 'Approving…' : 'Approve'}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── NOTIFICATIONS TAB ──────────────────────────────────────
// Shows all in-app notifications with user context. Admins can
// mark individual notifications as read or clear all.
// ═══════════════════════════════════════════════════════════
type NKey = 'nuser' | 'ntype' | 'nmsg' | 'ndate'
const N_DEF: Record<NKey, number> = { nuser: 180, ntype: 130, nmsg: 400, ndate: 120 }
const N_MIN: Record<NKey, number> = { nuser: 100, ntype: 80, nmsg: 150, ndate: 80 }

function NotificationsTab({ dark }: { dark: boolean }) {
  const [rows,    setRows]    = useState<Notification[]>([])
  const [total,   setTotal]   = useState<number | null>(null)
  const [page,    setPage]    = useState(1)
  const [filter,  setFilter]  = useState<'all' | 'unread'>('all')
  const [error,   setError]   = useState('')

  const { containerRef, startResize } = useTableResize(N_DEF, N_MIN)
  const GRID = `var(--col-nuser,${N_DEF.nuser}px) var(--col-ntype,${N_DEF.ntype}px) var(--col-nmsg,${N_DEF.nmsg}px) var(--col-ndate,${N_DEF.ndate}px) 80px`

  const load = useCallback(async (p = 1) => {
    setError('')
    try {
      const params: Record<string, string> = { page: String(p), limit: '50' }
      if (filter === 'unread') params.is_read = 'false'
      const { data } = await axios.get(`${API}/notifications`, { params })
      setRows(data.rows); setTotal(data.total)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load notifications')
    }
  }, [filter])

  useEffect(() => { setPage(1); load(1) }, [load])

  const markRead = async (id: number) => {
    try {
      await axios.put(`${API}/notifications/${id}/read`)
      load(page)
    } catch { /* silent */ }
  }

  const markAllRead = async () => {
    try {
      await axios.put(`${API}/notifications/read-all`)
      load(page)
    } catch { /* silent */ }
  }

  const TYPE_COLOR: Record<string, string> = {
    contract_expiry: '#f59e0b',
    contract_expired: '#ef4444',
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        {(['all', 'unread'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: filter === f ? 600 : 400, border: `1px solid ${filter === f ? '#E84E0F' : (dark ? '#334155' : '#dde3ed')}`, background: filter === f ? 'rgba(232,78,15,0.1)' : 'transparent', color: filter === f ? '#E84E0F' : '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{total == null ? 'Loading…' : `${total} notification${total !== 1 ? 's' : ''}`}</span>
        <button onClick={markAllRead} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          Mark all read
        </button>
      </div>

      {error && <Err msg={error} />}

      <TableCard dark={dark}>
        <div ref={containerRef}>
          <TH dark={dark} grid={GRID}>
            <HeaderCell label="User"    col="nuser" align="left" onResize={startResize} />
            <HeaderCell label="Type"    col="ntype" align="left" onResize={startResize} />
            <HeaderCell label="Message" col="nmsg"  align="left" onResize={startResize} />
            <HeaderCell label="Date"    col="ndate"              onResize={startResize} />
            <div />
          </TH>

          {rows.length === 0 && total !== null && <Empty msg="No notifications." />}
          {rows.map(n => (
            <TR key={n.id} dark={dark} grid={GRID}>
              <TD dark={dark}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.userEmail}>{n.userName}</div>
              </TD>
              <div style={{ padding: '0 12px' }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 9999, background: `${TYPE_COLOR[n.type] ?? '#94a3b8'}22`, color: TYPE_COLOR[n.type] ?? '#94a3b8' }}>
                  {n.type.replace(/_/g, ' ')}
                </span>
              </div>
              <TD dark={dark} muted>
                <span title={n.message} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: n.isRead ? 0.6 : 1, fontWeight: n.isRead ? 400 : 500 }}>
                  {n.message}
                </span>
              </TD>
              <TD dark={dark} muted mono>{n.createdAt?.slice(0, 10) ?? '—'}</TD>
              <div style={{ padding: '0 10px', display: 'flex', justifyContent: 'center' }}>
                {!n.isRead && (
                  <button onClick={() => markRead(n.id)} title="Mark as read" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                    ✓
                  </button>
                )}
              </div>
            </TR>
          ))}
        </div>
      </TableCard>

      {total != null && total > 50 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          {Array.from({ length: Math.ceil(total / 50) }, (_, i) => (
            <button key={i} onClick={() => { setPage(i + 1); load(i + 1) }}
              style={{ width: 28, height: 28, borderRadius: 4, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: page === i + 1 ? '#E84E0F' : 'transparent', color: page === i + 1 ? '#fff' : '#64748b', cursor: 'pointer', fontSize: 12, fontFamily: 'IBM Plex Sans, sans-serif' }}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── SYSTEM SETTINGS TAB ────────────────────────────────────
// Displays read-only SMTP configuration status, expiry thresholds,
// and allows admins to send a test email.
// ═══════════════════════════════════════════════════════════
function SystemSettingsTab({ dark }: { dark: boolean }) {
  const [testing,     setTesting]     = useState(false)
  const [testResult,  setTestResult]  = useState('')
  const [testError,   setTestError]   = useState('')

  const sendTest = async () => {
    setTesting(true); setTestResult(''); setTestError('')
    try {
      const { data } = await axios.post(`${API}/test-email`)
      setTestResult(`Test email sent to ${data.sentTo}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setTestError(err.response?.data?.error ?? 'Email test failed')
    } finally { setTesting(false) }
  }

  const row = (label: string, value: string, mono = false) => (
    <div style={{ display: 'flex', padding: '11px 0', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, alignItems: 'flex-start', gap: 12 }}>
      <span style={{ width: 200, flexShrink: 0, fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 13, color: dark ? '#f1f5f9' : '#0f172a', fontFamily: mono ? 'JetBrains Mono, monospace' : 'IBM Plex Sans, sans-serif' }}>
        {value}
      </span>
    </div>
  )

  const section = (title: string) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
      {title}
    </div>
  )

  return (
    <div style={{ maxWidth: 680 }}>
      {section('SMTP Configuration')}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 10, padding: '0 18px' }}>
        {row('Host', process.env.SMTP_HOST ?? 'smtp.office365.com', true)}
        {row('Port', '587', true)}
        {row('From address', 'noreply@qcogroup.com.au', true)}
        {row('Additional alert recipients', 'Configured via ADDITIONAL_ALERT_EMAILS in .env')}
        {row('Status', 'Credentials configured in server/.env — restart server after changes')}
      </div>

      <div style={{ marginTop: 14 }}>
        <button onClick={sendTest} disabled={testing} style={{ padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: testing ? 'not-allowed' : 'pointer', opacity: testing ? 0.7 : 1, fontFamily: 'IBM Plex Sans, sans-serif' }}>
          {testing ? 'Sending…' : 'Send test email to me'}
        </button>
        {testResult && <p style={{ marginTop: 8, fontSize: 12, color: '#22c55e' }}>{testResult}</p>}
        {testError  && <p style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>{testError}</p>}
      </div>

      {section('Contract Expiry Notifications')}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 10, padding: '0 18px' }}>
        {row('Warning thresholds', '30, 14, 7, and 1 day(s) before expiry')}
        {row('Auto-deactivation', 'Users are automatically deactivated on the day their contract expires')}
        {row('Check frequency', 'Daily — runs on server start then every 24 hours')}
        {row('Seed permissions', 'Run: node server/scripts/seed-permissions.js', true)}
      </div>

      {section('Roles')}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 10, padding: '14px 18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ALL_ROLES.map(r => <RoleBadge key={r} role={r} />)}
        </div>
      </div>

      {section('SQL Setup')}
      <div style={{ background: dark ? '#0f172a' : '#f8fafc', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 10, padding: '14px 18px' }}>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px' }}>Run the following SQL on your MySQL database to enable all permission system features:</p>
        <pre style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: dark ? '#94a3b8' : '#475569', margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
{`ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_start DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_end DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at DATETIME;
ALTER TABLE users ADD COLUMN IF NOT EXISTS second_approved_by INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS second_approved_at DATETIME;

CREATE TABLE IF NOT EXISTS user_wbs_access (...);
CREATE TABLE IF NOT EXISTS role_permissions (...);
CREATE TABLE IF NOT EXISTS user_permission_overrides (...);
CREATE TABLE IF NOT EXISTS notifications (...);
CREATE TABLE IF NOT EXISTS delegated_permissions (...);

-- Then seed default permissions:
node server/scripts/seed-permissions.js`}
        </pre>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── ADMIN ──────────────────────────────────────────────────
// Root admin page. Tab bar routes to the five sub-sections.
// Only users with role='admin' reach this page (guarded both
// in App.tsx and on every /api/admin route server-side).
// ═══════════════════════════════════════════════════════════
type AdminTab = 'users' | 'permissions' | 'external' | 'notifications' | 'settings'

export function Admin({ dark }: { dark: boolean }) {
  const [tab, setTab] = useState<AdminTab>('users')

  const tabs: { key: AdminTab; label: string; icon: string }[] = [
    { key: 'users',         label: 'Users',              icon: '👤' },
    { key: 'permissions',   label: 'Permissions Matrix', icon: '🔐' },
    { key: 'external',      label: 'External Users',     icon: '🌐' },
    { key: 'notifications', label: 'Notifications',      icon: '🔔' },
    { key: 'settings',      label: 'System Settings',    icon: '⚙️' },
  ]

  return (
    <div>
      {/* ─── PAGE HEADER ──────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, color: dark ? '#f1f5f9' : '#0f172a', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          Admin
        </h2>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: '3px 0 0' }}>
          Manage users, permissions, external access and system settings.
        </p>
      </div>

      {/* ─── TAB BAR ──────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: `2px solid ${dark ? '#334155' : '#e2e8f0'}`, paddingBottom: 0, overflowX: 'auto' }}>
        {tabs.map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#E84E0F' : (dark ? '#94a3b8' : '#64748b'), borderBottom: `2px solid ${active ? '#E84E0F' : 'transparent'}`, marginBottom: -2, fontFamily: 'IBM Plex Sans, sans-serif', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 150ms', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 14 }}>{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ─── TAB CONTENT ──────────────────────────────────── */}
      {tab === 'users'         && <UsersTab         dark={dark} />}
      {tab === 'permissions'   && <PermissionsTab   dark={dark} />}
      {tab === 'external'      && <ExternalUsersTab dark={dark} />}
      {tab === 'notifications' && <NotificationsTab dark={dark} />}
      {tab === 'settings'      && <SystemSettingsTab dark={dark} />}
    </div>
  )
}
