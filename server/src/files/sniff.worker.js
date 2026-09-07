/**
 * The thread that parses untrusted bytes, so the event loop never has to.
 *
 * Deliberately plain JavaScript in a strict-TypeScript tree: `node` has to be
 * able to start this file directly from `src/` (under tsx and vitest, where no
 * `dist` exists) and from `dist/` (in production), with no loader flag and no
 * conditional path. `allowJs` in tsconfig.json copies it into the build, so
 * `./sniff.worker.js` resolves next to `sniff.js`/`sniff.ts` in both trees.
 *
 * It does exactly one thing and then exits. If `fileTypeFromBuffer` never comes
 * back — F1, the reason this file exists — the parent's timeout terminates the
 * thread and no message is ever posted.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { fileTypeFromBuffer } from 'file-type';

try {
  const type = await fileTypeFromBuffer(workerData);
  parentPort.postMessage({ ok: true, type: type ? { mime: type.mime, ext: type.ext } : null });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
