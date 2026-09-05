import { beforeEach, describe, expect, it } from 'vitest';
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
      expect(on.body).toMatchObject({ kind: 'provider', email: body.email, firmName: body.firmName });
      expect(on.body).not.toHaveProperty('passwordHash');
      expect(on.headers['set-cookie']).toBeDefined();

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
});
