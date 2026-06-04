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

## UI

- **Modals render at scale 1 — they don't grow with the S/M/L accessibility zoom**
  (fully visible and centered, but not scaled with zoom). All modals portal to
  `document.body` to escape the app's `zoom` wrapper (commit 2f773df, fixes the
  non-default-zoom clipping), which means they sit outside the zoomed coordinate
  space and stay at 100%. Making modals zoom-aware is a separate, larger change
  (scale the card with compensated dimensions, e.g. width/height ÷ scale, so it
  grows with the setting without re-introducing the fixed-position clipping).
