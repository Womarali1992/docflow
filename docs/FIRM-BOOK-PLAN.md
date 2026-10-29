# Firm book + assignment — plan

> The model the user chose on 2026-10-28 for the audit's fourth blocker ("the product is
> single-advisor", `docs/audit/2026-10-28-product-audit.md`). A **firm** owns its clients and
> several advisor logins share that book. Each client has an **assigned advisor** and can be
> reassigned. The work queue gets a **mine / everyone** filter. A client's email is unique
> **within a firm**, not across the whole system.
>
> Branch `audit-fixes`. This file holds the design. The Status ledger below is the live state:
> update it after every commit.

## Status ledger

| Step | Commit | Status | Id | Notes |
|---|---|---|---|---|
| F0 | `docs(plan): firm book + assignment` | DONE | | go-ahead 2026-10-28; the five questions answered (see the end) |
| F0b | `fix(auth): a client signs in whatever case they type` | DONE | `3253dca` | 2026-10-29; clients by `email_normalized`, advisors by `lower(trim(email))` (exact spelling breaks a case-only tie); padded addresses trimmed by the schema; reset link goes to the address on file; admin CLI and advisor signup follow. Server 831 / 24 files |
| F1 | `feat(schema): a firm owns the book (expand)` | DONE (one commit with F1–F6, F8) | `0cb5ee2` | 2026-10-29; migration `0011_firms`, additive + backfill. Tenant `firm_id` cascades from `firms` like `provider_id` does from `providers`; `providers.firm_id` does not. New advisors (CLI, signup, seed, fixtures) found a firm through `createFirmWithOwner` and own it. Reads of the now-nullable `provider_id` carry a `!` until F2/F3 replace them. `firms` joins the backup manifest's table count. New `test/firms.test.ts`. Server 833 / 25 files. Dev DB migrated; all three checks 0 (1 firm "Meridian CPA", its advisor now owner) |
| F2 | `feat(notify): advisor notices go to the assigned advisor, or the whole firm` | DONE (one commit with F1–F6, F8) | `0cb5ee2` | 2026-10-29; `advisorsFor` / `notifyAdvisors` in `notify.ts`, the six sites and demo's two moved. Firm name from `firms.name` (new `firmSignOff` in `db/firms.ts` for emails; `providerMe`/`clientMe` join it; login and signup answer through them). A client's `providerName` is the assigned active advisor, else the firm. Invite page names the inviter (`invitations.created_by_id`). Digest to owners only. `admin list-users` shows firm and role. Tests: 4 in `notices.test.ts`, 2 in `firms.test.ts`, 1 in `ops.test.ts` (helper `insertColleague`) |
| F3 | `feat(tenant): the firm is the tenant` | DONE (one commit with F1–F6, F8) | `0cb5ee2` | 2026-10-29; every scope check and list by `firm_id`; `providerId` gone from `AuthPayload`, serialized rows carry `firmId`; `provider_id` is written by nothing and read only by migrations. Fixture gains `colleague1` (advisor in firm 1, no clients), a 7th actor in the matrix with provider 1's answers. Client DTO `assignedAdvisorId/Name`. Full suite 915 / 922: the 7 were tests naming `provider1` alone, the fixture's table counts and a CLI test at its 20 s limit, all fixed (matrix 578 / 578) |
| F4 | `feat(team): an owner invites advisors into the firm` | DONE (one commit with F1–F6, F8) | `0cb5ee2` | 2026-10-29; migration `0012_staff` (`providers.password_hash` nullable, `staff_invitations`); `auth/staff-invitations.ts`, `routes/firm.ts`, `routes/staff-invitations.ts`, mail template `staff_invitation`, `providerMe.role`. **Deviation:** `GET /api/firm` is readable by every advisor of the firm (F5's picker and F6's toggle need the team); every change is owner-only. A firm keeps an owner because an owner cannot deactivate themselves. One rule for who looks after a client, `isEffectiveAdvisor` in `db/firms.ts` (same firm, active, has joined), used by notices, portal, directory and queue. No password reset for an advisor who has not joined. Admin CLI `create-advisor --join <firm id>`, `list-firms`. Frontend `FirmCard` in Settings, `/staff-invite/:token`. Dev DB migrated |
| F5 | `feat(clients): every client has an advisor, and can be reassigned` | DONE (one commit with F1–F6, F8) | `0cb5ee2` | 2026-10-29; `POST /clients/:id/assign`, `POST /clients` takes `assignedAdvisorId`; `workflow/assignment.ts` (audit `client.reassigned` in the transaction, activity line, in-app `client.assigned` notice). Frontend: Advisor on the client page, Mine / Everyone / Unassigned on the directory, Advisor in New client and the CSV |
| F6 | `feat(queue): mine or everyone` | DONE (one commit with F1–F6, F8) | `0cb5ee2` | 2026-10-29; `GET /dashboard?who=mine\|all` (default all, 400 `bad_who`), rows carry `advisorId/advisorName`. Frontend `useQueueWho` + `WhoToggle` on the queue, Work and Review; defaults to mine once the firm has two advisors who have joined |
| F7 | `feat(clients): a client's address is unique within the firm` | DONE | `625a13c` | 2026-10-29, unparked (overturns Q1). Migration `0013_firm_client_email`: unique `(firm_id, email_normalized)` goes in before the global key comes out, plus a plain `email_normalized` index for cross-firm lookups. `findClientsByEmail` (oldest first, at most `MAX_CLIENT_ACCOUNTS` = 10, which bounds the bcrypt checks per sign-in). Sign-in: one opened account signs in; several answer 409 `choose_firm` naming only the opened firms; `firmId` picks. Reset: one link per active account, and the email now names the firm. Admin CLI: `--firm <id>` on the account commands, stops and lists the firms when ambiguous; `list-users` shows each client's firm. Seed and demo look up by firm. Login page: "Which firm?" step. New `test/client-email.test.ts` (4), admin CLI +1, frontend `Login.test.tsx` (2). Dev DB migrated (14) |
| F8 | `chore(seed): a two-advisor firm to demo` | DONE (one commit with F1–F6, F8) | `0cb5ee2` | 2026-10-29; seed adds James Okafor and splits the clients as planned (new clients only); demo picks the firm by the seed owner's email and writes Michael Chen's reassignment once. Dev DB reseeded: James added, its clients kept their advisor |
| F9 | `chore(db): contract the provider-as-tenant columns` | DONE | `25b5c73` | 2026-10-29, on the user's word (Q5). Migration `0014_contract_provider_tenant` drops `provider_id` from the seven tenant tables, `providers.firm_name`, the six old indexes and seven cascade paths; a hand-added guard refuses if any row's `firm_id` disagrees with its old advisor's firm. `createFirmWithOwner` takes the firm name beside the account. Relations: `clients.firm` and `clients.assignedAdvisor`. `staff_invitations.provider_id` (the invitee) stays. `firms.test.ts` checks the columns are gone. Preconditions met on the dev DB: no reader in `src`, 0 null or mismatched rows, backup `~/docflow-backups/2026-10-29`. Server 975 / 27 files. Dev DB migrated (15 migrations), row counts unchanged |

Baseline before F1: server 818 tests at `0000029`; 831 / 24 files with F0b on top of `2c4e365`
(2026-10-29, this run also covers the withdraw commit). Frontend: typecheck clean, eslint 0 errors / 9 warnings, vitest
55 / 8 files, build clean.

F1–F6 and F8 were built in one working tree and land as one commit, because the steps edit the
same files and an in-between commit would never have been tested on its own. Final run
(2026-10-29): server 969 / 969, 26 files (824 s, alone on `docflow_test`), both typechecks clean;
frontend typecheck clean, eslint 0 errors / 9 warnings, vitest 55 / 8 files, build clean.

F7 and F9 (2026-10-29) are one commit each: server 974 / 27 files at F7 and 975 / 27 at F9;
frontend typecheck clean, eslint 0 errors / 9 warnings, vitest 57 / 9 files, build clean. The
program is complete.

Every step runs the full server suite **alone** (`npx vitest run` in `server/`, about 11 min,
nothing else touching `docflow_test`) and the four frontend gates before its commit.

## What the code does today (verified at `2c4e365`)

The tenant **is** the advisor. Each claim below was checked against the code before this plan
relied on it.

- **The auth payload carries `providerId`, and it means two things.** `middleware/auth.ts:65-86`
  (`loadAuth`): for an advisor, `providerId = sub` (their own id). For a client, it is
  `clients.provider_id` (their advisor). Routes use it as the tenant key for both kinds.
- **Scope checks compare `row.providerId !== auth.providerId`.** All five loaders in
  `routes/scope.ts` do this (`findEngagement` :42, `findRequest` :51, `findDocument` :65,
  `findTemplate` :87, `findClient` :96). **Correction:** the same check is also written inline
  outside `scope.ts`, in `clients.ts:84` (`ownClient`), `clients.ts:105` (`GET /:id`),
  `messages.ts:26,58,99` and `documents.ts:487` (`POST /`). List queries filter on
  `provider_id` directly in `clients.ts:94`, `documents.ts:73`, `engagements.ts:109-110`,
  `dashboard.ts:42,88`, `activities.ts:58`, `search.ts:47,84`, `templates.ts:38-44` and
  `files/quota.ts:93,111` (through `ops/status.ts`; `ops.ts:38` passes `auth.sub`).
- **The tenant rows carry `provider_id`.** Clients, engagements, requests and documents do.
  **Correction:** so do `messages`, `activities` and `request_templates`, which makes seven
  tables. Every one is `NOT NULL` with `ON DELETE CASCADE` from `providers`. `document_versions`,
  `reviews`, `invitations`, `notifications` and `audit_log` do not; they reach the tenant through
  their parent. On the child rows `provider_id` is always the tenant and never the person who
  acted: actors are recorded separately in `uploadedById`, `senderId`, `reviewerId`,
  `waivedById`, `sharedById`, `actorId` and the audit log.
- **`notify()` and the activity log address the advisor through `providerId`.** There are six
  advisor-addressed notices, each sent with `userId: <row>.providerId`: `uploads.ts:211`
  (`upload.received`), `messages.ts:121` (`message.new`, from `auth.providerId`),
  `requests.ts:531` (`request.not_applicable`), `documents.ts:370` (`upload.withdrawn`), and
  `scan_retry.ts:80,122` (`scan.stuck`, `upload.quarantined`). `demo.ts:352,420` sends two
  more. `recordActivity()` writes `activities.provider_id`, which `GET /activities` reads back.
  The daily ops digest (`ops_digest.ts:37`) goes to **every** active provider.
- **Email uniqueness is global.** **Correction:** `clients.email` itself is not unique (it has
  only the plain index `clients_email_idx`). The global rule is on `email_normalized` through
  `clients_email_normalized_key` (unique, from `0008_contract`). The 409 `email_taken` check in
  `clients.ts:132-138` is deliberately unscoped. **Found in passing:** client sign-in
  (`auth.ts:104`), the client password-reset request (`auth.ts:280`), the admin CLI
  (`admin.ts:115`) and `seed.ts`/`demo.ts` all look clients up by the **raw** `email`. A client
  created as `Sarah@X.com` therefore cannot sign in as `sarah@x.com`.
- **`providers.firm_name` holds the firm's name.** It is a nullable text column. Every reader
  falls back to the provider's own name: the email sign-off (`notify.ts:121,130`,
  `clients.ts:250`, `auth.ts:285`, `reminders.ts:80,196`), the invite page
  (`invitations.ts:47`), the sidebar, Settings and the home header.
- **Advisor accounts** come only from `npm run admin -- create-advisor` (`admin.ts:155`) or the
  flag-gated `POST /auth/signup-provider` (off unless `ALLOW_PROVIDER_SIGNUP=true`).
  `providers.role` exists (default `'advisor'`) but nothing reads it. `providers.password_hash`
  is `NOT NULL`, so an account cannot exist before its password does.
  `invitations.client_id` is `NOT NULL`, which means invitations are for clients only.
- **The dev DB** (`docflow` on :5432) has one provider, still named "Sarah Johnson" with firm
  "Meridian CPA", three clients, two templates and migrations 0000–0010 applied. There are no
  duplicate normalised emails.

## The model

```
firms ──< providers (role: owner | advisor)
  │
  └──< clients ── assigned_provider_id ──> providers   (nullable; mutable)
          └──< engagements ──< requests, documents, messages, activities   (firm_id on each)
firms ──< request_templates
```

1. **`firm_id` is the tenant, and it goes on every row that carries `provider_id` today.** That
   is the same denormalisation the code already relies on: one-line scope checks and the
   `requests (firm_id, status, due_date)` queue index. A client never changes firm, so the
   copies cannot drift.
2. **Assignment lives on `clients` only.** It is the one thing that changes. Reassignment is
   therefore a single-row update, and no line, document or message has to be rewritten to
   follow it. The "mine" view joins through `clients`.
3. **Every advisor in a firm sees the whole book.** Assignment decides who is *told* and what
   *mine* means. It never decides who may look. Inside a firm there is no 404.
4. **Roles: `owner` and `advisor`.** An owner can also manage the team: invite, deactivate and
   reactivate advisors. Every existing provider becomes the owner of their own firm.
5. **Expand → switch → contract**, the way `0007_workflow_model` and `0008_contract` did it.
   The old `provider_id` columns become nullable in F1, stop being read and written in F3, and
   are dropped only in F9, on your word.

| | owner | advisor (same firm) | advisor (other firm) | client |
|---|---|---|---|---|
| see / act on the firm's clients, engagements, files, messages | yes | yes | 404 | own only |
| templates | edit | edit | 404 | — |
| reassign a client | yes | yes (Q2) | 404 | 403 |
| invite / deactivate / reactivate advisors | yes | 403 | 404 | 403 |
| System status panel | yes | yes | (installation-wide) | 403 |

## Steps

### F0b — `fix(auth): a client signs in whatever case they type`

Found while checking F7, and the one part of it that cannot wait for a second firm. Client
sign-in (`auth.ts:104`) and the client password-reset request (`auth.ts:280`) look the client up
by the raw `clients.email`, so a client saved as `Sarah@X.com` is told "wrong email or password"
when they type `sarah@x.com`. Both now look up by `email_normalized = normalizeEmail(email)`,
which is unique across the install while F7 stays parked. Advisor sign-in compares
`lower(email)` the same way. The admin CLI's client lookup (`admin.ts:115`) follows.
**Tests:** mixed-case and padded addresses sign in and get a reset link, for both kinds.

### F1 — `feat(schema): a firm owns the book (expand)`

**Migration `0011_firms`.** It is generated with `npx drizzle-kit generate` and then renamed,
and the backfill is added by hand the way `0008` did it:

- `firms (id, name NOT NULL, created_at, updated_at)`.
- `providers.firm_id` (FK, **no cascade**) is filled with one firm per existing provider, named
  `coalesce(nullif(trim(firm_name), ''), name)`, which is the fallback every email already uses.
  The column is then made `NOT NULL`. Every existing provider gets `role = 'owner'`.
- **The firms get fresh ids, not their founder's id.** If a firm's id equalled its founder's id,
  code that passed a provider id where a firm id belongs would pass every test against migrated
  data. A temporary `founder_id` column carries the mapping and is dropped in the same migration.
- `firm_id` is added to `clients`, `engagements`, `requests`, `documents`, `messages`,
  `activities` and `request_templates`, backfilled from `providers.firm_id` through each row's
  `provider_id`, and made `NOT NULL`. Each gets an index; `requests` gets
  `(firm_id, status, due_date)`.
- `clients.assigned_provider_id` (FK `ON DELETE SET NULL`, indexed) is backfilled from
  `clients.provider_id`.
- `provider_id` becomes nullable on all seven tables. Nothing stops writing it yet.

**Code.** `firmId` is added to `AuthPayload` (`loadAuth` reads it for both kinds), and every
insert also sets `firm_id`, taking it from `auth.firmId` or from the parent row. The insert
sites are `clients.ts:158`, `engagements.ts:137` and `:449` (`itemsToRequests`),
`documents.ts:504`, `messages.ts:106`, `uploads.ts:305,397` and `starter-templates.ts:69,86`.
`recordActivity()` also takes `firmId`, which touches its 14 callers. Beyond those: `admin.ts`
(`create-advisor` creates a firm and its owner; `record()`), `auth.ts` `signup-provider`
(creates a firm), `seed.ts` (finds or creates "Meridian CPA") and `demo.ts`. Tests: `helpers.ts` `insertProvider`/`insertClient` create firms,
and `export.test.ts`, `workflow.test.ts` and `hardening.test.ts` get their direct inserts
updated. No read changes, so behaviour is identical.

**Done when** the full suite is green with no expectation changed and the dev DB is migrated
(`npx tsx src/db/migrate.ts` from `server/`, right after the code lands; the running
`npm run dev` restarts on the file change). These checks against the dev DB must also return 0:
rows whose `firm_id` differs from their provider's firm, providers without a firm, and clients
whose `assigned_provider_id` differs from `provider_id`.

### F2 — `feat(notify): advisor notices go to the assigned advisor, or the whole firm`

- `advisorsFor(clientId)` in `notify.ts` returns the client's assigned advisor when there is one
  and that account is active. Otherwise it returns **every active advisor in the client's firm**.
  The fallback exists so that a client is never shouted into a void: unassigned, or their
  advisor has left, and somebody still hears the upload.
- `notifyAdvisors(clientId, notice)` calls `notify()` once per recipient, so each recipient gets
  their own in-app row and their own coalesced email under the existing per-user key. The six
  sites listed above, and the two in `demo.ts`, move to it.
- The firm's name comes from `firms.name` everywhere the sign-off or a page names the firm:
  `recipientOf`, `reminders.ts` (two joins), `firmNameFor`, the reset request, the invitation
  page and `clientMe`. `me.providerName` for a client becomes the assigned advisor's name, with
  the firm's name as the fallback.
- The ops digest goes to **owners** only. It is about the installation, and staff did not ask
  to hear about backups.
- **Tests** (`notices.test.ts`): only the assigned advisor is told, not a colleague; an
  unassigned client's upload reaches every active advisor in the firm and nobody in another
  firm; a deactivated assignee falls back to the firm; each recipient gets one email per window;
  the digest goes to owners only. Behaviour is identical for a one-advisor firm.

### F3 — `feat(tenant): the firm is the tenant`

- Every scope check listed under "What the code does today" compares `firmId`: the five
  loaders, the inline checks in `clients.ts`, `messages.ts` and `documents.ts`, and every list
  query. Storage on the System status panel is scoped to the firm.
- **`providerId` is removed from `AuthPayload`**, so the compiler lists every remaining reader
  and nothing depends on a grep. A client's messages already reach the advisor through
  `advisorsFor` (F2).
- `provider_id` is no longer written on any of the seven tables (nullable since F1).
- Templates belong to the firm: `ensureStarterTemplates(firmId)`, and any advisor edits them.
- DTOs: `serialize.ts` sends `firmId` instead of `providerId`. The client DTO gains
  `assignedAdvisorId` and `assignedAdvisorName` (F5 uses them). Frontend `api/types.ts` follows.
- **Authz matrix:** a seventh actor, `colleague1`, is an advisor in firm 1 with no clients
  assigned. `S()` fills `colleague1` with `provider1`'s expectation, so the 84 existing cases
  need no edit and each gains a row that proves the shared book (about 490 → 575 checks).
  A case overrides it only where an owner-only route differs (F4). The `check` callbacks that
  assert `providerId` (`authz.test.ts:247,344,411,436`) assert `firmId` instead.
- **Done when** `grep -rn "auth.providerId" server/src` is empty, `provider_id` appears only in
  `schema.ts` and the migrations, and the full suite and frontend gates are green.

### F4 — `feat(team): an owner invites advisors into the firm`

No open signup. `signup-provider` stays off by default, and when it is on it creates a **new**
firm, never a seat in an existing one.

- **Migration `0012_staff`:** `providers.password_hash` becomes nullable (an invited advisor has
  no password yet, and `verifyPassword` already refuses a null hash). A new
  `staff_invitations (provider_id, token_hash UNIQUE, expires_at, used_at, created_by_id,
  created_at)` table follows the client invitations' rules exactly: 7 days, single use, sha256
  of the token, and a new link replaces an unused one. It is a separate table so the client
  invitation path is not touched.
- **Owner routes** (`/api/firm`, `requireOwner`):
  - `GET /firm` returns the firm name and its advisors with role, status, a pending invitation
    and an assigned-client count.
  - `POST /firm/advisors {name, email}` answers `{link, expiresAt, emailQueued}`, which is the
    same copy-link pattern as client invitations. The address is unique across all advisors,
    because advisor sign-in is global; a duplicate gets 409 `email_taken` with the same generic
    sentence.
  - `POST /firm/advisors/:id/invitations` resends the link.
  - `POST /firm/advisors/:id/deactivate {reassignTo: id | null}` ends their sessions and moves
    their clients to `reassignTo`, or leaves them unassigned (F2's fallback then applies). An
    owner cannot deactivate themselves or the last owner.
  - `POST /firm/advisors/:id/reactivate`.
- **Public:** `GET /staff-invitations/:token` and `POST /staff-invitations/:token/accept
  {password}` set the password, burn the link and open a session in `mfa_enroll`.
- A mail template, `staff_invitation`.
- **Audit:** `staff.invited`, `staff.invitation_accepted`, `staff.deactivated` (with the number
  of clients moved) and `staff.reactivated`.
- **Admin CLI:** `create-advisor` keeps `--firm "<name>"` for a new firm, with the account as
  its owner. A new `--join <firm id>` adds the account to an existing firm as an advisor, and a
  new `list-firms` command is added.
- **Frontend:** a "Your firm" card in Settings with the advisor list, an Invite dialog
  (copy-link, like a client invite), and Deactivate (with a "move their N clients to…" select)
  and Reactivate actions. A `/staff-invite/:token` page is built on `Invite.tsx`.
- **Tests:** authz rows (owner 2xx, `colleague1` 403, `provider2` 404 on firm-1 ids, clients
  403, anonymous 401) and the token states (used, expired, invalid). Accepting reaches
  `mfa_enroll`. A deactivated advisor's clients move or fall back.

### F5 — `feat(clients): every client has an advisor, and can be reassigned`

- `POST /clients/:id/assign {advisorId: uuid | null}`. The target must be an active advisor in
  the same firm; otherwise the answer is 400 `not_in_firm`, which says nothing about other
  firms. Assigning the current advisor again is a 200 no-op that writes no audit row.
- The update and an audit row `client.reassigned {fromId, toId}` are one transaction. An
  activity line on the client page reads "Reassigned to James Okafor (was Sarah Mitchell)", and
  the new advisor gets an in-app notice `client.assigned`, without an email. The client is not
  told; the portal simply shows the new name.
- `POST /clients` takes an optional `assignedAdvisorId` and defaults to the advisor creating
  the client.
- **Frontend:**
  - The client directory gets an Advisor column and Mine / Everyone / Unassigned chips. It
    filters in the browser, because the endpoint already returns the whole book.
  - The client page shows "Advisor: Sarah Mitchell · Change".
  - The New-client dialog gets an Advisor select, hidden while the firm has one advisor.
- **Tests:** reassign, cross-firm target refused, deactivated target refused, audit and
  activity rows written, notice to the new advisor, plus authz rows for `/assign`.

### F6 — `feat(queue): mine or everyone`

- `GET /dashboard?who=mine|all`. `mine` means the client's `assigned_provider_id` is me, plus
  unassigned clients (Q3). It applies to all five buckets, unread messages included, through a
  join on `clients`. Rows carry the assigned advisor's name, so "everyone" shows whose line it is.
- **Frontend:** a Mine / Everyone toggle on the Work page and the home tiles, kept in `?who=` in
  the URL. The query key becomes `keys.dashboard(scope, who)`. The existing
  `invalidateQueries(keys.dashboard(scope))` calls still match both views by prefix; a
  `keys.test.ts` case proves it. The toggle is hidden while the firm has one active advisor.
- **Tests:** the bucket counts differ between `mine` and `all` for two advisors and are equal
  for one; an unknown `who` gets 400.

### F7 — `feat(clients): a client's address is unique within the firm`

Read Q1 first. With one firm on this machine, this step changes nothing anyone can see. The
same-firm case from the audit ("a second advisor cannot even add them") is already solved by
F3: the second advisor sees that client in the shared book instead of trying to add them again.

- **Migration `0013`:** drops `clients_email_normalized_key` and adds a unique index on
  `(firm_id, email_normalized)`. `emailIsTaken` is scoped to the firm.
- **Client sign-in** finds candidate rows by `email_normalized`, which also fixes the
  case-sensitivity bug found above. It checks the password against each candidate (bounded).
  Exactly one match signs in. Several matches answer 409 `choose_firm` with the names of only
  the firms whose account that password opened. The login page asks "Which firm?" and posts
  again with `firmId`. Nothing is revealed to anyone who lacks the password, and the rate
  limiters are unchanged.
- **The password-reset request** sends one link per matching active account, each naming its
  firm, and still always answers 202.
- **The admin CLI** stops on an ambiguous client email, lists the firms and accepts `--firm`.
  `demo.ts` looks up by firm and email.
- **Tests:** the same address in two firms is accepted and in one firm is refused. Different
  passwords sign straight in. The same password gets `choose_firm` and then succeeds. The reset
  fans out. Mixed-case sign-in works.

### F8 — `chore(seed): a two-advisor firm to demo`

- **`db:seed`:** creates the firm "Meridian CPA" with Sarah Mitchell (owner,
  `sarah@meridiancpa.com`) and **James Okafor** (advisor, `james@meridiancpa.com`, the same dev
  password and dev TOTP secret). It assigns Sarah Johnson to Sarah Mitchell and Michael Chen to
  James Okafor, and leaves **Emily Davis unassigned**, so the Mine / Everyone toggle and the
  notification fallback each have something to show. The seed stays idempotent and never
  overwrites an assignment that already exists.
- **`db:demo`:** picks the firm through the seed owner's email (today it takes
  `providers LIMIT 1`, which is arbitrary once there are two). Its notices go through
  `notifyAdvisors`, and it writes one reassignment into Michael Chen's history so the client
  page shows one.
- The dev DB's provider keeps the name "Sarah Johnson", because the seed renames nothing.
  Renaming it is a one-line SQL statement if you want it.

### F9 — `chore(db): contract the provider-as-tenant columns` — only on your word

- **Migration `0014`:** drops `provider_id` from the seven tables (`clients.provider_id`
  included, which `assigned_provider_id` replaced), drops `providers.firm_name` and drops the
  old `provider_id` indexes. This also removes seven `ON DELETE CASCADE` paths through which
  deleting one advisor row would have deleted the firm's clients and files.
- **Preconditions,** checked on the dev DB before it runs: no reader in `src` (grep), no row
  with a null `firm_id`, and a fresh backup.

## Decisions taken in this plan (yours to overturn)

1. `firm_id` is denormalised onto every tenant row, and assignment lives on `clients` only.
2. Migrated firms get fresh ids, not their founder's.
3. Templates are firm-wide, and any advisor can edit them.
4. **Message read state stays per message.** When one advisor opens a thread, it is read for
   the firm. Notifications stay per person.
5. Every advisor can see System status. Storage figures are per firm. The ops digest goes to
   owners only.
6. A reassignment gets an in-app notice to the new advisor, with no email. The client is not
   notified.
7. Staff invitations get their own table rather than being folded into the client invitations
   table.
8. No preparer/reviewer split. The audit mentions one, but the chosen model does not include it.

## Questions answered on 2026-10-28

The user took the recommendation on all five.

1. **Per-firm client email (F7): parked** until a second firm is created on this install. F3
   already fixes the audit's case. The sign-in case bug found while checking F7 is fixed on its
   own in F0b.
2. **Who may reassign a client: any advisor in the firm.** Every change is audited and shows on
   the client's activity.
3. **"Mine" includes unassigned clients**, marked with an "Unassigned" pill. The queue opens on
   "mine" once the firm has a second active advisor. Until then there is no toggle.
4. **Colleagues do not hear about clients that aren't theirs.** Only the assigned advisor is
   told; the whole firm is the fallback when a client is unassigned or their advisor is
   deactivated. "Everyone" in the queue is how a colleague covers.
5. **The contraction (F9): parked.** The dead `provider_id` columns stay until the user asks.

On 2026-10-29 the user unparked both: F7 (overturning Q1) and F9 (the word Q5 waited for).
