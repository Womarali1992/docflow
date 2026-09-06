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
import { clamdHost, clamdPort, ping, scanRequired } from '../files/scan.js';

const router = Router();

router.use(authenticate);

router.get('/status', requireProvider, async (_req, res) => {
  const [jobs, clamdUp] = await Promise.all([queueStats(), scanRequired() ? ping() : Promise.resolve(false)]);
  res.json({
    time: new Date().toISOString(),
    jobs,
    scanner: {
      required: scanRequired(),
      reachable: clamdUp,
      endpoint: `${clamdHost()}:${clamdPort()}`,
      note: scanRequired()
        ? clamdUp
          ? null
          : 'The virus scanner is not answering. Uploads are still accepted and stored, but stay unreadable until it is back.'
        : 'Scanning is switched off (SCAN_REQUIRED=false). Uploads are stored but never marked clean.',
    },
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
