# QMAT CONSOLIDATED RUN — REPORT (2026-06-03, unattended)

## Per-phase status (one line each)
- **A — Commit C1 (schema):** ✅ DONE — `b51da43` (qmat_audit_log.sql + qmat_schema.sql).
- **B — Commit VDRL doc:** ✅ DONE — `8a03265`.
- **C — Housekeeping (delete 2 chat-output .md):** ✅ DONE — tree clean.
- **D — C3 audit writers (project_id), file-by-file:** ✅ DONE — 7 commits `a60a621`→`c460028`, each proven.
- **E0 — Isolation (ZZ_FLOWTEST + teardown):** ✅ DONE — `$TESTPROJ = 9`; teardown proven; canonical untouched.
- **E1 — Author harness:** ✅ DONE — `docs/flowtest/{seed.cjs, seed.md, flow-plan.md, ui-audit.md, flowtest_run.cjs}` + `scripts/flowtest_teardown.sql`.
- **E2 — Seed (smoke→full):** ✅ DONE — smoke checkpoint passed → full volume seeded; all checkpoints green.
- **E3 — Flow test (logic):** ✅ DONE (automatable assertions) — 10 PASS, **1 SECURITY-GAP**, 1 inconclusive.
- **E4 — UI audit:** 🟡 PARTIAL — browser automation unreliable this session (dashboard card not resolving); high-risk items documented for manual pass (below).
- **E5 — Report:** ✅ this file + chat summary.

---

## 1. What ran / what didn't
Phases A–D (pre-approved audit work) committed + pushed. Phase E executed read-only: ZZ_FLOWTEST isolated, harness authored, full-volume seed, automated flow-test assertions, partial UI audit. Nothing fixed; no commits beyond seed/teardown scripts + this report. The only non-automatable gap is the full 20-screen × 3-zoom UI walk (E4) — flagged for manual follow-up.

## 2. Seed summary
- **$TESTPROJ = 9** (`ZZ_FLOWTEST`, status active). All data scoped to it; users `@zzflowtest.example`; suppliers/warehouses `ZZF-*`.
- **Row counts:** wbs_nodes 500 · commodity_library 1000 · equipment_list 400 · mto_registers 6 / mto_lines 3,338 (incl. A/B/C revs on 2) · suppliers 30 · purchase_orders 40 / po_lines 601 (heat_number_required on ~half) · shipment_control_notes 150 (+packages +scn_heats) · warehouse_stock 801 (good/quarantine/major_damage, heat numbers) · warehouse_transfers 30 · fmr_requests 25 (+lines) · traceability_certs 300 (heat_ref) · users 25.
  - *Volumes scaled from spec ranges for single-run reliability (simple tables near target; complex linked entities lighter). Noted per spec's "reasonable choice" allowance. Re-runnable at higher scale via `SCALE` in seed.cjs.*
- **User credential matrix** (all password = `password`):
  | Role label | Backend role | Count | Emails | Scope |
  |---|---|---|---|---|
  | Super Admin | admin | 2 | superadmin1..2@zzflowtest.example | full |
  | Project Admin | project_manager | 3 | projectadmin1..3@… | full |
  | Procurement | procurement_officer | 4 | procurement1..4@… | full |
  | Expeditor | expeditor | 3 | expeditor1..3@… | full |
  | Material Control | warehouse | 2 | materialcontrol1..2@… | full |
  | Logistics | freight_forwarder | 2 | logistics1..2@… | own SCNs |
  | Traceability/QA | vendor | 2 | traceabilityqa1..2@… | full |
  | Contractor | site_contractor | 3 | contractor1..3@… | **WBS-scoped** |
  | Auditor | viewer | 2 | auditor1..2@… | read+audit |
  | Viewer | viewer | 2 | viewer1..2@… | read-only |
- **Heat-chain manifest:** 50 designated good chains seeded; **122 heats fully linked SCN↔stock↔cert** (case-insensitive join verified). Edge cases: (a) PO line `EDGE-A` heat-required with NO heat; (b) receipt `ZZH-MISMATCH-XYZ` ≠ SCN heat; (c) stock `ZZH-ORPHAN-NOCERT` with no cert; (d) transfers carry heat both legs.
- **Canonical untouched:** projects = 4 (unchanged); project-1 warehouse_stock = 10 (baseline); 0 audit residue under ZZ after probe cleanup. Teardown proven (`seed.cjs teardown` / `scripts/flowtest_teardown.sql`) restores canonical counts.

## 3. Flow-test results (read-only; FIX NOTHING)
| Module | Step | Expected | Actual | Verdict |
|---|---|---|---|---|
| 7-Heat | good chains SCN↔stock↔cert (case-insensitive) | ≥50 | 122 | ✅ PASS |
| 7-Heat | edge(a) heat-required line w/o heat (data to test receipt-block) | heat NULL | heat NULL | ✅ PASS(data) |
| 7-Heat | edge(c) stock heat with no matching cert detectable | 1 surfaced | 1 | ✅ PASS |
| 7-Heat | edge(b) receipt heat ≠ SCN heat present | 1 | 1 | ✅ PASS(data) |
| 4-MTO | Rev A→B real changes | >0 | 111/332 | ✅ PASS |
| 4-MTO | Rev B→C (identical content) diff | 0 honest-zero | 0 | ✅ PASS (upload-guard = separate logged MTO bug) |
| X-Validation | create WBS missing code | 4xx not 500 | 400 | ✅ PASS |
| X-Audit | create writes audit_log w/ project_id | project_id=9 | 9 | ✅ PASS (project-scoped audit works end-to-end) |
| 8-Roles | contractor reads /admin/users | 403 | 403 | ✅ PASS |
| 5-Proc | edit locked PO (PATCH /pos/:id) | refused | 404 | ⚠️ INCONCLUSIVE — that route/method 404s; locked-edit enforcement must be re-tested against the real PO-edit endpoint |
| 8-Roles | **viewer creates WBS node** | 403 | **201 CREATED** | 🔴 **SECURITY-GAP** |
| 1-WBS | A1 depth-filter leak | UI | n/a (client-side) | ⏭ UI (still open per handover) |

**Not automated (need manual/UI or heavier fixtures):** WBS parent-delete Impact→Reallocate→Confirm via UI; bulk-upload validations (WBS/commodity/equipment/MTO/PO — abort-vs-skip behaviour); expediting 6a split conservation / 6b off-PO child / 6c VDRL (need the assignment UI/endpoints); heat receipt-block enforcement (edge a) and receipt-mismatch detection (edge b) via the receipting endpoint; full role matrix beyond the two probes.

### Prioritized findings (E3)
1. 🔴 **HIGH/SECURITY — `viewer` can create WBS nodes** (`POST /foundational/:pid/wbs` returned 201 for a viewer token). Role not enforced on the foundational write endpoints — viewers/auditors are not read-only there. Likely affects other foundational/MTO writes too. Verify across all write endpoints.
2. 🟡 **MED — locked-PO edit enforcement unverified**: `PATCH /procurement/pos/:id` 404s (wrong route/method); the real edit path's `is_locked` guard needs a direct test.
3. 🟢 **CONFIRMED GOOD** — heat continuity spine (122 chains), case-insensitive heat↔cert join, project-scoped audit (C3), bad-payload→400, edge cases all detectable in data.
4. 🟡 Pre-logged (unchanged): MTO B→C diff shows 0 for identical content (correct); the open question is whether content-identical re-upload should be blocked (handover §5).

## 4. UI findings (E4 — PARTIAL)
Browser automation could not reliably drive the SPA to the ZZ_FLOWTEST project this session (dashboard project card didn't resolve after reload — note: the project IS active and present in DB; this was a harness/automation issue, not necessarily an app bug, though **dashboard project-list refresh after new-project creation should be confirmed**). The full 20-screen × 3-zoom walk was not completed. **Manual audit still required** — highest-risk items to check (from code/handover knowledge):
- **Resizable tables + reset:** only Procurement + Admin comply; ~12 other tables (WBS Tree, Commodity, Equipment, MTO, Stock, Receipting, FMR, Transfers, Logistics, Traceability, PO/Exp-PO detail) lack it (standing-rule gap, already logged).
- **Font-zoom clipping:** re-verify every modal at **Large (1.15)** — the `dad8b99` stock-take class (vw/vh vs ancestor zoom). High-risk: any maximized modal at Large.
- **WBS Gantt at "All" depth** with 500 nodes — load/clip/perf; **A1 Tree depth-filter leak still open** (handover) — confirm in UI.
- **Volume/perf:** WBS Tree (500), MTO lines (3,338), PO lines (601), stock (801) — confirm pagination/virtualization vs lag; deep WBS codes / long heat numbers in narrow columns.
- **Help/legends:** RAG/status colour legends where colour carries meaning.

## 5. TOP 10 ISSUES (triage order)
1. 🔴 **Viewer/role write-permission gap** — viewer created a WBS node (201). Audit role enforcement across ALL foundational/MTO/other write endpoints (security).
2. 🟡 **Locked-PO edit guard** — verify against the correct PO-edit endpoint (the tested PATCH 404'd).
3. 🟡 **Heat receipt-block enforcement** — confirm a heat-required PO line CANNOT be received without heat (edge a) via the receipting endpoint (data seeded; enforcement untested here).
4. 🟡 **Receipt/SCN heat-mismatch detection** — confirm mismatch (edge b) is surfaced, not silently accepted.
5. 🟡 **Stock-without-cert visibility** — confirm UI surfaces edge (c) (`ZZH-ORPHAN-NOCERT`) rather than hiding it (DB join correctly flags it).
6. 🟡 **A1 WBS Tree depth-filter leak** — still open (handover); confirm in UI at volume.
7. 🟡 **Resizable-tables standing-rule rollout** — ~12 tables missing resize+reset.
8. 🟡 **Font-zoom modal clipping** — re-verify all modals at Large (1.15).
9. 🟢 **MTO content-identical re-upload guard** — decide block vs honest-zero (diff itself is correct).
10. 🟢 **Dashboard project-list refresh** — confirm a newly-created project appears without a hard reload.

## 6. Cleanup / safety
- Teardown ready: `node ../docs/flowtest/seed.cjs teardown` (run from `server/`) or `scripts/flowtest_teardown.sql`. Verifies canonical project/user counts unchanged.
- ZZ_FLOWTEST data left **in place** (per "leave seed data in DB" rule) for Thomas to review the UI at volume; remove with teardown when done.
- No code/schema changes in Phase E; canonical data untouched throughout.
