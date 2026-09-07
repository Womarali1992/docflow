/**
 * The upload pipeline (C2.3): authorize → stage → validate → scan → publish.
 *
 * The two properties worth the most here:
 *
 *   1. **Authorize before bytes.** An upload aimed at someone else's request
 *      must never reach the disk. The test for it asserts the staging directory
 *      is empty afterwards, which is the only way to tell the difference between
 *      "rejected" and "rejected after writing 25 MB of someone else's file".
 *
 *   2. **Never clean without a scan.** Every scanner failure mode — down,
 *      timing out, talking nonsense — must end as `error`, never `clean`. The
 *      scanner is exercised against a fake clamd on a real TCP socket, so these
 *      run on a machine with no ClamAV installed. The single test that needs a
 *      genuine clamd is tagged and skips.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { stagingDir } from '../src/files/store.js';
import { interpret, ping, scanFile } from '../src/files/scan.js';
import { sweepOnce } from '../src/jobs/handlers/sweeper.js';
import { scanRetryJob } from '../src/jobs/handlers/scan_retry.js';
import { FIXTURES } from './fixtures.js';
import { app, fakeClamd, loginAs, request, seedFixture, type Fixture } from './helpers.js';

/** Files sitting in staging right now. Should be empty except mid-upload. */
function stagedFiles(): string[] {
  const dir = stagingDir();
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.part')) : [];
}

type FixtureName = keyof typeof FIXTURES;

function attach(req: ReturnType<typeof request>['post'] extends (u: string) => infer T ? T : never, which: FixtureName) {
  const f = FIXTURES[which];
  return req.attach('file', Buffer.from(f.bytes), { filename: f.name });
}

describe('authorize before bytes', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it("never writes a file staged for another client's request", async () => {
    const intruder = await loginAs(fx, 'client2a');

    const res = await attach(request(app).post(`/api/requests/${fx.client1a.request}/uploads`).set('Cookie', intruder), 'pdf');

    expect(res.status).toBe(404);
    // The whole point: not one byte of that upload reached the disk.
    expect(stagedFiles()).toEqual([]);
    expect(await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.request))).toEqual([]);
  });

  it('never writes a file for an anonymous caller', async () => {
    const res = await attach(request(app).post(`/api/requests/${fx.client1a.request}/uploads`), 'pdf');
    expect(res.status).toBe(401);
    expect(stagedFiles()).toEqual([]);
  });

  it("never writes a file into another firm's engagement", async () => {
    const advisor = await loginAs(fx, 'provider2');
    const res = await attach(request(app).post(`/api/engagements/${fx.client1a.engagement}/uploads`).set('Cookie', advisor), 'pdf');
    expect(res.status).toBe(404);
    expect(stagedFiles()).toEqual([]);
  });

  it('refuses an advisor uploading against a client checklist line, without staging it', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const res = await attach(request(app).post(`/api/requests/${fx.client1a.request}/uploads`).set('Cookie', advisor), 'pdf');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('client_only');
    expect(stagedFiles()).toEqual([]);
  });
});

describe('validation', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  afterEach(() => {
    // Whatever happened, nothing may be left in staging.
    expect(stagedFiles()).toEqual([]);
  });

  const url = (fx: Fixture) => `/api/requests/${fx.client1a.request}/uploads`;

  it('accepts a real PDF and stores it as a version', async () => {
    const client = await loginAs(fx, 'client1a');
    const res = await attach(request(app).post(url(fx)).set('Cookie', client), 'pdf');

    // SCAN_REQUIRED=false in tests: stored, honestly not published.
    expect(res.status).toBe(202);
    expect(res.body.scanStatus).toBe('pending');
    expect(res.body.version).toMatchObject({ versionNo: 1, mimeType: 'application/pdf', available: false });
    expect(res.body.version).not.toHaveProperty('storageKey');
    expect(res.body.version).not.toHaveProperty('sha256');
  });

  it('refuses a PNG wearing a .pdf name', async () => {
    const client = await loginAs(fx, 'client1a');
    const res = await attach(request(app).post(url(fx)).set('Cookie', client), 'spoofPdf');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('type_mismatch');
    expect(res.body.error).toMatch(/named \.pdf but its contents are PNG/);
    expect(await db.select().from(schema.documentVersions)).toHaveLength(6); // only the fixture's own
  });

  it('refuses a file type it does not accept', async () => {
    const client = await loginAs(fx, 'client1a');
    const res = await attach(request(app).post(url(fx)).set('Cookie', client), 'exe');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('unsupported_type');
  });

  it('refuses a password-protected PDF, because a scanner cannot see inside it', async () => {
    const client = await loginAs(fx, 'client1a');
    const res = await attach(request(app).post(url(fx)).set('Cookie', client), 'encryptedPdf');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('encrypted');
    expect(res.body.error).toMatch(/password-protected/);
  });

  it('refuses binary wearing a .txt name', async () => {
    const client = await loginAs(fx, 'client1a');
    const res = await attach(request(app).post(url(fx)).set('Cookie', client), 'fakeText');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('type_mismatch');
  });

  it('refuses an empty file', async () => {
    const client = await loginAs(fx, 'client1a');
    const res = await attach(request(app).post(url(fx)).set('Cookie', client), 'empty');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('empty_file');
  });

  it('accepts the everyday formats a client actually sends', async () => {
    const client = await loginAs(fx, 'client1a');
    for (const name of ['png', 'gif', 'csv', 'txt', 'xlsx'] as const) {
      const res = await attach(request(app).post(`/api/engagements/${fx.client1a.engagement}/uploads`).set('Cookie', client), name);
      expect(res.status, `${name} → ${JSON.stringify(res.body)}`).toBe(202);
    }
  });
});

describe('the scanner', () => {
  let clamd: ReturnType<typeof fakeClamd> | null = null;
  const original = { host: process.env.CLAMD_HOST, port: process.env.CLAMD_PORT, required: process.env.SCAN_REQUIRED };

  afterEach(async () => {
    await clamd?.stop();
    clamd = null;
    process.env.CLAMD_HOST = original.host;
    process.env.CLAMD_PORT = original.port;
    process.env.SCAN_REQUIRED = original.required;
  });

  async function pointAt(behaviour: Parameters<typeof fakeClamd>[0]) {
    clamd = fakeClamd(behaviour);
    const port = await clamd.start();
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = String(port);
    process.env.SCAN_REQUIRED = 'true';
  }

  function tempFile(bytes: Buffer): string {
    const dir = path.join(process.env.DATA_ROOT!, 'scan-tmp');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
    fs.writeFileSync(file, bytes);
    return file;
  }

  it('reads a clean verdict', async () => {
    await pointAt('clean');
    expect(await scanFile(tempFile(FIXTURES.pdf.bytes))).toEqual({ verdict: 'clean', detail: null });
  });

  it('reads an infected verdict and keeps the signature name', async () => {
    await pointAt('infected');
    const result = await scanFile(tempFile(FIXTURES.eicar.bytes));
    expect(result.verdict).toBe('infected');
    expect(result.detail).toBe('Eicar-Test-Signature');
  });

  it('reports error — never clean — when clamd cannot be reached', async () => {
    process.env.SCAN_REQUIRED = 'true';
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = '1'; // nothing listens here
    const result = await scanFile(tempFile(FIXTURES.pdf.bytes));
    expect(result.verdict).toBe('error');
    expect(result.detail).toMatch(/unreachable|closed/i);
  });

  it('reports error when clamd answers with something it does not understand', async () => {
    await pointAt('garbage');
    const result = await scanFile(tempFile(FIXTURES.pdf.bytes));
    expect(result.verdict).toBe('error');
    expect(result.detail).toMatch(/clamd said/);
  });

  it('reports error rather than hanging when clamd never answers', async () => {
    await pointAt('silent');
    process.env.CLAMD_TIMEOUT_MS = '300';
    try {
      const result = await scanFile(tempFile(FIXTURES.pdf.bytes));
      expect(result.verdict).toBe('error');
      expect(result.detail).toMatch(/did not answer within/);
    } finally {
      delete process.env.CLAMD_TIMEOUT_MS;
    }
  });

  it('answers PING', async () => {
    await pointAt('pong');
    expect(await ping(1000)).toBe(true);
    process.env.CLAMD_PORT = '1';
    expect(await ping(500)).toBe(false);
  });

  it('never turns an unrecognised reply into a clean verdict', () => {
    expect(interpret('stream: OK\0')).toEqual({ verdict: 'clean', detail: null });
    expect(interpret('stream: Win.Test.EICAR_HDB-1 FOUND\0').verdict).toBe('infected');
    expect(interpret('').verdict).toBe('error');
    expect(interpret('INSTREAM size limit exceeded\0').verdict).toBe('error');
    expect(interpret('who knows\0').verdict).toBe('error');
  });
});

describe('scanning through the upload route', () => {
  let fx: Fixture;
  let clamd: ReturnType<typeof fakeClamd> | null = null;
  const originalRequired = process.env.SCAN_REQUIRED;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  afterEach(async () => {
    await clamd?.stop();
    clamd = null;
    process.env.SCAN_REQUIRED = originalRequired;
    delete process.env.CLAMD_HOST;
    delete process.env.CLAMD_PORT;
  });

  async function pointAt(behaviour: Parameters<typeof fakeClamd>[0]) {
    clamd = fakeClamd(behaviour);
    const port = await clamd.start();
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = String(port);
    process.env.SCAN_REQUIRED = 'true';
  }

  it('publishes a clean file and moves the checklist on', async () => {
    await pointAt('clean');
    const client = await loginAs(fx, 'client1a');

    const res = await attach(request(app).post(`/api/requests/${fx.client1a.request}/uploads`).set('Cookie', client), 'pdf');

    expect(res.status).toBe(201);
    expect(res.body.scanStatus).toBe('clean');
    expect(res.body.version.available).toBe(true);

    const [req] = await db.select().from(schema.requests).where(eq(schema.requests.id, fx.client1a.request));
    expect(req.status).toBe('submitted');
    expect(stagedFiles()).toEqual([]);
  });

  it('quarantines an infected file: 422, nothing stored, and an audit line', async () => {
    await pointAt('infected');
    const client = await loginAs(fx, 'client1a');

    const res = await attach(request(app).post(`/api/requests/${fx.client1a.request}/uploads`).set('Cookie', client), 'eicar');

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('infected');
    // Nothing on disk, no version, and the checklist did not move.
    expect(stagedFiles()).toEqual([]);
    expect(await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.request))).toEqual([]);
    const [request_] = await db.select().from(schema.requests).where(eq(schema.requests.id, fx.client1a.request));
    expect(request_.status).toBe('requested');

    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'document.quarantined'));
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toMatchObject({ signature: 'Eicar-Test-Signature' });
  });

  it('accepts the file when the scanner is down: 202, stored, unreadable, retry queued', async () => {
    process.env.SCAN_REQUIRED = 'true';
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = '1';
    const client = await loginAs(fx, 'client1a');

    const res = await attach(request(app).post(`/api/requests/${fx.client1a.request}/uploads`).set('Cookie', client), 'pdf');

    // The firm's outage is not the client's problem — but nothing is published.
    expect(res.status).toBe(202);
    expect(res.body.code).toBe('scanner_unavailable');
    expect(res.body.version.available).toBe(false);

    const [version] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.request));
    expect(version.scanStatus).toBe('error');
    expect(version.publishedAt).toBeNull();

    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, 'scan_retry'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].dedupeKey).toBe(`scan_retry:${version.id}`);

    // And it cannot be downloaded while it is in that state.
    const dl = await request(app).get(`/api/documents/${fx.client1a.request}/download`).set('Cookie', client);
    expect(dl.status).toBe(409);
    expect(dl.body.code).toBe('not_available_yet');
  });

  it('publishes on retry once the scanner comes back', async () => {
    // 1. Upload while the scanner is down.
    process.env.SCAN_REQUIRED = 'true';
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = '1';
    const client = await loginAs(fx, 'client1a');
    await attach(request(app).post(`/api/requests/${fx.client1a.request}/uploads`).set('Cookie', client), 'pdf');

    const [version] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.request));
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.type, 'scan_retry'));

    // 2. The scanner comes back; the retry job runs.
    await pointAt('clean');
    await scanRetryJob(job);

    const [after] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, version.id));
    expect(after.scanStatus).toBe('clean');
    expect(after.publishedAt).not.toBeNull();

    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.request));
    expect(doc.currentVersionId).toBe(version.id);
    const [req] = await db.select().from(schema.requests).where(eq(schema.requests.id, fx.client1a.request));
    expect(req.status).toBe('submitted');
  });

  it('quarantines on retry if the file turns out to be infected', async () => {
    process.env.SCAN_REQUIRED = 'true';
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = '1';
    const client = await loginAs(fx, 'client1a');
    await attach(request(app).post(`/api/requests/${fx.client1a.request}/uploads`).set('Cookie', client), 'pdf');

    const [version] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.request));
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.type, 'scan_retry'));

    await pointAt('infected');
    await scanRetryJob(job);

    const [after] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, version.id));
    expect(after.scanStatus).toBe('infected');
    expect(after.publishedAt).toBeNull();
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.request));
    expect(doc.currentVersionId).toBeNull();
  });

  it('keeps failing the retry while the scanner stays down, so the queue backs off', async () => {
    process.env.SCAN_REQUIRED = 'true';
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = '1';
    const client = await loginAs(fx, 'client1a');
    await attach(request(app).post(`/api/requests/${fx.client1a.request}/uploads`).set('Cookie', client), 'pdf');
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.type, 'scan_retry'));

    await expect(scanRetryJob(job)).rejects.toThrow(/still unavailable/);
  });
});

describe('concurrent submissions', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('keeps both files intact when two uploads land at once', async () => {
    const client = await loginAs(fx, 'client1a');
    const url = `/api/documents/${fx.client1a.upload}/versions`;

    const [a, b] = await Promise.all([
      attach(request(app).post(url).set('Cookie', client), 'pdf'),
      attach(request(app).post(url).set('Cookie', client), 'png'),
    ]);

    expect([a.status, b.status].every((s) => s === 201 || s === 202)).toBe(true);

    const versions = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.upload));
    // The seeded version plus both new ones, each with its own number and bytes.
    expect(versions).toHaveLength(3);
    expect(new Set(versions.map((v) => v.versionNo)).size).toBe(3);
    expect(new Set(versions.map((v) => v.storageKey)).size).toBe(3);
    expect(stagedFiles()).toEqual([]);
  });
});

describe('the sweeper', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('removes abandoned staged files and leaves fresh ones alone', async () => {
    const dir = stagingDir();
    fs.mkdirSync(dir, { recursive: true });
    const stale = path.join(dir, 'stale.part');
    const fresh = path.join(dir, 'fresh.part');
    fs.writeFileSync(stale, 'x');
    fs.writeFileSync(fresh, 'x');
    // Two hours old.
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);

    const result = await sweepOnce();

    expect(result.stagedRemoved).toBe(1);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    fs.rmSync(fresh);
  });

  it('flags a version that never got a verdict, and never touches a published one', async () => {
    const [published] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.upload));

    const [stranded] = await db
      .insert(schema.documentVersions)
      .values({
        documentId: fx.client1a.upload,
        versionNo: 99,
        originalFilename: 'stranded.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'b'.repeat(64),
        storageKey: 'files/2026/09/stranded.pdf',
        scanStatus: 'pending',
        uploadedByKind: 'client',
        uploadedById: fx.client1a.id,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      })
      .returning();

    const result = await sweepOnce();
    expect(result.versionsFlagged).toBe(1);

    const [after] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, stranded.id));
    expect(after.scanStatus).toBe('error');
    expect(after.scanDetail).toMatch(/did not finish/);

    // The published version is untouched: the sweeper never edits live documents.
    const [stillFine] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, published.id));
    expect(stillFine.scanStatus).toBe('clean');
    expect(stillFine.publishedAt).not.toBeNull();
  });
});

/*
 * These two guarded the legacy `POST /documents/:id/file` route, to prove it was
 * not a back door around the pipeline. C5.4 removed that route; the behaviours
 * still matter, so they moved to the one route that remains.
 */
describe('re-uploading a document', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('creates a version instead of overwriting, and still refuses a spoofed file', async () => {
    const client = await loginAs(fx, 'client1a');

    const spoof = await attach(request(app).post(`/api/documents/${fx.client1a.upload}/versions`).set('Cookie', client), 'spoofPdf');
    expect(spoof.status).toBe(400);
    expect(spoof.body.code).toBe('type_mismatch');

    const ok = await attach(request(app).post(`/api/documents/${fx.client1a.upload}/versions`).set('Cookie', client), 'pdf');
    expect([200, 202]).toContain(ok.status);

    const versions = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, fx.client1a.upload));
    expect(versions).toHaveLength(2); // the seeded one, plus this — nothing overwritten
    expect(stagedFiles()).toEqual([]);
  });

  it('still refuses a client writing over advisor material', async () => {
    const client = await loginAs(fx, 'client1a');
    const res = await attach(request(app).post(`/api/documents/${fx.client1a.deliverable}/versions`).set('Cookie', client), 'pdf');
    expect(res.status).toBe(403);
    expect(stagedFiles()).toEqual([]);
  });
});

describe('ops status reports the scanner', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('says scanning is off, and why, when it is', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app).get('/api/ops/status').set('Cookie', advisor);
    expect(res.body.scanner).toMatchObject({ required: false, reachable: false });
    expect(res.body.scanner.note).toMatch(/switched off/);
  });
});

/**
 * The one test that needs a real ClamAV. It is skipped unless clamd answers on
 * CLAMD_HOST/PORT, so this suite runs on a dev box with nothing installed — and
 * runs for real on the firm PC once C5.3 installs it.
 */
describe('clamav integration', () => {
  it('flags EICAR through a real clamd', async () => {
    const wasRequired = process.env.SCAN_REQUIRED;
    process.env.SCAN_REQUIRED = 'true';
    delete process.env.CLAMD_HOST;
    delete process.env.CLAMD_PORT;

    const up = await ping(1500);
    if (!up) {
      process.env.SCAN_REQUIRED = wasRequired;
      console.log('[clamav] skipped: no clamd on 127.0.0.1:3310');
      return;
    }

    const dir = path.join(process.env.DATA_ROOT!, 'scan-tmp');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'eicar.txt');
    fs.writeFileSync(file, FIXTURES.eicar.bytes);

    const result = await scanFile(file);
    process.env.SCAN_REQUIRED = wasRequired;

    expect(result.verdict).toBe('infected');
    expect(result.detail).toMatch(/EICAR/i);
  });
});

describe('a request with no file attached', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('is refused without leaving an empty document behind', async () => {
    const client = await loginAs(fx, 'client1a');
    const before = (await db.select().from(schema.documents)).length;

    const res = await request(app).post(`/api/engagements/${fx.client1a.engagement}/uploads`).set('Cookie', client);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_file');
    // The document is created only once bytes have actually arrived.
    expect((await db.select().from(schema.documents)).length).toBe(before);
    expect(stagedFiles()).toEqual([]);
  });

  it('names an ad-hoc upload after the file that was sent', async () => {
    const client = await loginAs(fx, 'client1a');
    const res = await attach(request(app).post(`/api/engagements/${fx.client1a.engagement}/uploads`).set('Cookie', client), 'csv');
    expect(res.status).toBe(202);
    expect(res.body.document.displayName).toBe('ledger.csv');
  });
});
