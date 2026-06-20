# QMAT — Azure Deployment Runbook (Milestone A: internal testing)

**Audience:** Thomas, running these commands himself. Claude does **not** run any of
this — it's a copy-paste runbook. Work top to bottom; each major step has a
verification check. Replace every `<PLACEHOLDER>` before running a command.

**What this deploys**
- **Backend** → Azure App Service (Linux, Node 22, **Free F1**)
- **Frontend** → Azure Static Web Apps (Free)
- **Database** → *reuses* the existing Azure MySQL (`qmat` on
  `qcosystem.mysql.database.azure.com`) — **nothing new is provisioned for the DB**

**Locked specs:** Region **Australia East** · Resource group **`qco-mms-test-rg`**
(rename if you like) · backend F1 (no Always On) · manual CLI deploy (no CI this phase).

> ⚠️ **Four easy-to-miss failure points** (called out again in context below):
> 1. **DB firewall** — the MySQL server must allow the App Service to connect, or every DB call silently fails.
> 2. **`VITE_API_URL` is baked in at BUILD time** — the frontend must be *rebuilt* with the backend URL; it cannot be changed after build. The backend must exist first.
> 3. **F1 tier has no "Always On"** — do not pass `--always-on` (it errors on F1). Expect cold starts.
> 4. **Do not set `PORT`** — App Service injects it; the app already reads `process.env.PORT`.

---

## Values you need to supply (gather these first)

| Placeholder | What it is | Notes |
|---|---|---|
| `<SUBSCRIPTION>` | Your Azure subscription name/ID | `az account show` |
| `<BACKEND_APP_NAME>` | Globally-unique App Service name | becomes `https://<name>.azurewebsites.net` |
| `<SWA_NAME>` | Static Web App name | becomes `https://<name>.<hash>.azurestaticapps.net` |
| `<DB_PASSWORD>` | Password for the MySQL app user | **secret** — from your existing DB config |
| `<DB_USER>` | MySQL app user (e.g. `qmat_app`) | the runtime (non-admin) user |
| `<JWT_SECRET>` | A **new strong random string** | NOT the dev fallback. Generate: `openssl rand -base64 48` |
| `<MYSQL_SERVER_NAME>` | The MySQL flexible-server resource name | for the firewall rule (step 2c) |
| `<MYSQL_RG>` | Resource group the MySQL server lives in | may differ from `qco-mms-test-rg` |

Secrets are **never** committed. They go into App Service "Application Settings" only.

---

## 0 — Prerequisites (your machine)

```bash
# Azure CLI (macOS)
brew update && brew install azure-cli        # or: az upgrade

# Static Web Apps CLI (for manual frontend deploy)
npm install -g @azure/static-web-apps-cli

# Node 22 available locally for the frontend build (you have 24; 22 also fine)
node -v

# Log in and select the subscription
az login
az account show                              # confirm the right subscription
az account set --subscription "<SUBSCRIPTION>"
```

**Verify:** `az account show` prints the subscription you intend to use.

---

## 1 — Resource group

```bash
az group create --name qco-mms-test-rg --location australiaeast
```

**Verify:**
```bash
az group show --name qco-mms-test-rg --query "properties.provisioningState" -o tsv
# → Succeeded
```

---

## 2 — Backend (App Service)

### 2a — App Service plan (Linux, Free F1)

```bash
az appservice plan create \
  --name qco-mms-plan \
  --resource-group qco-mms-test-rg \
  --location australiaeast \
  --is-linux \
  --sku F1
```

> ⚠️ F1 is Free: **no Always On**, shared CPU, ~daily CPU quota. Expect a cold
> start after idle. Fine for internal testing. To upgrade later (real testers):
> `az appservice plan update --name qco-mms-plan --resource-group qco-mms-test-rg --sku B1`

### 2b — Web app (Node 22)

```bash
az webapp create \
  --name <BACKEND_APP_NAME> \
  --resource-group qco-mms-test-rg \
  --plan qco-mms-plan \
  --runtime "NODE:22-lts"
```

**Verify:** `az webapp show -g qco-mms-test-rg -n <BACKEND_APP_NAME> --query state -o tsv` → `Running`
(the URL is `https://<BACKEND_APP_NAME>.azurewebsites.net` — no app deployed yet).

### 2c — ⚠️ DB firewall (common silent failure)

The existing MySQL must accept connections from the App Service. Easiest for an
Azure-hosted app — allow Azure services (adds the `0.0.0.0` rule):

```bash
az mysql flexible-server firewall-rule create \
  --resource-group <MYSQL_RG> \
  --name <MYSQL_SERVER_NAME> \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

> If `qcosystem` is a **Single Server** (not Flexible), use `az mysql server firewall-rule create` instead (same args).
> The `0.0.0.0/0.0.0.0` rule = **"allow all Azure services"** — broader than just this App Service (any Azure resource can reach the DB). Accepted for internal; in Milestone B restrict to this App Service's outbound IPs (`az webapp show ... --query outboundIpAddresses`).

### 2d — Application settings (the env vars the app reads)

> Grounded in `server/db.js` + `server/services/email.js`: the **runtime** app reads
> exactly these. `DB_ADMIN_*` / `MYSQL_DATABASE` are **migration-script-only — do NOT set them here**. There is **no Anthropic/AI key** (the dashboard is deterministic). **Do NOT set `PORT`** (App Service injects it).

**Required:**
```bash
az webapp config appsettings set -g qco-mms-test-rg -n <BACKEND_APP_NAME> --settings \
  DB_HOST="qcosystem.mysql.database.azure.com" \
  DB_PORT="3306" \
  DB_USER="<DB_USER>" \
  DB_PASSWORD="<DB_PASSWORD>" \
  DB_NAME="qmat" \
  JWT_SECRET="<JWT_SECRET>" \
  JWT_EXPIRES_IN="24h" \
  SCM_DO_BUILD_DURING_DEPLOYMENT="true"
```

**SMTP (optional for internal — leave as placeholders; email simply no-ops):**
```bash
az webapp config appsettings set -g qco-mms-test-rg -n <BACKEND_APP_NAME> --settings \
  SMTP_HOST="smtp.office365.com" \
  SMTP_PORT="587" \
  SMTP_USER="placeholder@example.com" \
  SMTP_PASS="your-password-here" \
  SMTP_FROM="QCO Group MMS <placeholder@example.com>" \
  ADDITIONAL_ALERT_EMAILS=""
```
> `SMTP_PASS="your-password-here"` keeps email disabled (no-op) on purpose. New-user
> invites and password-reset emails will NOT send until real SMTP is set (Milestone B);
> for internal testing you hand out credentials manually.

### 2e — Deploy the backend code

The backend lives in **`server/`** (its own `package.json` with `"start": "node index.js"`).
Deploy that folder; exclude `node_modules` (Oryx runs `npm install` because
`SCM_DO_BUILD_DURING_DEPLOYMENT=true`), `.env` (secrets are in App Settings), and `uploads`.

> `SCM_DO_BUILD_DURING_DEPLOYMENT=true` (set in 2d) tells Azure to run `npm install`
> **server-side** during deploy — that's why `node_modules` is excluded from the zip.
> The **first** deploy is slower (it installs deps). If the backend doesn't start,
> check `az webapp log tail` first — a failed Oryx build/install is the usual suspect.

```bash
cd ~/Desktop/qmat/server
zip -r ../qmat-backend.zip . -x "node_modules/*" ".env" "uploads/*"

az webapp deploy \
  --resource-group qco-mms-test-rg \
  --name <BACKEND_APP_NAME> \
  --src-path ../qmat-backend.zip \
  --type zip

# Ensure the start command (App Service runs `npm start` → node index.js)
az webapp config set -g qco-mms-test-rg -n <BACKEND_APP_NAME> --startup-file "npm start"
az webapp restart -g qco-mms-test-rg -n <BACKEND_APP_NAME>
```

**Verify (health check — does not touch the DB):**
```bash
curl https://<BACKEND_APP_NAME>.azurewebsites.net/health
# → {"status":"QMAT API running","time":...}
```
If this 502s on first hit, it's the F1 cold start — wait ~30s and retry. If it
stays down, check logs: `az webapp log tail -g qco-mms-test-rg -n <BACKEND_APP_NAME>`.

---

## 3 — Frontend (Static Web App)

### 3a — Build with the real backend URL (⚠️ build-time inlining)

`VITE_API_URL` is **inlined into the bundle at build time** (see `src/lib/api.ts`),
so the backend must already exist and you build with its URL:

```bash
cd ~/Desktop/qmat
VITE_API_URL="https://<BACKEND_APP_NAME>.azurewebsites.net" npm run build
# output → dist/
```

**Verify the URL was baked in (not localhost):**
```bash
grep -o "https://<BACKEND_APP_NAME>.azurewebsites.net" dist/assets/*.js | head -1
# → prints the backend URL  (if empty, the build didn't pick up VITE_API_URL — rebuild)
```

### 3b — Create the Static Web App

```bash
az staticwebapp create \
  --name <SWA_NAME> \
  --resource-group qco-mms-test-rg \
  --location eastasia
```
> ⚠️ SWA `--location` must be a **supported SWA region** (Australia East is not one;
> `eastasia` is nearest). This only sets where SWA metadata/managed functions live —
> the static content is served globally via CDN, so latency to AU is unaffected.

### 3c — Deploy `dist/` with the deployment token

```bash
# Get the deployment token
SWA_TOKEN=$(az staticwebapp secrets list \
  --name <SWA_NAME> --resource-group qco-mms-test-rg \
  --query "properties.apiKey" -o tsv)

# Deploy the pre-built dist/ as production
swa deploy ./dist --deployment-token "$SWA_TOKEN" --env production
```

**Verify:** the command prints a URL like
`https://<SWA_NAME>.<hash>.azurestaticapps.net`. Open it — the app loads.

---

## 4 — End-to-end smoke test (on the live SWA URL)

1. Open `https://<SWA_NAME>.<hash>.azurestaticapps.net`.
2. **Network check (DevTools → Network):** API calls go to
   `https://<BACKEND_APP_NAME>.azurewebsites.net/...` — **not** `localhost`.
3. **Login** as a seeded test account — password is the seeded **`password`**:
   - Admin: **`admin1@zzflowtest.example`** (verified: seed password `password`).
   - Alternate (internal, non-admin): **`kate.nguyen@qcogroup.com.au`** (`project_manager`, same password).
   > ⚠️ The real staff admins (`admin@qco.com.au`, `tchang@…`, `jneal@…`) have their
   > own changed passwords — `password` does **not** work for them; use a seeded account above.
4. **Dashboard** loads live data (counts/health) → backend ↔ DB path works (firewall OK).
5. **RBAC is live:** an internal user sees **"All Projects"**; an external test user
   (e.g. a vendor) sees only granted projects, or "No project access" if none —
   confirming the shipped `is_external` gate.

> **CORS:** the backend currently uses open `cors()`, so the SWA origin is accepted —
> no CORS change needed for internal. Tightening to the SWA origin is a Milestone B task.

---

## 5 — Notes / gotchas

- **F1 cold start + quota:** first request after idle is slow; F1 has a daily CPU
  quota and can return 429/503 if exceeded. Acceptable for light internal testing.
  Scale up when testers arrive:
  `az appservice plan update --name qco-mms-plan --resource-group qco-mms-test-rg --sku B1`
- **Email is off:** `SMTP_PASS` placeholder ⇒ all email no-ops. Invites and
  password-reset delivery don't work yet → hand out credentials manually for internal.
  Connecting real SMTP is Milestone B.
- **Re-deploys:** backend → repeat 2e (re-zip + `az webapp deploy`). Frontend → repeat
  3a + 3c (**rebuild** so any backend-URL/code change is re-inlined, then `swa deploy`).
- **Migrations:** not needed for this deploy (the existing `qmat` DB already has the
  schema). If a future migration is required, it needs the DB **admin** creds
  (`DB_ADMIN_USER`/`DB_ADMIN_PASSWORD`) run from a script — not the runtime app settings.

### ⚠️ NOT yet hardened — do these before ANY external exposure (Milestone B)
- **CORS** is wide open (`cors()`) — restrict to the SWA origin.
- **DB firewall** uses the `0.0.0.0` "allow all Azure services" rule — restrict to this App Service's outbound IPs.
- **No rate limiting / no helmet** — add before public exposure (login + `/forgot-password`).
- **`/pos/:id` cross-project leak** (backlogged) — a vendor can read any PO by id; close it before external vendors.
- **Test data** — testers land on the shared `qmat` DB (canonical 1–4 + ZZ demo +
  dummy users). Consider a separate/clean test dataset before external testers.
- **Weak shared password `"password"`** on seeded accounts — fine internally, replace
  with real per-user credentials (needs working email) before external.
