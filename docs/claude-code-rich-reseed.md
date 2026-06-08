# QMAT Rich Re-seed — Runbook

A repeatable procedure for rebuilding the disposable demo project (`ZZ_FLOWTEST`)
with **domain-authentic mining / minerals-processing data** so every screen is
genuinely walkable. Captures the exact commands, guardrails, and verification used.

> **TL;DR run order:** backup DB → teardown (QCO_admin) → seed **smoke** → PASS B →
> **HOLD for review** → seed **full** → re-seal audit checkpoint → PASS B again.
> Never run `full` before the smoke is approved.

---

## 0. What this produces

- One project, `code = 'ZZ_FLOWTEST'` (the numeric `id` changes every rebuild —
  was 21, currently **23** — never hardcode the id; resolve it by code).
- A coherent supply-chain graph: WBS → commodities/equipment → MTO → PO → milestones
  → SCN → stock/receipts → FMR → certs → holds → RFIs/meetings, all FK-coherent.
- **Mining domain content** (see §7): process-area WBS, slurry/valve/liner commodities,
  tagged equipment (`34-ML-001`), regional generic vendors.
- **WBS Gantt roll-up**: each node's planned/forecast/actual dates derived from the
  POs beneath it, so the Gantt renders bars (parents span their children).
- Full field completeness (no blank key columns) + deliberate exceptions (overdue
  lines, amended ROS with `date_change_log`, holds).

Key files:
| File | Role |
|---|---|
| `docs/flowtest/seed.cjs` | the seed generator (`smoke` \| `full` \| `teardown`) |
| `scripts/flowtest_teardown.sql` | QCO_admin teardown (drops audit guards, deletes ZZ) |
| `docs/canonical_baseline.json` | per-table counts for canonical projects 1–4 (drift check) |

---

## 1. Guardrails (read before touching anything)

1. **Scope every delete** to the ZZ project: `project_id = <ZZ id>`, emails
   `@zzflowtest.example`, supplier code `ZZF-%`, MTO `ZZ-%`. Never touch canonical
   projects **1–4** — they must stay byte-identical. Any unexpected delta = **STOP**.
2. **Audit tables are immutable** (`audit_log`, `audit_review` are hash-chained with
   enforcement triggers). The teardown SQL drops the guards *as QCO_admin*, deletes ZZ
   audit rows, then re-arms them. Do not delete audit rows by hand.
3. **Least privilege**: the app user `qmat_app` has **no DDL** and **no DELETE** on
   several tables (`mto_lines`, `rfi_meeting_records`, …). Migrations, the teardown,
   and any hard delete must run as **QCO_admin**.
4. **Secrets**: QCO_admin creds go through a temp env file — never echoed to stdout,
   never committed (see §2).
5. **Login**: the seed hashes the password `password` via the app's own bcrypt
   (`bcryptjs`, cost 12). Keep this — minting JWTs masks login bugs; always prove via
   the real `/api/auth/login` endpoint.
6. **Seed code is committed; seed *data* is not** (it's DB state). Run PASS C (tsc +
   audit verify + canonical drift) before pushing any code change.

### QCO_admin credential handling (verbatim pattern)

```bash
umask 077
printf "export QADM_USER='QCO_admin'\nexport QADM_PASS='EPL1@admin'\n" > /tmp/.qadm.env
chmod 600 /tmp/.qadm.env
source /tmp/.qadm.env
# ... run elevated work using $QADM_USER / $QADM_PASS ...
rm -f /tmp/.qadm.env          # or: shred -u /tmp/.qadm.env
unset QADM_USER QADM_PASS
```

---

## 2. Step 1 — Back up the DB

`mysqldump` 9.x against the Azure MySQL 8.x server **must drop `--routines`** — the
newer client emits an `INFORMATION_SCHEMA.LIBRARIES` query the server lacks (errors
mid-dump otherwise). Use `--skip-routines --triggers --single-transaction
--no-tablespaces`.

```bash
cd /Users/thomaschang/Desktop/qmat
BKDIR=~/Desktop/qmat_db_backups; mkdir -p "$BKDIR"
BK="$BKDIR/qmat_$(date +%Y%m%d_%H%M%S).sql"
umask 077; printf "export QADM_PASS='EPL1@admin'\n" > /tmp/.qadm.env; chmod 600 /tmp/.qadm.env; source /tmp/.qadm.env
export MYSQL_PWD="$QADM_PASS"
/opt/homebrew/opt/mysql-client/bin/mysqldump \
  --host=qcosystem.mysql.database.azure.com --user=QCO_admin \
  --ssl-mode=REQUIRED --single-transaction --no-tablespaces \
  --skip-routines --triggers --skip-add-locks qmat > "$BK"
unset MYSQL_PWD QADM_PASS; rm -f /tmp/.qadm.env
# verify NON-EMPTY + complete:
test -s "$BK" && grep -q 'Dump completed' "$BK" && echo "OK $(du -h "$BK" | cut -f1), tables=$(grep -c 'CREATE TABLE' "$BK")"
```

A good dump is ~4 MB, ~80 `CREATE TABLE`, and ends with a `Dump completed` marker.
**Restore** (rollback) is `mysql ... qmat < "$BK"` as QCO_admin.

---

## 3. Step 2 — Teardown the ZZ project (QCO_admin)

The seed has its own JS teardown, but it gets blocked on `audit_log` rows the session
created (PO approvals, RFI tests, etc.). Run the SQL teardown first — it drops the
audit enforcement guards, deletes ZZ rows, then re-arms the guards.

```bash
umask 077; printf "export QADM_USER='QCO_admin'\nexport QADM_PASS='EPL1@admin'\n" > /tmp/.qadm.env
chmod 600 /tmp/.qadm.env; source /tmp/.qadm.env
node -e "
const m=require('./server/node_modules/mysql2/promise');const fs=require('fs');
require('./server/node_modules/dotenv').config({path:'./server/.env'});
(async()=>{
  const sql=fs.readFileSync('scripts/flowtest_teardown.sql','utf8');
  const c=await m.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,
    user:process.env.QADM_USER,password:process.env.QADM_PASS,database:process.env.DB_NAME,
    ssl:{rejectUnauthorized:false},multipleStatements:true});
  const [[cb]]=await c.query(\"SELECT COUNT(*) n FROM projects WHERE code<>'ZZ_FLOWTEST'\");
  await c.query(sql);
  const [[zz]]=await c.query(\"SELECT COUNT(*) n FROM projects WHERE code='ZZ_FLOWTEST'\");
  const [trg]=await c.query('SHOW TRIGGERS');
  const guards=['audit_log_bu','audit_log_bd','audit_review_bu','audit_review_bd','audit_log_bi','audit_review_bi']
    .filter(x=>trg.map(t=>t.Trigger).includes(x));
  const [[ca]]=await c.query(\"SELECT COUNT(*) n FROM projects WHERE code<>'ZZ_FLOWTEST'\");
  console.log('teardown OK | ZZ:',zz.n,'| guards:',guards.length+'/6','| canonical',cb.n+'->'+ca.n,cb.n===ca.n?'OK':'DRIFT');
  await c.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
"
rm -f /tmp/.qadm.env; unset QADM_USER QADM_PASS
```

**Expect:** `ZZ: 0 | guards: 6/6 | canonical 4->4 OK`. If canonical drifted, STOP and
restore from backup.

---

## 4. Step 3 — Seed SMOKE (QCO_admin)

The seed runs **elevated** (creates project, warehouses, etc.). Override the DB user
via env — `dotenv` will **not** override variables that are already set.
**The default arg is `full`** — you MUST pass `smoke` explicitly.

```bash
umask 077; printf "export QADM_USER='QCO_admin'\nexport QADM_PASS='EPL1@admin'\n" > /tmp/.qadm.env
chmod 600 /tmp/.qadm.env; source /tmp/.qadm.env
export DB_USER="$QADM_USER" DB_PASSWORD="$QADM_PASS"
cd server && node ../docs/flowtest/seed.cjs smoke
cd ..
rm -f /tmp/.qadm.env; unset QADM_USER QADM_PASS DB_USER DB_PASSWORD
```

The seed prints `=== SEED RESULT ===` with counts, a funnel
(`MTO → raised → expedited → received`), the WBS roll-up coverage, and `ASSERT`
flags (fk-coherent / funnel monotonic / 21 roles / canonical untouched).

---

## 5. Step 4 — PASS B (verify the smoke)

Run the verification script against the new ZZ id. Checklist:

- [ ] **WBS Gantt bars** — `COUNT(planned_start) > 0`; a parent area spans its
      descendants (`parent.planned_start ≤ min(child)`, `parent.planned_end ≥ max(child)`).
- [ ] **Field completeness** — 0 blanks in commodity `preservation`/`preferred_vendor`/
      `notes`, equipment `size_lwh`/`notes`/`vendor`.
- [ ] **Inherited-ROS rule** — every PO's `ros_date` equals its MTO demand **or** has a
      `date_change_log` row (`entity_type='purchase_order'`, `field='ros_date'`).
      `SILENT` (diverged with no log) must be **0**.
- [ ] **Forecast slips logged** — every milestone whose `forecast_date ≠ planned_date`
      has a `date_change_log` row (`entity_type='po_milestone'`).
- [ ] **Physical monotonicity** — `cargo_ready ≤ etd ≤ atd ≤ eta ≤ ata ≤ received` per
      received unit; `received ≥ ata`.
- [ ] **Orphans = 0** — stock→po_line, scn→po, cert→po all resolve.
- [ ] **Exceptions populate** — overdue lines > 0 (Attention), holds present.
- [ ] **Canonical 1–4 = 0 drift** vs `docs/canonical_baseline.json`.
- [ ] **Mining sanity** — sample WBS / commodity / equipment / vendor names read as a
      real minerals plant.

Then **HOLD** — report the smoke results and wait for explicit approval before `full`.

---

## 6. Step 5 — FULL (after approval) + re-seal

```bash
# same elevated env as §4, but:
cd server && node ../docs/flowtest/seed.cjs full && cd ..
```

Full volume (~110 WBS nodes, 1000 commodities, 400 equipment, 3000 MTO lines, 300 POs,
~2400 lines, ~800 stock/receipts). Re-run the PASS B script against the new id.

**Re-seal the audit checkpoint** (the teardown moved the audit head):

```bash
TOKEN=$(node -e "console.log(require('./server/node_modules/jsonwebtoken').sign({id:1,email:'admin@qco.com.au',role:'admin',full_name:'Admin User'},'qmat_jwt_secret_2024',{expiresIn:'1h'}))")
curl -s -X POST http://localhost:3001/api/audit/checkpoint -H "Authorization: Bearer $TOKEN"   # seal
curl -s        http://localhost:3001/api/audit/verify     -H "Authorization: Bearer $TOKEN"   # expect status:"verified"
```

---

## 7. Mining domain content (in `seed.cjs`)

- **WBS areas** (`AREAS`): ROM & Primary Crushing, Secondary/Tertiary Crushing,
  Grinding (SAG/Ball), Classification, Flotation, Thickening & Filtration, Reagents,
  Tailings Storage, Materials Handling, Water Services, Power & Electrical, Process
  Control, Infrastructure → sub-areas → packages.
- **Commodities** (`COMS`): HDPE / rubber-lined / carbon-steel slurry pipe,
  knife-gate / pinch / ball valves, mill liner sets, cyclone clusters, conveyor
  belting/idlers, MCC / HV switchgear, mag-flow / density instruments, reagent skids —
  each with `uom`, `spec`, `trace`, `preservation`.
- **Equipment** (`EQUIP`): SAG/Ball mills, gyratory/cone crushers, screens, flotation
  cells, thickeners, slurry pumps, cyclones, conveyors, transformers, filters — tagged
  `AREA-CODE-NNN` (e.g. `34-ML-001`), with `size_lwh`, `weight_kg`, `criticality`.
- **Vendors** (`VENDORS`): generic regional names (Pilbara Steel & Fabrication,
  SlurryFlow Pumps Australia, …), wired through a `supName()` lookup so every
  `vendor_name` is coherent with the `suppliers` table.

The **WBS roll-up** runs after PO/milestone generation: it aggregates each leaf's PO
line timelines (earliest PO-raised → latest line ROS; forecast = latest receipt;
actual = started/received) and rolls child → parent by code prefix, then UPDATEs
`wbs_nodes`. The node modal's manual date fields were removed (dates are derived).
*Future enhancement:* compute-on-read in the WBS GET so app-created/edited nodes stay
fresh without a re-seed.

---

## 8. Gotchas hit (and the fixes)

| Symptom | Cause / fix |
|---|---|
| `mysqldump` errors on `INFORMATION_SCHEMA.LIBRARIES` | client v9 vs server v8 — use `--skip-routines` |
| `dotenv` ignores `DB_USER` override | dotenv won't overwrite pre-set env — `export` it before invoking |
| Seed ran full when you wanted smoke | default arg is `full` — pass `smoke` explicitly |
| `DELETE command denied to 'qmat_app'` | hard deletes need QCO_admin (app soft-deletes) |
| `Data truncated for column 'inspection_class' / 'status' / 'type'` | enum columns — `inspection_class ∈ {Class I,II,III}`, `mto_lines.status ∈ {not-started,rfq,po-raised}`, `supplier_addresses.type ∈ {registered,remittance,shipping}` |
| Ambiguous `ros_date` / `id` in JOINs | qualify with `pl.` / `mm.` / `p.` prefixes |
| ZZ login fails | hash `password` via the app's bcrypt; prove via real `/api/auth/login` |
| MTO header shows "0 lines" | set `mto_registers.line_count` after inserting lines |

---

## 9. PASS C before pushing code

Any change to `seed.cjs` (or related app code) is committed separately and must pass:

```bash
npx tsc --noEmit                                   # C1: type-check clean
# C3 audit verify == "verified"; C4 pagination unique==total;
# C5 RBAC (viewer write → 403); C6 ZZ login (password) works;
# canonical 1–4 == 0 drift vs docs/canonical_baseline.json
```

Commit the seed change on its own branch/commit, push only after PASS C is green.
