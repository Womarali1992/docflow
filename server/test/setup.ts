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
process.env.UPLOADS_DIR = path.join(here, '.uploads-tmp');
delete process.env.ALLOW_PROVIDER_SIGNUP;
// No mail server in tests: the mailer must degrade to copy-link, and the email
// handler is exercised with an injected transport instead of a socket.
delete process.env.SMTP_URL;

const { db, pool } = await import('../src/db/client.js');
const { migrate } = await import('drizzle-orm/node-postgres/migrator');
const { sql } = await import('drizzle-orm');

let tableList: string | null = null;

beforeAll(async () => {
  fs.rmSync(process.env.UPLOADS_DIR!, { recursive: true, force: true });
  fs.mkdirSync(process.env.UPLOADS_DIR!, { recursive: true });
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
