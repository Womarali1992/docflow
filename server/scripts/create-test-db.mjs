#!/usr/bin/env node
/**
 * Creates the docflow_test database used by `npm test`. Thin wrapper over
 * create-db.mjs that takes the name and owner from DATABASE_URL_TEST.
 *
 * Connects with PG_ADMIN_URL if set (a superuser), otherwise with DATABASE_URL
 * (the dev role, which then needs CREATEDB).
 */
import { dbNameOf, dbUserOf } from './lib.mjs';
import { adminUrlFromEnv, ensureDatabase } from './create-db.mjs';

const testUrl =
  process.env.DATABASE_URL_TEST || 'postgres://docflow:docflow_dev@localhost:5432/docflow_test';
const name = dbNameOf(testUrl);
if (name !== 'docflow_test') {
  console.error(`Refusing: DATABASE_URL_TEST must name docflow_test (got "${name}")`);
  process.exit(1);
}
const owner = dbUserOf(testUrl) || 'docflow';
const adminUrl = adminUrlFromEnv() || testUrl.replace(/\/docflow_test(\?|$)/, '/postgres$1');

try {
  const r = await ensureDatabase({ name, owner, adminUrl });
  console.log(r.created ? `+ created ${name} (owner ${owner})` : `= ${name} already exists`);
} catch (err) {
  console.error(`Could not create ${name}: ${err instanceof Error ? err.message : err}`);
  console.error(
    `Either set PG_ADMIN_URL to a superuser connection string and rerun, or run as a superuser:\n` +
      `  CREATE DATABASE ${name} OWNER ${owner};`
  );
  process.exitCode = 1;
}
