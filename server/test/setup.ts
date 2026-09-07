/**
 * Vitest setup — runs before every test file.
 *
 * Points the server at the docflow_test database (never the dev database), runs
 * the migrations once per file, and truncates every public table before each
 * test so tests are independent. Server modules are imported dynamically AFTER
 * the environment is set, because db/client.ts and storage.ts read it at import.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

const testUrl =
  process.env.DATABASE_URL_TEST || 'postgres://docflow:docflow_dev@localhost:5432/docflow_test';
if (!/\/docflow_test(\?|$)/.test(testUrl)) {
  throw new Error(
    `DATABASE_URL_TEST must name a database called docflow_test (got "${testUrl.replace(/:[^:@/]+@/, ':***@')}"). ` +
      'Refusing to run tests against it.'
  );
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.APP_BASE_URL = 'http://localhost:8080';
// The matrix alone makes ~1 000 requests from one IP; the limiters themselves are unit-tested in security.test.ts.
process.env.RATE_LIMIT_GLOBAL = '100000';
process.env.RATE_LIMIT_LOOKUP_IP = '100000';
// Fixtures hash passwords at cost 4; the same cost here keeps logins fast and stops the re-hash-on-login from firing.
process.env.PASSWORD_BCRYPT_COST = '4';
// Every document byte lives under DATA_ROOT; C5.4 removed the legacy uploads tree.
process.env.DATA_ROOT = path.join(here, '.data-tmp');
// No clamd on a dev box: uploads are stored and left `pending`, never claimed clean.
// The scanner's own paths are tested against a fake clamd on a real socket.
process.env.SCAN_REQUIRED = 'false';
delete process.env.ALLOW_PROVIDER_SIGNUP;
// No mail server in tests: the mailer must degrade to copy-link, and the email
// handler is exercised with an injected transport instead of a socket.
delete process.env.SMTP_URL;

const { db, pool } = await import('../src/db/client.js');
const { migrate } = await import('drizzle-orm/node-postgres/migrator');
const { sql } = await import('drizzle-orm');

let tableList: string | null = null;

beforeAll(async () => {
  // Windows holds directory handles briefly after the last file closes, so a
  // plain recursive delete intermittently throws ENOTEMPTY. Retrying is what
  // node exposes for exactly this.
  const wipe = (dir: string) => {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch (err) {
      // Best effort. Windows can hold a directory handle open after a crashed
      // run, and leftover files are harmless anyway: storage keys are UUIDs, so
      // nothing collides. What this hook must guarantee is a clean database,
      // which the TRUNCATE in beforeEach does.
      console.warn(`[setup] could not clear ${dir}: ${(err as Error).message}`);
    }
    fs.mkdirSync(dir, { recursive: true });
  };
  wipe(process.env.DATA_ROOT!);
  try {
    await migrate(db, { migrationsFolder: path.join(here, '..', 'migrations') });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not prepare the test database (${msg}). Create it once with: node scripts/create-test-db.mjs`
    );
  }
});

beforeEach(async () => {
  if (tableList === null) {
    const result = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    tableList = result.rows.map((r) => `"${String(r.table_name)}"`).join(', ');
  }
  if (tableList) {
    await db.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`));
  }
});

afterAll(async () => {
  await pool.end();
});
