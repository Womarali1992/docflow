/**
 * Shared test fixtures: two providers, three clients (two under provider 1, one
 * under provider 2), and for every client one uploaded file, one open request
 * and one advisor deliverable. Recreated before every test by the caller.
 */
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Response } from 'supertest';
import app from '../src/app.js';
import { db, schema } from '../src/db/client.js';
import { humanSize, storedFileName, writeStoredFileSync } from '../src/storage.js';

export { app };

export const PASSWORD = 'test-password-123';
// Low cost on purpose: fixtures are rebuilt before every test.
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n% docflow test fixture\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'
);

export const ACTORS = ['provider1', 'provider2', 'client1a', 'client1b', 'client2a', 'anonymous'] as const;
export type Actor = (typeof ACTORS)[number];
export type LoggedInActor = Exclude<Actor, 'anonymous'>;

export interface ProviderFixture {
  id: string;
  email: string;
  preset: string;
}

export interface ClientFixture {
  id: string;
  email: string;
  providerId: string;
  /** A file the client uploaded (folder "Uploads", has bytes on disk). */
  upload: string;
  /** An open request from the advisor (no file yet). */
  request: string;
  /** An advisor deliverable (folder "Reports", has bytes on disk). */
  deliverable: string;
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
  const [preset] = await db
    .insert(schema.presets)
    .values({
      providerId: p.id,
      name: `${name} preset`,
      bins: [{ id: 'b1', label: 'Monthly', items: [{ name: 'Bank Statement' }] }],
    })
    .returning({ id: schema.presets.id });
  await db.insert(schema.activities).values({
    providerId: p.id,
    type: 'update',
    description: 'seeded provider activity',
    actorKind: 'provider',
    actorId: p.id,
    actorName: name,
  });
  return { id: p.id, email, preset: preset.id };
}

function storedFile(id: string) {
  const fileName = storedFileName(id, 'application/pdf');
  writeStoredFileSync(fileName, PDF_BYTES);
  return {
    storagePath: fileName,
    mimeType: 'application/pdf',
    sizeBytes: PDF_BYTES.length,
    size: humanSize(PDF_BYTES.length),
    url: `/api/documents/${id}/download`,
  };
}

async function insertClient(
  provider: ProviderFixture,
  name: string,
  email: string,
  tag: string
): Promise<ClientFixture> {
  const [c] = await db
    .insert(schema.clients)
    .values({ providerId: provider.id, name, email, passwordHash: PASSWORD_HASH, accountId: `CL-${tag}` })
    .returning({ id: schema.clients.id });

  const upload = randomUUID();
  const req = randomUUID();
  const deliverable = randomUUID();
  await db.insert(schema.documents).values([
    {
      id: upload,
      clientId: c.id,
      providerId: provider.id,
      name: `${tag} Bank Statement.pdf`,
      type: 'pdf',
      folder: 'Uploads',
      uploadedByKind: 'client',
      uploadedById: c.id,
      status: 'pending',
      ...storedFile(upload),
    },
    {
      id: req,
      clientId: c.id,
      providerId: provider.id,
      name: `${tag} Insurance Policy`,
      type: 'pdf',
      folder: 'Documents',
      isRequested: true,
      requestedById: provider.id,
      requestedAt: new Date(),
      description: 'seeded request',
    },
    {
      id: deliverable,
      clientId: c.id,
      providerId: provider.id,
      name: `${tag} Tax Return Draft.pdf`,
      type: 'pdf',
      folder: 'Reports',
      uploadedByKind: 'provider',
      uploadedById: provider.id,
      ...storedFile(deliverable),
    },
  ]);
  await db.insert(schema.activities).values({
    providerId: provider.id,
    clientId: c.id,
    type: 'document',
    description: 'seeded client activity',
    actorKind: 'client',
    actorId: c.id,
    actorName: name,
  });
  return { id: c.id, email, providerId: provider.id, upload, request: req, deliverable };
}

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

/** Log in through the real endpoint and return the session cookie as `name=value`. */
export async function loginAs(fx: Fixture, actor: LoggedInActor): Promise<string> {
  const { kind, email } = credentials(fx, actor);
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD, kind });
  if (res.status !== 200) {
    throw new Error(`login failed for ${actor}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const header = res.headers['set-cookie'] as string[] | string | undefined;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) throw new Error(`login for ${actor} returned no Set-Cookie header`);
  return raw.split(';')[0];
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
