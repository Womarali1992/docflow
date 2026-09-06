/**
 * Operational status for the advisor (plan: Ops panel, `GET /ops/status`).
 *
 * v1 answers what C1.4 can actually observe: the job queue and whether a mail
 * server is configured. C5.2 grows this into the `/settings/system` panel
 * (storage, clamd, last backup, active sessions) — the shape is additive, so
 * the panel can be built against this route today.
 *
 * Advisor-only: a client has no business knowing the firm's queue depth.
 */
import { Router } from 'express';
import { authenticate, requireProvider } from '../middleware/auth.js';
import { queueStats } from '../jobs/queue.js';
import { isMailConfigured } from '../jobs/mail.js';

const router = Router();

router.use(authenticate);

router.get('/status', requireProvider, async (_req, res) => {
  const jobs = await queueStats();
  res.json({
    time: new Date().toISOString(),
    jobs,
    mail: {
      configured: isMailConfigured(),
      // What the advisor should do about it, rather than making them read the runbook.
      note: isMailConfigured()
        ? null
        : 'No mail server configured (SMTP_URL). Invitations and password resets are copy-link only.',
    },
  });
});

export default router;
