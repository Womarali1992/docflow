/**
 * Serving the built app from the API process (`SERVE_STATIC=1`).
 *
 * The audit's F7 assumed Caddy in front, terminating TLS and sending the HTML
 * security policy. There is no Caddy here — the deployment is one laptop — so
 * without this the app is only ever served by Vite's dev server, which sends no
 * CSP at all. Rather than leave the browser unprotected or install a reverse
 * proxy nobody will maintain, Express serves `dist/` itself and sends the policy.
 *
 * One origin, on loopback: `http://127.0.0.1:4000` answers both the SPA and
 * `/api`, which also makes the origin check (invariant: origin check first)
 * trivially satisfied instead of cross-origin.
 *
 * Two policies, on purpose. `/api` keeps the tight JSON policy from
 * `headers.ts` — it never returns a document to render. The HTML shell needs
 * more, but only just: scripts stay `'self'` with no `unsafe-inline` and no
 * `unsafe-eval`, so an injected `<script>` still cannot run. Styles get
 * `'unsafe-inline'` because Radix/shadcn set inline `style` attributes for
 * positioning, which is not a script-execution vector and is the one relaxation
 * the built app actually needs.
 *
 * Off unless `SERVE_STATIC=1`, so `npm run dev` on :8080 is unchanged.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

/**
 * The policy for the HTML shell. Spaces after the semicolons, unlike helmet's
 * joined form, because this one is written here rather than emitted by helmet.
 */
export const HTML_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // Radix/shadcn position floating elements with inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "frame-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * `<repo>/dist` — where `npm run build` at the root puts the app.
 *
 * Derived from this module rather than `process.cwd()`, which depends on where
 * the service was started from: `server/src/security/` and `server/dist/security/`
 * are both three levels below the repository root.
 */
export function defaultDistDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist');
}

export function isStaticEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SERVE_STATIC || '').trim() === '1';
}

/**
 * Assets by hashed name are immutable and cached for a year; the HTML shell
 * that names them is never cached, or a deploy would be invisible until
 * somebody cleared their browser.
 */
export function spa(distDir: string): express.Router {
  const router = express.Router();
  const indexHtml = path.join(distDir, 'index.html');

  router.use(
    express.static(distDir, {
      index: false,
      maxAge: '1y',
      immutable: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Content-Security-Policy', HTML_CONTENT_SECURITY_POLICY);
        }
      },
    })
  );

  // Every other path is a client-side route: send the shell and let the router
  // decide. `/api` never reaches here — it is answered (or 404'd) above.
  router.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Security-Policy', HTML_CONTENT_SECURITY_POLICY);
    res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  });

  return router;
}
