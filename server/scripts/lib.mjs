/**
 * Shared helpers for the operational scripts in this folder. Every script loads
 * server/.env relative to its own location, so they work from any cwd (the
 * PowerShell backup/restore scripts call them from the repo root).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

export const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(serverDir, '.env') });

/** `--name value` style argument, or undefined. */
export function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

export function hasFlag(name) {
  return process.argv.includes(name);
}

/** The database to operate on: `--url` wins, then DATABASE_URL from the environment / .env. */
export function databaseUrl() {
  const url = argValue('--url') || process.env.DATABASE_URL;
  if (!url) throw new Error('No database URL: pass --url or set DATABASE_URL');
  return url;
}

export function dbNameOf(url) {
  return new URL(url).pathname.replace(/^\//, '');
}

export function dbUserOf(url) {
  return decodeURIComponent(new URL(url).username || '');
}

/** Same connection, different database name (credentials kept as encoded). */
export function withDbName(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export function redact(url) {
  return url.replace(/:[^:@/]+@/, ':***@');
}

export function sha256File(absPath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(absPath));
  return hash.digest('hex');
}

/** True when the given module is the one Node was started with (CLI mode). */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  return path.resolve(fileURLToPath(metaUrl)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase();
}

export { pathToFileURL };
