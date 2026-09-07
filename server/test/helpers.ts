/**
 * Shared test fixtures: two providers, three clients (two under provider 1, one
 * under provider 2), and for every client one uploaded file, one open request
 * and one advisor deliverable. Recreated before every test by the caller.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import supertest from 'supertest';
import type { Express } from 'express';
import type { Response, Test } from 'supertest';
import { and, eq } from 'drizzle-orm';
import app from '../src/app.js';
import { db, schema } from '../src/db/client.js';
import { encryptSecret } from '../src/auth/crypto.js';
import { generateCode } from '../src/auth/mfa.js';
import { normalizeEmail } from '../src/auth/email.js';
import { ensureKeyDir, newStorageKey } from '../src/files/store.js';

export { app };

/** The origin the test app is 'served' from; the origin check refuses non-GET requests without it. */
export const TEST_ORIGIN = 'http://localhost:8080';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type Http = Record<Method, (url: string) => Test>;

/** supertest bound to the app, with the app's own Origin on every request (drop it deliberately to test the check). */
export function request(target: Express = app): Http {
  const base = supertest(target);
  const wrap = (m: Method) => (url: string) => base[m](url).set('Origin', TEST_ORIGIN);
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
}

export const PASSWORD = 'test-password-123';
// Low cost on purpose: fixtures are rebuilt before every test.
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

/** Every fixture account is MFA-enrolled with this authenticator secret (base32). */
export const TOTP_SECRET = 'TESTFIXTURE2TOTP2SECRET2';

/** The code an authenticator app would show for the fixture secret right now. */
export const totpCode = () => generateCode(TOTP_SECRET);

async function enrollMfa(userKind: 'provider' | 'client', userId: string) {
  const now = new Date();
  await db
    .insert(schema.mfaTotp)
    .values({ userKind, userId, secretEnc: encryptSecret(TOTP_SECRET), enrolledAt: now, createdAt: now, updatedAt: now });
}

/** Removes the enrollment so the next login lands in `mfa_enroll` (for enrollment tests). */
export async function unenroll(fx: Fixture, actor: LoggedInActor) {
  const { kind, id } = identity(fx, actor);
  await db.delete(schema.mfaTotp).where(and(eq(schema.mfaTotp.userKind, kind), eq(schema.mfaTotp.userId, id)));
  await db.delete(schema.recoveryCodes).where(and(eq(schema.recoveryCodes.userKind, kind), eq(schema.recoveryCodes.userId, id)));
}

export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n% docflow test fixture\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'
);

export const ACTORS = ['provider1', 'provider2', 'client1a', 'client1b', 'client2a', 'anonymous'] as const;
export type Actor = (typeof ACTORS)[number];
export type LoggedInActor = Exclude<Actor, 'anonymous'>;

export interface ProviderFixture {
  id: string;
  email: string;
}

export interface ClientFixture {
  id: string;
  email: string;
  providerId: string;
  /** A file the client uploaded (folder "Uploads", has bytes on disk + version 1). */
  upload: string;
  /** An open request from the advisor (no file yet). The request row shares this id. */
  request: string;
  /** An advisor deliverable (folder "Reports", bytes + version 1), SHARED with the client. */
  deliverable: string;
  /** The engagement all three sit in. */
  engagement: string;
  /** Version 1 of `upload`. */
  uploadVersion: string;
  /** Version 1 of `deliverable`. */
  deliverableVersion: string;
}

export interface Fixture {
  provider1: ProviderFixture;
  provider2: ProviderFixture;
  client1a: ClientFixture;
  client1b: ClientFixture;
  client2a: ClientFixture;
  messages: { fromClient1a: string; fromProvider1: string };
}

export const docIds = (c: ClientFixture): string[] => [c.upload, c.request, c.deliverable];

async function insertProvider(name: string, email: string): Promise<ProviderFixture> {
  const [p] = await db
    .insert(schema.providers)
    .values({ name, email, passwordHash: PASSWORD_HASH, firmName: `${name} CPA`, role: 'advisor' })
    .returning({ id: schema.providers.id });
  await db.insert(schema.activities).values({
    providerId: p.id,
    type: 'update',
    description: 'seeded provider activity',
    actorKind: 'provider',
    actorId: p.id,
    actorName: name,
  });
  await enrollMfa('provider', p.id);
  return { id: p.id, email };
}

/**
 * Writes the fixture bytes under DATA_ROOT and returns a version row for them —
 * the fixture represents a database that has been through the C2.1 import, so
 * every document with a file has a version behind it.
 */
async function insertVersion(documentId: string, uploadedBy: { kind: 'provider' | 'client'; id: string }, filename: string) {
  const storageKey = newStorageKey(new Date(), 'pdf');
  fs.writeFileSync(ensureKeyDir(storageKey), PDF_BYTES);
  const now = new Date();
  const [v] = await db
    .insert(schema.documentVersions)
    .values({
      documentId,
      versionNo: 1,
      originalFilename: filename,
      mimeType: 'application/pdf',
      sizeBytes: PDF_BYTES.length,
      sha256: createHash('sha256').update(PDF_BYTES).digest('hex'),
      storageKey,
      scanStatus: 'clean',
      scannedAt: now,
      uploadedByKind: uploadedBy.kind,
      uploadedById: uploadedBy.id,
      publishedAt: now,
      createdAt: now,
    })
    .returning({ id: schema.documentVersions.id });
  await db.update(schema.documents).set({ currentVersionId: v.id }).where(eq(schema.documents.id, documentId));
  return v.id;
}

/** What a document row records about its bytes; the bytes themselves are a version. */
const FILE_FACTS = { mimeType: 'application/pdf', sizeBytes: PDF_BYTES.length } as const;

async function insertClient(
  provider: ProviderFixture,
  name: string,
  email: string,
  tag: string
): Promise<ClientFixture> {
  const [c] = await db
    .insert(schema.clients)
    .values({
      providerId: provider.id,
      name,
      email,
      emailNormalized: normalizeEmail(email),
      passwordHash: PASSWORD_HASH,
      accountId: `CL-${tag}`,
    })
    .returning({ id: schema.clients.id });

  /*
   * One engagement per client, every document carrying a kind and (where it has
   * bytes) a version. This used to have a `legacy` mode as well — the pre-import
   * shape `seedLegacyFixture()` handed to the import tests — which went with the
   * importer in C5.4: the columns it wrote no longer exist.
   */
  const [engagement] = await db
    .insert(schema.engagements)
    .values({
      providerId: provider.id,
      clientId: c.id,
      title: `${tag} 2026 Individual Tax Return`,
      kind: 'individual_tax',
      taxYear: 2026,
      status: 'open',
    })
    .returning({ id: schema.engagements.id });

  const upload = randomUUID();
  const req = randomUUID();
  const deliverable = randomUUID();
  const now = new Date();
  // The checklist line behind the requested document; same id, as the import did.
  await db.insert(schema.requests).values({
    id: req,
    providerId: provider.id,
    clientId: c.id,
    engagementId: engagement.id,
    title: `${tag} Insurance Policy`,
    instructions: 'seeded request',
    category: 'Documents',
    required: true,
    status: 'requested',
    sortOrder: 0,
    importedFromDocumentId: req,
  });

  await db.insert(schema.documents).values([
    {
      id: upload,
      clientId: c.id,
      providerId: provider.id,
      name: `${tag} Bank Statement.pdf`,
      displayName: `${tag} Bank Statement.pdf`,
      category: 'Uploads',
      engagementId: engagement.id,
      kind: 'client_upload',
      uploadedByKind: 'client',
      uploadedById: c.id,
      ...FILE_FACTS,
    },
    {
      id: req,
      clientId: c.id,
      providerId: provider.id,
      name: `${tag} Insurance Policy`,
      displayName: `${tag} Insurance Policy`,
      category: 'Documents',
      engagementId: engagement.id,
      requestId: req,
      kind: 'client_upload',
    },
    {
      id: deliverable,
      clientId: c.id,
      providerId: provider.id,
      name: `${tag} Tax Return Draft.pdf`,
      displayName: `${tag} Tax Return Draft.pdf`,
      category: 'Reports',
      engagementId: engagement.id,
      kind: 'deliverable',
      // Shared: a deliverable the client can already see.
      sharedAt: now,
      sharedById: provider.id,
      uploadedByKind: 'provider',
      uploadedById: provider.id,
      ...FILE_FACTS,
    },
  ]);

  const uploadVersion = await insertVersion(upload, { kind: 'client', id: c.id }, `${tag} Bank Statement.pdf`);
  const deliverableVersion = await insertVersion(
    deliverable,
    { kind: 'provider', id: provider.id },
    `${tag} Tax Return Draft.pdf`
  );

  await db.insert(schema.activities).values({
    providerId: provider.id,
    clientId: c.id,
    type: 'document',
    description: 'seeded client activity',
    actorKind: 'client',
    actorId: c.id,
    actorName: name,
  });
  await enrollMfa('client', c.id);
  return {
    id: c.id,
    email,
    providerId: provider.id,
    upload,
    request: req,
    deliverable,
    engagement: engagement.id,
    uploadVersion,
    deliverableVersion,
  };
}

/** Two providers, three clients, and for each client an upload, an open request and a deliverable. */
export async function seedFixture(): Promise<Fixture> {
  const provider1 = await insertProvider('Provider One', 'p1@example.test');
  const provider2 = await insertProvider('Provider Two', 'p2@example.test');
  const client1a = await insertClient(provider1, 'Client 1A', 'c1a@example.test', '1A');
  const client1b = await insertClient(provider1, 'Client 1B', 'c1b@example.test', '1B');
  const client2a = await insertClient(provider2, 'Client 2A', 'c2a@example.test', '2A');

  const [m1] = await db
    .insert(schema.messages)
    .values({
      clientId: client1a.id,
      providerId: provider1.id,
      senderKind: 'client',
      senderId: client1a.id,
      senderName: 'Client 1A',
      content: 'seeded message from client',
    })
    .returning({ id: schema.messages.id });
  const [m2] = await db
    .insert(schema.messages)
    .values({
      clientId: client1a.id,
      providerId: provider1.id,
      senderKind: 'provider',
      senderId: provider1.id,
      senderName: 'Provider One',
      content: 'seeded message from provider',
    })
    .returning({ id: schema.messages.id });

  return {
    provider1,
    provider2,
    client1a,
    client1b,
    client2a,
    messages: { fromClient1a: m1.id, fromProvider1: m2.id },
  };
}

export function credentials(fx: Fixture, actor: LoggedInActor): { kind: 'provider' | 'client'; email: string } {
  switch (actor) {
    case 'provider1':
      return { kind: 'provider', email: fx.provider1.email };
    case 'provider2':
      return { kind: 'provider', email: fx.provider2.email };
    case 'client1a':
      return { kind: 'client', email: fx.client1a.email };
    case 'client1b':
      return { kind: 'client', email: fx.client1b.email };
    case 'client2a':
      return { kind: 'client', email: fx.client2a.email };
  }
}

/** The client record an actor *is*, or null for providers / anonymous. */
export function selfClient(fx: Fixture, actor: Actor): ClientFixture | null {
  if (actor === 'client1a') return fx.client1a;
  if (actor === 'client1b') return fx.client1b;
  if (actor === 'client2a') return fx.client2a;
  return null;
}

/** The provider an actor *is*, or null for clients / anonymous. */
export function selfProvider(fx: Fixture, actor: Actor): ProviderFixture | null {
  if (actor === 'provider1') return fx.provider1;
  if (actor === 'provider2') return fx.provider2;
  return null;
}

/** The kind + id an actor signs in as. */
export function identity(fx: Fixture, actor: LoggedInActor): { kind: 'provider' | 'client'; id: string } {
  const provider = selfProvider(fx, actor);
  if (provider) return { kind: 'provider', id: provider.id };
  return { kind: 'client', id: selfClient(fx, actor)!.id };
}

/** First step only: password login. Returns the pre-auth cookie and the response (`body.stage` says what is owed). */
export async function passwordLogin(fx: Fixture, actor: LoggedInActor): Promise<{ cookie: string; res: Response }> {
  const { kind, email } = credentials(fx, actor);
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD, kind });
  if (res.status !== 200) {
    throw new Error(`login failed for ${actor}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const header = res.headers['set-cookie'] as string[] | string | undefined;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) throw new Error(`login for ${actor} returned no Set-Cookie header`);
  return { cookie: raw.split(';')[0], res };
}

/** Forgets the last accepted TOTP step so the same code can be accepted again (test-only; the guard is covered in mfa.test.ts). */
export async function clearReplayGuard(fx: Fixture, actor: LoggedInActor) {
  const { kind, id } = identity(fx, actor);
  await db
    .update(schema.mfaTotp)
    .set({ lastUsedStep: null })
    .where(and(eq(schema.mfaTotp.userKind, kind), eq(schema.mfaTotp.userId, id)));
}

/**
 * Full sign-in through the real endpoints (password, then the authenticator
 * code) and the resulting `active` session cookie as `name=value`. The replay
 * guard is cleared first so one test can sign the same actor in twice inside
 * a single 30 s step.
 */
export async function loginAs(fx: Fixture, actor: LoggedInActor): Promise<string> {
  const { cookie, res } = await passwordLogin(fx, actor);
  if (res.body.stage !== 'preauth') {
    throw new Error(`expected a preauth session for ${actor}, got stage ${String(res.body.stage)}`);
  }
  await clearReplayGuard(fx, actor);
  const verify = await request(app).post('/api/auth/mfa/verify').set('Cookie', cookie).send({ code: totpCode() });
  if (verify.status !== 200 || verify.body.stage !== 'active') {
    throw new Error(`mfa verify failed for ${actor}: ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return cookie;
}

/** Collects a binary response body into a Buffer (superagent parses only text and JSON by default). */
export function binaryParser(res: Response, callback: (err: Error | null, body: Buffer) => void): void {
  // superagent hands the raw http.IncomingMessage to node parsers.
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
  stream.on('error', (err: Error) => callback(err, Buffer.alloc(0)));
}
