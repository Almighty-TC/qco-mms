# QCO MMS - Claude Context & Build Tracker
Last updated: 2026-05-29
Last commit: (pending — see session 3 below)

## MODULE STATUS
- Login: ✅ Complete
- Dashboard: ✅ Complete
- Admin: 🔨 In Progress (visual QA remaining)
- All other modules: ⏳ Not started

## ADMIN MODULE - OUTSTANDING ISSUES

### Layout & Scroll
- [ ] Responsive layout: test at 1440/1280/1024/768px widths (visual test only)
- [ ] Verify sticky thead stays behind sticky admin-header-wrap at all zoom levels

### Table UX
- [ ] Toolbar ↺ reset button position: currently inside last th (table header),
      not left of + Add button in toolbar — visually correct but position differs from spec

### DB Connectivity (all confirmed wired to MySQL):
- ✅ Users & Roles: full CRUD via /api/admin/users
- ✅ Permission Matrix (roles): GET/PUT /api/admin/permissions
- ✅ Permission Matrix (user overrides): GET/POST /api/admin/permissions/user/:userId
- ✅ Suppliers: full CRUD via /api/admin/suppliers
- ✅ Warehouses: full CRUD via /api/admin/warehouses
- ✅ Units of Measure: full CRUD via /api/admin/uom
- ✅ Acronyms: full CRUD via /api/admin/acronyms
- ✅ INCO Terms: confirmed — routes at /api/admin/inco-terms (admin.js line 1328)
- ✅ Projects: full CRUD via /api/admin/projects
- ✅ Notifications: GET/PUT(read)/DELETE via /api/admin/notifications
- ✅ System Settings: GET/PUT via /api/admin/system-settings

## DECISIONS MADE

### Architecture
- Fixed-position layout: topbar (z:100), sidebar (z:90), main content (z:1)
  Main content is `position:fixed; overflow:auto` — the ONLY scroll container
- AdminTable: single <table> with sticky <thead top={headerHeight}> 
  overflow:clip on outer div — preserves border-radius, does NOT create BFC,
  so position:sticky on thead works relative to main content scroll container
- Flex column: AdminCol with flex:true — colgroup uses <col /> (no width) until
  user drags it; after drag, explicit width applied. All tabs have one flex column.
- canDrag = !col.noResize (flex columns are NOW resizable)
- Sticky top measurement: use element.offsetHeight (CSS pixels) NOT
  getBoundingClientRect().height (viewport pixels) to avoid zoom mismatch
- AuthContext uses lazy useState initialiser to set axios defaults before
  first render (fixes "no token" race condition on page load)
- All Admin API calls use axios global default header (set in AuthContext)
  — no per-call Authorization headers needed

### Design
- Column drag handle: 1px grey divider at rest, 6px transparent hit target
  that turns #E84E0F at 0.6 opacity on hover. ALL columns (incl flex) resizable.
- Tab bar: overflowX:auto so all 10 tabs stay visible at any width
- Modals: portal-rendered to document.body so zoom CSS doesn't affect position
- ↺ reset button: inside last th, absolutely positioned right edge, appears on all tables
- Tab order: users → permissions → suppliers → warehouses → uom → acronyms →
  incoterms → projects → notifications → settings
- Suppliers tab: client-side search + status filter dropdown

### DB / Backend
- bcrypt hash `$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi`
  used for all seeded test users (password = "password")
- Password change: 5-hash history enforced; complexity: 8+ chars, upper,
  lower, digit, special; expiry: 90 days internal / 365 days external
- audit_log table: created — audit() in admin.js + change-password in auth.js
  both insert with graceful fallback to console
- user_permission_overrides: UNIQUE KEY uq_user_module (user_id, module) added
  — ON DUPLICATE KEY UPDATE now works correctly
- projects table: client, start_date, end_date columns added via migration
- 27 users total in DB; project-scoped roles have user_wbs_access rows

## NEXT SESSION - START HERE

1. Visual test at 1440/1280/1024/768px — check sticky header and table widths
2. Admin module can be marked ✅ Complete once visual testing passes
3. Next modules to build: Procurement (PO list, add PO, supplier/WBS linkage)
   — read QMAT-prototype.html and WIREFRAME_INVENTORY.md first

## USER MANUAL STATUS
See docs/USER_MANUAL_STATUS.md

## SESSION HISTORY

### Session 2026-05-29 (session 3)
Fixed in this session:
- AdminTable.tsx: canDrag = !col.noResize (flex columns now resizable);
  colgroup: flex col uses <col /> until dragged, then explicit width;
  DragHandle: 6px wide, transparent at rest, #E84E0F @0.6 opacity on hover
- Admin.tsx:
  - UsersTab load(): accepts s=search param to fix stale closure on clear/type
  - PermissionsTab loadUserOverrides: data.role → data.user?.role (fix save bug)
  - SuppliersTab: added search input + status filter dropdown (client-side);
    fixed div-in-tr for Addresses and Status cells → AdminCell
  - ProjectsTab: fixed div-in-tr for Code cell and POs/Risk/Breach cells → AdminCell
- server/scripts/migrate-projects-columns.js: adds client, start_date, end_date
  to projects table (run and confirmed successful)
- server/scripts/migrate-permissions-unique.js: adds UNIQUE KEY uq_user_module
  on user_permission_overrides (run and confirmed successful)
- server/scripts/seed-dummy-users.js: run — 9 users inserted
- server/scripts/seed-users-projects.js: new — 8 more users + WBS assignments
  + project client/date/RAG data (run and confirmed successful)

### Session 2026-05-29 (session 2)
Fixed in this session:
- AdminTable.tsx: rewrote as single table with sticky thead; overflow:clip on
  outer div; flex column support; ↺ reset button in last th; title prop on AdminCell
- useColumnResize.ts: min-width default 60 → 40
- Admin.tsx: 
  - Tab order: permissions moved to 2nd position
  - All column defs: one flex column per table (fills remaining width)
  - UsersTab: fixed div→td for Name, Role, Status, ProjectsCell cells
  - ProjectsCell: now renders <td> (was invalid <div> inside <tr>)
  - PermissionsTab: converted roles + user-override grids to AdminTable
  - headerHeight measurement: getBoundingClientRect().height → offsetHeight
- admin.css: added background:inherit to .admin-page (fixes sticky header background)
- admin.js: audit() now inserts to audit_log table (graceful fallback to console)
- auth.js: change-password route now writes to audit_log
- server/scripts/migrate-audit-log.js: new migration for audit_log table

### Session 2026-05-29 (session 1)
Fixed in this session:
- App.tsx: converted to fixed-position layout (topbar/sidebar/main content)
- AdminTable.tsx: rewrote as split header+body tables with colgroup widths
- AuthContext.tsx: lazy initialiser for axios token (race condition fix)
- Admin.tsx: all 10 tabs converted to AdminTable; toolbar flexWrap fixed;
  Permission Matrix user-override mode added; help modals added
- admin.css: global spacing tokens
- seed-dummy-users.js: one user per previously-empty role added
- Column dividers: orange replaced with subtle grey; orange only on drag hover
