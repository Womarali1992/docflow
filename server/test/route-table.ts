/**
 * Every route the built app answers, read from Express's own router stacks.
 *
 * The 2026-11-11 audit found rules enforced on one route and not on its
 * sibling. A test that names the routes it checks cannot see a route added
 * later, so the guards walk the app instead: a new route with no entry fails
 * the suite until someone decides what it should do.
 *
 * Express 4 keeps a mount path only as a regexp, so it is read back from that
 * for the literal mounts this app uses (`app.use('/api/requests', router)`).
 */
import type { Express } from 'express';

export interface RouteEntry {
  method: string;
  /** The full path as written, `:params` and all: `/api/requests/:id/accept`. */
  path: string;
}

interface Layer {
  name?: string;
  regexp?: RegExp & { fast_slash?: boolean };
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

/** `^\/api\/requests\/?(?=\/|$)` → `/api/requests`. */
function mountPath(layer: Layer): string {
  if (!layer.regexp || layer.regexp.fast_slash) return '';
  const source = layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\\\//g, '/');
  if (/[\\()[\]*+?]/.test(source)) throw new Error(`route-table: cannot read the mount path ${layer.regexp.source}`);
  return source;
}

function walk(stack: Layer[], prefix: string, out: RouteEntry[]): void {
  for (const layer of stack) {
    if (layer.route) {
      for (const [method, on] of Object.entries(layer.route.methods)) {
        if (on && method !== '_all') out.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      walk(layer.handle.stack, prefix + mountPath(layer), out);
    }
  }
}

export function routeTable(app: Express): RouteEntry[] {
  const out: RouteEntry[] = [];
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, '', out);
  return out;
}

export const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
