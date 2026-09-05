#!/usr/bin/env node
/**
 * Creates the docflow_test database used by `npm test`.
 *
 * Connects with PG_ADMIN_URL if set (a superuser, e.g.
 * postgres://postgres@localhost:5432/postgres), otherwise with DATABASE_URL
 * (the dev role, which then needs CREATEDB). The database is owned by the role
 * named in DATABASE_URL_TEST so the app can migrate it without extra privileges.
 *
 * Uses `pg` directly because psql is not on PATH on the dev machine.
 */
import 'dotenv/config';
import pg from 'pg';

const testUrl =
  process.env.DATABASE_URL_TEST || 'postgres://docflow:docflow_dev@localhost:5432/docflow_test';
const parsed = new URL(testUrl);
const dbName = parsed.pathname.replace(/^\//, '');
const owner = decodeURIComponent(parsed.username || 'docflow');
if (dbName !== 'docflow_test') {
  console.error(`Refusing: DATABASE_URL_TEST must name docflow_test (got "${dbName}")`);
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]*$/i.test(owner)) {
  console.error(`Refusing: unexpected role name "${owner}" in DATABASE_URL_TEST`);
  process.exit(1);
}

const adminUrl =
  process.env.PG_ADMIN_URL ||
  process.env.DATABASE_URL ||
  testUrl.replace(/\/docflow_test(\?|$)/, '/postgres$1');
const client = new pg.Client({ connectionString: adminUrl });

try {
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount) {
    console.log(`= ${dbName} already exists`);
  } else {
    await client.query(`CREATE DATABASE "${dbName}" OWNER "${owner}"`);
    console.log(`+ created ${dbName} (owner ${owner})`);
  }
} catch (err) {
  console.error(`Could not create ${dbName}: ${err instanceof Error ? err.message : err}`);
  console.error(
    `Either set PG_ADMIN_URL to a superuser connection string and rerun, or run as a superuser:\n` +
      `  CREATE DATABASE ${dbName} OWNER ${owner};`
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
