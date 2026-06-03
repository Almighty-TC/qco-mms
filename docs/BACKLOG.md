# QMAT — Backlog

Tracked technical debt / future work. Newest first.

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
