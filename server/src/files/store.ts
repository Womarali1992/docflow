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

/* --------------------------------------------------------------- staging */

/**
 * Where a multipart body lands before anyone has decided it is safe. Separate
 * from `files/` on purpose: nothing under `files/` has ever been unvalidated,
 * so a sweep of the staging directory can never touch a published document.
 */
export function stagingDir(): string {
  return process.env.STAGING_DIR ? path.resolve(process.env.STAGING_DIR) : path.join(dataRoot(), 'staging');
}

export function ensureStagingDir(): string {
  const dir = stagingDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A staged file's path. `.part` so a half-written upload is obvious on disk. */
export function stagedPath(id: string): string {
  return path.join(stagingDir(), `${id}.part`);
}

/** Deletes a staged file, swallowing "already gone". Never throws at the caller. */
export function discardStaged(absPath: string | null | undefined): void {
  if (!absPath) return;
  try {
    fs.unlinkSync(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.error('[files] could not remove staged file:', absPath, err);
    }
  }
}

/** Moves a staged file to its final key. Same volume, so this is a rename. */
export function commitStaged(stagedAbsPath: string, storageKey: string): void {
  const target = ensureKeyDir(storageKey);
  try {
    fs.renameSync(stagedAbsPath, target);
  } catch (err) {
    // Different volumes (DATA_ROOT and STAGING_DIR configured apart): copy then unlink.
    if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
      fs.copyFileSync(stagedAbsPath, target);
      fs.unlinkSync(stagedAbsPath);
      return;
    }
    throw err;
  }
}
