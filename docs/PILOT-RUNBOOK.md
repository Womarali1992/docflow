# DocFlow pilot runbook

Operational procedures for the CPA pilot. Sections are added as the programme in
[`CPA-PILOT-PLAN.md`](CPA-PILOT-PLAN.md) delivers them; each one records when it was last
exercised for real.

## Installing on the firm PC (C5.3)

Everything here happens once, on the machine that will host the pilot. Read the whole section before
starting: two of the steps need someone else (the DNS record, the router) and one needs a decision
that cannot be undone quietly (BitLocker's recovery key).

### Prerequisites — things only a person can do

| # | What | Why it cannot be scripted |
|---|---|---|
| 1 | **Windows 11 Pro** (not Home) | BitLocker. On Home the data volume cannot be encrypted, and a laptop full of clients' tax documents without disk encryption is not a pilot, it is an incident waiting. |
| 2 | **A second volume** for data (`D:`), BitLocker-encrypted, recovery key printed and stored off the machine | If the key is only on the machine it protects, it is not a backup of anything. |
| 3 | **Node 22 LTS**, **PostgreSQL 17**, **ClamAV**, **Caddy**, **WinSW** installed | Licences and installer choices are the firm's. |
| 4 | **A hostname** (`docs.<firm>.com`) with a public A record pointing at this machine's address | Let's Encrypt has to reach it. |
| 5 | **Ports 80 and 443 forwarded** to this machine on the router | Certificate issuance uses 80; clients use 443. |
| 6 | **A static or reserved DHCP address** for the machine | A portal that moves when the router reboots is a portal that is down. |
| 7 | **SMTP credentials** (optional) | Without them invitations and resets are copy-link only, which works — the advisor sends the link themselves. |
| 8 | **The firm's timezone** | Reminders go out at 08:00 there, and "overdue" is measured against that calendar. |

### Install order

```powershell
# 1. Clone, elevated, into C:\docflow\app
git clone https://github.com/Womarali1992/docflow.git C:\docflow\app
cd C:\docflow\app

# 2. Postgres: config, roles, database
#    - copy ops\windows\postgresql.conf.snippet into <PGDATA>\postgresql.conf
#    - replace <PGDATA>\pg_hba.conf with ops\windows\pg_hba.conf.example
#    - Restart-Service postgresql-x64-17
#    - create the roles and database (SQL is in pg_hba.conf.example)

# 3. ClamAV: copy both example configs, run freshclam ONCE by hand (~250 MB),
#    then install clamd and freshclam as services.

# 4. WinSW: download WinSW.NET461.exe into C:\docflow\services\

# 5. The installer: account, folders, ACLs, build, services, firewall, backup task
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\install.ps1 `
    -DataRoot D:\docflow-data -BackupDest E:\docflow-backups

# 6. Edit server\.env — the production block at the bottom of .env.example says
#    exactly which lines. Generate the two secrets ON THIS MACHINE.

# 7. Migrations
cd server; npm run db:migrate; cd ..

# 8. Caddy: copy ops\windows\Caddyfile.example to C:\docflow\caddy\Caddyfile and
#    put the real hostname in it. Download caddy.exe into C:\docflow\caddy\.

# 9. Start everything
Start-Service docflow-api, docflow-worker, caddy

# 10. Prove it
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\verify.ps1 -HostName docs.firm.com
```

### The certificate

Caddy asks Let's Encrypt for one the first time a request arrives for the hostname. It needs DNS
already pointing here and port 80 reachable **at that moment**. If it fails:

- `Get-Content C:\docflow\services\logs\caddy.out.log -Tail 50` says why, in plain words.
- The usual causes, in order of likelihood: the A record has not propagated, the router forwards 443
  but not 80, or the ISP blocks 80 (some residential lines do — the firm then needs the DNS-01
  challenge, which is a different Caddyfile and an API token from the DNS provider).
- `verify.ps1 -HostName …` prints the days remaining once it works. Renewal is automatic and needs
  nothing from anyone; the check exists so a failed renewal is noticed before it expires.

### The first advisor

There is no sign-up page — `ALLOW_PROVIDER_SIGNUP` stays `false`, so the only way an advisor account
exists is somebody with a shell on this machine creating it:

```powershell
cd C:\docflow\app\server
npm run admin -- create-advisor --email sarah@firm.com --name "Sarah Chen" --firm "Chen & Co CPA"
```

It prints a one-time link. Open it in a browser **on the firm PC**, set a password, and enroll the
authenticator app when prompted — two-step verification is not optional for anyone, including the
advisor. Save the ten recovery codes somewhere that is not the same laptop.

### The first client

From the advisor's own screen, not the command line: **Clients → New client**, then hand over the
invitation link it shows. With SMTP configured the client is emailed as well; without it, the
advisor sends the link themselves (text, in person, whatever they normally use). The link is single
use and lasts seven days.

Then, in the client's page: **New engagement**, pick a template, and the checklist exists. That is
the whole onboarding.

## Running it day to day (C5.3)

**Every morning (10 seconds):** open `/settings/system`. It answers the only four questions that
matter — did last night's backup work, is the scanner answering, is the disk filling, is anything
stuck. Everything green means nothing needs doing.

**Every week:** swap the offline backup drive (see "Offline copy rotation"). Glance at the failed
jobs count; a non-zero one is almost always email credentials.

**Every month:** run a restore drill against the most recent set. A backup nobody has restored is a
hypothesis.

**When updating:**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\update.ps1 -HostName docs.firm.com
```

It backs up first, refuses to run on a dirty working tree, builds before stopping anything, migrates,
restarts and verifies. The portal is down only for the migration and two service restarts.

## When something is wrong (C5.3)

### The virus scanner is not answering

**What the client sees:** uploads still work and say "Received — being checked". Nothing is lost.
**What is actually happening:** every new version is stored with `scanStatus = error` and a retry job
is queued (30 attempts over about a day). Nothing is served until it passes.

```powershell
Get-Service clamd
Start-Service clamd
Get-Content C:\ProgramData\ClamAV\clamd.log -Tail 30
```

The usual cause is the `Example` line still present in `clamd.conf` after an upgrade replaced it.
Once clamd answers, the retry jobs publish everything by themselves — there is nothing to re-upload.

### The disk is filling

Ordered by what buys the most room soonest:

1. Old backup sets on this machine (`-Keep 30` should be pruning them; check the destination is not
   also the data volume).
2. Postgres logs in `<PGDATA>\log`.
3. Service logs in `C:\docflow\services\logs`.

**Never** delete anything under `DATA_ROOT\files`. Those are the documents themselves, they are
immutable by design, and `npm run integrity` will fail for every one that is missing.

### The certificate did not renew

The portal is down and every client sees a browser warning. `caddy.out.log` says why. While it is
being fixed the advisor can still work locally on `http://127.0.0.1:4000` — but no client can reach
anything, so tell them.

### An update went wrong

`update.ps1` takes a backup before it touches anything, so the last good copy is minutes old.

```powershell
# 1. Stop the services
Stop-Service docflow-api, docflow-worker

# 2. Put the code back
cd C:\docflow\app; git reset --hard <the commit update.ps1 printed as "before">

# 3. Rebuild
npm ci; npm run build; cd server; npm ci; npm run build; cd ..

# 4. If a MIGRATION was the problem, the database has to go back too — restore
#    the pre-update set into docflow_restore, check it, then promote it. Never
#    pg_restore over the live database while it is the only copy.

# 5. Start and verify
Start-Service docflow-api, docflow-worker
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\verify.ps1 -HostName docs.firm.com
```

### Somebody is locked out

- **Lost authenticator:** they use one of their ten recovery codes. If those are gone too:
  `npm run admin -- reset-mfa --email them@example.com`, then they enroll again on next sign-in.
- **Forgotten password:** the advisor sends a reset link from the client's page (Reset link). The
  self-service "forgot password" form only works when SMTP is configured.
- **Too many attempts:** the throttle is in memory and clears itself in fifteen minutes. Restarting
  `docflow-api` clears it immediately.

### Someone has left the firm, or a client has

`npm run admin -- deactivate --email them@example.com` — sign-in refused, every live session ended,
pending invitations dropped, and nothing on the file changes. It is reversible with `reactivate`.

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

## Nightly backup and the restore drill (v2 — C5.2)

Supersedes the v1 section above. v1 backed up `server\uploads`, which was the whole store when it
was written; since C2.3 the bytes live under `DATA_ROOT`. **C5.4 stopped `backup.ps1` copying the
legacy tree**, so a set taken from this commit on contains one file tree. `restore.ps1` still
understands an older set that has both — a backup you cannot restore is not a backup.

> **Mind the gap.** `backup.ps1` stopped copying `server\uploads` in the same commit that wrote
> `0008_contract` — but the migration has not been run and the tree is still on disk, with 5
> `documents` rows still carrying a `storage_path`. Until the byte-identity check below confirms
> those 5 files are redundant copies of versions already under `DATA_ROOT`, a nightly set taken now
> does **not** contain them. Either finish the contraction or copy `server\uploads` by hand; do not
> leave it sitting in this gap.

### What a v2 backup set contains

```
<Dest>\<yyyy-MM-dd>\
  db.dump          pg_dump -Fc of the whole database
  files\           every document version's bytes, mirroring DATA_ROOT\files
  config\          server.env  <-- SECRETS. The destination must be an encrypted volume.
  manifest.json    sha256 of the dump and of every file, row counts, pg_dump version
```

**The manifest is what makes the set a backup rather than a folder.** `npm run backup:manifest`
asks the database which files should exist, hashes each one in the copy, and **fails the run** if a
file the database says it can serve is missing or hashes differently. A set with a manifest is a
complete, verified set; a set without one is nothing.

### Run a backup

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\backup.ps1 -Dest E:\docflow-backups
```

Order is dump -> files -> manifest -> `backup_runs`, and every run is recorded whether it worked or
not. `/settings/system` reads that table, so **"did the backup run?" is answered in the app**, not by
looking at a drive.

Versions are immutable, so the files copy is `robocopy /XO` — incremental. A season of scans is not
re-copied every night; only what is new.

Scheduled task on the firm PC (C5.3 installs it): daily 02:00, as `docflow-svc`, "run whether user is
logged on or not". Keep 30 days (`-Keep`).

### Restore drill

**A backup nobody has restored is a hypothesis.** Run this monthly, and after any change to what is
backed up:

```powershell
$env:PG_ADMIN_URL = 'postgres://postgres@localhost:5432/postgres'
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\restore.ps1 -From E:\docflow-backups\2026-09-07
```

It refuses any target that is not `docflow_restore*`, so it can never restore over the live
database. It then compares every table's row count with the manifest and runs `npm run integrity`,
which checks each version's bytes against **both** the database's sha256 and the manifest's.

### Drill record

| Date | Set | Result | Notes |
|---|---|---|---|
| 2026-09-05 | dev box, v1 | PASS | legacy schema, uploads only |
| 2026-09-07 | `C:\Users\omara\docflow-backups\2026-09-07_020646` (dev box, v2) | **PASS** in 7.2 s | 20 tables matched, 5 document versions + 5 legacy files verified against the database and the manifest; restored to `docflow_restore` and `C:\Users\omara\docflow-restore` |

### The C5.4 contraction (2026-09-07)

The one destructive migration in the programme. `0008_contract` drops 18 legacy `documents` columns
and the `presets` table, makes `documents.kind` NOT NULL, and backfills `clients.email_normalized`
before making it NOT NULL and unique. `server\uploads` is then deleted by hand.

> **STATUS: NOT YET RUN.** The migration is written and committed; it has been applied only to
> `docflow_test`, which the test harness builds from empty on every run. The dev database is still at
> `0007_workflow_model` with every legacy column and the `presets` table intact, and `server\uploads`
> still holds its 5 files. Do not read the table below as a record of a completed drop.

**What must be checked first, on the target database — all of it, every time, on every machine:**

| Check | Why | Dev box, 2026-09-07 |
|---|---|---|
| `SELECT count(*) FROM documents WHERE kind IS NULL` | a row the import never converted would lose its only data | **0** ✅ |
| duplicate / NULL `clients.email_normalized` | the unique index fails loudly rather than dedupe silently | **0 / 0** ✅ |
| `SELECT count(*) FROM presets` | the table is dropped | **0** ✅ |
| `npm run legacy:redundancy` — every file in `server\uploads` sha256-compared to a retained version under `DATA_ROOT` | this is what makes deleting the tree safe | **5 / 5 redundant, 0 orphans** ✅ 2026-09-07 |

That last row is the important one, and it is **not** what `npm run integrity` does. Integrity proves
the legacy tree is *intact*; deleting it needs proof it is *redundant*. The two are different
questions, and only the second one licenses an `rm`. `scripts\legacy-redundancy.mjs` asks the second
one directly: for each `documents.storage_path` still set, it finds a version of that same document
with the same sha256, confirms those bytes exist under `DATA_ROOT` and hash identically, and refuses
to count a quarantined version (whose bytes were destroyed on purpose) as proof. It also lists
orphans — files in the tree no row points at, the one case where an `rm` destroys the only copy of
something. Exit 0 only when every file is accounted for and there are no orphans. After
`0008_contract` has run there is no `storage_path` column left, and the script says so rather than
pretending to check.

A backup was taken by hand before the first attempt (`docflow-backups\2026-09-07_113927`). **Take a
fresh one immediately before actually running the migration** — that set predates the contraction
commit.

**The order, when you run it:**

```
cd server
npm run count                     # record the before-state
npm run integrity                 # legacy tree intact
npm run legacy:redundancy         # ...and redundant. MUST pass; it is the licence for the rm
.\ops\windows\backup.ps1          # fresh set, from the repo root
npm run db:migrate                # applies 0008_contract
npm run count                     # presets gone, migrations = 9
npm run integrity                 # the surviving tree still matches the database
# only now:  Remove-Item server\uploads -Recurse -Force
```

**Still outstanding — the pilot is not finished until these are done and dated here.** They need the
firm PC (or a staging Windows box), a phone and a second machine on the LAN:

- [ ] **the contraction itself**, in the order above. `npm run legacy:redundancy` passed 5/5 with 0
      orphans on 2026-09-07, so all four preconditions are met; what is left is a fresh backup →
      `npm run db:migrate` → delete `server\uploads`. Everything else in this list can be done before
      or after; this one is the destructive step, and it has not been run.
- [ ] a client's whole journey — invitation → MFA → upload → correction → resubmission → download —
      on a desktop **and** a phone, including **one file whose name is not plain ASCII**
      (`Résumé.pdf`, `2026 Form 1040 — draft.pdf`). This is a real defect class, not a formality:
      one such filename took the whole API process down on 2026-09-07.
- [ ] the nightly backup having run **three nights in a row** — that proves the scheduled task, not
      the script.
- [ ] a restore drill on a **clean Windows machine**, passing `npm run integrity`.
- [ ] `Test-NetConnection <machine> -Port 443` succeeds and `4000` / `5432` / `3310` do not, run
      **from another machine on the LAN**.
- [ ] a keyboard-only walk of both portals.
- [ ] firm SMTP credentials in `server\.env`, worker restarted, `mail.configured: true` on
      `/settings/system`, and one real invitation sent.

### Offline copy rotation

Two drives, labelled A and B. A stays connected for the nightly task; B lives somewhere else — a
different building, a safe, not the same desk.

- **Weekly (say Friday):** run the backup once more with `-Dest <B>`, then disconnect B and swap it
  with A's off-site position. `-Keep 30` prunes each drive independently, so a drive that has been
  away for a fortnight keeps everything it had.
- **Why bother:** ransomware encrypts what is mounted. The only copy it cannot reach is the one that
  is unplugged. This is also the only protection against "the backup drive died on the same day".
- **Check when you swap:** open `/settings/system` and confirm the last good backup is from last
  night. If it is older, the scheduled task has stopped — find out why before touching the drives.

### If a restore is for real, not a drill

Restore into `docflow_restore` first and check it, exactly as the drill does. Only then promote it
(see "Promoting a restored database" above). Never `pg_restore` over the live database: if the set
turns out to be damaged, you will have destroyed the only other copy.

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

## Legacy import (C2.1) — done, and the script is gone (C5.4)

**This section is history.** The import ran for real against the dev database on 2026-09-06 (record
below), and C5.4 deleted `db/migrate-legacy.ts` along with the legacy columns it reads — a script
that cannot compile is worse than no script. **After C5.4 no pre-C2.1 DocFlow database can be
imported.** If one ever turns up, the route back is: check out a commit before C5.4, run the import
there against a restored copy, then migrate that database forward through `0008_contract`.

What it did, for the record:

The workflow model (engagements → requests → documents → versions → reviews) arrived as an
**additive** migration: every legacy column and route kept working until C5.4. One script then
converted the existing rows into the new shape.

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
| 2026-09-06 | `docflow-backups\2026-09-06` | Restore drill **PASS** (5 files verified, counts match). Migrated to `0007_workflow_model`, then imported: 3 engagements, 3 requests, 5 versions, 2 reviews, 8 documents converted, 5 scan jobs queued. All 5 versions' bytes matched their recorded sha256 and size; the 5 legacy uploads were untouched. A second run created nothing. Then run against the dev database with `--trust-legacy-files`. |

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

## Uploads and virus scanning (C2.3)

Every byte that enters DocFlow goes through one pipeline:

**authorize → stage → validate → scan → publish**

- **Authorize first.** The target request, engagement or document is resolved and
  authorized *before* the multipart body is parsed. An upload aimed at someone else's
  file never reaches the disk at all.
- **Stage.** The file is written to `<DATA_ROOT>\staging\<uuid>.part`, never into memory.
- **Validate.** The extension is a claim; the bytes are the truth. A `.pdf` whose contents
  are a PNG is refused. Password-protected files are refused too — not because they are
  dangerous, but because a scanner cannot see inside them.
- **Scan.** clamd, over its INSTREAM socket.
- **Publish.** Only then is the file moved into `<DATA_ROOT>\files\yyyy\mm\`, hashed, and
  recorded as a version.

Any refusal deletes the staged file and returns a stable code the UI can branch on:
`unsupported_type`, `type_mismatch`, `encrypted`, `empty_file`, `too_large`, `infected`.

### What happens when the scanner is down

**The client's upload is accepted, not rejected.** The firm's outage is not the client's
problem. The file is stored, the version is `error`, a retry job is queued every 5 minutes
for 24 hours, and the client gets **202** with "we are checking this file".

Nobody can read it in the meantime — a download returns 409 `not_available_yet`. When clamd
comes back the retry job publishes it and moves the checklist on by itself. If the retry
finds it infected, the version is quarantined: the row stays as the record, the bytes are
deleted, and the document stops pointing at it.

`GET /api/ops/status` shows `scanner.reachable`, so an advisor can see the cause rather than
guessing why nothing is appearing.

### The one setting to get right

`SCAN_REQUIRED=false` is for a dev machine with no clamd. **It does not mean "publish
anyway"** — uploads are stored and left `pending`, which is the honest state for a file
nothing has looked at. Nothing is ever marked clean without a scanner saying so, and the
setting is ignored entirely when `NODE_ENV=production`.

On the firm PC (C5.3 installs ClamAV):

```
CLAMD_HOST=127.0.0.1
CLAMD_PORT=3310
SCAN_REQUIRED=true
```

Check it with `GET /api/ops/status` → `scanner.reachable: true`. `freshclam` needs internet
to update signatures.

### The hourly sweeper

The worker sweeps two kinds of debris — the backstop, not the mechanism, since every error
path already cleans up after itself:

1. staged `.part` files older than an hour (an upload that died mid-flight);
2. versions still unpublished after an hour, which become `error` so the ops panel shows them.

It never touches anything under `files\` that a version points at.

### Testing without ClamAV

The scanner's own paths — clean, infected, unreachable, timeout, garbled reply — are tested
against a **fake clamd on a real TCP socket**, so the suite runs fully on a machine with no
antivirus installed. One integration test uses the real EICAR string against a genuine clamd
and **skips automatically** when none is listening; it runs for real on the firm PC.
