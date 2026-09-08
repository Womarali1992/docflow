/**
 * Operational status for the advisor — the `/settings/system` panel (C5.2, H7).
 *
 * One screen that answers the questions an operator of a single firm PC
 * actually has, in the order they matter:
 *
 *   Did the backup run?      — the only one that cannot be recovered from later.
 *   Is the worker running?   — while it is not, nothing queued happens at all.
 *   Is the scanner working?  — while it is down, uploads arrive but stay closed.
 *   Is the disk filling?     — the failure that takes everything else with it.
 *   Is anything stuck?       — failed jobs, and versions that never published.
 *   Who is signed in?        — sessions, so a forgotten one can be noticed.
 *   What is even running?    — the commit, the node, the migrations applied.
 *
 * The answers themselves live in `ops/status.ts`, because the daily digest job
 * has to reach exactly the same conclusions by email (H7) and two copies of
 * "is this backup too old" would eventually disagree.
 *
 * Advisor-only: a client has no business knowing the firm's disk usage. Nothing
 * here names a document or a client — it is counts and timestamps, so the panel
 * can be left open on a screen in a shared office.
 */
import { asyncRouter } from './async-router.js';
import { db } from '../db/client.js';
import { auditRequest } from '../db/audit.js';
import { authenticate, requireProvider } from '../middleware/auth.js';
import { retryJob } from '../jobs/queue.js';
import { collectOpsStatus } from '../ops/status.js';

const router = asyncRouter();

router.use(authenticate);

/** Postgres refuses a malformed uuid with a 22P02; a bad id is a 404, never a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/status', requireProvider, async (req, res) => {
  res.json(await collectOpsStatus(req.auth!.sub));
});

/**
 * Put a failed job back in the queue.
 *
 * Until now a failed job was a red number that stayed red: the panel said "3
 * failed" and the only way to act on it was psql. Most of them are one email
 * sent while the mail password was wrong, and the fix — set it, retry — should
 * not require a database client.
 *
 * Deliberately narrow. Only a job whose attempts are spent can be retried;
 * anything still in flight or still due to run on its own answers 409, because
 * resetting a row under a running worker is how a notice gets sent twice. The
 * error text is kept, so the second failure does not masquerade as the first.
 */
router.post('/jobs/:id/retry', requireProvider, async (req, res) => {
  const { id } = req.params;
  if (!UUID.test(id)) return res.status(404).json({ error: 'Job not found' });

  const outcome = await db.transaction(async (tx) => {
    const result = await retryJob(id, tx);
    if (result.ok) {
      /* Inside the transaction: a job that was reset with no record of who did
         it is exactly the thing an append-only log exists to prevent. */
      await auditRequest(req, { action: 'job.retried', targetType: 'job', targetId: id, meta: { type: result.job.type } }, tx);
    }
    return result;
  });

  if (!outcome.ok) {
    if (outcome.reason === 'not_found') return res.status(404).json({ error: 'Job not found' });
    return res.status(409).json({
      code: 'not_failed',
      error: 'That job has not failed — it is either finished or still due to run on its own.',
    });
  }
  res.json({ ok: true, job: outcome.job });
});

export default router;
