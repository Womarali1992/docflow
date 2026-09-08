/**
 * The daily problems digest (H7).
 *
 * A dashboard only helps while somebody is looking at it, and on a laptop
 * deployment nobody is. The audit's point stands: the failure modes that matter
 * — a stopped worker, a backup that quietly stopped running, a disk filling —
 * are all *silent*, and the panel that would show them is a page an accountant
 * opens when something already feels wrong.
 *
 * So once a firm-local morning, this asks `collectOpsStatus()` the same
 * questions the panel asks and emails the answers **only if any of them are
 * bad**. That restraint is the design. A daily "everything is fine" becomes a
 * filter rule inside a fortnight, and the one morning it says something else it
 * is already in a folder nobody opens.
 *
 * The body is counts and sentences: no client names, no filenames, no document
 * titles. An inbox is not the portal, and this one is about the machine anyway.
 */
import { and, isNull } from 'drizzle-orm';
import { db, schema } from '../../db/client.js';
import type { Job } from '../../db/schema.js';
import { collectOpsStatus, opsProblems } from '../../ops/status.js';
import { queueEmail } from '../mail.js';
import { firmDate } from '../schedule.js';

export interface DigestResult {
  date: string;
  problems: string[];
  /** Advisors the notice was queued for; zero when there is nothing to report. */
  recipients: number;
  emailsQueued: number;
}

/** Every advisor who could still sign in. A deactivated one is not on call. */
async function advisors(): Promise<{ id: string; email: string; firmName: string | null }[]> {
  return db
    .select({ id: schema.providers.id, email: schema.providers.email, firmName: schema.providers.firmName })
    .from(schema.providers)
    .where(and(isNull(schema.providers.deactivatedAt)));
}

export async function runOpsDigest(options: { today?: string } = {}): Promise<DigestResult> {
  /* The day is passed in, never derived here: a job that ran late still reports
     for the day it was scheduled for, and the dedupe key stays meaningful. */
  const date = options.today ?? firmDate(new Date());

  const status = await collectOpsStatus();
  const problems = opsProblems(status);
  if (problems.length === 0) return { date, problems, recipients: 0, emailsQueued: 0 };

  const to = await advisors();
  let emailsQueued = 0;
  for (const advisor of to) {
    /* `queueEmail`, not `enqueueEmail`: the count has to be what this run
       actually queued. The dedupe key already stops a retried digest job from
       sending twice, and a return value that could not see the difference would
       report two notices sent when none were. */
    const row = await queueEmail(
      {
        template: 'ops_digest',
        to: advisor.email,
        firmName: advisor.firmName ?? undefined,
        items: problems,
      },
      { dedupeKey: `ops_digest:${date}:${advisor.id}` }
    );
    if (row) emailsQueued++;
  }

  return { date, problems, recipients: to.length, emailsQueued };
}

export async function opsDigestJob(job: Job): Promise<DigestResult> {
  const payload = (job.payload ?? {}) as { date?: unknown };
  return runOpsDigest({ today: typeof payload.date === 'string' ? payload.date : undefined });
}

export default opsDigestJob;
