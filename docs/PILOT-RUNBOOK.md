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
