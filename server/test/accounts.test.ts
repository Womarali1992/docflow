/**
 * Invitations, password resets and changes, deactivation, password hashing
 * (plan: Data model → invitations / password_resets; invariant 7 revocation
 * paths; Security design → Passwords; R12, R13).
 */
import express from 'express';
import supertest from 'supertest';
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { INVITATION_TTL_MS } from '../src/auth/invitations.js';
import { RESET_TTL_MS } from '../src/auth/resets.js';
import { hashToken } from '../src/auth/sessions.js';
import { createLookupLimiter } from '../src/security/limits.js';
import { PASSWORD, app, loginAs, passwordLogin, request, seedFixture, type Fixture } from './helpers.js';

const NEW_PASSWORD = 'a-fresh-password-2026';
const SHORT_PASSWORD = 'too-short';
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const me = (cookie: string) => request(app).get('/api/auth/me').set('Cookie', cookie);
const tokenOf = (link: string) => link.split('/').pop()!;
const login = (email: string, password: string, kind: 'provider' | 'client') =>
  request(app).post('/api/auth/login').send({ email, password, kind });
const cookieOf = (res: { headers: Record<string, string | string[] | undefined> }) => {
  const h = res.headers['set-cookie'];
  const first = Array.isArray(h) ? h[0] : h;
  if (!first) throw new Error('no Set-Cookie header');
  return first.split(';')[0];
};

async function newClient(advisor: string, email: string) {
  const res = await request(app).post('/api/clients').set('Cookie', advisor).send({ name: 'Fresh Client', email });
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ hasPassword: false, invitePendingUntil: null, deactivatedAt: null });
  return res.body as { id: string; email: string };
}

async function clientRow(advisor: string, id: string) {
  const res = await request(app).get(`/api/clients/${id}`).set('Cookie', advisor);
  expect(res.status).toBe(200);
  return res.body as { hasPassword: boolean; invitePendingUntil: string | null; deactivatedAt: string | null };
}

describe('invitations', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('an advisor gets a link for their own client; the link names the parties and only its hash is stored', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const fresh = await newClient(advisor, 'fresh@example.test');

    const before = Date.now();
    const res = await request(app).post(`/api/clients/${fresh.id}/invitations`).set('Cookie', advisor);
    expect(res.status).toBe(201);
    expect(res.body.link).toMatch(/^http:\/\/localhost:8080\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(res.body.emailQueued).toBe(false);
    const expiresAt = new Date(res.body.expiresAt).getTime();
    expect(expiresAt - before).toBeGreaterThan(INVITATION_TTL_MS - 5_000);
    expect(expiresAt - before).toBeLessThanOrEqual(INVITATION_TTL_MS + 5_000);

    const token = tokenOf(res.body.link);
    const rows = await db.select().from(schema.invitations).where(eq(schema.invitations.clientId, fresh.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(rows[0].tokenHash).not.toContain(token);
    expect(rows[0].createdById).toBe(fx.provider1.id);

    expect((await clientRow(advisor, fresh.id)).invitePendingUntil).not.toBeNull();

    const info = await request(app).get(`/api/invitations/${token}`);
    expect(info.status).toBe(200);
    expect(info.body).toEqual({
      clientName: 'Fresh Client',
      email: 'fresh@example.test',
      providerName: 'Provider One',
      firmName: 'Provider One CPA',
      expiresAt: res.body.expiresAt,
    });

    // Not my client → indistinguishable from a missing one.
    const other = await loginAs(fx, 'provider2');
    expect((await request(app).post(`/api/clients/${fresh.id}/invitations`).set('Cookie', other)).status).toBe(404);
  });

  it('accepting sets the password once, opens an enrollment session, and the client can then sign in', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const fresh = await newClient(advisor, 'fresh@example.test');
    const { body } = await request(app).post(`/api/clients/${fresh.id}/invitations`).set('Cookie', advisor);
    const token = tokenOf(body.link);

    const weak = await request(app).post(`/api/invitations/${token}/accept`).send({ password: SHORT_PASSWORD });
    expect(weak.status).toBe(400);
    expect((await clientRow(advisor, fresh.id)).hasPassword).toBe(false);

    const accepted = await request(app).post(`/api/invitations/${token}/accept`).send({ password: NEW_PASSWORD });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ stage: 'mfa_enroll', me: { kind: 'client', id: fresh.id, email: 'fresh@example.test', providerName: 'Provider One' } });
    const cookie = cookieOf(accepted);
    expect((await me(cookie)).body.stage).toBe('mfa_enroll');
    const gated = await request(app).get('/api/documents').set('Cookie', cookie);
    expect(gated.status).toBe(403);
    expect(gated.body.code).toBe('mfa_required');

    const row = await clientRow(advisor, fresh.id);
    expect(row.hasPassword).toBe(true);
    expect(row.invitePendingUntil).toBeNull();
    const [db1] = await db.select().from(schema.clients).where(eq(schema.clients.id, fresh.id));
    expect(db1.passwordChangedAt).not.toBeNull();
    expect(db1.passwordHash).not.toContain(NEW_PASSWORD);

    const signin = await login('fresh@example.test', NEW_PASSWORD, 'client');
    expect(signin.status).toBe(200);
    expect(signin.body.stage).toBe('mfa_enroll');

    // Single use.
    const again = await request(app).post(`/api/invitations/${token}/accept`).send({ password: NEW_PASSWORD });
    expect(again.status).toBe(410);
    expect(again.body.code).toBe('used');
    expect((await request(app).get(`/api/invitations/${token}`)).status).toBe(410);
  });

  it('a new invitation replaces the old one; expired and unknown links are refused', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const first = tokenOf((await request(app).post(`/api/clients/${fx.client1a.id}/invitations`).set('Cookie', advisor)).body.link);
    const second = tokenOf((await request(app).post(`/api/clients/${fx.client1a.id}/invitations`).set('Cookie', advisor)).body.link);
    expect(second).not.toBe(first);
    expect((await request(app).get(`/api/invitations/${first}`)).status).toBe(404);
    expect((await request(app).get(`/api/invitations/${second}`)).status).toBe(200);
    expect(await db.select().from(schema.invitations).where(eq(schema.invitations.clientId, fx.client1a.id))).toHaveLength(1);

    await db.update(schema.invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.invitations.tokenHash, hashToken(second)));
    const expired = await request(app).get(`/api/invitations/${second}`);
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe('expired');
    expect((await request(app).post(`/api/invitations/${second}/accept`).send({ password: NEW_PASSWORD })).status).toBe(410);

    expect((await request(app).get('/api/invitations/not-a-token')).status).toBe(404);
    expect((await request(app).get(`/api/invitations/${'A'.repeat(43)}`)).status).toBe(404);
    expect((await request(app).post(`/api/invitations/${'A'.repeat(43)}/accept`).send({ password: NEW_PASSWORD })).status).toBe(404);
  });

  it('accepting an invitation ends every session the client already had', async () => {
    const old = await loginAs(fx, 'client1a');
    const advisor = await loginAs(fx, 'provider1');
    const token = tokenOf((await request(app).post(`/api/clients/${fx.client1a.id}/invitations`).set('Cookie', advisor)).body.link);

    const accepted = await request(app).post(`/api/invitations/${token}/accept`).send({ password: NEW_PASSWORD });
    expect(accepted.status).toBe(200);
    // Still enrolled from before, so the fresh session owes a code rather than an enrollment.
    expect(accepted.body.stage).toBe('preauth');
    expect((await me(old)).body.reason).toBe('revoked');
    expect((await login(fx.client1a.email, PASSWORD, 'client')).status).toBe(401);
    expect((await login(fx.client1a.email, NEW_PASSWORD, 'client')).status).toBe(200);
  });

  it('a deactivated client cannot be invited, and a pending link dies with the deactivation', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const token = tokenOf((await request(app).post(`/api/clients/${fx.client1a.id}/invitations`).set('Cookie', advisor)).body.link);

    const off = await request(app).post(`/api/clients/${fx.client1a.id}/deactivate`).set('Cookie', advisor);
    expect(off.status).toBe(200);
    expect(off.body.deactivatedAt).not.toBeNull();
    expect((await request(app).get(`/api/invitations/${token}`)).status).toBe(404);
    const refused = await request(app).post(`/api/clients/${fx.client1a.id}/invitations`).set('Cookie', advisor);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('deactivated');

    expect((await request(app).post(`/api/clients/${fx.client1a.id}/reactivate`).set('Cookie', advisor)).body.deactivatedAt).toBeNull();
    expect((await request(app).post(`/api/clients/${fx.client1a.id}/invitations`).set('Cookie', advisor)).status).toBe(201);
  });
});

describe('password reset', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('the public request is always 202 and creates a row only for a live account that has a password', async () => {
    const rows = () => db.select().from(schema.passwordResets);
    expect((await request(app).post('/api/auth/password-reset/request').send({ email: 'nobody@example.test', kind: 'client' })).status).toBe(202);
    expect(await rows()).toHaveLength(0);

    expect((await request(app).post('/api/auth/password-reset/request').send({ email: fx.provider1.email, kind: 'provider' })).status).toBe(202);
    const [row] = await rows();
    expect(row).toMatchObject({ userKind: 'provider', userId: fx.provider1.id, usedAt: null });
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(RESET_TTL_MS);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // A client who never accepted an invitation has nothing to reset; a deactivated one gets nothing either.
    const advisor = await loginAs(fx, 'provider1');
    const fresh = await newClient(advisor, 'fresh@example.test');
    expect((await request(app).post('/api/auth/password-reset/request').send({ email: fresh.email, kind: 'client' })).status).toBe(202);
    await request(app).post(`/api/clients/${fx.client1b.id}/deactivate`).set('Cookie', advisor);
    expect((await request(app).post('/api/auth/password-reset/request').send({ email: fx.client1b.email, kind: 'client' })).status).toBe(202);
    expect(await rows()).toHaveLength(1);

    // The wrong kind for an email is a miss too.
    expect((await request(app).post('/api/auth/password-reset/request').send({ email: fx.provider1.email, kind: 'client' })).status).toBe(202);
    expect(await rows()).toHaveLength(1);
  });

  it("the advisor's copy-link resets a client's password, ends their sessions, and works once", async () => {
    const clientCookie = await loginAs(fx, 'client1a');
    const advisor = await loginAs(fx, 'provider1');

    const issued = await request(app).post(`/api/clients/${fx.client1a.id}/password-reset`).set('Cookie', advisor);
    expect(issued.status).toBe(200);
    expect(issued.body.link).toMatch(/^http:\/\/localhost:8080\/reset\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(issued.body.link);
    expect(token).toMatch(TOKEN_SHAPE);

    expect((await request(app).post('/api/auth/password-reset/confirm').send({ token, password: SHORT_PASSWORD })).status).toBe(400);
    expect((await me(clientCookie)).status).toBe(200);

    const done = await request(app).post('/api/auth/password-reset/confirm').send({ token, password: NEW_PASSWORD });
    expect(done.status).toBe(200);
    expect(done.headers['set-cookie']).toBeUndefined();
    expect((await me(clientCookie)).body.reason).toBe('revoked');
    expect((await login(fx.client1a.email, PASSWORD, 'client')).status).toBe(401);
    expect((await login(fx.client1a.email, NEW_PASSWORD, 'client')).status).toBe(200);

    const reused = await request(app).post('/api/auth/password-reset/confirm').send({ token, password: NEW_PASSWORD });
    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe('used');

    // Scope and preconditions.
    const other = await loginAs(fx, 'provider2');
    expect((await request(app).post(`/api/clients/${fx.client1a.id}/password-reset`).set('Cookie', other)).status).toBe(404);
    const fresh = await newClient(advisor, 'fresh@example.test');
    const notInvited = await request(app).post(`/api/clients/${fresh.id}/password-reset`).set('Cookie', advisor);
    expect(notInvited.status).toBe(409);
    expect(notInvited.body.code).toBe('not_invited');
  });

  it('expired, unknown and replaced reset links are refused', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const first = tokenOf((await request(app).post(`/api/clients/${fx.client1a.id}/password-reset`).set('Cookie', advisor)).body.link);
    const second = tokenOf((await request(app).post(`/api/clients/${fx.client1a.id}/password-reset`).set('Cookie', advisor)).body.link);

    const replaced = await request(app).post('/api/auth/password-reset/confirm').send({ token: first, password: NEW_PASSWORD });
    expect(replaced.status).toBe(400);
    expect(replaced.body.code).toBe('invalid_token');

    await db.update(schema.passwordResets).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.passwordResets.tokenHash, hashToken(second)));
    const expired = await request(app).post('/api/auth/password-reset/confirm').send({ token: second, password: NEW_PASSWORD });
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe('expired');

    const garbage = await request(app).post('/api/auth/password-reset/confirm').send({ token: 'garbage', password: NEW_PASSWORD });
    expect(garbage.status).toBe(400);
    expect(garbage.body.code).toBe('invalid_token');
    expect((await login(fx.client1a.email, PASSWORD, 'client')).status).toBe(200);
  });
});

describe('password change', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('needs the current password, enforces the minimum, and ends every other session', async () => {
    const a = await loginAs(fx, 'provider1');
    const b = await loginAs(fx, 'provider1');
    const change = (body: Record<string, string>) => request(app).post('/api/auth/password').set('Cookie', a).send(body);

    const wrong = await change({ currentPassword: 'not-the-password', newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('wrong_password');
    expect((await change({ currentPassword: PASSWORD, newPassword: SHORT_PASSWORD })).status).toBe(400);
    expect((await me(b)).status).toBe(200);

    const ok = await change({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.revoked).toBe(1);
    expect((await me(a)).status).toBe(200);
    expect((await me(b)).body.reason).toBe('revoked');

    expect((await login(fx.provider1.email, PASSWORD, 'provider')).status).toBe(401);
    expect((await login(fx.provider1.email, NEW_PASSWORD, 'provider')).status).toBe(200);
    const [p] = await db.select().from(schema.providers).where(eq(schema.providers.id, fx.provider1.id));
    expect(p.passwordChangedAt).not.toBeNull();
  });
});

describe('deactivation', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('takes effect on the next request and blocks sign-in until reactivated', async () => {
    const clientCookie = await loginAs(fx, 'client1a');
    const advisor = await loginAs(fx, 'provider1');

    const off = await request(app).post(`/api/clients/${fx.client1a.id}/deactivate`).set('Cookie', advisor);
    expect(off.status).toBe(200);
    expect(off.body.deactivatedAt).not.toBeNull();
    const dead = await me(clientCookie);
    expect(dead.status).toBe(401);
    expect(dead.body.reason).toBe('revoked');

    const refused = await login(fx.client1a.email, PASSWORD, 'client');
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('deactivated');
    expect(refused.headers['set-cookie']).toBeUndefined();
    // With the wrong password the answer stays generic: no oracle on account state.
    const wrong = await login(fx.client1a.email, 'not-the-password', 'client');
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBeUndefined();

    const list = await request(app).get('/api/clients').set('Cookie', advisor);
    const listed = list.body.find((c: { id: string }) => c.id === fx.client1a.id);
    expect(listed.deactivatedAt).not.toBeNull();

    // Idempotent and scoped.
    expect((await request(app).post(`/api/clients/${fx.client1a.id}/deactivate`).set('Cookie', advisor)).status).toBe(200);
    expect((await request(app).post(`/api/clients/${fx.client1a.id}/deactivate`).set('Cookie', await loginAs(fx, 'provider2'))).status).toBe(404);

    const on = await request(app).post(`/api/clients/${fx.client1a.id}/reactivate`).set('Cookie', advisor);
    expect(on.body.deactivatedAt).toBeNull();
    expect((await login(fx.client1a.email, PASSWORD, 'client')).status).toBe(200);
  });

  it('a deactivated advisor is refused on the next request and at sign-in', async () => {
    const cookie = await loginAs(fx, 'provider2');
    await db.update(schema.providers).set({ deactivatedAt: new Date() }).where(eq(schema.providers.id, fx.provider2.id));
    expect((await me(cookie)).body.reason).toBe('revoked');
    const refused = await login(fx.provider2.email, PASSWORD, 'provider');
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('deactivated');
  });
});

describe('password hashing', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  const rounds = async (id: string) => {
    const [c] = await db.select({ h: schema.clients.passwordHash }).from(schema.clients).where(eq(schema.clients.id, id));
    return bcrypt.getRounds(c.h!);
  };

  it('re-hashes an older, weaker hash on a successful sign-in and leaves a current one alone', async () => {
    expect(await rounds(fx.client1a.id)).toBe(4);
    const original = process.env.PASSWORD_BCRYPT_COST;
    process.env.PASSWORD_BCRYPT_COST = '5';
    try {
      expect((await passwordLogin(fx, 'client1a')).res.status).toBe(200);
      expect(await rounds(fx.client1a.id)).toBe(5);
      // A wrong password never touches the hash.
      expect((await login(fx.client1b.email, 'not-the-password', 'client')).status).toBe(401);
      expect(await rounds(fx.client1b.id)).toBe(4);
    } finally {
      process.env.PASSWORD_BCRYPT_COST = original;
    }
    expect((await passwordLogin(fx, 'client1a')).res.status).toBe(200);
    expect(await rounds(fx.client1a.id)).toBe(5);
  });

  it('refuses the published demo passwords in production only', async () => {
    await db
      .update(schema.clients)
      .set({ passwordHash: bcrypt.hashSync('client123', 4) })
      .where(eq(schema.clients.id, fx.client1a.id));
    expect((await login(fx.client1a.email, 'client123', 'client')).status).toBe(200);

    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const refused = await login(fx.client1a.email, 'client123', 'client');
      expect(refused.status).toBe(401);
      expect(refused.body.code).toBe('demo_password');
      expect(refused.headers['set-cookie']).toBeUndefined();
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('lookup limiter: a fixed budget per IP, every attempt counts', async () => {
    const mini = express();
    mini.use(createLookupLimiter(2));
    mini.get('/', (_req, res) => res.status(404).json({ error: 'nope' }));

    expect((await supertest(mini).get('/')).status).toBe(404);
    expect((await supertest(mini).get('/')).status).toBe(404);
    const blocked = await supertest(mini).get('/');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('rate_limited');
  });

  it('never returns a hash, a token hash, or a deactivation column it should not', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const list = await request(app).get('/api/clients').set('Cookie', advisor);
    for (const c of list.body) {
      expect(Object.keys(c)).not.toContain('passwordHash');
      expect(Object.keys(c).sort()).toEqual(
        [
          'accountId', 'aum', 'clientSince', 'createdAt', 'deactivatedAt', 'documentsCount', 'email', 'hasPassword', 'id',
          'invitePendingUntil', 'lastActivity', 'name', 'pendingUpdates', 'plan', 'providerId', 'unreadMessages', 'updatedAt',
        ].sort()
      );
    }
    const pending = await db
      .select()
      .from(schema.invitations)
      .where(and(eq(schema.invitations.clientId, fx.client1a.id), eq(schema.invitations.clientId, fx.client1a.id)));
    expect(pending).toHaveLength(0);
  });
});
