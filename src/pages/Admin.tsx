import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import { useTableResize } from '../hooks/useTableResize'
import { HeaderCell } from '../components/ResizableTable'
import { DeleteConfirmModal, SimpleConfirmModal } from '../components'

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
// Approval/emergency fields removed — single-admin workflow requires
// no second approval, so those columns are no longer fetched or used.
type AdminUser = {
  id: number; fullName: string; email: string; role: string; company: string
  staffId: string; phone: string
  isActive: number; isExternal: number
  contractStart: string; contractEnd: string
  lastLogin: string | null
  projectCount: number
}

// ─── FULL-ACCESS ROLES ───────────────────────────────────────
// These roles are not WBS-scoped, so they can see all projects.
// Used by the Projects column in the users table to display "All"
// instead of a count from user_wbs_access.
const FULL_ACCESS_ROLES = new Set([
  'admin', 'ceo', 'director',
  'procurement_manager', 'procurement_officer',
  'expediting_manager', 'logistics_manager', 'viewer',
])
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
// Each role category has a distinct colour so roles are scannable at a
// glance without reading the text. Groups: leadership (orange), project
// (blue), procurement (green), expediting (purple), logistics/warehouse
// (cyan), external parties (amber), viewer (grey).
const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  admin:               { bg: 'rgba(232,78,15,0.12)',  text: '#E84E0F' },
  ceo:                 { bg: 'rgba(232,78,15,0.12)',  text: '#E84E0F' },
  director:            { bg: 'rgba(232,78,15,0.10)',  text: '#c43b0c' },
  project_director:    { bg: 'rgba(37,99,235,0.12)',  text: '#2563eb' },
  project_manager:     { bg: 'rgba(37,99,235,0.10)',  text: '#2563eb' },
  procurement_manager: { bg: 'rgba(22,163,74,0.12)',  text: '#16a34a' },
  procurement_officer: { bg: 'rgba(22,163,74,0.10)',  text: '#16a34a' },
  expediting_manager:  { bg: 'rgba(124,58,237,0.12)', text: '#7c3aed' },
  expeditor:           { bg: 'rgba(124,58,237,0.10)', text: '#7c3aed' },
  logistics_manager:   { bg: 'rgba(6,182,212,0.12)',  text: '#0891b2' },
  warehouse:           { bg: 'rgba(6,182,212,0.10)',  text: '#0891b2' },
  vendor:              { bg: 'rgba(245,158,11,0.12)', text: '#d97706' },
  freight_forwarder:   { bg: 'rgba(245,158,11,0.10)', text: '#d97706' },
  site_contractor:     { bg: 'rgba(245,158,11,0.10)', text: '#d97706' },
  qco_staff:           { bg: 'rgba(37,99,235,0.08)',  text: '#3b82f6' },
  supplier:            { bg: 'rgba(245,158,11,0.10)', text: '#d97706' },
  viewer:              { bg: 'rgba(100,116,139,0.10)', text: '#64748b' },
}
const RoleBadge = ({ role }: { role: string }) => {
  const c = ROLE_COLORS[role] ?? { bg: 'rgba(100,116,139,0.10)', text: '#64748b' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999,
      background: c.bg, color: c.text,
      fontFamily: 'IBM Plex Sans, sans-serif', whiteSpace: 'nowrap',
    }}>
      {role.replace(/_/g, ' ')}
    </span>
  )
}

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
// ─── DELETION REASONS ───────────────────────────────────────
// The global reason list lives in DeleteConfirmModal.tsx (DEFAULT_DELETE_REASONS).
// Each module can pass a custom `reasons` prop if needed.

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

// ─── HELP MODAL PRIMITIVES ──────────────────────────────────
// Used exclusively in the UsersTab help modal. Kept near the
// tab they belong to rather than in the global shared section.
const HelpSection = ({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 4 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#E84E0F', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{title}</span>
    </div>
    <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {children}
    </ul>
  </div>
)
const HelpRule = ({ children }: { children: React.ReactNode }) => (
  <li style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.55, paddingLeft: 2 }}>
    <span style={{ color: 'inherit' }}>{children}</span>
  </li>
)
const HelpDivider = ({ dark }: { dark: boolean }) => (
  <div style={{ borderTop: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, margin: '18px 0' }} />
)

// ═══════════════════════════════════════════════════════════
// ─── USERS TAB ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

// ─── COLUMN KEYS ────────────────────────────────────────────
// Email is shown below the name in the Name cell (not a separate
// column) so users with the same full name are still distinguishable.
type UserKey = 'uname' | 'urole' | 'uprojects' | 'ucompany' | 'uphone' | 'ucontractstart' | 'ucontract' | 'ustatus' | 'ulastlogin'
const U_DEF: Record<UserKey, number> = { uname: 230, urole: 145, uprojects: 80, ucompany: 140, uphone: 140, ucontractstart: 110, ucontract: 110, ustatus: 90, ulastlogin: 110 }
const U_MIN: Record<UserKey, number> = { uname: 140, urole: 90,  uprojects: 60, ucompany: 80,  uphone: 90,  ucontractstart: 80,  ucontract: 80,  ustatus: 70, ulastlogin: 80  }

type UserForm = {
  fullName: string; email: string; role: string; company: string
  staffId: string; phone: string
  isActive: boolean; isExternal: boolean; contractStart: string; contractEnd: string
}
// contractEnd is intentionally empty — internal staff have no end date
const EMPTY_USER: UserForm = {
  fullName: '', email: '', role: 'viewer', company: '',
  staffId: '', phone: '',
  isActive: true, isExternal: false, contractStart: '', contractEnd: '',
}

// ─── ERROR MESSAGE MAP ───────────────────────────────────────
// Maps server-side error strings to user-friendly messages with
// specific guidance on how to resolve the issue.
function friendlyUserError(serverErr: string): string {
  if (!serverErr) return 'Save failed. Please check all fields and try again.'
  const e = serverErr.toLowerCase()
  if (e.includes('email already exists') || e.includes('er_dup_entry') || e.includes('duplicate entry')) {
    return 'A user with this email already exists. Please use a different email address, or search for the existing user and edit them instead.'
  }
  if (e.includes('full name')) return 'Full name is required. Please enter the user\'s complete name.'
  if (e.includes('invalid role')) return 'Please select a valid role from the Role dropdown.'
  if (e.includes('er_bad_field_error') || e.includes('unknown column') || e.includes('missing database column')) {
    return `Database column missing — the users table needs to be updated. Go to Admin → System Settings → SQL Setup and run the setup script, then try again. (Detail: ${serverErr})`
  }
  if (e.includes('er_no_such_table') || e.includes('missing database table') || e.includes("doesn't exist")) {
    return `Database table missing — the database needs to be initialised. Go to Admin → System Settings → SQL Setup and run the setup script, then try again. (Detail: ${serverErr})`
  }
  if (e.includes('database error')) return `Database error — a column may be missing. Run the SQL setup in System Settings, then try again. (Detail: ${serverErr})`
  return serverErr
}

// ─── PROJECTS CELL ──────────────────────────────────────────
// Renders the Projects count for a user row. Full-access roles show
// "All"; scoped users show "X projects" (clickable) or "—".
// Clicking opens a portal popover listing the actual project names.
type ProjectRow = { id: number; code: string; name: string }

function ProjectsCell({ userId, count, fullAccess, dark }: {
  userId: number; count: number; fullAccess: boolean; dark: boolean
}) {
  const [open,     setOpen]     = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [pos,      setPos]      = useState({ top: 0, left: 0 })
  const cellRef = useRef<HTMLDivElement>(null)

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (fullAccess || count === 0) return
    if (open) { setOpen(false); return }
    const rect = cellRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left })
    setOpen(true)
    if (!projects) {
      setLoading(true)
      try {
        const { data } = await axios.get(`${API}/users/${userId}/projects`)
        setProjects(data.projects)
      } catch { setProjects([]) }
      finally { setLoading(false) }
    }
  }

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const label = fullAccess ? 'All' : count === 0 ? '—' : `${count} project${count !== 1 ? 's' : ''}`
  const clickable = !fullAccess && count > 0

  return (
    <div
      ref={cellRef}
      onClick={toggle}
      title={fullAccess ? 'Has access to all projects' : count === 0 ? 'No projects assigned' : `Click to view ${count} project${count !== 1 ? 's' : ''}`}
      style={{
        padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: clickable ? 'pointer' : 'default',
        color: clickable ? (dark ? '#60a5fa' : '#2563eb') : (dark ? '#64748b' : '#94a3b8'),
        fontFamily: 'IBM Plex Mono, monospace', fontSize: 12,
        textDecoration: clickable ? 'underline' : 'none',
        textDecorationStyle: 'dotted', userSelect: 'none',
      }}
    >
      {label}
      {open && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
            background: dark ? '#1e293b' : '#fff',
            border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            minWidth: 220, maxWidth: 320, padding: 12,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Assigned Projects
          </div>
          {loading ? (
            <div style={{ fontSize: 12, color: '#64748b', padding: '4px 0' }}>Loading…</div>
          ) : !projects || projects.length === 0 ? (
            <div style={{ fontSize: 12, color: '#64748b', padding: '4px 0' }}>No projects found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {projects.map(p => (
                <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#E84E0F', minWidth: 80 }}>{p.code}</span>
                  <span style={{ fontSize: 12, color: dark ? '#cbd5e1' : '#334155' }}>{p.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

// ─── USERS TAB COMPONENT ────────────────────────────────────
// Manages all user operations. Single-admin workflow — no approval
// step required. onSave is optional for future parent callbacks.
function UsersTab({ dark, onSave }: { dark: boolean; onSave?: () => void }) {
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
  const [showHelp,    setShowHelp]    = useState(false)

  // ─── DEACTIVATE MODAL STATE ──────────────────────────────────
  // Uses SimpleConfirmModal — reversible action, no reason required.
  const [deactivateTarget, setDeactivateTarget] = useState<{ userId: number; fullName: string } | null>(null)
  const [deactivateSaving, setDeactivateSaving] = useState(false)
  const [deactivateErr,    setDeactivateErr]    = useState('')

  // ─── REACTIVATE MODAL STATE ──────────────────────────────────
  // Uses SimpleConfirmModal — re-enables a previously deactivated account.
  const [reactivateTarget, setReactivateTarget] = useState<{ userId: number; fullName: string } | null>(null)
  const [reactivateSaving, setReactivateSaving] = useState(false)
  const [reactivateErr,    setReactivateErr]    = useState('')

  // ─── DELETE MODAL STATE ──────────────────────────────────────
  // Uses DeleteConfirmModal — permanent action, reason + checkbox required.
  const [deleteTarget, setDeleteTarget] = useState<{ userId: number; fullName: string } | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteErr,    setDeleteErr]    = useState('')

  // ─── RESET PASSWORD MODAL STATE ─────────────────────────────
  const [resetPwTarget, setResetPwTarget] = useState<{ userId: number; email: string } | null>(null)
  const [resetPwSaving, setResetPwSaving] = useState(false)
  const [resetPwDone,   setResetPwDone]   = useState<number | null>(null)
  const [resetPwErr,    setResetPwErr]    = useState('')

  const { containerRef, startResize } = useTableResize(U_DEF, U_MIN)
  const GRID = [
    `var(--col-uname,${U_DEF.uname}px)`,
    `var(--col-urole,${U_DEF.urole}px)`,
    `var(--col-uprojects,${U_DEF.uprojects}px)`,
    `var(--col-ucompany,${U_DEF.ucompany}px)`,
    `var(--col-uphone,${U_DEF.uphone}px)`,
    `var(--col-ucontractstart,${U_DEF.ucontractstart}px)`,
    `var(--col-ucontract,${U_DEF.ucontract}px)`,
    `var(--col-ustatus,${U_DEF.ustatus}px)`,
    `var(--col-ulastlogin,${U_DEF.ulastlogin}px)`,
    '190px',
  ].join(' ')

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
      company: u.company ?? '', staffId: u.staffId ?? '', phone: u.phone ?? '',
      isActive: !!u.isActive, isExternal: !!u.isExternal,
      contractStart: u.contractStart?.slice(0, 10) ?? '',
      contractEnd: u.contractEnd?.slice(0, 10) ?? '',
    })
    setEditId(u.id); setFormErr(''); setShowForm(true)
  }

  const save = async () => {
    if (!form.fullName.trim()) { setFormErr('Full name is required'); return }
    if (!form.email.trim())    { setFormErr('Email is required'); return }
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRx.test(form.email.trim())) { setFormErr('Please enter a valid email address (e.g. jane@example.com)'); return }
    // ─── PRE-CHECK EMAIL UNIQUENESS ─────────────────────────────────
    // Do this before submitting so the error message can give the user
    // specific guidance rather than a raw DB duplicate-key error.
    try {
      const params: Record<string, string> = { email: form.email.trim() }
      if (editId != null) params.excludeId = String(editId)
      const { data: check } = await axios.get(`${API}/users/check-email`, { params })
      if (check.exists) {
        setFormErr('A user with this email already exists. Please use a different email address, or search for the existing user and edit them instead.')
        return
      }
    } catch { /* if check fails, let the server reject it with a clear error */ }
    setSaving(true); setFormErr('')
    try {
      editId != null
        ? await axios.put(`${API}/users/${editId}`, form)
        : await axios.post(`${API}/users`, form)
      setShowForm(false); load(); onSave?.()
    } catch (e: unknown) {
      const err = e as { response?: { data?: unknown }; message?: string }
      const d = err.response?.data
      const raw = (d && typeof d === 'object')
        ? ((d as Record<string, string>).error || (d as Record<string, string>).message || '')
        : (typeof d === 'string' ? (d as string).slice(0, 400) : '')
      setFormErr(raw ? friendlyUserError(raw) : (err.message || 'Save failed — check the server console for details'))
    } finally { setSaving(false) }
  }

  // ─── CONFIRM DEACTIVATE ──────────────────────────────────────
  // Soft action — disables the account while preserving all data and history.
  const confirmDeactivate = async () => {
    if (!deactivateTarget) return
    setDeactivateSaving(true); setDeactivateErr('')
    try {
      await axios.post(`${API}/users/${deactivateTarget.userId}/deactivate`, { reason: 'Manually deactivated by admin' })
      setDeactivateTarget(null); load(); onSave?.()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setDeactivateErr(err.response?.data?.error ?? 'Deactivation failed')
    } finally { setDeactivateSaving(false) }
  }

  // ─── CONFIRM DELETE ──────────────────────────────────────────
  // Permanent hard delete. Called by DeleteConfirmModal with the
  // admin-selected reason, which is forwarded to the server audit trail.
  const confirmDelete = async (reason: string) => {
    if (!deleteTarget) return
    setDeleteSaving(true); setDeleteErr('')
    try {
      await axios.delete(`${API}/users/${deleteTarget.userId}`, { data: { reason } })
      setDeleteTarget(null); load(); onSave?.()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setDeleteErr(err.response?.data?.error ?? 'Delete failed')
    } finally { setDeleteSaving(false) }
  }

  // ─── CONFIRM REACTIVATE ──────────────────────────────────────
  // Re-enables a previously deactivated account. Uses SimpleConfirmModal.
  const confirmReactivate = async () => {
    if (!reactivateTarget) return
    setReactivateSaving(true); setReactivateErr('')
    try {
      await axios.post(`${API}/users/${reactivateTarget.userId}/activate`)
      setReactivateTarget(null); load(); onSave?.()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setReactivateErr(err.response?.data?.error ?? 'Reactivation failed')
    } finally { setReactivateSaving(false) }
  }

  // ─── CONFIRM RESET PASSWORD ──────────────────────────────────
  // Called after admin confirms in the ResetPasswordModal.
  const confirmResetPassword = async () => {
    if (!resetPwTarget) return
    setResetPwSaving(true); setResetPwErr('')
    try {
      await axios.post(`${API}/users/${resetPwTarget.userId}/reset-password`)
      setResetPwDone(resetPwTarget.userId)
      setResetPwTarget(null)
      setTimeout(() => setResetPwDone(null), 3000)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setResetPwErr(err.response?.data?.error ?? 'Reset failed')
    } finally { setResetPwSaving(false) }
  }

  const f = (k: keyof UserForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))

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
        <button
          onClick={() => setShowHelp(true)}
          title="User creation rules and guidelines"
          style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'IBM Plex Sans, sans-serif', flexShrink: 0 }}>
          ℹ
        </button>
        <AddBtn onClick={openAdd} label="+ Add User" />
      </div>

      {error && <Err msg={error} />}

      {/* ─── TABLE ──────────────────────────────────────── */}
      <TableCard dark={dark}>
        <div ref={containerRef}>
          <TH dark={dark} grid={GRID}>
            <HeaderCell label="Name / Email"    col="uname"          align="left" onResize={startResize} />
            <HeaderCell label="Role"            col="urole"                       onResize={startResize} />
            <HeaderCell label="Projects"        col="uprojects"      align="left" onResize={startResize} />
            <HeaderCell label="Company"         col="ucompany"       align="left" onResize={startResize} />
            <HeaderCell label="Phone"           col="uphone"         align="left" onResize={startResize} />
            <HeaderCell label="Contract Start"  col="ucontractstart"              onResize={startResize} />
            <HeaderCell label="Contract End"    col="ucontract"                   onResize={startResize} />
            <HeaderCell label="Status"          col="ustatus"                     onResize={startResize} />
            <HeaderCell label="Last Login"      col="ulastlogin"                  onResize={startResize} />
            <div />
          </TH>

          {rows.length === 0 && total !== null && <Empty msg="No users found." />}
          {rows.map(u => (
            <TR key={u.id} dark={dark} grid={GRID}>
              {/* ─── NAME CELL: name + email below + external badge ─ */}
              <div style={{ padding: '4px 12px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span title={u.fullName} style={{ fontSize: 13, fontWeight: 500, color: dark ? '#f1f5f9' : '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.fullName}</span>
                  {!!u.isExternal && <ExtBadge />}
                  {u.staffId && <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>#{u.staffId}</span>}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }} title={u.email}>
                  {u.email}
                </div>
              </div>
              {/* ─── ROLE ───────────────────────────────────────────── */}
              <div style={{ padding: '0 12px' }}>
                <RoleBadge role={u.role} />
              </div>
              {/* ─── PROJECTS ───────────────────────────────────────── */}
              <ProjectsCell
                userId={u.id}
                count={u.projectCount ?? 0}
                fullAccess={FULL_ACCESS_ROLES.has(u.role)}
                dark={dark}
              />
              {/* ─── COMPANY / PHONE / CONTRACT START / CONTRACT END / STATUS / LAST LOGIN */}
              <TD dark={dark} muted>{u.company || '—'}</TD>
              <TD dark={dark} muted mono>{u.phone || '—'}</TD>
              <TD dark={dark} muted mono>
                {u.contractStart ? u.contractStart.slice(0, 10) : '—'}
              </TD>
              <TD dark={dark} muted mono>
                {u.contractEnd ? u.contractEnd.slice(0, 10) : '—'}
              </TD>
              <div style={{ padding: '0 12px' }}>
                <StatusPill active={!!u.isActive} />
              </div>
              <TD dark={dark} muted mono>
                {u.lastLogin ? u.lastLogin.slice(0, 10) : 'Never'}
              </TD>
              {/* ─── ROW ACTIONS ────────────────────────────────────────
                  Edit | Reset Password | Deactivate or Reactivate | Delete
                  All actions execute immediately — no second-admin approval. */}
              <div style={{ padding: '0 8px', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'nowrap' }}>
                {/* Edit — opens full edit form immediately */}
                <button onClick={() => openEdit(u)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.08)', color: '#2563eb', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', whiteSpace: 'nowrap' }}>
                  Edit
                </button>
                {u.id !== me?.id && (<>
                  {/* Reset Password — shows confirm modal before sending new temp password */}
                  <button
                    onClick={() => setResetPwTarget({ userId: u.id, email: u.email })}
                    title="Generate a new temp password and email it to the user"
                    style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: `1px solid ${resetPwDone === u.id ? 'rgba(34,197,94,0.4)' : 'rgba(100,116,139,0.3)'}`, background: resetPwDone === u.id ? 'rgba(34,197,94,0.1)' : 'transparent', color: resetPwDone === u.id ? '#22c55e' : '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', whiteSpace: 'nowrap' }}>
                    {resetPwDone === u.id ? '✓ Sent' : 'Reset Password'}
                  </button>
                  {/* Deactivate — soft disable, all data preserved (only for active users) */}
                  {!!u.isActive && (
                    <button
                      onClick={() => { setDeactivateTarget({ userId: u.id, fullName: u.fullName }); setDeactivateErr('') }}
                      title="Disable this account — user cannot log in but all data is kept"
                      style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#d97706', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', whiteSpace: 'nowrap' }}>
                      Deactivate
                    </button>
                  )}
                  {/* Reactivate — re-enables a previously deactivated account (only for inactive) */}
                  {!u.isActive && (
                    <button
                      onClick={() => { setReactivateTarget({ userId: u.id, fullName: u.fullName }); setReactivateErr('') }}
                      title="Re-enable this account so the user can log in again"
                      style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#16a34a', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', whiteSpace: 'nowrap' }}>
                      Reactivate
                    </button>
                  )}
                  {/* Delete — permanent hard delete; reason + checkbox required */}
                  <button
                    onClick={() => { setDeleteTarget({ userId: u.id, fullName: u.fullName }); setDeleteErr('') }}
                    title="Permanently delete this user — cannot be undone"
                    style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.25)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', whiteSpace: 'nowrap' }}>
                    Delete
                  </button>
                </>)}
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
          <Field label="Staff ID (optional)"><input value={form.staffId} onChange={f('staffId')} placeholder="e.g. EMP-0042" style={inp(dark)} /></Field>
          <Field label="Role">
            <select value={form.role} onChange={f('role')} style={inp(dark)}>
              {ALL_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Company"><input value={form.company} onChange={f('company')} placeholder="Company name" style={inp(dark)} /></Field>
          <Field label="Phone (Optional)"><input value={form.phone} onChange={f('phone')} placeholder="e.g. +61 4XX XXX XXX" style={inp(dark)} /></Field>
          <Field label="Contract Start Date (optional)"><input type="date" value={form.contractStart} onChange={f('contractStart')} style={inp(dark)} /></Field>
          <Field label="Contract End Date (optional)"><input type="date" value={form.contractEnd} onChange={f('contractEnd')} style={inp(dark)} /></Field>
          {/* New users get a system-generated temp password emailed to them; no manual password entry needed */}
          {editId == null && (
            <Field label="Password" wide>
              <div style={{ padding: '8px 10px', borderRadius: 6, fontSize: 12, color: '#64748b', background: dark ? '#0f172a' : '#f1f5f9', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}` }}>
                A secure temporary password will be automatically generated and emailed to the user. They will be required to change it on first login.
              </div>
            </Field>
          )}
          <Field label="Options">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13, color: dark ? '#f1f5f9' : '#0f172a' }}>
                <input type="checkbox" checked={form.isActive} onChange={f('isActive')} style={{ accentColor: '#E84E0F' }} />
                Active (can log in)
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13, color: dark ? '#f1f5f9' : '#0f172a' }}>
                <input type="checkbox" checked={form.isExternal} onChange={f('isExternal')} style={{ accentColor: '#E84E0F' }} />
                External user (contractor, vendor, supplier)
              </label>
            </div>
          </Field>
        </Modal>
      )}

      {/* ─── USER CREATION HELP MODAL ───────────────────────── */}
      {showHelp && createPortal(
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowHelp(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'IBM Plex Sans, sans-serif' }}
          ref={(el) => {
            if (!el) return
            const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowHelp(false) }
            el.addEventListener('keydown', onKey)
          }}
          tabIndex={-1}>
          <div style={{ width: 580, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', background: dark ? '#1e293b' : '#ffffff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.5)', overflow: 'hidden' }}>

            {/* Header */}
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${dark ? 'rgba(232,78,15,0.2)' : '#e2e8f0'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: dark ? '#0f172a' : '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 15, color: '#E84E0F' }}>◈</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>User Creation Guide</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>Rules and guidelines for adding users to QCO Group MMS</div>
                </div>
              </div>
              <button onClick={() => setShowHelp(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '20px' }}>

              {/* Creating Users */}
              <HelpSection title="Creating Users" icon="🏢">
                <HelpRule>Full Name and Email are required. Email must be unique — it is the login identifier.</HelpRule>
                <HelpRule>Staff ID is optional but recommended when multiple staff share the same name.</HelpRule>
                <HelpRule>Any admin can create any user (internal or external) immediately — no second-admin approval required.</HelpRule>
                <HelpRule>A secure temporary password is auto-generated and emailed on account creation.</HelpRule>
                <HelpRule>The user must change their password on first login.</HelpRule>
                <HelpRule>Passwords expire every <strong>90 days</strong> for internal users and <strong>30 days</strong> for external users.</HelpRule>
              </HelpSection>

              <HelpDivider dark={dark} />

              {/* External Users */}
              <HelpSection title="External Users — Contractors, Vendors, Suppliers" icon="🌐">
                <HelpRule>External users are activated immediately on creation — same workflow as internal users.</HelpRule>
                <HelpRule>Contract Start and End dates are strongly recommended for compliance tracking.</HelpRule>
                <HelpRule>Access is automatically revoked on the contract end date.</HelpRule>
                <HelpRule>Warning notifications are sent at <strong>30, 14, 7 and 1 day(s)</strong> before expiry.</HelpRule>
                <HelpRule>After creation, assign the user to specific projects and WBS codes via the project settings.</HelpRule>
              </HelpSection>

              <HelpDivider dark={dark} />

              {/* Managing Users */}
              <HelpSection title="Managing Users" icon="📋">
                <HelpRule><strong>Edit</strong> — update any field immediately. Contract end date can be extended at any time.</HelpRule>
                <HelpRule><strong>Deactivate</strong> — disables login while preserving all data. Reversible with Reactivate.</HelpRule>
                <HelpRule><strong>Reactivate</strong> — re-enables a deactivated account immediately.</HelpRule>
                <HelpRule><strong>Reset Password</strong> — generates a new temp password and emails it. User must change it on next login.</HelpRule>
                <HelpRule><strong>Delete</strong> — permanent. Requires selecting a reason and confirming. Cannot be undone.</HelpRule>
                <HelpRule>Every action (create, edit, deactivate, reactivate, reset, delete) is recorded in the audit trail with the acting admin's name and timestamp.</HelpRule>
                <HelpRule>You cannot deactivate or delete your own account. Email is always the unique identifier.</HelpRule>
              </HelpSection>

            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button onClick={() => setShowHelp(false)} style={{ padding: '7px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                Got it
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ─── DEACTIVATE MODAL ───────────────────────────────────
          SimpleConfirmModal — reversible action, no reason needed.
          The server logs who performed the deactivation and when. */}
      {deactivateTarget && (
        <SimpleConfirmModal
          dark={dark}
          title="Deactivate User"
          message={`Are you sure you want to deactivate ${deactivateTarget.fullName}? Their account will be disabled but all data and history is preserved. You can reactivate them at any time.`}
          confirmLabel="Deactivate"
          confirmStyle="warning"
          onConfirm={confirmDeactivate}
          onCancel={() => { setDeactivateTarget(null); setDeactivateErr('') }}
          saving={deactivateSaving}
          error={deactivateErr}
        />
      )}

      {/* ─── REACTIVATE MODAL ───────────────────────────────────
          SimpleConfirmModal — re-enables a previously deactivated account.
          No approval required — any admin can reactivate immediately. */}
      {reactivateTarget && (
        <SimpleConfirmModal
          dark={dark}
          title="Reactivate User"
          message={`Reactivate ${reactivateTarget.fullName}? They will be able to log in again immediately.`}
          confirmLabel="Reactivate"
          confirmStyle="primary"
          onConfirm={confirmReactivate}
          onCancel={() => { setReactivateTarget(null); setReactivateErr('') }}
          saving={reactivateSaving}
          error={reactivateErr}
        />
      )}

      {/* ─── DELETE MODAL ───────────────────────────────────────
          DeleteConfirmModal — permanent action. Admin must select a reason
          from the dropdown AND tick the checkbox before Confirm is enabled.
          The reason is forwarded to the server and logged in the audit trail. */}
      {deleteTarget && (
        <DeleteConfirmModal
          dark={dark}
          itemName={deleteTarget.fullName}
          itemType="user"
          onConfirm={confirmDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteErr('') }}
          saving={deleteSaving}
          error={deleteErr}
        />
      )}

      {/* ─── RESET PASSWORD MODAL ───────────────────────────────
          Shows before sending a reset so the admin can verify the
          email address. Marks force_password_change on the account
          so the user must set a new password on next login. */}
      {resetPwTarget && createPortal(
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setResetPwTarget(null) }}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'IBM Plex Sans, sans-serif' }}>
          <div style={{ width: 420, background: dark ? '#1e293b' : '#ffffff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15 }}>🔑</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>Reset Password</span>
              </div>
              <button onClick={() => setResetPwTarget(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            {/* Body */}
            <div style={{ padding: '20px' }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: dark ? '#cbd5e1' : '#334155', lineHeight: 1.5 }}>
                Send a password reset email to:
              </p>
              <div style={{ padding: '8px 12px', borderRadius: 6, background: dark ? '#0f172a' : '#f8fafc', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, color: dark ? '#f1f5f9' : '#0f172a', marginBottom: 14 }}>
                {resetPwTarget.email}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                The user will be required to set a new password on their next login.
              </p>
              {resetPwErr && (
                <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 12, color: '#ef4444' }}>
                  {resetPwErr}
                </div>
              )}
            </div>
            {/* Footer */}
            <div style={{ padding: '14px 20px', borderTop: `1px solid ${dark ? '#334155' : '#f1f5f9'}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setResetPwTarget(null)} style={{ padding: '7px 16px', borderRadius: 6, fontSize: 13, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                Cancel
              </button>
              <button
                onClick={confirmResetPassword}
                disabled={resetPwSaving}
                style={{ padding: '7px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: resetPwSaving ? 'not-allowed' : 'pointer', opacity: resetPwSaving ? 0.7 : 1, fontFamily: 'IBM Plex Sans, sans-serif' }}>
                {resetPwSaving ? 'Sending…' : 'Send Reset Email'}
              </button>
            </div>
          </div>
        </div>,
        document.body
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

// ─── (ExternalUsersTab removed) ─────────────────────────────
// The two-admin approval workflow has been removed. External users
// are created active immediately — same as internal users. To view
// external users, use the "External only" filter in the Users tab.

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
// Shows SMTP status, expiry thresholds, and the editable
// escalation email field. Settings are persisted in the
// system_settings table via GET/PUT /api/admin/system-settings.
// ═══════════════════════════════════════════════════════════
// ─── SETTINGS FIELD DEFINITIONS ─────────────────────────────
// Maps each setting key to its label and description so the
// SystemSettingsTab can render fields generically.
const SETTINGS_META: Record<string, { label: string; desc: string; placeholder: string }> = {
  system_name:                   { label: 'System Name',                            desc: 'Displayed in email subjects and headings.',                                               placeholder: 'QCO Group MMS' },
  escalation_email:              { label: 'Emergency Escalation Email(s)',          desc: 'Receives security and escalation alert emails. Comma-separated.',                        placeholder: 'security@qco.com.au, ceo@qco.com.au' },
  password_expiry_days_internal: { label: 'Password Expiry — Internal Users (days)', desc: 'Days before internal user passwords expire (default 90).',                            placeholder: '90' },
  password_expiry_days_external: { label: 'Password Expiry — External Users (days)', desc: 'Days before external user passwords expire (default 30).',                            placeholder: '30' },
  access_expiry_warning_days:    { label: 'Access Expiry Warning Days',             desc: 'Comma-separated days before contract end to send warning notifications.',               placeholder: '30,14,7,1' },
}

function SystemSettingsTab({ dark }: { dark: boolean }) {
  // ─── LOCAL STATE ─────────────────────────────────────────────
  // Each editable setting is held in a single Record so adding
  // new settings only requires updating SETTINGS_META above.
  const [settings,   setSettings]   = useState<Record<string, string>>({})
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [saveErr,    setSaveErr]    = useState('')
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState('')
  const [testError,  setTestError]  = useState('')

  // ─── LOAD SETTINGS ON MOUNT ──────────────────────────────────
  // Degrades silently if the table doesn't exist yet.
  const loadSettings = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/system-settings`)
      setSettings(data)
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  const setSetting = (k: string, v: string) => setSettings(p => ({ ...p, [k]: v }))

  const saveAll = async () => {
    setSaving(true); setSaved(false); setSaveErr('')
    try {
      await axios.put(`${API}/system-settings`, settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setSaveErr(err.response?.data?.error ?? 'Save failed')
    } finally { setSaving(false) }
  }

  const resetDefaults = () => {
    setSettings({
      system_name: 'QCO Group MMS',
      escalation_email: '',
      password_expiry_days_internal: '90',
      password_expiry_days_external: '30',
      access_expiry_warning_days: '30,14,7,1',
    })
  }

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

  const section = (title: string) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 28, marginBottom: 10 }}>
      {title}
    </div>
  )
  const infoRow = (label: string, value: string, mono = false) => (
    <div style={{ display: 'flex', padding: '11px 0', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, alignItems: 'flex-start', gap: 12 }}>
      <span style={{ width: 220, flexShrink: 0, fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 13, color: dark ? '#f1f5f9' : '#0f172a', fontFamily: mono ? 'JetBrains Mono, monospace' : 'IBM Plex Sans, sans-serif' }}>{value}</span>
    </div>
  )

  return (
    <div style={{ maxWidth: 720 }}>

      {/* ─── EDITABLE SETTINGS ──────────────────────────────────── */}
      {section('System Settings')}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {Object.entries(SETTINGS_META).map(([key, meta]) => (
          <div key={key}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: dark ? '#f1f5f9' : '#0f172a', marginBottom: 3 }}>{meta.label}</label>
            <p style={{ margin: '0 0 6px', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>{meta.desc}</p>
            <input
              value={settings[key] ?? ''}
              onChange={e => setSetting(key, e.target.value)}
              placeholder={meta.placeholder}
              style={{ ...inp(dark), maxWidth: 460 }}
            />
          </div>
        ))}
        {saveErr && <p style={{ margin: 0, fontSize: 12, color: '#ef4444' }}>{saveErr}</p>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={saveAll} disabled={saving} style={{ padding: '8px 22px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'IBM Plex Sans, sans-serif' }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
          </button>
          <button onClick={resetDefaults} style={{ padding: '8px 18px', borderRadius: 6, fontSize: 13, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'none', color: '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
            Reset to Defaults
          </button>
        </div>
      </div>

      {/* ─── SMTP CONFIG ────────────────────────────────────────── */}
      {section('SMTP Configuration')}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 10, padding: '0 18px' }}>
        {infoRow('Host', 'smtp.office365.com', true)}
        {infoRow('Port', '587', true)}
        {infoRow('From address', 'noreply@qcogroup.com.au', true)}
        {infoRow('Alert recipients', 'Configured via ADDITIONAL_ALERT_EMAILS in server/.env')}
        {infoRow('Status', 'Credentials in server/.env — restart server after changes')}
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={sendTest} disabled={testing} style={{ padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: testing ? 'not-allowed' : 'pointer', opacity: testing ? 0.7 : 1, fontFamily: 'IBM Plex Sans, sans-serif' }}>
          {testing ? 'Sending…' : 'Send test email to me'}
        </button>
        {testResult && <p style={{ marginTop: 8, fontSize: 12, color: '#22c55e' }}>{testResult}</p>}
        {testError  && <p style={{ marginTop: 8, fontSize: 12, color: '#ef4444' }}>{testError}</p>}
      </div>

      {/* ─── ROLES REFERENCE ────────────────────────────────────── */}
      {section('Active Roles')}
      <div style={{ background: dark ? '#1e293b' : '#fff', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 10, padding: '14px 18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ALL_ROLES.map(r => <RoleBadge key={r} role={r} />)}
        </div>
      </div>

      {/* ─── SQL SETUP ──────────────────────────────────────────── */}
      {section('SQL Setup')}
      <div style={{ background: dark ? '#0f172a' : '#f8fafc', border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, borderRadius: 10, padding: '14px 18px' }}>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px' }}>Run the migration script to initialise all tables and columns:</p>
        <pre style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: dark ? '#94a3b8' : '#475569', margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
{`node server/scripts/migrate-users-columns.js
node server/scripts/seed-admin-data.js
node server/scripts/seed-permissions.js

-- Or run these SQL statements manually:
ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_start DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_end DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_id VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS force_password_change TINYINT(1) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_expires_at DATETIME;

-- System settings (escalation email, policy thresholds)
CREATE TABLE IF NOT EXISTS system_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  \`key\` VARCHAR(100) NOT NULL UNIQUE,
  \`value\` TEXT,
  updated_by INT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT INTO system_settings (\`key\`, \`value\`) VALUES
  ('system_name', 'QCO Group MMS'),
  ('escalation_email', ''),
  ('password_expiry_days_internal', '90'),
  ('password_expiry_days_external', '30'),
  ('access_expiry_warning_days', '30,14,7,1')
ON DUPLICATE KEY UPDATE \`key\`=\`key\`;

CREATE TABLE IF NOT EXISTS user_wbs_access (...);
CREATE TABLE IF NOT EXISTS role_permissions (...);
CREATE TABLE IF NOT EXISTS user_permission_overrides (...);
CREATE TABLE IF NOT EXISTS notifications (...);
CREATE TABLE IF NOT EXISTS delegated_permissions (...);

-- Then seed default role permissions:
node server/scripts/seed-permissions.js`}
        </pre>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── SUPPLIERS TAB ──────────────────────────────────────────
// Full CRUD for the suppliers master list. Matches wireframe
// columns: Name, Code, Country, Contact, Email, Phone, Status.
// ═══════════════════════════════════════════════════════════
type Supplier = {
  id: number; name: string; code: string; country: string
  contactName: string; email: string; phone: string; status: string
}
type SupplierForm = { name: string; code: string; country: string; contactName: string; email: string; phone: string; status: string }
const EMPTY_SUP: SupplierForm = { name: '', code: '', country: '', contactName: '', email: '', phone: '', status: 'active' }

type SKey = 'sname' | 'scode' | 'scountry' | 'scontact' | 'semail' | 'sphone' | 'sstatus'
const S_DEF: Record<SKey, number> = { sname: 200, scode: 100, scountry: 110, scontact: 150, semail: 190, sphone: 130, sstatus: 90 }
const S_MIN: Record<SKey, number> = { sname: 120, scode: 70,  scountry: 80,  scontact: 100, semail: 130, sphone: 90,  sstatus: 70 }

function SuppliersTab({ dark }: { dark: boolean }) {
  const [rows,     setRows]     = useState<Supplier[]>([])
  const [total,    setTotal]    = useState<number | null>(null)
  const [error,    setError]    = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState<number | null>(null)
  const [form,     setForm]     = useState<SupplierForm>(EMPTY_SUP)
  const [formErr,  setFormErr]  = useState('')
  const [saving,   setSaving]   = useState(false)
  // ─── DELETE / DEACTIVATE STATE ──────────────────────────────
  const [deleteTarget,     setDeleteTarget]     = useState<{ id: number; name: string } | null>(null)
  const [deleteSaving,     setDeleteSaving]     = useState(false)
  const [deleteErr,        setDeleteErr]        = useState('')
  const [deactivateTarget, setDeactivateTarget] = useState<{ id: number; name: string } | null>(null)
  const [deactivateSaving, setDeactivateSaving] = useState(false)
  const [deactivateErr,    setDeactivateErr]    = useState('')

  const { containerRef, startResize } = useTableResize(S_DEF, S_MIN)
  const GRID = [
    `var(--col-sname,${S_DEF.sname}px)`,
    `var(--col-scode,${S_DEF.scode}px)`,
    `var(--col-scountry,${S_DEF.scountry}px)`,
    `var(--col-scontact,${S_DEF.scontact}px)`,
    `var(--col-semail,${S_DEF.semail}px)`,
    `var(--col-sphone,${S_DEF.sphone}px)`,
    `var(--col-sstatus,${S_DEF.sstatus}px)`,
    '130px',
  ].join(' ')

  const load = useCallback(async () => {
    setError('')
    try {
      const { data } = await axios.get(`${API}/suppliers`)
      setRows(data); setTotal(data.length)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load suppliers')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd  = () => { setForm(EMPTY_SUP); setEditId(null); setFormErr(''); setShowForm(true) }
  const openEdit = (s: Supplier) => {
    setForm({ name: s.name, code: s.code, country: s.country, contactName: s.contactName, email: s.email, phone: s.phone, status: s.status })
    setEditId(s.id); setFormErr(''); setShowForm(true)
  }

  const sf = (k: keyof SupplierForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    if (!form.name.trim()) { setFormErr('Supplier name is required'); return }
    setSaving(true); setFormErr('')
    try {
      editId != null
        ? await axios.put(`${API}/suppliers/${editId}`, form)
        : await axios.post(`${API}/suppliers`, form)
      setShowForm(false); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setFormErr(err.response?.data?.error ?? 'Save failed')
    } finally { setSaving(false) }
  }

  // ─── DELETE (permanent) ─────────────────────────────────────
  // Reason is collected by DeleteConfirmModal and logged in audit.
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try {
      await axios.delete(`${API}/suppliers/${id}`, { data: { reason } })
      setDeleteTarget(null); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setDeleteErr(err.response?.data?.error ?? 'Delete failed')
    } finally { setDeleteSaving(false) }
  }

  // ─── DEACTIVATE (reversible) ─────────────────────────────────
  const deactivate = async (id: number) => {
    setDeactivateSaving(true); setDeactivateErr('')
    try {
      await axios.patch(`${API}/suppliers/${id}/status`, { status: 'inactive' })
      setDeactivateTarget(null); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setDeactivateErr(err.response?.data?.error ?? 'Deactivation failed')
    } finally { setDeactivateSaving(false) }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{total == null ? 'Loading…' : `${total} supplier${total !== 1 ? 's' : ''}`}</span>
        <AddBtn onClick={openAdd} label="+ Add Supplier" />
      </div>

      {error && <Err msg={error} />}

      <TableCard dark={dark}>
        <div ref={containerRef}>
          <TH dark={dark} grid={GRID}>
            <HeaderCell label="Name"    col="sname"    align="left" onResize={startResize} />
            <HeaderCell label="Code"    col="scode"    align="left" onResize={startResize} />
            <HeaderCell label="Country" col="scountry" align="left" onResize={startResize} />
            <HeaderCell label="Contact" col="scontact" align="left" onResize={startResize} />
            <HeaderCell label="Email"   col="semail"   align="left" onResize={startResize} />
            <HeaderCell label="Phone"   col="sphone"   align="left" onResize={startResize} />
            <HeaderCell label="Status"  col="sstatus"               onResize={startResize} />
            <div />
          </TH>
          {rows.length === 0 && total !== null && <Empty msg="No suppliers found." />}
          {rows.map(s => (
            <TR key={s.id} dark={dark} grid={GRID}>
              <TD dark={dark}>{s.name}</TD>
              <TD dark={dark} mono>{s.code || '—'}</TD>
              <TD dark={dark} muted>{s.country || '—'}</TD>
              <TD dark={dark} muted>{s.contactName || '—'}</TD>
              <TD dark={dark} muted>{s.email || '—'}</TD>
              <TD dark={dark} muted mono>{s.phone || '—'}</TD>
              <div style={{ padding: '0 12px' }}>
                <StatusPill active={s.status === 'active'} label={s.status === 'active' ? 'Active' : 'Inactive'} />
              </div>
              <div style={{ padding: '0 8px', display: 'flex', gap: 4, alignItems: 'center' }}>
                <button onClick={() => openEdit(s)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.08)', color: '#2563eb', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Edit</button>
                {s.status === 'active' && (
                  <button onClick={() => { setDeactivateTarget({ id: s.id, name: s.name }); setDeactivateErr('') }} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', color: '#d97706', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Deactivate</button>
                )}
                <button onClick={() => { setDeleteTarget({ id: s.id, name: s.name }); setDeleteErr('') }} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.25)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Delete</button>
              </div>
            </TR>
          ))}
        </div>
      </TableCard>

      {/* ─── DEACTIVATE / DELETE MODALS ─────────────────────── */}
      {deactivateTarget && (
        <SimpleConfirmModal dark={dark} title="Deactivate Supplier"
          message={`Are you sure you want to deactivate ${deactivateTarget.name}? It will no longer appear as an active supplier.`}
          confirmLabel="Deactivate" confirmStyle="warning"
          onConfirm={() => deactivate(deactivateTarget.id)}
          onCancel={() => { setDeactivateTarget(null); setDeactivateErr('') }}
          saving={deactivateSaving} error={deactivateErr} />
      )}
      {deleteTarget && (
        <DeleteConfirmModal dark={dark} itemName={deleteTarget.name} itemType="supplier"
          reasons={['Duplicate record', 'Created in error', 'No longer required', 'Merged with another supplier', 'Other']}
          onConfirm={reason => del(deleteTarget.id, reason)}
          onCancel={() => { setDeleteTarget(null); setDeleteErr('') }}
          saving={deleteSaving} error={deleteErr} />
      )}

      {showForm && (
        <Modal title={editId != null ? 'Edit Supplier' : 'Add Supplier'} dark={dark} onClose={() => setShowForm(false)} onSubmit={save} error={formErr} saving={saving}>
          <Field label="Name *"><input value={form.name} onChange={sf('name')} placeholder="Supplier name" style={inp(dark)} /></Field>
          <Field label="Code"><input value={form.code} onChange={sf('code')} placeholder="e.g. SUP-001" style={inp(dark)} /></Field>
          <Field label="Country"><input value={form.country} onChange={sf('country')} placeholder="Country" style={inp(dark)} /></Field>
          <Field label="Contact Name"><input value={form.contactName} onChange={sf('contactName')} placeholder="Contact person" style={inp(dark)} /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={sf('email')} placeholder="contact@supplier.com" style={inp(dark)} /></Field>
          <Field label="Phone"><input value={form.phone} onChange={sf('phone')} placeholder="+61 2 1234 5678" style={inp(dark)} /></Field>
          <Field label="Status">
            <select value={form.status} onChange={sf('status')} style={inp(dark)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        </Modal>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── PROJECTS ADMIN TAB ─────────────────────────────────────
// Full CRUD for projects. RAG status, phase, client, and dates
// are all editable. Columns: Code, Name, Client, Phase, RAG,
// Start, End, Status, Actions.
// ═══════════════════════════════════════════════════════════
type AdminProject = {
  id: number; code: string; name: string; phase: string; status: string
  rag: string; client: string; startDate: string; endDate: string
  totalPOs: number; atRisk: number; breached: number
}
type ProjForm = { code: string; name: string; phase: string; status: string; rag: string; client: string; startDate: string; endDate: string }
const EMPTY_PROJ: ProjForm = { code: '', name: '', phase: '', status: 'active', rag: 'grey', client: '', startDate: '', endDate: '' }
const RAG_OPTS = ['green', 'amber', 'red', 'blue', 'grey']
const RAG_DOT: Record<string, string> = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', blue: '#2563eb', grey: '#94a3b8' }

function ProjectsAdminTab({ dark }: { dark: boolean }) {
  const [rows,     setRows]     = useState<AdminProject[]>([])
  const [search,   setSearch]   = useState('')
  const [error,    setError]    = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState<number | null>(null)
  const [form,     setForm]     = useState<ProjForm>(EMPTY_PROJ)
  const [formErr,  setFormErr]  = useState('')
  const [saving,   setSaving]   = useState(false)
  // ─── DELETE STATE ────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteErr,    setDeleteErr]    = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const { data } = await axios.get(`${API}/projects`)
      // Map DB snake_case aliases to camelCase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setRows(data.map((p: any) => ({
        ...p,
        startDate: p.startDate ?? p.start_date ?? '',
        endDate:   p.endDate   ?? p.end_date   ?? '',
      })))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load projects')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const pf = (k: keyof ProjForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const openAdd  = () => { setForm(EMPTY_PROJ); setEditId(null); setFormErr(''); setShowForm(true) }
  const openEdit = (p: AdminProject) => {
    setForm({ code: p.code, name: p.name, phase: p.phase || '', status: p.status || 'active',
              rag: p.rag || 'grey', client: p.client || '', startDate: p.startDate?.slice(0,10) || '', endDate: p.endDate?.slice(0,10) || '' })
    setEditId(p.id); setFormErr(''); setShowForm(true)
  }
  const save = async () => {
    if (!form.code.trim()) { setFormErr('Project code is required'); return }
    if (!form.name.trim()) { setFormErr('Project name is required'); return }
    setSaving(true); setFormErr('')
    try {
      editId != null ? await axios.put(`${API}/projects/${editId}`, form) : await axios.post(`${API}/projects`, form)
      setShowForm(false); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setFormErr(err.response?.data?.error ?? 'Save failed')
    } finally { setSaving(false) }
  }
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try {
      await axios.delete(`${API}/projects/${id}`, { data: { reason } })
      setDeleteTarget(null); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setDeleteErr(err.response?.data?.error ?? 'Delete failed')
    } finally { setDeleteSaving(false) }
  }

  const filtered = search.trim()
    ? rows.filter(p => p.code.toLowerCase().includes(search.toLowerCase()) || p.name.toLowerCase().includes(search.toLowerCase()) || (p.client || '').toLowerCase().includes(search.toLowerCase()))
    : rows

  const GRID = '100px 1fr 130px 100px 60px 60px 60px 110px 110px 120px'
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code, name, client…" style={{ ...inp(dark), width: 260 }} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{filtered.length} project{filtered.length !== 1 ? 's' : ''}</span>
        <AddBtn onClick={openAdd} label="+ Add Project" />
      </div>
      {error && <Err msg={error} />}
      <TableCard dark={dark}>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, background: dark ? '#0f172a' : '#f4f7fb', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}`, height: 36, userSelect: 'none', position: 'sticky', top: 0, zIndex: 1 }}>
          {['Code','Name','Client','Phase','POs','Risk','Breach','Start','End',''].map(h => (
            <div key={h} style={{ padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</div>
          ))}
        </div>
        {filtered.length === 0 && <Empty msg="No projects found." />}
        {filtered.map(p => (
          <div key={p.id} style={{ display: 'grid', gridTemplateColumns: GRID, borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`, minHeight: 40, alignItems: 'center' }}>
            <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: RAG_DOT[p.rag] ?? '#94a3b8' }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: dark ? '#f1f5f9' : '#0f172a' }}>{p.code}</span>
            </div>
            <TD dark={dark}>{p.name}</TD>
            <TD dark={dark} muted>{p.client || '—'}</TD>
            <TD dark={dark} muted>{p.phase || '—'}</TD>
            <TD dark={dark} muted center>{p.totalPOs ?? 0}</TD>
            <TD dark={dark} muted center>{p.atRisk ?? 0}</TD>
            <TD dark={dark} muted center>{p.breached ?? 0}</TD>
            <TD dark={dark} muted mono>{p.startDate?.slice(0, 10) || '—'}</TD>
            <TD dark={dark} muted mono>{p.endDate?.slice(0, 10) || '—'}</TD>
            <div style={{ padding: '0 8px', display: 'flex', gap: 4 }}>
              <button onClick={() => openEdit(p)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.08)', color: '#2563eb', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Edit</button>
              <button onClick={() => { setDeleteTarget({ id: p.id, name: `${p.code} — ${p.name}` }); setDeleteErr('') }} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.25)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Delete</button>
            </div>
          </div>
        ))}
      </TableCard>
      {showForm && (
        <Modal title={editId != null ? 'Edit Project' : 'Add Project'} dark={dark} onClose={() => setShowForm(false)} onSubmit={save} error={formErr} saving={saving}>
          <Field label="Project Code *"><input value={form.code} onChange={pf('code')} placeholder="e.g. PGAS-001" style={inp(dark)} /></Field>
          <Field label="RAG Status">
            <select value={form.rag} onChange={pf('rag')} style={inp(dark)}>
              {RAG_OPTS.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Project Name *" wide>
            <input value={form.name} onChange={pf('name')} placeholder="e.g. Pilbara Gas Processing Plant" style={inp(dark)} />
          </Field>
          <Field label="Phase">
            <input value={form.phase} onChange={pf('phase')} placeholder="e.g. Execution" style={inp(dark)} />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={pf('status')} style={inp(dark)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
          <Field label="Client">
            <input value={form.client} onChange={pf('client')} placeholder="Client name" style={inp(dark)} />
          </Field>
          <Field label="Start Date">
            <input type="date" value={form.startDate} onChange={pf('startDate')} style={inp(dark)} />
          </Field>
          <Field label="End Date">
            <input type="date" value={form.endDate} onChange={pf('endDate')} style={inp(dark)} />
          </Field>
        </Modal>
      )}
      {/* ─── DELETE MODAL ─────────────────────────────────── */}
      {deleteTarget && (
        <DeleteConfirmModal dark={dark} itemName={deleteTarget.name} itemType="project"
          reasons={['Project cancelled', 'Duplicate record', 'Created in error', 'No longer required', 'Other']}
          onConfirm={reason => del(deleteTarget.id, reason)}
          onCancel={() => { setDeleteTarget(null); setDeleteErr('') }}
          saving={deleteSaving} error={deleteErr} />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── WAREHOUSES TAB ─────────────────────────────────────────
// Full CRUD for physical storage locations (laydown yards,
// stores, site warehouses). Columns: Name, Code, Address,
// State, Contact, Phone, Status.
// ═══════════════════════════════════════════════════════════
type Warehouse = {
  id: number; name: string; code: string; address: string
  state: string; contactName: string; phone: string; status: string
}
type WhForm = { name: string; code: string; address: string; state: string; contactName: string; phone: string; status: string }
const EMPTY_WH: WhForm = { name: '', code: '', address: '', state: '', contactName: '', phone: '', status: 'active' }
type WhKey = 'whname' | 'whcode' | 'whaddr' | 'whstate' | 'whcontact' | 'whphone' | 'whstatus'
const WH_DEF: Record<WhKey, number> = { whname: 200, whcode: 80, whaddr: 220, whstate: 80, whcontact: 140, whphone: 130, whstatus: 90 }
const WH_MIN: Record<WhKey, number> = { whname: 120, whcode: 60, whaddr: 120, whstate: 60, whcontact: 90,  whphone: 90,  whstatus: 70 }

function WarehousesTab({ dark }: { dark: boolean }) {
  const [rows,     setRows]     = useState<Warehouse[]>([])
  const [total,    setTotal]    = useState<number | null>(null)
  const [search,   setSearch]   = useState('')
  const [filterSt, setFilterSt] = useState('')
  const [error,    setError]    = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState<number | null>(null)
  const [form,     setForm]     = useState<WhForm>(EMPTY_WH)
  const [formErr,  setFormErr]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [deleteTarget,   setDeleteTarget]   = useState<Warehouse | null>(null)
  const [deleteSaving,   setDeleteSaving]   = useState(false)
  const [deleteErr,      setDeleteErr]      = useState('')
  const [deactivateTarget,  setDeactivateTarget]  = useState<Warehouse | null>(null)
  const [deactivateSaving,  setDeactivateSaving]  = useState(false)
  const [deactivateErr,     setDeactivateErr]     = useState('')
  const { containerRef, startResize } = useTableResize(WH_DEF, WH_MIN)
  const GRID = [
    `var(--col-whname,${WH_DEF.whname}px)`,
    `var(--col-whcode,${WH_DEF.whcode}px)`,
    `var(--col-whaddr,${WH_DEF.whaddr}px)`,
    `var(--col-whstate,${WH_DEF.whstate}px)`,
    `var(--col-whcontact,${WH_DEF.whcontact}px)`,
    `var(--col-whphone,${WH_DEF.whphone}px)`,
    `var(--col-whstatus,${WH_DEF.whstatus}px)`,
    '100px',
  ].join(' ')

  const load = useCallback(async () => {
    setError('')
    try {
      const p: Record<string, string> = {}
      if (search.trim()) p.search = search.trim()
      if (filterSt)      p.status = filterSt
      const { data } = await axios.get(`${API}/warehouses`, { params: p })
      setRows(data.rows ?? data); setTotal(data.total ?? (data.rows ?? data).length)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load warehouses')
    }
  }, [search, filterSt])

  useEffect(() => { load() }, [load])

  const wf = (k: keyof WhForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const openAdd  = () => { setForm(EMPTY_WH); setEditId(null); setFormErr(''); setShowForm(true) }
  const openEdit = (w: Warehouse) => {
    setForm({ name: w.name, code: w.code, address: w.address, state: w.state, contactName: w.contactName, phone: w.phone, status: w.status })
    setEditId(w.id); setFormErr(''); setShowForm(true)
  }
  const save = async () => {
    if (!form.name.trim()) { setFormErr('Name is required'); return }
    if (!form.code.trim()) { setFormErr('Code is required'); return }
    setSaving(true); setFormErr('')
    try {
      editId != null ? await axios.put(`${API}/warehouses/${editId}`, form) : await axios.post(`${API}/warehouses`, form)
      setShowForm(false); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setFormErr(err.response?.data?.error ?? 'Save failed')
    } finally { setSaving(false) }
  }
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try { await axios.delete(`${API}/warehouses/${id}`, { data: { reason } }); setDeleteTarget(null); load() }
    catch (e: unknown) { const err = e as { response?: { data?: { error?: string } } }; setDeleteErr(err.response?.data?.error ?? 'Delete failed') }
    finally { setDeleteSaving(false) }
  }
  const deactivate = async (id: number) => {
    setDeactivateSaving(true); setDeactivateErr('')
    try { await axios.patch(`${API}/warehouses/${id}/status`, { status: 'inactive' }); setDeactivateTarget(null); load() }
    catch (e: unknown) { const err = e as { response?: { data?: { error?: string } } }; setDeactivateErr(err.response?.data?.error ?? 'Deactivate failed') }
    finally { setDeactivateSaving(false) }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, code, state…" style={{ ...inp(dark), width: 240 }} />
        <select value={filterSt} onChange={e => setFilterSt(e.target.value)} style={{ ...inp(dark), width: 120 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{total == null ? 'Loading…' : `${total} warehouse${total !== 1 ? 's' : ''}`}</span>
        <AddBtn onClick={openAdd} label="+ Add Warehouse" />
      </div>
      {error && <Err msg={error} />}
      <TableCard dark={dark}>
        <div ref={containerRef}>
          <TH dark={dark} grid={GRID}>
            <HeaderCell label="Name"    col="whname"    align="left" onResize={startResize} />
            <HeaderCell label="Code"    col="whcode"    align="left" onResize={startResize} />
            <HeaderCell label="Address" col="whaddr"    align="left" onResize={startResize} />
            <HeaderCell label="State"   col="whstate"   align="left" onResize={startResize} />
            <HeaderCell label="Contact" col="whcontact" align="left" onResize={startResize} />
            <HeaderCell label="Phone"   col="whphone"   align="left" onResize={startResize} />
            <HeaderCell label="Status"  col="whstatus"              onResize={startResize} />
            <div />
          </TH>
          {rows.length === 0 && total !== null && <Empty msg="No warehouses found." />}
          {rows.map(w => (
            <TR key={w.id} dark={dark} grid={GRID}>
              <TD dark={dark}>{w.name}</TD>
              <TD dark={dark} mono>{w.code}</TD>
              <TD dark={dark} muted><span title={w.address} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{w.address || '—'}</span></TD>
              <TD dark={dark} muted>{w.state || '—'}</TD>
              <TD dark={dark} muted>{w.contactName || '—'}</TD>
              <TD dark={dark} muted mono>{w.phone || '—'}</TD>
              <div style={{ padding: '0 12px' }}>
                <StatusPill active={w.status === 'active'} label={w.status === 'active' ? 'Active' : 'Inactive'} />
              </div>
              <div style={{ padding: '0 8px', display: 'flex', gap: 4 }}>
                <button onClick={() => openEdit(w)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.08)', color: '#2563eb', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Edit</button>
                {w.status === 'active' && (
                  <button onClick={() => setDeactivateTarget(w)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(217,119,6,0.3)', background: 'rgba(217,119,6,0.08)', color: '#d97706', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Deactivate</button>
                )}
                <button onClick={() => setDeleteTarget(w)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Delete</button>
              </div>
            </TR>
          ))}
        </div>
      </TableCard>
      {showForm && (
        <Modal title={editId != null ? 'Edit Warehouse' : 'Add Warehouse'} dark={dark} onClose={() => setShowForm(false)} onSubmit={save} error={formErr} saving={saving}>
          <Field label="Name *"><input value={form.name} onChange={wf('name')} placeholder="e.g. Perth Laydown Yard" style={inp(dark)} /></Field>
          <Field label="Code *"><input value={form.code} onChange={wf('code')} placeholder="e.g. PLY" style={inp(dark)} /></Field>
          <Field label="State"><input value={form.state} onChange={wf('state')} placeholder="WA / QLD / VIC…" style={inp(dark)} /></Field>
          <Field label="Contact Name"><input value={form.contactName} onChange={wf('contactName')} placeholder="Site contact" style={inp(dark)} /></Field>
          <Field label="Phone"><input value={form.phone} onChange={wf('phone')} placeholder="+61 8 1234 5678" style={inp(dark)} /></Field>
          <Field label="Status">
            <select value={form.status} onChange={wf('status')} style={inp(dark)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
          <Field label="Address" wide>
            <input value={form.address} onChange={wf('address')} placeholder="Street address" style={inp(dark)} />
          </Field>
        </Modal>
      )}
      {deactivateTarget && (
        <SimpleConfirmModal dark={dark} title="Deactivate Warehouse"
          message={`Are you sure you want to deactivate ${deactivateTarget.name}? It will no longer appear in active lists.`}
          confirmLabel="Deactivate" confirmStyle="warning"
          onConfirm={() => deactivate(deactivateTarget.id)}
          onCancel={() => { setDeactivateTarget(null); setDeactivateErr('') }}
          saving={deactivateSaving} error={deactivateErr} />
      )}
      {deleteTarget && (
        <DeleteConfirmModal dark={dark} itemName={deleteTarget.name} itemType="warehouse"
          reasons={['Duplicate record', 'Created in error', 'No longer required', 'Facility closed', 'Other']}
          onConfirm={reason => del(deleteTarget.id, reason)}
          onCancel={() => { setDeleteTarget(null); setDeleteErr('') }}
          saving={deleteSaving} error={deleteErr} />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── UNITS OF MEASURE TAB ───────────────────────────────────
// Reference list of UoM codes used on POs and MTO lines.
// Columns: Code, Description, Status, Actions.
// ═══════════════════════════════════════════════════════════
type Uom = { id: number; code: string; description: string; status: string }
type UomForm = { code: string; description: string; status: string }
const EMPTY_UOM: UomForm = { code: '', description: '', status: 'active' }

function UomTab({ dark }: { dark: boolean }) {
  const [rows,     setRows]     = useState<Uom[]>([])
  const [search,   setSearch]   = useState('')
  const [filterSt, setFilterSt] = useState('')
  const [error,    setError]    = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState<number | null>(null)
  const [form,     setForm]     = useState<UomForm>(EMPTY_UOM)
  const [formErr,  setFormErr]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [deleteTarget,      setDeleteTarget]      = useState<Uom | null>(null)
  const [deleteSaving,      setDeleteSaving]      = useState(false)
  const [deleteErr,         setDeleteErr]         = useState('')
  const [deactivateTarget,  setDeactivateTarget]  = useState<Uom | null>(null)
  const [deactivateSaving,  setDeactivateSaving]  = useState(false)
  const [deactivateErr,     setDeactivateErr]     = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const p: Record<string, string> = {}
      if (search.trim()) p.search = search.trim()
      if (filterSt)      p.status = filterSt
      const { data } = await axios.get(`${API}/uom`, { params: p })
      setRows(data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load UoM')
    }
  }, [search, filterSt])

  useEffect(() => { load() }, [load])

  const uf = (k: keyof UomForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const openAdd  = () => { setForm(EMPTY_UOM); setEditId(null); setFormErr(''); setShowForm(true) }
  const openEdit = (u: Uom) => { setForm({ code: u.code, description: u.description, status: u.status }); setEditId(u.id); setFormErr(''); setShowForm(true) }
  const save = async () => {
    if (!form.code.trim())        { setFormErr('Code is required'); return }
    if (!form.description.trim()) { setFormErr('Description is required'); return }
    setSaving(true); setFormErr('')
    try {
      editId != null ? await axios.put(`${API}/uom/${editId}`, form) : await axios.post(`${API}/uom`, form)
      setShowForm(false); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setFormErr(err.response?.data?.error ?? 'Save failed')
    } finally { setSaving(false) }
  }
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try { await axios.delete(`${API}/uom/${id}`, { data: { reason } }); setDeleteTarget(null); load() }
    catch (e: unknown) { const err = e as { response?: { data?: { error?: string } } }; setDeleteErr(err.response?.data?.error ?? 'Delete failed') }
    finally { setDeleteSaving(false) }
  }
  const deactivate = async (id: number) => {
    setDeactivateSaving(true); setDeactivateErr('')
    try { await axios.patch(`${API}/uom/${id}/status`, { status: 'inactive' }); setDeactivateTarget(null); load() }
    catch (e: unknown) { const err = e as { response?: { data?: { error?: string } } }; setDeactivateErr(err.response?.data?.error ?? 'Deactivate failed') }
    finally { setDeactivateSaving(false) }
  }

  const GRID = '80px 1fr 100px 100px'
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or description…" style={{ ...inp(dark), width: 260 }} />
        <select value={filterSt} onChange={e => setFilterSt(e.target.value)} style={{ ...inp(dark), width: 120 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{rows.length} unit{rows.length !== 1 ? 's' : ''}</span>
        <AddBtn onClick={openAdd} label="+ Add UoM" />
      </div>
      {error && <Err msg={error} />}
      <TableCard dark={dark}>
        <TH dark={dark} grid={GRID}>
          <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Code</div>
          <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Description</div>
          <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Status</div>
          <div />
        </TH>
        {rows.length === 0 && <Empty msg="No units of measure found." />}
        {rows.map(u => (
          <TR key={u.id} dark={dark} grid={GRID}>
            <TD dark={dark} mono>{u.code}</TD>
            <TD dark={dark} muted>{u.description}</TD>
            <div style={{ padding: '0 12px' }}>
              <StatusPill active={u.status === 'active'} label={u.status === 'active' ? 'Active' : 'Inactive'} />
            </div>
            <div style={{ padding: '0 8px', display: 'flex', gap: 4 }}>
              <button onClick={() => openEdit(u)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.08)', color: '#2563eb', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Edit</button>
              {u.status === 'active' && (
                <button onClick={() => setDeactivateTarget(u)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(217,119,6,0.3)', background: 'rgba(217,119,6,0.08)', color: '#d97706', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Deactivate</button>
              )}
              <button onClick={() => setDeleteTarget(u)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Delete</button>
            </div>
          </TR>
        ))}
      </TableCard>
      {showForm && (
        <Modal title={editId != null ? 'Edit Unit of Measure' : 'Add Unit of Measure'} dark={dark} onClose={() => setShowForm(false)} onSubmit={save} error={formErr} saving={saving}>
          <Field label="Code *"><input value={form.code} onChange={uf('code')} placeholder="e.g. EA" style={inp(dark)} /></Field>
          <Field label="Description *"><input value={form.description} onChange={uf('description')} placeholder="e.g. Each" style={inp(dark)} /></Field>
          <Field label="Status">
            <select value={form.status} onChange={uf('status')} style={inp(dark)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        </Modal>
      )}
      {deactivateTarget && (
        <SimpleConfirmModal dark={dark} title="Deactivate Unit of Measure"
          message={`Are you sure you want to deactivate "${deactivateTarget.code} — ${deactivateTarget.description}"? It will no longer appear in active lists.`}
          confirmLabel="Deactivate" confirmStyle="warning"
          onConfirm={() => deactivate(deactivateTarget.id)}
          onCancel={() => { setDeactivateTarget(null); setDeactivateErr('') }}
          saving={deactivateSaving} error={deactivateErr} />
      )}
      {deleteTarget && (
        <DeleteConfirmModal dark={dark} itemName={`${deleteTarget.code} — ${deleteTarget.description}`} itemType="unit of measure"
          reasons={['Duplicate record', 'Created in error', 'No longer required', 'Other']}
          onConfirm={reason => del(deleteTarget.id, reason)}
          onCancel={() => { setDeleteTarget(null); setDeleteErr('') }}
          saving={deleteSaving} error={deleteErr} />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── ACRONYMS TAB ───────────────────────────────────────────
// Searchable glossary of acronyms used across all MMS modules.
// Columns: Acronym, Definition, Module, Notes, Actions.
// ═══════════════════════════════════════════════════════════
type AcronymRow = { id: number; acronym: string; definition: string; module: string; notes: string }
type AcrForm    = { acronym: string; definition: string; module: string; notes: string }
const EMPTY_ACR: AcrForm = { acronym: '', definition: '', module: '', notes: '' }
const ACR_MODULES = ['', 'Procurement', 'Expediting', 'VDRL', 'Logistics', 'Material Control', 'Traceability', 'Document Inbox', 'Audit', 'Admin', 'Foundational', 'Foundational']

function AcronymsTab({ dark }: { dark: boolean }) {
  const [rows,     setRows]     = useState<AcronymRow[]>([])
  const [search,   setSearch]   = useState('')
  const [filterMod, setFilterMod] = useState('')
  const [error,    setError]    = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState<number | null>(null)
  const [form,     setForm]     = useState<AcrForm>(EMPTY_ACR)
  const [formErr,  setFormErr]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [deleteTarget,  setDeleteTarget]  = useState<AcronymRow | null>(null)
  const [deleteSaving,  setDeleteSaving]  = useState(false)
  const [deleteErr,     setDeleteErr]     = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const p: Record<string, string> = {}
      if (search.trim())   p.search = search.trim()
      if (filterMod.trim()) p.module = filterMod.trim()
      const { data } = await axios.get(`${API}/acronyms`, { params: p })
      setRows(data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load acronyms')
    }
  }, [search, filterMod])

  useEffect(() => { load() }, [load])

  const af = (k: keyof AcrForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const openAdd  = () => { setForm(EMPTY_ACR); setEditId(null); setFormErr(''); setShowForm(true) }
  const openEdit = (a: AcronymRow) => { setForm({ acronym: a.acronym, definition: a.definition, module: a.module, notes: a.notes }); setEditId(a.id); setFormErr(''); setShowForm(true) }
  const save = async () => {
    if (!form.acronym.trim())    { setFormErr('Acronym is required'); return }
    if (!form.definition.trim()) { setFormErr('Definition is required'); return }
    setSaving(true); setFormErr('')
    try {
      editId != null ? await axios.put(`${API}/acronyms/${editId}`, form) : await axios.post(`${API}/acronyms`, form)
      setShowForm(false); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setFormErr(err.response?.data?.error ?? 'Save failed')
    } finally { setSaving(false) }
  }
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try { await axios.delete(`${API}/acronyms/${id}`, { data: { reason } }); setDeleteTarget(null); load() }
    catch (e: unknown) { const err = e as { response?: { data?: { error?: string } } }; setDeleteErr(err.response?.data?.error ?? 'Delete failed') }
    finally { setDeleteSaving(false) }
  }

  const GRID = '90px 1fr 140px 200px 110px'
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search acronym or definition…" style={{ ...inp(dark), width: 260 }} />
        <select value={filterMod} onChange={e => setFilterMod(e.target.value)} style={{ ...inp(dark), width: 160 }}>
          <option value="">All modules</option>
          {['Procurement','Expediting','VDRL','Logistics','Material Control','Traceability','Document Inbox','Audit','Admin','Foundational'].map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{rows.length} acronym{rows.length !== 1 ? 's' : ''}</span>
        <AddBtn onClick={openAdd} label="+ Add Acronym" />
      </div>
      {error && <Err msg={error} />}
      <TableCard dark={dark}>
        <TH dark={dark} grid={GRID}>
          {['Acronym','Definition','Module','Notes',''].map(h => (
            <div key={h} style={{ padding: '0 12px', display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</div>
          ))}
        </TH>
        {rows.length === 0 && <Empty msg="No acronyms found." />}
        {rows.map(a => (
          <TR key={a.id} dark={dark} grid={GRID}>
            <TD dark={dark} mono>{a.acronym}</TD>
            <TD dark={dark}><span title={a.definition} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{a.definition}</span></TD>
            <TD dark={dark} muted>{a.module || '—'}</TD>
            <TD dark={dark} muted><span title={a.notes} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{a.notes || '—'}</span></TD>
            <div style={{ padding: '0 8px', display: 'flex', gap: 4 }}>
              <button onClick={() => openEdit(a)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.08)', color: '#2563eb', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Edit</button>
              <button onClick={() => setDeleteTarget(a)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Delete</button>
            </div>
          </TR>
        ))}
      </TableCard>
      {showForm && (
        <Modal title={editId != null ? 'Edit Acronym' : 'Add Acronym'} dark={dark} onClose={() => setShowForm(false)} onSubmit={save} error={formErr} saving={saving}>
          <Field label="Acronym *"><input value={form.acronym} onChange={af('acronym')} placeholder="e.g. PO" style={inp(dark)} /></Field>
          <Field label="Module">
            <select value={form.module} onChange={af('module')} style={inp(dark)}>
              {ACR_MODULES.map((m, i) => <option key={i} value={m}>{m || '— None —'}</option>)}
            </select>
          </Field>
          <Field label="Full Definition *" wide>
            <input value={form.definition} onChange={af('definition')} placeholder="e.g. Purchase Order" style={inp(dark)} />
          </Field>
          <Field label="Notes" wide>
            <input value={form.notes} onChange={af('notes')} placeholder="Optional notes" style={inp(dark)} />
          </Field>
        </Modal>
      )}
      {deleteTarget && (
        <DeleteConfirmModal dark={dark} itemName={`${deleteTarget.acronym} — ${deleteTarget.definition}`} itemType="acronym"
          reasons={['Duplicate record', 'Created in error', 'No longer required', 'Superseded', 'Other']}
          onConfirm={reason => del(deleteTarget.id, reason)}
          onCancel={() => { setDeleteTarget(null); setDeleteErr('') }}
          saving={deleteSaving} error={deleteErr} />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── INCO TERMS TAB ─────────────────────────────────────────
// International commercial terms defining risk transfer and
// freight cost responsibility on Purchase Orders.
// Columns: Code, Full Name, Description, Risk Transfer Point,
//          Transport Mode, Status, Actions.
// ═══════════════════════════════════════════════════════════
type IncoTerm = {
  id: number; code: string; fullName: string; description: string
  riskTransferPoint: string; transportMode: string; status: string
}
type IncForm = { code: string; fullName: string; description: string; riskTransferPoint: string; transportMode: string; status: string }
const EMPTY_INC: IncForm = { code: '', fullName: '', description: '', riskTransferPoint: '', transportMode: 'Any mode', status: 'active' }
type IKey = 'icode' | 'iname' | 'idesc' | 'irisk' | 'imode' | 'istatus'
const I_DEF: Record<IKey, number> = { icode: 70, iname: 200, idesc: 260, irisk: 200, imode: 150, istatus: 90 }
const I_MIN: Record<IKey, number> = { icode: 50, iname: 130, idesc: 130, irisk: 120, imode: 100, istatus: 70 }

function IncoTermsTab({ dark }: { dark: boolean }) {
  const [rows,     setRows]     = useState<IncoTerm[]>([])
  const [search,   setSearch]   = useState('')
  const [filterSt, setFilterSt] = useState('')
  const [error,    setError]    = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState<number | null>(null)
  const [form,     setForm]     = useState<IncForm>(EMPTY_INC)
  const [formErr,  setFormErr]  = useState('')
  const [saving,   setSaving]   = useState(false)
  const [deleteTarget,      setDeleteTarget]      = useState<IncoTerm | null>(null)
  const [deleteSaving,      setDeleteSaving]      = useState(false)
  const [deleteErr,         setDeleteErr]         = useState('')
  const [deactivateTarget,  setDeactivateTarget]  = useState<IncoTerm | null>(null)
  const [deactivateSaving,  setDeactivateSaving]  = useState(false)
  const [deactivateErr,     setDeactivateErr]     = useState('')
  const { containerRef, startResize } = useTableResize(I_DEF, I_MIN)
  const GRID = [
    `var(--col-icode,${I_DEF.icode}px)`,
    `var(--col-iname,${I_DEF.iname}px)`,
    `var(--col-idesc,${I_DEF.idesc}px)`,
    `var(--col-irisk,${I_DEF.irisk}px)`,
    `var(--col-imode,${I_DEF.imode}px)`,
    `var(--col-istatus,${I_DEF.istatus}px)`,
    '100px',
  ].join(' ')

  const load = useCallback(async () => {
    setError('')
    try {
      const p: Record<string, string> = {}
      if (search.trim()) p.search = search.trim()
      if (filterSt)      p.status = filterSt
      const { data } = await axios.get(`${API}/inco-terms`, { params: p })
      setRows(data)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load INCO terms')
    }
  }, [search, filterSt])

  useEffect(() => { load() }, [load])

  const inf = (k: keyof IncForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const openAdd  = () => { setForm(EMPTY_INC); setEditId(null); setFormErr(''); setShowForm(true) }
  const openEdit = (t: IncoTerm) => {
    setForm({ code: t.code, fullName: t.fullName, description: t.description, riskTransferPoint: t.riskTransferPoint, transportMode: t.transportMode, status: t.status })
    setEditId(t.id); setFormErr(''); setShowForm(true)
  }
  const save = async () => {
    if (!form.code.trim())     { setFormErr('Code is required'); return }
    if (!form.fullName.trim()) { setFormErr('Full name is required'); return }
    setSaving(true); setFormErr('')
    try {
      editId != null ? await axios.put(`${API}/inco-terms/${editId}`, form) : await axios.post(`${API}/inco-terms`, form)
      setShowForm(false); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setFormErr(err.response?.data?.error ?? 'Save failed')
    } finally { setSaving(false) }
  }
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try { await axios.delete(`${API}/inco-terms/${id}`, { data: { reason } }); setDeleteTarget(null); load() }
    catch (e: unknown) { const err = e as { response?: { data?: { error?: string } } }; setDeleteErr(err.response?.data?.error ?? 'Delete failed') }
    finally { setDeleteSaving(false) }
  }
  const deactivate = async (id: number) => {
    setDeactivateSaving(true); setDeactivateErr('')
    try { await axios.patch(`${API}/inco-terms/${id}/status`, { status: 'inactive' }); setDeactivateTarget(null); load() }
    catch (e: unknown) { const err = e as { response?: { data?: { error?: string } } }; setDeactivateErr(err.response?.data?.error ?? 'Deactivate failed') }
    finally { setDeactivateSaving(false) }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code, name, mode…" style={{ ...inp(dark), width: 260 }} />
        <select value={filterSt} onChange={e => setFilterSt(e.target.value)} style={{ ...inp(dark), width: 120 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{rows.length} term{rows.length !== 1 ? 's' : ''}</span>
        <AddBtn onClick={openAdd} label="+ Add INCO Term" />
      </div>
      {error && <Err msg={error} />}
      <TableCard dark={dark}>
        <div ref={containerRef}>
          <TH dark={dark} grid={GRID}>
            <HeaderCell label="Code"              col="icode"   align="left" onResize={startResize} />
            <HeaderCell label="Full Name"         col="iname"   align="left" onResize={startResize} />
            <HeaderCell label="Description"       col="idesc"   align="left" onResize={startResize} />
            <HeaderCell label="Risk Transfer"     col="irisk"   align="left" onResize={startResize} />
            <HeaderCell label="Transport Mode"    col="imode"   align="left" onResize={startResize} />
            <HeaderCell label="Status"            col="istatus"              onResize={startResize} />
            <div />
          </TH>
          {rows.length === 0 && <Empty msg="No INCO terms found." />}
          {rows.map(t => (
            <TR key={t.id} dark={dark} grid={GRID}>
              <TD dark={dark} mono>{t.code}</TD>
              <TD dark={dark}><span title={t.fullName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{t.fullName}</span></TD>
              <TD dark={dark} muted><span title={t.description} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{t.description || '—'}</span></TD>
              <TD dark={dark} muted><span title={t.riskTransferPoint} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{t.riskTransferPoint || '—'}</span></TD>
              <TD dark={dark} muted>{t.transportMode || '—'}</TD>
              <div style={{ padding: '0 12px' }}>
                <StatusPill active={t.status === 'active'} label={t.status === 'active' ? 'Active' : 'Inactive'} />
              </div>
              <div style={{ padding: '0 8px', display: 'flex', gap: 4 }}>
                <button onClick={() => openEdit(t)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.08)', color: '#2563eb', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Edit</button>
                {t.status === 'active' && (
                  <button onClick={() => setDeactivateTarget(t)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(217,119,6,0.3)', background: 'rgba(217,119,6,0.08)', color: '#d97706', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Deactivate</button>
                )}
                <button onClick={() => setDeleteTarget(t)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Delete</button>
              </div>
            </TR>
          ))}
        </div>
      </TableCard>
      {showForm && (
        <Modal title={editId != null ? 'Edit INCO Term' : 'Add INCO Term'} dark={dark} onClose={() => setShowForm(false)} onSubmit={save} error={formErr} saving={saving}>
          <Field label="Code *"><input value={form.code} onChange={inf('code')} placeholder="e.g. FOB" style={inp(dark)} /></Field>
          <Field label="Status">
            <select value={form.status} onChange={inf('status')} style={inp(dark)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
          <Field label="Full Name *" wide>
            <input value={form.fullName} onChange={inf('fullName')} placeholder="e.g. Free On Board" style={inp(dark)} />
          </Field>
          <Field label="Transport Mode" wide>
            <select value={form.transportMode} onChange={inf('transportMode')} style={inp(dark)}>
              <option value="Any mode">Any mode</option>
              <option value="Sea and inland waterway">Sea and inland waterway</option>
              <option value="Air">Air</option>
              <option value="Road">Road</option>
              <option value="Rail">Rail</option>
            </select>
          </Field>
          <Field label="Risk Transfer Point" wide>
            <input value={form.riskTransferPoint} onChange={inf('riskTransferPoint')} placeholder="e.g. On board vessel at named port" style={inp(dark)} />
          </Field>
          <Field label="Description" wide>
            <input value={form.description} onChange={inf('description')} placeholder="Brief description of the term" style={inp(dark)} />
          </Field>
        </Modal>
      )}
      {deactivateTarget && (
        <SimpleConfirmModal dark={dark} title="Deactivate INCO Term"
          message={`Are you sure you want to deactivate "${deactivateTarget.code} — ${deactivateTarget.fullName}"? It will no longer appear in active lists.`}
          confirmLabel="Deactivate" confirmStyle="warning"
          onConfirm={() => deactivate(deactivateTarget.id)}
          onCancel={() => { setDeactivateTarget(null); setDeactivateErr('') }}
          saving={deactivateSaving} error={deactivateErr} />
      )}
      {deleteTarget && (
        <DeleteConfirmModal dark={dark} itemName={`${deleteTarget.code} — ${deleteTarget.fullName}`} itemType="INCO term"
          reasons={['Duplicate record', 'Created in error', 'No longer required', 'Superseded by updated standard', 'Other']}
          onConfirm={reason => del(deleteTarget.id, reason)}
          onCancel={() => { setDeleteTarget(null); setDeleteErr('') }}
          saving={deleteSaving} error={deleteErr} />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// ─── ADMIN ──────────────────────────────────────────────────
// Root admin page. Tab bar routes to the sub-sections.
// Only users with role='admin' reach this page (guarded both
// in App.tsx and on every /api/admin route server-side).
//
// Single-admin workflow: any admin can perform any user-management
// action immediately. Every mutation is logged to the audit trail.
// ═══════════════════════════════════════════════════════════
type AdminTab = 'users' | 'suppliers' | 'warehouses' | 'uom' | 'acronyms' | 'incoterms' | 'projects' | 'permissions' | 'notifications' | 'settings'

export function Admin({ dark }: { dark: boolean }) {
  const [tab, setTab] = useState<AdminTab>('users')

  const tabs: { key: AdminTab; label: string; icon: string }[] = [
    { key: 'users',         label: 'Users & Roles',      icon: '👤' },
    { key: 'suppliers',     label: 'Suppliers',          icon: '🏭' },
    { key: 'warehouses',    label: 'Warehouses',         icon: '🏗️' },
    { key: 'uom',           label: 'Units of Measure',   icon: '📏' },
    { key: 'acronyms',      label: 'Acronyms',           icon: '🔤' },
    { key: 'incoterms',     label: 'INCO Terms',         icon: '🚢' },
    { key: 'projects',      label: 'Projects',           icon: '📁' },
    { key: 'permissions',   label: 'Permission Matrix',  icon: '🔐' },
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
      {tab === 'users'         && <UsersTab          dark={dark} />}
      {tab === 'suppliers'     && <SuppliersTab      dark={dark} />}
      {tab === 'warehouses'    && <WarehousesTab     dark={dark} />}
      {tab === 'uom'           && <UomTab            dark={dark} />}
      {tab === 'acronyms'      && <AcronymsTab       dark={dark} />}
      {tab === 'incoterms'     && <IncoTermsTab      dark={dark} />}
      {tab === 'projects'      && <ProjectsAdminTab  dark={dark} />}
      {tab === 'permissions'   && <PermissionsTab    dark={dark} />}
      {tab === 'notifications' && <NotificationsTab  dark={dark} />}
      {tab === 'settings'      && <SystemSettingsTab dark={dark} />}
    </div>
  )
}
