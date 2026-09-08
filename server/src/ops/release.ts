/**
 * What is running here (H7).
 *
 * The commit comes from `dist/release.json`, written by `scripts/release-stamp.mjs`
 * as a `postbuild` step — never from a `git` call at request time. A deployed
 * tree need not be a checkout, and a status endpoint that spawns a subprocess
 * has become something else.
 *
 * A development run (`tsx src/index.ts`) has no `dist`, so the answer is nulls
 * and a note saying why. That is the honest shape: "this build does not know"
 * is a fact, and pretending otherwise is how a panel starts lying.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Release {
  commit: string | null;
  short: string | null;
  branch: string | null;
  /** Null when git could not be asked; true when the build had uncommitted changes. */
  dirty: boolean | null;
  builtAt: string | null;
  node: string;
  note: string | null;
}

/* `dist/ops/release.js` → `dist/release.json`. In a `tsx` run the same walk
   lands on `src/release.json`, which does not exist — hence the fallback. */
const stampPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'release.json');

let cached: Release | null = null;

export function release(): Release {
  if (cached) return cached;
  let stamp: Partial<Release> = {};
  let note: string | null = 'no dist/release.json — this process was started from source, not from a build';
  try {
    stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8')) as Partial<Release>;
    note = stamp.note ?? null;
  } catch {
    // Left as the note above: a source run, or a build that never got stamped.
  }
  cached = {
    commit: stamp.commit ?? null,
    short: stamp.short ?? null,
    branch: stamp.branch ?? null,
    dirty: stamp.dirty ?? null,
    builtAt: stamp.builtAt ?? null,
    /* The node running now, not the one that built: they can differ, and the
       one that matters for a crash is this one. */
    node: process.version,
    note,
  };
  return cached;
}

/**
 * A short label for this build, for the worker to stamp on its heartbeat —
 * so "the API was updated and the worker was not" is visible rather than
 * deduced from behaviour.
 */
export function releaseLabel(): string {
  const r = release();
  if (!r.short) return `source ${process.version}`;
  return r.dirty ? `${r.short}-dirty` : r.short;
}

/** Tests only: the file is read once per process. */
export function resetReleaseCache(): void {
  cached = null;
}
