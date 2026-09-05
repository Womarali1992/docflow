#!/usr/bin/env node
/**
 * Creates (or with --drop, recreates) a scratch database — docflow_test or a
 * docflow_restore* database. Refuses any other name so it can never touch the
 * live database.
 *
 *   node scripts/create-db.mjs --name docflow_restore [--owner docflow] [--drop]
 *
 * Connects with PG_ADMIN_URL if set (a superuser, e.g.
 * postgres://postgres@localhost:5432/postgres), otherwise with DATABASE_URL
 * (the dev role, which then needs CREATEDB). Uses `pg` directly because psql
 * is not on PATH on the dev machine.
 */
import pg from 'pg';
import { argValue, dbUserOf, hasFlag, isMain } from './lib.mjs';

const ALLOWED = /^docflow_(test|restore)[a-z0-9_]*$/;
const ROLE = /^[a-z_][a-z0-9_]*$/i;

export async function ensureDatabase({ name, owner, adminUrl, drop = false }) {
  if (!ALLOWED.test(name)) throw new Error(`Refusing to create "${name}": only docflow_test / docflow_restore* are allowed`);
  if (!ROLE.test(owner)) throw new Error(`Unexpected role name "${owner}"`);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const exists = async () =>
      (await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount > 0;
    if (await exists()) {
      if (!drop) return { name, created: false, dropped: false };
      await client.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [name]
      );
      await client.query(`DROP DATABASE "${name}"`);
      await client.query(`CREATE DATABASE "${name}" OWNER "${owner}"`);
      return { name, created: true, dropped: true };
    }
    await client.query(`CREATE DATABASE "${name}" OWNER "${owner}"`);
    return { name, created: true, dropped: false };
  } finally {
    await client.end();
  }
}

export function adminUrlFromEnv() {
  return process.env.PG_ADMIN_URL || process.env.DATABASE_URL;
}

if (isMain(import.meta.url)) {
  const name = argValue('--name');
  if (!name) {
    console.error('usage: node scripts/create-db.mjs --name <docflow_test|docflow_restore...> [--owner role] [--drop]');
    process.exit(2);
  }
  const owner = argValue('--owner') || (process.env.DATABASE_URL ? dbUserOf(process.env.DATABASE_URL) : 'docflow');
  const adminUrl = adminUrlFromEnv();
  if (!adminUrl) {
    console.error('Set PG_ADMIN_URL (superuser) or DATABASE_URL');
    process.exit(2);
  }
  try {
    const r = await ensureDatabase({ name, owner, adminUrl, drop: hasFlag('--drop') });
    console.log(r.created ? `+ created ${name} (owner ${owner})${r.dropped ? ' after dropping the old one' : ''}` : `= ${name} already exists`);
  } catch (err) {
    console.error(`Could not create ${name}: ${err instanceof Error ? err.message : err}`);
    console.error(
      `Either set PG_ADMIN_URL to a superuser connection string and rerun, or run as a superuser:\n` +
        `  CREATE DATABASE ${name} OWNER ${owner};`
    );
    process.exitCode = 1;
  }
}
