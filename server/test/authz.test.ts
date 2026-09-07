/**
 * Authorization matrix for every current API route.
 *
 * Each case lists the expected status for all six actors, following
 * docs/CPA-PILOT-PLAN.md: cross-tenant ids are 404 (never 403), clients cannot
 * review, delete or overwrite advisor material, storage paths are never
 * serialized. If a later commit knowingly breaks a case, list the actor in
 * `fails` (the case then runs as `it.fails`) and flip it back in the fix.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Response, Test } from 'supertest';
import {
  ACTORS,
  PASSWORD,
  PDF_BYTES,
  app,
  binaryParser,
  docIds,
  loginAs,
  request,
  seedFixture,
  selfClient,
  selfProvider,
  type Actor,
  type Fixture,
} from './helpers.js';

type Statuses = Record<Actor, number>;

interface Case {
  name: string;
  req: (fx: Fixture) => Test;
  expect: Statuses;
  /** Actors whose target expectation the current code does not meet yet (known defects). */
  fails?: Actor[];
  /** Restrict the case to these actors. */
  only?: Actor[];
  /** Extra assertions, run only on a 2xx response. */
  check?: (res: Response, fx: Fixture, actor: Actor) => void | Promise<void>;
}

const S = (p1: number, p2: number, c1a: number, c1b: number, c2a: number, anon: number): Statuses => ({
  provider1: p1,
  provider2: p2,
  client1a: c1a,
  client1b: c1b,
  client2a: c2a,
  anonymous: anon,
});

const CLIENTS: Actor[] = ['client1a', 'client1b', 'client2a'];

const attachPdf = (t: Test) =>
  t.attach('file', PDF_BYTES, { filename: 'upload.pdf', contentType: 'application/pdf' });

/**
 * The newest decision recorded against a document, read back through the API.
 *
 * Accept and request-correction used to be provable from their own response:
 * they overwrote `documents.status`, so the returned document said `reviewed`
 * or `needs_update`. C5.4 dropped that column — a decision is a row in
 * `reviews` now, and the document it describes is deliberately unchanged apart
 * from `updatedAt`. So the proof that the verb did something moved one request
 * away, to the history the advisor actually reads. Ordered newest-first by the
 * route, hence `[0]`.
 */
async function latestReview(fx: Fixture, actor: Actor, documentId: string) {
  // `check` only runs on a 2xx, and no anonymous actor has one on these rows —
  // if that ever changes, an unauthenticated advisor verb succeeded and this
  // should stop the suite rather than quietly log in as somebody.
  if (actor === 'anonymous') throw new Error('anonymous reached an advisor verb');
  const cookie = await loginAs(fx, actor);
  const res = await request(app).get(`/api/documents/${documentId}/reviews`).set('Cookie', cookie);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body[0];
}

const cases: Case[] = [
  /* ---------------------------------------------------------------- auth */
  {
    name: 'GET /api/auth/me',
    req: () => request(app).get('/api/auth/me'),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res, fx, actor) => {
      expect(res.body.me).not.toHaveProperty('passwordHash');
      expect(res.body.stage).toBe('active');
      const self = selfClient(fx, actor) ?? selfProvider(fx, actor);
      expect(res.body.me.id).toBe(self!.id);
    },
  },
  {
    name: 'GET /api/auth/mfa/status',
    req: () => request(app).get('/api/auth/mfa/status'),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res) => {
      expect(res.body).toMatchObject({ stage: 'active', enrolled: true, recoveryCodesLeft: 0 });
      expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
    },
  },
  {
    // Every fixture account is enrolled; re-enrollment is the admin's job (C1.3).
    name: 'POST /api/auth/mfa/enroll',
    req: () => request(app).post('/api/auth/mfa/enroll'),
    expect: S(409, 409, 409, 409, 409, 401),
  },
  {
    name: 'POST /api/auth/mfa/enroll/confirm',
    req: () => request(app).post('/api/auth/mfa/enroll/confirm').send({ code: '000000' }),
    expect: S(409, 409, 409, 409, 409, 401),
  },
  {
    // A wrong code is refused for everyone; the right code is exercised in mfa.test.ts.
    name: 'POST /api/auth/mfa/verify',
    req: () => request(app).post('/api/auth/mfa/verify').send({ code: '000000' }),
    expect: S(401, 401, 401, 401, 401, 401),
  },
  {
    name: 'POST /api/auth/mfa/recovery-codes',
    req: () => request(app).post('/api/auth/mfa/recovery-codes').send({ code: '000000' }),
    expect: S(401, 401, 401, 401, 401, 401),
  },
  {
    name: 'POST /api/auth/password',
    req: () => request(app).post('/api/auth/password').send({ currentPassword: PASSWORD, newPassword: 'a-fresh-password-2026' }),
    expect: S(200, 200, 200, 200, 200, 401),
    // The matrix actor holds exactly one session, so nothing else is there to revoke.
    check: (res) => expect(res.body.revoked).toBe(0),
  },
  {
    name: 'POST /api/auth/password-reset/request (always 202)',
    req: (fx) => request(app).post('/api/auth/password-reset/request').send({ email: fx.client1a.email, kind: 'client' }),
    expect: S(202, 202, 202, 202, 202, 202),
  },
  {
    name: 'POST /api/auth/password-reset/confirm (bogus token)',
    req: () => request(app).post('/api/auth/password-reset/confirm').send({ token: 'x'.repeat(43), password: 'a-fresh-password-2026' }),
    expect: S(400, 400, 400, 400, 400, 400),
  },
  {
    name: 'GET /api/invitations/:token (bogus token, public)',
    req: () => request(app).get(`/api/invitations/${'x'.repeat(43)}`),
    expect: S(404, 404, 404, 404, 404, 404),
  },
  {
    name: 'POST /api/invitations/:token/accept (bogus token, public)',
    req: () => request(app).post(`/api/invitations/${'x'.repeat(43)}/accept`).send({ password: 'a-fresh-password-2026' }),
    expect: S(404, 404, 404, 404, 404, 404),
  },
  {
    name: 'POST /api/auth/logout-all',
    req: () => request(app).post('/api/auth/logout-all'),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res) => expect(res.body.revoked).toBeGreaterThanOrEqual(1),
  },
  {
    name: 'GET /api/auth/sessions',
    req: () => request(app).get('/api/auth/sessions'),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res) => {
      expect(res.body).toHaveLength(1);
      expect(res.body[0].current).toBe(true);
      expect(res.body[0]).not.toHaveProperty('tokenHash');
    },
  },
  {
    name: 'POST /api/auth/logout (a stale tab can always sign out)',
    req: () => request(app).post('/api/auth/logout'),
    expect: S(200, 200, 200, 200, 200, 200),
  },
  {
    name: 'POST /api/auth/signup-provider is disabled unless ALLOW_PROVIDER_SIGNUP=true',
    req: () =>
      request(app)
        .post('/api/auth/signup-provider')
        .send({ name: 'Walk-in', email: 'walkin@example.test', password: 'walkin-pass-123' }),
    expect: S(403, 403, 403, 403, 403, 403),
  },

  /* ------------------------------------------------------------- clients */
  {
    name: 'GET /api/clients (provider only, tenant-scoped)',
    req: () => request(app).get('/api/clients'),
    expect: S(200, 200, 403, 403, 403, 401),
    check: (res, fx, actor) => {
      const ids = (res.body as { id: string }[]).map((c) => c.id).sort();
      const expected = actor === 'provider1' ? [fx.client1a.id, fx.client1b.id] : [fx.client2a.id];
      expect(ids).toEqual(expected.sort());
      for (const c of res.body) expect(c).not.toHaveProperty('passwordHash');
    },
  },
  {
    name: 'GET /api/clients/:id',
    req: (fx) => request(app).get(`/api/clients/${fx.client1a.id}`),
    expect: S(200, 404, 200, 404, 404, 401),
    check: (res) => expect(res.body).not.toHaveProperty('passwordHash'),
  },
  {
    name: 'POST /api/clients/:id/invitations (own client)',
    req: (fx) => request(app).post(`/api/clients/${fx.client1a.id}/invitations`),
    expect: S(201, 404, 403, 403, 403, 401),
    check: (res) => {
      expect(res.body.link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
      expect(res.body.emailQueued).toBe(false);
    },
  },
  {
    name: 'POST /api/clients/:id/password-reset (own client)',
    req: (fx) => request(app).post(`/api/clients/${fx.client1a.id}/password-reset`),
    expect: S(200, 404, 403, 403, 403, 401),
    check: (res) => expect(res.body.link).toMatch(/\/reset\/[A-Za-z0-9_-]{43}$/),
  },
  {
    name: 'POST /api/clients/:id/deactivate (own client)',
    req: (fx) => request(app).post(`/api/clients/${fx.client1a.id}/deactivate`),
    expect: S(200, 404, 403, 403, 403, 401),
    check: (res) => {
      expect(res.body.deactivatedAt).not.toBeNull();
      expect(res.body).not.toHaveProperty('passwordHash');
    },
  },
  {
    name: 'POST /api/clients/:id/reactivate (own client)',
    req: (fx) => request(app).post(`/api/clients/${fx.client1a.id}/reactivate`),
    expect: S(200, 404, 403, 403, 403, 401),
    check: (res) => expect(res.body.deactivatedAt).toBeNull(),
  },
  {
    name: 'POST /api/clients',
    req: () => request(app).post('/api/clients').send({ name: 'New Client', email: 'new.client@example.test' }),
    expect: S(201, 201, 403, 403, 403, 401),
    check: (res, fx, actor) => expect(res.body.providerId).toBe(selfProvider(fx, actor)!.id),
  },
  {
    name: 'PATCH /api/clients/:id',
    req: (fx) => request(app).patch(`/api/clients/${fx.client1a.id}`).send({ name: 'Renamed' }),
    expect: S(200, 404, 403, 403, 403, 401),
  },

  /* ----------------------------------------------------------- documents */
  {
    name: 'GET /api/documents is tenant-scoped',
    req: () => request(app).get('/api/documents'),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res, fx, actor) => {
      const ids = (res.body as { id: string }[]).map((d) => d.id).sort();
      const expected =
        actor === 'provider1'
          ? [...docIds(fx.client1a), ...docIds(fx.client1b)]
          : actor === 'provider2'
            ? docIds(fx.client2a)
            : docIds(selfClient(fx, actor)!);
      expect(ids).toEqual(expected.sort());
    },
  },
  {
    name: 'GET /api/documents never serializes storagePath',
    req: () => request(app).get('/api/documents'),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res) => {
      for (const d of res.body) {
        expect(d).not.toHaveProperty('storagePath');
        expect(typeof d.hasFile).toBe('boolean');
      }
    },
  },
  {
    name: 'GET /api/documents/:id',
    req: (fx) => request(app).get(`/api/documents/${fx.client1a.upload}`),
    expect: S(200, 404, 200, 404, 404, 401),
  },
  {
    name: 'GET /api/documents/:id never serializes storagePath',
    req: (fx) => request(app).get(`/api/documents/${fx.client1a.upload}`),
    expect: S(200, 404, 200, 404, 404, 401),
    only: ['provider1', 'client1a'],
    check: (res) => {
      expect(res.body).not.toHaveProperty('storagePath');
      expect(res.body.hasFile).toBe(true);
    },
  },
  {
    name: 'GET /api/documents/:id/download (client upload)',
    req: (fx) =>
      request(app).get(`/api/documents/${fx.client1a.upload}/download`).buffer(true).parse(binaryParser),
    expect: S(200, 404, 200, 404, 404, 401),
    check: (res) => {
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^inline;/);
      expect(Buffer.from(res.body as Buffer).equals(PDF_BYTES)).toBe(true);
    },
  },
  {
    name: 'GET /api/documents/:id/download (advisor deliverable)',
    req: (fx) =>
      request(app)
        .get(`/api/documents/${fx.client1a.deliverable}/download?disposition=attachment`)
        .buffer(true)
        .parse(binaryParser),
    expect: S(200, 404, 200, 404, 404, 401),
    check: (res) => {
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(Buffer.from(res.body as Buffer).equals(PDF_BYTES)).toBe(true);
    },
  },
  {
    // Removed in C5.4. No screen had called it since C4.1, and it was the last
    // route that wrote the legacy columns. One row rather than silence, as C3.2
    // did for /presets: a compatibility route that quietly comes back is how a
    // legacy surface survives forever. 404 for every actor who got far enough to
    // be told anything — including the advisor, and including a document they
    // can otherwise see.
    //
    // Anonymous is 401, not the 404 /presets gives: `/api/presets` has no mount
    // at all so it falls straight to the app's 404, while this path is under
    // `/api/documents`, whose router authenticates before routing. Every other
    // document row here ends in 401 for the same reason. Nothing leaks either
    // way — the answer is identical for a path that never existed.
    name: 'POST /api/documents/:id/file (removed in C5.4 — uploads create versions)',
    req: (fx) => attachPdf(request(app).post(`/api/documents/${fx.client1a.request}/file`)),
    expect: S(404, 404, 404, 404, 404, 401),
  },
  {
    name: 'POST /api/documents (create for a client)',
    req: (fx) => request(app).post('/api/documents').send({ clientId: fx.client1a.id, name: 'Adhoc.pdf' }),
    expect: S(201, 404, 201, 404, 404, 401),
    check: (res, fx) => {
      expect(res.body.clientId).toBe(fx.client1a.id);
      expect(res.body.providerId).toBe(fx.provider1.id);
      expect(res.body.hasFile).toBe(false);
      // The contracted shape: none of the columns 0008_contract dropped.
      for (const gone of ['storagePath', 'folder', 'isRequested', 'status', 'type', 'size', 'url']) {
        expect(res.body).not.toHaveProperty(gone);
      }
    },
  },
  {
    name: 'PATCH /api/documents/:id (filing is advisor-only)',
    req: (fx) => request(app).patch(`/api/documents/${fx.client1a.upload}`).send({ displayName: 'Renamed by the advisor' }),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body.displayName).toBe('Renamed by the advisor'),
  },
  {
    // C3.4 closed the legacy door: the advisor who owns the row is refused too,
    // and told where the decision actually lives. Role checks still come first,
    // so everyone else gets the same answer they got before.
    name: 'PATCH /api/documents/:id with a legacy review field (removed in C3.4)',
    req: (fx) => request(app).patch(`/api/documents/${fx.client1a.upload}`).send({ status: 'reviewed' }),
    // Every actor runs: the point is that the role checks still come first, so a
    // closed door does not become a way to find out which ids exist. The body's
    // `use_review_actions` code is asserted in documents.test.ts (check() here
    // only runs on a 2xx).
    expect: S(400, 404, 403, 404, 404, 401),
  },
  {
    name: 'DELETE /api/documents/:id (advisor deliverable)',
    req: (fx) => request(app).delete(`/api/documents/${fx.client1a.deliverable}`),
    expect: S(200, 404, 403, 404, 404, 401),
  },
  {
    name: 'DELETE /api/documents/:id (client upload — clients never delete)',
    req: (fx) => request(app).delete(`/api/documents/${fx.client1a.upload}`),
    expect: S(200, 404, 403, 404, 404, 401),
  },

  /* ------------------------------------------------------------ messages */
  {
    name: 'GET /api/messages?clientId= (clients are self-scoped regardless of the param)',
    req: (fx) => request(app).get(`/api/messages?clientId=${fx.client1a.id}`),
    expect: S(200, 404, 200, 200, 200, 401),
    check: (res, fx, actor) => {
      const list = res.body as { id: string; clientId: string }[];
      if (actor === 'provider1' || actor === 'client1a') {
        expect(list.map((m) => m.id).sort()).toEqual(
          [fx.messages.fromClient1a, fx.messages.fromProvider1].sort()
        );
      } else {
        expect(list).toHaveLength(0);
      }
      const self = selfClient(fx, actor);
      if (self) for (const m of list) expect(m.clientId).toBe(self.id);
    },
  },
  {
    name: 'GET /api/messages without clientId (providers must scope)',
    req: () => request(app).get('/api/messages'),
    expect: S(400, 400, 200, 200, 200, 401),
  },
  {
    name: 'POST /api/messages',
    req: (fx) => request(app).post('/api/messages').send({ clientId: fx.client1a.id, content: 'hello' }),
    expect: S(201, 404, 201, 201, 201, 401),
    check: (res, fx, actor) => {
      const self = selfClient(fx, actor);
      expect(res.body.clientId).toBe(self ? self.id : fx.client1a.id);
      expect(res.body.providerId).toBe(self ? self.providerId : fx.provider1.id);
    },
  },
  {
    name: 'PATCH /api/messages/read',
    req: (fx) => request(app).patch('/api/messages/read').send({ clientId: fx.client1a.id }),
    expect: S(200, 404, 200, 200, 200, 401),
    check: (res, _fx, actor) => {
      // Only the two parties of client1a's thread have anything to mark.
      const expected = actor === 'provider1' || actor === 'client1a' ? 1 : 0;
      expect(res.body.updated).toBe(expected);
    },
  },

  /* ---------------------------------------------------------- activities */
  {
    name: 'GET /api/activities is tenant-scoped',
    req: () => request(app).get('/api/activities'),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res, fx, actor) => {
      const list = res.body as { providerId: string; clientId: string | null }[];
      expect(list.length).toBeGreaterThan(0);
      const provider = selfProvider(fx, actor);
      const client = selfClient(fx, actor);
      for (const a of list) {
        if (provider) expect(a.providerId).toBe(provider.id);
        if (client) expect(a.clientId).toBe(client.id);
      }
    },
  },
  {
    name: "GET /api/activities?clientId= for another tenant's client returns nothing",
    req: (fx) => request(app).get(`/api/activities?clientId=${fx.client1a.id}`),
    expect: S(200, 200, 200, 200, 200, 401),
    only: ['provider2'],
    check: (res) => expect(res.body).toHaveLength(0),
  },

  /* ------------------- presets: removed in C3.2, and staying removed */
  {
    // The shim existed only so the old Settings screen kept working while the
    // data moved to request_templates. The templates editor replaced that
    // screen, so the route is gone — 404 for everyone, including the advisor
    // who used to own it. A row here rather than silence: a compatibility
    // route that quietly comes back is how a legacy surface survives forever.
    name: 'GET /api/presets (removed in C3.2 — templates replaced it)',
    req: () => request(app).get('/api/presets'),
    expect: S(404, 404, 404, 404, 404, 404),
  },

  /* --------------------------------------------------------- engagements */
  {
    name: 'GET /api/engagements (advisor sees the firm, client sees their own)',
    req: () => request(app).get('/api/engagements'),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res, fx, actor) => {
      const rows = res.body as Array<{ id: string; clientId: string; providerId: string }>;
      const self = selfClient(fx, actor);
      if (self) expect(rows.every((r) => r.clientId === self.id)).toBe(true);
      else expect(rows.every((r) => r.providerId === selfProvider(fx, actor)!.id)).toBe(true);
    },
  },
  {
    name: 'GET /api/engagements/:id (tree)',
    req: (fx) => request(app).get(`/api/engagements/${fx.client1a.engagement}`),
    expect: S(200, 404, 200, 404, 404, 401),
    check: (res, fx) => {
      expect(res.body.engagement.id).toBe(fx.client1a.engagement);
      expect(res.body.requests).toHaveLength(1);
      // Storage details never travel, on any nested shape.
      expect(JSON.stringify(res.body)).not.toMatch(/storagePath|storageKey|sha256/);
    },
  },
  {
    name: 'POST /api/engagements',
    req: (fx) => request(app).post('/api/engagements').send({ clientId: fx.client1a.id, title: '2027 return', kind: 'individual_tax' }),
    expect: S(201, 404, 403, 403, 403, 401),
  },
  {
    name: 'PATCH /api/engagements/:id',
    req: (fx) => request(app).patch(`/api/engagements/${fx.client1a.engagement}`).send({ title: 'Renamed' }),
    expect: S(200, 404, 403, 404, 404, 401),
  },
  {
    name: 'POST /api/engagements/:id/close',
    req: (fx) => request(app).post(`/api/engagements/${fx.client1a.engagement}/close`),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body.status).toBe('closed'),
  },
  {
    name: 'POST /api/engagements/:id/reopen',
    req: (fx) => request(app).post(`/api/engagements/${fx.client1a.engagement}/reopen`),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body.status).toBe('open'),
  },
  {
    name: 'POST /api/engagements/:id/requests (explicit items)',
    req: (fx) =>
      request(app)
        .post(`/api/engagements/${fx.client1a.engagement}/requests`)
        .send({ items: [{ title: 'Prior-year return', category: 'Reference' }] }),
    expect: S(201, 404, 403, 404, 404, 401),
    check: (res) => {
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ status: 'requested', title: 'Prior-year return' });
      // Appended after the seeded line rather than renumbering it.
      expect(res.body[0].sortOrder).toBe(1);
    },
  },

  /* ------------------------------------------------------------ requests */
  {
    name: 'GET /api/requests/:id',
    req: (fx) => request(app).get(`/api/requests/${fx.client1a.request}`),
    expect: S(200, 404, 200, 404, 404, 401),
    check: (res) => expect(res.body).toMatchObject({ status: 'requested', overdue: false }),
  },
  {
    name: 'PATCH /api/requests/:id (wording only)',
    req: (fx) => request(app).patch(`/api/requests/${fx.client1a.request}`).send({ instructions: 'Any month will do' }),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body.instructions).toBe('Any month will do'),
  },
  {
    // Nothing has been submitted against the seeded request, so there is nothing to accept.
    name: 'POST /api/requests/:id/accept (nothing submitted yet)',
    req: (fx) => request(app).post(`/api/requests/${fx.client1a.request}/accept`),
    expect: S(400, 404, 403, 404, 404, 401),
  },
  {
    name: 'POST /api/requests/:id/waive (reason required)',
    req: (fx) => request(app).post(`/api/requests/${fx.client1a.request}/waive`).send({ reason: 'Client has no mortgage' }),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body).toMatchObject({ status: 'waived', waivedReason: 'Client has no mortgage' }),
  },
  {
    name: 'POST /api/requests/:id/reopen',
    req: (fx) => request(app).post(`/api/requests/${fx.client1a.request}/reopen`),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body.status).toBe('requested'),
  },
  {
    // The mirror image of the advisor verbs: the client answers, the advisor cannot answer for them.
    name: 'POST /api/requests/:id/respond (the client answers)',
    req: (fx) => request(app).post(`/api/requests/${fx.client1a.request}/respond`).send({ kind: 'not_applicable', note: 'I rent' }),
    expect: S(403, 404, 200, 404, 404, 401),
    check: (res) => {
      expect(res.body.clientResponseKind).toBe('not_applicable');
      // A response is not a decision: the line stays on the advisor's list.
      expect(res.body.status).toBe('requested');
    },
  },

  /* ------------------------------------------------- documents (workflow) */
  {
    name: 'GET /api/documents/:id/versions',
    req: (fx) => request(app).get(`/api/documents/${fx.client1a.upload}/versions`),
    expect: S(200, 404, 200, 404, 404, 401),
    check: (res, fx) => {
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ versionNo: 1, isCurrent: true, available: true });
      expect(res.body[0].id).toBe(fx.client1a.uploadVersion);
      expect(res.body[0]).not.toHaveProperty('storageKey');
      expect(res.body[0]).not.toHaveProperty('sha256');
    },
  },
  {
    name: 'GET /api/documents/:id/reviews',
    req: (fx) => request(app).get(`/api/documents/${fx.client1a.upload}/reviews`),
    expect: S(200, 404, 200, 404, 404, 401),
    check: (res) => expect(res.body).toEqual([]),
  },
  {
    name: 'POST /api/documents/:id/accept (ad-hoc upload)',
    req: (fx) => request(app).post(`/api/documents/${fx.client1a.upload}/accept`),
    expect: S(200, 404, 403, 404, 404, 401),
    check: async (_res, fx, actor) =>
      expect(await latestReview(fx, actor, fx.client1a.upload)).toMatchObject({
        decision: 'accepted',
        versionId: fx.client1a.uploadVersion,
      }),
  },
  {
    name: 'POST /api/documents/:id/request-correction (note required)',
    req: (fx) => request(app).post(`/api/documents/${fx.client1a.upload}/request-correction`).send({ note: 'Page 2 is missing' }),
    expect: S(200, 404, 403, 404, 404, 401),
    // The note is the whole point of the verb — the client reads it — so it is
    // asserted here rather than only its presence.
    check: async (_res, fx, actor) =>
      expect(await latestReview(fx, actor, fx.client1a.upload)).toMatchObject({
        decision: 'needs_correction',
        note: 'Page 2 is missing',
      }),
  },
  {
    name: 'POST /api/documents/:id/unshare (deliverable)',
    req: (fx) => request(app).post(`/api/documents/${fx.client1a.deliverable}/unshare`),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body.shared).toBe(false),
  },
  {
    name: 'POST /api/documents/:id/share (deliverable)',
    req: (fx) => request(app).post(`/api/documents/${fx.client1a.deliverable}/share`),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body.shared).toBe(true),
  },
  {
    name: 'POST /api/documents/:id/archive',
    req: (fx) => request(app).post(`/api/documents/${fx.client1a.upload}/archive`),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body.archivedAt).not.toBeNull(),
  },
  {
    name: 'POST /api/documents/:id/unarchive',
    req: (fx) => request(app).post(`/api/documents/${fx.client1a.upload}/unarchive`),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body.archivedAt).toBeNull(),
  },

  /* ------------------------------------------------------------ delivery */
  {
    name: 'GET /api/documents/:id/versions/:vid/download',
    req: (fx) =>
      request(app)
        .get(`/api/documents/${fx.client1a.upload}/versions/${fx.client1a.uploadVersion}/download`)
        .buffer(true)
        .parse(binaryParser),
    expect: S(200, 404, 200, 404, 404, 401),
    check: (res) => {
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.from(res.body as Buffer).equals(PDF_BYTES)).toBe(true);
    },
  },
  {
    name: 'GET /api/documents/:id/versions/:vid/preview',
    req: (fx) =>
      request(app)
        .get(`/api/documents/${fx.client1a.upload}/versions/${fx.client1a.uploadVersion}/preview`)
        .buffer(true)
        .parse(binaryParser),
    expect: S(200, 404, 200, 404, 404, 401),
    check: (res) => {
      expect(res.headers['content-disposition']).toMatch(/^inline;/);
      // Rendered in a browser with a live session: nothing in it may act.
      expect(res.headers['content-security-policy']).toBe('sandbox');
      expect(res.headers['content-type']).toBe('application/pdf');
    },
  },
  {
    // The advisor's own deliverable, which the fixture leaves shared.
    name: 'GET /api/documents/:id/versions/:vid/download (deliverable)',
    req: (fx) =>
      request(app)
        .get(`/api/documents/${fx.client1a.deliverable}/versions/${fx.client1a.deliverableVersion}/download`)
        .buffer(true)
        .parse(binaryParser),
    expect: S(200, 404, 200, 404, 404, 401),
  },

  /* ------------------------------------------------------------- uploads */
  {
    // Only the client answers their own checklist line; a foreign id is 404,
    // and nothing is ever staged before that is decided.
    name: 'POST /api/requests/:id/uploads',
    req: (fx) => attachPdf(request(app).post(`/api/requests/${fx.client1a.request}/uploads`)),
    expect: S(403, 404, 202, 404, 404, 401),
    check: (res) => {
      // SCAN_REQUIRED=false in tests: stored, honestly not published.
      expect(res.body.scanStatus).toBe('pending');
      expect(res.body.version.available).toBe(false);
      expect(res.body.version).not.toHaveProperty('storageKey');
    },
  },
  {
    name: 'POST /api/engagements/:id/uploads (ad-hoc, either side)',
    req: (fx) => attachPdf(request(app).post(`/api/engagements/${fx.client1a.engagement}/uploads`)),
    expect: S(202, 404, 202, 404, 404, 401),
    check: (res, fx, actor) => {
      // An advisor filing into an engagement is producing a deliverable.
      expect(res.body.document.kind).toBe(actor === 'provider1' ? 'deliverable' : 'client_upload');
    },
  },
  {
    name: 'POST /api/documents/:id/versions (own upload)',
    req: (fx) => attachPdf(request(app).post(`/api/documents/${fx.client1a.upload}/versions`)),
    expect: S(202, 404, 202, 404, 404, 401),
    check: (res) => expect(res.body.version.versionNo).toBe(2),
  },
  {
    name: 'POST /api/documents/:id/versions (client cannot revise a deliverable)',
    req: (fx) => attachPdf(request(app).post(`/api/documents/${fx.client1a.deliverable}/versions`)),
    expect: S(202, 404, 403, 404, 404, 401),
  },

  /* ----------------------------------------------------------- templates */
  {
    name: 'GET /api/templates (starters seeded on first read)',
    req: () => request(app).get('/api/templates'),
    expect: S(200, 200, 403, 403, 403, 401),
    check: (res, fx, actor) => {
      const rows = res.body as Array<{ providerId: string; kind: string; items: unknown[] }>;
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.kind).sort()).toEqual(['business_tax', 'individual_tax']);
      expect(rows.every((r) => r.providerId === selfProvider(fx, actor)!.id)).toBe(true);
      expect(rows.every((r) => r.items.length >= 10)).toBe(true);
    },
  },
  {
    name: 'POST /api/templates',
    req: () =>
      request(app)
        .post('/api/templates')
        .send({ name: 'Quarterly pack', items: [{ key: 'pnl', title: 'Profit and loss' }] }),
    expect: S(201, 201, 403, 403, 403, 401),
  },

  /* ---------------------------------------------------- dashboard, search */
  {
    name: 'GET /api/dashboard',
    req: () => request(app).get('/api/dashboard'),
    expect: S(200, 200, 403, 403, 403, 401),
    check: (res, fx, actor) => {
      // provider1 has two clients, provider2 one — each with one open request.
      const expected = actor === 'provider1' ? 2 : 1;
      expect(res.body.waitingOnClients.count).toBe(expected);
      expect(res.body.readyToReview.count).toBe(0);
      expect(res.body.overdue.count).toBe(0);
      expect(res.body.needsDecision.count).toBe(0);
    },
  },
  {
    name: 'GET /api/search?q=',
    req: () => request(app).get('/api/search?q=Insurance'),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res, fx, actor) => {
      const self = selfClient(fx, actor);
      const docs = res.body.documents as Array<{ clientId: string }>;
      if (self) expect(docs.every((d) => d.clientId === self.id)).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/storagePath|storageKey|sha256/);
    },
  },
  {
    name: 'GET /api/notifications',
    req: () => request(app).get('/api/notifications'),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res) => expect(res.body).toEqual({ unread: 0, notifications: [] }),
  },
  {
    name: 'POST /api/notifications/read',
    req: () => request(app).post('/api/notifications/read').send({}),
    expect: S(200, 200, 200, 200, 200, 401),
    check: (res) => expect(res.body).toEqual({ ok: true, marked: 0 }),
  },

  /* ----------------------------------------------------------------- ops */
  {
    // Queue depth and mail configuration are the firm's business, not a client's.
    name: 'GET /api/ops/status',
    req: () => request(app).get('/api/ops/status'),
    expect: S(200, 200, 403, 403, 403, 401),
    check: (res) => {
      expect(res.body.jobs).toMatchObject({ pending: 0, running: 0, failed: 0, done: 0 });
      expect(res.body.mail.configured).toBe(false);
      // Counts and configuration only: never the connection string behind them.
      expect(Object.keys(res.body.mail).sort()).toEqual(['configured', 'note']);
      expect(JSON.stringify(res.body)).not.toMatch(/smtps?:\/\//i);
      // v2 (C5.2): the panel's five questions, and no client or document in sight.
      expect(res.body).toHaveProperty('storage.path');
      expect(res.body).toHaveProperty('backups.lastGoodAt');
      expect(res.body).toHaveProperty('health.activeSessions');
      expect(res.body).toHaveProperty('scanner.signaturesAt');
      expect(res.body.health.activeSessions).toBeGreaterThan(0);
    },
  },
];

describe('authorization matrix', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  for (const c of cases) {
    describe(c.name, () => {
      for (const actor of ACTORS) {
        if (c.only && !c.only.includes(actor)) continue;
        const expected = c.expect[actor];
        const runner = c.fails?.includes(actor) ? it.fails : it;
        runner(`${actor} → ${expected}`, async () => {
          const cookie = actor === 'anonymous' ? null : await loginAs(fx, actor);
          const t = c.req(fx);
          if (cookie) t.set('Cookie', cookie);
          const res = await t;
          expect(res.status, JSON.stringify(res.body)).toBe(expected);
          if (res.status < 300 && c.check) await c.check(res, fx, actor);
        });
      }
    });
  }

  it('has no case left running as an expected failure', () => {
    expect(cases.filter((c) => c.fails && c.fails.length > 0).map((c) => c.name)).toEqual([]);
    expect(CLIENTS.every((a) => ACTORS.includes(a))).toBe(true);
  });
});
