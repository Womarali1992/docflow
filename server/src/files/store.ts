/**
 * Where document bytes live (invariant 11: data outside the repo).
 *
 * `DATA_ROOT` is the encrypted data volume on the firm PC. Everything a version
 * points at is `files/yyyy/mm/<uuid>.<ext>` underneath it, and those bytes are
 * immutable — a replacement is a new version with a new key, never an overwrite
 * (invariant 2). The legacy `server/uploads/` tree stays exactly where it is
 * until C5.4; nothing new is ever written there.
 *
 * C2.1 needs only enough of this to let the import place files. C2.3 adds
 * staging, validation, scanning and publishing beside it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Dev default: `server/.data` (gitignored). Production must say where the volume is. */
export function dataRoot(): string {
  const configured = process.env.DATA_ROOT;
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATA_ROOT must be set in production (the encrypted data volume holding files/ and staging/).');
  }
  return path.resolve(process.cwd(), '.data');
}

export function filesDir(): string {
  return path.join(dataRoot(), 'files');
}

/**
 * A fresh key for a version: `files/yyyy/mm/<uuid>.<ext>`, bucketed by month so
 * no single directory grows without bound. Always forward slashes — the key is
 * stored in the database and must not carry Windows separators.
 */
export function newStorageKey(when: Date, ext: string): string {
  const yyyy = String(when.getUTCFullYear());
  const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
  const safeExt = /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : 'bin';
  return `files/${yyyy}/${mm}/${randomUUID()}.${safeExt}`;
}

/**
 * Resolves a storage key to an absolute path, refusing anything that would
 * escape `DATA_ROOT` — keys come from the database, and a traversal there must
 * not become a read anywhere on disk.
 */
export function absPathForKey(storageKey: string): string {
  const root = dataRoot();
  const abs = path.resolve(root, storageKey);
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  return abs;
}

/** Creates the directory a key lives in and returns its absolute path. */
export function ensureKeyDir(storageKey: string): string {
  const abs = absPathForKey(storageKey);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

/** Extension for a filename, without the dot; '' when there is none worth keeping. */
export function extOf(filename: string): string {
  const ext = path.extname(filename).replace(/^\./, '');
  return /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : '';
}
