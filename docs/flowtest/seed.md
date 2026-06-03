# ZZ_FLOWTEST — Seed generator (seed.cjs)
Run from `server/` (loads server/.env): `node ../docs/flowtest/seed.cjs [smoke|full|teardown]`.
- **Idempotent**: teardown-first; re-runnable. All data under project code `ZZ_FLOWTEST`; users `@zzflowtest.example`; suppliers/warehouses `ZZF-*`.
- **FK order**: project → warehouses → users(+wbs scope) → WBS → commodities → equipment → suppliers → MTO(+revs A/B/C, lines) → POs(+lines, heat_number_required subset) → SCNs(+packages, heats) → warehouse_stock(heat) → transfers → FMRs(+lines) → certs(heat_ref).
- **Volumes (full)**: WBS 500, commodity 1000, equipment 400, suppliers 30, MTO 6/~3300 lines, PO 40/~600 lines, SCN 150, stock 800, transfers 30, FMR 25, certs 300. (Scaled from spec ranges for single-run reliability; complex linked entities kept lighter, heat chains kept at 50 as specified.)
- **Heat chains**: ≥50 good end-to-end (SCN heat ↔ stock heat ↔ cert heat_ref, case-insensitive). **Edge cases**: (a) heat-required PO line `EDGE-A` with NO heat; (b) receipt heat `ZZH-MISMATCH-XYZ` ≠ SCN; (c) stock `ZZH-ORPHAN-NOCERT` with no cert; (d) transfers carry heat both legs.
- **Auto-checkpoint**: smoke = 10/table + asserts (FK zero-orphan, ≥1 chain, users) → proceed to full.
- **Teardown**: `node ../docs/flowtest/seed.cjs teardown` (also `scripts/flowtest_teardown.sql`); verifies canonical project/user counts unchanged.
