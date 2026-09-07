/** Isolated audit probes. Uses a fresh schema in docflow_test; sends no email. */
import '../../server/scripts/lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { withDbName } from '../../server/scripts/lib.mjs';
import pg from '../../server/node_modules/pg/lib/index.js';

const scratch = `docflow_audit_${Date.now()}`;
const originalUrl = process.env.DATABASE_URL!;
const auditUrl = new URL(process.env.DATABASE_URL_TEST || withDbName(originalUrl, 'docflow_test'));
if (auditUrl.pathname !== '/docflow_test') throw new Error('Audit requires docflow_test');
auditUrl.searchParams.set('options', `-c search_path=${scratch}`);
process.env.DATABASE_URL = auditUrl.toString();
process.env.NODE_ENV = 'test';
process.env.APP_BASE_URL = 'http://localhost:8080';
process.env.PASSWORD_BCRYPT_COST = '4';
process.env.DATA_ROOT = path.resolve('docs/audit/scratch-data');
process.env.SCAN_REQUIRED = 'false';
delete process.env.SMTP_URL;
const findings: Record<string, unknown> = {};
const { db, pool, schema } = await import('../../server/src/db/client.ts');
const { eq } = await import('../../server/node_modules/drizzle-orm/index.js');
let scanner: net.Server | undefined;
let created = false;
try {
  await pool.query(`CREATE SCHEMA "${scratch}"`);
  created = true;
  const journal = JSON.parse(fs.readFileSync('server/migrations/meta/_journal.json', 'utf8'));
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(`server/migrations/${entry.tag}.sql`, 'utf8').replaceAll('"public".', `"${scratch}".`);
    await pool.query(sql);
  }
  const { seedFixture, loginAs, request, app, TOTP_SECRET } = await import('../../server/test/helpers.ts');
  const { consumeTotp, getMfa, generateCode } = await import('../../server/src/auth/mfa.ts');
  const { recordNewVersion } = await import('../../server/src/workflow/versions.ts');
  const { scanRetryJob } = await import('../../server/src/jobs/handlers/scan_retry.ts');
  const { ensureKeyDir, newStorageKey } = await import('../../server/src/files/store.ts');
  const fx = await seedFixture();
  const mfa = await getMfa('client', fx.client1a.id);
  findings.totpConcurrent = await Promise.all([consumeTotp(mfa!, generateCode(TOTP_SECRET)), consumeTotp(mfa!, generateCode(TOTP_SECRET))]);
  const [upload] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.upload));
  const makeVersion = async (document: typeof upload, status: 'pending' | 'clean') => {
    const storageKey = newStorageKey(new Date(), 'pdf');
    fs.writeFileSync(ensureKeyDir(storageKey), '%PDF-1.4\n%%EOF');
    return recordNewVersion({ document, originalFilename: 'audit.pdf', mimeType: 'application/pdf', sizeBytes: 14,
      sha256: 'a'.repeat(64), storageKey, uploadedByKind: 'client', uploadedById: fx.client1a.id, scanStatus: status });
  };
  const concurrent = await Promise.allSettled(Array.from({ length: 8 }, () => makeVersion(upload, 'pending')));
  findings.concurrentVersions = { attempted: 8, fulfilled: concurrent.filter(r => r.status === 'fulfilled').length,
    failures: concurrent.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason.code) };
  scanner = net.createServer(socket => {
    let bytes = Buffer.alloc(0);
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length >= 14 && bytes.subarray(-4).equals(Buffer.alloc(4))) socket.end('stream: OK\0');
    });
    socket.on('error', () => {});
  });
  await new Promise<void>(resolve => scanner!.listen(0, '127.0.0.1', resolve));
  process.env.CLAMD_HOST = '127.0.0.1';
  process.env.CLAMD_PORT = String((scanner.address() as net.AddressInfo).port);
  process.env.SCAN_REQUIRED = 'true';
  const older = await makeVersion(upload, 'pending');
  const newer = await makeVersion(upload, 'clean');
  await scanRetryJob({ id: randomUUID(), payload: { versionId: older.version.id } } as any);
  const [afterRetry] = await db.select().from(schema.documents).where(eq(schema.documents.id, upload.id));
  findings.outOfOrderScan = { olderVersion: older.version.versionNo, newerVersion: newer.version.versionNo,
    currentBecameOlder: afterRetry.currentVersionId === older.version.id };
  const [requestDoc] = await db.select().from(schema.documents).where(eq(schema.documents.id, fx.client1a.request));
  await db.update(schema.requests).set({ status: 'accepted' }).where(eq(schema.requests.id, fx.client1a.request));
  const replacement = await makeVersion(requestDoc, 'pending');
  await scanRetryJob({ id: randomUUID(), payload: { versionId: replacement.version.id } } as any);
  const [afterRequest] = await db.select().from(schema.requests).where(eq(schema.requests.id, fx.client1a.request));
  findings.acceptedAfterReplacementScan = afterRequest.status;
  const replacement2 = await makeVersion(requestDoc, 'clean');
  const advisor = await loginAs(fx, 'provider1');
  const accepted = await request(app).post(`/api/requests/${fx.client1a.request}/accept`).set('Cookie', advisor)
    .send({ versionId: replacement.version.id });
  findings.acceptOldVersion = { httpStatus: accepted.status, requestStatus: accepted.body.status,
    reviewedVersion: replacement.version.versionNo, currentVersion: replacement2.version.versionNo };
  const client = await loginAs(fx, 'client1a');
  process.env.SCAN_REQUIRED = 'false';
  const uploadRequest = await request(app).post(`/api/engagements/${fx.client1a.engagement}/requests`).set('Cookie', advisor)
    .send({ items: [{ title: 'Audit concurrent first upload', required: true }] });
  if (uploadRequest.status === 201) {
    const id = uploadRequest.body[0]?.id ?? uploadRequest.body.requests?.[0]?.id;
    const results = await Promise.all(Array.from({length:4}, () => request(app).post(`/api/requests/${id}/uploads`)
      .set('Cookie', client).attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'audit.pdf')));
    const docs = await db.select().from(schema.documents).where(eq(schema.documents.requestId, id));
    findings.concurrentFirstUpload = { statuses: results.map(r => r.status), documentRows: docs.length };
  } else findings.concurrentFirstUpload = { setupStatus: uploadRequest.status };
  const beforeDocs = (await db.select().from(schema.documents)).length;
  const invalid = await request(app).post(`/api/engagements/${fx.client1a.engagement}/uploads`).set('Cookie', client)
    .attach('file', Buffer.from('not a pdf'), 'audit.pdf');
  findings.rejectedUpload = { status: invalid.status, extraDocumentRows: (await db.select().from(schema.documents)).length - beforeDocs };
  fs.writeFileSync(path.resolve('docs/audit/2026-09-07-probe-results.json'), JSON.stringify(findings, null, 2) + '\n');
  console.log(JSON.stringify(findings, null, 2));
} finally {
  if (scanner) await new Promise<void>(resolve => scanner!.close(() => resolve()));
  await pool.end();
  const admin = new pg.Client({ connectionString: auditUrl.toString() });
  await admin.connect();
  try {
    if (!/^docflow_audit_\d+$/.test(scratch)) throw new Error('Unsafe scratch cleanup');
    if (created) await admin.query(`DROP SCHEMA "${scratch}" CASCADE`);
  } finally { await admin.end(); }
}
