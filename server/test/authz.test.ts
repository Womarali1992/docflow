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
    name: 'POST /api/documents/:id/file fulfils an open request',
    req: (fx) => attachPdf(request(app).post(`/api/documents/${fx.client1a.request}/file`)),
    expect: S(200, 404, 200, 404, 404, 401),
    check: (res) => {
      expect(res.body.isRequested).toBe(false);
      expect(res.body.status).toBe('pending');
      expect(res.body.hasFile).toBe(true);
      expect(res.body).not.toHaveProperty('storagePath');
    },
  },
  {
    name: 'POST /api/documents/:id/file cannot overwrite an advisor deliverable as a client',
    req: (fx) => attachPdf(request(app).post(`/api/documents/${fx.client1a.deliverable}/file`)),
    expect: S(200, 404, 403, 404, 404, 401),
  },
  {
    name: 'POST /api/documents (create for a client)',
    req: (fx) => request(app).post('/api/documents').send({ clientId: fx.client1a.id, name: 'Adhoc.pdf' }),
    expect: S(201, 404, 201, 404, 404, 401),
    check: (res, fx) => {
      expect(res.body.clientId).toBe(fx.client1a.id);
      expect(res.body.providerId).toBe(fx.provider1.id);
      expect(res.body.hasFile).toBe(false);
    },
  },
  {
    name: 'PATCH /api/documents/:id (review state is advisor-only)',
    req: (fx) => request(app).patch(`/api/documents/${fx.client1a.upload}`).send({ status: 'reviewed' }),
    expect: S(200, 404, 403, 404, 404, 401),
    check: (res) => expect(res.body.status).toBe('reviewed'),
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

  /* ------------------------------------------------------------- presets */
  {
    name: 'GET /api/presets (provider only, tenant-scoped)',
    req: () => request(app).get('/api/presets'),
    expect: S(200, 200, 403, 403, 403, 401),
    check: (res, fx, actor) => {
      const ids = (res.body as { id: string }[]).map((p) => p.id);
      expect(ids).toEqual([selfProvider(fx, actor)!.preset]);
    },
  },
  {
    name: 'POST /api/presets',
    req: () =>
      request(app)
        .post('/api/presets')
        .send({ name: 'Quarterly pack', bins: [{ id: 'b1', label: 'Quarterly', items: [{ name: 'P&L' }] }] }),
    expect: S(201, 201, 403, 403, 403, 401),
  },
  {
    name: 'DELETE /api/presets/:id',
    req: (fx) => request(app).delete(`/api/presets/${fx.provider1.preset}`),
    expect: S(200, 404, 403, 403, 403, 401),
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
