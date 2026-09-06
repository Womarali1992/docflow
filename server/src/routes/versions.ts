/**
 * Version history for a document. Mounted alongside `documents.ts` on
 * `/api/documents`, because that is where the resource lives.
 *
 * Reading only: creating a version happens through the upload pipeline (C2.3),
 * and fetching the bytes through per-version delivery (C2.4). What this route
 * gives you is the record — what was submitted, when, by whom, and what the
 * scanner made of it — with `storageKey` and `sha256` left on the server.
 */
import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { serializeReview, serializeVersion } from './serialize.js';
import { findDocument, findVersion, notFound } from './scope.js';

const router = Router();
router.use(authenticate);

router.get('/:id/versions', async (req, res) => {
  const doc = await findDocument(req.auth!, req.params.id);
  if (!doc) return notFound(res);

  const versions = await db
    .select()
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, doc.id))
    .orderBy(desc(schema.documentVersions.versionNo));

  const reviews = await db.select().from(schema.reviews).where(eq(schema.reviews.documentId, doc.id));
  const reviewsByVersion = new Map<string, ReturnType<typeof serializeReview>[]>();
  for (const r of reviews) {
    if (!r.versionId) continue;
    reviewsByVersion.set(r.versionId, [...(reviewsByVersion.get(r.versionId) ?? []), serializeReview(r)]);
  }

  res.json(
    versions.map((v) => ({
      ...serializeVersion(v),
      // The decision made about this particular version, not the document as a whole.
      reviews: reviewsByVersion.get(v.id) ?? [],
      isCurrent: doc.currentVersionId === v.id,
    }))
  );
});

router.get('/:id/versions/:versionId', async (req, res) => {
  const found = await findVersion(req.auth!, req.params.id, req.params.versionId);
  if (!found) return notFound(res);
  res.json(serializeVersion(found.version));
});

export default router;
