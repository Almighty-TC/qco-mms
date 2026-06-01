# HEAT / LOT TRACKING — SPEC
# QCO MMS — captured 02 June 2026
# Status: SPEC ONLY — not built. Backlog. Scheduled AFTER receipting rebuild Phases 1–4,
# as its own mini-project that BEGINS with a read-first across stock / FMR / transfers /
# traceability / SCN-creation in Expediting.

## WHY THIS MATTERS
Heat number is a first-class material identity for capital-infrastructure traceability. It is
not a receipt-time annotation — it travels with the physical material through every movement and
must be traceable end to end. A heat field that does not travel, or stock that pools across
heats, is worse than nothing: it implies traceability the system cannot deliver. Cross-cutting:
Material Control (stock, receipting, transfers, FMR-out), Expediting (SCN creation — where heats
enter), Traceability (certs/holds key against heat/material identity).

## REQUIREMENTS
1. Heat number travels with the goods end-to-end: receipt → warehouse grid/bin location →
   transfer → FMR-out (issue). Stays attached to the specific material it identifies at each stage.

2. Receipting — confirm/enter heat, two entry modes:
   - Bulk (one heat for the lot): select multiple items/lines, enter/pick the heat ONCE, applies
     to all selected.
   - Split (one line, multiple heats): click a line of qty X, it expands into sub-lines, heat
     entered per sub-quantity (e.g. 320 m → 200 m heat A + 120 m heat B).

3. Stock tracked at heat/lot granularity — NO pooling across heats. Each distinct heat is its own
   stock holding, even same item + same location, because it is traceably different material.
   - CONFIRMED HELD (Phase 3, proven live 02 Jun): receipting creates stock as per-receipt-line
     DISTINCT holdings, never pooled into shared item+location rows. One received line split into
     two separate warehouse_stock rows (good 175 / quarantine 5), each carrying its own
     po_line_id. So heat number later becomes an attribute on an already-distinct holding — no
     retroactive row-split needed. Constraint intact going into the heat mini-project.

4. Entry by SELECTION not free-typing, wherever possible (typo avoidance):
   - Downstream (FMR-out, transfers, stock-take): STRICT dropdown bound to heats that actually
     exist on the stock holding being acted on. No free typing.
   - At receipting: dropdown scoped to heats within the SAME SCN shipment (see #6).
   - Consider a vendor-format sanity-check (length/char pattern) as a secondary guard on any path
     that allows new entry.

5. Stock-take heat column: the physical-count screen needs a heat number column so identical-
   looking rows are disambiguated by heat. SAME underlying heat/lot data, surfaced on stock-take.
   (Originated as a stock-take UI request; folded in — same model.)

6. Receipting heat dropdown scoped to the SCN shipment: populated from the heat numbers within
   the same SCN shipment (heats declared on that shipment's packing list / mill certs). Makes the
   picker typo-proof AND truthful (can't assign a heat from another shipment).
   - UPSTREAM GAP (confirmed from read-firsts 02 Jun): the dropdown source does NOT exist yet.
     scn_packages has NO heat column (only id, package_number, description, dims, weights, DG
     fields, marks_numbers). po_lines DOES have heat_number + heat_number_required, but that is
     PO-LINE level (populated in Expediting), NOT a per-shipment heat list keyed to the SCN's
     packing list / mill certs. So the heat mini-project must ADD per-SCN heat capture at SCN
     creation (Expediting) so the receipting dropdown has a source. This is the upstream half of
     "heat travels with the goods": enters at the shipment, selected at receipt, travels onward.
     (Real assessment belongs in the scheduled read-first; this is what was observed in passing.)

## OPEN QUESTIONS / EDGE CASES (decide during the mini-project, not before)
- Heat not on the declared shipment list (paperwork mismatch): strict (only declared heats) vs
  exception-with-reason (allow off-list heat with mandatory reason + flag).
- FMR-out heat selection policy: user-picks-heat vs FIFO-by-heat vs oldest-first-enforced.
- Traceability linkage: how heat on a holding connects to the Traceability module's certs/holds
  (heat is presumably the join key).
- Transfers: the queued transfers stock-link fix must carry heat through a move once heat exists;
  sequence transfers to be heat-aware or to follow heat.
- Partial quarantine resolution (noted in Phase 3): resolve is currently whole-holding; partial
  release/reject of a quarantined holding is a later disposition enhancement.

## SEQUENCING
Finish receipting Phases 1–4 first. Then heat/lot as its own mini-project, beginning with a
read-first across warehouse_stock / FMR / transfers / traceability / SCN-creation in Expediting,
before any code.

*Captured from working session 02 June 2026. Update as decisions are made.*
