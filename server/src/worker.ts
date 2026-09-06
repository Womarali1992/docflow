/**
 * The worker service entry point: `npm run worker` in development, and
 * `node dist/worker.js` under the `docflow-worker` Windows service from C5.3.
 *
 * Separate from the API on purpose — a mail server that stops answering must
 * slow nothing down for the advisor or the client, and the API can restart
 * mid-send without losing the job (the queue is the database).
 */
import 'dotenv/config';
import { pool } from './db/client.js';
import { isMailConfigured } from './jobs/mail.js';
import { POLL_INTERVAL_MS, startWorker } from './jobs/worker.js';

const worker = startWorker();

console.log(`docflow worker ${worker.workerId} started (polling every ${POLL_INTERVAL_MS} ms)`);
if (!isMailConfigured()) {
  console.log('SMTP_URL is not set: email jobs will be skipped and invitations/resets stay copy-link only.');
}

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\ndocflow worker stopping (${signal})…`);
    // Let the job in flight finish so it is not counted as a failed attempt.
    void worker
      .stop()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}
