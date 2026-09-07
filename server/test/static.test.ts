/**
 * Serving the built app from the API process (`SERVE_STATIC=1`, plan 2.7).
 *
 * The audit assumed Caddy in front, sending the HTML security policy. There is
 * no Caddy on this deployment, so without this the app is only ever served by
 * Vite's dev server, which sends no CSP at all. Two things have to hold:
 *
 *   - the HTML shell carries a real policy — scripts `'self'` only, no
 *     `unsafe-inline` and no `unsafe-eval`, so an injected `<script>` is inert;
 *   - mounting a catch-all under the same app does not swallow `/api`. A `*`
 *     route in the wrong place turns every missing endpoint into a 200 page,
 *     which the client would then try to parse as JSON.
 *
 * The app under test is composed the way `app.ts` composes it — API headers,
 * the `/api` 404, then the SPA — because the ordering *is* the thing at risk.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HTML_CONTENT_SECURITY_POLICY, isStaticEnabled, spa } from '../src/security/static.js';
import { CONTENT_SECURITY_POLICY, permissionsPolicy, securityHeaders } from '../src/security/headers.js';
import { app as realApp } from './helpers.js';

let dist: string;
let served: express.Express;

beforeAll(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'docflow-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>DocFlow</title><div id="root"></div>');
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log(1)\n');
  fs.writeFileSync(path.join(dist, 'favicon.ico'), 'not really an icon');

  served = express();
  served.disable('x-powered-by');
  served.use(securityHeaders);
  served.use(permissionsPolicy);
  served.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  served.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  served.use(spa(dist));
});

afterAll(() => {
  fs.rmSync(dist, { recursive: true, force: true });
});

const get = (url: string) => supertest(served).get(url);

describe('SERVE_STATIC', () => {
  it('is off unless it is exactly 1, and the ordinary app does not serve HTML', async () => {
    expect(isStaticEnabled({})).toBe(false);
    expect(isStaticEnabled({ SERVE_STATIC: '0' })).toBe(false);
    expect(isStaticEnabled({ SERVE_STATIC: 'true' })).toBe(false);
    expect(isStaticEnabled({ SERVE_STATIC: '1' })).toBe(true);

    // The app the whole suite uses was built without it: `/` is not a page.
    const res = await supertest(realApp).get('/');
    expect(res.status).toBe(404);
  });
});

describe('the served app', () => {
  it('answers / with the shell, under a policy that will not run injected script', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<div id="root">');

    const csp = res.headers['content-security-policy'];
    expect(csp).toBe(HTML_CONTENT_SECURITY_POLICY);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline; ');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");

    // The shell names the hashed bundles, so caching it hides a deploy.
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('gives every client-side route the same shell, and never caches it', async () => {
    for (const route of ['/portal', '/clients/some-id', '/deeply/nested/route']) {
      const res = await get(route);
      expect(res.status, route).toBe(200);
      expect(res.headers['content-type'], route).toMatch(/text\/html/);
      expect(res.headers['cache-control'], route).toBe('no-cache');
      expect(res.headers['content-security-policy'], route).toBe(HTML_CONTENT_SECURITY_POLICY);
    }
  });

  it('caches hashed assets hard, because their names change when they do', async () => {
    const res = await get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/max-age=31536000/);
    expect(res.headers['cache-control']).toMatch(/immutable/);
    // An asset is not a document: it keeps the tight API policy from helmet.
    expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('still answers /api as JSON — the catch-all does not swallow the API', async () => {
    const ok = await get('/api/health');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });

    // The case that would break the client: a missing endpoint answering 200 HTML.
    const missing = await get('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.headers['content-type']).toMatch(/application\/json/);
    expect(missing.body).toEqual({ error: 'Not found' });

    const nested = await get('/api/requests/does-not-exist/versions');
    expect(nested.status).toBe(404);
    expect(nested.headers['content-type']).toMatch(/application\/json/);
  });

  it('keeps the API security headers on the page as well', async () => {
    const res = await get('/');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  /**
   * `.env` on this machine carries `CORS_ORIGIN=http://localhost:8080` from the
   * development shape. If a served run inherited it, any page on :8080 could
   * read the API with the operator's cookies — the origin check refuses
   * cross-site writes, but not reads. Serving the app means one origin, so CORS
   * is not mounted; the split-origin app still gets it.
   *
   * This has to build the real `app.ts` a second time with the flag set:
   * asserting it against the hand-composed app above would only prove that this
   * file did not mount CORS, which is not the claim.
   */
  it('grants no second origin credentialed access when it serves the app itself', async () => {
    // The suite's own app is the split-origin shape, and still answers CORS.
    const devRes = await supertest(realApp).get('/api/health').set('Origin', 'http://localhost:8080');
    expect(devRes.headers['access-control-allow-origin']).toBe('http://localhost:8080');

    const before = process.env.SERVE_STATIC;
    process.env.SERVE_STATIC = '1';
    try {
      vi.resetModules();
      const { default: servedApp } = (await import('../src/app.js')) as { default: express.Express };
      const res = await supertest(servedApp).get('/api/health').set('Origin', 'http://localhost:8080');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      // Still the API, not the shell: /api never falls through to index.html.
      expect(res.body).toMatchObject({ ok: true });
    } finally {
      if (before === undefined) delete process.env.SERVE_STATIC;
      else process.env.SERVE_STATIC = before;
      vi.resetModules();
    }
  });
});
