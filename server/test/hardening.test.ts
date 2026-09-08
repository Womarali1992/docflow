/**
 * The hardening release's failing tests (H0).
 *
 * An independent audit on 2026-09-07 reproduced eleven defects at `705cdbd` and
 * wrote probes for them (`docs/audit/`). Those probes assert the **defects** —
 * they pass because the bug is there, and they would start failing the moment
 * it was fixed, which is exactly backwards for a suite that has to keep working
 * afterwards.
 *
 * So this file is the live form of that evidence, and it asserts the **correct**
 * behaviour instead. Every row starts as `it.fails(...)`: vitest runs it, expects
 * it to throw, and fails the suite if it ever passes. Each fix commit flips its
 * own rows to `it(...)` in the same commit. When this file has no `it.fails`
 * left, the release is done — that is the definition in the plan, and it is
 * checkable rather than asserted.
 *
 * The same pattern as the pilot's C0.1 → C0.2 authorization hotfix. A row's name
 * carries its finding (F2, F3 …) so a failure points straight at the design
 * note in the plan.
 *
 * Nothing here is a probe: no scratch schema, no separate runner. It uses the
 * ordinary fixtures, the ordinary app and the ordinary test database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db, pool, schema } from '../src/db/client.js';
import type { Document, Job, ScanStatus } from '../src/db/schema.js';
import { consumeTotp, getMfa } from '../src/auth/mfa.js';
import { recordNewVersion, type NewVersionResult } from '../src/workflow/versions.js';
import { scanRetryJob } from '../src/jobs/handlers/scan_retry.js';
import { ensureKeyDir, newStorageKey } from '../src/files/store.js';
import { FIXTURES } from './fixtures.js';
import {
  app,
  fakeClamd,
  loginAs,
  request,
  seedFixture,
  totpCode,
  type Fixture,
} from './helpers.js';

/** The document row behind a fixture id, as `recordNewVersion` wants it. */
async function documentRow(id: string): Promise<Document> {
  const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  return row;
}

/** A version with real bytes on disk, so a re-scan has something to read. */
async function addVersion(document: Document, scanStatus: ScanStatus): Promise<NewVersionResult> {
  const storageKey = newStorageKey(new Date(), 'pdf');
  fs.writeFileSync(ensureKeyDir(storageKey), FIXTURES.pdf.bytes);
  return recordNewVersion({
    document,
    originalFilename: 'hardening.pdf',
    mimeType: 'application/pdf',
    sizeBytes: FIXTURES.pdf.bytes.length,
    sha256: 'a'.repeat(64),
    storageKey,
    uploadedByKind: 'client',
    uploadedById: document.clientId,
    scanStatus,
  });
}

/** The versions of a document, oldest first. */
function versionsOf(documentId: string) {
  return db
    .select()
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId))
    .orderBy(asc(schema.documentVersions.versionNo));
}

/** Long enough that "still running" means blocked rather than merely slow. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Enough of a job row for a handler that only reads `id` and `payload`. */
function retryJob(versionId: string): Job {
  return {
    id: randomUUID(),
    type: 'scan_retry',
    payload: { versionId },
    runAt: new Date(),
    attempts: 1,
    maxAttempts: 30,
    lockedAt: new Date(),
    lockedBy: 'hardening-test',
    lastError: null,
    doneAt: null,
    dedupeKey: null,
    createdAt: new Date(),
  };
}

/** Every `.ts` file under `server/src`, for the invariant-16 sweep. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('hardening', () => {
  let fx: Fixture;
  let clamd: ReturnType<typeof fakeClamd> | null = null;
  const original = { host: process.env.CLAMD_HOST, port: process.env.CLAMD_PORT, required: process.env.SCAN_REQUIRED };

  beforeEach(async () => {
    fx = await seedFixture();
  });

  afterEach(async () => {
    await clamd?.stop();
    clamd = null;
    process.env.CLAMD_HOST = original.host;
    process.env.CLAMD_PORT = original.port;
    process.env.SCAN_REQUIRED = original.required;
  });

  /** A scanner that says OK, for the paths that only exist once one answers. */
  async function scannerSaysClean() {
    clamd = fakeClamd('clean');
    const port = await clamd.start();
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = String(port);
    process.env.SCAN_REQUIRED = 'true';
  }

  /* ------------------------------------------------------------------ F2 */

  /**
   * `consumeTotp` read the row, decided, then updated by id. Two verifications
   * holding the same row both decided "not used yet" and both won — a stolen
   * code was usable for as long as its 30-second step lasted. The existing
   * replay test passed because it is sequential.
   *
   * FIXED by H1 (2.2): one conditional UPDATE … RETURNING, so the row lock
   * decides which caller was first rather than a stale in-memory copy.
   */
  it('F2: one authenticator code signs in exactly once, even used twice at once', async () => {
    const mfa = await getMfa('client', fx.client1a.id);
    const code = totpCode();

    const results = await Promise.all([consumeTotp(mfa!, code), consumeTotp(mfa!, code)]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'reused')).toHaveLength(1);
  });

  /* ------------------------------------------------------------------ F3 */

  /**
   * `recordNewVersion` allocates `MAX(version_no) + 1` inside a transaction that
   * holds no lock, so concurrent uploads compute the same number and the unique
   * index turns the loser into a 23505 — which the upload pipeline reports as a
   * 500 to a client whose file was perfectly fine. The audit measured 4 of 8.
   *
   * Fixed by H2 (2.3): lock the document, then allocate.
   */
  it('F3: eight versions recorded at once each get their own number', async () => {
    const document = await documentRow(fx.client1a.upload);

    const results = await Promise.allSettled(Array.from({ length: 8 }, () => addVersion(document, 'pending')));

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    // The fixture already carries version 1, so eight more is 1…9 with no gaps.
    expect((await versionsOf(document.id)).map((v) => v.versionNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  /**
   * `documentForRequest` is select-then-insert with no lock and no unique index,
   * so four uploads answering the same empty request race twice over: once for
   * the document row, and again for the version number. The audit saw two 500s.
   *
   * Fixed by H2 (2.3): the request row is locked for the first upload.
   */
  it('F3: four uploads answering one empty request make one document and four versions', async () => {
    const client = await loginAs(fx, 'client1a');
    const [created] = await db
      .insert(schema.requests)
      .values({
        providerId: fx.client1a.providerId,
        clientId: fx.client1a.id,
        engagementId: fx.client1a.engagement,
        title: 'Concurrent first upload',
        category: 'Documents',
        required: true,
        status: 'requested',
        sortOrder: 1,
      })
      .returning({ id: schema.requests.id });

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post(`/api/requests/${created.id}/uploads`)
          .set('Cookie', client)
          .attach('file', Buffer.from(FIXTURES.pdf.bytes), { filename: FIXTURES.pdf.name })
      )
    );

    // 201 published, 202 stored and being checked. Never a 500: the client's
    // file was fine, and losing a race is not their problem.
    expect(results.map((r) => r.status).filter((s) => s !== 201 && s !== 202)).toEqual([]);
    const documents = await db.select().from(schema.documents).where(eq(schema.documents.requestId, created.id));
    expect(documents).toHaveLength(1);
    expect(await versionsOf(documents[0].id)).toHaveLength(4);
  });

  /**
   * The same defect, proved deterministically rather than by racing: with the
   * document held by another connection, a version insert must *wait* for the
   * lock instead of computing its number beside it. This is the pattern every
   * other overlap test in this program follows — hold, prove it blocks,
   * release, prove the order.
   */
  it('F3: a version insert waits for the document lock rather than racing it', async () => {
    const document = await documentRow(fx.client1a.upload);
    const holder = await pool.connect();

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM documents WHERE id = $1 FOR UPDATE', [document.id]);

      const pending = addVersion(document, 'pending');
      const raced = await Promise.race([pending.then(() => 'finished' as const), sleep(300).then(() => 'blocked' as const)]);
      expect(raced).toBe('blocked');

      await holder.query('COMMIT');
      // The fixture already carries version 1, so the one that waited is 2.
      expect((await pending).version.versionNo).toBe(2);
    } finally {
      holder.release();
    }
  });

  /* ------------------------------------------------------------------ F4 */

  /**
   * A version that scanned late repoints `currentVersionId` at itself with no
   * comparison, so a slow scan of version 6 undoes the already-published version
   * 7: the advisor's screen silently goes back in time.
   *
   * Fixed by H2 (2.3): `publishVersion` never moves the pointer backwards; a
   * late arrival that is not the newest is superseded on the spot.
   */
  it('F4: an older version scanning clean late does not become current again', async () => {
    await scannerSaysClean();
    const document = await documentRow(fx.client1a.upload);
    const older = await addVersion(document, 'pending');
    const newer = await addVersion(document, 'clean');

    await scanRetryJob(retryJob(older.version.id));

    const after = await documentRow(document.id);
    expect(after.currentVersionId).toBe(newer.version.id);
    const [refreshed] = await versionsOf(document.id).then((rows) => rows.filter((v) => v.id === older.version.id));
    // Clean, recorded, and explicitly out of the way rather than silently newest.
    expect(refreshed.scanStatus).toBe('clean');
    expect(refreshed.supersededAt).not.toBeNull();
  });

  /**
   * The clean branch of `scan_retry` skips the request transition when the
   * request is `accepted`, so a replacement file that arrives during a scanner
   * outage publishes without ever reaching the advisor: the checklist still says
   * accepted, and nobody looked at the new document.
   *
   * Fixed by H2 (2.3): publication reopens acceptance wherever it happens.
   */
  it('F4: a replacement that scans clean puts an accepted request back in front of the advisor', async () => {
    await scannerSaysClean();
    const document = await documentRow(fx.client1a.request);
    await addVersion(document, 'clean');
    await db
      .update(schema.requests)
      .set({ status: 'accepted' })
      .where(eq(schema.requests.id, fx.client1a.request));
    const replacement = await addVersion(await documentRow(document.id), 'pending');

    await scanRetryJob(retryJob(replacement.version.id));

    const [after] = await db.select().from(schema.requests).where(eq(schema.requests.id, fx.client1a.request));
    expect(after.status).toBe('submitted');
  });

  /* ------------------------------------------------------------------ F5 */

  /**
   * Accept only checks that the version belongs to the request, so an advisor
   * reviewing version 1 while version 2 lands accepts a file they never opened —
   * with a 200 and no hint that anything moved.
   *
   * Fixed by H2 (2.3): the decision must name the current clean version, or it
   * is 409 `stale_version` and the workspace offers Refresh.
   */
  it('F5: accepting a version that is no longer current is refused', async () => {
    const document = await documentRow(fx.client1a.request);
    const first = await addVersion(document, 'clean');
    await addVersion(await documentRow(document.id), 'clean');
    const advisor = await loginAs(fx, 'provider1');

    const res = await request(app)
      .post(`/api/requests/${fx.client1a.request}/accept`)
      .set('Cookie', advisor)
      .send({ versionId: first.version.id });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('stale_version');
    const [after] = await db.select().from(schema.requests).where(eq(schema.requests.id, fx.client1a.request));
    expect(after.status).toBe('submitted');
  });

  /**
   * Worse: nothing requires the named version to have been scanned. A request
   * whose newest file is still `pending` — stored, unreadable, unscanned — can
   * be accepted, and the review row points at bytes nobody has ever seen.
   *
   * Fixed by H2 (2.3): the version must be the current, clean, published one.
   */
  it('F5: accepting a version that has not been scanned is refused', async () => {
    const document = await documentRow(fx.client1a.request);
    await addVersion(document, 'clean');
    const pending = await addVersion(await documentRow(document.id), 'pending');
    const advisor = await loginAs(fx, 'provider1');

    const res = await request(app)
      .post(`/api/requests/${fx.client1a.request}/accept`)
      .set('Cookie', advisor)
      .send({ versionId: pending.version.id });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('stale_version');
  });

  /**
   * And the case the audit did not write a probe for, which the fix implies: a
   * decision that names nothing at all used to fall back to whatever was
   * current at the moment the request reached the server. That is the same bug
   * wearing a default — the advisor still never said which file they read.
   *
   * Fixed by H2 (2.3): `versionId` is required whenever a document exists.
   */
  it('F5: a decision that names no version at all is refused', async () => {
    const document = await documentRow(fx.client1a.request);
    await addVersion(document, 'clean');
    const advisor = await loginAs(fx, 'provider1');

    const res = await request(app)
      .post(`/api/requests/${fx.client1a.request}/accept`)
      .set('Cookie', advisor)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('version_required');
    const [after] = await db.select().from(schema.requests).where(eq(schema.requests.id, fx.client1a.request));
    expect(after.status).toBe('submitted');
  });

  /* ----------------------------------------------------------------- F11 */

  /**
   * `finish()` creates the document row before the pipeline validates anything,
   * so every refused upload — wrong type, spoofed extension, encrypted — leaves
   * an empty document behind. The client sees a rejection; the advisor sees a
   * document with no file in it.
   *
   * Fixed by H3 (2.4): validate and scan first, then create; the version row,
   * its scan job and its audit line commit together or not at all.
   */
  it.fails('F11: a refused upload leaves no document row behind', async () => {
    const client = await loginAs(fx, 'client1a');
    const before = (await db.select().from(schema.documents)).length;

    const res = await request(app)
      .post(`/api/engagements/${fx.client1a.engagement}/uploads`)
      .set('Cookie', client)
      // PNG bytes wearing a .pdf name: refused by the sniffer, after the row exists.
      .attach('file', Buffer.from(FIXTURES.spoofPdf.bytes), { filename: FIXTURES.spoofPdf.name });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('type_mismatch');
    expect((await db.select().from(schema.documents)).length).toBe(before);
  });
  /* ------------------------------------------------- invariant 16 (H2) */

  /**
   * The fix is only a fix while it stays the only path. `publishVersion` and
   * `quarantineVersion` own `published_at`, `superseded_at` and
   * `current_version_id`; a second writer anywhere else is how F4 happened in
   * the first place, so the tree is swept rather than trusted.
   *
   * This looks at the object handed to `.set(...)` or `.values(...)` — the
   * write form. Reading those columns, and serializing them, is everyone's
   * business.
   */
  it('nothing outside workflow/publish.ts writes the publication columns', () => {
    const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const owner = path.join('workflow', 'publish.ts');
    const columns = /\b(publishedAt|supersededAt|currentVersionId)\s*:/;
    const writes = /\.(?:set|values)\(\s*\{/g;
    const offenders: string[] = [];

    for (const file of sourceFiles(srcDir)) {
      const relative = path.relative(srcDir, file);
      if (relative === owner) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(writes)) {
        const from = match.index ?? 0;
        const window = source.slice(from, from + 800);
        const end = window.indexOf('})');
        const body = end === -1 ? window : window.slice(0, end);
        if (columns.test(body)) offenders.push(`${relative} @ char ${from}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
