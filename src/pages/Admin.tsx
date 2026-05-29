import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import { DeleteConfirmModal, SimpleConfirmModal } from '../components'
import { AdminTable, AdminRow, AdminCell, AdminActions } from '../components/AdminTable'
import { ToastProvider, useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/Toast'
import type { AdminCol } from '../components/AdminTable'
import { useColumnResize } from '../hooks/useColumnResize'
import { ActionMenu } from '../components/ActionMenu'
import type { ActionItem } from '../components/ActionMenu'
import { HelpModal } from '../components/HelpModal'
import type { HelpSection } from '../components/HelpModal'
import '../styles/admin.css'

const API = 'http://localhost:3001/api/admin'

// ─── ROLES AND MODULES ──────────────────────────────────────
// Single source of truth for all valid role and module names,
// used in selects, filters, and the permissions matrix.
const ALL_ROLES = [
  'admin', 'ceo', 'director', 'project_director', 'project_manager',
  'procurement_manager', 'procurement_officer',
  'expediting_manager', 'expeditor', 'logistics_manager',
  'warehouse', 'vendor', 'freight_forwarder', 'site_contractor', 'subcontractor', 'viewer',
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
  hasCustomPermissions: number
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

// ─── USERS COLUMN DEFINITIONS ───────────────────────────────
// Name and Email are split into two columns. Actions column
// (last) has noResize: true — no drag handle, always 300px.
const U_COLS: AdminCol[] = [
  { label: 'Name',           width: 180, minWidth: 160 },
  { label: 'Email',          width: 220, minWidth: 160, flex: true },
  { label: 'Role',           width: 165, minWidth: 160 },
  { label: 'Projects',       width: 210, minWidth: 200 },
  { label: 'Company',        width: 155, minWidth: 150 },
  { label: 'Phone',          width: 145, minWidth: 140 },
  { label: 'Contract Start', width: 135, minWidth: 130 },
  { label: 'Contract End',   width: 135, minWidth: 120 },
  { label: 'Status',         width: 105, minWidth: 100 },
  { label: 'Last Login',     width: 125, minWidth: 120 },
  { label: '',               width: 120, minWidth: 120, noResize: true },
]

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
// Shows up to 2 project code pills. "+N more" shows full list as
// a tooltip. Full-access roles show a single "All Projects" pill.
type ProjectRow = { id: number; code: string; name: string }

function ProjectsCell({ userId, count, fullAccess, dark }: {
  userId: number; count: number; fullAccess: boolean; dark: boolean
}) {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)

  // Load project codes lazily on mount for non-full-access users.
  useEffect(() => {
    if (fullAccess || count === 0) { setProjects([]); return }
    let cancelled = false
    axios.get(`${API}/users/${userId}/projects`)
      .then(({ data }) => { if (!cancelled) setProjects(data.projects ?? []) })
      .catch(() => { if (!cancelled) setProjects([]) })
    return () => { cancelled = true }
  }, [userId, fullAccess, count])

  // ─── TD STYLE ─────────────────────────────────────────────────
  // ProjectsCell is always used as a direct child of <AdminRow> (<tr>),
  // so it must render a <td> (not a <div>) to produce valid HTML.
  const tdStyle: React.CSSProperties = {
    padding: '0 12px', height: 44, boxSizing: 'border-box',
    verticalAlign: 'middle', overflow: 'hidden',
    borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
  }

  if (fullAccess) {
    return (
      <td style={tdStyle}>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', color: '#64748b', whiteSpace: 'nowrap' }}>
          All Projects
        </span>
      </td>
    )
  }

  if (count === 0) {
    return <td style={tdStyle}><span style={{ fontSize: 13, color: dark ? '#475569' : '#94a3b8' }}>—</span></td>
  }

  if (projects === null) {
    return <td style={tdStyle}><span style={{ fontSize: 12, color: '#64748b' }}>…</span></td>
  }

  const visible = projects.slice(0, 2)
  const hidden  = projects.slice(2)

  return (
    <td style={tdStyle}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', overflow: 'hidden', flexWrap: 'nowrap' }}>
        {visible.map(p => (
          <span key={p.id} title={p.name} style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, border: '1px solid rgba(232,78,15,0.35)', color: '#E84E0F', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {p.code}
          </span>
        ))}
        {hidden.length > 0 && (
          <span
            title={hidden.map(p => `${p.code} — ${p.name}`).join('\n')}
            style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', cursor: 'default', flexShrink: 0 }}>
            +{hidden.length} more
          </span>
        )}
      </div>
    </td>
  )
}

// ─── USERS TAB COMPONENT ────────────────────────────────────
// Manages all user operations. Single-admin workflow — no approval
// step required. onSave is optional for future parent callbacks.
function UsersTab({ dark, onSave }: { dark: boolean; onSave?: () => void }) {
  const { user: me } = useAuth()
  const { addToast } = useToast()
  const [rows,      setRows]      = useState<AdminUser[]>([])
  const [total,     setTotal]     = useState<number | null>(null)
  const [page,      setPage]      = useState(1)
  const [search,    setSearch]    = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [filterType, setFilterType] = useState('')
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

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (p = page, s = search) => {
    setError('')
    try {
      const params: Record<string, string> = { page: String(p), limit: '200' }
      if (filterRole) params.role   = filterRole
      if (s.trim())   params.search = s.trim()
      const { data } = await axios.get(`${API}/users`, { params })
      setRows(data.rows); setTotal(data.total)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setError(err.response?.data?.error ?? 'Failed to load users')
    }
  }, [page, filterRole, search])

  // ─── CLIENT-SIDE TYPE FILTER ──────────────────────────────────
  // Applied on top of already-loaded rows so no extra network call is needed.
  // Conditions match exactly what the DB flags represent:
  //   qco          → internal user with company = 'QCO Group'
  //   project_team → internal user with any other company (incl. null)
  //   external     → is_external = 1 (vendor / freight_forwarder / site_contractor)
  const filteredRows = useMemo(() => {
    if (!filterType) return rows
    if (filterType === 'qco')          return rows.filter(u => !u.isExternal && u.company === 'QCO Group')
    if (filterType === 'project_team') return rows.filter(u => !u.isExternal && u.company !== 'QCO Group')
    if (filterType === 'external')     return rows.filter(u => !!u.isExternal)
    return rows
  }, [rows, filterType])

  useEffect(() => { load() }, [load])

  const onSearch = (v: string) => {
    setSearch(v)
    if (searchRef.current) clearTimeout(searchRef.current)
    // Pass v directly to avoid stale closure capturing old search state
    searchRef.current = setTimeout(() => { setPage(1); load(1, v) }, 350)
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
      addToast('success', editId != null ? `User ${form.fullName} updated successfully` : `User ${form.fullName} created successfully`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: unknown }; message?: string }
      const d = err.response?.data
      const raw = (d && typeof d === 'object')
        ? ((d as Record<string, string>).error || (d as Record<string, string>).message || '')
        : (typeof d === 'string' ? (d as string).slice(0, 400) : '')
      const friendlyMsg = raw ? friendlyUserError(raw) : (err.message || 'Save failed — check the server console for details')
      setFormErr(friendlyMsg)
      addToast('error', friendlyMsg)
    } finally { setSaving(false) }
  }

  // ─── CONFIRM DEACTIVATE ──────────────────────────────────────
  // Soft action — disables the account while preserving all data and history.
  const confirmDeactivate = async () => {
    if (!deactivateTarget) return
    setDeactivateSaving(true); setDeactivateErr('')
    try {
      await axios.post(`${API}/users/${deactivateTarget.userId}/deactivate`, { reason: 'Manually deactivated by admin' })
      const name = deactivateTarget.fullName
      setDeactivateTarget(null); load(); onSave?.()
      addToast('warning', `User ${name} has been deactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Deactivation failed'
      setDeactivateErr(msg)
      addToast('error', msg)
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
      const name = deleteTarget.fullName
      setDeleteTarget(null); load(); onSave?.()
      addToast('success', `User ${name} has been deleted`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Delete failed'
      setDeleteErr(msg)
      addToast('error', msg)
    } finally { setDeleteSaving(false) }
  }

  // ─── CONFIRM REACTIVATE ──────────────────────────────────────
  // Re-enables a previously deactivated account. Uses SimpleConfirmModal.
  const confirmReactivate = async () => {
    if (!reactivateTarget) return
    setReactivateSaving(true); setReactivateErr('')
    try {
      await axios.post(`${API}/users/${reactivateTarget.userId}/activate`)
      const name = reactivateTarget.fullName
      setReactivateTarget(null); load(); onSave?.()
      addToast('success', `User ${name} has been reactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Reactivation failed'
      setReactivateErr(msg)
      addToast('error', msg)
    } finally { setReactivateSaving(false) }
  }

  // ─── CONFIRM RESET PASSWORD ──────────────────────────────────
  // Called after admin confirms in the ResetPasswordModal.
  const confirmResetPassword = async () => {
    if (!resetPwTarget) return
    setResetPwSaving(true); setResetPwErr('')
    try {
      await axios.post(`${API}/users/${resetPwTarget.userId}/reset-password`)
      const email = resetPwTarget.email
      setResetPwTarget(null)
      addToast('success', `Password reset email sent to ${email}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Reset failed'
      setResetPwErr(msg)
      addToast('error', msg)
    } finally { setResetPwSaving(false) }
  }

  const f = (k: keyof UserForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))

  return (
    <>
      {/* ─── FILTERS + TOOLBAR ──────────────────────────── */}
      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'nowrap' }}>
        <input
          value={search} onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name, email, company…"
          style={{ ...inp(dark), width: 220, height: 32 }}
        />
        <select value={filterRole} onChange={(e) => { setFilterRole(e.target.value); setPage(1) }} style={{ ...inp(dark), width: 180, height: 32 }}>
          <option value="">All roles</option>
          {ALL_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1) }} style={{ ...inp(dark), width: 150, height: 32 }}>
          <option value="">All users</option>
          <option value="qco">QCO Team</option>
          <option value="project_team">Project Team</option>
          <option value="external">External</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {total == null ? 'Loading…' : filterType ? `${filteredRows.length} of ${total} user${total !== 1 ? 's' : ''}` : `${total} user${total !== 1 ? 's' : ''}`}
        </span>
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
      <AdminTable tableId="admin_users" columns={U_COLS} dark={dark} empty="No users found.">
        {filteredRows.map(u => (
          <AdminRow key={u.id} dark={dark}>
            {/* ─── NAME ───────────────────────────────────── */}
            <td title={u.fullName} style={{
              padding: '0 12px', height: 44, overflow: 'hidden', boxSizing: 'border-box',
              borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}`,
              boxShadow: u.isExternal ? 'inset 3px 0 0 #E84E0F' : undefined,
              paddingLeft: u.isExternal ? 9 : 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: '100%' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: dark ? '#f1f5f9' : '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.fullName}</span>
                {u.staffId && <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>#{u.staffId}</span>}
              </div>
            </td>
            {/* ─── EMAIL ──────────────────────────────────── */}
            <AdminCell muted title={u.email}>{u.email}</AdminCell>
            {/* ─── ROLE (with Custom badge if overrides exist) */}
            <td style={{ padding: '0 12px', height: 44, boxSizing: 'border-box', verticalAlign: 'middle', borderBottom: `1px solid ${dark ? '#1e293b' : '#f1f5f9'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <RoleBadge role={u.role} />
                {!!u.hasCustomPermissions && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(232,78,15,0.12)', color: '#E84E0F', letterSpacing: '0.04em' }}>Custom</span>
                )}
              </div>
            </td>
            {/* ─── PROJECTS ───────────────────────────────── */}
            <ProjectsCell userId={u.id} count={u.projectCount ?? 0} fullAccess={FULL_ACCESS_ROLES.has(u.role)} dark={dark} />
            {/* ─── COMPANY / PHONE / DATES / STATUS / LAST LOGIN */}
            <AdminCell muted title={u.company || undefined}>{u.company || '—'}</AdminCell>
            <AdminCell muted mono title={u.phone || undefined}>{u.phone || '—'}</AdminCell>
            <AdminCell muted mono>{u.contractStart ? u.contractStart.slice(0, 10) : '—'}</AdminCell>
            <AdminCell mono>{(() => {
              if (!u.contractEnd) return <span style={{ color: '#94a3b8' }}>—</span>
              const d = new Date(u.contractEnd.slice(0, 10))
              const daysLeft = Math.ceil((d.getTime() - Date.now()) / 86400000)
              const color = daysLeft < 0 ? '#ef4444' : daysLeft <= 30 ? '#d97706' : '#22c55e'
              return <span style={{ color, fontWeight: daysLeft <= 30 ? 600 : 400 }}>{u.contractEnd.slice(0, 10)}</span>
            })()}</AdminCell>
            <AdminCell center><StatusPill active={!!u.isActive} /></AdminCell>
            <AdminCell muted mono>{u.lastLogin ? u.lastLogin.slice(0, 10) : 'Never'}</AdminCell>
            {/* ─── ROW ACTIONS ────────────────────────────── */}
            <AdminActions>
              <ActionMenu dark={dark} actions={[
                { label: 'Edit',           icon: '✏', onClick: () => openEdit(u) },
                { label: 'Reset Password', icon: '🔑', onClick: () => setResetPwTarget({ userId: u.id, email: u.email }), hidden: u.id === me?.id },
                { label: !!u.isActive ? 'Deactivate' : 'Reactivate', icon: '⊙',
                  variant: !!u.isActive ? 'warning' : 'default',
                  onClick: () => !!u.isActive
                    ? (setDeactivateTarget({ userId: u.id, fullName: u.fullName }), setDeactivateErr(''))
                    : (setReactivateTarget({ userId: u.id, fullName: u.fullName }), setReactivateErr('')),
                  hidden: u.id === me?.id },
                { label: 'Delete',         icon: '🗑', variant: 'danger', onClick: () => { setDeleteTarget({ userId: u.id, fullName: u.fullName }); setDeleteErr('') }, hidden: u.id === me?.id },
              ] satisfies ActionItem[]} />
            </AdminActions>
          </AdminRow>
        ))}
      </AdminTable>

      {/* ─── EXTERNAL LEGEND ──────────────────────────────── */}
      {filteredRows.some(u => u.isExternal) && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94a3b8' }}>
          <span style={{ display: 'inline-block', width: 18, height: 13, boxShadow: 'inset 3px 0 0 #E84E0F', flexShrink: 0 }} />
          External user (vendor / freight forwarder / site contractor / subcontractor)
        </div>
      )}

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
      {showHelp && (
        <HelpModal
          dark={dark}
          title="Users & Roles — Help"
          subtitle="Rules and guidelines for managing users in QCO Group MMS"
          onClose={() => setShowHelp(false)}
          sections={[
            {
              icon: '🏢', title: 'Creating Users',
              items: [
                'Full Name and Email are required. Email must be unique — it is the login identifier.',
                'Staff ID is optional but recommended when multiple staff share the same name.',
                'Any admin can create any user (internal or external) immediately — no second-admin approval required.',
                'A secure temporary password is auto-generated and emailed on account creation.',
                'The user must change their password on first login.',
                <>Passwords expire every <strong>90 days</strong> for internal users and <strong>30 days</strong> for external users.</>,
              ],
            },
            {
              icon: '🌐', title: 'External Users — Contractors, Vendors, Suppliers',
              items: [
                <>External users (vendor, freight forwarder, site contractor, subcontractor) are shown with an <strong>orange left border</strong> on their row. Internal users have no border.</>,
                'External users are activated immediately on creation — same workflow as internal users.',
                'Contract Start and End dates are strongly recommended for compliance tracking.',
                'Access is automatically revoked on the contract end date.',
                <>Warning notifications are sent at <strong>30, 14, 7 and 1 day(s)</strong> before expiry.</>,
                'After creation, assign the user to specific projects and WBS codes via the project settings.',
              ],
            },
            {
              icon: '🔍', title: 'User Type Filter',
              items: [
                <><strong>All users</strong> — shows everyone in the system.</>,
                <><strong>QCO Team</strong> — internal staff with company = QCO Group.</>,
                <><strong>Project Team</strong> — internal users not from QCO Group (client-side staff, secondees, etc.).</>,
                <><strong>External</strong> — vendors, freight forwarders, site contractors and subcontractors. These users have contract expiry dates and an orange left border on their row.</>,
                'The filter is applied client-side on top of any active role filter or search.',
              ],
            },
            {
              icon: '📋', title: 'Managing Users',
              items: [
                <><strong>Edit</strong> — update any field immediately. Contract end date can be extended at any time.</>,
                <><strong>Deactivate</strong> — disables login while preserving all data. Reversible with Reactivate.</>,
                <><strong>Reactivate</strong> — re-enables a deactivated account immediately.</>,
                <><strong>Reset Password</strong> — generates a new temp password and emails it. User must change it on next login.</>,
                <><strong>Delete</strong> — permanent. Requires selecting a reason and confirming. Cannot be undone.</>,
                'Every action is recorded in the audit trail with the acting admin\'s name and timestamp.',
                'You cannot deactivate or delete your own account. Email is always the unique identifier.',
              ],
            },
            {
              icon: '🔐', title: 'Column Reference',
              items: [
                <><strong>Name</strong> — full name. Orange left border = external user (vendor / freight forwarder / site contractor / subcontractor). No border = internal user.</>,
                <><strong>Email</strong> — unique login identifier.</>,
                <><strong>Role</strong> — assigned system role. Custom badge = has per-module permission overrides.</>,
                <><strong>Projects</strong> — project codes the user can access. Full-access roles see "All Projects".</>,
                <><strong>Contract End</strong> — colour coded: <span style={{ color: '#ef4444' }}>Red = expired</span>, <span style={{ color: '#d97706' }}>Amber = expiring within 30 days</span>, <span style={{ color: '#22c55e' }}>Green = more than 30 days remaining</span>, Grey dash = no expiry date (permanent internal staff).</>,
                <><strong>Status</strong> — Active (can log in) or Inactive (account disabled).</>,
                <><strong>Last Login</strong> — most recent successful login timestamp.</>,
              ],
            },
          ] satisfies HelpSection[]}
        />
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

// ─── OVERVIEW DRAG HANDLE ───────────────────────────────────────
// Mirrors AdminTable's DragHandle for use in AllRolesOverview.
function OvDragHandle({ onMouseDown, dark }: { onMouseDown: (e: React.MouseEvent) => void; dark: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <>
      <div style={{ position: 'absolute', right: 0, top: 0, width: 1, height: '100%', background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', pointerEvents: 'none' }} />
      <div
        onMouseDown={onMouseDown}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{ position: 'absolute', right: 0, top: 0, width: 6, height: '100%', cursor: 'col-resize', background: hov ? '#E84E0F' : 'transparent', opacity: hov ? 0.6 : 1, transition: 'background 150ms', zIndex: 1 }}
      />
    </>
  )
}

// ─── ALL ROLES OVERVIEW ──────────────────────────────────────────
// Resizable-column table (same overflow:clip pattern as AdminTable)
// showing all roles × modules as colour dots. Sticky thead sticks
// relative to main content scroll container. 4-char column headers
// with full module name in title tooltip.
function AllRolesOverview({ dark, perms, top }: { dark: boolean; perms: RolePerm[]; top: string | number }) {
  const ovDefaults = useMemo(() => [150, ...ALL_MODULES.map(() => 52)], [])
  const ovMins     = useMemo(() => [100, ...ALL_MODULES.map(() => 40)], [])
  const { widths, onMouseDown: ovDown, resetWidths: ovReset } = useColumnResize(
    'admin_perm_overview', ovDefaults, ovMins
  )

  const lookup = useMemo(() => perms.reduce<Record<string, Record<string, RolePerm>>>((acc, p) => {
    acc[p.role] = acc[p.role] ?? {}
    acc[p.role][p.module] = p
    return acc
  }, {}), [perms])

  const headerBg  = dark ? '#0f172a' : '#f4f7fb'
  const borderCol = dark ? '#334155' : '#dde3ed'
  const rowBorder = dark ? '#1e293b' : '#f1f5f9'
  const minTableW = ovMins.reduce((a, b) => a + b, 0)

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: dark ? '#94a3b8' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
          All Roles Overview
        </h3>
        <button
          onClick={ovReset}
          title="Reset column widths"
          style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#E84E0F'; e.currentTarget.style.borderColor = 'rgba(232,78,15,0.4)' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = dark ? '#334155' : '#dde3ed' }}
        >↺</button>
      </div>
      <div style={{
        background: dark ? '#1e293b' : '#fff',
        border: `1px solid ${borderCol}`,
        borderRadius: 10,
        overflow: 'clip',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <table style={{ width: '100%', minWidth: minTableW, borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
          <colgroup>
            {widths[0] === ovDefaults[0] ? <col /> : <col style={{ width: widths[0] }} />}
            {ALL_MODULES.map((_, i) => <col key={i} style={{ width: widths[i + 1] }} />)}
          </colgroup>
          <thead style={{ position: 'sticky', top, zIndex: 10, background: headerBg }}>
            <tr>
              <th style={{ height: 36, padding: '0 12px', fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'IBM Plex Sans, sans-serif', textAlign: 'left', position: 'relative', overflow: 'hidden', whiteSpace: 'nowrap', boxSizing: 'border-box', borderBottom: `1px solid ${borderCol}` }}>
                ROLE
                <OvDragHandle dark={dark} onMouseDown={e => ovDown(0, e)} />
              </th>
              {ALL_MODULES.map((m, i) => (
                <th key={m} title={m.replace(/_/g, ' ')} style={{ height: 36, padding: '0 4px', fontSize: 9, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'IBM Plex Sans, sans-serif', textAlign: 'center', position: 'relative', overflow: 'hidden', whiteSpace: 'nowrap', boxSizing: 'border-box', borderBottom: `1px solid ${borderCol}` }}>
                  {m.replace(/_/g, ' ').slice(0, 4)}
                  <OvDragHandle dark={dark} onMouseDown={e => ovDown(i + 1, e)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_ROLES.map(role => (
              <tr key={role}>
                <td style={{ padding: '0 12px', height: 38, fontSize: 12, color: dark ? '#f1f5f9' : '#0f172a', borderBottom: `1px solid ${rowBorder}`, fontFamily: 'IBM Plex Sans, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', boxSizing: 'border-box' }}>
                  {role.replace(/_/g, ' ')}
                </td>
                {ALL_MODULES.map(mod => {
                  const p = lookup[role]?.[mod]
                  const grants: string[] = []
                  if (p?.can_view)    grants.push('View')
                  if (p?.can_create)  grants.push('Create')
                  if (p?.can_edit)    grants.push('Edit')
                  if (p?.can_approve) grants.push('Approve')
                  if (p?.can_delete)  grants.push('Delete')
                  if (p?.wbs_scoped)  grants.push('WBS scoped')
                  return (
                    <td key={mod} title={grants.length > 0 ? grants.join(', ') : 'No access'} style={{ textAlign: 'center', height: 38, borderBottom: `1px solid ${rowBorder}`, boxSizing: 'border-box' }}>
                      <div style={{ display: 'flex', gap: 1, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', padding: '0 3px' }}>
                        {grants.length > 0
                          ? grants.map((_, j) => <span key={j} style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', flexShrink: 0 }} />)
                          : <span style={{ color: '#475569', fontSize: 11 }}>—</span>}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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

// ─── USER OVERRIDE STATE ─────────────────────────────────────
// Each module/key cell is one of: inherit (use role default),
// grant (force allow), restrict (force deny).
type OverrideVal = 'inherit' | 'grant' | 'restrict'

// ─── PERMISSION MATRIX COLUMN DEFINITIONS ───────────────────
// Module column is flex so it fills all remaining width.
// Permission columns are fixed — just wide enough for the checkbox/toggle.
const PERM_MATRIX_COLS: AdminCol[] = [
  { label: 'Module',     flex: true, width: 180, minWidth: 120 },
  { label: 'View',       width: 72, minWidth: 60, noResize: true },
  { label: 'Create',     width: 72, minWidth: 60, noResize: true },
  { label: 'Edit',       width: 72, minWidth: 60, noResize: true },
  { label: 'Approve',    width: 80, minWidth: 60, noResize: true },
  { label: 'Delete',     width: 72, minWidth: 60, noResize: true },
  { label: 'WBS Scoped', width: 90, minWidth: 70, noResize: true },
]

function PermissionsTab({ dark }: { dark: boolean }) {
  const { addToast } = useToast()
  // ─── MODE TOGGLE ──────────────────────────────────────────────
  const [permMode, setPermMode] = useState<'roles' | 'users'>('roles')

  const [perms,    setPerms]    = useState<RolePerm[]>([])
  const [selRole,  setSelRole]  = useState<string>('procurement_officer')
  const [editing,  setEditing]  = useState<Record<string, Record<PermKey, boolean>>>({})
  const [saving,           setSaving]           = useState(false)
  const [error,            setError]            = useState('')
  const [resetRoleOpen,    setResetRoleOpen]    = useState(false)
  const [resetRoleSaving,  setResetRoleSaving]  = useState(false)

  // ─── USER OVERRIDES STATE ─────────────────────────────────────
  const [usersList,       setUsersList]       = useState<{ id: number; fullName: string; role: string }[]>([])
  const [selUserId,       setSelUserId]       = useState<number | null>(null)
  const [userRole,        setUserRole]        = useState<string>('')
  // rolePerms removed — base dots now derived from global lookup via selUserRole
  const [userOverrides,   setUserOverrides]   = useState<Record<string, Record<PermKey, OverrideVal>>>({})
  const [overrideSaving,  setOverrideSaving]  = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetSaving,     setResetSaving]     = useState(false)
  const [stickyH,         setStickyH]         = useState(0)
  const stickyRef = useRef<HTMLDivElement>(null)

  // Measure sticky header height so AdminTable thead can stick below it
  useEffect(() => {
    const el = stickyRef.current
    if (!el) return
    setStickyH(el.offsetHeight)
    const ro = new ResizeObserver(() => setStickyH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [permMode])

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

  // ─── LOAD USERS FOR DROPDOWN ──────────────────────────────────
  useEffect(() => {
    if (permMode !== 'users') return
    axios.get(`${API}/users`, { params: { limit: '500' } })
      .then(({ data }) => setUsersList(data.rows ?? []))
      .catch(() => {})
  }, [permMode])

  // ─── LOAD USER OVERRIDES ──────────────────────────────────────
  // Fetches only the user's existing overrides — base role dots come from
  // the global perms lookup (already loaded) via selUserRole, no second call needed.
  const loadUserOverrides = useCallback(async (userId: number) => {
    try {
      const { data } = await axios.get(`${API}/permissions/user/${userId}`)
      setUserRole(data.user?.role ?? '')
      const ovr: Record<string, Record<PermKey, OverrideVal>> = {}
      for (const o of data.overrides ?? []) {
        ovr[o.module] = {} as Record<PermKey, OverrideVal>
        for (const k of PERM_KEYS) {
          const v = o[k]
          ovr[o.module][k] = v === 1 ? 'grant' : v === -1 ? 'restrict' : 'inherit'
        }
      }
      setUserOverrides(ovr)
    } catch (e) {
      console.error('[loadUserOverrides] failed:', e)
    }
  }, [])

  useEffect(() => {
    if (selUserId != null) loadUserOverrides(selUserId)
  }, [selUserId, loadUserOverrides])

  // ─── CYCLE OVERRIDE ───────────────────────────────────────────
  // inherit → grant → restrict → inherit (admin users skip restrict)
  const cycleOverride = (module: string, key: PermKey) => {
    setUserOverrides(prev => {
      const cur = prev[module]?.[key] ?? 'inherit'
      const isAdminUser = selUserRole === 'admin'
      const next: OverrideVal = cur === 'inherit' ? 'grant' : cur === 'grant' ? (isAdminUser ? 'inherit' : 'restrict') : 'inherit'
      return { ...prev, [module]: { ...(prev[module] ?? {} as Record<PermKey, OverrideVal>), [key]: next } }
    })
  }

  // ─── SAVE USER OVERRIDES ──────────────────────────────────────
  const saveUserOverrides = async () => {
    if (!selUserId) return
    setOverrideSaving(true)
    const overrides = ALL_MODULES.flatMap(mod => {
      const row = userOverrides[mod]
      if (!row) return []
      const hasAny = PERM_KEYS.some(k => (row[k] ?? 'inherit') !== 'inherit')
      if (!hasAny) return [{ module: mod, remove: true }]
      const entry: Record<string, unknown> = { module: mod }
      for (const k of PERM_KEYS) {
        const v = row[k] ?? 'inherit'
        entry[k] = v === 'grant' ? 1 : v === 'restrict' ? -1 : 0
      }
      return [entry]
    })
    try {
      await axios.post(`${API}/permissions/user/${selUserId}`, { overrides })
      const uName = usersList.find(u => u.id === selUserId)?.fullName ?? 'user'
      addToast('success', `Permissions updated for ${uName}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Save failed')
    } finally { setOverrideSaving(false) }
  }

  // ─── RESET TO ROLE DEFAULTS ───────────────────────────────────
  const resetToRoleDefaults = async () => {
    if (!selUserId) return
    setResetSaving(true)
    try {
      await axios.delete(`${API}/permissions/user/${selUserId}`)
      setUserOverrides({})
      setResetConfirmOpen(false)
      const uName = usersList.find(u => u.id === selUserId)?.fullName ?? 'user'
      addToast('success', `Permissions reset to role defaults for ${uName}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setResetConfirmOpen(false)
      addToast('error', err.response?.data?.error ?? 'Reset failed')
    } finally { setResetSaving(false) }
  }

  const overrideCount = ALL_MODULES.reduce((n, mod) => {
    const row = userOverrides[mod]
    if (!row) return n
    return n + PERM_KEYS.filter(k => (row[k] ?? 'inherit') !== 'inherit').length
  }, 0)

  // Build lookup: perms[role][module] = { can_view, … } — used by roles mode
  const lookup = perms.reduce<Record<string, Record<string, RolePerm>>>((acc, p) => {
    acc[p.role] = acc[p.role] ?? {}
    acc[p.role][p.module] = p
    return acc
  }, {})

  // Derive selected user's role synchronously from usersList — no async timing issues.
  // Falls back to userRole (from API) in case usersList entry is somehow missing.
  const selUserRole = useMemo(
    () => usersList.find(u => u.id === selUserId)?.role ?? userRole,
    [usersList, selUserId, userRole]
  )
  // Base permissions for selected user — sourced directly from global lookup (already loaded).
  // admin role is handled separately in render (synthesised full access).
  const effectiveRolePermsLookup = useMemo(
    () => lookup[selUserRole] ?? {},
    [lookup, selUserRole]
  )

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
    setSaving(true); setError('')
    const modules = Object.keys(editing)
    try {
      for (const module of modules) {
        const payload: Record<string, boolean> = {}
        PERM_KEYS.forEach(k => { payload[k] = getVal(module, k) })
        await axios.put(`${API}/permissions/${selRole}/${module}`, payload)
      }
      setEditing({})
      load()
      addToast('success', `Role permissions updated for ${selRole.replace(/_/g, ' ')}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Save failed'
      setError(msg)
      addToast('error', msg)
    } finally { setSaving(false) }
  }

  // ─── RESET ROLE TO DEFAULTS ──────────────────────────────────
  const resetRoleDefaults = async () => {
    setResetRoleSaving(true)
    try {
      await axios.delete(`${API}/permissions/role/${selRole}`)
      setEditing({})
      load()
      setResetRoleOpen(false)
      addToast('success', `Permissions for ${selRole.replace(/_/g, ' ')} reset to defaults`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      setResetRoleOpen(false)
      addToast('error', err.response?.data?.error ?? 'Reset failed')
    } finally { setResetRoleSaving(false) }
  }

  const isDirty = Object.keys(editing).length > 0
  const isAdmin = selRole === 'admin'

  return (
    <div>
      {/* ─── STICKY HEADER (mode toggle + selector) ──────── */}
      <div ref={stickyRef} style={{ position: 'sticky', top: 'var(--admin-header-height)', zIndex: 20, background: dark ? '#0f172a' : '#f1f4f8', paddingBottom: 12 }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['roles', 'users'] as const).map(m => (
            <button key={m} onClick={() => setPermMode(m)} style={{ padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: permMode === m ? 600 : 400, border: `1px solid ${permMode === m ? '#E84E0F' : (dark ? '#334155' : '#dde3ed')}`, background: permMode === m ? 'rgba(232,78,15,0.1)' : 'transparent', color: permMode === m ? '#E84E0F' : '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
              {m === 'roles' ? 'Role Permissions' : 'User Overrides'}
            </button>
          ))}
        </div>
        {/* ─── ROLE SELECTOR ───────────────────────────────── */}
        {permMode === 'roles' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>Role:</label>
            <select value={selRole} onChange={(e) => { setSelRole(e.target.value); setEditing({}) }} style={{ ...inp(dark), width: 220, height: 34 }}>
              {ALL_ROLES.filter(r => r !== 'admin').map(r => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </select>
            {!isAdmin && (
              <button onClick={saveRole} disabled={saving || !isDirty} style={{ padding: '7px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: (saving || !isDirty) ? 'not-allowed' : 'pointer', opacity: (saving || !isDirty) ? 0.45 : 1, fontFamily: 'IBM Plex Sans, sans-serif' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            {!isAdmin && (
              <button onClick={() => setResetRoleOpen(true)} disabled={resetRoleSaving} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: resetRoleSaving ? 'not-allowed' : 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                Reset to defaults
              </button>
            )}
            {isDirty && (
              <button onClick={() => setEditing({})} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                Discard
              </button>
            )}
          </div>
        )}
        {/* ─── USER SELECTOR ───────────────────────────────── */}
        {permMode === 'users' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>User:</label>
            <select
              value={selUserId ?? ''}
              onChange={e => { setSelUserId(e.target.value ? Number(e.target.value) : null); setUserOverrides({}) }}
              style={{ ...inp(dark), width: 280, height: 34 }}>
              <option value="">— Select a user —</option>
              {usersList.map(u => (
                <option key={u.id} value={u.id}>{u.fullName} ({u.role.replace(/_/g, ' ')})</option>
              ))}
            </select>
            {selUserId != null && overrideCount > 0 && (
              <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 9999, background: 'rgba(232,78,15,0.1)', color: '#E84E0F', fontWeight: 600 }}>
                {overrideCount} override{overrideCount !== 1 ? 's' : ''}
              </span>
            )}
            {selUserId != null && (
              <button onClick={saveUserOverrides} disabled={overrideSaving} style={{ padding: '7px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: overrideSaving ? 'not-allowed' : 'pointer', opacity: overrideSaving ? 0.7 : 1, fontFamily: 'IBM Plex Sans, sans-serif' }}>
                {overrideSaving ? 'Saving…' : 'Save overrides'}
              </button>
            )}
            {selUserId != null && (
              <button onClick={() => setResetConfirmOpen(true)} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
                Reset to role defaults
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── ROLES MODE CONTENT ───────────────────────────── */}
      {permMode === 'roles' && (<>
        {error && <Err msg={error} />}
        {isAdmin && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: 'rgba(232,78,15,0.06)', border: '1px solid rgba(232,78,15,0.2)', fontSize: 12, color: '#E84E0F' }}>
            Admin role has full access to everything and cannot be modified.
          </div>
        )}
        {/* ─── PERMISSION GRID ──────────────────────────── */}
        <AdminTable tableId="admin_perm_roles" columns={PERM_MATRIX_COLS} dark={dark} top={`calc(var(--admin-header-height) + ${stickyH}px)`}>
          {ALL_MODULES.map(mod => (
            <AdminRow key={mod} dark={dark}>
              <AdminCell title={mod.replace(/_/g, ' ')}>{mod.replace(/_/g, ' ')}</AdminCell>
              {PERM_KEYS.map(key => (
                <AdminCell key={key} center>
                  <input
                    type="checkbox"
                    checked={isAdmin ? true : getVal(mod, key)}
                    disabled={isAdmin}
                    onChange={() => !isAdmin && toggle(mod, key)}
                    style={{ width: 16, height: 16, accentColor: '#E84E0F', cursor: isAdmin ? 'not-allowed' : 'pointer' }}
                  />
                </AdminCell>
              ))}
            </AdminRow>
          ))}
        </AdminTable>
        {/* ─── ROLE SUMMARY (all roles overview) ───────── */}
        <AllRolesOverview dark={dark} perms={perms} top={`calc(var(--admin-header-height) + ${stickyH}px)`} />
        {/* ─── RESET ROLE CONFIRM ───────────────────────── */}
        {resetRoleOpen && (
          <SimpleConfirmModal
            dark={dark}
            title="Reset to Defaults"
            message={`Reset all permissions for "${selRole.replace(/_/g, ' ')}" to system defaults? This cannot be undone.`}
            confirmLabel="Reset"
            confirmStyle="warning"
            onConfirm={resetRoleDefaults}
            onCancel={() => setResetRoleOpen(false)}
            saving={resetRoleSaving}
          />
        )}
      </>)}

      {/* ─── USER OVERRIDES MODE CONTENT ─────────────────── */}
      {permMode === 'users' && (
        <div>

          {selUserId == null ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 13, color: '#64748b' }}>
              Select a user above to view and edit their permission overrides.
            </div>
          ) : (<>
            {selUserRole && (
              <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 6, background: dark ? 'rgba(37,99,235,0.08)' : 'rgba(37,99,235,0.05)', border: `1px solid ${dark ? 'rgba(37,99,235,0.2)' : 'rgba(37,99,235,0.15)'}`, fontSize: 12, color: '#2563eb' }}>
                Base role: <strong>{selUserRole.replace(/_/g, ' ')}</strong>
                {selUserRole === 'admin' && ' — admin users can only be granted permissions, not restricted'}
              </div>
            )}
            {/* ─── OVERRIDE MATRIX ────────────────────── */}
            <AdminTable tableId="admin_perm_users" columns={PERM_MATRIX_COLS} dark={dark} top={`calc(var(--admin-header-height) + ${stickyH}px)`}>
              {ALL_MODULES.map(mod => {
                const basePerm = effectiveRolePermsLookup[mod] as RolePerm | undefined
                return (
                  <AdminRow key={mod} dark={dark}>
                    <AdminCell title={mod.replace(/_/g, ' ')}>{mod.replace(/_/g, ' ')}</AdminCell>
                    {PERM_KEYS.map(key => {
                      // admin role always has full access; for others read from global lookup
                      const baseVal = selUserRole === 'admin' ? (key !== 'wbs_scoped') : !!(basePerm?.[key] ?? 0)
                      const ovr = userOverrides[mod]?.[key] ?? 'inherit'
                      return (
                        <AdminCell key={key} center>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                            {/* base role indicator — larger dot */}
                            <span title={`Role ${selUserRole}: ${baseVal ? 'has' : 'no'} ${key}`} style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: baseVal ? 'rgba(34,197,94,0.5)' : 'rgba(100,116,139,0.2)' }} />
                            {/* override toggle */}
                            <button
                              onClick={() => cycleOverride(mod, key)}
                              title={`Override: ${ovr}. Click to cycle.`}
                              style={{
                                width: 22, height: 22, borderRadius: 4, cursor: 'pointer',
                                border: ovr === 'inherit' ? `1px solid ${dark ? '#334155' : '#dde3ed'}` : 'none',
                                background: ovr === 'grant' ? 'rgba(34,197,94,0.15)' : ovr === 'restrict' ? 'rgba(239,68,68,0.15)' : 'transparent',
                                color: ovr === 'grant' ? '#22c55e' : ovr === 'restrict' ? '#ef4444' : '#64748b',
                                fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                              {ovr === 'grant' ? '✓' : ovr === 'restrict' ? '✕' : '—'}
                            </button>
                          </div>
                        </AdminCell>
                      )
                    })}
                  </AdminRow>
                )
              })}
            </AdminTable>
            {/* ─── LEGEND ─────────────────────────────── */}
            <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: '#64748b' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgba(34,197,94,0.5)', display: 'inline-block', flexShrink: 0 }} />
                Role has permission
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgba(100,116,139,0.2)', display: 'inline-block', flexShrink: 0 }} />
                Role does not have permission
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(34,197,94,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#22c55e', fontWeight: 700, flexShrink: 0 }}>✓</span>
                Override: grant
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(239,68,68,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#ef4444', fontWeight: 700, flexShrink: 0 }}>✕</span>
                Override: restrict
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 20, height: 20, borderRadius: 4, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#64748b', fontWeight: 700, flexShrink: 0 }}>—</span>
                Inheriting from role
              </span>
            </div>
          </>)}

          {/* ─── RESET CONFIRM MODAL ───────────────────── */}
          {resetConfirmOpen && selUserId != null && (() => {
            const u = usersList.find(x => x.id === selUserId)
            return (
              <SimpleConfirmModal
                dark={dark}
                title="Reset to Role Defaults"
                message={`This will remove all custom permission overrides for ${u?.fullName ?? 'this user'} and revert them to their role defaults. Are you sure?`}
                confirmLabel="Reset overrides"
                confirmStyle="warning"
                onConfirm={resetToRoleDefaults}
                onCancel={() => setResetConfirmOpen(false)}
                saving={resetSaving}
                error=""
              />
            )
          })()}
        </div>
      )}
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
// ─── NOTIFICATIONS COLUMN DEFINITIONS ───────────────────────
const N_COLS: AdminCol[] = [
  { label: 'User',    width: 180, minWidth: 100 },
  { label: 'Type',    width: 130, minWidth: 80  },
  { label: 'Message', width: 400, minWidth: 150, flex: true },
  { label: 'Date',    width: 120, minWidth: 80  },
  { label: '',        width: 90,  minWidth: 90, noResize: true },
]

function NotificationsTab({ dark }: { dark: boolean }) {
  const { addToast } = useToast()
  const [rows,     setRows]     = useState<Notification[]>([])
  const [total,    setTotal]    = useState<number | null>(null)
  const [page,     setPage]     = useState(1)
  const [filter,   setFilter]   = useState<'all' | 'unread'>('all')
  const [error,    setError]    = useState('')
  const [showHelp, setShowHelp] = useState(false)

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
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Failed to mark notification as read')
    }
  }

  const markAllRead = async () => {
    try {
      await axios.put(`${API}/notifications/read-all`)
      load(page)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Failed to mark all as read')
    }
  }

  const deleteNotification = async (id: number) => {
    try {
      await axios.delete(`${API}/notifications/${id}`)
      load(page)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Failed to delete notification')
    }
  }

  const TYPE_COLOR: Record<string, string> = {
    contract_expiry: '#f59e0b',
    contract_expired: '#ef4444',
  }

  return (
    <>
      {/* ─── FILTERS + TOOLBAR ──────────────────────────── */}
      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
        <button onClick={() => setShowHelp(true)} title="Notifications help" style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>ℹ</button>
      </div>

      {error && <Err msg={error} />}

      {/* ─── TABLE ──────────────────────────────────────── */}
      <AdminTable tableId="admin_notifications" columns={N_COLS} dark={dark} empty="No notifications.">
        {rows.map(n => (
          <AdminRow key={n.id} dark={dark}>
            <AdminCell><span title={n.userEmail}>{n.userName}</span></AdminCell>
            <AdminCell>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 9999, background: `${TYPE_COLOR[n.type] ?? '#94a3b8'}22`, color: TYPE_COLOR[n.type] ?? '#94a3b8', whiteSpace: 'nowrap' }}>
                {n.type.replace(/_/g, ' ')}
              </span>
            </AdminCell>
            <AdminCell muted>
              <span title={n.message} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: n.isRead ? 0.6 : 1, fontWeight: n.isRead ? 400 : 500 }}>
                {n.message}
              </span>
            </AdminCell>
            <AdminCell muted mono>{n.createdAt?.slice(0, 10) ?? '—'}</AdminCell>
            <AdminActions>
              <ActionMenu dark={dark} actions={[
                { label: 'Mark as read', icon: '✓', onClick: () => markRead(n.id), hidden: !!n.isRead },
                { label: 'Delete',       icon: '🗑', variant: 'danger', onClick: () => deleteNotification(n.id) },
              ] satisfies ActionItem[]} />
            </AdminActions>
          </AdminRow>
        ))}
      </AdminTable>

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

      {/* ─── HELP MODAL ──────────────────────────────────── */}
      {showHelp && (
        <HelpModal dark={dark} title="Notifications — Help" subtitle="System notification log" onClose={() => setShowHelp(false)} sections={[
          { icon: '🔔', title: 'What this tab is for', items: ['Shows all system-generated notifications including contract expiry warnings, security alerts, and admin actions.'] },
          { icon: '📋', title: 'Column Reference', items: [<><strong>User</strong> — the user the notification is about. Hover for email.</>, <><strong>Type</strong> — notification category (contract_expiry, contract_expired, etc.).</>, <><strong>Message</strong> — full notification text.</>, <><strong>Date</strong> — when the notification was generated.</> ] },
          { icon: '⚙️', title: 'Actions', items: [<><strong>✓ Read</strong> — marks a single notification as read.</>, <><strong>Mark all read</strong> — clears all unread notifications at once.</>, <><strong>Unread filter</strong> — toggle to show only unread notifications.</> ] },
        ] satisfies HelpSection[]} />
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
  const { addToast } = useToast()
  // ─── LOCAL STATE ─────────────────────────────────────────────
  // Each editable setting is held in a single Record so adding
  // new settings only requires updating SETTINGS_META above.
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [saving,   setSaving]   = useState(false)
  const [testing,  setTesting]  = useState(false)

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
    setSaving(true)
    try {
      await axios.put(`${API}/system-settings`, settings)
      addToast('success', 'System settings saved successfully')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Save failed')
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
    setTesting(true)
    try {
      const { data } = await axios.post(`${API}/test-email`)
      addToast('success', `Test email sent to ${data.sentTo}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Email test failed')
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
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={saveAll} disabled={saving} style={{ padding: '8px 22px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', background: '#E84E0F', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, fontFamily: 'IBM Plex Sans, sans-serif' }}>
            {saving ? 'Saving…' : 'Save Settings'}
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
// ─── SUPPLIER ADDRESS TYPE ───────────────────────────────────
type SupplierAddress = {
  id?: number
  label: string; address_line1: string; address_line2: string
  city: string; state: string; postcode: string; country: string
  is_primary: boolean; is_pickup: boolean; notes: string
}
const EMPTY_ADDR: SupplierAddress = {
  label: 'Main', address_line1: '', address_line2: '',
  city: '', state: '', postcode: '', country: '',
  is_primary: true, is_pickup: false, notes: '',
}

type Supplier = {
  id: number; name: string; code: string; country: string
  contactName: string; email: string; phone: string; status: string
  addressCount?: number; primaryAddressText?: string
}
type SupplierForm = {
  name: string; code: string; country: string; contactName: string
  email: string; phone: string; status: string
  addresses: SupplierAddress[]
}
const EMPTY_SUP: SupplierForm = {
  name: '', code: '', country: '', contactName: '', email: '', phone: '', status: 'active',
  addresses: [{ ...EMPTY_ADDR }],
}

// ─── SUPPLIERS COLUMN DEFINITIONS ───────────────────────────
const S_COLS: AdminCol[] = [
  { label: 'Name',      width: 200, minWidth: 120, flex: true },
  { label: 'Code',      width: 100, minWidth: 70  },
  { label: 'Country',   width: 110, minWidth: 80  },
  { label: 'Contact',   width: 150, minWidth: 100 },
  { label: 'Email',     width: 190, minWidth: 130 },
  { label: 'Phone',     width: 130, minWidth: 90  },
  { label: 'Addresses', width: 130, minWidth: 80  },
  { label: 'Status',    width: 90,  minWidth: 70  },
  { label: '',          width: 90,  minWidth: 90,  noResize: true },
]

function SuppliersTab({ dark }: { dark: boolean }) {
  const { addToast } = useToast()
  const [rows,           setRows]           = useState<Supplier[]>([])
  const [total,          setTotal]          = useState<number | null>(null)
  const [search,         setSearch]         = useState('')
  const [filterSt,       setFilterSt]       = useState('')
  const [filterCountry,  setFilterCountry]  = useState('')
  const [error,          setError]          = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
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

  // ─── CLIENT-SIDE FILTER ──────────────────────────────────────
  const countries = useMemo(() => {
    const set = new Set(rows.map(s => s.country).filter(Boolean))
    return [...set].sort() as string[]
  }, [rows])

  const filtered = rows.filter(s => {
    if (filterSt      && s.status  !== filterSt)      return false
    if (filterCountry && s.country !== filterCountry)  return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return s.name.toLowerCase().includes(q) || (s.code || '').toLowerCase().includes(q) || (s.country || '').toLowerCase().includes(q)
    }
    return true
  })

  const openAdd  = () => { setForm({ ...EMPTY_SUP, addresses: [{ ...EMPTY_ADDR }] }); setEditId(null); setFormErr(''); setShowForm(true) }
  const openEdit = async (s: Supplier) => {
    // Fetch full supplier with addresses for the edit modal
    try {
      const { data } = await axios.get(`${API}/suppliers/${s.id}`)
      const addrs: SupplierAddress[] = (data.addresses ?? []).map((a: SupplierAddress) => ({
        id: a.id, label: a.label || 'Main',
        address_line1: a.address_line1 || '', address_line2: a.address_line2 || '',
        city: a.city || '', state: a.state || '', postcode: a.postcode || '',
        country: a.country || '',
        is_primary: !!a.is_primary, is_pickup: !!a.is_pickup, notes: a.notes || '',
      }))
      setForm({
        name: s.name, code: s.code, country: s.country, contactName: s.contactName,
        email: s.email, phone: s.phone, status: s.status,
        addresses: addrs.length ? addrs : [{ ...EMPTY_ADDR }],
      })
    } catch {
      setForm({
        name: s.name, code: s.code, country: s.country, contactName: s.contactName,
        email: s.email, phone: s.phone, status: s.status, addresses: [{ ...EMPTY_ADDR }],
      })
    }
    setEditId(s.id); setFormErr(''); setShowForm(true)
  }

  // ─── ADDRESS HELPERS ──────────────────────────────────────────
  const addAddress = () => setForm(p => ({
    ...p,
    addresses: [...p.addresses, { ...EMPTY_ADDR, is_primary: false }],
  }))
  const removeAddress = (i: number) => setForm(p => ({
    ...p,
    addresses: p.addresses.filter((_, idx) => idx !== i),
  }))
  const updateAddress = (i: number, key: keyof SupplierAddress, val: string | boolean) =>
    setForm(p => {
      const addrs = [...p.addresses]
      // Enforce single primary
      if (key === 'is_primary' && val === true) {
        addrs.forEach((a, idx) => { addrs[idx] = { ...a, is_primary: idx === i } })
      } else {
        addrs[i] = { ...addrs[i], [key]: val }
      }
      return { ...p, addresses: addrs }
    })

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
      addToast('success', `Supplier ${form.name} saved successfully`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Save failed'
      setFormErr(msg); addToast('error', msg)
    } finally { setSaving(false) }
  }

  // ─── DELETE (permanent) ─────────────────────────────────────
  // Reason is collected by DeleteConfirmModal and logged in audit.
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try {
      await axios.delete(`${API}/suppliers/${id}`, { data: { reason } })
      const name = deleteTarget?.name ?? ''
      setDeleteTarget(null); load()
      if (name) addToast('success', `Supplier ${name} has been deleted`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Delete failed'
      setDeleteErr(msg); addToast('error', msg)
    } finally { setDeleteSaving(false) }
  }

  // ─── DEACTIVATE / REACTIVATE (reversible) ───────────────────
  const deactivate = async (id: number) => {
    setDeactivateSaving(true); setDeactivateErr('')
    try {
      await axios.patch(`${API}/suppliers/${id}/status`, { status: 'inactive' })
      const name = deactivateTarget?.name ?? ''
      setDeactivateTarget(null); load()
      if (name) addToast('warning', `Supplier ${name} has been deactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Deactivation failed'
      setDeactivateErr(msg); addToast('error', msg)
    } finally { setDeactivateSaving(false) }
  }

  const reactivate = async (id: number) => {
    const s = rows.find(r => r.id === id)
    try {
      await axios.patch(`${API}/suppliers/${id}/status`, { status: 'active' })
      load()
      if (s) addToast('success', `Supplier ${s.name} has been reactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Reactivation failed')
    }
  }

  return (
    <>
      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, code, country…" style={{ ...inp(dark), width: 240 }} />
        <select value={filterSt} onChange={e => setFilterSt(e.target.value)} style={{ ...inp(dark), width: 120 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {countries.length > 0 && (
          <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)} style={{ ...inp(dark), width: 140 }}>
            <option value="">All countries</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{filtered.length} supplier{filtered.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowHelp(true)} title="Suppliers help" style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>ℹ</button>
        <AddBtn onClick={openAdd} label="+ Add Supplier" />
      </div>

      {error && <Err msg={error} />}

      <AdminTable tableId="admin_suppliers" columns={S_COLS} dark={dark} empty="No suppliers found.">
        {filtered.map(s => (
          <AdminRow key={s.id} dark={dark}>
            <AdminCell>{s.name}</AdminCell>
            <AdminCell mono>{s.code || '—'}</AdminCell>
            <AdminCell muted>{s.country || '—'}</AdminCell>
            <AdminCell muted>{s.contactName || '—'}</AdminCell>
            <AdminCell muted>{s.email || '—'}</AdminCell>
            <AdminCell muted mono>{s.phone || '—'}</AdminCell>
            {/* ─── ADDRESSES BADGE ────────────────────────── */}
            <AdminCell>
              {(s.addressCount ?? 0) > 0 ? (
                <span title={s.primaryAddressText || undefined} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(37,99,235,0.08)', color: '#2563eb', cursor: s.primaryAddressText ? 'help' : 'default', whiteSpace: 'nowrap' }}>
                  {s.addressCount} address{(s.addressCount ?? 0) !== 1 ? 'es' : ''}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>—</span>
              )}
            </AdminCell>
            <AdminCell>
              <StatusPill active={s.status === 'active'} label={s.status === 'active' ? 'Active' : 'Inactive'} />
            </AdminCell>
            <AdminActions>
              <ActionMenu dark={dark} actions={[
                { label: 'Edit',       icon: '✏', onClick: () => openEdit(s) },
                { label: 'Deactivate', icon: '⊙', variant: 'warning', onClick: () => { setDeactivateTarget({ id: s.id, name: s.name }); setDeactivateErr('') }, hidden: s.status !== 'active' },
                { label: 'Reactivate', icon: '↺', onClick: () => reactivate(s.id), hidden: s.status === 'active' },
                { label: 'Delete',     icon: '🗑', variant: 'danger', onClick: () => { setDeleteTarget({ id: s.id, name: s.name }); setDeleteErr('') } },
              ] satisfies ActionItem[]} />
            </AdminActions>
          </AdminRow>
        ))}
      </AdminTable>

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

      {/* ─── ADD / EDIT MODAL WITH ADDRESSES ────────────────── */}
      {showForm && (
        <Modal title={editId != null ? 'Edit Supplier' : 'Add Supplier'} dark={dark} wide onClose={() => setShowForm(false)} onSubmit={save} error={formErr} saving={saving}>
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
          {/* ─── ADDRESS SECTION ────────────────────────────── */}
          <Field label="Pickup & Delivery Addresses" wide>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {form.addresses.map((addr, i) => (
                <div key={i} style={{ padding: 12, borderRadius: 8, border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`, background: dark ? '#0f172a' : '#f8fafc' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Address {i + 1}</span>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 12, color: dark ? '#94a3b8' : '#64748b', cursor: 'pointer' }}>
                        <input type="radio" checked={addr.is_primary} onChange={() => updateAddress(i, 'is_primary', true)} style={{ accentColor: '#E84E0F' }} />
                        Primary
                      </label>
                      <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 12, color: dark ? '#94a3b8' : '#64748b', cursor: 'pointer' }}>
                        <input type="checkbox" checked={addr.is_pickup} onChange={e => updateAddress(i, 'is_pickup', e.target.checked)} style={{ accentColor: '#E84E0F' }} />
                        Pickup location
                      </label>
                      <button
                        type="button"
                        disabled={form.addresses.length <= 1}
                        onClick={() => removeAddress(i)}
                        style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: form.addresses.length <= 1 ? '#64748b' : '#ef4444', cursor: form.addresses.length <= 1 ? 'not-allowed' : 'pointer', opacity: form.addresses.length <= 1 ? 0.4 : 1 }}>
                        ✕ Remove
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Label</span>
                      <input value={addr.label} onChange={e => updateAddress(i, 'label', e.target.value)} placeholder="e.g. Head Office" style={{ ...inp(dark), height: 30 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Address Line 1 *</span>
                      <input value={addr.address_line1} onChange={e => updateAddress(i, 'address_line1', e.target.value)} placeholder="Street address" style={{ ...inp(dark), height: 30 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Address Line 2</span>
                      <input value={addr.address_line2} onChange={e => updateAddress(i, 'address_line2', e.target.value)} placeholder="Unit, floor, suite…" style={{ ...inp(dark), height: 30 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>City</span>
                      <input value={addr.city} onChange={e => updateAddress(i, 'city', e.target.value)} placeholder="City" style={{ ...inp(dark), height: 30 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>State</span>
                      <input value={addr.state} onChange={e => updateAddress(i, 'state', e.target.value)} placeholder="State / Province" style={{ ...inp(dark), height: 30 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Postcode</span>
                      <input value={addr.postcode} onChange={e => updateAddress(i, 'postcode', e.target.value)} placeholder="Postcode" style={{ ...inp(dark), height: 30 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Country</span>
                      <input value={addr.country} onChange={e => updateAddress(i, 'country', e.target.value)} placeholder="Country" style={{ ...inp(dark), height: 30 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Notes</span>
                      <input value={addr.notes} onChange={e => updateAddress(i, 'notes', e.target.value)} placeholder="Optional notes" style={{ ...inp(dark), height: 30 }} />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addAddress} style={{ alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer' }}>
                + Add Address
              </button>
            </div>
          </Field>
        </Modal>
      )}

      {/* ─── HELP MODAL ──────────────────────────────────── */}
      {showHelp && (
        <HelpModal dark={dark} title="Suppliers — Help" subtitle="Manage the supplier master list" onClose={() => setShowHelp(false)} sections={[
          { icon: '🏭', title: 'What this tab is for', items: ['Manage the master list of suppliers used on Purchase Orders across all projects. Each supplier can have multiple pickup and delivery addresses.'] },
          { icon: '📋', title: 'Column Reference', items: [<><strong>Name</strong> — full legal supplier name.</>, <><strong>Code</strong> — short supplier code used on POs.</>, <><strong>Addresses</strong> — number of addresses on record. Hover for primary address.</>, <><strong>Status</strong> — Active suppliers appear in PO drop-downs.</> ] },
          { icon: '⚙️', title: 'Actions', items: [<><strong>Edit</strong> — update supplier fields and manage pickup/delivery addresses.</>, <><strong>Deactivate</strong> — hides from active lists. Reversible.</>, <><strong>Delete</strong> — permanent. Cascades to all addresses.</> ] },
        ] satisfies HelpSection[]} />
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

// ─── PROJECTS COLUMN DEFINITIONS ────────────────────────────
const P_COLS: AdminCol[] = [
  { label: 'Code',   width: 100, minWidth: 80  },
  { label: 'Name',   width: 200, minWidth: 120, flex: true },
  { label: 'Client', width: 130, minWidth: 100 },
  { label: 'Phase',  width: 100, minWidth: 80  },
  { label: 'POs',    width: 60,  minWidth: 50  },
  { label: 'Risk',   width: 60,  minWidth: 50  },
  { label: 'Breach', width: 60,  minWidth: 50  },
  { label: 'Start',  width: 110, minWidth: 80  },
  { label: 'End',    width: 110, minWidth: 80  },
  { label: '',       width: 90,  minWidth: 90,  noResize: true },
]

function ProjectsAdminTab({ dark }: { dark: boolean }) {
  const { addToast } = useToast()
  const [rows,     setRows]     = useState<AdminProject[]>([])
  const [search,   setSearch]   = useState('')
  const [error,    setError]    = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId,   setEditId]   = useState<number | null>(null)
  const [form,     setForm]     = useState<ProjForm>(EMPTY_PROJ)
  const [formErr,  setFormErr]  = useState('')
  const [saving,   setSaving]   = useState(false)
  // ─── DELETE / DEACTIVATE STATE ──────────────────────────────
  const [deleteTarget,     setDeleteTarget]     = useState<{ id: number; name: string } | null>(null)
  const [deleteSaving,     setDeleteSaving]     = useState(false)
  const [deleteErr,        setDeleteErr]        = useState('')
  const [deactivateTarget, setDeactivateTarget] = useState<{ id: number; name: string } | null>(null)
  const [deactivateSaving, setDeactivateSaving] = useState(false)
  const [deactivateErr,    setDeactivateErr]    = useState('')
  const [showHelp,         setShowHelp]         = useState(false)

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
      addToast('success', `Project ${form.code} saved successfully`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Save failed'
      setFormErr(msg); addToast('error', msg)
    } finally { setSaving(false) }
  }
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try {
      await axios.delete(`${API}/projects/${id}`, { data: { reason } })
      const name = deleteTarget?.name ?? ''
      setDeleteTarget(null); load()
      if (name) addToast('success', `Project ${name} has been deleted`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Delete failed'
      setDeleteErr(msg); addToast('error', msg)
    } finally { setDeleteSaving(false) }
  }
  const deactivate = async (id: number) => {
    setDeactivateSaving(true); setDeactivateErr('')
    try {
      await axios.patch(`${API}/projects/${id}/status`, { status: 'inactive' })
      const name = deactivateTarget?.name ?? ''
      setDeactivateTarget(null); load()
      if (name) addToast('warning', `Project ${name} has been deactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Deactivation failed'
      setDeactivateErr(msg); addToast('error', msg)
    } finally { setDeactivateSaving(false) }
  }
  const reactivate = async (id: number) => {
    const p = rows.find(r => r.id === id)
    try {
      await axios.patch(`${API}/projects/${id}/status`, { status: 'active' })
      load()
      if (p) addToast('success', `Project ${p.code} has been reactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Reactivation failed')
    }
  }

  const filtered = search.trim()
    ? rows.filter(p => p.code.toLowerCase().includes(search.toLowerCase()) || p.name.toLowerCase().includes(search.toLowerCase()) || (p.client || '').toLowerCase().includes(search.toLowerCase()))
    : rows

  return (
    <>
      {/* ─── FILTERS + TOOLBAR ──────────────────────────── */}
      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code, name, client…" style={{ ...inp(dark), width: 260 }} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{filtered.length} project{filtered.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowHelp(true)} title="Projects help" style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>ℹ</button>
        <AddBtn onClick={openAdd} label="+ Add Project" />
      </div>
      {error && <Err msg={error} />}

      {/* ─── TABLE ──────────────────────────────────────── */}
      <AdminTable tableId="admin_projects" columns={P_COLS} dark={dark} empty="No projects found.">
        {filtered.map(p => (
          <AdminRow key={p.id} dark={dark}>
            {/* ─── CODE cell with inline RAG dot ───────────── */}
            <AdminCell title={p.code}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: RAG_DOT[p.rag] ?? '#94a3b8' }} />
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{p.code}</span>
              </span>
            </AdminCell>
            <AdminCell>{p.name}</AdminCell>
            <AdminCell muted>{p.client || '—'}</AdminCell>
            <AdminCell muted>{p.phase || '—'}</AdminCell>
            <AdminCell muted center>{String(p.totalPOs ?? 0)}</AdminCell>
            <AdminCell muted center>{String(p.atRisk ?? 0)}</AdminCell>
            <AdminCell muted center>{String(p.breached ?? 0)}</AdminCell>
            <AdminCell muted mono>{p.startDate?.slice(0, 10) || '—'}</AdminCell>
            <AdminCell muted mono>{p.endDate?.slice(0, 10) || '—'}</AdminCell>
            <AdminActions>
              <ActionMenu dark={dark} actions={[
                { label: 'Edit',       icon: '✏', onClick: () => openEdit(p) },
                { label: 'Deactivate', icon: '⊙', variant: 'warning', onClick: () => { setDeactivateTarget({ id: p.id, name: `${p.code} — ${p.name}` }); setDeactivateErr('') }, hidden: p.status === 'inactive' },
                { label: 'Reactivate', icon: '↺', onClick: () => reactivate(p.id), hidden: p.status !== 'inactive' },
                { label: 'Delete',     icon: '🗑', variant: 'danger', onClick: () => { setDeleteTarget({ id: p.id, name: `${p.code} — ${p.name}` }); setDeleteErr('') } },
              ] satisfies ActionItem[]} />
            </AdminActions>
          </AdminRow>
        ))}
      </AdminTable>
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

      {/* ─── DEACTIVATE MODAL ────────────────────────────── */}
      {deactivateTarget && (
        <SimpleConfirmModal dark={dark} title="Deactivate Project"
          message={`Are you sure you want to deactivate ${deactivateTarget.name}? It will be hidden from active project lists.`}
          confirmLabel="Deactivate" confirmStyle="warning"
          onConfirm={() => deactivate(deactivateTarget.id)}
          onCancel={() => { setDeactivateTarget(null); setDeactivateErr('') }}
          saving={deactivateSaving} error={deactivateErr} />
      )}

      {/* ─── HELP MODAL ──────────────────────────────────── */}
      {showHelp && (
        <HelpModal dark={dark} title="Projects — Help" subtitle="Project master list management" onClose={() => setShowHelp(false)} sections={[
          { icon: '📁', title: 'What this tab is for', items: ['Manage the master list of projects. Projects are referenced by Purchase Orders, WBS codes, and user access assignments.'] },
          { icon: '📋', title: 'Column Reference', items: [<><strong>Code</strong> — unique project code. RAG dot shows status (Green/Amber/Red/Blue/Grey).</>, <><strong>Client</strong> — client organisation.</>, <><strong>Phase</strong> — current project phase (e.g. Execution, Close-out).</>, <><strong>POs / Risk / Breach</strong> — purchase order summary counts from the Procurement module.</>, <><strong>Start / End</strong> — project date range.</> ] },
          { icon: '⚙️', title: 'Actions', items: [<><strong>Edit</strong> — update project details, RAG status, and dates.</>, <><strong>Deactivate</strong> — hides from active lists; reversible.</>, <><strong>Delete</strong> — permanent. Requires reason. Does not delete linked POs.</> ] },
        ] satisfies HelpSection[]} />
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
// ─── WAREHOUSES COLUMN DEFINITIONS ──────────────────────────
const WH_COLS: AdminCol[] = [
  { label: 'Name',    width: 200, minWidth: 120 },
  { label: 'Code',    width: 80,  minWidth: 60  },
  { label: 'Address', width: 220, minWidth: 120, flex: true },
  { label: 'State',   width: 80,  minWidth: 60  },
  { label: 'Contact', width: 140, minWidth: 90  },
  { label: 'Phone',   width: 130, minWidth: 90  },
  { label: 'Status',  width: 90,  minWidth: 70  },
  { label: '',        width: 90,  minWidth: 90,  noResize: true },
]

function WarehousesTab({ dark }: { dark: boolean }) {
  const { addToast } = useToast()
  const [rows,        setRows]        = useState<Warehouse[]>([])
  const [total,       setTotal]       = useState<number | null>(null)
  const [search,      setSearch]      = useState('')
  const [filterSt,    setFilterSt]    = useState('')
  const [filterState, setFilterState] = useState('')
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
  const [showHelp, setShowHelp] = useState(false)

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

  const states      = useMemo(() => [...new Set(rows.map(w => w.state).filter(Boolean))].sort(), [rows])
  const filteredWH  = useMemo(() => filterState ? rows.filter(w => w.state === filterState) : rows, [rows, filterState])

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
      addToast('success', `Warehouse ${form.name} saved successfully`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Save failed'
      setFormErr(msg); addToast('error', msg)
    } finally { setSaving(false) }
  }
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try {
      await axios.delete(`${API}/warehouses/${id}`, { data: { reason } })
      const name = deleteTarget?.name ?? ''
      setDeleteTarget(null); load()
      if (name) addToast('success', `Warehouse ${name} has been deleted`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Delete failed'
      setDeleteErr(msg); addToast('error', msg)
    } finally { setDeleteSaving(false) }
  }
  const deactivate = async (id: number) => {
    setDeactivateSaving(true); setDeactivateErr('')
    try {
      await axios.patch(`${API}/warehouses/${id}/status`, { status: 'inactive' })
      const name = deactivateTarget?.name ?? ''
      setDeactivateTarget(null); load()
      if (name) addToast('warning', `Warehouse ${name} has been deactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Deactivate failed'
      setDeactivateErr(msg); addToast('error', msg)
    } finally { setDeactivateSaving(false) }
  }
  const reactivate = async (id: number) => {
    const w = rows.find(r => r.id === id)
    try {
      await axios.patch(`${API}/warehouses/${id}/status`, { status: 'active' }); load()
      if (w) addToast('success', `Warehouse ${w.name} has been reactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Reactivation failed')
    }
  }

  return (
    <>
      {/* ─── FILTERS + TOOLBAR ──────────────────────────── */}
      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, code, state…" style={{ ...inp(dark), width: 240 }} />
        <select value={filterSt} onChange={e => setFilterSt(e.target.value)} style={{ ...inp(dark), width: 120 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {states.length > 0 && (
          <select value={filterState} onChange={e => setFilterState(e.target.value)} style={{ ...inp(dark), width: 130 }}>
            <option value="">All states</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {total == null ? 'Loading…' : filterState
            ? `${filteredWH.length} of ${total} warehouse${total !== 1 ? 's' : ''}`
            : `${total} warehouse${total !== 1 ? 's' : ''}`}
        </span>
        <button onClick={() => setShowHelp(true)} title="Warehouses help" style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>ℹ</button>
        <AddBtn onClick={openAdd} label="+ Add Warehouse" />
      </div>
      {error && <Err msg={error} />}

      {/* ─── TABLE ──────────────────────────────────────── */}
      <AdminTable tableId="admin_warehouses" columns={WH_COLS} dark={dark} empty="No warehouses found.">
        {filteredWH.map(w => (
          <AdminRow key={w.id} dark={dark}>
            <AdminCell>{w.name}</AdminCell>
            <AdminCell mono>{w.code}</AdminCell>
            <AdminCell muted><span title={w.address}>{w.address || '—'}</span></AdminCell>
            <AdminCell muted>{w.state || '—'}</AdminCell>
            <AdminCell muted>{w.contactName || '—'}</AdminCell>
            <AdminCell muted mono>{w.phone || '—'}</AdminCell>
            <AdminCell><StatusPill active={w.status === 'active'} label={w.status === 'active' ? 'Active' : 'Inactive'} /></AdminCell>
            <AdminActions>
              <ActionMenu dark={dark} actions={[
                { label: 'Edit',       icon: '✏', onClick: () => openEdit(w) },
                { label: 'Deactivate', icon: '⊙', variant: 'warning', onClick: () => setDeactivateTarget(w), hidden: w.status !== 'active' },
                { label: 'Reactivate', icon: '↺', onClick: () => reactivate(w.id), hidden: w.status === 'active' },
                { label: 'Delete',     icon: '🗑', variant: 'danger', onClick: () => setDeleteTarget(w) },
              ] satisfies ActionItem[]} />
            </AdminActions>
          </AdminRow>
        ))}
      </AdminTable>
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

      {/* ─── HELP MODAL ──────────────────────────────────── */}
      {showHelp && (
        <HelpModal dark={dark} title="Warehouses — Help" subtitle="Physical storage locations and laydown yards" onClose={() => setShowHelp(false)} sections={[
          { icon: '🏗️', title: 'What this tab is for', items: ['Manage the master list of physical warehouses, laydown yards, and storage facilities used for material receipt and dispatch.'] },
          { icon: '🔍', title: 'Filters', items: [<><strong>Search</strong> — filters by name, code or state (live as you type).</>, <><strong>Status filter</strong> — show All, Active, or Inactive warehouses.</>, <><strong>State filter</strong> — narrow to a specific state or territory (QLD, NSW, WA…). Populated dynamically from the loaded warehouse list. Only appears when warehouses have state values recorded.</> ] },
          { icon: '📋', title: 'Column Reference', items: [<><strong>Name</strong> — full warehouse name.</>, <><strong>Code</strong> — short identifier used on transfers and tags.</>, <><strong>Address</strong> — full street address. Hover for full text.</>, <><strong>State</strong> — state or territory.</>, <><strong>Contact</strong> — site contact person.</>, <><strong>Status</strong> — Active warehouses appear in material transfer forms.</> ] },
          { icon: '⚙️', title: 'Actions', items: [<><strong>Edit</strong> — update warehouse details.</>, <><strong>Deactivate</strong> — hides from active lists. Reversible.</>, <><strong>Delete</strong> — permanent. Requires reason confirmation.</> ] },
        ] satisfies HelpSection[]} />
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

// ─── UNITS OF MEASURE COLUMN DEFINITIONS ────────────────────
const UOM_COLS: AdminCol[] = [
  { label: 'Code',        width: 80,  minWidth: 70  },
  { label: 'Description', width: 300, minWidth: 150, flex: true },
  { label: 'Status',      width: 100, minWidth: 80  },
  { label: '',            width: 90,  minWidth: 90,  noResize: true },
]

function UomTab({ dark }: { dark: boolean }) {
  const { addToast } = useToast()
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
  const [showHelp,          setShowHelp]          = useState(false)

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
      addToast('success', `Unit of measure ${form.code} saved successfully`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Save failed'
      setFormErr(msg); addToast('error', msg)
    } finally { setSaving(false) }
  }
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try {
      await axios.delete(`${API}/uom/${id}`, { data: { reason } })
      const code = deleteTarget?.code ?? ''
      setDeleteTarget(null); load()
      if (code) addToast('success', `Unit of measure ${code} has been deleted`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Delete failed'
      setDeleteErr(msg); addToast('error', msg)
    } finally { setDeleteSaving(false) }
  }
  const deactivate = async (id: number) => {
    setDeactivateSaving(true); setDeactivateErr('')
    try {
      await axios.patch(`${API}/uom/${id}/status`, { status: 'inactive' })
      const code = deactivateTarget?.code ?? ''
      setDeactivateTarget(null); load()
      if (code) addToast('warning', `Unit of measure ${code} has been deactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Deactivate failed'
      setDeactivateErr(msg); addToast('error', msg)
    } finally { setDeactivateSaving(false) }
  }
  const reactivate = async (id: number) => {
    const u = rows.find(r => r.id === id)
    try {
      await axios.patch(`${API}/uom/${id}/status`, { status: 'active' }); load()
      if (u) addToast('success', `Unit of measure ${u.code} has been reactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Reactivation failed')
    }
  }

  return (
    <>
      {/* ─── FILTERS + TOOLBAR ──────────────────────────── */}
      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or description…" style={{ ...inp(dark), width: 260 }} />
        <select value={filterSt} onChange={e => setFilterSt(e.target.value)} style={{ ...inp(dark), width: 120 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{rows.length} unit{rows.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowHelp(true)} title="Units of Measure help" style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>ℹ</button>
        <AddBtn onClick={openAdd} label="+ Add UoM" />
      </div>
      {error && <Err msg={error} />}

      {/* ─── TABLE ──────────────────────────────────────── */}
      <AdminTable tableId="admin_uom" columns={UOM_COLS} dark={dark} empty="No units of measure found.">
        {rows.map(u => (
          <AdminRow key={u.id} dark={dark}>
            <AdminCell mono>{u.code}</AdminCell>
            <AdminCell muted>{u.description}</AdminCell>
            <AdminCell><StatusPill active={u.status === 'active'} label={u.status === 'active' ? 'Active' : 'Inactive'} /></AdminCell>
            <AdminActions>
              <ActionMenu dark={dark} actions={[
                { label: 'Edit',        icon: '✏',  onClick: () => openEdit(u) },
                { label: 'Deactivate',  icon: '⊙',  variant: 'warning', onClick: () => setDeactivateTarget(u), hidden: u.status !== 'active' },
                { label: 'Reactivate',  icon: '↺',  onClick: () => reactivate(u.id), hidden: u.status === 'active' },
                { label: 'Delete',      icon: '🗑', variant: 'danger',  onClick: () => setDeleteTarget(u) },
              ] satisfies ActionItem[]} />
            </AdminActions>
          </AdminRow>
        ))}
      </AdminTable>
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

      {/* ─── HELP MODAL ──────────────────────────────────── */}
      {showHelp && (
        <HelpModal dark={dark} title="Units of Measure — Help" subtitle="Reference list of UoM codes used on POs and MTO lines" onClose={() => setShowHelp(false)} sections={[
          { icon: '📏', title: 'What this tab is for', items: ['Manage the master list of Units of Measure used on Purchase Order line items and Material Take-Off sheets.'] },
          { icon: '📋', title: 'Column Reference', items: [<><strong>Code</strong> — short UoM code (e.g. EA, KG, M).</>, <><strong>Description</strong> — full description (e.g. Each, Kilogram, Metre).</>, <><strong>Status</strong> — Active units appear in PO and MTO line item forms.</> ] },
          { icon: '⚙️', title: 'Actions', items: [<><strong>Edit</strong> — update code or description.</>, <><strong>Deactivate</strong> — hides from selection lists. Existing PO lines keep their value.</>, <><strong>Delete</strong> — permanent. Requires reason confirmation.</> ] },
        ] satisfies HelpSection[]} />
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
const ACR_MODULES = ['', 'Procurement', 'Expediting', 'VDRL', 'Logistics', 'Material Control', 'Traceability', 'Document Inbox', 'Audit', 'Admin', 'Foundational']

// ─── ACRONYMS COLUMN DEFINITIONS ────────────────────────────
const ACR_COLS: AdminCol[] = [
  { label: 'Acronym',    width: 90,  minWidth: 70  },
  { label: 'Definition', width: 260, minWidth: 130, flex: true },
  { label: 'Module',     width: 140, minWidth: 100 },
  { label: 'Notes',      width: 200, minWidth: 120 },
  { label: '',           width: 90,  minWidth: 90,  noResize: true },
]

function AcronymsTab({ dark }: { dark: boolean }) {
  const { addToast } = useToast()
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
  const [showHelp,      setShowHelp]      = useState(false)

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
      addToast('success', `Acronym ${form.acronym} saved successfully`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Save failed'
      setFormErr(msg); addToast('error', msg)
    } finally { setSaving(false) }
  }
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try {
      await axios.delete(`${API}/acronyms/${id}`, { data: { reason } })
      const code = deleteTarget?.acronym ?? ''
      setDeleteTarget(null); load()
      if (code) addToast('success', `Acronym ${code} has been deleted`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Delete failed'
      setDeleteErr(msg); addToast('error', msg)
    } finally { setDeleteSaving(false) }
  }

  return (
    <>
      {/* ─── FILTERS + TOOLBAR ──────────────────────────── */}
      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search acronym or definition…" style={{ ...inp(dark), width: 260 }} />
        <select value={filterMod} onChange={e => setFilterMod(e.target.value)} style={{ ...inp(dark), width: 160 }}>
          <option value="">All modules</option>
          {['Procurement','Expediting','VDRL','Logistics','Material Control','Traceability','Document Inbox','Audit','Admin','Foundational'].map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{rows.length} acronym{rows.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowHelp(true)} title="Acronyms help" style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>ℹ</button>
        <AddBtn onClick={openAdd} label="+ Add Acronym" />
      </div>
      {error && <Err msg={error} />}

      {/* ─── TABLE ──────────────────────────────────────── */}
      <AdminTable tableId="admin_acronyms" columns={ACR_COLS} dark={dark} empty="No acronyms found.">
        {rows.map(a => (
          <AdminRow key={a.id} dark={dark}>
            <AdminCell mono>{a.acronym}</AdminCell>
            <AdminCell><span title={a.definition}>{a.definition}</span></AdminCell>
            <AdminCell muted>{a.module || '—'}</AdminCell>
            <AdminCell muted><span title={a.notes}>{a.notes || '—'}</span></AdminCell>
            <AdminActions>
              <ActionMenu dark={dark} actions={[
                { label: 'Edit',   icon: '✏',  onClick: () => openEdit(a) },
                { label: 'Delete', icon: '🗑', variant: 'danger', onClick: () => setDeleteTarget(a) },
              ] satisfies ActionItem[]} />
            </AdminActions>
          </AdminRow>
        ))}
      </AdminTable>
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

      {/* ─── HELP MODAL ──────────────────────────────────── */}
      {showHelp && (
        <HelpModal dark={dark} title="Acronyms — Help" subtitle="Searchable glossary of MMS acronyms" onClose={() => setShowHelp(false)} sections={[
          { icon: '🔤', title: 'What this tab is for', items: ['Manage the searchable glossary of acronyms used across all MMS modules. Users can look up definitions from any module.'] },
          { icon: '📋', title: 'Column Reference', items: [<><strong>Acronym</strong> — the short form (e.g. PO, MTO, FAT).</>, <><strong>Definition</strong> — full expanded text.</>, <><strong>Module</strong> — which MMS module this acronym primarily belongs to.</>, <><strong>Notes</strong> — additional context or usage notes.</> ] },
          { icon: '⚙️', title: 'Actions', items: [<><strong>Edit</strong> — update any field.</>, <><strong>Delete</strong> — permanent. Requires reason confirmation.</> ] },
        ] satisfies HelpSection[]} />
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

// ─── INCO TERMS COLUMN DEFINITIONS ──────────────────────────
const INC_COLS: AdminCol[] = [
  { label: 'Code',           width: 70,  minWidth: 50  },
  { label: 'Full Name',      width: 200, minWidth: 130 },
  { label: 'Description',    width: 260, minWidth: 130, flex: true },
  { label: 'Risk Transfer',  width: 200, minWidth: 120 },
  { label: 'Transport Mode', width: 150, minWidth: 100 },
  { label: 'Status',         width: 90,  minWidth: 70  },
  { label: '',               width: 90,  minWidth: 90,  noResize: true },
]

function IncoTermsTab({ dark }: { dark: boolean }) {
  const { addToast } = useToast()
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
  const [showHelp,          setShowHelp]          = useState(false)

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
      addToast('success', `INCO Term ${form.code} saved successfully`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Save failed'
      setFormErr(msg); addToast('error', msg)
    } finally { setSaving(false) }
  }
  const del = async (id: number, reason: string) => {
    setDeleteSaving(true); setDeleteErr('')
    try {
      await axios.delete(`${API}/inco-terms/${id}`, { data: { reason } })
      const code = deleteTarget?.code ?? ''
      setDeleteTarget(null); load()
      if (code) addToast('success', `INCO Term ${code} has been deleted`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Delete failed'
      setDeleteErr(msg); addToast('error', msg)
    } finally { setDeleteSaving(false) }
  }
  const deactivate = async (id: number) => {
    setDeactivateSaving(true); setDeactivateErr('')
    try {
      await axios.patch(`${API}/inco-terms/${id}/status`, { status: 'inactive' })
      const code = deactivateTarget?.code ?? ''
      setDeactivateTarget(null); load()
      if (code) addToast('warning', `INCO Term ${code} has been deactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      const msg = err.response?.data?.error ?? 'Deactivate failed'
      setDeactivateErr(msg); addToast('error', msg)
    } finally { setDeactivateSaving(false) }
  }
  const reactivate = async (id: number) => {
    const t = rows.find(r => r.id === id)
    try {
      await axios.patch(`${API}/inco-terms/${id}/status`, { status: 'active' }); load()
      if (t) addToast('success', `INCO Term ${t.code} has been reactivated`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      addToast('error', err.response?.data?.error ?? 'Reactivation failed')
    }
  }

  return (
    <>
      {/* ─── FILTERS + TOOLBAR ──────────────────────────── */}
      <div className="admin-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code, name, mode…" style={{ ...inp(dark), width: 260 }} />
        <select value={filterSt} onChange={e => setFilterSt(e.target.value)} style={{ ...inp(dark), width: 120 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{rows.length} term{rows.length !== 1 ? 's' : ''}</span>
        <button onClick={() => setShowHelp(true)} title="INCO Terms help" style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>ℹ</button>
        <AddBtn onClick={openAdd} label="+ Add INCO Term" />
      </div>
      {error && <Err msg={error} />}

      {/* ─── TABLE ──────────────────────────────────────── */}
      <AdminTable tableId="admin_incoterms" columns={INC_COLS} dark={dark} empty="No INCO terms found.">
        {rows.map(t => (
          <AdminRow key={t.id} dark={dark}>
            <AdminCell mono>{t.code}</AdminCell>
            <AdminCell><span title={t.fullName}>{t.fullName}</span></AdminCell>
            <AdminCell muted><span title={t.description}>{t.description || '—'}</span></AdminCell>
            <AdminCell muted><span title={t.riskTransferPoint}>{t.riskTransferPoint || '—'}</span></AdminCell>
            <AdminCell muted>{t.transportMode || '—'}</AdminCell>
            <AdminCell><StatusPill active={t.status === 'active'} label={t.status === 'active' ? 'Active' : 'Inactive'} /></AdminCell>
            <AdminActions>
              <ActionMenu dark={dark} actions={[
                { label: 'Edit',        icon: '✏',  onClick: () => openEdit(t) },
                { label: 'Deactivate',  icon: '⊙',  variant: 'warning', onClick: () => setDeactivateTarget(t), hidden: t.status !== 'active' },
                { label: 'Reactivate',  icon: '↺',  onClick: () => reactivate(t.id), hidden: t.status === 'active' },
                { label: 'Delete',      icon: '🗑', variant: 'danger',  onClick: () => setDeleteTarget(t) },
              ] satisfies ActionItem[]} />
            </AdminActions>
          </AdminRow>
        ))}
      </AdminTable>
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

      {/* ─── HELP MODAL ──────────────────────────────────── */}
      {showHelp && (
        <HelpModal dark={dark} title="INCO Terms — Help" subtitle="International commercial terms for PO freight and risk" onClose={() => setShowHelp(false)} sections={[
          { icon: '🚢', title: 'What this tab is for', items: ['Manage the list of INCO Terms (International Commercial Terms) available on Purchase Orders. These define where risk and freight cost transfer between buyer and seller.'] },
          { icon: '📋', title: 'Column Reference', items: [<><strong>Code</strong> — standard INCO code (e.g. FOB, CIF, EXW).</>, <><strong>Full Name</strong> — complete term name.</>, <><strong>Description</strong> — plain-language explanation.</>, <><strong>Risk Transfer</strong> — the point at which responsibility passes to the buyer.</>, <><strong>Transport Mode</strong> — applicable transport modes (Any, Sea, Air, Road, Rail).</>, <><strong>Status</strong> — Active terms appear on PO forms.</> ] },
          { icon: '⚙️', title: 'Actions', items: [<><strong>Edit</strong> — update any field.</>, <><strong>Deactivate</strong> — hides from PO selection. Existing POs keep their value.</>, <><strong>Delete</strong> — permanent. Requires reason confirmation.</> ] },
        ] satisfies HelpSection[]} />
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
    { key: 'permissions',   label: 'Permission Matrix',  icon: '🔐' },
    { key: 'suppliers',     label: 'Suppliers',          icon: '🏭' },
    { key: 'warehouses',    label: 'Warehouses',         icon: '🏗️' },
    { key: 'uom',           label: 'Units of Measure',   icon: '📏' },
    { key: 'acronyms',      label: 'Acronyms',           icon: '🔤' },
    { key: 'incoterms',     label: 'INCO Terms',         icon: '🚢' },
    { key: 'projects',      label: 'Projects',           icon: '📁' },
    { key: 'notifications', label: 'Notifications',      icon: '🔔' },
    { key: 'settings',      label: 'System Settings',    icon: '⚙️' },
  ]

  return (
    <ToastProvider>
    <div className="admin-page">
      <ToastContainer />
      {/* ─── STICKY HEADER (title + tab bar) ─────────────────── */}
      <div className="admin-header-wrap">
        <h2 className="admin-title" style={{ color: dark ? '#f1f5f9' : '#0f172a' }}>
          Admin
        </h2>
        <p className="admin-subtitle">
          Manage users, permissions, external access and system settings.
        </p>

        {/* ─── TAB BAR ────────────────────────────────────── */}
        <div className="admin-tab-bar" style={{ display: 'flex', gap: 2, borderBottom: `2px solid ${dark ? '#334155' : '#e2e8f0'}`, overflowX: 'clip' }}>
          {tabs.map(t => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="admin-tab-btn"
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#E84E0F' : (dark ? '#94a3b8' : '#64748b'), borderBottom: `2px solid ${active ? '#E84E0F' : 'transparent'}`, marginBottom: -2, fontFamily: 'IBM Plex Sans, sans-serif', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 150ms', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 14 }}>{t.icon}</span>
                {t.label}
              </button>
            )
          })}
        </div>
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
    </ToastProvider>
  )
}
