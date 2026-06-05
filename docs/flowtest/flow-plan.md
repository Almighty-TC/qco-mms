# ZZ_FLOWTEST — Flow plan (read-only; record PASS/FAIL/LOGIC-GAP; FIX NOTHING)
Results columns: Module | Step | Expected | Actual | Verdict | Evidence.
Cross-cutting every module: bad payload → clean 4xx + ZERO mutation (not 500/partial); no parent-with-dependents delete w/o validated path; permissions enforced (contractor scoped, no admin/proc writes; viewer read-only; auditor view+audit only); every create/edit/remove writes audit_log row WITH project_id; approved/locked POs resist edits.
1. WBS — CRUD; parent delete Impact→Reallocate→Confirm + guards; bulk upload (reject bad parent/dup/cyclic); A1 depth-filter leak still? locked-PO-linked node refuses delete.
2. Commodity — CRUD; dup-code reject; bulk (dup/bad-unit; abort vs skip-report?).
3. Equipment — CRUD; tag uniqueness; WBS-link validation; bulk.
4. MTO — CRUD lines; bulk; revisions A→B(real)→C; diff correctness (watch B→C=0 bug); content-identical re-upload blocked/honest-zero; received-vs-demand.
5. Procurement — wizard PO; edit; approve; edit locked/approved → refusal; bulk PO-line; thresholds; no delete with downstream links.
6. Expediting — 6a partial assign/split (M<N; remainder=N−M; over-assign blocked; auditable); 6b off-PO child line (flagged variation; parent totals intact); 6c VDRL consistent with PO/SCN.
7. Heat continuity — 50 good chains + edges: heat at SCN→receipt→stock→transfer(both legs)→FMR→cert(case-insensitive); heat-required-no-heat receipt BLOCKED; stock-no-cert SURFACED.
8. Role matrix — log in each role; confirm boundaries; over-permission = security finding.
