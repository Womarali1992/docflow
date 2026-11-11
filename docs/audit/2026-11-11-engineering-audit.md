# DocFlow engineering and security audit — 2026-11-11

Branch `whose-move-boards` at `e9b37ad`. The 2026-10-28 audit covered the product;
this one covers the code: access control, sign-in, the audit trail, workflow
correctness, dependencies and how this laptop is set up.

**Status of this document: reproduced.** Every finding was first read from the code
(file and line given). On 2026-11-11 a probe ran each one against the real API, alone
on the test database (11 of 11 probes ran; table below). Step R0 of
`docs/AUDIT-REFACTOR-PLAN.md` then turned each into a test that asserts the correct
behaviour and runs as `it.fails` until its fix lands. Those tests also reproduced the
parts the probe did not reach. One claim was wrong: `?limit=abc` does not answer 500
(finding 10, corrected below). Finding 9 is confirmed from the code only, and
finding 12 is as npm reports it.

## How each finding was confirmed

| Finding | What the API did on 2026-11-11 | Test (runs as `it.fails`) |
|---|---|---|
| 1 | Correction on an ad-hoc upload: 200, no client notification, no message carrying the note | `workflow.test.ts` F1 (R2) |
| 2 | A colleague (not the owner) set a client's password: 200, no audit row. Signing in with it reached the second step; after the same colleague's MFA reset it reached `mfa_enroll` | `audit.test.ts` F2 (R6), F2 (R7) |
| 3 | Session A: five 401s, then 429. A second session on the same account: 401 again. No `auth.mfa_failed` row | `mfa.test.ts` F3 (R8) ×2 |
| 4 | Client feed listed `provider: uploaded: SECRET draft return.pdf` for a deliverable missing from the client's document list | `authz.test.ts` F4 (R9) |
| 5 | `/documents/:id/download`: no `document.downloaded` row (the per-version route wrote one), the app-wide CSP instead of `sandbox`, and the row's type (`application/vnd.ms-excel`) for PDF bytes | `delivery.test.ts` F5 (R5) ×2 |
| 6 | Closed engagement: `/requests/:id/uploads` refused (400 `engagement_closed`), `/documents/:id/versions` took the file (202). Waive, reopen, edit, respond, accept and request a correction (line and ad-hoc) all answered 200 | `workflow.test.ts` F6 (R4) ×9 |
| 7 | Archiving the only file left the line `submitted` with 0 attachments shown; accept answered 200 and marked it `accepted` with 0 review rows. The re-scan half does not happen (see the correction under finding 7) | `workflow.test.ts` F7 (R2), F7 (R3) |
| 8 | Only the advisor's sign-in wrote `auth.login`. Reopening a line or an engagement, unarchiving, creating a reset link and editing a line or an engagement wrote nothing | `audit.test.ts` F8 ×5 |
| 9 | Confirmed from the code (`auth/passwords.ts:42` returns before bcrypt when there is no hash). Not timed: the tests hash at cost 4 | none yet; R8 adds one |
| 10 | 500 for a malformed id on `GET /clients/:id`, `POST /clients/:id/deactivate`, and `clientId`/`documentId` on messages, engagements and activities. `?limit=abc`: 200 with every row (see the correction) | `authz.test.ts` F10 (R9) ×3 |
| 11 | A client pinned a message to another firm's document: 201, stored. The same for another client's document in the same firm | `authz.test.ts` F11 (R9) |
| 12 | As reported by npm | none; R10 |
| S2 | A year filter missed a 2024 document behind 55 newer 2026 ones | `workflow.test.ts` S2 (R9) |
| S5 | Accepting a checklist file through `/documents/:id/accept` wrote a review and left the line `submitted` | `workflow.test.ts` S5 (R2) |

## What was checked and how it came out

| Check | Result |
|---|---|
| Frontend typecheck | passes |
| Frontend lint | 0 errors, 9 warnings (the known react-refresh baseline) |
| Frontend tests | 71 of 71 pass (12 files) |
| Frontend build | passes |
| Server typecheck | passes |
| Server tests | 976 of 976 pass (27 files), run alone on 2026-11-11; 1006 with R0's 30 `it.fails` rows |
| `npm audit --omit=dev` | frontend 9 advisories (3 high), server 9 (1 critical, 5 high) |

Not done: no browser walkthrough, no review of `server/src/admin.ts`, the ops
PowerShell scripts or the migrations.

## Overall

The server is carefully built. Tenant scoping goes through one set of loaders, cross-firm
ids answer 404, uploads are authorized before bytes are staged, nothing is served
unscanned, sessions are opaque and hashed, and the CSRF origin check sits in front of
every router. I found no way for one firm to read another firm's data and no way for a
client to read another client's.

The problems are narrower: one message that never reaches the client, an advisor
power with no record, a second-factor throttle that can be walked around, a feed that
tells the client more than the portal does, and several places where "closed" and
"audited" are enforced on one route and not on its sibling.

## Findings, most serious first

### 1. A correction on an ad-hoc upload tells the client nothing

`server/src/routes/documents.ts:118-175` (`decide`). When a client uses "Send something
else" and the advisor answers "request a correction" in the review workspace
(`src/components/docflow/review/ReviewActions.tsx:48-49` calls this route when there is
no checklist line), the server writes a review row and an audit row and stops. No
notification, no message in the thread, no email. The portal's "My documents" page
(`src/pages/portal/Documents.tsx`) shows no status for these files either. The advisor
believes they asked for a better copy; the client never hears.

This is the same defect as blocker 1 of the 2026-10-28 audit, on the path that fix did
not cover. The checklist path (`routes/requests.ts:143-154`) posts the note to the
thread and notifies; this one should do the same.

### 2. Any advisor can set a client's password, and nothing records it

`server/src/routes/clients.ts:209-263`. `PATCH /clients/:id` accepts `password` from any
advisor of the firm, owner or not. It ends the client's sessions and writes no audit
row (an email change on the same route is audited; the password is not). With
`POST /clients/:id/mfa-reset` (line 323, also any advisor) an advisor can then sign in
as the client and upload, withdraw, answer "I don't have this" or send messages in the
client's name.

No screen sends `password` on this route (`EditDetailsDialogs.tsx` says the password
stays as it is), so this is an API door the UI does not need. Remove `password` from
`updateClientSchema`, or keep it and audit it. `POST /clients` has the same optional
`password`. `POST /clients/:id/password-reset` (line 293) hands the reset link to the
advisor and also writes no audit row; the invitation route beside it does.

### 3. The wrong-code limit on the second step is per session, not per account

`server/src/security/limits.ts:86-94` keys `mfaVerifyLimiter` on the session cookie:
5 wrong codes per session. Someone who has a password gets a fresh session, and five
more guesses, by signing in again. Those sign-ins succeed, so the login limiters
(`skipSuccessfulRequests: true`, lines 30-51) never count them. What remains is the
global limit of 600 requests per 15 minutes per IP for cookie-less requests, which
allows about 3,000 code guesses per 15 minutes. With three valid codes in a million at
any moment, that is roughly an even chance of getting in within a day.

Also `auth.mfa_failed` is defined in `db/audit.ts` and never written, so failed
second-step attempts leave no trace.

Fix: count wrong codes per account (a counter on `mfa_totp`, or a limiter keyed on
user id) and write the audit row.

How much this matters depends on exposure. The API binds to 127.0.0.1 and the
deployment is this laptop, so today nobody outside the machine can reach it. It
becomes real the day the portal is put on the network.

### 4. The client's activity feed shows advisor-side lines

`server/src/routes/activities.ts:68-76`. A client calling `GET /api/activities` gets
every activity row for their client id, including lines the portal deliberately hides:

- `uploaded: <filename>` for a deliverable that has not been shared
  (`routes/uploads.ts:216-225`), although `scope.ts` says an unshared deliverable "does
  not exist as far as the client is concerned";
- `removed from the checklist: <title>`, although `routes/requests.ts:400-403` says
  nothing is said to the client about a removed line;
- waivers, reminders sent, and "Reassigned to … (was …)".

The portal screens do not call this endpoint, so it takes a client who looks at the
API. Filter the client's view to their own actions, or drop the client branch.

### 5. Downloads of shared returns are not in the audit log

`server/src/routes/documents.ts:399-457` (`GET /documents/:id/download`). This older
route writes no `document.downloaded` row, serves the recorded MIME type instead of the
sniffed one, and defaults to `inline`. The hardened per-version route in
`routes/versions.ts:91-152` does all three properly. The two places that matter most
use the old one: the client's "Shared with you" page (`src/pages/portal/Shared.tsx:48`)
and the advisor's deliverables list (`engagement/Deliverables.tsx:132`). So the log
cannot answer "did the client download their return?".

Fix: have the old route resolve the current version and call the same `deliver()`.

### 6. A closed engagement is only closed on some routes

Checked: `POST /requests/:id/uploads`, `POST /engagements/:id/uploads`,
`POST /engagements/:id/requests`, remove, restore, withdraw, remind.

Not checked:

- `POST /documents/:id/versions` (`routes/uploads.ts:450-477`). A client can add a new
  version to a file in a closed year. Once it scans clean, `resetRequest`
  (`workflow/publish.ts:202-220`) moves an accepted line back to `submitted`.
- `POST /requests/:id/accept`, `/request-correction`, `/waive`, `/reopen`,
  `PATCH /requests/:id`, and the client's `/respond`.

### 7. A line can be accepted with no file on it

`workflow/publish.ts:377`: `decidableVersions` answers "ok, nothing to decide" when the
line has no documents. `POST /requests/:id/accept` (`routes/requests.ts:228-271`) only
refuses lines in `requested` or `waived`. So if the advisor archives the only file on a
submitted line (`POST /documents/:id/archive` does not touch the line's status,
`routes/documents.ts:241-254`), the line stays `submitted`
with no attachment: the client is told it is with the accountant, the work queue lists
it with nothing to open, and "accept" succeeds with zero review rows. The client-side
withdraw already settles the line (`settleAfterWithdrawal`); archive should use the
same step, and accept should refuse an empty line.

*Correction (R3, 2026-11-12):* the draft also said "or a re-scan quarantines it". That
does not happen: `scan_retry` skips a version that is already clean, only a clean version
can be current, and a line only moves when a version is published. So a re-scan never
takes away the file a line is showing. A related case is real: archive the readable file
on a line whose other file the scanner refused, and the line stays `submitted` with
nothing to open, because the settle step counted the refused file as still there.

### 8. Gaps in the audit trail

- A client's successful sign-in is not recorded; an advisor's is
  (`routes/auth.ts:97-106` against `:140-144`).
- No row for: reopening a request (undoing an accept or a waiver,
  `routes/requests.ts:369-388`), reopening an engagement (`routes/engagements.ts`,
  `/:id/reopen`; closing is audited), un-archiving a document
  (`routes/documents.ts:256-274`), an advisor creating a client reset link, or any PATCH
  to a request, engagement, document or template.

### 9. Sign-in timing reveals whether an address has an account

`routes/auth.ts:87-88` and `:115-116` return before any bcrypt work when the address is
unknown, and `verifyPassword` returns at once for an account with no password yet. At
cost 12 the difference is around a quarter of a second, which undoes the care taken to
give identical answers. Compare against a fixed dummy hash when there is no account.

### 10. Malformed ids answer 500

No UUID check before the query on `GET /clients/:id` and every `/clients/:id/*` verb
(`routes/clients.ts:91-101`), `GET /messages?clientId=` and `?documentId=`
(`routes/messages.ts:13-38`), `GET /engagements?clientId=`
(`routes/engagements.ts`, list) and `GET /activities?clientId=`. Postgres refuses the
value and the error handler answers 500. No data is exposed; it is noise in the logs
and a wrong status. `scope.ts#isId` is already there.

**Corrected after the probe.** `?limit=abc` on activities does not answer 500, as the
draft said. `parseInt` gives `NaN`, the clamp at `routes/activities.ts:53-54` passes
`NaN` through, and drizzle leaves out a `LIMIT` that is not a number of 0 or more
(`drizzle-orm/pg-core/dialect.js:275`). So the caller gets every row: their whole
feed, past the 200 cap. Advisors get only their own firm's rows and clients only their
own, so nothing leaks, but the read has no upper bound. The fix in R9 is the same:
fall back to 50.

### 11. A message can be pinned to any document id

`routes/messages.ts:77-111`. `documentId` is not checked against the caller's scope, so
a client can attach a message to a document of another client or firm. The message
stays in their own thread, so nothing leaks; it is an integrity gap.

### 12. Dependencies

`npm audit --omit=dev`, as reported by npm (I have not verified the advisories
independently):

- Server: `multer` (high, the upload path), `nodemailer` (high), `body-parser` (high),
  `proxy-addr` (critical, only relevant with `TRUST_PROXY=1`, which is not set),
  `express`/`qs`, `ip-address`: all fixable with `npm audit fix`. `drizzle-orm` (high,
  SQL identifiers; the code builds no identifiers from input) and `zod` (high) need a
  major upgrade.
- Frontend: `react-router-dom` (moderate, needs v7), `zod` (high, needs v4), and build
  tooling (`brace-expansion`, `source-map-js`, `glob`, `minimatch`,
  `postcss-selector-parser`, `sucrase`) fixable with `npm audit fix`.

### Smaller things

Numbered S1 to S5 so the plan and the tests can name them.

- **S1.** The catch-all route renders the advisor layout with no guard
  (`src/App.tsx`, `path="*"`), so a client or a signed-out visitor on an unknown URL
  sees the advisor shell. (Read from the code; frontend, not probed.)
- **S2.** Search applies the year filter to documents after the 50-row limit
  (`routes/search.ts:66-78`), so matches beyond the first 50 are dropped. (Reproduced.)
- **S3.** `/api/ops/status` and job retry are open to every advisor, not only owners, and jobs
  are not scoped to a firm. Fine for one firm on one machine.
- **S4.** Still open from 2026-10-28: `in_review` is never set, no pagination on any list, the
  Documents year filter is a fixed five years, no season roll-forward, no e-sign.
- **S5.** `/documents/:id/accept` and `/request-correction` do not refuse a document that
  belongs to a checklist line, so a review can be written without moving the line.
  (Reproduced.)

## This laptop, as found

- `server/.env` has `NODE_ENV=development`; `DATA_ROOT` is unset, so documents live in
  `server/.data` inside the checkout.
- Nothing is listening on 3310. With no virus scanner running and `SCAN_REQUIRED`
  unset, a new upload is stored as "being checked" and can never be opened.
- `SMTP_URL` is set, so the worker sends real email whenever it runs.
- Dev database: 15 of 15 migrations applied, 1 firm, 2 advisors, 3 clients, 19 clean
  versions. No worker heartbeat row. Last good backup recorded 2026-10-29.
- PR #2 (`audit-fixes`) is still open; `whose-move-boards` is pushed with no PR.

## Suggested order

1. Finding 1 (correction on ad-hoc uploads), because a client is left waiting.
2. Findings 2 and 8 together: close the password door and fill the audit gaps.
3. Finding 5: one download path.
4. Findings 6 and 7: closed years and empty lines.
5. Finding 3 before the portal is ever reachable from another machine.
6. Finding 4, then `npm audit fix` on both packages, then 9 to 11.
