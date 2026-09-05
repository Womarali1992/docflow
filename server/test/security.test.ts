/**
 * Origin check, security headers, body/field limits and throttling
 * (plan: Security design → CSRF, Headers, Throttling; invariant 10).
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, PERMISSIONS_POLICY } from '../src/security/headers.js';
import { INSTRUCTIONS_MAX, MESSAGE_MAX, NAME_MAX, createGlobalLimiter } from '../src/security/limits.js';
import { checkOrigin } from '../src/auth/csrf.js';
import { PASSWORD, PDF_BYTES, TEST_ORIGIN, app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

/** Raw supertest: no default Origin, so each case controls the headers exactly. */
const raw = () => supertest(app);

describe('security headers', () => {
  it('are present on every response, and X-Powered-By is not', async () => {
    for (const res of [await raw().get('/api/health'), await raw().get('/api/auth/me'), await raw().get('/api/nope')]) {
      expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['x-powered-by']).toBeUndefined();
      // HSTS belongs to Caddy; the API must not send a conflicting one.
      expect(res.headers['strict-transport-security']).toBeUndefined();
    }
  });
});

describe('origin check', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('decides from Sec-Fetch-Site first, then Origin, and refuses requests with neither', () => {
    const o = TEST_ORIGIN;
    expect(checkOrigin({}, o)).toEqual({ ok: false, reason: 'missing' });
    expect(checkOrigin({ origin: o }, o)).toEqual({ ok: true });
    expect(checkOrigin({ origin: 'https://evil.example' }, o)).toEqual({ ok: false, reason: 'origin-mismatch' });
    expect(checkOrigin({ origin: `${o}.evil.example` }, o)).toEqual({ ok: false, reason: 'origin-mismatch' });
    expect(checkOrigin({ 'sec-fetch-site': 'same-origin' }, o)).toEqual({ ok: true });
    expect(checkOrigin({ 'sec-fetch-site': 'none' }, o)).toEqual({ ok: true });
    expect(checkOrigin({ 'sec-fetch-site': 'same-site' }, o)).toEqual({ ok: false, reason: 'sec-fetch-site' });
    expect(checkOrigin({ 'sec-fetch-site': 'cross-site', origin: o }, o)).toEqual({ ok: false, reason: 'sec-fetch-site' });
  });

  it('refuses non-GET requests from a foreign or absent Origin with 403 bad_origin', async () => {
    const cookie = await loginAs(fx, 'provider1');
    const attempts: Array<[string, Record<string, string>]> = [
      ['no headers', {}],
      ['foreign Origin', { Origin: 'https://evil.example' }],
      ['cross-site', { 'Sec-Fetch-Site': 'cross-site', Origin: TEST_ORIGIN }],
      ['same-site', { 'Sec-Fetch-Site': 'same-site' }],
    ];
    for (const [label, headers] of attempts) {
      const res = await raw().post('/api/auth/logout').set('Cookie', cookie).set(headers);
      expect(res.status, label).toBe(403);
      expect(res.body.code, label).toBe('bad_origin');
    }
    // The session survived every refused attempt.
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
  });

  it('accepts a matching Origin or a same-origin fetch, and never asks GET for one', async () => {
    const cookie = await loginAs(fx, 'provider1');
    expect((await raw().get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
    expect((await raw().get('/api/clients').set('Cookie', cookie)).status).toBe(200);

    const accepted: Array<[string, Record<string, string>]> = [
      ['Origin', { Origin: TEST_ORIGIN }],
      ['Sec-Fetch-Site same-origin', { 'Sec-Fetch-Site': 'same-origin' }],
      ['Sec-Fetch-Site none', { 'Sec-Fetch-Site': 'none' }],
    ];
    for (const [label, headers] of accepted) {
      const res = await raw().post('/api/messages').set('Cookie', cookie).set(headers).send({ clientId: fx.client1a.id, content: `hi via ${label}` });
      expect(res.status, label).toBeLessThan(300);
    }
  });

  it('runs before authentication and before the multipart parser', async () => {
    const anon = await raw().post('/api/clients').set('Origin', 'https://evil.example').send({ name: 'x', email: 'x@example.test' });
    expect(anon.status).toBe(403);
    expect(anon.body.code).toBe('bad_origin');

    const cookie = await loginAs(fx, 'client1a');
    const upload = await raw()
      .post(`/api/documents/${fx.client1a.request}/file`)
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .attach('file', PDF_BYTES, { filename: 'evil.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(403);
    expect(upload.body.code).toBe('bad_origin');

    const doc = await request(app).get(`/api/documents/${fx.client1a.request}`).set('Cookie', cookie);
    expect(doc.body.hasFile).toBe(false);
  });
});

describe('limits', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('caps message bodies, names and instructions', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const client = await loginAs(fx, 'client1a');

    const okMsg = await request(app).post('/api/messages').set('Cookie', client).send({ content: 'x'.repeat(MESSAGE_MAX) });
    expect(okMsg.status).toBeLessThan(300);
    const longMsg = await request(app).post('/api/messages').set('Cookie', client).send({ content: 'x'.repeat(MESSAGE_MAX + 1) });
    expect(longMsg.status).toBe(400);

    const longName = await request(app)
      .post('/api/clients')
      .set('Cookie', advisor)
      .send({ name: 'n'.repeat(NAME_MAX + 1), email: 'long@example.test' });
    expect(longName.status).toBe(400);

    const longInstructions = await request(app)
      .post('/api/documents')
      .set('Cookie', advisor)
      .send({ clientId: fx.client1a.id, name: 'W-2', isRequested: true, description: 'i'.repeat(INSTRUCTIONS_MAX + 1) });
    expect(longInstructions.status).toBe(400);

    const rename = await request(app)
      .patch(`/api/documents/${fx.client1a.upload}`)
      .set('Cookie', advisor)
      .send({ name: 'n'.repeat(NAME_MAX + 1) });
    expect(rename.status).toBe(400);
  });

  it('refuses JSON bodies over 1 MB with 413 and malformed JSON with 400', async () => {
    const client = await loginAs(fx, 'client1a');
    const huge = await request(app)
      .post('/api/messages')
      .set('Cookie', client)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ content: 'x'.repeat(1_100_000) }));
    expect(huge.status).toBe(413);
    expect(huge.body.error).toMatch(/too large/i);

    const malformed = await request(app)
      .post('/api/messages')
      .set('Cookie', client)
      .set('Content-Type', 'application/json')
      .send('{"content": ');
    expect(malformed.status).toBe(400);
  });

  it('throttles per session (per IP when anonymous) and answers 429 past the limit', async () => {
    const mini = express();
    mini.use(cookieParser());
    mini.use(createGlobalLimiter(3));
    mini.get('/', (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 3; i++) expect((await supertest(mini).get('/')).status).toBe(200);
    const blocked = await supertest(mini).get('/');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('rate_limited');

    // A session has its own budget, separate from the anonymous IP bucket.
    expect((await supertest(mini).get('/').set('Cookie', 'docflow_session=session-a')).status).toBe(200);
    for (let i = 0; i < 2; i++) await supertest(mini).get('/').set('Cookie', 'docflow_session=session-a');
    expect((await supertest(mini).get('/').set('Cookie', 'docflow_session=session-a')).status).toBe(429);
    expect((await supertest(mini).get('/').set('Cookie', 'docflow_session=session-b')).status).toBe(200);
  });

  it('locks an email after 10 failed logins in a window, independent of the IP limit', async () => {
    const email = fx.client2a.email;
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong', kind: 'client' });
      expect(res.status, `attempt ${i + 1}`).toBe(401);
    }
    const locked = await request(app).post('/api/auth/login').send({ email, password: PASSWORD, kind: 'client' });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('rate_limited');

    // Another account from the same IP is still fine (10 failures < the 20 per IP).
    const other = await request(app).post('/api/auth/login').send({ email: fx.client1a.email, password: PASSWORD, kind: 'client' });
    expect(other.status).toBe(200);
  });
});
