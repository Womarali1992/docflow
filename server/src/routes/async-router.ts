/**
 * A Router whose handlers may be `async` without that being an availability bug.
 *
 * Express 4 calls a route handler and ignores what it returns. A handler
 * declared `async` returns a promise, so when it rejects there is nobody to
 * catch it: the rejection never reaches the error handler in `app.ts`, and Node
 * treats an unhandled rejection as fatal. One bad input does not produce a 500,
 * it ends the process — for every signed-in user at once.
 *
 * That is not hypothetical here. On 2026-09-07 a document called
 * `2026 Form 1040 — draft.pdf` made the delivery routes throw `ERR_INVALID_CHAR`
 * while composing a `Content-Disposition` header, and took the API down with it
 * (`d59fe14`). Those two routes were fixed by hand with `.catch(next)`, and the
 * plan recorded the general form of the lesson: every other `async` handler was
 * the same defect waiting for the right input. There were 65 of them.
 *
 * Fixing each by hand is 65 chances to forget one, and the next handler somebody
 * writes would start the count again. So the guarantee lives in the router
 * instead: `asyncRouter()` is a normal `express.Router()` whose verb methods
 * wrap each handler, turning a rejected promise (and a synchronous throw) into
 * `next(err)`. The result is the 500 the error handler was always there to give.
 *
 * Scope: routers only. A handler registered straight onto the app in `app.ts`
 * never passes through here — today that is just `/api/health`, which wraps its
 * own body in try/catch. Anything else added there has to do the same.
 *
 * Express 5 does this natively. When the pilot moves to it, this file can go and
 * `asyncRouter()` becomes `Router()` again.
 */
import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from 'express';

/**
 * Only the HTTP verbs. `use` and `param` take middleware, and the middleware
 * this app mounts already routes its own failures through `next(err)` — see
 * `makeAuthenticate` in `middleware/auth.ts`. Leaving them alone also keeps
 * `router.use(someRouter)` passing a Router through untouched, rather than
 * flattening it into a plain function.
 */
const VERBS = ['get', 'post', 'put', 'patch', 'delete'] as const;

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

/**
 * One handler, wrapped so neither a throw nor a rejection escapes.
 *
 * The wrapper is written with three explicit parameters on purpose. Express
 * reads `fn.length` to tell a request handler (3 or fewer) from an error handler
 * (4), so a `(...args)` signature would change how Express classifies it.
 */
function wrap(fn: unknown): unknown {
  if (typeof fn !== 'function') return fn;
  const handler = fn as Handler;
  return function asyncSafe(req: Request, res: Response, next: NextFunction) {
    let result: unknown;
    try {
      result = handler(req, res, next);
    } catch (err) {
      next(err);
      return;
    }
    // A handler that already does its own `.catch(next)` hands back a settled
    // promise, so this is a no-op rather than a second error path.
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).catch(next);
    }
  };
}

/** `express.Router()`, with the guarantee above on every verb it routes. */
export function asyncRouter(): ExpressRouter {
  const router = Router();
  for (const verb of VERBS) {
    const original = router[verb].bind(router) as (...args: unknown[]) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (router as any)[verb] = (path: unknown, ...handlers: unknown[]) => original(path, ...handlers.map(wrap));
  }
  return router;
}
