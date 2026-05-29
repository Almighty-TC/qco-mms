# QCO MMS - Claude Context & Build Tracker
Last updated: 2026-05-29
Last commit: (pending — see session 12 below)

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

## GLOBAL RULES

### Toast Rule (ALL modules — permanent)
All save, create, update, delete, deactivate and reactivate actions MUST show
a toast notification confirming the result. Use the shared `useToast` hook
(`src/hooks/useToast.ts`) and `ToastContainer` (`src/components/Toast.tsx`).
- Success toast (green, 3s): confirm the action with the item name
- Error toast (red, 5s): show the specific API error message, never "Save failed"
- Warning toast (amber, 4s): for deactivate actions
- Load errors (tab data failing to fetch) stay as inline banners (not toasts)
- Form validation errors (client-side) stay in the modal form (not toasts)

### Help Modal Rule (ALL modules — permanent)
Whenever any feature, column, filter, colour coding or behaviour is added or
changed in any screen, the ℹ help modal for that screen MUST be updated in the
same commit to reflect the change. This applies to every module built going
forward (Procurement, Expediting, VDRL, Logistics, etc.).

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
- Full schema audit complete (session 12): 39 changes applied, 31 tables total
- qmat_schema.sql exported (mysqldump --no-data, 899 lines, all 31 tables)

## DB SCHEMA STATUS (session 12 — authoritative)
All tables verified and patched via server/scripts/migrate-full-schema.js (idempotent).

### Tables created (were missing):
- `supplier_addresses` — normalised supplier address rows (type, line1/2, city, state, postcode, country)
- `user_project_access` — project-level access control (UNIQUE user_id+project_id; view/edit/manage)

### Columns added:
- `warehouses`: city, postcode, country (VARCHAR 100/20/100)
- `units_of_measure`: created_by (INT FK→users), updated_at (auto-update)
- `acronyms`: created_by (INT FK→users), updated_at (auto-update)
- `inco_terms`: created_by (INT FK→users), updated_at (auto-update)
- `notifications`: related_entity_type (VARCHAR 50), related_entity_id (INT)
- `audit_log`: entity_type, entity_id, before_value (JSON), after_value (JSON), reason_category, reason_detail
- `purchase_orders`: supplier_id (FK→suppliers), inco_term_id (FK→inco_terms), warehouse_id (FK→warehouses)
  (vendor_name/vendor_code kept for backwards compat)
- `po_lines`: uom_id (FK→units_of_measure), unit_price (DECIMAL 15,4),
  total_price (GENERATED STORED = qty * unit_price) — uom varchar kept for backwards compat

### Foreign keys added:
warehouses.created_by, units_of_measure.created_by, acronyms.created_by, inco_terms.created_by,
suppliers.created_by, audit_log.user_id, user_wbs_access.created_by, password_history.user_id,
po_lines.uom_id, purchase_orders.supplier_id/inco_term_id/warehouse_id

### Unique indexes added:
- role_permissions: UNIQUE KEY uq_role_module (role, module)
- user_wbs_access: UNIQUE KEY uq_wbs_access (user_id, project_id, wbs_code)

## NEXT SESSION - START HERE

1. Visual test at 1440/1280/1024/768px — check sticky header and table widths
2. Admin module can be marked ✅ Complete once visual testing passes
3. Next module: Procurement (PO list, add PO, supplier/WBS linkage)
   — read QMAT-prototype.html and WIREFRAME_INVENTORY.md first
   — purchase_orders now has supplier_id FK + inco_term_id FK + warehouse_id FK
   — po_lines now has uom_id FK + unit_price + total_price (GENERATED)

## DB DATA STATUS (session 10)
- 4 Project Team dummy users added (is_external=0, company != 'QCO Group'):
  IDs 60-63: James O'Connor (project_manager, Pilbara Gas Co),
  Sarah Lim (project_director, Hunter Valley Energy),
  David Nguyen (viewer, Ord River Authority),
  Michelle Park (project_manager, Port Hedland LNG)

## DB DATA STATUS (session 5)
- 4 external dummy users added: john.doe, mary.jones (expired), peter.chan, lisa.park (expiring soon)
- 21 internal QCO Group users got contract_start = 2024-01-01
- Total users now: ~35

## DESIGN NOTES (session 4)
- ActionMenu: portal-rendered dropdown (zIndex 9100), module-level _closeActive for
  single-open coordination. All actions columns are 90px noResize.
- PermissionsTab sticky header: position:sticky top=headerHeight wraps mode toggle +
  selector row. Content (tables, legends) scrolls below.
- Override cycle: admin-role users skip 'restrict' (inherit → grant → inherit only).
- Override legend below matrix; base role dot is 12px (was 8px).
- Reset to role defaults: DELETE /permissions/user/:userId — clears all overrides.

## USER MANUAL STATUS
See docs/USER_MANUAL_STATUS.md

## SESSION HISTORY

### Session 2026-05-29 (session 12)
Fixed in this session:
- server/scripts/migrate-full-schema.js (new, run ✓):
  - Full idempotent schema migration — 39 changes applied across all tables
  - Created missing tables: supplier_addresses, user_project_access
  - Added missing columns to: warehouses, units_of_measure, acronyms, inco_terms,
    notifications, audit_log, purchase_orders, po_lines
  - Added missing FKs to: warehouses, units_of_measure, acronyms, inco_terms,
    suppliers, audit_log, user_wbs_access, password_history, po_lines, purchase_orders
  - Added UNIQUE KEY uq_role_module on role_permissions (role, module)
  - Added UNIQUE KEY uq_wbs_access on user_wbs_access (user_id, project_id, wbs_code)
- qmat_schema.sql (new): full schema export via mysqldump --no-data (31 tables, 899 lines)
- CLAUDE_CONTEXT.md: added DB SCHEMA STATUS section, updated NEXT SESSION

### Session 2026-05-29 (session 11)
Fixed in this session:
- src/hooks/useToast.ts (new):
  - ToastProvider + useToast hook; context-based shared state
  - addToast(type, message): auto-dismisses at 3s/4s/5s for success/warning/error
  - dismiss(id): manual dismiss on ×
- src/components/Toast.tsx (new):
  - ToastContainer: portal-rendered fixed top-right stack
  - Green/amber/red backgrounds; ✓/⚠/✕ icons; × dismiss button
- src/pages/Admin.tsx:
  - Admin export: wrapped with ToastProvider, ToastContainer rendered inside
  - ALL 10 tab functions: added useToast() + addToast calls on every
    save/create/update/delete/deactivate/reactivate/reset action
  - PermissionsTab: removed success/overrideSuccess states + inline renders
    (replaced by toasts); saveRole/saveUserOverrides/resetToRoleDefaults all toast
  - SystemSettingsTab: removed saved/saveErr/testResult/testError states
    (replaced by toasts); saveAll and sendTest both toast
  - Silent error catches (reactivate, markRead, deleteNotification) now toast errors
  - Form save API errors: addToast('error', msg) in addition to setFormErr
- server/scripts/seed-project-team-assignments.js (new, run ✓):
  - 4 user_wbs_access rows inserted (wbs_code='ALL'):
    James O'Connor → PRJ-2024-001, Sarah Lim → PRJ-2024-002,
    David Nguyen → PRJ-2023-008, Michelle Park → PRJ-2025-001
- CLAUDE_CONTEXT.md: added Toast Rule to GLOBAL RULES

### Session 2026-05-29 (session 10)
Fixed in this session:
- src/pages/Admin.tsx (PermissionsTab — definitive permission dots fix):
  - Root cause: `effectiveRolePermsLookup` depended on `userRole` state set by an
    async API call. If the call failed or server was stale, `userRole` stayed ''
    and all dots rendered grey.
  - Fix: added `selUserRole` useMemo that derives the selected user's role directly
    from `usersList` (already synchronously populated). Dots are now computed from
    `lookup[selUserRole]` (global perms, loaded on mount) — zero async dependency.
  - Removed `rolePerms` state, `rolePermsLookup` memo, and the second API call
    (GET /permissions/role) from loadUserOverrides — no longer needed.
  - Updated `cycleOverride`, role banner, and override matrix render to use `selUserRole`.
- server/scripts/seed-project-team-users.js (new, run ✓):
  - 4 Project Team users inserted (is_external=0, company != 'QCO Group')
  - IDs 60-63: James O'Connor, Sarah Lim, David Nguyen, Michelle Park

### Session 2026-05-29 (session 9)
Fixed in this session:
- src/pages/Admin.tsx (UsersTab):
  - User type filter: switched from backend param to CLIENT-SIDE filtering via
    filteredRows useMemo. Removed filterType from load() deps and params.
    load() now uses limit=200 to pre-load all users for reliable client filtering.
    filteredRows conditions: qco (company='QCO Group' && !isExternal),
    project_team (!isExternal && company≠'QCO Group'), external (isExternal).
    Count display: "N of M users" when filter active.
  - External legend: updated label text; references filteredRows (not rows)
- src/pages/Admin.tsx (PermissionsTab):
  - loadUserOverrides: split into two separate try-catch blocks; each failure
    logs to console.error instead of silently swallowing. Role var extracted
    before await so second call still runs if first succeeds.
  - effectiveRolePermsLookup: falls back to global lookup[userRole] when
    rolePermsLookup is empty (e.g. if /permissions/role call fails).
  - basePerm uses effectiveRolePermsLookup; admin role special-case restored:
    admin always shows green dots (except wbs_scoped which is always false).
- src/pages/Admin.tsx (UsersTab help modal):
  - External Users section: added orange border description
  - New "User Type Filter" section: explains all 4 filter options
  - Column Reference: updated Name entry (orange border = external, no badge);
    Contract End entry: full colour-coding legend (red/amber/green/dash)
- CLAUDE_CONTEXT.md: added GLOBAL RULES section with Help Modal Rule

### Session 2026-05-29 (session 8)
Fixed in this session:
- server/scripts/migrate-is-external.js (new, run ✓):
  - ALTER TABLE IF NOT EXISTS is_external TINYINT(1) DEFAULT 0
  - UPDATE: 6 users updated to is_external=1 (Hans Mueller, James Wilson, Emma Davis,
    Sophie Kim, Raj Patel, Mei Lin — all had external roles but flag was 0)
  - All 10 external-role users now correctly flagged
- server/scripts/seed-role-permissions.js (new, run ✓):
  - Deleted 150 stale rows; inserted 160 correct rows (16 roles × 10 modules)
  - subcontractor role added (was missing from original seed)
  - Permissions match the canonical spec exactly (wbs_scoped=0 for all)
- server/routes/admin.js:
  - Added 'subcontractor' to VALID_ROLES
  - GET /users (list + single): DATE_FORMAT(contract_start/end, '%Y-%m-%d') so dates
    return as plain 'YYYY-MM-DD' strings not JS Date objects (fixes UTC timezone
    offset showing dates 1 day behind for servers in UTC+10)
- src/pages/Admin.tsx:
  - Added 'subcontractor' to ALL_ROLES constant
- Contract End column: CONFIRMED in code (U_COLS line 300, row cell line 650-656)
  and API (DATE_FORMAT now returns clean 'YYYY-MM-DD' strings). If not visible,
  scroll right — table is ~1700px wide. Click ↺ to reset column widths.
  Most internal users show '—' (no contract_end set) — this is expected.

### Session 2026-05-29 (session 7)
Fixed in this session:
- server/routes/admin.js:
  - GET /permissions/role?role=... new endpoint — returns role_permissions rows for
    a single role; admin role synthesises full access (no DB rows for admin)
- src/pages/Admin.tsx (PermissionsTab):
  - Added rolePerms state + rolePermsLookup memo (replaces lookup[userRole] approach)
  - loadUserOverrides: second API call GET /permissions/role?role=... after getting
    user's role; stores result in rolePerms. Admin role now shows green dots correctly.
  - basePerm = rolePermsLookup[mod] (was lookup[userRole]?.[mod] — was empty for admin)
  - User selector onChange: now also resets rolePerms([]) alongside userOverrides({})
- src/pages/Admin.tsx (UsersTab):
  - EXT indicator: borderLeft → boxShadow: inset 3px 0 0 #E84E0F (immune to
    overflow:clip clipping; legend icon updated to match)
- src/pages/Admin.tsx (SuppliersTab):
  - filterCountry state + countries memo (unique sorted list from rows)
  - Country dropdown added to toolbar (only renders when >0 countries exist)
  - filtered() checks filterCountry against s.country

### Session 2026-05-29 (session 6)
Fixed in this session:
- Admin.tsx (UsersTab):
  - Actions column 90→120px (was too narrow for ActionMenu button)
  - EXT badge removed; replaced with 3px #E84E0F left border on Name cell for external users
  - Orange border legend added below Users table
  - User type filter: "Internal only / External only" → "QCO Team / Project Team / External"
    filterExt → filterType state; load() sends user_type param to backend
- server/routes/admin.js:
  - GET /users: added user_type param (qco | project_team | external)
    project_team = is_external=0 AND company != 'QCO Group'
- Admin.tsx (PermissionsTab):
  - AllRolesOverview: new resizable-column <table> component replacing div-grid
    overflow:clip (sticky thead works); useColumnResize hook; OvDragHandle inline
    4-char module headers with full name tooltip; cell tooltip lists granted permissions
    ↺ reset button next to heading; dots are 6px green per granted permission
  - DESIGN: sticky thead uses overflow:clip like AdminTable (not overflow:auto which
    would break sticky by creating a Y-axis scroll container)

### Session 2026-05-29 (session 5)
Fixed in this session:
- ActionMenu.tsx: added dropRef (ref on portal div) — mousedown handler now checks
  dropRef.current.contains(target) before closing; prevents menu closing before
  item onClick fires (mousedown fires before click event)
- Admin.tsx (PermissionsTab):
  - stickyRef + ResizeObserver to measure sticky header height → stickyH
  - AdminTable top = (headerHeight ?? 0) + stickyH (table thead sticks below selector)
  - Sticky header background: explicit dark ? '#0f172a' : '#f1f4f8' (was 'inherit')
  - zIndex 10 → 20 on sticky header
  - baseVal = userRole === 'admin' ? true : existing logic (admin dots now green)
- Admin.tsx (UsersTab):
  - Contract End cell: color coded — red if expired, amber if ≤30 days, green if >30 days
- seed-external-users.js: 4 external users + contract_start on 21 internal users (run ✓)

### Session 2026-05-29 (session 4)
Fixed in this session:
- src/components/ActionMenu.tsx: new component — portal-rendered Actions ▾ dropdown,
  single-open coordination via module-level _closeActive, keyboard (Escape) + outside-
  click close, variant colours (warning=amber, danger=red)
- Admin.tsx:
  - All 8 action-bearing tabs converted to ActionMenu (Users, Suppliers, Warehouses,
    UoM, Acronyms, INCO Terms, Projects, Notifications)
  - div-in-tr StatusPill fixed in WarehousesTab, UoM, INCO Terms, NotificationsTab
  - reactivate() added to UoM and INCO Terms tabs
  - PermissionsTab:
    - Mode toggle + selector row now sticky (position:sticky, top=headerHeight)
    - User selector moved inside sticky header; roles selector also sticky
    - Base role dot enlarged 8→12px; cycle skip 'restrict' for admin-role users
    - Legend added below override matrix
    - "Reset to role defaults" button → SimpleConfirmModal → DELETE /permissions/user/:id
- server/routes/admin.js:
  - PATCH /projects/:id/status (deactivate/reactivate projects)
  - DELETE /permissions/user/:userId (reset all overrides for a user)

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
