/**
 * What production refuses to start without.
 *
 * The audit's F7 is really two problems wearing one number. The first is the
 * bind address, which `index.ts` now fixes. The second is subtler and worse: a
 * production process that starts happily with `DATA_ROOT` unset writes client
 * documents into `server/.data` — inside the checkout, inside whatever syncs the
 * checkout — and nothing says a word until someone goes looking for the files.
 *
 * The rule here is that a misconfiguration that would quietly lose or expose
 * documents must stop the process at boot, when it is one line in a console, not
 * at 4 p.m. on a filing deadline. Every problem is listed in one message rather
 * than one-at-a-time, because fixing five .env lines across five restarts is how
 * people give up and set NODE_ENV=development.
 *
 * Development and test are untouched: this runs only when NODE_ENV is
 * `production`, and the defaults that make a laptop pleasant stay defaults.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `<repo>/server/src/config` → `<repo>`. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface ConfigProblem {
  key: string;
  problem: string;
}

/** `true` when `child` is inside `parent` (or is `parent`). */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Every production configuration problem, in the order they should be fixed.
 * Empty means the process may start.
 */
export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const add = (key: string, problem: string) => problems.push({ key, problem });

  const dataRoot = (env.DATA_ROOT || '').trim();
  if (!dataRoot) {
    add('DATA_ROOT', 'is not set, so documents would be written inside the checkout (server/.data). Point it at the encrypted data volume.');
  } else if (isInside(repoRoot, path.resolve(dataRoot))) {
    add('DATA_ROOT', `resolves to ${path.resolve(dataRoot)}, which is inside the checkout (${repoRoot}). Documents must live outside the repository.`);
  }

  const key = (env.APP_ENCRYPTION_KEY || '').trim();
  if (!key) {
    add('APP_ENCRYPTION_KEY', 'is not set. In production the development key is refused, and without it no authenticator secret can be read.');
  } else if (decodedKeyLength(key) !== 32) {
    add('APP_ENCRYPTION_KEY', 'must decode to exactly 32 bytes (64 hex characters, or 32 bytes of base64).');
  }

  // The same pair `appOrigin()` reads, in the same order — a validator that
  // accepted something the origin check would reject is worse than none.
  const baseUrl = (env.APP_BASE_URL || env.CORS_ORIGIN || '').trim();
  if (!baseUrl) {
    add('APP_BASE_URL', 'is not set. Every non-GET request is checked against it, and invitation links are built from it.');
  } else if (!parsesAsHttpUrl(baseUrl)) {
    add('APP_BASE_URL', `is not a URL (${baseUrl}). Use the full origin, e.g. https://docs.yourfirm.com.`);
  }

  if ((env.SCAN_REQUIRED || '').trim().toLowerCase() === 'false') {
    add('SCAN_REQUIRED', 'is set to false, which production ignores: nothing is published unless a scanner said it was clean. Remove the line so it does not read as a setting that works.');
  }

  const smtp = (env.SMTP_URL || '').trim();
  if (smtp && !parsesAsUrl(smtp)) {
    add('SMTP_URL', 'is set but does not parse as a URL. Percent-encode the @ in the username and any special characters in the password.');
  }

  return problems;
}

function decodedKeyLength(value: string): number {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return 32;
  try {
    return Buffer.from(value, 'base64').length;
  } catch {
    return -1;
  }
}

function parsesAsUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function parsesAsHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Called by `index.ts` and `worker.ts` at startup. Outside production it does
 * nothing; in production it prints every problem and exits 1.
 */
export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if ((env.NODE_ENV || '').trim() !== 'production') return;
  const problems = productionConfigProblems(env);
  if (problems.length === 0) return;
  console.error(`\nDocFlow cannot start in production: ${problems.length} configuration problem${problems.length === 1 ? '' : 's'}.\n`);
  for (const { key, problem } of problems) console.error(`  ${key} ${problem}`);
  console.error('\nFix these in server/.env (see .env.example) and start again.\n');
  process.exit(1);
}

/**
 * The address the API binds to. Loopback unless told otherwise (invariant 24).
 *
 * `app.listen(PORT)` with no host binds every interface, which on a laptop that
 * joins coffee-shop and client wifi means the API — and every session cookie
 * crossing it — is reachable from the network the moment the machine is on one.
 * Nothing about this deployment needs that: the browser and the server are the
 * same machine. Anything else has to ask for it by name.
 */
export function bindHost(env: NodeJS.ProcessEnv = process.env): string {
  return (env.HOST || '').trim() || '127.0.0.1';
}
