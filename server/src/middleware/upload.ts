import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { MAX_UPLOAD_BYTES, isAllowedMime } from '../storage.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMime(file.mimetype)) {
      cb(null, true);
    } else {
      // Signal to the wrapper below; translated to a 400 response.
      cb(new Error('UNSUPPORTED_FILE_TYPE'));
    }
  },
});

const single = upload.single('file');

/**
 * Accept a single multipart `file` field, translating multer failures into
 * clean HTTP responses (413 for oversize, 400 for bad type / malformed upload).
 */
export function uploadSingle(req: Request, res: Response, next: NextFunction) {
  single(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 25 MB).' });
      }
      return res.status(400).json({ error: `Upload error: ${err.code}` });
    }
    if (err instanceof Error && err.message === 'UNSUPPORTED_FILE_TYPE') {
      return res.status(400).json({ error: 'Unsupported file type.' });
    }
    return next(err as Error);
  });
}
