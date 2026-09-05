/**
 * Authenticator MFA (plan: Security design → MFA; invariant 9): a password
 * alone yields a pre-auth session that can reach only the MFA, me and logout
 * endpoints; the code (or a recovery code) makes it active; enrollment is
 * forced; wrong codes are throttled; secrets are encrypted at rest.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { decryptSecret, encryptSecret } from '../src/auth/crypto.js';
import { RECOVERY_CODE_COUNT, TOTP_STEP_SECONDS, generateCode } from '../src/auth/mfa.js';
import { hashToken } from '../src/auth/sessions.js';
import {
  PASSWORD,
  TOTP_SECRET,
  app,
  clearReplayGuard,
  identity,
  passwordLogin,
  request,
  seedFixture,
  totpCode,
  unenroll,
  type Fixture,
} from './helpers.js';

const tokenOf = (cookie: string) => cookie.split('=')[1];

async function sessionRow(cookie: string) {
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(tokenOf(cookie))));
  return row;
}

async function mfaRow(fx: Fixture, actor: Parameters<typeof identity>[1]) {
  const { kind, id } = identity(fx, actor);
  const [row] = await db
    .select()
    .from(schema.mfaTotp)
    .where(and(eq(schema.mfaTotp.userKind, kind), eq(schema.mfaTotp.userId, id)));
  return row ?? null;
}

async function recoveryRows(fx: Fixture, actor: Parameters<typeof identity>[1]) {
  const { kind, id } = identity(fx, actor);
  return db
    .select()
    .from(schema.recoveryCodes)
    .where(and(eq(schema.recoveryCodes.userKind, kind), eq(schema.recoveryCodes.userId, id)));
}

const verify = (cookie: string, body: Record<string, string>) => request(app).post('/api/auth/mfa/verify').set('Cookie', cookie).send(body);
const status = (cookie: string) => request(app).get('/api/auth/mfa/status').set('Cookie', cookie);
/** A route every signed-in user may call: 200 once the session is active, 403 mfa_required before. */
const clients = (cookie: string) => request(app).get('/api/documents').set('Cookie', cookie);

const RECOVERY_CODE_SHAPE = /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;

describe('mfa', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  describe('pre-auth stage', () => {
    it('a password login yields a preauth session that reaches only me, mfa and logout', async () => {
      const { cookie, res } = await passwordLogin(fx, 'provider1');
      expect(res.body).toMatchObject({ stage: 'preauth', me: { kind: 'provider', id: fx.provider1.id } });
      expect((await sessionRow(cookie)).stage).toBe('preauth');

      const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
      expect(me.status).toBe(200);
      expect(me.body.stage).toBe('preauth');

      const st = await status(cookie);
      expect(st.status).toBe(200);
      expect(st.body).toMatchObject({ stage: 'preauth', enrolled: true });

      const refused: Array<[string, Promise<{ status: number; body: Record<string, unknown> }>]> = [
        ['GET /clients', clients(cookie)],
        ['GET download', request(app).get(`/api/documents/${fx.client1a.upload}/download`).set('Cookie', cookie)],
        ['GET /auth/sessions', request(app).get('/api/auth/sessions').set('Cookie', cookie)],
        ['POST /auth/logout-all', request(app).post('/api/auth/logout-all').set('Cookie', cookie)],
        ['POST /messages', request(app).post('/api/messages').set('Cookie', cookie).send({ clientId: fx.client1a.id, content: 'not yet' })],
        ['POST /auth/mfa/recovery-codes', request(app).post('/api/auth/mfa/recovery-codes').set('Cookie', cookie).send({ code: totpCode() })],
      ];
      for (const [label, t] of refused) {
        const r = await t;
        expect(r.status, label).toBe(403);
        expect(r.body, label).toMatchObject({ code: 'mfa_required', stage: 'preauth' });
      }
      // Nothing above touched the DB: the message was refused before the handler.
      expect((await db.select().from(schema.messages)).map((m) => m.content)).not.toContain('not yet');
    });

    it('a refused request does not extend the pre-auth session', async () => {
      const { cookie } = await passwordLogin(fx, 'client1a');
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
      await db.update(schema.sessions).set({ lastSeenAt: fiveMinutesAgo }).where(eq(schema.sessions.tokenHash, hashToken(tokenOf(cookie))));
      expect((await clients(cookie)).status).toBe(403);
      expect((await sessionRow(cookie)).lastSeenAt.getTime()).toBe(fiveMinutesAgo.getTime());
    });

    it('logout works from a pre-auth session', async () => {
      const { cookie } = await passwordLogin(fx, 'client1a');
      const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
      expect(out.status).toBe(200);
      expect((await sessionRow(cookie)).revokedAt).not.toBeNull();
      expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
    });
  });

  describe('verify', () => {
    it('the authenticator code activates the session', async () => {
      const { cookie } = await passwordLogin(fx, 'provider1');
      const res = await verify(cookie, { code: totpCode() });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ stage: 'active', recoveryCodesLeft: 0 });
      expect((await sessionRow(cookie)).stage).toBe('active');
      expect((await clients(cookie)).status).toBe(200);
      expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.stage).toBe('active');
    });

    it('accepts a code with spaces and the neighbouring steps, and nothing else', async () => {
      const now = Date.now();
      const { cookie: a } = await passwordLogin(fx, 'provider1');
      const spaced = totpCode().replace(/^(\d{3})(\d{3})$/, '$1 $2');
      expect((await verify(a, { code: spaced })).status).toBe(200);

      const { cookie: b } = await passwordLogin(fx, 'provider2');
      const next = generateCode(TOTP_SECRET, now + TOTP_STEP_SECONDS * 1000);
      expect((await verify(b, { code: next })).status).toBe(200);

      const { cookie: c } = await passwordLogin(fx, 'client1a');
      const farFuture = generateCode(TOTP_SECRET, now + 3 * TOTP_STEP_SECONDS * 1000);
      const stale = await verify(c, { code: farFuture });
      expect(stale.status).toBe(401);
      expect(stale.body.code).toBe('invalid_code');
      expect((await verify(c, { code: '12345' })).status).toBe(401);
      expect((await verify(c, { code: 'abcdef' })).status).toBe(401);
      expect((await verify(c, {})).status).toBe(400);
      expect((await sessionRow(c)).stage).toBe('preauth');
    });

    it('never accepts the same code twice (replay inside the 30 s window)', async () => {
      const code = totpCode();
      const { cookie: first } = await passwordLogin(fx, 'client1b');
      expect((await verify(first, { code })).status).toBe(200);

      const { cookie: second } = await passwordLogin(fx, 'client1b');
      const replay = await verify(second, { code });
      expect(replay.status).toBe(401);
      expect((await sessionRow(second)).stage).toBe('preauth');

      // Another account with the same secret value is unaffected: the guard is per user.
      const { cookie: other } = await passwordLogin(fx, 'client2a');
      expect((await verify(other, { code })).status).toBe(200);
    });

    it('throttles after 5 wrong codes per session and keeps the session pre-auth', async () => {
      const { cookie } = await passwordLogin(fx, 'provider1');
      for (let i = 0; i < 5; i++) {
        const res = await verify(cookie, { code: '000000' });
        expect(res.status, `attempt ${i + 1}`).toBe(401);
      }
      const locked = await verify(cookie, { code: totpCode() });
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('rate_limited');
      expect((await sessionRow(cookie)).stage).toBe('preauth');

      // The lock is per session: a fresh login is not punished for the other tab's failures.
      const { cookie: fresh } = await passwordLogin(fx, 'provider1');
      expect((await verify(fresh, { code: totpCode() })).status).toBe(200);
    });

    it('refuses a code for an account that is not enrolled and points at enrollment', async () => {
      await unenroll(fx, 'client1a');
      const { cookie, res } = await passwordLogin(fx, 'client1a');
      expect(res.body.stage).toBe('mfa_enroll');
      const r = await verify(cookie, { code: totpCode() });
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'not_enrolled', stage: 'mfa_enroll' });
    });
  });

  describe('enrollment', () => {
    it('is forced for an account without an authenticator and hands out recovery codes once', async () => {
      await unenroll(fx, 'client1a');
      const { cookie, res } = await passwordLogin(fx, 'client1a');
      expect(res.body.stage).toBe('mfa_enroll');
      expect((await sessionRow(cookie)).stage).toBe('mfa_enroll');

      const refused = await clients(cookie);
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'mfa_required', stage: 'mfa_enroll' });

      const st = await status(cookie);
      expect(st.body).toMatchObject({ stage: 'mfa_enroll', enrolled: false, enrolledAt: null, recoveryCodesLeft: 0 });

      const start = await request(app).post('/api/auth/mfa/enroll').set('Cookie', cookie);
      expect(start.status).toBe(200);
      expect(start.body.secret).toMatch(/^[A-Z2-7]{16,}$/);
      expect(start.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(start.body.issuer).toBe('DocFlow');
      expect(start.body.account).toBe(fx.client1a.email);
      const url = new URL(start.body.otpauthUrl);
      expect(url.protocol).toBe('otpauth:');
      expect(url.host).toBe('totp');
      expect(decodeURIComponent(url.pathname)).toBe(`/DocFlow:${fx.client1a.email}`);
      expect(url.searchParams.get('secret')).toBe(start.body.secret);
      expect(url.searchParams.get('issuer')).toBe('DocFlow');

      // The pending secret is stored encrypted, never in the clear.
      const pending = await mfaRow(fx, 'client1a');
      expect(pending!.enrolledAt).toBeNull();
      expect(pending!.secretEnc).toMatch(/^v1:/);
      expect(pending!.secretEnc).not.toContain(start.body.secret);
      expect(decryptSecret(pending!.secretEnc)).toBe(start.body.secret);

      // A wrong code does not enroll; the session stays where it was.
      const wrong = await request(app).post('/api/auth/mfa/enroll/confirm').set('Cookie', cookie).send({ code: '000000' });
      expect(wrong.status).toBe(401);
      expect((await sessionRow(cookie)).stage).toBe('mfa_enroll');

      const confirm = await request(app)
        .post('/api/auth/mfa/enroll/confirm')
        .set('Cookie', cookie)
        .send({ code: generateCode(start.body.secret) });
      expect(confirm.status).toBe(200);
      expect(confirm.body.stage).toBe('active');
      expect(confirm.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      for (const c of confirm.body.recoveryCodes) expect(c).toMatch(RECOVERY_CODE_SHAPE);
      expect(new Set(confirm.body.recoveryCodes).size).toBe(RECOVERY_CODE_COUNT);

      expect((await sessionRow(cookie)).stage).toBe('active');
      expect((await clients(cookie)).status).toBe(200);
      expect((await mfaRow(fx, 'client1a'))!.enrolledAt).not.toBeNull();
      expect((await status(cookie)).body).toMatchObject({ stage: 'active', enrolled: true, recoveryCodesLeft: RECOVERY_CODE_COUNT });

      // Stored hashed: no plaintext code in the table.
      const rows = await recoveryRows(fx, 'client1a');
      expect(rows).toHaveLength(RECOVERY_CODE_COUNT);
      for (const row of rows) {
        expect(row.codeHash).toMatch(/^\$2[aby]\$/);
        expect(row.usedAt).toBeNull();
      }

      // Enrolled once: a second enrollment (and a second confirm) is refused.
      expect((await request(app).post('/api/auth/mfa/enroll').set('Cookie', cookie)).status).toBe(409);
      const again = await request(app).post('/api/auth/mfa/enroll/confirm').set('Cookie', cookie).send({ code: generateCode(start.body.secret) });
      expect(again.status).toBe(409);
    });

    it('restarting enrollment replaces an unconfirmed secret; confirm needs enroll first', async () => {
      await unenroll(fx, 'provider2');
      const { cookie } = await passwordLogin(fx, 'provider2');

      const early = await request(app).post('/api/auth/mfa/enroll/confirm').set('Cookie', cookie).send({ code: '000000' });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('not_started');

      const first = await request(app).post('/api/auth/mfa/enroll').set('Cookie', cookie);
      const second = await request(app).post('/api/auth/mfa/enroll').set('Cookie', cookie);
      expect(second.status).toBe(200);
      expect(second.body.secret).not.toBe(first.body.secret);

      const stale = await request(app).post('/api/auth/mfa/enroll/confirm').set('Cookie', cookie).send({ code: generateCode(first.body.secret) });
      expect(stale.status).toBe(401);
      const ok = await request(app).post('/api/auth/mfa/enroll/confirm').set('Cookie', cookie).send({ code: generateCode(second.body.secret) });
      expect(ok.status).toBe(200);
    });
  });

  describe('recovery codes', () => {
    async function enrollWithCodes(actor: 'client1a' | 'provider1'): Promise<string[]> {
      await unenroll(fx, actor);
      const { cookie } = await passwordLogin(fx, actor);
      const start = await request(app).post('/api/auth/mfa/enroll').set('Cookie', cookie);
      const confirm = await request(app)
        .post('/api/auth/mfa/enroll/confirm')
        .set('Cookie', cookie)
        .send({ code: generateCode(start.body.secret) });
      expect(confirm.status).toBe(200);
      return confirm.body.recoveryCodes as string[];
    }

    it('a recovery code signs in once, in any spelling, and then never again', async () => {
      const codes = await enrollWithCodes('client1a');

      const { cookie: a } = await passwordLogin(fx, 'client1a');
      const sloppy = codes[0].toLowerCase().replace('-', ' ');
      const res = await verify(a, { recoveryCode: sloppy });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ stage: 'active', recoveryCodesLeft: RECOVERY_CODE_COUNT - 1 });
      expect((await clients(a)).status).toBe(200);

      const { cookie: b } = await passwordLogin(fx, 'client1a');
      const reuse = await verify(b, { recoveryCode: codes[0] });
      expect(reuse.status).toBe(401);
      expect(reuse.body.code).toBe('invalid_code');
      expect((await sessionRow(b)).stage).toBe('preauth');

      expect((await verify(b, { recoveryCode: codes[1] })).status).toBe(200);
      expect((await status(b)).body.recoveryCodesLeft).toBe(RECOVERY_CODE_COUNT - 2);

      const used = (await recoveryRows(fx, 'client1a')).filter((r) => r.usedAt !== null);
      expect(used).toHaveLength(2);
    });

    it("someone else's recovery code is worthless", async () => {
      const codes = await enrollWithCodes('client1a');
      const { cookie } = await passwordLogin(fx, 'client1b');
      expect((await verify(cookie, { recoveryCode: codes[2] })).status).toBe(401);
      expect((await sessionRow(cookie)).stage).toBe('preauth');
    });

    it('regeneration needs an active session and a fresh authenticator code, and retires the old set', async () => {
      const codes = await enrollWithCodes('provider1');
      const secret = decryptSecret((await mfaRow(fx, 'provider1'))!.secretEnc);

      // Sign in with the new authenticator (the confirm consumed this step, so forget it first).
      await clearReplayGuard(fx, 'provider1');
      const { cookie } = await passwordLogin(fx, 'provider1');
      expect((await verify(cookie, { code: generateCode(secret) })).status).toBe(200);

      const wrong = await request(app).post('/api/auth/mfa/recovery-codes').set('Cookie', cookie).send({ code: '000000' });
      expect(wrong.status).toBe(401);
      expect((await recoveryRows(fx, 'provider1')).filter((r) => r.usedAt === null)).toHaveLength(RECOVERY_CODE_COUNT);

      // The sign-in consumed the current step again; a fresh code means the next step (inside the ±1 window).
      const fresh = generateCode(secret, Date.now() + TOTP_STEP_SECONDS * 1000);
      const res = await request(app).post('/api/auth/mfa/recovery-codes').set('Cookie', cookie).send({ code: fresh });
      expect(res.status).toBe(200);
      expect(res.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      for (const c of res.body.recoveryCodes) {
        expect(c).toMatch(RECOVERY_CODE_SHAPE);
        expect(codes).not.toContain(c);
      }

      const { cookie: p } = await passwordLogin(fx, 'provider1');
      expect((await verify(p, { recoveryCode: codes[0] })).status).toBe(401);
      expect((await verify(p, { recoveryCode: res.body.recoveryCodes[0] })).status).toBe(200);
    });
  });

  describe('secrets at rest', () => {
    it('round-trip, random IV, and tamper detection', () => {
      const a = encryptSecret(TOTP_SECRET);
      const b = encryptSecret(TOTP_SECRET);
      expect(a).not.toBe(b);
      expect(a).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
      expect(a).not.toContain(TOTP_SECRET);
      expect(decryptSecret(a)).toBe(TOTP_SECRET);
      expect(decryptSecret(b)).toBe(TOTP_SECRET);

      const [v, iv, tag, ct] = a.split(':');
      const flipped = ct[0] === 'A' ? 'B' : 'A';
      expect(() => decryptSecret([v, iv, tag, flipped + ct.slice(1)].join(':'))).toThrow();
      expect(() => decryptSecret('v0:x:y:z')).toThrow(/format/);
      expect(() => decryptSecret('plain-secret')).toThrow();
    });

    it('a wrong key cannot read a stored secret, and then a login cannot finish', async () => {
      const stored = (await mfaRow(fx, 'client1a'))!.secretEnc;
      const original = process.env.APP_ENCRYPTION_KEY;
      process.env.APP_ENCRYPTION_KEY = 'f'.repeat(64);
      try {
        expect(() => decryptSecret(stored)).toThrow();
        const { cookie } = await passwordLogin(fx, 'client1a');
        expect((await verify(cookie, { code: totpCode() })).status).toBe(401);
      } finally {
        if (original === undefined) delete process.env.APP_ENCRYPTION_KEY;
        else process.env.APP_ENCRYPTION_KEY = original;
      }
    });
  });

  it('the login password check still runs before any MFA state is consulted', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: fx.provider1.email, password: 'wrong', kind: 'provider' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    const ok = await request(app).post('/api/auth/login').send({ email: fx.provider1.email, password: PASSWORD, kind: 'provider' });
    expect(ok.body.stage).toBe('preauth');
  });
});
