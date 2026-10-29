import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { PASSWORD, app, request, seedFixture, type Fixture } from './helpers.js';

describe('auth', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('enables advisor signup only when ALLOW_PROVIDER_SIGNUP=true', async () => {
    const body = { name: 'Walk-in', email: 'walkin@example.test', password: 'walkin-pass-123', firmName: 'Walk-in CPA' };

    const off = await request(app).post('/api/auth/signup-provider').send(body);
    expect(off.status).toBe(403);

    process.env.ALLOW_PROVIDER_SIGNUP = 'true';
    try {
      const on = await request(app).post('/api/auth/signup-provider').send(body);
      expect(on.status).toBe(201);
      // A brand-new account owes an enrollment before it can do anything else.
      expect(on.body).toMatchObject({ stage: 'mfa_enroll', me: { kind: 'provider', email: body.email, firmName: body.firmName } });
      expect(on.body.me).not.toHaveProperty('passwordHash');
      expect(on.headers['set-cookie']).toBeDefined();
      // The walk-in founds a firm of their own and owns it.
      const [p] = await db.select().from(schema.providers).where(eq(schema.providers.id, on.body.me.id));
      const [firm] = await db.select().from(schema.firms).where(eq(schema.firms.id, p.firmId));
      expect(firm.name).toBe('Walk-in CPA');
      expect(p.role).toBe('owner');

      const duplicate = await request(app).post('/api/auth/signup-provider').send(body);
      expect(duplicate.status).toBe(409);
    } finally {
      delete process.env.ALLOW_PROVIDER_SIGNUP;
    }
  });

  it('rejects a wrong password without setting a cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: fx.provider1.email, password: 'definitely-not-it', kind: 'provider' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('keeps the advisor and client login paths separate', async () => {
    const clientAsAdvisor = await request(app)
      .post('/api/auth/login')
      .send({ email: fx.client1a.email, password: PASSWORD, kind: 'provider' });
    expect(clientAsAdvisor.status).toBe(401);

    const advisorAsClient = await request(app)
      .post('/api/auth/login')
      .send({ email: fx.provider1.email, password: PASSWORD, kind: 'client' });
    expect(advisorAsClient.status).toBe(401);
  });
  it('signs in and sends a reset link whatever case the address is typed in', async () => {
    // Addresses are kept as typed: this client was saved in mixed case.
    await db.update(schema.clients).set({ email: 'C1A@Example.Test' }).where(eq(schema.clients.id, fx.client1a.id));
    const login = (email: string, kind: 'provider' | 'client') => request(app).post('/api/auth/login').send({ email, password: PASSWORD, kind });

    expect((await login('c1a@example.test', 'client')).status).toBe(200);
    expect((await login('C1A@EXAMPLE.TEST', 'client')).status).toBe(200);
    expect((await login('  c1a@example.test ', 'client')).status).toBe(200);
    expect((await login('P1@Example.TEST', 'provider')).status).toBe(200);
    expect((await login(' p1@example.test  ', 'provider')).status).toBe(200);

    process.env.SMTP_URL = 'smtp://user:pass@localhost:1025';
    try {
      expect((await request(app).post('/api/auth/password-reset/request').send({ email: 'c1a@EXAMPLE.test', kind: 'client' })).status).toBe(202);
      expect((await request(app).post('/api/auth/password-reset/request').send({ email: ' P1@example.test ', kind: 'provider' })).status).toBe(202);
    } finally {
      delete process.env.SMTP_URL;
    }
    const resets = await db.select().from(schema.passwordResets);
    expect(resets.map((r) => r.userId).sort()).toEqual([fx.client1a.id, fx.provider1.id].sort());
    // The link goes to the address on file, not to whatever was typed into the form.
    const sentTo = (await db.select().from(schema.jobs)).map((j) => (j.payload as Record<string, unknown>).to).sort();
    expect(sentTo).toEqual(['C1A@Example.Test', fx.provider1.email].sort());
  });

  it('refuses an advisor signup that differs from an existing address only by case', async () => {
    process.env.ALLOW_PROVIDER_SIGNUP = 'true';
    try {
      const res = await request(app)
        .post('/api/auth/signup-provider')
        .send({ name: 'Twin', email: fx.provider1.email.toUpperCase(), password: 'twin-pass-1234', firmName: 'Twin CPA' });
      expect(res.status).toBe(409);
    } finally {
      delete process.env.ALLOW_PROVIDER_SIGNUP;
    }
  });
});
