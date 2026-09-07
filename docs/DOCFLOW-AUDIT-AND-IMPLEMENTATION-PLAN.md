# DocFlow audit and implementation plan

Audited 7 September 2026 against Git HEAD `705cdbd`. This is an assessment and implementation plan; application fixes, deployment, and migration of the working database have not been performed.

**Recommendation: finish a focused hardening release before inviting real clients.** The application has substantial working functionality and useful authorization coverage. However, isolated probes reproduced authentication replay, upload concurrency, review-state, and upload-queue defects. Applying the pending contraction alone would not make this ready for a pilot.

## What was checked

Reviewed the supplied program record, commit history, both package manifests and lockfiles, database migrations, authentication and authorization, upload and delivery paths, review transitions, job processing, frontend upload orchestration, backup/restore/deployment scripts, and existing release documentation. Ran the existing suites, typechecks, lint, builds, read-only database/file checks, SMTP connection authentication, dependency audits, and additional isolated regression probes.

The backend probes ran against newly created, uniquely named schemas in `docflow_test`, with separate generated files and SMTP disabled. Those schemas were removed afterwards. The working `docflow` database was only read. No emails were sent during this audit. No production services, firewall rules, or migration state were changed.

This does not substitute for the outstanding real-phone, keyboard, production ClamAV, external-network, clean-machine restore, or production deployment checks. Historical successful email jobs support the previous send claim; mailbox receipt was not independently established in this audit.

## Corrections to the program record

| Claim | Finding and recommended wording |
|---|---|
| “35 commits, three days” | **34 reachable commits are dated 5–7 September** in the stated +07 timezone, including the merge. `git rev-list --count 5e611c2..HEAD` returns 35 because that range also includes `52f3ba3`, dated 24 July 2026. State the commit range or use 34 for the three-day count. |
| July 2025 Lovable origins | Supported: history starts 7 July 2025 and includes commits titled “Visual edit in Lovable.” |
| “Anyone signed in could reach anyone else's files” | Too broad for the audited C0 baseline. At `3d94efa`, lists and downloads already checked advisor/client ownership. The demonstrated defect was that clients could review, replace, or delete **advisor material associated with their own account**; foreign IDs also returned revealing 403s. Use that narrower, evidenced description. |
| Hotfix was “commit one” | `8b6df06` is C0.2, after the harness commit and a merge. Call it the first authorization fix. |
| Started from nothing but mocked data | Distinguish the original generated UI from the July 2026 backend work (`5e611c2`). The September program hardened and extended an existing server as well as replacing mock UI paths. |
| 690 tests | Existing suite result is recorded below. The intended arithmetic is 660 server + 30 frontend; 454 belong to the authorization matrix. The ClamAV test returns early without an assertion when no scanner exists, so a passing total is not evidence of a real scan. |
| 23,175 application lines | Not reproducible at this HEAD with a stated physical-line definition. Tracked `.ts/.tsx/.js/.mjs/.css` files under `src/` and `server/src/` contain **25,576 lines**, including **436 frontend test lines**. Excluding those tests gives **25,140**. TypeScript-only total is **23,782**, or **23,346** excluding frontend tests. State extensions, test inclusion, and commit when quoting a number. |
| 5,500 server-test lines | Reproduced across 20 TypeScript files under `server/test/`, including helpers/fixtures/setup. The 17 `*.test.ts` files themselves contain 4,931 lines. |
| Nine migrations | Nine migration files exist, `0000`–`0008`; only eight are applied to the working database. |
| C5 removed the legacy schema | Code and migration preparation are complete; database contraction remains pending. `0008_contract.sql` contains **17 `DROP COLUMN` statements**, not the 18 asserted in parts of the runbook. It also drops `presets` and two enum types, adds constraints and the email index. |
| 65 async handlers across 16 files | The systemic Express-4 error-handling fix exists and has a guard test. A simple current count finds 70 `async (` occurrences across 16 route files; occurrence counts are not handler counts. Retain 65 only as a clearly labeled historical measurement with its counting method. |
| A filename signed everybody out | The Unicode header failure and process-crash mechanism are supported by code/history. A server crash is an availability failure; it does not itself revoke database-backed sessions. Avoid claiming universal session revocation. |
| “Data outside the repo” | A production design requirement, not the current local state. Actual `DATA_ROOT` resolves to `server/.data` inside the repository, though ignored by Git. Production only requires a configured value; it does not presently enforce that the resolved path lies outside the checkout. |
| “Tests are the release checks” | Automated tests are part of the release gate. The repository itself still lists manual phone, keyboard, network, backup scheduling, and clean-machine restoration checks. |

The record's four historical incidents are supported by the commits and relevant code changes. Preserve that section, but separate **historical evidence**, **currently verified state**, and **remaining work** throughout the page.

## Current verification results

| Check | Result |
|---|---|
| Existing server suite | 660 passed across 17 files in 600.68 seconds. Final result recorded in `audit/verification-summary.json`. |
| Existing frontend suite | 30 passed across 4 files. |
| Authorization matrix | 454 passed; no expected-failure cases remain. |
| Typechecks | Frontend application, server build, and server test typecheck passed. |
| ESLint | 0 errors, 9 existing Fast Refresh warnings. “No lint errors” is more precise than “lint clean.” |
| Builds | Both passed. Frontend emits a 533.28 kB JS bundle, 156.37 kB gzip, with a chunk-size warning and old Browserslist data warning. |
| Compiled API | Imported emitted app, listened temporarily on loopback, and received HTTP 200 from `/api/health`, including a successful database check. |
| Worker | Emitted worker entry passes syntax checking; production worker/service startup was not exercised. |
| Deleted build modules | No emitted legacy importer/storage/presets modules found after the clean build. |
| Production bundle markers | No `password123`, `client123`, demo email/domain, Google Fonts, or Lovable markers found in the emitted JS. |
| Working migration state | 8 applied; latest stamp `1788692292702`, matching `0007_workflow_model`. |
| File integrity | All 24 recorded versions and all 5 referenced legacy files checked, with no missing files or checksum mismatches. |
| Legacy redundancy | 5/5 legacy files retained under `DATA_ROOT`; zero orphan legacy files. Still recheck immediately before any deletion. |
| Mail | SMTP configured; connection/authentication verification succeeded. Working DB contains two completed email jobs. No new message sent. |
| Deployment | Local development configuration; base URL is localhost. No DocFlow, Caddy, or ClamAV Windows services found. Both PostgreSQL 16 and 17 services run. Port 5432 is bound to wildcard interfaces; external reachability was not tested. |
| Backups | Latest recorded successful backup: 7 September, 11:39 Bangkok time; manifest covers 24 versions and 5 legacy files with no reported problems. Existing records document earlier restore drills. A new clean-machine restore was not performed. |
| Real ClamAV | Unavailable; existing integration test logs a skip and returns successfully. |

## Findings to fix before the pilot

### F1 — P1: upload file-type parser has a reachable known denial-of-service issue

`server/src/files/validate.ts:127` reads untrusted upload bytes and invokes the installed vulnerable `file-type` parser before determining that the content matches its allowed extension. Renaming unsupported content to an allowed extension reaches the parser. The maintainer describes an ASF parser infinite loop in versions >=13.0.0 and <21.3.1, affecting detection of untrusted input. No denial-of-service payload was executed against this application.

Upgrade to a patched version compatible with the selected Node runtime, review the rest of the dependency audit, and test malformed inputs in a killable worker/process with a timeout. The async router catches rejected promises; it cannot recover an event loop stuck inside a parser. [Maintainer advisory](https://github.com/sindresorhus/file-type/security/advisories/GHSA-5v7r-6r5c-r473).

Dependency counts from this audit: frontend tree 24 findings (1 critical, 15 high); server tree 11 (1 critical, 3 high). With dev dependencies omitted: frontend 13 (10 high), server 6 (3 high). These are dependency advisories, **not counts of demonstrated exploitable application vulnerabilities**. Runtime reachability must be assessed individually. Review `file-type`, Drizzle, Nodemailer, React Router, Vite, and Vitest first; do not use a blind forced major upgrade.

### F2 — P1: TOTP replay consumption is not atomic

`server/src/auth/mfa.ts:102` checks an already-read row and then updates by ID without checking the stored step. Two concurrent calls with the same valid code both returned `ok` in the isolated probe.

Use an atomic conditional update (`last_used_step IS NULL OR last_used_step < accepted_step`) and require one returned row. Ensure the secret/enrollment state being validated is still current. Add a concurrent test where precisely one caller succeeds. This is a replay-protection failure; it does not bypass the first-factor password requirement.

### F3 — P1: concurrent uploads collide; first-document creation also lacks serialization

`server/src/workflow/versions.ts:52` allocates `MAX(version_no)+1` without locking the parent. In the latest probe, 8 concurrent calls produced 4 successes and 4 uniqueness errors. Four concurrent HTTP uploads to a fresh request produced two 202s and two 500s. A normal two-upload test happened to pass, so scheduling luck currently affects coverage.

Serialize allocation and publication using a consistent request/document locking order. Lock the request before resolving/creating its document under the current one-document policy. Add upload operation IDs persisted across retries, with a unique constraint, so a lost response does not create another version. Test concurrent first uploads and existing-document uploads with a controlled overlap, as well as post-commit response loss.

### F4 — P1: deferred scanning breaks version and acceptance rules

`server/src/jobs/handlers/scan_retry.ts:87` unconditionally points the document at whichever version finishes scanning. It also explicitly excludes accepted requests from reopening at line 90, and does not perform the same superseding/response-clearing operations as immediate publication.

Reproduced: pending version 6 finished scanning after clean version 7 and became current. A new pending replacement scanned clean while its request remained `accepted`.

Create one transactional publication operation shared by immediate uploads and scan retries. Under a parent lock, publish the version, choose the newest eligible version, preserve previous reviews, update supersession consistently, and reopen acceptance only when the effective current submission changes. An older late scan must not roll the current pointer backward.

### F5 — P1: accepting an old version closes the current request

`server/src/routes/requests.ts:58` checks whether a version belongs to the request, but the accept path at line 111 does not require it to be the current published clean version. The probe reviewed version 1 while version 2 was current and received HTTP 200 with request status `accepted`.

Include the expected current version in review commands. Compare it inside the same transaction/lock used for publication and return 409 when it is stale. Verify scan/readability state. Historical annotations must not change the completion state of a newer submission.

### F6 — P1: upload cancellation and queue draining do not follow current state

`src/components/upload/useUploadQueue.ts:191` drains a local snapshot. Adding another file while a send is active calls a pump that returns early, so the added item can remain queued. Cancelling a queued file updates React state but not the snapshot; it can still be sent. Both behaviors were reproduced using the real hook with controlled network promises.

Drive processing from current state, with one in-flight controller, a wakeup when queued items change, and a final current-state check before every send. Abort active work on unmount/logout. Add hook integration tests for enqueue during flight, cancel/remove before flight, retry during flight, cancellation after server receipt, and navigation away. Reducer-only tests cannot cover orchestration.

### F7 — P1: production perimeter assumptions are not enforced

`server/src/index.ts:6` omits the listen host. Node then listens on unspecified interfaces rather than exclusively on loopback. This contradicts the service description. The current machine also exposes a wildcard PostgreSQL listener; firewall reachability remains unknown. [Node listen documentation](https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback).

Bind the API explicitly to `127.0.0.1` for the Caddy deployment. Validate production data paths and required configuration at startup. Configure PostgreSQL/ClamAV loopback listeners and verify from another machine. Set proxy trust only for the actual proxy topology.

The Caddy example serves the SPA directly but only Express emits CSP/Permissions-Policy. Add a tested HTML policy at the layer serving HTML; the existing application uses inline styles, so test a compatible policy rather than copying the API policy blindly. The access log is plain JSON with no URI redaction, while invite/reset URLs contain bearer tokens. Redact those paths and Referer values. JSON formatting alone does not remove them. [Caddy logging documentation](https://caddyserver.com/docs/caddyfile/directives/log), [CSP delivery guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP).

### F8 — P1: backups do not describe a single consistent application snapshot

`ops/windows/backup.ps1:98` dumps the database, then copies files, then `server/scripts/manifest.mjs:63` and line 136 query the **live database again** for expected versions/counts. Concurrent uploads, jobs, reviews, or scan-driven file deletion can make those observations differ from the dump. A quiet-machine restore drill does not test that race. PostgreSQL's dump itself is consistent; the surrounding manifest/file process lacks a shared snapshot. [PostgreSQL dump documentation](https://www.postgresql.org/docs/current/app-pgdump.html).

For the small pilot, first implement a bounded maintenance barrier: drain uploads, pause all writers including the worker, capture dump/files/metadata together, then resume in a guaranteed cleanup path. A later online design can use an exported database snapshot and coordinated retention of referenced files.

Also, `manifest.mjs:101` treats a missing pending/error version as nonfatal if it is not currently servable. Those are still client submissions awaiting a scan. Fail backup verification for every retained version whose bytes should exist; exempt only explicitly destroyed/quarantined content. Verify this during restore, including pending scan work and encryption-key recovery.

### F9 — P1: updates modify the live release before verification

`ops/windows/update.ps1:87` runs `npm ci` and both builds in place while services are running. Caddy serves that same `dist` directory (`Caddyfile.example:49`), and the server prebuild now deletes its emitted output. A build failure can therefore leave the live site partly replaced even though the script says nothing running changed.

Build a versioned release directory from a pinned commit, verify it, then enter maintenance and switch service/static paths. Keep the prior release and compatible database backup available. Test interrupted builds, migration failure, verification failure, and rollback on a staging Windows host.

### F10 — P2: audit completeness and operational verification are weaker than the prose

The append-only UPDATE/DELETE trigger exists, but `server/src/db/audit.ts:96` swallows audit failures outside a transaction. Many security/workflow mutations record their audit row after committing. Append-only storage does not ensure every action was recorded. Use transactional audit writes for important mutations and an explicit policy for read/download logging. Give the runtime role no schema ownership, trigger management, or TRUNCATE privilege; retain a separate migration role.

`verify.ps1:60` treats absent services as warnings and permits missing public-host checks to skip; it can report success without proving a deployment. Add `-StrictProduction` that fails absent required services, migration drift, missing HTTPS checks, invalid data location, unavailable/outdated scanning, or stale backup. Bound the scanner socket read at line 131 so verification itself cannot hang. Verify ACLs, not just grant entries: the installer adds access but does not remove broad inherited permissions from data/config/backup locations.

### F11 — P2: failed uploads leave debris, and important side effects can be lost

`routes/uploads.ts:51` creates a document before validation; a rejected ad-hoc PDF returned 400 while adding an empty document row. Publication can also move bytes and then fail its version transaction. Its comment promises a later sweeper, but the sweeper only handles staging files and existing pending rows, not unreferenced files in `files/`.

Delay document creation until validation succeeds and commit model changes with audit/scan-job records. Add an orphan reconciliation report with a conservative age threshold and explicit deletion policy. A scan-job enqueue or notification failure after commit should not turn a successful upload into an ambiguous 500; make required jobs transactional and optional notices independently retryable.

## Product improvements after correctness fixes

1. **Resolve multi-file meaning before widening the pilot.** Multiple files sent to the same request currently become versions of one document. Six receipt photos are generally six attachments, not six revisions of one photo. Recommended model: request → multiple documents → versions per document. Define request completion across those documents. Preserve existing version chains as history; do not guess which past versions were separate attachments. If that model is deferred, make the one-file/replacement limitation explicit in the UI.
2. Show the advisor the exact file/version they are approving and explain a stale-review conflict with a refresh action. Clearly separate “received, checking” from “ready for review.”
3. Let operators retry failed scan/email jobs with authorization and an audit trail. Add worker heartbeat, oldest actionable job age, disk thresholds, backup age, and external uptime alerts. A dashboard only helps while someone is looking at it.
4. Add explicit retention/archiving/export decisions, storage quotas, and capacity forecasts before storing a full tax season. Define ownership for support, updates, and recovery.
5. After usability checks, split routes/lazy-load heavy screens and update browser metadata. These are lower priority than file correctness, reliable cancellation, and recovery.
6. Keep the current pilot scope. Team roles, OCR, e-signatures, financial analytics, and a broad cloud-integration program would distract from the remaining release work.

## Ordered implementation plan

Estimates are planning ranges for one engineer familiar with the code, including targeted verification, not promises. Host procurement, DNS access, and stakeholder feedback are additional elapsed time.

| Step | Work and likely files | Acceptance gate | Estimate |
|---|---|---|---|
| 0. Evidence baseline | Preserve this report/probes. Reconcile README, plan ledger, runbook, and program record. Add a machine-readable status command that reports commit, migration IDs, dependency/runtime versions, scanner, storage, and backup state without secrets. | One consistent release record; pending/manual checks cannot be represented as completed. | 0.5 day |
| 1. Security fixes | Patch parser and triage dependencies in both lockfiles. Make TOTP consumption atomic. Explicit loopback bind, production config validation, proxy/HTML headers, token-safe logging. | Same TOTP has one winner; malformed-file checks terminate; production smoke verifies bindings, headers, and log redaction. | 1–2 days |
| 2. Workflow transactions | Unify publication and scan retry; lock version allocation; reject stale review commands; create scan jobs/audits atomically; implement upload idempotency and safe orphan reporting. | Concurrent writes succeed without lost versions; out-of-order scans cannot regress current; new current submission reopens acceptance; lost responses replay safely. | 2–3 days |
| 3. Client upload behavior | Replace snapshot pump; add hook tests and browser flows. Decide multiple attachments versus replacements; implement the chosen contract across API/schema/review/portal. | Cancelled queued files never send; newly queued files drain; each intended attachment remains visible and reviewable. | 1–2 days for queue; 2–4 additional days if multi-attachment modeling is adopted |
| 4. Recovery and release scripts | Consistent backup barrier; verify retained pending bytes; snapshot/restore tests; isolated release directories; strict verification; runtime/migration roles; ACL tests. | Restore under concurrent-work simulation passes; failed builds preserve old release; failed migration has a tested recovery route; strict checks fail missing dependencies. | 2–3 days |
| 5. Safe contraction rehearsal | On a fresh restored copy, check redundancy, duplicate normalized emails, unimported documents, and manifest integrity. Apply `0008`, verify schema and app behavior, then rehearse rollback. Apply to target only after that evidence. | Nine applied migrations, constraints verified, clean integrity check and login/upload/review smoke; restorable pre-contraction backup retained. | 0.5–1 day |
| 6. Staging and pilot | Choose an accountable host/operator. Deploy HTTPS origin, fresh production secrets/accounts, data and backup locations, real ClamAV, mail worker, services, and alerts. Exercise desktop/phone/keyboard, outage/restart, network isolation, and restoration. | Three consecutive scheduled backups; clean-machine restore within the stated 4-hour target; external links work; real EICAR check passes; advisor/client sign off the complete workflow. | 1–2 engineering days plus at least 3 nights |

Steps 1–4 precede exposing this system to real clients. Step 5 can be rehearsed on scratch data while the other fixes progress. **Do not delete `server/uploads` merely because the migration succeeds.** Preserve the fresh pre-drop redundancy report and backup, verify the migrated application, then retire the exact checked tree. The redundancy script returns “not applicable” after the column disappears, so it cannot recreate the proof afterwards.

The approximate core hardening effort is **8–14 engineering days**, excluding the optional multi-attachment expansion and infrastructure lead time. Re-estimate after the publication/locking work. Start with a small named pilot cohort and a support owner; expand only after actual use and recovery evidence.

## Required regression and release evidence

- Promote the audit reproductions into permanent tests that assert **correct** behavior. The supplied probes deliberately assert the observed defects and are not release gates.
- Add deterministic overlap tests for version allocation and stale review, not only opportunistic `Promise.all` tests. Include upload versus scan retry versus review operations.
- Add browser coverage for invitation → MFA → upload → correction → resubmission → acceptance → shared-document download. Exercise loss of connectivity, login expiry during upload, Unicode filenames, cancelled items, and mobile camera input.
- Make a missing real scanner an explicit skipped test in development and a failing prerequisite in the production release job.
- Run the full application/test typechecks, lint, frontend/server tests, builds, emitted API/worker smoke, and migration compatibility checks in CI. No CI workflow exists in the reviewed tree. Run Windows deployment/restore checks on a suitable staging runner or VM.
- Record release commit, runtime versions, migration state, test totals including skips, artifact hashes, backup manifest, restore result, and dated manual checks. A successful build or large test count alone is insufficient release evidence.

## Evidence files and reproduction

`docs/audit/2026-09-07-probe-results.json` records the backend observations. `docs/audit/upload-queue-results.json` records the two hook reproductions. The dependency JSON files retain full audit output and separate production-only views. `verification-summary.json` contains the final baseline summary.

From the repository root, after installing the existing dependencies:

```powershell
node --import ./server/node_modules/tsx/dist/loader.mjs docs/audit/2026-09-07-probes.mts
node node_modules/vitest/vitest.mjs run --config docs/audit/vitest.config.mts
```

The backend probe requires permission to create/drop an isolated schema in `docflow_test`. It never migrates the working database or sends mail. Temporary generated PDF fixtures are excluded from Git under `docs/audit/scratch-data/`; automatic approval review blocked their deletion during this audit, so they remain locally. These are synthetic test files.
