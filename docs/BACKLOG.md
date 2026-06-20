# QMAT — Backlog

Tracked technical debt / future work. Newest first.

## Security / RBAC

- **`role_permissions.wbs_scoped` column is now vestigial.** After the WBS-scope
  convention flip (Stage 3), external project-scope is driven solely by `is_external`
  via `requireProjectScope` (router.param). The `wbs_scoped` flag is no longer read as
  a scope trigger anywhere — the dead in-line check in `requirePermission` was removed.
  The column + its 3 rows (fmr/site_contractor, fmr/subcontractor, wbs/site_contractor)
  are left in place (harmless, still surfaced/editable in the Permission Matrix admin
  UI) rather than dropped (destructive). **Future DB cleanup (optional):** drop the
  `wbs_scoped` column and its references in seed scripts + the admin matrix CRUD/UI.

- **External cross-project leak via `/pos/:id`.** Stage 1 of the WBS-scope flip
  enforces external project-scope via `router.param('projectId', requireProjectScope)`
  on all 12 project-bearing routers — but the `/api/procurement/pos/:id/...` family
  is keyed on the PO id, **not** `:projectId`, so the param scope never fires for it.
  A vendor (`procurement.can_view`) can therefore still `GET /api/procurement/pos/<any id>`
  regardless of which projects they're granted. **Fix (Stage-1 follow-up):** resolve
  `po → project_id` then apply the same scope check, **or** restrict vendors to POs of
  their own supplier (needs a vendor↔supplier-PO access design decision). Deliberately
  out of scope for the Stage 1 gate (see `server/middleware/permissions.js`
  `requireProjectScope`).

## Schema

- **No MTO→PO foreign key.** `po_lines` has no reference to the `mto_line` it
  fulfils (no `mto_line_id`/source column). This limits MTO-to-delivery
  traceability end-to-end, and is the reason the dashboard pipeline funnel cannot
  chain the **demand → PO-raised** stage — "MTO demand" is shown as a separate
  upstream bar rather than a funnel parent (see
  `server/routes/dashboard.js` pipeline derivation, commit 68e7420).
  *Consider adding `po_lines.mto_line_id` (FK → `mto_lines.id`) so a line can be
  traced demand → PO → expedite → ship → receive → issue.* Once present, the funnel
  can chain the top stage and MTO-to-delivery reporting becomes possible.

## UI

- **Modals render at scale 1 — they don't grow with the S/M/L accessibility zoom**
  (fully visible and centered, but not scaled with zoom). All modals portal to
  `document.body` to escape the app's `zoom` wrapper (commit 2f773df, fixes the
  non-default-zoom clipping), which means they sit outside the zoomed coordinate
  space and stay at 100%. Making modals zoom-aware is a separate, larger change
  (scale the card with compensated dimensions, e.g. width/height ÷ scale, so it
  grows with the setting without re-introducing the fixed-position clipping).
