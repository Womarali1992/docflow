# Engineering audit refactor — plan

> Answers `docs/audit/2026-11-11-engineering-audit.md` (12 findings and five smaller things).
> The audit's own summary is the design brief: rules are "enforced on one route and not on its
> sibling". So this plan does not patch twelve routes. It gives each rule **one home**, moves
> every route onto it, and adds a test that fails when a new route skips it.
>
> Branch `audit-refactor`, cut from `whose-move-boards` at `e9b37ad`. This
> file holds the design. The Status ledger below is the live state: update it after every
> commit.

## Status ledger

| Step | Commit | Status | Id | Notes |
|---|---|---|---|---|
| R0 | `test(audit): the 2026-11-11 findings as failing tests` | DONE, draft PR #3 | `0862be9` | probe 11/11 reproduced; one correction (finding 10, `?limit=abc`); 22 `it.fails` rows = 30 tests; server 1006 / 27 files (976 before R0), frontend 71 / 12, lint 0 / 9 |
| R1 | `refactor(workflow): one writer for a line's status` | DONE, draft PR #4 | `e730cf3` | behaviour-identical move. `workflow/line-status.ts`: `decideLine`, `waiveLine`, `reopenLine`, `resetLine`, `settleLine`, `reviveLine`. Also moved: `db/demo.ts`'s two status writes (decide, waive), which the plan did not list. Guard in `hardening.test.ts` (updates only; inserts start at the default; PATCH's computed `set(updates)` named with its reason); run on the pre-R1 tree it finds all 8 writers. Server 1007 / 27, frontend 71 / 12, lint 0 / 9 |
| R2 | `fix(review): one decision path, and the client hears about it` | DONE | (next commit records it) | findings 1, 7 (accept half), smaller thing 5. `workflow/decisions.ts`: `recordDecision` (a line or a lone document, one transaction), `announceDecision` (notice + activity for both), `latestDecisions`. `decideLine` returns false when the line has no decidable file; the refusal is 400 `nothing_submitted`, now also from the correction route. A document route decision goes through the line when the file is a client upload on a line and not archived; imported or archived files keep the document path, as before. Deviations: the portal says "Needs another look" (the checklist card's words) rather than "Another copy needed"; `latestDecision` is the ruling on the *current* version, sent by the document list, a single document and a decision (`serializeDocumentWithDecision`), and shown only on files with no line; the demo seeder throws if `decideLine` refuses. Guard: no `insert(schema.reviews)` outside decisions.ts (demo allowed, named). 3 rows flipped, 3 tests + 1 guard added. Server 1011 / 27, frontend 71 / 12, lint 0 / 9 |
| R3 | `fix(workflow): a line settles when its file leaves` | NOT STARTED | | finding 7 (archive, quarantine) |
| R4 | `fix(engagements): closed means closed on every route` | NOT STARTED | | finding 6 |
| R5 | `fix(files): one delivery path` | NOT STARTED | | finding 5 |
| R6 | `fix(clients): no password door for advisors` | NOT STARTED | | finding 2 |
| R7 | `feat(audit): every change leaves a row` | NOT STARTED | | finding 8, rest of 2 |
| R8 | `fix(auth): the second step is throttled per account` | NOT STARTED | | findings 3, 9 |
| R9 | `refactor(routes): ids and scope checked in one place` | NOT STARTED | | findings 4, 10, 11; search, catch-all |
| R10 | `chore(deps): npm audit fix` | NOT STARTED | | finding 12, non-major only |

Baseline recorded in R0 (2026-11-11, suite run alone, 572 s): server 976 tests / 27 files at
`e9b37ad`, 1006 with R0's 30 `it.fails` tests; frontend 71 / 12 files; eslint 0 errors /
9 warnings; both typechecks and the build pass. A step that flips its rows keeps the count; a
step that adds guard tests raises it.

Each step is one commit on `audit-refactor` and one draft PR (the user's choice, 2026-11-11):
branch `audit-refactor-rN` at that commit, PR base `audit-refactor-r(N-1)` (R0's base is
`whose-move-boards`), so each PR shows one step. A step's commit id is written into the ledger
by the next step's commit.

Every step runs the full server suite **alone** (`npx vitest run` in `server/`, nothing else
touching `docflow_test`) and the four frontend gates before its commit, as in the firm book
program.

## Before R1 (done in R0)

The probe ran alone on 2026-11-11 at 23:21 (11 of 11, 18 s) and reproduced every finding it
covered. The one disagreement: `?limit=abc` on activities answers 200 with every row, not 500
(drizzle drops a `NaN` limit). R9's fix is unchanged. The report now says so and has a table
of how each finding was confirmed. The probe file is deleted; its evidence lives on as the
`it.fails` rows below.

An earlier attempt at 19:42 is void: a full server suite was running on `docflow_test` at the
same time. Before running the suite or any test file, check that no `vitest run` is alive in
`server/`.

### The `it.fails` rows R0 left, by the step that flips them

A row's name is `<finding> (<step>): …`. Each step turns its own rows into `it`.

| Step | Rows | Where |
|---|---|---|
| R2 | F1, F7 (accept on an empty line), S5 | `workflow.test.ts` "the review loop" |
| R3 | F7 (archive settles the line), F8 (unarchive audited) | `workflow.test.ts`, `audit.test.ts` |
| R4 | F6 ×9, one per route (one loop row in the source) | `workflow.test.ts` "a closed engagement takes no changes" |
| R5 | F5 ×2 | `delivery.test.ts` "one delivery path" |
| R6 | F2 (no password on client create or update) | `audit.test.ts` |
| R7 | F2 (reset link audited), F8 ×4 (client sign-in, line reopen, engagement reopen, edits) | `audit.test.ts` "what the record misses" |
| R8 | F3 ×2 | `mfa.test.ts` "wrong codes". R8 also rewrites the second half of `throttles after 5 wrong codes per session…`, which asserts today's per-session lock |
| R9 | F4, F10 ×3, F11, S2 | `authz.test.ts` "what a caller can name", `workflow.test.ts` "search" |

No row for finding 9 (R8 adds one that does not depend on timing: the tests hash at cost 4),
finding 12 (R10 is `npm audit`), or S1, the frontend catch-all (R9 adds a frontend test).

Each claim this plan relies on was re-read in the code on 2026-11-11 at `e9b37ad`:

- **A line's status has five writers in three files.** `requests.ts:134` (accept, correction),
  `requests.ts:343` (waive), `requests.ts:378` (reopen), `documents.ts:270` (unarchive),
  `documents.ts:300` (`settleAfterWithdrawal`) and `publish.ts:210` (`resetRequest`). The
  publication columns already have one writer and a grep test that keeps it so
  (`hardening.test.ts:774`). The status column has neither.
- **The closed check is written five times** with three different sentences: `requests.ts:392`
  (`engagementClosed`, used by remove and restore), `documents.ts:323` (withdraw),
  `uploads.ts:332` and `:418`, `engagements.ts:413`, plus `reminders.ts:160`. Nine mutating
  routes have none.
- **A decision is written twice.** `requests.ts:106` (`recordDecision`: reviews, status, thread
  message, audit, then notify and activity in the route) and `documents.ts:118` (`decide`:
  review and audit only).
- **Bytes are served twice.** `versions.ts:91` (`deliver`: sniffed type, attachment by default,
  audited) and `documents.ts:399` (recorded type, inline by default, not audited). Both frontend
  callers of the old one already ask for `?disposition=attachment` (`Shared.tsx:48`,
  `Deliverables.tsx:132`).
- **Scope checks are still written inline** in `clients.ts:97` (`ownClient`, no `isId`),
  `clients.ts:113`, `messages.ts:25,57,96` and `documents.ts:484`, beside `scope.ts#findClient`
  which does the same with the id check.
- **`audit_log.action` is a text column** (`schema.ts:585`), so new actions need no migration.
- **`mfaVerifyLimiter` runs after `authenticateAnyStage`** (`mfa.ts:26,34`), so `req.auth.sub`
  is available to key on.
- **The frontend API client still types `password` on client create and update**
  (`src/api/client.ts:302,307`); no screen passes it on update.

## The design

Five rules, each with one home and one test that guards it.

| Rule | Home | Guard |
|---|---|---|
| Only one module moves a line's status | `server/src/workflow/line-status.ts` | grep test: no other file under `src/` writes `requests.status` |
| A closed engagement takes no changes | `requireOpenEngagement` in `routes/scope.ts` | route-table test: every mutating route on a request, document or engagement either calls it or is on a short named allow-list |
| A decision is one transaction and one announcement | `server/src/workflow/decisions.ts` | both routes call it; no `insert(schema.reviews)` elsewhere |
| Bytes leave through one function | `server/src/files/deliver.ts` | grep test: `createReadStream` appears in no route file |
| Every change leaves an audit row | `auditRequest` at each site | route-table test: every non-GET route maps to an audit action or a written reason it has none |

The route-table tests walk the Express router stacks of the built `app`, so a route added
later without an entry fails the suite. That is what stops the next sibling from drifting.

## Steps

### R0 — `test(audit): the 2026-11-11 findings as failing tests`

Run the probe alone, correct the audit report where the table disagrees with it, and commit the
report. Move each probe into the test file that owns the subject (`workflow.test.ts`,
`audit.test.ts`, `mfa.test.ts`, `authz.test.ts`, `delivery.test.ts`) as `it.fails` with the
finding number, the way `hardening.test.ts` did it. Delete the probe file. Each later step
turns its own rows into `it`.

### R1 — `refactor(workflow): one writer for a line's status`

Behaviour-identical. New `workflow/line-status.ts` holding the moves that exist today, each
taking a `tx`:

- `decideLine(tx, requestId, 'accepted' | 'needs_correction', now)`
- `waiveLine`, `reopenLine`
- `resetLine` (moved from `publish.ts#resetRequest`)
- `settleLine` (moved from `documents.ts#settleAfterWithdrawal`)
- `reviveLine` (the unarchive branch at `documents.ts:267`)

Routes call these; nothing else changes. Add the grep test. No test count should change apart
from the new one.

### R2 — `fix(review): one decision path, and the client hears about it`

New `workflow/decisions.ts`: `recordDecision` moves there from `requests.ts` and takes either
a request or a lone document. `announceDecision` does the notify and the activity line for
both.

- **Finding 1.** A correction on an ad-hoc upload posts the note to the thread pinned to the
  document, notifies the client (`request.correction`, link `/portal/documents`) and writes an
  activity line. An accept notifies too.
- **Finding 7, accept half.** `decideLine` refuses a line with no attachments:
  400 `nothing_submitted`.
- **Smaller thing 5.** `/documents/:id/accept` and `/request-correction` on a document that
  has a `requestId` decide through the line (same code as `/requests/:id/...`), so a review can
  no longer be written without moving the line.
- **Frontend.** `src/pages/portal/Documents.tsx` shows the latest decision on an ad-hoc file
  ("Accepted", or "Another copy needed" with the note). The serializer adds `latestDecision`.

### R3 — `fix(workflow): a line settles when its file leaves`

`settleLine` is called, in the same transaction, from `POST /documents/:id/archive`,
`DELETE /documents/:id` and the quarantine in `scan_retry.ts:91`. Archive and delete take the
document lock first, as withdraw does. Unarchive audits `document.unarchived` (new action).
**Tests:** archive the only file on a submitted line and the line is `requested`; archive one
of two and it stays `submitted`; a re-scan that quarantines the only file does the same.

### R4 — `fix(engagements): closed means closed on every route`

`requireOpenEngagement(res, engagementId)` in `scope.ts`, one sentence per audience, code
`engagement_closed`, status 400 as today. The five existing copies call it. Then the routes
that have no check:

- `POST /documents/:id/versions`
- `POST /requests/:id/accept`, `/request-correction`, `/waive`, `/reopen`, `PATCH /requests/:id`
- client `POST /requests/:id/respond`
- `POST /documents/:id/accept`, `/request-correction`

Allowed on a closed engagement, on the test's allow-list with a reason each: reads and
downloads, export, share and unshare of a deliverable, archive and unarchive, messages,
`POST /engagements/:id/reopen`. Add the route-table test.

### R5 — `fix(files): one delivery path`

Move `deliver` and `unavailable` to `files/deliver.ts`. `GET /documents/:id/download` resolves
the current version and calls it: `?disposition=attachment` is a download; without it, a
preview when the sniffed type is previewable and a download otherwise. The "still being
checked" answers for a document with no current version stay as they are. Result: both paths
audit `document.downloaded`, send the sniffed type and sandbox inline content.

### R6 — `fix(clients): no password door for advisors`

Remove `password` from `updateClientSchema` and `createClientSchema`,
make both `.strict()`, and drop the field from `src/api/client.ts`. A client's password then
comes only from an invitation or a reset link. Tests and seed that create a client with a
password write the row directly.

### R7 — `feat(audit): every change leaves a row`

New actions: `request.reopened`, `request.edited`, `engagement.reopened`, `engagement.edited`,
`document.unarchived` (R3), `document.edited`, `template.created` / `.edited` / `.deleted`,
`client.edited`, `client.reset_link_created`, and `auth.mfa_failed` (defined, never written;
R8 writes it). A client's successful sign-in writes `auth.login` like an advisor's. Edit rows
carry the names of the changed fields in `meta`, never the values. Add the route-table test
with its exemption list (marking messages read, marking notifications read, sign-out of an
already-dead session).

### R8 — `fix(auth): the second step is throttled per account`

- **Finding 3.** `mfaVerifyLimiter` keys on `mfa:<kind>:<sub>`, so five wrong codes per
  account per 15 minutes whatever the session. Each wrong code writes `auth.mfa_failed`. Cost:
  someone who holds the password can lock the owner out of the second step for 15 minutes at
  a time. That is the right trade once the password is already lost.
- **Finding 9.** When no account matches, `verifyPassword` runs against a fixed dummy hash
  before the refusal; the same for an account with no password yet.

### R9 — `refactor(routes): ids and scope checked in one place`

- **Finding 10.** `asyncRouter()` installs a `router.param` check for `id` and `versionId`:
  a malformed one answers 404 before any handler. A `queryId(req, name)` helper in `scope.ts`
  answers 400 `bad_id` for a malformed `clientId`, `documentId` or `engagementId` in a query
  string; `limit` falls back to 50 when it is not a number.
- `ownClient`, the inline checks in `messages.ts` and `documents.ts:484` are replaced by
  `scope.ts#findClient`.
- **Finding 11.** `POST /messages` and `PATCH /messages/read` load `documentId` through
  `findDocument` and require it to belong to the thread's client.
- **Finding 4.** A client calling `GET /activities` gets only the lines they wrote themselves
  (`actorKind = 'client'`, `actorId = self`). No migration.
- **Search.** The year filter joins the query before the 50-row limit.
- **Catch-all.** `path="*"` moves outside `DocFlowLayout` so an unknown URL shows a plain
  not-found page to anyone.

### R10 — `chore(deps): npm audit fix`

`npm audit fix` (no `--force`) in both packages, one commit each, suite after each. The major
upgrades (zod 4, drizzle-orm, react-router 7) are not in this plan: each is its own piece of
work and none is reachable through the code as written.

## Not in this plan

- `/api/ops/status` and job retry open to every advisor, jobs not scoped to a firm: fine for
  one firm on one machine.
- Still open from 2026-10-28: `in_review` never set, no pagination, the fixed five-year
  filter, season roll-forward, e-sign. R1 makes `in_review` a small follow-up.
- The laptop setup (no scanner on 3310, `DATA_ROOT` unset, `NODE_ENV=development`): operations,
  not code.
- `server/src/admin.ts`, the ops scripts and the migrations were not audited.

## Order and why

R1 goes first because R2, R3 and R4 all touch line status, and moving it once is cheaper than
moving it three times. R2 follows at once because it is the audit's first priority: a client
is left waiting. R6 and R7 keep the audit's pairing of findings 2 and 8. R8 matters only once
the portal is reachable from another machine, so it sits late. R9 and R10 are the low-risk
tail.

## Decisions (2026-11-11, the user took each recommendation)

1. **Branch.** `audit-refactor`, cut from `whose-move-boards` at `e9b37ad`.
2. **Closed engagements.** Nothing that changes the checklist or a decision is allowed until
   the engagement is reopened. Sharing and unsharing a deliverable, archiving, messages and
   export stay allowed.
3. **Advisor-set passwords.** The field is removed from both client create and client update.
4. **Client activity feed.** Filtered to the lines the client wrote themselves.
