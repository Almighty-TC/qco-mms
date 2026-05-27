import { useEffect, useState, useCallback, useRef } from 'react'
import axios from 'axios'
import { useAuth } from './context/AuthContext'
import Login from './pages/Login'
import { useTableResize } from './hooks/useTableResize'
import { HeaderCell } from './components/ResizableTable'
import { HelpLegend } from './components/HelpLegend'
import { Admin } from './pages/Admin'
import { ForcePasswordChange } from './components/ForcePasswordChange'
import { ChangePasswordModal } from './components/ChangePasswordModal'
import './App.css'

// ─── PAGE ROUTING ───────────────────────────────────────────
// Simple state-based routing — no router library needed.
// Only 'admin' requires the admin role check; all other pages
// are accessible to any authenticated user.
type Page = 'dashboard' | 'admin'

// ─── PROJECT TYPE ───────────────────────────────────────────
// Mirrors the API response shape. Snake_case DB columns (total_pos, at_risk)
// are aliased to camelCase in server/routes/projects.js before being sent here.
type Project = {
  id: number
  code: string
  name: string
  rag: string
  phase?: string
  totalPOs?: number
  atRisk?: number
  breached?: number
}

// ─── RAG BAR COLOURS ────────────────────────────────────────
// Left-edge accent bar colour keyed by RAG status string.
const RAG_BAR: Record<string, string> = {
  red: '#ef4444', amber: '#f59e0b', green: '#22c55e', blue: '#2563eb', grey: '#c4cedf',
}

// ─── FONT SIZE CONSTANTS ─────────────────────────────────────
// Three named sizes map to a CSS zoom multiplier applied to the app root.
// Zoom compensates its own container dimensions (height = 100vh / scale)
// so the content always fills the viewport exactly, not just 85% or 115%.
type FontSize = 'small' | 'medium' | 'large'
const FONT_SCALE: Record<FontSize, number> = { small: 0.85, medium: 1, large: 1.15 }
const FS_STORAGE_KEY = 'qmat_font_size'

// ─── ALL PREFERENCE KEYS ─────────────────────────────────────
// Centralised list of every localStorage key the app writes.
// The "Reset to defaults" action clears all of these so the next
// load starts completely fresh. Add new module keys here.
const ALL_PREF_KEYS = [
  'qmat_font_size',
  'qmat_help_seen',
] as const

// ─── DASHBOARD COLUMN DEFINITIONS ───────────────────────────
// ColKey names the five resizable data columns for the project table.
// The 4px RAG bar and 32px arrow chevron are fixed — not resizable.
type ColKey = 'project' | 'pos' | 'risk' | 'breach' | 'status'
const DEFAULT_COL_WIDTHS: Record<ColKey, number> = {
  project: 340, pos: 80, risk: 60, breach: 60, status: 100,
}
const MIN_COL_WIDTHS: Record<ColKey, number> = {
  project: 120, pos: 50, risk: 50, breach: 50, status: 80,
}

// ─── RAG PILL ────────────────────────────────────────────────
// Coloured status badge with a dot indicator. size="sm" is used in table rows.
const RAGPill = ({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) => {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    green: { label: 'On track',    cls: 'pill-green', dot: '#22c55e' },
    amber: { label: 'At risk',     cls: 'pill-amber', dot: '#f59e0b' },
    red:   { label: 'Breached',    cls: 'pill-red',   dot: '#ef4444' },
    grey:  { label: 'Not started', cls: 'pill-grey',  dot: '#8899aa' },
    blue:  { label: 'In progress', cls: 'pill-blue',  dot: '#2563eb' },
  }
  const { label, cls, dot } = map[status] ?? map.grey
  const sm = size === 'sm'
  return (
    <span className={`pill ${cls}`} style={{ fontSize: sm ? 11 : 12, padding: sm ? '2px 7px' : '3px 10px' }}>
      <span style={{ width: sm ? 6 : 7, height: sm ? 6 : 7, borderRadius: '50%', background: dot, display: 'inline-block', marginRight: 4, flexShrink: 0 }} />
      {label}
    </span>
  )
}

// ─── BADGE ───────────────────────────────────────────────────
// Small numeric badge used in the critical alert banner.
const Badge = ({ count, color = 'red' }: { count: number; color?: string }) => {
  const bg: Record<string, string> = { red: '#ef4444', amber: '#f59e0b', green: '#22c55e', blue: '#2563eb', grey: '#dde3ed' }
  const fg = color === 'amber' || color === 'green' ? '#f1f4f8' : '#fff'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 5px', borderRadius: 9999, fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', background: bg[color] ?? bg.red, color: fg }}>
      {count}
    </span>
  )
}

// ─── CRITICAL ALERT BANNER ───────────────────────────────────
// Red-tinted bar at the top of the dashboard listing severity counts.
const CriticalAlertBanner = ({ alerts }: { alerts: { label: string; count: number; color?: string }[] }) => (
  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
    <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', whiteSpace: 'nowrap' }}>Critical alerts</span>
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', flex: 1 }}>
      {alerts.map((a, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
          <Badge count={a.count} color={a.color ?? 'red'} /> {a.label}
        </span>
      ))}
    </div>
  </div>
)

// ─── DASHBOARD GRID TEMPLATE ────────────────────────────────
// Static string — column widths come from CSS variables seeded on
// the table wrapper by useTableResize.  Every row (header and body)
// uses this same string so the browser reflows them together when
// any --col-* variable changes.  No React prop needed.
const DASHBOARD_GRID =
  `4px ` +
  `var(--col-project, ${DEFAULT_COL_WIDTHS.project}px) ` +
  `var(--col-pos,     ${DEFAULT_COL_WIDTHS.pos}px) ` +
  `var(--col-risk,    ${DEFAULT_COL_WIDTHS.risk}px) ` +
  `var(--col-breach,  ${DEFAULT_COL_WIDTHS.breach}px) ` +
  `var(--col-status,  ${DEFAULT_COL_WIDTHS.status}px) ` +
  `32px`

// ─── PROJECT ROW ─────────────────────────────────────────────
// One row per project.  gridTemplateColumns is driven by CSS
// variables on the ancestor container (set by useTableResize),
// not by a React prop — so all rows resize simultaneously with
// the header in the same browser reflow.
const ProjectRow = ({
  project, dark,
}: {
  project: Project
  dark: boolean
}) => {
  const [hovered, setHovered] = useState(false)
  const total    = project.totalPOs ?? 0
  const atRisk   = project.atRisk   ?? 0
  const breached = project.breached ?? 0

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: DASHBOARD_GRID,
        alignItems: 'center',
        background: hovered ? (dark ? '#1e2d4a' : '#f4f7fb') : (dark ? '#1e293b' : '#ffffff'),
        borderBottom: `1px solid ${dark ? '#334155' : '#e8ecf2'}`,
        cursor: 'default',
        transition: 'background 120ms ease',
      }}>

      {/* RAG accent bar */}
      <div style={{ width: 4, height: '100%', background: RAG_BAR[project.rag] ?? RAG_BAR.grey, borderRadius: '2px 0 0 2px', alignSelf: 'stretch' }} />

      {/* Project name + code — truncates with tooltip when column is narrow */}
      <div style={{ padding: '14px 16px', minWidth: 0, overflow: 'hidden' }}>
        <div
          title={project.name}
          style={{ fontSize: 14, fontWeight: 600, color: dark ? '#f1f5f9' : '#0f172a', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <span
            title={project.code}
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
            {project.code}
          </span>
          {project.phase && (
            <>
              <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>·</span>
              <span title={project.phase} style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>{project.phase}</span>
            </>
          )}
          {/* Mini PO progress bar — only shown when PO data exists */}
          {total > 0 && (
            <div style={{ display: 'flex', gap: 1, alignItems: 'center', marginLeft: 6, flexShrink: 0 }}>
              {Array.from({ length: Math.min(total, 24) }).map((_, i) => {
                const isBreached = i < Math.round(breached / total * Math.min(total, 24))
                const isAtRisk   = !isBreached && i < Math.round((breached + atRisk) / total * Math.min(total, 24))
                return <div key={i} style={{ width: 4, height: 10, borderRadius: 1, background: isBreached ? '#ef4444' : isAtRisk ? '#f59e0b' : '#22c55e', opacity: 0.75 }} />
              })}
            </div>
          )}
        </div>
      </div>

      {/* Total POs — uses != null so genuine 0 renders as 0, not as a dash */}
      <div style={{ textAlign: 'center', padding: '0 8px', overflow: 'hidden' }}>
        <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: dark ? '#f1f5f9' : '#0f172a' }}>
          {project.totalPOs != null ? project.totalPOs : '—'}
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>Total POs</div>
      </div>

      {/* At risk */}
      <div style={{ textAlign: 'center', padding: '0 8px', overflow: 'hidden' }}>
        <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: atRisk > 0 ? '#f59e0b' : '#94a3b8' }}>{atRisk}</div>
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>At risk</div>
      </div>

      {/* Breached */}
      <div style={{ textAlign: 'center', padding: '0 8px', overflow: 'hidden' }}>
        <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: breached > 0 ? '#ef4444' : '#94a3b8' }}>{breached}</div>
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>Breached</div>
      </div>

      {/* Status pill — overflow:hidden clips if column is dragged very narrow */}
      <div style={{ padding: '0 8px', overflow: 'hidden' }}>
        <RAGPill status={project.rag} size="sm" />
      </div>

      {/* Arrow */}
      <div style={{ textAlign: 'center', color: hovered ? '#2563eb' : '#c4cedf', fontSize: 16, transition: 'color 120ms', paddingRight: 12 }}>›</div>
    </div>
  )
}

// ─── SIDEBAR NAV ─────────────────────────────────────────────
// Dark-gradient sidebar with logo, nav items, and user chip.
// activePage and onNavigate enable state-based page routing without
// a router library. Only items with a page key are clickable.
const Nav = ({
  userName, userInitial, activePage, onNavigate,
}: {
  userName: string; userInitial: string
  activePage: Page; onNavigate: (p: Page) => void
}) => {
  const navItem = (label: string, icon: string, page?: Page, badge?: number) => {
    const active = page != null && page === activePage
    return (
      <div
        key={label}
        onClick={() => page && onNavigate(page)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px',
          borderRadius: 6, fontSize: 13, marginBottom: 1, userSelect: 'none',
          cursor: page ? 'pointer' : 'default',
          transition: 'all 150ms ease',
          background: active ? 'rgba(232,78,15,0.12)' : 'transparent',
          border: `1px solid ${active ? 'rgba(232,78,15,0.28)' : 'transparent'}`,
          color: active ? '#E84E0F' : '#94a3b8',
        }}
        onMouseEnter={(e) => {
          if (!active && page) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            e.currentTarget.style.color = '#e2e8f0'
          }
        }}
        onMouseLeave={(e) => {
          if (!active && page) {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#94a3b8'
          }
        }}>
        <span style={{ width: 15, textAlign: 'center', fontSize: 12, opacity: active ? 1 : 0.65, flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
        {badge != null && badge > 0 && (
          <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', padding: '1px 5px', borderRadius: 9999, minWidth: 18, textAlign: 'center' }}>{badge}</span>
        )}
      </div>
    )
  }

  const sectionLabel = (label: string) => (
    <div key={label} style={{ fontSize: 10, fontWeight: 600, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 8px', marginBottom: 3, marginTop: 6 }}>{label}</div>
  )

  return (
    <nav style={{ width: 224, background: 'linear-gradient(180deg,#1e293b 0%,#0f172a 100%)', borderRight: '1px solid #1e2d4a', display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100%', overflow: 'hidden' }}>

      {/* ─── SIDEBAR LOGO ──────────────────────────────────────
          The file sits in /public so Vite serves it at the root
          path with no import needed. */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e2d4a', flexShrink: 0 }}>
        <img src="/qco_logo_primary_RGB_transparent.png" alt="QCO logo" style={{ width: 100, display: 'block' }} />
      </div>

      {/* Top nav */}
      <div style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
        {navItem('Dashboard', '🏠', 'dashboard')}
      </div>

      {/* Module nav */}
      <div style={{ padding: '4px 8px', flex: 1, overflowY: 'auto' }}>
        {sectionLabel('Modules')}
        {navItem('MTO Register', '📋')}
        {navItem('Procurement', '🧾')}
        {navItem('VDRL', '📑')}
        {navItem('Expediting', '🚨', undefined, 8)}
        {navItem('Logistics', '🚚')}
        {navItem('Material Control', '📦')}
        {navItem('Traceability', '🔗')}
        {navItem('Document Inbox', '📥')}
        {navItem('Audit', '🔍')}
      </div>

      {/* System */}
      <div style={{ padding: '4px 8px', flexShrink: 0 }}>
        {sectionLabel('System')}
        {navItem('Admin', '⚙️', 'admin')}
      </div>

      {/* User chip */}
      <div style={{ padding: 8, borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6 }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {userInitial}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
          </div>
        </div>
      </div>
    </nav>
  )
}

// ─── DASHBOARD HOME ──────────────────────────────────────────
// The main project-list view. containerRef and startResize are lifted
// to App so the global "Reset to defaults" action can call resetWidths()
// directly on the same ref without needing to drill through callbacks.
const DashboardHome = ({
  projects, loading, error, dark, containerRef, startResize,
}: {
  projects: Project[]
  loading: boolean
  error: string
  dark: boolean
  containerRef: React.RefObject<HTMLDivElement>
  startResize: (col: string, startX: number) => void
}) => {
  const criticalCount = projects.filter(p => p.rag === 'red').length
  const atRiskCount   = projects.filter(p => p.rag === 'amber').length

  return (
    <div>
      {(criticalCount > 0 || atRiskCount > 0) && (
        <CriticalAlertBanner alerts={[
          ...(criticalCount > 0 ? [{ label: 'Projects breached', count: criticalCount, color: 'red' }] : []),
          ...(atRiskCount   > 0 ? [{ label: 'Projects at risk',   count: atRiskCount,   color: 'amber' }] : []),
        ]} />
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: dark ? '#f1f5f9' : '#0f172a', fontFamily: 'IBM Plex Sans, sans-serif', letterSpacing: '-0.02em', margin: 0 }}>
            Select a project
          </h2>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '3px 0 0' }}>
            Choose a project to view its supply chain status.
          </p>
        </div>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {loading ? 'Loading…' : `${projects.length} active`}
        </span>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#ef4444' }}>
          {error}
        </div>
      )}

      {/* ─── TABLE CARD ──────────────────────────────────────────
          containerRef sits here so --col-* variables cascade to
          BOTH the header row and every ProjectRow beneath it.
          The browser reflows all of them together on each var update. */}
      <div
        ref={containerRef}
        style={{ background: dark ? '#1e293b' : '#ffffff', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>

        {/* ─── TABLE HEADER ────────────────────────────────────
            Uses DASHBOARD_GRID (var() refs) — same static string
            as every ProjectRow, so alignment is guaranteed. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: DASHBOARD_GRID,
          background: dark ? '#0f172a' : '#f4f7fb',
          borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
          padding: '7px 0',
          height: 32,
          alignItems: 'center',
        }}>
          <div />
          <HeaderCell label="Project" col="project" align="left" onResize={startResize} />
          <HeaderCell label="POs"     col="pos"                  onResize={startResize} />
          <HeaderCell label="Risk"    col="risk"                 onResize={startResize} />
          <HeaderCell label="Breach"  col="breach"               onResize={startResize} />
          <HeaderCell label="Status"  col="status"               onResize={startResize} />
          <div />
        </div>

        {loading && (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>
            Loading projects…
          </div>
        )}

        {!loading && projects.length === 0 && !error && (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>
            No projects available.
          </div>
        )}

        {projects.map(p => (
          <ProjectRow key={p.id} project={p} dark={dark} />
        ))}
      </div>
    </div>
  )
}

// ─── APP ─────────────────────────────────────────────────────
// Root component. Owns auth, data-fetching, sidebar, dark-mode,
// and font-size state. The zoom + compensated dimensions pattern
// ensures the content fills 100vh/100vw at every scale level.
function App() {
  const { user, token, logout, isAuthenticated } = useAuth()
  const [projects,      setProjects]      = useState<Project[]>([])
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  const [sidebarOpen,   setSidebarOpen]   = useState(true)
  const [dark,          setDark]          = useState(false)
  const [page,          setPage]          = useState<Page>('dashboard')
  const [showChangePw,  setShowChangePw]  = useState(false)

  // ─── FONT SIZE STATE ─────────────────────────────────────────
  // Initialised from localStorage so the preference survives reloads.
  const [fontSize, setFontSize] = useState<FontSize>(
    () => (localStorage.getItem(FS_STORAGE_KEY) as FontSize | null) ?? 'medium'
  )
  const applyFontSize = (s: FontSize) => {
    setFontSize(s)
    localStorage.setItem(FS_STORAGE_KEY, s)
  }
  const scale = FONT_SCALE[fontSize]

  // ─── COLUMN RESIZE — LIFTED FROM DashboardHome ───────────────
  // Kept here so resetPreferences() can call resetWidths() directly.
  const { containerRef, startResize, resetWidths } =
    useTableResize(DEFAULT_COL_WIDTHS, MIN_COL_WIDTHS)

  // ─── TOAST STATE ─────────────────────────────────────────────
  // Brief confirmation message shown after a reset. The ref holds
  // the auto-dismiss timer so rapid clicks don't stack timeouts.
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = () => {
    setToastVisible(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastVisible(false), 2500)
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // ─── RESET PREFERENCES ───────────────────────────────────────
  // Resets all user preferences to defaults in a single action:
  //   1. Font size → medium (React state + localStorage)
  //   2. Dark mode → light  (React state only; persisted on next toggle)
  //   3. Column widths → defaults (CSS vars on containerRef element)
  //   4. Clears every localStorage key in ALL_PREF_KEYS
  //   5. Shows a brief confirmation toast
  const resetPreferences = () => {
    setFontSize('medium')
    setDark(false)
    resetWidths()
    ALL_PREF_KEYS.forEach(k => localStorage.removeItem(k))
    showToast()
  }

  // ─── FETCH PROJECTS ─────────────────────────────────────────
  // Calls the API with the JWT and normalises the response.
  // Accepts both camelCase aliases (new server) and snake_case (old server
  // before restart) so the UI stays correct in either case.
  const fetchProjects = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const response = await axios.get('http://localhost:3001/api/projects', {
        headers: { Authorization: `Bearer ${token}` },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalised: Project[] = response.data.map((p: any) => ({
        ...p,
        totalPOs: p.totalPOs ?? p.total_pos ?? 0,
        atRisk:   p.atRisk   ?? p.at_risk   ?? 0,
        breached: p.breached ?? 0,
      }))
      setProjects(normalised)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string }
      setError(e.response?.data?.error ?? e.message ?? 'Unable to load projects')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  if (!isAuthenticated) return <Login />

  const userName    = user?.full_name ?? user?.email ?? 'User'
  const userInitial = userName.charAt(0).toUpperCase()
  const today       = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
  const criticalCount = projects.filter(p => p.rag === 'red').length

  // ─── PASSWORD EXPIRY WARNING ─────────────────────────────
  // Shows a topbar banner when the password expires within 7 days.
  const pwExpiryDaysLeft = (() => {
    if (!user?.passwordExpiresAt) return null
    const diff = Math.ceil((new Date(user.passwordExpiresAt).getTime() - Date.now()) / 86_400_000)
    return diff <= 7 ? diff : null
  })()

  return (
    // ─── APP ROOT ─────────────────────────────────────────────
    // Fragment wraps the zoom container + the reset toast so the toast
    // is a sibling, not a child, of the zoomed div. position:fixed
    // on children of a zoom-scaled element is misaligned in some
    // browsers — keeping fixed elements outside guarantees correct positioning.
    <>
    {/* zoom scales the entire UI uniformly. Compensating height/width
        (= 100vh/vw ÷ scale) ensures the content fills the viewport
        exactly — without it, small mode leaves blank space and
        large mode overflows and clips. */}
    <div style={{
      display: 'flex',
      height: `${(100 / scale).toFixed(4)}vh`,
      width:  `${(100 / scale).toFixed(4)}vw`,
      overflow: 'hidden',
      fontFamily: 'IBM Plex Sans, sans-serif',
      background: dark ? '#0f172a' : '#f1f4f8',
      color: dark ? '#f1f5f9' : '#0f172a',
      zoom: scale,
    }}>

      {/* Sidebar — slides in/out over 200ms */}
      <div style={{ width: sidebarOpen ? 224 : 0, flexShrink: 0, overflow: 'hidden', transition: 'width 200ms ease' }}>
        <Nav userName={userName} userInitial={userInitial} activePage={page} onNavigate={setPage} />
      </div>

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ─── TOPBAR ──────────────────────────────────────────
            Fixed-height bar: sidebar toggle · breadcrumb · date ·
            critical badge · dark-mode · font-size · help · user chip. */}
        <div style={{ height: 46, background: dark ? '#1e293b' : '#fff', borderBottom: `1px solid ${dark ? '#334155' : '#dde3ed'}`, display: 'flex', alignItems: 'center', padding: '0 12px 0 16px', gap: 10, flexShrink: 0 }}>

          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            style={{ width: 28, height: 28, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 6, background: dark ? '#0f172a' : '#f4f7fb', color: '#64748b', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 150ms', fontFamily: 'inherit' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = dark ? '#1e293b' : '#e8ecf2' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = dark ? '#0f172a' : '#f4f7fb' }}>
            {sidebarOpen ? '◂' : '▸'}
          </button>

          {/* Breadcrumb */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              {page === 'admin' ? 'Admin' : 'Dashboard'}
            </span>
          </div>

          {/* Right-side controls */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#8899aa' }}>{today}</div>

            {criticalCount > 0 && (
              <div style={{ background: 'rgba(220,38,38,0.10)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 9999, padding: '3px 10px', fontSize: 11, fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                {criticalCount} critical
              </div>
            )}

            {/* Dark mode toggle */}
            <button
              onClick={() => setDark(d => !d)}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{ width: 28, height: 28, border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 6, background: dark ? '#0f172a' : '#f4f7fb', color: dark ? '#f1f5f9' : '#475569', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 150ms', fontFamily: 'inherit' }}>
              {dark ? '☀' : '☾'}
            </button>

            {/* ─── FONT SIZE CONTROL ─────────────────────────────
                Three 'A' buttons at increasing sizes. Active option
                is highlighted. Each click persists to localStorage. */}
            <div style={{ display: 'flex', border: `1px solid ${dark ? '#334155' : '#dde3ed'}`, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
              {(['small', 'medium', 'large'] as FontSize[]).map((s, i) => {
                const active = fontSize === s
                return (
                  <button
                    key={s}
                    onClick={() => applyFontSize(s)}
                    title={`${s.charAt(0).toUpperCase() + s.slice(1)} text`}
                    style={{
                      width: 26, height: 28,
                      border: 'none',
                      borderLeft: i > 0 ? `1px solid ${dark ? '#334155' : '#dde3ed'}` : 'none',
                      background: active ? (dark ? '#334155' : '#e2e8f0') : (dark ? '#0f172a' : '#f4f7fb'),
                      color: active ? (dark ? '#f1f5f9' : '#0f172a') : '#94a3b8',
                      cursor: 'pointer',
                      fontFamily: 'IBM Plex Sans, sans-serif',
                      fontWeight: active ? 600 : 400,
                      fontSize: s === 'small' ? 10 : s === 'medium' ? 12 : 15,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 150ms',
                      flexShrink: 0,
                    }}>
                    A
                  </button>
                )
              })}
            </div>

            {/* ─── RESET BUTTON ─────────────────────────────────
                Resets font size, dark mode, and column widths to
                defaults, then clears all preference localStorage
                keys. Subtle at rest; turns red on hover to signal
                a destructive-but-reversible action. */}
            <button
              onClick={resetPreferences}
              title="Reset to defaults"
              style={{
                width: 28, height: 28,
                border: `1px solid ${dark ? '#334155' : '#dde3ed'}`,
                borderRadius: 6,
                background: dark ? '#0f172a' : '#f4f7fb',
                color: '#94a3b8',
                fontSize: 15,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 150ms',
                fontFamily: 'inherit',
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color       = '#ef4444'
                e.currentTarget.style.borderColor = 'rgba(239,68,68,0.35)'
                e.currentTarget.style.background  = 'rgba(239,68,68,0.06)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color       = '#94a3b8'
                e.currentTarget.style.borderColor = dark ? '#334155' : '#dde3ed'
                e.currentTarget.style.background  = dark ? '#0f172a' : '#f4f7fb'
              }}>
              ↺
            </button>

            {/* ─── HELP LEGEND ──────────────────────────────────
                "?" button — opens a popover with a feature guide.
                Auto-shown on first login via localStorage flag. */}
            <HelpLegend dark={dark} />

            {/* ─── USER CHIP ────────────────────────────────────────
                Avatar, name, Change Password button, and sign out. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 8, borderLeft: `1px solid ${dark ? '#334155' : '#dde3ed'}` }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                {userInitial}
              </div>
              <span style={{ fontSize: 12, color: dark ? '#94a3b8' : '#475569', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {userName}
              </span>
              <button
                onClick={() => setShowChangePw(true)}
                style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = dark ? '#e2e8f0' : '#1e293b' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8' }}>
                Password
              </button>
              <button
                onClick={logout}
                style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8' }}>
                Sign out
              </button>
            </div>
          </div>
        </div>

        {/* ─── PASSWORD EXPIRY BANNER ──────────────────────────
            Shown when the user's password expires within 7 days.
            Prompts them to change it before it forces a change. */}
        {pwExpiryDaysLeft !== null && (
          <div style={{
            background: pwExpiryDaysLeft <= 1 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
            borderBottom: `1px solid ${pwExpiryDaysLeft <= 1 ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
            padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12,
          }}>
            <span style={{ color: pwExpiryDaysLeft <= 1 ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>
              {pwExpiryDaysLeft <= 0
                ? 'Your password has expired.'
                : `Your password expires in ${pwExpiryDaysLeft} day${pwExpiryDaysLeft !== 1 ? 's' : ''}.`}
            </span>
            <span style={{ color: dark ? '#94a3b8' : '#64748b' }}>Change it now to avoid being locked out.</span>
            <button
              onClick={() => setShowChangePw(true)}
              style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', background: pwExpiryDaysLeft <= 1 ? '#ef4444' : '#f59e0b', color: '#fff', fontFamily: 'inherit' }}>
              Change Password
            </button>
          </div>
        )}

        {/* ─── SCROLLABLE CONTENT ───────────────────────────────
            Renders the active page. Admin is only accessible when
            the user's role is 'admin'; others see an access error. */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: 20, minWidth: 0 }}>
          {page === 'dashboard' && (
            <DashboardHome
              projects={projects} loading={loading} error={error} dark={dark}
              containerRef={containerRef} startResize={startResize}
            />
          )}
          {page === 'admin' && (
            user?.role === 'admin'
              ? <Admin dark={dark} />
              : (
                <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 14, color: '#94a3b8' }}>
                  You do not have permission to access Admin. Contact your administrator.
                </div>
              )
          )}
        </div>
      </div>
    </div>

    {/* ─── FORCE PASSWORD CHANGE ───────────────────────────────
        Non-dismissible overlay rendered when the server requires the
        user to set a new password before accessing any content. */}
    {user?.forcePasswordChange && <ForcePasswordChange dark={dark} />}

    {/* ─── CHANGE PASSWORD MODAL ───────────────────────────────
        Voluntary change — opened via the topbar Password button or
        the expiry warning banner. Dismissible. */}
    {showChangePw && !user?.forcePasswordChange && (
      <ChangePasswordModal dark={dark} onClose={() => setShowChangePw(false)} />
    )}

    {/* ─── RESET TOAST ─────────────────────────────────────────
        Confirmation message after "Reset to defaults". Outside
        the zoom div so coordinates are physical-viewport-relative.
        top:62 clears the topbar at every zoom level (46px × 1.15
        max = 52.9px + comfortable gap). pointerEvents:none so it
        never blocks clicks beneath it. Auto-dismisses after 2.5s. */}
    {toastVisible && (
      <div style={{
        position: 'fixed',
        top: 62,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#0d1117',
        border: '1px solid rgba(34,197,94,0.28)',
        borderRadius: 8,
        padding: '9px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        zIndex: 9999,
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        fontFamily: 'IBM Plex Sans, sans-serif',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}>
        <span style={{ color: '#22c55e', fontSize: 14, lineHeight: 1 }}>✓</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#f1f5f9' }}>
          Settings reset to defaults
        </span>
      </div>
    )}
    </>
  )
}

export default App
