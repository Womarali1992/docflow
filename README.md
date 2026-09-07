# DocFlow

A financial-advisor document portal. Advisors request, review, and share documents
with clients; clients upload files and message their advisor through a dedicated portal.

- **Frontend** — Vite + React + TypeScript + shadcn/ui (port `8080`, `/api` proxied to `4000`)
- **Backend** — Express + Drizzle ORM + PostgreSQL in [`server/`](server/) (port `4000`)
- **Auth** — opaque server sessions (30 min idle / 12 h absolute, revocable) in an httpOnly cookie; Origin check on every state change; role-based routing (provider vs client)
- **Storage** — uploaded files on local disk under `server/uploads/`, served only through an authenticated download endpoint

## Prerequisites

- Node.js 20+
- Docker (for PostgreSQL), or a local PostgreSQL 16 instance

## Getting started

### 1. Database

```bash
docker compose up -d          # starts postgres:16 on localhost:5432
```

### 2. Backend

```bash
cd server
cp .env.example .env          # adjust if your DB/secret differ
npm install
npm run db:migrate            # apply schema migrations
npm run db:seed               # demo accounts + MFA (idempotent)
npm run db:demo               # a tax season of documents, so there is something to look at
npm run dev                   # API on http://localhost:4000
```

> **Production note:** the server refuses to start in `NODE_ENV=production` unless
> `APP_BASE_URL` is the public https origin (every non-GET request must come from it) and
> `APP_ENCRYPTION_KEY` is set (32 random bytes as 64 hex chars; it encrypts authenticator
> secrets at rest). Set `TRUST_PROXY=1` only behind Caddy.

> **Two-step verification is on for everyone.** `db:seed` enrolls the demo accounts with one
> published authenticator secret and prints it; get the current code with
> `npm run totp -- <secret>` from `server/`. A brand-new account is walked through enrollment
> (QR code + recovery codes) on its first sign-in.

> **Accounts.** Advisors are created on the server console, clients by invitation link:
>
> ```bash
> cd server
> npm run admin -- create-advisor --email ann@firm.com --name "Ann Advisor" --firm "Firm CPA"
> npm run admin -- reset-mfa --kind client --email jane@example.com   # lost authenticator
> npm run admin -- reset-link --kind provider --email ann@firm.com    # one-hour password reset link
> npm run admin -- deactivate|reactivate --kind client --email jane@example.com
> npm run admin -- list-users | list-sessions --kind … --email …
> ```
>
> "New client" in the app creates the record and shows a one-time invitation link (7 days); the
> client sets their own password from it. Passwords are at least 12 characters; the demo
> passwords are refused in production. Email delivery of invitations and resets arrives with C1.4 —
> until then every link is shown to the advisor to copy.

### 3. Frontend

In a second terminal, from the repo root:

```bash
npm install
npm run dev                   # app on http://localhost:8080 (proxies /api → :4000)
```

## Demo credentials (seeded)

| Role    | Email                        | Password      |
|---------|------------------------------|---------------|
| Advisor | `sarah@meridiancpa.com`      | `password123` |
| Client  | `sarah.johnson@meridian.co`  | `client123`   |

## Useful scripts

Root (frontend):

| Command             | Description                               |
|---------------------|-------------------------------------------|
| `npm run dev`       | Vite dev server                           |
| `npm run build`     | Production build (does **not** typecheck) |
| `npm run lint`      | ESLint                                    |
| `npm run typecheck` | Typecheck the app                         |

`server/`:

| Command                            | Description                                                        |
|------------------------------------|--------------------------------------------------------------------|
| `npm run dev`                      | API with hot reload                                                |
| `npm run build`                    | Typecheck + compile to `dist/`                                     |
| `npm test`                         | API tests (vitest + supertest) against the `docflow_test` database |
| `npm run typecheck:test`           | Typecheck the test files                                           |
| `node scripts/create-test-db.mjs`  | Create `docflow_test` once (set `PG_ADMIN_URL` if the dev role lacks CREATEDB) |
| `npm run db:generate`              | Generate a Drizzle migration from the schema                       |
| `npm run db:migrate`               | Apply pending migrations                                           |
| `npm run db:seed`                  | Demo accounts (advisor + 3 clients) and their MFA enrollment       |
| `npm run db:demo`                  | A tax season of engagements, checklists, uploads and deliverables  |
| `npm run count`                    | Row counts + files on record + migrations, as JSON (`--url` to point elsewhere) |
| `npm run integrity`                | Verify every stored file exists and matches the database / a backup manifest |
| `npm run db:create -- --name docflow_restore` | Create a scratch database (`docflow_test` / `docflow_restore*` only) |

Backup and restore live in `ops/windows/` (`backup.ps1`, `restore.ps1`); the procedure and the
drill record are in [`docs/PILOT-RUNBOOK.md`](docs/PILOT-RUNBOOK.md).

## Tests

`server/test/authz.test.ts` is a table-driven authorization matrix: every route is exercised
as two advisors, three clients across two firms, and an anonymous caller. Expectations describe
the target behaviour from [`docs/CPA-PILOT-PLAN.md`](docs/CPA-PILOT-PLAN.md); cases the current
code does not meet yet run as `it.fails` and are flipped as the fixes land. Tests refuse to run
unless `DATABASE_URL_TEST` names a database called `docflow_test`; every table is truncated
before each test.

## Pilot programme

The CPA pilot (engagements, review workflow, server sessions + MFA, scanned immutable uploads,
Windows deployment) is specified in [`docs/CPA-PILOT-PLAN.md`](docs/CPA-PILOT-PLAN.md). Its
Status ledger says which commit is next.

## Notes

- Uploads accept PDF, images, and common Office/CSV types up to **25 MB**.
- Advisor self-signup is disabled unless `ALLOW_PROVIDER_SIGNUP=true`; the seed creates the demo advisor.
- Clients can upload to their own requests and re-upload their own files; only the advisor can
  review, delete, or replace advisor deliverables. Ids outside your firm answer 404, never 403.
- `drilldown/` is an unrelated standalone prototype and is not part of this app.
