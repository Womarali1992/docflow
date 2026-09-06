# DocFlow pilot runbook

Operational procedures for the CPA pilot. Sections are added as the programme in
[`CPA-PILOT-PLAN.md`](CPA-PILOT-PLAN.md) delivers them; each one records when it was last
exercised for real.

## Backup and restore (legacy schema, v1 — C0.3)

Until the immutable-version storage lands (C2.x), uploaded files live in `server\uploads` and
are **overwritten in place** when replaced. The v1 backup therefore takes a full, verified copy
of that folder with every set. v2 (C5.2) switches to the immutable `files\` store, incremental
copies and a `backup_runs` table; the manifest format stays compatible.

### What a backup set contains

```
<Dest>\2026-09-05\
  db.dump          pg_dump -Fc of the DATABASE_URL database
  uploads\         copy of server\uploads, every file hash-verified against the source
  config\          server.env (SECRETS — Dest must be an encrypted volume), migrations-journal.json
  manifest.json    version, createdAt, host, database, pgDumpVersion, dump {bytes, sha256},
                   counts {tables, documentsWithFile, migrations}, uploads [{path, bytes, sha256}]
```

The manifest is written **last**, so a set with a manifest is complete. A second run on the
same day gets a `_HHmmss` suffix; a failed run is renamed `<date>_FAILED` and left for
inspection. Sets older than `-Keep` days (30) are pruned by folder name.

### Prerequisites

- Node on PATH (the scripts call `server\scripts\count.mjs`, `integrity.mjs`, `create-db.mjs`).
- PostgreSQL client tools. They are not on PATH on Windows: set `PG_BIN` to the `bin` folder
  (e.g. `C:\Program Files\PostgreSQL\17\bin`) or let the script pick the newest install.
- `server\.env` with `DATABASE_URL` (the scripts never take passwords on the command line;
  `PGPASSWORD` is set only for the child process).
- For the restore drill: `PG_ADMIN_URL` pointing at a superuser connection, because the app
  role normally lacks CREATEDB (e.g. `postgres://postgres@localhost:5432/postgres`).

### Run a backup

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\backup.ps1 -Dest E:\docflow-backups
```

`-Dest` defaults to `%DOCFLOW_BACKUP_DEST%`, else `%USERPROFILE%\docflow-backups`. The
destination may never be inside the repository. Exit code 0 = set complete and verified.

### Restore drill

```powershell
$env:PG_ADMIN_URL = 'postgres://postgres@localhost:5432/postgres'
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\restore.ps1 -From E:\docflow-backups\2026-09-05
```

The drill always rebuilds a **scratch** database (`docflow_restore` by default; the name must
start with `docflow_restore`) and mirrors the files into `%USERPROFILE%\docflow-restore\uploads`
(`-UploadsTo`). It then verifies:

1. the dump and every file in the set match the manifest hashes (the set is intact),
2. every table's row count matches the manifest, as do "documents with file" and migrations,
3. every document that has a stored file has it on disk with the manifest's sha256 and the
   database's size (`npm run integrity`).

`RESTORE DRILL PASS` and exit code 0 mean the set is usable. Target: a drill every month and
before every schema migration; restore within 4 hours, data loss under 24 hours.

### Promoting a restored database (real incident)

The scripts never touch the live `docflow` database. To put a verified restore into service:

1. Stop the API (and, from C5.3, the worker service).
2. As a superuser: `ALTER DATABASE docflow RENAME TO docflow_broken_<date>;` then
   `ALTER DATABASE docflow_restore RENAME TO docflow;`
3. Replace `server\uploads` with the restored files folder (keep the old one until verified).
4. Start the API; sign in; open a document. Keep `docflow_broken_<date>` for a week.

### Drill record

| Date | Machine | Set | Dump | Files | Rows (providers/clients/documents/messages/activities/presets) | Result |
|---|---|---|---|---|---|---|
| 2026-09-05 | dev box (OMAR, Windows 11 Home, PostgreSQL 17.6 native) | `C:\Users\omara\docflow-backups\2026-09-05` | 20.6 KB, backup 1.8 s | 5 (3.2 KB), all hashes verified | 1 / 3 / 8 / 2 / 4 / 0; 5 documents with file; 3 migrations | **PASS** — restored into `docflow_restore` in 4.0 s; counts, migrations and file hashes all matched |

First run of the day found one defect: Windows PowerShell 5.1 writes `manifest.json` with a
UTF-8 BOM, which Node's JSON parser rejects. Fixed the same day (manifest written BOM-free and
the reader tolerates a BOM); the recorded run is the rerun.

### Known limits of v1

- Files are mutable until C2.x, so a file replaced *during* the copy is caught by the hash
  verification and fails the run; rerun. v2 makes this impossible by design (immutable versions,
  dump → files → manifest ordering).
- `config\server.env` holds the database password and, since C1.2, `APP_ENCRYPTION_KEY` (the
  key every authenticator secret is encrypted under). Only back up to an encrypted volume, and
  rotate the secrets if a backup drive is lost. A restore without the matching
  `APP_ENCRYPTION_KEY` restores accounts nobody can finish signing in to — the admin CLI
  (C1.3) resets their MFA one by one; there is no bulk recovery, so the key is part of the backup.
- No scheduling yet; C5.3 adds the Task Scheduler job and the offline-drive rotation.

## Accounts (C1.3)

All account administration happens on the server console with `npm run admin -- <command>` from
`server\` (the process reads `DATABASE_URL` and `APP_BASE_URL` from `.env`). There is no admin
role inside the app.

| Situation | Command |
|---|---|
| First advisor on the firm PC | `npm run admin -- create-advisor --email ann@firm.com --name "Ann Advisor" --firm "Firm CPA"` (password prompted twice, echo off, at least 12 characters) |
| Advisor forgot the password | `npm run admin -- reset-link --kind provider --email ann@firm.com` → hand over the printed link (one hour, single use; every session of that account ends when it is used) |
| Lost phone / authenticator | `npm run admin -- reset-mfa --kind client --email jane@example.com` (sessions end; the next sign-in enrolls a new authenticator and issues new recovery codes) |
| Leaver or compromised account | `npm run admin -- deactivate --kind provider|client --email …`; reversible with `reactivate` |
| Who can sign in, who is signed in | `npm run admin -- list-users`, `npm run admin -- list-sessions --kind … --email …` |
| "Too many login attempts" | The throttle is in the API process's memory and clears 15 minutes after the last failed attempt; restart `docflow-api` to clear it now (`npm run admin -- unlock` says the same) |

Clients are never given a password by hand: "New client" in the app shows a one-time invitation
link (7 days), and the client page has Resend invite, Reset link (one hour) and Deactivate. Every
CLI change appears in the advisor's activity feed as "Administrator (CLI) …" until C2.1's audit log.

## Background jobs and email (C1.4)

Slow work — sending mail, re-scanning a quarantined upload, sweeping abandoned staging files —
runs in a **separate worker process**, not in the API. The queue is the `jobs` table, so a
restart never loses work and a mail server that stops answering slows nothing down for the
advisor or the client.

| | Development | Firm PC (from C5.3) |
|---|---|---|
| API | `npm run dev` in `server\` | `docflow-api` service |
| Worker | `npm run worker` in `server\` | `docflow-worker` service |

A job is retried on failure after 1 min, 5 min, 15 min, then hourly, up to 5 attempts; after
that it stops and is counted as **failed** — it is never deleted, so it can still be read. A
worker that dies mid-job releases its lock after 5 minutes and another worker picks the job up.
`GET /api/ops/status` (advisor only) reports pending / running / failed counts and whether a
mail server is configured; C5.2 puts this on the System status panel.

### Email is optional

With **`SMTP_URL` unset nothing is emailed and no job is queued.** Invitations and password
resets still work: the app shows the one-time link and the advisor sends it however they like —
the copy-link is the supported way to run the pilot before the firm mailbox is wired up. The
invitation and reset dialogs say which happened, so the advisor never assumes an email went out.

The one path with no copy-link is the client's own "Forgot password" form: until SMTP is set it
silently does nothing visible (by design — the response must not reveal whether an account
exists). Until then, reset a client from their page, or an advisor with
`npm run admin -- reset-link`.

To turn email on, set both variables in `server\.env` and restart the worker:

```
SMTP_URL=smtps://docflow%40firm.com:APP_PASSWORD@smtp.office365.com:587
MAIL_FROM=DocFlow <docflow@firm.com>
```

Percent-encode the `@` in the username. Check `GET /api/ops/status` afterwards: `mail.configured`
must be `true`. Send yourself an invitation as a live test; if the job fails, `jobs.last_error`
carries the SMTP error and the count shows on the ops status.

Every notice is deliberately **generic** — subject and body never contain a filename, an amount,
a category, message text or another client's name. They say something is waiting and link to the
portal, because an inbox is not a confidential channel.

## Legacy import (C2.1) — run once, on purpose

The workflow model (engagements → requests → documents → versions → reviews) arrives as an
**additive** migration: every legacy column and route keeps working until C5.4. One script then
converts the existing rows into the new shape.

```
cd server
npm run db:import-legacy -- --backup-manifest <path-to-manifest.json> [--trust-legacy-files] [--dry-run]
```

It **refuses to run** unless the manifest is younger than 24 hours. There is no override — take a
backup instead (`ops\windows\backup.ps1`). Everything else about it is designed to be repeatable:

- **Idempotent.** A second run converts nothing. A document counts as "already imported" once its
  `kind` is set, so an interrupted run can simply be run again.
- **Copies, never moves.** `server\uploads\` is left byte-for-byte alone and stays the fallback
  until C5.4 deletes it. New bytes go to `<DATA_ROOT>\files\yyyy\mm\<uuid>.<ext>`.
- **Keeps ids.** A request carries the id of the document it came from, so existing links resolve.
- **A missing file is reported, not fatal.** The document survives with no current version and is
  listed in `migration-report.json` (written next to the manifest).
- `--dry-run` prints the same report and writes nothing at all.

### Scanning: what `--trust-legacy-files` means

Without it, imported versions are `pending` and a scan job is queued for each — nothing is served
until C2.3's scanner has actually looked at the file. With it, they are marked `clean` and the
version records that they were **not** scanned. Use it only for files that were already under the
firm's control. When in doubt leave it off: the import is still correct, the files simply wait.

### Rehearse first — this is not optional

Run it against a restored copy before the real database, and compare the report:

```
$env:PG_ADMIN_URL = 'postgres://postgres@localhost:5432/postgres'
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\restore.ps1 -From <backup set>
$env:DATABASE_URL = 'postgres://docflow:...@localhost:5432/docflow_restore'
$env:UPLOADS_DIR  = 'C:\Users\<you>\docflow-restore\uploads'
$env:DATA_ROOT    = 'C:\Users\<you>\docflow-restore\data'
npx tsx src/db/migrate.ts
npx tsx src/db/migrate-legacy.ts --backup-manifest <manifest> --dry-run
```

### Rehearsal record

| When | Set | Result |
|---|---|---|
| 2026-09-06 | `docflow-backups\2026-09-06` | Restore drill **PASS** (5 files verified, counts match). Migrated to `0007_workflow_model`, then imported: 3 engagements, 3 requests, 5 versions, 2 reviews, 8 documents converted, 5 scan jobs queued. All 5 versions' bytes matched their recorded sha256 and size; the 5 legacy uploads were untouched. A second run created nothing. Then run against the dev database with `--trust-legacy-files`; `npm run db:seed` still succeeds afterwards. |

The rehearsal earned its keep: it caught `scripts\count.mjs` failing on a backup set restored from
*before* this migration (it counted tables the older schema does not have). `countAll` now counts
only the tables a database actually has and reports the rest as `missingTables`, so an older
backup set stays verifiable.

## Audit log (C2.1)

`audit_log` is **append-only, enforced by the database**: a trigger raises on UPDATE and DELETE, so
no route, script or console session can quietly rewrite history. It records that something happened
— never what was in it. No passwords, tokens, document bytes or message text; an email address is
stored as a truncated sha256, so repeated failures stay countable without the address being there.

TRUNCATE is deliberately still allowed (it is statement-level): the test harness truncates between
tests, and a restore replaces the whole database. Nothing in the application ever issues one.
