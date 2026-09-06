/**
 * Hourly cleanup of staged uploads that never became versions — the backstop
 * for a multer `.part` file left behind by a rejected upload (plan: upload
 * pipeline, "Sweeper job hourly: staged files older than 1 h").
 *
 * Stub until C2.3 creates the staging directory. Deliberately never touches
 * anything under `files/` — published bytes are immutable (invariant 2).
 */
import type { Job } from '../../db/schema.js';

export async function sweeperJob(job: Job): Promise<void> {
  console.log(`[worker] sweeper ${job.id}: no staging directory yet (C2.3); nothing to do`);
}

export default sweeperJob;
