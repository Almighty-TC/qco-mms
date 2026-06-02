# HEAT / LOT TRACKING — PHASING PLAN
# QCO MMS — agreed 02 June 2026 (from cross-module discovery read-first)
# Companion to docs/HEAT_LOT_TRACKING_SPEC.md (the requirements). This file = the BUILD PLAN.
# Status: PLAN ONLY — no heat code written yet. Build phase-by-phase, each with its own go-ahead.

---

## CONTEXT / GROUND TRUTH AT PLANNING TIME

The stock surface is already HEAT-READY before any heat work begins:
- Receipting (rebuild Phases 1–4, committed/pushed) creates DISTINCT per-line warehouse_stock
  holdings (carry po_line_id / wbs_code / condition_status / trace_hold), never pooled.
- Transfers (stock-link fix, commit d51f1f3) splits holdings and carries identity to a distinct
  destination holding, never pools.
So heat number is addable as an ATTRIBUTE on already-distinct holdings — NO existing correct
behaviour needs reworking. The only NEW (additive, not corrective) behaviour is: receipting
split sub-lines (P2) and FMR-out issue-against-holding (P4a, absent entirely today).

KEY DISCOVERY: FMR-out does not decrement stock on issue today — there is no issue/consumption
step at all. Material can come in (receipting) and move (transfers) but never actually leaves
stock. This is a stock-integrity gap independent of heat. Decision (Thomas, 02 Jun): keep it
INSIDE the heat project, but split P4 into P4a (build issue + decrement, no heat) and P4b (add
heat selection on top) so the integrity fix and the heat feature verify independently.

---

## LOCKED DECISIONS (Thomas + claude.ai, 02 Jun)

1. CAPTURE LOCATION: a new `scn_heats` TABLE (one-to-many: an SCN shipment has many heats).
   NOT columns on scn_packages — a package/shipment can carry multiple heats (split case), which
   a column can't model honestly. The table is the source of valid heat values for dropdowns.

2. HOLDING LINK: a free `heat_number` VARCHAR on warehouse_stock (and carried onto receipt_lines,
   transfer destination holdings, fmr_lines). NOT a heat_id FK on every stock row.
   Rationale: scn_heats governs what's SELECTABLE (integrity at entry); the varchar travels
   cheaply through stock/transfer/issue without FK joins on every row. Best of both.

3. FMR-OUT: inside the heat project, split P4a (issue-against-holding + decrement, no heat) →
   P4b (strict heat selection on the now-working issue step). Proofs must SEPARATELY verify
   "decrement works" and "heat selection works" even if combined.

---

## DEFERRED DECISIONS (decide when the relevant phase is written, not now)

- OFF-LIST HEAT HANDLING (decide at P1/P2): if physical material arrives with a heat not on the
  declared SCN shipment list — strict (only declared heats selectable) vs exception-with-reason
  (allow off-list with a mandatory reason + flag).
- FMR-OUT ALLOCATION POLICY (decide at P4): user-picks-heat vs FIFO-by-heat vs oldest-first.

---

## PHASE BREAKDOWN (dependency-ordered)

### P0 — Stock heat attribute + read-through  [small, trivial risk; ships independently]
- Add `heat_number` VARCHAR (nullable) to warehouse_stock.
- Surface it: Stock Register column + the stock-take "Physical count" HEAT column (spec #5).
- Blank for now (no source until P1) but unblocks everything; independently shippable.
- Depends on: nothing.

### P1 — Upstream capture: scn_heats + SCN entry  [medium; the KEYSTONE]
- Create `scn_heats` table (keyed to SCN; fields: scn_id, heat_number, + room for mill cert ref /
  grade / qty-per-heat later).
- Add heat capture to CreateSCNWizard + the SCN create/package endpoints.
- Decide OFF-LIST handling here (or defer to P2 entry).
- Depends on: P0 (attribute target exists). Risk: the data-model is the keystone — everything
  downstream reads scn_heats; get it right once.

### P2 — Receipting heat entry: bulk + split  [medium-large; the trickiest]
- SCN-scoped heat dropdown sourced from scn_heats (spec #6).
- BULK mode: select multiple lines, enter/pick heat once, applies to all selected.
- SPLIT mode: click a line → expand to sub-lines → heat per sub-quantity → handler emits N
  distinct holdings (one per heat). heat_number onto receipt_lines.
- RISKIEST PART: split-line representation (one PO line → N receipt_lines) MUST keep the Phase
  1–4 received-to-date / partial-remainder / over-receipt math correct. Multiple receipt_lines
  per po_line is already structurally allowed (recommended over a separate breakdown table).
- Depends on: P0 + P1.

### P3 — Transfers carry heat  [small; minimal risk]
- Copy heat_number to the destination holding in the transfer split-move (one more attribute
  alongside condition/trace_hold/wbs/po_line_id).
- Show heat in the stock-line picker + transfer detail.
- Depends on: P0.

### P4a — FMR-out issue-against-holding + decrement (NO heat)  [large; new subsystem]
- Build the MISSING issue step: FMR-out consumes specific holdings, decrements qty_available
  (and qty), records qty_issued. This is greenfield — it does not exist today.
- Must respect the conserve/decrement invariants the rest of stock relies on; quarantine/
  trace_hold holdings excluded from issuable (as Phase 3 established).
- Decide ALLOCATION POLICY here.
- Depends on: P0 (+ real stock to issue). Riskiest: greenfield consumption logic touching the
  stock invariants — proven on its own BEFORE heat rides on top.

### P4b — FMR-out heat selection  [small-medium; thin add on P4a]
- Strict heat dropdown bound to the issued holding's heat; record heat_number on fmr_lines so
  heat travels OUT with the material.
- Depends on: P4a.

### P5 — Traceability linkage  [medium; mostly read]
- Traceability already has heat_ref on certs/versions (keyed by tag today). Join
  heat_number (holding) ⇄ heat_ref (cert) so a holding shows its certs/holds and vice-versa.
- Watch string-match fidelity / normalization.
- Depends on: P0 (+ ideally real heats from P1–P2).

---

## BUILD DISCIPLINE (same as the receipting/transfers work)
Each phase: read-first confirm → implement → rolled-back proofs against project 1 (never mutate
canonical demo data) → hold for review → commit + push. Backup at step 0. Pooled connection only.
Keep holdings DISTINCT (never pool). Show ALTERs before running.

*Captured 02 June 2026. Update as phases complete and deferred decisions are made.*
