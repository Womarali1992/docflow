# Audit evidence — 2026-09-07, at `705cdbd`

What an independent review of DocFlow actually ran, and what it found. The
conclusions and the plan built on them are in
[`../DOCFLOW-AUDIT-AND-IMPLEMENTATION-PLAN.md`](../DOCFLOW-AUDIT-AND-IMPLEMENTATION-PLAN.md);
this folder is the raw material behind them, kept so nobody has to take the
write-up's word for anything.

**These probes assert the defects, not the fix.** `2026-09-07-probes.mts` and
`upload-queue.probe.test.tsx` pass *because* the bugs are there — they are
reproductions, and they would start failing the moment a fix landed. That is the
right shape for evidence and the wrong shape for a test suite, so the live form
of the same eight cases is `server/test/hardening.test.ts`, where each is an
`it.fails(...)` row asserting the **correct** behaviour. Each fix commit flips
its own rows to `it(...)`; when no `it.fails` rows are left, the hardening
release is finished. The frontend pair lives in
`src/components/upload/useUploadQueue.orchestration.test.tsx`.

Nothing here is wired into either suite: the probes run standalone against a
throwaway schema in `docflow_test`, and this folder is not on any vitest include
path. They are kept runnable, not run.

| File | What it is |
|---|---|
| `2026-09-07-probes.mts` | The server reproductions: concurrent TOTP consumption, eight concurrent versions, an out-of-order clean scan, an accepted request replaced during a scanner outage, accepting a superseded version, four concurrent first uploads, a refused upload's leftover document row. Creates its own `docflow_audit_<ts>` schema and drops it again. |
| `2026-09-07-probe-results.json` | What that run printed. Two `ok` from one authenticator code; 4 of 8 versions lost to `23505`; the document pointer moved backwards; a replacement published without reopening the review; a superseded version accepted with a 200; two of four uploads answered 500; one orphan document row per refused upload. |
| `upload-queue.probe.test.tsx` + `vitest.config.mts` | The browser reproductions: a file added mid-upload stays `queued` forever, and a cancelled file is uploaded anyway. Run with `npx vitest run --config docs/audit/vitest.config.mts`. |
| `upload-queue-results.json` | That run's JSON reporter output. |
| `server-dependencies.json`, `frontend-dependencies.json`, `*-production-dependencies.json` | `npm audit --json` for both trees, full and production-only, as of the audit date. The `file-type` advisory (F1) comes from here. |
| `verification-summary.json` | The state of the whole system on the day: test totals, lint and build results, migrations applied (8, last `0007_workflow_model`, `0008_contract` pending), integrity and redundancy counts, SMTP, and what was *not* verified. |

`scratch-data/` (gitignored) holds fixture bytes the probes wrote. It can be
deleted at any time.

A caveat the summary records and this file repeats, because it is the kind of
thing that gets forgotten: **the real-ClamAV test returns successfully without
asserting anything when no scanner answers**, so "660 passed" on this laptop does
not mean the infected path was exercised against a genuine scanner.
