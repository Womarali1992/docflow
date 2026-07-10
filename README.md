# DocFlow

A financial-advisor document portal. Advisors request, review, and share documents
with clients; clients upload files and message their advisor through a dedicated portal.

- **Frontend** — Vite + React + TypeScript + shadcn/ui (port `8080`, `/api` proxied to `4000`)
- **Backend** — Express + Drizzle ORM + PostgreSQL in [`server/`](server/) (port `4000`)
- **Auth** — JWT in an httpOnly cookie; role-based routing (provider vs client)
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
npm run db:seed               # seed demo data (idempotent; writes placeholder PDFs)
npm run dev                   # API on http://localhost:4000
```

> **Production note:** the server refuses to start in `NODE_ENV=production` unless
> `JWT_SECRET` is set to a strong, non-default value.

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

| Command                                 | Description                               |
|-----------------------------------------|-------------------------------------------|
| `npm run dev`                           | Vite dev server                           |
| `npm run build`                         | Production build (does **not** typecheck) |
| `npm run lint`                          | ESLint                                    |
| `npx tsc --noEmit -p tsconfig.app.json` | Typecheck the app                         |

`server/`:

| Command               | Description                                  |
|-----------------------|----------------------------------------------|
| `npm run dev`         | API with hot reload                          |
| `npm run build`       | Typecheck + compile to `dist/`               |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:migrate`  | Apply pending migrations                     |
| `npm run db:seed`     | Seed / self-heal demo data                   |

## Notes

- Uploads accept PDF, images, and common Office/CSV types up to **25 MB**.
- `drilldown/` is an unrelated standalone prototype and is not part of this app.
