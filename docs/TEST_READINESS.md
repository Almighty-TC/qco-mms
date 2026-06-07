# QCO MMS — Test Readiness Assessment & Pre-Release Gate Checklist

**Purpose:** honest record of where testing stands, what's deliberately deferred, and what MUST happen before internal release. Decision (Thomas): finish the walk-through + functional fixes FIRST; build the formal test gates (E2E, security, config) AFTER the system is functionally stable. Security/config addressed closer to release, not now.

**Current stage:** functional build complete + walk-through in progress (UAT). NOT yet release-tested.

---

## Coverage scorecard (the 11 categories)

| # | Category | Status | Reality |
|---|----------|--------|---------|
| 1 | Unit testing | ❌ None | No Jest/Vitest/pytest suite; ~0% formal coverage. Deferred (retrofitting coverage onto a finished build is its own project). |
| 2 | Integration testing | 🟡 Informal | API↔DB + coherence chains proven by hand, no automated suite. |
| 3 | E2E testing | 🟡 Manual only | The walk-through IS manual E2E. No Cypress/Playwright automation. **← top automation gap.** |
| 4 | API testing | ✅ Strong | Endpoints proven all session: status codes, authz (403/422), payload validation. Best-covered area. |
| 5 | Regression | 🟡 Manual (PASS C) | Re-run per batch (tsc, canonical-untouched, hash-chain, pagination, RBAC). Real but not automated. |
| 6 | Security | 🟡 Partial | Auth/authz well-tested (RBAC, tamper-evident audit, least-priv DB user). **Missing:** OWASP sweep (SQLi/XSS/CSRF), SAST tool, secrets-in-bundle check, secure headers. |
| 7 | Performance/load | 🟡 Minimal | Single-query timing + pagination stress only. No k6/JMeter/Locust, no concurrency test. |
| 8 | Build/CI | 🟡 Partial | `tsc --noEmit` clean enforced per batch. No linter gate, no CI pipeline. |
| 9 | Config/env | ❌ Gaps known | Email/SMTP not connected; QCO_admin pw needs rotating; no formal dev-config-leak check. |
| 10 | Smoke | 🟡 Informal | "Is it alive" checks + rebuild smoke. No formal post-deploy gate. |
| 11 | UAT prep | 🔵 In progress | The walk-through. Business-critical flows validated by Thomas. |

**Summary:** strong ad-hoc API/RBAC/regression verification + a tamper-evident audit + least-privilege DB. NO automated test suite, NO CI, NO security scan, NO load test. Fine for a functional build; these are real gaps for an internal-release gate.

---

## Phase 1 — NOW (functional, in progress)
- [ ] Finish the ZZ data rebuild (smoke → HOLD → review → full → re-seal checkpoint)
- [ ] Batch 1 blockers (change-password, Pending-Changes approve, PO approve) + **PASS A** schema-drift sweep
- [ ] Continue the walk-through; fix in batches (UI/polish, MTO/design); **PASS C** after each batch
- [ ] **PASS B** coherence after the rebuild
- *Goal: a functionally correct, walked system. No formal test-suite work yet — the code is still changing.*

## Phase 2 — BEFORE internal release (build once functionally stable)
*(deferred on purpose — do NOT skip, do NOT do early)*

**Release-critical gates:**
- [ ] **E2E smoke suite (Playwright)** — automate the critical paths: login → approve PO → create MTO → raise+issue FMR → RFI raise→close → dashboard loads. Makes regression repeatable instead of manual. *(highest-leverage gap)*
- [ ] **Security pass:** SQLi spot-checks on key inputs, XSS on free-text fields, CSRF posture; confirm NO secrets in the frontend bundle; secure headers (CSP/HSTS); consider a SAST tool (Snyk/SonarQube). *(Thomas: address closer to release — this is that gate.)*
- [ ] **Config/env check:** connect email/SMTP (known: not wired — invitations don't send); rotate QCO_admin password (known: passed through dev sessions); confirm no dev configs in the release env; logging on but not leaking secrets; migrations run clean on a fresh DB.

**Should-have (incremental, post-stability):**
- [ ] Unit tests on the highest-risk logic first (approval chains, health-score derivation, stock/FMR atomic transactions, hash-chain) — build coverage up, don't big-bang it
- [ ] Integration tests for the cross-module flows the coherence pass checks
- [ ] CI pipeline (GitHub Actions): tsc + lint + the test suite green before merge
- [ ] Baseline load test (k6/Locust): API response under ~50–200 concurrent users; DB query performance at volume

---

## Known config/security items already logged (carry into Phase 2)
- Email/SMTP not connected → new-user invitations don't send (surfaced in walk-through, Admin/Users).
- QCO_admin password rotation (passed through dev sessions; app runs as qmat_app so rotation won't disrupt the app).
- Teardown-vs-enforcement (admin trigger-drop path; now exercised in the ZZ rebuild).
- (others live in docs/BACKLOG.md)

---

## The rule
Phase 2 is a **deliberate deferral, not an oversight.** Before any internal release, the Phase-2 release-critical gates (E2E smoke, security pass, config/env) must be done — this checklist is the gate. Don't mistake "functional build complete" for "release ready"; they are different bars, and this doc is the bridge between them.

---

## Trigger map (how the standing passes fit this gate)
- **PASS A — schema-drift sweep:** run with Batch 1, and after any migration/schema change. (Phase 1)
- **PASS B — end-to-end coherence:** run after the ZZ data rebuild, and again after full volume. (Phase 1)
- **PASS C — regression checklist:** run after every fix batch, before push. (Phase 1, ongoing)
- Artifacts: `docs/canonical_baseline.json` is the saved baseline for PASS C item 2 (canonical projects 1–4 untouched).
