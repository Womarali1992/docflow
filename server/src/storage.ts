import fs from 'node:fs';
import path from 'node:path';

/**
 * Local-disk file storage for uploaded documents.
 * Files live under UPLOADS_DIR (gitignored). Downloads are served only through
 * the authenticated GET /api/documents/:id/download endpoint — never statically.
 */

// cwd is expected to be the server/ package root (npm scripts + migrate rely on this).
export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(process.cwd(), 'uploads');

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/** Accepted MIME types → canonical file extension. */
export const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

export function isAllowedMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME, mime);
}

export function extForMime(mime: string): string {
  return ALLOWED_MIME[mime] ?? 'bin';
}

export function ensureUploadsDir(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/** Human-readable byte size, e.g. 1258291 → "1.2 MB". */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** Canonical on-disk filename for a document. */
export function storedFileName(docId: string, mime: string): string {
  return `${docId}.${extForMime(mime)}`;
}

/**
 * Resolve a stored path to an absolute path inside UPLOADS_DIR, rejecting any
 * value that would escape the uploads directory (path-traversal safe).
 */
export function absPathFor(storagePath: string): string {
  const abs = path.resolve(UPLOADS_DIR, storagePath);
  const rel = path.relative(UPLOADS_DIR, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid storage path');
  }
  return abs;
}

export async function writeStoredFile(fileName: string, buf: Buffer): Promise<void> {
  ensureUploadsDir();
  await fs.promises.writeFile(absPathFor(fileName), buf);
}

export function writeStoredFileSync(fileName: string, buf: Buffer): void {
  ensureUploadsDir();
  fs.writeFileSync(absPathFor(fileName), buf);
}

export async function deleteStoredFile(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath) return;
  try {
    await fs.promises.unlink(absPathFor(storagePath));
  } catch (err) {
    // Missing file is fine (already gone); log anything else but never throw.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') console.error('deleteStoredFile failed:', err);
  }
}
