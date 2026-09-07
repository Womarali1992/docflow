/**
 * The async-handler guarantee.
 *
 * Express 4 ignores what a handler returns, so a rejected promise from an
 * `async` handler reaches nobody and Node kills the process. That is not a
 * theoretical failure: `2026 Form 1040 — draft.pdf` did exactly this to the API
 * on 2026-09-07 (`d59fe14`). `asyncRouter()` closes it for every route at once,
 * and these tests are what keep it closed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { asyncRouter } from '../src/routes/async-router.js';

const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes');

/** An app shaped like the real one: a router, then the JSON error handler. */
function appWith(mount: (r: ReturnType<typeof asyncRouter>) => void) {
  const app = express();
  const router = asyncRouter();
  mount(router);
  app.use(router);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: 'Internal server error', message: (err as Error)?.message });
  });
  return app;
}

describe('asyncRouter', () => {
  it('turns a rejected async handler into a 500 rather than an unhandled rejection', async () => {
    const app = appWith((r) =>
      r.get('/boom', async () => {
        throw new Error('kaboom');
      })
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('kaboom');
  });

  it('catches a rejection from an awaited call, not just a bare throw', async () => {
    const app = appWith((r) =>
      r.post('/boom', async () => {
        await Promise.reject(new Error('downstream failed'));
      })
    );
    const res = await request(app).post('/boom');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('downstream failed');
  });

  it('still routes a synchronous throw to the error handler', async () => {
    const app = appWith((r) =>
      r.get('/boom', () => {
        throw new Error('sync kaboom');
      })
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('sync kaboom');
  });

  it('leaves a handler that succeeds completely alone', async () => {
    const app = appWith((r) => r.get('/ok', async (_req, res) => void res.json({ fine: true })));
    const res = await request(app).get('/ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fine: true });
  });

  it('does not double-report a handler that already catches for itself', async () => {
    // documents.ts and versions.ts hand `.catch(next)` in by hand. The wrapper
    // sees a promise that has already settled, so the error travels once.
    let calls = 0;
    const app = appWith((r) =>
      r.get('/boom', (_req, _res, next) => {
        Promise.reject(new Error('once')).catch((err) => {
          calls++;
          next(err);
        });
      })
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(calls).toBe(1);
  });

  it('keeps middleware in the chain working, including one that refuses', async () => {
    const app = appWith((r) =>
      r.get(
        '/guarded',
        (_req, res, next) => (res.locals.seen = true) && next(),
        async (_req, res) => void res.json({ seen: res.locals.seen })
      )
    );
    const res = await request(app).get('/guarded');
    expect(res.body).toEqual({ seen: true });
  });

  it('is what every route file uses — no route mounts a bare express Router', () => {
    // The guarantee is only as good as its adoption, and the next route file is
    // the one most likely to forget. A grep is a cheaper reviewer than an
    // outage: `async-router.ts` is the sole legitimate caller of `Router()`.
    const offenders: string[] = [];
    for (const entry of fs.readdirSync(routesDir)) {
      if (!entry.endsWith('.ts') || entry === 'async-router.ts') continue;
      const src = fs.readFileSync(path.join(routesDir, entry), 'utf8');
      if (/\bRouter\(\)/.test(src)) offenders.push(entry);
    }
    expect(offenders).toEqual([]);
  });
});
