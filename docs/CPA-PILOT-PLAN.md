# DocFlow — CPA Pilot (full spec)

> Source of truth for the DESIGN. Live per-commit status is tracked in the Status ledger
> below and in memory (`docflow-pilot-program.md` in the docflwo project memory). On the
> first implementation session (C0.1), copy this file into the repo as
> `docs/CPA-PILOT-PLAN.md` and treat the repo copy as canonical from then on.
>
> Built 2026-09-05 from the user's "DocFlow: a polished, secure CPA pilot" plan plus a
> code-grounded review (section "Review findings"). Every finding was adopted as a default;
> the user vetoes by editing that table.

## Status ledger (update after every commit)

| # | Commit | Status |
|---|--------|--------|
| C0.1 | `chore(pilot): merge finish-docflow-app; add docs/CPA-PILOT-PLAN.md; vitest+supertest harness on docflow_test; authz matrix for the current API` | SHIPPED 2026-09-05 |
| C0.2 | `fix(authz): clients cannot review, replace or delete advisor material; cross-tenant ids are 404; storagePath never serialized; signup off by default` | SHIPPED 2026-09-05 |
| C0.3 | `feat(ops): backup + restore scripts for the current schema (pg_dump, uploads copy, manifest) and a rehearsed restore` | SHIPPED 2026-09-05 |
| C1.1 | `feat(auth): opaque server sessions (30 min idle / 12 h absolute), revocation, origin check, helmet, limits` | SHIPPED 2026-09-05 |
| C1.2 | `feat(auth): TOTP MFA with recovery codes; forced enrollment; pre-auth session stage` | SHIPPED 2026-09-05 |
| C1.3 | `feat(auth): invitations, password reset, admin CLI, deactivation revokes sessions` | SHIPPED 2026-09-05 |
| C1.4 | `feat(jobs): Postgres job queue + worker service; SMTP mailer with generic templates; copy-link fallback` | SHIPPED 2026-09-06 |
| C2.1 | `feat(schema): engagements, requests, document_versions, reviews, audit_log (expand); legacy import script with report` | SHIPPED 2026-09-06 |
| C2.2 | `feat(api): engagement/request/document/version/review resources with explicit actions; legacy routes kept` | SHIPPED 2026-09-06 |
| C2.3 | `feat(upload): authorize → stage → validate → scan → publish pipeline; quarantine; sweeper; every upload is a version` | NOT STARTED |
| C2.4 | `feat(files): per-version preview/download with nosniff + no-store; PDF/image inline, Office/CSV download; legacy URL resolves current version` | NOT STARTED |
| C3.1 | `feat(web): React Query data layer, auth screens (MFA, invite, reset), shadcn primitives on df tokens, self-hosted Plex` | NOT STARTED |
| C3.2 | `feat(web): client directory, client page with engagements, engagement checklist, templates editor with starter tax templates` | NOT STARTED |
| C3.3 | `feat(web): review workspace (preview, versions, thread, Accept / Request correction / Waive); private-then-shared deliverables` | NOT STARTED |
| C3.4 | `feat(web): advisor home queue + filtered lists; search by client/year/category/status/filename; contexts removed` | NOT STARTED |
| C4.1 | `feat(portal): Your next steps, request cards (upload / ask / I don't have this), separate views` | NOT STARTED |
| C4.2 | `feat(portal): multi-file upload queue, Submitted/Received/Accepted/Needs-correction states, phone layout + camera` | NOT STARTED |
| C4.3 | `feat(notify): server unread + notifications, reminder scheduler, generic email notices` | NOT STARTED |
| C5.1 | `feat(ux): empty/loading/error/offline states, focus, contrast, touch targets, keyboard pass` | NOT STARTED |
| C5.2 | `feat(ops): audit coverage, System status panel, backup v2 + backup_runs, integrity + restore drill scripts` | NOT STARTED |
| C5.3 | `chore(deploy): ops/windows — Caddyfile, WinSW services, Postgres/ClamAV config, firewall, install/update/verify scripts, runbook` | NOT STARTED |
| C5.4 | `chore(release): pilot release checks executed and recorded; legacy columns/routes contracted` | NOT STARTED |

**NEXT = C2.3** (authorize → stage → validate → scan → publish upload pipeline; quarantine;
sweeper; every upload is a version). Phase 0, Phase 1, C2.1 and C2.2 shipped.

C2.2 notes: new route files `engagements.ts`, `requests.ts`, `versions.ts`, `templates.ts`,
`dashboard.ts`, `search.ts`, `notifications.ts`; `documents.ts` rewritten; `presets.ts` is now a
**read-only** shim (GET answers from `request_templates` in the old bins shape; POST/DELETE → 410).
Shared helpers: `routes/serialize.ts` (every public shape; `storageKey` / `sha256` / `storagePath`
never leave the server) and `routes/scope.ts` (tenant loaders — the single place that decides 404).
`workflow/versions.ts` `recordNewVersion()` holds the rule the review loop rests on — **a new version
supersedes the old one, repoints `currentVersionId`, sends the request back to `submitted` and leaves
the previous review row untouched** — and C2.3's publish step must call it rather than reimplement it.
`workflow/starter-templates.ts` seeds the two starter checklists on the first `GET /templates`, once
per provider and never again once they have any template.

**Ordering rule made explicit in C2.2:** for a resource the caller *can* see, a wrong role is 403; for
one they cannot, it stays 404. So `requireProvider` is only mounted on routes with no id to hide
(`POST /engagements`, `/templates`, `/dashboard`); every `/:id` verb loads first via a local
`loadForAdvisor` and only then checks the role. Getting this backwards would have told every client
that any id exists.

Request state machine (`requests.ts`): `requested → submitted → accepted | needs_correction →
submitted → accepted`, `waive` (reason REQUIRED, 400 `reason_required`) from any state, `reopen` back
to `submitted` when an answer is on file else `requested`. `accept` / `request-correction` refuse with
400 `nothing_submitted` when nothing has been submitted, and 400 `version_mismatch` for a version that
belongs elsewhere. A client's `respond {kind:'not_applicable'}` records the answer and **deliberately
does not move the status** — it surfaces under the dashboard's `needsDecision` instead, because only
the advisor takes something off a checklist.

`DELETE /documents/:id` now **archives** (`{ok:true, archived:true}`); nothing a client sent is
destroyed by a click. `GET /documents?includeArchived=true` brings archived rows back.
Deliverables: `share` / `unshare` are explicit verbs; an unshared deliverable is **404 for the client
everywhere** — detail, versions, download, list and the engagement tree.

**Test fixture rewritten:** `seedFixture()` now represents a database AFTER the C2.1 import
(engagements, requests, versions, deliverables shared), and `seedLegacyFixture()` is the pre-import
shape that `import.test.ts` uses — running the import against an already-converted database would
prove nothing.

Frontend: only `src/api/client.ts` — `api.presets.create/remove` now write to `/templates` with a
bins↔items adapter, so the existing Settings screen keeps working against the new source of truth.
Reads still use the server shim. The whole adapter goes away with the C3.2 templates editor.

Gate: **569 tests / 12 files** (was 383 / 11); the authz matrix alone is 424 cases (was 262) — every
new route carries all six actor rows.

C2.1 notes: migration `0007_workflow_model` (additive; verified by the DROP/TRUNCATE/ALTER-TYPE grep).
Enums `engagement_kind|engagement_status|request_status|document_kind|scan_status|review_decision|
template_kind`. New tables `engagements`, `requests`, `document_versions`, `reviews`,
`request_templates`, `notifications`, `audit_log`, `backup_runs` (the last two land now rather than in
C5.2 — the C2.1 spec says "the Data model tables", and both are additive and unreferenced until their
own commits). `documents` gains `engagementId, requestId, kind, displayName, category, currentVersionId,
sharedAt, sharedById, archivedAt`; **all nullable on purpose — `kind IS NULL` means "not yet imported",
which is exactly what makes the import idempotent**. `clients.emailNormalized` added; its unique index
is still C5.4's job. `documents.currentVersionId` ↔ `document_versions.documentId` is circular, resolved
with drizzle's `AnyPgColumn` annotation.

**The audit trigger is hand-written at the end of the migration** (drizzle cannot generate it):
`audit_log_append_only()` raises on UPDATE and DELETE. TRUNCATE is statement-level and deliberately
still allowed — the test harness truncates between tests and a restore replaces the database.

`db/audit.ts` = `audit()` (never throws unless given a `tx`, so an audit failure cannot break the action
it records), `auditRequest()`, `hashedEmail()` (truncated sha256 — an address is never stored in the
clear), and the `AuditAction` vocabulary. `files/store.ts` brings forward the minimum of C2.3:
`dataRoot()` (required in production, dev default `server/.data`, gitignored), `newStorageKey()` →
`files/yyyy/mm/<uuid>.<ext>`, `absPathForKey()` (traversal-safe), `ensureKeyDir()`, `extOf()`.
`.env.example` documents `DATA_ROOT`.

`db/migrate-legacy.ts` (`npm run db:import-legacy -- --backup-manifest <path> [--trust-legacy-files]
[--dry-run] [--report <path>]`): refuses without a manifest younger than 24 h **with no override flag**
(also refuses a future-dated one — a wrong clock would defeat the check); copies files, never moves;
keeps legacy ids (a request has its document's id); a missing file is reported, not fatal; idempotent.
**Deviation from the plan's step 3, deliberate:** the plan gives every imported request status
`requested`; a legacy row that already carries a file is instead `submitted` (or `accepted` when its
legacy status was `reviewed`), because telling the advisor to chase a client who already delivered
would be worse than a strict reading. Without `--trust-legacy-files` versions are `pending` with a
`scan_retry` job each and `publishedAt` null — nothing is ever claimed `clean` unscanned (invariant 3).
Deliverables import as **shared** (they were visible before). Presets → `request_templates` (kind
`custom`, `key = <binId>:<slug(title)>`, category = bin label).

**`scripts/count.mjs` fix found by the rehearsal:** extending TABLES made it crash on a backup set
restored from *before* this migration. `countAll` now counts only the tables a database actually has
and returns `missingTables`, so older backup sets stay verifiable. Without the rehearsal this would
have broken the restore drill for every existing backup.

Gate: 383 tests / 11 files, server build + `typecheck:test` clean, root typecheck / lint (11 inherited
warnings) / build clean. Rehearsed for real on 2026-09-06: restore drill PASS → migrate → dry-run →
import → second run created nothing → all 5 versions' bytes matched their recorded sha256 and size →
legacy uploads untouched. Then run against the dev DB with `--trust-legacy-files`; `db:seed` still
succeeds. Recorded in `docs/PILOT-RUNBOOK.md`.

C1.3 notes: migration `0005_invites_resets` (additive: `invitations`, `password_resets`, `providers`/`clients` +
`deactivatedAt`, `passwordChangedAt`; both tables join `scripts/count.mjs` TABLES). `server/src/auth/passwords.ts`
= bcrypt cost 12 (`PASSWORD_BCRYPT_COST` lowers it outside production; the test setup uses 4), zod `passwordSchema`
min 12, `verifyPassword` reports `needsRehash` and login re-hashes cost-10 hashes, `isRefusedDemoPassword` refuses
`password123` / `client123` when `NODE_ENV=production`. `auth/tokens.ts` (32-byte base64url token, sha256 at rest,
`tokenState`, `appBaseUrl`), `auth/signin.ts` (`openSession`, `providerMe`, `clientMe`, `AuthState` shared by
login / signup / invitation accept), `auth/invitations.ts` (7-day single-use link; a new one deletes unused older
ones; accept sets the password, burns the link, revokes the client's sessions), `auth/resets.ts` (1-hour single-use
link; `setPassword` stamps `passwordChangedAt`; completing revokes every session). Routes: `POST
/clients/:id/invitations` → `{link, expiresAt, emailQueued:false}` (409 `deactivated`), `POST
/clients/:id/password-reset` (copy-link; 409 `not_invited` without a password), `POST /clients/:id/deactivate` (revokes
sessions, drops unused invitations, idempotent) / `reactivate`; public `GET /invitations/:token` (404
`invalid_token`, 410 `used` / `expired`; deactivated client → 404) and `POST /invitations/:token/accept {password}` →
`{stage, me}` + cookie (stage `mfa_enroll` unless already enrolled); `POST /auth/password {currentPassword,
newPassword}` (400 `wrong_password` — never 401, which would log the UI out; revokes every other session); `POST
/auth/password-reset/request {email, kind}` always 202 and only creates a row for a live account with a password;
`POST /auth/password-reset/confirm {token, password}` (400 `invalid_token` / `used` / `expired`). Login refuses a
deactivated account (401 `deactivated`) and a demo password in production (401 `demo_password`) only after the
password matched, so a wrong password stays a generic 401. `loadAuth` returns null for a deactivated account so the
next request of any live session is 401 `revoked`. Throttle: invitation/reset lookups 10 / h per IP
(`RATE_LIMIT_LOOKUP_IP`; `createLookupLimiter` unit-tested). Client serializer adds `hasPassword`,
`invitePendingUntil`, `deactivatedAt` (never a hash or token). Admin CLI `server/src/admin.ts` (`npm run admin --
create-advisor|reset-mfa|reset-link|deactivate|reactivate|list-sessions|list-users|unlock`): password prompted with
echo off, or `DOCFLOW_ADMIN_PASSWORD` for scripts; every change is recorded as an `activities` row with `actorName
'Administrator (CLI)'` (the audit bridge until C2.1's `audit_log`). **Deviation:** `unlock` cannot clear the login
throttle — it lives in the API process's memory (15-minute windows) — so the command prints how to clear it
(restart `docflow-api`); a DB-backed throttle was not worth adding for the pilot. `reset-link` is the CLI's copy-link
for an advisor's own reset until C1.4 sends email. Frontend: `/invite/:token` (who invited whom → set password →
`adopt(state)` → `/mfa/enroll`), `/forgot` (always "if an account exists…", with the copy-link hint), `/reset/:token`,
"Forgot your password?" on `/login`; `ClientAccess` (state pill Not invited / Invited / Portal access / Deactivated,
Invite / Resend invite, Reset link, Deactivate with confirm, Reactivate; `LinkModal` shows a one-time link with Copy) on
the client page header; the home list shows the access pill and sinks deactivated clients; `NewClientDialog` no longer
takes a password — it creates the client and immediately shows the invitation link; `SecurityCard` gains Change
password. Tests: `accounts.test.ts` (15), `admin-cli.test.ts` (6, spawns `node tsx src/admin.ts` against
`docflow_test`), 9 matrix rows; `PASSWORD_BCRYPT_COST=4` and `RATE_LIMIT_LOOKUP_IP=100000` in the test setup.

C1.2 notes: migration `0004_mfa` (additive: enum `session_stage`, tables `mfa_totp` + `recovery_codes`,
`sessions.stage` default `preauth`; both tables join `scripts/count.mjs` TABLES). `server/src/auth/crypto.ts` =
AES-256-GCM under `APP_ENCRYPTION_KEY` (64 hex or base64, 32 bytes; wire format `v1:iv:tag:ct`; required in
production, fixed dev key with a one-time warning elsewhere; `app.ts` calls `encryptionKey()` at boot so a bad key
fails fast). `server/src/auth/mfa.ts` = otplib TOTP (30 s, window ±1), `lastUsedStep` replay guard, `qrcode` data
URL, 10 recovery codes × 10 chars from an unambiguous alphabet, bcrypt cost 10, single use, regenerable with a fresh
code. Login (and signup) now answer `{stage, me}` and create the session in `preauth` (enrolled) or `mfa_enroll`
(not enrolled) — never `active`; `GET /auth/me` answers the same envelope in every stage. Stage gating lives in
`middleware/auth.ts`: `authenticate` refuses a non-active session with 403 `{code:'mfa_required', stage}` without
touching it; `authenticateAnyStage` is used only by `/auth/me` and `/auth/mfa/*` (`/auth/logout` needs no auth;
`/auth/logout-all` and `/auth/sessions` stay active-only). Routes: `POST /auth/mfa/verify {code | recoveryCode}`,
`POST /auth/mfa/enroll` (409 once enrolled — re-enrollment is the C1.3 admin reset), `POST /auth/mfa/enroll/confirm
{code}` → recovery codes once, `POST /auth/mfa/recovery-codes {code}`, `GET /auth/mfa/status`. Throttle: 5 wrong
codes / 15 min per session (`RATE_LIMIT_MFA_VERIFY`). Frontend: `/mfa` and `/mfa/enroll` behind `MfaGate`,
`RouteGuard` forwards a non-active session to its stage screen and back to `from` afterwards, the API client raises
`docflow:mfa-required` on a 403 so a session that lost its second factor mid-use falls back a stage;
`SecurityCard` (two-step status, recovery codes left + regenerate, live sessions, sign out everywhere) sits on the
advisor `/settings` and at the bottom of the client portal (`#security`). Seed: every demo account is enrolled with
the published dev secret `DOCFLOW2DEV2TOTP2SECRET2` (`npm run totp -- <secret>` prints the code); `db:seed` refuses
to run with `NODE_ENV=production`. Tests: `test/mfa.test.ts` (16) + 5 matrix rows; `loginAs` now completes both
steps (clearing the replay guard so one test can sign the same actor in twice inside a 30 s step). Gate: 251 tests
/ 7 files.

C1.1 notes: `server/src/auth/{sessions,csrf}.ts`, `server/src/security/{headers,limits}.ts`, migration
`0003_sessions` (additive; `sessions` also joins `scripts/count.mjs` TABLES). `authenticate` loads the row by
the sha256 of the cookie token, refuses `revoked` / `expired` / `idle` with a `reason` in the 401 body and
clears the cookie, then bumps `lastSeenAt` at most once a minute and never with `X-DocFlow-Poll: 1`. Cookie
`__Host-docflow_session` in production (`docflow_session` otherwise), Max-Age 12 h. Origin check
(Sec-Fetch-Site first, else Origin must equal the `APP_BASE_URL` origin, neither → 403 `bad_origin`) is
mounted on `/api` before every router, so an anonymous or multipart cross-site request dies before auth or
parsing; the harness sends the app Origin by default (`helpers.request`) and uses raw supertest for the
negative cases. Helmet: CSP exactly as specified, Referrer-Policy no-referrer, nosniff, X-Frame-Options
SAMEORIGIN, no HSTS (Caddy's), plus `Permissions-Policy: camera=(self)`. Throttles: login 20 / 15 min per IP
and 10 / 15 min per email, global 600 / 15 min per session (hashed cookie) or IP; `RATE_LIMIT_*` env
overrides (the test setup raises the global one, the limiter is unit-tested). Field limits: names 200,
instructions 2 000, messages 5 000, JSON 1 MB → 413. Revocation paths tested: logout, logout-all, advisor
setting a client password (`PATCH /clients/:id`), account deleted. `jsonwebtoken` and `JWT_SECRET` are gone;
`APP_BASE_URL` is required in production and `TRUST_PROXY=1` is the only way to get `trust proxy`. Frontend:
`api/client.ts` gained `poll`, the 401 `reason` reaches `AuthContext` as a toast, and `api.auth.logoutAll` /
`sessions` are ready for the C1.2 security card. Gate: 205 tests / 6 files (~80 s).

C0.3 notes: `ops/windows/{common,backup,restore}.ps1` (Windows PowerShell 5.1) plus
`server/scripts/{lib,count,integrity,create-db}.mjs` (cwd-independent, `npm run count|integrity|db:create`).
Backup and restore drill both ran for real on the dev box and are recorded in
`docs/PILOT-RUNBOOK.md` (PASS; backup 1.8 s, restore 4.0 s). Manifest format v1 is what C2.1's
`--backup-manifest` check expects. Gotcha found and fixed: PowerShell 5.1 `Set-Content -Encoding UTF8`
writes a BOM that `JSON.parse` rejects — write manifests with `UTF8Encoding($false)`.

C0.1 notes: 154 matrix tests; 41 of them were `it.fails` cases pinning defects 1, 2 and 6 plus
the open signup route. The `docflow` role on the dev box lacks CREATEDB, so `docflow_test` was
created with `PG_ADMIN_URL=postgres://postgres@localhost:5432/postgres` (the native install
trusts the postgres superuser on loopback — a dev-box convenience the firm PC must not copy).
Pushing C0.1 revealed `52f3ba3` on `origin/main` (2026-07-24, a frontend-only mock-data dashboard
refactor on the pre-backend line); by the user's decision it was recorded with `git merge -s ours`
(`e1a9771`) and contributes no content — the pilot continues on the API-wired line.

C0.2 notes: every `it.fails` flipped; the matrix guards that none remain. Also landed: the
upload route resolves and authorizes its target **before** the multipart body is parsed
(bytes still buffer in memory once authorized — C2.3 replaces that with staging), and
malformed document ids answer 404 instead of 500. Defects 1, 2, 4 and 6 from "Context" are
closed; 3 is half-closed; 5 and 7 remain for C2.1 / C1.x.

## Context — what exists on 2026-09-05 (verified in code)

Repo `C:\Users\omara\Desktop\docflwo`, GitHub `Womarali1992/docflow`. Branch `finish-docflow-app`
is one commit ahead of `main` (`5e611c2`, pushed to origin). No deploy automation exists.

- **Frontend:** Vite 5 + React 18 + TS (**non-strict** `tsconfig.app.json`), react-router 6.
  shadcn/Radix components are installed but the DocFlow screens use their own `df-*` CSS
  (`src/components/docflow/styles.css`: warm-neutral oklch surfaces, deep-navy accent
  `--df-accent`, IBM Plex loaded from **Google Fonts** in `index.html`, 13 px base).
  `@tanstack/react-query` is installed and `QueryClientProvider` wraps the app, but nothing
  uses it — all data flows through `AuthContext`, `ClientsContext`, `DocumentsContext`
  (load everything on login, manual `refresh()`). No tests. Pages: `Index` (practice
  overview), `Client` → `DocFlowDashboard` (582 lines; prev/next pager, no directory),
  `Documents`, `Document` (details + "Mark reviewed"), `Settings` (presets), `FinancialOverview`
  (labelled Calendar), `ClientPortal` (one scroll page with anchors), `Login` (dev creds
  prefilled under `import.meta.env.DEV`). `vite.config.ts` loads `lovable-tagger` in dev only.
- **Backend:** Express 4 + Drizzle 0.36 + pg, zod, bcryptjs (cost 10), jsonwebtoken (7-day JWT
  in `docflow_session` httpOnly cookie, SameSite=Lax), multer 2 **memoryStorage** (25 MB,
  declared-MIME allowlist only, no content sniffing), express-rate-limit 8 on login only.
  Files stored as `server/uploads/<docId>.<ext>`; replacing a file **overwrites in place**.
  `server/src/index.ts` mounts `/api/{auth,clients,documents,messages,presets,activities}`.
  Server tsconfig is strict.
- **Schema (3 migrations):** `providers`, `clients` (email not unique, nullable passwordHash,
  computed counters via correlated subqueries), `documents` (one table for requests, uploads,
  deliverables and "versions": `isRequested`, `folder='Reports'` means deliverable,
  `hasUpdateRequest`, `status pending|reviewed|needs_update|in_review`, `requestFrequency`),
  `messages` (`readAt` = unread state), `activities`, `presets` (jsonb bins).
  `src/utils/documentGrouping.ts` fakes versioning by stripping years/months from names.
- **Verified defects the pilot must fix:**
  1. `PATCH /api/documents/:id` only checks ownership, so a **client can set `status: 'reviewed'`**
     on their own document, clear `hasUpdateRequest`, and edit request metadata.
  2. `POST /api/documents/:id/file` and `DELETE /api/documents/:id` let a **client replace or
     delete an advisor deliverable** (`folder='Reports'`).
  3. Upload middleware runs **before** the target document is loaded and authorized: up to 25 MB
     is buffered in memory before any ownership check.
  4. `POST /api/auth/signup-provider` is open to the internet.
  5. `clients.email` is not unique; login takes the first matching row.
  6. Cross-tenant ids return **403** (confirms existence); responses include `storagePath`.
  7. No CSRF check, no security headers, no session revocation, no MFA.
- **Machine facts (dev box, not the firm PC):** Windows 11 **Home** 26200, Node 22.17, npm 10.9,
  Docker 29, native PostgreSQL **16 and 17 services both running**; a native Postgres shadows
  the docker `docflow-pg` container on `localhost:5432` (memory `docflow-db-5432-quirk`).
  `psql`/`pg_dump` are **not on PATH** (they live under `C:\Program Files\PostgreSQL\<ver>\bin`).
  No Caddy, ClamAV, NSSM or WinSW installed.
- **Gate baseline:** `npx tsc --noEmit -p tsconfig.app.json` 0 errors; `npm run lint` 0 errors /
  11 pre-existing react-refresh warnings; `npm run build` OK; `cd server && npm run build` 0 errors.
- **Seed accounts:** advisor `sarah@meridiancpa.com / password123`; clients
  `sarah.johnson@meridian.co`, `m.chen@chenco.io`, `emily@davisventures.com` / `client123`.

## Review findings and adopted decisions (2026-09-05)

| # | Finding in the original plan | Decision |
|---|---|---|
| R1 | Authorization fixes are scheduled inside the big Phase 1; the two authz defects above are live today and cost hours, not days. | **Phase 0 hotfix (C0.2)** before any schema change, guarded by an automated authz matrix (C0.1) that stays as the regression gate for every later commit. |
| R2 | "Functional and security coverage will be added" but there is no test runner at all. | vitest + supertest against a `docflow_test` database. The release checks (cross-client access, spoofed/oversize/infected uploads, session invalidation, migration counts) become **automated tests**, not a manual list. |
| R3 | "Briefly pause writes ... while capturing a consistent backup set." | Not needed. Files are immutable and a version's file reaches disk **before** its row commits, so backup order **dump → files → manifest** guarantees every referenced file exists. No maintenance mode. |
| R4 | "Use shared shadcn components" next to the df-* palette would give two looks (Tailwind hsl blue primary vs df oklch navy). | Adopt Radix/shadcn primitives (Dialog, Select, Popover, Tooltip, Tabs, Toast) but **remap the shadcn CSS variables inside `.df-root` to df tokens**. One look, real accessibility. |
| R5 | CSRF protection unspecified; the app is same-origin behind Caddy. | SameSite=Lax cookie (Strict breaks email-link landings) + **Origin / Sec-Fetch-Site check** on every non-GET `/api` request + JSON-only bodies. No token plumbing. |
| R6 | Scanner-failure handling says "remain unavailable"; unclear whether the client must re-upload. | Scanner down → file stays **quarantined with a retry job**; the client's submission shows as *Received, checking*; nothing is published or lost; the advisor sees scanner health. Never auto-publish on scanner error. |
| R7 | BitLocker is assumed; the dev machine is Windows 11 Home (no BitLocker To Go, no manageable BitLocker). | Prerequisite: the firm PC runs **Windows 11 Pro**. If Home is unavoidable: Device Encryption for the system volume and an explicit user decision on the backup drives before launch. |
| R8 | "Run Node ... as Windows services" names no mechanism. | **WinSW** (maintained, XML checked into `ops/windows/`, restart on failure, log rolling) for `docflow-api`, `docflow-worker`, `caddy`. ClamAV registers its own services; Postgres already is one. NSSM is the fallback. |
| R9 | Upload path buffers before authorization. | Route order **authenticate → load + authorize target → stream to staging (multer diskStorage) → validate → scan → publish (rename on the same volume + DB transaction)**. Staging and files directories share one volume so rename is atomic. |
| R10 | "Validate extensions and actual content" is unspecified. | `file-type` magic bytes for PDF/PNG/JPEG/GIF/WebP/OOXML/OLE; CSV/TXT must be valid UTF-8 without NUL; declared MIME, extension and sniffed type must agree; encrypted PDF (`/Encrypt` in trailer) and encrypted Office (OLE `EncryptedPackage` stream) become `encrypted` and unavailable with an explanation. |
| R11 | Preview mechanism unspecified. | Native browser viewer: sandboxed `<iframe>` for PDF, `<img>` for images, pointing at the authenticated per-version endpoint with `nosniff`, `Cache-Control: private, no-store`, `Content-Security-Policy: sandbox`, inline disposition. No pdf.js. Office/CSV download only. |
| R12 | Password hashing not mentioned; argon2 needs native builds on Windows. | Keep **bcryptjs at cost 12** (pure JS). Re-hash cost-10 hashes on the next successful login. |
| R13 | "Send generic email invitations" makes SMTP a hard dependency for onboarding. | Email goes through the job queue, and every invitation/reset also returns a **copy-link** to the advisor so onboarding works before SMTP is configured. |
| R14 | "Background polling does not extend inactivity" — no mechanism named. | Polls send `X-DocFlow-Poll: 1`; the session middleware skips the `lastSeenAt` bump for them. Bumps are coalesced to once per minute. |
| R15 | TOTP depends on a correct clock. | `install.ps1` verifies the Windows Time service is running and synced; ±1 step tolerance; replay protection via `lastUsedStep`. |
| R16 | Two Postgres majors run on the dev box; the docker container is a decoy. | Dev and tests use the native instance (`DATABASE_URL`, `DATABASE_URL_TEST`); the firm PC gets one dedicated PostgreSQL 17. Never inspect via `docker exec docflow-pg`. |
| R17 | "Put records with unknown engagement/year into Imported documents" — how are legacy request rows and links preserved? | Each legacy request row becomes a `requests` row **with the same id**; each legacy file becomes `documents` (same id) + `document_versions` v1. Legacy `GET /api/documents/:id/download` resolves to the current version so existing links and stored `url` values keep working. |
| R18 | Migration safety is not enforced. | The legacy import **refuses to run** unless handed a backup manifest younger than 24 h (`--backup-manifest`). It is idempotent, copies (never moves) legacy files, and writes `migration-report.json` (counts, missing files, duplicate emails). Rehearsed on a restored copy first. |
| R19 | Tests, migrations and backups need Postgres tooling that is not on PATH. | Scripts resolve `pg_dump`/`pg_restore`/`psql` from `PG_BIN` or the newest `C:\Program Files\PostgreSQL\*\bin`. |
| R20 | The frontend tsconfig is non-strict; flipping strict mid-program would derail the schedule. | Keep non-strict for the app; new frontend modules are written to pass strict anyway. Server stays strict. |
| R21 | Plan keeps `requestFrequency` cadences (daily/monthly/…) while moving to engagement checklists. | Cadence is dropped from the request model; recurring needs become items on a new engagement (e.g. next tax year). Legacy `requestFrequency` is frozen and dropped in C5.4. |

## Product direction (unchanged from the user's plan)

One CPA, several clients, dedicated firm-owned Windows PC, secure internet access. Preserve
existing data; refine the current warm-neutral/navy look. Core loop: **Create engagement →
request documents → client uploads → advisor reviews → resolve corrections → share completed
work.** Clients always know their next step; advisors immediately see what needs attention.
Stack stays React + Express + Drizzle + PostgreSQL.

**Boundaries:** one advisor per installation; one client login per client record (existing
extra accounts preserved); firm timezone configured at setup. Out of scope: team permissions,
e-signatures, cloud integrations, AI/OCR extraction, financial analytics, automated permanent
retention.

## Architecture invariants

1. **Authorize before bytes.** Every upload route resolves and authorizes its target
   (request / engagement / document) before the multipart parser runs.
2. **Files are immutable.** A version's bytes live at `files/<yyyy>/<mm>/<uuid>.<ext>` and are
   never renamed, overwritten or deleted during the pilot. Replacement = new version. Archival
   is a flag.
3. **Publish before commit.** Staged file → validated → scanned → renamed into `files/` → then
   the `document_versions` row is inserted/published in one transaction. Any failure removes
   the staged file. The sweeper reconciles leftovers.
4. **Quarantine by default.** A version is `scanStatus='pending'` until ClamAV says clean. Only
   `clean` versions are downloadable/previewable. `infected`, `encrypted`, `error` stay
   unavailable with a reason.
5. **Cross-tenant → 404, never 403.** Existence is never confirmed. Every linked id
   (engagement, request, document, version, message) must resolve to the same `clientId`
   **and** `providerId` as the caller's scope.
6. **Explicit actions, not permissive patches.** State changes are `POST /:id/<verb>`; role is
   checked per verb. Clients never set review state, deadlines, waivers, sharing or
   organization.
7. **Response objects are explicit.** Serializers (`toDocumentDto`, `toVersionDto`, …)
   enumerate fields; storage keys, secret hashes and token hashes never leave the server.
8. **Sessions are server rows.** Opaque token, hashed at rest, 30 min idle / 12 h absolute,
   revocable; polls never extend them. Logout, password change, reset and deactivation revoke
   every session of that user.
9. **MFA for everyone.** A session in `preauth` / `mfa_enroll` stage can only reach the MFA,
   enrollment, `me` and logout endpoints.
10. **Origin check on every state change.** Non-GET `/api` requests must carry a matching
    `Origin` (or `Sec-Fetch-Site: same-origin`) or are rejected 403.
11. **Audit log is append-only.** A trigger raises on UPDATE/DELETE. Never store passwords,
    tokens, document bytes or message bodies in it.
12. **Data outside the repo.** `DATA_ROOT` (files, staging) and the Postgres data directory live
    on the encrypted data volume, never under the repo, OneDrive or Desktop.
13. **Legacy compatibility during expansion.** Legacy columns and routes keep working until
    C5.4 contracts them; every shim is a row in the Compatibility ledger.
14. **No destructive migrations before C5.4**, and C5.4 drops only what the ledger says.
15. **Everything the client sees derives from server state** — unread counts, statuses,
    overdue flags come from the API, never from client-side inference.
16. **Loopback only** for the API (`127.0.0.1:4000`), Postgres (`127.0.0.1:5432`) and clamd
    (`127.0.0.1:3310`). Caddy is the only network listener.
17. **Match the house look.** df tokens, IBM Plex (self-hosted from C3.1), 13 px base, hairline
    borders, restrained status colours. Radix primitives, remapped, for dialogs and controls.
18. **Tests are the release checks.** Every automated release check lives in `server/test/`
    and runs in `npm test`; a commit that weakens one is not shippable.

## Data model (target after C2.1)

Enums: `engagement_kind(individual_tax, business_tax, other, imported)` ·
`engagement_status(open, closed)` ·
`request_status(requested, submitted, in_review, needs_correction, accepted, waived)` ·
`document_kind(client_upload, deliverable, imported)` ·
`scan_status(pending, clean, infected, encrypted, error)` ·
`review_decision(accepted, needs_correction)` · `session_stage(preauth, mfa_enroll, active)` ·
`user_kind` = the existing `actor_kind`.

| Table | Columns (beyond id / createdAt / updatedAt) | Notes |
|---|---|---|
| `engagements` | providerId, clientId, title, kind, taxYear int?, status, closedAt?, archivedAt? | e.g. "2026 Individual Tax Return". One `imported` engagement per client, created by the import. |
| `requests` | providerId, clientId, engagementId, title, instructions?, category?, required bool, dueDate?, status, sortOrder, templateItemKey?, waivedReason?, waivedAt?, waivedById?, clientResponseKind? (`not_applicable`), clientResponseNote?, clientResponseAt?, importedFromDocumentId?, archivedAt? | Overdue is derived: status ∈ {requested, needs_correction} and dueDate < now (firm-tz end of day). A `not_applicable` response keeps status `requested` and shows in the advisor's "Needs decision" list. |
| `documents` | providerId, clientId, engagementId?, requestId?, kind, displayName, category?, currentVersionId?, sharedAt?, sharedById?, archivedAt?; **legacy columns kept**: name, type, size, folder, url, storagePath, mimeType, sizeBytes, uploadedBy*, isRequested, requested*, description, requestFrequency, dueDate, hasUpdateRequest, updateRequest*, requestedVersion, status | `sharedAt IS NULL` on a deliverable = private (client gets 404). Legacy columns frozen at import; dropped in C5.4. |
| `document_versions` | documentId, versionNo, originalFilename, mimeType, sizeBytes, sha256, storageKey (unique), scanStatus, scanDetail?, scannedAt?, uploadedByKind, uploadedById, publishedAt?, supersededAt? | `storageKey` = `files/yyyy/mm/<uuid>.<ext>`. Unique (documentId, versionNo). |
| `reviews` | documentId, versionId, requestId?, reviewerId, decision, note? | A newer version sends the request back to `submitted`; old review rows stay. |
| `request_templates` | providerId, name, kind (individual_tax / business_tax / custom), items jsonb `[{key, title, category, instructions, required, dueOffsetDays?}]`, archivedAt? | Replaces `presets`; the import converts existing presets (bins → items, category = bin label). |
| `sessions` | tokenHash unique, userKind, userId, stage, createdAt, lastSeenAt, expiresAt, revokedAt?, ip?, userAgent? | `expiresAt = createdAt + 12 h`. |
| `mfa_totp` | userKind, userId (unique pair), secretEnc (AES-256-GCM under `APP_ENCRYPTION_KEY`), enrolledAt?, lastUsedStep? | Enrolled when `enrolledAt` is set. |
| `recovery_codes` | userKind, userId, codeHash, usedAt? | 10 per enrollment, bcrypt, single use. |
| `invitations` | clientId, tokenHash unique, expiresAt (7 d), usedAt?, createdById | Single use. |
| `password_resets` | userKind, userId, tokenHash unique, expiresAt (1 h), usedAt? | Single use; success revokes all sessions. |
| `notifications` | userKind, userId, type, title, body?, link?, readAt? | Server unread state for non-message events. |
| `jobs` | type, payload jsonb, runAt, attempts, maxAttempts, lockedAt?, lockedBy?, lastError?, doneAt?, dedupeKey? unique | `FOR UPDATE SKIP LOCKED` worker. |
| `audit_log` | at, actorKind?, actorId?, action, targetType, targetId?, clientId?, ip?, meta jsonb | Append-only trigger. |
| `backup_runs` | startedAt, finishedAt?, ok bool, dumpBytes, fileCount, manifestPath, error? | Written by `backup.ps1` through `npm run backup:record`. |
| `providers`, `clients` | + `deactivatedAt?`, `passwordChangedAt?`; clients + `emailNormalized` (unique index only after duplicates are resolved, C5.4) | |

Indexes: every FK; `requests(providerId, status, dueDate)`; `documents(clientId, engagementId)`;
`document_versions(documentId, versionNo)`; `sessions(userKind, userId)`;
`jobs(runAt) where doneAt is null`; `audit_log(at)`, `audit_log(clientId, at)`.

## API surface (target after C2.2; legacy routes kept until C5.4)

**Auth & sessions:** `POST /auth/login` → `{stage: 'preauth'|'mfa_enroll'|'active', me?}` ·
`POST /auth/mfa/verify {code | recoveryCode}` · `POST /auth/mfa/enroll` → otpauth URL + QR data
URL · `POST /auth/mfa/enroll/confirm {code}` → recovery codes (shown once) ·
`POST /auth/mfa/recovery-codes` (regenerate; requires a fresh code) · `POST /auth/logout` ·
`POST /auth/logout-all` · `GET /auth/me` · `GET /auth/sessions` · `POST /auth/password`
(change; revokes other sessions) · `POST /auth/password-reset/request {email, kind}` (always
202) · `POST /auth/password-reset/confirm {token, password}` · `GET /invitations/:token`
(public, limited) · `POST /invitations/:token/accept {password}`.

**Advisor:** `GET/POST /clients`, `GET/PATCH /clients/:id`, `POST /clients/:id/deactivate|reactivate`,
`POST /clients/:id/invitations` → `{link, emailQueued}` · `GET/POST /engagements?clientId`,
`GET/PATCH /engagements/:id`, `POST /engagements/:id/close|reopen` ·
`POST /engagements/:id/requests` (bulk from a template or explicit items) · `PATCH /requests/:id`
(title, instructions, category, required, dueDate, sortOrder) · `POST /requests/:id/accept {versionId}` ·
`POST /requests/:id/request-correction {versionId, note}` · `POST /requests/:id/waive {reason}` ·
`POST /requests/:id/reopen` · `POST /documents/:id/accept|request-correction {versionId, note?}`
(ad-hoc uploads) · `POST /documents/:id/share|unshare` (deliverables) ·
`POST /documents/:id/archive|unarchive` · `PATCH /documents/:id` (displayName, category,
engagementId — organization only) · `GET/POST /templates`, `PATCH/DELETE /templates/:id` ·
`GET /dashboard` → `{readyToReview, waitingOnClients, overdue, unreadMessages, needsDecision}`
each with ids · `GET /ops/status` · `GET /audit?clientId&limit`.

**Client:** `GET /me/home` → next steps (open requests with instructions / deadline / state,
progress n of m, shared-deliverable count, unread) · `POST /requests/:id/uploads` (multipart;
creates document + version; request → `submitted`) · `POST /requests/:id/respond
{kind: 'not_applicable', note}` · `POST /engagements/:id/uploads` (ad-hoc) ·
`GET /documents?engagementId&kind` (deliverables only when shared).

**Both:** `GET /engagements/:id` (tree: requests, documents, version summaries) ·
`GET /documents/:id` · `GET /documents/:id/versions` ·
`GET /documents/:id/versions/:vid/download|preview` · `POST /documents/:id/versions` (advisor:
new deliverable version; client: resubmission) · `GET/POST /messages`, `PATCH /messages/read` ·
`GET /notifications`, `POST /notifications/read` ·
`GET /search?q&clientId&year&category&status` (advisor; scoped for clients).

**Removed or gated:** `POST /auth/signup-provider` (only when `ALLOW_PROVIDER_SIGNUP=true`; off
in production) · `PATCH /documents/:id` review fields (C0.2 restricts to providers, C2.2
replaces with actions) · `DELETE /documents/:id` → archive (C2.2) · `POST /documents/:id/file`
→ wrapper that creates a version (C2.3), removed in C5.4.

## Security design

- **Sessions (C1.1):** cookie `__Host-docflow_session` in production (Secure, HttpOnly,
  SameSite=Lax, Path=/; plain `docflow_session` when `NODE_ENV !== 'production'`). Token = 32
  random bytes base64url; DB stores sha256. Middleware: load by hash → reject if revoked,
  `now > expiresAt`, or `now - lastSeenAt > 30 min` (401 with `{reason: 'idle'|'expired'|'revoked'}`);
  bump `lastSeenAt` at most once a minute and never when `X-DocFlow-Poll: 1`. `app.set('trust proxy', 1)`
  behind Caddy (express-rate-limit 8 validates this). `express.json` 1 MB; message body ≤ 5 000
  chars; names ≤ 200; instructions ≤ 2 000.
- **CSRF (C1.1):** for every non-GET `/api/*`: if `Sec-Fetch-Site` is present it must be
  `same-origin` or `none`; otherwise `Origin` must equal the origin of `APP_BASE_URL`.
  Multipart routes included.
- **Headers (C1.1):** helmet with CSP `default-src 'self'; img-src 'self' data: blob:;
  font-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `Permissions-Policy: camera=(self)` (photo capture). HSTS is set by Caddy.
- **Throttling:** login 20 / 15 min per IP + 10 / 15 min per email; MFA verify 5 / 15 min per
  session; reset and invite lookups 10 / h per IP; uploads 60 / h per session; global 600 /
  15 min per session.
- **MFA (C1.2):** `otplib` TOTP (30 s, ±1 step). Enrollment forced for every account without
  `mfa_totp.enrolledAt`; login returns `stage: 'mfa_enroll'`. Recovery codes: 10 × 10 chars,
  bcrypt-hashed, single use, regenerable after a fresh TOTP. Admin CLI can reset MFA (audited).
- **Passwords:** bcryptjs cost 12; minimum 12 characters; the seeded demo passwords are
  refused in production; invitation acceptance sets the first password; reset revokes sessions.
- **Provisioning (C1.3):** `npm run admin -- create-advisor --email --name --firm` (password
  prompted on the console), `reset-mfa`, `deactivate`, `reactivate`, `unlock`, `list-sessions`.
  All audited with `actorKind='admin'`.
- **Upload pipeline (C2.3):** multer `diskStorage` into `STAGING_DIR/<uuid>.part`,
  `limits.fileSize = 25 MB`, one file per part. Then `validate.ts` (extension ∈ allowlist;
  `file-type` sniff must map to the same canonical type; CSV/TXT text checks; encrypted
  detection) → `scan.ts` (clamd INSTREAM via the `clamscan` package, 60 s timeout; unreachable →
  `error` + `scan_retry` job every 5 min for 24 h) → `publish.ts` (sha256 computed while
  streaming, `rename` into `FILES_DIR/yyyy/mm/<uuid>.<ext>`, then one transaction: insert
  version, set `documents.currentVersionId`, supersede the previous version, move the request
  to `submitted`, audit, notification). Any failure deletes the staged file and returns a
  specific 4xx/503 with a stable `code`: `unsupported_type`, `type_mismatch`, `encrypted`,
  `too_large`, `infected`, `scanner_unavailable`. Sweeper job hourly: staged files older than 1 h
  without a version row → delete; versions with `publishedAt IS NULL` older than 1 h → `error`.
- **Delivery (C2.4):** `download` → `Content-Disposition: attachment; filename*=UTF-8''…` ·
  `preview` only for `clean` PDF/PNG/JPEG/GIF/WebP → `inline`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`, `Content-Type` from the
  **sniffed** type, streamed with `Content-Length`. Every download/preview is audited.
- **Audit (C2.1 / C5.2):** login success/failure (email hashed), MFA events, session
  revocations, invitation create/accept, password change/reset, client create/deactivate,
  engagement create/close, request create/accept/correction/waive, upload publish/quarantine,
  download/preview, share/unshare, archive, admin CLI actions, backup runs.

## Migration (legacy → target), C2.1

1. Refuse unless `--backup-manifest <path>` names a manifest younger than 24 h (C0.3 format).
   `--dry-run` prints the report without writing.
2. Per client: create the `imported` engagement "Imported documents" (skip if present).
3. Per legacy `documents` row:
   - `isRequested` → insert `requests` (same id; title = name, instructions = description,
     dueDate, status `requested`; `hasUpdateRequest` → `needs_correction` plus a `reviews` row
     carrying `updateRequestDescription`).
   - otherwise → set `kind` (`deliverable` if `folder='Reports'`, else `client_upload`),
     `engagementId` = imported engagement, `displayName = name`, `category = folder`; if
     `storagePath` exists and the file is readable → copy to
     `files/<uploadedAt yyyy>/<mm>/<uuid>.<ext>`, sha256, insert version 1 (`scanStatus='clean'`
     with `--trust-legacy-files`, else `pending` + scan jobs), set `currentVersionId`; status map
     `reviewed` → review `accepted`, `needs_update` → review `needs_correction`,
     `pending` / `in_review` → no review. Missing file → row kept, `currentVersionId` null,
     listed in the report. Deliverables import as **shared** (`sharedAt = uploadedAt`) because
     they were visible before.
4. Presets → `request_templates` (kind `custom`).
5. Clients: compute `emailNormalized = lower(trim(email))`; duplicates listed in the report; the
   unique index is a separate C5.4 migration that fails loudly if duplicates remain.
6. Write `migration-report.json` {clientCount, requestCount, documentCount, versionCount,
   bytesCopied, missingFiles[], duplicateEmails[], presetsConverted}. Compare with the
   pre-migration snapshot; the C2.1 test asserts equality on a seeded database.
7. `server/uploads/` untouched until C5.4.

## Frontend architecture (C3.x, C4.x)

- **Data layer:** `src/api/queries/*.ts` — `useMe`, `useDashboard`, `useClients`, `useClient(id)`,
  `useEngagement(id)`, `useRequests`, `useDocument(id)`, `useDocumentVersions`,
  `useMessages(thread)`, `useNotifications`, `useSearch`, `useOpsStatus`. Query keys prefixed
  `[me.kind, me.id, …]`; `staleTime` 10 s; `refetchOnWindowFocus`; polling 5 s for an open
  thread, 30 s for dashboard / home / queue, off when the tab is hidden; polls pass
  `X-DocFlow-Poll: 1` (`request(path, {poll: true})`). Mutations invalidate by prefix. `logout`
  → `queryClient.clear()`. `ClientsContext` / `DocumentsContext` are deleted in C3.4 after the
  last consumer moves.
- **Routes (advisor):** `/` queue · `/clients` directory · `/clients/:id` (engagements, activity,
  thread) · `/engagements/:id` (checklist, documents, deliverables, thread) · `/review/:documentId`
  (workspace) · `/documents` (search) · `/templates` · `/settings` (profile, security / MFA,
  sessions) · `/settings/system` (ops panel) · `/work?filter=…` (queue lists).
- **Routes (client):** `/portal` (Your next steps) · `/portal/requests` · `/portal/documents` ·
  `/portal/shared` · `/portal/messages` · `/portal/security`.
- **Auth routes:** `/login`, `/mfa`, `/mfa/enroll`, `/invite/:token`, `/forgot`, `/reset/:token`.
- **Design:** keep the `styles.css` tokens; add `.df-root` overrides for the shadcn variables
  (`--primary` ← `--df-accent`, `--border` ← `--df-border`, `--radius` ← `--df-radius`,
  `--background`, `--foreground`, `--muted*`, fonts) so Radix components look native. Self-host
  IBM Plex (`public/fonts/`, `@font-face` in `src/index.css`, remove the Google Fonts links, set
  `<title>DocFlow</title>`, drop the Lovable meta). Focus ring `2px solid var(--df-accent)`
  offset 2 px; ≥ 44 px touch targets in the portal; body text ≥ 13 px, meta ≥ 11.5 px with
  ≥ 4.5:1 contrast.
- **Upload queue:** `src/components/upload/UploadQueue.tsx` + `useUploadQueue` reducer:
  items `{file, requestId?, progress, state: queued|uploading|scanning|done|failed|cancelled,
  code?}`, `XMLHttpRequest` for progress, cancel via `xhr.abort()`, retry keeps the item, server
  `code` → copy ("This PDF is password-protected. Remove the password and upload it again.").

## Windows operations (C5.3 + `docs/PILOT-RUNBOOK.md`)

- **Layout on the firm PC:** `C:\docflow\app` (git checkout with built `dist/`),
  `C:\docflow\services` (WinSW exes + xml + logs), `D:\docflow-data\{files,staging}` on the
  BitLocker data volume (`DATA_ROOT`), the PostgreSQL 17 data directory on the same volume,
  `C:\docflow\caddy\{Caddyfile,data,config}`.
- **Accounts:** local user `docflow-svc` (non-admin) runs `docflow-api`, `docflow-worker` and
  `caddy` (Windows lets non-admins bind 80/443). ACL: modify on `DATA_ROOT` and
  `C:\docflow\caddy`, read on `C:\docflow\app`, nothing elsewhere. ClamAV services run as the
  installer configures and read only staging.
- **Services (WinSW):** `docflow-api.xml` (`node dist/index.js`, env from
  `C:\docflow\app\server\.env`, `<onfailure action="restart" delay="10 sec"/>`,
  `<log mode="roll-by-size">`), `docflow-worker.xml` (`node dist/worker.js`), `caddy.xml`
  (`caddy run --config C:\docflow\caddy\Caddyfile`). `install.ps1` creates the user, ACLs,
  services, firewall rules (inbound TCP 80/443 only), confirms `w32time` is running and synced,
  then runs `verify.ps1`.
- **Caddyfile:**
  ```
  docs.<firm-domain> {
    encode gzip zstd
    request_body { max_size 26MB }
    header {
      Strict-Transport-Security "max-age=31536000; includeSubDomains"
      X-Frame-Options SAMEORIGIN
    }
    handle /api/* { reverse_proxy 127.0.0.1:4000 { header_up X-Forwarded-Proto https } }
    handle { root * C:\docflow\app\dist ; try_files {path} /index.html ; file_server }
  }
  ```
  Certificates via Let's Encrypt HTTP-01 / TLS-ALPN (needs public DNS and inbound 80/443
  forwarded to the PC). Caddy's data dir must be writable by `docflow-svc`.
- **PostgreSQL 17:** `listen_addresses = '127.0.0.1'`, `password_encryption = scram-sha-256`,
  `pg_hba.conf` only `host all all 127.0.0.1/32 scram-sha-256`; roles `docflow_app` (db owner,
  login) and `docflow_backup` (login, `pg_read_all_data`). Scripts resolve binaries via `PG_BIN`.
- **ClamAV:** official Windows MSI; `clamd.conf`: `TCPSocket 3310`, `TCPAddr 127.0.0.1`,
  `MaxFileSize 30M`, `MaxScanSize 60M`, `StreamMaxLength 30M`, remove `Example`; `freshclam.conf`
  with `DatabaseMirror database.clamav.net`; `clamd --install`, `freshclam --install`; the first
  `freshclam` run needs internet. `GET /ops/status` reports PING and signature age (`VERSION`).
- **Backups (`backup.ps1`; Task Scheduler nightly 02:00 as `docflow-svc`, "run whether user is
  logged on or not"):** 1) `pg_dump -Fc` → `<dest>\<yyyy-mm-dd>\db.dump`; 2) `robocopy FILES_DIR
  <dest>\files /E /XO /R:2 /W:5` (adds new immutable files, **never purges**); 3) copy `.env`,
  Caddyfile, service xml → `<dest>\<day>\config\`; 4) `npm run backup:manifest -- <day-dir>` —
  sha256 of `db.dump`, every storage key in the DB with size/sha256, verifies each exists under
  `<dest>\files`, writes `manifest.json`; 5) prune day folders older than 30; 6) `npm run
  backup:record` inserts `backup_runs`. `-Dest` selects drive A or the weekly offline drive B.
  Order dump → files → manifest (R3).
- **Restore (`restore.ps1 -From <day> -Target docflow_restore`):** create the DB, `pg_restore`,
  copy `files`, run `npm run integrity` (every `clean` version's file exists and sha256 matches;
  prints counts vs manifest). Drill before launch on a clean Windows machine; target ≤ 4 h
  restore, ≤ 24 h data loss.
- **Update (`update.ps1`):** `git pull` on `main` → `npm ci` (root + server) → build both →
  `npm run db:migrate` → restart `docflow-api`, `docflow-worker` → `verify.ps1` (health, clamd
  ping, disk free, certificate expiry).
- **Ops panel (`/settings/system`, C5.2):** storage free/used on `DATA_ROOT`, clamd reachable +
  signatures updated at, last successful backup (from `backup_runs`), failed/stuck jobs, active
  sessions.

## Commit specs

### Phase 0 — safety net (no schema change)

**C0.1** Merge `finish-docflow-app` → `main` (fast-forward). Add `docs/CPA-PILOT-PLAN.md` (this
file). `server/vitest.config.ts`; `server/test/setup.ts` (connects to `DATABASE_URL_TEST`, runs
migrations once, truncates all tables between tests, seeds two providers × two clients each with
one upload, one request, one deliverable, one message); `server/test/helpers.ts` (`loginAs(kind,
email)` returning a cookie jar; `asProvider1/2`, `asClient1a/1b/2a`); `server/test/authz.test.ts`
— table-driven matrix over every current route × {provider1, provider2, client1a, client1b,
client2a, anonymous} asserting the expected status. **Cases for defects 1, 2 and 6 are written to
the target behaviour and marked `test.fails`** so C0.2 flips them. Export the Express app from
`server/src/app.ts` (`listen` stays in `index.ts`). `server/package.json`: `"test": "vitest run"`,
devDeps `vitest`, `supertest`, `@types/supertest`. Root `package.json` adds
`"typecheck": "tsc --noEmit -p tsconfig.app.json"`. Create `docflow_test` on the native Postgres
with `scripts/create-test-db.mjs` (uses `pg`, no psql needed).

**C0.2** `documents.ts`: clients lose access to `PATCH` (providers keep it); clients may
`POST /:id/file` only when the document is theirs **and** (`isRequested` or
`uploadedByKind='client'`), never `folder='Reports'`; clients may not `DELETE`. Cross-tenant
lookups return 404 in `documents`, `clients`, `messages`, `activities`. Add `serializeDocument()`
that omits `storagePath` and adds `hasFile: boolean`; use it in every response. `auth.ts`: signup
behind `ALLOW_PROVIDER_SIGNUP === 'true'`. Update `src/api/types.ts` (`hasFile` replaces
`storagePath`) and the three frontend call sites. Tests: matrix green, `test.fails` removed.

**C0.3** `ops/windows/backup.ps1` v1 (`pg_dump -Fc`, `robocopy server\uploads`, `manifest.json`
with sha256 per file, prune 30) resolving `pg_dump` via `PG_BIN` or the newest
`C:\Program Files\PostgreSQL\*\bin`; `ops/windows/restore.ps1` (fresh DB name, `pg_restore`,
copy uploads, count check via `scripts/count.mjs`); `docs/PILOT-RUNBOOK.md` section "Backup and
restore (legacy)". **Run the backup once on the dev box and restore into `docflow_restore`**;
record the result in the runbook. This manifest is what C2.1 demands.

### Phase 1 — identity

**C1.1** `server/src/auth/sessions.ts` (create / load / touch / revoke, cookie helpers),
`server/src/auth/csrf.ts`, `server/src/security/headers.ts` (helmet),
`server/src/security/limits.ts`; migration `0003_sessions`; `middleware/auth.ts` rewritten
(jsonwebtoken removed; `req.auth` keeps `{sub, kind, providerId, email, name}` so routes do not
change; `req.session` added); `/auth/logout-all`, `/auth/sessions`. Frontend: `api/client.ts`
sends `X-DocFlow-Poll` when `init.poll`, handles 401 reasons with a toast ("Signed out after 30
minutes of inactivity"). Tests: idle expiry (manipulate `lastSeenAt`), absolute expiry, revoke,
poll does not touch, foreign `Origin` rejected, headers present.

**C1.2** Migration `0004_mfa` (`mfa_totp`, `recovery_codes`, `sessions.stage`);
`server/src/auth/mfa.ts` (`otplib`, AES-GCM secret at rest, `qrcode` data URL); login returns
the stage; `requireStage('active')` inside `authenticate` for everything except `/auth/mfa/*`,
`/auth/logout`, `/auth/me`. Frontend `/mfa`, `/mfa/enroll` (QR + manual key + confirm + recovery
codes shown once + "I saved them" checkbox), `/settings` security card (regenerate codes, view
sessions, sign out everywhere). Seed: dev accounts get a known TOTP secret printed by `db:seed`
so local login stays quick. Tests: enroll → verify → active; wrong code ×5 → 429; recovery code
single use; a preauth session cannot list clients.

**C1.3** Migration `0005_invites_resets` (+ `deactivatedAt`, `passwordChangedAt`);
`routes/invitations.ts`; password reset routes; `server/src/admin.ts` CLI (`npm run admin -- …`);
`POST /clients/:id/deactivate|reactivate`. Frontend `/invite/:token`, `/forgot`, `/reset/:token`;
client row "Invite / Resend / Copy link"; deactivate with confirm. Re-hash cost-10 hashes on
login. Tests: token single use + expiry; reset revokes sessions; deactivated user 401
immediately; admin CLI `create-advisor` (spawned with env).

**C1.4** Migration `0006_jobs`; `server/src/jobs/{queue,worker}.ts`; `server/src/worker.ts`
entry (`npm run worker`, builds to `dist/worker.js`); handlers `email.ts` (nodemailer,
`SMTP_URL`, `MAIL_FROM`; templates: invitation, password reset, "You have a new item in your
DocFlow portal", "A document needs your attention" — no filenames, amounts or message text),
`scan_retry.ts` stub, `sweeper.ts` stub; invitations/resets enqueue the email and return the
link; `GET /ops/status` v1 (failed jobs). Tests: SKIP LOCKED claim (two workers, one job),
retry/backoff, dedupeKey; email handler with a stubbed transport.

### Phase 2 — storage and workflow model

**C2.1** Migration `0007_workflow_model` (the "Data model" tables, additive; audit trigger);
`server/src/db/audit.ts`; `server/src/db/migrate-legacy.ts`
(`npm run db:import-legacy -- --backup-manifest <path> [--trust-legacy-files] [--dry-run]`) per
"Migration"; `scripts/count.mjs` extended. Tests: seeded legacy DB → import → counts, same ids,
version sha256 = file sha256, missing file reported not fatal, idempotent second run, refusal
without a manifest. **Rehearse on the C0.3 restore before running against the real dev DB.**

**C2.2** Routes `engagements.ts`, `requests.ts`, `documents.ts` (rewritten around kinds and
versions, with `serialize*`), `versions.ts`, review actions, `templates.ts`, `dashboard.ts`,
`search.ts`, `notifications.ts`; `presets.ts` becomes a read-only shim over templates; the legacy
`GET /documents` list keeps its shape (derived from the new columns) until C3.4;
`DELETE /documents/:id` archives. Starter templates are seeded per provider on the first
`GET /templates` — individual: W-2s, 1099s, prior-year return, mortgage 1098, property tax,
charitable receipts, HSA/IRA statements, estimated payments, K-1s (optional), dependents'
information; business: prior-year return, P&L, balance sheet, bank statements, payroll reports,
1099s issued, fixed-asset purchases, loan statements, sales-tax filings (optional), owner
distributions. Tests: full authz matrix for every new route; lifecycle requested → submitted →
needs_correction → submitted → accepted; waive requires a reason; a private deliverable is 404
for the client until shared; a newer version resets acceptance and keeps the old review.

**C2.3** `server/src/files/{store,staging,validate,scan,publish}.ts` replacing `storage.ts`;
`middleware/upload.ts` → `stageUpload` (diskStorage); routes `POST /requests/:id/uploads`,
`POST /engagements/:id/uploads`, `POST /documents/:id/versions`; legacy `POST /documents/:id/file`
delegates; `scan_retry` and `sweeper` become real; `.env.example` gains `DATA_ROOT`,
`CLAMD_HOST/PORT`, `SCAN_REQUIRED=true` (false only in dev/test without clamd → versions stay
`pending` with a logged warning, never `clean`). Fixtures in `server/test/fixtures/` (tiny real
pdf / png / docx / xlsx / csv, `spoof.pdf` = png bytes, `encrypted.pdf`, `eicar.txt`). Tests:
each failure code; oversize → 413 with no staged leftovers; authorize-before-bytes (an
unauthorized request never creates a staged file — assert the directory is empty); scanner stub
`infected` → quarantined + 422; scanner unreachable → 202 `scanner_unavailable`, version
`error`, retry job queued; concurrent double-submit → two intact versions; sweeper removes
orphans. One integration test tagged `clamav` runs only when clamd answers PING.

**C2.4** `GET /documents/:id/versions/:vid/{download,preview}` per "Delivery";
`GET /documents/:id/download` (legacy) → current version; `Document.url` kept. Tests: exact
headers; non-clean version → 409 with reason; another client's version → 404; Office → preview 415.

### Phase 3 — advisor workspace

**C3.1** `src/api/queries/*`; `QueryClient` config; `AuthContext` keeps only `me` / `login` /
`logout` (+ `queryClient.clear()`); auth screens; `src/index.css` `@font-face` + `public/fonts/`
(IBM Plex Sans 400/500/600/700, Mono 400/500/600, Serif 400/500/400i as woff2); `index.html`
cleaned; `.df-root` shadcn variable remap; `Modal.tsx` reimplemented on Radix Dialog with the
same props. Vitest + jsdom configured at the root for later reducer tests.

**C3.2** `/clients` directory (search, sort, needs-attention badges, New client, invite status);
`/clients/:id` (engagement list with progress bars, New engagement from template / kind / year,
activity, thread); `/engagements/:id` (checklist with inline edit of due / required /
instructions, add item, reorder, waive with reason, status pills, "Needs decision" for
not-applicable responses, ad-hoc uploads, deliverables tab); `/templates` editor replaces the
Settings presets (drag reorder, optional flag, default due offset). Sidebar: Overview · Clients ·
Documents · Templates · Settings; Calendar / Reports entries removed (`FinancialOverview` stays
reachable at `/overview` until the C5.4 decision).

**C3.3** `/review/:documentId`: left preview (sandboxed iframe / img, or "download to view" for
Office / CSV, scan-state notice); right rail: request context, version history with per-version
review outcome, Accept / Request correction (note required) / Waive (when a request exists),
organization (display name, category, engagement), document-scoped thread; deliverables:
"Upload deliverable" (private) → "Share with client" with confirm → shared badge; keyboard
shortcuts A / C. `Document.tsx` redirects here.

**C3.4** `/` queue: four tiles + "Needs decision"; each opens `/work?filter=…` (ids from
`GET /dashboard` → list query); `/documents` search with client / year / category / status /
filename filters backed by `GET /search`; delete `ClientsContext`, `DocumentsContext`,
`documentGrouping.ts` and the legacy `GET /documents` consumers. Gate: no remaining imports of
the contexts (`grep -r "context/DocumentsContext\|context/ClientsContext" src` is empty).

### Phase 4 — client portal

**C4.1** `/portal` Your next steps (ordered: needs correction → overdue → due soon → other open;
each card: title, instructions, deadline, state, Upload / Ask a question / I don't have this);
progress header (n of m done); `/portal/requests`, `/portal/documents` (by engagement / year),
`/portal/shared` (deliverables, download), `/portal/messages`; the client sidebar becomes real
routes; `ClientPortal.tsx` removed.

**C4.2** `UploadQueue` + `useUploadQueue` (multi-file per request, per-item progress via XHR,
cancel, retry, server code → copy, camera capture with
`accept="image/*,application/pdf" capture="environment"` on phones); states **Submitted /
Received, checking / Accepted / Needs correction / Waived**; responsive layout ≤ 640 px (stacked
cards, bottom action bar, sidebar → sheet), 44 px targets. Reducer tests in vitest + jsdom.

**C4.3** `notifications` wired for: request created, correction requested, deliverable shared,
accepted (client side); upload received, not-applicable response, new message (advisor side);
unread badges from `GET /notifications` + message `readAt`; `jobs/handlers/reminders.ts` (daily
08:00 firm tz: open requests with a due date get a notice 3 days before, on the day, then weekly
while overdue; one consolidated email per client per day; stop on submit / waive;
`dedupeKey = reminder:<clientId>:<date>`); `FIRM_TIMEZONE`; email copy generic. Tests: schedule
computation with fixed clocks; consolidation; stop conditions.

### Phase 5 — polish, operations, pilot

**C5.1** Skeletons; empty states with the single next action; error boundaries with retry;
offline banner (React Query `onlineManager`); `:focus-visible` rings; contrast audit of pills
(`df-warn` on `df-warn-soft` etc. ≥ 4.5:1); keyboard navigation for dialogs / menus (Radix);
`prefers-reduced-motion`; confirm the production bundle has no dev credential prefill
(`grep -c password123 dist/assets/*.js` = 0).

**C5.2** Audit coverage per "Security design"; `/settings/system` panel + `GET /ops/status` v2;
`backup.ps1` v2 (files dir + manifest via `npm run backup:manifest`, `backup:record`);
`restore.ps1` v2 + `npm run integrity`; runbook sections "Nightly backup", "Restore drill" (with
the recorded result), "Offline copy rotation".

**C5.3** `ops/windows/`: `Caddyfile.example`, `docflow-api.xml`, `docflow-worker.xml`, `caddy.xml`,
`install.ps1`, `update.ps1`, `verify.ps1`, `firewall.ps1`, `postgresql.conf.snippet`,
`pg_hba.conf.example`, `clamd.conf.example`, `freshclam.conf.example`; `server/.env.example`
production block; `docs/PILOT-RUNBOOK.md` complete (prerequisites, install order, DNS / port
forward, certificate check, first advisor via CLI, invite the first client, daily / weekly /
monthly ops, incidents: scanner down, disk full, certificate failed, restore).

**C5.4** Release checks executed on the firm PC (or a staging Windows box) and recorded in the
runbook with dates. Then contract: drop the legacy `documents` columns and `presets`, remove
`POST /documents/:id/file` and the legacy list shims, apply the `FinancialOverview` decision,
unique index on `clients.emailNormalized` (fails if duplicates remain — resolve first), delete
`server/uploads/` after `npm run integrity` passes. Mark the program COMPLETE in memory.

## Compatibility ledger (shims and their removal)

| Shim | Added | Removed |
|---|---|---|
| Legacy `documents` columns frozen at import | C2.1 | C5.4 |
| `documents` workflow columns nullable (`kind IS NULL` = not imported) | C2.1 | C5.4 |
| `GET /documents` legacy list shape | C2.2 | C3.4 |
| `PATCH /documents/:id` still accepts the legacy review fields | C2.2 | C3.4 |
| `GET /presets` read-only shim over `request_templates` (POST/DELETE → 410) | C2.2 | C3.2 |
| `api.presets.create/remove` → `/templates` bins↔items adapter (frontend) | C2.2 | C3.2 |
| `POST /documents/:id/file` → creates a version | C2.3 | C5.4 |
| `GET /documents/:id/download` → current version | C2.4 | kept (public contract) |
| `presets` read-only shim over templates | C2.2 | C5.4 |
| `req.auth` shape from the JWT era | C1.1 | kept |
| `server/uploads/` on disk | — | C5.4 after integrity |

## Release checks (pilot gate, C5.4) — [A] = automated in `npm test`

- [ ] A client completes invitation → MFA setup → upload → correction → resubmission →
      final-document download on desktop and on a phone (manual, recorded in the runbook).
- [A] Cross-client access fails (404) for lists, files, previews, versions, messages and linked
      ids; clients cannot approve, waive, share, or see private deliverables (`authz.test.ts`).
- [A] Failed, oversized, spoofed, infected, encrypted, interrupted and duplicate-retried uploads
      leave no published partial records, no staged leftovers, and never lose a previous version
      (`upload.test.ts`).
- [A] Logout, idle expiry, absolute expiry, password reset, password change and deactivation
      invalidate sessions immediately (`sessions.test.ts`).
- [A] The legacy import preserves counts, ids, links and file checksums (`import.test.ts`); the
      real-data `migration-report.json` shows zero unexplained gaps (manual review).
- [ ] Nightly backup ran on ≥ 3 consecutive nights; a restore drill on a clean Windows
      environment passes `npm run integrity` (manual, recorded).
- [ ] Only 80/443 answer from another LAN machine (`Test-NetConnection`); API, DB and clamd
      refuse non-loopback (manual).
- [ ] Keyboard-only walkthrough of both portals; contrast audit; all gates clean.
- [ ] The production bundle contains no dev credentials or Google Fonts references.

## Prerequisites and user-only actions

1. Firm PC: Windows 11 **Pro** (BitLocker on the data volume, BitLocker To Go on both backup
   drives), ≥ 16 GB RAM, SSD; two external encrypted drives for backups (R7).
2. Public DNS name for the portal; router forwards TCP 80 and 443 to the PC; static LAN IP or
   DHCP reservation.
3. SMTP credentials for the firm mailbox, or the decision to start with copy-link invitations.
4. Firm timezone; the advisor's name and email for `create-advisor`.
5. Admin installs on the firm PC: PostgreSQL 17, ClamAV, Caddy, WinSW, Node 22 LTS, Git —
   `install.ps1` automates everything after the downloads.
6. Decision on `FinancialOverview` (keep read-only or remove) before C5.4.

## Out of scope (pilot)

Team permissions, e-signatures, cloud integrations, AI/OCR, financial analytics, automated
permanent retention, multi-advisor firms, native mobile apps, in-browser document editing.
