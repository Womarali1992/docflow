/**
 * Re-scan a quarantined version after the scanner was unavailable (plan: R6 —
 * scanner down means quarantined-and-retried, never published, never rejected).
 *
 * Stub until C2.3 introduces `document_versions` and the ClamAV client. The job
 * type exists now so the queue, the worker service and the ops panel are already
 * wired when the upload pipeline lands, and so a job queued by an older build
 * cannot crash a newer worker.
 */
import type { Job } from '../../db/schema.js';

export async function scanRetryJob(job: Job): Promise<void> {
  console.log(`[worker] scan_retry ${job.id}: no scanner wired yet (C2.3); nothing to do`);
}

export default scanRetryJob;
