/**
 * Server sessions (plan: Architecture invariant 8 / Security design → Sessions):
 * opaque token, hashed at rest, 30 min idle / 12 h absolute, revocable, and
 * polling never extends them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { ABSOLUTE_TIMEOUT_MS, IDLE_TIMEOUT_MS, hashToken } from '../src/auth/sessions.js';
import { PASSWORD, app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

const tokenOf = (cookie: string) => cookie.split('=')[1];

/** The first Set-Cookie header (supertest types headers as strings; Node gives an array). */
function setCookie(res: { headers: Record<string, string | string[] | undefined> }): string {
  const h = res.headers['set-cookie'];
  const first = Array.isArray(h) ? h[0] : h;
  if (!first) throw new Error('no Set-Cookie header');
  return first;
}

async function sessionRow(cookie: string) {
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(tokenOf(cookie))));
  return row;
}

async function setSession(cookie: string, patch: Partial<typeof schema.sessions.$inferInsert>) {
  await db.update(schema.sessions).set(patch).where(eq(schema.sessions.tokenHash, hashToken(tokenOf(cookie))));
}

const me = (cookie: string, poll = false) => {
  const t = request(app).get('/api/auth/me').set('Cookie', cookie);
  return poll ? t.set('X-DocFlow-Poll', '1') : t;
};

describe('sessions', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('login creates a session row that stores only a hash of the cookie token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: fx.provider1.email, password: PASSWORD, kind: 'provider' });
    expect(res.status).toBe(200);

    const header = setCookie(res);
    expect(header).toMatch(/^docflow_session=[A-Za-z0-9_-]{43};/);
    for (const attr of [`Max-Age=${ABSOLUTE_TIMEOUT_MS / 1000}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']) {
      expect(header).toContain(attr);
    }

    const cookie = header.split(';')[0];
    const row = await sessionRow(cookie);
    expect(row).toBeDefined();
    expect(row.tokenHash).not.toBe(tokenOf(cookie));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.userKind).toBe('provider');
    expect(row.userId).toBe(fx.provider1.id);
    expect(row.revokedAt).toBeNull();
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(ABSOLUTE_TIMEOUT_MS);

    const all = await db.select({ h: schema.sessions.tokenHash }).from(schema.sessions);
    expect(all.some((r) => r.h.includes(tokenOf(cookie)))).toBe(false);
  });

  it('refuses a token that matches no row and clears the cookie', async () => {
    const res = await me('docflow_session=not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('invalid');
    expect(setCookie(res)).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('answers 401 missing without a cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('missing');
  });

  it('ends a session idle for more than 30 minutes', async () => {
    const cookie = await loginAs(fx, 'client1a');
    await setSession(cookie, { lastSeenAt: new Date(Date.now() - IDLE_TIMEOUT_MS + 60_000) });
    expect((await me(cookie)).status).toBe(200);

    await setSession(cookie, { lastSeenAt: new Date(Date.now() - IDLE_TIMEOUT_MS - 1000) });
    const res = await me(cookie);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('idle');
    expect(res.body.error).toMatch(/30 minutes/);
  });

  it('ends a session past its absolute lifetime even when it is active', async () => {
    const cookie = await loginAs(fx, 'provider1');
    await setSession(cookie, { lastSeenAt: new Date(), expiresAt: new Date(Date.now() - 1000) });
    const res = await me(cookie);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('expired');
  });

  it('extends the idle window on activity, at most once a minute, and never for polls', async () => {
    const cookie = await loginAs(fx, 'provider1');
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
    await setSession(cookie, { lastSeenAt: fiveMinutesAgo });

    expect((await me(cookie, true)).status).toBe(200);
    expect((await sessionRow(cookie)).lastSeenAt.getTime()).toBe(fiveMinutesAgo.getTime());

    const before = Date.now();
    expect((await me(cookie)).status).toBe(200);
    const touched = (await sessionRow(cookie)).lastSeenAt.getTime();
    expect(touched).toBeGreaterThanOrEqual(before - 5);

    const tenSecondsAgo = new Date(Date.now() - 10_000);
    await setSession(cookie, { lastSeenAt: tenSecondsAgo });
    expect((await me(cookie)).status).toBe(200);
    expect((await sessionRow(cookie)).lastSeenAt.getTime()).toBe(tenSecondsAgo.getTime());
  });

  it('logout revokes the row so the cookie is dead even if replayed', async () => {
    const cookie = await loginAs(fx, 'client1b');
    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(200);
    expect(setCookie(out)).toContain('Expires=Thu, 01 Jan 1970');
    expect((await sessionRow(cookie)).revokedAt).not.toBeNull();

    const replay = await me(cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.reason).toBe('revoked');
  });

  it('logout-all revokes every session of the caller and nobody else', async () => {
    const a = await loginAs(fx, 'provider1');
    const b = await loginAs(fx, 'provider1');
    const other = await loginAs(fx, 'client1a');

    const res = await request(app).post('/api/auth/logout-all').set('Cookie', a);
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(2);

    expect((await me(a)).body.reason).toBe('revoked');
    expect((await me(b)).body.reason).toBe('revoked');
    expect((await me(other)).status).toBe(200);
  });

  it('lists live sessions without the token hash and marks the current one', async () => {
    const a = await loginAs(fx, 'provider1');
    const b = await loginAs(fx, 'provider1');

    const list = await request(app).get('/api/auth/sessions').set('Cookie', a);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    for (const s of list.body) {
      expect(Object.keys(s).sort()).toEqual(['createdAt', 'current', 'expiresAt', 'id', 'ip', 'lastSeenAt', 'userAgent']);
    }
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(list.body.find((s: { current: boolean }) => s.current).id).toBe((await sessionRow(a)).id);

    await request(app).post('/api/auth/logout').set('Cookie', b);
    const after = await request(app).get('/api/auth/sessions').set('Cookie', a);
    expect(after.body).toHaveLength(1);
  });

  it("an advisor setting a client's password revokes that client's sessions", async () => {
    const clientCookie = await loginAs(fx, 'client1a');
    const advisor = await loginAs(fx, 'provider1');

    const res = await request(app)
      .patch(`/api/clients/${fx.client1a.id}`)
      .set('Cookie', advisor)
      .send({ password: 'brand-new-password-1' });
    expect(res.status).toBe(200);

    expect((await me(clientCookie)).body.reason).toBe('revoked');

    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ email: fx.client1a.email, password: 'brand-new-password-1', kind: 'client' });
    expect(relogin.status).toBe(200);
  });

  it('a session whose account no longer exists is revoked on first use', async () => {
    const cookie = await loginAs(fx, 'provider2');
    await db.delete(schema.providers).where(eq(schema.providers.id, fx.provider2.id));
    const res = await me(cookie);
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('revoked');
    expect((await sessionRow(cookie)).revokedAt).not.toBeNull();
  });
});
