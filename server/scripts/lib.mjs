/**
 * Shared helpers for the operational scripts in this folder. Every script loads
 * server/.env relative to its own location, so they work from any cwd (the
 * PowerShell backup/restore scripts call them from the repo root).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createDecipheriv, createHash } from 'node:crypto';
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

/* --------------------------------------------------------- secrets at rest */

/* The same wire format as src/auth/crypto.ts: AES-256-GCM under
   APP_ENCRYPTION_KEY, `v1:<iv>:<tag>:<ciphertext>` in base64url, and the same
   fixed development key when no key is set outside production. It is mirrored
   here rather than imported because these scripts are plain .mjs and crypto.ts
   is TypeScript; a test decrypts a secret the server encrypted, so the two
   cannot drift apart quietly. */
const DEV_KEY_SEED = 'docflow-dev-encryption-key-not-for-production';

/** The 32-byte key the server would use, or a thrown explanation. */
export function encryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') throw new Error('APP_ENCRYPTION_KEY is not set');
    return createHash('sha256').update(DEV_KEY_SEED).digest();
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32) throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or base64)');
  return bytes;
}

/** Throws on a wrong key, a tampered payload or an unknown format. */
export function decryptSecret(encoded, key = encryptionKey()) {
  const [version, ivB64, tagB64, ctB64] = String(encoded).split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('Unrecognized encrypted secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}

/** True when the given module is the one Node was started with (CLI mode). */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  return path.resolve(fileURLToPath(metaUrl)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase();
}

export { pathToFileURL };
