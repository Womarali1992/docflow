/**
 * Getting the bytes onto disk, and getting rid of them again.
 *
 * multer writes straight to `STAGING_DIR/<uuid>.part` rather than into memory,
 * so a 25 MB upload does not become 25 MB of heap, and so an abandoned upload
 * is a file the sweeper can find rather than a leak.
 *
 * Two things this module is careful about:
 *   - **multer 2 leaves the `.part` file behind even when it errors** (a size
 *     limit trips after some bytes are already written). Every error path here
 *     unlinks it; the hourly sweeper is the backstop, not the mechanism.
 *   - The caller must have authorized the target BEFORE calling this
 *     (invariant 1). Nothing here checks permissions, and it must not be
 *     mounted as router-level middleware where it would run first.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { discardStaged, ensureStagingDir, stagedPath } from './store.js';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface StagedUpload {
  absPath: string;
  originalFilename: string;
  sizeBytes: number;
  /** What the browser claimed. Recorded, never trusted — validate.ts sniffs the bytes. */
  declaredMime: string;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, ensureStagingDir());
      } catch (err) {
        cb(err as Error, '');
      }
    },
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.part`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20 },
});

const single = upload.single('file');

/**
 * Parses one multipart `file` field onto disk. Answers the HTTP error itself for
 * the cases with a stable code, so every upload route reports them identically.
 */
export function stageUpload(req: Request, res: Response, next: NextFunction) {
  single(req, res, (err: unknown) => {
    if (!err) return next();

    // multer may have written part of the file before failing.
    discardStaged(req.file?.path);

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'That file is larger than 25 MB.', code: 'too_large' });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Send one file at a time, in a field called "file".', code: 'bad_upload' });
      }
      return res.status(400).json({ error: `Upload failed (${err.code}).`, code: 'bad_upload' });
    }
    return next(err as Error);
  });
}

/** The staged file from a parsed request, or null when the caller sent none. */
export function stagedFrom(req: Request): StagedUpload | null {
  const file = req.file;
  if (!file) return null;
  return {
    absPath: file.path,
    originalFilename: file.originalname || 'upload',
    sizeBytes: file.size,
    declaredMime: file.mimetype || 'application/octet-stream',
  };
}

export { discardStaged, stagedPath };
