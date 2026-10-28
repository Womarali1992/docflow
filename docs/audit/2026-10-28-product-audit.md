# DocFlow product audit — 2026-10-28

Scope: does the app make sense, can people use it, does it work, does it add value.
Method: three code reviews (advisor screens, client portal + sign-in, backend domain model)
plus a hands-on walkthrough of the running app as the demo advisor and the demo client.
Every finding below was verified in code or on screen; the ones marked **seen** were
reproduced in the browser.

## Verdict

The spine is right and better than most portals: engagement per client per year, checklist
from a template, immutable versions, accept / correct / waive with reasons, virus-scanned
uploads that are unreadable until clean, deliverables private until shared, MFA for everyone,
a season-end zip. The client portal's home page ("Your next steps", ordered by urgency, plain
words) is the best screen in the product.

What stops it being usable by a real firm is not polish. It is four things:

1. The one message the client most needs (why their file was rejected) never reaches them.
2. Nothing ever emails anyone about workflow events, so clients must log in daily to find out.
3. Reminders only fire for lines with a due date, and nothing sets one by default.
4. The product is single-advisor: no staff, no reassignment, no second pair of hands.

## Blocking defects (fix before any pilot)

1. **Correction note never reaches the client (seen).** The portal card says "their note is
   in the messages for this item" (`src/lib/requestState.ts:46`). The note is stored in
   `reviews.note`; no message is created, and the portal never fetches reviews. On screen: the
   1098 item said "Needs another look", the thread was empty, and the actual note ("This is
   the December statement rather than the annual 1098…") exists only in the database.
2. **No event emails.** `enqueueEmail` is called only for invitations, password resets and
   the daily reminder (`server/src/routes/auth.ts:274,287`, `routes/clients.ts:258,278`,
   `jobs/handlers/reminders.ts:115`). The `new_item` mail template is defined but never
   queued. Clients are not emailed when a checklist is created, a correction is requested or
   a return is shared; advisors are not emailed about uploads or messages.
3. **Reminders are effectively off.** Only requests with `dueDate` qualify
   (`reminders.ts:76-83`); due dates are optional everywhere and the demo checklist shows
   "no due date" on 8 of 10 lines. Yet the Required checkbox says "the client is chased for
   it" (`ChecklistItem.tsx:140`). No manual "remind now", no bulk nudge.
4. **Quarantined files vanish into "Being checked" forever.** `scan_retry.ts` quarantines
   and notifies nobody; the card keeps saying "nothing more to do". A version stranded by the
   sweeper needs psql to recover.
5. **Any server error reads as "not on your file" (seen).** `Engagement.tsx:60-64` and
   `Review.tsx:72-80` show the 404 wording for every error. With two migrations unapplied the
   engagement page 500'd and the advisor was told the engagement was not theirs.
6. **MFA lockout has no self-service or advisor-side recovery.** Only
   `npm run admin -- reset-mfa` on the server console. The demo client already shows
   "0 of 10 unused" recovery codes.

## Things that would confuse or embarrass in a demo

- Breadcrumb reads **"Not found"** on `/work` and `/review/*` (seen; `Topbar.tsx:34-54`).
- Activity feed "View" buttons route accept/correct/waive events to `/documents/<request id>`
  and land on "That document is not on your file" (`ActivityFeed.tsx:21-25` vs
  `routes/requests.ts:238-333`).
- Floating **"Tweaks"** theme/density bar on every advisor and client screen
  (`Layout.tsx:45`, `ClientLayout.tsx:43`).
- New-client form asks for **"Plan: Core / Wealth Tier" and "AUM"**, never shown again
  (`NewClientDialog.tsx:106-117`); sidebar hard-codes "CPA · v3.2".
- Login defaults to **Advisor**; clients who miss the toggle get a bare refusal (`Login.tsx:20`).
- "⌘↵ to send" shown on Windows (`MessagesPanel.tsx:40`); failed sends lose the text.
- Demo data: advisor and client are both "Sarah Johnson", so the message thread is unreadable;
  "Imported documents" engagements and "Activity smoke test request" are visible to the client.
- Waiver reasons written for the file ("confirmed by phone on the 3rd") are shown to the client.
- Work queue rows show title + client only: no engagement, no upload date, no due date.
- Review workspace has no next/previous; 30 items means 30 round trips.

## Model gaps a firm would hit in week one

- **Single advisor = tenant.** No staff, preparer/reviewer split, client assignment or
  reassignment; a client email is globally unique so a second advisor cannot even add them.
- **Cannot edit a client or engagement from the UI** although PATCH routes and hooks exist.
- **Cannot cancel a checklist line** without waiving with a client-visible reason; client
  cannot remove a mistaken upload.
- **Closed engagements leak**: reminders and the dashboard never check engagement status, and
  `POST /requests/:id/uploads` accepts uploads into a closed year.
- **No season**: no "start 2026 for everyone", no roll-forward of last year's checklist, no
  extension state, no engagement-level due date.
- **No e-sign / acknowledge** on a deliverable (8879), no K-1 fan-out, no "client opened the
  return" signal (audit log is written but has no reader).
- `in_review` status is never set; `requests.archivedAt`, `engagements.archivedAt` have no
  writers; the Documents year filter is hard-coded to 5 years; no pagination anywhere.

## What genuinely adds value

Checklist with per-line state and an immutable version trail; "I don't have this" with a
recorded answer; one server-counted "whose move is it" queue with keyboard decisions; scan /
quota / private-until-shared discipline; season-end export with a sha256 manifest; per-file
plain-English upload refusals and idempotent retries; camera capture on phones.

## Environment note

The local database was two migrations behind (`0009_upload_id`, `0010_worker_heartbeats`);
applied during this audit so the app would run.
